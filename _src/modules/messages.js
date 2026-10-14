// guardian message queue. A browser cannot send SMS by itself (that needs a server and a paid provider), so messages are
// queued and each one opens the device's SMS app pre-filled (works on phones/tablets), or can be exported as CSV for a bulk-SMS service.
'use strict';
(function () {
  const EF = window.EF, { html, put, $, t, toast } = EF;
  EF.stores.push({ name: 'messages', key: 'id', indexes: [['status', 'status'], ['dedupe', 'dedupeKey']] });
  const MAX_AGE_H = 24;

  async function enqueue(student, template, date, at) {
    if (!(await EF.db.getSetting('messages.enabled', true))) return;
    if (!(await EF.consent.has(student.id, 'notifications'))) return;           // only guardians who agreed
    const g = (student.guardians || []).filter(x => x.phone);
    const time = new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); const name = EF.data.fullName(student);
    const text = { late: `${name} arrived late at ${time}.`, departed: `${name} left school at ${time}.`, absent: `${name} was marked absent today (${date}). Please contact the school.` }[template] || `${name} arrived at school at ${time}.`;
    for (const x of g) {
      const key = `${student.id}:${date}:${template}:${x.id}`; if ((await EF.db.where('messages', 'dedupe', key)).length) continue;   // never queue the same message twice
      await EF.db.save('messages', { studentId: student.id, guardianId: x.id, phone: x.phone, template, text, dedupeKey: key, status: 'queued', date });
    }
  }
  EF.messages = { enqueue };
  EF.hooks.afterRecord = (EF.hooks.afterRecord || []).concat((s, e) => enqueue(s, e.direction === 'out' ? 'departed' : e.status === 'late' ? 'late' : 'arrived', e.date, e.at));
  EF.hooks.studentAbsent = (EF.hooks.studentAbsent || []).concat((s, date) => enqueue(s, 'absent', date, EF.now()));

  async function expireOld() {
    for (const m of await EF.db.where('messages', 'status', 'queued')) if ((Date.now() - new Date(m.createdAt)) / 36e5 > MAX_AGE_H) { m.status = 'cancelled'; m.note = 'expired'; await EF.db.save('messages', m); }
  }
  const smsHref = m => `sms:${encodeURIComponent(m.phone)}?body=${encodeURIComponent(m.text)}`;

  EF.registerPage({ id: 'messages', titleKey: 'messages', icon: '✉', order: 60, perm: 'students.read', async render(el, nav) {
    await expireOld(); const all = (await EF.db.all('messages')).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); if (EF.nav() !== nav) return;
    const queued = all.filter(m => m.status === 'queued'); const enabled = await EF.db.getSetting('messages.enabled', true);
    put(el, html`<header class="top"><h1>${t('messages')}</h1><div class="row"><button data-act="msg-export">Export CSV</button>${EF.can('school.*') ? html`<label class="row"><input type="checkbox" id="msgon" ${enabled ? 'checked' : ''}> Create messages</label>` : ''}</div></header>
      <p class="hint">Messages are created for guardians who agreed to notifications. <strong>Send</strong> opens your SMS app with the text ready (phones/tablets); then press <strong>Mark sent</strong>. Unsent messages are cancelled after ${MAX_AGE_H} hours.</p>
      <div class="card"><h2>Waiting to send (${queued.length})</h2><div class="tablewrap"><table><thead><tr><th>To</th><th>Message</th><th></th></tr></thead><tbody>
        ${queued.map(m => html`<tr><td>${m.phone}</td><td>${m.text}</td><td class="row"><a class="small" href="${smsHref(m)}"><button class="small primary" type="button">Send</button></a>
          <button class="small" data-act="msg-sent" data-id="${m.id}">Mark sent</button><button class="small danger" data-act="msg-cancel" data-id="${m.id}">Cancel</button></td></tr>`)}
        ${queued.length ? '' : html`<tr><td colspan="3" class="muted">Nothing waiting.</td></tr>`}</tbody></table></div></div>
      <div class="card"><h2>History</h2><div class="tablewrap"><table><thead><tr><th>When</th><th>To</th><th>Message</th><th>Status</th></tr></thead><tbody>
        ${all.filter(m => m.status !== 'queued').slice(0, 100).map(m => html`<tr><td>${EF.fmtDateTime(m.createdAt)}</td><td>${m.phone}</td><td>${m.text}</td><td><span class="badge ${m.status === 'sent' ? 'ok' : ''}">${m.status}</span></td></tr>`)}</tbody></table></div></div>`);
    $('#msgon')?.addEventListener('change', async e => { await EF.db.setSetting('messages.enabled', e.target.checked); await EF.audit.append('settings.messages', 'school', EF.state.schoolId, { enabled: e.target.checked }); });
  } });
  const setStatus = async (id, status) => { const m = await EF.db.get('messages', id); m.status = status; if (status === 'sent') m.sentAt = EF.now(); await EF.db.save('messages', m); EF.showApp(); location.hash = '#/messages'; };
  EF.actions['msg-sent'] = el => setStatus(el.dataset.id, 'sent'); EF.actions['msg-cancel'] = el => setStatus(el.dataset.id, 'cancelled');
  EF.actions['msg-export'] = async () => { const q = (await EF.db.where('messages', 'status', 'queued')); EF.download(EF.toCsv(['phone', 'message'], q.map(m => [m.phone, m.text])), 'messages.csv', 'text/csv'); };

  EF.widgets.push({ order: 45, perm: 'students.read', render: async () => { const n = (await EF.db.where('messages', 'status', 'queued')).length;
    return n ? html`<div class="alert" role="status">${n} guardian message(s) waiting. <a href="#/messages">Open messages</a></div>` : ''; } });
})();
