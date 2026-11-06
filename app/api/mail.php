<?php
// Schlanker SMTP-Client für ausgehende E-Mails (Passwort-Zurücksetzen u. Ä.).
// Bewusst ohne Fremdbibliothek — wie base32/TOTP/EXIF/ZIP im Projekt selbst
// geschrieben. Unterstützt STARTTLS (Port 587), implizites TLS (465) und
// AUTH LOGIN. Nur Klartext-Mails (text/plain, UTF-8).
//
// KONFIGURATION über Umgebungsvariablen (im docker-compose.yml / Portainer
// setzen) oder optional über config.php (gleichnamige Schlüssel ohne Präfix):
//   TOURLOCATE_SMTP_HOST       z. B. smtp.example.org   (leer = Versand aus)
//   TOURLOCATE_SMTP_PORT       587 (Standard) | 465 | 25
//   TOURLOCATE_SMTP_USER       Benutzername am Relay (leer = ohne AUTH)
//   TOURLOCATE_SMTP_PASS       Passwort am Relay
//   TOURLOCATE_SMTP_FROM       Absenderadresse (z. B. noreply@example.org)
//   TOURLOCATE_SMTP_FROM_NAME  Anzeigename (Standard: Tourlocate)
//   TOURLOCATE_SMTP_SECURE     tls (Standard) | ssl | none (ohne Verschlüsselung)
//   TOURLOCATE_BASE_URL        öffentliche Basis-URL (z. B. https://host) —
//                              sonst aus der Anfrage (Host/X-Forwarded-Proto)

declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php'; // tl_config(), tl_setting()
require_once __DIR__ . '/crypto.php';    // tl_secret_pack/unpack

// Konfigurationsquelle in dieser Reihenfolge (erste nicht-leere gewinnt):
//   1. Admin-GUI → app_settings (DB, im Volume) — der übliche Weg
//   2. config.php (smtp_*, base_url)
//   3. Umgebungsvariablen (TOURLOCATE_SMTP_*)
function tl_mail_config(): array
{
    $cfg = function_exists('tl_config') ? tl_config() : [];
    $pick = function (string $key, string $cfgKey, string $env, string $default = '') use ($cfg): string {
        $db = function_exists('tl_setting') ? tl_setting($key, null) : null;
        if ($db !== null && $db !== '') {
            return (string) $db;
        }
        if (isset($cfg[$cfgKey]) && (string) $cfg[$cfgKey] !== '') {
            return (string) $cfg[$cfgKey];
        }
        $v = getenv($env);
        return $v !== false && $v !== '' ? (string) $v : $default;
    };

    // Passwort: in der DB VERSCHLÜSSELT (smtp_pass_enc), sonst config/env.
    $pass = '';
    $packed = function_exists('tl_setting') ? (string) tl_setting('smtp_pass_enc', '') : '';
    if ($packed !== '') {
        $p = tl_secret_unpack($packed);
        if ($p !== null) {
            $pass = $p;
        }
    }
    if ($pass === '') {
        $pass = (string) ($cfg['smtp_pass'] ?? (getenv('TOURLOCATE_SMTP_PASS') ?: ''));
    }

    return [
        'host'      => $pick('smtp_host', 'smtp_host', 'TOURLOCATE_SMTP_HOST'),
        'port'      => (int) $pick('smtp_port', 'smtp_port', 'TOURLOCATE_SMTP_PORT', '587'),
        'user'      => $pick('smtp_user', 'smtp_user', 'TOURLOCATE_SMTP_USER'),
        'pass'      => $pass,
        'from'      => $pick('smtp_from', 'smtp_from', 'TOURLOCATE_SMTP_FROM'),
        'from_name' => $pick('smtp_from_name', 'smtp_from_name', 'TOURLOCATE_SMTP_FROM_NAME', 'Tourlocate'),
        'secure'    => strtolower($pick('smtp_secure', 'smtp_secure', 'TOURLOCATE_SMTP_SECURE', 'tls')),
    ];
}

