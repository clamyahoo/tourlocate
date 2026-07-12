# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Tourlocate is a static, no-build, client-side web app for planning a tour: double-click (mobile: tap/long-press) the map to drop numbered POIs ("Stationen"), the app auto-routes between them (OSRM via Leaflet Routing Machine), and the tour can be exported/imported as GeoJSON, GPX, or a single self-contained HTML file that works offline. Everything is plain HTML/CSS/JS (ES modules) loaded from CDNs (jsDelivr) — there is no `package.json`, bundler, linter, or test suite.

Key runtime libraries (all via pinned CDN URLs in `index.html`): Leaflet 1.9.4, Leaflet Routing Machine 3.2.12, Leaflet Control Geocoder, `@tmcw/togeojson` 5.8.1 (GPX→GeoJSON; its UMD global is lowercase `togeojson`), `heic2any` 0.0.4 (HEIC→JPEG conversion).

## Running the app

No build step, but ES modules require http (not `file://`):

```
python3 -m http.server 8000
```

There is no test or lint command. Verify changes manually in the browser (see Verification notes below).

## Architecture

`index.html` loads the CDN libs with `defer`, then `<script type="module" src="js/main.js">` — modules run after the deferred scripts, so the global `L` is available at module evaluation time (`map-config.js` depends on this; keep the script order).

**`js/main.js`** — entry point: `initMap()` → `setupPOIs(map)` → `setupUI(map)` → `setupIO(map)`. The `map` object is the app's shared state container; `initMap()` attaches:
- `map.markersLayer`, `map.routeLayer`, `map.routingControl`
- `map.state = { pois, routeCoords, activeBase }` — **`pois` is the source of truth** (`[{lat, lng, name, link, img, marker}]`, `img` is a base64 JPEG data URL); markers are only the view. All ordering/CRUD goes through this array.
- `map.onPoisChanged` — hook set by `map-ui.js` to refresh toolbar button states; called from `renumberAndRoute()`.

Modules and their responsibilities:
- **`map-config.js`** — constants only: default view, tile layers (OSM/CyclOSM/OpenTopo/EOX-Sentinel-2-Satellit — all freely licensed by deliberate choice, the EOX layer is CC BY-NC-SA; all with `crossOrigin:'anonymous'` — required so export can draw tiles to a canvas), `ROUTING_PROFILES` (FOSSGIS OSRM at routing.openstreetmap.de: car/bike/foot — the project-osrm demo server only offers driving), CDN URLs for export inlining, `IMG_QUALITIES` presets.
- **`map-settings.js`** — user settings (`lang`, `lineMode`, `profile`, `imgQuality`) via `getSetting`/`setSetting`, persisted in localStorage with defaults; wrapped in try/catch for private-mode browsers.
- **`map-i18n.js`** — all UI strings (de/en), `t(key, vars)`, `formatDateTime`, `applyI18n()` (translates elements with `data-i18n`/`data-i18n-title` attributes). **Every user-facing string must go through `t()`** and exist in both languages; static HTML gets `data-i18n` attributes.
- **`map-core.js`** — `initMap()`, `setRouteWaypoints(map)` (honors `lineMode`: 'route' → OSRM, 'straight' → haversine polyline, 'none' → nothing; <2 POIs clears), `applyRoutingSettings(map)` (rebuilds the routing control after a profile change), `renderRouteInfo(map)` (re-renders distance from `state.lastKm`, e.g. after language switch), `fitToMarkers(map)`. The `routesfound` handler ignores late responses when `lineMode` is no longer 'route'.
- **`map-pois.js`** — `createPoi()` (shared factory for interactive creation AND import — always create POIs through it; stamps `createdAt` ISO timestamp), `bindPoiPopup()`, `renumberAndRoute()`, `removePoi`/`removeLastPoi`/`clearPois`, `sortPois(map, 'name'|'date', 'asc'|'desc')`, `setupPOIs()` (creation gestures: desktop dblclick/right-click, mobile tap/long-press via `L.Browser.mobile`).
- **`map-ui.js`** — `openPoiDialog(map, p, 'create'|'edit')` (the one shared form: name, link, link label, image preview/pick/delete, save, cancel/delete-station), sidebar wiring (collapsible `<aside id="sidebar">` with `<details>` sections; toggle state persists via the `sidebar` setting; `map.invalidateSize()` after toggling), sort/line-mode/profile/image-quality/language controls, WebDAV credential fields + import button, fullscreen, help overlay, lightbox (`openLightbox`), persistent file picker (`pickImage`). `#routeinfo` is a floating pill over the map (also used as progress display during exports/WebDAV import).
- **`map-exif.js`** — dependency-free JPEG EXIF reader (`readExif`: GPS + DateTimeOriginal, both byte orders — camera files are usually big-endian "MM") and writer (`writeExif`: builds a spec-compliant little-endian APP1 segment with GPS/date/description plus the EXIF-mandated base tags; heap values are word-aligned). Canvas re-encoding strips EXIF, so the ZIP export re-stamps images via `writeExif`.
- **`map-webdav.js`** — `importFromWebdav(map, onProgress)`: PROPFIND folder listing (namespace-aware DAV: parsing), GET per image, `readExif` for GPS/date, skips photos without GPS, creates POIs through `createPoi`, then sorts by capture date (`sortPois('date','asc')`) and fits bounds. Basic-Auth from the `webdav*` settings (UTF-8-safe btoa). Browser CORS applies: works only same-origin or when the server sends CORS headers — `webdavErrorMessage` maps failures to translated hints.
- **`map-io.js`** — `setupIO()`, GeoJSON builder (with `createdAt`/`linkText` properties), Komoot-compatible GPX builder (`<metadata>`, `<time>` **before** `<name>` in `<wpt>` per GPX schema, route as `<trk>`), imports (both funnel through `importFeatures` → `createPoi`; GPX `<time>` restores `createdAt`), the offline-capable HTML export (`captureMapSnapshot` + `fetchLeafletAssets` + `buildExportHtml`) in two flavors: single file (images inline as base64) or ZIP with a `bilder/` folder (images as separate JPEGs stamped with EXIF GPS/date/name via `writeExif`, HTML references relative paths). Export filenames carry the date (`tourlocate-YYYY-MM-DD.*`).
- **`map-utils.js`** — generic helpers: `readFileAsText`, `fileToDataURL` (HEIC conversion + 3-tier decode + downscale), `triggerBlobDownload` (with DuckDuckGo workaround; binary blobs like ZIP use a blob:-URL tap-link there), `haversineKm`, `dataURLToBytes`, `buildZipBlob` (minimal store-only ZIP writer — deliberate: no external lib, JPEGs are already compressed), `escapeHtml`/`escapeXml`.

