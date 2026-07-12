// Minimaler EXIF-Leser und -Schreiber für JPEG-Dateien (ohne Fremdbibliothek).
// Lesen: GPS-Position + Aufnahmedatum (für den WebDAV-Import).
// Schreiben: APP1-Segment mit GPS, Datum und Beschreibung (für den ZIP-Export —
// Canvas-Re-Encoding entfernt EXIF, hier stempeln wir es wieder auf).

// ==================== Lesen ====================

// Liefert { lat, lng, date } — Felder sind null, wenn nicht vorhanden.
export function readExif(arrayBuffer) {
  const out = { lat: null, lng: null, date: null };
  const view = new DataView(arrayBuffer);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8) return out; // kein JPEG

  // APP1-Segment mit "Exif\0\0" suchen
  let offset = 2;
  let tiffStart = -1;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xFF) break;
    const marker = view.getUint8(offset + 1);
    if (marker === 0xDA) break; // Start of Scan → keine Metadaten mehr
    const size = view.getUint16(offset + 2);
    if (marker === 0xE1 &&
        view.getUint32(offset + 4) === 0x45786966 /* "Exif" */ &&
        view.getUint16(offset + 8) === 0) {
      tiffStart = offset + 10;
      break;
    }
    offset += 2 + size;
  }
  if (tiffStart < 0) return out;

  const little = view.getUint16(tiffStart) === 0x4949; // "II" = little endian
  const u16 = o => view.getUint16(tiffStart + o, little);
  const u32 = o => view.getUint32(tiffStart + o, little);

  const readAscii = (valOffset, count) => {
    // Werte >4 Bytes stehen an einem (TIFF-relativen) Offset, sonst
    // direkt im Eintrag — valOffset ist bereits TIFF-relativ
    const start = count > 4 ? u32(valOffset) : valOffset;
    let s = '';
    for (let i = 0; i < count - 1; i++) {
      const c = view.getUint8(tiffStart + start + i);
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s;
  };

  const readRationals = (valOffset, count) => {
    const start = u32(valOffset);
    const vals = [];
    for (let i = 0; i < count; i++) {
      const num = u32(start + i * 8);
      const den = u32(start + i * 8 + 4);
      vals.push(den ? num / den : 0);
    }
    return vals;
  };

  // IFD durchlaufen, gesuchte Tags als {tag: entryOffset} einsammeln
  const scanIfd = (ifdOffset, wanted) => {
    const found = {};
    if (ifdOffset + 2 > view.byteLength - tiffStart) return found;
    const n = u16(ifdOffset);
    for (let i = 0; i < n; i++) {
      const e = ifdOffset + 2 + i * 12;
      const tag = u16(e);
      if (wanted.includes(tag)) found[tag] = e;
    }
    return found;
  };

  try {
    const ifd0 = u32(4);
    const t0 = scanIfd(ifd0, [0x0132, 0x8769, 0x8825]);

    let dateStr = '';
    if (t0[0x8769]) { // Exif-IFD → DateTimeOriginal
      const exifIfd = u32(t0[0x8769] + 8);
      const tx = scanIfd(exifIfd, [0x9003]);
      if (tx[0x9003]) dateStr = readAscii(tx[0x9003] + 8, u32(tx[0x9003] + 4));
    }
    if (!dateStr && t0[0x0132]) {
      dateStr = readAscii(t0[0x0132] + 8, u32(t0[0x0132] + 4));
    }
    // EXIF-Format "YYYY:MM:DD HH:MM:SS" → ISO
    const m = dateStr.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (m) out.date = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;

    if (t0[0x8825]) { // GPS-IFD
      const gpsIfd = u32(t0[0x8825] + 8);
      const tg = scanIfd(gpsIfd, [0x0001, 0x0002, 0x0003, 0x0004]);
      if (tg[0x0002] && tg[0x0004]) {
        const latRef = tg[0x0001] ? readAscii(tg[0x0001] + 8, u32(tg[0x0001] + 4)) : 'N';
        const lngRef = tg[0x0003] ? readAscii(tg[0x0003] + 8, u32(tg[0x0003] + 4)) : 'E';
        const [ld, lm, ls] = readRationals(tg[0x0002] + 8, 3);
        const [od, om, os] = readRationals(tg[0x0004] + 8, 3);
        const lat = ld + lm / 60 + ls / 3600;
        const lng = od + om / 60 + os / 3600;
        if (isFinite(lat) && isFinite(lng) && (lat || lng)) {
          out.lat = latRef.toUpperCase().startsWith('S') ? -lat : lat;
          out.lng = lngRef.toUpperCase().startsWith('W') ? -lng : lng;
        }
      }
    }
  } catch (e) {
    console.warn('EXIF-Parsing fehlgeschlagen:', e);
  }
  return out;
}

// ==================== Schreiben ====================

