<?php
// Öffentliche Live-Standort-Ansicht.
//   verfolgen.php?t=<token>
// Kein Login nötig. Zeigt die zuletzt gemeldete Position als wandernden
// Punkt; fragt api/live.php?action=read im Takt ab. Es wird nur die
// aktuelle Position angezeigt, keine Bewegungshistorie.
declare(strict_types=1);
require_once __DIR__ . '/api/bootstrap.php';

$token = (string) ($_GET['t'] ?? '');

// Existenzprüfung wie bei view.php: unbekannter Link → Fehlerseite.
// Der tatsächliche Zustand (aktiv/abgelaufen) kommt dann live per JS.
$st = db()->prepare('SELECT label FROM live_shares WHERE token = ?');
$st->execute([$token]);
$P = $token !== '' ? $st->fetch() : false;

if (!$P) {
    http_response_code(404);
    echo '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">'
       . '<meta name="viewport" content="width=device-width,initial-scale=1">'
       . '<title>Tourlocate</title><style>body{margin:0;font-family:system-ui,sans-serif;'
       . 'background:#f4f6f8;color:#1a1a1a;display:flex;min-height:100vh;align-items:center;'
       . 'justify-content:center;padding:20px;text-align:center}</style></head><body><div>'
       . '<h1>Nicht gefunden</h1><p>Dieser Link ist ungültig oder wurde beendet.</p>'
       . '</div></body></html>';
    exit;
}

$label = (string) ($P['label'] ?? '');
$heading = $label !== '' ? $label : 'Live-Standort';
// ?preview=1 → der Teilende schaut sich selbst die Ansicht an; dann einen
// Zurück-Link zum Dashboard zeigen (Betrachter mit dem Link sehen ihn nicht).
$preview = isset($_GET['preview']);
?>
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title><?= htmlspecialchars($heading, ENT_QUOTES) ?> — Tourlocate</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css">
<link rel="icon" type="image/png" href="../img/logo.png">
<style>
  html,body{height:100%;margin:0;font-family:system-ui,sans-serif}
  #bar{display:flex;align-items:center;gap:10px;padding:8px 14px;background:#fff;border-bottom:1px solid #e2e8f0}
  #bar img{width:26px;height:26px;border-radius:50%}
  #bar strong{font-size:16px;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #map{height:calc(100vh - 45px)}
  #pill{position:absolute;left:50%;top:56px;transform:translateX(-50%);z-index:1000;
        background:rgba(255,255,255,.95);border:1px solid #e2e8f0;border-radius:20px;
        padding:6px 14px;font-size:13px;color:#333;box-shadow:0 1px 6px rgba(0,0,0,.12);
        max-width:90vw;text-align:center}
  #pill.off{color:#777}
  #pill.stale{color:#92400e;background:#fff7ed;border-color:#fed7aa}
</style>
</head>
<body>
<div id="bar">
<?php if ($preview): ?>
  <a href="dashboard.php" style="font-size:14px;color:#2b6cb0;white-space:nowrap;text-decoration:none;font-weight:600">‹ Zurück</a>
<?php endif; ?>
  <img src="../img/logo.png" alt="" onerror="this.style.display='none'">
  <strong><?= htmlspecialchars($heading, ENT_QUOTES) ?><?= $preview ? ' (Vorschau)' : '' ?></strong>
  <a href="impressum.php" style="font-size:12px;color:#888;white-space:nowrap">Impressum</a>
</div>
<div id="map"></div>
<div id="pill">Warten auf Position…</div>

