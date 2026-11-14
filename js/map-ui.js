// UI: Toolbar, Einstellungen, Anlegen/Bearbeiten-Dialog, Lightbox,
// Hilfe-Overlay, Vollbild, Dateipicker

import { IMG_QUALITIES } from './map-config.js';
import { getSetting, setSetting } from './map-settings.js';
import { t, getLang, setLang, applyI18n } from './map-i18n.js';
import { fileToDataURL } from './map-utils.js';
import { applyRoutingSettings, setRouteWaypoints, renderRouteInfo } from './map-core.js';
import { bindPoiPopup, createPoi, renumberAndRoute, removePoi, removeLastPoi, clearPois, sortPois, pushUndo, popUndo, undo } from './map-pois.js';
import { importFromWebdav, webdavErrorMessage } from './map-webdav.js';
import { importPhotoFiles } from './map-photos.js';
import { readExif } from './map-exif.js';

const $ = id => document.getElementById(id);

// Karten-Referenz für die Lightbox (gesetzt in setupUI)
let _map = null;

// Kamera-Symbol für den Karten-Knopf „Foto vom Standort aufnehmen"
const CAMERA_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2b6cb0" '
  + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>'
  + '<circle cx="12" cy="13" r="3.6"/></svg>';

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

// ==================== Kamera-Aufnahme (capture) ====================
// Eigener persistenter Picker mit capture-Attribut (öffnet auf dem Handy
// direkt die Kamera). Getrennt vom normalen Bild-Picker, damit der
// Dialog-Bildwähler weiterhin auch Galerie-Bilder erlaubt.
let __camCb = null;

function setupCamPicker() {
  let inp = $('camInput');
  if (!inp) {
    inp = document.createElement('input');
    inp.type = 'file';
    inp.id = 'camInput';
    inp.accept = 'image/*';
    inp.setAttribute('capture', 'environment'); // bevorzugt die Rückkamera
    inp.style.display = 'none';
    document.body.appendChild(inp);
  }
  if (!inp.__bound) {
    inp.__bound = true;
    inp.addEventListener('change', async e => {
      const f = e.target.files && e.target.files[0];
      e.target.value = ''; // Reset für die nächste Aufnahme
      if (f && typeof __camCb === 'function') {
        const cb = __camCb;
        __camCb = null;
        try { await cb(f); }
        catch (err) { console.error('captureImage:', err); alert(t('imageError', { msg: err?.message || err })); }
      }
    });
  }
}

export function captureImage(callback) {
  setupCamPicker();
  __camCb = callback;
  $('camInput').click();
}

// Einmalige, hochgenaue Standortabfrage als Promise.
function getPositionOnce() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('no geolocation')); return; }
    navigator.geolocation.getCurrentPosition(resolve, reject,
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
  });
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

// ==================== Kurz-Einblendung (Toast) ====================
// Schlichte, selbst schließende Meldung unten mittig. Optional mit einer
// Aktion (z. B. „Nicht mehr anzeigen"). Nur DOM + Inline-Styles, kein CSS nötig.
let __toastEl = null, __toastTimer = null;
function showToast(text, { actionLabel = '', onAction = null, ms = 4000 } = {}) {
  if (!__toastEl) {
    __toastEl = document.createElement('div');
    __toastEl.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:10001;'
      + 'max-width:90vw;display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:8px;'
      + 'background:rgba(30,30,30,.94);color:#fff;font:500 14px/1.3 system-ui,sans-serif;'
      + 'box-shadow:0 2px 12px rgba(0,0,0,.35)';
    document.body.appendChild(__toastEl);
  }
  __toastEl.textContent = '';
  const span = document.createElement('span');
  span.textContent = text;
  __toastEl.appendChild(span);
  if (actionLabel && onAction) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = actionLabel;
    btn.style.cssText = 'background:none;border:none;color:#7fb2ff;font:600 14px/1.3 system-ui,sans-serif;'
      + 'cursor:pointer;padding:0;white-space:nowrap';
    btn.onclick = () => { try { onAction(); } finally { hideToast(); } };
    __toastEl.appendChild(btn);
  }
  __toastEl.style.display = 'flex';
  clearTimeout(__toastTimer);
  __toastTimer = setTimeout(hideToast, ms);
}
function hideToast() {
  clearTimeout(__toastTimer);
  if (__toastEl) __toastEl.style.display = 'none';
}

