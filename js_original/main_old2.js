// js/main.js
import { initMap } from './map-core.js';
import { setupUI } from './map-ui.js';
import { setupIO } from './map-io.js';
import { enablePoiInteractions } from './map-pois.js';
// import { setRouteInfo, renderLegs } from './map-ui.js';

window.addEventListener('DOMContentLoaded', () => {
  // Karte und Layer initialisieren (liefert Objekt mit map, layers, fg)
  const ctx = initMap();

  // UI-Elemente (Buttons etc.) initialisieren – bekommt nur die Leaflet-Map
  setupUI(ctx.map);

  // Import/Export – bekommt ebenfalls nur die Map (wenn so definiert)
  setupIO(ctx.map);

  // POI-Interaktionen – bekommt das ganze Kontextobjekt
  enablePoiInteractions(ctx);
});