// Letzter Versandfehler (für die "Testmail"-Rückmeldung im Admin-UI).
function tl_mail_last_error(?string $set = null): string
{
    static $err = '';
    if ($set !== null) {
        $err = $set;
    }
    return $err;
}

// Ist der Versand konfiguriert? (Sonst ist die Passwort-vergessen-Funktion
// faktisch aus — das Frontend zeigt trotzdem die generische Antwort.)
function tl_mail_configured(): bool
{
    $m = tl_mail_config();
    return $m['host'] !== '' && $m['from'] !== '';
}

// Öffentliche Basis-URL (ohne abschließenden Slash), für Links in E-Mails.
function tl_base_url(): string
{
    $cfg = function_exists('tl_config') ? tl_config() : [];
    $b = function_exists('tl_setting') ? (string) tl_setting('base_url', '') : '';
    if ($b === '') {
        $b = (string) ($cfg['base_url'] ?? (getenv('TOURLOCATE_BASE_URL') ?: ''));
    }
    if ($b !== '') {
        return rtrim($b, '/');
    }
    $proto = 'http';
    if (!empty($_SERVER['HTTP_X_FORWARDED_PROTO'])) {
        $proto = trim(explode(',', (string) $_SERVER['HTTP_X_FORWARDED_PROTO'])[0]);
    } elseif (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') {
        $proto = 'https';
    }
    $host = (string) ($_SERVER['HTTP_HOST'] ?? 'localhost');
    return $proto . '://' . $host;
}

// Betreff/Namen RFC-2047-kodieren, falls Nicht-ASCII (Umlaute).
function tl_mail_encode_header(string $s): string
{
    $s = str_replace(["\r", "\n"], '', $s);
    return preg_match('/[\x80-\xFF]/', $s) ? '=?UTF-8?B?' . base64_encode($s) . '?=' : $s;
}

