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

require_once __DIR__ . '/db.php'; // tl_config()

function tl_mail_config(): array
{
    $cfg = function_exists('tl_config') ? tl_config() : [];
    $pick = function (string $cfgKey, string $env, string $default = '') use ($cfg): string {
        if (isset($cfg[$cfgKey]) && (string) $cfg[$cfgKey] !== '') {
            return (string) $cfg[$cfgKey];
        }
        $v = getenv($env);
        return $v !== false && $v !== '' ? (string) $v : $default;
    };
    return [
        'host'      => $pick('smtp_host', 'TOURLOCATE_SMTP_HOST'),
        'port'      => (int) ($pick('smtp_port', 'TOURLOCATE_SMTP_PORT', '587')),
        'user'      => $pick('smtp_user', 'TOURLOCATE_SMTP_USER'),
        'pass'      => $pick('smtp_pass', 'TOURLOCATE_SMTP_PASS'),
        'from'      => $pick('smtp_from', 'TOURLOCATE_SMTP_FROM'),
        'from_name' => $pick('smtp_from_name', 'TOURLOCATE_SMTP_FROM_NAME', 'Tourlocate'),
        'secure'    => strtolower($pick('smtp_secure', 'TOURLOCATE_SMTP_SECURE', 'tls')),
    ];
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
    $b = (string) ($cfg['base_url'] ?? (getenv('TOURLOCATE_BASE_URL') ?: ''));
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
    $m = tl_mail_config();
    if ($m['host'] === '' || $m['from'] === '') {
        error_log('tl_send_mail: SMTP nicht konfiguriert');
        return false;
    }
    // Header-Injection ausschließen
    $to   = str_replace(["\r", "\n"], '', $to);
    $from = str_replace(["\r", "\n"], '', $m['from']);

    $port = $m['port'] ?: 587;
    $transport = ($m['secure'] === 'ssl') ? 'ssl://' : 'tcp://';
    $ctx = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true, 'SNI_enabled' => true]]);
    $fp = @stream_socket_client($transport . $m['host'] . ':' . $port, $errno, $errstr, 15, STREAM_CLIENT_CONNECT, $ctx);
    if (!$fp) {
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
        if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
            return $fail('TLS-Aushandlung fehlgeschlagen');
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
