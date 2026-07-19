<?php
// Öffentliche Inhalts-Meldung (Notice-and-Takedown) aus view.php.
//   POST api/report.php   {token, reason}
// Bewusst ohne Login nutzbar (Betrachter kennen nur den Share-Link);
// deshalb strikt pro IP gedrosselt. Meldungen erscheinen im Admin-Panel.

declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/ratelimit.php';

require_post();
$input = read_input();

$rlKey = 'report:ip:' . tl_client_ip();
tl_rate_guard($rlKey);

$token  = (string) ($input['token'] ?? '');
$reason = trim((string) ($input['reason'] ?? ''));

if ($reason === '' || strlen($reason) < 10) {
    json_error('Bitte kurz begründen (mindestens 10 Zeichen).');
}
$reason = tl_str_limit($reason, 1000);

$st = db()->prepare('SELECT id FROM presentations WHERE share_token = ?');
$st->execute([$token]);
$pid = $st->fetchColumn();
if ($pid === false) {
    tl_rate_fail($rlKey, 3);
    json_error('Link nicht gefunden.', 404);
}

$st = db()->prepare('INSERT INTO reports (presentation_id, reason, status, created_at) VALUES (?, ?, ?, ?)');
$st->execute([(int) $pid, $reason, 'open', now_iso()]);
tl_rate_fail($rlKey, 3); // jede Meldung zählt gegen das IP-Limit (3 pro Fenster)

json_out(['ok' => true]);
