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
    undoStack: [],     // Zustands-Schnappschüsse für Rückgängig
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
  setupLocateControl(map);

  return map;
}

// Crosshair-Symbol für den "Mein Standort"-Knopf
const LOCATE_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2b6cb0" '
  + 'stroke-width="2" stroke-linecap="round" aria-hidden="true">'
  + '<circle cx="12" cy="12" r="3.5"/>'
  + '<line x1="12" y1="1.5" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22.5"/>'
  + '<line x1="1.5" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22.5" y2="12"/></svg>';

// "Mein Standort"-Steuerung (unten rechts): zeigt die eigene Position als
// blauen Punkt mit Genauigkeitskreis und folgt (watch). Erneuter Klick
// stoppt. Nur über HTTPS/localhost verfügbar (Browser-Vorgabe).
function setupLocateControl(map) {
  let active = false;
  let dot = null;
  let ring = null;
  let firstFix = true;

  const btn = L.DomUtil.create('a');
  btn.href = '#';
  btn.title = t('locate');
  btn.setAttribute('role', 'button');
  btn.setAttribute('aria-label', t('locate'));
  btn.innerHTML = LOCATE_SVG;
  btn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:30px;height:30px';

  // Gesamt-Deadline: Wie lange insgesamt gesucht wird, bevor aufgegeben wird
  // (unabhängig vom timeout je Einzelversuch unten). Vorübergehende Timeouts
  // laufen bis dahin weiter.
  const LOCATE_DEADLINE = 45000;
  let deadlineTimer = null;
  const clearDeadline = () => {
    if (deadlineTimer) { clearTimeout(deadlineTimer); deadlineTimer = null; }
  };

  // „Standort wird ermittelt…" erst nach kurzer Verzögerung einblenden, damit
  // ein schneller (Cache-)Fix nicht nur kurz aufblitzt.
  const STATUS_DELAY = 500;
  let statusTimer = null;
  const clearStatus = () => {
    if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
  };

  const stop = () => {
    active = false;
    map.stopLocate();
    clearDeadline();
    clearStatus();
    btn.style.background = '';
    if (dot) { map.removeLayer(dot); dot = null; }
    if (ring) { map.removeLayer(ring); ring = null; }
    renderRouteInfo(map); // Pill zurück auf die Routen-Info
  };

  const start = () => {
    active = true;
    firstFix = true;
    btn.style.background = '#d2e3f7'; // aktiv hervorheben
    // Status erst nach STATUS_DELAY zeigen (kein Flackern bei schnellem Fix).
    clearStatus();
    statusTimer = setTimeout(() => {
      if (active && firstFix) document.getElementById('routeinfo').textContent = t('locating');
    }, STATUS_DELAY);
    // Gesamt-Deadline: kam bis hierhin kein Fix, aufgeben und ehrlich melden.
    clearDeadline();
    deadlineTimer = setTimeout(() => {
      if (!active) return;
      stop(); // räumt auf + setzt Pill zurück
      const ri = document.getElementById('routeinfo');
      ri.textContent = t('locateTimeout');
      // Meldung nach ein paar Sekunden von selbst verschwinden lassen,
      // sofern nicht inzwischen eine neue Suche läuft.
      setTimeout(() => { if (!active) renderRouteInfo(map); }, 6000);
    }, LOCATE_DEADLINE);
    // timeout großzügig: ein kalter GPS-Fix (v. a. in der nativen WebView)
    // dauert länger als Leaflets 10-s-Standard. maximumAge erlaubt, einen
    // wenige Sekunden alten Fix sofort zu nutzen, statt stur neu zu messen.
    map.locate({ watch: true, enableHighAccuracy: true, maxZoom: 16,
                 timeout: 30000, maximumAge: 10000 });
  };

  L.DomEvent.on(btn, 'click', e => {
    L.DomEvent.stop(e);
    active ? stop() : start();
  });

  map.on('locationfound', e => {
    if (!active) return;
    if (!dot) {
      dot = L.circleMarker(e.latlng, {
        radius: 7, color: '#fff', weight: 2,
        fillColor: '#2b6cb0', fillOpacity: 1, interactive: false
      }).addTo(map);
      ring = L.circle(e.latlng, {
        radius: e.accuracy, color: '#2b6cb0', weight: 1,
        fillColor: '#2b6cb0', fillOpacity: 0.12, interactive: false
      }).addTo(map);
    } else {
      dot.setLatLng(e.latlng);
      ring.setLatLng(e.latlng).setRadius(e.accuracy);
    }
    if (firstFix) {
      map.setView(e.latlng, Math.max(map.getZoom(), 15));
      firstFix = false;
      clearDeadline();      // geschafft — Gesamt-Timer stoppen
      clearStatus();        // evtl. noch ausstehenden „wird ermittelt"-Timer abbrechen
      renderRouteInfo(map); // Pill zurück auf die Routen-Info
    }
  });

  map.on('locationerror', e => {
    if (!active) return;
    // Nur bei echter Verweigerung der Freigabe (code 1) abbrechen + melden.
    if (e && e.code === 1 /* PERMISSION_DENIED */) {
      stop();
      alert(t('locateError'));
      return;
    }
    // Vorübergehender Fehler (Timeout code 3 / Position noch nicht verfügbar
    // code 2): den watch NICHT abwürgen — GPS wärmt sich evtl. noch auf und
    // fängt sich beim nächsten Versuch von selbst. Kein blockierender Dialog.
  });

  const ctrl = L.control({ position: 'bottomright' });
  ctrl.onAdd = () => {
    const div = L.DomUtil.create('div', 'leaflet-bar');
    div.appendChild(btn);
    L.DomEvent.disableClickPropagation(div);
    return div;
  };
  ctrl.addTo(map);
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
