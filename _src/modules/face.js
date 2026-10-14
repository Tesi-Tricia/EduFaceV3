// guardian consent, face enrolment, live face scan. Recognition runs in the browser (face-api: tiny detector + 68-point landmarks +
// 128-number face descriptor). Only descriptors are stored, encrypted with the data key (AES-256-GCM); photos are never saved.
'use strict';
(function () {
  const EF = window.EF, { html, put, $, t, toast } = EF;
  EF.stores.push({ name: 'consents', key: 'id', indexes: [['student', 'studentId']] }, { name: 'faces', key: 'id', indexes: [['student', 'studentId']] });
  EF.addStrings('en', { face: 'Face', consent_needed: 'No guardian consent' });
  const MIN = 3, MAX = 5, MODEL_DIR = 'lib/models';

  // ---------------------------------------------------------------- consent (most recent decision wins; a tie goes to "withdrawn")
  const consent = EF.consent = {
    isGranted(records) {
      if (!records.length) return false;
      const latest = records.reduce((m, r) => r.grantedAt > m ? r.grantedAt : m, '');
      return records.filter(r => r.grantedAt === latest).every(r => r.status === 'granted');
    },
    async forStudent(studentId, purpose) { return (await EF.db.where('consents', 'student', studentId)).filter(c => c.purpose === purpose); },
    async has(studentId, purpose) { return consent.isGranted(await consent.forStudent(studentId, purpose)); },
    async record(studentId, guardianId, purpose, status) {
      const c = await EF.db.save('consents', { studentId, guardianId, purpose, status, policyVersion: '1.0', grantedAt: EF.now(), recordedBy: EF.state.user.id });
      await EF.audit.append('consent.' + status, 'student', studentId, { purpose });
      if (purpose === 'biometric_attendance' && status === 'withdrawn') { const n = await faces.purge(studentId); await EF.audit.append('face.deleted_on_withdrawal', 'student', studentId, { removed: n }); }
      return c;
    },
  };

  // ---------------------------------------------------------------- face models
  let modelsP = null;
  const F = EF.face = {
    status: 'idle', error: null,
    ready() {
      if (modelsP) return modelsP;
      F.status = 'loading';
      modelsP = (async () => {
        if (typeof faceapi === 'undefined') throw new Error('Face library not found (lib/face-api.js).');
        await faceapi.tf.ready();
        await Promise.all([faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_DIR), faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_DIR), faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_DIR)]);
        F.backend = faceapi.tf.getBackend(); F.status = 'warming';
        // The first run of each network compiles GPU programs (can take 30+ s on older graphics chips). Do it once here, with a visible
        // "preparing" state, instead of freezing the first real scan. Later scans take about 0.1-0.4 s.
        const dummy = (n) => { const c = document.createElement('canvas'); c.width = c.height = n; const g = c.getContext('2d'); g.fillStyle = '#777'; g.fillRect(0, 0, n, n); return c; };
        await faceapi.detectAllFaces(dummy(416), new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }));
        await faceapi.nets.faceLandmark68TinyNet.detectLandmarks(dummy(112));
        await faceapi.nets.faceRecognitionNet.computeFaceDescriptor(dummy(150));
        F.status = 'ready';
      })().catch(e => { F.status = 'error'; F.error = e.message; modelsP = null; throw e; });
      return modelsP;
    },
    /** Largest face in a canvas/video: { box, points[68], descriptor(Float32Array 128), faces } or null. Replaceable (tests inject a fake). */
    async detect(input) {
      await F.ready();
      const res = await faceapi.detectAllFaces(input, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 })).withFaceLandmarks(true).withFaceDescriptors();
      if (!res.length) return null;
      const big = res.reduce((m, r) => r.detection.box.area > m.detection.box.area ? r : m);
      const b = big.detection.box;
      return { box: { x: b.x, y: b.y, w: b.width, h: b.height }, points: big.landmarks.positions.map(p => ({ x: p.x, y: p.y })), descriptor: big.descriptor, faces: res.length };
    },
  };

  // ---------------------------------------------------------------- quality gate (size, light, sharpness, angle)
  F.quality = (canvas, det) => {
    const { box, points } = det; const hints = [];
    const size = Math.min(box.w, box.h);
    const x = Math.max(0, Math.round(box.x)), y = Math.max(0, Math.round(box.y)), w = Math.min(Math.round(box.w), canvas.width - x), h = Math.min(Math.round(box.h), canvas.height - y);
    if (w < 8 || h < 8) return { ok: false, hints: ['Face not fully in frame'], size, brightness: 0, blur: 0, yaw: 0 };
    const c = document.createElement('canvas'); c.width = c.height = 96; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(canvas, x, y, w, h, 0, 0, 96, 96);
    const d = g.getImageData(0, 0, 96, 96).data; const gray = new Float32Array(96 * 96); let sum = 0;
    for (let i = 0; i < gray.length; i++) { gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; sum += gray[i]; }
    const brightness = sum / gray.length;
    let m = 0, m2 = 0, n = 0;   // variance of the Laplacian = sharpness
    for (let r = 1; r < 95; r++) for (let q = 1; q < 95; q++) { const i = r * 96 + q; const l = gray[i - 1] + gray[i + 1] + gray[i - 96] + gray[i + 96] - 4 * gray[i]; m += l; m2 += l * l; n++; }
    const blur = m2 / n - (m / n) ** 2;
    const eyeDist = Math.abs(points[45].x - points[36].x) || 1; const yaw = (points[30].x - (points[36].x + points[45].x) / 2) / eyeDist;
    if (size < 90) hints.push('Move closer'); if (blur < 25) hints.push('Hold still / improve focus'); if (brightness < 50) hints.push('Too dark'); if (brightness > 215) hints.push('Too bright'); if (Math.abs(yaw) > 0.35) hints.push('Face the camera');
    return { ok: hints.length === 0, hints, size, brightness, blur, yaw };
  };

  // ---------------------------------------------------------------- stored faces + in-memory index
  const index = new Map();   // studentId -> Float32Array[]
  const faces = EF.faces = {
    async count(studentId) { return (await EF.db.where('faces', 'student', studentId)).length; },
    async add(studentId, descriptor, quality) {
      const row = await EF.db.save('faces', { studentId, enc: await EF.crypto.sealFloats(EF.state.dek, new Float32Array(descriptor)), model: 'faceapi-resnet-128', quality: Math.round(quality) });
      if (!index.has(studentId)) index.set(studentId, []); index.get(studentId).push(new Float32Array(descriptor)); return row;
    },
    async loadIndex() { index.clear(); for (const r of await EF.db.all('faces')) { try { const v = await EF.crypto.openFloats(EF.state.dek, r.enc); if (!index.has(r.studentId)) index.set(r.studentId, []); index.get(r.studentId).push(v); } catch { console.error('face record could not be decrypted', r.id); } } },
    clearIndex() { index.clear(); },
    /** Wipes the biometric bytes, then removes the rows: nothing is left to recover. */
    async purge(studentId) {
      const rows = await EF.db.where('faces', 'student', studentId, { includeDeleted: true });
      for (const r of rows) { r.enc = ''; await EF.db.putRaw('faces', r); await EF.db.hardDelete('faces', r.id); }
      index.delete(studentId); return rows.length;
    },
    indexedStudents: () => index.size, indexedFaces: () => [...index.values()].reduce((n, a) => n + a.length, 0),
    /** Nearest enrolled student by Euclidean distance; margin = gap to the next-best DIFFERENT student. */
    search(desc) {
      let best = null, d1 = Infinity, d2 = Infinity;
      for (const [id, vecs] of index) {
        let top = Infinity; for (const v of vecs) { let s = 0; for (let i = 0; i < v.length; i++) { const x = v[i] - desc[i]; s += x * x; } const d = Math.sqrt(s); if (d < top) top = d; }
        if (top < d1) { d2 = d1; d1 = top; best = id; } else if (top < d2) d2 = top;
      }
      return best === null ? { studentId: null, distance: Infinity, margin: 0 } : { studentId: best, distance: d1, margin: d2 === Infinity ? Infinity : d2 - d1 };
    },
  };
  // Preparing the face engine compiles GPU programs: about 5 s normally, but up to a minute the very first time on older graphics chips,
  // and the page can pause while it happens. So: let the app draw first, show a banner, then start (can be switched off in Settings).
  async function prepareWithBanner() {
    if (F.status === 'ready' || F.status === 'loading' || F.status === 'warming' || !(await EF.db.getSetting('face.autostart', true))) return;
    const b = document.createElement('div'); b.className = 'toast'; b.id = 'facebanner'; b.textContent = 'Preparing face recognition… the screen may pause for a moment (the first time can take up to a minute).'; document.body.append(b);
    await new Promise(r => setTimeout(r, 900));   // give the browser time to paint the banner and the app before the heavy work starts
    try { await F.ready(); } catch { /* the Scan page reports the problem */ } finally { b.remove(); }
  }
  EF.hooks.afterLogin = (EF.hooks.afterLogin || []).concat(() => faces.loadIndex(), () => { prepareWithBanner(); });
  EF.face.prepare = prepareWithBanner;
  EF.hooks.afterLogout = (EF.hooks.afterLogout || []).concat(() => faces.clearIndex());

  const maxDist = () => EF.db.getSetting('face.max_distance', 0.5);
  const minMargin = () => EF.db.getSetting('face.margin', 0.08);

  // ---------------------------------------------------------------- identify (shared by the scan page)
  F.identify = async (canvas, det) => {
    const q = F.quality(canvas, det);
    if (det.faces > 1) return { result: 'low_quality', hints: ['One person at a time'], box: det.box };
    if (!q.ok) return { result: 'low_quality', hints: q.hints, box: det.box };
    const m = faces.search(det.descriptor);
    if (m.studentId === null || m.distance > await maxDist()) return { result: 'unknown', box: det.box, distance: m.distance };
    if (m.margin < await minMargin()) return { result: 'ambiguous', box: det.box, distance: m.distance };   // two close candidates: never guess
    const s = await EF.data.student(m.studentId); if (!s || s.deletedAt) return { result: 'unknown', box: det.box };
    if (!(await consent.has(s.id, 'biometric_attendance'))) return { result: 'no_consent', box: det.box };
    return { student: s, distance: m.distance, box: det.box };
  };

  function drawBox(canvas, video, sentW, box, ok) {
    const cw = canvas.clientWidth, ch = canvas.clientHeight; canvas.width = cw; canvas.height = ch; const g = canvas.getContext('2d'); g.clearRect(0, 0, cw, ch);
    if (!box || !video.videoWidth) return; const vr = video.videoWidth / video.videoHeight; const dw = Math.min(cw, ch * vr), dh = dw / vr, ox = (cw - dw) / 2, oy = (ch - dh) / 2, k = dw / sentW;
    g.lineWidth = 4; g.strokeStyle = ok === true ? '#35d36b' : ok === false ? '#ff5a4f' : '#f2bb55'; g.strokeRect(ox + box.x * k, oy + box.y * k, box.w * k, box.h * k);
  }

  EF.scanModes.push({ id: 'face', label: 'Face (webcam)', interval: 1200,
    async frame(video, ctx) {
      if (F.status === 'idle') F.ready().catch(() => { });
      if (F.status === 'loading' || F.status === 'warming' || F.status === 'idle') return { result: 'loading_models' };
      if (F.status === 'error') return { result: 'error_models' };
      const f = ctx.grab(video, 640); const det = await F.detect(f.canvas);
      if (!det) { drawBox(ctx.overlay, video, f.w, null); return { result: 'no_face' }; }
      const r = await F.identify(f.canvas, det);
      if (!r.student) { drawBox(ctx.overlay, video, f.w, r.box, r.result === 'low_quality' ? null : false); return r; }
      const rec = await EF.attendance.record({ student: r.student, direction: ctx.direction(), method: 'face', confidence: Math.max(0, 1 - r.distance) });
      drawBox(ctx.overlay, video, f.w, r.box, true);
      if (rec.outcome === 'inactive') return { result: 'inactive', name: EF.data.fullName(r.student) };
      return { result: rec.outcome === 'duplicate' ? 'duplicate' : 'matched', name: EF.data.fullName(r.student), status: rec.event.status, direction: rec.event.direction, confidence: Math.max(0, 1 - r.distance), studentId: r.student.id };
    } });

  // ---------------------------------------------------------------- student list button
  EF.pageExtra = EF.pageExtra || {};
  const prevRow = EF.pageExtra.studentRow;
  EF.pageExtra.studentRow = s => html`${prevRow ? prevRow(s) : ''}${EF.can('students.write') ? html`<button class="small" data-act="enroll-go" data-id="${s.id}">Enrol face</button>` : ''}`;
  EF.actions['enroll-go'] = el => { location.hash = '#/enroll?student=' + el.dataset.id; };

  // ---------------------------------------------------------------- enrolment wizard
  EF.registerPage({ id: 'enroll', titleKey: 'enroll', icon: '✚', order: 15, perm: 'students.write', async render(el, nav) {
    const sel = (location.hash.split('student=')[1] || '').split('&')[0];
    const students = await EF.data.activeStudents(); const counts = new Map(); for (const r of await EF.db.all('faces')) counts.set(r.studentId, (counts.get(r.studentId) || 0) + 1); if (EF.nav() !== nav) return;
    put(el, html`<header class="top"><h1>${t('enroll')}</h1></header>
      <div class="alert" role="alert">⚠ Anti-spoofing is not included: a printed photo or a phone screen could fool the camera. Do not use face scan as proof of identity.</div>
      <div class="card"><div class="field"><label for="es">1. Choose the student</label><select id="es"><option value="">—</option>
        ${students.map(s => html`<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${s.studentNo} · ${EF.data.fullName(s)} ${counts.get(s.id) >= MIN ? '✓ enrolled' : counts.get(s.id) ? `(${counts.get(s.id)} frames)` : ''}</option>`)}</select></div></div><div id="ewiz"></div>`);
    $('#es').onchange = () => wizard($('#es').value); if (sel) wizard(sel);

    async function wizard(id) {
      const box = $('#ewiz'); if (!id) return put(box, ''); const s = await EF.data.student(id); const guardians = s.guardians || [];
      if (!(await consent.has(id, 'biometric_attendance'))) {
        return put(box, html`<div class="card"><h2>2. Guardian consent</h2><p>Face scanning of a child needs the guardian's <strong>written consent</strong>. Children without consent use the QR card or manual check-in instead.</p>
          ${guardians.length ? '' : html`<div class="alert">This student has no guardian on file. Edit the student and add one first.</div>`}
          ${EF.can('consent.*') ? html`<form data-form="consent" data-id="${id}"><div class="field"><label for="gd">Guardian who consented</label><select id="gd" name="guardianId" required>${guardians.map(x => html`<option value="${x.id}">${x.fullName} ${x.relationship ? '(' + x.relationship + ')' : ''}</option>`)}</select></div>
            <p><label class="row"><input type="checkbox" name="ok" required> I hold a signed consent form from this guardian for face-based attendance.</label></p>
            <p><label class="row"><input type="checkbox" name="notify"> Guardian also agreed to message notifications.</label></p><p><button class="primary" type="submit" ${guardians.length ? '' : 'disabled'}>Record consent</button></p></form>`
            : html`<p class="alert">Only an administrator can record consent.</p>`}</div>`);
      }
      let count = await faces.count(id);
      put(box, html`<div class="card"><h2>2. Consent recorded ✓</h2><p class="muted">Consent can be withdrawn at any time; this deletes the student's face data immediately.</p>
        ${EF.can('consent.*') ? html`<button class="small danger" data-act="withdraw" data-id="${id}" data-g="${guardians[0]?.id || ''}">Withdraw consent and delete face data</button>` : ''}</div>
        <div class="card"><h2>3. Capture ${MIN}–${MAX} clear frames</h2><p class="muted">Face the camera, good light, one person only. Change the angle slightly between frames.</p>
          <div class="camwrap" id="cw"><video id="cam" playsinline muted></video><canvas id="ov"></canvas></div>
          <p class="row"><button class="primary" id="startcam">Start camera</button><button id="cap" disabled>Capture frame</button><button id="auto" disabled>Auto-capture</button><button id="done" disabled>Finish</button><span class="muted" id="camerr"></span></p>
          <div id="prog" class="row" aria-live="polite"></div><div id="hint" class="alert hidden" role="alert"></div></div>`);
      const video = $('#cam'); let busy = false, timer = null;
      const progress = () => put($('#prog'), html`${[0, 1, 2, 3, 4].map(i => html`<span class="badge ${i < count ? 'ok' : ''}">${i < count ? '✓' : i + 1}</span>`)} <span class="muted">${count} / ${MIN} minimum</span>`); progress(); $('#done').disabled = count < MIN;
      const hint = m => { const h = $('#hint'); if (m) { h.classList.remove('hidden'); h.textContent = m; } else h.classList.add('hidden'); };
      async function capture() {
        if (busy || !video.videoWidth || count >= MAX) return; busy = true;
        try {
          const c = document.createElement('canvas'); const sc = Math.min(1, 800 / video.videoWidth); c.width = Math.round(video.videoWidth * sc); c.height = Math.round(video.videoHeight * sc); c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
          const det = await F.detect(c);
          if (!det) return hint('No face found: look at the camera'); if (det.faces > 1) return hint('One person at a time');
          const q = F.quality(c, det); if (!q.ok) return hint(q.hints.join(' · '));
          const m = faces.search(det.descriptor);   // is this face already enrolled for ANOTHER student?
          if (m.studentId && m.studentId !== id && m.distance <= await maxDist()) return hint('This face matches another student — check identity (twins/siblings need extra care).');
          await faces.add(id, det.descriptor, q.blur); count++; hint(null); progress(); EF.beep('ok'); $('#done').disabled = count < MIN; if (count >= MAX) { clearInterval(timer); }
        } catch (e) { hint(e.message); } finally { busy = false; }
      }
      $('#startcam').onclick = async () => { try { const st = await EF.startCamera(video); EF.cleanups.push(() => { clearInterval(timer); EF.stopCamera(video); }); $('#cap').disabled = false; $('#auto').disabled = false; $('#startcam').disabled = true; F.ready().catch(e => hint('Face models failed to load: ' + e.message)); } catch (e) { $('#camerr').textContent = 'Camera unavailable: ' + e.message; } };
      $('#cap').onclick = capture; $('#auto').onclick = () => { clearInterval(timer); timer = setInterval(capture, 1800); $('#auto').disabled = true; };
      $('#done').onclick = async () => { await EF.audit.append('face.enrolled', 'student', id, { frames: count }); EF.stopLive(); toast('Enrolment complete'); location.hash = '#/students'; };
    }
  } });
  EF.forms.consent = async form => {
    const d = Object.fromEntries(new FormData(form)); const id = form.dataset.id;
    await consent.record(id, d.guardianId, 'biometric_attendance', 'granted'); if (d.notify) await consent.record(id, d.guardianId, 'notifications', 'granted'); toast('Consent recorded'); EF.nav(); location.hash = '#/enroll?student=' + id; EF.showApp();
  };
  EF.actions.withdraw = async el => {
    if (!confirm('Withdraw consent? ALL face data for this student will be deleted now.')) return;
    await consent.record(el.dataset.id, el.dataset.g, 'biometric_attendance', 'withdrawn'); toast('Consent withdrawn; face data deleted'); EF.showApp();
  };

  // ---------------------------------------------------------------- dashboard + settings
  EF.widgets.push({ order: 50, perm: 'students.read', render: async () => html`<div class="card"><h2>Face recognition</h2><p>Enrolled students: <strong>${faces.indexedStudents()}</strong> · Face templates: ${faces.indexedFaces()} ·
    Models: <span class="badge ${F.status === 'ready' ? 'ok' : F.status === 'error' ? 'bad' : ''}">${F.status === 'idle' ? 'load on first use' : F.status}</span> · Anti-spoofing: <span class="badge warn">off</span></p></div>` });
  EF.settingsSections.push({ perm: 'school.*', async render() {
    return html`<form class="card" data-form="facesettings"><h2>Face recognition</h2><div class="row">
      <div class="field"><label for="fd">Maximum distance to accept a match (lower = stricter)</label><input id="fd" name="max" type="number" step="0.01" min="0.2" max="0.8" value="${await maxDist()}"></div>
      <div class="field"><label for="fm">Required gap to the next-best student</label><input id="fm" name="margin" type="number" step="0.01" min="0" max="0.3" value="${await minMargin()}"></div></div>
      <p><label class="row"><input type="checkbox" name="autostart" ${(await EF.db.getSetting('face.autostart', true)) ? 'checked' : ''}> Prepare the face engine when someone signs in (turn off on computers that do not scan faces; the engine then starts when you first use it)</label></p>
      <p class="hint">Defaults 0.50 and 0.08. Change only after measuring accuracy on your own students and camera (see the accuracy plan in Help).</p><p><button class="primary" type="submit">${t('save')}</button></p></form>`;
  } });
  EF.forms.facesettings = async form => { const d = Object.fromEntries(new FormData(form)); await EF.db.setSetting('face.max_distance', Number(d.max)); await EF.db.setSetting('face.margin', Number(d.margin)); await EF.db.setSetting('face.autostart', !!d.autostart); await EF.audit.append('settings.face', 'school', EF.state.schoolId, d); toast('Saved'); };
})();