// Sendet eine Klartext-Mail. Rückgabe: true bei Erfolg, sonst false
// (Fehler landen im PHP-Error-Log, nicht in der HTTP-Antwort).
function tl_send_mail(string $to, string $subject, string $body): bool
{
    tl_mail_last_error('');
    $m = tl_mail_config();
    if ($m['host'] === '' || $m['from'] === '') {
        tl_mail_last_error('SMTP ist nicht konfiguriert (Host/Absender fehlt).');
        error_log('tl_send_mail: SMTP nicht konfiguriert');
        return false;
    }
    // Header-Injection ausschließen
    $to   = str_replace(["\r", "\n"], '', $to);
    $from = str_replace(["\r", "\n"], '', $m['from']);

    $port = $m['port'] ?: 587;
    $transport = ($m['secure'] === 'ssl') ? 'ssl://' : 'tcp://';
    // peer_name explizit setzen, damit SNI + Zertifikatsprüfung auch beim
    // STARTTLS-Upgrade den richtigen Hostnamen verwenden.
    $ctx = stream_context_create(['ssl' => [
        'verify_peer'      => true,
        'verify_peer_name' => true,
        'peer_name'        => $m['host'],
        'SNI_enabled'      => true,
    ]]);
    $fp = @stream_socket_client($transport . $m['host'] . ':' . $port, $errno, $errstr, 15, STREAM_CLIENT_CONNECT, $ctx);
    if (!$fp) {
        tl_mail_last_error("Verbindung zum SMTP-Server fehlgeschlagen: $errstr");
        error_log("tl_send_mail: Verbindung fehlgeschlagen ($errno): $errstr");
        return false;
    }
    stream_set_timeout($fp, 15);

    $read = function () use ($fp): string {
        $data = '';
        while (($line = fgets($fp, 515)) !== false) {
            $data .= $line;
            // Mehrzeilige Antwort: "250-" = weitere Zeilen, "250 " = Ende
            if (strlen($line) < 4 || $line[3] === ' ') {
                break;
            }
        }
        return $data;
    };
    $codeOf = fn(string $r): int => (int) substr($r, 0, 3);
    $cmd = function (string $c) use ($fp, $read): string {
        fwrite($fp, $c . "\r\n");
        return $read();
    };
    $fail = function (string $why) use ($fp): bool {
        tl_mail_last_error($why);
        error_log('tl_send_mail: ' . $why);
        @fwrite($fp, "QUIT\r\n");
        fclose($fp);
        return false;
    };

    if ($codeOf($read()) !== 220) {
        return $fail('kein 220-Gruß');
    }
    if ($codeOf($cmd('EHLO tourlocate')) !== 250) {
        return $fail('EHLO abgelehnt');
    }
    if ($m['secure'] === 'tls') {
        if ($codeOf($cmd('STARTTLS')) !== 220) {
            return $fail('STARTTLS abgelehnt');
        }
        // Moderne TLS-Versionen erzwingen (reine TLS_CLIENT-Konstante
        // verhandelt je nach Build evtl. nur alte Versionen).
        $crypto = STREAM_CRYPTO_METHOD_TLS_CLIENT;
        if (defined('STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT')) {
            $crypto |= STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT;
        }
        if (defined('STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT')) {
            $crypto |= STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT;
        }
        $before = error_get_last();
        if (!@stream_socket_enable_crypto($fp, true, $crypto)) {
            // Echte OpenSSL-Ursache mitgeben (z. B. "certificate verify
            // failed: unable to get local issuer certificate").
            $e = error_get_last();
            $detail = ($e && $e !== $before && !empty($e['message']))
                ? ' (' . trim(preg_replace('/^.*?:\s*/', '', $e['message'])) . ')' : '';
            return $fail('TLS-Aushandlung fehlgeschlagen' . $detail);
        }
        if ($codeOf($cmd('EHLO tourlocate')) !== 250) {
            return $fail('EHLO (nach TLS) abgelehnt');
        }
    }
    if ($m['user'] !== '') {
        if ($codeOf($cmd('AUTH LOGIN')) !== 334) {
            return $fail('AUTH LOGIN abgelehnt');
        }
        if ($codeOf($cmd(base64_encode($m['user']))) !== 334) {
            return $fail('Benutzername abgelehnt');
        }
        if ($codeOf($cmd(base64_encode($m['pass']))) !== 235) {
            return $fail('Anmeldung am Relay fehlgeschlagen');
        }
    }
    if ($codeOf($cmd('MAIL FROM:<' . $from . '>')) !== 250) {
        return $fail('MAIL FROM abgelehnt');
    }
    $rcpt = $codeOf($cmd('RCPT TO:<' . $to . '>'));
    if ($rcpt !== 250 && $rcpt !== 251) {
        return $fail('RCPT TO abgelehnt');
    }
    if ($codeOf($cmd('DATA')) !== 354) {
        return $fail('DATA abgelehnt');
    }

    $fromName = $m['from_name'] !== '' ? tl_mail_encode_header($m['from_name']) . ' ' : '';
    $headers = [
        'Date: ' . date('r'),
        'From: ' . $fromName . '<' . $from . '>',
        'To: <' . $to . '>',
        'Subject: ' . tl_mail_encode_header($subject),
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: 8bit',
    ];
    // Zeilenenden normieren + Dot-Stuffing (Zeilen mit führendem Punkt)
    $bodyNorm = str_replace(["\r\n", "\r", "\n"], "\n", $body);
    $bodyNorm = preg_replace('/^\./m', '..', $bodyNorm);
    $bodyNorm = str_replace("\n", "\r\n", $bodyNorm);
    $payload = implode("\r\n", $headers) . "\r\n\r\n" . $bodyNorm . "\r\n.";
    if ($codeOf($cmd($payload)) !== 250) {
        return $fail('Nachricht abgelehnt');
    }
    $cmd('QUIT');
    fclose($fp);
    return true;
}
