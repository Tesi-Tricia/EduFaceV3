// IndexedDB wrapper. Records mirror the original design: UUID ids, createdAt/updatedAt, version, soft delete (deletedAt).
'use strict';
(function () {
  const EF = window.EF;
  // Core stores; later phases add theirs with EF.stores.push(...) before boot.
  EF.stores.push(
    { name: 'users', key: 'id', indexes: [['email', 'email', { unique: true }]] },
    { name: 'settings', key: 'key' },
    { name: 'meta', key: 'key' },
    { name: 'audit', key: 'seq', auto: true },
  );

  let dbp = null;
  const DB = EF.db = {
    name: () => `EduFace-phase${EF.PHASE || 0}`,

    open() {
      if (dbp) return dbp;
      const version = EF.stores.length * 100 + EF.stores.reduce((n, s) => n + (s.indexes?.length || 0), 0);
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB.name(), version);
        req.onupgradeneeded = () => {
          const db = req.result, tx = req.transaction;
          for (const s of EF.stores) {
            const os = db.objectStoreNames.contains(s.name) ? tx.objectStore(s.name) : db.createObjectStore(s.name, { keyPath: s.key, autoIncrement: !!s.auto });
            for (const [iname, path, opt] of s.indexes || []) if (!os.indexNames.contains(iname)) os.createIndex(iname, path, opt || {});
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('Database is open in another tab; close it and reload.'));
      });
      return dbp;
    },

    async _run(store, mode, fn) {
      const db = await DB.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, mode), os = tx.objectStore(store);
        let result; const r = fn(os);
        if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      });
    },

    get: (store, id) => DB._run(store, 'readonly', os => os.get(id)),
    async all(store, { includeDeleted = false } = {}) {
      const rows = await DB._run(store, 'readonly', os => os.getAll());
      return includeDeleted ? rows : rows.filter(r => !r.deletedAt);
    },
    async where(store, index, value, opts) {
      const rows = await DB._run(store, 'readonly', os => os.index(index).getAll(value));
      return opts?.includeDeleted ? rows : rows.filter(r => !r.deletedAt);
    },
    count: (store) => DB._run(store, 'readonly', os => os.count()),
    putRaw: (store, obj) => DB._run(store, 'readwrite', os => os.put(obj)),
    clear: (store) => DB._run(store, 'readwrite', os => os.clear()),
    hardDelete: (store, id) => DB._run(store, 'readwrite', os => os.delete(id)),

    /** Create/update with housekeeping fields (id, timestamps, version). */
    async save(store, obj) {
      const t = EF.now();
      if (!obj.id) { obj.id = EF.uuid(); obj.createdAt = t; obj.version = 0; }
      obj.schoolId ??= EF.state.schoolId ?? null;
      obj.updatedAt = t; obj.version = (obj.version || 0) + 1;
      await DB.putRaw(store, obj);
      return obj;
    },
    /** Soft delete: the row stays (hidden) so deletes can be audited and restored. */
    async remove(store, id) {
      const o = await DB.get(store, id); if (!o) return;
      o.deletedAt = EF.now(); o.updatedAt = o.deletedAt; o.version = (o.version || 0) + 1;
      await DB.putRaw(store, o);
    },

    async getSetting(key, fallback) { const r = await DB.get('settings', key); return r ? r.value : fallback; },
    async setSetting(key, value) { await DB.putRaw('settings', { key, value, updatedAt: EF.now() }); },
    async getMeta(key) { return (await DB.get('meta', key))?.value; },
    async setMeta(key, value) { await DB.putRaw('meta', { key, value }); },

    /** For backup/restore: every store as plain JSON. */
    async dumpAll() { const out = {}; for (const s of EF.stores) out[s.name] = await DB._run(s.name, 'readonly', os => os.getAll()); return out; },
    async loadAll(dump) { for (const s of EF.stores) { if (!dump[s.name]) continue; await DB.clear(s.name); for (const r of dump[s.name]) await DB.putRaw(s.name, r); } },
  };
})();
