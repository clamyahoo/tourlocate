// ==================== Helfer ====================
// DDG-stabil: DataURL (FileReader) zuerst, dann Fallbacks
async function fileToDataURL(file, maxSide = 1200, quality = 0.85) {
  // 1) Stabilster Pfad: FileReader → DataURL
  try {
    const dataURL = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload  = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error || new Error('filereader-error'));
      fr.readAsDataURL(file);
    });

    const img = new Image();
    await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('img-load-timeout-dataurl')), 7000);
      img.onload  = () => { clearTimeout(to); resolve(); };
      img.onerror = () => { clearTimeout(to); reject(new Error('img-load-error-dataurl')); };
      img.src = dataURL;
    });

    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width  = Math.round(img.width  * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  } catch (eDataUrl) {
    // 2) Fallback A: createImageBitmap (wenn verfügbar)
    try {
      if ('createImageBitmap' in window) {
        const bmp = await createImageBitmap(file);
        const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(bmp.width  * scale);
        canvas.height = Math.round(bmp.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', quality);
      }
    } catch (eCib) { /* weiter zum Blob-Fallback */ }

    // 3) Fallback B: blob: URL (mit sauberem MIME + Timeout)
    const buf  = await (file.arrayBuffer ? file.arrayBuffer() : new Response(file).arrayBuffer());
    const mime = (/^image\//.test(file.type||'')) ? file.type : 'image/jpeg';
    const blob = file.slice ? file : new Blob([buf], { type: mime });

    const img  = new Image();
    const url  = URL.createObjectURL(blob);
    try {
      await new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(new Error('img-load-timeout-blob')), 7000);
        img.onload  = () => { clearTimeout(to); resolve(); };
        img.onerror = () => { clearTimeout(to); reject(new Error('img-load-error-blob')); };
        img.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }

    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width  = Math.round(img.width  * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  }
}

function enableExportButtons() {
  const on = pois.length > 0;
  ['undoBtn','clearBtn','exportGeoBtn','exportGpxBtn','exportHtmlBtn']
    .forEach(id => $(id).disabled = !on);
}

// ==================== Helper ====================
// Einheitliche Thumbnail-Styles (einmalig injizieren)
function ensureThumbStyles(){
  if (document.getElementById('tl-thumb-style')) return;
  const style = document.createElement('style');
  style.id = 'tl-thumb-style';
  style.textContent = `
    .tl-card{display:flex;flex-direction:column;gap:6px}
    .tl-title{line-height:1.3}
    .tl-thumb{width:120px;height:90px;overflow:hidden;border-radius:6px;box-shadow:0 0 3px rgba(0,0,0,.2);display:inline-block;line-height:0}
    .tl-thumb > a{display:block;width:120px;height:90px}
    .tl-thumb img{width:100%;height:100%;object-fit:contain;display:block}
  `;
  document.head.appendChild(style);
}

function bindPoiPopup(p, i) {
  ensureThumbStyles();
  const title = `${i+1}. ${p.name || 'Station'}`;
  const link  = p.link ? `<div><a href="${p.link}" target="_blank" rel="noopener">Link</a></div>` : '';
  const img   = p.img  ? `<div class="tl-thumb"><a href="${p.img}" data-title="${title}">
                            <img src="${p.img}" alt="">
                          </a></div>` : '';
  const edit  = `<div><button data-edit="${i}">Bearbeiten</button></div>`;

  p.marker.bindPopup(`
    <div class="tl-card" style="font:12px/1.3 sans-serif">
      <div class="tl-title"><strong>${title}</strong></div>
      ${link}
      ${img}
      ${edit}
    </div>
  `);
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

  publishTourState();
}
