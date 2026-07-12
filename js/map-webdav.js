// WebDAV-Import (z. B. Nextcloud): alle Bilder eines Ordners laden,
// EXIF-Position/-Datum auslesen und als Stationen auf die Karte bringen.
//
// Der Zugriff läuft über webdav-proxy.php auf demselben Server: Browser
// dürfen fremde WebDAV-Server aus Sicherheitsgründen (CORS) nicht direkt
// ansprechen. Das PHP-Skript übernimmt die eigentliche Anfrage
// serverseitig (dafür gilt CORS nicht) und reicht die Antwort durch.
// Erfordert PHP-fähiges Hosting — webdav-proxy.php muss mit hochgeladen sein.

import { IMG_QUALITIES, PROXY_KEY } from './map-config.js';
import { getSetting } from './map-settings.js';
import { t } from './map-i18n.js';
import { fileToDataURL } from './map-utils.js';
import { readExif } from './map-exif.js';
import { createPoi, sortPois } from './map-pois.js';
import { fitToMarkers } from './map-core.js';

const IMAGE_EXT = /\.(jpe?g|png|webp|hei[cf])$/i;
const PROXY_URL = 'webdav-proxy.php';

// Anfrage über den Server-Proxy schicken (kein direkter Cross-Origin-
// Zugriff aus dem Browser). Wirft 'auth' bei 401/403 von der Gegenstelle,
// 'proxy' bei Fehlern im Proxy selbst (erkennbar am X-Proxy-Error-Header).
async function proxyFetch(action, url) {
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    body: new URLSearchParams({
      action,
      url,
      user: getSetting('webdavUser'),
      pass: getSetting('webdavPass'),
      key: PROXY_KEY
    })
  });
  if (res.headers.get('X-Proxy-Error')) throw new Error('proxy');
  if (res.status === 401 || res.status === 403) throw new Error('auth');
  if (!res.ok) throw new Error('http ' + res.status);
  return res;
}

// Ordner auflisten → Bild-URLs
async function listImages(baseUrl) {
  const res = await proxyFetch('list', baseUrl);
  const xml = new DOMParser().parseFromString(await res.text(), 'application/xml');
  // Namespace-tolerant: getElementsByTagNameNS mit DAV:
  const responses = xml.getElementsByTagNameNS('DAV:', 'href');
  const basePath = new URL(baseUrl).pathname.replace(/\/+$/, '');
  const urls = [];
  for (const el of responses) {
    const href = el.textContent.trim();
    const abs = new URL(href, baseUrl);
    if (abs.pathname.replace(/\/+$/, '') === basePath) continue; // der Ordner selbst
    if (!IMAGE_EXT.test(abs.pathname)) continue;
    urls.push(abs.href);
  }
  return urls;
}

// Alle Ordnerbilder importieren; onProgress(fertig, gesamt) für die Anzeige.
// Rückgabe: { imported, skipped, total } — skipped = Bilder ohne GPS-Daten.
export async function importFromWebdav(map, onProgress) {
  const baseUrl = (getSetting('webdavUrl') || '').trim();
  if (!baseUrl) throw new Error('nourl');

  const urls = await listImages(baseUrl);

  const q = IMG_QUALITIES[getSetting('imgQuality')] || IMG_QUALITIES.medium;
  let imported = 0;
  let skipped = 0;
  const added = [];

  for (let i = 0; i < urls.length; i++) {
    onProgress?.(i, urls.length);
    try {
      const res = await proxyFetch('get', urls[i]);
      const blob = await res.blob();
      const exif = readExif(await blob.arrayBuffer());
      if (exif.lat == null || exif.lng == null) { skipped++; continue; }

      const fileName = decodeURIComponent(new URL(urls[i]).pathname.split('/').pop());
      const file = new File([blob], fileName, { type: blob.type || 'image/jpeg' });
      const dataUrl = await fileToDataURL(file, q.maxSide, q.quality);

      added.push(createPoi(map, {
        lat: exif.lat,
        lng: exif.lng,
        name: fileName.replace(/\.[^.]+$/, ''),
        img: dataUrl,
        createdAt: exif.date || ''
      }));
      imported++;
    } catch (e) {
      console.warn('WebDAV-Bild übersprungen:', urls[i], e);
      skipped++;
    }
  }
  onProgress?.(urls.length, urls.length);

  if (added.length) {
    // Wunsch: Nummerierung folgt dem Aufnahmedatum
    sortPois(map, 'date', 'asc');
    fitToMarkers(map);
  }
  return { imported, skipped, total: urls.length };
}

// Fehler → verständliche, übersetzte Meldung
export function webdavErrorMessage(e) {
  const msg = e?.message || String(e);
  if (msg === 'nourl') return t('webdavNoUrl');
  if (msg === 'auth') return t('webdavAuthError');
  if (msg === 'proxy') return t('webdavProxyError');
  return t('webdavError', { msg });
}
