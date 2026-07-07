// ==================== POI-VERWALTUNG ====================

import { map } from './map-core.js';

// Marker-Ebene initialisieren (erst nach Kartenerstellung!)
let markersLayer = null;
let poiCounter = 0;
let currentPoi = null;

// Diese Funktion wird beim Start von main.js oder map-core.js aufgerufen
export function initPOILayer(mapInstance) {
  markersLayer = L.featureGroup().addTo(mapInstance);
}


// ==================== POI-ERSTELLUNG ====================
export function startPoiCreation() {
  if (!markersLayer) {
    console.warn("markersLayer noch nicht initialisiert (initPOILayer(map) fehlt).");
    return;
  }

  // Doppelklick-Zoom temporär deaktivieren
  if (map.doubleClickZoom) map.doubleClickZoom.disable();

  // Hinweis in Konsole (optional)
  console.log("POI-Erstellmodus aktiv: Doppelklick, um einen neuen Punkt zu setzen.");

  // Handler definieren
  const handleDblClick = (e) => {
    const latlng = e.latlng;
    const poi = createPoi(latlng);
    markersLayer.addLayer(poi.marker);
    openEditPopup(poi.marker);

    // Nach Erstellen wieder deaktivieren, um versehentliche Mehrfach-Erstellung zu vermeiden
    map.off('dblclick', handleDblClick);
    if (map.doubleClickZoom) map.doubleClickZoom.enable();
    console.log("POI erstellt und Bearbeitungsfenster geöffnet.");
  };

  // Jetzt auf Doppelklick warten
  map.on('dblclick', handleDblClick);
}



// ==================== POI-POPUPS ====================

function openViewPopup(marker) {
  const { title, desc, imgData } = marker.poiData;

  const imgHtml = imgData
    ? `<a href="${imgData}" class="glightbox"><img src="${imgData}" style="max-width:150px;display:block;margin:6px 0;"></a>`
    : '';

  const html = `
    <b>${title || 'Ohne Titel'}</b><br>
    <div>${desc || ''}</div>
    ${imgHtml}
    <div style="margin-top:6px;display:flex;gap:6px;">
      <button id="edit-poi">Bearbeiten</button>
      <button id="delete-poi">Löschen</button>
    </div>
  `;

  marker.bindPopup(html).openPopup();

  marker.once('popupopen', () => {
    const editBtn = document.getElementById('edit-poi');
    const delBtn = document.getElementById('delete-poi');
    if (editBtn) editBtn.onclick = () => openEditPopup(marker);
    if (delBtn) delBtn.onclick = () => deletePoi(marker);

    // Falls Lightbox aktiv ist
    if (typeof GLightbox !== 'undefined') {
      try {
        const lb = GLightbox({ selector: '.glightbox' });
        lb.reload();
      } catch (err) {
        console.warn("GLightbox konnte nicht initialisiert werden:", err);
      }
    }
  });
}

async function openEditPopup(marker) {
  const { title, desc } = marker.poiData;

  const html = `
    <b>POI bearbeiten</b><br>
    <label>Titel:<br><input id="poi-title" type="text" value="${title || ''}" style="width:180px;"></label><br>
    <label>Beschreibung:<br><textarea id="poi-desc" rows="3" style="width:180px;">${desc || ''}</textarea></label><br>
    <label>Neues Bild:<br><input id="poi-image" type="file" accept="image/*"></label><br>
    <div style="margin-top:6px;display:flex;gap:6px;">
      <button id="save-poi">Speichern</button>
      <button id="cancel-poi">Abbrechen</button>
    </div>
    <p style="margin-top:4px;font-size:0.85em;color:#666;">Tipp: Tippen auf Karte schließt ohne zu speichern.</p>
  `;

  marker.bindPopup(html).openPopup();

  marker.once('popupopen', () => {
    const saveBtn = document.getElementById('save-poi');
    const cancelBtn = document.getElementById('cancel-poi');

    if (saveBtn) {
      saveBtn.onclick = async () => {
        const titleVal = document.getElementById('poi-title').value.trim();
        const descVal = document.getElementById('poi-desc').value.trim();
        const file = document.getElementById('poi-image').files[0];

        let imgData = marker.poiData.imgData;
        if (file) imgData = await fileToDataURL(file);

        marker.poiData = { ...marker.poiData, title: titleVal, desc: descVal, imgData };
        marker.closePopup();
        openViewPopup(marker);
      };
    }

    if (cancelBtn) {
      cancelBtn.onclick = () => {
        marker.closePopup();
        openViewPopup(marker);
      };
    }

    // Karte-Klick schließt ohne Speichern
    const mapClickHandler = () => {
      map.off('click', mapClickHandler);
      marker.closePopup();
    };
    map.on('click', mapClickHandler);
  });
}

// ==================== HILFSFUNKTIONEN ====================

async function fileToDataURL(file, maxSide = 768, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function deletePoi(marker) {
  if (markersLayer) {
    markersLayer.removeLayer(marker);
  }
}

// ==================== ZUSATZFUNKTIONEN ====================

// Letzten POI rückgängig machen
export function undoLast() {
  if (!markersLayer) return;
  const layers = markersLayer.getLayers();
  if (layers.length === 0) return;
  const lastMarker = layers[layers.length - 1];
  markersLayer.removeLayer(lastMarker);
}

// Alle POIs löschen
export function clearAll() {
  if (!markersLayer) return;
  markersLayer.clearLayers();
  poiCounter = 0;
  currentPoi = null;
}

// POI-Daten aus Karte holen (Export)
export function getPOIData() {
  if (!markersLayer) return [];
  const pois = [];
  markersLayer.eachLayer((marker) => {
    const { id, title, desc, imgData } = marker.poiData || {};
    const { lat, lng } = marker.getLatLng();
    pois.push({ id, title, desc, imgData, lat, lng });
  });
  return pois;
}

// POI-Daten auf Karte setzen (Import)
export function setPOIData(poiArray) {
  if (!markersLayer || !Array.isArray(poiArray)) return;
  markersLayer.clearLayers();
  poiArray.forEach((p) => {
    const marker = L.marker([p.lat, p.lng]).addTo(markersLayer);
    marker.poiData = {
      id: p.id || `poi-${++poiCounter}`,
      title: p.title || '',
      desc: p.desc || '',
      imgData: p.imgData || null
    };
    marker.on('click', () => openViewPopup(marker));
  });
}

// POI-Interaktionen aktivieren (z. B. nach Import)
export function enablePoiInteractions() {
  if (!markersLayer) return;
  markersLayer.eachLayer((marker) => {
    marker.on('click', () => {
      currentPoi = marker;
      openViewPopup(marker);
    });
  });
}

// ==================== SETUP ====================

// Initialisiert Button-Handler und Interaktionen
export function setupPOIHandlers() {
  enablePoiInteractions();

  const btnNew = document.getElementById('btn-new-poi');
  const btnUndo = document.getElementById('btn-undo-poi');
  const btnClear = document.getElementById('btn-clear-pois');

  if (btnNew) btnNew.onclick = () => startPoiCreation();
  if (btnUndo) btnUndo.onclick = () => undoLast();
  if (btnClear) btnClear.onclick = () => clearAll();
}
