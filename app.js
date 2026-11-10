/* Happy Baby Check-in — หน้าเว็บ LIFF */
(function () {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const DEMO = !CFG.LIFF_ID || !CFG.GAS_URL;
  const TZ = 'Asia/Bangkok';
  const LEAVE_TYPES = { sick: 'ลาป่วย', personal: 'ลากิจ', vacation: 'ลาพักร้อน', other: 'อื่นๆ' };
  const LEAVE_STATUS = { pending: ['รออนุมัติ', 'warn'], approved: ['อนุมัติแล้ว', ''], rejected: ['ไม่อนุมัติ', 'bad'], cancelled: ['ยกเลิก', 'mute'] };
  const DAY_NAMES = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'];

  const $ = (s, el) => (el || document).querySelector(s);
  const app = $('#app');
  const modalRoot = $('#modal-root');
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = (u) => (/^(https:\/\/|data:image\/)/.test(String(u || '')) ? String(u) : '');

  const S = {
    idToken: '', me: null, offset: 0, tab: 'checkin', adminTab: 'today',
    pos: null, posErr: '', watchId: null, stream: null, clockTimer: null,
    histMonth: '', reportMonth: '',
  };

  /* ---------- เวลา ---------- */
  const now = () => new Date(Date.now() + S.offset);
  const fmtTime = (d) => d.toLocaleTimeString('en-GB', { timeZone: TZ });
  const fmtDateLong = (d) => d.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ });
  const todayStr = () => now().toLocaleDateString('en-CA', { timeZone: TZ });
  const noon = (ds) => new Date(ds + 'T12:00:00+07:00');
  const thDay = (ds) => noon(ds).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });
  const thDate = (ds) => noon(ds).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', timeZone: TZ });
  const thMonth = (m) => noon(m + '-01').toLocaleDateString('th-TH', { month: 'long', year: 'numeric', timeZone: TZ });
  const shiftMonth = (m, n) => {
    const p = m.split('-').map(Number);
    const d = new Date(Date.UTC(p[0], p[1] - 1 + n, 1));
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
  };
  const hm = (t) => String(t || '').slice(0, 5);

  function distance(lat1, lng1, lat2, lng2) {
    const R = 6371000, rad = Math.PI / 180;
    const a = Math.sin((lat2 - lat1) * rad / 2) ** 2 +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin((lng2 - lng1) * rad / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  /* ---------- API ---------- */
  async function api(action, data) {
    if (DEMO) return window.mockApi(action, data || {});
    let j;
    try {
      const res = await fetch(CFG.GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // เลี่ยง CORS preflight ของ Apps Script
        body: JSON.stringify(Object.assign({ action: action, idToken: S.idToken }, data || {})),
      });
      j = await res.json();
    } catch (e) {
      throw new Error('เชื่อมต่อระบบไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่');
    }
    if (!j.ok) {
      if (j.code === 'TOKEN_INVALID' && window.liff && !window.liff.isInClient()) {
        window.liff.logout();
        location.reload();
      }
      const err = new Error(j.error || 'เกิดข้อผิดพลาด');
      err.code = j.code;
      throw err;
    }
    return j.data;
  }

  /* ---------- UI พื้นฐาน ---------- */
  let toastTimer;
  function toast(msg, isErr) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (isErr ? ' err' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, isErr ? 5000 : 2600);
  }
  const fail = (e) => toast(e && e.message ? e.message : String(e), true);

  function openModal(html) {
    modalRoot.innerHTML = '<div class="modal"><div class="sheet">' + html + '</div></div>';
    const m = $('.modal', modalRoot);
    m.addEventListener('click', (ev) => { if (ev.target === m && !m.dataset.lock) closeModal(); });
    return $('.sheet', modalRoot);
  }
  function closeModal() { modalRoot.innerHTML = ''; }

  /** กันกดซ้ำ + แสดงสถานะกำลังทำงานบนปุ่ม */
  async function withBusy(btn, fn) {
    if (btn.disabled) return;
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'กำลังดำเนินการ…';
    try { await fn(); } catch (e) { fail(e); } finally {
      if (btn.isConnected) { btn.disabled = false; btn.textContent = label; }
    }
  }

  function fullScreen(icon, title, text, extra) {
    app.innerHTML = '<div class="splash"><div class="logo">' + icon + '</div><div class="splash-title">' + esc(title) +
      '</div><p>' + esc(text) + '</p>' + (extra || '') + '</div>';
  }

  function avatar(url, cls) {
    const u = safeUrl(url);
    return u ? '<img class="' + cls + '" src="' + esc(u) + '" alt="" referrerpolicy="no-referrer">' : '<div class="' + cls + '">👤</div>';
  }

  function recBadges(r) {
    if (!r) return '';
    const b = [];
    if (r.type === 'in') b.push(r.lateMin > 0 ? '<span class="badge warn">สาย ' + r.lateMin + ' นาที</span>' : '<span class="badge">ตรงเวลา</span>');
    if (r.earlyMin > 0) b.push('<span class="badge warn">ออกก่อน ' + r.earlyMin + ' นาที</span>');
    if (r.otMin >= 30) b.push('<span class="badge">OT ' + r.otMin + ' นาที</span>');
    if (r.inArea !== 'Y') b.push('<span class="badge bad">นอกพื้นที่</span>');
    const f = String(r.flags || '');
    if (f.indexOf('CLOCK_DIFF') >= 0) b.push('<span class="badge bad">นาฬิกาไม่ตรง</span>');
    if (f.indexOf('PHOTO_FILE') >= 0) b.push('<span class="badge bad">ภาพไม่ได้ถ่ายสด</span>');
    return b.join('');
  }

  function monthPicker(month, id) {
    return '<div class="card month" id="' + id + '"><button data-d="-1" aria-label="เดือนก่อนหน้า">‹</button><b>' +
      esc(thMonth(month)) + '</b><button data-d="1" aria-label="เดือนถัดไป">›</button></div>';
  }
  function bindMonth(id, key, render) {
    $('#' + id).addEventListener('click', (ev) => {
      const d = ev.target.dataset.d;
      if (!d) return;
      const next = shiftMonth(S[key], Number(d));
      if (next > todayStr().slice(0, 7)) return;
      S[key] = next;
      render();
    });
  }

  /* ---------- เริ่มระบบ ---------- */
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('โหลด LINE SDK ไม่สำเร็จ'));
      document.head.appendChild(s);
    });
  }

  async function boot() {
    try {
      if (!DEMO) {
        await loadScript('https://static.line-scdn.net/liff/edge/2/sdk.js');
        await window.liff.init({ liffId: CFG.LIFF_ID });
        if (!window.liff.isLoggedIn()) { window.liff.login({ redirectUri: location.href }); return; }
        S.idToken = window.liff.getIDToken();
        if (!S.idToken) throw new Error('ไม่ได้รับข้อมูลยืนยันตัวตนจาก LINE (ตรวจว่า LIFF เปิด scope "openid" แล้ว)');
      }
      await refreshMe();
      route();
    } catch (e) {
      fullScreen('😢', 'เปิดระบบไม่สำเร็จ', e.message || String(e),
        '<button class="btn primary" onclick="location.reload()">ลองใหม่</button>');
    }
  }

  async function refreshMe() {
    const t0 = Date.now();
    S.me = await api('me');
    S.offset = S.me.serverTime - (t0 + Date.now()) / 2; // ชดเชยนาฬิกาเครื่องให้ตรงเซิร์ฟเวอร์
    if (!S.histMonth) S.histMonth = S.reportMonth = todayStr().slice(0, 7);
  }

  function route() {
    const e = S.me.employee;
    if (!e) return renderRegister();
    if (e.status === 'pending') {
      return fullScreen('⏳', 'รอผู้จัดการอนุมัติ', 'ลงทะเบียนในชื่อ "' + e.name + '" แล้ว เมื่อผู้จัดการอนุมัติจะเริ่มเช็คอินได้',
        '<button class="btn primary" onclick="location.reload()">ตรวจสอบอีกครั้ง</button>');
    }
    if (e.status !== 'active') return fullScreen('🔒', 'บัญชีถูกปิดใช้งาน', 'กรุณาติดต่อผู้จัดการร้าน');
    renderShell();
  }

  function renderRegister() {
    app.innerHTML = '<div class="splash"><div class="logo">🍼</div><div class="splash-title">' + esc(S.me.shop.name) + '</div>' +
      '<p>ลงทะเบียนพนักงานครั้งแรก</p>' +
      '<form id="reg" class="card" style="width:100%;max-width:360px;text-align:left;margin-top:8px">' +
      '<label class="f">ชื่อ-นามสกุลจริง<input type="text" name="name" maxlength="60" autocomplete="name" required></label>' +
      '<button class="btn primary block" type="submit">ลงทะเบียน</button></form></div>';
    $('#reg').addEventListener('submit', (ev) => {
      ev.preventDefault();
      withBusy($('#reg button'), async () => {
        await api('register', { name: ev.target.name.value });
        await refreshMe();
        route();
      });
    });
  }

  /* ---------- โครงหน้า + แท็บ ---------- */
  function renderShell() {
    const e = S.me.employee;
    const tabs = [['checkin', '📍', 'ลงเวลา'], ['history', '🗓️', 'ประวัติ'], ['leave', '📝', 'ลางาน']];
    if (e.role === 'manager') tabs.push(['admin', '👩‍💼', 'ผู้จัดการ']);
    app.innerHTML =
      '<header class="top">' + avatar(e.pictureUrl || S.me.profile.picture, 'avatar') +
      '<div class="who"><b>' + esc(e.name) + '</b><span>' + esc(S.me.shop.name) + (e.role === 'manager' ? ' • ผู้จัดการ' : '') + '</span></div>' +
      (DEMO ? '<span class="demo-tag">โหมดตัวอย่าง</span>' : '') + '</header>' +
      '<main id="view"></main>' +
      '<nav class="nav"><div class="nav-in">' + tabs.map((t) =>
        '<button data-tab="' + t[0] + '"><span>' + t[1] + '</span>' + t[2] + '</button>').join('') + '</div></nav>';
    $('.nav').addEventListener('click', (ev) => {
      const b = ev.target.closest('button');
      if (b) switchTab(b.dataset.tab);
    });
    switchTab(S.tab);
  }

  function switchTab(tab) {
    S.tab = tab;
    document.querySelectorAll('.nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    if (tab !== 'checkin') { stopCamera(); clearInterval(S.clockTimer); }
    window.scrollTo(0, 0);
    const r = { checkin: renderCheckin, history: renderHistory, leave: renderLeave, admin: renderAdmin }[tab];
    Promise.resolve(r()).catch(fail);
  }
  const view = () => $('#view');
  const loading = () => { view().innerHTML = '<div class="splash" style="min-height:40vh"><div class="spinner"></div></div>'; };

  /* ---------- แท็บลงเวลา ---------- */
  function stamp(label, r) {
    return '<div class="stamp"><small>' + label + '</small><div class="t' + (r ? '' : ' empty') + '">' + (r ? hm(r.time) : '--:--') +
      '</div><div class="badges">' + recBadges(r) + '</div></div>';
  }

  function renderCheckin() {
    const t = S.me.today, e = S.me.employee;
    const next = !t.in ? 'in' : !t.out ? 'out' : null;
    view().innerHTML =
      '<section class="hero"><div class="hero-date">' + esc(fmtDateLong(now())) + '</div>' +
      '<div class="hero-clock" id="clock">' + fmtTime(now()) + '</div>' +
      '<div class="hero-shift">กะงาน ' + esc(e.shiftStart) + ' – ' + esc(e.shiftEnd) + ' น.</div></section>' +
      (t.leave ? '<div class="banner">วันนี้คุณลางาน (' + esc(t.leave) + ')</div>' :
        !t.workDay ? '<div class="banner">วันนี้เป็นวันหยุดตามกะของคุณ</div>' : '') +
      '<section class="pair">' + stamp('เข้างาน', t.in) + stamp('ออกงาน', t.out) + '</section>' +
      (next ?
        '<section class="card"><div class="loc" id="loc">กำลังค้นหาตำแหน่ง…</div>' +
        '<div class="cam"><video id="video" playsinline autoplay muted></video><div class="cam-msg" id="camMsg">กำลังเปิดกล้อง…</div></div>' +
        '<input type="file" id="file" accept="image/*" capture="user" hidden>' +
        '<button class="btn big ' + next + '" id="shoot">📸 ถ่ายภาพ' + (next === 'in' ? 'เช็คอินเข้างาน' : 'เช็คเอาท์ออกงาน') + '</button>' +
        '<p class="hint">ระบบจะบันทึกภาพถ่าย พิกัด และเวลา พร้อมแจ้งผู้จัดการร้าน</p></section>' :
        '<section class="card done">🎉 วันนี้ลงเวลาครบแล้ว ขอบคุณที่ตั้งใจทำงานนะคะ</section>');

    clearInterval(S.clockTimer);
    S.clockTimer = setInterval(() => { const c = $('#clock'); if (c) c.textContent = fmtTime(now()); }, 500);
    if (!next) { stopCamera(); return; }
    startGeo();
    updateLoc();
    startCamera();
    $('#shoot').addEventListener('click', () => onShoot(next));
    $('#file').addEventListener('change', (ev) => onFile(ev, next));
  }

  function startGeo() {
    if (S.watchId !== null) return;
    if (!navigator.geolocation) { S.posErr = 'อุปกรณ์นี้ไม่รองรับการระบุตำแหน่ง'; return; }
    S.watchId = navigator.geolocation.watchPosition(setPos, (err) => {
      if (DEMO) { S.pos = { lat: S.me.shop.lat + 0.0002, lng: S.me.shop.lng + 0.0001, acc: 12 }; updateLoc(); return; }
      S.posErr = err.code === 1 ? 'กรุณาอนุญาตให้ LINE เข้าถึงตำแหน่ง แล้วเปิดหน้านี้ใหม่' : 'ยังหาตำแหน่งไม่ได้ กรุณาเปิด GPS';
      updateLoc();
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  }
  function setPos(p) {
    S.pos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) };
    S.posErr = '';
    updateLoc();
  }
  /** ขอพิกัดล่าสุดตอนกดยืนยัน ถ้าไม่ได้ภายใน 8 วินาทีใช้ค่าล่าสุดที่มี */
  function freshPos() {
    return new Promise((res) => {
      if (DEMO || !navigator.geolocation) return res(S.pos);
      navigator.geolocation.getCurrentPosition((p) => { setPos(p); res(S.pos); }, () => res(S.pos),
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 8000 });
    });
  }
  function posInfo() {
    if (!S.pos) return null;
    const shop = S.me.shop;
    const d = Math.round(distance(S.pos.lat, S.pos.lng, shop.lat, shop.lng));
    return { d: d, inArea: d <= shop.radius, lowAcc: S.pos.acc > shop.maxAccuracy };
  }
  function updateLoc() {
    const el = $('#loc');
    if (!el) return;
    const i = posInfo();
    if (!i) { el.className = 'loc' + (S.posErr ? ' bad' : ''); el.textContent = S.posErr || 'กำลังค้นหาตำแหน่ง…'; return; }
    if (i.lowAcc) { el.className = 'loc bad'; el.textContent = '📡 สัญญาณ GPS ยังไม่แม่นยำ (±' + S.pos.acc + ' ม.) กรุณารอสักครู่'; return; }
    el.className = 'loc ' + (i.inArea ? 'ok' : 'bad');
    el.textContent = i.inArea ? '📍 อยู่ในพื้นที่ร้าน • ห่าง ' + i.d + ' ม. (±' + S.pos.acc + ' ม.)'
      : '⚠️ อยู่นอกพื้นที่ร้าน • ห่าง ' + i.d + ' ม. (อนุญาต ' + S.me.shop.radius + ' ม.)';
  }

  async function startCamera() {
    const msg = $('#camMsg');
    try {
      if (!S.stream) {
        const st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 } }, audio: false });
        if (S.tab !== 'checkin' || !$('#video')) { st.getTracks().forEach((t) => t.stop()); return; }
        S.stream = st;
      }
      $('#video').srcObject = S.stream;
      if (msg) msg.hidden = true;
    } catch (e) {
      if ($('#camMsg')) $('#camMsg').textContent = 'เปิดกล้องในหน้านี้ไม่ได้ — กดปุ่มด้านล่างเพื่อถ่ายภาพ';
    }
  }
  function stopCamera() {
    if (S.stream) { S.stream.getTracks().forEach((t) => t.stop()); S.stream = null; }
  }

  function drawPhoto(src, w, h, type) {
    const scale = Math.min(1, 720 / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0, c.width, c.height);
    // ประทับชื่อ เวลา พิกัด ลงบนภาพ
    const lines = [
      S.me.shop.name + ' • ' + (type === 'in' ? 'เข้างาน' : 'ออกงาน') + ' • ' + S.me.employee.name,
      now().toLocaleDateString('th-TH', { timeZone: TZ }) + ' ' + fmtTime(now()),
      S.pos ? S.pos.lat.toFixed(5) + ', ' + S.pos.lng.toFixed(5) + ' (±' + S.pos.acc + ' ม.)' : '',
    ];
    const fs = Math.max(13, Math.round(c.width / 32)), lh = fs * 1.45, band = lh * lines.length + fs * 0.8;
    g.fillStyle = 'rgba(0,0,0,.55)';
    g.fillRect(0, c.height - band, c.width, band);
    g.fillStyle = '#fff';
    g.font = '600 ' + fs + 'px sans-serif';
    g.textBaseline = 'top';
    lines.forEach((t, i) => g.fillText(t, fs * 0.7, c.height - band + fs * 0.4 + i * lh, c.width - fs * 1.4));
    return c.toDataURL('image/jpeg', 0.72);
  }

  function onShoot(type) {
    if (!S.pos) return toast(S.posErr || 'กำลังค้นหาตำแหน่ง กรุณารอสักครู่', true);
    const v = $('#video');
    if (S.stream && v && v.videoWidth) return confirmShot(type, drawPhoto(v, v.videoWidth, v.videoHeight, type), 'camera');
    $('#file').click(); // กล้องสดใช้ไม่ได้ → ใช้กล้องของระบบแทน (จะถูกติดธงให้ผู้จัดการทราบ)
  }

  function onFile(ev, type) {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    const img = new Image();
    const url = URL.createObjectURL(f);
    img.onload = () => { confirmShot(type, drawPhoto(img, img.naturalWidth, img.naturalHeight, type), 'file'); URL.revokeObjectURL(url); };
    img.onerror = () => { URL.revokeObjectURL(url); toast('อ่านไฟล์ภาพไม่ได้', true); };
    img.src = url;
  }

  function confirmShot(type, photo, source) {
    const i = posInfo();
    const label = type === 'in' ? 'เช็คอินเข้างาน' : 'เช็คเอาท์ออกงาน';
    const needNote = i && !i.inArea;
    const sh = openModal(
      '<h3>ยืนยัน' + label + '</h3><img class="shot" src="' + photo + '" alt="ภาพถ่ายลงเวลา">' +
      (needNote ? '<div class="banner" style="margin-bottom:12px">คุณอยู่นอกพื้นที่ร้าน (' + i.d + ' ม.)' +
        (S.me.shop.allowOutside ? ' กรุณาระบุเหตุผล' : ' ระบบอาจไม่อนุญาตให้ลงเวลา') + '</div>' +
        '<label class="f">เหตุผล<textarea id="note" maxlength="200"></textarea></label>' : '') +
      '<div class="row"><button class="btn" id="retake">ถ่ายใหม่</button><button class="btn ' + type + '" id="ok">ยืนยัน</button></div>');
    $('#retake', sh).addEventListener('click', closeModal);
    $('#ok', sh).addEventListener('click', (ev) => withBusy(ev.target, async () => {
      const note = $('#note', sh) ? $('#note', sh).value.trim() : '';
      if (needNote && S.me.shop.allowOutside && !note) throw new Error('กรุณาระบุเหตุผลที่ลงเวลานอกพื้นที่');
      $('.modal', modalRoot).dataset.lock = '1';
      try {
        const pos = await freshPos();
        const r = await api('checkin', {
          type: type, photo: photo, photoSource: source, note: note,
          lat: pos.lat, lng: pos.lng, accuracy: pos.acc,
          deviceTime: Date.now(), device: navigator.userAgent,
        });
        await refreshMe();
        renderCheckin();
        showSuccess(r.record, label);
      } finally {
        const m = $('.modal', modalRoot);
        if (m) delete m.dataset.lock;
      }
    }));
  }

  function showSuccess(r, label) {
    const sh = openModal('<div class="big-ok">' + (r.lateMin > 0 ? '⏰' : '✅') + '</div><h3 class="center">' + label + 'สำเร็จ</h3>' +
      '<div class="when">' + esc(hm(r.time)) + ' น.</div><div class="badges" style="justify-content:center;margin:8px 0 16px">' +
      recBadges(r) + '</div><button class="btn primary block" id="close">ตกลง</button>');
    $('#close', sh).addEventListener('click', closeModal);
  }

  /* ---------- แท็บประวัติ ---------- */
  async function renderHistory() {
    loading();
    const data = await api('history', { month: S.histMonth });
    if (S.tab !== 'history') return;
    const days = {};
    data.records.forEach((r) => { (days[r.date] = days[r.date] || {})[r.type] = r; });
    const keys = Object.keys(days).sort().reverse();
    const late = keys.filter((k) => days[k].in && days[k].in.lateMin > 0);
    const lateMin = late.reduce((a, k) => a + days[k].in.lateMin, 0);
    view().innerHTML = monthPicker(S.histMonth, 'hm') +
      '<div class="stats"><div class="stat"><b>' + keys.length + '</b><span>วันที่มา</span></div>' +
      '<div class="stat"><b>' + late.length + '</b><span>สาย (ครั้ง)</span></div>' +
      '<div class="stat"><b>' + lateMin + '</b><span>สาย (นาที)</span></div>' +
      '<div class="stat"><b>' + keys.filter((k) => !days[k].out && k < todayStr()).length + '</b><span>ลืมเช็คเอาท์</span></div></div>' +
      '<section class="card"><div class="list">' + (keys.length ? keys.map((k) => {
        const d = days[k];
        return '<div class="item"><div class="grow"><b>' + esc(thDay(k)) + '</b><div class="badges">' + recBadges(d.in) +
          (d.out ? recBadges(d.out) : '') + '</div></div><div class="right times">' + (d.in ? hm(d.in.time) : '--:--') + ' – ' +
          (d.out ? hm(d.out.time) : '--:--') + '</div></div>';
      }).join('') : '<div class="empty">ยังไม่มีการลงเวลาในเดือนนี้</div>') + '</div></section>';
    bindMonth('hm', 'histMonth', () => renderHistory().catch(fail));
  }

  /* ---------- แท็บลางาน ---------- */
  function leaveItem(l, actions) {
    const st = LEAVE_STATUS[l.status] || [l.status, 'mute'];
    return '<div class="item"><div class="grow"><b>' + esc(actions === 'admin' ? l.name + ' • ' : '') + esc(LEAVE_TYPES[l.leaveType] || l.leaveType) +
      '</b><div class="sub">' + esc(thDate(l.fromDate)) + (l.toDate !== l.fromDate ? ' – ' + esc(thDate(l.toDate)) : '') + ' • ' + l.days +
      ' วัน</div><div class="sub">' + esc(l.reason) + '</div>' +
      (l.status === 'pending' && actions === 'admin' ? '<div class="row" style="margin-top:8px"><button class="btn sm danger" data-id="' + esc(l.id) +
        '" data-dec="rejected">ไม่อนุมัติ</button><button class="btn sm in" data-id="' + esc(l.id) + '" data-dec="approved">อนุมัติ</button></div>' : '') +
      '</div><div class="right"><span class="badge ' + st[1] + '">' + st[0] + '</span>' +
      (l.status === 'pending' && actions === 'mine' ? '<div style="margin-top:6px"><button class="btn sm" data-cancel="' + esc(l.id) + '">ยกเลิก</button></div>' : '') +
      '</div></div>';
  }

  async function renderLeave() {
    loading();
    const data = await api('myLeaves');
    if (S.tab !== 'leave') return;
    const t = todayStr();
    view().innerHTML =
      '<form class="card" id="lf"><h3>ขอลางาน</h3>' +
      '<label class="f">ประเภท<select name="leaveType">' + Object.keys(LEAVE_TYPES).map((k) =>
        '<option value="' + k + '">' + LEAVE_TYPES[k] + '</option>').join('') + '</select></label>' +
      '<div class="grid2"><label class="f">ตั้งแต่วันที่<input type="date" name="fromDate" value="' + t + '" required></label>' +
      '<label class="f">ถึงวันที่<input type="date" name="toDate" value="' + t + '" required></label></div>' +
      '<label class="f">เหตุผล<textarea name="reason" maxlength="300" required></textarea></label>' +
      '<button class="btn primary block" type="submit">ส่งคำขอลา</button></form>' +
      '<section class="card"><h3>คำขอของฉัน</h3><div class="list" id="ll">' + (data.leaves.length ?
        data.leaves.map((l) => leaveItem(l, 'mine')).join('') : '<div class="empty">ยังไม่มีคำขอลา</div>') + '</div></section>';
    const f = $('#lf');
    f.fromDate.addEventListener('change', () => { if (f.toDate.value < f.fromDate.value) f.toDate.value = f.fromDate.value; });
    f.addEventListener('submit', (ev) => {
      ev.preventDefault();
      withBusy($('button[type=submit]', f), async () => {
        await api('leaveRequest', { leaveType: f.leaveType.value, fromDate: f.fromDate.value, toDate: f.toDate.value, reason: f.reason.value });
        toast('ส่งคำขอลาแล้ว');
        await renderLeave();
      });
    });
    $('#ll').addEventListener('click', (ev) => {
      const id = ev.target.dataset.cancel;
      if (id) withBusy(ev.target, async () => { await api('leaveCancel', { id: id }); await renderLeave(); });
    });
  }

  /* ---------- แท็บผู้จัดการ ---------- */
  async function renderAdmin() {
    const tabs = [['today', 'วันนี้'], ['leaves', 'คำขอลา'], ['staff', 'พนักงาน'], ['report', 'รายงาน'], ['settings', 'ตั้งค่า']];
    view().innerHTML = '<div class="chips" id="at">' + tabs.map((t) =>
      '<button class="chip' + (S.adminTab === t[0] ? ' on' : '') + '" data-t="' + t[0] + '">' + t[1] + '<i hidden></i></button>').join('') +
      '</div><div id="av" style="display:grid;gap:14px"></div>';
    $('#at').addEventListener('click', (ev) => {
      const b = ev.target.closest('.chip');
      if (!b) return;
      S.adminTab = b.dataset.t;
      renderAdmin().catch(fail);
    });
    const av = $('#av');
    av.innerHTML = '<div class="splash" style="min-height:30vh"><div class="spinner"></div></div>';
    const key = S.adminTab;
    const html = await { today: adminToday, leaves: adminLeaves, staff: adminStaff, report: adminReport, settings: adminSettings }[key](av);
    if (html && S.tab === 'admin' && S.adminTab === key && av.isConnected) av.innerHTML = html;
  }
  function setChipCount(tab, n) {
    const i = $('#at [data-t="' + tab + '"] i');
    if (i) { i.hidden = !n; i.textContent = n; }
  }
  const stillOn = (av, key) => S.tab === 'admin' && S.adminTab === key && av.isConnected;

  async function adminToday(av) {
    const d = await api('adminToday');
    if (!stillOn(av, 'today')) return;
    setChipCount('leaves', d.pendingLeaves);
    setChipCount('staff', d.pendingEmployees);
    const nowHm = fmtTime(now()).slice(0, 5);
    let present = 0, late = 0, away = 0, absent = 0;
    const rows = d.rows.map((r) => {
      let status;
      if (r.in) { present++; if (r.in.lateMin > 0) late++; status = recBadges(r.in) + (r.out ? recBadges(r.out) : ''); }
      else if (r.leave) { away++; status = '<span class="badge warn">' + esc(r.leave) + '</span>'; }
      else if (!r.workDay) status = '<span class="badge mute">วันหยุด</span>';
      else if (nowHm > r.employee.shiftStart) { absent++; status = '<span class="badge bad">ยังไม่เช็คอิน</span>'; }
      else status = '<span class="badge mute">ยังไม่ถึงเวลา</span>';
      const rec = r.out || r.in;
      const photo = r.in ? safeUrl(r.in.photoUrl) : '';
      return '<div class="item">' + (photo ? '<a href="' + esc(photo) + '" target="_blank" rel="noopener"><img class="thumb" src="' + esc(photo) +
        '" alt="ภาพเช็คอิน" loading="lazy" referrerpolicy="no-referrer"></a>' : avatar(r.employee.pictureUrl, 'avatar')) +
        '<div class="grow"><b>' + esc(r.employee.name) + '</b><div class="sub">กะ ' + esc(r.employee.shiftStart) + '–' + esc(r.employee.shiftEnd) +
        '</div><div class="badges">' + status + '</div>' +
        (rec ? '<div class="links"><a href="https://www.google.com/maps?q=' + rec.lat + ',' + rec.lng + '" target="_blank" rel="noopener">แผนที่</a>' +
          (r.out && safeUrl(r.out.photoUrl) ? '<a href="' + esc(safeUrl(r.out.photoUrl)) + '" target="_blank" rel="noopener">รูปตอนออก</a>' : '') +
          (rec.note ? '<span class="sub">“' + esc(rec.note) + '”</span>' : '') + '</div>' : '') +
        '</div><div class="right times">' + (r.in ? hm(r.in.time) : '--:--') + '<br>' + (r.out ? hm(r.out.time) : '--:--') + '</div></div>';
    }).join('');
    return '<div class="stats"><div class="stat"><b>' + present + '</b><span>มาแล้ว</span></div><div class="stat"><b>' + late +
      '</b><span>สาย</span></div><div class="stat"><b>' + away + '</b><span>ลา</span></div><div class="stat"><b>' + absent +
      '</b><span>ยังไม่มา</span></div></div><section class="card"><h3>' + esc(fmtDateLong(now())) + '</h3><div class="list">' +
      (rows || '<div class="empty">ยังไม่มีพนักงาน</div>') + '</div></section>';
  }

  async function adminLeaves(av) {
    const d = await api('adminLeaves');
    if (!stillOn(av, 'leaves')) return;
    const pend = d.leaves.filter((l) => l.status === 'pending');
    const rest = d.leaves.filter((l) => l.status !== 'pending').slice(0, 30);
    setChipCount('leaves', pend.length);
    av.innerHTML = '<section class="card"><h3>รออนุมัติ</h3><div class="list">' + (pend.length ? pend.map((l) => leaveItem(l, 'admin')).join('')
      : '<div class="empty">ไม่มีคำขอที่รออนุมัติ</div>') + '</div></section>' +
      (rest.length ? '<section class="card"><h3>ประวัติ</h3><div class="list">' + rest.map((l) => leaveItem(l, 'admin')).join('') + '</div></section>' : '');
    av.onclick = (ev) => {
      const b = ev.target.closest('[data-dec]');
      if (b) withBusy(b, async () => { await api('adminDecideLeave', { id: b.dataset.id, decision: b.dataset.dec }); toast('บันทึกแล้ว'); await renderAdmin(); });
    };
  }

  async function adminStaff(av) {
    const d = await api('adminEmployees');
    if (!stillOn(av, 'staff')) return;
    const order = { pending: 0, active: 1, inactive: 2 };
    const list = d.employees.slice().sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name, 'th'));
    setChipCount('staff', list.filter((e) => e.status === 'pending').length);
    av.innerHTML = '<section class="card"><div class="list">' + list.map((e, i) =>
      '<div class="item">' + avatar(e.pictureUrl, 'avatar') + '<div class="grow"><b>' + esc(e.name) + '</b><div class="sub">LINE: ' + esc(e.lineName) +
      '</div><div class="sub">กะ ' + esc(e.shiftStart) + '–' + esc(e.shiftEnd) + ' • ' + e.workDays.split('').map((n) => DAY_NAMES[n - 1]).join(' ') +
      '</div><div class="badges">' + (e.role === 'manager' ? '<span class="badge">ผู้จัดการ</span>' : '') +
      (e.status === 'pending' ? '<span class="badge warn">รออนุมัติ</span>' : e.status === 'inactive' ? '<span class="badge mute">ปิดใช้งาน</span>' : '') +
      '</div></div><div class="right">' + (e.status === 'pending' ? '<button class="btn sm in" data-approve="' + i + '">อนุมัติ</button> ' : '') +
      '<button class="btn sm" data-edit="' + i + '">แก้ไข</button></div></div>').join('') + '</div></section>';
    av.onclick = (ev) => {
      const t = ev.target;
      if (t.dataset.approve) {
        withBusy(t, async () => {
          await api('adminUpdateEmployee', { userId: list[t.dataset.approve].userId, patch: { status: 'active' } });
          toast('อนุมัติแล้ว');
          await renderAdmin();
        });
      } else if (t.dataset.edit) editEmployee(list[t.dataset.edit]);
    };
  }

  function daysInput(value) {
    return '<div class="days">' + DAY_NAMES.map((n, i) => '<label><input type="checkbox" name="wd" value="' + (i + 1) + '"' +
      (String(value).indexOf(String(i + 1)) >= 0 ? ' checked' : '') + '><span>' + n + '</span></label>').join('') + '</div>';
  }
  const daysValue = (form) => Array.from(form.querySelectorAll('[name=wd]:checked')).map((c) => c.value).join('');

  function editEmployee(e) {
    const opt = (v, label, cur) => '<option value="' + v + '"' + (v === cur ? ' selected' : '') + '>' + label + '</option>';
    const sh = openModal('<h3>แก้ไขพนักงาน</h3><form id="ef">' +
      '<label class="f">ชื่อ-นามสกุล<input type="text" name="name" maxlength="60" value="' + esc(e.name) + '" required></label>' +
      '<div class="grid2"><label class="f">ตำแหน่ง<select name="role">' + opt('staff', 'พนักงาน', e.role) + opt('manager', 'ผู้จัดการ', e.role) + '</select></label>' +
      '<label class="f">สถานะ<select name="status">' + opt('active', 'ใช้งาน', e.status) + opt('pending', 'รออนุมัติ', e.status) +
      opt('inactive', 'ปิดใช้งาน', e.status) + '</select></label></div>' +
      '<div class="grid2"><label class="f">เวลาเข้างาน<input type="time" name="shiftStart" value="' + esc(e.shiftStart) + '" required></label>' +
      '<label class="f">เวลาเลิกงาน<input type="time" name="shiftEnd" value="' + esc(e.shiftEnd) + '" required></label></div>' +
      '<div class="f" style="display:grid;gap:5px;font-size:14px;font-weight:600;margin-bottom:14px">วันทำงาน' + daysInput(e.workDays) + '</div>' +
      '<div class="row"><button class="btn" type="button" id="ec">ยกเลิก</button><button class="btn primary" type="submit">บันทึก</button></div></form>');
    $('#ec', sh).addEventListener('click', closeModal);
    $('#ef', sh).addEventListener('submit', (ev) => {
      ev.preventDefault();
      const f = ev.target;
      withBusy($('button[type=submit]', f), async () => {
        await api('adminUpdateEmployee', { userId: e.userId, patch: {
          name: f.name.value, role: f.role.value, status: f.status.value,
          shiftStart: f.shiftStart.value, shiftEnd: f.shiftEnd.value, workDays: daysValue(f),
        } });
        closeModal();
        toast('บันทึกแล้ว');
        if (e.userId === S.me.employee.userId) { await refreshMe(); renderShell(); } else await renderAdmin();
      });
    });
  }

  async function adminReport(av) {
    const d = await api('adminReport', { month: S.reportMonth });
    if (!stillOn(av, 'report')) return;
    const cols = [['scheduled', 'วันตามกะ'], ['present', 'มา'], ['late', 'สาย(ครั้ง)'], ['lateMin', 'สาย(นาที)'], ['absent', 'ขาด'], ['leave', 'ลา'],
      ['earlyOut', 'ออกก่อน'], ['noCheckout', 'ลืมออก'], ['otMin', 'OT(นาที)'], ['outside', 'นอกพื้นที่'], ['hours', 'ชม.ทำงาน']];
    av.innerHTML = monthPicker(S.reportMonth, 'rm') + '<section class="card">' + (d.rows.length ?
      '<div class="table-wrap"><table><thead><tr><th>ชื่อ</th>' + cols.map((c) => '<th>' + c[1] + '</th>').join('') + '</tr></thead><tbody>' +
      d.rows.map((r) => '<tr><td>' + esc(r.name) + '</td>' + cols.map((c) => '<td>' + esc(r[c[0]]) + '</td>').join('') + '</tr>').join('') +
      '</tbody></table></div>' : '<div class="empty">ไม่มีข้อมูลในเดือนนี้</div>') +
      (safeUrl(d.sheetUrl) ? '<p class="hint"><a href="' + esc(d.sheetUrl) + '" target="_blank" rel="noopener">เปิดรายงานใน Google Sheets</a></p>' : '') +
      '</section>';
    bindMonth('rm', 'reportMonth', () => renderAdmin().catch(fail));
  }

  async function adminSettings(av) {
    const d = await api('adminSettings');
    if (!stillOn(av, 'settings')) return;
    const s = d.settings;
    const inp = (k, label, type, hint, attrs) => '<label class="f">' + label + (hint ? '<small>' + hint + '</small>' : '') +
      '<input type="' + type + '" name="' + k + '" value="' + esc(s[k]) + '" ' + (attrs || '') + '></label>';
    const sel = (k, label, opts, hint) => '<label class="f">' + label + (hint ? '<small>' + hint + '</small>' : '') + '<select name="' + k + '">' +
      opts.map((o) => '<option value="' + o[0] + '"' + (s[k] === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label>';
    const yn = [['Y', 'ใช่'], ['N', 'ไม่']];
    av.innerHTML = '<form id="sf" style="display:grid;gap:14px">' +
      '<section class="card"><h3>ร้านและพื้นที่เช็คอิน</h3>' + inp('shop_name', 'ชื่อร้าน', 'text', '', 'maxlength="60" required') +
      '<div class="grid2">' + inp('shop_lat', 'ละติจูด', 'number', '', 'step="any" required') + inp('shop_lng', 'ลองจิจูด', 'number', '', 'step="any" required') + '</div>' +
      '<button class="btn block" type="button" id="here" style="margin-bottom:12px">📍 ใช้ตำแหน่งปัจจุบันของฉันเป็นพิกัดร้าน</button>' +
      '<div class="grid2">' + inp('radius_m', 'รัศมีที่อนุญาต (ม.)', 'number', '', 'min="20" required') +
      inp('max_accuracy_m', 'GPS คลาดเคลื่อนได้ (ม.)', 'number', '', 'min="10" required') + '</div>' +
      sel('allow_outside', 'อนุญาตให้ลงเวลานอกพื้นที่', yn, 'ถ้าใช่ พนักงานต้องระบุเหตุผลและจะถูกติดธง') + '</section>' +
      '<section class="card"><h3>กะงาน</h3>' + inp('late_grace_min', 'อนุโลมมาสาย (นาที)', 'number', '', 'min="0" required') +
      '<div class="grid2">' + inp('default_shift_start', 'เข้างาน (พนักงานใหม่)', 'time', '', 'required') +
      inp('default_shift_end', 'เลิกงาน (พนักงานใหม่)', 'time', '', 'required') + '</div>' +
      '<div class="f" style="display:grid;gap:5px;font-size:14px;font-weight:600">วันทำงาน (พนักงานใหม่)' + daysInput(s.default_work_days) + '</div></section>' +
      '<section class="card"><h3>แจ้งเตือน LINE</h3>' +
      sel('notify_mode', 'โหมดแจ้งเตือน', [['all', 'แจ้งทุกการลงเวลา'], ['exceptions', 'เฉพาะกรณีผิดปกติ'], ['off', 'ปิด']],
        'โหมด “เฉพาะกรณีผิดปกติ” ช่วยประหยัดโควตาข้อความของ LINE OA') +
      inp('notify_group_id', 'รหัสกลุ่มแจ้งเตือน', 'text', 'เชิญ LINE OA เข้ากลุ่ม แล้วพิมพ์ groupid ในกลุ่มเพื่อดูรหัส', 'maxlength="60"') +
      '<div class="grid2">' + inp('daily_summary_hour', 'สรุปรายวันเวลา (น.)', 'number', '', 'min="-1" max="23" required') +
      inp('alert_no_checkin_min', 'เตือนไม่เช็คอินหลัง (นาที)', 'number', '', 'min="0" required') + '</div>' +
      sel('photo_public_link', 'แสดงรูปในแจ้งเตือน', yn, 'ถ้าใช่ รูปจะเปิดดูได้โดยผู้ที่มีลิงก์') +
      '<button class="btn block" type="button" id="test">ส่งข้อความทดสอบเข้ากลุ่ม</button></section>' +
      '<button class="btn primary big" type="submit">บันทึกการตั้งค่า</button>' +
      (safeUrl(d.sheetUrl) ? '<p class="hint"><a href="' + esc(d.sheetUrl) + '" target="_blank" rel="noopener">เปิดข้อมูลทั้งหมดใน Google Sheets</a></p>' : '') +
      '</form>';
    const f = $('#sf');
    $('#here').addEventListener('click', (ev) => withBusy(ev.target, () => new Promise((res, rej) => {
      if (!navigator.geolocation) return rej(new Error('อุปกรณ์นี้ไม่รองรับการระบุตำแหน่ง'));
      navigator.geolocation.getCurrentPosition((p) => {
        f.shop_lat.value = p.coords.latitude.toFixed(6);
        f.shop_lng.value = p.coords.longitude.toFixed(6);
        toast('ใส่พิกัดแล้ว (±' + Math.round(p.coords.accuracy) + ' ม.) อย่าลืมกดบันทึก');
        res();
      }, () => rej(new Error('หาตำแหน่งไม่ได้ กรุณาเปิด GPS')), { enableHighAccuracy: true, timeout: 15000 });
    })));
    $('#test').addEventListener('click', (ev) => withBusy(ev.target, async () => {
      const r = await api('adminTestNotify');
      toast(r.sent ? 'ส่งข้อความทดสอบแล้ว' : 'ส่งไม่สำเร็จ: ' + r.detail, !r.sent);
    }));
    f.addEventListener('submit', (ev) => {
      ev.preventDefault();
      withBusy($('button[type=submit]', f), async () => {
        const settings = { default_work_days: daysValue(f) };
        Array.from(f.elements).forEach((el) => { if (el.name && el.name !== 'wd') settings[el.name] = el.value; });
        await api('adminSaveSettings', { settings: settings });
        await refreshMe();
        toast('บันทึกการตั้งค่าแล้ว');
      });
    });
  }

  document.addEventListener('visibilitychange', () => {
    // กลับมาที่หน้าจอหลังข้ามวัน/พักเครื่อง → โหลดสถานะล่าสุด
    if (!document.hidden && S.me && S.me.employee && S.me.employee.status === 'active' && S.tab === 'checkin' && !modalRoot.innerHTML) {
      refreshMe().then(renderCheckin).catch(() => {});
    }
  });

  boot();
})();
