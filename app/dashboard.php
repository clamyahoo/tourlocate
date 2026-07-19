<?php
// Dashboard: Liste der eigenen Präsentationen mit Anlegen/Öffnen/
// Umbenennen/Löschen. Dynamik über api/presentations.php.
declare(strict_types=1);
require_once __DIR__ . '/api/bootstrap.php';

$uid = current_user_id();
if ($uid === null) {
    header('Location: index.php');
    exit;
}
$st = db()->prepare('SELECT email, is_admin FROM users WHERE id = ?');
$st->execute([$uid]);
$me = $st->fetch();
$email = (string) ($me['email'] ?? '');
$isAdmin = (int) ($me['is_admin'] ?? 0) === 1;
$csrf = csrf_token();
?>
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tourlocate — Meine Präsentationen</title>
<link rel="icon" type="image/png" href="../img/logo.png">
<style>
  body{margin:0;font-family:system-ui,sans-serif;background:#f4f6f8;color:#1a1a1a}
  .bar{display:flex;align-items:center;justify-content:space-between;
       padding:14px 20px;background:#fff;border-bottom:1px solid #e2e8f0}
  .brand{display:flex;align-items:center;gap:10px}
  .brand img{width:32px;height:32px;border-radius:50%}
  .brand strong{font-size:18px}
  .who{font-size:13px;color:#555;margin-right:12px}
  .wrap{max-width:820px;margin:24px auto;padding:0 16px}
  .head{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
  h1{font-size:20px;margin:0}
  button{padding:8px 14px;border:1px solid #cbd2d9;border-radius:7px;background:#fff;
         cursor:pointer;font:inherit}
  button.primary{background:#2b6cb0;color:#fff;border-color:#2b6cb0;font-weight:600}
  button.danger{color:#c0392b;border-color:#e3b0ab}
  .list{display:flex;flex-direction:column;gap:10px}
  .card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;
        display:flex;align-items:center;justify-content:space-between;gap:12px}
  .card .meta{min-width:0}
  .card .title{font-weight:600;font-size:15px;white-space:nowrap;overflow:hidden;
               text-overflow:ellipsis}
  .card .sub{font-size:12px;color:#667;margin-top:3px}
  .badge{display:inline-block;font-size:11px;background:#e6f0fb;color:#2b6cb0;
         border-radius:20px;padding:1px 8px;margin-left:6px}
  .actions{display:flex;gap:6px;flex:0 0 auto}
  .empty{color:#667;background:#fff;border:1px dashed #cbd2d9;border-radius:10px;
         padding:28px;text-align:center}
  .msg{font-size:13px;color:#c0392b;min-height:1em;margin-top:10px}
</style>
</head>
<body>
<div class="bar">
  <div class="brand">
    <img src="../img/logo.png" alt="" onerror="this.style.display='none'">
    <strong>Tourlocate</strong>
  </div>
  <div>
    <span class="who"><?= htmlspecialchars($email, ENT_QUOTES) ?></span>
    <?php if ($isAdmin): ?><a href="admin.php" style="margin-right:10px;color:#2b6cb0">Administration</a><?php endif; ?>
    <button id="logoutBtn">Abmelden</button>
  </div>
</div>

<div class="wrap">
  <div class="head">
    <h1>Meine Präsentationen</h1>
    <button class="primary" id="newBtn">+ Neue Präsentation</button>
  </div>
  <div class="list" id="list"></div>
  <div class="msg" id="msg"></div>
</div>

<script>
const CSRF = <?= json_encode($csrf) ?>;

async function api(action, body) {
  const opts = { headers: { 'X-CSRF-Token': CSRF } };
  if (body) {
    opts.method = 'POST';
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify({ ...body, csrf: CSRF });
  }
  const res = await fetch('api/presentations.php?action=' + action, opts);
  return res.json();
}

const msg = document.getElementById('msg');
const listEl = document.getElementById('list');

function fmtDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

async function load() {
  msg.textContent = '';
  const data = await api('list');
  if (!data.ok) { msg.textContent = data.error || 'Fehler beim Laden.'; return; }
  const items = data.presentations;
  if (!items.length) {
    listEl.innerHTML = '<div class="empty">Noch keine Präsentation. Leg mit „+ Neue Präsentation“ los.</div>';
    return;
  }
  listEl.innerHTML = items.map(p => `
    <div class="card" data-id="${p.id}">
      <div class="meta">
        <div class="title">${esc(p.title)}${p.shared ? '<span class="badge">geteilt</span>' : ''}</div>
        <div class="sub">${p.image_count} Bild${p.image_count === 1 ? '' : 'er'} · geändert ${esc(fmtDate(p.updated_at))}</div>
      </div>
      <div class="actions">
        <button data-act="open">Öffnen</button>
        <button data-act="rename">Umbenennen</button>
        <button class="danger" data-act="delete">Löschen</button>
      </div>
    </div>`).join('');
}

listEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('button'); if (!btn) return;
  const card = e.target.closest('.card'); const id = card.dataset.id;
  const act = btn.dataset.act;
  if (act === 'open') {
    location.href = 'editor.php?id=' + id;
  } else if (act === 'rename') {
    const cur = card.querySelector('.title').textContent.replace('geteilt','').trim();
    const title = prompt('Neuer Name:', cur);
    if (title === null) return;
    const r = await api('save', { id: Number(id), title });
    if (r.ok) load(); else msg.textContent = r.error || 'Fehler.';
  } else if (act === 'delete') {
    if (!confirm('Diese Präsentation und ihre Bilder wirklich löschen?')) return;
    const r = await api('delete', { id: Number(id) });
    if (r.ok) load(); else msg.textContent = r.error || 'Fehler.';
  }
});

document.getElementById('newBtn').onclick = async () => {
  const title = prompt('Name der neuen Präsentation:', 'Neue Präsentation');
  if (title === null) return;
  const r = await api('create', { title });
  if (r.ok) location.href = 'editor.php?id=' + r.id;
  else msg.textContent = r.error || 'Fehler.';
};

document.getElementById('logoutBtn').onclick = async () => {
  await fetch('api/auth.php?action=logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF },
    body: JSON.stringify({ csrf: CSRF })
  });
  location.href = 'index.php';
};

load();
</script>
</body>
</html>
