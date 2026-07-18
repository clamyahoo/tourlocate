// Editor der User-Version: baut dieselbe Leaflet-Karte wie die statische
// App (Wiederverwendung der js/-Module) und schaltet den "Server-Modus"
// dazu — Bilder werden verkleinert + hochgeladen, der Zustand wird in der
// Präsentation gespeichert.

import { initMap, fitToMarkers } from '../js/map-core.js';
import { setupPOIs, createPoi, renumberAndRoute } from '../js/map-pois.js';
import { setupUI } from '../js/map-ui.js';
import { setupIO } from '../js/map-io.js';
import { getSetting, setSetting } from '../js/map-settings.js';
import { fileToTargetJpeg } from '../js/map-utils.js';
import { writeExif } from '../js/map-exif.js';

const { pid, csrf } = window.TL_EDITOR;
const $ = id => document.getElementById(id);

// ---- Upload-Hook: Datei → ~200-KB-JPEG mit EXIF → Server → URL --------
async function imageStore(file, meta = {}) {
  let bytes = await fileToTargetJpeg(file, 200 * 1024);
  // Geodaten/Datum in die JPEG-Datei stempeln (Canvas-Re-Encoding hat
  // vorhandene EXIF entfernt) — nützlich für den späteren ZIP-Export.
  try {
    bytes = writeExif(bytes, {
      lat: meta.lat, lng: meta.lng,
      dateIso: meta.date || '', description: meta.name || ''
    });
  } catch (e) {
    console.warn('EXIF-Stempeln übersprungen:', e);
  }

  const fd = new FormData();
  fd.append('presentation_id', pid);
  fd.append('csrf', csrf);
  if (meta.lat != null) fd.append('lat', meta.lat);
  if (meta.lng != null) fd.append('lng', meta.lng);
  if (meta.date) fd.append('taken_at', meta.date);
  fd.append('image', new Blob([bytes], { type: 'image/jpeg' }), 'foto.jpg');

  const res = await fetch('api/upload.php', {
    method: 'POST', headers: { 'X-CSRF-Token': csrf }, body: fd
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(data.error || 'Upload fehlgeschlagen');
  return data.url; // 'api/image.php?id=X' (relativ zu /app/)
}

// ---- Zustand laden ---------------------------------------------------
async function loadPresentation(map) {
  const res = await fetch('api/presentations.php?action=get&id=' + pid, {
    headers: { 'X-CSRF-Token': csrf }
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) { setStatus('Konnte Präsentation nicht laden.', true); return; }
  const P = data.presentation;

  $('titleInput').value = P.title || '';
  document.title = 'Tourlocate — ' + (P.title || 'Editor');

  // Einstellungen übernehmen (Verbindungsdarstellung/Profil)
  setSetting('lineMode', P.line_mode);
  setSetting('profile', P.profile);
  if ($('lineModeSel')) $('lineModeSel').value = P.line_mode;
  if ($('profileSel')) { $('profileSel').value = P.profile; $('profileSel').disabled = P.line_mode !== 'route'; }

  const pois = (P.data && Array.isArray(P.data.pois)) ? P.data.pois : [];
  pois.forEach(sp => createPoi(map, {
    lat: sp.lat, lng: sp.lng,
    name: sp.name || '', link: sp.link || '', linkText: sp.linkText || '',
    img: sp.img || '', createdAt: sp.createdAt || ''
  }));
  renumberAndRoute(map);
  if (pois.length) fitToMarkers(map);
  markSaved();
}

// ---- Zustand speichern ----------------------------------------------
async function save(map) {
  setStatus('Speichern…');
  const pois = map.state.pois.map(p => ({
    lat: p.lat, lng: p.lng,
    name: p.name || '', link: p.link || '', linkText: p.linkText || '',
    img: p.img || '', createdAt: p.createdAt || ''
  }));
  const body = {
    id: pid,
    title: $('titleInput').value,
    line_mode: getSetting('lineMode'),
    profile: getSetting('profile'),
    // Routen-Geometrie mitspeichern, damit die öffentliche Ansicht bei
    // "Route" die echte Strecke zeigt (ohne dort neu routen zu müssen).
    data: { pois, route: map.state.routeCoords || [] },
    csrf
  };
  const res = await fetch('api/presentations.php?action=save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (data.ok) { markSaved(); document.title = 'Tourlocate — ' + data.title; }
  else setStatus(data.error || 'Speichern fehlgeschlagen.', true);
}

// ---- Status/Dirty-Anzeige -------------------------------------------
let dirty = false;
function setStatus(text, isError = false) {
  const el = $('saveStatus');
  el.textContent = text;
  el.style.color = isError ? '#c0392b' : '#4a5568';
}
function markDirty() { dirty = true; setStatus('Nicht gespeichert'); }
function markSaved() { dirty = false; setStatus('Gespeichert ✓'); }

// ---- Teilen (öffentlicher Link + Passwort) --------------------------
function setupShare() {
  const modal = $('shareModal');
  const shareApi = async (action, extra) => {
    const res = await fetch('api/share.php?action=' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ id: pid, csrf, ...extra })
    });
    return res.json().catch(() => ({}));
  };
  const shareMsg = t => { $('shareMsg').textContent = t || ''; };

  const render = (s) => {
    $('shareToggle').checked = !!s.shared;
    $('shareBody').style.display = s.shared ? 'block' : 'none';
    if (s.shared && s.token) {
      $('shareUrl').value = new URL('view.php?t=' + s.token, location.href).href;
    }
    $('sharePwToggle').checked = !!s.hasPassword;
    $('sharePwRow').style.display = s.hasPassword ? 'flex' : 'none';
    $('sharePw').value = '';
  };

  $('shareBtn').onclick = async () => {
    shareMsg('');
    const res = await fetch('api/share.php?action=status&id=' + pid, { headers: { 'X-CSRF-Token': csrf } });
    render(await res.json().catch(() => ({})));
    modal.style.display = 'flex';
  };
  $('shareClose').onclick = () => { modal.style.display = 'none'; };
  modal.onclick = e => { if (e.target === modal) modal.style.display = 'none'; };

  $('shareToggle').onchange = async (e) => {
    shareMsg('');
    const s = await shareApi(e.target.checked ? 'enable' : 'disable');
    if (s.ok) render(s); else shareMsg(s.error || 'Fehler.');
  };

  $('sharePwToggle').onchange = (e) => {
    $('sharePwRow').style.display = e.target.checked ? 'flex' : 'none';
    if (!e.target.checked) {
      // Passwortschutz entfernen = leeres Passwort setzen
      shareApi('setpassword', { password: '' }).then(s => { if (s.ok) render(s); });
    }
  };

  $('sharePwSave').onclick = async () => {
    shareMsg('');
    const pw = $('sharePw').value;
    if (!pw) { shareMsg('Bitte ein Passwort eingeben.'); return; }
    const s = await shareApi('setpassword', { password: pw });
    if (s.ok) { render(s); shareMsg(''); } else shareMsg(s.error || 'Fehler.');
  };

  $('shareCopy').onclick = async () => {
    try { await navigator.clipboard.writeText($('shareUrl').value); shareMsg('Link kopiert ✓'); }
    catch { $('shareUrl').select(); document.execCommand('copy'); shareMsg('Link kopiert ✓'); }
  };
}

// ---- Start -----------------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
  const map = initMap();
  setupPOIs(map);
  setupUI(map);
  setupIO(map);

  // Server-Modus aktivieren (die js-Module fragen diese Hooks ab)
  map.imageStore = imageStore;
  // Für den Export: Server-Bild-URL → Base64 auflösen
  map.resolveImage = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error || new Error('filereader-error'));
      fr.readAsDataURL(blob);
    });
  };

  // Änderungen an POIs als "nicht gespeichert" markieren
  const prevHook = map.onPoisChanged;
  map.onPoisChanged = () => { prevHook?.(); markDirty(); };

  loadPresentation(map);

  $('saveBtn').onclick = () => save(map);
  $('titleInput').oninput = markDirty;
  setupShare();

  // Vor dem Verlassen warnen, wenn ungespeichert
  window.addEventListener('beforeunload', e => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });
});
