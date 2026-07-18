<?php
// Öffentliche Nur-Ansicht einer geteilten Präsentation.
//   view.php?t=<share_token>
// Kein Login nötig. Bei Passwortschutz erst ein Gate; nach korrekter
// Eingabe (api/share.php?action=unlock) merkt die Session die Freigabe.
declare(strict_types=1);
require_once __DIR__ . '/api/bootstrap.php';
tl_session_start();

$token = (string) ($_GET['t'] ?? '');

$st = db()->prepare(
    'SELECT id, title, line_mode, data_json, share_password_hash
       FROM presentations WHERE share_token = ?'
);
$st->execute([$token]);
$P = $token !== '' ? $st->fetch() : false;

// Kleine Fehlerseite
function view_message(string $html): void
{
    http_response_code(404);
    echo '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">'
       . '<meta name="viewport" content="width=device-width,initial-scale=1">'
       . '<title>Tourlocate</title><style>body{margin:0;font-family:system-ui,sans-serif;'
       . 'background:#f4f6f8;color:#1a1a1a;display:flex;min-height:100vh;align-items:center;'
       . 'justify-content:center;padding:20px;text-align:center}</style></head><body><div>'
       . $html . '</div></body></html>';
    exit;
}

if (!$P) {
    view_message('<h1>Nicht gefunden</h1><p>Dieser Link ist ungültig oder wurde deaktiviert.</p>');
}

$pid = (int) $P['id'];
$needsPassword = $P['share_password_hash'] !== null;
$unlocked = !empty($_SESSION['share_ok'][$pid]);

// ---- Passwort-Gate ---------------------------------------------------
if ($needsPassword && !$unlocked) {
    $csrf = csrf_token();
    ?>
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title><?= htmlspecialchars($P['title'], ENT_QUOTES) ?> — Tourlocate</title>
<link rel="icon" type="image/png" href="../img/logo.png">
<style>
  body{margin:0;font-family:system-ui,sans-serif;background:#f4f6f8;color:#1a1a1a;
       display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}
  .card{background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.1);
        padding:26px;width:100%;max-width:340px;text-align:center}
  h1{font-size:17px;margin:0 0 6px}
  p{font-size:13px;color:#555;margin:0 0 16px}
  input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #cbd2d9;border-radius:7px;font:inherit}
  button{width:100%;margin-top:12px;padding:10px;border:0;border-radius:7px;background:#2b6cb0;
         color:#fff;font:inherit;font-weight:600;cursor:pointer}
  .msg{margin-top:10px;font-size:13px;color:#c0392b;min-height:1em}
</style>
</head>
<body>
<div class="card">
  <h1><?= htmlspecialchars($P['title'], ENT_QUOTES) ?></h1>
  <p>Diese Präsentation ist passwortgeschützt.</p>
  <form id="f">
    <input id="pw" type="password" placeholder="Passwort" autocomplete="off" autofocus>
    <button type="submit">Ansehen</button>
  </form>
  <div class="msg" id="msg"></div>
</div>
<script>
const TOKEN = <?= json_encode($token) ?>, CSRF = <?= json_encode($csrf) ?>;
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('msg'); msg.textContent = '';
  const res = await fetch('api/share.php?action=unlock', {
    method:'POST', headers:{'Content-Type':'application/json','X-CSRF-Token':CSRF},
    body: JSON.stringify({ token: TOKEN, password: document.getElementById('pw').value })
  });
  const data = await res.json().catch(()=>({}));
  if (data.ok) location.reload();
  else msg.textContent = data.error || 'Fehler.';
});
</script>
</body>
</html>
    <?php
    exit;
}

