// Assembles the cumulative phase folders: html/phase1 ... html/phase6.
// Each phase is a complete, runnable copy: it contains every module of the earlier phases plus its own additions.
//   node _tools/build-phases.js
'use strict';
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const src = path.join(root, '_src'), vendor = path.join(root, '_vendor'), tools = path.join(root, '_tools');

const CORE = ['util', 'i18n', 'db', 'crypto', 'audit', 'auth', 'shell'];
const PHASES = [
  { n: 1, title: 'Accounts, login and audit', modules: ['accounts'], vendor: [],
    summary: ['First-time setup (school + administrator)', 'Sign-in with roles (SchoolAdmin, Teacher, Security), lockout after 5 wrong passwords, 15-minute idle sign-out',
      'Passwords hashed with PBKDF2; one data key wrapped per user (used from Phase 4 for face data)', 'User management, tamper-evident audit log, settings (school name/colour, language, theme)',
      'Everything stored in this browser (IndexedDB) - no server, no database'] },
  { n: 2, title: 'School data and the user interface', modules: ['school'], vendor: ['qrcode.js'],
    summary: ['Dashboard with live numbers and a 7-day chart', 'Classes and students (add, edit, search, soft delete), guardians', 'CSV import (with a template) and CSV export',
      'Printable student QR cards'] },
  { n: 3, title: 'Attendance, visitors, roll call and reports', modules: ['attendance', 'visitors', 'reports'], vendor: ['jsQR.js'],
    summary: ['Scan page: QR card (camera or USB scanner), or type a code; late cut-off; duplicate scans ignored', 'Daily attendance view, manual override with required reason, close day (marks absentees)',
      'Visitors: check-in, badge with QR, check-out, watchlist/blocked, overstay alerts', 'Emergency roll call (students + visitors on campus)', 'Reports: attendance summary, late-comers, chronic absentees, visitors; CSV and print/PDF'] },
  { n: 4, title: 'Face recognition (webcam)', modules: ['face'], vendor: ['face-api.js', 'models'],
    summary: ['Guardian consent records (face scanning is blocked without consent)', 'Enrolment wizard: 3-5 frames with quality hints (size, blur, light, angle)', 'Live face scan on the Scan page; unknown / not-sure faces are never marked',
      'Face templates stored encrypted (AES-256-GCM) with the data key, never photos', 'Withdrawing consent deletes the student\'s face data immediately', 'Anti-spoofing is NOT included (a photo could fool it)'] },
  { n: 5, title: 'Kiosk, backup, messages and data retention', modules: ['kiosk', 'backup', 'messages', 'retention'], vendor: [], pwa: true,
    summary: ['Full-screen gate kiosk mode (PIN to leave)', 'Encrypted backup file export and restore', 'Installable app that works offline (service worker)', 'Guardian message queue with one-tap SMS links (no server needed)',
      'Retention: delete face data of withdrawn/graduated students and expired visitor records'] },
  { n: 6, title: 'Help, self-test and compliance documents', modules: ['help'], vendor: [], pwa: true, docs: true,
    summary: ['Built-in help: staff training guide, privacy checklist, accuracy test plan, deployment notes', 'Self-test page that runs the app\'s own checks in your browser', 'Demo data loader for training (never on a live school)'] },
];

const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };
const rmrf = p => fs.rmSync(p, { recursive: true, force: true });
const read = f => fs.readFileSync(f, 'utf8');

function indexHtml(p, scripts) {
  const faceCsp = p.n >= 4 ? " 'unsafe-eval'" : '';   // face-api (TensorFlow.js) compiles its network graph at run time
  const csp = `default-src 'self'; script-src 'self'${faceCsp}; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="theme-color" content="#1f6feb">
<title>EduFace</title>
${p.pwa ? '<link rel="manifest" href="manifest.webmanifest">\n' : ''}<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="app.css">
</head>
<body>
<div id="root"><p class="muted">Loading...</p></div>
<noscript>EduFace needs JavaScript.</noscript>
${scripts.map(s => `<script src="${s}"></script>`).join('\n')}
</body>
</html>
`;
}

