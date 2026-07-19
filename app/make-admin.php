<?php
// Ernennt ein bestehendes Konto zum Admin (nur Kommandozeile):
//   php app/make-admin.php mail@example.org
// Mit --revoke wird der Admin-Status wieder entzogen.
// Bewusst NICHT über die Web-UI möglich — wer die Kommandozeile des
// Servers bedienen kann, ist ohnehin Betreiber.

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("Nur per Kommandozeile ausführbar.\n");
}

require_once __DIR__ . '/api/db.php';

$args = array_values(array_filter(array_slice($argv, 1), fn($a) => $a !== '--revoke'));
$revoke = in_array('--revoke', $argv, true);
$email = strtolower(trim($args[0] ?? ''));

if ($email === '') {
    fwrite(STDERR, "Aufruf: php make-admin.php [--revoke] mail@example.org\n");
    exit(1);
}

$st = db()->prepare('SELECT id, is_admin FROM users WHERE email = ?');
$st->execute([$email]);
$user = $st->fetch();
if (!$user) {
    fwrite(STDERR, "Kein Konto mit dieser E-Mail-Adresse gefunden: $email\n");
    exit(1);
}

$flag = $revoke ? 0 : 1;
db()->prepare('UPDATE users SET is_admin = ? WHERE id = ?')->execute([$flag, (int) $user['id']]);
echo $revoke
    ? "Admin-Status entzogen: $email\n"
    : "Konto ist jetzt Admin: $email\n";
