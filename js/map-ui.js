// UI: Toolbar, Einstellungen, Anlegen/Bearbeiten-Dialog, Lightbox,
// Hilfe-Overlay, Vollbild, Dateipicker

import { IMG_QUALITIES } from './map-config.js';
import { getSetting, setSetting } from './map-settings.js';
import { t, getLang, setLang, applyI18n } from './map-i18n.js';
import { fileToDataURL } from './map-utils.js';
import { applyRoutingSettings, setRouteWaypoints, renderRouteInfo } from './map-core.js';
import { bindPoiPopup, renumberAndRoute, removePoi, removeLastPoi, clearPois, sortPois } from './map-pois.js';

const $ = id => document.getElementById(id);

// Karten-Referenz für die Lightbox (gesetzt in setupUI)
let _map = null;

// ==================== Zentraler Dateipicker (DDG-robust) ====================
// Ein persistenter Input mit Einmal-Bindung + value-Reset; frisch erzeugte
// One-Shot-Inputs verhalten sich in der DuckDuckGo-WebView unzuverlässig.
let __pickImageCb = null;

function setupFilePicker() {
  let inp = $('imgInput');
  if (!inp) {
    inp = document.createElement('input');
    inp.type = 'file';
    inp.id = 'imgInput';
    inp.accept = 'image/*';
    inp.style.display = 'none';
    document.body.appendChild(inp);
  }
  if (!inp.__bound) {
    inp.__bound = true;
    inp.addEventListener('change', async e => {
      try {
        const f = e.target.files && e.target.files[0];
        e.target.value = ''; // Reset für den nächsten Pick
        if (f && typeof __pickImageCb === 'function') {
          await __pickImageCb(f);
        }
      } catch (err) {
        console.error('pickImage error:', err);
        alert(t('imageError', { msg: err?.message || err }));
      } finally {
        __pickImageCb = null;
      }
    });
  }
}

export function pickImage(callback) {
  setupFilePicker();
  __pickImageCb = callback;
  $('imgInput').click();
}

// ==================== Lightbox (eigene, robuste Overlay-Lösung) ====================
let LB = { overlay: null, img: null, cap: null, spinner: null, last: null };

function ensureLightbox() {
  if (LB.overlay) return;
  const overlay = document.createElement('div');
  overlay.id = 'tl-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;display:none;background:rgba(0,0,0,.92);align-items:center;justify-content:center';

  const fig = document.createElement('figure');
  fig.style.cssText = 'max-width:92vw;max-height:92vh;margin:0;position:relative';

  const spinner = document.createElement('div');
  spinner.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:500 14px/1.4 system-ui,sans-serif;color:#ccc';

  const img = document.createElement('img');
  img.style.cssText = 'max-width:92vw;max-height:86vh;display:block;margin:0 auto;visibility:hidden';

  const cap = document.createElement('figcaption');
  cap.style.cssText = 'color:#fff;text-align:center;margin-top:10px;font:500 14px/1.4 system-ui,sans-serif';

  fig.appendChild(spinner);
  fig.appendChild(img);
  fig.appendChild(cap);
  overlay.appendChild(fig);
  document.body.appendChild(overlay);

  const close = () => {
    overlay.style.display = 'none';
    if (LB.last && _map) {
      _map.dragging[LB.last.drag ? 'enable' : 'disable']();
      _map.scrollWheelZoom[LB.last.wheel ? 'enable' : 'disable']();
      _map.doubleClickZoom[LB.last.dbl ? 'enable' : 'disable']();
      LB.last = null;
    }
  };
  overlay.addEventListener('click', close);
  document.addEventListener('keydown', e => {
    if (overlay.style.display !== 'none' && e.key === 'Escape') close();
  });

  LB = { overlay, img, cap, spinner, last: null };
}

export function openLightbox(href, title = '') {
  ensureLightbox();
  LB.spinner.style.display = 'flex';
  LB.spinner.textContent = t('loadingImage');
  LB.img.style.visibility = 'hidden';
  LB.cap.textContent = title || '';
  LB.overlay.style.display = 'flex';

  // Karten-Gesten sperren, Zustand zum Wiederherstellen merken
  if (_map) {
    LB.last = {
      drag: _map.dragging.enabled(),
      wheel: _map.scrollWheelZoom.enabled(),
      dbl: _map.doubleClickZoom.enabled()
    };
    _map.dragging.disable();
    _map.scrollWheelZoom.disable();
    _map.doubleClickZoom.disable();
  }

  // Preload → erst nach load anzeigen (Fix für „erster Klick zeigt nichts" in FF)
  const pre = new Image();
  pre.onload = () => {
    LB.img.src = pre.src;
    LB.spinner.style.display = 'none';
    LB.img.style.visibility = 'visible';
  };
  pre.onerror = () => { LB.spinner.textContent = t('imageLoadError'); };
  requestAnimationFrame(() => { pre.src = href; });
}

