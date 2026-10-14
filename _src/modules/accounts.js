// dashboard shell (widgets), users, audit log, settings.
'use strict';
(function () {
  const EF = window.EF, { html, put, $, $$, t, toast } = EF;

  // ---------------------------------------------------------------- dashboard (modules add widgets)
  EF.registerPage({ id: 'dashboard', titleKey: 'dashboard', icon: '▦', order: 0, async render(el, nav) {
    const draw = async () => {
      const ws = EF.widgets.filter(w => !w.perm || EF.can(w.perm)).sort((a, b) => a.order - b.order);
      const parts = []; for (const w of ws) { try { parts.push(await w.render()); } catch (e) { parts.push(html`<div class="alert bad">${e.message}</div>`); } }
      if (EF.nav() !== nav) return;
      put(el, html`<header class="top"><h1>${t('dashboard')}</h1><span class="muted">${EF.todayISO()}</span></header>${parts}`);
    };
    await draw(); EF.every(nav, draw, 20000);
  } });

  EF.widgets.push({ order: 10, render: async () => {
    const users = await EF.db.all('users'); const a = await EF.audit.verify(); const school = EF.state.school;
    return html`<div class="grid">
      <div class="card stat"><div class="n">${users.filter(u => u.active).length}</div><div class="l">Active accounts</div></div>
      <div class="card stat"><div class="n">${a.count}</div><div class="l">Audit entries</div></div>
      <div class="card stat"><div class="n ${a.ok ? 'chip-ok' : 'chip-bad'}">${a.ok ? 'Intact' : 'BROKEN'}</div><div class="l">Audit chain</div></div></div>
      <div class="card"><h2>${school.name}</h2><dl class="kv"><dt>Signed in as</dt><dd>${EF.state.user.fullName} (${EF.state.user.role})</dd>
        <dt>Storage</dt><dd>This browser, on this computer (no server, no internet needed)</dd></dl></div>`;
  } });

  // ---------------------------------------------------------------- users
  EF.registerPage({ id: 'users', titleKey: 'users', icon: '☺', order: 90, perm: 'users.*', async render(el, nav) {
    const users = (await EF.db.all('users')).sort((a, b) => a.fullName.localeCompare(b.fullName));
    if (EF.nav() !== nav) return;
    put(el, html`<header class="top"><h1>${t('users')}</h1></header>
      <form class="card" data-form="newuser"><h2>Add a user</h2><div class="row">
        <div class="field"><label for="uf">Full name</label><input id="uf" name="fullName" required></div>
        <div class="field"><label for="ue">Email (sign-in name)</label><input id="ue" name="email" type="email" required></div>
        <div class="field"><label for="ur">Role</label><select id="ur" name="role">${Object.keys(EF.auth.ROLES).map(r => html`<option>${r}</option>`)}</select></div>
        <div class="field"><label for="up">Password (${EF.auth.MIN_PW}+ characters)</label><input id="up" name="password" type="password" minlength="${EF.auth.MIN_PW}" required autocomplete="new-password"></div>
        <div class="field"><button class="primary" type="submit">${t('add')}</button></div></div></form>
      <div class="card tablewrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>
        ${users.map(u => html`<tr><td>${u.fullName}</td><td>${u.email}</td><td>${u.role}</td>
          <td><span class="badge ${u.active ? 'ok' : 'bad'}">${u.active ? 'active' : 'disabled'}</span>${u.lockedUntil && new Date(u.lockedUntil) > new Date() ? html` <span class="badge warn">locked</span>` : ''}</td>
          <td class="row"><button class="small" data-act="reset-pw" data-id="${u.id}" data-name="${u.fullName}">Reset password</button>
            ${u.id !== EF.state.user.id ? html`<button class="small ${u.active ? 'danger' : ''}" data-act="toggle-user" data-id="${u.id}" data-on="${u.active ? '0' : '1'}">${u.active ? 'Disable' : 'Enable'}</button>` : ''}</td></tr>`)}
      </tbody></table></div>
      <p class="hint">Roles: <strong>SchoolAdmin</strong> everything · <strong>Teacher</strong> view students, attendance, manual changes · <strong>Security</strong> visitors, roll call.</p>`);
  } });
  EF.forms.newuser = async form => {
    const d = Object.fromEntries(new FormData(form));
    try { await EF.auth.createUser(d); toast('User added'); form.reset(); location.hash = '#/users'; EF.showApp(); } catch (e) { toast(e.message); }
  };
  EF.actions['toggle-user'] = async el => { try { await EF.auth.setActive(el.dataset.id, el.dataset.on === '1'); EF.showApp(); } catch (e) { toast(e.message); } };
  EF.actions['reset-pw'] = el => EF.modal(html`<h2>Reset password — ${el.dataset.name}</h2><form data-form="resetpw" data-id="${el.dataset.id}">
    <div class="field"><label for="np">New password (${EF.auth.MIN_PW}+ characters)</label><input id="np" name="password" type="password" minlength="${EF.auth.MIN_PW}" required autocomplete="new-password"></div>
    <p class="row"><button class="primary" type="submit">${t('save')}</button><button type="button" data-act="close">${t('cancel')}</button></p></form>`);
  EF.forms.resetpw = async form => { try { await EF.auth.resetPassword(form.dataset.id, new FormData(form).get('password')); EF.closeModal(); toast('Password changed'); } catch (e) { toast(e.message); } };

  // ---------------------------------------------------------------- audit log
  EF.registerPage({ id: 'audit', titleKey: 'audit', icon: '≡', order: 95, perm: 'audit.read', async render(el, nav) {
    const [rows, v] = await Promise.all([EF.audit.list(200), EF.audit.verify()]); if (EF.nav() !== nav) return;
    put(el, html`<header class="top"><h1>${t('audit')}</h1><span class="badge ${v.ok ? 'ok' : 'bad'}">${v.ok ? `Chain intact (${v.count} entries)` : `TAMPERING DETECTED at entry ${v.brokenAt}`}</span></header>
      <p class="hint">Every sensitive action is recorded with who and when. Each entry is linked to the one before it, so any edit or deletion is detected.</p>
      <div class="card tablewrap"><table><thead><tr><th>#</th><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead><tbody>
        ${rows.map(r => html`<tr><td>${r.seq}</td><td>${EF.fmtDateTime(r.at)}</td><td>${r.actorEmail || '—'}</td><td>${r.action}</td><td class="muted">${r.detail || ''}</td></tr>`)}</tbody></table></div>`);
  } });

  // ---------------------------------------------------------------- settings
  EF.registerPage({ id: 'settings', titleKey: 'settings', icon: '⚙', order: 99, async render(el, nav) {
    const school = EF.state.school; const sections = EF.settingsSections.filter(s => !s.perm || EF.can(s.perm));
    const rendered = []; for (const s of sections) rendered.push(await s.render());
    if (EF.nav() !== nav) return;
    put(el, html`<header class="top"><h1>${t('settings')}</h1></header>
      <div class="card"><h2>Display</h2><div class="row">
        <div class="field"><label for="lg">Language</label><select id="lg">${EF.languages().map(l => html`<option value="${l}" ${l === EF.lang() ? 'selected' : ''}>${l === 'en' ? 'English' : l === 'sw' ? 'Kiswahili' : l}</option>`)}</select></div>
        <div class="field"><label>Theme</label><button data-act="theme">Toggle dark / light</button></div>
        <label class="row"><input type="checkbox" id="mute" ${EF.store.get('mute') === '1' ? 'checked' : ''}> Mute sounds</label></div></div>
      ${EF.can('school.*') ? html`<form class="card" data-form="school"><h2>School</h2><div class="row"><div class="field"><label for="sn">Name</label><input id="sn" name="name" value="${school.name}" required></div>
        <div class="field"><label for="sc">Brand colour</label><input id="sc" name="primaryColor" type="color" value="${school.primaryColor || '#1f6feb'}"></div></div><p><button class="primary" type="submit">${t('save')}</button></p></form>` : ''}
      <form class="card" data-form="mypw"><h2>Change my password</h2><div class="row"><div class="field"><label for="cp">Current password</label><input id="cp" name="current" type="password" required autocomplete="current-password"></div>
        <div class="field"><label for="n1">New password (${EF.auth.MIN_PW}+ characters)</label><input id="n1" name="next" type="password" minlength="${EF.auth.MIN_PW}" required autocomplete="new-password"></div>
        <div class="field"><button type="submit">Change</button></div></div></form>
      ${rendered}`);
    $('#lg').onchange = e => { EF.setLang(e.target.value); EF.showApp(); };
    $('#mute').onchange = e => { EF.setMuted(e.target.checked); EF.store.set('mute', e.target.checked ? '1' : '0'); };
    for (const s of sections) s.wire?.(el);
  } });
  EF.setMuted(EF.store?.get?.('mute') === '1');
  EF.forms.school = async form => {
    const d = Object.fromEntries(new FormData(form)); const s = { ...EF.state.school, name: d.name.trim(), primaryColor: d.primaryColor };
    await EF.db.setMeta('school', s); EF.state.school = s; EF.applyBrand(); await EF.audit.append('school.update', 'school', s.id, { name: s.name }); toast('Saved'); EF.showApp();
  };
  EF.forms.mypw = async form => {
    const d = Object.fromEntries(new FormData(form)); try { await EF.auth.changeOwnPassword(d.current, d.next); form.reset(); toast('Password changed'); } catch (e) { toast(e.message); }
  };
})();
