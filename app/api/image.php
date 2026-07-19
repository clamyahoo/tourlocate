<?php
// Bild ausliefern — mit Rechteprüfung.
//   GET api/image.php?id=123
//
// Zugriff erlaubt, wenn:
//   a) der angemeldete Nutzer der Besitzer ist, ODER
//   b) die Präsentation öffentlich geteilt ist und (falls passwort-
//      geschützt) das Share-Passwort in dieser Session bereits bestätigt
//      wurde. Die Share-Freischaltung setzt view.php/share.php in
//      $_SESSION['share_ok'][presentation_id] = true.

declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
tl_session_start();

$id = (int) ($_GET['id'] ?? 0);
if ($id <= 0) {
    http_response_code(400);
    exit;
}

$st = db()->prepare(
    'SELECT i.user_id, i.presentation_id, i.filename,
            p.share_token, p.share_password_hash
       FROM images i
       JOIN presentations p ON p.id = i.presentation_id
      WHERE i.id = ?'
);
$st->execute([$id]);
$row = $st->fetch();
if (!$row) {
    http_response_code(404);
    exit;
}

$uid = current_user_id();
$isOwner = ($uid !== null && (int) $row['user_id'] === $uid)
        || is_admin_user($uid); // Admin-Einblick (auditiert beim Öffnen der Präsentation)

$shareOk = false;
if (!$isOwner && $row['share_token'] !== null) {
    // Öffentlich geteilt: ohne Passwort frei, mit Passwort erst nach
    // bestätigter Freischaltung in dieser Session.
    if ($row['share_password_hash'] === null) {
        $shareOk = true;
    } else {
        $shareOk = !empty($_SESSION['share_ok'][(int) $row['presentation_id']]);
    }
}

if (!$isOwner && !$shareOk) {
    http_response_code(403);
    exit;
}

$path = tl_data_dir() . '/uploads/' . (int) $row['user_id'] . '/'
      . (int) $row['presentation_id'] . '/' . basename((string) $row['filename']);

if (!is_file($path)) {
    http_response_code(404);
    exit;
}

header('Content-Type: image/jpeg');
header('Content-Length: ' . filesize($path));
header('Cache-Control: private, max-age=86400');
readfile($path);
