# Tourlocate — Docker-Image mit allen PHP-Voraussetzungen für die
# User-Version (/app) und den WebDAV-Proxy (webdav-proxy.php) bereits
# eingebaut: pdo_sqlite, gd, exif, curl, sodium. Cron läuft im selben
# Container für den WebDAV-Poller.
#
# Persistenz: /var/www/html/app/data muss als Volume gemountet werden
# (SQLite-Datenbank, Uploads UND der automatisch erzeugte
# Verschlüsselungsschlüssel — siehe docker/entrypoint.sh). Ohne dieses
# Volume gehen bei jedem Neustart alle Konten/Präsentationen verloren.

FROM php:8.2-apache

RUN apt-get update && apt-get install -y --no-install-recommends \
        libsqlite3-dev \
        libpng-dev \
        libjpeg62-turbo-dev \
        libfreetype6-dev \
        libsodium-dev \
        cron \
    && rm -rf /var/lib/apt/lists/* \
    && docker-php-ext-configure gd --with-jpeg --with-freetype \
    && docker-php-ext-install -j"$(nproc)" pdo_sqlite gd exif curl sodium \
    && a2enmod rewrite

# Repo-Inhalt (ohne app/data, app/api/config.php — siehe .dockerignore)
COPY . /var/www/html/

# Crontab für den WebDAV-Poller (alle 5 Minuten)
COPY docker/crontab /etc/cron.d/tourlocate-cron
RUN chmod 0644 /etc/cron.d/tourlocate-cron \
    && touch /var/log/tourlocate-cron.log

COPY docker/entrypoint.sh /usr/local/bin/tourlocate-entrypoint.sh
RUN chmod +x /usr/local/bin/tourlocate-entrypoint.sh

# app/data wird beim Start angelegt/verlinkt (siehe entrypoint) — hier
# nur sicherstellen, dass www-data grundsätzlich schreiben darf.
RUN mkdir -p /var/www/html/app/data \
    && chown -R www-data:www-data /var/www/html/app/data

ENTRYPOINT ["tourlocate-entrypoint.sh"]
CMD ["apache2-foreground"]
