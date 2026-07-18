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
];
