// attendance rules, scan page (QR card by camera / USB scanner / typed code), daily view, manual override, close day, dashboard numbers.
'use strict';
(function () {
  const EF = window.EF, { html, put, $, $$, t, toast } = EF;
  EF.stores.push({ name: 'attendance', key: 'id', indexes: [['date', 'date'], ['student', 'studentId']] });
  EF.addStrings('en', { already_scanned: 'Already scanned', unknown_code: 'Code not recognised', inactive: 'Student not active', not_recognised: 'Not recognised', not_sure: 'Not sure who this is',
    use_qr_or_manual: 'Use the QR card or ask a teacher', live_face_needed: 'Please show your real face', adjust: 'Adjust position', looking: 'Looking…', no_consent: 'Face scanning not allowed' });
  EF.addStrings('sw', { already_scanned: 'Tayari ameskaniwa', unknown_code: 'Msimbo haujulikani', inactive: 'Mwanafunzi hayuko hai', not_recognised: 'Hajatambuliwa', not_sure: 'Sina uhakika ni nani',
    use_qr_or_manual: 'Tumia kadi ya QR au muone mwalimu', live_face_needed: 'Onyesha uso wako halisi', adjust: 'Rekebisha msimamo', looking: 'Natafuta…', no_consent: 'Skani ya uso hairuhusiwi' });

  // ---------------------------------------------------------------- pure rules (also run by the self-test)
  const minutes = hhmm => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };
  const rules = EF.rules = {
    statusForArrival: (hhmm, cutoff) => minutes(hhmm) > minutes(cutoff) ? 'late' : 'present',
    /** excused > first arrival (present/late) > absent */
    dailyStatus(events) {
      if (!events || !events.length) return 'absent';
      if (events.some(e => e.status === 'excused')) return 'excused';
      const a = events.slice().sort((x, y) => x.at.localeCompare(y.at)).find(e => e.direction === 'in' && (e.status === 'present' || e.status === 'late'));
      return a ? a.status : 'absent';
    },
  };
  const localHHMM = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const localDate = d => new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  // ---------------------------------------------------------------- recording
  const A = EF.attendance = {
    async cutoff() { return EF.db.getSetting('attendance.late_cutoff', '08:15'); },
    async eventsOn(date) { return EF.db.where('attendance', 'date', date); },

    /** QR / face / manual scan. Returns {outcome, event}. Duplicate scans inside the rescan window are ignored. */
    async record({ student, direction = 'in', method, confidence = null, at = new Date() }) {
      if (student.status !== 'active') return { outcome: 'inactive' };
      const date = localDate(at); const windowSec = await EF.db.getSetting('attendance.rescan_window_sec', 30);
      const same = (await EF.db.where('attendance', 'student', student.id)).filter(e => e.date === date && e.direction === direction).sort((a, b) => b.at.localeCompare(a.at))[0];
      if (same && (at - new Date(same.at)) / 1000 < windowSec) return { outcome: 'duplicate', event: same };
      const status = direction === 'out' ? 'early_departure' : rules.statusForArrival(localHHMM(at), await A.cutoff());
      const event = await EF.db.save('attendance', { studentId: student.id, date, at: at.toISOString(), direction, status, method, confidence, deviceId: null });
      for (const h of EF.hooks.afterRecord || []) { try { await h(student, event); } catch (e) { console.error(e); } }   // e.g. queue a guardian message
      return { outcome: 'recorded', event };
    },
  };

  // shared plain-language verdicts for scan results
  EF.verdictFor = j => {
    switch (j.result) {
      case 'matched': return { cls: j.status === 'late' ? 'warn' : 'ok', beep: j.status === 'late' ? 'late' : 'ok', who: j.name, what: [t(j.status), t(j.direction), j.confidence != null && Math.round(j.confidence * 100) + '%'].filter(Boolean).join(' · '), ok: true };
      case 'duplicate': return { cls: 'warn', beep: null, who: j.name || '', what: t('already_scanned'), ok: true };
      case 'unknown_code': return { cls: 'bad', beep: 'bad', who: t('unknown_code'), what: '', ok: false };
      case 'unknown': return { cls: 'bad', beep: 'bad', who: t('not_recognised'), what: t('use_qr_or_manual'), ok: false };
      case 'ambiguous': return { cls: 'bad', beep: 'bad', who: t('not_sure'), what: t('use_qr_or_manual'), ok: false };
      case 'low_quality': return { cls: 'warn', beep: null, who: t('adjust'), what: (j.hints || []).join(' · '), ok: null };
      case 'no_face': return { cls: '', beep: null, who: t('looking'), what: '', ok: null };
      case 'no_consent': return { cls: 'bad', beep: 'bad', who: t('no_consent'), what: t('use_qr_or_manual'), ok: false };
      case 'inactive': return { cls: 'bad', beep: 'bad', who: t('inactive'), what: '', ok: false };
      case 'loading_models': return { cls: 'warn', beep: null, who: 'Preparing face recognition…', what: 'The first start can take up to a minute. QR cards work meanwhile.', ok: null };
      case 'error_models': return { cls: 'bad', beep: null, who: 'Face models failed to load', what: 'Check that lib/models is present, then reload.', ok: null };
      default: return { cls: 'bad', beep: 'bad', who: j.result || 'error', what: '', ok: false };
    }
  };

  /** Turn a QR token or student number into a recorded scan. */
  EF.scanCode = async (code, direction) => {
    code = String(code || '').trim(); if (!code) return null;
    const D = EF.data; let s = await D.studentByQr(code);
    if (!s) s = (await EF.db.where('students', 'no', code)).find(x => !x.deletedAt) || null;
    if (!s) return { result: 'unknown_code' };
    const r = await A.record({ student: s, direction, method: 'qr' });
    if (r.outcome === 'inactive') return { result: 'inactive', name: D.fullName(s) };
    return { result: r.outcome === 'duplicate' ? 'duplicate' : 'matched', name: D.fullName(s), status: r.event.status, direction: r.event.direction, studentId: s.id };
  };

  // ---------------------------------------------------------------- scan modes (the face module adds a "Face" mode)
  EF.scanModes = [{ id: 'qr', label: 'QR card (camera)', interval: 450,
    async frame(video, ctx) {
      if (typeof jsQR !== 'function') return null;
      const f = ctx.grab(video, 480); const img = f.ctx.getImageData(0, 0, f.w, f.h);
      const q = jsQR(img.data, f.w, f.h, { inversionAttempts: 'dontInvert' });
      if (!q?.data) return null;
      if (q.data === ctx.lastQr && Date.now() - ctx.lastQrAt < 4000) return null;   // same card still in view
      ctx.lastQr = q.data; ctx.lastQrAt = Date.now();
      return EF.scanCode(q.data, ctx.direction());
    } }];

  EF.registerPage({ id: 'scan', titleKey: 'scan', icon: '◉', order: 5, perm: 'attendance.scan', async render(el, nav) {
    put(el, html`<header class="top"><h1>${t('scan')}</h1><div class="row">
        <select id="mode" aria-label="Scan mode">${EF.scanModes.map(m => html`<option value="${m.id}">${m.label}</option>`)}</select>
        <select id="dir" aria-label="Direction"><option value="in">${t('in')}</option><option value="out">${t('out')}</option></select>
        <label class="row"><input type="checkbox" id="mute" ${EF.store.get('mute') === '1' ? 'checked' : ''}> Mute</label></div></header>
      <div class="scan-layout"><div>
        <div class="camwrap" id="cw"><video id="cam" playsinline muted></video><canvas id="ov"></canvas></div>
        <p class="row"><button class="primary" id="startcam">Start camera</button><span class="muted" id="camerr"></span></p>
        <div class="card"><div class="field"><label for="code">Or scan with a USB scanner / type the QR code or student number, then press Enter</label><input id="code" autocomplete="off" placeholder="Scan or type…"></div></div>
      </div><div><div class="verdict" id="verdict" aria-live="assertive"><div class="who">—</div><div class="what muted">Start the camera, or scan a card.</div></div>
        <div class="card"><h2>Recent</h2><ul class="feed" id="feed"></ul></div></div></div>`);
    const video = $('#cam'), ov = $('#ov'), verdict = $('#verdict'), cw = $('#cw'); let busy = false, timer = null;
    const ctx = { direction: () => $('#dir').value, lastQr: null, lastQrAt: 0, video, overlay: ov,
      grab(v, maxW) { const sc = Math.min(1, maxW / v.videoWidth); const c = document.createElement('canvas'); c.width = Math.round(v.videoWidth * sc); c.height = Math.round(v.videoHeight * sc);
        const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(v, 0, 0, c.width, c.height); return { canvas: c, ctx: g, w: c.width, h: c.height }; } };

    EF.setMuted($('#mute').checked); $('#mute').onchange = e => { EF.setMuted(e.target.checked); EF.store.set('mute', e.target.checked ? '1' : '0'); };

    function show(r) {
      if (!r) return; const v = EF.verdictFor(r);
      verdict.className = 'verdict ' + v.cls; put(verdict, html`<div class="who">${v.who}</div><div class="what">${v.what}</div>`);
      cw.classList.remove('flash-ok', 'flash-bad'); if (v.ok === true) cw.classList.add('flash-ok'); if (v.ok === false) cw.classList.add('flash-bad');
      if (v.beep) EF.beep(v.beep); if (v.ok !== null) loadFeed();
    }
    async function loop() {
      if (busy || !video.videoWidth) return; busy = true;
      try { const mode = EF.scanModes.find(m => m.id === $('#mode').value); show(await mode.frame(video, ctx)); } catch (e) { console.error(e); } finally { busy = false; }
    }
    function restart() { clearInterval(timer); const m = EF.scanModes.find(m => m.id === $('#mode').value); if (S_stream) timer = setInterval(() => { if (EF.nav() === nav) loop(); }, m.interval); }
    let S_stream = null;
    $('#mode').onchange = () => { ctx.overlay.getContext('2d').clearRect(0, 0, ov.width, ov.height); restart(); };
    $('#startcam').onclick = async () => {
      try { S_stream = await EF.startCamera(video); $('#startcam').disabled = true; restart(); }
      catch (e) { $('#camerr').textContent = 'Camera unavailable: ' + (e.name === 'NotAllowedError' ? 'permission denied' : e.message); }
    };
    $('#code').onkeydown = async e => { if (e.key !== 'Enter') return; const v = e.target.value; e.target.value = ''; show(await EF.scanCode(v, $('#dir').value)); };
    async function loadFeed() {
      const D = EF.data; const ev = (await EF.db.all('attendance')).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
      const names = new Map((await D.students()).map(s => [s.id, D.fullName(s)]));
      put($('#feed'), html`${ev.map(e => html`<li><span>${names.get(e.studentId) || '?'}</span><span class="muted">${t(e.status)} · ${EF.fmtTime(e.at)}</span></li>`)}`);
    }
    EF.cleanups.push(() => { clearInterval(timer); EF.stopCamera(video); }); loadFeed(); $('#code').focus();
  } });

  // ---------------------------------------------------------------- daily attendance + manual override
  EF.registerPage({ id: 'attendance', titleKey: 'attendance', icon: '✓', order: 20, perm: 'attendance.read', async render(el, nav) {
    const st = { date: EF.todayISO(), classId: '' }; const classes = await EF.data.classes(); if (EF.nav() !== nav) return;
    async function draw() {
      let students = await EF.data.activeStudents(); if (st.classId) students = students.filter(s => s.classId === st.classId);
      const events = await A.eventsOn(st.date); const byStudent = new Map();
      for (const e of events) { if (!byStudent.has(e.studentId)) byStudent.set(e.studentId, []); byStudent.get(e.studentId).push(e); }
      const rows = students.map(s => { const evs = byStudent.get(s.id); const first = evs?.filter(e => e.direction === 'in').sort((a, b) => a.at.localeCompare(b.at))[0];
        return { s, status: rules.dailyStatus(evs), first: first?.at }; });
      const n = k => rows.filter(r => r.status === k).length; if (EF.nav() !== nav) return;
      put($('#dl'), html`<p class="row"><span class="badge ok">${t('present')} ${n('present')}</span><span class="badge warn">${t('late')} ${n('late')}</span><span class="badge bad">${t('absent')} ${n('absent')}</span><span class="badge">${t('excused')} ${n('excused')}</span></p>
        <div class="tablewrap"><table><thead><tr><th>No.</th><th>Name</th><th>Status</th><th>First seen</th><th></th></tr></thead><tbody>
        ${rows.map(r => html`<tr><td>${r.s.studentNo}</td><td>${EF.data.fullName(r.s)}</td><td><span class="badge ${r.status === 'present' ? 'ok' : r.status === 'absent' ? 'bad' : 'warn'}">${t(r.status)}</span></td><td>${EF.fmtTime(r.first)}</td>
          <td>${EF.can('attendance.override') ? html`<button class="small" data-act="override" data-id="${r.s.id}" data-name="${EF.data.fullName(r.s)}">Override</button>` : ''}</td></tr>`)}</tbody></table></div>`);
    }
    put(el, html`<header class="top"><h1>${t('attendance')}</h1>${EF.can('attendance.override') ? html`<button data-act="close-day">Close day (mark absent)</button>` : ''}</header>
      <div class="card"><div class="row"><div class="field"><label for="ad">Date</label><input id="ad" type="date" value="${st.date}"></div>
        <div class="field"><label for="ac">Class</label><select id="ac"><option value="">All</option>${classes.map(c => html`<option value="${c.id}">${c.name} ${c.stream || ''}</option>`)}</select></div></div><div id="dl"></div></div>`);
    $('#ad').onchange = e => { st.date = e.target.value; draw(); }; $('#ac').onchange = e => { st.classId = e.target.value; draw(); };
    EF.attPage = { st, draw }; draw();
  } });
  EF.actions.override = el => EF.modal(html`<h2>Manual override — ${el.dataset.name}</h2><form data-form="override" data-id="${el.dataset.id}">
    <div class="row"><div class="field"><label for="os">Status</label><select id="os" name="status"><option value="present">${t('present')}</option><option value="late">${t('late')}</option><option value="excused">${t('excused')}</option><option value="absent">${t('absent')}</option></select></div>
      <div class="field"><label for="od">Direction</label><select id="od" name="direction"><option value="in">${t('in')}</option><option value="out">${t('out')}</option></select></div></div>
    <div class="field"><label for="or">Reason (required; recorded in the audit log)</label><textarea id="or" name="reason" required minlength="5"></textarea></div>
    <p class="row"><button class="primary" type="submit">${t('save')}</button><button type="button" data-act="close">${t('cancel')}</button></p></form>`);
  EF.forms.override = async form => {
    const d = Object.fromEntries(new FormData(form)); if (d.reason.trim().length < 5) return toast('A reason of at least 5 characters is required.');
    const e = await EF.db.save('attendance', { studentId: form.dataset.id, date: EF.attPage.st.date, at: new Date().toISOString(), direction: d.direction, status: d.status, method: 'manual',
      confidence: null, overrideBy: EF.state.user.id, overrideReason: d.reason.trim() });
    await EF.audit.append('attendance.override', 'attendance', e.id, { studentId: form.dataset.id, status: d.status, reason: d.reason.trim() });
    EF.closeModal(); toast('Saved'); EF.attPage.draw();
  };
  EF.actions['close-day'] = async () => {
    const date = EF.attPage.st.date; if (!confirm(`Mark every active student with no scan on ${date} as absent?`)) return;
    const seen = new Set((await A.eventsOn(date)).map(e => e.studentId)); let n = 0;
    for (const s of await EF.data.activeStudents()) if (!seen.has(s.id)) {
      await EF.db.save('attendance', { studentId: s.id, date, at: new Date().toISOString(), direction: 'in', status: 'absent', method: 'manual', overrideBy: EF.state.user.id, overrideReason: 'Auto: no scan by day close' });
      for (const h of EF.hooks.studentAbsent || []) await h(s, date); n++;
    }
    await EF.audit.append('attendance.close_day', 'school', EF.state.schoolId, { date, markedAbsent: n }); toast(`${n} marked absent`); EF.attPage.draw();
  };

  // ---------------------------------------------------------------- dashboard widget with 7-day trend
  EF.widgets.push({ order: 30, perm: 'attendance.read', render: async () => {
    const students = await EF.data.activeStudents(); const total = students.length; const ids = new Set(students.map(s => s.id));
    const days = []; for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(localDate(d)); }
    const perDay = {};
    for (const e of await EF.db.all('attendance')) if (days.includes(e.date) && e.direction === 'in' && (e.status === 'present' || e.status === 'late') && ids.has(e.studentId)) (perDay[e.date] ||= new Set()).add(e.studentId);
    const today = days[6]; const evs = await A.eventsOn(today); const by = new Map(); for (const e of evs) (by.get(e.studentId) || by.set(e.studentId, []).get(e.studentId)).push(e);
    let present = 0, late = 0, absent = 0; for (const s of students) { const st = rules.dailyStatus(by.get(s.id)); if (st === 'present') present++; else if (st === 'late') late++; else if (st === 'absent') absent++; }
    const rate = d => total ? Math.round(1000 * (perDay[d]?.size || 0) / total) / 10 : 0;
    return html`<div class="grid">
      <div class="card stat"><div class="n">${total ? Math.round(1000 * (present + late) / total) / 10 : 0}%</div><div class="l">${t('attendance')} today</div></div>
      <div class="card stat"><div class="n">${present}</div><div class="l">${t('present')}</div></div><div class="card stat"><div class="n">${late}</div><div class="l">${t('late')}</div></div>
      <div class="card stat"><div class="n">${absent}</div><div class="l">${t('absent')}</div></div></div>
      <div class="card"><h2>Last 7 days</h2><div class="bars" role="img" aria-label="Attendance rate per day" data-rates="${days.map(rate).join(',')}">${days.map(() => html`<div class="b"></div>`)}</div>
        <div class="bars-x">${days.map(d => html`<div>${d.slice(5)}</div>`)}</div></div>`;
  } });
  // bar heights are set after render (the strict CSP forbids inline style attributes)
  new MutationObserver(() => $$('.bars[data-rates]').forEach(bars => { if (bars.dataset.done) return; bars.dataset.done = '1';
    const rates = bars.dataset.rates.split(',').map(Number); $$('.b', bars).forEach((b, i) => { b.style.height = Math.max(2, rates[i]) + '%'; const s = document.createElement('span'); s.textContent = rates[i] + '%'; b.append(s); }); }))
    .observe(document.documentElement, { childList: true, subtree: true });
})();
