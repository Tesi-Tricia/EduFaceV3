// WebCrypto helpers. Passwords: PBKDF2-SHA256. Data: one random AES-256-GCM "data key" (DEK) that is never stored in clear;
// it is stored once per user, wrapped with a key derived from that user's password. Face templates are encrypted with the DEK.
'use strict';
(function () {
  const EF = window.EF, subtle = crypto.subtle, enc = new TextEncoder(), dec = new TextDecoder();
  const ITER = 200000;

  const sha256Hex = async data => EF.hex(await subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data));

  async function pbkdf2Bits(password, salt, iter = ITER, bits = 256) {
    const k = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, k, bits));
  }
  async function kek(password, salt, iter = ITER) {
    const raw = await pbkdf2Bits(password, salt, iter);
    return subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }
  const eq = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; };

  // ---- passwords ----
  async function hashPassword(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    return { salt: EF.b64(salt), iter: ITER, hash: EF.b64(await pbkdf2Bits(password, salt, ITER)) };
  }
  async function verifyPassword(password, rec) {
    const h = await pbkdf2Bits(password, EF.unb64(rec.salt), rec.iter);
    return eq(h, EF.unb64(rec.hash));
  }

  // ---- data key ----
  const newDek = () => subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  async function wrapDek(dek, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const raw = await subtle.exportKey('raw', dek);
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, await kek(password, salt), raw);
    return { salt: EF.b64(salt), iter: ITER, iv: EF.b64(iv), ct: EF.b64(ct) };
  }
  async function unwrapDek(w, password) {
    const raw = await subtle.decrypt({ name: 'AES-GCM', iv: EF.unb64(w.iv) }, await kek(password, EF.unb64(w.salt), w.iter), EF.unb64(w.ct));
    return subtle.importKey('raw', raw, 'AES-GCM', true, ['encrypt', 'decrypt']);
  }

  // ---- encrypt/decrypt with the data key; blob = iv(12) || ciphertext || tag(16), base64 ----
  async function seal(dek, bytes) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, dek, bytes));
    const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return EF.b64(out);
  }
  async function open(dek, b64blob) {
    const all = EF.unb64(b64blob);
    return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, dek, all.slice(12)));
  }
  const sealFloats = (dek, f32) => seal(dek, new Uint8Array(f32.buffer.slice(f32.byteOffset, f32.byteOffset + f32.byteLength)));
  const openFloats = async (dek, b) => { const u = await open(dek, b); return new Float32Array(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength)); };

  // ---- passphrase-encrypted backups ----
  async function sealJson(passphrase, obj) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, await kek(passphrase, salt), enc.encode(JSON.stringify(obj)));
    return JSON.stringify({ format: 'EFB-html-1', salt: EF.b64(salt), iter: ITER, iv: EF.b64(iv), ct: EF.b64(ct) });
  }
  async function openJson(passphrase, text) {
    const w = JSON.parse(text); if (w.format !== 'EFB-html-1') throw new Error('Not an EduFace backup file.');
    try {
      const pt = await subtle.decrypt({ name: 'AES-GCM', iv: EF.unb64(w.iv) }, await kek(passphrase, EF.unb64(w.salt), w.iter), EF.unb64(w.ct));
      return JSON.parse(dec.decode(pt));
    } catch { throw new Error('Wrong passphrase, or the backup file is damaged or was changed.'); }
  }

  EF.crypto = { sha256Hex, hashPassword, verifyPassword, newDek, wrapDek, unwrapDek, seal, open, sealFloats, openFloats, sealJson, openJson, ITER };
})();
