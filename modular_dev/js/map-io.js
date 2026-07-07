// ===== Kombinierte Version aus map-io_old.js und map-io_develop.js =====

// --- Alter Stand (map-io_old.js) ---
/* map-io.js — Import/Export getrennt von map.js (keine Lightbox/POI-UI hier) */
(function(){
  if (!window.Tour) { console.error('[map-io] Tour-API fehlt. map.js muss vorher geladen werden.'); return; }
  const S = Tour.state;
  const A = Tour.api;
  const $ = (id) => document.getElementById(id);

  // Toolbar-Bindings (nur wenn vorhanden)
  const geoEl   = $('exportGeoBtn');
  const gpxEl   = $('exportGpxBtn');
  const htmlEl  = $('exportHtmlBtn');
  const impGeo  = $('importGeoBtn');
  const impGpx  = $('importGpxBtn');
  const fileGeo = $('fileGeo');
  const fileGpx = $('fileGpx');

  if (geoEl)  geoEl.onclick  = () => triggerBlobDownload('tour.geojson', buildGeoJSONBlob(S));
  if (gpxEl)  gpxEl.onclick  = () => triggerBlobDownload('tour.gpx',     buildGpxBlob(S));
  if (htmlEl) htmlEl.onclick = () => {
    const blob = buildSingleFileHtmlBlob(S);
    // Download statt im neuen Tab öffnen
    triggerBlobDownload('tourlocate.html', blob);
  };

  if (impGeo && fileGeo) {
    impGeo.onclick = () => { fileGeo.value = ''; fileGeo.click(); };
    fileGeo.onchange = async () => {
      const f = fileGeo.files && fileGeo.files[0]; if (!f) return;
      try { importGeoJSON(S, A, JSON.parse(await f.text())); }
      catch { alert('GeoJSON konnte nicht gelesen werden.'); }
    };
  }

  if (impGpx && fileGpx) {
    impGpx.onclick = () => { fileGpx.value = ''; fileGpx.click(); };
    fileGpx.onchange = async () => {
      const f = fileGpx.files && fileGpx.files[0]; if (!f) return;
      try {
        const xml = new DOMParser().parseFromString(await f.text(), 'application/xml');
        if (!window.toGeoJSON) { alert('GPX-Import benötigt togeojson (Script in index.html einbinden).'); return; }
        importGeoJSON(S, A, toGeoJSON.gpx(xml));
      } catch { alert('GPX konnte nicht gelesen werden.'); }
    };
  }

  // Download-Helper
  function triggerBlobDownload(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // Export: GeoJSON
function buildGeoJSONBlob() {
  const pois = (window.Tour && window.Tour.state && Array.isArray(window.Tour.state.pois))
    ? window.Tour.state.pois : [];
  // Optional: bei 0 POIs abbrechen statt leere Datei
  // if (!pois.length) { alert('Keine POIs vorhanden.'); return; }

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


  // Export: GPX

function buildGpxBlob() {
  const pois = (window.Tour && window.Tour.state && Array.isArray(window.Tour.state.pois))
    ? window.Tour.state.pois : [];
  // if (!pois.length) { alert('Keine POIs vorhanden.'); return; }

  const esc = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const wpts = pois.map((p, i) =>
    `<wpt lat="${p.lat}" lon="${p.lng}"><name>${esc((i + 1) + '. ' + (p.name || 'Station'))}</name></wpt>`
  ).join('\n');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Tourlocate">${wpts}</gpx>`;
  return new Blob([gpx], { type: 'application/gpx+xml' });
}


  // Export: Ein-Datei-HTML (robust: JSON-Datenblock, kein </script>-Bruch)
  function buildSingleFileHtmlBlob(S) {
    const flat = S.pois.map(p => ({
      lat: p.lat, lng: p.lng,
      name: p.name || '', link: p.link || '', img: p.img || ''
    }));

    const fallbackRoute = S.pois.map(p => [p.lat, p.lng]);
    const ROUTE = (Array.isArray(S.routeCoords) && S.routeCoords.length) ? S.routeCoords : fallbackRoute;

    const tileURL     = (S.activeBase && S.activeBase._url) ? S.activeBase._url : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    const tileAttrib  = (S.activeBase && S.activeBase.getAttribution && S.activeBase.getAttribution()) ? S.activeBase.getAttribution() : '© OpenStreetMap';
    const tileMaxZoom = (S.activeBase && S.activeBase.options && S.activeBase.options.maxZoom) ? S.activeBase.options.maxZoom : 19;

    const data = {
      GEO: flat,
      ROUTE: ROUTE,
      TILE_URL: tileURL,
      TILE_ATTR: tileAttrib,
      TILE_MAXZ: tileMaxZoom
    };
    // Wichtig: "<" escapen, damit in Base64 nie "</script>" entsteht
    const jsonSafe = JSON.stringify(data).replace(/</g, '\\u003c');

    const html = `<!doctype html><html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tourlocate Export</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css">
<style>
  html,body{height:100%;margin:0}
  #map{height:82vh}
  .poi-num{background:#1976d2;color:#fff;display:flex;align-items:center;justify-content:center;border-radius:50%;width:26px;height:26px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3)}
  .thumb img{cursor:zoom-in}
  .tl-thumb{
    width:120px;height:90px;background:#fff;border:1px solid #e6e6e6;border-radius:6px;
    display:inline-flex;align-items:center;justify-content:center;overflow:hidden
  }
  .tl-thumb > img{width:100%;height:100%;object-fit:contain;display:block}
  #routeinfo{padding:8px 12px;font-weight:600}
</style>
</head><body>

<div id="map"></div>
<div id="routeinfo"></div>

<!-- Sichere Daten-Payload -->
<script id="tl-data" type="application/json">${jsonSafe}</script>

<script>
(function(){
  // Mini-Overlay für Bilder
  var W=document.createElement("div");
  W.id="ov-wrap";
  W.style.cssText="position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.92);z-index:99999;padding:4vh";
  W.innerHTML="<img id=\\"ov-img\\" alt=\\"\\" style=\\"max-width:92vw;max-height:92vh;border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.5)\\">";
  document.body.appendChild(W);
  // NEU: Overlay bei Klick schließen
  W.addEventListener("click", function(){ W.style.display="none"; var I=document.getElementById("ov-img"); if(I) I.removeAttribute("src"); }, {passive:true});
  document.addEventListener("keydown",function(e){if(e.key==="Escape"){W.style.display="none";var I=document.getElementById("ov-img");if(I)I.removeAttribute("src");}});
  document.addEventListener("click",function(e){
    var b=e.target.closest && e.target.closest("button.thumb"); if(!b) return;
    if(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey) return;
    e.preventDefault();
    var src=b.getAttribute("data-img")||"", alt=b.getAttribute("data-title")||"";
    var I=document.getElementById("ov-img"); I.removeAttribute("src"); if(alt) I.alt=alt;
    var T=new Image(); T.onload=function(){ I.src=src; W.style.display="flex"; };
    T.onerror=function(){ try{ window.open(src,"_blank","noopener"); }catch(_){} };
    T.src=src;
  }, true);

  function d2r(x){return x*Math.PI/180;}
  function segKm(a,b){
    var dLat=d2r(b[0]-a[0]), dLng=d2r(b[1]-a[1]);
    var sa=Math.sin(dLat/2)**2 + Math.cos(d2r(a[0]))*Math.cos(d2r(b[0]))*Math.sin(dLng/2)**2;
    return 2*6371*Math.asin(Math.sqrt(sa));
  }
  function sumKm(coords){
    if(!coords || coords.length<2) return 0;
    var s=0; for(var i=1;i<coords.length;i++) s+=segKm(coords[i-1], coords[i]);
    return s;
  }
  function formatKm(km){ return (km<10?km.toFixed(2):km.toFixed(1)).replace('.', ',') + ' km'; }

  function init(){
    try {
      var data = JSON.parse(document.getElementById('tl-data').textContent);
      var map = L.map("map").setView([0,0], 2);
      L.tileLayer(data.TILE_URL, {maxZoom:data.TILE_MAXZ, attribution:data.TILE_ATTR}).addTo(map);
      var markers = L.featureGroup().addTo(map);

      (data.GEO||[]).forEach(function(p,i){
        var icon=L.divIcon({className:"poi-num",html:String(i+1),iconSize:[26,26],iconAnchor:[13,13]});
        var m=L.marker([p.lat,p.lng],{icon:icon}).addTo(markers);
        var name = p.name || ("Station "+(i+1));
        var linkHtml = p.link ? '<div><a href="'+p.link+'" target="_blank" rel="noopener">Link</a></div>' : '';
        var imgHtml  = p.img  ? '<div><button type="button" class="thumb" data-img="'+p.img+'" data-title="'+name+'"><span class="tl-thumb"><img src="'+p.img+'" alt=""></span></button></div>' : '';
        m.bindPopup('<div style="font:12px system-ui,sans-serif"><strong>'+(i+1)+'. '+name+'</strong>'+linkHtml+imgHtml+'</div>');
      });

      if (Array.isArray(data.ROUTE) && data.ROUTE.length>1) {
        L.polyline(data.ROUTE, {weight:4, color:"#d33"}).addTo(map);
      }

      var b=markers.getBounds();
      if (b.isValid()) map.fitBounds(b.pad(0.15));
      setTimeout(function(){ map.invalidateSize(); }, 0);

      // Entfernung im Export berechnen & anzeigen
      var km = 0;
      if (Array.isArray(data.ROUTE) && data.ROUTE.length>1) {
        km = sumKm(data.ROUTE.map(function(ll){ return [ll[0], ll[1]]; }));
      } else if (data.GEO && data.GEO.length>1) {
        km = sumKm(data.GEO.map(function(p){ return [p.lat, p.lng]; }));
      }
      var ri = document.getElementById('routeinfo');
      ri.textContent = km>0 ? ('Gesamt: ' + formatKm(km)) : '';
    } catch (e) {
      var el = document.getElementById('map');
      el.innerHTML = '<div style="padding:12px;color:#b00">Fehler beim Kartenaufbau: '+(e && e.message ? e.message : e)+'</div>';
    }
  }

  // Leaflet erst laden, dann init()
  var s=document.createElement('script');
  s.src='https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';
  s.onload=init;
  s.onerror=function(){
    var el=document.getElementById('map');
    el.innerHTML='<div style="padding:12px;color:#b00">Leaflet konnte nicht geladen werden.</div>';
  };
  document.head.appendChild(s);
})();
</script>

</body></html>`;

    return new Blob([html], { type: 'text/html;charset=utf-8' });
  }

  // Import: GeoJSON in Karte bringen
  function importGeoJSON(S, A, gj){
    if (!gj || !gj.features) return;
    const added = [];
    gj.features.forEach((f) => {
      if (!f || !f.geometry || f.geometry.type !== 'Point') return;
      const c = f.geometry.coordinates; // [lng,lat]
      const p = {
        lat: c[1], lng: c[0],
        name: (f.properties && f.properties.name) || '',
        link: (f.properties && f.properties.link) || '',
        img:  (f.properties && f.properties.img)  || ''
      };
      const icon = L.divIcon({ className:'poi-num', html:String(S.pois.length + added.length + 1), iconSize:[26,26], iconAnchor:[13,13] });
      const m = L.marker([p.lat, p.lng], { icon, draggable: true }).addTo(S.markersLayer);
      p.marker = m;
      m.on('dragend', () => A.renumberAndRoute());
      S.pois.push(p);
      added.push(p);
    });
    A.renumberAndRoute();
    if (added.length) {
      const b = L.featureGroup(added.map(x => x.marker)).getBounds();
      if (b.isValid()) S.map.fitBounds(b.pad(0.15));
    }
  }
})();

// --- Neuer Stand (map-io_develop.js) ---
// ==================== Zentraler Dateipicker (DDG-robust, Variante A) ====================
let __pickImageCb = null;
function setupFilePicker(){
  let inp = document.getElementById('imgInput');
  if (!inp) {
    inp = document.createElement('input');
    inp.type = 'file';
    inp.id   = 'imgInput';
    inp.accept = 'image/*';
    inp.style.display = 'none';
    document.body.appendChild(inp);
  }
  if (!inp.__bound) {
    inp.__bound = true;
    inp.addEventListener('change', async (e) => {
      try {
        const f = e.target.files && e.target.files[0];
        e.target.value = ''; // reset für den nächsten Pick
        if (f && typeof __pickImageCb === 'function') {
          await __pickImageCb(f);
        }
      } catch(err){
        console.error('pickImage error:', err);
        alert('Bild konnte nicht geladen werden: ' + (err?.message || err));
      } finally {
        __pickImageCb = null;
      }
    });
  }
}
function pickImage(callback){
  setupFilePicker();
  __pickImageCb = callback;
  document.getElementById('imgInput').click();
}


// ==================== Export ====================


// Gemeinsamer Download-Helper – PC: blob:, DDG: sichtbarer Tap-Link (Data-URL). Keine window.open/location.href.
function triggerBlobDownload(filename, blob) {
  const ua = navigator.userAgent || '';
  const isDDG = /DuckDuckGo/i.test(ua);

  const clickAnchor = (href) => {
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    a.target = '_self';
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    try { a.click(); } catch(_) {}
    a.remove();
  };

  const showDDGPrompt = (href) => {
    document.getElementById('tl-ddg-dl')?.remove();
    const box = document.createElement('div');
    box.id = 'tl-ddg-dl';
    box.style.cssText =
      'position:fixed;left:12px;right:12px;bottom:12px;z-index:99999;' +
      'background:#111;color:#fff;border-radius:10px;padding:12px;font:14px/1.35 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4)';
    box.innerHTML =
      `<div style="margin-bottom:8px"><strong>Download bereit:</strong> ${filename}</div>` +
      `<div><a id="tl-ddg-link" href="${href}" download="${filename}" ` +
      `style="display:inline-block;padding:8px 12px;background:#2b6cb0;color:#fff;border-radius:8px;text-decoration:none">Tippen zum Herunterladen</a></div>`;
    document.body.appendChild(box);
    const link = document.getElementById('tl-ddg-link');
    link.addEventListener('click', () => setTimeout(() => box.remove(), 500), { passive: true });
  };

  if (isDDG) {
    const type = (blob.type || 'text/plain').toLowerCase();
    if (/^(application\/json|application\/gpx\+xml|application\/xml|text\/html|text\/plain)/.test(type)) {
      blob.text().then(txt => {
        const href = `data:${type};charset=utf-8,` + encodeURIComponent(txt);
        showDDGPrompt(href);
      }).catch(() => {
        const url = URL.createObjectURL(blob);
        showDDGPrompt(url);
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      });
      return;
    }
  }

  const url = URL.createObjectURL(blob);
  clickAnchor(url);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
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

// ... buildSingleFileHtmlBlob() folgt (großes Template mit Leaflet-Einbettung) ...

let exportsBound = false;
function initExports() {
  if (exportsBound) return;
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

initExports();
publishTourState();
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
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
      if (!(geo.type && (geo.type === 'FeatureCollection' || geo.type === 'Feature'))) {
        alert('Die Datei scheint keine gültige GeoJSON-Datei zu sein.');
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
            p.lat=ll.lat; p.lng=ll.lng; renumberAndRoute(); 
          });
          p.marker.on('popupopen', () => {
            const el = p.marker.getPopup().getElement();
            const btn = el?.querySelector('button[data-edit]');
            if (btn) btn.addEventListener('click', ev => { 
              ev.stopPropagation(); 
              openEditPopup(pois.indexOf(p)); 
            });
            if (typeof window.wirePopupImages === 'function') {
              window.wirePopupImages(el);
            }
          });
          pois.push(p);
          newMarkers.push(p.marker);
        }
      });

      renumberAndRoute();
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
        alert('Die Datei scheint keine gültige GPX-Datei zu sein.');
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
            p.lat=ll.lat; p.lng=ll.lng; renumberAndRoute(); 
          });
          p.marker.on('popupopen', () => {
            const el = p.marker.getPopup().getElement();
            const btn = el?.querySelector('button[data-edit]');
            if (btn) btn.addEventListener('click', ev => { 
              ev.stopPropagation(); 
              openEditPopup(pois.indexOf(p)); 
            });
            if (typeof window.wirePopupImages === 'function') {
              window.wirePopupImages(el);
            }
          });
          pois.push(p);
          newMarkers.push(p.marker);
        }
      });

      renumberAndRoute();
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
