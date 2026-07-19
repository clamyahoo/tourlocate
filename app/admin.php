<?php
// Admin-Panel: Nutzerverwaltung, Inhalts-Einblick (nur-lesend, auditiert),
// Audit-Log. Zugang nur für Konten mit is_admin (siehe make-admin.php).
declare(strict_types=1);
require_once __DIR__ . '/api/bootstrap.php';

$uid = current_user_id();
if ($uid === null || !is_admin_user($uid)) {
    header('Location: index.php');
    exit;
}
$csrf = csrf_token();
?>
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tourlocate — Administration</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css">
<link rel="icon" type="image/png" href="../img/logo.png">
<style>
  body{margin:0;font-family:system-ui,sans-serif;background:#f4f6f8;color:#1a1a1a}
  .bar{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;
       background:#fff;border-bottom:1px solid #e2e8f0}
  .brand{display:flex;align-items:center;gap:10px}
  .brand img{width:32px;height:32px;border-radius:50%}
  .wrap{max-width:960px;margin:24px auto;padding:0 16px}
  h1{font-size:20px;margin:0 0 4px}
  .note{font-size:12px;color:#8a5a00;background:#fff7e6;border:1px solid #f0d9a8;
        border-radius:8px;padding:8px 12px;margin:10px 0 18px}
  h2{font-size:16px;margin:26px 0 10px}
  table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;
        border-radius:10px;overflow:hidden;font-size:13px}
  th,td{padding:8px 10px;text-align:left;border-bottom:1px solid #eef2f6;vertical-align:top}
  th{background:#f8fafc;font-weight:600}
  tr:last-child td{border-bottom:0}
  button{padding:5px 10px;border:1px solid #cbd2d9;border-radius:6px;background:#fff;
         cursor:pointer;font:inherit;font-size:12px}
  button.danger{color:#c0392b;border-color:#e3b0ab}
  .badge{display:inline-block;font-size:11px;border-radius:20px;padding:1px 8px;margin-left:4px}
  .badge.admin{background:#e6f0fb;color:#2b6cb0}
  .badge.blocked{background:#fdecea;color:#c0392b}
  .badge.shared{background:#e8f6ec;color:#1e7d34}
  .msg{font-size:13px;color:#c0392b;min-height:1em;margin-top:10px}
  #presPanel{display:none;background:#fff;border:1px solid #e2e8f0;border-radius:10px;
             padding:14px 16px;margin-top:10px}
  #viewMap{height:340px;border-radius:8px;margin-top:10px;display:none}
  .poi-num{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;
           background:#2b6cb0;color:#fff;font-weight:700;font-size:13px;border:2px solid #fff;
           box-shadow:0 0 4px rgba(0,0,0,.3)}
  a.plain{color:#2b6cb0}
</style>
</head>
<body>
<div class="bar">
  <div class="brand">
    <img src="../img/logo.png" alt="" onerror="this.style.display='none'">
    <strong>Tourlocate — Administration</strong>
  </div>
  <div><a class="plain" href="dashboard.php">Zum Dashboard</a></div>
</div>

<div class="wrap">
  <h1>Nutzerverwaltung</h1>
  <div class="note">Jeder Einblick in fremde Präsentationen und jede Verwaltungsaktion wird
  im Audit-Log protokolliert. Einsicht nur anlassbezogen vornehmen (z. B. bei einer
  Meldung wegen rechtswidriger Inhalte).</div>

  <table id="usersTable">
    <thead><tr><th>ID</th><th>E-Mail</th><th>Registriert</th><th>Präsentationen</th>
    <th>Bilder</th><th>Status</th><th>Aktionen</th></tr></thead>
    <tbody></tbody>
  </table>

  <div id="presPanel">
    <strong id="presTitle"></strong>
    <table id="presTable" style="margin-top:8px">
      <thead><tr><th>ID</th><th>Titel</th><th>Bilder</th><th>Geteilt</th><th>Geändert</th><th>Aktionen</th></tr></thead>
      <tbody></tbody>
    </table>
    <div id="viewMap"></div>
  </div>

  <h2>Audit-Log (letzte 200 Einträge)</h2>
  <table id="auditTable">
    <thead><tr><th>Zeit</th><th>Admin</th><th>Aktion</th><th>Nutzer</th><th>Präs.</th><th>Detail</th></tr></thead>
    <tbody></tbody>
  </table>

  <div class="msg" id="msg"></div>
</div>

<script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const CSRF = <?= json_encode($csrf) ?>;
const msg = document.getElementById('msg');
const esc = s => String(s==null?'':s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt = iso => { const d=new Date(iso); return isNaN(d)?'':d.toLocaleString('de-DE',{dateStyle:'short',timeStyle:'short'}); };

async function api(action, body, params='') {
  const opts = { headers: { 'X-CSRF-Token': CSRF } };
  if (body) {
    opts.method='POST';
    opts.headers['Content-Type']='application/json';
    opts.body=JSON.stringify({ ...body, csrf: CSRF });
  }
  const res = await fetch('api/admin.php?action='+action+params, opts);
  return res.json().catch(()=>({}));
}

async function loadUsers() {
  const d = await api('users');
  if (!d.ok) { msg.textContent = d.error || 'Fehler.'; return; }
  document.querySelector('#usersTable tbody').innerHTML = d.users.map(u => `
    <tr data-id="${u.id}" data-email="${esc(u.email)}">
      <td>${u.id}</td>
      <td>${esc(u.email)}${u.is_admin?'<span class="badge admin">Admin</span>':''}${u.blocked?'<span class="badge blocked">gesperrt</span>':''}</td>
      <td>${fmt(u.created_at)}</td>
      <td>${u.pres_count}</td>
      <td>${u.image_count}</td>
      <td>${u.blocked?'gesperrt':'aktiv'}</td>
      <td>
        <button data-act="pres">Inhalte</button>
        ${u.is_admin?'':`<button data-act="block">${u.blocked?'Entsperren':'Sperren'}</button>
        <button class="danger" data-act="del">Löschen</button>`}
      </td>
    </tr>`).join('');
}

document.querySelector('#usersTable tbody').addEventListener('click', async e => {
  const btn = e.target.closest('button'); if (!btn) return;
  const tr = e.target.closest('tr'); const id = Number(tr.dataset.id); const email = tr.dataset.email;
  msg.textContent = '';
  if (btn.dataset.act === 'pres') {
    const d = await api('presentations', null, '&user_id='+id);
    if (!d.ok) { msg.textContent = d.error||'Fehler.'; return; }
    document.getElementById('presPanel').style.display='block';
    document.getElementById('presTitle').textContent = 'Präsentationen von ' + email;
    document.getElementById('viewMap').style.display='none';
    document.querySelector('#presTable tbody').innerHTML = d.presentations.map(p => `
      <tr data-id="${p.id}">
        <td>${p.id}</td><td>${esc(p.title)}</td><td>${p.image_count}</td>
        <td>${p.shared?'<span class="badge shared">ja</span>':'nein'}</td>
        <td>${fmt(p.updated_at)}</td>
        <td><button data-act="view">Ansehen (auditiert)</button>
            <button class="danger" data-act="delpres">Löschen</button></td>
      </tr>`).join('') || '<tr><td colspan="6">Keine Präsentationen.</td></tr>';
    document.getElementById('presPanel').scrollIntoView({behavior:'smooth'});
  } else if (btn.dataset.act === 'block') {
    const blocked = btn.textContent === 'Sperren' ? 1 : 0;
    if (!confirm((blocked?'Sperren':'Entsperren')+': '+email+'?')) return;
    const d = await api('block', { user_id: id, blocked });
    if (d.ok) { loadUsers(); loadAudit(); } else msg.textContent = d.error||'Fehler.';
  } else if (btn.dataset.act === 'del') {
    if (!confirm('Konto '+email+' MIT ALLEN INHALTEN endgültig löschen?')) return;
    if (!confirm('Wirklich sicher? Das kann nicht rückgängig gemacht werden.')) return;
    const d = await api('deleteuser', { user_id: id });
    if (d.ok) { document.getElementById('presPanel').style.display='none'; loadUsers(); loadAudit(); }
    else msg.textContent = d.error||'Fehler.';
  }
});

let viewMap = null, viewLayer = null;
document.querySelector('#presTable tbody').addEventListener('click', async e => {
  const btn = e.target.closest('button'); if (!btn) return;
  const id = Number(e.target.closest('tr').dataset.id);
  msg.textContent = '';
  if (btn.dataset.act === 'view') {
    const d = await api('presentation', null, '&id='+id);
    if (!d.ok) { msg.textContent = d.error||'Fehler.'; return; }
    const el = document.getElementById('viewMap');
    el.style.display='block';
    if (!viewMap) { viewMap = L.map('viewMap'); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap-Mitwirkende'}).addTo(viewMap); }
    if (viewLayer) viewLayer.remove();
    viewLayer = L.featureGroup().addTo(viewMap);
    (d.presentation.data.pois||[]).forEach((p,i) => {
      const icon = L.divIcon({className:'poi-num', html:String(i+1), iconSize:[26,26], iconAnchor:[13,13]});
      L.marker([p.lat,p.lng],{icon}).addTo(viewLayer)
        .bindPopup('<strong>'+esc((i+1)+'. '+(p.name||'Station'))+'</strong>'
          + (p.img ? '<br><img src="'+esc(p.img)+'" style="max-width:150px;max-height:110px;margin-top:6px;border-radius:6px">' : ''));
    });
    setTimeout(() => {
      viewMap.invalidateSize();
      const b = viewLayer.getBounds();
      if (b.isValid()) viewMap.fitBounds(b.pad(0.2)); else viewMap.setView([51,10],5);
    }, 50);
    loadAudit(); // der Einblick ist soeben protokolliert worden
  } else if (btn.dataset.act === 'delpres') {
    if (!confirm('Präsentation #'+id+' mit allen Bildern löschen?')) return;
    const d = await api('deletepresentation', { id });
    if (d.ok) { loadUsers(); loadAudit(); document.getElementById('viewMap').style.display='none'; }
    else msg.textContent = d.error||'Fehler.';
  }
});

async function loadAudit() {
  const d = await api('audit');
  if (!d.ok) return;
  document.querySelector('#auditTable tbody').innerHTML = d.audit.map(a => `
    <tr><td>${fmt(a.created_at)}</td><td>${esc(a.admin_email)}</td><td>${esc(a.action)}</td>
    <td>${a.target_user_id??''}</td><td>${a.target_pres_id??''}</td><td>${esc(a.detail)}</td></tr>`).join('')
    || '<tr><td colspan="6">Noch keine Einträge.</td></tr>';
}

loadUsers(); loadAudit();
</script>
</body>
</html>
