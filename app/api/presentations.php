<?php
// CRUD für Präsentationen (Touren eines Nutzers).
//   GET  api/presentations.php?action=list
//   GET  api/presentations.php?action=get&id=123
//   POST api/presentations.php?action=create   {title}
//   POST api/presentations.php?action=save      {id,title,line_mode,profile,data_json}
//   POST api/presentations.php?action=delete    {id}
//
// data_json ist der von der Karte erzeugte Zustand (POIs, Route) OHNE
// Bilddaten — Bilder liegen als Dateien (Tabelle images) und werden über
// image.php ausgeliefert. Hier wird data_json als undurchsichtiges JSON
// gespeichert (nur auf Gültigkeit geprüft).

declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

$uid = require_login();
$action = $_GET['action'] ?? '';

// Erlaubte Werte für die Verbindungsdarstellung (nichts/Linie/Route)
const LINE_MODES = ['none', 'straight', 'route'];
const PROFILES   = ['car', 'bike', 'foot'];

if ($action === 'list') {
    list_presentations($uid);
} elseif ($action === 'get') {
    get_presentation($uid);
}

require_post();
$input = read_input();
require_csrf($input);

switch ($action) {
    case 'create': create_presentation($uid, $input); break;
    case 'save':   save_presentation($uid, $input);   break;
    case 'delete': delete_presentation($uid, $input); break;
    default:       json_error('Unbekannte Aktion.', 400);
}

// ---- Helfer ---------------------------------------------------------

// Lädt eine Präsentation und stellt sicher, dass sie dem Nutzer gehört.
function owned_presentation(int $uid, $id): array
{
    $id = (int) $id;
    $st = db()->prepare('SELECT * FROM presentations WHERE id = ? AND user_id = ?');
    $st->execute([$id, $uid]);
    $p = $st->fetch();
    if (!$p) {
        json_error('Präsentation nicht gefunden.', 404);
    }
    return $p;
}

// ---- Aktionen -------------------------------------------------------

function list_presentations(int $uid): void
{
    $st = db()->prepare(
        'SELECT p.id, p.title, p.line_mode, p.profile, p.updated_at,
                (p.share_token IS NOT NULL) AS shared,
                (SELECT COUNT(*) FROM images i WHERE i.presentation_id = p.id) AS image_count
           FROM presentations p
          WHERE p.user_id = ?
          ORDER BY p.updated_at DESC'
    );
    $st->execute([$uid]);
    $rows = $st->fetchAll();
    foreach ($rows as &$r) {
        $r['id']          = (int) $r['id'];
        $r['shared']      = (bool) $r['shared'];
        $r['image_count'] = (int) $r['image_count'];
    }
    json_out(['ok' => true, 'presentations' => $rows]);
}

function get_presentation(int $uid): void
{
    $p = owned_presentation($uid, $_GET['id'] ?? 0);

    $st = db()->prepare(
        'SELECT id, filename, lat, lng, taken_at FROM images WHERE presentation_id = ? ORDER BY id'
    );
    $st->execute([(int) $p['id']]);
    $images = $st->fetchAll();

    json_out(['ok' => true, 'presentation' => [
        'id'        => (int) $p['id'],
        'title'     => $p['title'],
        'line_mode' => $p['line_mode'],
        'profile'   => $p['profile'],
        'data'      => json_decode($p['data_json'] ?: '{}', true),
        'shared'    => $p['share_token'] !== null,
        'images'    => $images,
    ]]);
}

function create_presentation(int $uid, array $input): void
{
    $title = trim((string) ($input['title'] ?? ''));
    if ($title === '') {
        $title = 'Neue Präsentation';
    }
    $title = tl_str_limit($title, 200);
    $now = now_iso();

    $st = db()->prepare(
        'INSERT INTO presentations (user_id, title, line_mode, profile, data_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    $st->execute([$uid, $title, 'route', 'car', '{}', $now, $now]);

    json_out(['ok' => true, 'id' => (int) db()->lastInsertId(), 'title' => $title]);
}

function save_presentation(int $uid, array $input): void
{
    $p = owned_presentation($uid, $input['id'] ?? 0);

    $title = trim((string) ($input['title'] ?? $p['title']));
    if ($title === '') {
        $title = $p['title'];
    }
    $title = tl_str_limit($title, 200);

    $lineMode = (string) ($input['line_mode'] ?? $p['line_mode']);
    if (!in_array($lineMode, LINE_MODES, true)) {
        $lineMode = $p['line_mode'];
    }
    $profile = (string) ($input['profile'] ?? $p['profile']);
    if (!in_array($profile, PROFILES, true)) {
        $profile = $p['profile'];
    }

    // data_json: gültiges JSON verlangen; als Array kommt es aus dem
    // JSON-Body, als String aus einem Formularfeld.
    $data = $input['data_json'] ?? $input['data'] ?? null;
    if (is_array($data)) {
        $dataJson = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    } elseif (is_string($data) && $data !== '') {
        json_decode($data);
        if (json_last_error() !== JSON_ERROR_NONE) {
            json_error('Ungültige Präsentationsdaten (kein gültiges JSON).');
        }
        $dataJson = $data;
    } else {
        $dataJson = $p['data_json'];
    }

    $st = db()->prepare(
        'UPDATE presentations
            SET title = ?, line_mode = ?, profile = ?, data_json = ?, updated_at = ?
          WHERE id = ? AND user_id = ?'
    );
    $st->execute([$title, $lineMode, $profile, $dataJson, now_iso(), (int) $p['id'], $uid]);

    json_out(['ok' => true, 'id' => (int) $p['id'], 'title' => $title,
              'line_mode' => $lineMode, 'profile' => $profile]);
}

function delete_presentation(int $uid, array $input): void
{
    $p = owned_presentation($uid, $input['id'] ?? 0);

    // Bilddateien der Präsentation mitlöschen (DB-Zeilen via ON DELETE CASCADE)
    $dir = tl_data_dir() . '/uploads/' . $uid . '/' . (int) $p['id'];
    tl_rrmdir($dir);

    $st = db()->prepare('DELETE FROM presentations WHERE id = ? AND user_id = ?');
    $st->execute([(int) $p['id'], $uid]);

    json_out(['ok' => true]);
}

// Verzeichnis rekursiv löschen (nur innerhalb von data/uploads verwendet).
function tl_rrmdir(string $dir): void
{
    if (!is_dir($dir)) {
        return;
    }
    $items = scandir($dir) ?: [];
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') {
            continue;
        }
        $path = $dir . '/' . $item;
        is_dir($path) ? tl_rrmdir($path) : @unlink($path);
    }
    @rmdir($dir);
}
