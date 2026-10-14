// Multi-language ready: add a language by adding a block. Missing keys fall back to English; modules add keys with EF.addStrings().
'use strict';
(function () {
  const EF = window.EF;
  const I18N = {
    en: {
      dashboard: 'Dashboard', users: 'Users', audit: 'Audit log', settings: 'Settings', students: 'Students', scan: 'Live scan', attendance: 'Attendance',
      visitors: 'Visitors', reports: 'Reports', rollcall: 'Roll call', enroll: 'Enrol faces', messages: 'Messages', backup: 'Backup', help: 'Help', tests: 'Self-test',
      signin: 'Sign in', signout: 'Sign out', checkin: 'Check in', checkout: 'Check out', email: 'Email', password: 'Password', save: 'Save', cancel: 'Cancel', add: 'Add', delete: 'Delete', search: 'Search', print: 'Print',
      present: 'Present', late: 'Late', absent: 'Absent', excused: 'Excused', early_departure: 'Left early', in: 'In', out: 'Out',
    },
    sw: {
      dashboard: 'Dashibodi', users: 'Watumiaji', audit: 'Kumbukumbu', settings: 'Mipangilio', students: 'Wanafunzi', scan: 'Skani', attendance: 'Mahudhurio',
      visitors: 'Wageni', reports: 'Ripoti', rollcall: 'Orodha ya dharura', enroll: 'Sajili nyuso', messages: 'Ujumbe', backup: 'Hifadhi nakala', help: 'Msaada', tests: 'Jaribio',
      signin: 'Ingia', signout: 'Toka', checkin: 'Ingia', checkout: 'Toka', email: 'Barua pepe', password: 'Nenosiri', save: 'Hifadhi', cancel: 'Ghairi', add: 'Ongeza', delete: 'Futa', search: 'Tafuta', print: 'Chapisha',
      present: 'Yupo', late: 'Amechelewa', absent: 'Hayupo', excused: 'Ameruhusiwa', early_departure: 'Ameondoka mapema', in: 'Ndani', out: 'Nje',
    },
  };
  let lang = (() => { try { return localStorage.getItem('eduface.lang') || 'en'; } catch { return 'en'; } })();
  EF.t = k => (I18N[lang] && I18N[lang][k]) || I18N.en[k] || k;
  EF.addStrings = (l, dict) => { I18N[l] = Object.assign(I18N[l] || {}, dict); };
  EF.languages = () => Object.keys(I18N);
  EF.setLang = l => { lang = I18N[l] ? l : 'en'; try { localStorage.setItem('eduface.lang', lang); } catch { /* private mode */ } };
  EF.lang = () => lang;
})();

