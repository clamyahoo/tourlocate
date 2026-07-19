// Generische Helfer: Dateien, Bilder, Downloads, Escaping, Distanz, ZIP

import { t } from './map-i18n.js';
import { CDN } from './map-config.js';

// HEIC/HEIF → JPEG-Blob über ein frisches, verstecktes iframe pro Bild.
// heic2any teilt sich einen globalen WASM-Zustand, der ab dem zweiten
// Aufruf im selben Kontext hängen bleibt (ein Batch-Import würde ab dem
// zweiten Foto blockieren). Ein Web Worker scheitert, weil heic2any ein
// <canvas> (also `document`) braucht. Ein iframe hat sein eigenes
// window/document samt Canvas und eine eigene, frische WASM-Instanz;
// nach der Konvertierung wird es zerstört → sauberer Zustand pro Bild.
function heicToJpegBlob(file, quality) {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    // srcdoc-iframe erbt den Origin → postMessage-Austausch mit dem Parent
    iframe.srcdoc =
      '<script src="' + CDN.heic2any + '"></scr' + 'ipt><script>' +
      'window.addEventListener("message",async function(e){' +
      '  try{' +
      '    var out=await heic2any({blob:e.data.blob,toType:"image/jpeg",quality:e.data.quality});' +
      '    parent.postMessage({tlHeic:true,ok:true,blob:Array.isArray(out)?out[0]:out},"*");' +
      '  }catch(err){ parent.postMessage({tlHeic:true,ok:false,error:String(err&&err.message||err)},"*"); }' +
      '});' +
      'parent.postMessage({tlHeic:true,ready:true},"*");' +
      '</scr' + 'ipt>';

    const cleanup = () => { clearTimeout(to); window.removeEventListener('message', onMsg); iframe.remove(); };
    const onMsg = e => {
      if (e.source !== iframe.contentWindow || !e.data || !e.data.tlHeic) return;
      if (e.data.ready) { iframe.contentWindow.postMessage({ blob: file, quality }, '*'); return; }
      const ok = e.data.ok, payload = e.data.blob, err = e.data.error;
      cleanup();
      ok ? resolve(payload) : reject(new Error(err || 'HEIC-Konvertierung fehlgeschlagen'));
    };
    const to = setTimeout(() => { cleanup(); reject(new Error('heic-timeout')); }, 30000);
    window.addEventListener('message', onMsg);
    document.body.appendChild(iframe);
  });
}

// Datei einlesen (Textinhalt)
export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = err => reject(err);
    reader.readAsText(file);
  });
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// =============== Distanz (Haversine) ===============
export function haversineKm(coords) {
  if (!coords || coords.length < 2) return 0;
  const d2r = x => x * Math.PI / 180;
  let sum = 0;
  for (let i = 1; i < coords.length; i++) {
    const [aLat, aLng] = coords[i - 1];
    const [bLat, bLng] = coords[i];
    const dLat = d2r(bLat - aLat);
    const dLng = d2r(bLng - aLng);
    const sa = Math.sin(dLat / 2) ** 2 +
      Math.cos(d2r(aLat)) * Math.cos(d2r(bLat)) * Math.sin(dLng / 2) ** 2;
    sum += 2 * 6371 * Math.asin(Math.sqrt(sa));
  }
  return sum;
}

