// Generische Helfer: Dateien lesen, Bilder konvertieren, Downloads, Escaping

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

// =============== Bild → verkleinertes JPEG als DataURL ===============
// DDG-stabil: DataURL (FileReader) zuerst, dann Fallbacks.
// HEIC/HEIF wird vorab per heic2any nach JPEG konvertiert.
export async function fileToDataURL(file, maxSide = 1200, quality = 0.85) {
  let src = file;

  const isHeic = /image\/hei[cf]/.test(file.type || '') || /\.hei[cf]$/i.test(file.name || '');
  if (isHeic) {
    if (typeof heic2any === 'undefined') {
      throw new Error('HEIC-Konvertierung nicht verfügbar (heic2any nicht geladen).');
    }
    src = await heic2any({ blob: file, toType: 'image/jpeg', quality });
    if (Array.isArray(src)) src = src[0]; // heic2any kann mehrere Blobs liefern
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
      `<div style="margin-bottom:8px"><strong>Download bereit:</strong> ${escapeHtml(filename)}</div>` +
      `<div><a id="tl-ddg-link" href="${href}" download="${escapeHtml(filename)}" ` +
      `style="display:inline-block;padding:8px 12px;background:#2b6cb0;color:#fff;border-radius:8px;text-decoration:none">Tippen zum Herunterladen</a></div>`;
    document.body.appendChild(box);
    document.getElementById('tl-ddg-link')
      .addEventListener('click', () => setTimeout(() => box.remove(), 500), { passive: true });
  };

  if (isDDG) {
    const type = (blob.type || 'text/plain').toLowerCase();
    // Unsere Exporte sind textbasiert → Data-URL ist in DDG am stabilsten
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

  // Standardpfad: blob:-URL, nur via <a download> (keine Navigation, keine neuen Tabs)
  const url = URL.createObjectURL(blob);
  clickAnchor(url);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
