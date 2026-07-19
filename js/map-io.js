// Import / Export: GeoJSON, GPX (Komoot-kompatibel), offline-fähige
// Ein-Datei-HTML und HTML+Bilder als ZIP

import { CDN } from './map-config.js';
import { getSetting, setSetting } from './map-settings.js';
import { t } from './map-i18n.js';
import {
  readFileAsText, triggerBlobDownload, escapeXml,
  dataURLToBytes, buildZipBlob
} from './map-utils.js';
import { createPoi, renumberAndRoute, pushUndo } from './map-pois.js';
import { writeExif } from './map-exif.js';

const $ = id => document.getElementById(id);

// Dateiname mit Datum, z. B. tourlocate-2026-07-12.gpx
function exportFilename(ext) {
  return `tourlocate-${new Date().toISOString().slice(0, 10)}.${ext}`;
}

export function setupIO(map) {
  // onclick/onchange-Zuweisung ist idempotent → gefahrlos wiederholbar
  // (bfcache/DDG-Reaktivierung wie im Alt-Code, aber ohne Doppelbindung)
  const bind = () => {
    $('importGeoBtn').onclick = () => { const f = $('fileGeo'); f.value = ''; f.click(); };
    $('importGpxBtn').onclick = () => { const f = $('fileGpx'); f.value = ''; f.click(); };
    $('fileGeo').onchange = e => importGeoFile(map, e.target);
    $('fileGpx').onchange = e => importGpxFile(map, e.target);

    $('exportGeoBtn').onclick = async () => triggerBlobDownload(exportFilename('geojson'), await buildGeoJSONBlob(map));
    $('exportGpxBtn').onclick = () => triggerBlobDownload(exportFilename('gpx'), buildGpxBlob(map));
    $('exportHtmlBtn').onclick = () => exportHtml(map, 'single');
    $('exportZipBtn').onclick = () => exportHtml(map, 'zip');
    const imsBtn = $('exportImsBtn');
    if (imsBtn) imsBtn.onclick = () => exportHtml(map, 'ims');
  };
  bind();
  window.addEventListener('pageshow', bind);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) bind(); });
}

// Server-Modus (Editor): Bild-URLs (api/image.php?id=…) vorab zu Base64
// auflösen, damit die Export-Funktionen unverändert greifen. In der
// statischen App ist map.resolveImage nicht gesetzt → leere Map, die
// Exporte nutzen dann direkt das schon vorhandene Base64 in p.img.
async function resolveExportImages(map) {
  const m = new Map();
  if (typeof map.resolveImage !== 'function') return m;
  for (const p of map.state.pois) {
    if (p.img && !m.has(p.img)) {
      try {
        m.set(p.img, await map.resolveImage(p.img));
      } catch (e) {
        console.warn('Export: Bild konnte nicht aufgelöst werden:', p.img, e);
      }
    }
  }
  return m;
}

// Verbindungs-Geometrie für Exporte gemäß Einstellung
function exportRoute(map) {
  if (getSetting('lineMode') === 'none') return [];
  const S = map.state;
  return (S.routeCoords && S.routeCoords.length)
    ? S.routeCoords
    : S.pois.map(p => [p.lat, p.lng]);
}

// ==================== Export: GeoJSON ====================
// async, weil im Server-Modus (Editor) die Bild-URLs vorab zu Base64
// aufgelöst werden — sonst enthielte die Datei nur login-geschützte
// api/image.php-URLs statt eigenständiger Bilddaten.
export async function buildGeoJSONBlob(map) {
  const imgMap = await resolveExportImages(map);
  const fc = {
    type: 'FeatureCollection',
    features: map.state.pois.map((p, i) => ({
      type: 'Feature',
      properties: {
        index: i + 1, name: p.name, link: p.link, linkText: p.linkText || '',
        img: p.img ? ((imgMap && imgMap.get(p.img)) || p.img) : '',
        createdAt: p.createdAt || ''
      },
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] }
    }))
  };
  return new Blob([JSON.stringify(fc, null, 2)], { type: 'application/json' });
}

