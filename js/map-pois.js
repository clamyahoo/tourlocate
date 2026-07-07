// POI-/Marker-Logik: Erstellen, Popups, Bearbeiten

import { updateRoute } from './map-core.js';

export function setupPOIs(map) {
  // Doppelklick erzeugt neuen POI
  map.on('dblclick', e => {
    addPOI(map, e.latlng);
  });
}

// Neuen Marker hinzufügen
export function addPOI(map, latlng) {
  const index = map.markersLayer.getLayers().length + 1;

  const iconHtml = `<div class="poi-num">${index}</div>`;
  const icon = L.divIcon({
    className: 'poi-icon',
    html: iconHtml,
    iconSize: [26, 26],
    iconAnchor: [13, 13]
  });

  const marker = L.marker(latlng, { icon }).addTo(map.markersLayer);
  marker.bindPopup(createPopupHTML(index, latlng)).openPopup();
  updateRoute(map);
}

// Anzeige-Popup erzeugen
export function createPopupHTML(index, latlng) {
  return `
    <div>
      <b>Station ${index}</b><br>
      Lat: ${latlng.lat.toFixed(5)}<br>
      Lng: ${latlng.lng.toFixed(5)}<br>
      <button class="editBtn">Bearbeiten</button>
      <button class="deleteBtn">Löschen</button>
    </div>
  `;
}
