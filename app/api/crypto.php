<?php
// Ver-/Entschlüsselung der WebDAV-App-Passwörter (sodium_crypto_secretbox).
//
// Das Passwort muss REVERSIBEL verschlüsselt gespeichert werden, weil der
// Cron-Poller sich damit beim WebDAV-Server anmelden muss (ein Hash würde
// nicht reichen). Der Schlüssel liegt in config.php (außerhalb des Repos).
// Konsequenz: Wer Server UND config.php kompromittiert, kann die Passwörter
// entschlüsseln — deshalb wird in der UI dringend zu Nextcloud-App-
// Passwörtern geraten (einzeln widerrufbar, kein Zugriff aufs Hauptkonto).

declare(strict_types=1);

require_once __DIR__ . '/db.php';

function tl_secret_key(): string
{
    $hex = (string) (tl_config()['secret_key_hex'] ?? '');
    if (!preg_match('/^[0-9a-f]{64}$/i', $hex)) {
        http_response_code(500);
        exit('secret_key_hex in config.php fehlt oder ist ungültig (64 Hex-Zeichen nötig).');
    }
    return hex2bin($hex);
}

// Liefert [cipher, nonce] als Binärstrings für die DB (BLOB).
function tl_encrypt(string $plain): array
{
    $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
    $cipher = sodium_crypto_secretbox($plain, $nonce, tl_secret_key());
    return [$cipher, $nonce];
}

// Gibt den Klartext zurück oder null (falscher Schlüssel/beschädigte Daten).
function tl_decrypt(string $cipher, string $nonce): ?string
{
    $plain = sodium_crypto_secretbox_open($cipher, $nonce, tl_secret_key());
    return $plain === false ? null : $plain;
}

// Verschlüsselt einen String in EINE speicherbare Zeichenkette (z. B. für
// app_settings, das nur TEXT kennt): "enc:<base64-nonce>:<base64-cipher>".
function tl_secret_pack(string $plain): string
{
    [$cipher, $nonce] = tl_encrypt($plain);
    return 'enc:' . base64_encode($nonce) . ':' . base64_encode($cipher);
}

// Gegenstück zu tl_secret_pack(); null bei ungültigem/fremdem Format.
function tl_secret_unpack(string $packed): ?string
{
    if (strncmp($packed, 'enc:', 4) !== 0) {
        return null;
    }
    $parts = explode(':', $packed, 3);
    if (count($parts) !== 3) {
        return null;
    }
    $nonce  = base64_decode($parts[1], true);
    $cipher = base64_decode($parts[2], true);
    if ($nonce === false || $cipher === false) {
        return null;
    }
    return tl_decrypt($cipher, $nonce);
}
