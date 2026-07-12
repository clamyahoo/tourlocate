// Lokaler Foto-Import per Dateiauswahl oder Drag & Drop:
// mehrere Bilder auf einmal, Platzierung nach EXIF-GPS-Position,
// Reihenfolge (Nummerierung) nach Aufnahmedatum.
//
// Anders als der WebDAV-Import (map-webdav.js) braucht das keinen Server —
// die Dateien liegen als lokale File-Objekte vor, es gibt kein CORS-Problem.

import { IMG_QUALITIES } from './map-config.js';
import { getSetting } from './map-settings.js';
import { fileToDataURL } from './map-utils.js';
import { readExif } from './map-exif.js';
import { createPoi, sortPois } from './map-pois.js';
import { fitToMarkers } from './map-core.js';

const IMAGE_EXT = /\.(jpe?g|png|webp|hei[cf])$/i;

// Aus einer FileList/Array Stationen anlegen; onProgress(fertig, gesamt).
// Rückgabe: { imported, skipped, total } — skipped = Bilder ohne
// lesbare GPS-Position (oder Fehler).
export async function importPhotoFiles(map, files, onProgress) {
  const list = Array.from(files).filter(f => IMAGE_EXT.test(f.name) || /^image\//.test(f.type));
  const q = IMG_QUALITIES[getSetting('imgQuality')] || IMG_QUALITIES.medium;
  let imported = 0;
  let skipped = 0;
  const added = [];

  for (let i = 0; i < list.length; i++) {
    onProgress?.(i, list.length);
    const f = list[i];
    try {
      // EXIF wird aus den Rohbytes gelesen (JPEG). PNG/WebP/HEIC tragen
      // hier i. d. R. keine lesbare GPS-Position → werden übersprungen.
      const exif = readExif(await f.arrayBuffer());
      if (exif.lat == null || exif.lng == null) { skipped++; continue; }

      const dataUrl = await fileToDataURL(f, q.maxSide, q.quality);
      added.push(createPoi(map, {
        lat: exif.lat,
        lng: exif.lng,
        name: f.name.replace(/\.[^.]+$/, ''),
        img: dataUrl,
        // Aufnahmedatum aus EXIF; Fallback auf das Datei-Änderungsdatum
        createdAt: exif.date || (f.lastModified ? new Date(f.lastModified).toISOString() : '')
      }));
      imported++;
    } catch (e) {
      console.warn('Foto übersprungen:', f.name, e);
      skipped++;
    }
  }
  onProgress?.(list.length, list.length);

  if (added.length) {
    // Nummerierung folgt dem Aufnahmedatum
    sortPois(map, 'date', 'asc');
    fitToMarkers(map);
  }
  return { imported, skipped, total: list.length };
}
