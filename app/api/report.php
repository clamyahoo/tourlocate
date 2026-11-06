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

$st = db()->prepare('SELECT id, title FROM presentations WHERE share_token = ?');
$st->execute([$token]);
$pres = $st->fetch();
if (!$pres) {
    tl_rate_fail($rlKey, 3);
    json_error('Link nicht gefunden.', 404);
}
$pid   = (int) $pres['id'];
$title = (string) $pres['title'];

$st = db()->prepare('INSERT INTO reports (presentation_id, reason, status, created_at) VALUES (?, ?, ?, ?)');
$st->execute([$pid, $reason, 'open', now_iso()]);
tl_rate_fail($rlKey, 3); // jede Meldung zählt gegen das IP-Limit (3 pro Fenster)

// Admins per E-Mail benachrichtigen (nur wenn SMTP konfiguriert ist;
// best effort — ein Fehlschlag darf die Meldung selbst nicht stören).
require_once __DIR__ . '/mail.php';
if (tl_mail_configured()) {
    try {
        $admins = db()->query('SELECT email FROM users WHERE is_admin = 1 AND blocked = 0')
                      ->fetchAll(PDO::FETCH_COLUMN);
        if ($admins) {
            $body = "Eine neue Inhaltsmeldung ist eingegangen.\n\n"
                  . 'Präsentation: #' . $pid . ($title !== '' ? ' — ' . $title : '') . "\n\n"
                  . "Begründung der Meldung:\n" . $reason . "\n\n"
                  . "Zur Prüfung im Admin-Bereich:\n" . tl_base_url() . "/app/admin.php\n\n"
                  . "-- Tourlocate";
            foreach ($admins as $to) {
                tl_send_mail((string) $to, 'Tourlocate: Neue Inhaltsmeldung', $body);
            }
        }
    } catch (Throwable $e) {
        error_log('report.php: Admin-Benachrichtigung fehlgeschlagen: ' . $e->getMessage());
    }
}

json_out(['ok' => true]);
