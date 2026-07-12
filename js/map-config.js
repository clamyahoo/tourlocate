// Zentrale Einstellungen: Kartenansicht, Layer, Routing, Bilder, Export

export const DEFAULT_VIEW = {
  lat: 48.46960,
  lng: 7.94292,
  zoom: 11
};

// crossOrigin ist Voraussetzung dafür, dass Kacheln beim HTML-Export
// in ein Canvas gezeichnet werden dürfen (sonst "tainted canvas").
export const TILE_LAYERS = {
  OSM: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap',
    crossOrigin: 'anonymous'
  }),

  Satellit: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles © Esri',
    crossOrigin: 'anonymous'
  }),

  Topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17,
    attribution: '© OpenTopoMap, © OSM',
    crossOrigin: 'anonymous'
  })
};

// FOSSGIS-OSRM (routing.openstreetmap.de) bietet im Gegensatz zum
// project-osrm-Demoserver alle drei Profile an.
export const ROUTING_PROFILES = {
  car: 'https://routing.openstreetmap.de/routed-car/route/v1',
  bike: 'https://routing.openstreetmap.de/routed-bike/route/v1',
  foot: 'https://routing.openstreetmap.de/routed-foot/route/v1'
};

// Gepinnte CDN-URLs (identisch zu index.html) — werden beim
// Ein-Datei-HTML-Export gefetcht und in die Exportdatei eingebettet.
export const CDN = {
  leafletJs: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js',
  leafletCss: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css'
};

// Bild-Verkleinerung beim Anhängen an POIs, wählbar über die Einstellung
// "imgQuality" (map-settings.js)
export const IMG_QUALITIES = {
  small: { maxSide: 800, quality: 0.7 },
  medium: { maxSide: 1200, quality: 0.85 },
  large: { maxSide: 1600, quality: 0.9 },
  original: { maxSide: 100000, quality: 0.92 }
};
