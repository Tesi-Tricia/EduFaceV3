// full-screen gate kiosk (face + QR together, locked by a PIN) and the offline app shell (service worker).
'use strict';
(function () {
  const EF = window.EF, { html, put, $, t, toast } = EF;

  // ---------------------------------------------------------------- offline app shell
  // Once installed/visited, the app and the face models load from the browser cache, even if start.bat is not running.
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    const hadController = !!navigator.serviceWorker.controller; let reloaded = false;
    // After an update the new version takes over: reload once so the page and its scripts match (not on the very first install).
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded && !EF.state.user) { reloaded = true; location.reload(); } });
    navigator.serviceWorker.register('sw.js').catch(() => { });
  }

  // ---------------------------------------------------------------- kiosk page
  EF.registerPage({ id: 'kiosk', title: 'Gate kiosk', icon: '▣', order: 6, perm: 'attendance.scan', async render(el) {
    const hasPin = !!(await EF.db.getSetting('kiosk.pin', null));
    put(el, html`<header class="top"><h1>Gate kiosk</h1></header>
      <div class="card"><p>Turns this computer/tablet into a full-screen gate scanner. It reads <strong>faces and QR cards</strong> at the same time, hides the menu, and keeps the screen awake.
        To leave, someone must enter the kiosk PIN.</p>
        <form data-form="kiosk" class="row"><div class="field"><label for="kp">${hasPin ? 'Kiosk PIN (4–8 digits)' : 'Choose a kiosk PIN (4–8 digits)'}</label><input id="kp" name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" required autocomplete="off"></div>
        <div class="field"><label for="kd">Direction</label><select id="kd" name="dir"><option value="in">${t('in')}</option><option value="out">${t('out')}</option></select></div>
        <div class="field"><button class="primary" type="submit">Start kiosk</button></div></form>
        <p class="hint">The kiosk stays signed in as <strong>${EF.state.user.fullName}</strong> and is not signed out by inactivity. Use a Security or Teacher account for gate tablets.</p></div>`);
  } });

  EF.forms.kiosk = async form => {
    const d = Object.fromEntries(new FormData(form)); const stored = await EF.db.getSetting('kiosk.pin', null);
    if (stored) { if (!(await EF.crypto.verifyPassword(d.pin, stored))) return toast('Wrong PIN.'); } else { await EF.db.setSetting('kiosk.pin', await EF.crypto.hashPassword(d.pin)); await EF.audit.append('kiosk.pin_set', 'school', EF.state.schoolId); }
    startKiosk(d.dir);
  };

  let wake = null, kTimer = null;
  async function startKiosk(direction) {
    EF.stopLive(); EF.kioskActive = true; document.body.classList.add('kiosk'); await EF.audit.append('kiosk.start', 'school', EF.state.schoolId, { direction });
    try { await document.documentElement.requestFullscreen?.(); } catch { /* the user can still use the kiosk windowed */ }
    try { wake = await navigator.wakeLock?.request('screen'); } catch { /* optional */ }
    put($('#root'), html`<div class="kiosk-wrap"><div class="row between"><strong>${EF.state.school.name}</strong><span id="knet" class="pill"></span><button class="small" id="kexit">Exit</button></div>
      <div><div class="camwrap" id="cw"><video id="cam" playsinline muted></video><canvas id="ov"></canvas></div><div class="verdict" id="verdict" aria-live="assertive"><div class="who">${t('looking')}</div><div class="what"></div></div></div>
      <div class="row"><label class="row">No face? Scan the QR card or type the number: <input id="code" autocomplete="off" placeholder="Scan card…"></label><button id="start" class="primary">Start camera</button></div></div>`);
    const video = $('#cam'), ov = $('#ov'), verdict = $('#verdict'), cw = $('#cw'); let busy = false, lastShown = 0, tick = 0;
    const ctx = { direction: () => direction, lastQr: null, lastQrAt: 0, overlay: ov, grab(v, maxW) { const sc = Math.min(1, maxW / v.videoWidth); const c = document.createElement('canvas'); c.width = Math.round(v.videoWidth * sc); c.height = Math.round(v.videoHeight * sc);
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(v, 0, 0, c.width, c.height); return { canvas: c, ctx: g, w: c.width, h: c.height }; } };
    const show = r => {
      if (!r) return; const v = EF.verdictFor(r);
      if (v.ok === null && Date.now() - lastShown < 3000) return;   // keep a successful result on screen for 3 s
      verdict.className = 'verdict ' + v.cls; put(verdict, html`<div class="who">${v.who}</div><div class="what">${v.what}</div>`);
      cw.classList.remove('flash-ok', 'flash-bad'); if (v.ok === true) cw.classList.add('flash-ok'); if (v.ok === false) cw.classList.add('flash-bad'); if (v.beep) EF.beep(v.beep); if (v.ok !== null) lastShown = Date.now();
    };
    async function loop() {
      if (busy || !video.videoWidth) return; busy = true; tick++;
      try { const qr = EF.scanModes.find(m => m.id === 'qr'), face = EF.scanModes.find(m => m.id === 'face');
        const rq = await qr.frame(video, ctx); if (rq) show(rq); else if (face && tick % 3 === 0) show(await face.frame(video, ctx)); } catch (e) { console.error(e); } finally { busy = false; }
    }
    $('#start').onclick = async () => { try { await EF.startCamera(video); $('#start').classList.add('hidden'); clearInterval(kTimer); kTimer = setInterval(loop, 400); put($('#knet'), html`<span class="dot ok"></span>Running`); } catch (e) { put(verdict, html`<div class="who">Camera unavailable</div><div class="what">${e.message}</div>`); } };
    $('#code').onkeydown = async e => { if (e.key !== 'Enter') return; const v = e.target.value; e.target.value = ''; show(await EF.scanCode(v, direction)); };
    $('#kexit').onclick = () => EF.modal(html`<h2>Exit kiosk</h2><form data-form="kioskexit"><div class="field"><label for="ep">PIN</label><input id="ep" name="pin" type="password" inputmode="numeric" required autocomplete="off"></div>
      <p class="row"><button class="primary" type="submit">Exit</button><button type="button" data-act="close">${t('cancel')}</button></p></form>`);
    $('#start').click();
  }
  EF.forms.kioskexit = async form => {
    const pin = new FormData(form).get('pin'); const stored = await EF.db.getSetting('kiosk.pin', null);
    if (!stored || !(await EF.crypto.verifyPassword(pin, stored))) { await EF.audit.append('kiosk.exit_failed', 'school', EF.state.schoolId); return toast('Wrong PIN.'); }
    clearInterval(kTimer); EF.stopCamera($('#cam')); try { await wake?.release(); } catch { /* ignore */ } try { if (document.fullscreenElement) await document.exitFullscreen(); } catch { /* ignore */ }
    EF.kioskActive = false; document.body.classList.remove('kiosk'); EF.closeModal(); await EF.audit.append('kiosk.exit', 'school', EF.state.schoolId); location.hash = '#/dashboard'; EF.showApp();
  };
})();