// Baut ein komplettes APP1/Exif-Segment (TIFF little-endian) und fügt es
// direkt nach dem SOI-Marker in die JPEG-Bytes ein.
export function writeExif(jpegBytes, { lat, lng, dateIso, description }) {
  if (jpegBytes[0] !== 0xFF || jpegBytes[1] !== 0xD8) return jpegBytes; // kein JPEG

  const enc = new TextEncoder();

  // EXIF-Datumsformat "YYYY:MM:DD HH:MM:SS"
  let exifDate = '';
  const d = dateIso ? new Date(dateIso) : null;
  if (d && !isNaN(d)) {
    const p = n => String(n).padStart(2, '0');
    exifDate = `${d.getFullYear()}:${p(d.getMonth() + 1)}:${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  // Grad → [Grad, Minuten, Sekunden] als Rationale (Sekunden mit 1/10000)
  const toDms = deg => {
    const abs = Math.abs(deg);
    const dg = Math.floor(abs);
    const mn = Math.floor((abs - dg) * 60);
    const sc = Math.round(((abs - dg) * 60 - mn) * 60 * 10000);
    return [[dg, 1], [mn, 1], [sc, 10000]];
  };

  // --- TIFF-Struktur mit Daten-Heap bauen; alle Offsets relativ zum TIFF-Start ---
  // Ein IFD = [{tag, type, count, value}]; value: Zahl (SHORT/LONG),
  // Uint8Array (ASCII/BYTE/UNDEFINED) oder Array von [num,den] (RATIONAL)
  const TYPE_SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 };

  const buildIfd = (entries, ifdOffset, heap) => {
    // heap: { chunks: [], offset: aktueller Heap-Start }
    // Heap-Chunks werden auf gerade Länge gepolstert (TIFF verlangt
    // wort-ausgerichtete Wert-Offsets)
    const pushChunk = bytes => {
      const off = heap.offset;
      if (bytes.length % 2) {
        const padded = new Uint8Array(bytes.length + 1);
        padded.set(bytes);
        bytes = padded;
      }
      heap.chunks.push(bytes);
      heap.offset += bytes.length;
      return off;
    };

    entries.sort((a, b) => a.tag - b.tag);
    const buf = new DataView(new ArrayBuffer(2 + entries.length * 12 + 4));
    buf.setUint16(0, entries.length, true);
    entries.forEach((e, i) => {
      const at = 2 + i * 12;
      buf.setUint16(at, e.tag, true);
      buf.setUint16(at + 2, e.type, true);
      buf.setUint32(at + 4, e.count, true);
      const size = TYPE_SIZES[e.type] * e.count;
      if (e.type === 5) { // RATIONAL → immer in den Heap
        const r = new DataView(new ArrayBuffer(size));
        e.value.forEach(([num, den], j) => {
          r.setUint32(j * 8, num, true);
          r.setUint32(j * 8 + 4, den, true);
        });
        buf.setUint32(at + 8, pushChunk(new Uint8Array(r.buffer)), true);
      } else if (e.type === 2 || e.type === 1 || e.type === 7) { // ASCII/BYTE/UNDEFINED
        if (size <= 4) {
          const inl = new Uint8Array(4);
          inl.set(e.value.subarray(0, size));
          buf.setUint32(at + 8, new DataView(inl.buffer).getUint32(0, true), true);
        } else {
          buf.setUint32(at + 8, pushChunk(e.value), true);
        }
      } else { // SHORT/LONG inline
        if (e.type === 3) buf.setUint16(at + 8, e.value, true);
        else buf.setUint32(at + 8, e.value, true);
      }
    });
    buf.setUint32(2 + entries.length * 12, 0, true); // kein weiteres IFD
    return new Uint8Array(buf.buffer);
  };

  // count muss der BYTE-Länge entsprechen (Umlaute belegen in UTF-8
  // mehrere Bytes) — daher immer aus den kodierten Bytes ableiten
  const ascii = s => enc.encode(s + '\0');
  const asciiEntry = (tag, s) => {
    const bytes = ascii(s);
    return { tag, type: 2, count: bytes.length, value: bytes };
  };

  // Bildmaße aus dem SOF-Marker (für die Pflicht-Tags ExifImageWidth/Height)
  const readJpegSize = bytes => {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let o = 2;
    while (o + 4 <= bytes.length) {
      if (v.getUint8(o) !== 0xFF) break;
      const m = v.getUint8(o + 1);
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
        return { height: v.getUint16(o + 5), width: v.getUint16(o + 7) };
      }
      o += 2 + v.getUint16(o + 2);
    }
    return null;
  };
  const dim = readJpegSize(jpegBytes);

  // Layout: TIFF-Header(8) | IFD0 | ExifIFD | GPSIFD | Heap
  const ifd0Entries = [];
  const exifEntries = [];
  const gpsEntries = [];

  const hasGps = isFinite(lat) && isFinite(lng);
  if (!description && !exifDate && !hasGps) return jpegBytes; // nichts zu schreiben

  if (description) ifd0Entries.push(asciiEntry(0x010E, description));
  if (exifDate) {
    ifd0Entries.push(asciiEntry(0x0132, exifDate));
    exifEntries.push(asciiEntry(0x9003, exifDate));
  }

  // Von der EXIF-Spezifikation geforderte Basis-Tags (sonst warnen Validatoren)
  ifd0Entries.push({ tag: 0x011A, type: 5, count: 1, value: [[72, 1]] });          // XResolution
  ifd0Entries.push({ tag: 0x011B, type: 5, count: 1, value: [[72, 1]] });          // YResolution
  ifd0Entries.push({ tag: 0x0128, type: 3, count: 1, value: 2 });                  // ResolutionUnit: Zoll
  ifd0Entries.push({ tag: 0x0213, type: 3, count: 1, value: 1 });                  // YCbCrPositioning
  exifEntries.push({ tag: 0x9000, type: 7, count: 4, value: new Uint8Array([0x30, 0x32, 0x33, 0x30]) }); // ExifVersion "0230"
  exifEntries.push({ tag: 0x9101, type: 7, count: 4, value: new Uint8Array([1, 2, 3, 0]) });             // ComponentsConfiguration YCbCr
  exifEntries.push({ tag: 0xA000, type: 7, count: 4, value: new Uint8Array([0x30, 0x31, 0x30, 0x30]) }); // FlashpixVersion "0100"
  exifEntries.push({ tag: 0xA001, type: 3, count: 1, value: 1 });                  // ColorSpace: sRGB
  if (dim) {
    exifEntries.push({ tag: 0xA002, type: 4, count: 1, value: dim.width });        // ExifImageWidth
    exifEntries.push({ tag: 0xA003, type: 4, count: 1, value: dim.height });       // ExifImageHeight
  }
  if (hasGps) {
    gpsEntries.push({ tag: 0x0000, type: 1, count: 4, value: new Uint8Array([2, 3, 0, 0]) });
    gpsEntries.push(asciiEntry(0x0001, lat >= 0 ? 'N' : 'S'));
    gpsEntries.push({ tag: 0x0002, type: 5, count: 3, value: toDms(lat) });
    gpsEntries.push(asciiEntry(0x0003, lng >= 0 ? 'E' : 'W'));
    gpsEntries.push({ tag: 0x0004, type: 5, count: 3, value: toDms(lng) });
  }

  const ifdSize = n => 2 + n * 12 + 4;
  const ifd0Count = ifd0Entries.length + (exifEntries.length ? 1 : 0) + (gpsEntries.length ? 1 : 0);
  const ifd0Off = 8;
  const exifOff = ifd0Off + ifdSize(ifd0Count);
  const gpsOff = exifOff + (exifEntries.length ? ifdSize(exifEntries.length) : 0);
  const heapStart = gpsOff + (gpsEntries.length ? ifdSize(gpsEntries.length) : 0);

  if (exifEntries.length) ifd0Entries.push({ tag: 0x8769, type: 4, count: 1, value: exifOff });
  if (gpsEntries.length) ifd0Entries.push({ tag: 0x8825, type: 4, count: 1, value: gpsOff });

  const heap = { chunks: [], offset: heapStart };
  const ifd0Bytes = buildIfd(ifd0Entries, ifd0Off, heap);
  const exifBytes = exifEntries.length ? buildIfd(exifEntries, exifOff, heap) : new Uint8Array(0);
  const gpsBytes = gpsEntries.length ? buildIfd(gpsEntries, gpsOff, heap) : new Uint8Array(0);

  const tiffHeader = new Uint8Array([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00]); // "II", 42, IFD0@8
  const tiffLen = heap.offset;
  const tiff = new Uint8Array(tiffLen);
  tiff.set(tiffHeader, 0);
  tiff.set(ifd0Bytes, ifd0Off);
  if (exifBytes.length) tiff.set(exifBytes, exifOff);
  if (gpsBytes.length) tiff.set(gpsBytes, gpsOff);
  let ho = heapStart;
  for (const c of heap.chunks) { tiff.set(c, ho); ho += c.length; }

  // APP1-Segment: FF E1, Länge, "Exif\0\0", TIFF
  const exifHeader = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]); // "Exif\0\0"
  const segLen = 2 + exifHeader.length + tiff.length;
  const app1 = new Uint8Array(2 + segLen);
  app1[0] = 0xFF; app1[1] = 0xE1;
  app1[2] = (segLen >> 8) & 0xFF; app1[3] = segLen & 0xFF;
  app1.set(exifHeader, 4);
  app1.set(tiff, 10);

  // Direkt nach SOI einfügen
  const result = new Uint8Array(jpegBytes.length + app1.length);
  result.set(jpegBytes.subarray(0, 2), 0);
  result.set(app1, 2);
  result.set(jpegBytes.subarray(2), 2 + app1.length);
  return result;
}
