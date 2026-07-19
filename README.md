# Tourlocate

Tourlocate ist ein einfaches, clientseitiges Web-Tool, um Reise- und Tourenberichte auf einer Karte darzustellen: Doppelklick auf die Karte genügt, um eine nummerierte Station anzulegen, mit Name, Bild und Link zu versehen und automatisch mit den anderen Stationen zu einer Route zu verbinden. Die fertige Tour lässt sich als GeoJSON, GPX oder als eigenständige HTML-Datei exportieren, die auch offline und ohne Internetverbindung funktioniert.

Es gibt keinen Build-Schritt und keine Abhängigkeiten außerhalb des Browsers — die Seite besteht fast vollständig aus reinem HTML/CSS/JavaScript (ES-Module) und lädt alle Bibliotheken über CDN. Einzige Ausnahme ist der WebDAV/Nextcloud-Import (siehe unten), der ein kleines PHP-Skript auf dem Server voraussetzt.

## Funktionen

- **Stationen anlegen**: Doppelklick oder Rechtsklick auf die Karte (mobil: Tippen bzw. langes Drücken); ein Dialog fragt Bezeichnung, Link (mit optionaler Beschriftung) und ein Bild ab.
- **Automatisches Routing**: Die Stationen werden per OSRM (FOSSGIS-Instanz) verbunden — wahlweise als echte Route, als Luftlinie oder ganz ohne Verbindung; das Routing-Profil ist zwischen Auto, Rad und zu Fuß umschaltbar. Die Gesamtdistanz wird live angezeigt.
- **Bilder**: Fotos werden beim Anhängen automatisch verkleinert (Qualitätsstufe wählbar), HEIC-Dateien werden nach JPEG konvertiert. Anklicken eines Bildes öffnet eine Lightbox.
- **Sortierung**: Stationen lassen sich nach Name oder Anlage-/Aufnahmedatum auf- oder absteigend ordnen.
- **Import/Export**:
  - **GeoJSON** — vollständiger Export inkl. Bildern, Links und Datum; auf der Seite wieder importierbar.
  - **GPX** — kompatibel mit Komoot & Co. (Track + Wegpunkte mit Zeitstempel).
  - **Ein-Datei-HTML** — ein eigenständiges HTML-Dokument mit eingebetteter Karte, das auch ganz ohne Internetverbindung funktioniert (der zuletzt sichtbare Kartenausschnitt wird als Bild mit eingebettet).
  - **HTML + Bilder (ZIP)** — wie oben, aber die Bilder liegen als einzelne JPEG-Dateien in einem Ordner statt eingebettet zu sein (sinnvoll bei großen Touren); die JPEGs erhalten dabei EXIF-Metadaten mit Stationsname, Datum und GPS-Position.
