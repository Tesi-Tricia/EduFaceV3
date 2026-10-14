// Local accounts, roles and sessions. IMPORTANT: this protects data against honest mistakes and casual access, not against someone
// with full control of the computer/browser. Real protection = a locked room, a Windows login, disk encryption (BitLocker) and strong passwords.
'use strict';
(function () {
  const EF = window.EF;
  const MAX_FAILS = 5, LOCK_MIN = 15, MIN_PW = 10;

  // Same roles/permissions as the server edition.
  const ROLES = {
    SchoolAdmin: ['school.*', 'students.*', 'visitors.*', 'reports.*', 'users.*', 'consent.*', 'attendance.*', 'rollcall.read', 'audit.read', 'backup.*'],
    Teacher: ['students.read', 'attendance.read', 'attendance.override', 'attendance.scan', 'reports.class'],
    Security: ['visitors.*', 'attendance.read', 'attendance.scan', 'rollcall.read'],
  };
  const allows = (granted, req) => granted.some(g => g === '*' || g === req || (g.endsWith('.*') && req.startsWith(g.slice(0, -1))));
  const can = req => !!EF.state.user && allows(ROLES[EF.state.user.role] || [], req);

  const norm = e => String(e || '').trim().toLowerCase();
  const validPw = p => typeof p === 'string' && p.length >= MIN_PW;

  const isSetUp = async () => !!(await EF.db.getMeta('school'));

  async function setup({ schoolName, adminName, email, password }) {
    if (await isSetUp()) throw new Error('Already set up.');
    if (!schoolName?.trim() || !adminName?.trim() || !norm(email)) throw new Error('School name, your name and email are required.');
    if (!validPw(password)) throw new Error(`Password must be at least ${MIN_PW} characters.`);
    const dek = await EF.crypto.newDek();
    const school = { id: EF.uuid(), name: schoolName.trim(), primaryColor: '#1f6feb', timezoneNote: Intl.DateTimeFormat().resolvedOptions().timeZone };
    await EF.db.setMeta('school', school);
    EF.state.schoolId = school.id; EF.state.school = school;
    const user = await EF.db.save('users', {
      email: norm(email), fullName: adminName.trim(), role: 'SchoolAdmin', active: true, failed: 0, lockedUntil: null,
      pass: await EF.crypto.hashPassword(password), wrappedDek: await EF.crypto.wrapDek(dek, password),
    });
    await EF.audit.append('setup', 'school', school.id, { school: school.name, admin: user.email });
    return user;
  }

  async function login(email, password) {
    const users = await EF.db.where('users', 'email', norm(email));
    const u = users[0];
    if (u && u.lockedUntil && new Date(u.lockedUntil) > new Date()) { const e = new Error('Account locked for a few minutes after too many wrong passwords.'); e.code = 'locked'; throw e; }
    const ok = !!u && u.active && await EF.crypto.verifyPassword(password, u.pass);
    if (!ok) {
      if (u) {
        u.failed = (u.failed || 0) + 1;
        if (u.failed >= MAX_FAILS) { u.lockedUntil = new Date(Date.now() + LOCK_MIN * 60000).toISOString(); u.failed = 0; }
        await EF.db.save('users', u);
      }
      await EF.audit.append('login.failed', 'user', u?.id ?? null, { email: norm(email) });
      throw new Error('Wrong email or password.');
    }
    u.failed = 0; u.lockedUntil = null; u.lastLoginAt = EF.now(); await EF.db.save('users', u);
    EF.state.dek = await EF.crypto.unwrapDek(u.wrappedDek, password);
    EF.state.user = { id: u.id, email: u.email, fullName: u.fullName, role: u.role };
    const school = await EF.db.getMeta('school'); EF.state.school = school; EF.state.schoolId = school.id;
    await EF.audit.append('login.success', 'user', u.id);
    for (const h of EF.hooks.afterLogin || []) await h();
    return EF.state.user;
  }

  async function logout(reason = 'logout') {
    if (EF.state.user) await EF.audit.append(reason, 'user', EF.state.user.id).catch(() => { });
    EF.state.user = null; EF.state.dek = null;
    for (const h of EF.hooks.afterLogout || []) await h();
  }

  // ---- user management (needs an administrator session so the data key can be wrapped for the new user) ----
  async function createUser({ email, fullName, role, password }) {
    if (!can('users.*')) throw new Error('Not allowed.');
    if (!ROLES[role]) throw new Error('Unknown role.');
    if (!norm(email) || !fullName?.trim()) throw new Error('Name and email are required.');
    if (!validPw(password)) throw new Error(`Password must be at least ${MIN_PW} characters.`);
    if ((await EF.db.where('users', 'email', norm(email), { includeDeleted: true })).length) throw new Error('That email is already used.');
    const u = await EF.db.save('users', { email: norm(email), fullName: fullName.trim(), role, active: true, failed: 0, lockedUntil: null,
      pass: await EF.crypto.hashPassword(password), wrappedDek: await EF.crypto.wrapDek(EF.state.dek, password) });
    await EF.audit.append('user.create', 'user', u.id, { email: u.email, role });
    return u;
  }
  async function resetPassword(userId, newPassword) {
    if (!can('users.*')) throw new Error('Not allowed.');
    if (!validPw(newPassword)) throw new Error(`Password must be at least ${MIN_PW} characters.`);
    const u = await EF.db.get('users', userId); if (!u) throw new Error('No such user.');
    u.pass = await EF.crypto.hashPassword(newPassword); u.wrappedDek = await EF.crypto.wrapDek(EF.state.dek, newPassword); u.failed = 0; u.lockedUntil = null;
    await EF.db.save('users', u); await EF.audit.append('user.password_reset', 'user', u.id);
  }
  async function changeOwnPassword(current, next) {
    const u = await EF.db.get('users', EF.state.user.id);
    if (!(await EF.crypto.verifyPassword(current, u.pass))) throw new Error('Current password is wrong.');
    if (!validPw(next)) throw new Error(`Password must be at least ${MIN_PW} characters.`);
    u.pass = await EF.crypto.hashPassword(next); u.wrappedDek = await EF.crypto.wrapDek(EF.state.dek, next);
    await EF.db.save('users', u); await EF.audit.append('user.password_changed', 'user', u.id);
  }
  async function setActive(userId, active) {
    if (!can('users.*')) throw new Error('Not allowed.');
    if (userId === EF.state.user.id) throw new Error('You cannot disable your own account.');
    const u = await EF.db.get('users', userId); u.active = active; await EF.db.save('users', u);
    await EF.audit.append(active ? 'user.enable' : 'user.disable', 'user', userId);
  }

  EF.auth = { ROLES, allows, can, isSetUp, setup, login, logout, createUser, resetPassword, changeOwnPassword, setActive, MIN_PW };
  EF.can = can;
})();
