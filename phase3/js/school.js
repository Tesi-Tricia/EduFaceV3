// classes, students (with guardians), CSV import/export, QR cards, dashboard numbers.
'use strict';
(function () {
  const EF = window.EF, { html, put, $, $$, t, toast } = EF;
  EF.stores.push(
    { name: 'classes', key: 'id' },
    { name: 'students', key: 'id', indexes: [['no', 'studentNo'], ['qr', 'qrToken']] },
  );

  // ---------------------------------------------------------------- data helpers (used by later phases)
  const D = EF.data = {
    classes: () => EF.db.all('classes'),
    students: async () => (await EF.db.all('students')).sort((a, b) => (a.lastName + a.firstName).localeCompare(b.lastName + b.firstName)),
    activeStudents: async () => (await D.students()).filter(s => s.status === 'active'),
    student: id => EF.db.get('students', id),
    studentByQr: async token => (await EF.db.where('students', 'qr', token))[0] || null,
    className: (classes, id) => { const c = classes.find(c => c.id === id); return c ? c.name + (c.stream ? ' ' + c.stream : '') : ''; },
    fullName: s => `${s.firstName} ${s.lastName}`,
  };
  EF.qrDataUrl = (text, cell = 6) => { const q = qrcode(0, 'M'); q.addData(String(text)); q.make(); return q.createDataURL(cell, 2); };
  const newToken = () => EF.randomHex(16);

  // ---------------------------------------------------------------- dashboard widget
  EF.widgets.push({ order: 20, perm: 'students.read', render: async () => {
    const [st, cl] = await Promise.all([D.students(), D.classes()]);
    const active = st.filter(s => s.status === 'active').length;
    return EF.html`<div class="grid">
      <div class="card stat"><div class="n">${active}</div><div class="l">Active students</div></div>
      <div class="card stat"><div class="n">${cl.length}</div><div class="l">Classes</div></div>
      <div class="card stat"><div class="n">${st.length - active}</div><div class="l">Graduated / withdrawn / suspended</div></div></div>`;
  } });

  // ---------------------------------------------------------------- students page
  EF.registerPage({ id: 'students', titleKey: 'students', icon: '☺', order: 10, perm: 'students.read', async render(el, nav) {
    const st = { q: '', classId: '', page: 1 }; let classes = await D.classes(); if (EF.nav() !== nav) return;
    const canWrite = EF.can('students.write');
    async function draw() {
      let list = await D.students();
      if (st.classId) list = list.filter(s => s.classId === st.classId);
      if (st.q) { const q = st.q.toLowerCase(); list = list.filter(s => (s.firstName + ' ' + s.lastName + ' ' + s.studentNo).toLowerCase().includes(q)); }
      const pages = Math.max(1, Math.ceil(list.length / 25)); st.page = Math.min(st.page, pages);
      const slice = list.slice((st.page - 1) * 25, st.page * 25);
      if (EF.nav() !== nav) return;
      put($('#stlist'), html`<div class="tablewrap"><table><thead><tr><th>No.</th><th>Name</th><th>Class</th><th>Status</th><th></th></tr></thead><tbody>
        ${slice.map(s => html`<tr><td>${s.studentNo}</td><td>${D.fullName(s)}</td><td>${D.className(classes, s.classId)}</td>
          <td><span class="badge ${s.status === 'active' ? 'ok' : 'warn'}">${s.status}</span></td>
          <td class="row"><button class="small" data-act="qr-card" data-id="${s.id}">QR card</button>
            ${EF.pageExtra?.studentRow ? EF.pageExtra.studentRow(s) : ''}
            ${canWrite ? html`<button class="small" data-act="edit-student" data-id="${s.id}">Edit</button><button class="small danger" data-act="del-student" data-id="${s.id}" data-name="${D.fullName(s)}">${t('delete')}</button>` : ''}</td></tr>`)}
        ${slice.length ? '' : html`<tr><td colspan="5" class="muted">No students found.</td></tr>`}</tbody></table></div>
        <div class="row"><button class="small" data-act="pg" data-d="-1" ${st.page <= 1 ? 'disabled' : ''}>‹</button><span>${st.page} / ${pages} · ${list.length}</span>
          <button class="small" data-act="pg" data-d="1" ${st.page >= pages ? 'disabled' : ''}>›</button></div>`);
    }
    put(el, html`<header class="top"><h1>${t('students')}</h1><div class="row">
        ${canWrite ? html`<button class="primary" data-act="new-student">+ ${t('add')}</button><button data-act="import-pick">Import CSV</button><button data-act="csv-template">Template</button><input type="file" id="csvfile" accept=".csv,text/csv" class="hidden">` : ''}
        <button data-act="export-students">Export CSV</button>${canWrite ? html`<button data-act="manage-classes">Classes</button>` : ''}</div></header>
      <div class="card"><div class="row"><div class="field"><label for="q">${t('search')}</label><input id="q" type="search" placeholder="Name or number"></div>
        <div class="field"><label for="cf">Class</label><select id="cf"><option value="">All</option>${classes.map(c => html`<option value="${c.id}">${c.name} ${c.stream || ''}</option>`)}</select></div></div><div id="stlist"></div></div>`);
    let deb; $('#q').oninput = e => { clearTimeout(deb); deb = setTimeout(() => { st.q = e.target.value; st.page = 1; draw(); }, 200); };
    $('#cf').onchange = e => { st.classId = e.target.value; st.page = 1; draw(); };
    EF.studentsPage = { st, draw, reloadClasses: async () => { classes = await D.classes(); } };
    const f = $('#csvfile'); if (f) f.onchange = async () => { const file = f.files[0]; if (!file) return; await importCsv(await file.text()); f.value = ''; await EF.studentsPage.reloadClasses(); draw(); };
    draw();
  } });

  const classOptions = (classes, sel) => classes.map(c => html`<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${c.name} ${c.stream || ''}</option>`);
  async function studentForm(s) {
    const classes = await D.classes(); const g = s?.guardians?.[0] || {};
    EF.modal(html`<h2>${s ? 'Edit' : t('add')} student</h2><form data-form="student" data-id="${s?.id || ''}">
      <div class="row"><div class="field"><label for="sno">Student number</label><input id="sno" name="studentNo" value="${s?.studentNo || ''}" required></div>
        <div class="field"><label for="sc">Class</label><select id="sc" name="classId"><option value="">—</option>${classOptions(classes, s?.classId)}</select></div></div>
      <div class="row"><div class="field"><label for="sf">First name</label><input id="sf" name="firstName" value="${s?.firstName || ''}" required></div>
        <div class="field"><label for="sl">Last name</label><input id="sl" name="lastName" value="${s?.lastName || ''}" required></div></div>
      <div class="row"><div class="field"><label for="sg">Gender</label><select id="sg" name="gender"><option value="">—</option>${['M', 'F', 'O'].map(x => html`<option ${s?.gender === x ? 'selected' : ''}>${x}</option>`)}</select></div>
        <div class="field"><label for="sd">Date of birth</label><input id="sd" name="dob" type="date" value="${s?.dob || ''}"></div></div>
      ${s ? html`<div class="row"><div class="field"><label for="sst">Status</label><select id="sst" name="status">${['active', 'graduated', 'withdrawn', 'suspended'].map(x => html`<option ${s.status === x ? 'selected' : ''}>${x}</option>`)}</select></div></div>` : ''}
      <h2>Guardian</h2><div class="row"><div class="field"><label for="gn">Name</label><input id="gn" name="gname" value="${g.fullName || ''}"></div>
        <div class="field"><label for="gp">Phone</label><input id="gp" name="gphone" type="tel" value="${g.phone || ''}" placeholder="+2567…"></div>
        <div class="field"><label for="gr">Relationship</label><input id="gr" name="grel" value="${g.relationship || ''}"></div></div>
      <p class="row"><button class="primary" type="submit">${t('save')}</button><button type="button" data-act="close">${t('cancel')}</button></p></form>`);
  }
  EF.actions['new-student'] = () => studentForm(null);
  EF.actions['edit-student'] = async el => studentForm(await D.student(el.dataset.id));
  EF.forms.student = async form => {
    const d = Object.fromEntries(new FormData(form)); const id = form.dataset.id;
    const dup = (await EF.db.where('students', 'no', d.studentNo.trim())).find(x => x.id !== id);
    if (dup) return toast(`Student number ${d.studentNo} already exists.`);
    const s = id ? await D.student(id) : { status: 'active', qrToken: newToken(), guardians: [] };
    Object.assign(s, { studentNo: d.studentNo.trim(), firstName: d.firstName.trim(), lastName: d.lastName.trim(), gender: d.gender || null, dob: d.dob || null, classId: d.classId || null });
    if (d.status && d.status !== s.status) { s.status = d.status; s.statusChangedAt = EF.now(); await EF.audit.append('student.status', 'student', s.id, { status: d.status }); }   // drives data retention
    if (d.gname?.trim()) { const g = s.guardians[0] || { id: EF.uuid(), isPrimary: true }; Object.assign(g, { fullName: d.gname.trim(), phone: d.gphone?.trim() || null, relationship: d.grel?.trim() || null }); s.guardians[0] = g; }
    await EF.db.save('students', s); await EF.audit.append(id ? 'student.update' : 'student.create', 'student', s.id, { no: s.studentNo });
    EF.closeModal(); toast('Saved'); EF.studentsPage.draw();
  };
  EF.actions['del-student'] = async el => {
    if (!confirm(`Delete ${el.dataset.name}? (An administrator can see deleted records in a backup.)`)) return;
    await EF.db.remove('students', el.dataset.id); await EF.audit.append('student.delete', 'student', el.dataset.id); toast('Deleted'); EF.studentsPage.draw();
  };
  EF.actions.pg = el => { const p = EF.studentsPage; p.st.page = Math.max(1, p.st.page + Number(el.dataset.d)); p.draw(); };
  EF.actions['import-pick'] = () => $('#csvfile').click();

  // ---------------------------------------------------------------- QR card
  EF.actions['qr-card'] = async el => {
    const s = await D.student(el.dataset.id); const classes = await D.classes();
    EF.modal(html`<div class="badge-sheet"><div><h3>${EF.state.school.name}</h3><div class="v">${D.fullName(s)}</div><small>${s.studentNo} · ${D.className(classes, s.classId)}</small><small>Student card · QR fallback</small></div>
      <img alt="QR code" src="${EF.qrDataUrl(s.qrToken, 5)}"></div>
      <p class="row noprint"><button class="primary" data-act="print">${t('print')}</button><button data-act="close">Close</button></p>`);
  };

  // ---------------------------------------------------------------- CSV import / export
  const HEADER = ['student_no', 'first_name', 'last_name', 'gender', 'dob', 'class', 'stream', 'guardian_name', 'guardian_phone', 'guardian_email'];
  EF.actions['csv-template'] = () => EF.download(EF.toCsv(HEADER, [['S-001', 'Amina', 'Nakato', 'F', '2012-03-14', 'S.2', 'East', 'Rose Nakato', '+256700111222', 'rose@example.com']]), 'students-template.csv', 'text/csv');
  EF.actions['export-students'] = async () => {
    const [st, cl] = await Promise.all([D.students(), D.classes()]);
    EF.download(EF.toCsv(HEADER, st.map(s => { const c = cl.find(c => c.id === s.classId), g = s.guardians?.[0] || {};
      return [s.studentNo, s.firstName, s.lastName, s.gender, s.dob, c?.name, c?.stream, g.fullName, g.phone, g.email]; })), 'students.csv', 'text/csv');
    await EF.audit.append('student.export', 'school', EF.state.schoolId);
  };
  async function importCsv(text) {
    const rows = EF.parseCsv(text); if (rows.length < 2) return toast('CSV needs a header row and at least one student.');
    const header = rows[0].map(h => h.trim().toLowerCase());
    for (const need of ['student_no', 'first_name', 'last_name']) if (!header.includes(need)) return toast('Missing column: ' + need);
    const col = (r, n) => { const i = header.indexOf(n); return i >= 0 && i < r.length ? r[i].trim() : ''; };
    const existing = new Set((await D.students()).map(s => s.studentNo.toLowerCase())); const classes = await D.classes(); const year = new Date().getFullYear();
    let created = 0; const skipped = [];
    for (let n = 1; n < rows.length; n++) {
      const r = rows[n]; if (r.every(c => !c.trim())) continue;
      const no = col(r, 'student_no'), first = col(r, 'first_name'), last = col(r, 'last_name');
      if (!no || !first || !last) { skipped.push(`Row ${n + 1}: student_no, first_name and last_name are required`); continue; }
      if (existing.has(no.toLowerCase())) { skipped.push(`Row ${n + 1}: ${no} already exists`); continue; }
      let dob = null; if (col(r, 'dob')) { if (/^\d{4}-\d{2}-\d{2}$/.test(col(r, 'dob'))) dob = col(r, 'dob'); else { skipped.push(`Row ${n + 1}: dob must be YYYY-MM-DD`); continue; } }
      let classId = null; const cn = col(r, 'class');
      if (cn) { const stn = col(r, 'stream') || null; let c = classes.find(c => c.name.toLowerCase() === cn.toLowerCase() && (c.stream || null) === stn);
        if (!c) { c = await EF.db.save('classes', { name: cn, stream: stn, year }); classes.push(c); } classId = c.id; }
      const s = { studentNo: no, firstName: first, lastName: last, gender: ['M', 'F', 'O'].includes(col(r, 'gender').toUpperCase()) ? col(r, 'gender').toUpperCase() : null, dob, classId, status: 'active', qrToken: newToken(), guardians: [] };
      if (col(r, 'guardian_name')) s.guardians.push({ id: EF.uuid(), fullName: col(r, 'guardian_name'), phone: col(r, 'guardian_phone') || null, email: col(r, 'guardian_email') || null, isPrimary: true });
      await EF.db.save('students', s); existing.add(no.toLowerCase()); created++;
    }
    await EF.audit.append('student.import', 'school', EF.state.schoolId, { created, skipped: skipped.length });
    EF.modal(html`<h2>Import finished</h2><p>${created} student(s) added.</p>${skipped.length ? html`<p>${skipped.length} row(s) skipped:</p><ul>${skipped.map(s => html`<li>${s}</li>`)}</ul>` : ''}<p><button class="primary" data-act="close">OK</button></p>`);
  }
  EF.importStudentsCsv = importCsv;

  // ---------------------------------------------------------------- classes
  EF.actions['manage-classes'] = async () => {
    const classes = await D.classes();
    EF.modal(html`<h2>Classes</h2><ul>${classes.map(c => html`<li class="row between"><span>${c.name} ${c.stream || ''} <span class="muted">(${c.year})</span></span><button class="small danger" data-act="del-class" data-id="${c.id}">${t('delete')}</button></li>`)}</ul>
      <form data-form="class" class="row"><div class="field"><label for="cn">Name</label><input id="cn" name="name" placeholder="S.2" required></div><div class="field"><label for="cs">Stream</label><input id="cs" name="stream" placeholder="East"></div>
        <div class="field"><button class="primary" type="submit">${t('add')}</button></div></form><p><button data-act="close">Close</button></p>`);
  };
  EF.forms.class = async form => {
    const d = Object.fromEntries(new FormData(form)); await EF.db.save('classes', { name: d.name.trim(), stream: d.stream?.trim() || null, year: new Date().getFullYear() });
    await EF.audit.append('class.create', 'class', null, { name: d.name }); await EF.studentsPage.reloadClasses(); EF.actions['manage-classes']();
  };
  EF.actions['del-class'] = async el => {
    if ((await D.students()).some(s => s.classId === el.dataset.id)) return toast('Move or remove the students in this class first.');
    await EF.db.remove('classes', el.dataset.id); await EF.audit.append('class.delete', 'class', el.dataset.id); await EF.studentsPage.reloadClasses(); EF.actions['manage-classes']();
  };
})();
