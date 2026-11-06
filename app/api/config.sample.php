<?php
// Vorlage für die Konfiguration der Tourlocate-User-Version.
//
// EINRICHTUNG: Diese Datei nach api/config.php kopieren und die Werte
// anpassen. config.php liegt NICHT im Repo (siehe app/.gitignore) und
// enthält die Serverschlüssel — niemals einchecken, niemals weitergeben.
//
//   cp api/config.sample.php api/config.php
//
// Danach in config.php die beiden Schlüssel unten durch eigene,
// zufällige Werte ersetzen (Befehle stehen jeweils daneben).

return [
    // Absoluter Pfad zum Datenverzeichnis (SQLite-DB + Uploads). Standard:
    // app/data/ neben diesem api/-Ordner. Muss für PHP schreibbar sein.
    'data_dir' => dirname(__DIR__) . '/data',

    // Geheimer Schlüssel zum VERSCHLÜSSELN der WebDAV-App-Passwörter
    // (sodium_crypto_secretbox, 32 Byte, hex-kodiert). Neu erzeugen mit:
    //   php -r "echo bin2hex(random_bytes(32));"
    // WICHTIG: Ändert man ihn später, sind bereits gespeicherte
    // WebDAV-Passwörter nicht mehr entschlüsselbar (müssen neu hinterlegt
    // werden).
    'secret_key_hex' => 'BITTE-AENDERN-32-byte-hex-hier-einsetzen',

    // Maximale Upload-Größe pro Bild in Bytes (Standard 20 MB).
    'max_upload_bytes' => 20 * 1024 * 1024,

    // Wird das Cookie nur über HTTPS gesendet? Im Produktivbetrieb true,
    // für lokale Tests ohne TLS ggf. false.
    'cookie_secure' => true,

    // ---- E-Mail-Versand (für "Passwort vergessen") -------------------
    // Optional. Wird bevorzugt über Umgebungsvariablen gesetzt (siehe
    // api/mail.php bzw. docker-compose.yml); alternativ hier eintragen.
    // Ohne konfigurierten SMTP-Host ist die Passwort-vergessen-Funktion
    // einfach inaktiv (das Formular zeigt trotzdem die generische Antwort).
    //   'smtp_host'      => 'smtp.example.org',
    //   'smtp_port'      => 587,              // 587 (STARTTLS) | 465 (SSL) | 25
    //   'smtp_user'      => 'postbox@example.org',
    //   'smtp_pass'      => 'GEHEIM',
    //   'smtp_from'      => 'noreply@example.org',
    //   'smtp_from_name' => 'Tourlocate',
    //   'smtp_secure'    => 'tls',            // tls | ssl | none (ohne)
    // Öffentliche Basis-URL für Links in E-Mails (sonst aus der Anfrage
    // abgeleitet). Beispiel: 'https://tourlocate.example.org'
    //   'base_url'       => 'https://tourlocate.example.org',
];
