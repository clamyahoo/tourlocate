<?php
// PDO/SQLite-Verbindung und Schema-Migration.
// db() liefert eine gecachte PDO-Instanz; beim ersten Aufruf wird das
// Schema angelegt (idempotent via CREATE TABLE IF NOT EXISTS).

declare(strict_types=1);

function tl_config(): array
{
    static $cfg = null;
    if ($cfg === null) {
        $path = __DIR__ . '/config.php';
        if (!is_file($path)) {
            http_response_code(500);
            exit('config.php fehlt — bitte api/config.sample.php nach api/config.php kopieren und anpassen.');
        }
        $cfg = require $path;
    }
    return $cfg;
}

function tl_data_dir(): string
{
    $dir = tl_config()['data_dir'];
    if (!is_dir($dir)) {
        @mkdir($dir, 0770, true);
    }
    // Direktzugriff auf DB und Uploads per Apache unterbinden. data/ liegt
    // nicht im Repo (siehe app/.gitignore), daher hier zur Laufzeit anlegen.
    $ht = $dir . '/.htaccess';
    if (!is_file($ht)) {
        @file_put_contents($ht, "Require all denied\nDeny from all\n");
    }
    return $dir;
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }

    $file = tl_data_dir() . '/tourlocate.sqlite';
    $pdo = new PDO('sqlite:' . $file, null, null, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
    $pdo->exec('PRAGMA journal_mode = WAL');
    $pdo->exec('PRAGMA foreign_keys = ON');
    tl_migrate($pdo);
    return $pdo;
}

function tl_migrate(PDO $pdo): void
{
    $pdo->exec(<<<'SQL'
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            email         TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at    TEXT NOT NULL
        );
    SQL);

    $pdo->exec(<<<'SQL'
        CREATE TABLE IF NOT EXISTS presentations (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title               TEXT NOT NULL,
            line_mode           TEXT NOT NULL DEFAULT 'route',
            profile             TEXT NOT NULL DEFAULT 'car',
            data_json           TEXT NOT NULL DEFAULT '{}',
            share_token         TEXT UNIQUE,
            share_password_hash TEXT,
            created_at          TEXT NOT NULL,
            updated_at          TEXT NOT NULL
        );
    SQL);

    $pdo->exec(<<<'SQL'
        CREATE TABLE IF NOT EXISTS images (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            presentation_id INTEGER NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
            user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            filename        TEXT NOT NULL,
            lat             REAL,
            lng             REAL,
            taken_at        TEXT,
            created_at      TEXT NOT NULL
        );
    SQL);

    $pdo->exec(<<<'SQL'
        CREATE TABLE IF NOT EXISTS rate_limits (
            key           TEXT PRIMARY KEY,
            fails         INTEGER NOT NULL DEFAULT 0,
            window_start  INTEGER NOT NULL,
            blocked_until INTEGER
        );
    SQL);

    $pdo->exec(<<<'SQL'
        CREATE TABLE IF NOT EXISTS webdav_connections (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            presentation_id INTEGER NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
            url             TEXT NOT NULL,
            username        TEXT NOT NULL,
            secret_cipher   BLOB NOT NULL,
            secret_nonce    BLOB NOT NULL,
            active          INTEGER NOT NULL DEFAULT 1,
            last_poll_at    TEXT,
            last_error      TEXT,
            seen_files_json TEXT NOT NULL DEFAULT '[]',
            created_at      TEXT NOT NULL
        );
    SQL);
}
