<?php
// Bild-Upload zu einer Präsentation.
//   POST api/upload.php   (multipart/form-data)
//     presentation_id, image (JPEG, client-seitig schon auf ~200 KB
//     verkleinert), lat, lng, taken_at, csrf
//
// Das Bild wird server-seitig mit GD neu kodiert (tl_normalize_jpeg):
// dabei fallen ALLE EXIF-/Metadaten weg (Datenschutz — kein Kameramodell,
// keine Seriennummer usw.), die Orientation wird vorher in die Pixel
// gedreht. Erhalten bleiben nur Dateiname, Datum und Geoposition, und die
// stehen getrennt in der Datenbank, nicht im Bild.

declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/image-process.php';

$uid = require_login();
require_post();
require_csrf($_POST);

$pid = (int) ($_POST['presentation_id'] ?? 0);

// Präsentation muss dem Nutzer gehören
$st = db()->prepare('SELECT id FROM presentations WHERE id = ? AND user_id = ?');
$st->execute([$pid, $uid]);
if (!$st->fetch()) {
    json_error('Präsentation nicht gefunden.', 404);
}

$f = $_FILES['image'] ?? null;
if (!$f || ($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
    json_error('Keine Bilddatei empfangen.');
}

$maxBytes = (int) tl_config()['max_upload_bytes'];
if ($f['size'] > $maxBytes) {
    json_error('Bild ist zu groß (max. ' . round($maxBytes / 1024 / 1024) . ' MB).', 413);
}

// Bilddaten lesen und server-seitig normalisieren (Orientation anwenden,
// alle Metadaten strippen, auf ~200 KB bringen). Nicht-JPEG/kaputte
// Dateien scheitern hier und werden abgewiesen.
$raw = file_get_contents($f['tmp_name']);
$clean = $raw !== false ? tl_normalize_jpeg($raw) : null;
if ($clean === null) {
    json_error('Nur JPEG-Bilder werden akzeptiert.', 415);
}

// Zielverzeichnis: data/uploads/<uid>/<pid>/
$dir = tl_data_dir() . '/uploads/' . $uid . '/' . $pid;
if (!is_dir($dir) && !@mkdir($dir, 0770, true) && !is_dir($dir)) {
    json_error('Ablageverzeichnis konnte nicht angelegt werden.', 500);
}

$name = bin2hex(random_bytes(8)) . '.jpg';
if (file_put_contents($dir . '/' . $name, $clean) === false) {
    json_error('Bild konnte nicht gespeichert werden.', 500);
}

// Geodaten (optional) für Tabelle images
$lat = isset($_POST['lat']) && $_POST['lat'] !== '' ? (float) $_POST['lat'] : null;
$lng = isset($_POST['lng']) && $_POST['lng'] !== '' ? (float) $_POST['lng'] : null;
$takenAt = isset($_POST['taken_at']) && $_POST['taken_at'] !== '' ? substr((string) $_POST['taken_at'], 0, 40) : null;

$st = db()->prepare(
    'INSERT INTO images (presentation_id, user_id, filename, lat, lng, taken_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)'
);
$st->execute([$pid, $uid, $name, $lat, $lng, $takenAt, now_iso()]);
$imgId = (int) db()->lastInsertId();

json_out(['ok' => true, 'id' => $imgId, 'url' => 'api/image.php?id=' . $imgId]);
