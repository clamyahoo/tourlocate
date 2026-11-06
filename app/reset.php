<?php
// Öffentliche Seite zum Setzen eines neuen Passworts per Reset-Token.
//   reset.php?token=<token aus der E-Mail>
// Die eigentliche Prüfung des Tokens passiert serverseitig beim Absenden
// (api/auth.php?action=resetpassword) — hier nur das Formular.
declare(strict_types=1);
require_once __DIR__ . '/api/bootstrap.php';

if (current_user_id() !== null) {
    header('Location: dashboard.php');
    exit;
}
$csrf  = csrf_token();
$token = (string) ($_GET['token'] ?? '');
?>
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tourlocate — Passwort zurücksetzen</title>
<link rel="icon" type="image/png" href="../img/logo.png">
<style>
  body{margin:0;font-family:system-ui,sans-serif;background:#f4f6f8;color:#1a1a1a;
       display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}
  .card{background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.1);
        padding:28px 26px;width:100%;max-width:360px}
  .brand{display:flex;align-items:center;gap:10px;margin-bottom:18px}
  .brand img{width:36px;height:36px;border-radius:50%}
  .brand strong{font-size:20px}
  h1{font-size:16px;margin:0 0 14px;font-weight:600}
  label{display:block;font-size:13px;margin:10px 0 4px;color:#444}
  input{width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid #cbd2d9;
        border-radius:7px;font:inherit}
  button{width:100%;margin-top:16px;padding:10px;border:0;border-radius:7px;
         background:#2b6cb0;color:#fff;font:inherit;font-weight:600;cursor:pointer}
  button:disabled{opacity:.6;cursor:not-allowed}
  .msg{margin-top:12px;font-size:13px;min-height:1em}
  .msg.err{color:#c0392b}
  .msg.ok{color:#1e7d34}
  a{color:#2b6cb0}
  .foot{margin-top:16px;text-align:center;font-size:13px}
</style>
</head>
<body>
<div class="card">
  <div class="brand">
    <img src="../img/logo.png" alt="" onerror="this.style.display='none'">
    <strong>Tourlocate</strong>
  </div>
  <h1>Neues Passwort setzen</h1>
  <form id="resetForm">
    <label for="pw1">Neues Passwort</label>
    <input id="pw1" type="password" autocomplete="new-password" minlength="12" placeholder="mind. 12 Zeichen" required>
    <label for="pw2">Neues Passwort wiederholen</label>
    <input id="pw2" type="password" autocomplete="new-password" minlength="12" required>
    <button type="submit" id="submitBtn">Passwort speichern</button>
  </form>
  <div class="msg" id="msg"></div>
  <div class="foot"><a href="index.php">Zur Anmeldung</a></div>
</div>

<script>
const CSRF = <?= json_encode($csrf) ?>, TOKEN = <?= json_encode($token) ?>;
const msg = document.getElementById('msg');
const submitBtn = document.getElementById('submitBtn');

if (!TOKEN) {
  msg.className = 'msg err';
  msg.textContent = 'Dieser Link ist unvollständig. Bitte den Link aus der E-Mail vollständig öffnen.';
  submitBtn.disabled = true;
}

document.getElementById('resetForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.className = 'msg';
  const pw1 = document.getElementById('pw1').value;
  const pw2 = document.getElementById('pw2').value;
  if (pw1.length < 12) { msg.className = 'msg err'; msg.textContent = 'Das Passwort muss mindestens 12 Zeichen lang sein.'; return; }
  if (pw1 !== pw2)    { msg.className = 'msg err'; msg.textContent = 'Die beiden Passwörter stimmen nicht überein.'; return; }
  submitBtn.disabled = true;
  msg.textContent = 'Moment…';
  try {
    const res = await fetch('api/auth.php?action=resetpassword', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF },
      body: JSON.stringify({ token: TOKEN, new: pw1, csrf: CSRF })
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      msg.className = 'msg ok';
      msg.textContent = 'Passwort geändert ✓ — du kannst dich jetzt anmelden.';
      document.getElementById('resetForm').style.display = 'none';
    } else {
      msg.className = 'msg err';
      msg.textContent = data.error || 'Fehler.';
      submitBtn.disabled = false;
    }
  } catch (err) {
    msg.className = 'msg err';
    msg.textContent = 'Verbindungsfehler: ' + err.message;
    submitBtn.disabled = false;
  }
});
</script>
</body>
</html>
