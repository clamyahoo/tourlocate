// js/main.js
import { initMap } from './map-core.js';
import { setupUI } from './map-ui.js';
import { setupIO } from './map-io.js';
import { enablePoiInteractions } from './map-pois.js';
// import { setRouteInfo, renderLegs } from './map-ui.js';


window.addEventListener('DOMContentLoaded', () => {
  const map = initMap();   // Karte und Layer initialisieren
  setupUI(map);            // Buttons, Popups, Interaktionen
  setupIO(map);            // Import/Export

const ctx = initMap();
enablePoiInteractions(ctx);

});