// ==================== Hilfe-Overlay ====================
function openHelp() {
  document.getElementById('tl-help')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'tl-help';
  overlay.className = 'tl-help-overlay';

  const box = document.createElement('div');
  box.className = 'tl-help-box';
  box.innerHTML = `<h2>${t('helpTitle')}</h2>${t('helpHtml')}`;
  box.addEventListener('click', ev => ev.stopPropagation());

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'tl-help-close';
  closeBtn.textContent = '×';
  closeBtn.onclick = () => overlay.remove();
  box.prepend(closeBtn);

  overlay.appendChild(box);
  overlay.addEventListener('click', () => overlay.remove());
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', esc); }
  });
  document.body.appendChild(overlay);
}

// ==================== Anlegen/Bearbeiten-Dialog ====================
// Ein gemeinsames Formular für beide Fälle; ersetzt die früheren
// prompt()-Abfragen (einheitliche Darstellung auf allen Systemen).
export function openPoiDialog(map, p, mode) {
  const isCreate = mode === 'create';
  const staged = { img: p.img || '' };

  const c = document.createElement('div');
  c.className = 'tl-form';

  const head = document.createElement('div');
  const headStrong = document.createElement('strong');
  headStrong.textContent = isCreate ? t('newStation') : t('edit');
  head.appendChild(headStrong);
  c.appendChild(head);

  const makeField = (labelText, value) => {
    const label = document.createElement('label');
    label.append(labelText);
    const input = document.createElement('input');
    input.value = value;
    label.appendChild(input);
    c.appendChild(label);
    return input;
  };
  const nameInput = makeField(t('nameLabel'), p.name || '');
  const linkInput = makeField(t('linkLabel'), p.link || '');

  // Bild-Vorschau
  const thumb = document.createElement('img');
  thumb.className = 'tl-form-thumb';
  thumb.alt = '';
  c.appendChild(thumb);

  const imgRow = document.createElement('div');
  imgRow.className = 'tl-form-row';
  const imgBtn = document.createElement('button');
  imgBtn.type = 'button';
  const imgDelBtn = document.createElement('button');
  imgDelBtn.type = 'button';
  imgDelBtn.textContent = t('deleteImage');
  imgRow.append(imgBtn, imgDelBtn);
  c.appendChild(imgRow);

  const actionRow = document.createElement('div');
  actionRow.className = 'tl-form-row';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.textContent = t('save');
  actionRow.appendChild(saveBtn);
  if (isCreate) {
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = t('cancel');
    cancelBtn.onclick = ev => {
      ev.stopPropagation();
      p.marker.closePopup(); // popupclose räumt den frischen POI weg
    };
    actionRow.appendChild(cancelBtn);
  } else {
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = t('deleteStation');
    deleteBtn.className = 'tl-danger';
    deleteBtn.onclick = ev => {
      ev.stopPropagation();
      p.marker.off('popupclose', onPopupClose);
      removePoi(map, p); // schließt das Popup automatisch mit
    };
    actionRow.appendChild(deleteBtn);
  }
  c.appendChild(actionRow);

  const updateThumb = () => {
    if (staged.img) {
      thumb.src = staged.img;
      thumb.style.display = 'block';
      imgDelBtn.style.display = '';
      imgBtn.textContent = t('newImage');
    } else {
      thumb.removeAttribute('src');
      thumb.style.display = 'none';
      imgDelBtn.style.display = 'none';
      imgBtn.textContent = t('chooseImage');
    }
  };

  // Schließen ohne Speichern: beim Anlegen den frischen POI entfernen,
  // beim Bearbeiten das Anzeige-Popup wiederherstellen
  const onPopupClose = () => {
    p.marker.off('popupclose', onPopupClose);
    if (isCreate) {
      removePoi(map, p);
    } else {
      bindPoiPopup(map, p, map.state.pois.indexOf(p));
    }
  };

  const save = () => {
    p.marker.off('popupclose', onPopupClose);
    p.name = nameInput.value.trim();
    p.link = linkInput.value.trim();
    p.img = staged.img;
    bindPoiPopup(map, p, map.state.pois.indexOf(p));
    renumberAndRoute(map);
    p.marker.openPopup();
  };

  saveBtn.onclick = ev => { ev.stopPropagation(); save(); };

  imgBtn.onclick = ev => {
    ev.stopPropagation();
    pickImage(async file => {
      const q = IMG_QUALITIES[getSetting('imgQuality')] || IMG_QUALITIES.medium;
      staged.img = await fileToDataURL(file, q.maxSide, q.quality);
      updateThumb();
    });
  };

  imgDelBtn.onclick = ev => {
    ev.stopPropagation();
    staged.img = '';
    updateThumb();
  };

  // Enter in einem Eingabefeld = Speichern
  c.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') {
      ev.preventDefault();
      save();
    }
  });

  updateThumb();
  p.marker.bindPopup(c, { minWidth: 240 });
  p.marker.getPopup()._tlDialog = true; // renumberAndRoute lässt offene Dialoge in Ruhe
  // Erst öffnen, DANN den Close-Listener scharf schalten: openPopup schließt
  // ein evtl. offenes Anzeige-Popup desselben Markers, was sonst sofort den
  // Listener auslösen würde.
  p.marker.openPopup();
  p.marker.on('popupclose', onPopupClose);
  setTimeout(() => nameInput.focus(), 0);
}

