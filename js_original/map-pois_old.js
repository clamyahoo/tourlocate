// js/map-pois.js
// =====================================================
// POI-Verwaltung: Erstellen, Anzeigen, Bearbeiten, Bilder, Lightbox
// =====================================================

import { toast } from './map-ui.js';

// interne Zähler und Zustände
let poiCounter = 0;
let editingMarker = null;
let glightboxInstance;

// interne Speicherstruktur
const pois = []; // { marker, title, desc, imgData }

// =====================================================
// Initialisierung
// =====================================================

export function enablePoiInteractions(ctx) {
  const { map, fg } = ctx;

  // Doppelklick oder langer Touch erzeugt neuen POI
  map.on('dblclick', e => startPoiCreation(ctx, e.latlng.lat, e.latlng.lng));

  let touchTimer = null;
  map.on('touchstart', e => {
    touchTimer = setTimeout(() => {
      const t = e.originalEvent.touches?.[0];
      const latlng = e.latlng || (t ? map.mouseEventToLatLng(t) : null);
      if (latlng) startPoiCreation(ctx, latlng.lat, latlng.lng);
    }, 500);
  });
  map.on('touchend', () => clearTimeout(touchTimer));

  // Klick auf Karte schließt Bearbeiten ohne Speichern
  map.on('click', () => {
    if (editingMarker) {
      closeEditPopup(false);
    }
  });
}

// =====================================================
// POI-Erstellung
// =====================================================

function startPoiCreation(ctx, lat, lng) {
  poiCounter++;
  const icon = L.divIcon({
    className: '',
    html: `<div class="poi-number">${poiCounter}</div>`,
    iconSize: [26, 26],
  });
  const marker = L.marker([lat, lng], { icon }).addTo(ctx.fg.markersLayer);
  pois.push({ marker, title: '', desc: '', imgData: '' });

  openEditPopup(marker, true);
}

// =====================================================
// Popup: Anzeigen
// =====================================================

function openViewPopup(marker) {
  const poi = pois.find(p => p.marker === marker);
  if (!poi) return;

  const imgHtml = poi.imgData
    ? `<a href="${poi.imgData}" class="glightbox"><img src="${poi.imgData}" style="max-width:120px;border-radius:8px;margin-top:4px"></a>`
    : '';

  const html = `
    <div style="min-width:200px">
      <b>${poi.title || '(ohne Titel)'}</b><br>
      <div>${poi.desc || ''}</div>
      ${imgHtml}
      <div style="margin-top:6px;text-align:right">
        <button class="edit-btn">Bearbeiten</button>
      </div>
    </div>
  `;

  marker.bindPopup(html, { closeOnClick: false }).openPopup();

  // Edit-Button im Popup aktivieren
  setTimeout(() => {
    const editBtn = document.querySelector('.leaflet-popup-content .edit-btn');
    if (editBtn) {
      editBtn.addEventListener('click', e => {
        e.stopPropagation();
        openEditPopup(marker, false);
      });
    }

    // Lightbox initialisieren, falls Bild vorhanden
    if (poi.imgData && window.GLightbox) {
      glightboxInstance = GLightbox({ selector: '.glightbox' });
    }
  }, 50);
}

// =====================================================
// Popup: Bearbeiten
// =====================================================

function openEditPopup(marker, isNew) {
  const poi = pois.find(p => p.marker === marker);
  if (!poi) return;

  editingMarker = marker;

  const html = `
    <div style="min-width:220px">
      <label style="font-size:12px">Titel</label><br>
      <input id="poiTitle" type="text" value="${poi.title || ''}" style="width:100%"><br>
      <label style="font-size:12px">Beschreibung</label><br>
      <textarea id="poiDesc" rows="2" style="width:100%">${poi.desc || ''}</textarea><br>
      <input id="poiImg" type="file" accept="image/*" style="font-size:12px"><br>
      <div style="margin-top:6px;text-align:right">
        <button id="poiSave">Speichern</button>
        <button id="poiCancel">Abbrechen</button>
      </div>
    </div>
  `;

  marker.bindPopup(html, { closeOnClick: false }).openPopup();

  setTimeout(() => {
    const saveBtn = document.getElementById('poiSave');
    const cancelBtn = document.getElementById('poiCancel');
    const imgInput = document.getElementById('poiImg');

    saveBtn?.addEventListener('click', async e => {
      e.stopPropagation();
      const title = document.getElementById('poiTitle').value.trim();
      const desc = document.getElementById('poiDesc').value.trim();
      let imgData = poi.imgData;

      if (imgInput.files && imgInput.files[0]) {
        imgData = await fileToDataURL(imgInput.files[0]);
      }

      poi.title = title;
      poi.desc = desc;
      poi.imgData = imgData;

      closeEditPopup(true);
    });

    cancelBtn?.addEventListener('click', e => {
      e.stopPropagation();
      closeEditPopup(false);
    });
  }, 50);
}

// =====================================================
// Bearbeiten beenden
// =====================================================

function closeEditPopup(saveChanges) {
  if (!editingMarker) return;
  const poi = pois.find(p => p.marker === editingMarker);
  if (!poi) return;

  if (saveChanges) {
    openViewPopup(editingMarker);
  } else {
    editingMarker.closePopup();
  }
  editingMarker = null;
}

// =====================================================
// Utils
// =====================================================

async function fileToDataURL(file, maxSide = 768, quality = 0.85) {
  const buf = await file.arrayBuffer();
  const blob = new Blob([buf], { type: file.type || 'image/*' });
  const img = new Image();
  img.src = URL.createObjectURL(blob);
  await new Promise(res => (img.onload = res));

  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = img.width * scale;
  canvas.height = img.height * scale;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(img.src);

  return await new Promise(res =>
    canvas.toBlob(
      blob2 => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result);
        reader.readAsDataURL(blob2);
      },
      file.type || 'image/jpeg',
      quality
    )
  );
}

// =====================================================
// Exportierte Hilfsfunktionen
// =====================================================

export function getPoints() {
  return pois.map(p => [p.marker.getLatLng().lat, p.marker.getLatLng().lng]);
}

export function clearAll(ctx) {
  for (const p of pois) ctx.fg.markersLayer.removeLayer(p.marker);
  pois.length = 0;
  poiCounter = 0;
  editingMarker = null;
}

export function undo(ctx) {
  const last = pois.pop();
  if (last) ctx.fg.markersLayer.removeLayer(last.marker);
  poiCounter = Math.max(0, poiCounter - 1);
}
