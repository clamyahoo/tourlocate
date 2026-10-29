<?php
// Server-seitiger WebDAV-Client für die User-Version (Verbindungstest im
// Editor + Cron-Poller). Gleiche Schutzlinie wie webdav-proxy.php:
// nur https, kein privates/internes Ziel (SSRF), keine Umleitungen,
// Zeit- und Größenlimits. Anders als der Proxy liefert er Ergebnisse als
// Arrays zurück (['ok'=>bool, ...]) statt HTTP-Antworten zu beenden.

declare(strict_types=1);

const TL_DAV_MAX_BYTES = 30 * 1024 * 1024;
const TL_DAV_TIMEOUT   = 20;

// Eine einzelne IP (v4 oder v6) auf öffentlich/erlaubt prüfen.
// FILTER_FLAG_NO_PRIV_RANGE|NO_RES_RANGE deckt v4 UND v6 ab (Loopback,
// Link-Local inkl. 169.254.169.254, ULA fc00::/7, ::1 …); zusätzlich
// explizit die IPv4-Cloud-Metadaten-Adresse als Gürtel-und-Hosenträger.
function tl_dav_ip_allowed(string $ip): bool
{
    if ($ip === '169.254.169.254') {
        return false;
    }
    return filter_var(
        $ip,
        FILTER_VALIDATE_IP,
        FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE
    ) !== false;
}

// Host zu ALLEN IPs auflösen (A + AAAA). Rückgabe: Liste oder [] .
function tl_dav_resolve_all(string $host): array
{
    if (filter_var($host, FILTER_VALIDATE_IP)) {
        return [$host]; // schon eine IP
    }
    $ips = [];
    $v4 = @gethostbynamel($host);
    if (is_array($v4)) {
        $ips = $v4;
    }
    if (function_exists('dns_get_record')) {
        $aaaa = @dns_get_record($host, DNS_AAAA);
        if (is_array($aaaa)) {
            foreach ($aaaa as $rec) {
                if (!empty($rec['ipv6'])) {
                    $ips[] = $rec['ipv6'];
                }
            }
        }
    }
    return array_values(array_unique($ips));
}

// Ziel-URL prüfen und die Verbindung an eine geprüfte IP binden
// (SSRF-Schutz inkl. DNS-Rebinding: aufgelöst wird EINMAL, curl bekommt
// per CURLOPT_RESOLVE genau diese IP und löst nicht erneut auf).
// Rückgabe: ['error'=>?string, 'resolve'=>?string] — resolve ist der
// "host:port:ip"-Eintrag für CURLOPT_RESOLVE (null bei Fehler).
function tl_dav_validate(string $url): array
{
    $parts = parse_url($url);
    if ($parts === false || ($parts['scheme'] ?? '') !== 'https' || empty($parts['host'])) {
        return ['error' => 'Nur https-URLs erlaubt.', 'resolve' => null];
    }
    $host = $parts['host'];
    $port = (int) ($parts['port'] ?? 443);

    $ips = tl_dav_resolve_all($host);
    if (!$ips) {
        return ['error' => 'Ziel-Host konnte nicht aufgelöst werden.', 'resolve' => null];
    }
    // Konservativ: ist AUCH NUR EINE aufgelöste IP intern, wird abgelehnt
    // (verhindert, dass ein Host public+private mischt, um intern zu zielen).
    foreach ($ips as $ip) {
        if (!tl_dav_ip_allowed($ip)) {
            return ['error' => 'Ziel-Adresse ist nicht erlaubt (privates/internes Netz).', 'resolve' => null];
        }
    }
    // Erste geprüfte IP festnageln; eckige Klammern für IPv6 in RESOLVE
    // sind NICHT nötig (curl erwartet dort die nackte IP).
    return ['error' => null, 'resolve' => $host . ':' . $port . ':' . $ips[0]];
}

// Prüft die Ziel-URL (https, auflösbar, kein privates Netz).
// Rückgabe: null wenn ok, sonst Fehlertext. (Dünner Wrapper für
// Aufrufer, die nur validieren, aber nicht selbst verbinden.)
function tl_dav_check_url(string $url): ?string
{
    return tl_dav_validate($url)['error'];
}

// Führt PROPFIND (action=list) oder GET (action=get) aus.
// Rückgabe: ['ok'=>true,'status'=>int,'body'=>string] oder ['ok'=>false,'error'=>string]
function tl_dav_request(string $action, string $url, string $user, string $pass): array
{
    $check = tl_dav_validate($url);
    if ($check['error'] !== null) {
        return ['ok' => false, 'error' => $check['error']];
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
        // An die geprüfte IP binden → curl löst nicht erneut auf
        // (DNS-Rebinding-Schutz).
        CURLOPT_RESOLVE        => [$check['resolve']],
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
