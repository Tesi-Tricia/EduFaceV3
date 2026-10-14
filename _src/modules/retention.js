// data retention. Deletes face data of withdrawn/graduated students and expired visitor records, on demand or once a day at admin sign-in.
'use strict';
(function () {
  const EF = window.EF, { html, toast, t } = EF;
  const day = 864e5;

  async function run(dryRun) {
    const studentDays = await EF.db.getSetting('retention.student_days', 90), visitorDays = await EF.db.getSetting('retention.visitor_days', 365);
    const now = Date.now(); let students = 0, faces = 0, visitors = 0;
    for (const s of await EF.data.students()) {
      if ((s.status === 'withdrawn' || s.status === 'graduated') && s.statusChangedAt && now - new Date(s.statusChangedAt) > studentDays * day) {
        const n = EF.faces ? await EF.faces.count(s.id) : 0; if (n) { students++; faces += n; if (!dryRun) await EF.faces.purge(s.id); }
      }
    }
    const visits = await EF.db.all('visits'); const byVisitor = new Map(); for (const v of visits) (byVisitor.get(v.visitorId) || byVisitor.set(v.visitorId, []).get(v.visitorId)).push(v);
    for (const p of await EF.db.all('visitors')) {
      const vs = byVisitor.get(p.id) || []; const recent = vs.some(v => v.status === 'checked_in' || now - new Date(v.checkedInAt) <= visitorDays * day);
      if (!recent && now - new Date(p.createdAt) > visitorDays * day) { visitors++; if (!dryRun) { for (const v of vs) await EF.db.remove('visits', v.id); p.idNumber = null; p.phone = null; await EF.db.save('visitors', p); await EF.db.remove('visitors', p.id); } }
    }
    return { students, faces, visitors, dryRun };
  }
  EF.retention = { run };

  EF.settingsSections.push({ perm: 'school.*', async render() {
    const sd = await EF.db.getSetting('retention.student_days', 90), vd = await EF.db.getSetting('retention.visitor_days', 365), auto = await EF.db.getSetting('retention.auto', false), last = await EF.db.getMeta('lastRetentionRun');
    return html`<form class="card" data-form="retention"><h2>Data retention</h2><p class="muted">Deletes face data of students who left, and visitor records, after the periods below. Last run: ${last ? EF.fmtDateTime(last) : 'never'}.</p>
      <div class="row"><div class="field"><label for="rs">Keep face data of withdrawn/graduated students (days)</label><input id="rs" name="sd" type="number" min="0" value="${sd}"></div>
        <div class="field"><label for="rv">Keep visitor records (days)</label><input id="rv" name="vd" type="number" min="1" value="${vd}"></div></div>
      <p><label class="row"><input type="checkbox" name="auto" ${auto ? 'checked' : ''}> Run automatically once a day when an administrator signs in</label></p>
      <p class="row"><button class="primary" type="submit">${t('save')}</button><button type="button" data-act="ret-dry">Preview</button><button type="button" class="danger" data-act="ret-run">Run now</button></p></form>`;
  } });
  EF.forms.retention = async form => { const d = Object.fromEntries(new FormData(form)); await EF.db.setSetting('retention.student_days', Number(d.sd)); await EF.db.setSetting('retention.visitor_days', Number(d.vd)); await EF.db.setSetting('retention.auto', !!d.auto); await EF.audit.append('settings.retention', 'school', EF.state.schoolId, d); toast('Saved'); };
  EF.actions['ret-dry'] = async () => { const r = await run(true); toast(`Would delete face data of ${r.students} student(s) (${r.faces} templates) and ${r.visitors} visitor record(s)`); };
  EF.actions['ret-run'] = async () => { if (!confirm('Permanently delete expired face data and visitor records now?')) return; const r = await run(false); await EF.db.setMeta('lastRetentionRun', EF.now());
    await EF.audit.append('retention.run', 'school', EF.state.schoolId, r); toast(`Deleted ${r.faces} face templates and ${r.visitors} visitor record(s)`); };

  // once a day, when an administrator signs in (a browser app cannot run while closed)
  EF.hooks.afterLogin = (EF.hooks.afterLogin || []).concat(async () => {
    if (!EF.can('school.*') || !(await EF.db.getSetting('retention.auto', false))) return; const last = await EF.db.getMeta('lastRetentionRun');
    if (last && last.slice(0, 10) === EF.todayISO()) return; const r = await run(false); await EF.db.setMeta('lastRetentionRun', EF.now()); await EF.audit.append('retention.scheduled', 'school', EF.state.schoolId, r);
  });
})();