- **Foto-Import (lokal)**: Mehrere Fotos auf einmal per Dateiauswahl oder Drag & Drop auf die Karte ablegen — sie werden anhand ihrer GPS-Metadaten automatisch als Stationen platziert und nach Aufnahmedatum nummeriert. Unterstützt **JPEG und HEIC** (iPhone-Format), Fotos ohne Positionsdaten werden übersprungen. Läuft rein im Browser, ohne Server.
- **WebDAV/Nextcloud-Import**: Ein WebDAV-Ordner (z. B. ein Nextcloud-Album) lässt sich als Bildquelle hinterlegen. Beim Import werden alle Fotos geladen, anhand ihrer GPS-Metadaten automatisch als Stationen platziert und nach Aufnahmedatum nummeriert. **Benötigt PHP-fähiges Hosting** (siehe Abschnitt „Voraussetzungen" unten); ohne PHP funktioniert der Rest der Seite unverändert, nur dieser Import steht dann nicht zur Verfügung.
- **Kartenlayer**: OpenStreetMap, CyclOSM und OpenTopoMap (alle CC-BY-SA) sowie ein Satellitenlayer (Sentinel-2 cloudless von EOX, CC BY-NC-SA — nur für nicht-kommerzielle Nutzung). Es kommen bewusst keine proprietär lizenzierten Kartenanbieter zum Einsatz.
- **Zweisprachig**: Die komplette Oberfläche ist auf Deutsch und Englisch verfügbar (Umschalter in der Seitenleiste).
- **Sonstiges**: Vollbildmodus, eingebaute Hilfe (u. a. mit Hinweisen für iPhone/iPad-Nutzung), Undo/Alles-löschen.

## Verwendung

Die Seite braucht immer einen einfachen HTTP-Server (ES-Module funktionieren nicht über `file://`):

```bash
python3 -m http.server 8000
```

Anschließend `http://localhost:8000/` im Browser öffnen. Für alle Funktionen außer dem WebDAV-Import reicht das bereits aus.

**Für den WebDAV/Nextcloud-Import** wird zusätzlich PHP benötigt (siehe „Voraussetzungen" unten) — lokal zum Testen statt des Python-Servers z. B. PHPs eingebauten Server verwenden:

```bash
php -S localhost:8000
```

### Voraussetzungen für den WebDAV-Import

Nur relevant, wenn Bilder automatisch aus einem WebDAV-/Nextcloud-Ordner importiert werden sollen (`webdav-proxy.php`). Der Rest der Seite ist komplett statisch und läuft auf jedem Webspace, auch ohne diese Voraussetzungen.

- **PHP** auf dem Webhosting (nahezu jedes klassische Webhosting bringt das mit).
- Die **PHP-cURL-Erweiterung** muss aktiviert sein (`php-curl`, ebenfalls Standard bei den meisten Hostern; im Zweifel beim Provider nachfragen oder testweise die WebDAV-Import-Funktion ausprobieren — bei fehlender Erweiterung erscheint eine Fehlermeldung statt eines stillen Fehlschlags).
- `webdav-proxy.php` muss zusammen mit den übrigen Dateien im selben Verzeichnis wie `index.html` hochgeladen sein.
- Der in `webdav-proxy.php` und `js/map-config.js` hinterlegte `PROXY_KEY` sollte vor dem produktiven Einsatz in beiden Dateien auf einen eigenen, zufälligen Wert geändert werden (siehe Kommentare in beiden Dateien).

## User-Version (`/app`, in Entwicklung)

Neben der statischen App entsteht unter `/app/` eine Mehrbenutzer-Version mit Konten: Präsentationen serverseitig speichern, Bilder hochladen (automatisch auf ~200 KB verkleinert), öffentliche Teilen-Links mit Passwortschutz und eine dauerhafte WebDAV-/Nextcloud-Verbindung, die neue Fotos automatisch als Stationen ergänzt. Details in [app/DESIGN.md](app/DESIGN.md).

**Zusätzliche Voraussetzungen** (nur für die User-Version; die statische App bleibt davon unberührt):

- PHP-Erweiterungen **`php-sqlite3`**, **`php-gd`** und **`php-exif`** (unter Ubuntu/Debian: `sudo apt install php-sqlite3 php-gd php-exif`; `php-exif` ist oft schon in `php-cli`/`php-fpm` enthalten).
- Einmalig `app/api/config.sample.php` nach `app/api/config.php` kopieren und die Werte anpassen (Schlüssel erzeugen mit `php -r "echo bin2hex(random_bytes(32));"`). `config.php` und das Datenverzeichnis `app/data/` gehören nicht ins Repo.
- Für den automatischen Cloud-Import einen **Cron-Job** einrichten, der den Poller alle paar Minuten aufruft — per Crontab (`crontab -e`):

  ```
  */5 * * * * php /pfad/zu/tourlocate/app/cron/poll-webdav.php
  ```

  Alternativ als systemd-Timer (`systemctl edit --force --full tourlocate-webdav.timer`):

  ```ini
  # /etc/systemd/system/tourlocate-webdav.service
  [Unit]
  Description=Tourlocate WebDAV-Import

  [Service]
  Type=oneshot
  ExecStart=/usr/bin/php /pfad/zu/tourlocate/app/cron/poll-webdav.php

  # /etc/systemd/system/tourlocate-webdav.timer
  [Unit]
  Description=Tourlocate WebDAV-Import alle 5 Minuten

  [Timer]
  OnBootSec=2min
  OnUnitActiveSec=5min

  [Install]
  WantedBy=timers.target
  ```

  Danach aktivieren mit `sudo systemctl enable --now tourlocate-webdav.timer`.
- In der Cloud (z. B. Nextcloud: Einstellungen → Sicherheit) ein **App-Passwort** erzeugen und dieses im Editor hinterlegen — nie das Konto-Passwort. Es wird auf dem Server verschlüsselt gespeichert, muss aber für den Cron entschlüsselbar bleiben; ein App-Passwort lässt sich im Zweifel einzeln widerrufen.
- Nach dem ersten Start ein Konto registrieren und es auf dem Server per Kommandozeile zum Admin machen (Nutzerverwaltung/Moderation, siehe `app/admin.php`):

  ```bash
  php app/make-admin.php deine@mail.de
  ```

### Als Docker-Container (Alternative zur manuellen Installation)

Statt PHP-Erweiterungen manuell zu installieren, kann die User-Version als fertiges Docker-Image gebaut werden — `php-sqlite3`, `php-gd`, `php-exif` und `sodium` sind darin bereits enthalten, ebenso ein eingebauter Cron für den WebDAV-Poller. Die statische App (`index.html`, `js/`) läuft im selben Container automatisch mit.

```bash
docker compose up -d --build
```

Danach ist die Seite unter `http://localhost:8080/` (statische App) bzw. `http://localhost:8080/app/` (User-Version) erreichbar. Details:

- **Persistenz**: Das Volume `tourlocate_data` (→ `app/data/` im Container) enthält die SQLite-Datenbank, alle hochgeladenen Bilder **und** den beim ersten Start automatisch erzeugten Verschlüsselungsschlüssel für die WebDAV-Passwörter. Dieses Volume niemals löschen, sonst sind Konten, Präsentationen und gespeicherte WebDAV-Zugangsdaten unwiderruflich weg.
- **Erster Admin**: nach dem ersten Registrieren im Container ausführen: `docker compose exec tourlocate php app/make-admin.php deine@mail.de`.
- **Hinter einem Reverse-Proxy mit HTTPS** (empfohlen) läuft `TOURLOCATE_COOKIE_SECURE=true` (Standard in `docker-compose.yml`) problemlos. Läuft der Container (nur zum Testen) ohne HTTPS davor, auf `"false"` setzen — sonst verwirft der Browser den Session-Cookie und der Login funktioniert nicht.
- **In Portainer**: unter „Stacks" → „Add stack" → „Web editor" den Inhalt von `docker-compose.yml` einfügen (Build-Kontext muss dabei auf das Repo zeigen, z. B. über „Repository" statt „Web editor" direkt aus Git deployen) und den Stack starten.
- **`webdav-proxy.php`** (die ältere, proxy-basierte WebDAV-Anbindung der statischen App) funktioniert im Container ebenfalls, ganz ohne Zusatzkonfiguration — `php-curl` ist im Image enthalten.

## Architektur

Der komplette Programmcode liegt in `js/` als ES-Module, eingebunden über `<script type="module" src="js/main.js">` in `index.html`:

| Datei | Verantwortung |
|---|---|
| `main.js` | Einstiegspunkt, initialisiert Karte, POIs, UI und Import/Export |
| `map-config.js` | Konstanten: Kartenansicht, Layer, Routing-Profile, Bildqualitäten |
| `map-settings.js` | Nutzereinstellungen (Sprache, Routing, Bildqualität, WebDAV-Zugangsdaten) mit localStorage |
| `map-i18n.js` | Alle Oberflächentexte auf Deutsch/Englisch |
| `map-core.js` | Grundkarte, Layer-Steuerung, Routing-Logik |
| `map-pois.js` | Stationen anlegen, nummerieren, sortieren, Erstellungsgesten |
| `map-ui.js` | Seitenleiste, Anlegen-/Bearbeiten-Dialog, Lightbox, Hilfe, Dateiauswahl |
| `map-io.js` | GeoJSON-/GPX-Import und -Export, Ein-Datei-HTML- und ZIP-Export |
| `map-exif.js` | Lesen und Schreiben von EXIF-Metadaten (GPS, Datum) in JPEG-Dateien |
| `map-webdav.js` | Import von Bildern aus einem WebDAV-/Nextcloud-Ordner (spricht mit `webdav-proxy.php`) |
| `map-utils.js` | Allgemeine Helfer: Dateizugriff, Bildverarbeitung, Downloads, ZIP-Erzeugung |

Einzige Ausnahme von „alles ist statisches JS" ist **`webdav-proxy.php`** im Wurzelverzeichnis: Browser dürfen aus Sicherheitsgründen (CORS) keine Anfragen an einen fremden WebDAV-Server schicken. Das PHP-Skript läuft auf demselben Server wie Tourlocate und reicht die Anfrage serverseitig weiter (dafür gilt CORS nicht) — enthält außerdem Schutzmaßnahmen gegen Missbrauch als offenen Proxy (nur https-Ziele, keine privaten/internen Adressen, Zeit- und Größenlimits).

Es gibt keinen Bundler, keinen Transpiler und kein Test-Framework — Änderungen werden manuell im Browser geprüft. Weitere Details zu Architektur-Entscheidungen und Konventionen stehen in [CLAUDE.md](CLAUDE.md).

## Verwendete Bibliotheken

[Leaflet](https://leafletjs.com/), [Leaflet Routing Machine](https://github.com/perliedman/leaflet-routing-machine), [Leaflet Control Geocoder](https://github.com/perliedman/leaflet-control-geocoder), [@tmcw/togeojson](https://github.com/placemark/togeojson), [heic2any](https://github.com/alexcorvi/heic2any) — alle über jsDelivr eingebunden, keine lokale Installation nötig.

## Lizenz

Siehe [LICENSE](LICENSE) (GNU GPLv3).
