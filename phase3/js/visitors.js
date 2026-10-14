// visitors (check-in/out, badge with QR, watchlist, overstay) and the emergency roll call.
'use strict';
(function () {
  const EF = window.EF, { html, put, $, t, toast } = EF;
  EF.stores.push({ name: 'visitors', key: 'id', indexes: [['idno', 'idNumber']] }, { name: 'visits', key: 'id', indexes: [['visitor', 'visitorId'], ['status', 'status'], ['qr', 'qrToken']] });

  const maxMinutes = () => EF.db.getSetting('visitor.default_max_minutes', 120);
  const localDay = d => new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  EF.visitors = {
    async onSite() {
      const limit = await maxMinutes(); const visitors = new Map((await EF.db.all('visitors')).map(v => [v.id, v]));
      return (await EF.db.where('visits', 'status', 'checked_in')).filter(v => !v.deletedAt).sort((a, b) => a.checkedInAt.localeCompare(b.checkedInAt)).map(v => {
        const mins = Math.floor((Date.now() - new Date(v.checkedInAt)) / 60000); const p = visitors.get(v.visitorId) || {};
        return { ...v, visitor: p, minutes: mins, overstay: mins > (v.maxMinutes || limit) };
      });
    },
    async checkIn(d) {
      if (!d.fullName?.trim() || !d.purpose?.trim()) throw new Error('Name and purpose are required.');
      let visitor = d.idNumber?.trim() ? (await EF.db.where('visitors', 'idno', d.idNumber.trim()))[0] : null;
      if (visitor?.watchlist === 'blocked') { await EF.audit.append('visitor.blocked_attempt', 'visitor', visitor.id, { reason: visitor.watchlistReason }); const e = new Error('Visitor is BLOCKED: ' + (visitor.watchlistReason || 'no reason recorded')); e.blocked = true; throw e; }
      if (visitor && (await EF.db.where('visits', 'visitor', visitor.id)).some(v => v.status === 'checked_in')) throw new Error('Visitor is already checked in.');
      if (!visitor) visitor = await EF.db.save('visitors', { fullName: d.fullName.trim(), phone: d.phone?.trim() || null, idNumber: d.idNumber?.trim() || null, watchlist: 'none', watchlistReason: null });
      const day = localDay(new Date()); const seq = (await EF.db.all('visits')).filter(v => v.badgeNo?.startsWith('V-' + day.replaceAll('-', ''))).length + 1;
      const visit = await EF.db.save('visits', { visitorId: visitor.id, hostName: d.hostName?.trim() || null, purpose: d.purpose.trim(), vehiclePlate: d.vehiclePlate?.trim() || null, status: 'checked_in',
        checkedInAt: EF.now(), checkedOutAt: null, maxMinutes: await maxMinutes(), badgeNo: `V-${day.replaceAll('-', '')}-${String(seq).padStart(3, '0')}`, qrToken: EF.randomHex(16), createdBy: EF.state.user.id });
      await EF.audit.append('visitor.checkin', 'visit', visit.id, { name: visitor.fullName }); return { visit, visitor };
    },
    async checkOut({ visitId, qrToken }) {
      const visit = visitId ? await EF.db.get('visits', visitId) : (await EF.db.where('visits', 'qr', qrToken))[0];
      if (!visit) throw new Error('Badge not found.'); if (visit.status !== 'checked_in') throw new Error('Visit is not currently checked in.');
      visit.status = 'checked_out'; visit.checkedOutAt = EF.now(); visit.checkoutMethod = qrToken ? 'qr' : 'manual'; await EF.db.save('visits', visit);
      await EF.audit.append('visitor.checkout', 'visit', visit.id); return visit;
    },
  };

  function badge(visit, visitor) {
    return html`<div class="badge-sheet"><div><h3>${EF.state.school.name}</h3><small>VISITOR · ${visit.badgeNo}</small><div class="v">${visitor.fullName}</div>
      <small>Visiting: ${visit.hostName || '—'}</small><small>${visit.purpose}</small><small>In: ${EF.fmtDateTime(visit.checkedInAt)}</small></div><img alt="Badge QR" src="${EF.qrDataUrl(visit.qrToken, 4)}"></div>`;
  }

  EF.registerPage({ id: 'visitors', titleKey: 'visitors', icon: '⇄', order: 30, perm: 'visitors.*', async render(el, nav) {
    async function draw() {
      const rows = await EF.visitors.onSite(); if (EF.nav() !== nav || !$('#onsite')) return;
      put($('#onsite'), html`<div class="tablewrap"><table><thead><tr><th>Visitor</th><th>Host / purpose</th><th>Since</th><th></th></tr></thead><tbody>
        ${rows.map(v => html`<tr><td>${v.visitor.fullName} ${v.visitor.watchlist && v.visitor.watchlist !== 'none' ? html`<span class="badge bad">${v.visitor.watchlist}</span>` : ''}</td><td>${v.hostName || ''} <span class="muted">${v.purpose}</span></td>
          <td>${EF.fmtTime(v.checkedInAt)} <span class="badge ${v.overstay ? 'bad' : ''}">${v.minutes} min${v.overstay ? ' · overstay' : ''}</span></td>
          <td class="row"><button class="small primary" data-act="v-checkout" data-id="${v.id}">${t('checkout') || 'Check out'}</button><button class="small" data-act="v-badge" data-id="${v.id}">Badge</button>
            <button class="small" data-act="v-watch" data-id="${v.visitorId}" data-name="${v.visitor.fullName}">Watchlist</button></td></tr>`)}
        ${rows.length ? '' : html`<tr><td colspan="4" class="muted">Nobody checked in.</td></tr>`}</tbody></table></div>`);
    }
    put(el, html`<header class="top"><h1>${t('visitors')}</h1></header>
      <div class="grid"><form class="card" data-form="checkin"><h2>Check in</h2>
        <div class="field"><label for="vn">Full name</label><input id="vn" name="fullName" required></div>
        <div class="row"><div class="field"><label for="vp">Phone</label><input id="vp" name="phone" type="tel"></div><div class="field"><label for="vi">ID number</label><input id="vi" name="idNumber"></div></div>
        <div class="field"><label for="vh">Person visiting</label><input id="vh" name="hostName"></div>
        <div class="row"><div class="field"><label for="vu">Purpose</label><input id="vu" name="purpose" required></div><div class="field"><label for="vv">Vehicle plate</label><input id="vv" name="vehiclePlate"></div></div>
        <p><button class="primary" type="submit">Check in</button></p></form>
      <div class="card"><h2>Check out by badge QR</h2><div class="field"><label for="qrin">Scan or type the badge code, then Enter</label><input id="qrin" autocomplete="off" placeholder="Scan badge…"></div></div></div>
      <div class="card"><h2>${t('visitors')} on site</h2><div id="onsite"></div></div>`);
    $('#qrin').onkeydown = async e => { if (e.key !== 'Enter' || !e.target.value.trim()) return; const v = e.target.value.trim(); e.target.value = '';
      try { await EF.visitors.checkOut({ qrToken: v }); toast('Checked out'); } catch (er) { toast(er.message); } draw(); };
    EF.visPage = { draw }; draw(); EF.every(nav, draw, 15000);
  } });
  EF.forms.checkin = async form => {
    const d = Object.fromEntries(new FormData(form));
    try { const { visit, visitor } = await EF.visitors.checkIn(d); form.reset(); EF.visPage.draw();
      EF.modal(html`<h2>Checked in</h2>${visitor.watchlist === 'watch' ? html`<div class="alert bad" role="alert">On watchlist: ${visitor.watchlistReason || 'watch'}</div>` : ''}${badge(visit, visitor)}
        <p class="row noprint"><button class="primary" data-act="print">Print badge</button><button data-act="close">Close</button></p>`); }
    catch (e) { if (e.blocked) EF.beep('bad'); toast(e.message); }
  };
  EF.actions['v-checkout'] = async el => { try { await EF.visitors.checkOut({ visitId: el.dataset.id }); toast('Checked out'); } catch (e) { toast(e.message); } EF.visPage.draw(); };
  EF.actions['v-badge'] = async el => { const v = await EF.db.get('visits', el.dataset.id); const p = await EF.db.get('visitors', v.visitorId);
    EF.modal(html`${badge(v, p)}<p class="row noprint"><button class="primary" data-act="print">Print badge</button><button data-act="close">Close</button></p>`); };
  EF.actions['v-watch'] = el => EF.modal(html`<h2>Watchlist — ${el.dataset.name}</h2><form data-form="watch" data-id="${el.dataset.id}">
    <div class="field"><label for="ws">Status</label><select id="ws" name="status"><option value="none">None</option><option value="watch">Watch (alert staff)</option><option value="blocked">Blocked (refuse entry)</option></select></div>
    <div class="field"><label for="wr">Reason</label><input id="wr" name="reason"></div><p class="row"><button class="primary" type="submit">${t('save')}</button><button type="button" data-act="close">${t('cancel')}</button></p></form>`);
  EF.forms.watch = async form => {
    const d = Object.fromEntries(new FormData(form)); const v = await EF.db.get('visitors', form.dataset.id); v.watchlist = d.status; v.watchlistReason = d.reason || null;
    await EF.db.save('visitors', v); await EF.audit.append('visitor.watchlist', 'visitor', v.id, d); EF.closeModal(); toast('Saved'); EF.visPage.draw();
  };

  // ---------------------------------------------------------------- roll call
  EF.registerPage({ id: 'rollcall', titleKey: 'rollcall', icon: '⚑', order: 40, perm: 'rollcall.read', async render(el, nav) {
    async function draw() {
      const today = EF.todayISO(); const events = await EF.attendance.eventsOn(today); const last = new Map();
      for (const e of events.sort((a, b) => a.at.localeCompare(b.at))) last.set(e.studentId, e);
      const D = EF.data; const students = (await D.students()).filter(s => { const e = last.get(s.id); return e && e.direction === 'in' && e.status !== 'absent' && e.status !== 'excused'; });
      const visitors = await EF.visitors.onSite(); if (EF.nav() !== nav) return;
      put(el, html`<header class="top"><h1>${t('rollcall')}</h1><div class="row"><span class="muted">Generated ${EF.fmtDateTime(EF.now())}</span><button data-act="print">${t('print')}</button></div></header>
        <div class="card stat"><div class="n">${students.length + visitors.length}</div><div class="l">people on campus (${students.length} students, ${visitors.length} visitors)</div></div>
        <div class="card"><h2>${t('students')}</h2><div class="tablewrap"><table><thead><tr><th>No.</th><th>Name</th></tr></thead><tbody>${students.map(s => html`<tr><td>${s.studentNo}</td><td>${D.fullName(s)}</td></tr>`)}</tbody></table></div></div>
        <div class="card"><h2>${t('visitors')}</h2><div class="tablewrap"><table><thead><tr><th>Name</th><th>Host</th></tr></thead><tbody>${visitors.map(v => html`<tr><td>${v.visitor.fullName}</td><td>${v.hostName || ''}</td></tr>`)}</tbody></table></div></div>`);
    }
    await draw(); EF.every(nav, draw, 20000);
  } });

  EF.widgets.push({ order: 40, perm: 'visitors.*', render: async () => {
    const rows = await EF.visitors.onSite(); const over = rows.filter(r => r.overstay).length;
    return html`${over ? html`<div class="alert bad" role="alert">${over} visitor(s) have overstayed.</div>` : ''}<div class="grid"><div class="card stat"><div class="n">${rows.length}</div><div class="l">${t('visitors')} on site</div></div>
      <div class="card stat"><div class="n">${over}</div><div class="l">Overstays</div></div></div>`;
  } });
})();
