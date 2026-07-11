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

export const OSRM_SERVICE_URL = 'https://router.project-osrm.org/route/v1';

// Gepinnte CDN-URLs (identisch zu index.html) — werden beim
// Ein-Datei-HTML-Export gefetcht und in die Exportdatei eingebettet.
export const CDN = {
  leafletJs: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js',
  leafletCss: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css'
};

// Bild-Verkleinerung beim Anhängen an POIs
export const IMG_MAX_SIDE = 1200;
export const IMG_QUALITY = 0.85;

export const EXPORT_FILES = {
  geojson: 'tourlocate.geojson',
  gpx: 'tourlocate.gpx',
  html: 'tourlocate.html'
};
