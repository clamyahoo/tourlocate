<?php
// Admin-API: Nutzerverwaltung, Inhalts-Einblick, Audit-Log.
//   GET  api/admin.php?action=users
//   GET  api/admin.php?action=presentations&user_id=…
//   GET  api/admin.php?action=presentation&id=…      (nur-lesend, AUDITIERT)
//   GET  api/admin.php?action=audit
//   POST api/admin.php?action=block    {user_id, blocked: 0|1}
//   POST api/admin.php?action=deleteuser {user_id}
//   POST api/admin.php?action=deletepresentation {id}
//
// Jeder Einblick in fremde Inhalte und jede Verwaltungsaktion landet im
// Audit-Log (Beleg für anlassbezogene Einsicht, siehe DESIGN.md).

declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

$aid = require_admin();
$action = $_GET['action'] ?? '';

switch ($action) {
    case 'users':
        $rows = db()->query(
            'SELECT u.id, u.email, u.created_at, u.is_admin, u.blocked,
                    (SELECT COUNT(*) FROM presentations p WHERE p.user_id = u.id) AS pres_count,
                    (SELECT COUNT(*) FROM images i WHERE i.user_id = u.id) AS image_count
               FROM users u ORDER BY u.id'
        )->fetchAll();
        foreach ($rows as &$r) {
            $r['id'] = (int) $r['id'];
            $r['is_admin'] = (bool) $r['is_admin'];
            $r['blocked'] = (bool) $r['blocked'];
            $r['pres_count'] = (int) $r['pres_count'];
            $r['image_count'] = (int) $r['image_count'];
        }
        json_out(['ok' => true, 'users' => $rows]);
        break;

    case 'presentations':
        $uid = (int) ($_GET['user_id'] ?? 0);
        $st = db()->prepare(
            'SELECT id, title, updated_at, (share_token IS NOT NULL) AS shared,
                    (SELECT COUNT(*) FROM images i WHERE i.presentation_id = presentations.id) AS image_count
               FROM presentations WHERE user_id = ? ORDER BY updated_at DESC'
        );
        $st->execute([$uid]);
        $rows = $st->fetchAll();
        foreach ($rows as &$r) {
            $r['id'] = (int) $r['id'];
            $r['shared'] = (bool) $r['shared'];
            $r['image_count'] = (int) $r['image_count'];
        }
        json_out(['ok' => true, 'presentations' => $rows]);
        break;

    case 'presentation':
        // Nur-lesender Einblick in eine fremde Präsentation — AUDITIERT.
        $pid = (int) ($_GET['id'] ?? 0);
        $st = db()->prepare('SELECT * FROM presentations WHERE id = ?');
        $st->execute([$pid]);
        $p = $st->fetch();
        if (!$p) {
            json_error('Präsentation nicht gefunden.', 404);
        }
        tl_audit($aid, 'view_presentation', (int) $p['user_id'], $pid,
            'Einblick in "' . $p['title'] . '"');
        json_out(['ok' => true, 'presentation' => [
            'id'       => (int) $p['id'],
            'user_id'  => (int) $p['user_id'],
            'title'    => $p['title'],
            'line_mode'=> $p['line_mode'],
            'shared'   => $p['share_token'] !== null,
            'data'     => json_decode($p['data_json'] ?: '{}', true),
        ]]);
        break;

    case 'settings':
        json_out(['ok' => true, 'registrationMode' => tl_registration_mode()]);
        break;

    case 'invites':
        $rows = db()->query(
            'SELECT i.id, i.token, i.note, i.created_at, i.used_at,
                    u.email AS used_by_email
               FROM invites i LEFT JOIN users u ON u.id = i.used_by
              ORDER BY (i.used_by IS NULL) DESC, i.id DESC LIMIT 200'
        )->fetchAll();
        json_out(['ok' => true, 'invites' => $rows]);
        break;

    case 'reports':
        $rows = db()->query(
            'SELECT r.id, r.presentation_id, r.reason, r.status, r.created_at,
                    p.title, p.user_id
               FROM reports r JOIN presentations p ON p.id = r.presentation_id
              ORDER BY (r.status = \'open\') DESC, r.id DESC LIMIT 200'
        )->fetchAll();
        json_out(['ok' => true, 'reports' => $rows]);
        break;

    case 'audit':
        $rows = db()->query(
            'SELECT a.id, a.action, a.target_user_id, a.target_pres_id, a.detail, a.created_at,
                    u.email AS admin_email
               FROM audit_log a JOIN users u ON u.id = a.admin_id
              ORDER BY a.id DESC LIMIT 200'
        )->fetchAll();
        json_out(['ok' => true, 'audit' => $rows]);
        break;
}

require_post();
$input = read_input();
require_csrf($input);

switch ($action) {
    case 'block':
        $uid = (int) ($input['user_id'] ?? 0);
        $blocked = ((int) ($input['blocked'] ?? 0)) === 1 ? 1 : 0;
        if ($uid === $aid) {
            json_error('Das eigene Konto kann nicht gesperrt werden.');
        }
        $st = db()->prepare('SELECT email FROM users WHERE id = ?');
        $st->execute([$uid]);
        $email = $st->fetchColumn();
        if ($email === false) {
            json_error('Konto nicht gefunden.', 404);
        }
        db()->prepare('UPDATE users SET blocked = ? WHERE id = ?')->execute([$blocked, $uid]);
        tl_audit($aid, $blocked ? 'block_user' : 'unblock_user', $uid, null, (string) $email);
        json_out(['ok' => true]);
        break;

    case 'deleteuser':
        $uid = (int) ($input['user_id'] ?? 0);
        if ($uid === $aid) {
            json_error('Das eigene Konto kann hier nicht gelöscht werden.');
        }
        $st = db()->prepare('SELECT email FROM users WHERE id = ?');
        $st->execute([$uid]);
        $email = $st->fetchColumn();
        if ($email === false) {
            json_error('Konto nicht gefunden.', 404);
        }
        // Upload-Dateien des Nutzers entfernen (DB-Zeilen via CASCADE)
        tl_admin_rrmdir(tl_data_dir() . '/uploads/' . $uid);
        db()->prepare('DELETE FROM users WHERE id = ?')->execute([$uid]);
        tl_audit($aid, 'delete_user', $uid, null, (string) $email);
        json_out(['ok' => true]);
        break;

    case 'deletepresentation':
        $pid = (int) ($input['id'] ?? 0);
        $st = db()->prepare('SELECT user_id, title FROM presentations WHERE id = ?');
        $st->execute([$pid]);
        $p = $st->fetch();
        if (!$p) {
            json_error('Präsentation nicht gefunden.', 404);
        }
        tl_admin_rrmdir(tl_data_dir() . '/uploads/' . (int) $p['user_id'] . '/' . $pid);
        db()->prepare('DELETE FROM presentations WHERE id = ?')->execute([$pid]);
        tl_audit($aid, 'delete_presentation', (int) $p['user_id'], $pid, (string) $p['title']);
        json_out(['ok' => true]);
        break;

    case 'setmode':
        $mode = (string) ($input['mode'] ?? '');
        if (!in_array($mode, ['open', 'invite', 'closed'], true)) {
            json_error('Ungültiger Modus.');
        }
        tl_setting_set('registration_mode', $mode);
        tl_audit($aid, 'set_registration_mode', null, null, $mode);
        json_out(['ok' => true, 'registrationMode' => $mode]);
        break;

    case 'createinvite':
        $note = tl_str_limit(trim((string) ($input['note'] ?? '')), 200);
        $token = bin2hex(random_bytes(16));
        db()->prepare('INSERT INTO invites (token, note, created_by, created_at) VALUES (?, ?, ?, ?)')
            ->execute([$token, $note, $aid, now_iso()]);
        tl_audit($aid, 'create_invite', null, null, $note);
        json_out(['ok' => true, 'token' => $token]);
        break;

    case 'deleteinvite':
        $iid = (int) ($input['id'] ?? 0);
        // Nur unbenutzte Einladungen löschbar (benutzte bleiben als Beleg)
        $st = db()->prepare('DELETE FROM invites WHERE id = ? AND used_by IS NULL');
        $st->execute([$iid]);
        json_out(['ok' => true, 'deleted' => $st->rowCount()]);
        break;

    case 'createuser':
        $email = trim(strtolower((string) ($input['email'] ?? '')));
        $pass  = (string) ($input['password'] ?? '');
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            json_error('Bitte eine gültige E-Mail-Adresse angeben.');
        }
        if (strlen($pass) < 8) {
            json_error('Das Passwort muss mindestens 8 Zeichen lang sein.');
        }
        try {
            db()->prepare('INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)')
                ->execute([$email, password_hash($pass, PASSWORD_DEFAULT), now_iso()]);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000' || stripos($e->getMessage(), 'UNIQUE') !== false) {
                json_error('Diese E-Mail-Adresse ist bereits registriert.', 409);
            }
            json_error('Datenbankfehler beim Anlegen.', 500);
        }
        $newUid = (int) db()->lastInsertId();
        tl_audit($aid, 'create_user', $newUid, null, $email);
        json_out(['ok' => true, 'id' => $newUid, 'email' => $email]);
        break;

    case 'closereport':
        $rid = (int) ($input['id'] ?? 0);
        $st = db()->prepare('SELECT presentation_id FROM reports WHERE id = ?');
        $st->execute([$rid]);
        $pid = $st->fetchColumn();
        if ($pid === false) {
            json_error('Meldung nicht gefunden.', 404);
        }
        db()->prepare('UPDATE reports SET status = ? WHERE id = ?')->execute(['closed', $rid]);
        tl_audit($aid, 'close_report', null, (int) $pid, 'Meldung #' . $rid . ' geschlossen');
        json_out(['ok' => true]);
        break;

    default:
        json_error('Unbekannte Aktion.', 400);
}

function tl_admin_rrmdir(string $dir): void
{
    if (!is_dir($dir)) {
        return;
    }
    foreach (scandir($dir) ?: [] as $item) {
        if ($item === '.' || $item === '..') {
            continue;
        }
        $path = $dir . '/' . $item;
        is_dir($path) ? tl_admin_rrmdir($path) : @unlink($path);
    }
    @rmdir($dir);
}
