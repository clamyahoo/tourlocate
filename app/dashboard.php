<?php
// Vorläufiges Dashboard (wird in der nächsten Scheibe zur Präsentations-
// Liste ausgebaut). Vorerst nur Login-Nachweis + Abmelden.
declare(strict_types=1);
require_once __DIR__ . '/api/bootstrap.php';

$uid = current_user_id();
if ($uid === null) {
    header('Location: index.php');
    exit;
}
$st = db()->prepare('SELECT email FROM users WHERE id = ?');
$st->execute([$uid]);
$email = $st->fetchColumn();
$csrf = csrf_token();
?>
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tourlocate — Dashboard</title>
<link rel="icon" type="image/png" href="../img/logo.png">
<style>
  body{margin:0;font-family:system-ui,sans-serif;background:#f4f6f8;color:#1a1a1a;padding:24px}
  .bar{display:flex;align-items:center;justify-content:space-between;max-width:800px;margin:0 auto 20px}
  .brand{display:flex;align-items:center;gap:10px}
  .brand img{width:32px;height:32px;border-radius:50%}
  button{padding:8px 14px;border:1px solid #cbd2d9;border-radius:7px;background:#fff;cursor:pointer;font:inherit}
</style>
</head>
<body>
<div class="bar">
  <div class="brand">
    <img src="../img/logo.png" alt="" onerror="this.style.display='none'">
    <strong>Tourlocate</strong>
  </div>
  <button id="logoutBtn">Abmelden</button>
</div>
<p style="max-width:800px;margin:0 auto">Angemeldet als <strong><?= htmlspecialchars($email, ENT_QUOTES) ?></strong>.
Das Dashboard mit deinen Präsentationen entsteht im nächsten Schritt.</p>

<script>
const CSRF = <?= json_encode($csrf) ?>;
document.getElementById('logoutBtn').onclick = async () => {
  await fetch('api/auth.php?action=logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF },
    body: JSON.stringify({ csrf: CSRF })
  });
  location.href = 'index.php';
};
</script>
</body>
</html>
