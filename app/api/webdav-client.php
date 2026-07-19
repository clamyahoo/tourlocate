<?php
// Server-seitiger WebDAV-Client für die User-Version (Verbindungstest im
// Editor + Cron-Poller). Gleiche Schutzlinie wie webdav-proxy.php:
// nur https, kein privates/internes Ziel (SSRF), keine Umleitungen,
// Zeit- und Größenlimits. Anders als der Proxy liefert er Ergebnisse als
// Arrays zurück (['ok'=>bool, ...]) statt HTTP-Antworten zu beenden.

declare(strict_types=1);

const TL_DAV_MAX_BYTES = 30 * 1024 * 1024;
const TL_DAV_TIMEOUT   = 20;

// Prüft die Ziel-URL (https, auflösbar, kein privates Netz).
// Rückgabe: null wenn ok, sonst Fehlertext.
function tl_dav_check_url(string $url): ?string
{
    $parts = parse_url($url);
    if ($parts === false || ($parts['scheme'] ?? '') !== 'https' || empty($parts['host'])) {
        return 'Nur https-URLs erlaubt.';
    }
    $host = $parts['host'];
    $ip = gethostbyname($host);
    if ($ip === $host && !filter_var($host, FILTER_VALIDATE_IP)) {
        return 'Ziel-Host konnte nicht aufgelöst werden.';
    }
    if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
        return 'Ziel-Adresse ist nicht erlaubt (privates/internes Netz).';
    }
    return null;
}

// Führt PROPFIND (action=list) oder GET (action=get) aus.
// Rückgabe: ['ok'=>true,'status'=>int,'body'=>string] oder ['ok'=>false,'error'=>string]
function tl_dav_request(string $action, string $url, string $user, string $pass): array
{
    $err = tl_dav_check_url($url);
    if ($err !== null) {
        return ['ok' => false, 'error' => $err];
    }

    $headers = [];
    if ($user !== '') {
        $headers[] = 'Authorization: Basic ' . base64_encode($user . ':' . $pass);
    }

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => TL_DAV_TIMEOUT,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_FOLLOWLOCATION => false, // Umleitungen könnten den SSRF-Schutz umgehen
        CURLOPT_PROTOCOLS      => CURLPROTO_HTTPS,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    if ($action === 'list') {
        $headers[] = 'Depth: 1';
        $headers[] = 'Content-Type: application/xml';
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'PROPFIND');
        curl_setopt($ch, CURLOPT_POSTFIELDS,
            '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>');
    } else {
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'GET');
    }
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

    $body = curl_exec($ch);
    if ($body === false) {
        $errno = curl_errno($ch);
        $msg = curl_error($ch);
        curl_close($ch);
        return ['ok' => false, 'error' => 'curl-Fehler ' . $errno . ': ' . ($msg ?: 'Verbindung fehlgeschlagen')];
    }
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);

    if (strlen($body) > TL_DAV_MAX_BYTES) {
        return ['ok' => false, 'error' => 'Antwort zu groß.'];
    }
    return ['ok' => true, 'status' => (int) $status, 'body' => $body];
}

// PROPFIND-Antwort parsen → Liste der Bilddateien (href-Pfade) im Ordner.
// Bewusst OHNE SimpleXML/DOM (auf manchen Installationen fehlt php-xml):
// PROPFIND-Antworten sind maschinell erzeugtes XML mit fester Struktur —
// pro <response>-Block wird href extrahiert und auf <collection> geprüft.
// Namespace-tolerant (DAV:-Elemente können d:/D:/ohne Präfix heißen).
function tl_dav_list_images(string $xmlBody, string $folderUrl): array
{
    $hrefs = [];
    // Blöcke: <response …>…</response>, beliebiges/fehlendes Präfix
    if (!preg_match_all('#<(?:\w+:)?response[\s>].*?</(?:\w+:)?response>#is', $xmlBody, $blocks)) {
        return [];
    }
    foreach ($blocks[0] as $block) {
        if (!preg_match('#<(?:\w+:)?href\s*>(.*?)</(?:\w+:)?href>#is', $block, $m)) {
            continue;
        }
        $href = html_entity_decode(trim($m[1]), ENT_QUOTES | ENT_XML1, 'UTF-8');
        if ($href === '') {
            continue;
        }
        // Ordner (Collection) überspringen — auch selbstschließend
        if (preg_match('#<(?:\w+:)?collection\s*/?\s*>#i', $block)) {
            continue;
        }
        // Nur JPEGs: server-seitiges HEIC-Dekodieren ist ohne Zusatz-
        // pakete nicht möglich (GD kann kein HEIC) → HEIC macht weiterhin
        // der Browser-Import im Editor.
        if (!preg_match('/\.jpe?g$/i', rawurldecode($href))) {
            continue;
        }
        $hrefs[] = $href;
    }
    sort($hrefs);
    return $hrefs;
}

// href (Pfad aus der PROPFIND-Antwort) → absolute URL auf demselben Host.
function tl_dav_href_to_url(string $href, string $folderUrl): string
{
    if (preg_match('#^https://#i', $href)) {
        return $href;
    }
    $parts = parse_url($folderUrl);
    return 'https://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '') . $href;
}
