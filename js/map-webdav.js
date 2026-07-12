// WebDAV-Import (z. B. Nextcloud): alle Bilder eines Ordners laden,
// EXIF-Position/-Datum auslesen und als Stationen auf die Karte bringen.
//
// Hinweis CORS: Der Browser kann nur dann auf einen fremden WebDAV-Server
// zugreifen, wenn dieser CORS-Header sendet oder Tourlocate auf derselben
// Domain läuft. Nextcloud erlaubt das von Haus aus nicht — die Fehlermeldung
// weist darauf hin (Details im Hilfetext).

import { IMG_QUALITIES } from './map-config.js';
import { getSetting } from './map-settings.js';
import { t } from './map-i18n.js';
import { fileToDataURL } from './map-utils.js';
import { readExif } from './map-exif.js';
import { createPoi, sortPois } from './map-pois.js';
import { fitToMarkers } from './map-core.js';

const IMAGE_EXT = /\.(jpe?g|png|webp|hei[cf])$/i;

function authHeaders() {
  const user = getSetting('webdavUser');
  const pass = getSetting('webdavPass');
  const h = {};
  if (user) {
    // btoa verträgt kein Unicode → vorher UTF-8-encodieren
    const raw = `${user}:${pass}`;
    h.Authorization = 'Basic ' + btoa(String.fromCharCode(...new TextEncoder().encode(raw)));
  }
  return h;
}

// Ordner auflisten → Bild-URLs
async function listImages(baseUrl) {
  const res = await fetch(baseUrl, {
    method: 'PROPFIND',
    headers: {
      ...authHeaders(),
      Depth: '1',
      'Content-Type': 'application/xml'
    },
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>'
  });
  if (res.status === 401 || res.status === 403) throw new Error('auth');
  if (!res.ok) throw new Error('http ' + res.status);

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

  let urls;
  try {
    urls = await listImages(baseUrl);
  } catch (e) {
    // fetch wirft TypeError bei Netzwerk-/CORS-Blockade
    if (e instanceof TypeError) throw new Error('cors');
    throw e;
  }

  const q = IMG_QUALITIES[getSetting('imgQuality')] || IMG_QUALITIES.medium;
  let imported = 0;
  let skipped = 0;
  const added = [];

  for (let i = 0; i < urls.length; i++) {
    onProgress?.(i, urls.length);
    try {
      const res = await fetch(urls[i], { headers: authHeaders() });
      if (!res.ok) { skipped++; continue; }
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
  if (msg === 'cors') return t('webdavCorsError');
  return t('webdavError', { msg });
}
