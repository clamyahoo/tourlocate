// Zentrale Einstellungen und Layer-Definitionen

export const DEFAULT_VIEW = {
  lat: 48.46960,
  lng: 7.94292,
  zoom: 11
};

export const TILE_LAYERS = {
  OSM: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap-Mitwirkende'
  }),

  Satellit: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles © Esri'
  }),

  Topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17,
    attribution: '© OpenTopoMap, © OSM'
  })
};

export const ROUTING_PROFILE = {
  serviceUrl: 'https://router.project-osrm.org/route/v1/',
  profile: 'driving'
};