// =============== Bild → verkleinertes JPEG als DataURL ===============
// DDG-stabil: DataURL (FileReader) zuerst, dann Fallbacks.
// HEIC/HEIF wird vorab (im Worker) nach JPEG konvertiert.
export async function fileToDataURL(file, maxSide = 1200, quality = 0.85) {
  let src = file;

  const isHeic = /image\/hei[cf]/.test(file.type || '') || /\.hei[cf]$/i.test(file.name || '');
  if (isHeic) {
    src = await heicToJpegBlob(file, quality);
  }

  const drawScaled = (img, w, h) => {
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  };

  // 1) Stabilster Pfad: FileReader → DataURL → <img> → Canvas
  try {
    const dataURL = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error || new Error('filereader-error'));
      fr.readAsDataURL(src);
    });

    const img = new Image();
    await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('img-load-timeout-dataurl')), 7000);
      img.onload = () => { clearTimeout(to); resolve(); };
      img.onerror = () => { clearTimeout(to); reject(new Error('img-load-error-dataurl')); };
      img.src = dataURL;
    });

    return drawScaled(img, img.width, img.height);
  } catch (eDataUrl) {
    // 2) Fallback A: createImageBitmap (wenn verfügbar)
    try {
      if ('createImageBitmap' in window) {
        const bmp = await createImageBitmap(src);
        return drawScaled(bmp, bmp.width, bmp.height);
      }
    } catch (eCib) { /* weiter zum Blob-Fallback */ }

    // 3) Fallback B: blob:-URL (mit sauberem MIME + Timeout)
    const buf = await (src.arrayBuffer ? src.arrayBuffer() : new Response(src).arrayBuffer());
    const mime = (/^image\//.test(src.type || '')) ? src.type : 'image/jpeg';
    const blob = src.slice ? src : new Blob([buf], { type: mime });

    const img = new Image();
    const url = URL.createObjectURL(blob);
    try {
      await new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(new Error('img-load-timeout-blob')), 7000);
        img.onload = () => { clearTimeout(to); resolve(); };
        img.onerror = () => { clearTimeout(to); reject(new Error('img-load-error-blob')); };
        img.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }

    return drawScaled(img, img.width, img.height);
  }
}

// =============== Bild → JPEG-Bytes auf Zielgröße (~200 KB) ===============
// Für die User-Version: verkleinert ein Bild so, dass die JPEG-Datei unter
// targetBytes bleibt (erst Qualität senken, dann Kantenlänge). Liefert die
// JPEG-Bytes (Uint8Array) — passend für Upload UND für writeExif-Stempelung.
// fileToDataURL bleibt bewusst getrennt (die statische App hängt daran).
export async function fileToTargetJpeg(file, targetBytes = 200 * 1024, hardMaxSide = 1600) {
  const isHeic = /image\/hei[cf]/.test(file.type || '') || /\.hei[cf]$/i.test(file.name || '');
  const src = isHeic ? await heicToJpegBlob(file, 0.9) : file;

  const loadImage = (url) => new Promise((resolve, reject) => {
    const img = new Image();
    const to = setTimeout(() => reject(new Error('img-load-timeout')), 8000);
    img.onload = () => { clearTimeout(to); resolve(img); };
    img.onerror = () => { clearTimeout(to); reject(new Error('img-load-error')); };
    img.src = url;
  });

  // Persistente Bildquelle (mehrfaches Enkodieren nötig)
  let drawable, width, height, cleanup = () => {};
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error || new Error('filereader-error'));
      fr.readAsDataURL(src);
    });
    const img = await loadImage(dataUrl);
    drawable = img; width = img.naturalWidth; height = img.naturalHeight;
  } catch (e) {
    if ('createImageBitmap' in window) {
      const bmp = await createImageBitmap(src);
      drawable = bmp; width = bmp.width; height = bmp.height;
      cleanup = () => bmp.close && bmp.close();
    } else {
      const url = URL.createObjectURL(src);
      const img = await loadImage(url);
      drawable = img; width = img.naturalWidth; height = img.naturalHeight;
      cleanup = () => URL.revokeObjectURL(url); // erst nach dem Enkodieren
    }
  }

  const encode = (maxSide, quality) => new Promise((resolve, reject) => {
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext('2d').drawImage(drawable, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(async (blob) => {
      if (!blob) { reject(new Error('canvas-toblob-null')); return; }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, 'image/jpeg', quality);
  });

  try {
    let maxSide = Math.min(hardMaxSide, Math.max(width, height));
    let best = null;
    for (let round = 0; round < 6; round++) {
      for (const q of [0.85, 0.72, 0.6, 0.5]) {
        const bytes = await encode(maxSide, q);
        if (!best || bytes.length < best.length) best = bytes;
        if (bytes.length <= targetBytes) return bytes;
      }
      maxSide = Math.round(maxSide * 0.8);
      if (maxSide < 480) break;
    }
    return best; // bestes Ergebnis, falls das Ziel nicht ganz erreichbar war
  } finally {
    cleanup();
  }
}

// Uint8Array → base64-DataURL (Gegenstück zu dataURLToBytes)
export function bytesToDataURL(bytes, mime = 'image/jpeg') {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return 'data:' + mime + ';base64,' + btoa(bin);
}

// DataURL (base64) → Bytes, z. B. für den ZIP-Export
export function dataURLToBytes(dataUrl) {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// =============== ZIP (Store, ohne Kompression) ===============
// Minimaler ZIP-Writer, damit keine Fremdbibliothek nötig ist. Die Inhalte
// (JPEGs) sind ohnehin schon komprimiert, daher reicht "Store".
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// files: [{ name: 'ordner/datei.jpg', data: Uint8Array }]
export function buildZipBlob(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;

  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  for (const f of files) {
    const nameBytes = encoder.encode(f.name);
    const crc = crc32(f.data);

    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true);  // local file header
    h.setUint16(4, 20, true);          // version needed
    h.setUint16(6, 0x0800, true);      // Flag: UTF-8-Dateinamen
    h.setUint16(8, 0, true);           // Methode: Store
    h.setUint16(10, dosTime, true);
    h.setUint16(12, dosDate, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, f.data.length, true);
    h.setUint32(22, f.data.length, true);
    h.setUint16(26, nameBytes.length, true);
    h.setUint16(28, 0, true);

    chunks.push(h.buffer, nameBytes, f.data);
    central.push({ nameBytes, crc, size: f.data.length, offset });
    offset += 30 + nameBytes.length + f.data.length;
  }

  const cdStart = offset;
  for (const c of central) {
    const h = new DataView(new ArrayBuffer(46));
    h.setUint32(0, 0x02014b50, true);  // central directory header
    h.setUint16(4, 20, true);
    h.setUint16(6, 20, true);
    h.setUint16(8, 0x0800, true);
    h.setUint16(10, 0, true);
    h.setUint16(12, dosTime, true);
    h.setUint16(14, dosDate, true);
    h.setUint32(16, c.crc, true);
    h.setUint32(20, c.size, true);
    h.setUint32(24, c.size, true);
    h.setUint16(28, c.nameBytes.length, true);
    h.setUint32(42, c.offset, true);
    chunks.push(h.buffer, c.nameBytes);
    offset += 46 + c.nameBytes.length;
  }

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);  // end of central directory
  end.setUint16(8, central.length, true);
  end.setUint16(10, central.length, true);
  end.setUint32(12, offset - cdStart, true);
  end.setUint32(16, cdStart, true);
  chunks.push(end.buffer);

  return new Blob(chunks, { type: 'application/zip' });
}

