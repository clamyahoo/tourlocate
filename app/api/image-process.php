<?php
// Server-seitige Bild-Normalisierung mit GD.
//
// Zweck (Datenschutz): Ein hochgeladenes oder per WebDAV geholtes JPEG
// wird komplett neu kodiert. Dabei fallen ALLE EXIF-/Metadaten weg
// (Kameramodell, Seriennummer, Software, Originaldateiname im EXIF …).
// Erhalten bleiben nur die Bildpunkte; Geoposition, Aufnahmedatum und
// Dateiname werden getrennt in der Datenbank geführt (nicht im Bild).
//
// Vorher wird die EXIF-Orientation ausgewertet und in die Pixel gedreht,
// damit Hochkant-Fotos nach dem Strippen nicht querliegen (die
// Orientation-Angabe selbst ist danach ja weg).

declare(strict_types=1);

// Orientation-Wert (1..8) aus JPEG-Bytes lesen; 1 = normal / unbekannt.
function tl_jpeg_orientation(string $jpeg): int
{
    if (!function_exists('exif_read_data')) {
        return 1;
    }
    $exif = @exif_read_data('data://image/jpeg;base64,' . base64_encode($jpeg));
    return (is_array($exif) && isset($exif['Orientation'])) ? (int) $exif['Orientation'] : 1;
}

// EXIF-Orientation in die Pixel anwenden. imagerotate dreht gegen den
// Uhrzeigersinn (positive Winkel), daher -90 zum Korrigieren von 6 usw.
// Gibt das (ggf. neue) GD-Bild zurück; ersetzte Bilder werden freigegeben.
function tl_apply_orientation($img, int $orientation)
{
    switch ($orientation) {
        case 2: imageflip($img, IMG_FLIP_HORIZONTAL); return $img;
        case 3: $r = imagerotate($img, 180, 0); imagedestroy($img); return $r;
        case 4: imageflip($img, IMG_FLIP_VERTICAL); return $img;
        case 5: $r = imagerotate($img, -90, 0); imagedestroy($img); imageflip($r, IMG_FLIP_HORIZONTAL); return $r;
        case 6: $r = imagerotate($img, -90, 0); imagedestroy($img); return $r;
        case 7: $r = imagerotate($img, 90, 0); imagedestroy($img); imageflip($r, IMG_FLIP_HORIZONTAL); return $r;
        case 8: $r = imagerotate($img, 90, 0); imagedestroy($img); return $r;
        default: return $img;
    }
}

// JPEG neu kodieren: Orientation anwenden, Metadaten strippen, auf
// ~$targetBytes verkleinern (erst Qualität, dann Kantenlänge — wie
// fileToTargetJpeg im Browser). Rückgabe: JPEG-Bytes ohne EXIF, oder null
// (nicht dekodierbar).
function tl_normalize_jpeg(string $jpeg, int $targetBytes = 204800, int $hardMaxSide = 1600): ?string
{
    $orientation = tl_jpeg_orientation($jpeg);
    $src = @imagecreatefromstring($jpeg); // GD liest keine EXIF → Metadaten sind damit weg
    if ($src === false) {
        return null;
    }
    $src = tl_apply_orientation($src, $orientation);

    $w = imagesx($src);
    $h = imagesy($src);
    $maxSide = min($hardMaxSide, max($w, $h));
    $best = null;

    for ($round = 0; $round < 6; $round++) {
        $scale = min(1.0, $maxSide / max($w, $h));
        $nw = max(1, (int) round($w * $scale));
        $nh = max(1, (int) round($h * $scale));
        $img = imagecreatetruecolor($nw, $nh);
        imagecopyresampled($img, $src, 0, 0, 0, 0, $nw, $nh, $w, $h);

        foreach ([85, 72, 60, 50] as $q) {
            ob_start();
            imagejpeg($img, null, $q); // schreibt KEINE EXIF-Daten
            $bytes = (string) ob_get_clean();
            if ($best === null || strlen($bytes) < strlen($best)) {
                $best = $bytes;
            }
            if (strlen($bytes) <= $targetBytes) {
                imagedestroy($img);
                imagedestroy($src);
                return $bytes;
            }
        }
        imagedestroy($img);
        $maxSide = (int) round($maxSide * 0.8);
        if ($maxSide < 480) {
            break;
        }
    }
    imagedestroy($src);
    return $best;
}
