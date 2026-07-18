# Tourlocate — User-Version (Design)

Dies ist ein **eigener, abgetrennter Bereich** neben der bestehenden statischen
App. Die statische App (`/index.html`, `/js/…`) bleibt vollständig unberührt und
funktioniert weiter ohne Server. Die User-Version liegt komplett unter `/app/`
und braucht ein PHP-Backend mit SQLite-Datenbank.

## Ziel

Angemeldete Nutzer können:
- Bilder hochladen und daraus eine Tour/**Präsentation** bauen (dieselbe Karte
  wie die statische App, wiederverwendeter Code aus `/js/`).
- Präsentationen **dauerhaft speichern** (server-seitig, dem Konto zugeordnet).
- Eine **WebDAV-Dauerverbindung** hinterlegen; ein **Cron-Job** holt alle paar
  Minuten neue Fotos aus dem Ordner und ergänzt die Präsentation automatisch.
- Einen **öffentlichen, passwortgeschützten Link** erzeugen, über den Bekannte
  die Präsentation nur ansehen (Reisebilder teilen).
- Die Verbindungsdarstellung folgt der Einstellung: **nichts / Linie / Route**
  (wie in der statischen App), pro Präsentation gespeichert.

## Stack

- **PHP** (matcht das bestehende Hosting; kein Framework, im schlanken Geist des
  Projekts) + **PDO/SQLite** (eine Datei, keine DB-Einrichtung).
- Frontend-Karte: Wiederverwendung der bestehenden ES-Module aus `/js/`.
- Kein Bundler, kein Composer-Zwang. Externe PHP-Abhängigkeiten werden
  vermieden; Krypto über die eingebaute `sodium`- bzw. `openssl`-Erweiterung.

## Verzeichnislayout

```
/app/
  DESIGN.md              (dieses Dokument)
  index.php              (Einstieg: Login / Registrierung / Dashboard-Redirect)
  dashboard.php          (Liste eigener Präsentationen, angemeldet)
  editor.php             (Präsentation bearbeiten — bindet /js-Karte ein)
  view.php               (öffentliche Ansicht via Share-Token + Passwort)
  api/
    bootstrap.php        (Session, Helfer, JSON-Antworten, CSRF, Auth-Guard)
    config.php           (Secrets — NICHT im Repo, siehe config.sample.php)
    config.sample.php    (Vorlage; wird zu config.php kopiert)
    db.php               (PDO-SQLite-Verbindung + Schema-Migration)
    crypto.php           (Verschlüsselung der WebDAV-Passwörter)
    auth.php             (register / login / logout / me)
    presentations.php    (list / get / save / delete)
    upload.php           (Bild-Upload zu einer Präsentation)
    image.php            (Bild ausliefern — Rechteprüfung: Owner ODER Share)
    share.php            (Share-Link erzeugen/aufheben; öffentliche Daten holen)
    webdav.php           (WebDAV-Verbindung speichern/testen/löschen)
  cron/
    poll-webdav.php      (per System-Cron; pollt aktive WebDAV-Verbindungen)
  data/                  (NICHT im Repo — .htaccess Deny; SQLite-DB + Uploads)
    tourlocate.sqlite
    uploads/<user>/<presentation>/<bild>.jpg
```

## Datenbank-Schema (SQLite)

```
users
  id            INTEGER PK
  email         TEXT UNIQUE NOT NULL
  password_hash TEXT NOT NULL          -- password_hash(), bcrypt
  created_at    TEXT NOT NULL

presentations
  id                  INTEGER PK
  user_id             INTEGER NOT NULL -> users.id
  title               TEXT NOT NULL
  line_mode           TEXT NOT NULL DEFAULT 'route'  -- none|straight|route
  profile             TEXT NOT NULL DEFAULT 'car'
  data_json           TEXT NOT NULL    -- POIs ohne Bilddaten (Bilder = Dateien)
  share_token         TEXT UNIQUE      -- NULL = nicht geteilt
  share_password_hash TEXT             -- NULL = ohne Passwort
  created_at          TEXT NOT NULL
  updated_at          TEXT NOT NULL

images
  id              INTEGER PK
  presentation_id INTEGER NOT NULL -> presentations.id
  user_id         INTEGER NOT NULL -> users.id
  filename        TEXT NOT NULL    -- relativ unter data/uploads/…
  lat             REAL
  lng             REAL
  taken_at        TEXT
  created_at      TEXT NOT NULL

webdav_connections
  id                 INTEGER PK
  user_id            INTEGER NOT NULL -> users.id
  presentation_id    INTEGER NOT NULL -> presentations.id  -- Ziel des Imports
  url                TEXT NOT NULL
  username           TEXT NOT NULL
  secret_cipher      BLOB NOT NULL    -- verschlüsseltes App-Passwort
  secret_nonce       BLOB NOT NULL
  active             INTEGER NOT NULL DEFAULT 1
  last_poll_at       TEXT
  last_error         TEXT
  seen_files_json    TEXT             -- schon importierte Datei-Pfade (Dedupe)
  created_at         TEXT NOT NULL
```

## Sicherheitsmodell

- **Passwörter**: `password_hash()` (bcrypt), `password_verify()`. Nie im
  Klartext, nie geloggt.
- **Sessions**: PHP-Sessions, Cookie `HttpOnly` + `SameSite=Lax` + `Secure`
  (unter HTTPS). Login-Guard `require_login()` für alle geschützten Endpunkte.
- **CSRF**: Token in der Session; zustandsändernde API-Aufrufe (POST) prüfen es.
- **SQL**: ausschließlich PDO-Prepared-Statements.
- **Uploads**: Größenlimit, MIME-/Bild-Validierung (`getimagesize`), zufällige
  Dateinamen, Ablage unter `data/uploads/` (per `.htaccess` kein Direktzugriff).
  Auslieferung nur über `image.php` mit Rechteprüfung (Owner-Session ODER
  gültiges Share-Token; bei passwortgeschütztem Share erst nach Passwort-OK).
- **WebDAV-Zugangsdaten für den Cron** (der heikelste Teil): Das WebDAV-Passwort
  muss der Cron entschlüsseln können, liegt also *reversibel verschlüsselt* auf
  dem Server (nicht nur gehasht). Verschlüsselung mit `sodium_crypto_secretbox`
  und einem Serverschlüssel aus `config.php` (außerhalb des Repos). **Dringende
  Empfehlung an den Nutzer: ein Nextcloud-App-Passwort verwenden** (einzeln
  widerrufbar, kein Zugriff auf das Hauptkonto). Wird in der UI deutlich
  hingewiesen. Der Serverschlüssel selbst liegt in `config.php`; bei Kompromiss
  des Servers sind die App-Passwörter entschlüsselbar — deshalb App-Passwörter.
- **Share-Links**: langes Zufalls-Token (`share_token`), optionales Passwort
  separat gehasht. Öffentliche Ansicht ist strikt nur-lesend; kein Zugriff auf
  Konto-/Editor-Funktionen ohne Session.

## Cron

System-Cron ruft alle paar Minuten `php /pfad/app/cron/poll-webdav.php` auf.
Das Skript geht alle `active` WebDAV-Verbindungen durch, listet den Ordner
(PROPFIND, wie im bestehenden `webdav-proxy.php` — Logik wird geteilt/portiert),
lädt neue (noch nicht in `seen_files_json` vermerkte) Bilder mit GPS, legt sie
als Bilder/POIs der Ziel-Präsentation an und aktualisiert `last_poll_at` /
`seen_files_json` / ggf. `last_error`. Läuft entkoppelt vom Browser des Nutzers.

## Umsetzungs-Reihenfolge (Scheiben)

1. **Fundament**: Verzeichnis, `config.sample.php`, `db.php` (Schema/Migration),
   `bootstrap.php`, `.gitignore`/`.htaccess`. → *diese Scheibe*
2. **Auth**: `auth.php` + Login-/Registrierungs-Seite. → *diese Scheibe*
3. **Präsentationen**: CRUD + Dashboard.
4. **Editor + Upload**: Karte aus `/js/` einbetten, Bild-Upload, Speichern,
   Verbindungsdarstellung (nichts/Linie/Route) mitspeichern.
5. **Öffentlicher Share-Link** mit Passwortschutz + `view.php`.
6. **WebDAV-Verbindung** speichern/testen + `crypto.php`.
7. **Cron-Poller** + Dedupe + Fehleranzeige im Dashboard.

Jede Scheibe wird einzeln getestet, bevor die nächste beginnt.
