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
