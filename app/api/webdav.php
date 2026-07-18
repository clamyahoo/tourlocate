<?php
// WebDAV-Dauerverbindung einer Präsentation verwalten (Besitzer).
//   GET  api/webdav.php?action=status&presentation_id=…
//   POST api/webdav.php?action=save    {presentation_id,url,username,password}
//   POST api/webdav.php?action=test    {presentation_id}   → PROPFIND-Probe
//   POST api/webdav.php?action=delete  {presentation_id}
//
// Das App-Passwort wird mit sodium_crypto_secretbox verschlüsselt
// gespeichert (siehe crypto.php), damit der Cron-Poller es zum Anmelden
// entschlüsseln kann. In der UI wird dringend zu einem Nextcloud-App-
// Passwort geraten (einzeln widerrufbar).

declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/crypto.php';
require_once __DIR__ . '/webdav-client.php';

$uid = require_login();
$action = $_GET['action'] ?? '';

function owned_pid(int $uid, $pid): int
{
    $st = db()->prepare('SELECT id FROM presentations WHERE id = ? AND user_id = ?');
    $st->execute([(int) $pid, $uid]);
    if (!$st->fetch()) {
        json_error('Präsentation nicht gefunden.', 404);
    }
    return (int) $pid;
}

function conn_for(int $uid, int $pid): ?array
{
    $st = db()->prepare('SELECT * FROM webdav_connections WHERE user_id = ? AND presentation_id = ?');
    $st->execute([$uid, $pid]);
    return $st->fetch() ?: null;
}

function conn_state(?array $c): array
{
    if (!$c) {
        return ['ok' => true, 'configured' => false];
    }
    return [
        'ok'         => true,
        'configured' => true,
        'url'        => $c['url'],
        'username'   => $c['username'],
        'active'     => (bool) $c['active'],
        'lastPollAt' => $c['last_poll_at'],
        'lastError'  => $c['last_error'],
    ];
}

if ($action === 'status') {
    $pid = owned_pid($uid, $_GET['presentation_id'] ?? 0);
    json_out(conn_state(conn_for($uid, $pid)));
}

require_post();
$input = read_input();
require_csrf($input);
$pid = owned_pid($uid, $input['presentation_id'] ?? 0);

switch ($action) {
    case 'save':
        $url  = trim((string) ($input['url'] ?? ''));
        $user = trim((string) ($input['username'] ?? ''));
        $pass = (string) ($input['password'] ?? '');
        if ($url === '' || $user === '') {
            json_error('Ordner-URL und Benutzername sind erforderlich.');
        }
        $err = tl_dav_check_url($url);
        if ($err !== null) {
            json_error($err);
        }

        $existing = conn_for($uid, $pid);
        if ($pass === '' && $existing) {
            // Leeres Passwort beim Bearbeiten = bestehendes behalten
            $cipher = $existing['secret_cipher'];
            $nonce  = $existing['secret_nonce'];
        } elseif ($pass === '') {
            json_error('Bitte ein App-Passwort angeben.');
        } else {
            [$cipher, $nonce] = tl_encrypt($pass);
        }

        if ($existing) {
            $st = db()->prepare(
                'UPDATE webdav_connections
                    SET url = ?, username = ?, secret_cipher = ?, secret_nonce = ?,
                        active = 1, last_error = NULL
                  WHERE id = ?'
            );
            $st->execute([$url, $user, $cipher, $nonce, (int) $existing['id']]);
        } else {
            $st = db()->prepare(
                'INSERT INTO webdav_connections
                    (user_id, presentation_id, url, username, secret_cipher, secret_nonce, active, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, 1, ?)'
            );
            $st->execute([$uid, $pid, $url, $user, $cipher, $nonce, now_iso()]);
        }
        json_out(conn_state(conn_for($uid, $pid)));
        break;

    case 'test':
        $c = conn_for($uid, $pid);
        if (!$c) {
            json_error('Keine Verbindung hinterlegt.');
        }
        $pass = tl_decrypt($c['secret_cipher'], $c['secret_nonce']);
        if ($pass === null) {
            json_error('Gespeichertes Passwort nicht entschlüsselbar — bitte neu hinterlegen.', 500);
        }
        $res = tl_dav_request('list', $c['url'], $c['username'], $pass);
        if (!$res['ok']) {
            json_error($res['error'], 502);
        }
        if ($res['status'] === 401 || $res['status'] === 403) {
            json_error('Anmeldung abgelehnt (HTTP ' . $res['status'] . ') — Benutzer/App-Passwort prüfen.', 401);
        }
        if ($res['status'] >= 300) {
            json_error('WebDAV-Server antwortete mit HTTP ' . $res['status'] . '.', 502);
        }
        $images = tl_dav_list_images($res['body'], $c['url']);
        json_out(['ok' => true, 'imageCount' => count($images)]);
        break;

    case 'delete':
        $st = db()->prepare('DELETE FROM webdav_connections WHERE user_id = ? AND presentation_id = ?');
        $st->execute([$uid, $pid]);
        json_out(['ok' => true, 'configured' => false]);
        break;

    default:
        json_error('Unbekannte Aktion.', 400);
}
