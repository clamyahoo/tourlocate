// ==================== POIs anlegen ====================
function addPoi(latlng) {
  const name = prompt('Name (optional):');
  if (name === null) return;  // Abbruch komplett

  const link = prompt('Link (optional):');
  if (link === null) return;  // Abbruch komplett

  const marker = L.marker(latlng, { draggable: true }).addTo(markersLayer);
  const p      = { lat: latlng.lat, lng: latlng.lng, name: name || '', link: link || '', img:'', marker };

  marker.on('dragend', e => {
    const ll = e.target.getLatLng();
    p.lat = ll.lat; 
    p.lng = ll.lng;
    renumberAndRoute();
  });

  // Bearbeiten + Bild-Link-Bindings im Popup aktivieren
  marker.on('popupopen', () => {
    const el  = marker.getPopup().getElement();
    const btn = el?.querySelector('button[data-edit]');
    if (btn) btn.addEventListener('click', ev => {
      ev.stopPropagation(); 
      openEditPopup(pois.indexOf(p));
    });
    if (typeof window.wirePopupImages === 'function') {
      window.wirePopupImages(el); // <<<<<< Firefox-fest binden
    }
  });

  pois.push(p);
  renumberAndRoute();
  openAddImagePopup(p);
}

function openAddImagePopup(p) {
  const c = document.createElement('div');
  c.style.font = '12px/1.3 sans-serif';
  c.innerHTML  = '<div><strong>Bild hinzufügen?</strong></div>';

  const row = document.createElement('div');
  row.style.cssText = 'margin-top:6px;display:flex;gap:8px';

  let btnSkip; // merken für Enter

  ['Bild wählen…','Ohne Bild','Abbrechen'].forEach(txt => {
    const b = document.createElement('button'); 
    b.textContent = txt; 
    row.appendChild(b);

    if (txt==='Bild wählen…') b.onclick = (ev) => {
      ev.stopPropagation();
      pickImage(async (file) => {
        let dataUrl;
        try {
          dataUrl = await fileToDataURL(file);
        } catch (e) {
          alert('Bild konnte nicht geladen werden: ' + (e?.message || e));
          return;
        }
        p.img = dataUrl;
        bindPoiPopup(p, pois.indexOf(p));
        p.marker.openPopup();
        const el = p.marker.getPopup().getElement();
        if (typeof window.wirePopupImages === 'function') {
          window.wirePopupImages(el);
        }
      });
    };

    if (txt==='Ohne Bild') {
      btnSkip = b;
      b.onclick = ev => {
        ev.stopPropagation(); 
        bindPoiPopup(p,pois.indexOf(p)); 
        p.marker.openPopup();
        const el = p.marker.getPopup().getElement();
        if (typeof window.wirePopupImages === 'function') {
          window.wirePopupImages(el);
        }
      };
    }

    if (txt==='Abbrechen') b.onclick = ev => {
      ev.stopPropagation(); 
      markersLayer.removeLayer(p.marker); 
      pois = pois.filter(x=>x!==p); 
      renumberAndRoute(); publishTourState();
};
  });
  c.appendChild(row);

  // Enter = wie "Ohne Bild"
  c.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && btnSkip) {
      ev.preventDefault();
      btnSkip.click();
    }
  });

  p.marker.bindPopup(c).openPopup();
}

function openEditPopup(i) {
  const p = pois[i];

  const container = document.createElement('div');
  container.style.font='12px/1.3 sans-serif';
  container.innerHTML =
    `<div style="margin-bottom:6px"><strong>Bearbeiten</strong></div>
     <div style="display:flex;flex-direction:column;gap:6px">
      <label>Bezeichnung:<br><input id="edName" value="${p.name||''}" style="width:220px"></label>
      <label>Link (optional):<br><input id="edLink" value="${p.link||''}" style="width:220px"></label>
      <div style="display:flex;gap:6px">
        <button id="edImgNew">Neues Bild</button>
        <button id="edImgDel">Bild löschen</button>
        <button id="edSave">Speichern</button>
      </div>
     </div>`;

  const save  = () => {
    const name = container.querySelector('#edName').value.trim();
    const link = container.querySelector('#edLink').value.trim();
    p.name = name; 
    p.link = link;
    bindPoiPopup(p,i); 
    p.marker.openPopup(); 
    const el = p.marker.getPopup().getElement();
    if (typeof window.wirePopupImages === 'function') {
      window.wirePopupImages(el);
    }
    renumberAndRoute();
  };

  container.querySelector('#edSave').addEventListener('click', ev => { ev.stopPropagation(); save(); });
  container.querySelector('#edImgDel').addEventListener('click', ev => { ev.stopPropagation(); p.img=''; save(); });
  container.querySelector('#edImgNew').addEventListener('click', (ev) => {
    ev.stopPropagation();
    pickImage(async (file) => {
      let dataUrl;
      try {
        dataUrl = await fileToDataURL(file);
      } catch (e) {
        alert('Bild konnte nicht geladen werden: ' + (e?.message || e));
        return;
      }
      p.img = dataUrl;
      save();
    });
  });

  // Enter = Speichern
  container.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') {
      ev.preventDefault();
      save();
    }
  });

  p.marker.bindPopup(container).openPopup();
}
