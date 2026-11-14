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
//   pause()/resume()  – Senden pausieren / fortsetzen (Sitzung bleibt aktiv)
//   extend(ttl)       – laufende Sitzung verlängern
//   getState()        – { active, token, expiresAt, paused }
//   urlFor(token)     – absolute verfolgen.php-URL

(function () {
  const CSRF = window.TL_LIVE_CSRF || '';

  let token = null;
  let expiresAt = null;
  let watchId = null;          // Browser-watchPosition-ID
  let bgWatcherId = null;      // ID des nativen Hintergrund-Watchers (Capacitor-App)
  let lastPing = 0;            // Drossel: höchstens alle 3 Sek. senden
  let bannerTimer = null;
  let geoProblem = null;      // Text, falls die Ortung blockiert/fehlt
  let wakeSentinel = null;    // Screen-Wake-Lock (Bildschirm bleibt an)
  let lastUpdateAt = null;    // Zeitpunkt des letzten erfolgreichen Pings
  let paused = false;         // Teilen pausiert (Sitzung aktiv, aber kein Senden)
  let collapsed = true;       // Banner startet eingeklappt (platzsparend)
  const STALE_MS = 120000;    // ab 2 Min. ohne Update gilt die Position als alt
  // Wake-Info wird PRO Sitzung (Token) ausgeblendet, nicht für immer — bei
  // einer neuen Teilen-Sitzung erscheint sie wieder (so bleibt sie als
  // Erinnerung nützlich, lässt sich aber im laufenden Teilen wegklicken).
  const WAKE_DISMISS_KEY = 'tlLiveWakeDismissToken';
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

  function getState() { return { active: !!token, token, expiresAt, paused }; }
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
      '#tlLiveWrap{position:fixed;top:10px;left:58px;z-index:100000;' +
      'display:flex;flex-direction:column;gap:6px;align-items:flex-start;max-width:calc(100vw - 68px)}' +
      '#tlLiveBanner{display:flex;align-items:center;gap:8px;background:#1a1a1a;color:#fff;border-radius:22px;' +
      'padding:8px 14px;font:13px/1.3 system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.3);max-width:100%;' +
      'touch-action:none;cursor:move;user-select:none;-webkit-user-select:none}' +
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
      '#tlLiveWakeInfo>span{flex:1 1 auto;min-width:0}' +
      '#tlLiveWakeInfo button{background:none;border:0;color:#92400e;text-decoration:underline;cursor:pointer;' +
      'font:inherit;flex:0 0 auto;padding:0;text-align:left;white-space:normal;max-width:120px}' +
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
      + '<button id="tlLivePause" type="button">Pause</button>'
      + '<button id="tlLiveStop" type="button">Beenden</button>';

    const info = document.createElement('div');
    info.id = 'tlLiveWakeInfo';
    info.style.display = 'none';
    info.innerHTML = '<span>Wake-Lock aktiv: Bildschirm wird nicht automatisch gesperrt oder gedimmt. '
      + 'Bei Bildschirmsperre von Hand oder App-Wechsel stoppt die automatische Aktualisierung — '
      + 'sie läuft automatisch weiter, sobald das Tourlocate-Fenster wieder aktiv ist.</span>'
      + '<button id="tlLiveWakeHide" type="button">Für diese Teilen-Session ausblenden</button>';

    wrap.appendChild(b);
    wrap.appendChild(info);
    document.body.appendChild(wrap);
    b.querySelector('#tlLiveStop').onclick = () => { window.TLLiveShare.stop(); };
    b.querySelector('#tlLivePause').onclick = () => { paused ? window.TLLiveShare.resume() : window.TLLiveShare.pause(); };
    b.querySelector('#tlLiveToggle').onclick = () => { collapsed = !collapsed; updateBanner(); };
    info.querySelector('#tlLiveWakeHide').onclick = () => {
      hideWakeInfo();
      try { if (token) localStorage.setItem(WAKE_DISMISS_KEY, token); } catch (e) {}
    };

    positionBelowBar();
    makeDraggable(wrap, b);
    window.addEventListener('resize', positionBelowBar);
  }

  // Standardposition: oben links (neben dem ☰-Knopf), direkt unter der
  // Kopfleiste der Seite (Editor #tl-editbar / Dashboard .bar). Nicht
  // überschreiben, wenn der Nutzer das Banner von Hand verschoben hat.
  function positionBelowBar() {
    const wrap = document.getElementById('tlLiveWrap');
    if (!wrap || wrap.dataset.moved) return;
    const bar = document.querySelector('#tl-editbar, .bar, #bar');
    let top = 10;
    if (bar) {
      const r = bar.getBoundingClientRect();
      if (r.bottom > 0 && r.bottom < 200) top = Math.round(r.bottom + 8);
    }
    wrap.style.top = top + 'px';
    wrap.style.bottom = 'auto';
  }

  // Banner von Hand verschiebbar (Zeiger-Events = Touch + Maus). Buttons
  // bleiben klickbar; ab dem ersten Ziehen gilt die Position als "gesetzt".
  function makeDraggable(wrap, handle) {
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const r = wrap.getBoundingClientRect();
      ox = r.left; oy = r.top; sx = e.clientX; sy = e.clientY;
      wrap.style.left = r.left + 'px';
      wrap.style.top = r.top + 'px';
      wrap.style.transform = 'none';
      wrap.style.bottom = 'auto';
      wrap.dataset.moved = '1';
      dragging = true;
      try { handle.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    });
    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      let nx = ox + (e.clientX - sx);
      let ny = oy + (e.clientY - sy);
      nx = Math.max(4, Math.min(window.innerWidth - wrap.offsetWidth - 4, nx));
      ny = Math.max(4, Math.min(window.innerHeight - wrap.offsetHeight - 4, ny));
      wrap.style.left = nx + 'px';
      wrap.style.top = ny + 'px';
    });
    const end = (e) => { dragging = false; try { handle.releasePointerCapture(e.pointerId); } catch (_) {} };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  function updateBanner() {
    const msg = document.getElementById('tlLiveMsg');
    if (!msg) return;
    const toggle = document.getElementById('tlLiveToggle');
    const stop = document.getElementById('tlLiveStop');
    const pauseBtn = document.getElementById('tlLivePause');
    const banner = msg.parentElement;
    const dot = banner ? banner.querySelector('.tlLiveDot') : null;
    if (banner) {
      // Eingeklappt: schmale Pille; aufgeklappt feste, breitere Box
      // (sonst bricht der Text in viele Zeilen um).
      banner.style.width = collapsed ? 'auto' : 'min(360px, calc(100vw - 68px))';
    }
    if (toggle) toggle.textContent = collapsed ? '▸' : '▾';
    if (stop) stop.style.display = collapsed ? 'none' : '';
    if (pauseBtn) { pauseBtn.style.display = collapsed ? 'none' : ''; pauseBtn.textContent = paused ? 'Fortsetzen' : 'Pause'; }
    // Punkt im Pause-Zustand grau + ruhig, sonst rot pulsierend
    if (dot) { dot.style.background = paused ? '#9ca3af' : '#e53e3e'; dot.style.animationPlayState = paused ? 'paused' : 'running'; }
    // Aufgeklappt umbrechen lassen, damit auch die Restlaufzeit sichtbar
    // bleibt (einzeilig würde sie hinter "…" abgeschnitten); eingeklappt
    // einzeilig für die kompakte Pille.
    msg.style.whiteSpace = collapsed ? 'nowrap' : 'normal';

    if (paused) {
      const r = remainingText();
      msg.textContent = collapsed ? '⏸ pausiert' : ('Teilen pausiert' + (r ? ' · ' + r : ''));
      return;
    }

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
    try { return !!token && localStorage.getItem(WAKE_DISMISS_KEY) === token; } catch (e) { return false; }
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
    // Fehlerform je nach Quelle: Browser-Geolocation (numerischer code mit
    // PERMISSION_DENIED) ODER natives Plugin (code === 'NOT_AUTHORIZED').
    const denied = err && (
      (typeof err.code === 'number' && err.code === err.PERMISSION_DENIED) ||
      err.code === 'NOT_AUTHORIZED'
    );
    geoProblem = denied
      ? 'Ortung blockiert — Standort wird nicht gesendet'
      : 'Standort nicht verfügbar';
    updateBanner();
  }

  // Natives Hintergrund-Standort-Plugin — nur in der Capacitor-App vorhanden.
  // Liefert über einen Vordergrunddienst (mit Benachrichtigung) auch bei
  // gesperrtem Display Positionen; im Browser gibt es das nicht → null.
  let _bgPlugin; // undefined = noch nicht geprüft
  function nativeBg() {
    if (_bgPlugin !== undefined) return _bgPlugin;
    const Cap = window.Capacitor;
    try {
      // Zugriff über den vom nativen Bridge bereitgestellten Plugins-Proxy
      // (wie bei Gallery). window.Capacitor.registerPlugin existiert im
      // no-build-Kontext NICHT — deshalb lief bisher immer der watchPosition-
      // Fallback (am Gerät per DevTools verifiziert).
      _bgPlugin = (Cap && Cap.isNativePlatform && Cap.isNativePlatform()
                   && Cap.Plugins && Cap.Plugins.BackgroundGeolocation)
        ? Cap.Plugins.BackgroundGeolocation : null;
    } catch (e) { _bgPlugin = null; }
    return _bgPlugin;
  }

  async function startWatch() {
    if (watchId !== null || bgWatcherId !== null) return;
    lastPing = 0;

    // Bevorzugt nativer Hintergrund-Watcher (läuft bei gesperrtem Display weiter).
    const BG = nativeBg();
    if (BG) {
      try {
        bgWatcherId = await BG.addWatcher({
          backgroundTitle: 'Tourlocate',
          backgroundMessage: 'Dein Standort wird gerade geteilt',
          requestPermissions: true,
          distanceFilter: 0
        }, function (location, error) {
          if (error) { onGeoError(error); return; }
          if (location) ping({ coords: {
            latitude: location.latitude,
            longitude: location.longitude,
            accuracy: location.accuracy
          } });
        });
        return;
      } catch (e) {
        bgWatcherId = null; // Fallback auf Browser-Geolocation
      }
    }

    if (!navigator.geolocation) return;
    watchId = navigator.geolocation.watchPosition(ping, onGeoError, {
      enableHighAccuracy: true, maximumAge: 5000, timeout: 20000
    });
  }

  async function stopWatch() {
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    if (bgWatcherId !== null) {
      const BG = nativeBg();
      const id = bgWatcherId;
      bgWatcherId = null;
      try { if (BG) await BG.removeWatcher({ id }); } catch (e) {}
    }
  }

  function begin(tok, exp, isPaused) {
    token = tok;
    expiresAt = exp;
    paused = !!isPaused;
    lastUpdateAt = null;
    showBanner();
    if (!paused) { startWatch(); requestWake(); }
    emit();
  }

  function onEnded() {
    token = null;
    expiresAt = null;
    geoProblem = null;
    lastUpdateAt = null;
    paused = false;
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

    async pause() {
      if (!token || paused) return;
      if (token) { try { await api('pause', { token }); } catch (e) {} }
      paused = true;
      stopWatch();
      releaseWake();
      updateBanner();
      emit();
    },

    async resume() {
      if (!token || !paused) return;
      if (token) { try { await api('resume', { token }); } catch (e) {} }
      paused = false;
      lastPing = 0;
      startWatch();
      requestWake();
      updateBanner();
      emit();
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
    if (d && d.ok && d.share) begin(d.share.token, d.share.expiresAt, d.share.paused);
  })();
})();
