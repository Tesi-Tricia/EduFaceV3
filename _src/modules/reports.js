// reports (attendance summary, late-comers, chronic absentees, visitors) with CSV and print/PDF.
'use strict';
(function () {
  const EF = window.EF, { html, put, $, t, toast } = EF;

  /** A "school day" is any date in range on which at least one student arrived. Per student and day: excused > present/late > absent. */
  EF.reports = {
    async summary(from, to, classId) {
      let students = await EF.data.activeStudents(); if (classId) students = students.filter(s => s.classId === classId);
      const classes = await EF.data.classes();
      const events = (await EF.db.all('attendance')).filter(e => e.date >= from && e.date <= to);
      const days = [...new Set(events.filter(e => e.direction === 'in' && (e.status === 'present' || e.status === 'late')).map(e => e.date))].sort();
      const by = new Map(); for (const e of events) { const k = e.studentId + '|' + e.date; if (!by.has(k)) by.set(k, []); by.get(k).push(e); }
      return students.map(s => {
        let present = 0, late = 0, absent = 0, excused = 0;
        for (const d of days) { const st = EF.rules.dailyStatus(by.get(s.id + '|' + d)); if (st === 'present') present++; else if (st === 'late') late++; else if (st === 'excused') excused++; else absent++; }
        const counted = days.length - excused;
        return { studentNo: s.studentNo, name: EF.data.fullName(s), className: EF.data.className(classes, s.classId), present, late, absent, excused, schoolDays: days.length, attendanceRate: counted <= 0 ? 100 : Math.round(1000 * (present + late) / counted) / 10 };
      });
    },
    async lateComers(from, to, classId) { return (await EF.reports.summary(from, to, classId)).filter(r => r.late > 0).sort((a, b) => b.late - a.late); },
    async chronic(from, to, classId, threshold = 20) { return (await EF.reports.summary(from, to, classId)).filter(r => r.schoolDays > 0 && 100 * r.absent / Math.max(1, r.schoolDays - r.excused) >= threshold).sort((a, b) => b.absent - a.absent); },
    async visitors(from, to) {
      const visitors = new Map((await EF.db.all('visitors')).map(v => [v.id, v])); const f = new Date(from + 'T00:00:00'), e = new Date(to + 'T23:59:59');
      return (await EF.db.all('visits')).filter(v => { const d = new Date(v.checkedInAt); return d >= f && d <= e; }).sort((a, b) => a.checkedInAt.localeCompare(b.checkedInAt)).map(v => {
        const p = visitors.get(v.visitorId) || {}; return { visitor: p.fullName, phone: p.phone, idNumber: p.idNumber, purpose: v.purpose, host: v.hostName, vehicle: v.vehiclePlate, checkedIn: EF.fmtDateTime(v.checkedInAt), checkedOut: EF.fmtDateTime(v.checkedOutAt), status: v.status }; });
    },
  };

  EF.registerPage({ id: 'reports', titleKey: 'reports', icon: '≡', order: 50, perm: 'reports.*', async render(el) {
    const to = EF.todayISO(), from = new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10); const classes = await EF.data.classes();
    put(el, html`<header class="top"><h1>${t('reports')}</h1></header>
      <div class="card"><form class="row" data-form="report">
        <div class="field"><label for="rt">Report</label><select id="rt" name="type"><option value="summary">Attendance summary</option><option value="late">Late-comers</option><option value="chronic">Chronic absentees</option><option value="visitors">Visitors</option></select></div>
        <div class="field"><label for="rf">From</label><input id="rf" name="from" type="date" value="${from}"></div><div class="field"><label for="rto">To</label><input id="rto" name="to" type="date" value="${to}"></div>
        <div class="field"><label for="rc">Class</label><select id="rc" name="classId"><option value="">All</option>${classes.map(c => html`<option value="${c.id}">${c.name} ${c.stream || ''}</option>`)}</select></div>
        <div class="field"><button class="primary" type="submit">Run</button></div></form></div><div id="rout"></div>`);
  } });
  let last = null;
  EF.forms.report = async form => {
    const d = Object.fromEntries(new FormData(form)); const c = d.classId || null;
    const rows = d.type === 'late' ? await EF.reports.lateComers(d.from, d.to, c) : d.type === 'chronic' ? await EF.reports.chronic(d.from, d.to, c) : d.type === 'visitors' ? await EF.reports.visitors(d.from, d.to) : await EF.reports.summary(d.from, d.to, c);
    last = { rows, name: `${d.type}-${d.from}-${d.to}` }; const cols = rows.length ? Object.keys(rows[0]) : [];
    put($('#rout'), html`<div class="card"><div class="row noprint"><button data-act="dl-report">CSV</button><button data-act="print">PDF / ${t('print')}</button><span class="muted">${rows.length} row(s)</span></div>
      <div class="tablewrap"><table><thead><tr>${cols.map(k => html`<th>${k.replace(/([A-Z])/g, ' $1')}</th>`)}</tr></thead><tbody>${rows.map(r => html`<tr>${cols.map(k => html`<td>${r[k]}</td>`)}</tr>`)}</tbody></table></div></div>`);
  };
  EF.actions['dl-report'] = () => { if (!last?.rows.length) return toast('Nothing to export.'); const cols = Object.keys(last.rows[0]); EF.download(EF.toCsv(cols, last.rows.map(r => cols.map(c => r[c]))), last.name + '.csv', 'text/csv'); };
})();