// ==================== Export: GPX (Komoot-kompatibel) ====================
// Wegpunkte MIT Zeitstempel plus die Strecke als <trk> — Track ist das,
// was Komoot & Co. als Tour importieren.
export function buildGpxBlob(map) {
  const pois = map.state.pois;

  // GPX-Schema: in <wpt> kommt <time> VOR <name>
  const wpts = pois.map((p, i) => {
    const time = p.createdAt ? `<time>${escapeXml(p.createdAt)}</time>` : '';
    return `  <wpt lat="${p.lat}" lon="${p.lng}">${time}<name>${escapeXml((i + 1) + '. ' + (p.name || t('station')))}</name></wpt>`;
  }).join('\n');

  const route = exportRoute(map);
  let trk = '';
  if (route.length > 1) {
    const pts = route.map(([lat, lng]) => `      <trkpt lat="${lat}" lon="${lng}"></trkpt>`).join('\n');
    trk = `  <trk>\n    <name>Tourlocate</name>\n    <trkseg>\n${pts}\n    </trkseg>\n  </trk>\n`;
  }

  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Tourlocate" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>Tourlocate</name>
    <time>${new Date().toISOString()}</time>
  </metadata>
${wpts}
${trk}</gpx>`;
  return new Blob([gpx], { type: 'application/gpx+xml' });
}

// ==================== Import: GeoJSON / GPX ====================
function importGeoFile(map, input) {
  const f = input.files && input.files[0];
  if (!f) return;
  readFileAsText(f).then(text => {
    const geo = JSON.parse(text);
    if (!(geo.type === 'FeatureCollection' || geo.type === 'Feature')) {
      alert(t('invalidGeojson'));
      return;
    }
    pushUndo(map); // Import rückgängig machbar
    importFeatures(map, geo, { namesOnly: false });
  }).catch(err => {
    alert(t('geojsonError', { msg: err?.message || err }));
    console.warn('Fehler beim GeoJSON-Import:', err);
  }).finally(() => { input.value = ''; });
}

// Track-Geometrie (<trk>/<rte> → LineString/MultiLineString) als
// [[lat,lng],...] extrahieren; null, wenn keine brauchbare Strecke da ist.
function extractTrack(gj) {
  const coords = [];
  (gj.features || []).forEach(ft => {
    const g = ft?.geometry;
    if (!g) return;
    if (g.type === 'LineString') {
      g.coordinates.forEach(c => coords.push([c[1], c[0]]));
    } else if (g.type === 'MultiLineString') {
      g.coordinates.forEach(seg => seg.forEach(c => coords.push([c[1], c[0]])));
    }
  });
  return coords.length >= 2 ? coords : null;
}

function importGpxFile(map, input) {
  const f = input.files && input.files[0];
  if (!f) return;
  readFileAsText(f).then(text => {
    // Das UMD-Global von @tmcw/togeojson heißt kleingeschrieben "togeojson"
    const tg = window.togeojson || window.toGeoJSON;
    if (!tg) {
      alert(t('needTogeojson'));
      return;
    }
    const xml = new DOMParser().parseFromString(text, 'application/xml');
    const gj = tg.gpx(xml);
    if (gj.type !== 'FeatureCollection') {
      alert(t('invalidGpx'));
      return;
    }

    const track = extractTrack(gj);
    const hasPoints = (gj.features || []).some(ft => ft?.geometry?.type === 'Point');
    if (!track && !hasPoints) {
      alert(t('invalidGpx'));
      return;
    }

    pushUndo(map); // Import rückgängig machbar

    // Aufzeichnung übernehmen und in den Track-Modus schalten (Stationen
    // rasten dann auf die Strecke ein, die Verbindung folgt der Aufnahme).
    map.state.track = track;
    if (track) setSetting('lineMode', 'track');
    map.onTrackChanged?.();

    if (hasPoints) {
      // Wegpunkte sind die Stationen (rasten im Track-Modus auf die Strecke)
      importFeatures(map, gj, { namesOnly: true });
    } else {
      // Reine Aufzeichnung ohne Wegpunkte: Start + Ende als Stationen
      const s = track[0];
      const e = track[track.length - 1];
      createPoi(map, { lat: s[0], lng: s[1], name: t('trackStart') });
      createPoi(map, { lat: e[0], lng: e[1], name: t('trackEnd') });
      renumberAndRoute(map);
    }

    // An die gesamte Aufzeichnung heranzoomen (nicht nur an die 2 Marker)
    if (track) {
      const b = L.polyline(track).getBounds();
      if (b.isValid()) map.fitBounds(b.pad(0.1));
    }
  }).catch(err => {
    alert(t('gpxError', { msg: err?.message || err }));
    console.warn('Fehler beim GPX-Import:', err);
  }).finally(() => { input.value = ''; });
}

// Point-Features additiv als POIs übernehmen (gleicher Codepfad wie
// manuelles Anlegen), danach Route/Nummern aktualisieren und hinzoomen
function importFeatures(map, gj, { namesOnly }) {
  const features = gj.type === 'Feature' ? [gj] : (gj.features || []);
  const added = [];

  features.forEach(ft => {
    if (ft?.geometry?.type !== 'Point') return;
    const [lng, lat] = ft.geometry.coordinates;
    let name = ft.properties?.name || '';
    // GPX aus eigenem Export trägt die Nummer im Namen → beim Re-Import strippen
    if (namesOnly) name = name.replace(/^\d+\.\s*/, '');
    added.push(createPoi(map, {
      lat, lng, name,
      link: namesOnly ? '' : (ft.properties?.link || ''),
      linkText: namesOnly ? '' : (ft.properties?.linkText || ''),
      img: namesOnly ? '' : (ft.properties?.img || ''),
      // GPX-<time> landet bei togeojson in properties.time
      createdAt: ft.properties?.createdAt || ft.properties?.time || ''
    }));
  });

  renumberAndRoute(map);

  if (added.length) {
    const bounds = L.featureGroup(added.map(p => p.marker)).getBounds();
    if (bounds.isValid()) map.fitBounds(bounds.pad(0.15));
  }
}

// IMS-Content-Package-Manifest (imsmanifest.xml). Offener 1EdTech-
// Standard; Moodle u. a. importieren solche ZIPs direkt. Die eigentliche
// Tour steckt als eigenständige index.html im selben Paket.
function imsManifest(title) {
  const t2 = escapeXml(title || 'Tourlocate');
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="TOURLOCATE-MANIFEST" version="1.1"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imscp_v1p1 http://www.imsglobal.org/xsd/imscp_v1p1.xsd">
  <organizations default="TOC">
    <organization identifier="TOC">
      <title>${t2}</title>
      <item identifier="ITEM1" identifierref="RES1">
        <title>${t2}</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES1" type="webcontent" href="index.html">
      <file href="index.html"/>
    </resource>
  </resources>
</manifest>`;
}

