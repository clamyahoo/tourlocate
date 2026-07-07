// js/main.js
import { initMap } from './map-core.js';
import { setupUI } from './map-ui.js';
import { setupIO } from './map-io.js';
import { enablePoiInteractions } from './map-pois.js';

window.addEventListener('DOMContentLoaded', () => {
  // 1) Karte + Layer initialisieren → liefert ctx = { map, layers, fg }
  const ctx = initMap();

  // 2) UI-Elemente einrichten (Buttons etc.) → braucht nur die Leaflet-Map
  setupUI(ctx.map);

  // 3) Import/Export einrichten → braucht den gesamten Kontext (für addPoi(ctx,...))
  setupIO(ctx);

  // 4) POI-Interaktionen (Doppelklick anlegen, Edit/Lightbox schließen etc.)
  enablePoiInteractions(ctx);
});
