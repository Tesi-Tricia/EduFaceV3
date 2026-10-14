// App shell: sign-in / first-run setup, navigation built from registered pages, router, sessions (idle timeout), theme and brand.
'use strict';
(function () {
  const EF = window.EF, { html, put, $, $$, t } = EF;
  const store = {
    get: k => { try { return localStorage.getItem('eduface.' + k); } catch { return null; } },
    set: (k, v) => { try { v == null ? localStorage.removeItem('eduface.' + k) : localStorage.setItem('eduface.' + k, v); } catch { /* private mode */ } },
  };
  EF.store = store; EF.cleanups = []; EF.settingsSections = [];
  let navCount = 0, timer = null, idleTimer = null;
  const IDLE_MS = 15 * 60 * 1000;

  EF.registerPage = p => { EF.pages = EF.pages.filter(x => x.id !== p.id); EF.pages.push(Object.assign({ order: 50, icon: '•' }, p)); };
  EF.nav = () => navCount;
  // refresh timers only while the user is still on the page that asked for them (prevents stale pages redrawing)
  EF.every = (nav, fn, ms) => { if (navCount === nav) timer = setInterval(() => { if (navCount === nav) fn(); else clearInterval(timer); }, ms); };
  EF.stopLive = () => { clearInterval(timer); timer = null; for (const c of EF.cleanups.splice(0)) { try { c(); } catch { /* ignore */ } } };

  function applyTheme(mode) {
    const m = mode || store.get('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = m; store.set('theme', m);
  }
  function applyBrand() {
    const c = /^#[0-9a-f]{6}$/i.test(EF.state.school?.primaryColor || '') ? EF.state.school.primaryColor : '#1f6feb';
    const [r, g, b] = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
    const s = document.documentElement.style; s.setProperty('--brand', c); s.setProperty('--brand-fg', (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#000' : '#fff');
    document.title = EF.state.school?.name || 'EduFace';
  }
  EF.applyTheme = applyTheme; EF.applyBrand = applyBrand;

  // ------------------------------------------------------------------ first run + sign in
  function showSetup(msg) {
    put($('#root'), html`<div class="login"><form class="card" data-form="setup" autocomplete="off">
      <h1>EduFace</h1><p class="muted">First-time setup: create the school and its administrator.</p>
      ${msg ? html`<div class="alert bad" role="alert">${msg}</div>` : ''}
      <div class="field"><label for="sn">School name</label><input id="sn" name="schoolName" required></div>
      <div class="field"><label for="an">Your name</label><input id="an" name="adminName" required></div>
      <div class="field"><label for="ae">Your email (your sign-in name)</label><input id="ae" name="email" type="email" required></div>
      <div class="field"><label for="ap">Password (at least ${EF.auth.MIN_PW} characters)</label><input id="ap" name="password" type="password" minlength="${EF.auth.MIN_PW}" required autocomplete="new-password"></div>
      <p class="alert">All data stays in <strong>this browser on this computer</strong>. If the password is lost, the data cannot be recovered. Keep copies of important data (exports or backups).</p>
      <p><button class="primary" type="submit">Create school</button></p></form></div>`);
  }
  function showLogin(msg) {
    EF.stopLive(); clearTimeout(idleTimer);
    put($('#root'), html`<div class="login"><form class="card" data-form="login" autocomplete="on">
      <h1>${EF.state.school?.name || 'EduFace'}</h1><p class="muted">${t('signin')}</p>
      ${msg ? html`<div class="alert bad" role="alert">${msg}</div>` : ''}
      <div class="field"><label for="em">${t('email')}</label><input id="em" name="email" type="email" required autocomplete="username"></div>
      <div class="field"><label for="pw">${t('password')}</label><input id="pw" name="password" type="password" required autocomplete="current-password"></div>
      <p><button class="primary" type="submit">${t('signin')}</button></p></form></div>`);
    $('#em')?.focus();
  }
  EF.showLogin = showLogin;

  EF.forms.setup = async form => {
    const d = Object.fromEntries(new FormData(form));
    try { await EF.auth.setup(d); await EF.auth.login(d.email, d.password); applyBrand(); showApp(); }
    catch (e) { showSetup(e.message); }
  };
  EF.forms.login = async form => {
    const d = Object.fromEntries(new FormData(form)); const btn = $('button', form); btn.disabled = true;
    try { await EF.auth.login(d.email, d.password); location.hash = '#/dashboard'; showApp(); }
    catch (e) { showLogin(e.message); }
  };

  // ------------------------------------------------------------------ app frame
  const visiblePages = () => EF.pages.filter(p => !p.perm || EF.can(p.perm)).sort((a, b) => a.order - b.order);

  function showApp() {
    const items = visiblePages();
    put($('#root'), html`<div id="app">
      <nav id="nav" aria-label="Main"><div class="brand">${EF.state.school.name}</div>
        ${items.map(p => html`<a href="#/${p.id}" data-route="${p.id}"><span aria-hidden="true">${p.icon}</span> ${p.title || t(p.titleKey || p.id)}</a>`)}
        <div class="spacer"></div><a href="#/logout" data-act="logout"><span aria-hidden="true">⏻</span> ${t('signout')}</a></nav>
      <main id="main"><div class="row" id="statusbar"><span class="pill" title="Everything is stored in this browser on this computer"><span class="dot ok"></span>Data on this computer</span>
        <span class="muted">${EF.state.user.fullName} · ${EF.state.user.role}</span><span id="statusextra"></span></div><div id="page"></div></main></div>`);
    resetIdle(); route();
  }
  EF.showApp = showApp;

  function route() {
    EF.stopLive(); const nav = ++navCount;
    const key = (location.hash.replace(/^#\//, '').split('?')[0]) || 'dashboard';
    const pages = visiblePages();
    const page = pages.find(p => p.id === key) || pages.find(p => p.id === 'dashboard') || pages[0];
    $$('#nav a[data-route]').forEach(a => { const on = a.dataset.route === page.id; a.classList.toggle('active', on); a.setAttribute('aria-current', on ? 'page' : 'false'); });
    const el = $('#page'); if (!el) return;
    put(el, html`<p class="muted">…</p>`);
    Promise.resolve(page.render(el, nav)).catch(e => { console.error(e); if (navCount === nav) put(el, html`<div class="alert bad">Something went wrong: ${e.message}</div>`); });
    scrollTo(0, 0);
  }
  addEventListener('hashchange', () => { if (EF.state.user && $('#page')) route(); });

  EF.actions.logout = async () => { await EF.auth.logout(); showLogin(); };
  EF.actions.theme = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  EF.actions.print = () => window.print();

  function resetIdle() {
    clearTimeout(idleTimer);
    // a gate kiosk stays signed in (it is locked by a PIN instead)
    idleTimer = setTimeout(async () => { if (EF.state.user && !EF.kioskActive) { await EF.auth.logout('logout.idle'); showLogin('You were signed out after 15 minutes of inactivity.'); } }, IDLE_MS);
  }
  ['pointerdown', 'keydown'].forEach(ev => addEventListener(ev, () => { if (EF.state.user) resetIdle(); }, { passive: true }));

  // ------------------------------------------------------------------ boot
  EF.boot = async function () {
    applyTheme();
    try { await EF.db.open(); } catch (e) { put($('#root'), html`<div class="login"><div class="card"><div class="alert bad">This browser cannot store data (${e.message}). Private/incognito windows are not supported.</div></div></div>`); return; }
    try { navigator.storage?.persist?.(); } catch { /* optional */ }
    for (const h of EF.hooks.beforeBoot || []) await h();
    const school = await EF.db.getMeta('school'); if (school) { EF.state.school = school; EF.state.schoolId = school.id; applyBrand(); }
    (await EF.auth.isSetUp()) ? showLogin() : showSetup();
  };
})();
