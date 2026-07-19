<?php
// Cron-Poller: holt neue Fotos aus den hinterlegten WebDAV-Ordnern und
// hängt sie als Stationen an die jeweilige Präsentation an.
//
// Einrichtung (System-Cron, z. B. alle 5 Minuten):
//   */5 * * * * php /pfad/zu/tourlocate/app/cron/poll-webdav.php
//
// Ablauf pro aktiver Verbindung:
//   PROPFIND-Liste → neue JPEGs (Abgleich mit seen_files_json) → GET →
//   EXIF-GPS/-Datum lesen (php-exif) → ohne GPS: überspringen (aber als
//   gesehen merken) → mit GD auf ~200 KB verkleinern → als Bild ablegen →
//   Station in data_json ergänzen, nach Aufnahmedatum sortieren.
// Fehler landen in last_error und werden im Editor angezeigt.
//
// Hinweis: HEIC wird hier übersprungen (GD kann kein HEIC dekodieren);
// HEIC-Fotos importiert weiterhin der Browser-Import im Editor.

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("Nur per Kommandozeile/Cron ausführbar.\n");
}

require_once __DIR__ . '/../api/db.php';
require_once __DIR__ . '/../api/crypto.php';
require_once __DIR__ . '/../api/webdav-client.php';
require_once __DIR__ . '/../api/image-process.php'; // tl_normalize_jpeg (GD)

const TL_TARGET_BYTES  = 200 * 1024; // Zielgröße pro Bild (~200 KB)
const TL_HARD_MAX_SIDE = 1600;
const TL_MAX_PER_RUN   = 20;         // Neue Bilder pro Lauf und Verbindung

function now_iso(): string
{
    return gmdate('Y-m-d\TH:i:s\Z');
}

function logline(string $msg): void
{
    echo '[' . now_iso() . '] ' . $msg . "\n";
}

// EXIF-GPS (Rationalzahlen-Tripel + Ref) → Dezimalgrad
function exif_coord($triple, string $ref): ?float
{
    if (!is_array($triple) || count($triple) < 3) {
        return null;
    }
    $num = [];
    foreach ($triple as $part) {
        if (is_string($part) && strpos($part, '/') !== false) {
            [$a, $b] = explode('/', $part, 2);
            $num[] = (float) $b !== 0.0 ? (float) $a / (float) $b : 0.0;
        } else {
            $num[] = (float) $part;
        }
    }
    $deg = $num[0] + $num[1] / 60 + $num[2] / 3600;
    if ($ref === 'S' || $ref === 'W') {
        $deg = -$deg;
    }
    return $deg;
}

// EXIF aus JPEG-Bytes lesen → ['lat'=>?, 'lng'=>?, 'date'=>?ISO]
function read_exif_bytes(string $jpeg): array
{
    $out = ['lat' => null, 'lng' => null, 'date' => null];
    if (!function_exists('exif_read_data')) {
        return $out;
    }
    $exif = @exif_read_data('data://image/jpeg;base64,' . base64_encode($jpeg));
    if (!is_array($exif)) {
        return $out;
    }
    if (isset($exif['GPSLatitude'], $exif['GPSLongitude'])) {
        $out['lat'] = exif_coord($exif['GPSLatitude'], (string) ($exif['GPSLatitudeRef'] ?? 'N'));
        $out['lng'] = exif_coord($exif['GPSLongitude'], (string) ($exif['GPSLongitudeRef'] ?? 'E'));
    }
    $dt = $exif['DateTimeOriginal'] ?? ($exif['DateTime'] ?? null);
    if (is_string($dt) && preg_match('/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/', $dt, $m)) {
        $out['date'] = sprintf('%s-%s-%sT%s:%s:%sZ', $m[1], $m[2], $m[3], $m[4], $m[5], $m[6]);
    }
    return $out;
}

// Verkleinern + Metadaten strippen + Orientation anwenden erledigt jetzt
// tl_normalize_jpeg() aus api/image-process.php (gemeinsam mit upload.php).

// ---- Hauptlauf -------------------------------------------------------

$pdo = db();
$conns = $pdo->query('SELECT * FROM webdav_connections WHERE active = 1')->fetchAll();
logline(count($conns) . ' aktive Verbindung(en).');

