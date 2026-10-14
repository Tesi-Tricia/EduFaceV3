// Static check of the built phases: every script an index.html references exists, and every non-library script parses.
//   node _tools/check.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.resolve(__dirname, '..'); let bad = 0;
for (let n = 1; n <= 6; n++) {
  const d = path.join(root, 'phase' + n);
  if (!fs.existsSync(d)) { console.log(`phase${n}: not built`); bad++; continue; }
  for (const page of ['index.html', 'selftest.html']) {
    const file = path.join(d, page); if (!fs.existsSync(file)) continue;
    const srcs = [...fs.readFileSync(file, 'utf8').matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
    for (const s of srcs) {
      const f = path.join(d, s);
      if (!fs.existsSync(f)) { console.log(`phase${n}/${page}: MISSING ${s}`); bad++; continue; }
      if (!s.startsWith('lib/')) { try { new vm.Script(fs.readFileSync(f, 'utf8'), { filename: s }); } catch (e) { console.log(`phase${n}: SYNTAX ${s}: ${e.message}`); bad++; } }
    }
    if (page === 'index.html') console.log(`phase${n}: ${srcs.length} scripts OK; modules: ${srcs.filter(s => /js\/(accounts|school|attendance|visitors|reports|face|kiosk|backup|messages|retention|help)\.js/.test(s)).map(s => s.replace('js/', '').replace('.js', '')).join(', ')}`);
  }
  for (const f of ['serve.ps1', 'start.bat', 'README.md', 'app.css', 'icon.svg']) if (!fs.existsSync(path.join(d, f))) { console.log(`phase${n}: missing ${f}`); bad++; }
}
console.log(bad ? `PROBLEMS: ${bad}` : 'All phases OK');
process.exit(bad ? 1 : 0);
