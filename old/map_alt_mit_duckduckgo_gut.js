// ==================== Karte & Layer ====================
const map = L.map('map').setView([48.46960, 7.94292], 11);
const osm  = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
const esri = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  { maxZoom: 19, attribution: 'Tiles © Esri' });
const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
  { maxZoom: 17, attribution: '© OpenTopoMap, © OSM' });

const markersLayer = L.featureGroup().addTo(map);
const routeLayer   = L.featureGroup().addTo(map);

// aktive Basiskarte merken
let activeBase = osm;
L.control.layers(
  { OSM: osm, Satellit: esri, Topo: topo },
  { POIs: markersLayer, Route: routeLayer }
).addTo(map);
map.on('baselayerchange', (e) => { activeBase = e.layer; });

// Suche
L.Control.geocoder({ defaultMarkGeocode: false, placeholder: 'Ort suchen…' })
  .on('markgeocode', e => map.fitBounds(e.geocode.bbox))
  .addTo(map);

// ==================== Zustand ====================
let pois = [];                 // {lat,lng,name,link,img,marker}
let routeCoords = [];          // aktuelle Routing-Geometrie als [[lat,lng],...]
const $ = id => document.getElementById(id);

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

// ==================== Routing ====================
const routing = L.Routing.control({
  waypoints: [],
  fitSelectedRoutes: false,
  show: false,
  addWaypoints: false,
  draggableWaypoints: false,
  createMarker: () => null,
  router: L.Routing.osrmv1({ serviceUrl: 'https://router.project-osrm.org/route/v1' })
}).addTo(map);

// Panel komplett ausblenden
routing.getContainer().style.display = 'none';

routing.on('routesfound', e => {
  routeLayer.clearLayers();
  const route = e.routes[0];
  routeLayer.addLayer(L.Routing.line(route));
  routeCoords = route.coordinates.map(ll => [ll.lat, ll.lng]);

  const km = (route.summary.totalDistance / 1000).toFixed(1);
  $('routeinfo').textContent = `Gesamt: ${km} km`;
});

// ==================== Helfer ====================
async function fileToDataURL(file, maxSide = 1200, quality = 0.85) {
  const buf = await file.arrayBuffer();
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([buf]));
  await new Promise(r => img.onload = r);

  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width  = Math.round(img.width  * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(img.src);
  return canvas.toDataURL('image/jpeg', quality);
}

function enableExportButtons() {
  const on = pois.length > 0;
  ['undoBtn','clearBtn','exportGeoBtn','exportGpxBtn','exportHtmlBtn']
    .forEach(id => $(id).disabled = !on);
}

function bindPoiPopup(p, i) {
  const title = `${i+1}. ${p.name || 'Station'}`;
  const link  = p.link ? `<div><a href="${p.link}" target="_blank" rel="noopener">Link</a></div>` : '';
  // Bild Link bleibt „echt“, wird erst beim Popup-Open neutralisiert (Firefox-Fix)
  const img   = p.img  ? `<div><a href="${p.img}" data-title="${title}">
                            <img src="${p.img}" style="max-width:120px;max-height:90px"></a></div>` : '';
  const edit  = `<div style="margin-top:6px"><button data-edit="${i}">Bearbeiten</button></div>`;

  p.marker.bindPopup(`<div style="font:12px/1.3 sans-serif"><strong>${title}</strong>${link}${img}${edit}</div>`);
}

