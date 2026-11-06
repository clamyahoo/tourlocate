# Tourlocate

Tourlocate ist ein einfaches, clientseitiges Web-Tool, um Reise- und Tourenberichte auf einer Karte darzustellen: Doppelklick auf die Karte genügt, um eine nummerierte Station anzulegen, mit Name, Bild und Link zu versehen und automatisch mit den anderen Stationen zu einer Route zu verbinden. Die fertige Tour lässt sich als GeoJSON, GPX oder als eigenständige HTML-Datei exportieren, die auch offline und ohne Internetverbindung funktioniert.

Es gibt keinen Build-Schritt und keine Abhängigkeiten außerhalb des Browsers — die Seite besteht fast vollständig aus reinem HTML/CSS/JavaScript (ES-Module) und lädt alle Bibliotheken über CDN. Einzige Ausnahme ist der WebDAV/Nextcloud-Import (siehe unten), der ein kleines PHP-Skript auf dem Server voraussetzt.

## Funktionen

- **Stationen anlegen**: Doppelklick oder Rechtsklick auf die Karte (mobil: Tippen bzw. langes Drücken); ein Dialog fragt Bezeichnung, Link (mit optionaler Beschriftung) und ein Bild ab.
- **Automatisches Routing**: Die Stationen werden per OSRM (FOSSGIS-Instanz) verbunden — wahlweise als echte Route, als Luftlinie, entlang einer importierten GPX-Aufzeichnung („Aufgezeichnete Strecke") oder ganz ohne Verbindung; das Routing-Profil ist zwischen Auto, Rad und zu Fuß umschaltbar. Die Gesamtdistanz wird live angezeigt.
- **Bilder**: Fotos werden beim Anhängen automatisch verkleinert (Qualitätsstufe wählbar), HEIC-Dateien werden nach JPEG konvertiert. Anklicken eines Bildes öffnet eine Lightbox.
- **Sortierung**: Stationen lassen sich nach Name oder Anlage-/Aufnahmedatum auf- oder absteigend ordnen.
- **Import/Export**:
  - **GeoJSON** — vollständiger Export inkl. Bildern, Links und Datum; auf der Seite wieder importierbar.
  - **GPX** — kompatibel mit Komoot & Co. (Track + Wegpunkte mit Zeitstempel); beim Import wird eine reine Track-Aufzeichnung als „Aufgezeichnete Strecke" übernommen.
  - **Ein-Datei-HTML** — ein eigenständiges HTML-Dokument mit eingebetteter Karte, das auch ganz ohne Internetverbindung funktioniert (der zuletzt sichtbare Kartenausschnitt wird als Bild mit eingebettet).
  - **HTML + Bilder (ZIP)** — wie oben, aber die Bilder liegen als einzelne JPEG-Dateien in einem Ordner statt eingebettet zu sein (sinnvoll bei großen Touren); die JPEGs erhalten dabei EXIF-Metadaten mit Stationsname, Datum und GPS-Position.
  - **IMS-Paket (Moodle)** — die Tour als IMS-Content-Package (offener Standard) für Moodle und andere Lernplattformen.
- **Foto-Import (lokal)**: Mehrere Fotos auf einmal per Dateiauswahl oder Drag & Drop auf die Karte ablegen — sie werden anhand ihrer GPS-Metadaten automatisch als Stationen platziert und nach Aufnahmedatum nummeriert. Unterstützt **JPEG und HEIC** (iPhone-Format), Fotos ohne Positionsdaten werden übersprungen. Läuft rein im Browser, ohne Server.
- **Unterwegs / eigener Standort**: Ein Knopf zeigt den **eigenen Standort** als blauen Punkt mit Genauigkeitskreis auf der Karte (Browser-Ortung, nur über HTTPS). Zusätzlich lässt sich direkt **ein Foto vom aktuellen Standort aufnehmen** — die Station wird an der per GPS ermittelten Live-Position angelegt (umgeht so den häufigen Verlust der EXIF-GPS-Daten beim Weitergeben von Fotos).
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

## User-Version (`/app`)

Neben der statischen App gibt es unter `/app/` eine Mehrbenutzer-Version mit Konten (in Betrieb, wird weiterentwickelt). Sie nutzt denselben Karten-/Editor-Code wie die statische App, speichert die Daten aber serverseitig (PHP + SQLite) und bietet darüber hinaus:

- **Konten & Präsentationen**: Registrierung/Login, Touren serverseitig speichern und im Editor bearbeiten; Bilder werden hochgeladen und automatisch auf ~200 KB verkleinert.
- **Teilen-Links**: öffentliche, optional passwortgeschützte Links auf eine Nur-Ansicht der Tour — kein Konto beim Empfänger nötig.
- **Live-Standort teilen**: den eigenen Standort über einen öffentlichen Link live mitteilen (wählbare Laufzeit, jederzeit abschaltbar, verlängerbar; der Punkt wird als „potentiell veraltet" markiert, wenn keine Updates mehr kommen). Nutzt die Browser-Ortung und läuft, solange die Tourlocate-Seite im Vordergrund ist; ein optionaler Bildschirm-Wachhalter (Wake-Lock) verhindert das automatische Sperren.
- **Dauerhafte WebDAV-/Nextcloud-Verbindung**: ein hinterlegter Ordner ergänzt neue Fotos automatisch als Stationen (per Cron, siehe unten).
- **Registrierungssteuerung**: offen / nur per Einladung / geschlossen; Admins können Einladungen und Konten anlegen.
- **Kontosicherheit**: Passwort ändern (Selfservice + Admin-Reset), Passwort-Richtlinie, optional Zwei-Faktor-Authentifizierung (TOTP).
- **Moderation**: Admin-Bereich mit Nutzerverwaltung, Audit-Log und einem „Inhalt melden"-Link in der öffentlichen Ansicht.

Details zu Architektur und Sicherheitsmodell in [app/DESIGN.md](app/DESIGN.md).

**Zusätzliche Voraussetzungen** (nur für die User-Version; die statische App bleibt davon unberührt):

- PHP-Erweiterungen **`php-sqlite3`**, **`php-gd`**, **`php-exif`** und **`php-sodium`** (unter Ubuntu/Debian: `sudo apt install php-sqlite3 php-gd php-exif php-sodium`; `php-exif` und `php-sodium` sind oft schon in `php-cli`/`php-fpm` enthalten). `sodium` wird für die verschlüsselte Ablage der WebDAV-Zugangsdaten und der 2FA-Secrets gebraucht.
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

Statt PHP-Erweiterungen manuell zu installieren, kann die User-Version als fertiges Docker-Image gebaut werden (Basis: `php:8.3-apache`) — `php-sqlite3`, `php-gd`, `php-exif` und `sodium` sind darin bereits enthalten, ebenso ein eingebauter Cron für den WebDAV-Poller. Die statische App (`index.html`, `js/`) läuft im selben Container automatisch mit.

```bash
docker compose up -d --build
```

Danach ist die Seite unter `http://localhost:8080/` (statische App) bzw. `http://localhost:8080/app/` (User-Version) erreichbar. Details:

- **Persistenz**: Das Volume `tourlocate_data` (→ `app/data/` im Container) enthält die SQLite-Datenbank, alle hochgeladenen Bilder **und** den beim ersten Start automatisch erzeugten Verschlüsselungsschlüssel für die WebDAV-Passwörter. Dieses Volume niemals löschen, sonst sind Konten, Präsentationen und gespeicherte WebDAV-Zugangsdaten unwiderruflich weg.
- **Erster Admin**: nach dem ersten Registrieren im Container ausführen: `docker compose exec tourlocate php app/make-admin.php deine@mail.de`.
- **Hinter einem Reverse-Proxy mit HTTPS** (empfohlen) läuft `TOURLOCATE_COOKIE_SECURE=true` (Standard in `docker-compose.yml`) problemlos. Läuft der Container (nur zum Testen) ohne HTTPS davor, auf `"false"` setzen — sonst verwirft der Browser den Session-Cookie und der Login funktioniert nicht.
- **In Portainer**: unter „Stacks" → „Add stack" → „Web editor" den Inhalt von `docker-compose.yml` einfügen (Build-Kontext muss dabei auf das Repo zeigen, z. B. über „Repository" statt „Web editor" direkt aus Git deployen) und den Stack starten.
- **`webdav-proxy.php`** (die ältere, proxy-basierte WebDAV-Anbindung der statischen App) funktioniert im Container ebenfalls, ganz ohne Zusatzkonfiguration — `php-curl` ist im Image enthalten.

### E-Mail-Versand (optional, für „Passwort vergessen")

Für die Selfservice-Funktion „Passwort vergessen" muss ein **SMTP-Zugang** hinterlegt werden — am besten ein **Transaktions-Mail-Dienst / SMTP-Relay** (gute Zustellbarkeit); nicht direkt von der VPS-IP senden. Ohne Konfiguration ist die Funktion einfach inaktiv (das Formular antwortet trotzdem neutral, verrät also nicht, ob eine Adresse existiert).

Drei gleichwertige Konfigurationswege (erster nicht-leerer gewinnt in dieser Reihenfolge):

1. **Admin-Bereich → „E-Mail-Versand (SMTP)"** (empfohlen): Host/Port/Verschlüsselung/Benutzer/Passwort/Absender/Basis-URL im Browser eintragen, mit „Testmail an mich senden" prüfen. Die Werte liegen in der Datenbank (persistentes Volume, überleben Deploys), das **Passwort wird verschlüsselt** gespeichert (sodium).
2. **Umgebungsvariablen** (`docker-compose.yml` / Portainer → „Environment variables"): `TOURLOCATE_SMTP_HOST`, `_PORT` (587 STARTTLS / 465 SSL), `_USER`, `_PASS`, `_FROM`, `_FROM_NAME`, `_SECURE` (`tls`/`ssl`/`none`), `TOURLOCATE_BASE_URL`.
3. **`app/api/config.php`**: dieselben Werte als `smtp_*` / `base_url`.

Der Reset-Link ist eine Stunde gültig und nur einmal verwendbar; die Tokens liegen nur als Hash in der Datenbank.

## Architektur

Der komplette Programmcode liegt in `js/` als ES-Module, eingebunden über `<script type="module" src="js/main.js">` in `index.html`:

| Datei | Verantwortung |
|---|---|
| `main.js` | Einstiegspunkt, initialisiert Karte, POIs, UI und Import/Export |
| `map-config.js` | Konstanten: Kartenansicht, Layer, Routing-Profile, Bildqualitäten |
| `map-settings.js` | Nutzereinstellungen (Sprache, Routing, Bildqualität, WebDAV-Zugangsdaten) mit localStorage |
| `map-i18n.js` | Alle Oberflächentexte auf Deutsch/Englisch |
| `map-core.js` | Grundkarte, Layer-Steuerung, Routing-Logik, eigener Standort, Track-Modus |
| `map-pois.js` | Stationen anlegen, nummerieren, sortieren, Erstellungsgesten |
| `map-ui.js` | Seitenleiste, Anlegen-/Bearbeiten-Dialog, Lightbox, Hilfe, Dateiauswahl, Foto vom Standort |
| `map-io.js` | GeoJSON-/GPX-Import und -Export, Ein-Datei-HTML-, ZIP- und IMS-Export |
| `map-exif.js` | Lesen und Schreiben von EXIF-Metadaten (GPS, Datum) in JPEG-/HEIC-Dateien |
| `map-photos.js` | Lokaler Foto-Import (Dateiauswahl/Drag & Drop) mit EXIF-Platzierung |
| `map-webdav.js` | Import von Bildern aus einem WebDAV-/Nextcloud-Ordner (spricht mit `webdav-proxy.php`) |
| `map-utils.js` | Allgemeine Helfer: Dateizugriff, Bildverarbeitung, Downloads, ZIP-Erzeugung |

Einzige Ausnahme von „alles ist statisches JS" ist **`webdav-proxy.php`** im Wurzelverzeichnis: Browser dürfen aus Sicherheitsgründen (CORS) keine Anfragen an einen fremden WebDAV-Server schicken. Das PHP-Skript läuft auf demselben Server wie Tourlocate und reicht die Anfrage serverseitig weiter (dafür gilt CORS nicht) — enthält außerdem Schutzmaßnahmen gegen Missbrauch als offenen Proxy (nur https-Ziele, keine privaten/internen Adressen, Zeit- und Größenlimits).

Die **User-Version** unter `app/` baut auf denselben `js/`-Modulen auf (der Editor bindet sie ein und schaltet per Hook auf serverseitiges Speichern/Hochladen um) und ergänzt eigenen Servercode: ein PHP-API unter `app/api/` (PDO/SQLite, Auth/CSRF, Teilen-Links, Uploads, 2FA, WebDAV), die öffentlichen Seiten `app/view.php` (Tour-Ansicht) und `app/verfolgen.php` (Live-Standort) sowie `app/live-share.js` für das Standort-Teilen. Details dazu in [app/DESIGN.md](app/DESIGN.md).

Es gibt keinen Bundler, keinen Transpiler und kein Test-Framework — Änderungen werden manuell im Browser geprüft. Weitere Details zu Architektur-Entscheidungen und Konventionen stehen in [CLAUDE.md](CLAUDE.md).

## Verwendete Bibliotheken

[Leaflet](https://leafletjs.com/), [Leaflet Routing Machine](https://github.com/perliedman/leaflet-routing-machine), [Leaflet Control Geocoder](https://github.com/perliedman/leaflet-control-geocoder), [@tmcw/togeojson](https://github.com/placemark/togeojson), [heic2any](https://github.com/alexcorvi/heic2any) — alle über jsDelivr eingebunden, keine lokale Installation nötig. Die User-Version nutzt zusätzlich [qrcode](https://github.com/soldair/node-qrcode) (QR-Code bei der 2FA-Einrichtung).

## Lizenz

Siehe [LICENSE](LICENSE) (GNU GPLv3).
