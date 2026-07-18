<?php
// Öffentliche Teilen-Links verwalten und freischalten.
//   POST api/share.php?action=enable       {id}            → Link erzeugen
//   POST api/share.php?action=disable      {id}            → Teilen beenden
//   POST api/share.php?action=setpassword  {id, password}  → Passwort setzen/löschen
//   GET  api/share.php?action=status&id=…                  → aktueller Zustand
//   POST api/share.php?action=unlock       {token, password} → öffentl. Freischaltung
//
// enable/disable/setpassword/status sind Besitzer-Aktionen (Login nötig).
// unlock ist öffentlich: prüft das Share-Passwort und merkt die Freigabe
// in der Session ($_SESSION['share_ok'][presentation_id]).

declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

$action = $_GET['action'] ?? '';

// ---- Öffentlich: Passwort-Freischaltung -----------------------------
if ($action === 'unlock') {
    require_post();
    $input = read_input();
    $token = (string) ($input['token'] ?? '');
    $pass  = (string) ($input['password'] ?? '');

    $st = db()->prepare('SELECT id, share_password_hash FROM presentations WHERE share_token = ?');
    $st->execute([$token]);
    $p = $st->fetch();
    if (!$p) {
        json_error('Link nicht gefunden.', 404);
    }
    if ($p['share_password_hash'] !== null && !password_verify($pass, $p['share_password_hash'])) {
        json_error('Falsches Passwort.', 401);
    }
    tl_session_start();
    $_SESSION['share_ok'][(int) $p['id']] = true;
    json_out(['ok' => true]);
}

// ---- Ab hier: Besitzer-Aktionen -------------------------------------
$uid = require_login();

function owned(int $uid, $id): array
{
    $st = db()->prepare('SELECT * FROM presentations WHERE id = ? AND user_id = ?');
    $st->execute([(int) $id, $uid]);
    $p = $st->fetch();
    if (!$p) {
        json_error('Präsentation nicht gefunden.', 404);
    }
    return $p;
}

function share_state(array $p): array
{
    return [
        'ok'          => true,
        'shared'      => $p['share_token'] !== null,
        'token'       => $p['share_token'],
        'hasPassword' => $p['share_password_hash'] !== null,
    ];
}

if ($action === 'status') {
    json_out(share_state(owned($uid, $_GET['id'] ?? 0)));
}

require_post();
$input = read_input();
require_csrf($input);
$p = owned($uid, $input['id'] ?? 0);

switch ($action) {
    case 'enable':
        $token = $p['share_token'] ?: bin2hex(random_bytes(16));
        $st = db()->prepare('UPDATE presentations SET share_token = ? WHERE id = ? AND user_id = ?');
        $st->execute([$token, (int) $p['id'], $uid]);
        $p['share_token'] = $token;
        json_out(share_state($p));
        break;

    case 'disable':
        $st = db()->prepare('UPDATE presentations SET share_token = NULL, share_password_hash = NULL WHERE id = ? AND user_id = ?');
        $st->execute([(int) $p['id'], $uid]);
        $p['share_token'] = null;
        $p['share_password_hash'] = null;
        json_out(share_state($p));
        break;

    case 'setpassword':
        if ($p['share_token'] === null) {
            json_error('Bitte zuerst das Teilen aktivieren.');
        }
        $pass = (string) ($input['password'] ?? '');
        $hash = $pass === '' ? null : password_hash($pass, PASSWORD_DEFAULT);
        $st = db()->prepare('UPDATE presentations SET share_password_hash = ? WHERE id = ? AND user_id = ?');
        $st->execute([$hash, (int) $p['id'], $uid]);
        $p['share_password_hash'] = $hash;
        json_out(share_state($p));
        break;

    default:
        json_error('Unbekannte Aktion.', 400);
}