function renumberAndRoute() {
  pois.forEach((p,i) => {
    const icon = L.divIcon({ className:'poi-num', html:String(i+1), iconSize:[26,26], iconAnchor:[13,13] });
    p.marker.setIcon(icon);
    bindPoiPopup(p,i);
  });
  enableExportButtons();

  if (pois.length < 2) {
    routeLayer.clearLayers();
    $('routeinfo').textContent = '';
    routing.setWaypoints([]); // Routing-Engine zurücksetzen
    routeCoords = [];
  } else {
    routing.setWaypoints(pois.map(p => L.latLng(p.lat,p.lng)));
  }
}

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
    wirePopupImages(el); // <<<<<< Firefox-fest binden
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

    if (txt==='Bild wählen…') b.onclick = ev => {
      ev.stopPropagation();
      const input=$('imgInput');
      input.onchange=async()=>{
        const f=input.files?.[0]; input.value='';
        if(f){ 
          p.img=await fileToDataURL(f); 
          bindPoiPopup(p,pois.indexOf(p)); 
          p.marker.openPopup(); 
          // Nach neuem Popup: Links neutralisieren & binden
          wirePopupImages(p.marker.getPopup().getElement());
        }
      };
      input.click();
    };

    if (txt==='Ohne Bild') {
      btnSkip = b;
      b.onclick = ev => {
        ev.stopPropagation(); 
        bindPoiPopup(p,pois.indexOf(p)); 
        p.marker.openPopup();
        wirePopupImages(p.marker.getPopup().getElement());
      };
    }

    if (txt==='Abbrechen') b.onclick = ev => {
      ev.stopPropagation(); 
      markersLayer.removeLayer(p.marker); 
      pois = pois.filter(x=>x!==p); 
      renumberAndRoute();
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
    wirePopupImages(p.marker.getPopup().getElement());
    renumberAndRoute();
  };

  container.querySelector('#edSave').addEventListener('click', ev => { ev.stopPropagation(); save(); });
  container.querySelector('#edImgDel').addEventListener('click', ev => { ev.stopPropagation(); p.img=''; save(); });
  container.querySelector('#edImgNew').addEventListener('click', ev => {
    ev.stopPropagation();
    const input = $('imgInput');
    input.onchange = async () => {
      const f=input.files?.[0]; input.value='';
      if (f) { 
        p.img = await fileToDataURL(f); 
        save(); 
      }
    };
    input.click();
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

// ==================== Export ====================


// Gemeinsamer Download-Helper
function triggerBlobDownload(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url;
  a.download = filename;

  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Builder: GeoJSON
function buildGeoJSONBlob() {
  const fc = {
    type: 'FeatureCollection',
    features: pois.map((p, i) => ({
      type: 'Feature',
      properties: { index: i + 1, name: p.name, link: p.link, img: p.img },
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] }
    }))
  };
  return new Blob([JSON.stringify(fc, null, 2)], { type: 'application/json' });
}

// Builder: GPX (Waypoints)
function buildGpxBlob() {
  const esc = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const wpts = pois.map((p, i) =>
    `<wpt lat="${p.lat}" lon="${p.lng}"><name>${esc((i + 1) + '. ' + (p.name || 'Station'))}</name></wpt>`
  ).join('\n');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Tourlocate">${wpts}</gpx>`;
  return new Blob([gpx], { type: 'application/gpx+xml' });
}

// Builder: Ein-Datei-HTML
function buildSingleFileHtmlBlob() {
  const fc = {
    type:'FeatureCollection',
    features: pois.map((p,i)=>({
      type:'Feature',
      properties:{ index:i+1, name:p.name, link:p.link, img:p.img },
      geometry:{ type:'Point', coordinates:[p.lng,p.lat] }
    }))
  };

  // Route (Fallback = direkte Linie)
  const fallbackRoute = pois.map(p => [p.lat, p.lng]);
  const ROUTE = (routeCoords && routeCoords.length) ? routeCoords : fallbackRoute;

  // aktives Tile-Layer
  const tileURL     = (activeBase && activeBase._url) ? activeBase._url : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const tileAttrib  = (activeBase && activeBase.getAttribution && activeBase.getAttribution()) ? activeBase.getAttribution() : '© OpenStreetMap';
  const tileMaxZoom = (activeBase && activeBase.options && activeBase.options.maxZoom) ? activeBase.options.maxZoom : 19;

  const escHtml = s => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const routeInfo = escHtml($('routeinfo').textContent);

  const html =
'<!doctype html><html><head>'+
'<meta charset="utf-8">'+
'<meta name="viewport" content="width=device-width,initial-scale=1">'+
'<title>Tourlocate Export</title>'+
'<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css">'+
'<style>html,body,#map{height:82vh;margin:0}.poi-num{background:#2b6cb0;color:#fff;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font:700 13px sans-serif;border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,.3);}#routeinfo{padding:8px 12px;font-weight:600}#tl-overlay{position:fixed;inset:0;z-index:10000;display:none;background:rgba(0,0,0,.92);align-items:center;justify-content:center}</style>'+
'</head><body>'+
'<div id="map"></div>'+
'<div id="routeinfo">'+routeInfo+'</div>'+
'<script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"></script>'+
'<script>'+
'const GEO='+JSON.stringify(fc)+';'+
'const ROUTE='+JSON.stringify(ROUTE)+';'+
'const TILE_URL='+JSON.stringify(tileURL)+';'+
'const TILE_ATTR='+JSON.stringify(tileAttrib)+';'+
'const TILE_MAXZ='+(tileMaxZoom)+';'+

// Lightbox (+ FF-Fix) im Export-HTML
`(function(){
  let overlay, img, cap, spinner;
  function ensure(){
    if(overlay) return;
    overlay=document.createElement('div'); overlay.id='tl-overlay';
    overlay.style.cssText='position:fixed;inset:0;z-index:10000;display:none;background:rgba(0,0,0,.92);align-items:center;justify-content:center';
    const fig=document.createElement('figure'); fig.style.cssText='max-width:92vw;max-height:92vh;margin:0;position:relative';
    spinner=document.createElement('div'); spinner.style.cssText='position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:500 14px/1.4 system-ui,sans-serif;color:#ccc'; spinner.textContent='Lade Bild…';
    img=document.createElement('img'); img.style.cssText='max-width:92vw;max-height:86vh;display:block;margin:0 auto;visibility:hidden';
    cap=document.createElement('figcaption'); cap.style.cssText='color:#fff;text-align:center;margin-top:10px;font:500 14px/1.4 system-ui,sans-serif';
    fig.appendChild(spinner); fig.appendChild(img); fig.appendChild(cap); overlay.appendChild(fig); document.body.appendChild(overlay);
    overlay.addEventListener('click',()=>overlay.style.display='none');
    document.addEventListener('keydown',e=>{ if(overlay.style.display!=='none' && e.key==='Escape') overlay.style.display='none'; });
  }
  function isImageHref(h){ if(!h) return false; if(h.startsWith('data:image/')) return true; try { return /\.(jpe?g|png|webp|gif|bmp|svg)$/i.test(new URL(h, location.href).pathname); } catch { return false; } }
  function wirePopupImages(container){
    if(!container) return;
    container.querySelectorAll('a').forEach(a=>{
      const href=a.getAttribute('href')||''; const hasImg=!!a.querySelector('img');
      if(!hasImg && !isImageHref(href)) return;
      a.dataset.lbSrc=href; a.setAttribute('href','#'); a.removeAttribute('target');
      if(a.__lbBound) return; a.__lbBound=true;
      a.addEventListener('click',function(ev){ ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation(); open(a.dataset.lbSrc, a.getAttribute('data-title')||a.getAttribute('title')||a.textContent||''); }, {capture:true});
      a.setAttribute('role','button'); a.setAttribute('tabindex','0');
      a.addEventListener('keydown',function(ev){ if(ev.key==='Enter'||ev.key===' '){ ev.preventDefault(); ev.stopPropagation(); open(a.dataset.lbSrc, a.getAttribute('data-title')||a.getAttribute('title')||a.textContent||''); }});
    });
  }
  function open(href,title){
    ensure();
    spinner.style.display='flex'; img.style.visibility='hidden'; cap.textContent=title||''; overlay.style.display='flex';
    const pre=new Image(); pre.onload=function(){ img.src=pre.src; spinner.style.display='none'; img.style.visibility='visible'; };
    pre.onerror=function(){ spinner.textContent='Bild konnte nicht geladen werden.'; };
    requestAnimationFrame(()=>{ pre.src=href; });
  }
  window.__wirePopupImages = wirePopupImages;
})();`+

// Map + Popups
'const map=L.map("map").setView([0,0],2);'+
'L.tileLayer(TILE_URL,{maxZoom:TILE_MAXZ,attribution:TILE_ATTR}).addTo(map);'+
'const markers=L.featureGroup().addTo(map);'+
'GEO.features.forEach(function(f,i){'+
'  var lng=f.geometry.coordinates[0], lat=f.geometry.coordinates[1];'+
'  var name=(f.properties&&f.properties.name)||("Station "+(i+1));'+
'  var link=(f.properties&&f.properties.link)||"";'+
'  var img=(f.properties&&f.properties.img)||"";'+
'  var icon=L.divIcon({className:"poi-num",html:String(i+1),iconSize:[26,26],iconAnchor:[13,13]});'+
'  var m=L.marker([lat,lng],{icon:icon}).addTo(markers);'+
'  var linkHtml=link?`<div><a href="${link}" target="_blank" rel="noopener">Link</a></div>`:"";'+
'  var imgHtml=img?`<div><a href="${img}" data-title="${i+1}. ${name}"><img src="${img}" style="max-width:120px;max-height:90px"></a></div>`:"";'+
'  m.bindPopup(`<div style="font:12px sans-serif"><strong>${i+1}. ${name}</strong>${linkHtml}${imgHtml}</div>`);'+
'});'+
'if(ROUTE && ROUTE.length>1){ L.polyline(ROUTE,{weight:4,color:"#d33"}).addTo(map); }'+
'var b=markers.getBounds(); if(b.isValid()) map.fitBounds(b.pad(0.15));'+
'map.on("popupopen",function(e){ var el=e.popup&&e.popup.getElement&&e.popup.getElement(); if(el && window.__wirePopupImages) window.__wirePopupImages(el); });'+
'</'+'script>'+
'</body></html>';

  return new Blob([html], { type: 'text/html;charset=utf-8' });
}

// Event-Binding kapseln (idempotent)
let exportsBound = false;
function initExports() {
  if (exportsBound) return; // schon gebunden
  exportsBound = true;

  $('exportGeoBtn').addEventListener('click', () => {
    const blob = buildGeoJSONBlob();
    triggerBlobDownload('pois.geojson', blob);
  }, { passive: true });

  $('exportGpxBtn').addEventListener('click', () => {
    const blob = buildGpxBlob();
    triggerBlobDownload('pois.wpt.gpx', blob);
  }, { passive: true });

  $('exportHtmlBtn').addEventListener('click', () => {
    const blob = buildSingleFileHtmlBlob();
    triggerBlobDownload('tourlocate.html', blob);
  }, { passive: true });
}

// Erstbindung beim Laden
initExports();

// Nach Tab-Wechsel/Freeze reaktivieren (bfcache, DuckDuckGo, iOS)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    // Falls eine Engine Bindings „vergisst“, erneutes Setzen erlauben
    exportsBound = false;
    initExports();
  }
});
window.addEventListener('pageshow', () => {
  exportsBound = false;
  initExports();
});



