<?php
// Gemeinsame Basis für alle API-Endpunkte und Seiten:
// Session-Start, JSON-Helfer, CSRF-Schutz, Login-Guard.

declare(strict_types=1);

require_once __DIR__ . '/db.php';

function tl_session_start(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    session_set_cookie_params([
        'httponly' => true,
        'samesite' => 'Lax',
        'secure'   => (bool) tl_config()['cookie_secure'],
        'path'     => '/',
    ]);
    session_start();
}

// ---- JSON-Antworten -------------------------------------------------

function json_out($data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function json_error(string $message, int $status = 400): void
{
    json_out(['ok' => false, 'error' => $message], $status);
}

// Liest den Request-Body: JSON-Body ODER klassisches POST-Formular.
function read_input(): array
{
    $ctype = $_SERVER['CONTENT_TYPE'] ?? '';
    if (stripos($ctype, 'application/json') !== false) {
        $raw = file_get_contents('php://input');
        $data = json_decode($raw ?: 'null', true);
        return is_array($data) ? $data : [];
    }
    return $_POST;
}

function require_post(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        json_error('Nur POST erlaubt.', 405);
    }
}

// ---- CSRF -----------------------------------------------------------

function csrf_token(): string
{
    tl_session_start();
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

function require_csrf(array $input): void
{
    tl_session_start();
    $sent = $input['csrf'] ?? ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
    if (empty($_SESSION['csrf']) || !hash_equals($_SESSION['csrf'], (string) $sent)) {
        json_error('Ungültiges oder fehlendes CSRF-Token.', 403);
    }
}

// ---- Authentifizierung ---------------------------------------------

function current_user_id(): ?int
{
    tl_session_start();
    return isset($_SESSION['uid']) ? (int) $_SESSION['uid'] : null;
}

function require_login(): int
{
    $uid = current_user_id();
    if ($uid === null) {
        json_error('Nicht angemeldet.', 401);
    }
    // Gesperrte Konten sofort aussperren (auch mit noch aktiver Session)
    $st = db()->prepare('SELECT blocked FROM users WHERE id = ?');
    $st->execute([$uid]);
    $blocked = $st->fetchColumn();
    if ($blocked === false || (int) $blocked === 1) {
        logout_user();
        json_error('Dieses Konto ist gesperrt.', 403);
    }
    return $uid;
}

// Admin-Guard: wie require_login, zusätzlich is_admin-Pflicht.
function require_admin(): int
{
    $uid = require_login();
    $st = db()->prepare('SELECT is_admin FROM users WHERE id = ?');
    $st->execute([$uid]);
    if ((int) $st->fetchColumn() !== 1) {
        json_error('Keine Berechtigung.', 403);
    }
    return $uid;
}

function is_admin_user(?int $uid): bool
{
    if ($uid === null) {
        return false;
    }
    $st = db()->prepare('SELECT is_admin FROM users WHERE id = ?');
    $st->execute([$uid]);
    return (int) $st->fetchColumn() === 1;
}

// Audit-Log-Eintrag (Admin-Zugriffe auf fremde Inhalte / Verwaltung)
function tl_audit(int $adminId, string $action, ?int $targetUser = null, ?int $targetPres = null, string $detail = ''): void
{
    $st = db()->prepare(
        'INSERT INTO audit_log (admin_id, action, target_user_id, target_pres_id, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?)'
    );
    $st->execute([$adminId, $action, $targetUser, $targetPres, $detail, now_iso()]);
}

function login_user(int $uid): void
{
    tl_session_start();
    session_regenerate_id(true);
    $_SESSION['uid'] = $uid;
}

function logout_user(): void
{
    tl_session_start();
    $_SESSION = [];
    session_destroy();
}

function now_iso(): string
{
    return gmdate('Y-m-d\TH:i:s\Z');
}

// UTF-8-sichere Kürzung auf max. $max Zeichen — nutzt mbstring, wenn
// vorhanden, sonst PCRE-Fallback (kein mbstring als Pflicht-Abhängigkeit).
function tl_str_limit(string $s, int $max): string
{
    if (function_exists('mb_substr')) {
        return mb_substr($s, 0, $max, 'UTF-8');
    }
    if (preg_match_all('/./us', $s, $m) && count($m[0]) > $max) {
        return implode('', array_slice($m[0], 0, $max));
    }
    return $s;
}
