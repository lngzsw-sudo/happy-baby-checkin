/* โหมดตัวอย่าง: จำลอง backend ในเบราว์เซอร์ (ใช้เมื่อ config.js ยังไม่ได้ใส่ LIFF_ID / GAS_URL)
   ข้อมูลอยู่ในหน่วยความจำเท่านั้น รีเฟรชแล้วหาย */
(function () {
  'use strict';
  const TZ = 'Asia/Bangkok';
  const ds = (d) => d.toLocaleDateString('en-CA', { timeZone: TZ });
  const ts = (d) => d.toLocaleTimeString('en-GB', { timeZone: TZ });
  const today = () => ds(new Date());
  const addDays = (s, n) => ds(new Date(new Date(s + 'T12:00:00+07:00').getTime() + n * 864e5));
  const dow = (s) => { const n = new Date(s + 'T12:00:00+07:00').getUTCDay(); return n === 0 ? 7 : n; };
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const id = () => Math.random().toString(36).slice(2, 10);
  const err = (code, msg) => { const e = new Error(msg); e.code = code; return e; };
  const LT = { sick: 'ลาป่วย', personal: 'ลากิจ', vacation: 'ลาพักร้อน', other: 'อื่นๆ' };

  const ME = 'U-demo-me';
  const db = {
    settings: {
      shop_name: 'Happy Baby', shop_lat: '14.4745', shop_lng: '100.1177', radius_m: '150', allow_outside: 'N', max_accuracy_m: '150',
      late_grace_min: '5', default_shift_start: '09:00', default_shift_end: '18:00', default_work_days: '123456', notify_mode: 'all',
      notify_group_id: '', daily_summary_hour: '20', alert_no_checkin_min: '30', max_clock_diff_sec: '180', photo_public_link: 'Y', liff_url: '',
    },
    employees: [
      ['U-demo-me', 'สมหญิง ใจดี', 'manager', 'active'], ['U-demo-2', 'มานี รักเด็ก', 'staff', 'active'],
      ['U-demo-3', 'ปิติ ขยันงาน', 'staff', 'active'], ['U-demo-4', 'ชูใจ ยิ้มแย้ม', 'staff', 'active'],
      ['U-demo-5', 'วีระ มาใหม่', 'staff', 'pending'],
    ].map((e) => ({ userId: e[0], name: e[1], lineName: e[1].split(' ')[0], pictureUrl: '', role: e[2], status: e[3],
      shiftStart: '09:00', shiftEnd: '18:00', workDays: '123456', registeredAt: addDays(today(), -40) + ' 09:00:00' })),
    attendance: [],
    leaves: [],
  };

  function rec(userId, date, type, time) {
    const e = db.employees.find((x) => x.userId === userId);
    const m = toMin(time), s = toMin(e.shiftStart), en = toMin(e.shiftEnd);
    return { id: id(), date: date, userId: userId, name: e.name, type: type, serverTime: date + ' ' + time, time: time,
      lat: 14.4746, lng: 100.1178, accuracyM: 12, distanceM: 16, inArea: 'Y',
      lateMin: type === 'in' && m - s > 5 ? m - s : 0, earlyMin: type === 'out' && m < en ? en - m : 0, otMin: type === 'out' && m > en ? m - en : 0,
      photoUrl: '', note: '', flags: '' };
  }
  // ประวัติย้อนหลัง 12 วัน + สถานะวันนี้ของเพื่อนร่วมงาน
  for (let i = 12; i >= 1; i--) {
    const d = addDays(today(), -i);
    ['U-demo-me', 'U-demo-2', 'U-demo-3', 'U-demo-4'].forEach((u, k) => {
      if (dow(d) === 7 || (k === 3 && i === 4)) return;
      db.attendance.push(rec(u, d, 'in', (i + k) % 5 === 0 ? '09:1' + k + ':20' : '08:5' + ((i + k) % 8) + ':10'));
      if (!(k === 2 && i === 2)) db.attendance.push(rec(u, d, 'out', i % 4 === 0 ? '18:4' + k + ':00' : '18:0' + ((i + k) % 9) + ':30'));
    });
  }
  db.attendance.push(rec('U-demo-2', today(), 'in', '08:52:41'), rec('U-demo-3', today(), 'in', '09:14:05'));
  db.leaves.push({ id: id(), userId: 'U-demo-4', name: 'ชูใจ ยิ้มแย้ม', leaveType: 'personal', fromDate: addDays(today(), 2), toDate: addDays(today(), 3),
    days: 2, reason: 'พาลูกไปฉีดวัคซีน', status: 'pending', requestedAt: today() + ' 08:00:00' });

  const emp = (u) => db.employees.find((e) => e.userId === u);
  const leaveOn = (u, d) => db.leaves.find((l) => l.userId === u && l.status === 'approved' && l.fromDate <= d && d <= l.toDate);
  const copy = (o) => JSON.parse(JSON.stringify(o));

  const handlers = {
    me() {
      const s = db.settings, d = today(), me = emp(ME);
      const t = { date: d, in: null, out: null, leave: null, workDay: me.workDays.indexOf(String(dow(d))) >= 0 };
      db.attendance.forEach((r) => { if (r.userId === ME && r.date === d) t[r.type] = r; });
      const lv = leaveOn(ME, d);
      if (lv) t.leave = LT[lv.leaveType];
      return { serverTime: Date.now(), profile: { userId: ME, name: me.lineName, picture: '' }, employee: me,
        shop: { name: s.shop_name, lat: +s.shop_lat, lng: +s.shop_lng, radius: +s.radius_m, allowOutside: s.allow_outside === 'Y', maxAccuracy: +s.max_accuracy_m },
        today: t };
    },
    checkin(b) {
      const d = today(), mine = db.attendance.filter((r) => r.userId === ME && r.date === d);
      if (b.type === 'in' && mine.some((r) => r.type === 'in')) throw err('ALREADY', 'วันนี้คุณเช็คอินเข้างานแล้ว');
      if (b.type === 'out' && !mine.some((r) => r.type === 'in')) throw err('NO_CHECKIN', 'ยังไม่ได้เช็คอินเข้างานวันนี้');
      const r = rec(ME, d, b.type, ts(new Date()));
      Object.assign(r, { photoUrl: b.photo, note: b.note || '', flags: b.photoSource === 'camera' ? '' : 'PHOTO_FILE', lat: b.lat, lng: b.lng });
      db.attendance.push(r);
      return { record: r };
    },
    history(b) { return { month: b.month, records: db.attendance.filter((r) => r.userId === ME && r.date.slice(0, 7) === b.month) }; },
    myLeaves() { return { leaves: db.leaves.filter((l) => l.userId === ME).reverse() }; },
    leaveRequest(b) {
      if (!b.reason.trim()) throw err('BAD_INPUT', 'กรุณาระบุเหตุผล');
      if (b.fromDate > b.toDate) throw err('BAD_INPUT', 'ช่วงวันที่ลาไม่ถูกต้อง');
      let days = 0;
      for (let d = b.fromDate; d <= b.toDate; d = addDays(d, 1)) if (dow(d) !== 7) days++;
      const l = { id: id(), userId: ME, name: emp(ME).name, leaveType: b.leaveType, fromDate: b.fromDate, toDate: b.toDate, days: days,
        reason: b.reason, status: 'pending', requestedAt: today() };
      db.leaves.push(l);
      return { leave: l };
    },
    leaveCancel(b) { db.leaves.find((l) => l.id === b.id).status = 'cancelled'; return {}; },
    adminToday() {
      const d = today();
      return { date: d, pendingEmployees: db.employees.filter((e) => e.status === 'pending').length,
        pendingLeaves: db.leaves.filter((l) => l.status === 'pending').length,
        rows: db.employees.filter((e) => e.status === 'active').map((e) => {
          const row = { employee: e, workDay: e.workDays.indexOf(String(dow(d))) >= 0, in: null, out: null, leave: null };
          db.attendance.forEach((r) => { if (r.userId === e.userId && r.date === d) row[r.type] = r; });
          const lv = leaveOn(e.userId, d);
          if (lv) row.leave = LT[lv.leaveType];
          return row;
        }) };
    },
    adminLeaves() { return { leaves: db.leaves.slice().reverse() }; },
    adminDecideLeave(b) { db.leaves.find((l) => l.id === b.id).status = b.decision; return {}; },
    adminEmployees() { return { employees: db.employees }; },
    adminUpdateEmployee(b) {
      if (b.patch.workDays === '') throw err('BAD_INPUT', 'กรุณาเลือกวันทำงานอย่างน้อย 1 วัน');
      Object.assign(emp(b.userId), b.patch);
      return {};
    },
    adminSettings() { return { settings: db.settings, sheetUrl: '' }; },
    adminSaveSettings(b) { Object.assign(db.settings, b.settings); return { settings: db.settings }; },
    adminTestNotify() { return { sent: false, detail: 'โหมดตัวอย่างไม่ส่งข้อความจริง' }; },
    adminReport(b) {
      const t = today();
      return { month: b.month, sheetUrl: '', rows: db.employees.filter((e) => e.status === 'active').map((e) => {
        const row = { userId: e.userId, name: e.name, scheduled: 0, present: 0, late: 0, lateMin: 0, absent: 0, leave: 0, earlyOut: 0,
          noCheckout: 0, otMin: 0, outside: 0, hours: 0 };
        for (let d = b.month + '-01'; d.slice(0, 7) === b.month && d <= t; d = addDays(d, 1)) {
          const day = {};
          db.attendance.forEach((r) => { if (r.userId === e.userId && r.date === d) day[r.type] = r; });
          const work = e.workDays.indexOf(String(dow(d))) >= 0;
          if (work) row.scheduled++;
          if (day.in) {
            row.present++;
            if (day.in.lateMin > 0) { row.late++; row.lateMin += day.in.lateMin; }
            if (day.out) { if (day.out.earlyMin > 0) row.earlyOut++; row.otMin += day.out.otMin; row.hours += (toMin(day.out.time) - toMin(day.in.time)) / 60; }
            else if (d < t) row.noCheckout++;
          } else if (work) { if (leaveOn(e.userId, d)) row.leave++; else if (d < t) row.absent++; }
        }
        row.hours = Math.round(row.hours * 10) / 10;
        return row;
      }) };
    },
  };

  window.mockApi = function (action, data) {
    return new Promise((resolve, reject) => setTimeout(() => {
      try {
        if (!handlers[action]) throw err('BAD_ACTION', 'ไม่รู้จักคำสั่งนี้');
        resolve(copy(handlers[action](data)));
      } catch (e) { reject(e); }
    }, 250));
  };
})();
