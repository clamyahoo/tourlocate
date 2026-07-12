// Übersetzungen (Deutsch/Englisch) und Sprachumschaltung

import { getSetting, setSetting } from './map-settings.js';

const STRINGS = {
  de: {
    // Toolbar
    hint: 'Doppelklick / Rechtsklick (mobil: Tippen / lange drücken) = neue Station',
    undo: 'Letzte löschen',
    clear: 'Alles löschen',
    importGeo: 'GeoJSON importieren…',
    importGpx: 'GPX importieren…',
    exportLabel: 'Export:',
    exportHtml: 'Ein-Datei-HTML',
    exportZip: 'HTML+Bilder (ZIP)',
    sortPlaceholder: 'Sortieren…',
    sortNameAsc: 'Name ↑',
    sortNameDesc: 'Name ↓',
    sortDateAsc: 'Datum ↑',
    sortDateDesc: 'Datum ↓',
    // Einstellungs-Zeile
    connection: 'Verbindung:',
    connRoute: 'Route',
    connStraight: 'Luftlinie',
    connNone: 'keine',
    profile: 'Profil:',
    profCar: 'Auto',
    profBike: 'Rad',
    profFoot: 'zu Fuß',
    imgQuality: 'Bildqualität:',
    imgSmall: 'klein',
    imgMedium: 'mittel',
    imgLarge: 'groß',
    imgOriginal: 'original',
    fullscreen: 'Vollbild',
    help: 'Hilfe',
    // Karte / Routing
    total: 'Gesamt: {km} km',
    routeError: 'Route derzeit nicht verfügbar',
    searchPlaceholder: 'Ort suchen…',
    // POI / Dialog
    station: 'Station',
    newStation: 'Neue Station',
    edit: 'Bearbeiten',
    nameLabel: 'Bezeichnung:',
    linkLabel: 'Link (optional):',
    chooseImage: 'Bild wählen…',
    newImage: 'Neues Bild',
    deleteImage: 'Bild löschen',
    save: 'Speichern',
    cancel: 'Abbrechen',
    deleteStation: 'Station löschen',
    confirmClear: 'Alle Stationen löschen?',
    link: 'Link',
    // Lightbox / Bilder
    loadingImage: 'Lade Bild…',
    imageLoadError: 'Bild konnte nicht geladen werden.',
    imageError: 'Bild konnte nicht geladen werden: {msg}',
    heicUnavailable: 'HEIC-Konvertierung nicht verfügbar (heic2any nicht geladen).',
    // Import / Export
    invalidGeojson: 'Die Datei scheint keine gültige GeoJSON-Datei zu sein. Nicht gültige Dateien werden beim Import verworfen.',
    invalidGpx: 'Die Datei scheint keine gültige GPX-Datei zu sein. Nicht gültige Dateien werden beim Import verworfen.',
    geojsonError: 'GeoJSON-Fehler: {msg}',
    gpxError: 'GPX-Fehler: {msg}',
    needTogeojson: 'GPX-Import benötigt die togeojson-Bibliothek (Script in index.html einbinden).',
    creatingExport: 'Erstelle Export…',
    downloadReady: 'Download bereit:',
    tapToDownload: 'Tippen zum Herunterladen',
    // Exportierte HTML-Datei
    exportTitle: 'Tourlocate Export',
    exportMapError: 'Fehler beim Kartenaufbau: ',
    exportLeafletError: 'Leaflet konnte nicht geladen werden (offline?).',
    // Hilfe
    helpTitle: 'Hilfe',
    helpHtml: `
      <h3>Bedienung</h3>
      <p><strong>Neue Station:</strong> Doppelklick oder Rechtsklick auf die Karte (mobil: Tippen auf eine freie Stelle oder lange drücken). Stationen lassen sich per Ziehen verschieben; „Bearbeiten" im Popup öffnet Name, Link und Bild.</p>
      <h3>Export &amp; Import</h3>
      <p><strong>GeoJSON</strong> sichert die komplette Tour inkl. Bildern und lässt sich hier wieder importieren. <strong>GPX</strong> enthält Stationen und Strecke und funktioniert auch in anderen Apps (z.&nbsp;B. Komoot). <strong>Ein-Datei-HTML</strong> ist eine eigenständige Karte, die auch ohne Internet funktioniert. <strong>HTML+Bilder (ZIP)</strong> legt die Bilder als eigene Dateien in einen Ordner — besser für große Touren.</p>
      <h3>iPhone &amp; iPad</h3>
      <p>Exportierte Dateien landen in der Dateien-App. GeoJSON/GPX können von dort über „Teilen" wieder importiert werden. Die exportierte <strong>HTML-Datei</strong> lässt sich nicht direkt an Safari übergeben — die Vorschau der Dateien-App zeigt die Karte nur eingeschränkt. Empfehlung: eine App mit eingebautem Browser verwenden (z.&nbsp;B. „Documents" von Readdle) oder die Datei in eine Cloud laden und den Link in Safari öffnen.</p>
      <h3>DuckDuckGo (Android)</h3>
      <p>Beim Export erscheint unten ein Hinweis „Tippen zum Herunterladen" — das ist normal, der Browser blockiert automatische Downloads.</p>
    `
  },

  en: {
    hint: 'Double-click / right-click (mobile: tap / long-press) = new station',
    undo: 'Remove last',
    clear: 'Clear all',
    importGeo: 'Import GeoJSON…',
    importGpx: 'Import GPX…',
    exportLabel: 'Export:',
    exportHtml: 'Single-file HTML',
    exportZip: 'HTML+images (ZIP)',
    sortPlaceholder: 'Sort…',
    sortNameAsc: 'Name ↑',
    sortNameDesc: 'Name ↓',
    sortDateAsc: 'Date ↑',
    sortDateDesc: 'Date ↓',
    connection: 'Line:',
    connRoute: 'Route',
    connStraight: 'Straight line',
    connNone: 'none',
    profile: 'Profile:',
    profCar: 'Car',
    profBike: 'Bike',
    profFoot: 'Walking',
    imgQuality: 'Image quality:',
    imgSmall: 'small',
    imgMedium: 'medium',
    imgLarge: 'large',
    imgOriginal: 'original',
    fullscreen: 'Fullscreen',
    help: 'Help',
    total: 'Total: {km} km',
    routeError: 'Route currently unavailable',
    searchPlaceholder: 'Search place…',
    station: 'Station',
    newStation: 'New station',
    edit: 'Edit',
    nameLabel: 'Name:',
    linkLabel: 'Link (optional):',
    chooseImage: 'Choose image…',
    newImage: 'New image',
    deleteImage: 'Delete image',
    save: 'Save',
    cancel: 'Cancel',
    deleteStation: 'Delete station',
    confirmClear: 'Delete all stations?',
    link: 'Link',
    loadingImage: 'Loading image…',
    imageLoadError: 'Image could not be loaded.',
    imageError: 'Image could not be loaded: {msg}',
    heicUnavailable: 'HEIC conversion unavailable (heic2any not loaded).',
    invalidGeojson: 'This does not look like a valid GeoJSON file. Invalid files are discarded on import.',
    invalidGpx: 'This does not look like a valid GPX file. Invalid files are discarded on import.',
    geojsonError: 'GeoJSON error: {msg}',
    gpxError: 'GPX error: {msg}',
    needTogeojson: 'GPX import requires the togeojson library (include the script in index.html).',
    creatingExport: 'Creating export…',
    downloadReady: 'Download ready:',
    tapToDownload: 'Tap to download',
    exportTitle: 'Tourlocate Export',
    exportMapError: 'Error building the map: ',
    exportLeafletError: 'Leaflet could not be loaded (offline?).',
    helpTitle: 'Help',
    helpHtml: `
      <h3>Basics</h3>
      <p><strong>New station:</strong> double-click or right-click the map (mobile: tap an empty spot or long-press). Drag stations to move them; "Edit" in the popup opens name, link and image.</p>
      <h3>Export &amp; import</h3>
      <p><strong>GeoJSON</strong> saves the complete tour including images and can be re-imported here. <strong>GPX</strong> contains stations and track and also works in other apps (e.g. Komoot). <strong>Single-file HTML</strong> is a self-contained map that also works offline. <strong>HTML+images (ZIP)</strong> stores images as separate files in a folder — better for large tours.</p>
      <h3>iPhone &amp; iPad</h3>
      <p>Exported files end up in the Files app. GeoJSON/GPX can be re-imported from there via "Share". The exported <strong>HTML file</strong> cannot be handed to Safari directly — the Files app preview shows the map only partially. Recommendation: use an app with a built-in browser (e.g. "Documents" by Readdle) or upload the file to a cloud and open the link in Safari.</p>
      <h3>DuckDuckGo (Android)</h3>
      <p>On export, a "Tap to download" note appears at the bottom — this is normal, the browser blocks automatic downloads.</p>
    `
  }
};

export function getLang() {
  const l = getSetting('lang');
  return STRINGS[l] ? l : 'de';
}

export function setLang(lang) {
  if (STRINGS[lang]) setSetting('lang', lang);
  applyI18n();
}

// Übersetzung holen; {platzhalter} werden aus vars ersetzt
export function t(key, vars) {
  let s = STRINGS[getLang()][key] ?? STRINGS.de[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll('{' + k + '}', v);
  }
  return s;
}

// Datum/Uhrzeit lokalisiert formatieren
export function formatDateTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString(getLang() === 'de' ? 'de-DE' : 'en-GB', {
    dateStyle: 'short',
    timeStyle: 'short'
  });
}

// Statische Elemente mit data-i18n / data-i18n-title übersetzen
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
}
