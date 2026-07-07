// js/map-core.js
// =============== Zentrale Karten- und Routing-Logik ===============

import { DEFAULT_VIEW, TILE_LAYERS, ROUTING_PROFILE } from './map-config.js';

// Initialisierung der Karte
export function initMap() {
  const map = L.map('map').setView([DEFAULT_VIEW.lat, DEFAULT_VIEW.lng], DEFAULT_VIEW.zoom);

  // Basiskarten
  TILE_LAYERS.OSM.addTo(map);
  const layersControl = L.control.layers(TILE_LAYERS).addTo(map);

  // Feature-Gruppen
  const markersLayer = L.featureGroup().addTo(map);
  const routeLayer = L.featureGroup().addTo(map);

  // Referenzen im Map-Objekt speichern
  map.markersLayer = markersLayer;
  map.routeLayer = routeLayer;
  map.activeBaseLayer = TILE_LAYERS.OSM;
  map.layersControl = layersControl;

  // Routing-Machine vorbereiten
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

  // Geocoder hinzufügen
  if (L.Control.Geocoder) {
    L.Control.geocoder().addTo(map);
  }

  // Doppelklick für neue Station
  map.on('dblclick', e => {
    addPOI(map, e.latlng);
  });

  return map;
}

// ==================== POI-Logik ====================

// Neues POI hinzufügen
export function addPOI(map, latlng) {
  const index = map.markersLayer.getLayers().length + 1;

  const iconHtml = `<div class="poi-num">${index}</div>`;
  const icon = L.divIcon({
    className: 'poi-icon',
    html: iconHtml,
    iconSize: [26, 26],
    iconAnchor: [13, 13]
  });

  const marker = L.marker(latlng, { icon }).addTo(map.markersLayer);

  marker.bindPopup(createPopupHTML(index, latlng)).openPopup();
}

// Popup-Inhalt (Anzeige-Ansicht)
function createPopupHTML(index, latlng) {
  return `
    <div>
      <b>Station ${index}</b><br>
      Lat: ${latlng.lat.toFixed(5)}<br>
      Lng: ${latlng.lng.toFixed(5)}<br>
      <button class="editBtn">Bearbeiten</button>
      <button class="deleteBtn">Löschen</button>
    </div>
  `;
}

// ==================== Routing ====================

// Strecke berechnen aus den POIs
export function updateRoute(map) {
  const coords = map.markersLayer.getLayers().map(l => l.getLatLng());
  if (coords.length < 2) {
    map.routeLayer.clearLayers();
    return;
  }

  map.routingControl.setWaypoints(coords);
}

// ==================== Hilfsfunktionen ====================

// Karte neu zentrieren
export function fitToMarkers(map) {
  const group = map.markersLayer;
  if (group.getLayers().length) {
    map.fitBounds(group.getBounds(), { padding: [30, 30] });
  }
}