// Original-Foto einer App-Kamera-Aufnahme in die Geräte-Galerie (Album
// „Tourlocate") sichern. Greift NUR in der nativen Capacitor-App — im Browser
// ist window.Capacitor nicht vorhanden, dann passiert nichts. Best effort:
// Fehler brechen den Foto-/POI-Ablauf nicht ab.
const ALBUM_NAME = 'Tourlocate';
async function saveCaptureToAlbum(file) {
  const Cap = window.Capacitor;
  const Media = Cap?.Plugins?.Media;
  if (!Cap?.isNativePlatform?.() || !Media) return; // nur in der App
  try {
    // Original-Bytes als Base64-DataURL (bewusst OHNE Downscale/HEIC-Umwandlung
    // — die Galerie soll das echte Foto mit EXIF-GPS/Datum bekommen).
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error || new Error('read-failed'));
      r.readAsDataURL(file);
    });
    // Album „Tourlocate" sicherstellen (auf Android ist ein Album Pflicht).
    const findAlbum = async () =>
      (await Media.getAlbums()).albums.find(a => a.name === ALBUM_NAME);
    let album = await findAlbum();
    if (!album) { await Media.createAlbum({ name: ALBUM_NAME }); album = await findAlbum(); }
    await Media.savePhoto({
      path: dataUrl,
      albumIdentifier: album?.identifier,
      fileName: 'tourlocate-' + Date.now()
    });
    if (getSetting('albumConfirm') !== 'off') {
      showToast(t('albumSaved', { album: ALBUM_NAME }), {
        actionLabel: t('albumDontShow'),
        onAction: () => setSetting('albumConfirm', 'off')
      });
    }
  } catch (e) {
    console.error('saveCaptureToAlbum:', e);
    showToast(t('albumSaveError'));
  }
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
  const linkTextInput = makeField(t('linkTextLabel'), p.linkText || '');

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
      pushUndo(map);      // Löschen einer Station rückgängig machbar
      removePoi(map, p);  // schließt das Popup automatisch mit
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
      popUndo(map); // abgebrochenes Anlegen: Snapshot von startCreation verwerfen
    } else {
      bindPoiPopup(map, p, map.state.pois.indexOf(p));
    }
  };

  const save = () => {
    p.marker.off('popupclose', onPopupClose);
    if (!isCreate) pushUndo(map); // Bearbeiten rückgängig machbar (Anlegen bereits gepusht)
    p.name = nameInput.value.trim();
    p.link = linkInput.value.trim();
    p.linkText = linkTextInput.value.trim();
    p.img = staged.img;
    bindPoiPopup(map, p, map.state.pois.indexOf(p));
    renumberAndRoute(map);
    p.marker.openPopup();
  };

  saveBtn.onclick = ev => { ev.stopPropagation(); save(); };

  imgBtn.onclick = ev => {
    ev.stopPropagation();
    pickImage(async file => {
      imgBtn.disabled = true;
      try {
        // Server-Modus (Editor): Bild verkleinern + hochladen → URL.
        // Sonst (statische App): Base64-DataURL wie gehabt.
        if (typeof map.imageStore === 'function') {
          staged.img = await map.imageStore(file, { lat: p.lat, lng: p.lng });
        } else {
          const q = IMG_QUALITIES[getSetting('imgQuality')] || IMG_QUALITIES.medium;
          staged.img = await fileToDataURL(file, q.maxSide, q.quality);
        }
        updateThumb();
      } catch (e) {
        alert(t('imageError', { msg: e?.message || e }));
      } finally {
        imgBtn.disabled = false;
      }
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

  // Rückgängig-Knopf hängt am Undo-Stapel, nicht an den POIs
  const updateHistoryBtn = () => {
    const b = $('undoActionBtn');
    if (b) b.disabled = map.state.undoStack.length === 0;
  };
  map.onHistoryChanged = updateHistoryBtn;

  const updateButtons = () => {
    const off = map.state.pois.length === 0;
    ['undoBtn', 'clearBtn', 'exportGeoBtn', 'exportGpxBtn', 'exportHtmlBtn', 'exportZipBtn', 'exportImsBtn', 'sortSel']
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

  // Die Option "Aufgezeichnete Strecke" nur anbieten, wenn ein Track
  // importiert wurde. Wird über map.onTrackChanged aus Import/Löschen/
  // Präsentations-Laden angestoßen.
  const updateTrackOption = () => {
    const sel = $('lineModeSel');
    const opt = sel.querySelector('option[value="track"]');
    const has = !!(map.state.track && map.state.track.length);
    if (opt) opt.disabled = !has;
    // Track entfernt, aber noch ausgewählt → zurück auf Route
    if (!has && getSetting('lineMode') === 'track') setSetting('lineMode', 'route');
    sel.value = getSetting('lineMode');
    updateProfileState();
  };
  map.onTrackChanged = updateTrackOption;

  // onclick-Zuweisung ist idempotent → gefahrlos wiederholbar (bfcache/DDG)
  const bindToolbar = () => {
    $('undoBtn').onclick = () => {
      if (map.state.pois.length) { pushUndo(map); removeLastPoi(map); }
    };
    $('clearBtn').onclick = () => {
      if (map.state.pois.length && confirm(t('confirmClear'))) {
        pushUndo(map);
        clearPois(map);
      }
    };

    // Rückgängig (allgemein, für alle Aktionen)
    const undoBtn2 = $('undoActionBtn');
    if (undoBtn2) undoBtn2.onclick = () => undo(map);

    // Sortierung: Auswahl löst einmalige Sortierung aus
    $('sortSel').onchange = e => {
      const [key, dir] = e.target.value.split('-');
      if (key) { pushUndo(map); sortPois(map, key, dir); }
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

  // ==================== Seitenleiste ====================
  const setSidebar = open => {
    document.body.classList.toggle('sidebar-closed', !open);
    setSetting('sidebar', open ? 'open' : 'closed');
    // Leaflet an die neue Kartenbreite anpassen (nach der CSS-Transition)
    setTimeout(() => map.invalidateSize(), 250);
  };
  const stored = getSetting('sidebar');
  const initialOpen = stored ? stored === 'open' : window.innerWidth > 720;
  document.body.classList.toggle('sidebar-closed', !initialOpen);
  $('sidebarToggle').onclick = () => setSidebar(document.body.classList.contains('sidebar-closed'));
  $('sidebarClose').onclick = () => setSidebar(false);

  // ==================== Lokaler Foto-Import (Auswahl + Drag & Drop) ====================
  // Läuft die Verarbeitung, zeigt #routeinfo den Fortschritt; danach Ergebnis-Meldung.
  const runPhotoImport = async files => {
    const ri = $('routeinfo');
    const prev = ri.textContent;
    pushUndo(map); // Import rückgängig machbar
    try {
      const result = await importPhotoFiles(map, files, (done, total) => {
        ri.textContent = t('photoLoading', { done, total });
      });
      ri.textContent = prev;
      if (!result.imported) popUndo(map); // nichts importiert → Snapshot verwerfen
      if (result.total === 0) alert(t('photoNone'));
      else alert(t('photoResult', { imported: result.imported, skipped: result.skipped }));
    } catch (e) {
      ri.textContent = prev;
      popUndo(map);
      console.error('Foto-Import fehlgeschlagen:', e);
    }
  };

  // Foto vom Standort aufnehmen → Station an der Position des Fotos.
  // Quelle der Position in dieser Priorität:
  //   1) EXIF-GPS im Foto (schreiben viele Geräte selbst hinein),
  //   2) sonst nach Rückfrage der Live-Gerätestandort (Geolocation),
  //   3) sonst die Kartenmitte (freundlicher Hinweis zum Verschieben).
  // Die Koordinaten liegen getrennt vom Bild (DB bzw. POI) — der Verlust
  // der EXIF-Daten beim späteren Teilen/Export spielt daher keine Rolle.
  const capturePhotoHere = () => {
    captureImage(async file => {
      // Aufgenommenes Original (best effort) in die Galerie sichern — läuft im
      // Hintergrund, unabhängig vom POI-Ablauf, und nur in der nativen App.
      saveCaptureToAlbum(file);

      const ri = $('routeinfo');
      let lat = null, lng = null, exifDate = null;

      // 1) EXIF-GPS aus dem Original-Foto
      try {
        const ex = readExif(await file.arrayBuffer());
        if (ex.lat != null && ex.lng != null) { lat = ex.lat; lng = ex.lng; exifDate = ex.date; }
      } catch (e) { /* kein lesbares EXIF → weiter */ }

      // 2) Kein EXIF → fragen, ob der Gerätestandort geholt werden soll
      if (lat == null && confirm(t('photoAskGeo'))) {
        ri.textContent = t('locating');
        try {
          const pos = await getPositionOnce();
          lat = pos.coords.latitude; lng = pos.coords.longitude;
        } catch (e) { /* Freigabe verweigert / kein Fix → weiter */ }
      }

      // 3) Immer noch keine Position → Kartenmitte
      let atCenter = false;
      if (lat == null) { const c = map.getCenter(); lat = c.lat; lng = c.lng; atCenter = true; }

      // Bild ablegen: Editor → Server-Upload (URL); statisch → Base64-DataURL
      const q = IMG_QUALITIES[getSetting('imgQuality')] || IMG_QUALITIES.medium;
      const now = new Date().toISOString();
      let img;
      try {
        img = (typeof map.imageStore === 'function')
          ? await map.imageStore(file, { lat, lng, date: exifDate || now })
          : await fileToDataURL(file, q.maxSide, q.quality);
      } catch (e) {
        renderRouteInfo(map);
        alert(t('imageError', { msg: e?.message || e }));
        return;
      }

      pushUndo(map);
      createPoi(map, { lat, lng, name: '', img, createdAt: exifDate || now });
      renumberAndRoute(map);
      if (!atCenter) map.setView([lat, lng], Math.max(map.getZoom(), 16));

      ri.textContent = t('photoAdded');
      setTimeout(() => { if (ri.textContent === t('photoAdded')) renderRouteInfo(map); }, 2500);
      if (atCenter) alert(t('photoNoGeo'));
    });
  };

  const bindPhotos = () => {
    $('importPhotosBtn').onclick = () => { const f = $('filePhotos'); f.value = ''; f.click(); };
    $('filePhotos').onchange = e => { if (e.target.files.length) runPhotoImport(e.target.files); };
    const camBtn = $('takePhotoBtn');
    if (camBtn) camBtn.onclick = capturePhotoHere;
  };

  // Kamera-Knopf direkt auf der Karte (unten rechts, Stil wie „Mein
  // Standort") — schneller Zugriff unterwegs, ohne die Seitenleiste zu
  // öffnen. Nur dieses eine zusätzliche Element, damit die Karte ruhig bleibt.
  const addCameraControl = () => {
    const btn = L.DomUtil.create('a');
    btn.href = '#';
    btn.title = t('takePhoto');
    btn.setAttribute('role', 'button');
    btn.setAttribute('aria-label', t('takePhoto'));
    btn.innerHTML = CAMERA_SVG;
    btn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:30px;height:30px';
    L.DomEvent.on(btn, 'click', e => { L.DomEvent.stop(e); capturePhotoHere(); });
    const ctrl = L.control({ position: 'bottomright' });
    ctrl.onAdd = () => {
      const d = L.DomUtil.create('div', 'leaflet-bar');
      d.appendChild(btn);
      L.DomEvent.disableClickPropagation(d);
      return d;
    };
    ctrl.addTo(map);
  };

  // Drag & Drop über die gesamte Karte. dragenter/leave werden gezählt,
  // weil sie bei jedem Kindelement erneut feuern (sonst flackert das Overlay).
  const setupDragDrop = () => {
    const mapEl = map.getContainer();
    let depth = 0;
    const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

    mapEl.addEventListener('dragenter', e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      document.body.classList.add('dragging-photos');
    });
    mapEl.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
    mapEl.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) document.body.classList.remove('dragging-photos');
    });
    mapEl.addEventListener('drop', e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      document.body.classList.remove('dragging-photos');
      if (e.dataTransfer.files.length) runPhotoImport(e.dataTransfer.files);
    });
  };

  // ==================== WebDAV ====================
  const bindWebdav = () => {
    [['webdavUrlInp', 'webdavUrl'], ['webdavUserInp', 'webdavUser'], ['webdavPassInp', 'webdavPass']]
      .forEach(([id, key]) => {
        const inp = $(id);
        inp.value = getSetting(key);
        inp.onchange = () => setSetting(key, inp.value.trim());
      });

    $('webdavImportBtn').onclick = async () => {
      const btn = $('webdavImportBtn');
      const ri = $('routeinfo');
      const prev = ri.textContent;
      btn.disabled = true;
      pushUndo(map); // Import rückgängig machbar
      try {
        const result = await importFromWebdav(map, (done, total) => {
          ri.textContent = t('webdavLoading', { done, total });
        });
        ri.textContent = prev;
        if (!result.imported) popUndo(map);
        alert(t('webdavResult', { imported: result.imported, skipped: result.skipped }));
      } catch (e) {
        ri.textContent = prev;
        popUndo(map);
        alert(webdavErrorMessage(e));
      } finally {
        btn.disabled = false;
      }
    };
  };

  // Gespeicherte Einstellungen in die Selects übernehmen
  $('lineModeSel').value = getSetting('lineMode');
  $('profileSel').value = getSetting('profile');
  $('imgQualitySel').value = getSetting('imgQuality');

  applyI18n();
  updateLangBtn();
  updateTrackOption();
  bindToolbar();
  bindWebdav();
  bindPhotos();
  addCameraControl();
  setupDragDrop();
  window.addEventListener('pageshow', bindToolbar);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) bindToolbar(); });

  // ESC schließt offene Popups; Ctrl/Cmd+Z macht rückgängig
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && map._popup) { map.closePopup(); return; }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
      e.preventDefault();
      undo(map);
    }
  });

  updateButtons();
  updateHistoryBtn();
}
