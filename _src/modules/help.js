// built-in help (training guide, privacy checklist, accuracy plan, running notes), demo data, link to the self-test.
'use strict';
(function () {
  const EF = window.EF, { html, raw, put, $, t, toast } = EF;
  const DOCS = [['running', 'Running EduFace'], ['training', 'Staff training guide'], ['privacy', 'Privacy checklist'], ['accuracy', 'Accuracy test plan']];

  EF.registerPage({ id: 'help', titleKey: 'help', icon: '?', order: 97, async render(el, nav) {
    const which = (location.hash.split('doc=')[1] || 'running').split('&')[0]; const doc = DOCS.find(d => d[0] === which) || DOCS[0];
    let body; try { const r = await fetch(`docs/${doc[0]}.html`); body = r.ok ? await r.text() : '<p>Document not found.</p>'; } catch { body = '<p>Could not load the document.</p>'; }
    if (EF.nav() !== nav) return;
    put(el, html`<header class="top"><h1>${t('help')}</h1><div class="row noprint">${DOCS.map(d => html`<a href="#/help?doc=${d[0]}"><button class="small ${d[0] === doc[0] ? 'primary' : ''}" type="button">${d[1]}</button></a>`)}
        <button class="small" data-act="print">${t('print')}</button><a href="selftest.html" target="_blank" rel="noopener"><button class="small" type="button">Run self-test</button></a></div></header>
      <div class="card">${raw(body)}</div>`);   // these are the app's own static documents (not user input)
  } });

  // ---------------------------------------------------------------- demo data (training only)
  const FIRST = ['Amina', 'Brian', 'Cathy', 'David', 'Esther', 'Fred', 'Grace', 'Hassan', 'Irene', 'Joseph', 'Kevin', 'Lydia', 'Moses', 'Nadia', 'Oscar', 'Patience', 'Ronald', 'Sarah', 'Timothy', 'Winnie'];
  const LAST = ['Nakato', 'Okello', 'Auma', 'Mugisha', 'Namukasa', 'Ssemwogerere', 'Atim', 'Kato', 'Nabirye', 'Opio'];
  EF.loadDemoData = async () => {
    const year = new Date().getFullYear(); const classes = [];
    for (const n of ['S.1', 'S.2', 'S.3']) classes.push(await EF.db.save('classes', { name: n, stream: 'A', year }));
    for (let i = 0; i < 30; i++) {
      await EF.db.save('students', { studentNo: `DEMO-${String(i + 1).padStart(3, '0')}`, firstName: FIRST[i % FIRST.length], lastName: LAST[(i * 3) % LAST.length], gender: i % 2 ? 'M' : 'F', dob: null, classId: classes[i % 3].id,
        status: 'active', qrToken: EF.randomHex(16), guardians: [{ id: EF.uuid(), fullName: 'Guardian of ' + FIRST[i % FIRST.length], phone: `+2567000${String(i + 1).padStart(5, '0')}`, relationship: 'parent', isPrimary: true }] });
    }
    await EF.audit.append('demo.loaded', 'school', EF.state.schoolId, { students: 30 });
  };
  EF.settingsSections.push({ perm: 'school.*', render: async () => html`<div class="card"><h2>Training</h2><p class="muted">Loads 3 classes and 30 fake students with guardians and no consents, so the consent and enrolment steps can be practised.
      <strong>Only use this on a training copy, never on the real school's data.</strong></p><button data-act="load-demo">Load demo data</button> <a href="selftest.html" target="_blank" rel="noopener"><button type="button">Run self-test</button></a></div>` });
  EF.actions['load-demo'] = async () => {
    if (await EF.db.count('students')) { if (!confirm('This browser already has students. Add the demo students as well? (Do NOT do this on a real school.)')) return; }
    await EF.loadDemoData(); toast('Demo data loaded'); EF.showApp();
  };
})();
