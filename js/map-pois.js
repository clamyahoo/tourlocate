// POI-Logik: Anlegen, Nummerieren, Popups, Löschen, Sortieren, Erstellungsgesten

import { setRouteWaypoints, snapToTrackIndex } from './map-core.js';
import { getSetting, setSetting } from './map-settings.js';
import { t, formatDateTime } from './map-i18n.js';
import { openPoiDialog, openLightbox } from './map-ui.js';

// In der Track-Ansicht eine Position auf den nächsten aufgezeichneten
// Punkt einrasten (Stationen liegen dann exakt auf der Strecke).
function snapIfTrack(map, lat, lng) {
  const track = map.state.track;
  if (track && track.length && getSetting('lineMode') === 'track') {
    const i = snapToTrackIndex(track, lat, lng);
    return { lat: track[i][0], lng: track[i][1] };
  }
  return { lat, lng };
}

// Gemeinsame Fabrik für interaktive Erstellung UND Import.
// Ruft bewusst NICHT renumberAndRoute auf (Importe arbeiten im Stapel).
export function createPoi(map, { lat, lng, name = '', link = '', linkText = '', img = '', createdAt = '' }) {
  ({ lat, lng } = snapIfTrack(map, lat, lng));
  const marker = L.marker([lat, lng], { draggable: true }).addTo(map.markersLayer);
  const p = {
    lat, lng, name, link, linkText, img,
    createdAt: createdAt || new Date().toISOString(),
    marker
  };

  marker.on('dragend', e => {
    const ll = e.target.getLatLng();
    const snapped = snapIfTrack(map, ll.lat, ll.lng);
    p.lat = snapped.lat;
    p.lng = snapped.lng;
    if (snapped.lat !== ll.lat || snapped.lng !== ll.lng) {
      e.target.setLatLng([p.lat, p.lng]); // Marker sichtbar auf die Strecke ziehen
    }
    renumberAndRoute(map);
  });

  map.state.pois.push(p);
  return p;
}

// Anzeige-Popup binden. Der Inhalt wird als DOM-Element mit direkt
// angehängten Handlern gebaut: Leaflet tauscht Popup-Inhalte in place
// (ohne neues popupopen-Event), dabei bleiben diese Handler erhalten —
// das behebt den alten "Bearbeiten reagiert nicht"-Bug.
export function bindPoiPopup(map, p, i) {
  const title = `${i + 1}. ${p.name || t('station')}`;

  const card = document.createElement('div');
  card.className = 'tl-card';

  const titleEl = document.createElement('div');
  titleEl.className = 'tl-title';
  const strong = document.createElement('strong');
  strong.textContent = title;
  titleEl.appendChild(strong);
  card.appendChild(titleEl);

  const dateText = p.createdAt ? formatDateTime(p.createdAt) : '';
  if (dateText) {
    const dateEl = document.createElement('div');
    dateEl.className = 'tl-date';
    dateEl.textContent = dateText;
    card.appendChild(dateEl);
  }

  if (p.link) {
    const div = document.createElement('div');
    const a = document.createElement('a');
    a.href = p.link;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = p.linkText || t('link');
    div.appendChild(a);
    card.appendChild(div);
  }

  if (p.img) {
    const wrap = document.createElement('div');
    wrap.className = 'tl-thumb';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tl-thumb-btn';
    const img = document.createElement('img');
    img.src = p.img;
    img.alt = '';
    btn.appendChild(img);
    btn.onclick = ev => {
      ev.stopPropagation();
      openLightbox(p.img, title);
    };
    wrap.appendChild(btn);
    card.appendChild(wrap);
  }

  const editDiv = document.createElement('div');
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.textContent = t('edit');
  editBtn.onclick = ev => {
    ev.stopPropagation();
    openPoiDialog(map, p, 'edit');
  };
  editDiv.appendChild(editBtn);
  card.appendChild(editDiv);

  p.marker.bindPopup(card);
  // Ein evtl. wiederverwendetes Dialog-Popup ist jetzt wieder ein Anzeige-Popup
  const popup = p.marker.getPopup();
  if (popup) delete popup._tlDialog;
}

// Nummern-Icons setzen, Popups rebinden, Route & Button-Zustände aktualisieren
export function renumberAndRoute(map) {
  // In der Track-Ansicht folgt die Nummerierung dem Streckenverlauf
  const track = map.state.track;
  if (track && track.length && getSetting('lineMode') === 'track' && map.state.pois.length > 1) {
    map.state.pois.sort((a, b) =>
      snapToTrackIndex(track, a.lat, a.lng) - snapToTrackIndex(track, b.lat, b.lng));
  }

  map.state.pois.forEach((p, i) => {
    const icon = L.divIcon({ className: 'poi-num', html: String(i + 1), iconSize: [26, 26], iconAnchor: [13, 13] });
    p.marker.setIcon(icon);
    // Einen gerade geöffneten Anlegen/Bearbeiten-Dialog nicht ersetzen
    const popup = p.marker.getPopup();
    if (!popup || !popup._tlDialog) bindPoiPopup(map, p, i);
  });

  setRouteWaypoints(map);
  map.onPoisChanged?.();
}

export function removePoi(map, p) {
  const i = map.state.pois.indexOf(p);
  if (i === -1) return;
  map.state.pois.splice(i, 1);
  map.markersLayer.removeLayer(p.marker);
  renumberAndRoute(map);
}

export function removeLastPoi(map) {
  const pois = map.state.pois;
  if (pois.length) removePoi(map, pois[pois.length - 1]);
}

export function clearPois(map) {
  map.state.pois.forEach(p => map.markersLayer.removeLayer(p.marker));
  map.state.pois.length = 0;
  // "Alles löschen" verwirft auch eine importierte Aufzeichnung
  if (map.state.track) {
    map.state.track = null;
    if (getSetting('lineMode') === 'track') setSetting('lineMode', 'route');
    map.onTrackChanged?.();
  }
  renumberAndRoute(map);
}

// Stationen sortieren: key 'name' | 'date', dir 'asc' | 'desc'
export function sortPois(map, key, dir) {
  const factor = dir === 'desc' ? -1 : 1;
  map.state.pois.sort((a, b) => {
    const cmp = key === 'date'
      ? String(a.createdAt).localeCompare(String(b.createdAt)) // ISO sortiert lexikografisch
      : String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' });
    return cmp * factor;
  });
  renumberAndRoute(map);
}

// Erstellungsgesten (Desktop: Doppelklick/Rechtsklick, mobil: Tippen/Langdruck)
export function setupPOIs(map) {
  const startCreation = latlng => {
    const p = createPoi(map, { lat: latlng.lat, lng: latlng.lng });
    renumberAndRoute(map);
    openPoiDialog(map, p, 'create');
  };

  if (L.Browser.mobile) {
    // Mobil: Tipp = Popup schließen oder neuen POI anlegen
    map.on('click', e => {
      if (map._popup) {
        map.closePopup();
      } else {
        startCreation(e.latlng);
      }
    });

    // Mobil: Langdruck = neuer POI
    map.on('contextmenu', e => startCreation(e.latlng));
  } else {
    // Desktop: Klick = Popup schließen
    map.on('click', () => {
      if (map._popup) map.closePopup();
    });

    // Desktop: Doppelklick = neuer POI
    map.doubleClickZoom.disable();
    map.on('dblclick', e => startCreation(e.latlng));

    // Desktop: Rechtsklick = neuer POI
    map.on('contextmenu', e => startCreation(e.latlng));
  }
}
