// Grundkarte & Routing-Logik

import { DEFAULT_VIEW, TILE_LAYERS, ROUTING_PROFILE } from './map-config.js';

export function initMap() {
  const map = L.map('map').setView([DEFAULT_VIEW.lat, DEFAULT_VIEW.lng], DEFAULT_VIEW.zoom);

  TILE_LAYERS.OSM.addTo(map);
  L.control.layers(TILE_LAYERS).addTo(map);

  map.markersLayer = L.featureGroup().addTo(map);
  map.routeLayer = L.featureGroup().addTo(map);

  map.routingControl = L.Routing.control({
    waypoints: [],
    routeWhileDragging: false,
    draggableWaypoints: true,
    show: false,
    addWaypoints: false,
    serviceUrl: ROUTING_PROFILE.serviceUrl,
    lineOptions: { addWaypoints: false },
    createMarker: () => null
  }).addTo(map);

  if (L.Control.Geocoder) L.Control.geocoder().addTo(map);

  return map;
}

// Routing aktualisieren
export function updateRoute(map) {
  const coords = map.markersLayer.getLayers().map(l => l.getLatLng());
  if (coords.length < 2) {
    map.routeLayer.clearLayers();
    return;
  }
  map.routingControl.setWaypoints(coords);
}

// Karte an Marker anpassen
export function fitToMarkers(map) {
  if (map.markersLayer.getLayers().length) {
    map.fitBounds(map.markersLayer.getBounds(), { padding: [30, 30] });
  }
}
