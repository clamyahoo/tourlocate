<?php
// Live-Standort teilen.
//   POST api/live.php?action=start   {label?, ttl?}       → Sitzung starten
//   POST api/live.php?action=ping     {token, lat, lng, acc} → Position melden
//   POST api/live.php?action=stop     {token}              → Teilen beenden
//   GET  api/live.php?action=status                        → eigene aktive Sitzung
//   GET  api/live.php?action=read&t=…                      → öffentl. Position lesen
//
// start/ping/stop/status sind Besitzer-Aktionen (Login + CSRF nötig).
// read ist öffentlich (nur Token) — die Betrachterseite verfolgen.php
// fragt sie im Takt ab. Es wird nur die ZULETZT gemeldete Position
// gespeichert, keine Spur-Historie.

declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/ratelimit.php';

$action = $_GET['action'] ?? '';

// Erlaubte Ablaufzeiten in Minuten (15 min / 1 h / 8 h)
const TL_LIVE_TTLS = [15, 60, 480];

// Liefert den Zustand einer Zeile als öffentlich unbedenkliches Array
// (keine user_id, keine internen Felder).
function live_public(array $row): array
{
    $expired = $row['expires_at'] <= now_iso();
    $active  = ((int) $row['active'] === 1) && !$expired;
    $out = ['ok' => true, 'active' => $active, 'expired' => $expired];
    if ($active && $row['last_at'] !== null) {
        $out['lat'] = (float) $row['last_lat'];
        $out['lng'] = (float) $row['last_lng'];
        $out['acc'] = $row['last_acc'] !== null ? (float) $row['last_acc'] : null;
        $out['at']  = $row['last_at'];
    }
    if ($row['label'] !== null && $row['label'] !== '') {
        $out['label'] = $row['label'];
    }
    return $out;
}

// ---- Öffentlich: Position lesen -------------------------------------
if ($action === 'read') {
    $token = (string) ($_GET['t'] ?? '');

    // Token-Raten drosseln: NICHT jeden Lesezugriff (legitimes Polling),
    // sondern nur fehlschlagende (unbekannte) Token pro IP.
    $ipKey = 'live-read:ip:' . tl_client_ip();
    tl_rate_guard($ipKey);

    $st = db()->prepare('SELECT label, last_lat, last_lng, last_acc, last_at, expires_at, active FROM live_shares WHERE token = ?');
    $st->execute([$token]);
    $row = $st->fetch();
    if (!$row) {
        tl_rate_fail($ipKey, 30); // viele unbekannte Token von einer IP = Raten
        json_error('Link nicht gefunden.', 404);
    }
    json_out(live_public($row));
}

// ---- Ab hier: Besitzer-Aktionen -------------------------------------
$uid = require_login();

if ($action === 'status') {
    $st = db()->prepare(
        'SELECT token, label, expires_at FROM live_shares
          WHERE user_id = ? AND active = 1 AND expires_at > ?
          ORDER BY id DESC LIMIT 1'
    );
    $st->execute([$uid, now_iso()]);
    $row = $st->fetch();
    json_out([
        'ok'    => true,
        'share' => $row ? ['token' => $row['token'], 'label' => $row['label'], 'expiresAt' => $row['expires_at']] : null,
    ]);
}

require_post();
$input = read_input();
require_csrf($input);

switch ($action) {
    case 'start': {
        $label = tl_str_limit(trim((string) ($input['label'] ?? '')), 80);
        $ttl   = (int) ($input['ttl'] ?? 60);
        if (!in_array($ttl, TL_LIVE_TTLS, true)) {
            $ttl = 60;
        }
        $expires = gmdate('Y-m-d\TH:i:s\Z', time() + $ttl * 60);

        $pdo = db();
        // Frühere Sitzungen desselben Nutzers beenden — eine neue Sitzung
        // macht alte Links sofort ungültig (Datenschutz).
        $pdo->prepare('UPDATE live_shares SET active = 0 WHERE user_id = ? AND active = 1')
            ->execute([$uid]);

        // Gelegentliches Aufräumen längst abgelaufener Zeilen (~5 %),
        // damit die Tabelle nicht unbegrenzt wächst.
        if (random_int(1, 20) === 1) {
            $pdo->prepare('DELETE FROM live_shares WHERE expires_at < ?')
                ->execute([gmdate('Y-m-d\TH:i:s\Z', time() - 86400)]);
        }

        $token = bin2hex(random_bytes(16));
        $pdo->prepare(
            'INSERT INTO live_shares (user_id, token, label, expires_at, active, created_at)
             VALUES (?, ?, ?, ?, 1, ?)'
        )->execute([$uid, $token, $label !== '' ? $label : null, $expires, now_iso()]);

        json_out(['ok' => true, 'token' => $token, 'label' => $label, 'expiresAt' => $expires]);
    }

    case 'ping': {
        $token = (string) ($input['token'] ?? '');
        $lat = $input['lat'] ?? null;
        $lng = $input['lng'] ?? null;
        $acc = $input['acc'] ?? null;

        if (!is_numeric($lat) || !is_numeric($lng)
            || $lat < -90 || $lat > 90 || $lng < -180 || $lng > 180) {
            json_error('Ungültige Koordinaten.', 400);
        }
        $acc = is_numeric($acc) ? max(0.0, (float) $acc) : null;

        // Nur eigene, aktive, nicht abgelaufene Sitzung aktualisieren.
        $st = db()->prepare(
            'UPDATE live_shares
                SET last_lat = ?, last_lng = ?, last_acc = ?, last_at = ?
              WHERE token = ? AND user_id = ? AND active = 1 AND expires_at > ?'
        );
        $st->execute([(float) $lat, (float) $lng, $acc, now_iso(), $token, $uid, now_iso()]);

        if ($st->rowCount() === 0) {
            // Nichts aktualisiert → Sitzung abgelaufen/beendet/fremd.
            json_out(['ok' => true, 'active' => false]);
        }
        json_out(['ok' => true, 'active' => true]);
    }

    case 'stop': {
        $token = (string) ($input['token'] ?? '');
        db()->prepare('UPDATE live_shares SET active = 0 WHERE token = ? AND user_id = ?')
            ->execute([$token, $uid]);
        json_out(['ok' => true]);
    }

    default:
        json_error('Unbekannte Aktion.', 400);
}
