// ==================== Overlay (robuste, eigene Lightbox) ====================
let LB = { overlay:null, img:null, cap:null, spinner:null, last:null };

function ensureLightbox() {
  if (LB.overlay) return;
  const overlay = document.createElement('div');
  overlay.id = 'tl-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;display:none;background:rgba(0,0,0,.92);align-items:center;justify-content:center';

  const fig = document.createElement('figure');
  fig.style.cssText = 'max-width:92vw;max-height:92vh;margin:0;position:relative';

  const spinner = document.createElement('div');
  spinner.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:500 14px/1.4 system-ui,sans-serif;color:#ccc';
  spinner.textContent = 'Lade Bild…';

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
    if (LB.last){
      map.dragging[LB.last.drag ? 'enable' : 'disable']();
      map.scrollWheelZoom[LB.last.wheel ? 'enable' : 'disable']();
      map.doubleClickZoom[LB.last.dbl ? 'enable' : 'disable']();
      LB.last = null;
    }
  };
  overlay.addEventListener('click', close);
  document.addEventListener('keydown', e => { if (overlay.style.display !== 'none' && e.key === 'Escape') close(); });

  LB = { overlay, img, cap, spinner, last:null };
}

function openLightbox(href, title='') {
  ensureLightbox();
  LB.spinner.style.display = 'flex';
  LB.img.style.visibility = 'hidden';
  LB.cap.textContent = title || '';
  LB.overlay.style.display = 'flex';

  LB.last = {
    drag: map.dragging.enabled(),
    wheel: map.scrollWheelZoom.enabled(),
    dbl: map.doubleClickZoom.enabled()
  };
  map.dragging.disable(); map.scrollWheelZoom.disable(); map.doubleClickZoom.disable();

  // Preload → erst nach load anzeigen (fix für „erster Klick zeigt nichts“ in FF)
  const pre = new Image();
  pre.onload = () => {
    LB.img.src = pre.src;
    LB.spinner.style.display = 'none';
    LB.img.style.visibility = 'visible';
  };
  pre.onerror = () => { LB.spinner.textContent = 'Bild konnte nicht geladen werden.'; };
  requestAnimationFrame(() => { pre.src = href; });
}

// ==================== Firefox-sicher: Links im Popup neutralisieren & binden ====================
function isImageHref(href){
  if (!href) return false;
  if (href.startsWith('data:image/')) return true;
  try { return /\.(jpe?g|png|webp|gif|bmp|svg)$/i.test(new URL(href, location.href).pathname); }
  catch { return false; }
}

// Macht aus Bild-Links im Popup neutrale Links und bindet die Lightbox (Leaflet-konform)
function wirePopupImages(container){
  if (!container) return;
  container.querySelectorAll('a').forEach(a => {
    const href = a.getAttribute('href') || '';
    const hasImgChild = !!a.querySelector('img');
    if (!hasImgChild && !isImageHref(href)) return;

    // echte Ziel-URL merken, Link neutralisieren (FF fix)
    a.dataset.lbSrc = href;
    a.setAttribute('href', '#');
    a.removeAttribute('target');

    if (a.__lbBound) return;
    a.__lbBound = true;

    L.DomEvent.on(a, 'click', (ev) => {
      L.DomEvent.preventDefault(ev);
      L.DomEvent.stop(ev);
      const title = a.getAttribute('data-title') || a.getAttribute('title') || a.textContent || '';
      openLightbox(a.dataset.lbSrc, title);
    });

    a.setAttribute('role', 'button');
    a.setAttribute('tabindex', '0');
    L.DomEvent.on(a, 'keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        L.DomEvent.preventDefault(ev);
        L.DomEvent.stop(ev);
        const title = a.getAttribute('data-title') || a.getAttribute('title') || a.textContent || '';
        openLightbox(a.dataset.lbSrc, title);
      }
    });
  });
}
// global verfügbar machen (Fix für asynchrone Picker-Callbacks / bfcache)
window.wirePopupImages = wirePopupImages;


// ==================== Karten-Interaktion ====================

// Desktop vs. Mobile unterscheiden
if (L.Browser.mobile) {
  // Mobil: Tipp = neuen POI oder Popup schließen
  map.on('click', e => {
    if (map._popup) {
      map.closePopup();
    } else {
      addPoi(e.latlng);
    }
  });

  // Mobil: Langdruck = neuer POI
  map.on('contextmenu', e => {
    addPoi(e.latlng);
  });

} else {
  // Desktop: Klick = Popup schließen
  map.on('click', () => {
    if (map._popup) map.closePopup();
  });

  // Desktop: Doppelklick = neuer POI
  map.doubleClickZoom.disable();
  map.on('dblclick', e => addPoi(e.latlng));

  // Desktop: Rechtsklick = neuer POI
  map.on('contextmenu', e => addPoi(e.latlng));
}

// ESC: Popup schließen (nur Desktop sinnvoll)
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && map._popup) {
    map.closePopup();
  }
});

// ==================== Toolbar-Aktionen ====================
$('undoBtn').onclick = () => {
};

$('clearBtn').onclick = () => {
  pois.forEach(p => markersLayer.removeLayer(p.marker));
  pois = [];
  routeLayer.clearLayers();
  $('routeinfo').textContent = '';
  renumberAndRoute();
};
