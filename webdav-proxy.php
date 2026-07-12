<?php
/**
 * Gleiche-Herkunft-Durchreiche für WebDAV-Zugriffe (Nextcloud u. Ä.).
 *
 * Browser dürfen aus Sicherheitsgründen (CORS) keine Anfragen an eine
 * fremde Domain schicken. Dieses Skript läuft auf demselben Server wie
 * Tourlocate und übernimmt die eigentliche WebDAV-Anfrage serverseitig —
 * dafür gilt CORS nicht, weil keine Browser-Anfrage mehr beteiligt ist.
 * Der Browser spricht nur noch mit dieser Datei (gleiche Herkunft);
 * Zugangsdaten werden hier nicht dauerhaft gespeichert, sondern bei
 * jeder Anfrage vom Browser mitgeschickt und nur durchgereicht.
 *
 * Schutz gegen Missbrauch als offener Relay/Scanner:
 * - nur POST von der eigenen Seite (Origin/Referer-Prüfung)
 * - geteilter Schlüssel (bremst automatisierte Scanner; kein Ersatz für
 *   echte Zugriffskontrolle, da der Schlüssel im öffentlichen
 *   JS-Quelltext steht — siehe js/map-config.js)
 * - nur https:// und nur die Aktionen "list" (PROPFIND) / "get" (GET)
 * - Ziel-Adresse darf nicht privat/intern sein (SSRF-Schutz), keine
 *   Umleitungen (könnten die Prüfung sonst umgehen)
 * - Zeitlimit und Größenbegrenzung der Antwort
 */

// Muss mit PROXY_KEY in js/map-config.js übereinstimmen — bei Änderung
// immer BEIDE Stellen anpassen.
define('PROXY_KEY', 'tourlocate-webdav-2026-BITTE-AENDERN');

define('MAX_BYTES', 30 * 1024 * 1024); // 30 MB Obergrenze pro Antwort
define('TIMEOUT_SECONDS', 20);

function proxy_fail($status, $message) {
    http_response_code($status);
    header('X-Proxy-Error: 1'); // Markiert: Fehler kam vom Proxy selbst, nicht von der Gegenstelle
    header('Content-Type: text/plain; charset=utf-8');
    echo $message;
    exit;
}

// --- Grundlegende Prüfungen ---
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    proxy_fail(405, 'Nur POST erlaubt.');
}

$ownHost = $_SERVER['HTTP_HOST'] ?? '';
$origin = $_SERVER['HTTP_ORIGIN'] ?? ($_SERVER['HTTP_REFERER'] ?? '');
if ($ownHost === '' || $origin === '' || strpos($origin, $ownHost) === false) {
    proxy_fail(403, 'Ungültige Herkunft.');
}

$key = $_POST['key'] ?? '';
if (!hash_equals(PROXY_KEY, (string) $key)) {
    proxy_fail(403, 'Ungültiger Schlüssel.');
}

$action = $_POST['action'] ?? '';
$targetUrl = $_POST['url'] ?? '';
$user = $_POST['user'] ?? '';
$pass = $_POST['pass'] ?? '';

if ($action !== 'list' && $action !== 'get') {
    proxy_fail(400, 'Unbekannte Aktion.');
}
if ($targetUrl === '') {
    proxy_fail(400, 'Keine Ziel-URL angegeben.');
}

// --- Ziel-URL validieren (SSRF-Schutz) ---
$parts = parse_url($targetUrl);
if ($parts === false || ($parts['scheme'] ?? '') !== 'https' || empty($parts['host'])) {
    proxy_fail(400, 'Nur https-URLs erlaubt.');
}

$host = $parts['host'];
$ip = gethostbyname($host); // liefert bei Fehlschlag den Hostnamen unverändert zurück
if ($ip === $host && !filter_var($host, FILTER_VALIDATE_IP)) {
    proxy_fail(400, 'Ziel-Host konnte nicht aufgelöst werden.');
}
// Blockt private (10/8, 172.16/12, 192.168/16, ...) und reservierte
// Bereiche (Loopback 127/8, Link-Local 169.254/16 inkl. Cloud-Metadaten-
// Adresse 169.254.169.254, ...) in einem Aufwasch.
if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
    proxy_fail(400, 'Ziel-Adresse ist nicht erlaubt (privates/internes Netz).');
}

// --- Anfrage an die WebDAV-Gegenstelle bauen ---
$headers = [];
if ($user !== '') {
    $headers[] = 'Authorization: Basic ' . base64_encode($user . ':' . $pass);
}

$ch = curl_init($targetUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HEADER => true,
    CURLOPT_TIMEOUT => TIMEOUT_SECONDS,
    CURLOPT_FOLLOWLOCATION => false, // Umleitungen könnten den SSRF-Schutz umgehen
    CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
    CURLOPT_SSL_VERIFYPEER => true,
]);

if ($action === 'list') {
    $headers[] = 'Depth: 1';
    $headers[] = 'Content-Type: application/xml';
    $body = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>';
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'PROPFIND');
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
} else {
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'GET');
}
curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

$raw = curl_exec($ch);
if ($raw === false) {
    $err = curl_error($ch);
    curl_close($ch);
    proxy_fail(502, 'Verbindung zum WebDAV-Server fehlgeschlagen: ' . $err);
}

$headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
$status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
$contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
curl_close($ch);

$responseBody = substr($raw, $headerSize);
if (strlen($responseBody) > MAX_BYTES) {
    proxy_fail(502, 'Antwort zu groß.');
}
if (!$contentType) {
    $contentType = $action === 'list' ? 'application/xml' : 'application/octet-stream';
}

// Antwort der Gegenstelle 1:1 durchreichen (kein X-Proxy-Error-Header —
// der Client erkennt daran, dass der Fehler von der Gegenstelle kommt,
// nicht vom Proxy selbst)
http_response_code($status);
header('Content-Type: ' . $contentType);
echo $responseBody;
