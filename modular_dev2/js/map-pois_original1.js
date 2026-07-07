// ==================== map-pois.js ====================
// POI-Verwaltung: Erstellen, Bearbeiten, Anzeigen, Löschen
// =======================================================

import { fileToDataURL, openLightbox } from './map-utils.js';
import { updateButtons } from './map-ui.js';
import { config } from './map-config.js';

let poiList = [];
let undoStack = [];

// -------------------------------------------------------
// POI-Interaktionen einrichten
// -------------------------------------------------------
export function setupPOIHandlers(map, markersLayer, routeLayer) {
  map.on('dblclick', async e => {
    const newPOI = await createPOI(map, markersLayer, routeLayer, e.latlng);
    if (newPOI) {
      poiList.push(newPOI);
      undoStack.push(newPOI);
      updateButtons(markersLayer);
    }
  });
}

// -------------------------------------------------------
// Neues POI-Objekt erstellen
// -------------------------------------------------------
async function createPOI(map, markersLayer, routeLayer, latlng) {
  const num = markersLayer.getLayers().length + 1;
  const markerHtml = `<div class="poi-num">${num}</div>`;
  const icon = L.divIcon({ html: markerHtml, className: 'poi-icon', iconSize: [26, 26] });

  const marker = L.marker(latlng, { icon }).addTo(markersLayer);

  const poiData = { id: Date.now(), latlng, num, imgData: null, text: '' };

  marker.on('click', () => showPOIPopup(map, marker, poiData));

  return poiData;
}

// -------------------------------------------------------
// POI-Popup (Anzeige / Bearbeiten)
// -------------------------------------------------------
function showPOIPopup(map, marker, poiData) {
  const popupHtml = `
    <div style="min-width:200px">
      <textarea id="poiText" placeholder="Beschreibung..." rows="2" style="width:100%;">${poiData.text || ''}</textarea>
      <br>
      <input type="file" id="poiImg" accept="image/*" style="width:100%">
      <br>
      <button id="poiSave">Speichern</button>
      <button id="poiDel">Löschen</button>
      ${poiData.imgData ? '<br><button id="poiShowImg">Bild anzeigen</button>' : ''}
    </div>
  `;

  marker.bindPopup(popupHtml).openPopup();

  setTimeout(() => {
    const saveBtn = document.getElementById('poiSave');
    const delBtn  = document.getElementById('poiDel');
    const imgInput = document.getElementById('poiImg');
    const showBtn  = document.getElementById('poiShowImg');

    saveBtn.addEventListener('click', async () => {
      const textEl = document.getElementById('poiText');
      poiData.text = textEl.value.trim();

      const file = imgInput.files[0];
      if (file) {
        poiData.imgData = await fileToDataURL(file);
      }

      marker.closePopup();
    });

    delBtn.addEventListener('click', () => {
      markersLayer.removeLayer(marker);
      poiList = poiList.filter(p => p.id !== poiData.id);
      marker.closePopup();
      updateButtons(markersLayer);
    });

    if (showBtn) {
      showBtn.addEventListener('click', () => {
        if (poiData.imgData) openLightbox(poiData.imgData);
      });
    }
  }, 100);
}

// -------------------------------------------------------
// Undo / Clear-Funktionen
// -------------------------------------------------------
export function undoLast(map, markersLayer) {
  const last = undoStack.pop();
  if (!last) return;
  const marker = markersLayer.getLayers().find(m => {
    const pos = m.getLatLng();
    return pos.lat === last.latlng.lat && pos.lng === last.latlng.lng;
  });
  if (marker) markersLayer.removeLayer(marker);
  poiList = poiList.filter(p => p.id !== last.id);
  updateButtons(markersLayer);
}

export function clearAll(map, markersLayer, routeLayer) {
  markersLayer.clearLayers();
  routeLayer.clearLayers();
  poiList = [];
  undoStack = [];
  updateButtons(markersLayer);
}

// -------------------------------------------------------
// Export-Funktion für andere Module
// -------------------------------------------------------
export function getPOIData() {
  return poiList.map(p => ({
    id: p.id,
    latlng: p.latlng,
    text: p.text,
    imgData: p.imgData
  }));
}

export function setPOIData(pois, map, markersLayer) {
  clearAll(map, markersLayer);
  pois.forEach(p => {
    const markerHtml = `<div class="poi-num">${p.num || '?'}</div>`;
    const icon = L.divIcon({ html: markerHtml, className: 'poi-icon', iconSize: [26, 26] });
    const marker = L.marker(p.latlng, { icon }).addTo(markersLayer);
    const poiData = { ...p };
    marker.on('click', () => showPOIPopup(map, marker, poiData));
    poiList.push(poiData);
  });
  updateButtons(markersLayer);
}
