// Grundkarte, Layer, Suche & Routing

import { DEFAULT_VIEW, TILE_LAYERS, OSRM_SERVICE_URL } from './map-config.js';

export function initMap() {
  const map = L.map('map').setView([DEFAULT_VIEW.lat, DEFAULT_VIEW.lng], DEFAULT_VIEW.zoom);

  TILE_LAYERS.OSM.addTo(map);

  map.markersLayer = L.featureGroup().addTo(map);
  map.routeLayer = L.featureGroup().addTo(map);

  // Zentraler App-Zustand: POIs sind die Quelle der Wahrheit,
  // Marker nur deren Darstellung.
  map.state = {
    pois: [],          // [{lat, lng, name, link, img, marker}]
    routeCoords: [],   // aktuelle Routing-Geometrie als [[lat,lng],...]
    activeBase: TILE_LAYERS.OSM
  };

  L.control.layers(
    TILE_LAYERS,
    { POIs: map.markersLayer, Route: map.routeLayer }
  ).addTo(map);
  map.on('baselayerchange', e => { map.state.activeBase = e.layer; });

  // Suche
  if (L.Control.Geocoder) {
    L.Control.geocoder({ defaultMarkGeocode: false, placeholder: 'Ort suchen…' })
      .on('markgeocode', e => map.fitBounds(e.geocode.bbox))
      .addTo(map);
  }

  // Routing (OSRM); zeichnet keine eigenen Marker, Panel bleibt versteckt
  map.routingControl = L.Routing.control({
    waypoints: [],
    fitSelectedRoutes: false,
    show: false,
    addWaypoints: false,
    draggableWaypoints: false,
    createMarker: () => null,
    router: L.Routing.osrmv1({ serviceUrl: OSRM_SERVICE_URL })
  }).addTo(map);
  map.routingControl.getContainer().style.display = 'none';

  map.routingControl.on('routesfound', e => {
    map.routeLayer.clearLayers();
    const route = e.routes[0];
    map.routeLayer.addLayer(L.Routing.line(route));
    map.state.routeCoords = route.coordinates.map(ll => [ll.lat, ll.lng]);
    const km = (route.summary.totalDistance / 1000).toFixed(1);
    document.getElementById('routeinfo').textContent = `Gesamt: ${km} km`;
  });

  map.routingControl.on('routingerror', () => {
    document.getElementById('routeinfo').textContent = 'Route derzeit nicht verfügbar';
  });

  return map;
}

// Wegpunkte aus dem POI-Zustand ans Routing übergeben (<2 → Route leeren)
export function setRouteWaypoints(map) {
  const pois = map.state.pois;
  if (pois.length < 2) {
    map.routeLayer.clearLayers();
    map.routingControl.setWaypoints([]);
    map.state.routeCoords = [];
    document.getElementById('routeinfo').textContent = '';
  } else {
    map.routingControl.setWaypoints(pois.map(p => L.latLng(p.lat, p.lng)));
  }
}

// Karte an alle Marker anpassen
export function fitToMarkers(map) {
  const bounds = map.markersLayer.getBounds();
  if (bounds.isValid()) map.fitBounds(bounds.pad(0.15));
}
