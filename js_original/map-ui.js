// js/map-ui.js
// ============= UI-Setup & Helfer =============

// Shortcut zum Selektieren nach ID
const $ = (id) => document.getElementById(id);

/**
 * Wird von main.js aufgerufen, sobald die Karte erstellt ist.
 * Hier werden UI-Elemente (Buttons, Labels, Events) mit der App verdrahtet.
 */
export function setupUI(map) {
  console.log('[map-ui] setupUI gestartet');

  // === Buttons & UI-Grundfunktionen ===
  const buttons = {
    undo: $('undoBtn'),
    clear: $('clearBtn'),
    importGeo: $('importGeoBtn'),
    importGpx: $('importGpxBtn'),
    exportGeo: $('exportGeoBtn'),
    exportGpx: $('exportGpxBtn'),
    exportHtml: $('exportHtmlBtn'),
  };

  // Falls Buttons noch nicht existieren, abbrechen (z. B. eingebettete Karte)
  if (!buttons.clear || !buttons.undo) {
    console.warn('[map-ui] setupUI: keine Toolbar-Buttons gefunden.');
    return;
  }

  // Buttons initial deaktivieren
  buttons.undo.disabled = true;
  buttons.clear.disabled = true;

  // Beispiel: Tooltip oder Hinweis, wenn Karte geladen
  toast('Karte geladen – doppelklicken zum Erstellen von POIs', 2500);

  // Klick-Hinweis: Kartenklick erzeugt POI
  map.on('dblclick', (e) => {
    console.log('[map-ui] Doppelklick bei', e.latlng);
  });

  // Dynamische Route-Info regelmäßig aktualisieren (Dummy-Beispiel)
  const routeInfo = $('routeinfo');
  if (routeInfo) {
    routeInfo.textContent = '';
  }

  // === Buttons testen ===
  buttons.clear.addEventListener('click', () => {
    toast('Alle POIs löschen (Demo)');
  });

  buttons.undo.addEventListener('click', () => {
    toast('Letzten POI entfernen (Demo)');
  });

  // === Import/Export ===
  buttons.importGeo.addEventListener('click', () => {
    toast('GeoJSON importieren (Demo)');
  });
  buttons.importGpx.addEventListener('click', () => {
    toast('GPX importieren (Demo)');
  });
  buttons.exportGeo.addEventListener('click', () => {
    toast('GeoJSON exportieren (Demo)');
  });
  buttons.exportGpx.addEventListener('click', () => {
    toast('GPX exportieren (Demo)');
  });
  buttons.exportHtml.addEventListener('click', () => {
    toast('Ein-Datei-HTML exportieren (Demo)');
  });

  // === Event-Listener für mobile Nutzerhinweis ===
  map.on('zoomend', () => {
    console.log('[map-ui] Zoomstufe:', map.getZoom());
  });
}

// ============= Weitere UI-Helfer =============

/** Text in die Infozeile unter den Buttons schreiben */
export function setRouteInfo(text = '') {
  const el = $('routeinfo');
  if (el) el.textContent = text;
}

/** Einfache Schritt-für-Schritt-Liste (Leaflet Routing Machine) */
export function renderLegs(route) {
  const el = $('legs');
  if (!el) return;
  if (!route || !Array.isArray(route.instructions)) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = route.instructions.map(i => `<div>${i.text}</div>`).join('');
}

/** Kleines Hinweisfenster unten (Toast) */
export function toast(msg, ms = 2000) {
  const div = document.createElement('div');
  div.textContent = msg;
  div.style.cssText = `
    position:fixed;left:50%;bottom:24px;transform:translateX(-50%);
    background:#111;color:#fff;padding:8px 12px;border-radius:8px;
    box-shadow:0 3px 12px rgba(0,0,0,.25);z-index:9999;font:500 13px system-ui`;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), ms);
}
