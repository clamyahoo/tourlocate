// UI-Interaktion, Toolbar, Popup-Buttons

import { updateRoute } from './map-core.js';
import { addPOI } from './map-pois.js';

export function setupUI(map) {
  const undoBtn = document.getElementById('undoBtn');
  const clearBtn = document.getElementById('clearBtn');
  const routeinfo = document.getElementById('routeinfo');

  function updateButtons() {
    const count = map.markersLayer.getLayers().length;
    undoBtn.disabled = count === 0;
    clearBtn.disabled = count === 0;
  }

  undoBtn.addEventListener('click', () => {
    const layers = map.markersLayer.getLayers();
    if (layers.length) {
      map.markersLayer.removeLayer(layers[layers.length - 1]);
      updateRoute(map);
      updateButtons();
    }
  });

  clearBtn.addEventListener('click', () => {
    if (confirm('Alle Stationen und Routen löschen?')) {
      map.markersLayer.clearLayers();
      map.routeLayer.clearLayers();
      updateRoute(map);
      updateButtons();
      routeinfo.textContent = '';
    }
  });

  // Klicks auf Marker-Popups (Bearbeiten/Löschen)
  map.on('popupopen', e => {
    const el = e.popup.getElement();
    const editBtn = el.querySelector('.editBtn');
    const delBtn = el.querySelector('.deleteBtn');

    if (editBtn) {
      editBtn.addEventListener('click', () => openEditPopup(map, e.popup._source));
    }
    if (delBtn) {
      delBtn.addEventListener('click', () => {
        map.markersLayer.removeLayer(e.popup._source);
        updateRoute(map);
        updateButtons();
      });
    }
  });

  updateButtons();
}

function openEditPopup(map, marker) {
  const latlng = marker.getLatLng();
  const content = `
    <div>
      <b>Station bearbeiten</b><br>
      <label>Titel:<br><input id="poiTitle" value=""></label><br>
      <label>Beschreibung:<br><textarea id="poiDesc" rows="3"></textarea></label><br>
      <button id="savePoi">Speichern</button>
      <button id="cancelPoi">Abbrechen</button>
    </div>
  `;
  marker.bindPopup(content).openPopup();

  const el = marker.getPopup().getElement();
  el.querySelector('#savePoi').addEventListener('click', () => {
    const title = el.querySelector('#poiTitle').value;
    const desc = el.querySelector('#poiDesc').value;
    savePOIData(marker, title, desc);
    marker.closePopup();
  });
  el.querySelector('#cancelPoi').addEventListener('click', () => marker.closePopup());
}

function savePOIData(marker, title, desc) {
  marker.bindPopup(`
    <div>
      <b>${title || 'Station'}</b><br>
      ${desc ? `<p>${desc}</p>` : ''}
      <button class="editBtn">Bearbeiten</button>
      <button class="deleteBtn">Löschen</button>
    </div>
  `);
}
