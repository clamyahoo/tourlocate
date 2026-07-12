// Zentrale Einstellungen: Kartenansicht, Layer, Routing, Bilder, Export

export const DEFAULT_VIEW = {
  lat: 48.46960,
  lng: 7.94292,
  zoom: 11
};

// crossOrigin ist Voraussetzung dafür, dass Kacheln beim HTML-Export
// in ein Canvas gezeichnet werden dürfen (sonst "tainted canvas").
// Nur frei lizenzierte Layer: OSM-Standard (ODbL/CC-BY-SA), CyclOSM
// (CC-BY-SA), OpenTopoMap (CC-BY-SA) und Sentinel-2 cloudless von EOX
// (CC BY-NC-SA 4.0 — frei für nicht-kommerzielle Nutzung). Der frühere
// Esri-World-Imagery-Layer war proprietär und wurde entfernt.
export const TILE_LAYERS = {
  OSM: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap-Mitwirkende',
    crossOrigin: 'anonymous'
  }),

  CyclOSM: L.tileLayer('https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© CyclOSM, © OpenStreetMap-Mitwirkende',
    crossOrigin: 'anonymous'
  }),

  Topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17,
    attribution: '© OpenTopoMap (CC-BY-SA), © OpenStreetMap-Mitwirkende',
    crossOrigin: 'anonymous'
  }),

  Satellit: L.tileLayer('https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg', {
    maxZoom: 15,
    attribution: 'Sentinel-2 cloudless © EOX IT Services GmbH (CC BY-NC-SA 4.0), Copernicus-Daten',
    crossOrigin: 'anonymous'
  })
};

// FOSSGIS-OSRM (routing.openstreetmap.de) bietet im Gegensatz zum
// project-osrm-Demoserver alle drei Profile an.
export const ROUTING_PROFILES = {
  car: 'https://routing.openstreetmap.de/routed-car/route/v1',
  bike: 'https://routing.openstreetmap.de/routed-bike/route/v1',
  foot: 'https://routing.openstreetmap.de/routed-foot/route/v1'
};

// Gepinnte CDN-URLs (identisch zu index.html) — werden beim
// Ein-Datei-HTML-Export gefetcht und in die Exportdatei eingebettet.
export const CDN = {
  leafletJs: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js',
  leafletCss: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css'
};

// Bild-Verkleinerung beim Anhängen an POIs, wählbar über die Einstellung
// "imgQuality" (map-settings.js)
export const IMG_QUALITIES = {
  small: { maxSide: 800, quality: 0.7 },
  medium: { maxSide: 1200, quality: 0.85 },
  large: { maxSide: 1600, quality: 0.9 },
  original: { maxSide: 100000, quality: 0.92 }
};

// Geteiltes Geheimnis mit webdav-proxy.php (bremst automatisierte
// Scanner; kein Ersatz für echte Zugriffskontrolle, da der Wert im
// öffentlichen JS-Quelltext steht). Bei Änderung IMMER auch in
// webdav-proxy.php (Konstante PROXY_KEY) anpassen.
export const PROXY_KEY = 'tourlocate-webdav-2026-BITTE-AENDERN';