// ---- Freigegebene Ansicht -------------------------------------------
$data = json_decode($P['data_json'] ?: '{}', true) ?: [];
$viewData = [
    'title'    => $P['title'],
    'lineMode' => $P['line_mode'],
    'pois'     => $data['pois'] ?? [],
    'route'    => $data['route'] ?? [],
];
$json = json_encode($viewData, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
$json = str_replace('<', '\\u003c', $json); // nie </script> in der Payload
?>
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title><?= htmlspecialchars($P['title'], ENT_QUOTES) ?> — Tourlocate</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css">
<link rel="icon" type="image/png" href="../img/logo.png">
<style>
  html,body{height:100%;margin:0;font-family:system-ui,sans-serif}
  #bar{display:flex;align-items:center;gap:10px;padding:8px 14px;background:#fff;border-bottom:1px solid #e2e8f0}
  #bar img{width:26px;height:26px;border-radius:50%}
  #bar strong{font-size:16px}
  #map{height:calc(100vh - 45px)}
  .poi-num{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;background:#2b6cb0;
           color:#fff;font-weight:700;font-size:13px;border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,.3)}
  .tl-card{font:12px/1.3 system-ui,sans-serif;display:flex;flex-direction:column;gap:6px}
  .tl-date{color:#777;font-size:11px}
  button.thumb{padding:0;border:0;background:none;cursor:zoom-in}
  .tl-thumb{width:120px;height:90px;background:#fff;border:1px solid #e6e6e6;border-radius:6px;
            display:inline-flex;align-items:center;justify-content:center;overflow:hidden}
  .tl-thumb>img{width:100%;height:100%;object-fit:contain;display:block}
</style>
</head>
<body>
<div id="bar">
  <img src="../img/logo.png" alt="" onerror="this.style.display='none'">
  <strong><?= htmlspecialchars($P['title'], ENT_QUOTES) ?></strong>
</div>
<div id="map"></div>

<script id="tl-data" type="application/json"><?= $json ?></script>
<script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function(){
  var D = JSON.parse(document.getElementById('tl-data').textContent);
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }

  var map = L.map('map').setView([0,0],2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom:19, attribution:'© OpenStreetMap-Mitwirkende'
  }).addTo(map);

  // Mini-Lightbox
  var W=document.createElement('div');
  W.style.cssText='position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.92);z-index:99999;padding:4vh';
  var I=document.createElement('img'); I.style.cssText='max-width:92vw;max-height:92vh;border-radius:10px';
  W.appendChild(I); document.body.appendChild(W);
  W.addEventListener('click', function(){ W.style.display='none'; I.removeAttribute('src'); });
  document.addEventListener('keydown', function(e){ if(e.key==='Escape'){ W.style.display='none'; } });
  document.addEventListener('click', function(e){
    var b=e.target.closest && e.target.closest('button.thumb'); if(!b) return;
    I.src=b.getAttribute('data-img'); W.style.display='flex';
  }, true);

  var markers=L.featureGroup().addTo(map);
  (D.pois||[]).forEach(function(p,i){
    var icon=L.divIcon({className:'poi-num', html:String(i+1), iconSize:[26,26], iconAnchor:[13,13]});
    var m=L.marker([p.lat,p.lng],{icon:icon}).addTo(markers);
    var title=(i+1)+'. '+(p.name||'Station');
    var dateHtml='';
    if (p.createdAt){ var d=new Date(p.createdAt); if(!isNaN(d)) dateHtml='<div class="tl-date">'+esc(d.toLocaleString('de-DE'))+'</div>'; }
    var linkHtml=p.link?'<div><a href="'+esc(p.link)+'" target="_blank" rel="noopener">'+esc(p.linkText||'Link')+'</a></div>':'';
    var imgHtml=p.img?'<div><button type="button" class="thumb" data-img="'+esc(p.img)+'"><span class="tl-thumb"><img src="'+esc(p.img)+'" alt=""></span></button></div>':'';
    m.bindPopup('<div class="tl-card"><strong>'+esc(title)+'</strong>'+dateHtml+linkHtml+imgHtml+'</div>');
  });

  // Verbindung gemäß Einstellung: keine / Linie / Route
  if (D.lineMode !== 'none') {
    var line = (Array.isArray(D.route) && D.route.length>1)
      ? D.route
      : (D.pois||[]).map(function(p){ return [p.lat,p.lng]; });
    if (line.length>1) L.polyline(line, {weight:4, color:'#d33'}).addTo(map);
  }

  var b=markers.getBounds();
  if (b.isValid()) map.fitBounds(b.pad(0.15));
})();
</script>
</body>
</html>