// ==================== Import ====================
$('importGeoBtn').onclick = () => $('fileGeo').click();
$('importGpxBtn').onclick = () => $('fileGpx').click();

// ---- GeoJSON-Import ----
$('fileGeo').addEventListener('change', e => {
  const f = e.target.files[0]; 
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const geo = JSON.parse(r.result);

      // Prüfen, ob es nach GeoJSON aussieht
      if (!(geo.type && (geo.type === 'FeatureCollection' || geo.type === 'Feature'))) {
        alert('Die Datei scheint keine gültige GeoJSON-Datei zu sein. Nicht gültige JSON-Dateien werden beim Import verworfen.');
        console.warn('Ungültiges GeoJSON erkannt:', geo);
        return;
      }

      let newMarkers = [];

      (geo.features||[]).forEach(ft => {
        if (ft.geometry?.type === 'Point') {
          const [lng,lat] = ft.geometry.coordinates;
          const p = {
            lat, lng,
            name: ft.properties?.name || '',
            link: ft.properties?.link || '',
            img : ft.properties?.img  || '',
            marker: L.marker([lat,lng],{draggable:true}).addTo(markersLayer)
          };
          p.marker.on('dragend', ev => { 
            const ll=ev.target.getLatLng(); 
            p.lat=ll.lat; 
            p.lng=ll.lng; 
            renumberAndRoute(); 
          });
          p.marker.on('popupopen', () => {
            const el = p.marker.getPopup().getElement();
            const btn = el?.querySelector('button[data-edit]');
            if (btn) btn.addEventListener('click', ev => { 
              ev.stopPropagation(); 
              openEditPopup(pois.indexOf(p)); 
            });
            wirePopupImages(el); // <<<<<<
          });
          pois.push(p);
          newMarkers.push(p.marker);
        }
      });

      renumberAndRoute();

      // Karte auf importierte Marker zentrieren
      if (newMarkers.length > 0) {
        const bounds = L.featureGroup(newMarkers).getBounds();
        if (bounds.isValid()) map.fitBounds(bounds.pad(0.15));
      }

    } catch(err) { 
      alert('GeoJSON-Fehler: '+err.message); 
      console.warn('Fehler beim Parsen von GeoJSON:', err);
    }
  };
  r.readAsText(f); 
  e.target.value='';
});

