// ==================== Karte & Layer ====================
const map = L.map('map').setView([48.46960, 7.94292], 11);
const osm  = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
const esri = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  { maxZoom: 19, attribution: 'Tiles © Esri' });
const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
  { maxZoom: 17, attribution: '© OpenTopoMap, © OSM' });

const markersLayer = L.featureGroup().addTo(map);
const routeLayer   = L.featureGroup().addTo(map);


// --- Shim: map-io erwartet window.Tour.{state,api} ---
window.Tour = window.Tour || {};
window.Tour.state = window.Tour.state || {};
window.Tour.api   = window.Tour.api   || {};


// aktive Basiskarte merken
let activeBase = osm;
L.control.layers(
  { OSM: osm, Satellit: esri, Topo: topo },
  { POIs: markersLayer, Route: routeLayer }
).addTo(map);
map.on('baselayerchange', (e) => { activeBase = e.layer; publishTourState(); });

// Suche
L.Control.geocoder({ defaultMarkGeocode: false, placeholder: 'Ort suchen…' })
  .on('markgeocode', e => map.fitBounds(e.geocode.bbox))
  .addTo(map);

// ==================== Zustand ====================
let pois = []; // {lat,lng,name,link,img,marker}
// --- Shim: map-io erwartet window.Tour.{state,api} ---
window.Tour = window.Tour || {};
window.Tour.state = window.Tour.state || { pois: [], routeCoords: [], activeBase: null };
window.Tour.api   = window.Tour.api   || {};

// Publiziert den aktuellen internen Zustand für map-io.js
function publishTourState() {
  try {
    if (!window.Tour) window.Tour = {};
    if (!window.Tour.state) {
      window.Tour.state = { pois: [], routeCoords: [], activeBase: null };
    }
    window.Tour.state.pois        = Array.isArray(pois) ? pois : [];
    window.Tour.state.routeCoords = Array.isArray(routeCoords) ? routeCoords : [];
    window.Tour.state.activeBase  = (typeof activeBase !== 'undefined') ? activeBase : null;
  } catch (e) {
    // best effort
  }
}

let routeCoords = []; // aktuelle Routing-Geometrie als [[lat,lng],...]
const $ = id => document.getElementById(id);


// ==================== Routing ====================
const routing = L.Routing.control({
  waypoints: [],
  fitSelectedRoutes: false,
  show: false,
  addWaypoints: false,
  draggableWaypoints: false,
  createMarker: () => null,
  router: L.Routing.osrmv1({ serviceUrl: 'https://router.project-osrm.org/route/v1' })
}).addTo(map);

// Panel komplett ausblenden
routing.getContainer().style.display = 'none';

routing.on('routesfound', e => {
  routeLayer.clearLayers();
  const route = e.routes[0];
  routeLayer.addLayer(L.Routing.line(route));
  routeCoords = route.coordinates.map(ll => [ll.lat, ll.lng]);
  publishTourState();
  const km = (route.summary.totalDistance / 1000).toFixed(1);
  $('routeinfo').textContent = `Gesamt: ${km} km`;
});
