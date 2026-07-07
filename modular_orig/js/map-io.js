// js/map-io.js
// =============== Import / Export für GeoJSON, GPX & HTML ===============

import { readFileAsText, downloadFile, geoJSONToGPX, prettyJSON } from './map-utils.js';
import { updateRoute, fitToMarkers } from './map-core.js';
import { addPOI } from './map-pois.js';

// Hauptsetup, wird in main.js aufgerufen
export function setupIO(map) {
  const importGeoBtn = document.getElementById('importGeoBtn');
  const importGpxBtn = document.getElementById('importGpxBtn');
  const exportGeoBtn = document.getElementById('exportGeoBtn');
  const exportGpxBtn = document.getElementById('exportGpxBtn');
  const exportHtmlBtn = document.getElementById('exportHtmlBtn');

  const fileGeo = document.getElementById('fileGeo');
  const fileGpx = document.getElementById('fileGpx');

  // ==================== IMPORT ====================

  importGeoBtn.addEventListener('click', () => fileGeo.click());
  importGpxBtn.addEventListener('click', () => fileGpx.click());

  fileGeo.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      const geojson = JSON.parse(text);
      loadGeoJSON(map, geojson);
    } catch (err) {
      alert('Fehler beim Importieren von GeoJSON:\n' + err);
    }
    fileGeo.value = '';
  });

  fileGpx.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      const xml = new DOMParser().parseFromString(text, 'application/xml');
      const geojson = toGeoJSON.gpx(xml);
      loadGeoJSON(map, geojson);
    } catch (err) {
      alert('Fehler beim Importieren von GPX:\n' + err);
    }
    fileGpx.value = '';
  });

  // ==================== EXPORT ====================

  exportGeoBtn.addEventListener('click', () => {
    const geojson = exportGeoJSON(map);
    const content = prettyJSON(geojson);
    downloadFile('tourlocate.geojson', content, 'application/geo+json');
  });

  exportGpxBtn.addEventListener('click', () => {
    const geojson = exportGeoJSON(map);
    const gpx = geoJSONToGPX(geojson);
    downloadFile('tourlocate.gpx', gpx, 'application/gpx+xml');
  });

  exportHtmlBtn.addEventListener('click', () => {
    const html = exportSingleHTML(map);
    downloadFile('tourlocate.html', html, 'text/html');
  });
}

// =============== GEOJSON-Export ===============
export function exportGeoJSON(map) {
  const features = map.markersLayer.getLayers().map((m) => {
    const latlng = m.getLatLng();
    const popup = m.getPopup()?.getContent() || '';
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [latlng.lng, latlng.lat] },
      properties: { popupContent: popup }
    };
  });

  return {
    type: 'FeatureCollection',
    features
  };
}

// =============== GEOJSON-Import ===============
function loadGeoJSON(map, geojson) {
  if (!geojson.features) return;
  map.markersLayer.clearLayers();

  geojson.features.forEach((f, i) => {
    if (f.geometry?.type !== 'Point') return;
    const [lng, lat] = f.geometry.coordinates;
    addPOI(map, L.latLng(lat, lng));
  });

  updateRoute(map);
  fitToMarkers(map);
}

// =============== Ein-Datei-HTML-Export ===============
function exportSingleHTML(map) {
  const baseLayer = getActiveBaseLayer(map);
  const geojson = exportGeoJSON(map);
  const geoData = prettyJSON(geojson);

  return `
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tourlocate Export</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css">
<style>
  html,body {height:100%;margin:0;}
  #map {height:100%;}
</style>
</head>
<body>
<div id="map"></div>
<script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  const map = L.map('map').setView([${map.getCenter().lat}, ${map.getCenter().lng}], ${map.getZoom()});
  const base = L.tileLayer('${baseLayer._url}', { maxZoom: ${baseLayer.options.maxZoom}, attribution: \`${baseLayer.getAttribution()}\` }).addTo(map);
  const data = ${geoData};
  L.geoJSON(data, {
    onEachFeature: (f, layer) => {
      if (f.properties && f.properties.popupContent) {
        layer.bindPopup(f.properties.popupContent);
      }
    }
  }).addTo(map);
</script>
</body>
</html>`;
}

// Hilfsfunktion: aktives Layer finden
function getActiveBaseLayer(map) {
  let active;
  map.eachLayer(l => {
    if (l instanceof L.TileLayer && map.hasLayer(l)) active = l;
  });
  return active;
}
