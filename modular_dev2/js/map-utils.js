// ==================== map-utils.js ====================
// Hilfsfunktionen: Bildverarbeitung, Dateien, Lightbox
// ======================================================

import { config } from './map-config.js';

export function initUtils() {
  // Diese Funktion reserviert Platz für zukünftige Utility-Initialisierung
  // (aktuell z. B. GLightbox – die Instanz wird in main.js erzeugt)
}

// ------------------------------------------------------
// Datei in DataURL konvertieren (mit Skalierung & Qualität)
// ------------------------------------------------------
export async function fileToDataURL(file, maxSide = config.export.imageMaxSide, quality = config.export.imageQuality) {
  if (!file) return null;
  try {
    if (file.type === 'image/heic') {
      file = await heic2any({ blob: file, toType: 'image/jpeg' });
    }

    const buf = await file.arrayBuffer();
    const blob = new Blob([buf], { type: file.type || 'image/jpeg' });
    const img = new Image();
    img.src = URL.createObjectURL(blob);

    await new Promise(resolve => { img.onload = resolve; });

    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = img.width * scale;
    canvas.height = img.height * scale;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    URL.revokeObjectURL(img.src);
    return dataUrl;
  } catch (err) {
    alert('Fehler bei der Bildverarbeitung: ' + err.message);
    return null;
  }
}

// ------------------------------------------------------
// Datei als Download auslösen
// ------------------------------------------------------
export function downloadFile(filename, content, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ------------------------------------------------------
// Lightbox-Helfer (einzelnes Bild öffnen)
// ------------------------------------------------------
export function openLightbox(dataUrl) {
  if (!window.glightbox) return;
  window.glightbox.setElements([
    { href: dataUrl, type: 'image' }
  ]);
  window.glightbox.open();
}
