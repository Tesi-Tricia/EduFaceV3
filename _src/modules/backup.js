// encrypted backup / restore. Because there is no server, a backup file is the ONLY copy of the data besides this browser.
'use strict';
(function () {
  const EF = window.EF, { html, put, $, t, toast } = EF;
  const MIN_PASS = 10;

  async function persisted() { try { return await navigator.storage?.persisted?.(); } catch { return null; } }

  EF.registerPage({ id: 'backup', titleKey: 'backup', icon: '⤓', order: 80, perm: 'backup.*', async render(el, nav) {
    const last = await EF.db.getMeta('lastBackupAt'); const p = await persisted(); let est = null; try { est = await navigator.storage?.estimate?.(); } catch { /* optional */ }
    if (EF.nav() !== nav) return;
    put(el, html`<header class="top"><h1>${t('backup')}</h1></header>
      <div class="alert ${last && Date.now() - new Date(last) < 7 * 864e5 ? '' : 'bad'}" role="alert">${last ? `Last backup: ${EF.fmtDateTime(last)}.` : 'No backup has been made yet.'}
        All data lives only in this browser. If the browser data is cleared or the computer fails, it is gone unless you have a backup file.</div>
      <form class="card" data-form="backup"><h2>Make a backup file</h2><p>The file is encrypted with a passphrase you choose. <strong>Keep the passphrase safe: without it the backup cannot be opened.</strong> Store the file on a USB drive or another computer.</p>
        <div class="row"><div class="field"><label for="bp">Passphrase (${MIN_PASS}+ characters)</label><input id="bp" name="pass" type="password" minlength="${MIN_PASS}" required autocomplete="new-password"></div>
        <div class="field"><label for="bp2">Repeat passphrase</label><input id="bp2" name="pass2" type="password" minlength="${MIN_PASS}" required autocomplete="new-password"></div>
        <div class="field"><button class="primary" type="submit">Download backup</button></div></div></form>
      <form class="card" data-form="restore"><h2>Restore from a backup file</h2><p class="alert bad">Restoring <strong>replaces everything</strong> in this browser with the contents of the backup, then signs everyone out.</p>
        <div class="row"><div class="field"><label for="rf">Backup file (.efb)</label><input id="rf" name="file" type="file" accept=".efb,application/json" required></div>
        <div class="field"><label for="rp">Passphrase</label><input id="rp" name="pass" type="password" required autocomplete="off"></div>
        <div class="field"><button class="danger" type="submit">Restore</button></div></div></form>
      <div class="card"><h2>Browser storage</h2><dl class="kv"><dt>Protected from automatic clean-up</dt><dd>${p === null ? 'unknown' : p ? 'yes' : 'no (the browser may clear it if the disk is full)'}</dd>
        <dt>Space used</dt><dd>${est ? `${(est.usage / 1048576).toFixed(1)} MB of ${(est.quota / 1073741824).toFixed(1)} GB` : 'unknown'}</dd></dl>
        <p class="hint">Never use "Clear browsing data" on this site, and do not use a private/incognito window.</p></div>`);
  } });

  EF.forms.backup = async form => {
    const d = Object.fromEntries(new FormData(form)); if (d.pass !== d.pass2) return toast('The passphrases do not match.'); if (d.pass.length < MIN_PASS) return toast(`Use at least ${MIN_PASS} characters.`);
    const dump = await EF.db.dumpAll(); const payload = { app: 'EduFace-html', at: EF.now(), dump };
    EF.download(await EF.crypto.sealJson(d.pass, payload), `eduface-backup-${EF.todayISO()}.efb`, 'application/json');
    await EF.db.setMeta('lastBackupAt', EF.now()); await EF.audit.append('backup.export', 'school', EF.state.schoolId); toast('Backup downloaded'); form.reset(); EF.showApp();
  };

  EF.forms.restore = async form => {
    const file = form.file.files[0]; if (!file) return; let payload;
    try { payload = await EF.crypto.openJson(form.pass.value, await file.text()); } catch (e) { return toast(e.message); }
    if (payload.app !== 'EduFace-html' || !payload.dump) return toast('This is not an EduFace backup.');
    if (!confirm(`Replace ALL current data with the backup from ${EF.fmtDateTime(payload.at)}? This cannot be undone.`)) return;
    await EF.db.loadAll(payload.dump); EF.state.user = null; EF.state.dek = null; alert('Restore complete. Please sign in again.'); location.reload();
  };

  // reminder on the dashboard
  EF.widgets.push({ order: 5, perm: 'backup.*', render: async () => {
    const last = await EF.db.getMeta('lastBackupAt'); const old = !last || Date.now() - new Date(last) > 7 * 864e5;
    return old ? html`<div class="alert bad" role="alert">${last ? 'Your last backup is more than 7 days old.' : 'No backup has been made yet.'} <a href="#/backup">Make a backup now</a>. All data lives only in this browser.</div>` : '';
  } });
})();
