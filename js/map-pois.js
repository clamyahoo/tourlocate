// POI-Logik: Anlegen, Nummerieren, Popups, Löschen, Erstellungsgesten

import { setRouteWaypoints } from './map-core.js';
import { openPoiDialog, openLightbox } from './map-ui.js';

// Gemeinsame Fabrik für interaktive Erstellung UND Import.
// Ruft bewusst NICHT renumberAndRoute auf (Importe arbeiten im Stapel).
export function createPoi(map, { lat, lng, name = '', link = '', img = '' }) {
  const marker = L.marker([lat, lng], { draggable: true }).addTo(map.markersLayer);
  const p = { lat, lng, name, link, img, marker };

  marker.on('dragend', e => {
    const ll = e.target.getLatLng();
    p.lat = ll.lat;
    p.lng = ll.lng;
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
  const title = `${i + 1}. ${p.name || 'Station'}`;

  const card = document.createElement('div');
  card.className = 'tl-card';

  const titleEl = document.createElement('div');
  titleEl.className = 'tl-title';
  const strong = document.createElement('strong');
  strong.textContent = title;
  titleEl.appendChild(strong);
  card.appendChild(titleEl);

  if (p.link) {
    const div = document.createElement('div');
    const a = document.createElement('a');
    a.href = p.link;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'Link';
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
  editBtn.textContent = 'Bearbeiten';
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