// ==================== Export: HTML (Ein-Datei / ZIP / IMS-Paket) ====================
// mode: 'single' (eine HTML-Datei), 'zip' (HTML + bilder/), 'ims'
// (IMS-Content-Package fuer Moodle: eigenständige HTML + imsmanifest.xml).
async function exportHtml(map, mode) {
  const zip = mode === 'zip';
  const btn = mode === 'zip' ? $('exportZipBtn')
            : mode === 'ims' ? $('exportImsBtn')
            : $('exportHtmlBtn');
  const routeinfo = $('routeinfo');
  const prevText = routeinfo.textContent;
  if (btn) btn.disabled = true;
  routeinfo.textContent = t('creatingExport');
  try {
    const snapshot = await captureMapSnapshot(map);
    const assets = await fetchLeafletAssets();
    const imgMap = await resolveExportImages(map);
    // Nur der ZIP-Modus legt Bilder als eigene Dateien ab; single und ims
    // betten sie inline als Base64 ein (eigenständige HTML).
    const { html, imgFiles } = buildExportHtml(map, snapshot, assets, { imageFolder: zip, imgMap });

    if (mode === 'zip') {
      const files = [{ name: 'tourlocate.html', data: new TextEncoder().encode(html) }];
      // Bilddateien bekommen EXIF-Daten: Stationsname, Datum, GPS-Position
      // (das Canvas-Re-Encoding beim Anhängen hatte sie entfernt)
      imgFiles.forEach(f => files.push({
        name: f.name,
        data: writeExif(dataURLToBytes(f.dataUrl), {
          lat: f.lat, lng: f.lng, dateIso: f.createdAt, description: f.poiName
        })
      }));
      triggerBlobDownload(exportFilename('zip'), buildZipBlob(files));
    } else if (mode === 'ims') {
      const enc = new TextEncoder();
      const files = [
        { name: 'imsmanifest.xml', data: enc.encode(imsManifest(document.title)) },
        { name: 'index.html', data: enc.encode(html) }
      ];
      triggerBlobDownload(exportFilename('ims.zip'), buildZipBlob(files));
    } else {
      triggerBlobDownload(exportFilename('html'), new Blob([html], { type: 'text/html;charset=utf-8' }));
    }
  } finally {
    if (btn) btn.disabled = map.state.pois.length === 0;
    routeinfo.textContent = prevText;
  }
}