foreach ($conns as $c) {
    $cid = (int) $c['id'];
    $pid = (int) $c['presentation_id'];
    $uid = (int) $c['user_id'];
    $fail = function (string $msg) use ($pdo, $cid) {
        $st = $pdo->prepare('UPDATE webdav_connections SET last_poll_at = ?, last_error = ? WHERE id = ?');
        $st->execute([now_iso(), $msg, $cid]);
        logline("Verbindung $cid: FEHLER — $msg");
    };

    $pass = tl_decrypt($c['secret_cipher'], $c['secret_nonce']);
    if ($pass === null) {
        $fail('Passwort nicht entschlüsselbar (Serverschlüssel geändert?).');
        continue;
    }

    $res = tl_dav_request('list', $c['url'], $c['username'], $pass);
    if (!$res['ok']) {
        $fail($res['error']);
        continue;
    }
    if ($res['status'] === 401 || $res['status'] === 403) {
        $fail('Anmeldung abgelehnt (HTTP ' . $res['status'] . ').');
        continue;
    }
    if ($res['status'] >= 300) {
        $fail('WebDAV-Server: HTTP ' . $res['status']);
        continue;
    }

    $hrefs = tl_dav_list_images($res['body'], $c['url']);
    $seen = json_decode($c['seen_files_json'] ?: '[]', true) ?: [];
    $new = array_values(array_diff($hrefs, $seen));
    logline("Verbindung $cid: " . count($hrefs) . ' Bilder gelistet, ' . count($new) . ' neu.');
    if (!$new) {
        $st = $pdo->prepare('UPDATE webdav_connections SET last_poll_at = ?, last_error = NULL WHERE id = ?');
        $st->execute([now_iso(), $cid]);
        continue;
    }
    $new = array_slice($new, 0, TL_MAX_PER_RUN);

    // Präsentations-Zustand laden
    $st = $pdo->prepare('SELECT data_json FROM presentations WHERE id = ?');
    $st->execute([$pid]);
    $dataJson = $st->fetchColumn();
    if ($dataJson === false) {
        $fail('Ziel-Präsentation existiert nicht mehr.');
        continue;
    }
    $data = json_decode((string) $dataJson, true) ?: [];
    $pois = (isset($data['pois']) && is_array($data['pois'])) ? $data['pois'] : [];

    $dir = tl_data_dir() . '/uploads/' . $uid . '/' . $pid;
    if (!is_dir($dir) && !@mkdir($dir, 0770, true) && !is_dir($dir)) {
        $fail('Upload-Verzeichnis nicht anlegbar.');
        continue;
    }

    $imported = 0;
    $skipped = 0;
    foreach ($new as $href) {
        $fileUrl = tl_dav_href_to_url($href, $c['url']);
        $get = tl_dav_request('get', $fileUrl, $c['username'], $pass);
        if (!$get['ok'] || $get['status'] >= 300) {
            logline("  $href: Abruf fehlgeschlagen — " . ($get['error'] ?? 'HTTP ' . $get['status']));
            // NICHT als gesehen markieren → nächster Lauf versucht es erneut
            continue;
        }
        $seen[] = $href; // ab hier gilt die Datei als behandelt

        $exif = read_exif_bytes($get['body']);
        if ($exif['lat'] === null || $exif['lng'] === null) {
            $skipped++;
            logline("  $href: kein GPS — übersprungen.");
            continue;
        }
        $small = tl_normalize_jpeg($get['body'], TL_TARGET_BYTES, TL_HARD_MAX_SIDE);
        if ($small === null) {
            $skipped++;
            logline("  $href: nicht dekodierbar — übersprungen.");
            continue;
        }

        $name = bin2hex(random_bytes(8)) . '.jpg';
        if (file_put_contents($dir . '/' . $name, $small) === false) {
            $fail('Bild nicht speicherbar (Schreibrechte?).');
            continue 2;
        }
        $takenAt = $exif['date'] ?? now_iso();
        $ins = $pdo->prepare(
            'INSERT INTO images (presentation_id, user_id, filename, lat, lng, taken_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        $ins->execute([$pid, $uid, $name, $exif['lat'], $exif['lng'], $takenAt, now_iso()]);
        $imgId = (int) $pdo->lastInsertId();

        $base = preg_replace('/\.[^.]+$/', '', rawurldecode(basename($href)));
        $pois[] = [
            'lat' => $exif['lat'], 'lng' => $exif['lng'],
            'name' => $base, 'link' => '', 'linkText' => '',
            'img' => 'api/image.php?id=' . $imgId,
            'createdAt' => $takenAt,
        ];
        $imported++;
        logline("  $href: importiert (Bild $imgId).");
    }

    if ($imported > 0) {
        // Nummerierung folgt dem Aufnahmedatum (wie sortPois 'date','asc')
        usort($pois, fn($a, $b) => strcmp((string) ($a['createdAt'] ?? ''), (string) ($b['createdAt'] ?? '')));
        $data['pois'] = $pois;
        $st = $pdo->prepare('UPDATE presentations SET data_json = ?, updated_at = ? WHERE id = ?');
        $st->execute([json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), now_iso(), $pid]);
    }

    $st = $pdo->prepare('UPDATE webdav_connections SET last_poll_at = ?, last_error = NULL, seen_files_json = ? WHERE id = ?');
    $st->execute([now_iso(), json_encode(array_values($seen)), $cid]);
    logline("Verbindung $cid: $imported importiert, $skipped übersprungen.");
}

logline('Fertig.');
