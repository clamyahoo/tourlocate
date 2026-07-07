// ==================== Karte & Layer ====================

export const map = L.map('map', {
  center: [48.46960, 7.94292],
  zoom: 11
});

const osm  = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap'
}).addTo(map);

const esri = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 19,
  attribution: 'Tiles © Esri'
});

const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
  maxZoom: 17,
  attribution: '© OpenTopoMap, © OSM'
});

const markersLayer = L.featureGroup().addTo(map);
const routeLayer   = L.featureGroup().addTo(map);

// aktive Basiskarte merken
let activeBase = osm;

L.control.layers(
  { OSM: osm, Satellit: esri, Topo: topo },
  { "Marker": markersLayer, "Route": routeLayer }
).addTo(map);

L.control.scale().addTo(map);

// Export der Layer falls in anderen Modulen benötigt
export { markersLayer, routeLayer };

export const MapLayers = { osm, esri, topo, markersLayer, routeLayer };

export function initMap() {
  return map;
}