// refuse to build if any source file has a syntax error (a stray comment once swallowed a line and broke every phase)
for (const dir of ['core', 'modules', 'tests', 'assets']) for (const f of fs.readdirSync(path.join(src, dir))) if (f.endsWith('.js') && !f.startsWith('sw')) {
  try { new (require('vm').Script)(read(path.join(src, dir, f)), { filename: f }); } catch (e) { console.error(`SYNTAX ERROR in _src/${dir}/${f}: ${e.message}`); process.exit(1); }
}
const only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean).map(Number);
for (const p of PHASES) {
  if (only.length && !only.includes(p.n)) continue;
  const out = path.join(root, `phase${p.n}`); rmrf(out); fs.mkdirSync(out, { recursive: true });
  const cum = PHASES.filter(x => x.n <= p.n);
  const modules = cum.flatMap(x => x.modules), vend = cum.flatMap(x => x.vendor);

  copy(path.join(src, 'core', 'app.css'), path.join(out, 'app.css'));
  copy(path.join(src, 'assets', 'icon.svg'), path.join(out, 'icon.svg'));
  for (const f of CORE) copy(path.join(src, 'core', f + '.js'), path.join(out, 'js', f + '.js'));
  for (const m of modules) copy(path.join(src, 'modules', m + '.js'), path.join(out, 'js', m + '.js'));

  const libScripts = [];
  for (const v of vend) {
    if (v === 'models') { for (const f of fs.readdirSync(path.join(vendor, 'models'))) copy(path.join(vendor, 'models', f), path.join(out, 'lib', 'models', f)); }
    else { copy(path.join(vendor, v), path.join(out, 'lib', v)); libScripts.push('lib/' + v); }
  }
  for (const f of fs.readdirSync(vendor)) if (f.startsWith('LICENSE-') && vend.some(v => f.toLowerCase().includes(v.replace(/\.js$/, '').toLowerCase().replace('jsqr', 'jsqr')))) copy(path.join(vendor, f), path.join(out, 'lib', f));
  if (vend.length) copy(path.join(vendor, 'SHA256SUMS.txt'), path.join(out, 'lib', 'SHA256SUMS.txt'));

  fs.writeFileSync(path.join(out, 'js', 'phase.js'), `window.EF = window.EF || {}; window.EF.PHASE = ${p.n}; window.EF.PHASE_TITLE = ${JSON.stringify(p.title)};\n`);
  if (p.pwa) {
    // sw.js is written after all files exist (it precaches the full file list)
    fs.writeFileSync(path.join(out, 'manifest.webmanifest'), JSON.stringify({ name: 'EduFace', short_name: 'EduFace', start_url: './index.html', scope: './', display: 'standalone', background_color: '#0f1316', theme_color: '#1f6feb', icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }] }, null, 2));
  }
  if (p.docs) for (const f of fs.readdirSync(path.join(src, 'docs'))) copy(path.join(src, 'docs', f), path.join(out, 'docs', f));
  for (const f of fs.readdirSync(path.join(src, 'db'))) copy(path.join(src, 'db', f), path.join(out, 'db', f));   // the MySQL schema goes into every phase
  const scripts = ['js/phase.js', ...CORE.map(f => `js/${f}.js`), ...libScripts, ...modules.map(m => `js/${m}.js`), 'js/boot.js'];
  if (p.n === 6) {   // standalone self-test page: same code, throw-away database, no boot
    copy(path.join(src, 'tests', 'selftest.js'), path.join(out, 'js', 'selftest-runner.js'));
    const extra = [...libScripts, ...modules.map(m => `js/${m}.js`)].map(s => `<script src="${s}"></script>`).join('\n');
    fs.writeFileSync(path.join(out, 'selftest.html'), read(path.join(src, 'tests', 'selftest.html')).replace('__SCRIPTS__', extra));
  }
  copy(path.join(src, 'core', 'boot.js'), path.join(out, 'js', 'boot.js'));
  fs.writeFileSync(path.join(out, 'index.html'), indexHtml(p, scripts));

  if (p.pwa) {
    const skip = new Set(['sw.js', 'README.md', 'serve.ps1', 'start.bat']);
    const files = []; (function walk(d, rel) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = rel ? rel + '/' + e.name : e.name; if (e.isDirectory()) { if (r !== 'db') walk(path.join(d, e.name), r); } else if (!skip.has(r) && !r.endsWith('SHA256SUMS.txt')) files.push('./' + r); } })(out, '');
    files.push('./');
    const version = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    fs.writeFileSync(path.join(out, 'sw.js'), read(path.join(src, 'assets', 'sw.js')).replace('__CACHE__', `eduface-phase${p.n}-${version}`).replace('__PREFIX__', `eduface-phase${p.n}-`).replace('__PRECACHE__', JSON.stringify(files, null, 1)));
  }
  copy(path.join(tools, 'serve.ps1'), path.join(out, 'serve.ps1'));
  fs.writeFileSync(path.join(out, 'start.bat'), '@echo off\r\ntitle EduFace\r\nstart "" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" -Open\r\n');
  fs.writeFileSync(path.join(out, 'README.md'), [
    `# EduFace (static HTML edition) - Phase ${p.n}: ${p.title}`, '',
    p.n === 1 ? 'The first phase. Each later phase folder contains everything in this one, plus more.' : `A complete copy: everything from phases 1-${p.n - 1} is included, plus the additions below.`, '',
    '## What this phase contains', ...p.summary.map(s => `- ${s}`), '',
    '## Run it', '1. Double-click **start.bat** (or run `.\\serve.ps1 -Open` in PowerShell). It starts a tiny web server on this computer only and opens http://localhost:8080.',
    '2. First time: create the school and administrator. Nothing needs installing; no internet is needed.', '3. Stop it with Ctrl+C in the black window.', '',
    '## Important', '- All data is stored **in this browser on this computer**. A different browser, profile or computer sees nothing. Clearing browser data deletes everything' + (p.n >= 5 ? ' (use Backup).' : '.'),
    `- Each phase uses its own browser database (\`EduFace-phase${p.n}\`), so phases do not interfere with each other.`,
    '- The camera works only on http://localhost or https, which is why start.bat is used instead of opening index.html directly.', '',
    '## Database schema (MySQL)', 'The `db/` folder holds the MySQL 8 schema (`V001`-`V003` scripts and `SCHEMA.md`). This browser edition does not use it; it is the database design for a server-backed version.', ''].join('\n'));
}
console.log('Built: ' + PHASES.filter(p => !only.length || only.includes(p.n)).map(p => 'phase' + p.n).join(', '));