// Sichtbaren Kartenausschnitt als JPEG einfangen (für die Offline-Anzeige).
// Stufe 1: geladene Kacheln aus dem DOM auf ein Canvas zeichnen.
// Stufe 2: Kacheln des Ausschnitts direkt fetchen (max. 32).
// Stufe 3 (beides fehlgeschlagen): Export ohne Schnappschuss.
async function captureMapSnapshot(map) {
  try {
    const s = captureFromDom(map);
    if (s) return s;
  } catch (e) {
    console.warn('Karten-Schnappschuss (DOM) fehlgeschlagen:', e);
  }
  try {
    return await captureFromTiles(map);
  } catch (e) {
    console.warn('Karten-Schnappschuss (Tile-Fetch) fehlgeschlagen:', e);
  }
  return null;
}

function captureFromDom(map) {
  const base = map.state.activeBase;
  const container = base?.getContainer?.();
  if (!container) return null;
  const tiles = container.querySelectorAll('img.leaflet-tile-loaded');
  if (!tiles.length) return null;

  const mapRect = map.getContainer().getBoundingClientRect();
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(mapRect.width);
  canvas.height = Math.round(mapRect.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ddd';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // getBoundingClientRect übersteht alle Pane-Transforms zuverlässig
  tiles.forEach(img => {
    const r = img.getBoundingClientRect();
    ctx.drawImage(img, r.left - mapRect.left, r.top - mapRect.top, r.width, r.height);
  });

  const dataUrl = canvas.toDataURL('image/jpeg', 0.8); // wirft bei tainted canvas
  const b = map.getBounds();
  return {
    img: dataUrl,
    bounds: [[b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]]
  };
}

async function captureFromTiles(map) {
  const base = map.state.activeBase;
  const tpl = base?._url;
  if (!tpl) return null;

  const lon2tile = (lon, z) => Math.floor((lon + 180) / 360 * Math.pow(2, z));
  const lat2tile = (lat, z) => Math.floor(
    (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z)
  );
  const tile2lon = (x, z) => x / Math.pow(2, z) * 360 - 180;
  const tile2lat = (y, z) => {
    const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
    return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  };

  const b = map.getBounds();
  let z = Math.min(Math.round(map.getZoom()), base?.options?.maxZoom ?? 19);
  let x1, x2, y1, y2;
  // Zoomstufe verringern, bis der Ausschnitt mit ≤32 Kacheln abgedeckt ist
  for (;;) {
    x1 = lon2tile(b.getWest(), z); x2 = lon2tile(b.getEast(), z);
    y1 = lat2tile(b.getNorth(), z); y2 = lat2tile(b.getSouth(), z);
    if ((x2 - x1 + 1) * (y2 - y1 + 1) <= 32 || z <= 2) break;
    z--;
  }

  const tileUrl = (x, y) => tpl
    .replace('{s}', 'a')
    .replace('{r}', '')
    .replace('{z}', z)
    .replace('{x}', x)
    .replace('{y}', y);

  const canvas = document.createElement('canvas');
  canvas.width = (x2 - x1 + 1) * 256;
  canvas.height = (y2 - y1 + 1) * 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ddd';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const jobs = [];
  let drawn = 0;
  for (let x = x1; x <= x2; x++) {
    for (let y = y1; y <= y2; y++) {
      jobs.push(
        fetch(tileUrl(x, y))
          .then(res => { if (!res.ok) throw new Error('tile ' + res.status); return res.blob(); })
          .then(blob => createImageBitmap(blob))
          .then(bmp => { ctx.drawImage(bmp, (x - x1) * 256, (y - y1) * 256); drawn++; })
          .catch(() => {}) // einzelne fehlende Kacheln sind ok
      );
    }
  }
  await Promise.all(jobs);
  if (!drawn) return null;

  return {
    img: canvas.toDataURL('image/jpeg', 0.8),
    bounds: [[tile2lat(y2 + 1, z), tile2lon(x1, z)], [tile2lat(y1, z), tile2lon(x2 + 1, z)]]
  };
}

// Leaflet-Quellen zum Einbetten holen (liegen im Browser-Cache);
// bei Fehlschlag fällt die Exportdatei auf die CDN-URLs zurück
async function fetchLeafletAssets() {
  try {
    const [jsRes, cssRes] = await Promise.all([fetch(CDN.leafletJs), fetch(CDN.leafletCss)]);
    if (!jsRes.ok || !cssRes.ok) return null;
    const js = await jsRes.text();
    const css = await cssRes.text();
    if (js.includes('</script')) return null; // würde das Inline-<script> sprengen
    return { js, css };
  } catch {
    return null;
  }
}

// Exportdatei bauen. imageFolder=true legt Bilder als eigene Dateien in
// bilder/ ab (für den ZIP-Export) statt sie als Base64 einzubetten.
function buildExportHtml(map, snapshot, assets, { imageFolder, imgMap }) {
  const S = map.state;
  const base = S.activeBase;
  const imgFiles = [];

  const GEO = S.pois.map((p, i) => {
    // Server-Modus (Editor): p.img ist eine api/image.php-URL; imgMap
    // liefert die vorab aufgelösten Base64-Daten. Statische App: p.img ist
    // schon Base64, imgMap ist leer → Fallback auf p.img.
    let img = p.img ? ((imgMap && imgMap.get(p.img)) || p.img) : '';
    if (img && imageFolder) {
      const name = 'bilder/station-' + String(i + 1).padStart(2, '0') + '.jpg';
      imgFiles.push({
        name, dataUrl: img,
        lat: p.lat, lng: p.lng, createdAt: p.createdAt || '', poiName: p.name || ''
      });
      img = name; // relative Referenz in der HTML
    }
    return {
      lat: p.lat, lng: p.lng,
      name: p.name || '', link: p.link || '', linkText: p.linkText || '', img,
      createdAt: p.createdAt || ''
    };
  });

  const data = {
    GEO,
    ROUTE: exportRoute(map),
    TILE_URL: base?._url || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    TILE_ATTR: (base?.getAttribution && base.getAttribution()) || '© OpenStreetMap',
    TILE_MAXZ: base?.options?.maxZoom || 19,
    SNAPSHOT: snapshot || null,
    STRINGS: {
      total: t('total', { km: '{km}' }),
      mapError: t('exportMapError'),
      leafletError: t('exportLeafletError')
    }
  };
  // "<" escapen, damit in der Payload nie "</script>" entsteht
  const jsonSafe = JSON.stringify(data).replace(/</g, '\\u003c');

  const leafletCssBlock = assets
    ? '<style>\n' + assets.css + '\n</style>'
    : `<link rel="stylesheet" href="${CDN.leafletCss}">`;
  const leafletJsBlock = assets
    ? '<script>\n' + assets.js + '\n</script>'
    : '';

  const html = `<!doctype html><html lang="${t('exportTitle') === 'Tourlocate Export' ? 'de' : 'en'}"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t('exportTitle')}</title>
${leafletCssBlock}
<style>
  html,body{height:100%;margin:0;font-family:system-ui,sans-serif}
  #map{height:82vh}
  #routeinfo{padding:8px 12px;font-weight:600}
  .poi-num{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;background:#2b6cb0;color:#fff;font-weight:700;font-size:13px;border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,.3)}
  .tl-card{font:12px/1.3 system-ui,sans-serif;display:flex;flex-direction:column;gap:6px}
  .tl-date{color:#777;font-size:11px}
  button.thumb{padding:0;border:0;background:none;cursor:zoom-in}
  .tl-thumb{width:120px;height:90px;background:#fff;border:1px solid #e6e6e6;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;overflow:hidden}
  .tl-thumb > img{width:100%;height:100%;object-fit:contain;display:block}
</style>
</head><body>

<div id="map"></div>
<div id="routeinfo"></div>

<script id="tl-data" type="application/json">${jsonSafe}</script>
${leafletJsBlock}
<script>
(function(){
  // Mini-Lightbox
  var W=document.createElement('div');
  W.style.cssText='position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.92);z-index:99999;padding:4vh';
  var I=document.createElement('img');
  I.style.cssText='max-width:92vw;max-height:92vh;border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.5)';
  W.appendChild(I);
  document.body.appendChild(W);
  function hide(){ W.style.display='none'; I.removeAttribute('src'); }
  W.addEventListener('click', hide, {passive:true});
  document.addEventListener('keydown', function(e){ if(e.key==='Escape') hide(); });
  document.addEventListener('click', function(e){
    var b=e.target.closest && e.target.closest('button.thumb'); if(!b) return;
    e.preventDefault();
    var src=b.getAttribute('data-img')||'', alt=b.getAttribute('data-title')||'';
    I.removeAttribute('src'); if(alt) I.alt=alt;
    var T=new Image(); T.onload=function(){ I.src=src; W.style.display='flex'; };
    T.src=src;
  }, true);

  function d2r(x){ return x*Math.PI/180; }
  function segKm(a,b){
    var dLat=d2r(b[0]-a[0]), dLng=d2r(b[1]-a[1]);
    var sa=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(d2r(a[0]))*Math.cos(d2r(b[0]))*Math.sin(dLng/2)*Math.sin(dLng/2);
    return 2*6371*Math.asin(Math.sqrt(sa));
  }
  function sumKm(c){ if(!c||c.length<2) return 0; var s=0; for(var i=1;i<c.length;i++) s+=segKm(c[i-1],c[i]); return s; }
  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function init(){
    var data=JSON.parse(document.getElementById('tl-data').textContent);
    try {
      var map=L.map('map').setView([0,0],2);

      // Offline-Fallback: Schnappschuss UNTER die Live-Kacheln legen.
      // Online verdecken die Kacheln das Bild, offline bleibt es sichtbar.
      if (data.SNAPSHOT && data.SNAPSHOT.img && data.SNAPSHOT.bounds) {
        var pane=map.createPane('tl-snapshot');
        pane.style.zIndex=150; // Kachel-Pane liegt bei 200
        L.imageOverlay(data.SNAPSHOT.img, data.SNAPSHOT.bounds, {pane:'tl-snapshot'}).addTo(map);
      }
      // OSM & Co. verlangen inzwischen einen echten Referer-Header fuer
      // Kachel-Anfragen; bei file:// (Doppelklick geoeffnet) schickt der
      // Browser keinen mit, die Server liefern dann "Access blocked"-
      // Platzhalterbilder statt echter Kacheln, die den Schnappschuss
      // darunter verdecken wuerden. Deshalb Live-Kacheln nur ueber http(s).
      if (location.protocol === 'http:' || location.protocol === 'https:') {
        L.tileLayer(data.TILE_URL, {maxZoom:data.TILE_MAXZ, attribution:data.TILE_ATTR}).addTo(map);
      }

      var markers=L.featureGroup().addTo(map);
      (data.GEO||[]).forEach(function(p,i){
        var icon=L.divIcon({className:'poi-num', html:String(i+1), iconSize:[26,26], iconAnchor:[13,13]});
        var m=L.marker([p.lat,p.lng],{icon:icon}).addTo(markers);
        var title=(i+1)+'. '+(p.name||'Station');
        var dateHtml='';
        if (p.createdAt) {
          var d=new Date(p.createdAt);
          if (!isNaN(d)) dateHtml='<div class="tl-date">'+esc(d.toLocaleString())+'</div>';
        }
        var linkHtml=p.link?'<div><a href="'+esc(p.link)+'" target="_blank" rel="noopener">'+esc(p.linkText||'Link')+'</a></div>':'';
        var imgHtml=p.img?'<div><button type="button" class="thumb" data-img="'+esc(p.img)+'" data-title="'+esc(title)+'"><span class="tl-thumb"><img src="'+esc(p.img)+'" alt=""></span></button></div>':'';
        m.bindPopup('<div class="tl-card"><strong>'+esc(title)+'</strong>'+dateHtml+linkHtml+imgHtml+'</div>');
      });

      if (Array.isArray(data.ROUTE) && data.ROUTE.length>1) {
        L.polyline(data.ROUTE, {weight:4, color:'#d33'}).addTo(map);
      }

      var b=markers.getBounds();
      if (b.isValid()) map.fitBounds(b.pad(0.15));
      else if (data.SNAPSHOT && data.SNAPSHOT.bounds) map.fitBounds(data.SNAPSHOT.bounds);
      setTimeout(function(){ map.invalidateSize(); }, 0);

      var km=0;
      if (Array.isArray(data.ROUTE) && data.ROUTE.length>1) km=sumKm(data.ROUTE);
      document.getElementById('routeinfo').textContent = km>0 ? data.STRINGS.total.replace('{km}', km.toFixed(1)) : '';
    } catch(e) {
      document.getElementById('map').innerHTML='<div style="padding:12px;color:#b00">'+esc(data.STRINGS.mapError)+esc((e&&e.message)||e)+'</div>';
    }
  }

  if (window.L) { init(); }
  else {
    var s=document.createElement('script');
    s.src='${CDN.leafletJs}';
    s.onload=init;
    s.onerror=function(){
      var data=JSON.parse(document.getElementById('tl-data').textContent);
      document.getElementById('map').innerHTML='<div style="padding:12px;color:#b00">'+data.STRINGS.leafletError+'</div>';
    };
    document.head.appendChild(s);
  }
})();
</${'script'}>

</body></html>`;

  return { html, imgFiles };
}
