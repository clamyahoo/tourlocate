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
    track: null,       // importierte Aufzeichnung (lineMode 'track'): [[lat,lng],...]
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

// Abstand (in Metern), ab dem eine Station als "neben der Strecke"
// (nicht mehr auf dem Track) gilt. Kleinere Verschiebungen rasten wieder
// ein, größere lösen die Station von der Aufzeichnung.
export const TRACK_ON_M = 30;

// Index des Track-Punktes, der (lat,lng) am nächsten liegt. Quadratischer
// Abstand reicht für "am nächsten" (kein Wurzelziehen nötig).
export function snapToTrackIndex(track, lat, lng) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < track.length; i++) {
    const dLat = track[i][0] - lat;
    const dLng = track[i][1] - lng;
    const d = dLat * dLat + dLng * dLng;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// Liegt die Station noch auf der Aufzeichnung? Rückgabe: { on, i } mit
// dem nächsten Track-Index i.
export function trackAnchor(track, lat, lng) {
  const i = snapToTrackIndex(track, lat, lng);
  const distM = haversineKm([[lat, lng], [track[i][0], track[i][1]]]) * 1000;
  return { on: distM <= TRACK_ON_M, i };
}

// Verbindung gemäß Einstellung neu aufbauen:
// 'route' → OSRM, 'straight' → Luftlinie, 'track' → aufgezeichnete
// Strecke, 'none' → nichts
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

  // Aufgezeichnete Strecke: abschnittsweise zwischen den Stationen.
  // Liegen beide Enden eines Abschnitts auf der Aufzeichnung, wird der
  // echte Track-Teil gezeichnet; ist eine Station daneben gezogen, wird
  // dieser Abschnitt zur geraden Linie (die Track-Punkte dort entfallen).
  if (mode === 'track') {
    map.routingControl.setWaypoints([]);
    const track = map.state.track;
    if (!track || track.length < 2) {
      map.state.routeCoords = [];
      map.state.lastKm = 0;
      renderRouteInfo(map);
      return;
    }
    const coords = [];
    for (let k = 0; k < pois.length - 1; k++) {
      const A = pois[k];
      const B = pois[k + 1];
      const a = trackAnchor(track, A.lat, A.lng);
      const b = trackAnchor(track, B.lat, B.lng);
      let seg;
      if (a.on && b.on) {
        const lo = Math.min(a.i, b.i);
        const hi = Math.max(a.i, b.i);
        seg = track.slice(lo, hi + 1);
        if (a.i > b.i) seg.reverse(); // Richtung A → B beibehalten
      } else {
        seg = [[A.lat, A.lng], [B.lat, B.lng]];
      }
      // an die Gesamtlinie anhängen, ohne den Nahtpunkt zu doppeln
      for (let j = (coords.length ? 1 : 0); j < seg.length; j++) coords.push(seg[j]);
    }
    if (coords.length > 1) {
      L.polyline(coords, { weight: 4, color: '#d33' }).addTo(map.routeLayer);
    }
    map.state.routeCoords = coords;
    map.state.lastKm = haversineKm(coords);
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
