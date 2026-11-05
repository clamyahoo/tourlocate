// Gemeinsamer Live-Standort-Motor für die eingeloggten Seiten (Dashboard,
// Editor). Hält watchPosition + Ping am Laufen, zeigt überall einen
// schwebenden Hinweis "Du teilst gerade deinen Standort" und setzt eine
// laufende Sitzung beim Seitenwechsel fort (resume via api/live.php?status).
//
// Die Seite muss vorher window.TL_LIVE_CSRF setzen (das CSRF-Token).
// Öffentliche API unter window.TLLiveShare:
//   onChange(fn)      – fn(state) bei jedem Zustandswechsel
//   start(label,ttl)  – Sitzung starten (gibt die API-Antwort zurück)
//   stop()            – Teilen beenden
//   extend(ttl)       – laufende Sitzung verlängern
//   getState()        – { active, token, expiresAt }
//   urlFor(token)     – absolute verfolgen.php-URL

(function () {
  const CSRF = window.TL_LIVE_CSRF || '';

  let token = null;
  let expiresAt = null;
  let watchId = null;
  let lastPing = 0;            // Drossel: höchstens alle 3 Sek. senden
  let bannerTimer = null;
  let geoProblem = null;      // Text, falls die Ortung blockiert/fehlt
  const listeners = [];

  async function api(action, body) {
    const opts = { headers: { 'X-CSRF-Token': CSRF } };
    if (body) {
      opts.method = 'POST';
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify({ ...body, csrf: CSRF });
    }
    const res = await fetch('api/live.php?action=' + action, opts);
    return res.json().catch(() => ({}));
  }

  function getState() { return { active: !!token, token, expiresAt }; }
  function emit() { const s = getState(); listeners.forEach(fn => { try { fn(s); } catch (e) {} }); }

  function remainingText() {
    if (!expiresAt) return '';
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (ms <= 0) return '';
    const min = Math.ceil(ms / 60000);
    return min >= 60 ? 'noch ' + Math.round(min / 60) + ' Std.' : 'noch ' + min + ' Min.';
  }

  // ---- Schwebender Hinweis -------------------------------------------
  function ensureBanner() {
    if (document.getElementById('tlLiveBanner')) return;
    const style = document.createElement('style');
    style.textContent =
      '#tlLiveBanner{position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:100000;' +
      'display:flex;align-items:center;gap:10px;background:#1a1a1a;color:#fff;border-radius:22px;' +
      'padding:8px 14px;font:13px/1.2 system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.3);max-width:92vw}' +
      '#tlLiveBanner .tlLiveDot{width:10px;height:10px;border-radius:50%;background:#e53e3e;flex:0 0 auto;' +
      'animation:tlLivePulse 1.4s ease-in-out infinite}' +
      '#tlLiveBanner button{background:#fff;color:#1a1a1a;border:0;border-radius:14px;padding:5px 12px;' +
      'font:inherit;font-weight:600;cursor:pointer;flex:0 0 auto}' +
      '#tlLiveBanner .tlLiveMsg{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '@keyframes tlLivePulse{0%,100%{opacity:1}50%{opacity:.25}}';
    document.head.appendChild(style);

    const b = document.createElement('div');
    b.id = 'tlLiveBanner';
    b.style.display = 'none';
    b.innerHTML = '<span class="tlLiveDot"></span>'
      + '<span class="tlLiveMsg" id="tlLiveMsg">Du teilst gerade deinen Standort</span>'
      + '<button id="tlLiveStop" type="button">Beenden</button>';
    document.body.appendChild(b);
    b.querySelector('#tlLiveStop').onclick = () => { window.TLLiveShare.stop(); };
  }

  function updateBanner() {
    const msg = document.getElementById('tlLiveMsg');
    if (!msg) return;
    if (geoProblem) { msg.textContent = '⚠️ ' + geoProblem; return; }
    const r = remainingText();
    msg.textContent = 'Du teilst gerade deinen Standort' + (r ? ' (' + r + ')' : '');
  }

  function showBanner() {
    ensureBanner();
    document.getElementById('tlLiveBanner').style.display = 'flex';
    updateBanner();
    if (bannerTimer) clearInterval(bannerTimer);
    bannerTimer = setInterval(() => {
      if (expiresAt && new Date(expiresAt).getTime() - Date.now() <= 0) {
        onEnded(); // lokal abgelaufen
      } else {
        updateBanner();
      }
    }, 1000);
  }

  function hideBanner() {
    const b = document.getElementById('tlLiveBanner');
    if (b) b.style.display = 'none';
    if (bannerTimer) { clearInterval(bannerTimer); bannerTimer = null; }
  }

  // ---- Ortung ---------------------------------------------------------
  async function ping(pos) {
    if (!token) return;
    const nowMs = Date.now();
    if (nowMs - lastPing < 3000) return;
    lastPing = nowMs;
    if (geoProblem) { geoProblem = null; updateBanner(); } // Ortung wieder da
    const d = await api('ping', {
      token,
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      acc: pos.coords.accuracy
    });
    if (d && d.active === false) onEnded(); // serverseitig beendet/abgelaufen
  }

  function onGeoError(err) {
    geoProblem = (err && err.code === err.PERMISSION_DENIED)
      ? 'Ortung blockiert — Standort wird nicht gesendet'
      : 'Standort nicht verfügbar';
    updateBanner();
  }

  function startWatch() {
    if (!navigator.geolocation || watchId !== null) return;
    lastPing = 0;
    watchId = navigator.geolocation.watchPosition(ping, onGeoError, {
      enableHighAccuracy: true, maximumAge: 5000, timeout: 20000
    });
  }

  function stopWatch() {
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  }

  function begin(tok, exp) {
    token = tok;
    expiresAt = exp;
    showBanner();
    startWatch();
    emit();
  }

  function onEnded() {
    token = null;
    expiresAt = null;
    geoProblem = null;
    stopWatch();
    hideBanner();
    emit();
  }

  // ---- Öffentliche API ------------------------------------------------
  window.TLLiveShare = {
    onChange(fn) { listeners.push(fn); fn(getState()); },
    getState,
    urlFor(tok) { return new URL('verfolgen.php?t=' + encodeURIComponent(tok), location.href).href; },

    async start(label, ttl) {
      const d = await api('start', { label, ttl });
      if (d.ok) begin(d.token, d.expiresAt);
      return d;
    },

    async stop() {
      if (token) { try { await api('stop', { token }); } catch (e) {} }
      onEnded();
    },

    async extend(ttl) {
      const d = await api('extend', { ttl });
      if (d.ok) { expiresAt = d.expiresAt; updateBanner(); emit(); }
      return d;
    }
  };

  // Beim Laden: läuft noch eine Sitzung? Dann Hinweis + Ortung fortsetzen.
  (async () => {
    const d = await api('status');
    if (d && d.ok && d.share) begin(d.share.token, d.share.expiresAt);
  })();
})();
