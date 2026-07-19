<?php
// Authentifizierungs-Endpunkte: register / login / logout / me
// Aufruf: POST api/auth.php  mit action=register|login|logout, bzw.
//         GET  api/auth.php?action=me

declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/ratelimit.php';

$action = $_GET['action'] ?? ($_POST['action'] ?? '');

// "me" darf per GET abgefragt werden (liefert Login-Status + CSRF-Token).
if ($action === 'me') {
    $uid = current_user_id();
    if ($uid === null) {
        json_out(['ok' => true, 'user' => null, 'csrf' => csrf_token()]);
    }
    $st = db()->prepare('SELECT id, email FROM users WHERE id = ?');
    $st->execute([$uid]);
    $user = $st->fetch() ?: null;
    json_out(['ok' => true, 'user' => $user, 'csrf' => csrf_token()]);
}

require_post();
$input = read_input();

switch ($action) {
    case 'register':
        register($input);
        break;
    case 'login':
        login($input);
        break;
    case 'logout':
        require_csrf($input);
        logout_user();
        json_out(['ok' => true]);
        break;
    default:
        json_error('Unbekannte Aktion.', 400);
}

function register(array $input): void
{
    // Konto-Anlage pro IP drosseln (gegen Massenregistrierung)
    $ipKey = 'register:ip:' . tl_client_ip();
    tl_rate_guard($ipKey);

    $email = trim(strtolower((string) ($input['email'] ?? '')));
    $pass  = (string) ($input['password'] ?? '');

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        json_error('Bitte eine gültige E-Mail-Adresse angeben.');
    }
    if (strlen($pass) < 8) {
        json_error('Das Passwort muss mindestens 8 Zeichen lang sein.');
    }

    $hash = password_hash($pass, PASSWORD_DEFAULT);
    try {
        $st = db()->prepare('INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)');
        $st->execute([$email, $hash, now_iso()]);
    } catch (PDOException $e) {
        // Nur eine echte UNIQUE-Verletzung heißt "Adresse vergeben";
        // andere DB-Fehler (fehlender Treiber o. Ä.) nicht verschleiern.
        if (($e->getCode() === '23000')
            || stripos($e->getMessage(), 'UNIQUE') !== false) {
            tl_rate_fail($ipKey, 10); // auch Duplikat-Proben drosseln
            json_error('Diese E-Mail-Adresse ist bereits registriert.', 409);
        }
        json_error('Datenbankfehler bei der Registrierung.', 500);
    }
    tl_rate_fail($ipKey, 10); // jede Konto-Anlage zählt gegen das IP-Limit

    login_user((int) db()->lastInsertId());
    json_out(['ok' => true, 'user' => ['email' => $email], 'csrf' => csrf_token()]);
}

function login(array $input): void
{
    $email = trim(strtolower((string) ($input['email'] ?? '')));
    $pass  = (string) ($input['password'] ?? '');

    // Brute-Force-Bremse: pro Konto streng (5), pro IP großzügiger (20,
    // damit geteilte IPs nicht komplett aussperren)
    $mailKey = 'login:mail:' . $email;
    $ipKey   = 'login:ip:' . tl_client_ip();
    tl_rate_guard($mailKey);
    tl_rate_guard($ipKey);

    $st = db()->prepare('SELECT id, email, password_hash, blocked FROM users WHERE email = ?');
    $st->execute([$email]);
    $user = $st->fetch();

    // Konstante Antwort bei falschem Nutzer/Passwort (kein User-Enumeration).
    if (!$user || !password_verify($pass, $user['password_hash'])) {
        tl_rate_fail($mailKey, 5);
        tl_rate_fail($ipKey, 20);
        json_error('E-Mail-Adresse oder Passwort ist falsch.', 401);
    }
    if ((int) $user['blocked'] === 1) {
        json_error('Dieses Konto ist gesperrt.', 403);
    }
    tl_rate_clear($mailKey);

    // Hash bei Bedarf auf aktuelles Verfahren anheben
    if (password_needs_rehash($user['password_hash'], PASSWORD_DEFAULT)) {
        $new = password_hash($pass, PASSWORD_DEFAULT);
        $up = db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
        $up->execute([$new, $user['id']]);
    }

    login_user((int) $user['id']);
    json_out(['ok' => true, 'user' => ['id' => (int) $user['id'], 'email' => $user['email']], 'csrf' => csrf_token()]);
}
