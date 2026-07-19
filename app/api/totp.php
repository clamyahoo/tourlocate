<?php
// TOTP-Zwei-Faktor-Authentifizierung (RFC 6238, SHA-1, 30 s, 6 Stellen —
// kompatibel mit den üblichen Authenticator-Apps) plus Recovery-Codes.
// Kein Fremddienst: Secret-Erzeugung, Code-Prüfung und Base32 in PHP.
//
//   POST api/totp.php?action=setup            → Secret erzeugen (Session)
//   POST api/totp.php?action=confirm  {code}  → prüfen + aktivieren,
//                                               liefert Recovery-Codes
//   POST api/totp.php?action=disable  {password} → 2FA abschalten
//   GET  api/totp.php?action=status            → aktiviert ja/nein
//
// Der Login-Teil (Code-Abfrage nach dem Passwort) steckt in auth.php.

declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/ratelimit.php';

// ---- Base32 (RFC 4648, ohne Padding) --------------------------------

const TL_B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function tl_b32_encode(string $bin): string
{
    $out = '';
    $bits = 0;
    $value = 0;
    for ($i = 0; $i < strlen($bin); $i++) {
        $value = ($value << 8) | ord($bin[$i]);
        $bits += 8;
        while ($bits >= 5) {
            $out .= TL_B32_ALPHABET[($value >> ($bits - 5)) & 31];
            $bits -= 5;
        }
    }
    if ($bits > 0) {
        $out .= TL_B32_ALPHABET[($value << (5 - $bits)) & 31];
    }
    return $out;
}

function tl_b32_decode(string $b32): string
{
    $b32 = strtoupper(preg_replace('/[^A-Za-z2-7]/', '', $b32));
    $out = '';
    $bits = 0;
    $value = 0;
    for ($i = 0; $i < strlen($b32); $i++) {
        $idx = strpos(TL_B32_ALPHABET, $b32[$i]);
        if ($idx === false) {
            continue;
        }
        $value = ($value << 5) | $idx;
        $bits += 5;
        if ($bits >= 8) {
            $out .= chr(($value >> ($bits - 8)) & 0xFF);
            $bits -= 8;
        }
    }
    return $out;
}

// ---- TOTP-Kern -------------------------------------------------------

function tl_totp_code(string $secretBin, int $timeSlice): string
{
    $counter = pack('N2', 0, $timeSlice); // 64 Bit big-endian
    $hash = hash_hmac('sha1', $counter, $secretBin, true);
    $offset = ord($hash[19]) & 0x0F;
    $value = ((ord($hash[$offset]) & 0x7F) << 24)
           | (ord($hash[$offset + 1]) << 16)
           | (ord($hash[$offset + 2]) << 8)
           | ord($hash[$offset + 3]);
    return str_pad((string) ($value % 1000000), 6, '0', STR_PAD_LEFT);
}

// Prüft einen Code mit ±1 Zeitfenster (Uhrendrift).
function tl_totp_verify(string $secretB32, string $code): bool
{
    $secretBin = tl_b32_decode($secretB32);
    if ($secretBin === '' || !preg_match('/^\d{6}$/', $code)) {
        return false;
    }
    $slice = (int) floor(time() / 30);
    foreach ([-1, 0, 1] as $d) {
        if (hash_equals(tl_totp_code($secretBin, $slice + $d), $code)) {
            return true;
        }
    }
    return false;
}

// Recovery-Codes: 8 Stück im Format XXXX-XXXX; nur Hashes in der DB.
function tl_make_recovery_codes(): array
{
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne I/O/0/1
    $plain = [];
    for ($i = 0; $i < 8; $i++) {
        $c = '';
        for ($j = 0; $j < 8; $j++) {
            $c .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        }
        $plain[] = substr($c, 0, 4) . '-' . substr($c, 4);
    }
    return $plain;
}

// Prüft einen Recovery-Code gegen die Hash-Liste; bei Treffer wird er
// verbraucht (aus der Liste entfernt). Rückgabe: neue Liste oder null.
function tl_use_recovery_code(array $hashes, string $code): ?array
{
    $code = strtoupper(trim($code));
    foreach ($hashes as $i => $hash) {
        if (password_verify($code, $hash)) {
            unset($hashes[$i]);
            return array_values($hashes);
        }
    }
    return null;
}

// ---- Endpunkte -------------------------------------------------------

// Nur ausführen, wenn direkt aufgerufen (auth.php bindet diese Datei
// als Bibliothek ein).
if (basename($_SERVER['SCRIPT_FILENAME'] ?? '') !== 'totp.php') {
    return;
}

$action = $_GET['action'] ?? '';
$uid = require_login();

if ($action === 'status') {
    $st = db()->prepare('SELECT totp_secret, totp_recovery_json FROM users WHERE id = ?');
    $st->execute([$uid]);
    $u = $st->fetch();
    $left = count(json_decode($u['totp_recovery_json'] ?: '[]', true) ?: []);
    json_out(['ok' => true, 'enabled' => $u['totp_secret'] !== null, 'recoveryLeft' => $left]);
}

require_post();
$input = read_input();
require_csrf($input);

switch ($action) {
    case 'setup':
        // Secret NUR in der Session — aktiv wird 2FA erst nach confirm.
        $secret = tl_b32_encode(random_bytes(20));
        $_SESSION['totp_setup_secret'] = $secret;
        $st = db()->prepare('SELECT email FROM users WHERE id = ?');
        $st->execute([$uid]);
        $email = (string) $st->fetchColumn();
        $uri = 'otpauth://totp/' . rawurlencode('Tourlocate:' . $email)
             . '?secret=' . $secret . '&issuer=Tourlocate&digits=6&period=30';
        json_out(['ok' => true, 'secret' => $secret, 'uri' => $uri]);
        break;

    case 'confirm':
        $secret = (string) ($_SESSION['totp_setup_secret'] ?? '');
        if ($secret === '') {
            json_error('Kein Einrichtungsvorgang aktiv — bitte neu beginnen.');
        }
        if (!tl_totp_verify($secret, (string) ($input['code'] ?? ''))) {
            json_error('Der Code ist nicht korrekt — bitte erneut versuchen.', 401);
        }
        $plain = tl_make_recovery_codes();
        $hashes = array_map(fn($c) => password_hash($c, PASSWORD_DEFAULT), $plain);
        $st = db()->prepare('UPDATE users SET totp_secret = ?, totp_recovery_json = ? WHERE id = ?');
        $st->execute([$secret, json_encode($hashes), $uid]);
        unset($_SESSION['totp_setup_secret']);
        // Klartext-Codes gibt es nur JETZT, einmalig.
        json_out(['ok' => true, 'recoveryCodes' => $plain]);
        break;

    case 'disable':
        $st = db()->prepare('SELECT password_hash FROM users WHERE id = ?');
        $st->execute([$uid]);
        $hash = (string) $st->fetchColumn();
        if (!password_verify((string) ($input['password'] ?? ''), $hash)) {
            json_error('Passwort ist falsch.', 401);
        }
        db()->prepare('UPDATE users SET totp_secret = NULL, totp_recovery_json = NULL WHERE id = ?')
            ->execute([$uid]);
        json_out(['ok' => true]);
        break;

    default:
        json_error('Unbekannte Aktion.', 400);
}