// ==================== Toolbar & Einstellungen ====================
export function setupUI(map) {
  _map = map;

  const updateButtons = () => {
    const off = map.state.pois.length === 0;
    ['undoBtn', 'clearBtn', 'exportGeoBtn', 'exportGpxBtn', 'exportHtmlBtn', 'exportZipBtn', 'sortSel']
      .forEach(id => { const el = $(id); if (el) el.disabled = off; });
  };
  map.onPoisChanged = updateButtons;

  const updateLangBtn = () => {
    // Button zeigt die Sprache, auf die umgeschaltet wird
    $('langBtn').textContent = getLang() === 'de' ? 'EN' : 'DE';
  };

  const updateProfileState = () => {
    // Profil ist nur bei echter Routen-Berechnung relevant
    $('profileSel').disabled = getSetting('lineMode') !== 'route';
  };

  // onclick-Zuweisung ist idempotent → gefahrlos wiederholbar (bfcache/DDG)
  const bindToolbar = () => {
    $('undoBtn').onclick = () => removeLastPoi(map);
    $('clearBtn').onclick = () => {
      if (map.state.pois.length && confirm(t('confirmClear'))) {
        clearPois(map);
      }
    };

    // Sortierung: Auswahl löst einmalige Sortierung aus
    $('sortSel').onchange = e => {
      const [key, dir] = e.target.value.split('-');
      if (key) sortPois(map, key, dir);
    };

    // Verbindungsart & Profil
    $('lineModeSel').onchange = e => {
      setSetting('lineMode', e.target.value);
      updateProfileState();
      setRouteWaypoints(map);
    };
    $('profileSel').onchange = e => {
      setSetting('profile', e.target.value);
      applyRoutingSettings(map);
    };

    // Bildqualität
    $('imgQualitySel').onchange = e => setSetting('imgQuality', e.target.value);

    // Sprache
    $('langBtn').onclick = () => {
      setLang(getLang() === 'de' ? 'en' : 'de');
      updateLangBtn();
      renumberAndRoute(map);   // Popups (Datum, Buttons) neu aufbauen
      renderRouteInfo(map);    // Distanz-Text neu formatieren
    };

    // Vollbild
    $('fullscreenBtn').onclick = () => {
      const doc = document;
      const el = doc.documentElement;
      if (doc.fullscreenElement || doc.webkitFullscreenElement) {
        (doc.exitFullscreen || doc.webkitExitFullscreen)?.call(doc);
      } else {
        (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
      }
    };

    // Hilfe
    $('helpBtn').onclick = openHelp;
  };

  // Gespeicherte Einstellungen in die Selects übernehmen
  $('lineModeSel').value = getSetting('lineMode');
  $('profileSel').value = getSetting('profile');
  $('imgQualitySel').value = getSetting('imgQuality');

  applyI18n();
  updateLangBtn();
  updateProfileState();
  bindToolbar();
  window.addEventListener('pageshow', bindToolbar);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) bindToolbar(); });

  // ESC schließt offene Popups
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && map._popup) map.closePopup();
  });

  updateButtons();
}
