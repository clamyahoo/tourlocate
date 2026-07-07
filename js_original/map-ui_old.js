// js/map-ui.js
// Kleine UI-Helfer – kommt ohne Fremdimporte aus

const $ = (id) => document.getElementById(id);

/** Schreibe Text in die Route-Info-Zeile */
export function setRouteInfo(text = '') {
  const el = $('routeinfo');
  if (el) el.textContent = text;
}

/** Zeige einfache Turn-by-Turn-Liste (Leaflet Routing Machine route) */
export function renderLegs(route) {
  const el = $('legs');
  if (!el) return;
  if (!route || !Array.isArray(route.instructions)) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = route.instructions.map(i => `<div>${i.text}</div>`).join('');
}

/** Optional: kleines Toast/Hint */
export function toast(msg, ms = 2000) {
  const div = document.createElement('div');
  div.textContent = msg;
  div.style.cssText = `
    position:fixed;left:50%;bottom:24px;transform:translateX(-50%);
    background:#111;color:#fff;padding:8px 12px;border-radius:8px;
    box-shadow:0 3px 12px rgba(0,0,0,.25);z-index:9999;font:500 13px system-ui`;
  document.body.appendChild(div);
  setTimeout(()=> div.remove(), ms);
}