// =============== Download-Helper ===============
// PC: blob:-URL via <a download>. DuckDuckGo: sichtbarer Tap-Link (Data-URL),
// weil manche WebViews programmatische Klicks komplett blocken.
export function triggerBlobDownload(filename, blob) {
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
    try { a.click(); } catch (_) {}
    a.remove();
  };

  // Sichtbarer Download-Hinweis für DDG (echte User-Geste nötig)
  const showDDGPrompt = (href) => {
    document.getElementById('tl-ddg-dl')?.remove();
    const box = document.createElement('div');
    box.id = 'tl-ddg-dl';
    box.style.cssText =
      'position:fixed;left:12px;right:12px;bottom:12px;z-index:99999;' +
      'background:#111;color:#fff;border-radius:10px;padding:12px;font:14px/1.35 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4)';
    box.innerHTML =
      `<div style="margin-bottom:8px"><strong>${t('downloadReady')}</strong> ${escapeHtml(filename)}</div>` +
      `<div><a id="tl-ddg-link" href="${href}" download="${escapeHtml(filename)}" ` +
      `style="display:inline-block;padding:8px 12px;background:#2b6cb0;color:#fff;border-radius:8px;text-decoration:none">${t('tapToDownload')}</a></div>`;
    document.body.appendChild(box);
    document.getElementById('tl-ddg-link')
      .addEventListener('click', () => setTimeout(() => box.remove(), 500), { passive: true });
  };

  if (isDDG) {
    const type = (blob.type || 'text/plain').toLowerCase();
    // Textbasierte Exporte → Data-URL ist in DDG am stabilsten
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
    // Binäre Fälle (ZIP): blob:-URL mit sichtbarem Tap-Link
    const url = URL.createObjectURL(blob);
    showDDGPrompt(url);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return;
  }

  // Standardpfad: blob:-URL, nur via <a download> (keine Navigation, keine neuen Tabs)
  const url = URL.createObjectURL(blob);
  clickAnchor(url);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
