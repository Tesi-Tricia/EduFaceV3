// EduFace (static HTML edition) - shared helpers. No inline scripts/styles anywhere (strict CSP).
'use strict';
(function () {
  const EF = window.EF = window.EF || {};
  EF.pages = []; EF.widgets = []; EF.stores = []; EF.hooks = {}; EF.state = { user: null, dek: null };

  // ---- escaping templates: html`...` escapes every interpolation unless it is itself html`...` / raw() ----
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
  const raw = s => new Safe(s);
  const part = v => v instanceof Safe ? v.s : esc(v);
  function html(strings, ...vals) {
    let out = '';
    strings.forEach((s, i) => { out += s; if (i < vals.length) { const v = vals[i]; out += Array.isArray(v) ? v.map(part).join('') : part(v); } });
    return new Safe(out);
  }
  const put = (el, safe) => { el.innerHTML = safe instanceof Safe ? safe.s : esc(safe); return el; };
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const uuid = () => crypto.randomUUID();
  const now = () => new Date().toISOString();
  const todayISO = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const fmtTime = iso => iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const fmtDateTime = iso => iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
  const randomHex = n => hex(crypto.getRandomValues(new Uint8Array(n)));
  const b64 = bytes => { let s = ''; new Uint8Array(bytes).forEach(b => s += String.fromCharCode(b)); return btoa(s); };
  const unb64 = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));

  // ---- CSV (RFC 4180: quotes, escaped quotes, commas/newlines inside quotes) ----
  function parseCsv(text) {
    const rows = []; let row = [], cur = '', q = false; text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; rows.push(row); row = []; }
      else cur += c;
    }
    if (cur.length || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }
  // Quote fields and neutralise spreadsheet formulas (a name like "=cmd|..." must not execute when opened in Excel).
  function csvCell(v) {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(s) && isNaN(Number(s))) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  const toCsv = (header, rows) => '﻿' + [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');

  function download(content, name, type = 'text/plain') {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ---- sound cue (WebAudio; nothing to download) ----
  let audioCtx = null, muted = false;
  function beep(kind) {
    if (muted) return;
    try {
      audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
      const tones = { ok: [[880, .12]], late: [[660, .12], [660, .12]], bad: [[220, .3]] }[kind] || [[440, .1]];
      let t = audioCtx.currentTime;
      for (const [f, d] of tones) {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.frequency.value = f; g.gain.value = .15; o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t + d); t += d + .06;
      }
    } catch { /* audio is optional */ }
  }

  // ---- camera ----
  async function startCamera(video) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(window.isSecureContext ? 'This browser has no camera support.'
        : 'The browser blocks the camera on this address. Open the app as http://localhost:8080 (use start.bat) or over HTTPS.');
    }
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false });
    video.srcObject = stream; await video.play().catch(() => { });
    return stream;
  }
  const stopCamera = video => { video?.srcObject?.getTracks().forEach(t => t.stop()); if (video) video.srcObject = null; };

  // ---- toast + modal ----
  function toast(msg) {
    const el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); el.textContent = msg;
    document.body.append(el); setTimeout(() => el.remove(), 3200);
  }
  function modal(content) {
    let root = $('#modal-root'); if (!root) { root = document.createElement('div'); root.id = 'modal-root'; document.body.append(root); }
    put(root, html`<div class="modal-bg" data-act="close-bg"><div class="modal" role="dialog" aria-modal="true">${content}</div></div>`);
    $('input, select, textarea, button', root)?.focus();
  }
  const closeModal = () => { const r = $('#modal-root'); if (r) r.innerHTML = ''; };
  addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  // ---- tiny action/form registries (event delegation, no inline handlers) ----
  EF.actions = {}; EF.forms = {};
  addEventListener('click', e => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    if (el.dataset.act === 'close-bg') { if (e.target === el) closeModal(); return; }
    if (el.dataset.act === 'close') { closeModal(); return; }
    const f = EF.actions[el.dataset.act]; if (f) { if (el.tagName === 'A') e.preventDefault(); f(el, e); }
  });
  addEventListener('submit', e => {
    const form = e.target.closest('form[data-form]'); if (!form) return; e.preventDefault();
    EF.forms[form.dataset.form]?.(form);
  });

  Object.assign(EF, { esc, raw, html, put, $, $$, uuid, now, todayISO, fmtTime, fmtDateTime, hex, randomHex, b64, unb64, parseCsv, csvCell, toCsv, download, beep, setMuted: m => { muted = m; }, startCamera, stopCamera, toast, modal, closeModal, Safe });
})();
