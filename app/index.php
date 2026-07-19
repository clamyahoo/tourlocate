<?php
// Einstiegsseite der User-Version: angemeldet → weiter zum Dashboard,
// sonst Login-/Registrierungsformular.
declare(strict_types=1);
require_once __DIR__ . '/api/bootstrap.php';

if (current_user_id() !== null) {
    header('Location: dashboard.php');
    exit;
}
$csrf = csrf_token();

// Registrierung: Modus + ggf. mitgeschickter Einladungs-Token
$regMode = tl_registration_mode();
$inviteToken = trim((string) ($_GET['invite'] ?? ''));
$inviteValid = false;
if ($regMode === 'invite' && $inviteToken !== '') {
    $st = db()->prepare('SELECT 1 FROM invites WHERE token = ? AND used_by IS NULL');
    $st->execute([$inviteToken]);
    $inviteValid = (bool) $st->fetchColumn();
}
// Selbstregistrierung möglich? (offen; oder Einladung mit gültigem Token)
$canRegister = $regMode === 'open' || ($regMode === 'invite' && $inviteValid);
?>
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tourlocate — Anmelden</title>
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
  .switch{margin-top:14px;font-size:13px;text-align:center;color:#555}
  .switch a{color:#2b6cb0;cursor:pointer;text-decoration:underline}
  .msg{margin-top:12px;font-size:13px;min-height:1em}
  .msg.err{color:#c0392b}
  .msg.ok{color:#1e7d34}
</style>
</head>
<body>
<div class="card">
  <div class="brand">
    <img src="../img/logo.png" alt="" onerror="this.style.display='none'">
    <strong>Tourlocate</strong>
  </div>
  <h1 id="formTitle">Anmelden</h1>
  <form id="authForm" autocomplete="on">
    <label for="email">E-Mail</label>
    <input id="email" name="email" type="email" required autocomplete="email">
    <label for="password">Passwort</label>
    <input id="password" name="password" type="password" required
           autocomplete="current-password" minlength="8">
    <div id="totpRow" style="display:none">
      <label for="totpCode">Code aus der Authenticator-App (oder Recovery-Code)</label>
      <input id="totpCode" type="text" inputmode="numeric" autocomplete="one-time-code"
             placeholder="123456">
    </div>
    <button type="submit" id="submitBtn">Anmelden</button>
  </form>
  <div class="switch" id="switchLine">
    <?php if ($canRegister): ?>Noch kein Konto? <a id="switchLink">Registrieren</a>
    <?php elseif ($regMode === 'invite'): ?><span style="color:#889">Registrierung nur mit Einladung.</span>
    <?php endif; ?>
  </div>
  <div class="msg" id="msg"></div>
  <div style="margin-top:16px;text-align:center;font-size:12px">
    <a href="impressum.php" style="color:#889">Impressum</a> ·
    <a href="datenschutz.php" style="color:#889">Datenschutz</a>
  </div>
</div>

<script>
const CSRF = <?= json_encode($csrf) ?>;
let mode = 'login'; // 'login' | 'register'

const title = document.getElementById('formTitle');
const submitBtn = document.getElementById('submitBtn');
const switchLine = document.getElementById('switchLine');
const switchLink = document.getElementById('switchLink');
const pwInput = document.getElementById('password');
const msg = document.getElementById('msg');

function setMode(m) {
  mode = m;
  if (m === 'login') {
    title.textContent = 'Anmelden';
    submitBtn.textContent = 'Anmelden';
    switchLine.innerHTML = 'Noch kein Konto? <a id="switchLink">Registrieren</a>';
    pwInput.autocomplete = 'current-password';
  } else {
    title.textContent = 'Konto erstellen';
    submitBtn.textContent = 'Registrieren';
    switchLine.innerHTML = 'Schon ein Konto? <a id="switchLink">Anmelden</a>';
    pwInput.autocomplete = 'new-password';
  }
  const sl = document.getElementById('switchLink');
  if (sl) sl.onclick = () => setMode(m === 'login' ? 'register' : 'login');
  msg.textContent = '';
}
const CAN_REGISTER = <?= $canRegister ? 'true' : 'false' ?>;
const INVITE_TOKEN = <?= json_encode($inviteToken) ?>;
if (switchLink) switchLink.onclick = () => setMode('register');
// Mit gültigem Einladungslink direkt im Registrierungsmodus starten
if (CAN_REGISTER && INVITE_TOKEN) setMode('register');

let awaiting2fa = false;

document.getElementById('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  submitBtn.disabled = true;
  msg.className = 'msg';
  msg.textContent = 'Moment…';
  try {
    // Zweiter Schritt: nur den 2FA-Code schicken
    const action = awaiting2fa ? 'totp' : mode;
    const body = awaiting2fa
      ? { code: document.getElementById('totpCode').value.trim(), csrf: CSRF }
      : { email: document.getElementById('email').value, password: pwInput.value, csrf: CSRF,
          invite: (mode === 'register' ? INVITE_TOKEN : undefined) };
    const res = await fetch('api/auth.php?action=' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.ok && data.need2fa) {
      // Passwort ok, Konto hat 2FA → Code-Eingabe zeigen
      awaiting2fa = true;
      document.getElementById('totpRow').style.display = 'block';
      document.getElementById('email').disabled = true;
      pwInput.disabled = true;
      submitBtn.textContent = 'Code bestätigen';
      msg.textContent = '';
      document.getElementById('totpCode').focus();
    } else if (data.ok) {
      msg.className = 'msg ok';
      msg.textContent = 'Erfolgreich — weiter…';
      location.href = 'dashboard.php';
    } else {
      msg.className = 'msg err';
      msg.textContent = data.error || 'Fehler.';
    }
  } catch (err) {
    msg.className = 'msg err';
    msg.textContent = 'Verbindungsfehler: ' + err.message;
  } finally {
    submitBtn.disabled = false;
  }
});
</script>
</body>
</html>