There is one intentional import cycle: `map-pois.js` ↔ `map-ui.js` (POIs need `openPoiDialog`/`openLightbox`, UI needs POI CRUD). Safe because all cross-calls happen at event time, after both modules are loaded.

## Critical patterns — do not regress these

- **Popup content must be DOM elements with handlers attached at build time** (see `bindPoiPopup`, `openPoiDialog`). Leaflet's `bindPopup` reuses the popup instance and swaps content in place **without firing `popupopen`**, so popupopen-based (re)binding of buttons silently breaks — this was the historical "Bearbeiten reagiert nicht" bug. Never switch popup content back to HTML strings + `popupopen` wiring.
- **Dialog lifecycle** (`openPoiDialog`): the popup gets a `_tlDialog` flag so `renumberAndRoute()` won't replace an open dialog; `bindPoiPopup` clears the flag. The `popupclose` listener (create: remove fresh POI; edit: restore view popup) is attached **after** `openPopup()` — attaching before would fire it when `openPopup` closes the marker's previous popup. `save()` detaches it before rebinding.
- **Exactly one binding site per button, assigned via `onclick`** (idempotent), so the `pageshow`/`visibilitychange` re-binding (DuckDuckGo/bfcache robustness) can't double-fire downloads. The old code's `addEventListener` double-binding caused two downloads per export click.
- **Single-file HTML export**: payload goes in `<script type="application/json" id="tl-data">` with every opening angle bracket JSON-escaped as unicode escape u003c (prevents premature `</script>` termination); Leaflet js/css are fetched from the (cached) CDN URLs and inlined, with CDN `<script src>` fallback; the map snapshot is an `L.imageOverlay` in a custom pane at z-index 150 — *below* the tile pane (200), so live tiles cover it online and it shows through offline. No online-detection logic; keep it that way.
- **Downloads** must go through `triggerBlobDownload` (handles the DuckDuckGo WebView, which blocks programmatic anchor clicks). Images must go through `pickImage` + `fileToDataURL` (persistent input + value reset is a DuckDuckGo workaround; HEIC conversion lives there).
- OSRM demo server is rate-limited/flaky: `routingerror` shows a message instead of failing silently; the HTML export falls back to straight lines between POIs when `state.routeCoords` is empty.

## Conventions

- UI copy and code comments are in German; keep new user-facing strings and comments consistent with that.
- No CSS framework — `css/style.css` is a small hand-written stylesheet; layout-critical rules for the full-height map live inline in `index.html`'s `<head>`.
- External libraries are pinned by exact version in CDN URLs — when adding a library, follow the same pattern rather than introducing a package manager. When bumping Leaflet, also update `CDN` in `map-config.js` (export inlining) and the version referenced by the export fallback.

## Verification notes

Serve via `python3 -m http.server 8000`, open with DevTools console (should stay clean except the known OSRM demo-server warning). Core flows: create POI (dblclick) → dialog → save → popup "1. Name" with working Bearbeiten; second POI → route + "Gesamt: X.X km"; cancel/ESC during creation removes the marker; image attach shows preview in dialog, thumb in popup, lightbox on click; exports produce exactly one download each; GeoJSON re-import restores names/links/images and fits bounds; exported HTML must render standalone from `file://` and show the embedded snapshot when offline (DevTools → Network → Offline). Mobile gestures (`L.Browser.mobile` branch), real HEIC files, marker dragging, and DuckDuckGo downloads need a real device/browser to test.

## History

The repo previously contained several parallel implementations (`old/` monolith — the pre-2026-07 live version — plus `modular_orig/`, `modular_dev/`, `modular_dev2/`, `js_original/` snapshots). They were removed when the modular rewrite reached full feature parity; recover them from git history if ever needed.
