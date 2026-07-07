// js/map-io.js
// =============== Import / Export für GeoJSON, GPX & HTML ===============

import { readFileAsText, downloadFile, geoJSONToGPX, prettyJSON } from './map-utils.js';
import { addPOI, updateRoute, fitToMarkers } from './map-core.js';

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
    const file = e.target.files
  });

}
