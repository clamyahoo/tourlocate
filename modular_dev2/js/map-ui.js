// ==================== map-ui.js ====================
// Benutzeroberfläche (Toolbar, Buttons, Dateiauswahl)
// ===================================================

import { clearAll, undoLast } from './map-pois.js';
import { importGeoJSON, importGPX, exportGeoJSON, exportGPX, exportHTML } from './map-io.js';

// ---------------------------------------------------
// UI-Initialisierung
// ---------------------------------------------------
export function setupUI(map, markersLayer, routeLayer) {

  // Undo
  const undoBtn = document.getElementById('undoBtn');
  undoBtn.addEventListener('click', () => undoLast(map, markersLayer, routeLayer));

  // Alles löschen
  const clearBtn = document.getElementById('clearBtn');
  clearBtn.addEventListener('click', () => {
    if (confirm('Wirklich alle Punkte löschen?')) {
      clearAll(map, markersLayer, routeLayer);
    }
  });

  // GeoJSON importieren
  const importGeoBtn = document.getElementById('importGeoBtn');
  importGeoBtn.addEventListener('click', () => {
    document.getElementById('fileGeo').click();
  });

  // GPX importieren
  const importGpxBtn = document.getElementById('importGpxBtn');
  importGpxBtn.addEventListener('click', () => {
    document.getElementById('fileGpx').click();
  });

  // GeoJSON exportieren
  const exportGeoBtn = document.getElementById('exportGeoBtn');
  exportGeoBtn.addEventListener('click', () => exportGeoJSON(markersLayer, routeLayer));

  // GPX exportieren
  const exportGpxBtn = document.getElementById('exportGpxBtn');
  exportGpxBtn.addEventListener('click', () => exportGPX(markersLayer, routeLayer));

  // HTML exportieren
  const exportHtmlBtn = document.getElementById('exportHtmlBtn');
  exportHtmlBtn.addEventListener('click', () => exportHTML(map, markersLayer, routeLayer));

  // Dateieingaben
  document.getElementById('fileGeo').addEventListener('change', e => importGeoJSON(e, map, markersLayer, routeLayer));
  document.getElementById('fileGpx').addEventListener('change', e => importGPX(e, map, markersLayer, routeLayer));

  // UI-Status aktualisieren
  updateButtons(markersLayer);
}

// ---------------------------------------------------
// Aktivierung / Deaktivierung der Buttons je nach Zustand
// ---------------------------------------------------
export function updateButtons(markersLayer) {
  const hasMarkers = markersLayer && markersLayer.getLayers().length > 0;
  document.getElementById('undoBtn').disabled = !hasMarkers;
  document.getElementById('clearBtn').disabled = !hasMarkers;
}
