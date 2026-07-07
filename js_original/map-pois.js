// js/map-pois.js
// =====================================================
// POI-Verwaltung: Erstellen, Anzeigen, Bearbeiten, Bilder, Lightbox
// Exportiert: enablePoiInteractions(ctx), addPoi(ctx,...), getPoints(),
//            clearAll(ctx), undo(ctx)
// =====================================================

let poiCounter = 0;
let editingMarker = null;
let glb = null;               // GLightbox-Instanz
const pois = [];              // { marker, title, desc, imgData }

// ---------- Lightbox ----------
function ensureLightbox() {
  if (!window.GLightbox) return null;
  if (glb) return glb;
  glb = GLightbox({
    selector: '.glightbox',
    touchNavigation: true,
    closeOnOutsideClick: true,
    loop: false
  });
  return glb;
}

function tryCloseLightbox() {
  if (!glb) return;
  try { glb.close(); } catch(_) {}
  try { glb.destroy(); } catch(_) {}
  glb = null;
}

// ---------- Marker-Icon (Nummer im Kreis) ----------
function poiIcon(n) {
  return L.divIcon({
    className: '',
    html: `<div class="poi-number">${n}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13]
  });
}

// =====================================================
// Öffentliche API
// =====================================================

/**
 * Interaktionen aktivieren: Doppelklick/Touch → neuen POI anlegen,
 * Kartenklick → Edit/Lightbox schließen.
 */
export function enablePoiInteractions(ctx) {
  const { map } = ctx;

  // Doppelklick → neuer POI
  map.on('dblclick', e => startPoiCreation(ctx, e.latlng.lat, e.latlng.lng));

  // Langer Touch (mobil) → neuer POI
  let touchTimer = null;
  map.on('touchstart', e => {
    touchTimer = setTimeout(() => {
      const t = e.originalEvent.touches?.[0];
      const ll = e.latlng || (t ? map.mouseEventToLatLng(t) : null);
      if (ll) startPoiCreation(ctx, ll.lat, ll.lng);
    }, 500);
  });
  map.on('touchend', () => clearTimeout(touchTimer));

  // Kartenklick: Edit-Popup & Lightbox schließen
  map.on('click', () => {
    if (editingMarker) closeEditPopup(false);
    tryCloseLightbox();
  });
}

/**
 * Externen POI hinzufügen (z. B. beim Import).
 * @returns Marker
 */
export function addPoi(ctx, lat, lng, { title = '', desc = '', imgData = '' } = {}) {
  poiCounter += 1;
  const marker = L.marker([lat, lng], { icon: poiIcon(poiCounter) }).addTo(ctx.fg.markersLayer);
  pois.push({ marker, title, desc, imgData });

  // Marker-Klick zeigt Anzeige-Popup
  marker.on('click', () => openViewPopup(marker));

  // Direkt Anzeige-Popup zeigen (wie nach Speichern)
  openViewPopup(marker);
  return marker;
}

/** Punkte als [lat,lng]-Array (für Routing/Export) */
export function getPoints() {
  return pois.map(p => {
    const ll = p.marker.getLatLng();
    return [ll.lat, ll.lng];
  });
}

/** Alles löschen */
export function clearAll(ctx) {
  for (const p of pois) ctx.fg.markersLayer.removeLayer(p.marker);
  pois.length = 0;
  poiCounter = 0;
  editingMarker = null;
  tryCloseLightbox();
}

/** Letzten POI entfernen */
export function undo(ctx) {
  const last = pois.pop();
  if (last) ctx.fg.markersLayer.removeLayer(last.marker);
  poiCounter = Math.max(0, poiCounter - 1);
}

// =====================================================
// Interne Helfer
// =====================================================

function startPoiCreation(ctx, lat, lng) {
  // Neuer Marker + leerer Datensatz
  poiCounter += 1;
  const marker = L.marker([lat, lng], { icon: poiIcon(poiCounter) }).addTo(ctx.fg.markersLayer);
  pois.push({ marker, title: '', desc: '', imgData: '' });

  // Marker-Klick führt zur Anzeige
  marker.on('click', () => openViewPopup(marker));

  // Sofort Bearbeiten-Popup öffnen
  openEditPopup(marker, true);
}

// ---------- Anzeige-Popup ----------
function openViewPopup(marker) {
  const poi = pois.find(p => p.marker === marker);
  if (!poi) return;

  const imgHtml = poi.imgData
    ? `<a href="${poi.imgData}" class="glightbox" data-gallery="poi"><img src="${poi.imgData}" style="max-width:120px;border-radius:8px;margin-top:4px"></a>`
    : '';

  const html = `
    <div style="min-width:220px">
      <b>${poi.title || '(ohne Titel)'}</b><br>
      <div>${poi.desc ? escapeHTML(poi.desc).replace(/\n/g,'<br>') : ''}</div>
      ${imgHtml}
      <div style="margin-top:8px;text-align:right">
        <button class="edit-btn">Bearbeiten</button>
      </div>
    </div>
  `;

  marker.bindPopup(html, { closeOnClick: false }).openPopup();

  // Vorherige Lightbox schließen + neu initialisieren
  tryCloseLightbox();
  setTimeout(() => {
    const editBtn = document.querySelector('.leaflet-popup-content .edit-btn');
    if (editBtn) {
      editBtn.addEventListener('click', e => {
        e.stopPropagation();
        openEditPopup(marker, false);
      });
    }
    ensureLightbox();
  }, 0);

  // Wenn das Leaflet-Popup zugeht, Lightbox auch schließen
  marker.off('popupclose._glb');
  marker.on('popupclose._glb', () => tryCloseLightbox());
}

// ---------- Bearbeiten-Popup ----------
function openEditPopup(marker, isNew) {
  const poi = pois.find(p => p.marker === marker);
  if (!poi) return;

  editingMarker = marker;

  const html = `
    <div style="min-width:240px">
      <label style="font-size:12px">Titel</label>
      <input id="poiTitle" type="text" value="${escapeAttr(poi.title)}" style="width:100%">
      <label style="font-size:12px;margin-top:6px;display:block">Beschreibung</label>
      <textarea id="poiDesc" rows="3" style="width:100%">${escapeHTML(poi.desc)}</textarea>

      <div style="margin-top:8px">
        <input id="poiImg" type="file" accept="image/*" hidden>
        <button id="poiImgBtn">Neues Bild</button>
        ${poi.imgData ? `<span style="font-size:12px;margin-left:6px">(${Math.max(1, Math.round(poi.imgData.length/1024))} kB)</span>` : ''}
      </div>

      <div style="margin-top:8px;text-align:right">
        <button id="poiSave">Speichern</button>
        <button id="poiCancel">Abbrechen</button>
      </div>
    </div>
  `;

  marker.bindPopup(html, { closeOnClick: false }).openPopup();

  // Events im Popup
  setTimeout(() => {
    const saveBtn   = document.getElementById('poiSave');
    const cancelBtn = document.getElementById('poiCancel');
    const imgBtn    = document.getElementById('poiImgBtn');
    const imgInput  = document.getElementById('poiImg');

    imgBtn?.addEventListener('click', e => { e.stopPropagation(); imgInput?.click(); });

    saveBtn?.addEventListener('click', async e => {
      e.stopPropagation();
      const title = (document.getElementById('poiTitle').value || '').trim();
      const desc  = (document.getElementById('poiDesc').value  || '').trim();
      let imgData = poi.imgData;

      if (imgInput?.files && imgInput.files[0]) {
        try {
          imgData = await fileToDataURL(imgInput.files[0]);
        } catch (err) {
          console.error('[POI] Bild-Konvertierung fehlgeschlagen:', err);
        }
      }

      poi.title = title;
      poi.desc  = desc;
      poi.imgData = imgData;

      closeEditPopup(true);
    });

    cancelBtn?.addEventListener('click', e => { e.stopPropagation(); closeEditPopup(false); });
  }, 0);
}

// ---------- Edit beenden ----------
function closeEditPopup(saveChanges) {
  if (!editingMarker) return;
  const poi = pois.find(p => p.marker === editingMarker);
  if (!poi) { editingMarker = null; return; }

  if (saveChanges) {
    openViewPopup(editingMarker);
  } else {
    editingMarker.closePopup();
  }

  tryCloseLightbox();
  editingMarker = null;
}

// ---------- Utils ----------

async function fileToDataURL(file, maxSide = 1024, quality = 0.85) {
  const buf = await (file.arrayBuffer ? file.arrayBuffer() : new Response(file).arrayBuffer());
  const blob = file.slice ? file : new Blob([buf], { type: file.type || 'image/*' });

  const img = new Image();
  img.src = URL.createObjectURL(blob);
  await new Promise((res, rej) => {
    img.onload = () => res();
    img.onerror = (e) => rej(e);
  });

  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(img.src);

  const mime = (file.type && file.type.startsWith('image/')) ? file.type : 'image/jpeg';
  return await new Promise((res) => canvas.toBlob(b => {
    const reader = new FileReader();
    reader.onload = () => res(reader.result);
    reader.readAsDataURL(b);
  }, mime, quality));
}

function escapeHTML(str = '') {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escapeAttr(str = '') {
  return escapeHTML(str).replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
