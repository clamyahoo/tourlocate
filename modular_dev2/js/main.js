// ==================== main.js ====================
// Zentrale Initialisierung der modularen Tourlocate-App

import { initMap, MapLayers } from './map-core.js';
import { config } from './map-config.js';
import { setupUI } from './map-ui.js';
import { setupPOIHandlers } from './map-pois.js';
import { initUtils } from './map-utils.js';

// =================================================
// Hauptinitialisierung
// =================================================

document.addEventListener('DOMContentLoaded', async () => {
  // Utils initialisieren (z. B. Lightbox, FileReader etc.)
  initUtils();

  // Karte aufbauen
  const map = initMap(config);

  // Layer und globale Referenzen weitergeben
  const { markersLayer, routeLayer } = MapLayers;

  // UI-Events (Toolbar etc.)
  setupUI(map, markersLayer, routeLayer);

  // POI-Interaktionen
  setupPOIHandlers(map, markersLayer, routeLayer);

  // GLightbox initialisieren (nur einmal)
  if (!window.glightbox) {
    window.glightbox = GLightbox({
      touchNavigation: true,
      loop: false,
      closeOnOutsideClick: true,
      openEffect: 'zoom',
      closeEffect: 'fade'
    });
  }

  console.log('Tourlocate erfolgreich initialisiert.');
});
