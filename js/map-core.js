// Grundkarte, Layer, Suche & Routing

import { DEFAULT_VIEW, TILE_LAYERS, ROUTING_PROFILES } from './map-config.js';
import { getSetting } from './map-settings.js';
import { t } from './map-i18n.js';
import { haversineKm } from './map-utils.js';

export function initMap() {
  // Zoom unten rechts — oben links sitzt der Seitenleisten-Knopf
  const map = L.map('map', { zoomControl: false })
    .setView([DEFAULT_VIEW.lat, DEFAULT_VIEW.lng], DEFAULT_VIEW.zoom);
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  TILE_LAYERS.OSM.addTo(map);

  map.markersLayer = L.featureGroup().addTo(map);
  map.routeLayer = L.featureGroup().addTo(map);

  // Zentraler App-Zustand: POIs sind die Quelle der Wahrheit,
  // Marker nur deren Darstellung.
  map.state = {
    pois: [],          // [{lat, lng, name, link, img, createdAt, marker}]
    routeCoords: [],   // aktuelle Verbindungs-Geometrie als [[lat,lng],...]
    lastKm: 0,         // letzte Gesamtdistanz (für Neuzeichnen bei Sprachwechsel)
    activeBase: TILE_LAYERS.OSM
  };

  L.control.layers(
    TILE_LAYERS,
    { POIs: map.markersLayer, Route: map.routeLayer }
  ).addTo(map);
  map.on('baselayerchange', e => { map.state.activeBase = e.layer; });

  // Suche
  if (L.Control.Geocoder) {
    L.Control.geocoder({ defaultMarkGeocode: false, placeholder: t('searchPlaceholder') })
      .on('markgeocode', e => map.fitBounds(e.geocode.bbox))
      .addTo(map);
  }

  createRoutingControl(map);

  return map;
}

// Routing-Control für das aktuell eingestellte Profil (neu) aufbauen;
// zeichnet keine eigenen Marker, Panel bleibt versteckt
function createRoutingControl(map) {
  if (map.routingControl) {
    map.removeControl(map.routingControl);
  }

  const serviceUrl = ROUTING_PROFILES[getSetting('profile')] || ROUTING_PROFILES.car;
  map.routingControl = L.Routing.control({
    waypoints: [],
    fitSelectedRoutes: false,
    show: false,
    addWaypoints: false,
    draggableWaypoints: false,
    createMarker: () => null,
    router: L.Routing.osrmv1({ serviceUrl })
  }).addTo(map);
  map.routingControl.getContainer().style.display = 'none';

  map.routingControl.on('routesfound', e => {
    // Verspätete Antworten ignorieren, wenn inzwischen umgeschaltet wurde
    if (getSetting('lineMode') !== 'route') return;
    map.routeLayer.clearLayers();
    const route = e.routes[0];
    map.routeLayer.addLayer(L.Routing.line(route));
    map.state.routeCoords = route.coordinates.map(ll => [ll.lat, ll.lng]);
    map.state.lastKm = route.summary.totalDistance / 1000;
    renderRouteInfo(map);
  });

  map.routingControl.on('routingerror', () => {
    if (getSetting('lineMode') !== 'route') return;
    document.getElementById('routeinfo').textContent = t('routeError');
  });
}

// Nach Profilwechsel aufrufen: Control neu aufbauen und Route neu rechnen
export function applyRoutingSettings(map) {
  createRoutingControl(map);
  setRouteWaypoints(map);
}

export function renderRouteInfo(map) {
  const el = document.getElementById('routeinfo');
  el.textContent = map.state.lastKm > 0
    ? t('total', { km: map.state.lastKm.toFixed(1) })
    : '';
}

// Verbindung gemäß Einstellung neu aufbauen:
// 'route' → OSRM, 'straight' → Luftlinie, 'none' → nichts
export function setRouteWaypoints(map) {
  const pois = map.state.pois;
  const mode = getSetting('lineMode');

  map.routeLayer.clearLayers();

  if (pois.length < 2 || mode === 'none') {
    map.routingControl.setWaypoints([]);
    map.state.routeCoords = [];
    map.state.lastKm = 0;
    renderRouteInfo(map);
    return;
  }

  if (mode === 'straight') {
    map.routingControl.setWaypoints([]);
    const coords = pois.map(p => [p.lat, p.lng]);
    L.polyline(coords, { weight: 4, color: '#d33' }).addTo(map.routeLayer);
    map.state.routeCoords = coords;
    map.state.lastKm = haversineKm(coords);
    renderRouteInfo(map);
    return;
  }

  map.routingControl.setWaypoints(pois.map(p => L.latLng(p.lat, p.lng)));
}

// Karte an alle Marker anpassen
export function fitToMarkers(map) {
  const bounds = map.markersLayer.getBounds();
  if (bounds.isValid()) map.fitBounds(bounds.pad(0.15));
}
