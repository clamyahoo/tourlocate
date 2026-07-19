#!/bin/bash
# Container-Start: Verschlüsselungsschlüssel + Konfiguration im
# persistenten Volume anlegen (falls noch nicht vorhanden), Rechte
# setzen, Cron starten, dann Apache im Vordergrund (PID 1).
set -e

APP_ROOT=/var/www/html
DATA_DIR="$APP_ROOT/app/data"
CONFIG_LIVE="$DATA_DIR/config.php"   # liegt im Volume, überlebt Neustarts
CONFIG_LINK="$APP_ROOT/app/api/config.php"

mkdir -p "$DATA_DIR"

# Config + Secret-Key EINMALIG erzeugen (nicht bei jedem Start neu —
# sonst werden gespeicherte WebDAV-Passwörter unentschlüsselbar).
if [ ! -f "$CONFIG_LIVE" ]; then
    echo "[entrypoint] Erzeuge app/data/config.php (neuer Secret-Key)…"
    KEY="$(php -r 'echo bin2hex(random_bytes(32));')"
    sed \
        -e "s/'secret_key_hex' => '.*',/'secret_key_hex' => '${KEY}',/" \
        -e "s/'cookie_secure' => true/'cookie_secure' => ${TOURLOCATE_COOKIE_SECURE:-true}/" \
        "$APP_ROOT/app/api/config.sample.php" > "$CONFIG_LIVE"
fi

# api/config.php verweist per Symlink ins Volume (Code erwartet die
# Datei genau an dieser Stelle, siehe api/db.php:tl_config()).
if [ ! -L "$CONFIG_LINK" ]; then
    ln -sf ../data/config.php "$CONFIG_LINK"
fi

chown -R www-data:www-data "$DATA_DIR"

# Cron als Daemon starten (forkt selbst, blockiert nicht)
cron

exec "$@"
