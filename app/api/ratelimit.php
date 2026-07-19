<?php
// Einfache Fehlversuchs-Drossel (Brute-Force-Bremse) auf DB-Basis.
//
// Pro Schlüssel (z. B. 'login:mail:…' oder 'unlock:pid:…:ip:…') werden
// Fehlversuche in einem Zeitfenster gezählt; ab dem Limit wird der
// Schlüssel für die Sperrzeit blockiert. Erfolgreiche Aktionen setzen
// den Zähler zurück. Alte Einträge werden gelegentlich aufgeräumt.

declare(strict_types=1);

require_once __DIR__ . '/db.php';

const TL_RATE_WINDOW  = 900; // Zählfenster: 15 Minuten
const TL_RATE_LOCKOUT = 900; // Sperrzeit nach Erreichen des Limits

// Liefert 0, wenn erlaubt — sonst die Restsperrzeit in Sekunden.
function tl_rate_blocked(string $key): int
{
    $st = db()->prepare('SELECT blocked_until FROM rate_limits WHERE key = ?');
    $st->execute([$key]);
    $until = $st->fetchColumn();
    if ($until !== false && $until !== null && (int) $until > time()) {
        return (int) $until - time();
    }
    return 0;
}

// Fehlversuch zählen; ab $limit Versuchen im Fenster wird gesperrt.
function tl_rate_fail(string $key, int $limit): void
{
    $now = time();
    $pdo = db();
    $st = $pdo->prepare('SELECT fails, window_start FROM rate_limits WHERE key = ?');
    $st->execute([$key]);
    $row = $st->fetch();

    if (!$row || ((int) $row['window_start'] + TL_RATE_WINDOW) < $now) {
        // Neues Fenster
        $pdo->prepare('INSERT INTO rate_limits (key, fails, window_start, blocked_until)
                       VALUES (?, 1, ?, NULL)
                       ON CONFLICT(key) DO UPDATE SET fails = 1, window_start = ?, blocked_until = NULL')
            ->execute([$key, $now, $now]);
        return;
    }

    $fails = (int) $row['fails'] + 1;
    $blocked = $fails >= $limit ? $now + TL_RATE_LOCKOUT : null;
    $pdo->prepare('UPDATE rate_limits SET fails = ?, blocked_until = ? WHERE key = ?')
        ->execute([$fails, $blocked, $key]);

    // Gelegentliches Aufräumen abgelaufener Einträge (~1 % der Aufrufe)
    if (random_int(1, 100) === 1) {
        $pdo->prepare('DELETE FROM rate_limits WHERE window_start < ? AND (blocked_until IS NULL OR blocked_until < ?)')
            ->execute([$now - 2 * TL_RATE_WINDOW, $now]);
    }
}

function tl_rate_clear(string $key): void
{
    db()->prepare('DELETE FROM rate_limits WHERE key = ?')->execute([$key]);
}

// Bequemer Guard: bricht mit 429 ab, wenn gesperrt.
function tl_rate_guard(string $key): void
{
    $wait = tl_rate_blocked($key);
    if ($wait > 0) {
        json_error('Zu viele Fehlversuche — bitte in ' . (int) ceil($wait / 60) . ' Minute(n) erneut versuchen.', 429);
    }
}

// Client-IP (hinter Proxy ggf. anpassen; bewusst konservativ REMOTE_ADDR)
function tl_client_ip(): string
{
    return (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
}
