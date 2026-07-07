import { initMap } from './map-core.js';
import { setupPOIs } from './map-pois.js';
import { setupUI } from './map-ui.js';
import { setupIO } from './map-io.js';

window.addEventListener('DOMContentLoaded', () => {
  const map = initMap();   // Karte initialisieren
  setupPOIs(map);          // POI-Logik initialisieren
  setupUI(map);            // Toolbar, Popups etc.
  setupIO(map);            // Import/Export
});

