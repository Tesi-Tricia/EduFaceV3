// Tamper-evident audit log: every row's hash covers the previous row's hash (a chain). Editing or deleting any row breaks verification.
'use strict';
(function () {
  const EF = window.EF, GENESIS = '0'.repeat(64);
  let queue = Promise.resolve();   // serialise appends so the chain can never fork

  const rowString = r => `${r.prevHash}|${r.id}|${r.actorId ?? ''}|${r.action}|${r.entity ?? ''}|${r.entityId ?? ''}|${r.detail ?? ''}|${r.at}`;

  async function lastRow() {
    const db = await EF.db.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction('audit', 'readonly').objectStore('audit').openCursor(null, 'prev');
      req.onsuccess = () => resolve(req.result ? req.result.value : null); req.onerror = () => reject(req.error);
    });
  }

  function append(action, entity = null, entityId = null, detail = null) {
    const job = queue.then(async () => {
      const prev = await lastRow();
      const row = { id: EF.uuid(), at: EF.now(), actorId: EF.state.user?.id ?? null, actorEmail: EF.state.user?.email ?? null, action, entity, entityId,
        detail: detail == null ? null : JSON.stringify(detail), prevHash: prev ? prev.rowHash : GENESIS };
      row.rowHash = await EF.crypto.sha256Hex(rowString(row));
      await EF.db.putRaw('audit', row);
      return row;
    });
    queue = job.catch(() => { });
    return job;
  }

  /** Recomputes the whole chain. Returns { ok, count, brokenAt } (brokenAt = seq of the first bad row). */
  async function verify() {
    const rows = (await EF.db.all('audit', { includeDeleted: true })).sort((a, b) => a.seq - b.seq);
    let prev = GENESIS;
    for (const r of rows) {
      if (r.prevHash !== prev || (await EF.crypto.sha256Hex(rowString(r))) !== r.rowHash) return { ok: false, count: rows.length, brokenAt: r.seq };
      prev = r.rowHash;
    }
    return { ok: true, count: rows.length, brokenAt: null };
  }
  const list = async (limit = 200) => (await EF.db.all('audit', { includeDeleted: true })).sort((a, b) => b.seq - a.seq).slice(0, limit);

  EF.audit = { append, verify, list, GENESIS };
})();
