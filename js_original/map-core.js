// js/map-core.js
// =============== Zentrale Karten- und Routing-Logik ===============

import { DEFAULT_VIEW, TILE_LAYERS, ROUTING_PROFILE } from './map-config.js';

// Initialisierung der Karte


export function initMap() {
  const mapContainer = L.DomUtil.get('map');
  if (mapContainer && mapContainer._leaflet_id) {
    mapContainer._leaflet_id = null;
    mapContainer.innerHTML = '';
  }

  const map = L.map('map', {
    center: [48.46960, 7.94292],
    zoom: 11,
  });

  const osm = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxZoom: 19, attribution: '© OpenStreetMap contributors' }
  ).addTo(map);

  const esri = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, attribution: 'Tiles © Esri' }
  );

  const topo = L.tileLayer(
    'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    { maxZoom: 17, attribution: '© OpenTopoMap, © OSM' }
  );

  const markersLayer = L.featureGroup().addTo(map);
  const routeLayer   = L.featureGroup().addTo(map);

  L.control.layers(
    { OSM: osm, Satellit: esri, Topo: topo },
    { Marker: markersLayer, Route: routeLayer },
    { collapsed: true }
  ).addTo(map);

  return { map, layers: { osm, esri, topo }, fg: { markersLayer, routeLayer } };
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
