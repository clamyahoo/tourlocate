// ==================== map-io.js ====================
// Import / Export: GeoJSON, GPX, HTML
// ===================================================

import { getPOIData, setPOIData } from './map-pois.js';
import { downloadFile } from './map-utils.js';
import { config } from './map-config.js';

// ---------------------------------------------------
// GeoJSON-Import
// ---------------------------------------------------
export function importGeoJSON(event, map, markersLayer, routeLayer) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.type === 'FeatureCollection') {
        const pois = data.features.map((f, i) => ({
          id: Date.now() + i,
          latlng: f.geometry.coordinates.reverse(),
          text: f.properties?.text || '',
          imgData: f.properties?.imgData || null,
          num: i + 1
        }));
        setPOIData(pois, map, markersLayer);
      }
    } catch (err) {
      alert('Fehler beim Import der GeoJSON-Datei: ' + err.message);
    }
  };
  reader.readAsText(file);
  event.target.value = ''; // Reset für nächsten Import
}

// ---------------------------------------------------
// GPX-Import
// ---------------------------------------------------
export function importGPX(event, map, markersLayer, routeLayer) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const xml = new DOMParser().parseFromString(e.target.result, 'text/xml');
      const geojson = toGeoJSON.gpx(xml);

      if (geojson && geojson.features) {
        const pois = geojson.features.map((f, i) => ({
          id: Date.now() + i,
          latlng: f.geometry.coordinates.reverse(),
          text: f.properties?.name || '',
          imgData: null,
          num: i + 1
        }));
        setPOIData(pois, map, markersLayer);
      }
    } catch (err) {
      alert('Fehler beim GPX-Import: ' + err.message);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

// ---------------------------------------------------
// GeoJSON-Export
// ---------------------------------------------------
export function exportGeoJSON(markersLayer, routeLayer) {
  const pois = getPOIData();
  const features = pois.map(p => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [p.latlng.lng, p.latlng.lat] },
    properties: { text: p.text, imgData: p.imgData }
  }));
  const geojson = { type: 'FeatureCollection', features };
  downloadFile(`${config.export.filenameBase}.geojson`, JSON.stringify(geojson, null, 2), 'application/geo+json');
}

// ---------------------------------------------------
// GPX-Export (rudimentär)
// ---------------------------------------------------
export function exportGPX(markersLayer, routeLayer) {
  const pois = getPOIData();
  const gpxPoints = pois.map(p =>
    `<wpt lat="${p.latlng.lat}" lon="${p.latlng.lng}"><name>${escapeXml(p.text || '')}</name></wpt>`
  ).join('\n');
  const gpx =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="Tourlocate">\n${gpxPoints}\n</gpx>`;
  downloadFile(`${config.export.filenameBase}.gpx`, gpx, 'application/gpx+xml');
}

// ---------------------------------------------------
// HTML-Export (komplette Karte als Ein-Datei-Version)
// ---------------------------------------------------
export function exportHTML(map, markersLayer, routeLayer) {
  const pois = getPOIData();
  const geojson = JSON.stringify(pois);

  const htmlContent = `
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Tourlocate-Export</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css">
<style>
  html, body, #map { height:100%; margin:0; }
  .poi-num{ width:26px; height:26px; border-radius:50%;
    display:grid; place-items:center;
    background:#2b6cb0; color:#fff; font-weight:700; font-size:13px;
    border:2px solid #fff; box-shadow:0 0 4px rgba(0,0,0,.3); }
</style>
</head>
<body>
<div id="map"></div>
<script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const pois = ${geojson};
const map = L.map('map').setView([48.47, 7.94], 11);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom:19, attribution:'© OpenStreetMap'
}).addTo(map);
pois.forEach(p => {
  const html = '<div class="poi-num">'+(p.num||'?')+'</div>';
  const icon = L.divIcon({html, className:'poi-icon', iconSize:[26,26]});
  const m = L.marker(p.latlng, {icon}).addTo(map);
  if (p.text) m.bindPopup(p.text);
});
</script>
</body>
</html>
`;
  downloadFile(`${config.export.filenameBase}.html`, htmlContent, 'text/html');
}

// ---------------------------------------------------
// Hilfsfunktion: XML escapen
// ---------------------------------------------------
function escapeXml(s) {
  return s.replace(/[<>&'"]/g, c => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]
  ));
}
