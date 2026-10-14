// Self-test: runs the app's own logic in THIS browser against a throw-away database ("EduFace-phaseselftest"). Your real data is never touched.
'use strict';
(function () {
  const EF = window.EF; EF.PHASE = 'selftest';
  const tests = []; const test = (name, fn, opt = {}) => tests.push({ name, fn, ...opt });
  const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || 'not equal'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
  const ok = (c, msg) => { if (!c) throw new Error(msg || 'assertion failed'); };
  const fails = async (fn, msg) => { try { await fn(); } catch (e) { return e; } throw new Error(msg || 'expected an error'); };
  const rnd = seed => { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647 - 0.5; };
  const person = seed => { const r = rnd(seed); const v = new Float32Array(128).map(() => r()); const n = Math.hypot(...v); return v.map(x => x / n * 0.9); };
  const noisy = (v, seed, a) => { const r = rnd(seed); return v.map(x => x + r() * a); };
  const textured = () => { const c = document.createElement('canvas'); c.width = 640; c.height = 480; const g = c.getContext('2d'); const id = g.createImageData(640, 480); for (let i = 0; i < id.data.length; i += 4) { const v = 90 + Math.random() * 90; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; } g.putImageData(id, 0, 0); return c; };
  const pts = (yaw = 0) => { const p = Array.from({ length: 68 }, () => ({ x: 200, y: 160 })); p[36] = { x: 150, y: 140 }; p[45] = { x: 250, y: 140 }; p[30] = { x: 200 + yaw * 100, y: 180 }; return p; };
  const PW = 'correct-horse-9';

  // ---------------------------------------------------------------- crypto
  test('SHA-256 matches the published test vector', async () => eq(await EF.crypto.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'));
  test('Password hashing: right password verifies, wrong does not, hashes are salted', async () => {
    const a = await EF.crypto.hashPassword('s3cret-pass-1'), b = await EF.crypto.hashPassword('s3cret-pass-1');
    ok(await EF.crypto.verifyPassword('s3cret-pass-1', a)); ok(!(await EF.crypto.verifyPassword('s3cret-pass-2', a))); ok(a.hash !== b.hash, 'same password gave the same hash');
  });
  test('Data key: wrapped per password, unwraps only with the right one, round-trips face data', async () => {
    const dek = await EF.crypto.newDek(); const w = await EF.crypto.wrapDek(dek, 'pass-number-one');
    const dek2 = await EF.crypto.unwrapDek(w, 'pass-number-one'); const f = new Float32Array([0.25, -1.5, 3]);
    eq(Array.from(await EF.crypto.openFloats(dek2, await EF.crypto.sealFloats(dek, f))), [0.25, -1.5, 3]);
    await fails(() => EF.crypto.unwrapDek(w, 'pass-number-two'), 'wrong password unwrapped the key');
  });
  test('Face template blob is nonce+ciphertext+tag (540 bytes) and tampering is detected', async () => {
    const dek = await EF.crypto.newDek(); const blob = await EF.crypto.sealFloats(dek, new Float32Array(128)); eq(EF.unb64(blob).length, 12 + 512 + 16);
    const bytes = EF.unb64(blob); bytes[40] ^= 1; await fails(() => EF.crypto.openFloats(dek, EF.b64(bytes)), 'tampered blob accepted');
  });
  test('Backup sealing: no plaintext, wrong passphrase and tampering are refused', async () => {
    const s = await EF.crypto.sealJson('a-long-passphrase', { name: 'Amina Nakato' }); ok(!s.includes('Amina'));
    eq((await EF.crypto.openJson('a-long-passphrase', s)).name, 'Amina Nakato'); await fails(() => EF.crypto.openJson('another-passphrase', s));
    const w = JSON.parse(s); w.ct = w.ct.slice(0, 20) + (w.ct[20] === 'A' ? 'B' : 'A') + w.ct.slice(21); await fails(() => EF.crypto.openJson('a-long-passphrase', JSON.stringify(w)));
  });

  // ---------------------------------------------------------------- csv + rules
  test('CSV: quotes, commas and newlines inside quotes, escaped quotes', () => eq(EF.parseCsv('a,b\n"x, y","he said ""hi"""\n'), [['a', 'b'], ['x, y', 'he said "hi"']]));
  test('CSV export neutralises spreadsheet formulas but keeps negative numbers', () => { const c = EF.toCsv(['n'], [['=HYPERLINK("x")'], ['+1+1'], ['-5'], ['plain']]); ok(c.includes("'=HYPERLINK") && c.includes("'+1+1") && c.includes('\r\n-5')); });
  test('Late cut-off boundaries and daily status', () => {
    eq([EF.rules.statusForArrival('08:15', '08:15'), EF.rules.statusForArrival('08:16', '08:15')], ['present', 'late']);
    eq(EF.rules.dailyStatus([]), 'absent'); eq(EF.rules.dailyStatus([{ at: '1', direction: 'in', status: 'late' }]), 'late');
    eq(EF.rules.dailyStatus([{ at: '1', direction: 'in', status: 'present' }, { at: '2', direction: 'in', status: 'excused' }]), 'excused'); eq(EF.rules.dailyStatus([{ at: '1', direction: 'out', status: 'early_departure' }]), 'absent');
  });
  test('Consent rule: latest decision wins, a tie goes to "withdrawn"', () => {
    ok(!EF.consent.isGranted([])); ok(EF.consent.isGranted([{ grantedAt: '1', status: 'granted' }]));
    ok(!EF.consent.isGranted([{ grantedAt: '1', status: 'granted' }, { grantedAt: '2', status: 'withdrawn' }])); ok(!EF.consent.isGranted([{ grantedAt: '2', status: 'granted' }, { grantedAt: '2', status: 'withdrawn' }]));
    ok(EF.consent.isGranted([{ grantedAt: '1', status: 'withdrawn' }, { grantedAt: '2', status: 'granted' }]));
  });

  // ---------------------------------------------------------------- accounts, audit
  let amina, brian, cathy;
  test('First-time setup creates the school and an administrator who can sign in', async () => {
    await EF.auth.setup({ schoolName: 'Self-test School', adminName: 'Admin', email: 'Admin@Test.ug', password: PW }); await EF.auth.logout();
    const u = await EF.auth.login('admin@test.ug', PW); eq(u.role, 'SchoolAdmin'); ok(EF.state.dek, 'data key not unwrapped');
  });
  test('Five wrong passwords lock the account; a correct one is refused while locked', async () => {
    await EF.auth.createUser({ email: 'mary@test.ug', fullName: 'Mary', role: 'Teacher', password: 'teacher-pass-1' }); await EF.auth.logout();
    for (let i = 0; i < 5; i++) await fails(() => EF.auth.login('mary@test.ug', 'wrong-wrong-1'));
    const e = await fails(() => EF.auth.login('mary@test.ug', 'teacher-pass-1')); ok(/locked/i.test(e.message), 'not locked: ' + e.message);
    await EF.auth.login('admin@test.ug', PW); const mary = (await EF.db.where('users', 'email', 'mary@test.ug'))[0]; await EF.auth.resetPassword(mary.id, 'new-teacher-pass'); await EF.auth.logout();
    eq((await EF.auth.login('mary@test.ug', 'new-teacher-pass')).role, 'Teacher');
  });
  test('Roles: a teacher cannot manage users; their data key still opens', async () => {
    await fails(() => EF.auth.createUser({ email: 'x@test.ug', fullName: 'X', role: 'Teacher', password: 'longenough-1' })); ok(EF.can('attendance.override') && !EF.can('users.*') && !EF.can('backup.*'));
    await EF.auth.logout(); await EF.auth.login('admin@test.ug', PW);
  });
  test('Audit chain is intact, and editing any entry is detected', async () => {
    ok((await EF.audit.verify()).ok, 'chain broken at start'); const rows = await EF.db.all('audit', { includeDeleted: true }); const v = rows.find(r => r.action === 'user.create');
    const orig = v.detail; v.detail = '{"email":"someone-else"}'; await EF.db.putRaw('audit', v); eq((await EF.audit.verify()).ok, false); v.detail = orig; await EF.db.putRaw('audit', v); ok((await EF.audit.verify()).ok, 'chain should be intact again');
  });

  // ---------------------------------------------------------------- students, attendance, visitors
  test('CSV import: adds students and classes, reports bad rows and duplicates', async () => {
    await EF.importStudentsCsv('student_no,first_name,last_name,class,stream,guardian_name,guardian_phone,dob\nS-001,Amina,Nakato,S.2,East,Rose,+256700111222,2012-03-14\nS-002,Brian,Okello,S.2,East,Paul,+256700333444,\nS-001,Dup,Licate,,,,,\nS-003,Cathy,Auma,S.2,East,Grace,+256700555666,14/03/2012\n'); EF.closeModal();
    const st = await EF.data.students(); eq(st.length, 2, 'students after import'); eq((await EF.data.classes()).length, 1, 'classes'); [amina, brian] = st.sort((a, b) => a.studentNo.localeCompare(b.studentNo));
    cathy = await EF.db.save('students', { studentNo: 'S-003', firstName: 'Cathy', lastName: 'Auma', status: 'active', qrToken: EF.randomHex(16), guardians: [{ id: EF.uuid(), fullName: 'Grace', phone: '+256700555666' }] });
  });
  test('Scan by code: present, duplicate ignored, unknown refused, late after cut-off', async () => {
    await EF.db.setSetting('attendance.late_cutoff', '23:59'); eq((await EF.scanCode('S-001', 'in')).status, 'present'); eq((await EF.scanCode('S-001', 'in')).result, 'duplicate'); eq((await EF.scanCode('nope', 'in')).result, 'unknown_code');
    await EF.db.setSetting('attendance.late_cutoff', '00:00'); eq((await EF.scanCode(brian.qrToken, 'in')).status, 'late'); eq((await EF.scanCode(brian.qrToken, 'out')).status, 'early_departure');
  });
  test('A withdrawn student cannot be scanned in', async () => { const s = await EF.db.save('students', { studentNo: 'W-1', firstName: 'W', lastName: 'D', status: 'withdrawn', qrToken: EF.randomHex(16), guardians: [] }); eq((await EF.scanCode('W-1', 'in')).result, 'inactive'); await EF.db.remove('students', s.id); });
  test('Visitors: check-in, no double check-in, overstay flag, QR check-out, blocked visitor refused', async () => {
    const { visit, visitor } = await EF.visitors.checkIn({ fullName: 'John Okello', idNumber: 'CM123', purpose: 'Meeting', hostName: 'Head' }); ok(/^V-\d{8}-001$/.test(visit.badgeNo), 'badge no ' + visit.badgeNo);
    await fails(() => EF.visitors.checkIn({ fullName: 'John Okello', idNumber: 'CM123', purpose: 'Again' }));
    visit.checkedInAt = new Date(Date.now() - 150 * 60000).toISOString(); await EF.db.save('visits', visit); ok((await EF.visitors.onSite())[0].overstay, 'should be an overstay');
    await EF.visitors.checkOut({ qrToken: visit.qrToken }); eq((await EF.visitors.onSite()).length, 0); await fails(() => EF.visitors.checkOut({ qrToken: visit.qrToken }));
    visitor.watchlist = 'blocked'; visitor.watchlistReason = 'Trespass'; await EF.db.save('visitors', visitor); const e = await fails(() => EF.visitors.checkIn({ fullName: 'John Okello', idNumber: 'CM123', purpose: 'x' })); ok(e.blocked, 'not marked blocked');
  });
  test('Reports: late-comers and chronic absentees use only days someone arrived', async () => {
    const d = EF.todayISO(); const s = await EF.reports.summary(d, d); const row = n => s.find(r => r.studentNo === n); eq([row('S-001').present, row('S-002').late], [1, 1]);
    eq((await EF.reports.lateComers(d, d)).map(r => r.studentNo), ['S-002']); ok((await EF.reports.chronic(d, d, null, 50)).some(r => r.studentNo === 'S-003'), 'absent student should be chronic on a 1-day window');
  });

  // ---------------------------------------------------------------- face data, consent, messages, retention, backup
  test('Faces: stored encrypted, nearest student found, strangers refused, look-alikes flagged "not sure"', async () => {
    const A = person(11), B = person(22), C = person(33);
    await EF.consent.record(amina.id, amina.guardians[0].id, 'biometric_attendance', 'granted'); await EF.consent.record(brian.id, brian.guardians[0].id, 'biometric_attendance', 'granted');
    for (let i = 0; i < 3; i++) { await EF.faces.add(amina.id, noisy(A, 100 + i, 0.02), 300); await EF.faces.add(brian.id, noisy(B, 200 + i, 0.02), 300); }
    const raw = (await EF.db.all('faces'))[0]; ok(!JSON.stringify(raw).includes('Float32') && raw.enc.length > 100);
    const cv = textured(); const id = async (d, over) => EF.face.identify(cv, { box: { x: 100, y: 80, w: 220, h: 220 }, points: pts(over?.yaw), descriptor: d, faces: 1, ...over });
    eq((await id(noisy(A, 5, 0.02))).student.firstName, 'Amina'); eq((await id(C)).result, 'unknown'); eq((await id(A.map((x, i) => (x + B[i]) / 2))).result, 'ambiguous');
    eq((await id(A, { faces: 2 })).result, 'low_quality'); eq((await id(A, { yaw: 0.6 })).hints, ['Face the camera']);
    await EF.faces.add(cathy.id, noisy(C, 9, 0.02), 300); eq((await id(noisy(C, 10, 0.02))).result, 'no_consent');
  });
  test('Face scan end-to-end (stand-in detector): matched, duplicate ignored; withdrawing consent wipes the data', async () => {
    const A = person(11); const real = EF.face.detect; let cur = null; EF.face.detect = async () => cur && ({ box: { x: 100, y: 80, w: 220, h: 220 }, points: pts(), descriptor: cur, faces: 1 });
    try {
      const cam = textured(); cam.videoWidth = 640; cam.videoHeight = 480; const ctx = { direction: () => 'in', overlay: document.createElement('canvas'), grab(v, w) { const c = document.createElement('canvas'); c.width = 640; c.height = 480; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(v, 0, 0); return { canvas: c, ctx: g, w: 640, h: 480 }; } };
      const mode = EF.scanModes.find(m => m.id === 'face'); EF.face.status = 'ready'; await EF.db.setSetting('attendance.rescan_window_sec', 0); cur = noisy(A, 77, 0.02);
      const r = await mode.frame(cam, ctx); eq([r.result, r.name], ['matched', 'Amina Nakato']);
      await EF.db.setSetting('attendance.rescan_window_sec', 30); await EF.attendance.record({ student: amina, direction: 'out', method: 'manual' }); const r2 = await mode.frame(cam, ctx); ok(['matched', 'duplicate'].includes(r2.result));
      await EF.consent.record(amina.id, amina.guardians[0].id, 'biometric_attendance', 'withdrawn'); eq(await EF.faces.count(amina.id), 0, 'face rows after withdrawal'); eq((await mode.frame(cam, ctx)).result, 'unknown');
    } finally { EF.face.detect = real; }
  });
  test('Guardian messages: only with consent, never queued twice', async () => {
    await EF.db.clear('messages'); await EF.consent.record(brian.id, brian.guardians[0].id, 'notifications', 'granted'); const before = (await EF.db.all('messages')).length;
    await EF.messages.enqueue(amina, 'arrived', '2026-01-01', EF.now()); eq((await EF.db.all('messages')).length, before, 'queued without consent');
    await EF.messages.enqueue(brian, 'late', '2026-01-01', EF.now()); await EF.messages.enqueue(brian, 'late', '2026-01-01', EF.now()); eq((await EF.db.all('messages')).length, before + 1, 'dedupe');
  });
  test('Retention: face data of a long-withdrawn student is purged (dry run changes nothing)', async () => {
    await EF.faces.add(cathy.id, person(33), 300); const c = await EF.data.student(cathy.id); c.status = 'withdrawn'; c.statusChangedAt = new Date(Date.now() - 100 * 864e5).toISOString(); await EF.db.save('students', c);
    const dry = await EF.retention.run(true); ok(dry.faces >= 1); ok((await EF.faces.count(cathy.id)) >= 1, 'dry run deleted data'); await EF.retention.run(false); eq(await EF.faces.count(cathy.id), 0);
  });
  test('Backup: dump, wipe, restore - records and the audit chain come back intact', async () => {
    const n = (await EF.db.all('students')).length; const sealed = await EF.crypto.sealJson('a-long-passphrase', { dump: await EF.db.dumpAll() });
    await EF.db.clear('students'); eq((await EF.db.all('students')).length, 0); await EF.db.loadAll((await EF.crypto.openJson('a-long-passphrase', sealed)).dump); eq((await EF.db.all('students')).length, n); ok((await EF.audit.verify()).ok);
    await EF.auth.logout(); await EF.auth.login('admin@test.ug', PW);
  });
  test('Face engine: models load and a blank picture has no face (slow on old graphics chips; optional)', async () => {
    await EF.face.ready(); const c = document.createElement('canvas'); c.width = 640; c.height = 480; c.getContext('2d').fillRect(0, 0, 640, 480); eq(await EF.face.detect(c), null);
  }, { slow: true });

  // ---------------------------------------------------------------- runner
  async function freshDb() { await new Promise(res => { const r = indexedDB.deleteDatabase(EF.db.name()); r.onsuccess = r.onerror = r.onblocked = () => res(); }); }
  async function runAll(includeSlow) {
    const out = document.getElementById('out'); out.innerHTML = ''; const sum = document.getElementById('sum'); sum.textContent = 'Running…'; let pass = 0, fail = 0, skipped = 0;
    await freshDb(); await EF.db.open(); await EF.db.setSetting('face.autostart', false);   // do not start the heavy face engine at every test sign-in
    for (const tc of tests) {
      const li = document.createElement('li'); if (tc.slow && !includeSlow) { li.className = 'skip'; li.textContent = 'SKIP  ' + tc.name; out.append(li); skipped++; continue; }
      const t0 = performance.now();
      try { await tc.fn(); li.className = 'pass'; li.textContent = `PASS  ${tc.name}  (${Math.round(performance.now() - t0)} ms)`; pass++; }
      catch (e) { li.className = 'fail'; li.textContent = `FAIL  ${tc.name}\n      ${e.message}`; fail++; console.error(tc.name, e); }
      out.append(li);
    }
    sum.textContent = `${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ''}`; sum.className = fail ? 'fail' : 'pass'; document.title = fail ? 'SELFTEST FAILED' : 'SELFTEST PASSED';
    window.__selftest = { pass, fail, skipped };
  }
  document.getElementById('run').onclick = () => runAll(document.getElementById('slow').checked);
  document.getElementById('wipe').onclick = async () => { await freshDb(); document.getElementById('sum').textContent = 'Test database deleted.'; };
  window.addEventListener('load', () => { if (location.search.includes('auto')) runAll(location.search.includes('slow')); });
})();
