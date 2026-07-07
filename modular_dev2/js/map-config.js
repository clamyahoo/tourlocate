// ==================== map-config.js ====================
// Zentrale Konfiguration für die Tourlocate-App
// ======================================================

export const config = {
  // Startansicht der Karte
  startCoords: [48.4696, 7.9429],  // Beispiel: Mittelbaden
  startZoom: 11,

  // Routen-Optionen
  routeColor: '#2b6cb0',
  routeWeight: 5,

  // POI-Stil
  poi: {
    radius: 10,
    color: '#2b6cb0',
    fillColor: '#2b6cb0',
    fillOpacity: 1,
    weight: 2,
    numberColor: '#fff',
    numberFontSize: '13px'
  },

  // Exportoptionen
  export: {
    filenameBase: 'tourlocate',
    imageQuality: 0.85,
    imageMaxSide: 768
  },

  // Verhalten
  maxUndo: 10,        // Anzahl rückgängig machbarer Schritte
  enableGeocoder: true,
  enableRouting: true
};
