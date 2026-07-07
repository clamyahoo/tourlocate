// ==================== map-core.js ====================
// Initialisierung von Karte, Layern und Routing-Control
// =====================================================

export const MapLayers = {
  markersLayer: null,
  routeLayer: null
};

// -----------------------------------------------------
// Karte und Layer initialisieren
// -----------------------------------------------------
export function initMap(config) {
  const map = L.map('map').setView(config.startCoords, config.startZoom);

  // Basis-Layer
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(map);

  const esri = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, attribution: 'Tiles © Esri' }
  );

  const topo = L.tileLayer(
    'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    { maxZoom: 17, attribution: '© OpenTopoMap, © OSM contributors' }
  );

  // Feature-Layer
  MapLayers.markersLayer = L.featureGroup().addTo(map);
  MapLayers.routeLayer   = L.featureGroup().addTo(map);

  // Layer-Control
  L.control.layers(
    { 'OSM': osm, 'Satellit': esri, 'Topo': topo },
    {},
    { collapsed: true }
  ).addTo(map);

  // Geocoder optional
  if (L.Control.Geocoder) {
    L.Control.geocoder({ defaultMarkGeocode: false })
      .on('markgeocode', e => map.setView(e.geocode.center, 14))
      .addTo(map);
  }

  // Routing-Machine Setup
  if (L.Routing && L.Routing.control) {
    MapLayers.routingControl = L.Routing.control({
      waypoints: [],
      lineOptions: {
        styles: [{ color: '#2b6cb0', opacity: 0.9, weight: 5 }]
      },
      createMarker: () => null,
      addWaypoints: false,
      routeWhileDragging: false,
      draggableWaypoints: false,
      show: false
    }).addTo(map);
  }

  return map;
}
