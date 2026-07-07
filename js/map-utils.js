// js/map-utils.js
// =============== Hilfsfunktionen für Dateien, Bilder & Datenkonvertierung ===============

// Datei einlesen (Textinhalt)
export async function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = err => reject(err);
    reader.readAsText(file);
  });
}

// Datei aus Textinhalt herunterladen
export function downloadFile(filename, content, mimeType = 'application/octet-stream') {
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

// =============== Bilder konvertieren (JPEG / HEIC → DataURL) ===============
export async function fileToDataURL(file, maxSide = 768, quality = 0.85) {
  try {
    let blob = file;

    // HEIC-Unterstützung
    if (file.type === 'image/heic' || file.name.toLowerCase().endsWith('.heic')) {
      blob = await heic2any({ blob: file, toType: 'image/jpeg', quality });
    }

    const buf = await (blob.arrayBuffer ? blob.arrayBuffer() : new Response(blob).arrayBuffer());
    const img = new Image();
    img.src = URL.createObjectURL(new Blob([buf]));
    await new Promise(r => (img.onload = r));

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
    console.error('Fehler bei fileToDataURL:', err);
    return null;
  }
}

// =============== GeoJSON ↔ GPX Hilfen ===============
export function geoJSONToGPX(geojson) {
  // einfacher Export-Helfer
  const gpxHeader = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Tourlocate" xmlns="http://www.topografix.com/GPX/1/1">`;
  const gpxFooter = `</gpx>`;
  const waypoints = geojson.features
    .filter(f => f.geometry.type === 'Point')
    .map(f => {
      const [lng, lat] = f.geometry.coordinates;
      return `<wpt lat="${lat}" lon="${lng}">
        <name>${f.properties?.name || ''}</name>
        <desc>${f.properties?.desc || ''}</desc>
      </wpt>`;
    })
    .join('\n');

  return `${gpxHeader}\n${waypoints}\n${gpxFooter}`;
}

// JSON schön formatieren
export function prettyJSON(obj) {
  return JSON.stringify(obj, null, 2);
}