<script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function(){
  var TOKEN = <?= json_encode($token) ?>;
  var pill = document.getElementById('pill');

  var map = L.map('map').setView([0,0],2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom:19, attribution:'© OpenStreetMap-Mitwirkende'
  }).addTo(map);

  var dot=null, ring=null, firstFix=true;
  var STALE_SEC = 120; // ab 2 Min. ohne Update gilt die Position als veraltet

  // state: 'live' | 'stale' | 'off'
  function setPill(text, state){
    pill.textContent = text;
    pill.className = state === 'live' ? '' : state;
  }

  function setDotStale(stale){
    if (!dot) return;
    var c = stale ? '#9ca3af' : '#2b6cb0';
    dot.setStyle({ fillColor:c });
    if (ring) ring.setStyle({ color:c, fillColor:c });
  }

  // Frische anhand des Melde-Zeitstempels bewerten und Pille + Punkt setzen
  function renderFreshness(atIso){
    var d = new Date(atIso); if (isNaN(d)) return;
    var ageSec = Math.max(0, Math.round((Date.now() - d.getTime())/1000));
    if (ageSec > STALE_SEC){
      setPill('⚠️ Standort potentiell veraltet (letzte Aktualisierung ' + ago(atIso) + ')', 'stale');
      setDotStale(true);
    } else {
      setPill('Aktualisiert ' + ago(atIso), 'live');
      setDotStale(false);
    }
  }

  // "vor X Sek./Min." aus einem ISO-Zeitstempel
  function ago(iso){
    var d = new Date(iso); if (isNaN(d)) return '';
    var s = Math.max(0, Math.round((Date.now() - d.getTime())/1000));
    if (s < 60) return 'vor ' + s + ' Sek.';
    var m = Math.round(s/60);
    if (m < 60) return 'vor ' + m + ' Min.';
    return 'vor ' + Math.round(m/60) + ' Std.';
  }

  var lastAt = null;
  var activeState = false;
  var pausedState = false;

  // Weiches Gleiten statt Springen: zwischen zwei empfangenen Positionen
  // wird der Punkt per requestAnimationFrame interpoliert (reine Darstellung,
  // kostet den Sender keinen zusätzlichen Akku/Traffic).
  var curLL = null, fromLL = null, target = null;
  var fromAcc = 0, targetAcc = 0;
  var animStart = 0, animDur = 1500, raf = 0, lastPlace = 0;
  function lerp(a, b, t){ return a + (b - a) * t; }

  function animTick(){
    raf = 0;
    if (!dot || !target) return;
    var now = performance.now();
    var t = animDur > 0 ? Math.min(1, (now - animStart) / animDur) : 1;
    curLL = [lerp(fromLL[0], target[0], t), lerp(fromLL[1], target[1], t)];
    dot.setLatLng(curLL);
    if (ring){ ring.setLatLng(curLL); ring.setRadius(lerp(fromAcc, targetAcc, t)); }
    if (t < 1) raf = requestAnimationFrame(animTick);
  }

  function place(lat, lng, acc){
    var tgt = [lat, lng];
    if (!dot){
      dot = L.circleMarker(tgt,{radius:7,color:'#fff',weight:2,fillColor:'#2b6cb0',fillOpacity:1,interactive:false}).addTo(map);
      ring = L.circle(tgt,{radius:acc||0,color:'#2b6cb0',weight:1,fillColor:'#2b6cb0',fillOpacity:0.12,interactive:false}).addTo(map);
      curLL = tgt; target = tgt; targetAcc = acc || 0;
      if (firstFix){ map.setView(tgt, 16); firstFix=false; }
      return;
    }
    // Unveränderte Position → nicht neu animieren
    if (target && Math.abs(target[0]-lat) < 1e-7 && Math.abs(target[1]-lng) < 1e-7){
      targetAcc = acc != null ? acc : targetAcc;
      return;
    }
    var now = performance.now();
    // Animationsdauer ~ Abstand zwischen zwei Updates (begrenzt), damit der
    // Punkt etwa im Takt der echten Positionen gleitet.
    animDur = lastPlace ? Math.min(4000, Math.max(800, now - lastPlace)) : 1500;
    lastPlace = now;
    fromLL = curLL ? curLL.slice() : tgt.slice();
    fromAcc = ring ? ring.getRadius() : (acc || 0);
    target = tgt;
    targetAcc = acc != null ? acc : targetAcc;
    animStart = now;
    if (!raf) raf = requestAnimationFrame(animTick);
  }

  // Punkt + Kreis entfernen (wenn das Teilen endet, soll keine Position
  // mehr auf der Karte stehenbleiben)
  function clearDot(){
    if (raf){ cancelAnimationFrame(raf); raf = 0; }
    if (dot){ map.removeLayer(dot); dot=null; }
    if (ring){ map.removeLayer(ring); ring=null; }
    curLL = null; target = null; lastPlace = 0;
    firstFix=true;
  }

  async function poll(){
    try {
      var res = await fetch('api/live.php?action=read&t=' + encodeURIComponent(TOKEN), {cache:'no-store'});
      var d = await res.json().catch(function(){ return {}; });
      if (!d.ok){
        activeState = false;
        setPill(d.error || 'Nicht verfügbar.', 'off');
        return;
      }
      if (!d.active){
        activeState = false;
        clearDot();
        setPill(d.expired ? 'Teilen abgelaufen.' : 'Teilen beendet.', 'off');
        return;
      }
      activeState = true;
      pausedState = !!d.paused;
      if (d.paused){
        // Sofort "pausiert" anzeigen (nicht erst nach der Veraltet-Schwelle)
        if (d.lat != null && d.lng != null){ place(d.lat, d.lng, d.acc); lastAt = d.at; }
        setDotStale(true);
        setPill('⏸ Teilen pausiert', 'off');
        return;
      }
      if (d.lat != null && d.lng != null){
        place(d.lat, d.lng, d.acc);
        lastAt = d.at;
        renderFreshness(d.at);
      } else {
        setPill('Warten auf Position…', 'live');
      }
    } catch(e){
      setPill('Verbindungsfehler.', 'off');
    }
  }

  poll();
  setInterval(poll, 3000);
  // Sekundentakt nur für die Frische-Anzeige (ohne neue Anfrage);
  // im Pause-Zustand nicht überschreiben.
  setInterval(function(){ if (activeState && !pausedState && lastAt) renderFreshness(lastAt); }, 1000);
})();
</script>
</body>
</html>
