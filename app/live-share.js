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
  let wakeSentinel = null;    // Screen-Wake-Lock (Bildschirm bleibt an)
  let lastUpdateAt = null;    // Zeitpunkt des letzten erfolgreichen Pings
  let collapsed = false;      // Banner eingeklappt (platzsparend)
  const STALE_MS = 120000;    // ab 2 Min. ohne Update gilt die Position als alt
  // Hinweis: -v2, damit ein früheres "Ausblenden" einmalig zurückgesetzt wird
  const WAKE_INFO_KEY = 'tlLiveWakeInfoHidden-v2';
  const listeners = [];

  function agoText(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return s + ' Sek.';
    const m = Math.round(s / 60);
    return m < 60 ? m + ' Min.' : Math.round(m / 60) + ' Std.';
  }

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
    if (document.getElementById('tlLiveWrap')) return;
    const style = document.createElement('style');
    style.textContent =
      '#tlLiveWrap{position:fixed;bottom:54px;left:50%;transform:translateX(-50%);z-index:100000;' +
      'display:flex;flex-direction:column;gap:6px;align-items:center;max-width:92vw}' +
      '#tlLiveBanner{display:flex;align-items:center;gap:8px;background:#1a1a1a;color:#fff;border-radius:22px;' +
      'padding:8px 14px;font:13px/1.2 system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.3);max-width:100%}' +
      '#tlLiveBanner .tlLiveDot{width:10px;height:10px;border-radius:50%;background:#e53e3e;flex:0 0 auto;' +
      'animation:tlLivePulse 1.4s ease-in-out infinite}' +
      '#tlLiveBanner button{background:#fff;color:#1a1a1a;border:0;border-radius:14px;padding:5px 12px;' +
      'font:inherit;font-weight:600;cursor:pointer;flex:0 0 auto}' +
      '#tlLiveBanner #tlLiveToggle{background:rgba(255,255,255,.18);color:#fff;border-radius:12px;' +
      'padding:4px 9px;line-height:1}' +
      '#tlLiveBanner .tlLiveMsg{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '#tlLiveWakeInfo{display:flex;align-items:flex-start;gap:8px;background:#fff7ed;color:#92400e;' +
      'border:1px solid #fed7aa;border-radius:14px;padding:7px 12px;font:12px/1.35 system-ui,sans-serif;' +
      'box-shadow:0 2px 10px rgba(0,0,0,.15);max-width:100%}' +
      '#tlLiveWakeInfo button{background:none;border:0;color:#92400e;text-decoration:underline;cursor:pointer;' +
      'font:inherit;flex:0 0 auto;padding:0;white-space:nowrap}' +
      '@keyframes tlLivePulse{0%,100%{opacity:1}50%{opacity:.25}}';
    document.head.appendChild(style);

    const wrap = document.createElement('div');
    wrap.id = 'tlLiveWrap';

    const b = document.createElement('div');
    b.id = 'tlLiveBanner';
    b.style.display = 'none';
    b.innerHTML = '<span class="tlLiveDot"></span>'
      + '<span class="tlLiveMsg" id="tlLiveMsg">Du teilst gerade deinen Standort</span>'
      + '<button id="tlLiveToggle" type="button" title="Ein-/ausklappen" aria-label="Ein-/ausklappen">▾</button>'
      + '<button id="tlLiveStop" type="button">Beenden</button>';

    const info = document.createElement('div');
    info.id = 'tlLiveWakeInfo';
    info.style.display = 'none';
    info.innerHTML = '<span>Wake-Lock aktiv: Bildschirm wird nicht automatisch gesperrt oder gedimmt. '
      + 'Bei Bildschirmsperre von Hand oder App-Wechsel stoppt die automatische Aktualisierung.</span>'
      + '<button id="tlLiveWakeHide" type="button">Ausblenden</button>';

    wrap.appendChild(b);
    wrap.appendChild(info);
    document.body.appendChild(wrap);
    b.querySelector('#tlLiveStop').onclick = () => { window.TLLiveShare.stop(); };
    b.querySelector('#tlLiveToggle').onclick = () => { collapsed = !collapsed; updateBanner(); };
    info.querySelector('#tlLiveWakeHide').onclick = () => {
      hideWakeInfo();
      try { localStorage.setItem(WAKE_INFO_KEY, '1'); } catch (e) {}
    };
  }

  function updateBanner() {
    const msg = document.getElementById('tlLiveMsg');
    if (!msg) return;
    const toggle = document.getElementById('tlLiveToggle');
    const stop = document.getElementById('tlLiveStop');
    if (toggle) toggle.textContent = collapsed ? '▸' : '▾';
    if (stop) stop.style.display = collapsed ? 'none' : '';

    const age = lastUpdateAt != null ? Date.now() - lastUpdateAt : null;
    const stale = age != null && age > STALE_MS;
    // "zuletzt aktualisiert" hat Vorrang vor der Restlaufzeit
    const fresh = geoProblem ? null
      : (age != null ? (stale ? '⚠️ zuletzt vor ' : 'aktualisiert vor ') + agoText(age)
                     : 'warte auf Position…');

    if (collapsed) {
      // Platzsparend: nur der kürzeste Frische-Hinweis
      msg.textContent = geoProblem ? '⚠️' : (age != null ? 'vor ' + agoText(age) : '…');
      return;
    }
    if (geoProblem) { msg.textContent = '⚠️ ' + geoProblem; return; }
    const r = remainingText();
    msg.textContent = 'Standort geteilt · ' + fresh + (r ? ' · ' + r : '');
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

  // ---- Wake-Lock (Bildschirm bleibt an) ------------------------------
  function wakeInfoDismissed() {
    try { return localStorage.getItem(WAKE_INFO_KEY) === '1'; } catch (e) { return false; }
  }

  function showWakeInfo() {
    if (wakeInfoDismissed()) return;
    ensureBanner();
    const el = document.getElementById('tlLiveWakeInfo');
    if (el) el.style.display = 'flex';
  }

  function hideWakeInfo() {
    const el = document.getElementById('tlLiveWakeInfo');
    if (el) el.style.display = 'none';
  }

  async function requestWake() {
    if (!('wakeLock' in navigator) || wakeSentinel || !token) return;
    if (document.visibilityState !== 'visible') return;
    try {
      wakeSentinel = await navigator.wakeLock.request('screen');
      // Das System gibt die Sperre bei App-Wechsel/Sperre selbst frei
      wakeSentinel.addEventListener('release', () => { wakeSentinel = null; });
      showWakeInfo();
    } catch (e) {
      wakeSentinel = null; // z. B. bei niedrigem Akku abgelehnt — still ignorieren
    }
  }

  async function releaseWake() {
    hideWakeInfo();
    if (wakeSentinel) {
      try { await wakeSentinel.release(); } catch (e) {}
      wakeSentinel = null;
    }
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
    if (d && d.active === false) { onEnded(); return; } // serverseitig beendet
    lastUpdateAt = Date.now();
    updateBanner();
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
    lastUpdateAt = null;
    showBanner();
    startWatch();
    requestWake();
    emit();
  }

  function onEnded() {
    token = null;
    expiresAt = null;
    geoProblem = null;
    lastUpdateAt = null;
    stopWatch();
    releaseWake();
    hideBanner();
    emit();
  }

  // Wird die Seite wieder sichtbar, die Wake-Lock erneut anfordern
  // (das System hat sie beim Wechsel/Sperre freigegeben).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && token) requestWake();
  });

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
