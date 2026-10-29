#!/bin/bash
# Container-Start: Verschlüsselungsschlüssel + Konfiguration im
# persistenten Volume anlegen (falls noch nicht vorhanden), Rechte
# setzen, Cron starten, dann Apache im Vordergrund (PID 1).
set -e

APP_ROOT=/var/www/html
# Datenverzeichnis liegt AUSSERHALB des Web-Roots — so zeigt keine URL
# darauf (echte Tiefenverteidigung). Das Volume tourlocate_data wird hier
# eingehängt (siehe docker-compose.yml).
DATA_DIR=/var/lib/tourlocate
CONFIG_LIVE="$DATA_DIR/config.php"   # liegt im Volume, überlebt Neustarts
CONFIG_LINK="$APP_ROOT/app/api/config.php"

mkdir -p "$DATA_DIR"

# Config + Secret-Key EINMALIG erzeugen (nicht bei jedem Start neu —
# sonst werden gespeicherte WebDAV-Passwörter unentschlüsselbar).
if [ ! -f "$CONFIG_LIVE" ]; then
    echo "[entrypoint] Erzeuge config.php (neuer Secret-Key)…"
    KEY="$(php -r 'echo bin2hex(random_bytes(32));')"
    sed \
        -e "s/'secret_key_hex' => '.*',/'secret_key_hex' => '${KEY}',/" \
        -e "s/'cookie_secure' => true/'cookie_secure' => ${TOURLOCATE_COOKIE_SECURE:-true}/" \
        "$APP_ROOT/app/api/config.sample.php" > "$CONFIG_LIVE"
fi

# data_dir IMMER auf den absoluten externen Pfad setzen. Greift für neu
# erzeugte UND für migrierte Alt-Configs: deren Zeile war noch
# dirname(__DIR__).'/data' und hätte nach dem Verschieben auf das falsche
# Verzeichnis gezeigt (PHP löst __DIR__ zum realen Symlink-Ziel auf).
sed -i "s|'data_dir' => .*,|'data_dir' => '${DATA_DIR}',|" "$CONFIG_LIVE"

# api/config.php per ABSOLUTEM Symlink ins Volume (liegt außerhalb des
# Web-Roots; Code erwartet die Datei an dieser Stelle, api/db.php).
ln -sfn "$CONFIG_LIVE" "$CONFIG_LINK"

chown -R www-data:www-data "$DATA_DIR"

# WebDAV-Proxy-Schlüssel pro Deployment setzen (nur statische App unter /).
# KEIN echtes Secret — er steht im ausgelieferten JS; aber so nutzt jede
# Installation einen eigenen Wert statt des Standard-Platzhalters, was
# generische Scanner abblockt. Wert in BEIDEN Dateien gleich setzen
# (PHP-Proxy + map-config.js), damit sie zusammenpassen.
# Nur [A-Za-z0-9._-] verwenden (sonst bricht die sed-Ersetzung).
if [ -n "${TOURLOCATE_PROXY_KEY:-}" ]; then
    echo "[entrypoint] Setze WebDAV-Proxy-Schlüssel aus TOURLOCATE_PROXY_KEY…"
    sed -i "s|define('PROXY_KEY', '[^']*');|define('PROXY_KEY', '${TOURLOCATE_PROXY_KEY}');|" \
        "$APP_ROOT/webdav-proxy.php"
    sed -i "s|export const PROXY_KEY = '[^']*';|export const PROXY_KEY = '${TOURLOCATE_PROXY_KEY}';|" \
        "$APP_ROOT/js/map-config.js"
fi

# Cron als Daemon starten (forkt selbst, blockiert nicht)
cron

exec "$@"