// ---- GPX-Import ----
$('fileGpx').addEventListener('change', e => {
  const f = e.target.files[0]; 
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const xml = new DOMParser().parseFromString(r.result,'application/xml');
      const gj  = togeojson.gpx(xml);

      if (!(gj.type && gj.type === 'FeatureCollection')) {
        alert('Die Datei scheint keine gültige GPX-Datei zu sein. Nicht gültige Dateien werden beim Import verworfen.');
        console.warn('Ungültiges GPX erkannt:', gj);
        return;
      }

      let newMarkers = [];

      (gj.features||[]).forEach(ft => {
        if (ft.geometry?.type === 'Point') {
          const [lng,lat] = ft.geometry.coordinates;
          const p = {
            lat, lng,
            name: ft.properties?.name || '',
            link: '', 
            img: '',
            marker: L.marker([lat,lng],{draggable:true}).addTo(markersLayer)
          };
          p.marker.on('dragend', ev => { 
            const ll=ev.target.getLatLng(); 
            p.lat=ll.lat; 
            p.lng=ll.lng; 
            renumberAndRoute(); 
          });
          p.marker.on('popupopen', () => {
            const el = p.marker.getPopup().getElement();
            const btn = el?.querySelector('button[data-edit]');
            if (btn) btn.addEventListener('click', ev => { 
              ev.stopPropagation(); 
              openEditPopup(pois.indexOf(p)); 
            });
            wirePopupImages(el); // <<<<<<
          });
          pois.push(p);
          newMarkers.push(p.marker);
        }
      });

      renumberAndRoute();

      // Karte auf importierte Marker zentrieren
      if (newMarkers.length > 0) {
        const bounds = L.featureGroup(newMarkers).getBounds();
        if (bounds.isValid()) map.fitBounds(bounds.pad(0.15));
      }

    } catch(err) { 
      alert('GPX-Fehler: '+err.message); 
      console.warn('Fehler beim Parsen von GPX:', err);
    }
  };
  r.readAsText(f); 
  e.target.value='';
});
