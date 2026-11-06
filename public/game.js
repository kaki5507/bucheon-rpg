'use strict';
// 모바일 확대(더블탭/핀치) 막기
document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });
['gesturestart', 'gesturechange', 'gestureend'].forEach(ev => document.addEventListener(ev, e => e.preventDefault(), { passive: false }));
document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
let lastTouchEnd = 0;
document.addEventListener('touchend', e => { const t = Date.now(); if (t - lastTouchEnd < 350 && !(e.target.closest && e.target.closest('input,textarea,select'))) { e.preventDefault(); if (e.target.click && e.target.closest('button,.sk,.slot,.card,.job,.facs div')) e.target.closest('button,.sk,.slot,.card,.job,.facs div').click(); } lastTouchEnd = t; }, { passive: false });
/* ============ 기본 ============ */
const $ = s => document.querySelector(s), T = 32;
const cv = $('#c'), ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1, ZOOM = 2;
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1); W = innerWidth; H = innerHeight;
  cv.width = W * DPR; cv.height = H * DPR;
  ZOOM = Math.max(1, Math.min(2.2, Math.min(W / (18 * T), H / (12 * T))));
}
addEventListener('resize', resize); resize();
const now = () => performance.now();
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hash = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };

let D = null;          // init 데이터
let ME = null;         // 내 상세 정보
let MAP = null, mapCv = null;
const ents = new Map(); // 'p'+id / 'm'+id
let ground = [];
const fxs = [], dmgs = [];
const cds = {};
let ws = null, myId = 0, faction = '', WHO = [], EVT = 1;
const WARN = [], HZ = [];
let PLATES = { l: [], seq: null, i: 0 }, MOOD = '', SHAKE = 0, LAVA = [], SHARE = null, COUNT = 0, ROYN = 0, FLASH = 0, ZBAN = null, ZST = null, ZR = null, STAG = null;
const MARKS = {};

/* ============ 로그인 ============ */
const FACS = { sangdong: ['상동', '#ff6b6b', '🔥 빨간 망토 · 공격력 +8%'], jungdong: ['중동', '#4dabf7', '🎒 파란 백팩 · 방어력 +15%'], wonjong: ['원종', '#51cf66', '🌱 머리 새싹 · 최대 HP +12%'], yeokgok: ['역곡', '#ffd43b', '🎧 노란 헤드폰 · 이동속도 +10%'], sosa: ['소사', '#da77f2', '🐱 고양이귀 · MP +20%, 골드 +15%'] };
let pickFac = 'sangdong';
$('#facs').innerHTML = Object.entries(FACS).map(([k, [n, c]]) => `<div data-f="${k}" style="background:${c}33;color:${c}">${n}</div>`).join('');
const facDivs = [...document.querySelectorAll('#facs div')];
facDivs.forEach(d => d.onclick = () => { pickFac = d.dataset.f; facDivs.forEach(x => x.classList.toggle('on', x === d)); $('#fperk').textContent = FACS[pickFac][2]; });
const PREV_D = { WB: [{ s: 'sword' }], AB: [{ c: '#74c0fc' }], HB: [{ s: 'cap' }], RAR: [{ c: '#d0d0d0' }] };
function prevLoop() {
  const c = $('#fprev'); if (!c || $('#login').classList.contains('hidden')) return;
  const g = c.getContext('2d'), t = now(); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height);
  const keep = D; if (!D) D = PREV_D;
  [0, 2, 3, 1].forEach((d, i) => { g.setTransform(2.6, 0, 0, 2.6, 52 + i * 92, 128); drawChar(g, 0, 0, { n: 'preview', f: pickFac, d: [0, 2, 3, 1][(i + Math.floor(t / 1500)) % 4], w: [0, 0, 0], ar: [0, 0], he: [0, 0] }, t, false, true); });
  D = keep; requestAnimationFrame(prevLoop);
}
requestAnimationFrame(prevLoop);
facDivs[0].classList.add('on');
try { $('#lname').value = localStorage.getItem('bc_name') || ''; } catch (e) { }
$('#lgo').onclick = doLogin;
$('#lpw').onkeydown = e => { if (e.key === 'Enter') doLogin(); };
function doLogin() {
  const name = $('#lname').value.trim(), pw = $('#lpw').value;
  if (!name || !pw) { $('#lerr').textContent = '이름과 비밀번호를 입력하세요'; return; }
  try { localStorage.setItem('bc_name', name); } catch (e) { }
  $('#lerr').textContent = '접속 중...';
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => ws.send(JSON.stringify({ t: 'login', name, pw, faction: pickFac }));
  ws.onmessage = e => onMsg(JSON.parse(e.data));
  ws.onclose = () => {
    if (!ME) { $('#lerr').textContent = $('#lerr').textContent === '접속 중...' ? '서버에 연결할 수 없어요' : $('#lerr').textContent; return; }
    toast('연결이 끊겼어요. 다시 접속합니다...'); setTimeout(() => location.reload(), 2000);
  };
}
const send = o => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };

/* ============ 메시지 ============ */
function onMsg(m) {
  switch (m.t) {
    case 'err': $('#lerr').textContent = m.m; ws.close(); break;
    case 'need_create': $('#lerr').textContent = '진영을 골라주세요'; break;
    case 'init': D = m; break;
    case 'map': loadMap(m); break;
    case 'me': {
      const first = !ME; ME = m; myId = m.id; faction = m.faction;
      if (first) { $('#login').classList.add('hidden'); $('#game').classList.remove('hidden'); }
      updHud(m); buildSkills(); refreshPanels(); $('#admbtn').classList.toggle('hidden', !m.admin); break;
    }
    case 'v': if (ME) { Object.assign(ME, m); updHud(ME); } break;
    case 'st': onState(m); break;
    case 'fx': addFx(m); break;
    case 'dm': dmgs.push({ x: m.x, y: m.y, v: m.v, c: m.c, cr: m.cr, t: now(), ox: (Math.random() - .5) * 14 }); break;
    case 'chat': addChat(m); break;
    case 'cd': cds[m.i] = { s: now(), e: now() + m.ms }; break;
    case 'enh': toast(m.ok === 1 ? '✨ 강화 성공!' : m.ok === -1 ? '💥 펑!! 아이템이 터졌어요' : '강화 실패', m.ok === 1 ? '#ffe066' : '#ff8787'); if (m.ok === -1) { SHAKE = now() + 500; FLASH = now() + 200; } break;
    case 'jobpick': openPanel('job'); toast('🌟 1차 직업을 골라주세요!', '#ff8cff'); break;
    case 'stun': toast('💫 춤추는 중...', '#74c0fc'); break;
    case 'pk': onPoker(m); break;
    case 'dlg': showDlg(m); break;
    case 'notice': notice(m.m, m.c, m.big, m.small); if (!m.small) LOG.push(`<span style="color:${m.c || '#fff'}">${esc(m.m)}</span>`); break;
    case 'kill': killFeed(m); break;
    case 'who': WHO = m.l; ZR = m.zr || null; renderWho(); break;
    case 'evt': EVT = m.mult; $('#evbadge').classList.toggle('hidden', EVT <= 1); $('#evbadge').textContent = `🔥 경험치 ${EVT}배 이벤트`; break;
    case 'warn': WARN.push({ tiles: m.tiles, t0: now(), until: now() + m.ms, c: m.c }); break;
    case 'hz': HZ.push({ tiles: m.tiles, t0: now(), c: m.c }); break;
    case 'plates': PLATES = m; break;
    case 'share': SHARE = m.ms ? { x: m.x, y: m.y, r: m.r, until: now() + m.ms } : null; break;
    case 'mark': MARKS[m.id] = now() + m.ms; break;
    case 'count': COUNT = now() + m.ms; break;
    case 'roy': ROYN = m.st === 'idle' ? 0 : m.n; break;
    case 'mood': MOOD = m.m; break;
    case 'stag': STAG = m; break;
    case 'zev':
      if (m.st === 'start') { ZBAN = { t: now(), ms: 4500, txt: '🧟 좀비들이 몰려옵니다…', sub: `${m.min}분 동안 좀비 보스를 가장 많이 잡아라! (좀비 1점 · 좀비 킹 5점)` }; SHAKE = now() + 900; }
      else if (m.st === 'wave') ZBAN = { t: now(), ms: 2600, txt: `🧟 ${m.wave}번째 웨이브!`, sub: '좀비가 더 몰려옵니다…', small: 1 };
      else if (m.st === 'on') { ZST = Object.assign(m, { at: now() }); }
      else if (m.st === 'end') { ZST = null; ZBAN = null; }
      renderZRank(); break;
    case 'zres': showZRes(m); break;
    case 'shake': SHAKE = now() + (m.ms || 600); break;
    case 'tiles': if (MAP && mapCv) { const g = mapCv.getContext('2d'), fl = FLOOR[MAP.theme] || FLOOR.grass; for (const [x, y] of m.set) { MAP.rows[y] = MAP.rows[y].slice(0, x) + m.ch + MAP.rows[y].slice(x + 1); g.fillStyle = fl[(x + y) & 1]; g.fillRect(x * T, y * T, T, T); drawTile(g, m.ch, x * T, y * T, MAP.theme, rnd(x, y, 1)); } scanLava(); } break;
    case 'mtalk': { const e = ents.get('m' + m.id); if (e) { e.mb = m.m; e.mbT = now() + (m.loud ? 2600 : 3800); e.loud = m.loud; } const nm = e ? D.MON[e.t].n : m.n; if (nm && m.loud) addChat({ ch: 'sys', m: `💬 ${nm}: ${m.m}`, c: '#ffa8a8' }); break; }
  }
}
function onState(m) {
  const t = now(), seen = new Set();
  for (const p of m.p) {
    const k = 'p' + p.i; seen.add(k); let e = ents.get(k);
    if (!e) { e = { k, kind: 'p', rx: p.x, ry: p.y, sw: 0 }; ents.set(k, e); }
    const isMe = p.i === myId;
    if (isMe && t - lastMv < 260 && Math.abs(p.x - e.x) + Math.abs(p.y - e.y) <= 2) { const d = e.d; Object.assign(e, p, { x: e.x, y: e.y, d }); }
    else Object.assign(e, p);
    e.bb = p.bb; e.bf = p.bf || 0;
    if (Math.abs(e.rx - e.x) > 3 || Math.abs(e.ry - e.y) > 3) { e.rx = e.x; e.ry = e.y; }
  }
  for (const a of m.m) {
    const k = 'm' + a[0]; seen.add(k); let e = ents.get(k);
    if (!e) { e = { k, kind: 'm', rx: a[2], ry: a[3], sw: 0 }; ents.set(k, e); }
    Object.assign(e, { id: a[0], t: a[1], x: a[2], y: a[3], h: a[4], H: a[5], v: a[6], acc: a[7], fl: a[8], fa: a[9] });
    if (Math.abs(e.rx - e.x) > 3 || Math.abs(e.ry - e.y) > 3) { e.rx = e.x; e.ry = e.y; }
  }
  for (const k of ents.keys()) if (!seen.has(k)) ents.delete(k);
  ground = m.g;
}

/* ============ 맵 ============ */
function rnd(x, y, s) { const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return v - Math.floor(v); }
const FLOOR = { arena4: ['#1f3a5f', '#234269'], arena5: ['#4a3b1f', '#544324'], altar: ['#4c4466', '#554c70'], arena1: ['#6b8f4e', '#749957'], arena2: ['#5a3a32', '#634038'], arena3: ['#3f3a4f', '#47415a'], cave: ['#5c4b51', '#64535a'], forest: ['#4c9a52', '#55a65b'], grass: ['#7cc96a', '#86d174'], street: ['#4a4e57', '#50545d'], gym: ['#c9a27a', '#d1ab84'], hall: ['#e9e4dc', '#f3efe8'], sauna: ['#b9e6f0', '#c8eef5'], station: ['#9aa5b1', '#a3aebb'], market: ['#b08968', '#b8916f'], lake: ['#7cc96a', '#86d174'], sewer: ['#3d4a3a', '#435140'], factory: ['#5c5f66', '#63666d'], tunnel: ['#2a2a35', '#30303c'], castle: ['#3a1f2b', '#422431'], temple1: ['#16324f', '#1a3a5c'], temple2: ['#d8dde3', '#e3e7ec'], temple3: ['#5c1a1a', '#66201f'], temple4: ['#1f3530', '#243d37'], arena7: ['#2b2b2f', '#323236'], arena6: ['#e7f5ff', '#f1f8ff'], bunker: ['#3b3f45', '#41454c'], comic: ['#fff9db', '#fff3bf'], ruins: ['#6b5d4b', '#74654f'] };
function scanLava() { LAVA = []; if (!MAP) return; for (let y = 0; y < MAP.h; y++) for (let x = 0; x < MAP.w; x++) if (MAP.rows[y][x] === 'L') LAVA.push([x, y]); }
function loadMap(m) {
  MAP = m; ents.clear(); ground = []; WARN.length = 0; HZ.length = 0; PLATES = { l: [], seq: null, i: 0 }; MOOD = ''; STAG = null; setTimeout(scanLava, 0); if (typeof dlg !== 'undefined' && dlg) { dlg = null; drawDlg(); }
  $('#mapname').textContent = '📍 ' + m.name + (m.lvr && m.lvr !== '휴식' ? ' · Lv' + m.lvr : '');
  mapCv = document.createElement('canvas'); mapCv.width = m.w * T; mapCv.height = m.h * T;
  const g = mapCv.getContext('2d'), th = m.theme, floor = FLOOR[th] || FLOOR.grass;
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    const px = x * T, py = y * T, r = rnd(x, y, 1);
    g.fillStyle = floor[(x + y) & 1]; g.fillRect(px, py, T, T);
    if (th === 'grass' || th === 'forest' || th === 'lake') {
      if (r < .08) { g.fillStyle = ['#fff', '#ffd6e7', '#fff3bf', '#d0bfff'][Math.floor(r * 50) % 4]; for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(px + 10 + Math.cos(k * 1.57) * 3, py + 12 + Math.sin(k * 1.57) * 3, 2.2, 0, 7); g.fill(); } g.fillStyle = '#ffd43b'; g.beginPath(); g.arc(px + 10, py + 12, 1.6, 0, 7); g.fill(); }
      else if (r < .2) { g.strokeStyle = '#3f8f45'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(px + 18, py + 24); g.lineTo(px + 16, py + 18); g.moveTo(px + 20, py + 24); g.lineTo(px + 22, py + 17); g.stroke(); }
    } else if (th === 'cave' && r < .07) { g.fillStyle = '#8ce99a55'; g.beginPath(); g.arc(px + 16, py + 16, 3, 0, 7); g.fill(); }
    else if (th === 'street') { if (y % 8 === 4) { g.fillStyle = '#ffd43b'; g.fillRect(px + 4, py + 15, 16, 3); } if (r < .05) { g.fillStyle = '#0003'; g.beginPath(); g.ellipse(px + 16, py + 20, 8, 3, 0, 0, 7); g.fill(); } }
    else if (th === 'gym') { g.fillStyle = '#0000000f'; g.fillRect(px, py + 15, T, 1); if ((x + (y & 1) * 2) % 4 === 0) g.fillRect(px, py, 1, 16); }
    else if (th === 'hall') { if (r < .04) { g.fillStyle = '#a61e4d22'; g.fillRect(px + 2, py + 2, 28, 28); } }
    else if (th && th.startsWith('arena') || th === 'altar') { g.strokeStyle = '#ffffff10'; g.lineWidth = 1; g.strokeRect(px + .5, py + .5, T - 1, T - 1); if (th === 'arena2' && r < .06) { g.fillStyle = '#ff6b0055'; g.beginPath(); g.ellipse(px + 16, py + 16, 9, 5, 0, 0, 7); g.fill(); } if (th === 'arena1' && r < .1) { g.fillStyle = '#ffffff55'; g.beginPath(); g.arc(px + 12, py + 14, 2, 0, 7); g.fill(); } }
    else if (th === 'station') { g.strokeStyle = '#ffffff22'; g.lineWidth = 1; g.strokeRect(px + .5, py + .5, T - 1, T - 1); if (y % 10 === 5) { g.fillStyle = '#fab005'; g.fillRect(px, py + 12, T, 8); g.fillStyle = '#e67700'; for (let k = 0; k < 4; k++) g.fillRect(px + 3 + k * 8, py + 14, 3, 4); } }
    else if (th === 'market') { if (r < .06) { g.fillStyle = '#0002'; g.beginPath(); g.ellipse(px + 16, py + 18, 9, 4, 0, 0, 7); g.fill(); } if (x % 12 === 6) { g.fillStyle = '#ffffff18'; g.fillRect(px, py, T, T); } }
    else if (th === 'sewer') { if (r < .1) { g.fillStyle = '#94d82d33'; g.beginPath(); g.ellipse(px + 16, py + 18, 10, 5, 0, 0, 7); g.fill(); } g.fillStyle = '#0002'; g.fillRect(px, py + 30, T, 2); }
    else if (th === 'factory') { g.strokeStyle = '#0003'; g.lineWidth = 1; g.strokeRect(px + .5, py + .5, T - 1, T - 1); if (r < .04) { g.fillStyle = '#111a'; g.beginPath(); g.ellipse(px + 16, py + 18, 11, 6, 0, 0, 7); g.fill(); } if (y % 9 === 4) { g.fillStyle = (x & 1) ? '#fab005' : '#212529'; g.fillRect(px, py + 13, T, 6); } }
    else if (th === 'tunnel') { if (y % 6 === 3) { g.fillStyle = '#5c4b51'; for (let k = 0; k < 4; k++) g.fillRect(px + k * 8 + 1, py + 6, 5, 20); g.fillStyle = '#adb5bd'; g.fillRect(px, py + 9, T, 2); g.fillRect(px, py + 21, T, 2); } else if (r < .05) { g.fillStyle = '#7048e833'; g.beginPath(); g.arc(px + 16, py + 16, 4, 0, 7); g.fill(); } }
    else if (th === 'castle') { g.strokeStyle = '#00000044'; g.lineWidth = 1; g.strokeRect(px + .5, py + .5, T - 1, T - 1); if (r < .05) { g.fillStyle = '#e0313133'; g.beginPath(); g.ellipse(px + 16, py + 16, 9, 5, 0, 0, 7); g.fill(); } if (y % 10 === 5) { g.fillStyle = '#7a0f1f'; g.fillRect(px, py + 4, T, T - 8); } }
    else if (th && th.startsWith('temple')) { g.strokeStyle = '#ffffff14'; g.lineWidth = 1; g.strokeRect(px + .5, py + .5, T - 1, T - 1); if (r < .05) { g.fillStyle = { temple1: '#74c0fc33', temple2: '#ffffff55', temple3: '#ff6b0033', temple4: '#3bc9db33' }[th]; g.beginPath(); g.arc(px + 16, py + 16, 4, 0, 7); g.fill(); } }
    else if (th === 'arena6') { g.strokeStyle = '#a5d8ff55'; g.lineWidth = 1; g.strokeRect(px + .5, py + .5, T - 1, T - 1); if (r < .1) { g.fillStyle = '#fff'; g.fillRect(px + 8 + r * 80, py + 12, 2, 2); } }
    else if (th === 'bunker') { g.strokeStyle = '#0004'; g.lineWidth = 1; g.strokeRect(px + .5, py + .5, T - 1, T - 1); if (r < .05) { g.fillStyle = ['#f783ac55', '#74c0fc55', '#ffd43b55'][Math.floor(r * 60) % 3]; g.fillRect(px + 6, py + 6, 20, 20); } }
    else if (th === 'comic') { g.strokeStyle = '#21252922'; g.lineWidth = 2; if (x % 6 === 0) { g.beginPath(); g.moveTo(px, py); g.lineTo(px, py + T); g.stroke(); } if (y % 5 === 0) { g.beginPath(); g.moveTo(px, py); g.lineTo(px + T, py); g.stroke(); } if (r < .04) { g.fillStyle = '#21252955'; for (let k = 0; k < 9; k++) g.fillRect(px + 4 + (k % 3) * 9, py + 4 + (k / 3 | 0) * 9, 3, 3); } }
    else if (th === 'ruins') { if (r < .08) { g.strokeStyle = '#3b2f2033'; g.lineWidth = 1; g.beginPath(); g.moveTo(px + 4, py + 10); g.lineTo(px + 16, py + 18); g.lineTo(px + 26, py + 12); g.stroke(); } if (r > .95) { g.fillStyle = '#20c99733'; g.beginPath(); g.arc(px + 16, py + 16, 5, 0, 7); g.fill(); } }
    else if (th === 'sauna') { g.strokeStyle = '#ffffff88'; g.lineWidth = 1; g.strokeRect(px + .5, py + .5, T - 1, T - 1); }
    drawTile(g, m.rows[y][x], px, py, th, r);
  }
  if (th === 'hall') { g.fillStyle = '#c92a2a'; g.fillRect(0, (m.h / 2 | 0) * T + 4, m.w * T, T - 8); g.fillStyle = '#ffd43b'; g.fillRect(0, (m.h / 2 | 0) * T + 4, m.w * T, 2); g.fillRect(0, (m.h / 2 | 0) * T + T - 6, m.w * T, 2); }
  for (const z of m.safes || []) {
    if (!z.all) {
      const fc = z.f && FACS[z.f] ? FACS[z.f][1] : '#ffffff';
      g.fillStyle = fc + '33'; g.fillRect(z.x0 * T, z.y0 * T, (z.x1 - z.x0 + 1) * T, (z.y1 - z.y0 + 1) * T);
      g.strokeStyle = fc + 'cc'; g.setLineDash([6, 5]); g.lineWidth = 2; g.strokeRect(z.x0 * T, z.y0 * T, (z.x1 - z.x0 + 1) * T, (z.y1 - z.y0 + 1) * T); g.setLineDash([]);
    }
    const all = z.all, txt = z.label || '🕊️ 안전지대', tx = all ? m.w * T / 2 : (z.x0 + z.x1 + 1) / 2 * T, ty = all ? T * 1.7 : z.y1 * T + 26;
    g.font = '15px Jua'; g.textAlign = 'center'; g.fillStyle = '#0008'; g.fillText(txt, tx + 1, ty + 1); g.fillStyle = '#fff'; g.fillText(txt, tx, ty);
    if (!all) { g.font = '10px Jua'; g.fillStyle = '#fffc'; g.fillText('PvP 불가', tx, ty + 13); }
  }
}
function drawTile(g, c, px, py, th, r) {
  const sh = (w = 12) => { g.fillStyle = '#0003'; g.beginPath(); g.ellipse(px + 16, py + 27, w, 4, 0, 0, 7); g.fill(); };
  switch (c) {
    case 't': drawTree(g, px, py, th); break;
    case 'r': sh(); g.fillStyle = th === 'cave' ? '#8a7a80' : '#adb5bd'; g.beginPath(); g.ellipse(px + 16, py + 18, 12, 10, 0, 0, 7); g.fill(); g.fillStyle = '#fff6'; g.beginPath(); g.ellipse(px + 12, py + 14, 4, 3, 0, 0, 7); g.fill(); break;
    case 'w': if (th === 'sewer') { g.fillStyle = '#5c7a2c'; g.fillRect(px, py, T, T); g.fillStyle = '#94d82d88'; g.fillRect(px + 5 + r * 10, py + 10, 8, 2); g.beginPath(); g.arc(px + 20, py + 22 - r * 6, 2, 0, 7); g.fill(); break; } g.fillStyle = '#4dabf7'; g.fillRect(px, py, T, T); g.fillStyle = '#a5d8ff'; g.fillRect(px + 5 + r * 10, py + 10, 8, 2); g.fillRect(px + 14, py + 22 - r * 6, 9, 2); break;
    case '#': g.fillStyle = '#3b2c35'; g.fillRect(px, py, T, T); g.fillStyle = '#4e3b47'; g.fillRect(px + 2, py + 2, T - 4, T - 10); g.fillStyle = '#2a1f26'; g.fillRect(px, py + T - 6, T, 6); break;
    case 'Y': { sh(15); g.fillStyle = '#fff4e6'; g.fillRect(px + 4, py + 12, 24, 16); g.fillStyle = ['#e03131', '#1c7ed6', '#2f9e44', '#f08c00', '#9c36b5'][(px / T * 7 + py / T) % 5 | 0]; g.beginPath(); g.moveTo(px, py + 14); g.lineTo(px + 16, py + 1); g.lineTo(px + 32, py + 14); g.fill(); g.fillStyle = '#8d5a3b'; g.fillRect(px + 13, py + 19, 7, 9); g.fillStyle = '#74c0fc'; g.fillRect(px + 6, py + 16, 5, 5); g.fillRect(px + 22, py + 16, 5, 5); break; }
    case 'L': { g.fillStyle = '#c92a2a'; g.fillRect(px, py, T, T); g.fillStyle = '#ff6b00'; g.fillRect(px + 2, py + 2, T - 4, T - 4); g.fillStyle = '#ffd43b'; g.beginPath(); g.ellipse(px + 10 + r * 10, py + 12, 5, 3, r, 0, 7); g.ellipse(px + 20, py + 22 - r * 6, 4, 2.5, 0, 0, 7); g.fill(); g.strokeStyle = '#7a1a00'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(px + 4, py + 28); g.lineTo(px + 14, py + 18); g.lineTo(px + 26, py + 26); g.stroke(); break; }
    case 'V': { g.fillStyle = '#05030a'; g.fillRect(px, py, T, T); g.fillStyle = '#2b1d4a'; g.fillRect(px, py, T, 3); g.fillStyle = '#1a1030'; g.fillRect(px + 4 + r * 10, py + 10, 3, 3); break; }
    case 'W': { const lava = th === 'arena2' || th === 'castle', WP = { temple1: ['#0b2540', '#16406b'], temple2: ['#868e96', '#ced4da'], temple3: ['#3b0d0d', '#6b1a1a'], temple4: ['#0b2b26', '#1d4a40'], arena7: ['#1a1a1d', '#5c1a1a'], arena6: ['#74c0fc', '#d0ebff'] }[th] || (lava ? ['#3b1f1a', '#5c2c22'] : ['#2b2540', '#3d3459']); g.fillStyle = WP[0]; g.fillRect(px, py, T, T); g.fillStyle = WP[1]; g.fillRect(px + 2, py + 2, 13, 12); g.fillRect(px + 17, py + 2, 13, 12); g.fillRect(px + 9, py + 17, 14, 12); if (lava && r < .3) { g.fillStyle = '#ff6b00aa'; g.fillRect(px + 4, py + 26, 24, 3); } break; }
    case 'X': g.strokeStyle = '#00000018'; g.lineWidth = 1; g.beginPath(); g.moveTo(px + 9, py + 11); g.lineTo(px + 15, py + 17); g.lineTo(px + 13, py + 23); g.stroke(); break;
    case 'D': { g.fillStyle = '#5c3d2e'; g.fillRect(px, py, T, T); g.fillStyle = '#fab005'; g.fillRect(px, py + 2, T, 4); g.fillRect(px, py + T - 6, T, 4); g.fillStyle = '#c92a2a'; rr(g, px + 7, py + 8, 18, 16, 3); g.fill(); g.fillStyle = '#ffe066'; g.font = 'bold 12px serif'; g.textAlign = 'center'; g.fillText('封', px + 16, py + 21); break; }
    // 술집거리
    case 'B': { g.fillStyle = ['#5c3d6e', '#3d4f6e', '#6e3d48'][(px / T + py / T) % 3 | 0]; g.fillRect(px, py, T, T); g.fillStyle = r < .5 ? '#ffe066' : '#ffa8a8'; g.fillRect(px + 5, py + 6, 8, 8); g.fillRect(px + 19, py + 6, 8, 8); g.fillStyle = '#0004'; g.fillRect(px, py + T - 5, T, 5); break; }
    case 'p': sh(14); g.fillStyle = '#ff6b6b'; g.beginPath(); g.moveTo(px + 2, py + 12); g.lineTo(px + 16, py + 2); g.lineTo(px + 30, py + 12); g.fill(); g.fillStyle = '#fff'; for (let k = 0; k < 4; k++) g.fillRect(px + 4 + k * 7, py + 10, 3, 3); g.fillStyle = '#e03131'; g.fillRect(px + 6, py + 16, 20, 4); g.fillStyle = '#c92a2a'; g.fillRect(px + 8, py + 20, 2, 7); g.fillRect(px + 22, py + 20, 2, 7); g.fillStyle = '#69db7c'; g.fillRect(px + 13, py + 10, 3, 6); break;
    case 'b': sh(); g.fillStyle = '#fab005'; g.fillRect(px + 6, py + 12, 20, 14); g.fillStyle = '#e67700'; g.fillRect(px + 6, py + 12, 20, 3); g.fillStyle = '#2b8a3e'; for (let k = 0; k < 4; k++) g.fillRect(px + 8 + k * 5, py + 5, 3, 8); break;
    case 'n': sh(6); g.fillStyle = '#495057'; g.fillRect(px + 15, py + 12, 3, 16); g.save(); g.shadowColor = '#f783ac'; g.shadowBlur = 8; g.fillStyle = '#212529'; rr(g, px + 3, py + 2, 26, 12, 3); g.fill(); g.font = '9px Jua'; g.textAlign = 'center'; g.fillStyle = ['#f783ac', '#74c0fc', '#ffe066'][r * 3 | 0]; g.fillText(['호프', '포차', '노래방'][r * 3 | 0], px + 16, py + 11); g.restore(); break;
    // 헬스장
    case 'G': g.fillStyle = '#495057'; g.fillRect(px, py, T, T); g.fillStyle = '#868e96'; g.fillRect(px, py + 22, T, 4); g.fillStyle = '#ff6b6b'; if (r < .3) { g.font = '9px Jua'; g.textAlign = 'center'; g.fillText('D8', px + 16, py + 14); } break;
    case 'm': sh(14); g.fillStyle = '#343a40'; rr(g, px + 3, py + 14, 26, 9, 3); g.fill(); g.fillStyle = '#495057'; g.fillRect(px + 22, py + 4, 4, 12); g.fillStyle = '#74c0fc'; g.fillRect(px + 20, py + 3, 8, 4); g.fillStyle = '#212529'; g.fillRect(px + 5, py + 16, 16, 2); break;
    case 'd': sh(); g.fillStyle = '#868e96'; g.fillRect(px + 4, py + 10, 24, 3); g.fillRect(px + 4, py + 19, 24, 3); g.fillStyle = '#212529'; for (let k = 0; k < 3; k++) { g.fillRect(px + 6 + k * 8, py + 6, 4, 9); g.fillRect(px + 6 + k * 8, py + 15, 4, 9); } break;
    case 'k': sh(14); g.fillStyle = th === 'hall' ? '#8d5a3b' : th === 'sauna' ? '#d9a066' : '#c92a2a'; rr(g, px + 3, py + 12, 26, 10, 2); g.fill(); g.fillStyle = '#0003'; g.fillRect(px + 5, py + 22, 3, 5); g.fillRect(px + 24, py + 22, 3, 5); if (th === 'hall') { g.fillStyle = '#fff'; g.fillRect(px + 8, py + 9, 7, 5); g.fillStyle = '#4dabf7'; g.fillRect(px + 18, py + 7, 7, 6); } break;
    // 시청
    case 'H': g.fillStyle = '#ced4da'; g.fillRect(px, py, T, T); g.fillStyle = '#adb5bd'; g.fillRect(px, py + 24, T, 8); g.fillStyle = '#74c0fc88'; g.fillRect(px + 6, py + 5, 20, 13); break;
    case 'c': sh(10); g.fillStyle = '#f8f9fa'; g.fillRect(px + 9, py + 2, 14, 26); g.fillStyle = '#dee2e6'; g.fillRect(px + 7, py, 18, 4); g.fillRect(px + 7, py + 26, 18, 3); g.fillStyle = '#e9ecef'; g.fillRect(px + 12, py + 4, 2, 22); g.fillRect(px + 18, py + 4, 2, 22); break;
    case 'f': sh(8); g.fillStyle = '#c08552'; g.beginPath(); g.moveTo(px + 9, py + 18); g.lineTo(px + 23, py + 18); g.lineTo(px + 21, py + 28); g.lineTo(px + 11, py + 28); g.fill(); g.fillStyle = '#40c057'; for (let k = 0; k < 5; k++) { g.beginPath(); g.ellipse(px + 16 + Math.cos(k * 1.3) * 6, py + 11 + Math.sin(k * 1.3) * 4, 5, 3, k, 0, 7); g.fill(); } break;
    // 사우나
    case 'S': g.fillStyle = '#e3fafc'; g.fillRect(px, py, T, T); g.strokeStyle = '#99e9f2'; g.strokeRect(px + .5, py + .5, T - 1, T - 1); g.fillStyle = '#c5f6fa'; g.fillRect(px, py + 24, T, 8); break;
    case 'h': { g.fillStyle = '#ffffff'; g.fillRect(px, py, T, T); g.fillStyle = '#3bc9db'; g.fillRect(px + 2, py + 2, T - 4, T - 4); g.fillStyle = '#99e9f2'; g.fillRect(px + 6 + r * 8, py + 10, 8, 2); g.fillStyle = '#ffffffaa'; g.font = '13px sans-serif'; g.textAlign = 'center'; g.fillText('♨', px + 16, py + 24); break; }
  }
}
function drawTree(g, px, py, th) {
  g.fillStyle = '#0003'; g.beginPath(); g.ellipse(px + 16, py + 28, 13, 4, 0, 0, 7); g.fill();
  g.fillStyle = '#8d5a3b'; g.fillRect(px + 13, py + 17, 6, 11);
  g.fillStyle = th === 'forest' ? '#2b8a3e' : '#40c057'; g.beginPath(); g.arc(px + 16, py + 12, 13, 0, 7); g.fill();
  g.fillStyle = th === 'forest' ? '#37b24d' : '#69db7c'; g.beginPath(); g.arc(px + 12, py + 8, 6, 0, 7); g.fill();
  if (rnd(px, py, 3) < .3) { g.fillStyle = '#ff6b6b'; g.beginPath(); g.arc(px + 21, py + 14, 2.5, 0, 7); g.arc(px + 9, py + 17, 2.5, 0, 7); g.fill(); }
}

/* ============ 그리기: 캐릭터 ============ */
const SKIN = ['#ffe0c7', '#ffd5b5', '#f6c9a8'], HAIR = ['#3b2a20', '#1a1a1a', '#8d5a3b', '#f0c36d', '#c2410c', '#6741d9', '#e64980'];
const rarC = r => D ? D.RAR[r].c : '#ccc';
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
// 손 위치 원점, 위쪽(-y)으로 뻗은 무기
function drawWeapon(g, s, r, plus, t) {
  const rc = rarC(r), metal = r >= 2 ? rc : '#dee2e6';
  g.save();
  if (r >= 5) { g.shadowColor = '#ffe600'; g.shadowBlur = 10 + Math.sin(t / 150) * 5; }
  else if (r >= 3) { g.shadowColor = rc; g.shadowBlur = 6; }
  else if (plus >= 7) { g.shadowColor = '#fff'; g.shadowBlur = 6; }
  g.lineCap = 'round';
  switch (s) {
    case 'sword': g.fillStyle = '#8d5a3b'; g.fillRect(-1.5, -2, 3, 6); g.fillStyle = '#ffd43b'; g.fillRect(-5, -4, 10, 2.5); g.fillStyle = metal; g.beginPath(); g.moveTo(-2.5, -4); g.lineTo(2.5, -4); g.lineTo(2.5, -19); g.lineTo(0, -23); g.lineTo(-2.5, -19); g.fill(); break;
    case 'pan': g.strokeStyle = '#5c3d2e'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 4); g.lineTo(0, -8); g.stroke(); g.fillStyle = r >= 2 ? rc : '#343a40'; g.beginPath(); g.arc(0, -15, 8, 0, 7); g.fill(); g.fillStyle = '#ffffff33'; g.beginPath(); g.arc(-2, -17, 3, 0, 7); g.fill(); break;
    case 'bat': g.fillStyle = r >= 2 ? rc : '#c08552'; g.beginPath(); g.moveTo(-1.5, 4); g.lineTo(1.5, 4); g.lineTo(4, -20); g.arc(0, -20, 4, 0, Math.PI, true); g.closePath(); g.fill(); break;
    case 'bow': g.strokeStyle = r >= 2 ? rc : '#a0522d'; g.lineWidth = 3; g.beginPath(); g.arc(-6, -8, 13, -1.1, 1.1); g.stroke(); g.strokeStyle = '#fff'; g.lineWidth = 1; g.beginPath(); g.moveTo(-6 + 13 * Math.cos(-1.1), -8 + 13 * Math.sin(-1.1)); g.lineTo(-6 + 13 * Math.cos(1.1), -8 + 13 * Math.sin(1.1)); g.stroke(); break;
    case 'staff': g.strokeStyle = '#8d5a3b'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 5); g.lineTo(0, -18); g.stroke(); g.fillStyle = r >= 1 ? rc : '#74c0fc'; g.beginPath(); g.arc(0, -21, 5, 0, 7); g.fill(); g.fillStyle = '#fff9'; g.beginPath(); g.arc(-1.5, -22.5, 1.8, 0, 7); g.fill(); break;
    case 'spear': g.strokeStyle = '#8d5a3b'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(0, 8); g.lineTo(0, -22); g.stroke(); g.fillStyle = metal; g.beginPath(); g.moveTo(-3.5, -21); g.lineTo(3.5, -21); g.lineTo(0, -30); g.fill(); break;
    case 'axe': g.strokeStyle = '#8d5a3b'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 5); g.lineTo(0, -18); g.stroke(); g.fillStyle = metal; g.beginPath(); g.moveTo(0, -18); g.quadraticCurveTo(11, -22, 10, -10); g.quadraticCurveTo(6, -12, 0, -11); g.fill(); break;
    case 'pen': g.fillStyle = '#4c6ef5'; rr(g, -1.6, -22, 3.2, 24, 1.5); g.fill(); g.fillStyle = '#fff'; g.fillRect(-1.6, -16, 3.2, 6); g.fillStyle = '#212529'; g.font = '3px sans-serif'; g.fillStyle = '#adb5bd'; g.beginPath(); g.moveTo(-1.6, 2); g.lineTo(1.6, 2); g.lineTo(0, 6); g.fill(); g.fillStyle = '#364fc7'; g.fillRect(-1, -26, 2, 4); g.fillStyle = '#ced4da'; g.fillRect(1.6, -21, 1.2, 8); break;
    case 'mic': g.fillStyle = '#212529'; rr(g, -2, -12, 4, 14, 2); g.fill(); g.fillStyle = '#ced4da'; g.beginPath(); g.arc(0, -15, 5, 0, 7); g.fill(); g.strokeStyle = '#868e96'; g.lineWidth = .8; for (let k = -1; k <= 1; k++) { g.beginPath(); g.moveTo(-4, -15 + k * 2.5); g.lineTo(4, -15 + k * 2.5); g.stroke(); } g.fillStyle = '#ff6b6b'; g.fillRect(-2, -5, 4, 2); break;
    case 'hwang': { const sh = Math.sin(t / 250); g.save(); g.shadowColor = '#ffd43b'; g.shadowBlur = 16 + sh * 6;
      const gr = g.createLinearGradient(-4, 0, 4, 0); gr.addColorStop(0, '#e67700'); gr.addColorStop(.5, '#fff3bf'); gr.addColorStop(1, '#fab005'); g.fillStyle = gr; g.beginPath(); g.moveTo(-3.5, -6); g.lineTo(-3, -38); g.lineTo(0, -46); g.lineTo(3, -38); g.lineTo(3.5, -6); g.fill(); g.restore();
      g.fillStyle = '#fab005'; g.beginPath(); g.moveTo(-11, -9); g.quadraticCurveTo(-6, -4, 0, -6); g.quadraticCurveTo(6, -4, 11, -9); g.lineTo(8, -4); g.lineTo(0, -2); g.lineTo(-8, -4); g.closePath(); g.fill();
      g.fillStyle = '#c92a2a'; g.fillRect(-1.6, -4, 3.2, 10); g.fillStyle = '#e03131'; g.beginPath(); g.arc(0, -6, 2, 0, 7); g.fill(); g.fillStyle = '#fff'; for (let k = 0; k < 3; k++) { g.globalAlpha = .5 + .5 * Math.sin(t / 150 + k * 2); g.fillRect(-1 + Math.sin(t / 300 + k) * 4, -14 - k * 10, 2, 2); } g.globalAlpha = 1; break; }
    case 'zstaff': { g.strokeStyle = '#3b2c35'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 6); g.quadraticCurveTo(3, -8, -1, -19); g.stroke();
      g.save(); g.shadowColor = '#69db7c'; g.shadowBlur = 12 + Math.sin(t / 200) * 5; g.fillStyle = '#e9ecef'; g.beginPath(); g.arc(-1, -25, 6, 0, 7); g.fill(); rr(g, -5, -21, 8, 4, 1); g.fill();
      g.fillStyle = '#2b8a3e'; g.beginPath(); g.arc(-3.2, -25.5, 1.7, 0, 7); g.arc(1.2, -25.5, 1.7, 0, 7); g.fill(); g.fillStyle = '#b2f2bb'; g.beginPath(); g.arc(-3.2, -25.5, .7, 0, 7); g.arc(1.2, -25.5, .7, 0, 7); g.fill(); g.restore();
      g.fillStyle = '#212529'; for (let k = 0; k < 3; k++) g.fillRect(-4 + k * 2.4, -20, 1, 2);
      g.fillStyle = '#94d82d'; for (let k = 0; k < 4; k++) { const a = t / 350 + k * 1.57; g.globalAlpha = .45 + .4 * Math.sin(t / 160 + k); g.beginPath(); g.arc(-1 + Math.cos(a) * 10, -26 + Math.sin(a) * 6, 1.6, 0, 7); g.fill(); } g.globalAlpha = 1;
      break; }
    case 'tuna': { const sh = Math.sin(t / 300);
      g.save(); g.shadowColor = '#a5d8ff'; g.shadowBlur = 12 + sh * 4;
      g.fillStyle = '#5c7cfa'; g.beginPath(); g.moveTo(0, -46); g.lineTo(-9, -54); g.lineTo(-2, -44); g.lineTo(2, -44); g.lineTo(9, -54); g.closePath(); g.fill();
      const gr = g.createLinearGradient(-8, 0, 8, 0); gr.addColorStop(0, '#364fc7'); gr.addColorStop(.45, '#a5d8ff'); gr.addColorStop(1, '#e7f5ff'); g.fillStyle = gr;
      g.beginPath(); g.moveTo(0, 6); g.quadraticCurveTo(-10, -4, -8, -22); g.quadraticCurveTo(-6, -38, 0, -45); g.quadraticCurveTo(6, -38, 8, -22); g.quadraticCurveTo(10, -4, 0, 6); g.fill();
      g.restore();
      g.fillStyle = '#1c3d7a'; g.beginPath(); g.moveTo(-3, -40); g.quadraticCurveTo(-6, -20, -4, 0); g.lineTo(-2, 0); g.quadraticCurveTo(-3, -20, -1, -40); g.fill();
      g.fillStyle = '#ffd43b'; for (let k = 0; k < 5; k++) { g.beginPath(); g.moveTo(7, -30 + k * 5); g.lineTo(10, -28 + k * 5); g.lineTo(7, -26 + k * 5); g.fill(); }
      g.fillStyle = '#fff'; g.beginPath(); g.arc(2, -1, 2.2, 0, 7); g.fill(); g.fillStyle = '#111'; g.beginPath(); g.arc(2.4, -1, 1.1, 0, 7); g.fill();
      g.strokeStyle = '#ffffffcc'; g.lineWidth = 1; for (let k = 0; k < 4; k++) { const yy = -8 - k * 9; g.beginPath(); g.moveTo(-5, yy); g.lineTo(-2, yy - 3); g.lineTo(1, yy); g.stroke(); }
      g.fillStyle = '#ffffff'; for (let k = 0; k < 3; k++) { const a = t / 400 + k * 2.1; g.globalAlpha = .6 + .4 * Math.sin(t / 150 + k); g.font = '7px sans-serif'; g.fillText('❄', Math.cos(a) * 12 - 3, -24 + Math.sin(a) * 18); } g.globalAlpha = 1;
      break; }
    case 'great': g.fillStyle = '#5c3d2e'; g.fillRect(-2, -2, 4, 7); g.fillStyle = '#ffd43b'; g.fillRect(-7, -5, 14, 3); g.fillStyle = metal; g.beginPath(); g.moveTo(-4, -5); g.lineTo(4, -5); g.lineTo(4, -25); g.lineTo(0, -30); g.lineTo(-4, -25); g.fill(); g.fillStyle = '#ffffff55'; g.fillRect(-1, -25, 2, 19); break;
  }
  g.restore();
  if (plus >= 5) { g.fillStyle = r >= 5 ? '#ffe600' : '#fff'; for (let i = 0; i < Math.min(4, plus / 3); i++) { const a = t / 300 + i * 2; g.globalAlpha = .5 + .5 * Math.sin(t / 120 + i); g.fillRect(Math.cos(a) * 6 - 1, -14 + Math.sin(a) * 10 - 1, 2.5, 2.5); } g.globalAlpha = 1; }
}
const FCOL = { sangdong: ['#ff8787', '#e03131'], jungdong: ['#74c0fc', '#1c7ed6'], wonjong: ['#8ce99a', '#2f9e44'], yeokgok: ['#ffe066', '#f08c00'], sosa: ['#e599f7', '#9c36b5'] };
function drawHelm(g, s, r, hx, hy, t, f) {
  const rc = rarC(r);
  g.save(); if (r >= 5) { g.shadowColor = '#ffe600'; g.shadowBlur = 8; }
  switch (s) {
    case 'cap': g.fillStyle = r >= 2 ? rc : (FCOL[f] ? FCOL[f][1] : '#e03131'); g.beginPath(); g.arc(hx, hy - 3, 11.5, Math.PI, 0); g.fill(); g.fillRect(hx - 2, hy - 4, 15, 3); break;
    case 'beanie': g.fillStyle = r >= 2 ? rc : '#f783ac'; g.beginPath(); g.arc(hx, hy - 3, 11.5, Math.PI, 0); g.fill(); g.fillStyle = '#fff'; g.fillRect(hx - 12, hy - 5, 24, 4); g.beginPath(); g.arc(hx, hy - 16, 3.5, 0, 7); g.fill(); break;
    case 'helm': g.fillStyle = r >= 2 ? rc : '#adb5bd'; g.beginPath(); g.arc(hx, hy - 2, 12.5, Math.PI, 0); g.fill(); g.fillStyle = '#868e96'; g.fillRect(hx - 13, hy - 3, 26, 3); g.fillStyle = '#e03131'; g.fillRect(hx - 1.5, hy - 19, 3, 6); break;
    case 'wiz': g.fillStyle = r >= 2 ? rc : '#7048e8'; g.beginPath(); g.moveTo(hx - 14, hy - 4); g.lineTo(hx + 14, hy - 4); g.lineTo(hx + 3, hy - 28); g.fill(); g.fillStyle = '#ffe066'; g.font = '8px sans-serif'; g.fillText('★', hx - 3, hy - 10); break;
    case 'crown': g.fillStyle = r >= 2 ? rc : '#fcc419'; g.beginPath(); g.moveTo(hx - 9, hy - 7); g.lineTo(hx - 9, hy - 16); g.lineTo(hx - 4.5, hy - 11); g.lineTo(hx, hy - 18); g.lineTo(hx + 4.5, hy - 11); g.lineTo(hx + 9, hy - 16); g.lineTo(hx + 9, hy - 7); g.fill(); g.fillStyle = '#e64980'; g.beginPath(); g.arc(hx, hy - 10, 1.8, 0, 7); g.fill(); break;
  }
  g.restore();
}
// look: {n,j,f,w:[b,r,plus],ar:[b,r],he:[b,r],d}
function drawChar(g, cx, cy, e, t, moving, big) {
  const d = e.d || 0, h = hash(e.n || 'x'), skin = e.skin || SKIN[h % 3], hair = e.hair || HAIR[h % HAIR.length];
  const bob = moving ? Math.abs(Math.sin(t / 80)) * 2 : Math.sin(t / 400) * .6;
  const armor = e.ar ? D.AB[e.ar[0]] : null, bodyC = e.cardigan ? e.cardigan : armor ? (e.ar[0] === 0 && e.ar[1] < 2 && FCOL[e.f] ? FCOL[e.f][0] : armor.c) : '#f8f9fa', trim = e.ar ? rarC(e.ar[1]) : '#ced4da';
  const ws = e.ws || (e.w ? D.WB[e.w[0]].s : null);
  const swing = e.sw && t - e.sw < 220 ? Math.sin((t - e.sw) / 220 * Math.PI) : 0;
  g.save(); g.translate(cx, cy);
  if (!big) { g.fillStyle = '#0004'; g.beginPath(); g.ellipse(0, 0, 11, 4, 0, 0, 7); g.fill(); }
  if (e.f && !big) { g.strokeStyle = (FACS[e.f] || [, '#fff'])[1]; g.lineWidth = 2; g.beginPath(); g.ellipse(0, 0, 13, 5, 0, 0, 7); g.stroke(); }
  // 버프 오라
  if (e.bf & 1) { g.fillStyle = '#ff6b6b33'; g.beginPath(); g.ellipse(0, -16, 17 + Math.sin(t / 100) * 2, 22, 0, 0, 7); g.fill(); }
  if (e.bf & 2) { g.strokeStyle = '#74c0fcaa'; g.lineWidth = 2; g.beginPath(); g.arc(0, -16, 19, 0, 7); g.stroke(); }
  if (e.mt) { g.save(); if (d === 1) g.scale(-1, 1); if (d === 0 || d === 3) g.scale(.92, 1); drawDog(g, t, moving, false); g.restore(); g.translate(0, -15); }
  g.translate(0, -bob);
  const hand = d === 1 ? [-10, -12] : [10, -12];
  const drawW = () => { if (!ws) return; g.save(); g.translate(hand[0], hand[1]); g.rotate((d === 1 ? -1 : 1) * (0.35 + swing * 1.4)); drawWeapon(g, ws, e.w[1], e.w[2] || 0, t); g.restore(); };
  if (d === 3) drawW();
  const F = e.f;
  if (e.cape && d !== 3) { const sw = Math.sin(t / 220) * 2; g.fillStyle = e.cape[0]; g.beginPath(); g.moveTo(-10, -20); g.lineTo(10, -20); g.lineTo(16 + sw, 0); g.lineTo(-16 + sw, 0); g.fill(); g.fillStyle = e.cape[1]; g.beginPath(); g.moveTo(-8, -19); g.lineTo(8, -19); g.lineTo(13 + sw, -1); g.lineTo(-13 + sw, -1); g.fill(); }
  if (F === 'sangdong' && d !== 3) { g.fillStyle = '#e03131'; g.beginPath(); g.moveTo(-8, -18); g.lineTo(8, -18); g.lineTo(12 + Math.sin(t / 200) * 1.5, -3); g.lineTo(-12 + Math.sin(t / 200) * 1.5, -3); g.fill(); }
  if (F === 'jungdong' && d !== 3) { g.fillStyle = '#1c7ed6'; rr(g, d === 1 ? 4 : d === 2 ? -14 : -9, -19, d === 0 ? 18 : 10, 13, 3); g.fill(); }
  // 다리
  const lg = moving && !e.mt ? Math.sin(t / 80) * 2.5 : 0;
  g.fillStyle = e.pants || '#343a40'; if (e.mt) { rr(g, -10, -8, 5, 6, 2); g.fill(); rr(g, 5, -8, 5, 6, 2); g.fill(); } else { rr(g, -6, -7 + lg * .3, 5, 7, 2); g.fill(); rr(g, 1, -7 - lg * .3, 5, 7, 2); g.fill(); }
  // 몸
  g.fillStyle = bodyC; rr(g, -9, -19, 18, 14, 5); g.fill();
  g.fillStyle = trim; g.fillRect(-9, -9, 18, 2.5);
  if (e.ar && e.ar[1] >= 5 && !e.cardigan) { g.fillStyle = '#ffe600'; g.fillRect(-1.5, -18, 3, 9); }
  if (e.tie && d !== 3) { g.fillStyle = e.tie; g.beginPath(); g.moveTo(-2, -19); g.lineTo(2, -19); g.lineTo(1.5, -11); g.lineTo(0, -9); g.lineTo(-1.5, -11); g.fill(); g.fillStyle = '#dee2e6'; g.fillRect(-8, -12, 3, 1.2); }
  if (e.cape) { g.fillStyle = e.cape[0]; g.beginPath(); g.moveTo(-11, -18); g.lineTo(-7, -27); g.lineTo(-5, -19); g.fill(); g.beginPath(); g.moveTo(11, -18); g.lineTo(7, -27); g.lineTo(5, -19); g.fill(); }
  if (F === 'sangdong') { g.fillStyle = '#c92a2a'; g.fillRect(-8, -20, 16, 3); if (d === 3) { g.fillStyle = '#e03131'; g.beginPath(); g.moveTo(-9, -19); g.lineTo(9, -19); g.lineTo(12 + Math.sin(t / 200) * 2, -2); g.lineTo(-12 + Math.sin(t / 200) * 2, -2); g.fill(); } }
  if (F === 'jungdong') { if (d === 3) { g.fillStyle = '#1c7ed6'; rr(g, -8, -20, 16, 14, 4); g.fill(); g.fillStyle = '#74c0fc'; rr(g, -5, -14, 10, 5, 2); g.fill(); } else if (d === 0) { g.strokeStyle = '#1864ab'; g.lineWidth = 2; g.beginPath(); g.moveTo(-5, -19); g.lineTo(-5, -9); g.moveTo(5, -19); g.lineTo(5, -9); g.stroke(); } }
  // 팔
  g.fillStyle = skin; g.beginPath(); g.arc(-10, -12, 3, 0, 7); g.arc(10, -12, 3, 0, 7); g.fill();
  // 머리
  const hx = 0, hy = -30;
  g.fillStyle = skin; g.beginPath(); g.arc(hx, hy, 11, 0, 7); g.fill();
  g.fillStyle = hair;
  if (d === 3) { g.beginPath(); g.arc(hx, hy, 11.3, 0, 7); g.fill(); }
  else { g.beginPath(); g.arc(hx, hy - 2, 11.3, Math.PI * 1.05, Math.PI * 1.95); g.fill(); g.beginPath(); g.ellipse(hx + (d === 1 ? 6 : d === 2 ? -6 : 0), hy - 8, 8, 4, 0, 0, 7); g.fill(); }
  if (d !== 3) {
    const ex = d === 1 ? -3 : d === 2 ? 3 : 0;
    const blink = (t + h) % 3000 < 120;
    g.fillStyle = '#222';
    if (blink) { g.fillRect(hx + ex - 6, hy + 1, 4, 1.5); g.fillRect(hx + ex + 2, hy + 1, 4, 1.5); }
    else { g.beginPath(); g.ellipse(hx + ex - 4, hy + 1, 2.2, 3, 0, 0, 7); g.ellipse(hx + ex + 4, hy + 1, 2.2, 3, 0, 0, 7); g.fill(); g.fillStyle = '#fff'; g.fillRect(hx + ex - 5, hy - 1, 1.3, 1.3); g.fillRect(hx + ex + 3, hy - 1, 1.3, 1.3); }
    g.fillStyle = '#ff8fab88'; g.beginPath(); g.ellipse(hx + ex - 7, hy + 5, 2.5, 1.5, 0, 0, 7); g.ellipse(hx + ex + 7, hy + 5, 2.5, 1.5, 0, 0, 7); g.fill();
    g.strokeStyle = '#9c3d3d'; g.lineWidth = 1.2; g.beginPath(); g.arc(hx + ex, hy + 5, 2, 0.2, Math.PI - 0.2); g.stroke();
    if (e.fangs) { g.fillStyle = '#fff'; g.beginPath(); g.moveTo(hx + ex - 2, hy + 6); g.lineTo(hx + ex - 1.2, hy + 8.5); g.lineTo(hx + ex - .4, hy + 6); g.moveTo(hx + ex + .4, hy + 6); g.lineTo(hx + ex + 1.2, hy + 8.5); g.lineTo(hx + ex + 2, hy + 6); g.fill(); }
    if (e.redeyes) { g.fillStyle = '#e03131'; g.beginPath(); g.arc(hx + ex - 4, hy + 1.5, 1.1, 0, 7); g.arc(hx + ex + 4, hy + 1.5, 1.1, 0, 7); g.fill(); }
  }
  if (e.perm) { g.fillStyle = hair; for (let k = 0; k < 9; k++) { const a = Math.PI * (1.0 + k / 8); g.beginPath(); g.arc(hx + Math.cos(a) * 11, hy - 2 + Math.sin(a) * 10, 4.2, 0, 7); g.fill(); } for (const sx of [-12, 12]) { g.beginPath(); g.arc(hx + sx, hy + 3, 3.6, 0, 7); g.fill(); } }
  if (e.glasses && d !== 3) { const ex = d === 1 ? -3 : d === 2 ? 3 : 0; g.strokeStyle = '#495057'; g.lineWidth = 1.3; g.beginPath(); g.arc(hx + ex - 4, hy + 1, 3.6, 0, 7); g.moveTo(hx + ex + 7.6, hy + 1); g.arc(hx + ex + 4, hy + 1, 3.6, 0, 7); g.moveTo(hx + ex - .4, hy + 1); g.lineTo(hx + ex + .4, hy + 1); g.stroke(); }
  if (e.grandma && d !== 3) { g.strokeStyle = '#7a3e3e'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(hx - 6, hy - 6); g.lineTo(hx - 2, hy - 4.5); g.moveTo(hx + 6, hy - 6); g.lineTo(hx + 2, hy - 4.5); g.stroke(); }
  if (e.he) drawHelm(g, D.HB[e.he[0]].s, e.he[1], hx, hy, t, e.f);
  if (F === 'wonjong') { const top = e.he ? (D.HB[e.he[0]].s === 'wiz' ? hy - 28 : hy - 17) : hy - 11, sw = Math.sin(t / 300) * .25; g.strokeStyle = '#2b8a3e'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(hx, top); g.lineTo(hx, top - 5); g.stroke(); g.fillStyle = '#51cf66'; g.beginPath(); g.ellipse(hx - 4, top - 6, 4.5, 2.2, -.5 + sw, 0, 7); g.ellipse(hx + 4, top - 6, 4.5, 2.2, .5 + sw, 0, 7); g.fill(); }
  if (F === 'yeokgok') { g.strokeStyle = '#fab005'; g.lineWidth = 2.5; g.beginPath(); g.arc(hx, hy - 1, 12.5, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); g.fillStyle = '#ffd43b'; if (d !== 2) { rr(g, hx - 15, hy - 4, 5, 9, 2); g.fill(); } if (d !== 1) { rr(g, hx + 10, hy - 4, 5, 9, 2); g.fill(); } }
  if (F === 'sosa') { g.fillStyle = '#be4bdb'; g.beginPath(); g.moveTo(hx - 11, hy - 6); g.lineTo(hx - 9, hy - 17); g.lineTo(hx - 3, hy - 10); g.moveTo(hx + 11, hy - 6); g.lineTo(hx + 9, hy - 17); g.lineTo(hx + 3, hy - 10); g.fill(); g.fillStyle = '#fcc2d7'; g.beginPath(); g.moveTo(hx - 9.5, hy - 8); g.lineTo(hx - 8.5, hy - 14); g.lineTo(hx - 5, hy - 10); g.moveTo(hx + 9.5, hy - 8); g.lineTo(hx + 8.5, hy - 14); g.lineTo(hx + 5, hy - 10); g.fill(); }
  if (d !== 3) drawW();
  g.restore();
  // 상태
  if (e.bf & 16) { for (let i = 0; i < 3; i++) { const a = t / 200 + i * 2.1; g.fillStyle = '#ffe066'; g.font = '10px sans-serif'; g.fillText('★', cx + Math.cos(a) * 11 - 4, cy - 46 + Math.sin(a) * 3); } }
  if (e.bf & 4) { g.strokeStyle = '#ffffffaa'; g.lineWidth = 1.5; for (let i = 0; i < 3; i++) { const yy = cy - 8 - i * 9, o = ((t / 4 + i * 20) % 20); g.beginPath(); g.moveTo(cx + (d === 1 ? 10 : -10) + (d === 1 ? o : -o), yy); g.lineTo(cx + (d === 1 ? 20 : -20) + (d === 1 ? o : -o), yy); g.stroke(); } }
  if (e.bf & 8) { g.font = '12px sans-serif'; g.fillText('🐌', cx + 8, cy - 40); }
}

/* ============ 그리기: 몬스터 ============ */
function mobColor(e, base, t) { if (e.v == null) return base; const v = D.VAR[e.v]; return v.c === 'rainbow' ? `hsl(${(t / 8) % 360},85%,62%)` : v.c; }
function face(g, x, y, s, angry) {
  g.fillStyle = '#222'; g.beginPath(); g.ellipse(x - 4 * s, y, 2 * s, 2.6 * s, 0, 0, 7); g.ellipse(x + 4 * s, y, 2 * s, 2.6 * s, 0, 0, 7); g.fill();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(x - 4.6 * s, y - 1 * s, .8 * s, 0, 7); g.arc(x + 3.4 * s, y - 1 * s, .8 * s, 0, 7); g.fill();
  if (angry) { g.strokeStyle = '#222'; g.lineWidth = 1.3 * s; g.beginPath(); g.moveTo(x - 7 * s, y - 5 * s); g.lineTo(x - 2 * s, y - 3.5 * s); g.moveTo(x + 7 * s, y - 5 * s); g.lineTo(x + 2 * s, y - 3.5 * s); g.stroke(); }
  g.fillStyle = '#ff8fab99'; g.beginPath(); g.ellipse(x - 7 * s, y + 3 * s, 2 * s, 1.2 * s, 0, 0, 7); g.ellipse(x + 7 * s, y + 3 * s, 2 * s, 1.2 * s, 0, 0, 7); g.fill();
}
// 흰색 말티즈 (보스 + 탈것 공용). 원점 = 발 밑, 오른쪽을 바라봄
function drawDog(g, t, moving, angry) {
  const run = moving ? Math.sin(t / 70) : 0, bob = moving ? Math.abs(run) * 1.5 : Math.sin(t / 300) * .5;
  g.fillStyle = '#f1f3f5';
  for (const lx of [-8, -3, 4, 9]) { g.beginPath(); g.ellipse(lx, -3 + (lx % 2 ? run : -run) * 1.2, 2.6, 3.4, 0, 0, 7); g.fill(); }
  g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(0, -9 - bob, 13, 8, 0, 0, 7); g.fill();
  for (let k = 0; k < 7; k++) { g.beginPath(); g.arc(-11 + k * 3.6, -15 - bob + (k % 2) * 1.5, 3.4, 0, 7); g.fill(); }
  const wag = Math.sin(t / (moving ? 60 : 110)) * .6; g.save(); g.translate(-12, -12 - bob); g.rotate(-.8 + wag); g.beginPath(); g.ellipse(0, -4, 3.2, 5.5, 0, 0, 7); g.fill(); g.restore();
  const hx = 12, hy = -17 - bob;
  g.beginPath(); g.arc(hx, hy, 8.5, 0, 7); g.fill();
  g.fillStyle = '#f8f0e3'; g.beginPath(); g.ellipse(hx - 6.5, hy + 3, 3.4, 6, .25, 0, 7); g.ellipse(hx + 6.5, hy + 3, 3.4, 6, -.25, 0, 7); g.fill();
  g.fillStyle = '#ffffff'; for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(hx - 6 + k * 3, hy - 7, 2.6, 0, 7); g.fill(); }
  g.fillStyle = '#ff8cc6'; g.beginPath(); g.moveTo(hx, hy - 8); g.lineTo(hx - 5, hy - 12); g.lineTo(hx - 5, hy - 5); g.closePath(); g.moveTo(hx, hy - 8); g.lineTo(hx + 5, hy - 12); g.lineTo(hx + 5, hy - 5); g.closePath(); g.fill(); g.beginPath(); g.arc(hx, hy - 8, 1.6, 0, 7); g.fill();
  g.fillStyle = '#222'; g.beginPath(); g.arc(hx - 2.8, hy, 1.7, 0, 7); g.arc(hx + 3.2, hy, 1.7, 0, 7); g.fill(); g.beginPath(); g.ellipse(hx + .3, hy + 3.5, 1.8, 1.3, 0, 0, 7); g.fill();
  g.fillStyle = '#fff'; g.fillRect(hx - 3.4, hy - .8, .8, .8); g.fillRect(hx + 2.6, hy - .8, .8, .8);
  if (!angry || moving) { g.fillStyle = '#ff6b81'; g.beginPath(); g.ellipse(hx + .5, hy + 6.2, 1.5, 2, 0, 0, 7); g.fill(); }
  g.fillStyle = '#ffc9c9aa'; g.beginPath(); g.ellipse(hx - 5.5, hy + 3, 1.8, 1.1, 0, 0, 7); g.ellipse(hx + 6, hy + 3, 1.8, 1.1, 0, 0, 7); g.fill();
}
function drawMob(g, cx, cy, e, t) {
  const M = D.MON[e.t], boss = M.boss, S = (boss ? (M.big || 1.9) : 1) * (M.id === 'rmushbroc' ? .65 + .35 * Math.max(0, e.h / e.H) : 1), c = mobColor(e, M.c, t);
  if (e.fl & 8) { g.save(); g.fillStyle = '#0005'; g.beginPath(); g.ellipse(cx, cy, 11 * S * .7, 4 * S * .7, 0, 0, 7); g.fill(); g.restore(); cy -= 70 + Math.sin(t / 90) * 4; }
  const ph = (e.id || 0) * 1.7, bob = Math.sin(t / 250 + ph);
  g.save(); g.translate(cx, cy);
  g.fillStyle = '#0004'; g.beginPath(); g.ellipse(0, 0, 11 * S, 4 * S, 0, 0, 7); g.fill();
  if (boss) { g.strokeStyle = c; g.globalAlpha = .4 + .2 * Math.sin(t / 200); g.lineWidth = 3; g.beginPath(); g.ellipse(0, 0, 18 * S, 7 * S, 0, 0, 7); g.stroke(); g.globalAlpha = 1; }
  if (e.fa != null) { const fa = e.fa, R2 = 5 * T; g.save(); g.translate(0, -12);
    g.fillStyle = (e.fl & 32) ? 'rgba(255,212,59,.12)' : 'rgba(250,82,82,.13)'; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R2, fa - 2.0, fa + 2.0); g.closePath(); g.fill();
    g.fillStyle = `rgba(105,219,124,${.2 + .08 * Math.sin(t / 200)})`; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R2, fa + 2.0, fa + 2 * Math.PI - 2.0); g.closePath(); g.fill();
    g.strokeStyle = '#ff6b6b'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(fa) * R2, Math.sin(fa) * R2); g.stroke();
    g.font = 'bold 13px Jua'; g.textAlign = 'center'; g.fillStyle = '#69db7c'; g.fillText('등 (백어택 ✓)', -Math.cos(fa) * R2 * .7, -Math.sin(fa) * R2 * .7); g.fillStyle = '#ff8787'; g.fillText('정면 🛡', Math.cos(fa) * R2 * .7, Math.sin(fa) * R2 * .7); g.restore(); }
  if (M.gb || M.hw) { const ac = M.hw ? '#ffd43b' : M.c === '#f8f9fa' ? '#ced4da' : M.c === '#343a40' ? '#3bc9db' : M.c; g.save(); g.globalAlpha = .28 + .14 * Math.sin(t / 300); const gr = g.createRadialGradient(0, -16 * S, 3, 0, -16 * S, 30 * S); gr.addColorStop(0, ac); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.beginPath(); g.arc(0, -16 * S, 30 * S, 0, 7); g.fill(); g.globalAlpha = .8; g.fillStyle = ac; for (let k = 0; k < 8; k++) { const a = t / 700 + k * .785, rr2 = 22 * S + Math.sin(t / 200 + k) * 4; g.beginPath(); g.arc(Math.cos(a) * rr2, -16 * S + Math.sin(a) * rr2 * .45, 2.5, 0, 7); g.fill(); } g.restore(); }
  g.scale(S, S);
  const angry = boss || (e.fl & 1) === 0 && e.h < e.H;
  switch (M.s) {
    case 'blob': { if (M.n.includes('맥주')) { g.fillStyle = '#fff'; for (let k = -1; k <= 1; k++) { g.beginPath(); g.arc(k * 6, -18 + bob, 5, 0, 7); g.fill(); } } const sq = 1 + bob * .08; g.fillStyle = c; g.beginPath(); g.ellipse(0, -9 * sq, 12 / sq, 10 * sq, 0, Math.PI, 0); g.lineTo(12 / sq, -1); g.quadraticCurveTo(0, 2, -12 / sq, -1); g.fill(); g.fillStyle = '#ffffff66'; g.beginPath(); g.ellipse(-5, -14 * sq, 3, 2, -.5, 0, 7); g.fill(); face(g, 0, -8, 1, angry); break; }
    case 'bunny': { const y = -Math.abs(bob) * 4; g.fillStyle = c; g.beginPath(); g.ellipse(-4, -22 + y, 2.5, 7, -.2, 0, 7); g.ellipse(4, -22 + y, 2.5, 7, .2, 0, 7); g.fill(); g.fillStyle = '#ffc9c9'; g.beginPath(); g.ellipse(-4, -22 + y, 1.2, 5, -.2, 0, 7); g.ellipse(4, -22 + y, 1.2, 5, .2, 0, 7); g.fill(); g.fillStyle = c; g.beginPath(); g.ellipse(0, -8 + y, 10, 9, 0, 0, 7); g.fill(); g.strokeStyle = '#ddd'; g.lineWidth = 1; g.stroke(); face(g, 0, -9 + y, .9, angry); break; }
    case 'mush': g.fillStyle = '#fff4e6'; rr(g, -6, -10, 12, 10, 4); g.fill(); face(g, 0, -5, .7, angry); g.fillStyle = c; g.beginPath(); g.ellipse(0, -12 + bob, 13, 9, 0, Math.PI, 0); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(-5, -16 + bob, 2.4, 0, 7); g.arc(4, -18 + bob, 2, 0, 7); g.arc(8, -13 + bob, 1.6, 0, 7); g.fill(); break;
    case 'bee': { const y = -12 + bob * 3; g.fillStyle = '#ffffffaa'; const fl = Math.sin(t / 30) * 3; g.beginPath(); g.ellipse(-6, y - 8, 5, 3 + fl * .3, -.6, 0, 7); g.ellipse(6, y - 8, 5, 3 + fl * .3, .6, 0, 7); g.fill(); g.fillStyle = c; g.beginPath(); g.ellipse(0, y, 10, 8, 0, 0, 7); g.fill(); g.fillStyle = '#222'; g.fillRect(-3, y - 7, 2.5, 14); g.fillRect(3, y - 7, 2.5, 14); g.beginPath(); g.moveTo(10, y); g.lineTo(14, y + 1); g.lineTo(10, y + 3); g.fill(); face(g, -5, y - 1, .7, angry); break; }
    case 'crab': g.fillStyle = c; const cl = Math.sin(t / 150) * .3; g.save(); g.translate(-12, -10); g.rotate(-cl); g.beginPath(); g.arc(0, 0, 5, 0, 5.5); g.lineTo(0, 0); g.fill(); g.restore(); g.save(); g.translate(12, -10); g.rotate(cl); g.beginPath(); g.arc(0, 0, 5, -2.4, 3.2); g.lineTo(0, 0); g.fill(); g.restore(); g.beginPath(); g.ellipse(0, -7, 11, 7, 0, 0, 7); g.fill(); g.strokeStyle = c; g.lineWidth = 2; g.beginPath(); g.moveTo(-4, -13); g.lineTo(-4, -18); g.moveTo(4, -13); g.lineTo(4, -18); g.stroke(); g.fillStyle = '#fff'; g.beginPath(); g.arc(-4, -19, 3, 0, 7); g.arc(4, -19, 3, 0, 7); g.fill(); g.fillStyle = '#222'; g.beginPath(); g.arc(-4, -19, 1.5, 0, 7); g.arc(4, -19, 1.5, 0, 7); g.fill(); break;
    case 'cat': g.fillStyle = c; g.beginPath(); g.ellipse(0, -6, 10, 7, 0, 0, 7); g.fill(); g.strokeStyle = c; g.lineWidth = 3; g.beginPath(); g.moveTo(9, -6); g.quadraticCurveTo(16, -10 + bob * 3, 13, -18); g.stroke(); g.beginPath(); g.arc(0, -15, 9, 0, 7); g.fill(); g.beginPath(); g.moveTo(-8, -18); g.lineTo(-6, -27); g.lineTo(-1, -21); g.moveTo(8, -18); g.lineTo(6, -27); g.lineTo(1, -21); g.fill(); face(g, 0, -15, .8, angry); g.fillStyle = '#ff8fab'; g.beginPath(); g.arc(0, -12, 1.2, 0, 7); g.fill(); break;
    case 'bat': { const y = -16 + bob * 4, fl = Math.sin(t / 60); g.fillStyle = c; g.beginPath(); g.moveTo(-6, y); g.quadraticCurveTo(-16, y - 10 * fl, -20, y + 2); g.quadraticCurveTo(-14, y, -11, y + 5); g.lineTo(-6, y + 3); g.moveTo(6, y); g.quadraticCurveTo(16, y - 10 * fl, 20, y + 2); g.quadraticCurveTo(14, y, 11, y + 5); g.lineTo(6, y + 3); g.fill(); g.beginPath(); g.arc(0, y, 8, 0, 7); g.fill(); g.beginPath(); g.moveTo(-6, y - 5); g.lineTo(-4, y - 12); g.lineTo(-1, y - 7); g.moveTo(6, y - 5); g.lineTo(4, y - 12); g.lineTo(1, y - 7); g.fill(); face(g, 0, y, .7, angry); break; }
    case 'ghost': { const y = -14 + bob * 3; g.globalAlpha = .9; g.fillStyle = c; g.beginPath(); g.arc(0, y, 10, Math.PI, 0); g.lineTo(10, y + 10); for (let i = 0; i < 4; i++) g.quadraticCurveTo(7.5 - i * 5, y + 6 + (i % 2) * 6 + Math.sin(t / 100 + i) * 2, 5 - i * 5, y + 10); g.lineTo(-10, y); g.fill(); g.globalAlpha = 1; face(g, 0, y, .8, angry); break; }
    case 'pumpkin': g.fillStyle = c; for (const ox of [-6, 6, 0]) { g.beginPath(); g.ellipse(ox, -9, 7, 9, 0, 0, 7); g.fill(); } g.fillStyle = '#2b8a3e'; g.fillRect(-1.5, -21, 3, 5); g.fillStyle = '#ffe066'; g.beginPath(); g.moveTo(-6, -12); g.lineTo(-3, -9); g.lineTo(-8, -9); g.moveTo(6, -12); g.lineTo(8, -9); g.lineTo(3, -9); g.fill(); g.beginPath(); g.moveTo(-6, -5); for (let i = 0; i < 4; i++) { g.lineTo(-4.5 + i * 3.5, -2 - (i % 2) * 2); } g.lineTo(6, -5); g.fill(); break;
    case 'snake': g.strokeStyle = c; g.lineWidth = 7; g.lineCap = 'round'; g.beginPath(); for (let i = 0; i <= 10; i++) { const x = -12 + i * 2.2, y = -4 + Math.sin(t / 150 + i * .8) * 3; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); g.fillStyle = c; g.beginPath(); g.arc(10, -10, 7, 0, 7); g.fill(); face(g, 10, -11, .6, angry); g.strokeStyle = '#e03131'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(16, -8); g.lineTo(20, -8); g.stroke(); break;
    case 'fox': g.fillStyle = c; g.beginPath(); g.ellipse(14, -10, 7, 4, -.6 + bob * .2, 0, 7); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(19, -14, 2.5, 0, 7); g.fill(); g.fillStyle = c; g.beginPath(); g.ellipse(0, -7, 10, 7, 0, 0, 7); g.fill(); g.beginPath(); g.arc(0, -16, 9, 0, 7); g.fill(); g.beginPath(); g.moveTo(-8, -19); g.lineTo(-7, -29); g.lineTo(-1, -22); g.moveTo(8, -19); g.lineTo(7, -29); g.lineTo(1, -22); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.ellipse(0, -12, 6, 4, 0, 0, Math.PI); g.fill(); face(g, 0, -16, .8, angry); break;
    case 'skull': g.fillStyle = '#ced4da'; rr(g, -7, -14, 14, 12, 3); g.fill(); g.strokeStyle = '#868e96'; g.lineWidth = 1; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(-6, -11 + i * 3.5); g.lineTo(6, -11 + i * 3.5); g.stroke(); } g.strokeStyle = '#8d5a3b'; g.lineWidth = 2; g.beginPath(); g.moveTo(10, -2); g.lineTo(10, -22); g.stroke(); g.fillStyle = '#adb5bd'; g.beginPath(); g.moveTo(8, -22); g.lineTo(12, -22); g.lineTo(10, -28); g.fill(); g.fillStyle = c; g.beginPath(); g.arc(0, -22, 9, 0, 7); g.fill(); g.fillStyle = '#222'; g.beginPath(); g.arc(-3.5, -22, 2.8, 0, 7); g.arc(3.5, -22, 2.8, 0, 7); g.fill(); g.fillStyle = angry ? '#ff6b6b' : '#74c0fc'; g.beginPath(); g.arc(-3.5, -22, 1, 0, 7); g.arc(3.5, -22, 1, 0, 7); g.fill(); g.fillStyle = '#222'; g.fillRect(-3, -16, 6, 1.5); break;
    case 'spider': g.strokeStyle = c; g.lineWidth = 2; for (let i = 0; i < 4; i++) { const k = Math.sin(t / 80 + i) * 2; g.beginPath(); g.moveTo(-5, -8); g.lineTo(-13, -14 + i * 4 + k); g.lineTo(-16, -4 + i * 3); g.moveTo(5, -8); g.lineTo(13, -14 + i * 4 - k); g.lineTo(16, -4 + i * 3); g.stroke(); } g.fillStyle = c; g.beginPath(); g.ellipse(0, -9, 9, 8, 0, 0, 7); g.fill(); g.fillStyle = '#e03131'; for (const [x, y] of [[-3, -11], [3, -11], [-5, -8], [5, -8]]) { g.beginPath(); g.arc(x, y, 1.5, 0, 7); g.fill(); } break;
    case 'golem': g.fillStyle = c; rr(g, -11, -22, 22, 20, 5); g.fill(); rr(g, -16, -18 + bob, 6, 13, 3); g.fill(); rr(g, 10, -18 - bob, 6, 13, 3); g.fill(); g.fillStyle = '#0002'; g.fillRect(-11, -9, 22, 2); g.fillStyle = M.c === '#e8590c' || e.v != null ? '#ffe066' : '#66d9e8'; g.fillRect(-6, -17, 4, 3); g.fillRect(2, -17, 4, 3); g.fillStyle = '#fff6'; g.beginPath(); g.arc(-5, -6, 2, 0, 7); g.fill(); break;
    case 'imp': { const y = -12 + bob * 2; g.fillStyle = c; g.beginPath(); g.arc(0, y, 10, 0, 7); g.fill(); g.fillStyle = '#ffe066'; g.beginPath(); g.moveTo(-7, y - 6); g.lineTo(-9, y - 15); g.lineTo(-3, y - 9); g.moveTo(7, y - 6); g.lineTo(9, y - 15); g.lineTo(3, y - 9); g.fill(); g.strokeStyle = c; g.lineWidth = 2; g.beginPath(); g.moveTo(8, y + 6); g.quadraticCurveTo(16, y + 8, 14, y - 2); g.stroke(); g.fillStyle = c; g.beginPath(); g.moveTo(14, y - 2); g.lineTo(11, y - 5); g.lineTo(17, y - 5); g.fill(); face(g, 0, y, .8, true); break; }
    case 'dragon': { const y = -12 + bob * 2, fl = Math.sin(t / 120); g.fillStyle = c; g.beginPath(); g.moveTo(-5, y - 3); g.lineTo(-17, y - 12 - fl * 3); g.lineTo(-13, y + 2); g.moveTo(5, y - 3); g.lineTo(17, y - 12 - fl * 3); g.lineTo(13, y + 2); g.fill(); g.beginPath(); g.ellipse(0, y + 4, 9, 8, 0, 0, 7); g.fill(); g.fillStyle = '#ffec99'; g.beginPath(); g.ellipse(0, y + 6, 5, 5, 0, 0, 7); g.fill(); g.fillStyle = c; g.beginPath(); g.arc(0, y - 7, 9, 0, 7); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(-6, y - 13); g.lineTo(-8, y - 20); g.lineTo(-3, y - 15); g.moveTo(6, y - 13); g.lineTo(8, y - 20); g.lineTo(3, y - 15); g.fill(); face(g, 0, y - 7, .8, angry); break; }
    case 'bird': { const y = -8 + Math.abs(bob) * -2; g.fillStyle = c; g.beginPath(); g.ellipse(0, y, 10, 8, 0, 0, 7); g.fill(); g.beginPath(); g.arc(6, y - 8, 6, 0, 7); g.fill(); g.fillStyle = '#69db7c'; g.beginPath(); g.arc(6, y - 4, 4, 0, Math.PI); g.fill(); g.fillStyle = '#ffa94d'; g.beginPath(); g.moveTo(11, y - 9); g.lineTo(15, y - 7); g.lineTo(11, y - 6); g.fill(); g.fillStyle = '#222'; g.beginPath(); g.arc(7, y - 9, 1.5, 0, 7); g.fill(); g.fillStyle = '#868e96'; g.beginPath(); g.ellipse(-3, y, 6, 4, -.3 + bob * .3, 0, 7); g.fill(); g.strokeStyle = '#ff8787'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(-2, y + 7); g.lineTo(-2, y + 10); g.moveTo(3, y + 7); g.lineTo(3, y + 10); g.stroke(); break; }
    case 'bottle': { const y = bob * 2; g.fillStyle = c; rr(g, -7, -22 + y, 14, 22, 5); g.fill(); g.fillRect(-3, -28 + y, 6, 7); g.fillStyle = '#2b8a3e'; g.fillRect(-3.5, -30 + y, 7, 3); g.fillStyle = '#fff'; g.fillRect(-6, -15 + y, 12, 7); g.fillStyle = '#1c7ed6'; g.font = '5px sans-serif'; g.textAlign = 'center'; g.fillText('소주', 0, -10 + y); g.fillStyle = '#ffffff55'; g.fillRect(-5, -20 + y, 2, 14); face(g, 0, -4 + y, .6, angry); break; }
    case 'skewer': { g.strokeStyle = '#d9a066'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -30); g.stroke(); for (let k = 0; k < 3; k++) { g.fillStyle = k === 1 ? '#69db7c' : c; rr(g, -6, -26 + k * 8 + bob, 12, 7, 3); g.fill(); } g.fillStyle = '#c92a2a55'; g.fillRect(-6, -26 + bob, 12, 2); face(g, 0, -15 + bob, .6, angry); break; }
    case 'snail': { g.fillStyle = '#ffe8cc'; g.beginPath(); g.ellipse(2, -4, 13, 4, 0, 0, 7); g.fill(); g.beginPath(); g.arc(12, -9, 5, 0, 7); g.fill(); g.strokeStyle = '#ffe8cc'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(11, -13); g.lineTo(10, -19); g.moveTo(14, -13); g.lineTo(15, -19); g.stroke(); g.fillStyle = '#222'; g.beginPath(); g.arc(10, -19, 1.4, 0, 7); g.arc(15, -19, 1.4, 0, 7); g.fill(); g.fillStyle = c; g.beginPath(); g.arc(-2, -12, 10, 0, 7); g.fill(); g.strokeStyle = '#a0522d'; g.lineWidth = 2; g.beginPath(); for (let k = 0; k < 30; k++) { const a = k * .35, rr2 = 8 - k * .25; g.lineTo(-2 + Math.cos(a) * rr2, -12 + Math.sin(a) * rr2); } g.stroke(); break; }
    case 'rat': { g.strokeStyle = '#ffc9c9'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(-9, -4); g.quadraticCurveTo(-16, -6 + bob * 3, -18, 0); g.stroke(); g.fillStyle = c; g.beginPath(); g.ellipse(0, -6, 10, 7, 0, 0, 7); g.fill(); g.beginPath(); g.arc(-4, -13, 4, 0, 7); g.arc(5, -13, 4, 0, 7); g.fill(); g.fillStyle = '#ffc9c9'; g.beginPath(); g.arc(-4, -13, 2, 0, 7); g.arc(5, -13, 2, 0, 7); g.fill(); face(g, 1, -6, .65, angry); g.fillStyle = '#ff8787'; g.beginPath(); g.arc(1, -3, 1.3, 0, 7); g.fill(); break; }
    case 'dumbbell': { const y = -10 + bob * 2; g.fillStyle = '#adb5bd'; g.fillRect(-8, y - 2, 16, 4); g.fillStyle = c; rr(g, -16, y - 9, 8, 18, 3); g.fill(); rr(g, 8, y - 9, 8, 18, 3); g.fill(); g.fillStyle = '#212529'; rr(g, -19, y - 6, 4, 12, 2); g.fill(); rr(g, 15, y - 6, 4, 12, 2); g.fill(); face(g, -12, y, .5, angry); face(g, 12, y, .5, angry); break; }
    case 'kettle': { const y = bob; g.strokeStyle = c; g.lineWidth = 3.5; g.beginPath(); g.arc(0, -20 + y, 6, Math.PI, 0); g.stroke(); g.fillStyle = c; g.beginPath(); g.arc(0, -9 + y, 10, 0, 7); g.fill(); g.fillStyle = '#ffe066'; g.font = 'bold 6px sans-serif'; g.textAlign = 'center'; g.fillText('16kg', 0, -1 + y); face(g, 0, -10 + y, .7, angry); break; }
    case 'paper': { const y = -14 + bob * 3; g.fillStyle = c; g.beginPath(); g.moveTo(-9, y - 10); g.lineTo(5, y - 10); g.lineTo(10, y - 5); g.lineTo(10, y + 10); for (let k = 0; k < 4; k++) g.lineTo(10 - k * 5 - 2.5, y + 7 + (k % 2) * 4); g.lineTo(-9, y + 10); g.closePath(); g.fill(); g.strokeStyle = '#ced4da'; g.lineWidth = 1; g.stroke(); g.fillStyle = '#dee2e6'; g.fillRect(-6, y + 3, 12, 1.2); g.fillRect(-6, y + 6, 9, 1.2); g.fillStyle = '#e03131'; g.beginPath(); g.arc(5, y + 5, 3, 0, 7); g.fill(); face(g, 0, y - 3, .7, angry); break; }
    case 'mimic': { const o = Math.max(0, Math.sin(t / 300 + ph)) * 5; g.fillStyle = c; rr(g, -12, -14, 24, 14, 2); g.fill(); g.fillStyle = '#ffd43b'; g.fillRect(-12, -8, 24, 2); g.fillStyle = '#c92a2a'; g.fillRect(-10, -16 - o, 20, o + 2); g.fillStyle = '#fff'; for (let k = 0; k < 5; k++) { g.beginPath(); g.moveTo(-10 + k * 4, -14); g.lineTo(-8 + k * 4, -11); g.lineTo(-6 + k * 4, -14); g.fill(); } g.fillStyle = c; rr(g, -13, -22 - o, 26, 8, 3); g.fill(); g.fillStyle = '#ffd43b'; g.fillRect(-2, -18 - o, 4, 4); g.fillStyle = '#fff'; g.beginPath(); g.arc(-5, -26 - o, 3, 0, 7); g.arc(5, -26 - o, 3, 0, 7); g.fill(); g.fillStyle = '#e03131'; g.beginPath(); g.arc(-5, -26 - o, 1.5, 0, 7); g.arc(5, -26 - o, 1.5, 0, 7); g.fill(); break; }
    case 'whale': { const y = -10 + bob * 2; g.fillStyle = c; g.beginPath(); g.ellipse(0, y, 15, 10, 0, 0, 7); g.fill(); g.beginPath(); g.moveTo(-13, y); g.lineTo(-22, y - 7); g.lineTo(-20, y + 6); g.fill(); g.fillStyle = '#d0ebff'; g.beginPath(); g.ellipse(2, y + 4, 10, 5, 0, 0, Math.PI); g.fill(); g.fillStyle = '#74c0fc'; for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(4 + (k - 1) * 4, y - 14 - Math.abs(Math.sin(t / 200 + k)) * 6, 2.5, 0, 7); g.fill(); } face(g, 5, y - 2, .8, angry); g.fillStyle = '#ff8787aa'; g.beginPath(); g.ellipse(-4, y + 1, 3, 2, 0, 0, 7); g.ellipse(13, y + 1, 3, 2, 0, 0, 7); g.fill(); break; }
    case 'broccoli': { const y0 = -12 + bob * 1.5; g.fillStyle = '#82c91e'; rr(g, -5, y0, 10, 12 - y0 * 0, 3); g.fill(); g.fillStyle = c; for (const [bx, by, br] of [[-8, -6, 7], [8, -6, 7], [0, -11, 8], [-4, -3, 6], [5, -2, 6], [-11, -1, 5], [11, -1, 5]]) { g.beginPath(); g.arc(bx, y0 + by, br, 0, 7); g.fill(); } g.fillStyle = '#ffffff22'; g.beginPath(); g.arc(-3, y0 - 13, 3, 0, 7); g.fill(); face(g, 0, y0 - 4, .8, angry); break; }
    case 'mushbroc': { const y0 = bob * 2; g.fillStyle = '#82c91e'; rr(g, 2, -14 + y0, 10, 14, 3); g.fill(); g.fillStyle = '#2f9e44'; for (const [bx, by, br] of [[4, -22, 7], [13, -20, 6], [9, -27, 6]]) { g.beginPath(); g.arc(bx, by + y0, br, 0, 7); g.fill(); } g.fillStyle = '#fff4e6'; rr(g, -11, -12 + y0, 13, 12, 4); g.fill(); g.fillStyle = '#e8590c'; g.beginPath(); g.ellipse(-5, -14 + y0, 12, 9, 0, Math.PI, 0); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(-9, -18 + y0, 2.2, 0, 7); g.arc(-2, -19 + y0, 1.8, 0, 7); g.fill(); face(g, -4, -6 + y0, .65, true); face(g, 8, -14 + y0, .55, true); break; }
    case 'dino': { const y0 = bob * 1.5, jaw = Math.abs(Math.sin(t / 300)) * 3; g.fillStyle = c; g.beginPath(); g.moveTo(-12, -8 + y0); g.quadraticCurveTo(-24, -6 + y0, -26, -2 + y0); g.quadraticCurveTo(-18, -2 + y0, -10, -3 + y0); g.fill(); g.beginPath(); g.ellipse(-2, -10 + y0, 12, 9, -.2, 0, 7); g.fill(); g.fillRect(-7, -4 + y0, 5, 6); g.fillRect(2, -4 + y0, 5, 6); g.beginPath(); g.ellipse(8, -22 + y0, 10, 7, .1, 0, 7); g.fill(); g.fillStyle = '#ffffff'; for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(10 + k * 2.5, -17 + y0); g.lineTo(11 + k * 2.5, -15 + y0 + jaw * .3); g.lineTo(12 + k * 2.5, -17 + y0); g.fill(); } g.fillStyle = c; g.beginPath(); g.ellipse(10, -15 + y0 + jaw, 8, 3, .1, 0, 7); g.fill(); g.fillStyle = '#ffe066'; g.beginPath(); g.arc(9, -25 + y0, 2.2, 0, 7); g.fill(); g.fillStyle = '#000'; g.beginPath(); g.arc(9.5, -25 + y0, 1, 0, 7); g.fill(); g.fillStyle = c === '#c92a2a' ? '#212529' : '#2b8a3e'; for (let k = 0; k < 5; k++) { g.beginPath(); g.moveTo(-12 + k * 4, -18 + y0 + k); g.lineTo(-10 + k * 4, -23 + y0 + k); g.lineTo(-8 + k * 4, -18 + y0 + k); g.fill(); } g.fillStyle = c; g.fillRect(4, -14 + y0, 2, 5); break; }
    case 'statue': { const y0 = Math.sin(t / 500) * .8, red = c === '#c92a2a'; g.fillStyle = '#495057'; rr(g, -14, -6, 28, 6, 2); g.fill(); g.fillStyle = red ? '#a61e4d' : c; rr(g, -10, -28 + y0, 20, 24, 5); g.fill(); g.fillStyle = red ? '#c92a2a' : '#ced4da'; rr(g, -8, -38 + y0, 16, 13, 5); g.fill(); g.fillStyle = '#ffd43b'; g.beginPath(); g.moveTo(-8, -38 + y0); g.lineTo(-6, -45 + y0); g.lineTo(-2, -40 + y0); g.lineTo(0, -47 + y0); g.lineTo(2, -40 + y0); g.lineTo(6, -45 + y0); g.lineTo(8, -38 + y0); g.fill(); g.fillStyle = red ? '#ffe066' : '#ff6b6b'; g.shadowColor = g.fillStyle; g.shadowBlur = 6; g.fillRect(-5, -33 + y0, 3, 2); g.fillRect(2, -33 + y0, 3, 2); g.shadowBlur = 0; g.strokeStyle = '#343a40'; g.lineWidth = .8; for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(-8 + k * 4, -24 + y0); g.lineTo(-6 + k * 4, -10 + y0); g.stroke(); } if (e.fl & 16) { g.strokeStyle = '#74c0fc'; g.globalAlpha = .5 + .3 * Math.sin(t / 150); g.lineWidth = 2; g.beginPath(); g.ellipse(0, -22, 18, 26, 0, 0, 7); g.stroke(); g.globalAlpha = 1; } break; }
    case 'arm': { const sw = Math.sin(t / 250 + ph) * .3; g.save(); g.rotate(sw); g.fillStyle = c; rr(g, -4, -26, 8, 26, 3); g.fill(); g.fillStyle = '#495057'; g.beginPath(); g.arc(0, -28, 7, 0, 7); g.fill(); g.fillStyle = '#adb5bd'; for (let k = -2; k <= 2; k++) { rr(g, k * 2.6 - 1, -38, 2.2, 7, 1); g.fill(); } g.restore(); break; }
    case 'kraken': { const y0 = Math.sin(t / 400) * 1.5; g.fillStyle = c; for (let k = 0; k < 6; k++) { const a = Math.PI * (.15 + k * .14), sw = Math.sin(t / 300 + k) * .25; g.save(); g.translate(Math.cos(a) * 7 * (k < 3 ? -1 : 1) * 0 + (k - 2.5) * 4, -6 + y0); g.rotate((k - 2.5) * .35 + sw); g.beginPath(); g.ellipse(0, 6, 2.5, 8, 0, 0, 7); g.fill(); g.restore(); } g.beginPath(); g.ellipse(0, -18 + y0, 13, 14, 0, 0, 7); g.fill(); g.fillStyle = '#9775fa'; for (const [sx, sy] of [[-6, -26], [5, -28], [0, -22]]) { g.beginPath(); g.arc(sx, sy + y0, 2, 0, 7); g.fill(); } g.fillStyle = '#ffe066'; g.beginPath(); g.ellipse(-5, -15 + y0, 3.5, 2.6, 0, 0, 7); g.ellipse(5, -15 + y0, 3.5, 2.6, 0, 0, 7); g.fill(); g.fillStyle = '#000'; g.fillRect(-5.6, -17 + y0, 1.3, 4); g.fillRect(4.4, -17 + y0, 1.3, 4); g.fillStyle = '#ffd43b'; g.beginPath(); g.moveTo(-8, -31 + y0); g.lineTo(-6, -37 + y0); g.lineTo(-2, -33 + y0); g.lineTo(0, -39 + y0); g.lineTo(2, -33 + y0); g.lineTo(6, -37 + y0); g.lineTo(8, -31 + y0); g.fill(); break; }
    case 'tentacle': { const sw = Math.sin(t / 220 + ph) * .45; g.save(); g.rotate(sw); g.fillStyle = c; g.beginPath(); g.moveTo(-5, 0); g.quadraticCurveTo(-7, -18, 0, -32); g.quadraticCurveTo(7, -18, 5, 0); g.fill(); g.fillStyle = '#e5dbff'; for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(1, -5 - k * 5.5, 1.6, 0, 7); g.fill(); } g.restore(); break; }
    case 'clock': { const y0 = Math.sin(t / 500), fake = M.id === 'clockclone'; if (fake) g.globalAlpha = .6 + .2 * Math.sin(t / 150); g.fillStyle = '#5c3d2e'; rr(g, -9, -10 + y0, 18, 10, 2); g.fill(); g.fillStyle = c; g.beginPath(); g.arc(0, -22 + y0, 13, 0, 7); g.fill(); g.fillStyle = '#fff9db'; g.beginPath(); g.arc(0, -22 + y0, 10.5, 0, 7); g.fill(); g.fillStyle = '#212529'; for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6; g.fillRect(Math.cos(a) * 8.5 - .6, -22 + y0 + Math.sin(a) * 8.5 - .6, 1.2, 1.2); } g.strokeStyle = '#212529'; g.lineWidth = 1.6; g.lineCap = 'round'; const a1 = t / 600, a2 = t / 60; g.beginPath(); g.moveTo(0, -22 + y0); g.lineTo(Math.cos(a1) * 5, -22 + y0 + Math.sin(a1) * 5); g.moveTo(0, -22 + y0); g.lineTo(Math.cos(a2) * 8, -22 + y0 + Math.sin(a2) * 8); g.stroke(); g.fillStyle = '#e03131'; g.beginPath(); g.arc(-4, -26 + y0, 1.6, 0, 7); g.arc(4, -26 + y0, 1.6, 0, 7); g.fill(); g.fillStyle = '#7048e8'; g.beginPath(); g.moveTo(-13, -30 + y0); g.lineTo(-17, -40 + y0); g.lineTo(-8, -33 + y0); g.moveTo(13, -30 + y0); g.lineTo(17, -40 + y0); g.lineTo(8, -33 + y0); g.fill(); g.globalAlpha = 1; break; }
    case 'warlord': { const y0 = Math.sin(t / 400) * 1.2, sw = Math.sin(t / 300) * .2;
      g.fillStyle = '#212529'; g.fillRect(-8, -8, 6, 8); g.fillRect(2, -8, 6, 8);
      g.fillStyle = '#7a0f1f'; g.beginPath(); g.moveTo(-12, -30 + y0); g.lineTo(-16, -4); g.lineTo(16, -4); g.lineTo(12, -30 + y0); g.fill();
      g.fillStyle = c; rr(g, -11, -30 + y0, 22, 22, 4); g.fill(); g.fillStyle = '#868e96'; rr(g, -16, -32 + y0, 9, 7, 3); g.fill(); rr(g, 7, -32 + y0, 9, 7, 3); g.fill();
      g.strokeStyle = '#ced4da'; g.lineWidth = 1; for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(-8, -24 + k * 5 + y0); g.lineTo(8, -24 + k * 5 + y0); g.stroke(); }
      g.fillStyle = '#343a40'; g.beginPath(); g.arc(0, -38 + y0, 8, 0, 7); g.fill();
      g.fillStyle = '#e9ecef'; g.beginPath(); g.moveTo(-6, -42 + y0); g.quadraticCurveTo(-16, -46 + y0, -14, -56 + y0); g.quadraticCurveTo(-11, -48 + y0, -3, -45 + y0); g.fill(); g.beginPath(); g.moveTo(6, -42 + y0); g.quadraticCurveTo(16, -46 + y0, 14, -56 + y0); g.quadraticCurveTo(11, -48 + y0, 3, -45 + y0); g.fill();
      g.save(); g.shadowColor = '#ff0000'; g.shadowBlur = 8; g.fillStyle = '#ff2b2b'; g.fillRect(-5, -40 + y0, 3.5, 2); g.fillRect(1.5, -40 + y0, 3.5, 2); g.restore();
      g.save(); g.translate(14, -22 + y0); g.rotate(-.5 + sw); g.fillStyle = '#5c3d2e'; g.fillRect(-1.5, -22, 3, 30); g.fillStyle = '#adb5bd'; g.beginPath(); g.moveTo(0, -22); g.quadraticCurveTo(14, -24, 13, -10); g.quadraticCurveTo(6, -14, 0, -12); g.fill(); g.beginPath(); g.moveTo(0, -22); g.quadraticCurveTo(-12, -24, -11, -12); g.quadraticCurveTo(-5, -15, 0, -13); g.fill(); g.restore();
      if (e.fl & 32) { g.font = '12px sans-serif'; for (let k = 0; k < 3; k++) g.fillText('💫', Math.cos(t / 200 + k * 2.1) * 12 - 6, -58 + Math.sin(t / 200 + k * 2.1) * 4); }
      break; }
    case 'orb': { const y0 = -16 + Math.sin(t / 300 + ph) * 3; g.save(); g.shadowColor = c; g.shadowBlur = 16; g.fillStyle = c; g.globalAlpha = .9; g.beginPath(); g.arc(0, y0, 10, 0, 7); g.fill(); g.restore(); g.fillStyle = '#ffffff88'; g.beginPath(); g.arc(-3, y0 - 4, 3, 0, 7); g.fill(); g.font = 'bold 15px Jua'; g.textAlign = 'center'; g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 3; g.strokeText(M.n, 0, y0 + 5); g.fillText(M.n, 0, y0 + 5); break; }
    case 'crystal': { const lit = M.id === 'kg_cl', y0 = Math.sin(t / 350 + ph) * 2; g.save(); if (lit) { g.shadowColor = '#ffd43b'; g.shadowBlur = 18 + Math.sin(t / 120) * 6; } g.fillStyle = c; g.beginPath(); g.moveTo(0, -34 + y0); g.lineTo(9, -16 + y0); g.lineTo(0, -2); g.lineTo(-9, -16 + y0); g.closePath(); g.fill(); g.restore(); g.fillStyle = '#ffffff66'; g.beginPath(); g.moveTo(0, -34 + y0); g.lineTo(3, -18 + y0); g.lineTo(0, -6); g.fill(); if (!lit) { g.font = '10px sans-serif'; g.fillText('☠', -5, -14 + y0); } break; }
    case 'turtle': { const y0 = bob * 1, dark = M.id === 'hyeonmu';
      g.fillStyle = dark ? '#2b3a36' : '#0b7285'; for (const [lx, ly] of [[-11, -2], [11, -2], [-9, -12], [9, -12]]) { g.beginPath(); g.ellipse(lx, ly + y0, 4, 3, 0, 0, 7); g.fill(); }
      g.fillStyle = dark ? '#343a40' : c; g.beginPath(); g.ellipse(0, -9 + y0, 14, 11, 0, Math.PI, 0); g.lineTo(14, -6 + y0); g.lineTo(-14, -6 + y0); g.fill();
      g.strokeStyle = dark ? '#3bc9db' : '#c5f6fa'; g.lineWidth = 1; for (const [hx, hy] of [[0, -14], [-7, -10], [7, -10]]) { g.beginPath(); for (let k = 0; k < 6; k++) { const a = k * 1.047; g.lineTo(hx + Math.cos(a) * 3.6, hy + y0 + Math.sin(a) * 3.2); } g.closePath(); g.stroke(); }
      g.fillStyle = dark ? '#495057' : '#15aabf'; g.beginPath(); g.arc(15, -10 + y0, 5, 0, 7); g.fill(); face(g, 15, -11 + y0, .5, angry);
      if (dark) { g.strokeStyle = '#2b8a3e'; g.lineWidth = 3; g.beginPath(); g.moveTo(-13, -8 + y0); g.quadraticCurveTo(-24, -18 + Math.sin(t / 250) * 3, -16, -28 + y0); g.stroke(); g.fillStyle = '#2b8a3e'; g.beginPath(); g.ellipse(-15, -29 + y0, 4, 3, .4, 0, 7); g.fill(); g.fillStyle = '#ff6b6b'; g.beginPath(); g.arc(-13.5, -30 + y0, .9, 0, 7); g.fill(); }
      break; }
    case 'santa': { const y0 = bob * 1.2;
      if (e.fl & 8) { g.fillStyle = '#c92a2a'; rr(g, -20, -12, 40, 12, 5); g.fill(); g.strokeStyle = '#fab005'; g.lineWidth = 2; g.beginPath(); g.moveTo(-22, 2); g.lineTo(22, 2); g.quadraticCurveTo(28, 2, 26, -4); g.stroke(); }
      g.fillStyle = '#8d5a3b'; g.beginPath(); g.ellipse(-12, -16 + y0, 7, 9, -.3, 0, 7); g.fill(); g.fillStyle = '#e03131'; g.fillRect(-14, -26 + y0, 4, 3);
      g.fillStyle = '#212529'; g.fillRect(-6, -6, 5, 6); g.fillRect(1, -6, 5, 6);
      g.fillStyle = c; g.beginPath(); g.ellipse(0, -15 + y0, 11, 11, 0, 0, 7); g.fill(); g.fillStyle = '#fff'; g.fillRect(-1.5, -25 + y0, 3, 18);
      g.fillStyle = '#212529'; g.fillRect(-11, -13 + y0, 22, 3); g.fillStyle = '#fab005'; g.fillRect(-2.5, -13.5 + y0, 5, 4);
      g.fillStyle = '#ffe0c7'; g.beginPath(); g.arc(0, -30 + y0, 7, 0, 7); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.ellipse(0, -24 + y0, 8, 6.5, 0, 0, 7); g.fill(); g.beginPath(); g.ellipse(-3, -27 + y0, 3, 1.6, 0, 0, 7); g.ellipse(3, -27 + y0, 3, 1.6, 0, 0, 7); g.fill();
      g.fillStyle = '#ff8787'; g.beginPath(); g.arc(0, -29 + y0, 1.6, 0, 7); g.fill(); g.fillStyle = '#222'; g.beginPath(); g.arc(-2.6, -31.5 + y0, 1, 0, 7); g.arc(2.6, -31.5 + y0, 1, 0, 7); g.fill();
      g.fillStyle = c; g.beginPath(); g.moveTo(-7, -34 + y0); g.lineTo(7, -34 + y0); g.quadraticCurveTo(8, -44 + y0, 13, -42 + y0); g.closePath(); g.fill(); g.fillStyle = '#fff'; g.fillRect(-8, -35 + y0, 16, 3); g.beginPath(); g.arc(13.5, -42 + y0, 2.5, 0, 7); g.fill();
      break; }
    case 'rudolph': { const y0 = -Math.abs(bob) * 3;
      g.strokeStyle = c; g.lineWidth = 2.5; for (const lx of [-7, -3, 4, 8]) { g.beginPath(); g.moveTo(lx, -8 + y0); g.lineTo(lx + Math.sin(t / 90 + lx) * 1.5, 0); g.stroke(); }
      g.fillStyle = c; g.beginPath(); g.ellipse(0, -11 + y0, 11, 6.5, 0, 0, 7); g.fill(); g.fillStyle = '#f1f3f5'; g.beginPath(); g.ellipse(1, -9 + y0, 6, 3, 0, 0, 7); g.fill();
      g.fillStyle = c; g.beginPath(); g.arc(11, -19 + y0, 5.5, 0, 7); g.fill();
      g.strokeStyle = '#d9a066'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(9, -23 + y0); g.lineTo(6, -31 + y0); g.lineTo(3, -33 + y0); g.moveTo(6, -31 + y0); g.lineTo(8, -34 + y0); g.moveTo(13, -23 + y0); g.lineTo(15, -31 + y0); g.lineTo(18, -33 + y0); g.moveTo(15, -31 + y0); g.lineTo(13, -34 + y0); g.stroke();
      g.save(); g.shadowColor = '#ff0000'; g.shadowBlur = 8 + Math.sin(t / 150) * 4; g.fillStyle = '#ff2b2b'; g.beginPath(); g.arc(16.5, -18 + y0, 2.4, 0, 7); g.fill(); g.restore();
      g.fillStyle = '#222'; g.beginPath(); g.arc(10, -20.5 + y0, 1.1, 0, 7); g.arc(13.5, -20.5 + y0, 1.1, 0, 7); g.fill(); g.fillStyle = '#e03131'; g.fillRect(-4, -16 + y0, 10, 2.5);
      break; }
    case 'zombie': {
      const sw = Math.sin(t / 260 + ph), lean = Math.sin(t / 520 + ph) * .12, id = M.id, king = id === 'zking';
      g.save(); g.rotate(lean);
      g.fillStyle = id === 'zstudent' ? '#1c3d7a' : id === 'zgym' ? '#212529' : id === 'zking' ? '#3b0d0d' : '#495057'; g.fillRect(-5, -10, 4, 10 + sw * 1.5); g.fillRect(1, -10, 4, 10 - sw * 1.5);
      g.fillStyle = '#343a40'; g.fillRect(-6, -1 + sw * 1.5, 5, 2); g.fillRect(1, -1 - sw * 1.5, 5, 2);
      const shirt = { zoffice: '#f1f3f5', zdrunk: '#e8590c', zgym: '#c92a2a', zstudent: '#f8f9fa', zking: '#5f3dc4' }[id] || '#868e96';
      g.fillStyle = shirt; rr(g, -7, -22, 14, 13, 3); g.fill();
      g.fillStyle = c; for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(-6 + k * 5, -9); g.lineTo(-4 + k * 5, -13); g.lineTo(-2 + k * 5, -9); g.fill(); } g.beginPath(); g.arc(3, -17, 1.8, 0, 7); g.fill();
      if (id === 'zoffice') { g.fillStyle = '#1c7ed6'; g.beginPath(); g.moveTo(-1.2, -22); g.lineTo(1.2, -22); g.lineTo(1.6, -14); g.lineTo(0, -12.5); g.lineTo(-1.6, -14); g.fill(); }
      if (id === 'zstudent') { g.fillStyle = '#1c3d7a'; g.fillRect(-6, -22, 2, 12); g.fillRect(4, -22, 2, 12); g.fillStyle = '#fff'; g.fillRect(-4, -18, 5, 2); }
      if (id === 'zgym') { g.fillStyle = '#fff'; g.font = 'bold 4px sans-serif'; g.textAlign = 'center'; g.fillText('GYM', 0, -14); }
      if (king) { g.fillStyle = '#c92a2a'; g.beginPath(); g.moveTo(-8, -22); g.lineTo(-12, -6); g.lineTo(12, -6); g.lineTo(8, -22); g.fill(); g.fillStyle = shirt; rr(g, -7, -22, 14, 13, 3); g.fill(); }
      const arm = id === 'zgym' ? 5.5 : 4; g.strokeStyle = c; g.lineCap = 'round'; g.lineWidth = arm;
      g.beginPath(); g.moveTo(-6, -19); g.lineTo(-14, -18 + sw * 2); g.moveTo(6, -19); g.lineTo(14, -19 - sw * 2); g.stroke();
      g.fillStyle = c; g.beginPath(); g.arc(-15, -18 + sw * 2, arm * .55, 0, 7); g.arc(15, -19 - sw * 2, arm * .55, 0, 7); g.fill();
      if (id === 'zdrunk') { g.fillStyle = '#2f9e44'; rr(g, 13, -27 - sw * 2, 4, 9, 1.5); g.fill(); g.fillRect(14, -30 - sw * 2, 2, 3); }
      g.fillStyle = c; g.beginPath(); g.arc(0, -29, 8, 0, 7); g.fill();
      g.fillStyle = '#343a40'; g.beginPath(); g.arc(-4, -36, 2.5, 0, 7); g.arc(1, -37, 2, 0, 7); g.arc(5, -35, 2, 0, 7); g.fill();
      g.strokeStyle = '#2b2b2b'; g.lineWidth = .8; g.beginPath(); g.moveTo(-6, -33); g.lineTo(2, -31); for (let k = 0; k < 4; k++) { g.moveTo(-5 + k * 2, -34); g.lineTo(-4.4 + k * 2, -31); } g.stroke();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(-3, -29, 2.7, 0, 7); g.fill(); g.fillStyle = '#e03131'; g.beginPath(); g.arc(-3, -29, 1.2, 0, 7); g.fill();
      g.fillStyle = '#1b1b1b'; g.beginPath(); g.arc(3.4, -28.5, 1.4, 0, 7); g.fill();
      g.fillStyle = '#3b0d0d'; rr(g, -3.5, -25, 7, 2.6, 1); g.fill(); g.fillStyle = '#fff'; g.fillRect(-2.5, -25, 1.2, 1.2); g.fillRect(.5, -25, 1.2, 1.2);
      g.fillStyle = '#94d82dcc'; g.beginPath(); g.ellipse(2, -21 + ((t / 90 + ph * 10) % 6), .9, 1.5, 0, 0, 7); g.fill();
      if (id === 'zgym') { g.fillStyle = '#e03131'; g.fillRect(-8, -33, 16, 2); }
      if (king) { g.fillStyle = '#ffd43b'; g.beginPath(); g.moveTo(-7, -36); g.lineTo(-6, -43); g.lineTo(-3, -39); g.lineTo(0, -45); g.lineTo(3, -39); g.lineTo(6, -43); g.lineTo(7, -36); g.fill(); g.fillStyle = '#e03131'; g.beginPath(); g.arc(0, -39, 1.2, 0, 7); g.fill(); }
      g.restore();
      if (boss) { g.fillStyle = '#69db7c'; for (let k = 0; k < 3; k++) { const p2 = ((t / 25 + k * 13 + ph * 7) % 18) / 18; g.globalAlpha = .45 * (1 - p2); g.beginPath(); g.arc(Math.sin(t / 400 + k * 2) * 9, -36 - p2 * 14, 2 + p2 * 2, 0, 7); g.fill(); } g.globalAlpha = 1; }
      if (M.pet) { g.strokeStyle = '#94d82d'; g.globalAlpha = .5 + .3 * Math.sin(t / 150); g.lineWidth = 1.5; g.beginPath(); g.ellipse(0, 0, 12, 4, 0, 0, 7); g.stroke(); g.globalAlpha = 1; }
      break; }
    case 'tuna': { const y0 = Math.sin(t / 450) * 1.2, flap = Math.sin(t / 220) * .25;
      g.fillStyle = '#d0ebff88'; rr(g, -20, -26 + y0, 40, 24, 5); g.fill(); g.strokeStyle = '#ffffffaa'; g.lineWidth = 1; g.strokeRect(-20, -26 + y0, 40, 24);
      g.save(); g.translate(-16, -14 + y0); g.rotate(flap); g.fillStyle = '#4263eb'; g.beginPath(); g.moveTo(0, 0); g.lineTo(-9, -9); g.lineTo(-6, 0); g.lineTo(-9, 9); g.closePath(); g.fill(); g.restore();
      const gr = g.createLinearGradient(0, -24 + y0, 0, -4 + y0); gr.addColorStop(0, '#1c3d7a'); gr.addColorStop(.5, '#74c0fc'); gr.addColorStop(1, '#f1f3f5'); g.fillStyle = gr;
      g.beginPath(); g.moveTo(-16, -14 + y0); g.quadraticCurveTo(-4, -28 + y0, 12, -18 + y0); g.quadraticCurveTo(19, -14 + y0, 12, -9 + y0); g.quadraticCurveTo(-4, -1 + y0, -16, -14 + y0); g.fill();
      g.fillStyle = '#ffd43b'; for (let k = 0; k < 5; k++) { g.beginPath(); g.moveTo(-10 + k * 4, -7 + y0); g.lineTo(-8 + k * 4, -4 + y0); g.lineTo(-6 + k * 4, -7 + y0); g.fill(); }
      g.fillStyle = '#fff'; g.beginPath(); g.arc(10, -16 + y0, 2.6, 0, 7); g.fill(); g.fillStyle = angry ? '#e03131' : '#111'; g.beginPath(); g.arc(10.5, -16 + y0, 1.3, 0, 7); g.fill();
      g.strokeStyle = '#1c3d7a'; g.lineWidth = 1; g.beginPath(); g.moveTo(15, -12 + y0); g.lineTo(18, -12 + y0); g.stroke();
      g.fillStyle = '#fff'; g.font = '6px sans-serif'; for (let k = 0; k < 6; k++) { const a = t / 500 + k * 1.05; g.globalAlpha = .5 + .5 * Math.sin(t / 170 + k); g.fillText('❄', Math.cos(a) * 24 - 3, -16 + Math.sin(a) * 12); } g.globalAlpha = 1;
      break; }
    case 'tennis': {
      const sq = 1 + Math.sin(t / 160 + ph) * .05, y0 = -13 - Math.abs(Math.sin(t / 260 + ph)) * 2;
      g.fillStyle = '#e9ecef'; g.beginPath(); g.ellipse(-6, -2, 4, 2.4, 0, 0, 7); g.ellipse(6, -2, 4, 2.4, 0, 0, 7); g.fill();
      g.strokeStyle = c; g.lineWidth = 3; g.beginPath(); g.moveTo(-6, y0 + 6); g.lineTo(-6, -3); g.moveTo(6, y0 + 6); g.lineTo(6, -3); g.stroke();
      g.fillStyle = c; g.beginPath(); g.ellipse(0, y0, 13 / sq, 12 * sq, 0, 0, 7); g.fill();
      g.fillStyle = '#d8f5a2'; for (let k = 0; k < 18; k++) { const a = k * .349, rr2 = 9 + (k % 3); g.fillRect(Math.cos(a) * rr2 - .6, y0 + Math.sin(a) * rr2 - .6, 1.2, 1.2); }
      g.strokeStyle = '#fff'; g.lineWidth = 1.8; g.beginPath(); g.arc(-15, y0, 11, -.9, .9); g.stroke(); g.beginPath(); g.arc(15, y0, 11, Math.PI - .9, Math.PI + .9); g.stroke();
      g.fillStyle = '#ff6b6b'; g.fillRect(-11, y0 - 9, 22, 3); g.fillStyle = '#fff'; g.font = 'bold 3px sans-serif'; g.textAlign = 'center'; g.fillText('SH', 0, y0 - 6.8);
      face(g, 0, y0 - 1, .85, angry);
      const sw = Math.sin(t / 220 + ph) * .5; g.save(); g.translate(12, y0 + 2); g.rotate(.4 + sw); g.strokeStyle = '#495057'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -8); g.stroke(); g.strokeStyle = '#1c7ed6'; g.lineWidth = 2; g.beginPath(); g.ellipse(0, -14, 5, 6.5, 0, 0, 7); g.stroke(); g.strokeStyle = '#ffffff99'; g.lineWidth = .5; for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(k * 2, -19.5); g.lineTo(k * 2, -8.5); g.moveTo(-4.5, -14 + k * 2.2); g.lineTo(4.5, -14 + k * 2.2); g.stroke(); } g.restore();
      g.fillStyle = '#fff'; g.fillRect(-14, y0 + 2, 3, 3); g.fillRect(11, y0 + 2, 3, 3);
      break; }
    case 'dog': { drawDog(g, t, Math.abs((e.x || 0) - (e.rx || 0)) + Math.abs((e.y || 0) - (e.ry || 0)) > .05, angry); break; }
    case 'human': { g.restore(); g.save(); g.translate(cx, cy); if (e.fl & 4) { g.rotate(Math.sin(t / 180) * .28); } g.scale(1.55, 1.55); const L = M.look || {}; drawChar(g, 0, 0, Object.assign({ n: M.n, d: 0 }, L), t, false, true);
      if (L.shades) { g.font = '9px sans-serif'; for (let k = 0; k < 4; k++) { const a = t / 500 + k * 1.57; g.globalAlpha = .6 + .4 * Math.sin(t / 150 + k); g.fillText(k % 2 ? '✨' : '💖', Math.cos(a) * 20 - 4, -26 + Math.sin(a) * 12); } g.globalAlpha = 1;
      g.fillStyle = '#111'; rr(g, -9, -32, 8, 4, 2); g.fill(); rr(g, 1, -32, 8, 4, 2); g.fill(); g.fillRect(-1, -31, 2, 1); }
      if (L.fangs) { g.font = '8px sans-serif'; g.globalAlpha = .6 + .4 * Math.sin(t / 200); g.fillText('🦇', -26 + Math.sin(t / 300) * 4, -36); g.fillText('🦇', 18, -30 + Math.cos(t / 300) * 4); g.globalAlpha = 1; }
      if (L.grandma && (e.fl & 4)) { g.font = '11px sans-serif'; g.fillText('🍶', 9, -14); g.fillText('💫', -8 + Math.sin(t / 120) * 4, -44); g.fillStyle = '#ff8787aa'; g.beginPath(); g.ellipse(-7, -27, 4, 2.5, 0, 0, 7); g.ellipse(7, -27, 4, 2.5, 0, 0, 7); g.fill(); }
      if (L.grandma) { g.font = 'bold 8px sans-serif'; g.fillStyle = '#ff6b6b'; g.globalAlpha = .5 + .5 * Math.abs(Math.sin(t / 160)); g.fillText('💢', 10, -40); g.globalAlpha = 1; }
      g.restore(); g.save(); g.translate(cx, cy); g.scale(S, S); break; }
  }
  // 보스 장식
  if (boss && !M.raid && M.s !== 'human' && M.s !== 'dog' && M.s !== 'tennis' && M.s !== 'tuna') {
    const top = M.s === 'golem' ? -26 : M.s === 'skull' ? -32 : -24;
    if (e.acc === 0) { g.fillStyle = '#fcc419'; g.beginPath(); g.moveTo(-7, top); g.lineTo(-7, top - 7); g.lineTo(-3.5, top - 3.5); g.lineTo(0, top - 9); g.lineTo(3.5, top - 3.5); g.lineTo(7, top - 7); g.lineTo(7, top); g.fill(); }
    else if (e.acc === 1) { g.fillStyle = '#495057'; g.beginPath(); g.moveTo(-7, top + 2); g.quadraticCurveTo(-13, top - 4, -10, top - 9); g.lineTo(-4, top + 2); g.moveTo(7, top + 2); g.quadraticCurveTo(13, top - 4, 10, top - 9); g.lineTo(4, top + 2); g.fill(); }
    else if (e.acc === 2) { g.strokeStyle = '#ffe066'; g.lineWidth = 1.5; g.beginPath(); g.ellipse(0, top - 4, 8, 2.5, 0, 0, 7); g.stroke(); }
    else { g.fillStyle = '#111'; rr(g, -9, top + 9, 8, 4, 2); g.fill(); rr(g, 1, top + 9, 8, 4, 2); g.fill(); g.fillRect(-1, top + 10, 2, 1); }
  }
  g.restore();
  if (M.raid && (e.fl & 16) && M.s !== 'statue') { g.save(); g.strokeStyle = '#74c0fc'; g.fillStyle = '#74c0fc22'; g.globalAlpha = .6 + .25 * Math.sin(t / 160); g.lineWidth = 3; g.beginPath(); for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + t / 1500; g.lineTo(cx + Math.cos(a) * 16 * S, cy - 14 * S + Math.sin(a) * 18 * S); } g.closePath(); g.fill(); g.stroke(); g.restore(); }
  if (e.fl & 32) { g.font = `bold ${14 + 2 * Math.sin(t / 120)}px Jua`; g.textAlign = 'center'; g.lineWidth = 4; g.strokeStyle = '#000'; g.strokeText('💫 그로기!', cx, cy - 34 * S - 14); g.fillStyle = '#ffe066'; g.fillText('💫 그로기!', cx, cy - 34 * S - 14); for (let i = 0; i < 5; i++) { const a = t / 250 + i * 1.26; g.font = '14px sans-serif'; g.fillText('⭐', cx + Math.cos(a) * 14 * S, cy - 30 * S + Math.sin(a) * 4 * S); } }
  if (e.fl & 1) { for (let i = 0; i < 3; i++) { const a = t / 200 + i * 2.1; g.fillStyle = '#ffe066'; g.font = '10px sans-serif'; g.fillText('★', cx + Math.cos(a) * 11 * S - 4, cy - 28 * S + Math.sin(a) * 3); } }
  if (e.fl & 2) { g.font = '11px sans-serif'; g.fillText('🐌', cx + 10, cy - 22 * S); }
}

/* ============ 아이템 아이콘 ============ */
const iconCache = new Map();
function itemIcon(it) {
  const key = it.type + '|' + (it.b ?? it.k) + '|' + (it.r ?? 0);
  if (iconCache.has(key)) return iconCache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.scale(2, 2);
  const t = 0;
  if (it.type === 'weapon') { g.translate(16, 28); g.rotate(.6); drawWeapon(g, D.WB[it.b].s, it.r, 0, t); }
  else if (it.type === 'armor') { const a = D.AB[it.b]; g.fillStyle = a.c; rr(g, 7, 8, 18, 18, 5); g.fill(); g.fillRect(3, 9, 6, 9); g.fillRect(23, 9, 6, 9); g.fillStyle = rarC(it.r); g.fillRect(7, 20, 18, 3); g.fillStyle = '#0003'; g.beginPath(); g.arc(16, 9, 4, 0, Math.PI); g.fill(); }
  else if (it.type === 'helm') { g.fillStyle = '#ffe0c7'; g.beginPath(); g.arc(16, 22, 9, 0, 7); g.fill(); drawHelm(g, D.HB[it.b].s, it.r, 16, 20, t); }
  else if (it.type === 'bundle' && it.k === 'hwang') { g.fillStyle = '#ffe066'; rr(g, 8, 4, 16, 24, 2); g.fill(); g.strokeStyle = '#c92a2a'; g.lineWidth = 1.5; g.strokeRect(10, 6, 12, 20); g.fillStyle = '#c92a2a'; g.font = 'bold 12px serif'; g.textAlign = 'center'; g.fillText('龍', 16, 20); }
  else if (it.type === 'bundle') { g.fillStyle = '#4dabf7'; g.beginPath(); g.ellipse(16, 21, 11, 9, 0, 0, 7); g.fill(); g.fillStyle = '#1c7ed6'; g.beginPath(); g.moveTo(10, 11); g.lineTo(16, 15); g.lineTo(22, 11); g.lineTo(19, 8); g.lineTo(16, 11); g.lineTo(13, 8); g.fill(); g.fillStyle = '#fff'; g.font = '10px sans-serif'; g.fillText('🐟', 10, 25); }
  else if (it.type === 'scroll') { g.fillStyle = '#fff3bf'; g.fillRect(8, 7, 16, 18); g.fillStyle = it.k === 'ward' ? '#4dabf7' : it.k === 'bless' ? '#be4bdb' : '#ff922b'; g.fillRect(6, 5, 20, 4); g.fillRect(6, 23, 20, 4); g.font = '10px sans-serif'; g.fillText(it.k === 'ward' ? '🛡' : it.k === 'bless' ? '✨' : '✦', 10, 20); }
  else if (it.type === 'potion') { g.fillStyle = '#e9ecef'; g.fillRect(13, 4, 6, 6); g.fillStyle = it.k === 'elixir' ? '#fab005' : it.k.startsWith('hp') ? (it.k === 'hp2' ? '#c92a2a' : '#fa5252') : (it.k === 'mp2' ? '#1864ab' : '#339af0'); if (it.k.endsWith('2') || it.k === 'elixir') { g.save(); g.shadowColor = g.fillStyle; g.shadowBlur = 8; g.beginPath(); g.arc(16, 19, 10, 0, 7); g.fill(); g.restore(); } g.beginPath(); g.arc(16, 19, 9, 0, 7); g.fill(); g.fillStyle = '#fff8'; g.beginPath(); g.arc(13, 16, 2.5, 0, 7); g.fill(); }
  else { g.fillStyle = `hsl(${hash(it.k) % 360},55%,62%)`; g.beginPath(); g.ellipse(16, 20, 10, 8, 0, 0, 7); g.fill(); g.fillStyle = '#c08552'; g.fillRect(12, 9, 8, 5); g.fillStyle = '#fff'; g.font = '11px Jua'; g.textAlign = 'center'; g.fillText(String(it.k)[0], 16, 24); }
  iconCache.set(key, c); return c;
}

/* ============ 이펙트 ============ */
const shouts = [];
function addFx(m) {
  const t = now(); m.t0 = t;
  if (m.mi && m.n) shouts.push({ mi: m.mi, n: m.n, c: m.c, t });
  if (m.i) { const e = ents.get('p' + m.i); if (e && (m.k === 'slash' || m.k === 'proj')) e.sw = t;
    if (m.n && e && !shouts.some(s => s.i === m.i && s.n === m.n && t - s.t < 900)) shouts.push({ i: m.i, n: m.n, c: m.c, t, f: m.f }); }
  if (m.f && m.f.startsWith('u_')) { m.dur = 1700; const me2 = me(); if (me2 && Math.hypot(me2.x - m.x, me2.y - m.y) < 10) { SHAKE = now() + 500; FLASH = now() + 250; } }
  m.dur = m.dur || { slash: 250, proj: 220, ring: 600, boom: 600, dash: 400, abuff: 1400, sbuff: 1100, lvup: 1500, die: 700, bite: 300 }[m.k] || 500;
  if (m.f && m.f.startsWith('u_')) m.dur = 1700;
  if (m.f === 't1' || m.f === 'football' || m.f === 'doristar' || m.f === 'nuke' || m.f === 'dance') m.dur = Math.max(m.dur, 1500);
  if (m.k === 'proj') { const imp = Object.assign({}, m, { k: 'impact', x: m.x2, y: m.y2, t0: t + 200, dur: m.f === 'nuke' ? 1300 : 350 }); fxs.push(imp); }
  fxs.push(m);
  if (m.k === 'slash' && m.f) fxs.push(Object.assign({}, m, { k: 'impact', x: m.x2, y: m.y2, dur: m.f === 'nuke' ? 1300 : 450 }));
}
const tc = v => v * T + T / 2;
function drawFx(g, t) {
  for (let i = fxs.length - 1; i >= 0; i--) {
    const f = fxs[i], p = (t - f.t0) / f.dur; if (p < 0) continue; if (p >= 1) { fxs.splice(i, 1); continue; }
    const x = tc(f.x), y = tc(f.y), c = f.c || '#fff';
    g.save(); g.globalAlpha = 1 - p * .7;
    switch (f.k) {
      case 'slash': { const x2 = tc(f.x2), y2 = tc(f.y2), a = Math.atan2(y2 - y, x2 - x); g.strokeStyle = c; g.lineWidth = 4 * (1 - p) + 1; g.beginPath(); g.arc(x2, y2 - 8, 14, a - 1.6 + p * 2, a - .4 + p * 2); g.stroke(); g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke(); break; }
      case 'proj': { const x2 = tc(f.x2), y2 = tc(f.y2), px = x + (x2 - x) * p, py = y - 14 + (y2 - y) * p; g.fillStyle = c; g.shadowColor = c; g.shadowBlur = 10; g.beginPath(); g.arc(px, py, f.big ? 6 : 3.5, 0, 7); g.fill();
        if (f.f === 'tball') { g.font = '15px sans-serif'; g.fillText('🎾', px - 8, py + 5 - Math.sin(p * Math.PI) * 18); }
        else if (f.f === 'football' || f.n === '프리킥' || f.n === '슈퍼골') { g.font = '14px sans-serif'; g.fillText('⚽', px - 7, py + 5); }
        else if (f.n === '삼각김밥') { g.font = '14px sans-serif'; g.fillText('🍙', px - 7, py + 5); } break; }
      case 'impact': {
        if (f.f === 'nuke') { const r = 10 + p * 34; g.fillStyle = '#ff922b'; g.beginPath(); g.arc(x, y - 6 - p * 30, r * .7, 0, 7); g.fill(); g.fillStyle = '#ffe066'; g.beginPath(); g.arc(x, y - 6 - p * 30, r * .45, 0, 7); g.fill(); g.fillStyle = '#868e96'; g.fillRect(x - 4, y - 6 - p * 30, 8, p * 30); g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.ellipse(x, y, r * 1.4, r * .4, 0, 0, 7); g.stroke(); g.font = 'bold 18px Jua'; g.fillStyle = '#ff5252'; g.textAlign = 'center'; g.fillText('쾅!!', x, y - 50); }
        else if (f.f === 'jaw') { g.translate(x, y - 14); g.rotate(p * 2); g.fillStyle = '#ffe066'; g.beginPath(); for (let k = 0; k < 16; k++) { const rr2 = k % 2 ? 7 : 18 * (1 - p * .3); g.lineTo(Math.cos(k * .3927) * rr2, Math.sin(k * .3927) * rr2); } g.fill(); g.rotate(-p * 2); g.font = 'bold 13px Jua'; g.fillStyle = '#c92a2a'; g.textAlign = 'center'; g.fillText('턱!', 0, 5); }
        else { g.strokeStyle = c; g.lineWidth = 3; g.beginPath(); g.arc(x, y - 10, 6 + p * 14, 0, 7); g.stroke(); }
        break; }
      case 'ring': {
        const R = (f.r || 1.5) * T, r = R * Math.min(1, p * 2.2);
        g.strokeStyle = c; g.lineWidth = 4; g.beginPath(); g.ellipse(x, y, r, r * .55, 0, 0, 7); g.stroke(); g.fillStyle = c + '22'; g.fill();
        if (f.f === 'doristar') { g.font = '16px sans-serif'; for (let k = 0; k < 10; k++) { const a = k * .628 + t / 250; g.fillText('⭐', x + Math.cos(a) * r - 8, y + Math.sin(a) * r * .55 - 10 - Math.sin(p * 3) * 10); } }
        else if (f.f === 'football') { for (let k = 0; k < 6; k++) { const a = k * 1.047 + p * 2, px = x + Math.cos(a) * r * .9, py = y + Math.sin(a) * r * .5; drawPlayerMini(g, px, py, k, t); g.font = '12px sans-serif'; g.fillText('⚽', x + Math.cos(a + .5) * r * 1.2 * p - 6, y + Math.sin(a + .5) * r * .6 * p - 10 - Math.abs(Math.sin(p * 8 + k)) * 10); } }
        else if (f.f === 'tunaswing') { g.globalAlpha = (1 - p) * .9; g.strokeStyle = '#a5d8ff'; g.lineWidth = 6 * (1 - p) + 1; g.beginPath(); g.ellipse(x, y - 6, r * Math.min(1, p * 3), r * Math.min(1, p * 3) * .55, 0, 0, 7); g.stroke(); g.font = '13px sans-serif'; for (let k = 0; k < 8; k++) { const a = k * .785 + p * 3; g.fillText('❄', x + Math.cos(a) * r * p - 6, y - 6 + Math.sin(a) * r * p * .55); } g.globalAlpha = 1; }
        else if (f.f === 'tunafx') { g.font = '18px sans-serif'; for (let k = 0; k < 16; k++) { const a = k * .39 + p * 2, rr2 = r * ((k * 37 % 10) / 10 + .2) * Math.min(1, p * 2); g.fillText(k % 3 ? '❄️' : '🧊', x + Math.cos(a) * rr2 - 9, y + Math.sin(a) * rr2 * .55 - Math.abs(Math.sin(p * 5 + k)) * 18); } g.font = 'bold 22px Jua'; g.textAlign = 'center'; g.fillStyle = '#a5d8ff'; g.strokeStyle = '#000'; g.lineWidth = 4; g.strokeText('❄️ 얼음 꼬리치기!!', x, y - 130); g.fillText('❄️ 얼음 꼬리치기!!', x, y - 130); }
        else if (f.f === 'tennis') { g.font = '16px sans-serif'; for (let k = 0; k < 12; k++) { const a = k * .524 + k * k, rr2 = r * ((k * 37 % 10) / 10), bx = x + Math.cos(a) * rr2, by = y + Math.sin(a) * rr2 * .55; const hop = Math.abs(Math.sin(p * 7 + k)) * 26; g.fillText('🎾', bx - 8, by - hop); } g.font = 'bold 20px Jua'; g.textAlign = 'center'; g.fillStyle = '#c0eb75'; g.strokeStyle = '#000'; g.lineWidth = 4; g.strokeText('스매시!!', x, y - 110 - p * 10); g.fillText('스매시!!', x, y - 110 - p * 10); }
        else if (f.f === 'finish') { g.strokeStyle = '#fff'; g.lineWidth = 3; const tw = r * 1.1; g.beginPath(); g.moveTo(x - tw, y - 16 - Math.sin(p * 9) * 3); g.quadraticCurveTo(x, y - 6 + p * 18, x + tw, y - 16 + Math.sin(p * 9) * 3); g.stroke(); g.strokeStyle = '#e03131'; g.lineWidth = 1.5; g.stroke();
          g.font = 'bold 22px Jua'; g.textAlign = 'center'; g.fillStyle = '#ffe066'; g.strokeStyle = '#000'; g.lineWidth = 4; g.strokeText('🏁 FINISH!', x, y - 64 - p * 14); g.fillText('🏁 FINISH!', x, y - 64 - p * 14); }
        else if (f.f === 'pen') { g.strokeStyle = '#4c6ef5'; g.lineWidth = 2.5; for (let k = 0; k < 14; k++) { const a = k * .449 + p * 2, r1 = r * (.2 + ((k * 37) % 10) / 14), r2 = r1 + 14; g.beginPath(); g.moveTo(x + Math.cos(a) * r1, y - 10 + Math.sin(a) * r1 * .55); g.lineTo(x + Math.cos(a) * r2, y - 10 + Math.sin(a) * r2 * .55); g.stroke(); }
          g.font = 'bold 30px serif'; g.textAlign = 'center'; g.fillStyle = '#fff'; g.strokeStyle = '#4c6ef5'; g.lineWidth = 4; g.strokeText('✝', x, y - 60); g.fillText('✝', x, y - 60); g.font = 'bold 18px Jua'; g.fillStyle = '#4c6ef5'; g.fillText('딸깍!', x + 30, y - 76 - p * 10); }
        else if (f.f && f.f.startsWith('u_')) { drawUlt(g, f, x, y, r, p, t); }
        else if (f.f === 'mic') { g.strokeStyle = '#ff6b6b'; g.lineWidth = 3; for (let k = 0; k < 3; k++) { const rr2 = ((p * 1.6 + k / 3) % 1) * r; g.globalAlpha = 1 - rr2 / r; g.beginPath(); g.ellipse(x, y - 10, rr2, rr2 * .55, 0, 0, 7); g.stroke(); } g.globalAlpha = 1 - p * .5; g.font = 'bold 26px Jua'; g.textAlign = 'center'; g.fillStyle = '#ff6b6b'; g.strokeStyle = '#000'; g.lineWidth = 4; g.strokeText('🎤 !!!', x, y - 80 - p * 10); g.fillText('🎤 !!!', x, y - 80 - p * 10); }
        else if (f.f === 'charm') { g.font = '16px sans-serif'; for (let k = 0; k < 12; k++) { const a = k * .524 + t / 400; g.fillText(k % 3 ? '💖' : '✨', x + Math.cos(a) * r - 8, y + Math.sin(a) * r * .55 - 8 - p * 20); } }
        else if (f.f === 'slowfield') { g.strokeStyle = '#b197fc'; g.lineWidth = 2; g.beginPath(); for (let k = 0; k < 60; k++) { const a = k * .3 + t / 300, rr2 = k / 60 * r; g.lineTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2 * .55); } g.stroke(); g.font = '18px sans-serif'; g.fillText('🐌', x - 9, y - 20); }
        break; }
      case 'boom': { const R = (f.r || 2) * T; g.fillStyle = c; g.globalAlpha = (1 - p) * .55; g.beginPath(); g.ellipse(x, y, R * p, R * p * .6, 0, 0, 7); g.fill(); g.globalAlpha = 1 - p; for (let k = 0; k < 10; k++) { const a = k * .628; g.fillStyle = k % 2 ? '#fff' : c; g.beginPath(); g.arc(x + Math.cos(a) * R * p, y + Math.sin(a) * R * p * .6 - 10, 4 * (1 - p) + 1, 0, 7); g.fill(); } break; }
      case 'dash': { const x2 = tc(f.x2), y2 = tc(f.y2); if (f.f === 'u_convoy') { g.font = '22px sans-serif'; for (let k = 0; k < 6; k++) { const q = Math.min(1, p * 1.6 - k * .08); if (q <= 0) continue; g.fillText(k % 2 ? '🚛' : '🚚', x + (x2 - x) * q - 11, y + (y2 - y) * q - 20 + (k % 3 - 1) * 26); } g.font = 'bold 22px Jua'; g.textAlign = 'center'; g.fillStyle = '#74c0fc'; g.strokeStyle = '#000'; g.lineWidth = 4; g.strokeText('수송대 진격!!', x2, y2 - 70); g.fillText('수송대 진격!!', x2, y2 - 70); } g.strokeStyle = c; g.lineWidth = 12 * (1 - p); g.lineCap = 'round'; g.beginPath(); g.moveTo(x, y - 14); g.lineTo(x2, y2 - 14); g.stroke(); g.font = '16px sans-serif'; if (f.n === '급발진' || f.n === '로드킬') g.fillText('🚙', x2 - 8, y2 - 30); if (f.n === '트럭 돌진' || f.n === '스카니아 박치기') g.fillText('🚛', x2 - 8, y2 - 30); break; }
      case 'abuff': case 'sbuff': {
        const R = f.k === 'abuff' ? (f.r || 4) * T : 20;
        if (f.k === 'abuff') { g.strokeStyle = c; g.lineWidth = 2; g.beginPath(); g.ellipse(x, y, R * Math.min(1, p * 3), R * Math.min(1, p * 3) * .55, 0, 0, 7); g.stroke(); g.fillStyle = c + '18'; g.fill(); }
        const sym = f.f === 'dance' ? ['♪', '♫', '♬'] : f.f === 'heal' ? ['+', '✚'] : f.f === 'speed' ? ['»'] : ['✦', '✧'];
        g.fillStyle = c; g.font = '14px sans-serif'; g.textAlign = 'center';
        for (let k = 0; k < (f.k === 'abuff' ? 16 : 7); k++) { const a = k * 2.4, rr2 = (f.k === 'abuff' ? R * .8 : 16) * ((k * 37 % 10) / 10), py = y - ((p * 50 + k * 7) % 50); g.fillText(sym[k % sym.length], x + Math.cos(a) * rr2, py + Math.sin(a) * rr2 * .4); }
        if (f.f === 't1') {
          const s = Math.min(1, p * 4), yy = y - 70 - (1 - s) * 20;
          g.globalAlpha = p > .8 ? (1 - p) * 5 : 1; g.fillStyle = '#111'; rr(g, x - 52, yy - 24, 104, 40, 8); g.fill(); g.strokeStyle = '#e03131'; g.lineWidth = 3; g.stroke();
          g.font = 'bold 26px Jua'; g.fillStyle = '#ff3b3b'; g.shadowColor = '#ff3b3b'; g.shadowBlur = 14; g.fillText('티~원!', x, yy + 6);
        }
        if (f.f === 'run') { g.font = 'bold 15px Jua'; g.fillStyle = '#40c057'; g.strokeStyle = '#000'; g.lineWidth = 3; g.strokeText('🏃 21.0975km', x, y - 58 - p * 12); g.fillText('🏃 21.0975km', x, y - 58 - p * 12); g.font = '10px sans-serif'; for (let k = 0; k < 6; k++) { g.globalAlpha = (1 - p) * (1 - k / 6); g.fillText('👟', x - 18 - k * 10, y - 4 + (k % 2) * 6); } g.globalAlpha = 1; }
        if (f.f === 'dance') { const sp = Math.sin(t / 90) * 8; g.font = '20px sans-serif'; g.fillText('💃', x - 18 + sp, y - 46); g.fillText('🕺', x + 18 - sp, y - 46); }
        break; }
      case 'lvup': { g.fillStyle = c; g.globalAlpha = (1 - p) * .5; g.fillRect(x - 14, y - 200 * p - 10, 28, 200 * p); g.globalAlpha = 1 - p; g.font = 'bold 18px Jua'; g.textAlign = 'center'; g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 3; const tx = c === '#ff8cff' ? '전직!' : 'LEVEL UP!'; g.strokeText(tx, x, y - 60 - p * 20); g.fillText(tx, x, y - 60 - p * 20); break; }
      case 'die': { for (let k = 0; k < 8; k++) { const a = k * .785; g.fillStyle = k % 2 ? '#fff' : c; g.beginPath(); g.arc(x + Math.cos(a) * p * 22, y - 10 + Math.sin(a) * p * 16, 5 * (1 - p), 0, 7); g.fill(); } break; }
      case 'bite': { g.strokeStyle = c; g.lineWidth = 2; for (let k = -1; k <= 1; k++) { g.beginPath(); g.moveTo(x - 8 + k * 5, y - 22); g.lineTo(x + 4 + k * 5, y - 8); g.stroke(); } break; }
    }
    g.restore();
  }
}
const ULTFX = { u_marathon: ['🏃', '👟', '🏅'], u_jaw: ['💥', '😤', '⚡'], u_concert: ['🎤', '🎵', '💖', '✨'], u_trophy: ['🏆', '🎉', '🎊'], u_nova: ['🌟', '⭐', '✨'], u_trucks: ['🚛', '🚚', '💨'], u_barbell: ['🏋️', '💪', '💥'], u_choir: ['🎶', '🐌', '🎵'], u_wave: ['🌊', '💧', '🐚'], u_worldcup: ['⚽', '🥅', '🏆'], u_convoy: ['🚛'] };
function drawUlt(g, f, x, y, R0, p, t) {
  const em = ULTFX[f.f] || ['✨'], c = f.c || '#fff', R = R0 * Math.min(1, p * 2);
  g.save();
  g.globalAlpha = (1 - p) * .55; const gr = g.createRadialGradient(x, y - 10, 0, x, y - 10, R); gr.addColorStop(0, '#ffffff'); gr.addColorStop(.4, c); gr.addColorStop(1, c + '00'); g.fillStyle = gr; g.beginPath(); g.ellipse(x, y - 10, R, R * .6, 0, 0, 7); g.fill();
  g.globalAlpha = 1 - p; g.lineWidth = 5; g.strokeStyle = c; g.beginPath(); g.ellipse(x, y, R, R * .55, 0, 0, 7); g.stroke(); g.lineWidth = 2; g.strokeStyle = '#fff'; g.beginPath(); g.ellipse(x, y, R * .75, R * .4, 0, 0, 7); g.stroke();
  g.globalAlpha = (1 - p) * .7; g.fillStyle = c; g.fillRect(x - 10 * (1 - p), y - 260, 20 * (1 - p), 260);
  g.globalAlpha = 1 - p * .6; g.font = `${18 + 8 * (1 - p)}px sans-serif`; g.textAlign = 'center';
  for (let k = 0; k < 20; k++) { const a = k * .314 + p * 2 + (k % 2) * .2, rr2 = R * (.3 + .8 * ((k * 37 % 10) / 10)) * (0.4 + p), hop = Math.abs(Math.sin(p * 6 + k)) * 30; g.fillText(em[k % em.length], x + Math.cos(a) * rr2, y + Math.sin(a) * rr2 * .55 - hop); }
  g.globalAlpha = p < .15 ? p / .15 : 1 - Math.max(0, p - .7) / .3; g.font = 'bold 30px Jua'; g.lineWidth = 6; g.strokeStyle = '#000'; g.strokeText(f.n + '!!', x, y - 120 - p * 20); const tg = g.createLinearGradient(x - 100, 0, x + 100, 0); tg.addColorStop(0, '#ffe066'); tg.addColorStop(.5, '#fff'); tg.addColorStop(1, c); g.fillStyle = tg; g.fillText(f.n + '!!', x, y - 120 - p * 20);
  g.restore();
}
function drawPlayerMini(g, x, y, k, t) { // 빨간 유니폼 꼬마 축구선수
  g.save(); g.translate(x, y); g.fillStyle = '#0003'; g.beginPath(); g.ellipse(0, 0, 6, 2, 0, 0, 7); g.fill();
  g.fillStyle = '#fff'; g.fillRect(-3, -5, 6, 4); g.fillStyle = '#e03131'; rr(g, -4, -11, 8, 7, 2); g.fill(); g.fillStyle = '#fff'; g.fillRect(-4, -11, 2, 7); g.fillRect(2, -11, 2, 7);
  g.fillStyle = '#ffe0c7'; g.beginPath(); g.arc(0, -15, 4.5, 0, 7); g.fill(); g.fillStyle = HAIR[k % HAIR.length]; g.beginPath(); g.arc(0, -16, 4.6, Math.PI, 0); g.fill(); g.restore();
}

/* ============ 입력 ============ */
const keys = new Set(); let lastMv = 0, nextMv = 0, nextAtk = 0, chatting = false;
const DIRK = { ArrowDown: 0, ArrowLeft: 1, ArrowRight: 2, ArrowUp: 3, s: 0, a: 1, d: 2, w: 3 };
addEventListener('keydown', e => {
  if (!ME) return;
  const k = e.key;
  if (document.activeElement === $('#chatin')) {
    if (k === 'Enter') { const v = $('#chatin').value.trim(); if (v) send({ t: 'chat', m: v }); $('#chatin').value = ''; closeChat(); }
    else if (k === 'Escape') closeChat();
    return;
  }
  if (k === 'Enter') { openChat(); e.preventDefault(); return; }
  if (k === 'Escape') { closeAll(); dlg = null; drawDlg(); return; }
  if (k in DIRK || k === ' ') e.preventDefault();
  keys.add(k.length === 1 ? k.toLowerCase() : k);
  const kl = k.toLowerCase();
  if ('12345'.includes(k) && k.length === 1) send({ t: 'sk', i: +k - 1 });
  if (kl === 'i') togglePanel('inv'); if (kl === 'e') togglePanel('eq'); if (kl === 'q') togglePanel('quest');
  if (kl === 'b') togglePanel('shop'); if (kl === 'p' && ME.admin) togglePanel('adm'); if (kl === 'j') togglePanel('job'); if (kl === 'h') togglePanel('help');
  if (kl === 'f') actionKey(); if (kl === 'm') togglePanel('world'); if (kl === 'z') send({ t: 'potion', k: 'hp' }); if (kl === 'x') send({ t: 'potion', k: 'mp' });
});
addEventListener('keyup', e => { keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key); });
addEventListener('blur', () => keys.clear());
// 모바일 패드
let padDir = -1, padAtk = false;
document.querySelectorAll('#pad button').forEach(b => {
  const on = e => { e.preventDefault(); padDir = +b.dataset.d; }, off = e => { e.preventDefault(); if (padDir === +b.dataset.d) padDir = -1; };
  b.addEventListener('touchstart', on); b.addEventListener('touchend', off); b.addEventListener('touchcancel', off);
  b.addEventListener('mousedown', on); b.addEventListener('mouseup', off); b.addEventListener('mouseleave', off);
});
const ab = $('#abtn');
ab.addEventListener('touchstart', e => { e.preventDefault(); padAtk = true; }); ab.addEventListener('touchend', e => { e.preventDefault(); padAtk = false; });
ab.addEventListener('mousedown', () => padAtk = true); ab.addEventListener('mouseup', () => padAtk = false);
$('#pickb').onclick = () => actionKey();

function me() { return ents.get('p' + myId); }
function blockedAt(x, y) {
  if (!MAP || x < 0 || y < 0 || x >= MAP.w || y >= MAP.h || (MAP.rows[y][x] !== '.' && MAP.rows[y][x] !== 'L' && MAP.rows[y][x] !== 'X')) return true;
  return false;
}
function inputTick(t) {
  const m = me(); if (!m) return;
  let d = -1;
  if (padDir >= 0) d = padDir;
  else for (const k of ['ArrowUp', 'w', 'ArrowDown', 's', 'ArrowLeft', 'a', 'ArrowRight', 'd']) if (keys.has(k)) { d = DIRK[k]; break; }
  if (d >= 0 && t >= nextMv && !(m.bf & 16)) {
    const rate = (m.bf & 8) ? 330 : (m.bf & 4) ? 70 : 135;
    nextMv = t + rate; send({ t: 'mv', d }); m.d = d;
    const nx = m.x + [0, -1, 1, 0][d], ny = m.y + [1, 0, 0, -1][d];
    if (!blockedAt(nx, ny)) { m.x = nx; m.y = ny; lastMv = t; }
  }
  if ((keys.has(' ') || padAtk) && t >= nextAtk) { nextAtk = t + 150; send({ t: 'atk' }); }
}

// 캔버스 클릭 → 다른 사람 메뉴
cv.addEventListener('click', ev => {
  hideCtx(); const m = me(); if (!m) return;
  const wx = (ev.clientX - W / 2) / ZOOM + cam.x, wy = (ev.clientY - H / 2) / ZOOM + cam.y;
  const npc = (MAP.npcs || []).find(n => Math.hypot(tc(n.x) - wx, tc(n.y) - 14 - wy) < 28);
  if (npc) { if (Math.abs(npc.x - m.x) <= 2 && Math.abs(npc.y - m.y) <= 2) send({ t: 'npc', id: npc.id }); else toast(npc.n + '에게 더 가까이 가세요'); return; }
  let best = null, bd = 30;
  for (const e of ents.values()) if (e.kind === 'p' && e.i !== myId) { const d = Math.hypot(tc(e.rx) - wx, tc(e.ry) - 14 - wy); if (d < bd) { bd = d; best = e; } }
  if (!best) return;
  const c = $('#ctx'); c.classList.remove('hidden'); c.style.left = Math.min(ev.clientX, W - 150) + 'px'; c.style.top = Math.min(ev.clientY, H - 120) + 'px';
  c.innerHTML = `<div style="padding:2px 4px;color:${FACS[best.f][1]}">${esc(best.n)} Lv.${best.l} ${D.JOBS[best.j] ? D.JOBS[best.j].icon + D.JOBS[best.j].n : ''}</div>
    <button id="cw">💬 귓속말</button><button id="cp">🃏 아이템 포커 신청</button>`;
  $('#cw').onclick = () => { hideCtx(); openChat('/w ' + best.n + ' '); };
  $('#cp').onclick = () => { hideCtx(); send({ t: 'pk', s: 'invite', to: best.i }); };
});
const hideCtx = () => $('#ctx').classList.add('hidden');

/* ============ 렌더 루프 ============ */
const cam = { x: 0, y: 0 };
let lastT = now();
function frame() {
  const t = now(), dt = Math.min(.1, (t - lastT) / 1000); lastT = t;
  inputTick(t);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = MAP ? ({ arena4: '#081426', arena5: '#1c1408', royale: '#2b8a3e', altar: '#1d1830', arena1: '#22301a', arena2: '#1a0d0a', arena3: '#141020', cave: '#1a1218', street: '#25262b', gym: '#343a40', hall: '#868e96', sauna: '#99e9f2', station: '#495057', market: '#5c3d2e', lake: '#2b8a3e', forest: '#1b4332', sewer: '#1a2418', factory: '#212529', tunnel: '#0b0b12', castle: '#1a0a10', temple1: '#061526', temple2: '#495057', temple3: '#1f0505', temple4: '#06140f', arena7: '#0d0d10', arena6: '#a5d8ff', bunker: '#1a1c1f', comic: '#f8f9fa', ruins: '#2b2219' }[MAP.theme] || '#2b8a3e') : '#2b8a3e'; ctx.fillRect(0, 0, W, H);
  const m = me();
  if (MAP && mapCv) {
    for (const e of ents.values()) { const k = Math.min(1, dt * 14); e.rx += (e.x - e.rx) * k; e.ry += (e.y - e.ry) * k; }
    if (m) { cam.x = tc(m.rx); cam.y = tc(m.ry); }
    const sk = t < SHAKE ? 7 * ((SHAKE - t) / 600) : 0, sx = (Math.random() - .5) * sk, sy = (Math.random() - .5) * sk;
    ctx.setTransform(DPR * ZOOM, 0, 0, DPR * ZOOM, DPR * (W / 2 - cam.x * ZOOM + sx), DPR * (H / 2 - cam.y * ZOOM + sy));
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(mapCv, 0, 0);
    // 포탈
    for (const p of MAP.portals) {
      const x = tc(p.x), y = tc(p.y);
      ctx.save(); ctx.translate(x, y); for (let k = 0; k < 3; k++) { ctx.rotate(t / 400); ctx.strokeStyle = ['#b197fc', '#74c0fc', '#fff'][k]; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(0, 0, 13 - k * 4, 8 - k * 2, 0, 0, 4.5); ctx.stroke(); } ctx.restore();
      ctx.font = '11px Jua'; ctx.textAlign = 'center'; ctx.fillStyle = '#000a'; const tw = ctx.measureText(p.n).width + 10; rr(ctx, x - tw / 2, y - 34, tw, 16, 6); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText('→ ' + p.n, x, y - 22);
    }
    // 바닥 아이템
    for (const gi of ground) {
      const x = tc(gi[1]), y = tc(gi[2]) + Math.sin(t / 300 + gi[0]) * 2, rc = gi[6] === 1 ? '#ffd43b' : gi[3] ? D.RAR[gi[3]].c : '#fff', mine = !gi[5] || gi[5] === myId;
      ctx.save(); ctx.globalAlpha = mine ? 1 : .45; ctx.shadowColor = rc; ctx.shadowBlur = gi[3] >= 3 ? 14 : 5;
      if (gi[6] === 1) { ctx.fillStyle = '#fab005'; for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.ellipse(x - 4 + k * 4, y + 3 - k * 3, 5, 3, 0, 0, 7); ctx.fill(); } ctx.fillStyle = '#ffe066'; ctx.beginPath(); ctx.ellipse(x + 4, y - 3, 5, 3, 0, 0, 7); ctx.fill(); }
      else if (gi[6] === 2) { ctx.fillStyle = '#5c3d2e'; rr(ctx, x - 8, y - 6, 16, 12, 3); ctx.fill(); ctx.fillStyle = rc; rr(ctx, x - 8, y - 6, 16, 4, 2); ctx.fill(); ctx.fillRect(x - 1.5, y - 3, 3, 5); }
      else { ctx.fillStyle = rc; ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 7); ctx.lineTo(x - 5, y); ctx.fill(); }
      ctx.restore();
      if ((gi[6] === 2 && gi[3] >= 2) || (m && Math.abs(gi[1] - m.x) <= 1 && Math.abs(gi[2] - m.y) <= 1)) { ctx.font = '10px Jua'; ctx.textAlign = 'center'; ctx.fillStyle = '#000'; ctx.fillText(gi[4], x + 1, y - 11); ctx.fillStyle = rc; ctx.fillText(gi[4], x, y - 12); }
    }
    for (const [x, y] of LAVA) { const a = .25 + .2 * Math.sin(t / 250 + x * 1.3 + y); ctx.fillStyle = `rgba(255,212,59,${a})`; ctx.beginPath(); ctx.arc(x * T + 16 + Math.sin(t / 400 + y) * 5, y * T + 16, 5 + 3 * Math.sin(t / 300 + x), 0, 7); ctx.fill(); }
    for (const [x, y, ci, on] of PLATES.l || []) {
      const cx2 = x * T + 16, cy2 = y * T + 16, col = ['#ff6b6b', '#4dabf7', '#51cf66', '#ffd43b', '#da77f2'][ci], pul = Math.sin(t / 180) * 3;
      ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = on ? 22 : 12; ctx.globalAlpha = on ? 1 : .85;
      ctx.fillStyle = col + (on ? 'ee' : '66'); ctx.beginPath(); ctx.ellipse(cx2, cy2 + 4, 15 + pul, 8 + pul / 2, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
      if (!on) { ctx.save(); ctx.globalAlpha = .5 + .5 * Math.sin(t / 200); ctx.fillStyle = col; ctx.fillRect(cx2 - 1.5, cy2 - 40, 3, 34); ctx.beginPath(); ctx.moveTo(cx2 - 7, cy2 - 12); ctx.lineTo(cx2 + 7, cy2 - 12); ctx.lineTo(cx2, cy2 - 3); ctx.fill(); ctx.restore(); }
      ctx.font = 'bold 13px Jua'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.fillText(on ? '✓' : (PLATES.seq ? '' : PLATES.sim ? '🗼' : '밟기'), cx2, cy2 + 8);
    }
    if (SHARE && t < SHARE.until) { const sx = tc(SHARE.x), sy = tc(SHARE.y), rr3 = (SHARE.r + .5) * T, inn = [...ents.values()].filter(e => e.kind === 'p' && Math.hypot(e.x - SHARE.x, e.y - SHARE.y) <= SHARE.r + .3).length, left = Math.ceil((SHARE.until - t) / 1000);
      ctx.save(); ctx.fillStyle = `rgba(255,212,59,${.18 + .1 * Math.sin(t / 120)})`; ctx.beginPath(); ctx.arc(sx, sy, rr3, 0, 7); ctx.fill(); ctx.strokeStyle = '#ffd43b'; ctx.lineWidth = 4; ctx.setLineDash([10, 6]); ctx.lineDashOffset = -t / 30; ctx.stroke(); ctx.setLineDash([]);
      ctx.font = 'bold 18px Jua'; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = '#000'; const lab = `👥 ${inn}/3 모이기! ${left}`; ctx.strokeText(lab, sx, sy - rr3 - 8); ctx.fillStyle = inn >= 3 ? '#69db7c' : '#ffd43b'; ctx.fillText(lab, sx, sy - rr3 - 8); ctx.restore(); }
    for (const id in MARKS) { if (t > MARKS[id]) { delete MARKS[id]; continue; } const e = ents.get('p' + id); if (!e) continue; const x = tc(e.rx), y = tc(e.ry) + 12; ctx.save(); ctx.strokeStyle = '#ff922b'; ctx.lineWidth = 3; ctx.globalAlpha = .5 + .4 * Math.sin(t / 90); ctx.beginPath(); ctx.ellipse(x, y, 2.5 * T + 16, (2.5 * T + 16) * .55, 0, 0, 7); ctx.stroke(); ctx.globalAlpha = 1; ctx.font = '22px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('💣', x, y - 70); ctx.font = 'bold 14px Jua'; ctx.fillStyle = '#ff922b'; ctx.fillText(Math.ceil((MARKS[id] - t) / 1000), x + 16, y - 78); ctx.restore(); }
    // NPC
    for (const n of MAP.npcs || []) {
      const x = tc(n.x), y = tc(n.y) + 12; drawChar(ctx, x, y, { n: n.n, d: 0, w: n.look.w, ar: n.look.ar, he: n.look.he }, t, false);
      ctx.font = '11px Jua'; ctx.textAlign = 'center'; ctx.fillStyle = '#000'; ctx.fillText(n.n, x + 1, y + 14); ctx.fillStyle = '#8ce99a'; ctx.fillText(n.n, x, y + 13);
      const mk = npcMark(n.id); if (mk) { const by = y - 56 + Math.sin(t / 200) * 3; ctx.font = 'bold 22px Jua'; ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.strokeText(mk, x, by); ctx.fillStyle = mk === '!' ? '#ffd43b' : '#69db7c'; ctx.fillText(mk, x, by); }
    }
    // 엔티티 (y 정렬)
    const list = [...ents.values()].sort((a, b) => a.ry - b.ry);
    const vw = W / ZOOM / 2 + 64, vh = H / ZOOM / 2 + 64;
    for (const e of list) {
      const x = tc(e.rx), y = tc(e.ry) + 12; if (Math.abs(x - cam.x) > vw || Math.abs(y - cam.y) > vh) continue;
      const moving = Math.abs(e.x - e.rx) + Math.abs(e.y - e.ry) > .05;
      if (e.kind === 'p') { drawChar(ctx, x, y, e, t, moving); if (e.iv) { ctx.save(); ctx.strokeStyle = '#ffd43b'; ctx.fillStyle = 'rgba(255,212,59,.15)'; ctx.lineWidth = 2.5; ctx.globalAlpha = .7 + .3 * Math.sin(t / 90); ctx.beginPath(); ctx.ellipse(x, y - 18, 20, 28, 0, 0, 7); ctx.fill(); ctx.stroke(); ctx.restore(); } } else drawMob(ctx, x, y, e, t);
    }
    // 이름/체력바/말풍선
    for (const e of list) {
      const x = tc(e.rx), y = tc(e.ry) + 12; if (Math.abs(x - cam.x) > vw || Math.abs(y - cam.y) > vh) continue;
      ctx.textAlign = 'center';
      if (e.kind === 'p') {
        const J = D.JOBS[e.j], fc = FACS[e.f] ? FACS[e.f][1] : '#fff', enemy = MAP.id === 'royale' ? e.i !== myId : /^(raid|temple)/.test(MAP.id) ? false : e.f !== faction;
        ctx.font = '11px Jua'; const label = (e.ad ? '👑 ' : '') + (J ? J.icon : '') + ' ' + e.n + ' Lv' + e.l;
        ctx.fillStyle = '#000'; ctx.fillText(label, x + 1, y + 14); ctx.fillStyle = e.i === myId ? '#fff' : fc; ctx.fillText(label, x, y + 13);
        const TT = e.tt && D.TITLES && D.TITLES[e.tt];
        if (TT) { ctx.font = 'bold 10px Jua'; ctx.fillStyle = '#000'; ctx.fillText('«' + TT.n + '»', x + 1, y + 26); ctx.fillStyle = TT.c; ctx.fillText('«' + TT.n + '»', x, y + 25); }
        if (enemy) { ctx.font = '9px Jua'; ctx.fillStyle = '#ff6b6b'; ctx.fillText(MAP.id === 'royale' ? '⚔ 적' : '⚔ 적 진영 ' + FACS[e.f][0], x, y + (TT ? 36 : 24)); }
        const up = e.mt ? 15 : 0;
        if (e.h < e.H) hpBar(ctx, x, y - 50 - up, 26, e.h / e.H, enemy ? '#ff6b6b' : '#51cf66');
        if (e.bb) bubble(ctx, x, y - 58 - up, e.bb);
      } else {
        const M = D.MON[e.t], S = M.boss ? (M.big || 1.9) : 1;
        if (M.raid) { if (e.mb && t < e.mbT) bubble(ctx, x, y - 34 * S - 10, e.mb, e.loud); if (['zarm', 'tentacle', 'clockclone'].includes(M.id) || M.guard) hpBar(ctx, x, y - 40 * S, M.guard ? 26 : 40, e.h / e.H, '#fa5252'); if (M.guard && m && Math.hypot(e.x - m.x, e.y - m.y) < 5) { ctx.font = '9px Jua'; ctx.fillStyle = '#ffd43b'; ctx.fillText(M.n, x, y + 10); } }
        else if (M.boss) { ctx.font = 'bold 13px Jua'; const n = (e.v != null ? D.VAR[e.v].p + ' ' : '') + M.n + (M.s === 'human' ? (M.look && M.look.grandma ? ' 🎤' : M.look && M.look.fangs ? ' 🧛' : ' ✨') : M.s === 'dog' ? ' 🐶' : M.s === 'tennis' ? ' 🎾' : M.s === 'tuna' ? ' 🐟' : M.s === 'zombie' ? ' 🧟' : M.hw ? ' 🐲' : ''); ctx.fillStyle = '#000'; ctx.fillText('👑 ' + n, x + 1, y - 34 * S - 9); ctx.fillStyle = '#ffe066'; ctx.fillText('👑 ' + n, x, y - 34 * S - 10); hpBar(ctx, x, y - 34 * S - 4, 60, e.h / e.H, '#fa5252'); if (e.mb && t < e.mbT) bubble(ctx, x, y - 34 * S - 26, e.mb, e.loud); }
        else if (e.fl & 64) { ctx.font = '9px Jua'; ctx.fillStyle = '#000'; ctx.fillText('🧟 아군 좀비', x + 1, y + 11); ctx.fillStyle = '#94d82d'; ctx.fillText('🧟 아군 좀비', x, y + 10); }
        else { if (e.h < e.H) hpBar(ctx, x, y - 30, 22, e.h / e.H, '#fa5252'); if (m && Math.hypot(e.x - m.x, e.y - m.y) < 4) { ctx.font = '9px Jua'; ctx.fillStyle = '#fff'; ctx.fillText(M.n + ' Lv' + M.lv, x, y + 10); } }
      }
    }
    for (let i = WARN.length - 1; i >= 0; i--) { const w = WARN[i]; if (t > w.until + 100) { WARN.splice(i, 1); continue; } const p = Math.min(1, (t - w.t0) / (w.until - w.t0)); ctx.fillStyle = w.c || '#ff0000'; ctx.globalAlpha = .18 + .32 * p + .12 * Math.sin(t / 60); for (const [x, y] of w.tiles) ctx.fillRect(x * T + 1, y * T + 1, T - 2, T - 2); ctx.globalAlpha = .9; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; for (const [x, y] of w.tiles) ctx.strokeRect(x * T + 3 + (1 - p) * 10, y * T + 3 + (1 - p) * 10, T - 6 - (1 - p) * 20, T - 6 - (1 - p) * 20); ctx.globalAlpha = 1; }
    for (let i = HZ.length - 1; i >= 0; i--) { const h = HZ[i], p = (t - h.t0) / 450; if (p >= 1) { HZ.splice(i, 1); continue; } ctx.globalAlpha = 1 - p; for (const [x, y] of h.tiles) { ctx.fillStyle = '#fff'; ctx.fillRect(x * T, y * T, T, T); ctx.fillStyle = h.c || '#ff6b6b'; ctx.beginPath(); ctx.arc(x * T + 16, y * T + 16, 6 + p * 14, 0, 7); ctx.fill(); } ctx.globalAlpha = 1; }
    drawFx(ctx, t);
    if (m && ground.some(g => Math.abs(g[1] - m.x) <= 1 && Math.abs(g[2] - m.y) <= 1)) { const x = tc(m.rx), y = tc(m.ry) + 46; ctx.font = 'bold 12px Jua'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText('F / 줍기 버튼', x, y); ctx.fillStyle = '#ffe066'; ctx.fillText('F / 줍기 버튼', x, y); }
    // 스킬 외침
    for (let i = shouts.length - 1; i >= 0; i--) {
      const s = shouts[i], p = (t - s.t) / 1300; if (p >= 1) { shouts.splice(i, 1); continue; }
      const e = ents.get(s.mi ? 'm' + s.mi : 'p' + s.i); if (!e) continue; const x = tc(e.rx), y = s.mi ? tc(e.ry) - 70 - p * 10 : tc(e.ry) + 46 - p * 10;
      ctx.globalAlpha = 1 - Math.max(0, p - .6) * 2.5; ctx.font = 'bold 15px Jua'; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.strokeText(s.n + '!', x, y); ctx.fillStyle = s.c; ctx.fillText(s.n + '!', x, y); ctx.globalAlpha = 1;
    }
    // 데미지 숫자
    for (let i = dmgs.length - 1; i >= 0; i--) {
      const d = dmgs[i], p = (t - d.t) / 900; if (p >= 1) { dmgs.splice(i, 1); continue; }
      const x = tc(d.x) + d.ox, y = tc(d.y) - 20 - p * 26; ctx.globalAlpha = 1 - p * p; ctx.font = `bold ${d.cr ? 18 : 13}px Jua`; ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = '#000'; const s = (d.c === '#69db7c' ? '+' : '') + d.v + (d.cr && typeof d.v === 'number' ? '!' : ''); ctx.strokeText(s, x, y); ctx.fillStyle = d.c; ctx.fillText(s, x, y); ctx.globalAlpha = 1;
    }
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (MOOD === 'lava') { const gr = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .25, W / 2, H / 2, Math.max(W, H) * .7); gr.addColorStop(0, 'rgba(255,80,0,0)'); gr.addColorStop(1, `rgba(200,30,0,${.35 + .1 * Math.sin(t / 300)})`); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#ffa94d'; for (let k = 0; k < 18; k++) { const ex = (k * 97 + t / 20 * (1 + k % 3)) % W, ey = H - ((t / 12 * (1 + k % 4) + k * 53) % H); ctx.globalAlpha = .6; ctx.fillRect(ex, ey, 2, 2); } ctx.globalAlpha = 1; }
    if (MOOD === 'dark') { const gr = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .18, W / 2, H / 2, Math.max(W, H) * .6); gr.addColorStop(0, 'rgba(10,0,30,0)'); gr.addColorStop(1, 'rgba(10,0,30,.82)'); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H); }
    if (MOOD === 'zombie') {
      ctx.fillStyle = `rgba(40,150,40,${.17 + .05 * Math.sin(t / 700)})`; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(160,240,140,.07)'; for (let k = 0; k < 7; k++) { const fx2 = ((k * 211 + t / (30 + k * 6)) % (W + 400)) - 200, fy = H * (.15 + (k % 4) * .22) + Math.sin(t / 900 + k) * 30; ctx.beginPath(); ctx.ellipse(fx2, fy, 200 + k * 20, 50 + k * 6, 0, 0, 7); ctx.fill(); }
      const gr = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .22, W / 2, H / 2, Math.max(W, H) * .68); gr.addColorStop(0, 'rgba(10,40,5,0)'); gr.addColorStop(1, 'rgba(6,30,4,.7)'); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#8ce99a'; for (let k = 0; k < 24; k++) { const ex = (k * 137 + Math.sin(t / 900 + k) * 40 + W) % W, ey = H - ((t / (14 + k % 5 * 4) + k * 71) % H); ctx.globalAlpha = .25 + .35 * Math.abs(Math.sin(t / 500 + k)); ctx.beginPath(); ctx.arc(ex, ey, 1.5 + k % 3, 0, 7); ctx.fill(); } ctx.globalAlpha = 1;
    }
    if (MOOD === 'snow') { ctx.fillStyle = 'rgba(200,230,255,.12)'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#fff'; for (let k = 0; k < 70; k++) { const sx = (k * 97 + Math.sin(t / 700 + k) * 30 + t / (40 + k % 7 * 6)) % W, sy = (t / (12 + k % 5 * 5) + k * 53) % H; ctx.globalAlpha = .5 + .4 * Math.sin(k); ctx.beginPath(); ctx.arc(sx, sy, 1 + k % 3, 0, 7); ctx.fill(); } ctx.globalAlpha = 1; }
    if (MOOD === 'quake') { ctx.fillStyle = `rgba(80,60,40,${.12 + .05 * Math.sin(t / 200)})`; ctx.fillRect(0, 0, W, H); }
    const MINI = ['zarm', 'tentacle', 'clockclone'];
    const rb = [...ents.values()].filter(e => e.kind === 'm' && ((D.MON[e.t].raid && !D.MON[e.t].guard && !MINI.includes(D.MON[e.t].id)) || D.MON[e.t].hw));
    const arms0 = [...ents.values()].some(e => e.kind === 'm' && D.MON[e.t].id === 'zarm');
    rb.forEach((e, k) => { const M = D.MON[e.t], bw = Math.min(460, W - 40), x0 = (W - bw) / 2, y0 = 92 + k * 30; ctx.fillStyle = '#000b'; rr(ctx, x0 - 4, y0 - 15, bw + 8, 28, 8); ctx.fill(); ctx.fillStyle = '#3b0d0d'; ctx.fillRect(x0, y0, bw, 9); ctx.fillStyle = (e.fl & 32) ? '#ffd43b' : (e.fl & 16) ? '#74c0fc' : '#fa5252'; ctx.fillRect(x0, y0, bw * Math.max(0, e.h / e.H), 9); ctx.font = '12px Jua'; ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.fillText(`👑 ${M.n}${(e.fl & 32) ? ' 💫 그로기! 피해 1.5배' : (e.fl & 16) ? (arms0 && M.id === 'zbody' && !(PLATES.l && PLATES.l.length) ? ' (무적 · 팔을 먼저 부수세요)' : ' 🛡 보호막 · 발판을 밟으세요') : ''}`, x0, y0 - 3); ctx.textAlign = 'right'; ctx.fillText(`${Math.max(0, Math.round(e.h / e.H * 100))}%`, x0 + bw, y0 - 3); });
    if (STAG && MAP.id === 'raid7') { const bw = Math.min(300, W - 60), x0 = (W - bw) / 2, y0 = 92 + rb.length * 30 + 4; ctx.fillStyle = '#000b'; rr(ctx, x0 - 4, y0 - 14, bw + 8, 24, 7); ctx.fill(); ctx.fillStyle = '#3d3459'; ctx.fillRect(x0, y0, bw, 7); ctx.fillStyle = '#69db7c'; ctx.fillRect(x0, y0, bw * STAG.v / 100, 7); ctx.font = '11px Jua'; ctx.textAlign = 'left'; ctx.fillStyle = '#d3f9d8'; ctx.fillText(`💫 무력화 게이지 ${STAG.v}% · ${STAG.ph || 1}페이즈 · 뒤에서 때리면 차요`, x0, y0 - 3); }
    if (PLATES.l && PLATES.l.length) { const emo = ['🔴', '🔵', '🟢', '🟡', '🟣'], yy = 92 + rb.length * 30 + 26; ctx.font = '15px Jua'; ctx.textAlign = 'center'; ctx.fillStyle = '#000a'; const txt = PLATES.sim ? `🗼 3명이 동시에 밟기: ${PLATES.l.filter(p => p[3]).length}/${PLATES.l.length}${PLATES.hold ? ' · 유지 ' + (PLATES.hold / 1000).toFixed(1) + '/2초' : ''}` : PLATES.seq ? '순서대로 밟기: ' + PLATES.seq.map((c, k) => (k < PLATES.i ? '✅' : emo[c])).join(' → ') : `🧊 냉각 발판 ${PLATES.l.filter(p => p[3]).length}/${PLATES.l.length} (10초 유지)`; const tw = ctx.measureText(txt).width + 20; rr(ctx, W / 2 - tw / 2, yy - 18, tw, 26, 8); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText(txt, W / 2, yy); }
    const arms = [...ents.values()].filter(e => e.kind === 'm' && MINI.includes(D.MON[e.t].id)).length; if (arms) { ctx.font = '13px Jua'; ctx.textAlign = 'center'; ctx.fillStyle = '#ced4da'; ctx.fillText(`${MAP.id === 'raid4' ? '🐙 남은 촉수' : MAP.id === 'raid5' ? '👥 남은 분신' : '🦾 남은 팔'}: ${arms}`, W / 2, 92 + rb.length * 30 + 6); }
    if (ZBAN && t - ZBAN.t < ZBAN.ms) {
      const p = (t - ZBAN.t) / ZBAN.ms, a = p < .08 ? p / .08 : p > .8 ? (1 - p) / .2 : 1, fs = Math.min(ZBAN.small ? 34 : 50, W / (ZBAN.small ? 12 : 11)), cy = H * .3;
      ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = '#04140488'; ctx.fillRect(0, cy - fs * 1.2, W, fs * 2.6);
      ctx.fillStyle = '#69db7c'; ctx.fillRect(0, cy - fs * 1.2, W, 2); ctx.fillRect(0, cy + fs * 1.4, W, 2);
      ctx.textAlign = 'center'; ctx.font = `bold ${fs}px Jua`; ctx.lineWidth = 8; ctx.strokeStyle = '#051a05'; const jx = Math.sin(t / 40) * (p < .3 ? 3 : 1);
      ctx.strokeText(ZBAN.txt, W / 2 + jx, cy + fs * .2); const tg = ctx.createLinearGradient(0, cy - fs, 0, cy + fs * .3); tg.addColorStop(0, '#d3f9d8'); tg.addColorStop(1, '#40c057'); ctx.fillStyle = tg; ctx.fillText(ZBAN.txt, W / 2 + jx, cy + fs * .2);
      ctx.fillStyle = '#69db7c'; for (let k = 0; k < 9; k++) { const dx = W / 2 + (k - 4) * fs * .9, dy = cy + fs * .3 + ((t / 8 + k * 37) % (fs * 1.1)); ctx.beginPath(); ctx.ellipse(dx, dy, 2.5, 4, 0, 0, 7); ctx.fill(); }
      ctx.font = `${Math.max(13, fs * .36)}px Jua`; ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.strokeText(ZBAN.sub, W / 2, cy + fs * 1.05); ctx.fillStyle = '#d3f9d8'; ctx.fillText(ZBAN.sub, W / 2, cy + fs * 1.05);
      ctx.restore();
    }
    if (t < FLASH) { ctx.fillStyle = `rgba(255,255,255,${(FLASH - t) / 250 * .55})`; ctx.fillRect(0, 0, W, H); }
    if (COUNT && t < COUNT + 900) { const left = (COUNT - t) / 1000, txt = left > 0 ? String(Math.ceil(Math.min(3, left))) : '시작!!', ph2 = left > 0 ? left % 1 : (t - COUNT) / 900; ctx.save(); ctx.fillStyle = '#0006'; ctx.fillRect(0, 0, W, H); ctx.font = `bold ${120 + ph2 * 60}px Jua`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 10; ctx.strokeStyle = '#000'; ctx.globalAlpha = Math.min(1, .3 + ph2); ctx.strokeText(txt, W / 2, H / 2); ctx.fillStyle = left > 0 ? '#ffd43b' : '#ff6b6b'; ctx.fillText(txt, W / 2, H / 2); ctx.restore(); }
    if (MAP.id === 'royale' && ROYN) { ctx.font = 'bold 18px Jua'; ctx.textAlign = 'center'; const txt = `🔥 무한장 · 생존 ${ROYN}명`; const tw = ctx.measureText(txt).width + 24; ctx.fillStyle = '#c92a2acc'; rr(ctx, W / 2 - tw / 2, 54, tw, 30, 10); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText(txt, W / 2, 75); }
    drawMinimap(m);
  }
  updSkillCd(t);
  requestAnimationFrame(frame);
}
function hpBar(g, x, y, w, p, c) { g.fillStyle = '#000a'; g.fillRect(x - w / 2 - 1, y - 1, w + 2, 5); g.fillStyle = c; g.fillRect(x - w / 2, y, w * Math.max(0, p), 3); }
function bubble(g, x, y, s, loud) {
  g.font = '12px Jua'; const lines = []; let cur = '';
  for (const ch of s) { cur += ch; if (g.measureText(cur).width > 110) { lines.push(cur); cur = ''; } } if (cur) lines.push(cur);
  const L = lines.slice(0, 4), w = Math.max(...L.map(l => g.measureText(l).width)) + 14, h = L.length * 15 + 8, by = y - h;
  g.fillStyle = loud ? '#fff5f5' : '#fff'; g.strokeStyle = loud ? '#e03131' : '#333'; g.lineWidth = loud ? 2.5 : 1.5; rr(g, x - w / 2, by, w, h, 8); g.fill(); g.stroke();
  g.beginPath(); g.moveTo(x - 5, y - .5); g.lineTo(x, y + 6); g.lineTo(x + 5, y - .5); g.fill(); g.beginPath(); g.moveTo(x - 5, y); g.lineTo(x, y + 6); g.lineTo(x + 5, y); g.stroke();
  g.fillStyle = loud ? '#c92a2a' : '#222'; g.textAlign = 'center'; L.forEach((l, i) => g.fillText(l, x, by + 15 + i * 15));
}
function drawMinimap(m) {
  if (W < 700) return;
  const s = 3, mw = MAP.w * s, mh = MAP.h * s, x0 = W - mw - 12, y0 = 52;
  ctx.globalAlpha = .85; ctx.drawImage(mapCv, x0, y0, mw, mh); ctx.globalAlpha = 1; ctx.strokeStyle = '#5b4d8a'; ctx.lineWidth = 2; ctx.strokeRect(x0, y0, mw, mh);
  for (const e of ents.values()) {
    if (e.kind === 'm') { ctx.fillStyle = (e.fl & 64) ? '#94d82d' : D.MON[e.t].zev ? '#69db7c' : D.MON[e.t].boss ? '#ffe600' : '#fa5252'; const r = D.MON[e.t].boss ? 4 : 1.5; ctx.fillRect(x0 + e.x * s - r / 2, y0 + e.y * s - r / 2, r, r); }
    else { ctx.fillStyle = e.i === myId ? '#fff' : FACS[e.f][1]; ctx.fillRect(x0 + e.x * s - 2, y0 + e.y * s - 2, 4, 4); }
  }
}

/* ============ HUD / 스킬바 ============ */
function updHud(m) {
  const J = D.JOBS[m.job];
  $('#hname').innerHTML = `<span style="color:${FACS[m.faction][1]}">[${FACS[m.faction][0]}]</span> ${esc(m.name)} · Lv.${m.lv} ${J ? J.icon + J.n : ''}`;
  const set = (id, a, b, txt) => { $(id + ' i').style.width = Math.max(0, Math.min(100, a / b * 100)) + '%'; $(id + ' span').textContent = txt; };
  set('#hpb', m.hp, m.mhp, `HP ${m.hp}/${m.mhp}`); set('#mpb', m.mp, m.mmp, `MP ${m.mp}/${m.mmp}`); set('#xpb', m.exp, m.need, `EXP ${(m.exp / m.need * 100).toFixed(1)}%`);
  const gbs = Object.keys(m.gb || ME.gb || {}).map(k => D.GBUFF && D.GBUFF[k] ? D.GBUFF[k].e : '').join(''), sm = (m.santa ?? ME.santa) > 0 ? ` 🎅${Math.ceil((m.santa ?? ME.santa) / 60000)}분` : '';
  $('#hgold').textContent = `💰 ${m.gold.toLocaleString()}G` + (ME.atk ? ` · ⚔ ${ME.atk} · 🛡 ${ME.def}` : '') + (gbs || sm ? ` · ${gbs ? '신수 ' + gbs : ''}${sm}` : '');
}
let skKey = '';
function updPots() { for (const k of ['hp', 'mp']) { const e = $('#pq' + k); if (e) { const n = (ME.inv.find(i => i.type === 'potion' && i.k === k) || { q: 0 }).q; e.textContent = n; e.parentElement.classList.toggle('lock', !n); } } }
function buildSkills() {
  const J = D.JOBS[ME.job]; const key = ME.job + ME.lv; if (key === skKey) return updPots(); skKey = key;
  const sk = J.sk.slice(0, 5);
  $('#skills').innerHTML = sk.map((s, i) => `<div class="sk ${ME.lv < s.lv ? 'lock' : ''} ${s.ult ? 'ult' : ''}" data-i="${i}" title="${esc(s.n)} (MP ${s.mp}, 쿨 ${s.cd / 1000}초, Lv${s.lv})\n${esc(s.d)}"><b>${i + 1}</b>${esc(s.n)}<div class="cdv"></div></div>`).join('')
    + `<div class="sk" id="skatk" title="기본 공격 (Space)"><b>␣</b>공격</div>`
    + `<div class="sk pot" data-pot="hp" title="HP포션 (Z)"><b>Z</b>❤️<span class="pq" id="pqhp">0</span></div><div class="sk pot" data-pot="mp" title="MP포션 (X)"><b>X</b>💙<span class="pq" id="pqmp">0</span></div>`;
  document.querySelectorAll('.sk.pot').forEach(d => d.onclick = () => send({ t: 'potion', k: d.dataset.pot }));
  document.querySelectorAll('.sk[data-i]').forEach(d => d.onclick = () => send({ t: 'sk', i: +d.dataset.i }));
  $('#skatk').onclick = () => send({ t: 'atk' });
  updPots();
}
function updSkillCd(t) {
  document.querySelectorAll('.sk[data-i]').forEach(d => { const c = cds[d.dataset.i], v = d.querySelector('.cdv'); v.style.height = c && t < c.e ? ((c.e - t) / (c.e - c.s) * 100) + '%' : '0'; });
}

/* ============ 채팅 ============ */
const LOG = [];
function addChat(m) {
  const fc = FACS[m.f] ? FACS[m.f] : ['', '#fff'];
  let html;
  if (m.ch === 'map' || m.ch === 'all') {
    html = `<span style="color:${fc[1]}">${fc[0] ? '[' + fc[0] + '] ' : ''}${esc(m.n)}</span> ${esc(m.m)}`;
    for (const e of ents.values()) if (e.kind === 'p' && e.n === m.n) e.bb = m.m;
    feed('#cfeed', html, 7000, 6);
  } else if (m.ch === 'w') { html = `<span style="color:#f783ac">💌 ${esc(m.m)}</span>`; feed('#cfeed', html, 9000, 6); }
  else { html = `<span style="color:${m.c || (m.ch === 'loot' ? '#8ce99a' : '#ffe066')}">${esc(m.m)}</span>`; feed('#sfeed', html, 5000, 4); }
  LOG.push(html); if (LOG.length > 200) LOG.shift();
  if (!$('#plog').classList.contains('hidden')) renderLog();
}
function feed(sel, html, ms, max) {
  const box = $(sel), d = document.createElement('div'); d.innerHTML = html; box.appendChild(d);
  while (box.children.length > max) box.firstChild.remove();
  setTimeout(() => { d.style.opacity = 0; setTimeout(() => d.remove(), 500); }, ms);
}
function renderLog() { const P = $('#plog'); P.innerHTML = `<h3>📜 기록<button class="x" onclick="$('#plog').classList.add('hidden')">✕</button></h3><div class="logbox">${LOG.slice(-120).map(h => `<div>${h}</div>`).join('')}</div>`; const lb = P.querySelector('.logbox'); lb.scrollTop = lb.scrollHeight; }
function openChat(prefix) { const w = $('#chatwrap'); w.classList.remove('hidden'); const i = $('#chatin'); if (prefix) i.value = prefix; i.focus(); }
function closeChat() { $('#chatin').blur(); $('#chatwrap').classList.add('hidden'); }
function notice(s, c, big, small) {
  const box = $('#notices'), d = document.createElement('div'); d.className = 'notice' + (big ? ' big' : '') + (small ? ' sm' : ''); d.textContent = s; d.style.borderColor = c || '#ffd43b'; d.style.color = c || '#fff';
  box.appendChild(d); while (box.children.length > 3) box.firstChild.remove(); setTimeout(() => { d.style.opacity = 0; setTimeout(() => d.remove(), 500); }, big ? 6000 : 4500);
}
function killFeed(m) {
  const box = $('#kills'), d = document.createElement('div'), F = f => FACS[f] || ['?', '#fff'];
  const nm = o => `<span style="color:${F(o.f)[1]}">[${F(o.f)[0]}] ${esc(o.n)}</span>`;
  d.className = 'kf';
  d.innerHTML = m.boss ? `${nm(m.a)} <b>🏆</b> <span style="color:#ffe066">${esc(m.boss)}</span>` : `${nm(m.a)} <b>⚔️</b> ${nm(m.v)}${m.st >= 3 ? ` <span style="color:#ff6b6b">🔥${m.st}연속</span>` : ''}`;
  d.title = m.map; box.prepend(d); while (box.children.length > 6) box.lastChild.remove();
  setTimeout(() => { d.style.opacity = 0; setTimeout(() => d.remove(), 600); }, 12000);
  if (!m.boss) addChat({ ch: 'sys', m: `⚔️ [${m.map}] ${m.a.n} → ${m.v.n} 처치${m.lost ? ' (아이템 ' + m.lost + '개 떨어짐)' : ''}`, c: '#ff8787' });
}
function toast(s, c) { const e = $('#toast'); e.textContent = s; e.style.color = c || '#fff'; e.style.opacity = 1; clearTimeout(e._t); e._t = setTimeout(() => e.style.opacity = 0, 1800); }

/* ============ 패널 ============ */
const PN = ['inv', 'eq', 'quest', 'shop', 'job', 'help', 'adm', 'world'];
let openP = null;
document.querySelectorAll('#menu button').forEach(b => b.onclick = () => togglePanel(b.dataset.p));
function togglePanel(p) { if (openP === p) closeAll(); else openPanel(p); }
function openPanel(p) { closeAll(); openP = p; $('#p' + p).classList.remove('hidden'); refreshPanels(); }
function closeAll() { PN.forEach(p => $('#p' + p).classList.add('hidden')); openP = null; hideCtx(); }
function head(t) { return `<h3>${t}<button class="x" onclick="closeAll()">✕</button></h3>`; }
function refreshPanels() {
  if (!ME || !openP) return;
  ({ inv: renderInv, eq: renderEq, quest: renderQuest, shop: renderShop, job: renderJob, help: renderHelp, adm: renderAdm, world: renderWorld })[openP]();
}
const isEq = it => it.type === 'weapon' || it.type === 'armor' || it.type === 'helm';
function power(it) { const arr = it.type === 'weapon' ? D.WB : it.type === 'armor' ? D.AB : D.HB; const base = arr[it.b][it.type === 'weapon' ? 'a' : 'd']; return Math.round(base * (1 + it.il * 0.22) * D.RAR[it.r].m * (1 + it.plus * 0.1) + it.plus); }
const enhRate = p => p <= 2 ? 100 : p <= 5 ? 100 - (p - 2) * 10 : Math.max(5, 70 - (p - 5) * 7), boomRate = p => p < 4 ? 0 : p <= 6 ? (p - 3) * 10 : Math.min(90, 30 + (p - 6) * 8);
const SLOTN = { weapon: '무기', armor: '갑옷', helm: '투구' };
function itemName(it) { return isEq(it) ? `<span style="color:${D.RAR[it.r].c}">[${D.RAR[it.r].n}] ${esc(it.n)}${it.plus ? ' +' + it.plus : ''}</span>` : esc(it.n) + (it.q > 1 ? ' x' + it.q : ''); }
function itemDesc(it) {
  if (isEq(it)) {
    const stat = it.type === 'weapon' ? `공격력 +${power(it)} · 사거리 ${D.WB[it.b].r}${D.WB[it.b].aoe ? `<br><span style="color:#a5d8ff">🐟 휘두르면 반경 ${D.WB[it.b].aoe}칸 광역 공격!</span>` : ''}${D.WB[it.b].zsum ? '<br><span style="color:#94d82d">🧟 평타를 치면 아군 좀비 소환! (최대 3마리 · 20초 · 사냥터에서만)</span>' : ''}` : `방어력 +${power(it)}`;
    const bon = [it.atkb ? `공격 +${it.atkb}` : '', it.defb ? `방어 +${it.defb}` : '', it.hpb ? `HP +${it.hpb}` : ''].filter(Boolean).join(' · ');
    return `${SLOTN[it.type]} · 아이템레벨 ${it.il}<br>${stat}${bon ? `<br><span style="color:#ffe066">✨ 특수 옵션: ${bon}</span>` : ''}<br><span class="small">강화 +${it.plus}→+${it.plus + 1}: 성공 ${enhRate(it.plus)}% (축복 ${Math.min(100, enhRate(it.plus) + 15)}%) · 실패 시 파괴 ${boomRate(it.plus)}% → <b style="color:${boomRate(it.plus) ? '#ff8787' : '#69db7c'}">💥 터질 확률 ${((100 - enhRate(it.plus)) * boomRate(it.plus) / 100).toFixed(1)}%</b> · ${(it.plus + 1) * 100}G</span>`;
  }
  if (it.type === 'scroll') return it.k === 'ward' ? '강화 실패로 터질 때 아이템을 지켜줘요 (강화 주문서와 함께 소모)' : it.k === 'bless' ? '강화 성공률 +15% (강화 주문서와 함께 소모)' : '장비를 강화해요. +3부터 실패, +4부터 실패 시 파괴 확률. 높을수록 잘 터져요!';
  if (it.type === 'potion') return { hp: 'HP 40% 회복 (Z)', mp: 'MP 40% 회복 (X)', hp2: 'HP 75% 회복 (일반 HP포션이 없으면 Z로 사용)', mp2: 'MP 75% 회복 (일반 MP포션이 없으면 X로 사용)', elixir: 'HP·MP 완전 회복' }[it.k] || '';
  if (it.type === 'bundle') return it.k === 'hwang' ? '사냥터에서 사용하면 황룡이 강림해요 (서버에 1마리만 · 3시간 머무름). 4신수보다 100배 강하고, 때리면 피해 일부가 반사돼요. 처치 시 황룡의 천검 + 칭호 [🐲 황룡 토벌자]' : '사냥터에서 사용하면 그 자리에 거대한 냉동참치 보스가 나타나요 (서버에 1마리만)';
  for (const RC of Object.values(D.RECIPES || {})) if (RC.need[it.k]) return `보스 재료 · ${RC.e} ${RC.n} 제작에 쓰여요 (가방 → 🧪 제작)`;
  return '퀘스트 재료';
}
function slotHtml(it, sel, locked) {
  return `<div class="slot ${sel ? 'sel' : ''} ${locked ? 'lk' : ''}" data-id="${it ? it.id : ''}" style="${it && isEq(it) ? 'border-color:' + D.RAR[it.r].c + (it.r >= 5 ? ';box-shadow:0 0 8px #ffe600' : '') : ''}">${it ? `<canvas data-ic="${it.id}" width="64" height="64"></canvas>${it.q > 1 ? `<span class="q">${it.q}</span>` : ''}${it.plus ? `<span class="pl">+${it.plus}</span>` : ''}` : ''}</div>`;
}
function paintIcons(root, items) { root.querySelectorAll('canvas[data-ic]').forEach(c => { const it = items.find(i => String(i.id) === c.dataset.ic); if (it) c.getContext('2d').drawImage(itemIcon(it), 0, 0); }); }
let craftOpen = false, invSel = null, composeMode = false, composeSel = [], stakeMode = false;
function renderInv() {
  const P = $('#pinv'), inv = ME.inv, lock = new Set(ME.lock || []);
  let sel = inv.find(i => i.id === invSel) || null;
  let h = head(stakeMode ? '🃏 포커에 걸 아이템을 고르세요' : `🎒 가방 (${inv.length}/${D.MAXINV})`);
  h += `<div class="grid">${Array.from({ length: D.MAXINV }, (_, i) => slotHtml(inv[i], inv[i] && (composeMode ? composeSel.includes(inv[i].id) : inv[i].id === invSel), inv[i] && lock.has(inv[i].id))).join('')}</div>`;
  if (composeMode) h += `<div style="margin-top:8px">🔮 합성: 같은 부위 + 같은 등급 장비 3개 → 한 단계 높은 등급 (성공 55%, 에픽→전설 히든 12%)<div class="acts"><button class="pri" id="cgo" ${composeSel.length === 3 ? '' : 'disabled'}>합성하기 (${composeSel.length}/3)</button><button id="cx">취소</button></div></div>`;
  else if (sel) {
    h += `<div style="margin-top:10px;border-top:2px solid #4a3f72;padding-top:8px"><div style="font-size:16px">${itemName(sel)}</div><div class="small" style="margin-top:3px">${itemDesc(sel)}</div><div class="acts">`;
    if (stakeMode) h += `<button class="pri" id="a-stake">이 아이템 걸기</button>`;
    else {
      if (isEq(sel)) { const has = k => ME.inv.some(i => i.type === 'scroll' && i.k === k); h += `<button class="pri" id="a-eq">장착</button><button id="a-enh">✦ 강화</button>${has('ward') ? '<button id="a-ward">🛡 보호 강화</button>' : ''}${has('bless') ? '<button id="a-bless">✨ 축복 강화</button>' : ''}${has('bless') && has('ward') ? '<button id="a-bw">✨🛡 축복+보호</button>' : ''}`; }
      if (sel.type === 'potion') h += `<button class="pri" id="a-use">사용</button>`;
      if (sel.type === 'bundle') h += `<button class="pri" id="a-use">${sel.k === 'hwang' ? '🐲 황룡 소환' : '🐟 냉동참치 소환'}</button>`;
      h += `<button id="a-sell">판매</button><button class="red" id="a-drop">🗑️ 바닥에 버리기</button>`;
    }
    h += `</div></div>`;
  }
  if (craftOpen && !composeMode && !stakeMode) { const cnt = k => (inv.find(i => i.type === 'mat' && i.k === k) || { q: 0 }).q;
    h += `<div style="margin-top:10px;border-top:2px solid #4a3f72;padding-top:8px">` + Object.entries(D.RECIPES).map(([rk, R]) => { const ok = Object.entries(R.need).every(([k, n]) => cnt(k) >= n) && ME.gold >= R.gold;
      return `<div style="margin-bottom:10px"><div style="font-size:16px">🧪 제작: ${R.e} ${esc(R.n)}</div><div class="small">${esc(R.desc)}</div>${Object.entries(R.need).map(([k, n]) => `<div class="small" style="color:${cnt(k) >= n ? '#69db7c' : '#ff8787'}">${cnt(k) >= n ? '✅' : '❌'} ${esc(k)} ${cnt(k)}/${n}</div>`).join('')}<div class="small" style="color:${ME.gold >= R.gold ? '#69db7c' : '#ff8787'}">💰 ${R.gold.toLocaleString()}G</div><div class="acts"><button class="pri" data-craft="${rk}" ${rk === 'tuna' ? 'id="craftgo"' : ''} ${ok ? '' : 'disabled'}>제작하기</button></div></div>`; }).join('') + `<div class="acts"><button id="craftx">닫기</button></div></div>`; }
  if (!composeMode && !stakeMode) h += `<div class="acts" style="margin-top:8px"><button id="cmode">🔮 장비 합성</button><button id="cropen">🧪 제작</button></div>`;
  P.innerHTML = h; paintIcons(P, inv);
  P.querySelectorAll('.grid .slot').forEach(s => s.onclick = () => {
    const id = +s.dataset.id; if (!id) return;
    if (composeMode) { const it = inv.find(i => i.id === id); if (!isEq(it)) return; composeSel = composeSel.includes(id) ? composeSel.filter(x => x !== id) : composeSel.length < 3 ? [...composeSel, id] : composeSel; }
    else invSel = id;
    renderInv();
  });
  const on = (id, f) => { const b = P.querySelector('#' + id); if (b) b.onclick = f; };
  on('a-eq', () => send({ t: 'equip', id: sel.id })); on('a-enh', () => send({ t: 'enh', id: sel.id }));
  on('a-ward', () => send({ t: 'enh', id: sel.id, ward: 1 })); on('a-bless', () => send({ t: 'enh', id: sel.id, bless: 1 })); on('a-bw', () => send({ t: 'enh', id: sel.id, bless: 1, ward: 1 })); on('a-use', () => send({ t: 'use', id: sel.id }));
  on('a-sell', () => { if (!isEq(sel) || sel.r < 3 || confirm('정말 판매할까요?')) send({ t: 'sell', id: sel.id }); });
  on('a-drop', () => { if (!isEq(sel) || sel.r < 2 || confirm('바닥에 버릴까요? 다른 사람이 주울 수 있어요')) send({ t: 'drop', id: sel.id }); });
  on('a-stake', () => { send({ t: 'pk', s: 'stake', id: sel.id }); stakeMode = false; closeAll(); });
  on('cmode', () => { composeMode = true; composeSel = []; renderInv(); });
  on('cropen', () => { craftOpen = !craftOpen; renderInv(); }); on('craftx', () => { craftOpen = false; renderInv(); }); P.querySelectorAll('[data-craft]').forEach(b => b.onclick = () => send({ t: 'craft', k: b.dataset.craft }));
  on('cx', () => { composeMode = false; renderInv(); });
  on('cgo', () => { send({ t: 'compose', ids: composeSel }); composeMode = false; composeSel = []; });
}
function renderEq() {
  const P = $('#peq'), J = D.JOBS[ME.job];
  let h = head('🛡️ 장비 / 캐릭터');
  h += `<div class="eqwrap"><canvas id="eqprev" width="240" height="300" style="width:120px;height:150px;background:#1a1530;border-radius:12px"></canvas><div class="eqslots">`;
  for (const sl of ['weapon', 'helm', 'armor']) { const it = ME.eq[sl]; h += `<div class="eqs" data-sl="${sl}">${slotHtml(it)}<div><div class="small">${SLOTN[sl]}</div>${it ? itemName(it) + `<div class="small">${it.type === 'weapon' ? '공격' : '방어'} +${power(it)}</div>` : '<span class="small">비어있음</span>'}</div></div>`; }
  h += `</div></div>${ME.mount ? '<div style="margin-top:8px;color:#ffc9c9">🐶 탈것: 밥풀이 (이동속도 +35%)</div>' : ''}<div class="small" style="margin-top:8px">${J.icon} ${J.n} · ⚔ 공격력 ${ME.atk} · 🛡 방어력 ${ME.def} · HP ${ME.mhp} · MP ${ME.mmp}<br>장비 칸을 누르면 해제돼요. 착용한 장비는 캐릭터 그림에 그대로 반영돼요.</div>`;
  P.innerHTML = h; paintIcons(P, Object.values(ME.eq).filter(Boolean));
  P.querySelectorAll('.eqs').forEach(d => d.onclick = () => { if (ME.eq[d.dataset.sl]) send({ t: 'unequip', slot: d.dataset.sl }); });
  const c = $('#eqprev'), g = c.getContext('2d');
  const look = { mt: ME.mount ? 1 : 0, n: ME.name, f: ME.faction, d: 0, w: ME.eq.weapon ? [ME.eq.weapon.b, ME.eq.weapon.r, ME.eq.weapon.plus] : 0, ar: ME.eq.armor ? [ME.eq.armor.b, ME.eq.armor.r] : 0, he: ME.eq.helm ? [ME.eq.helm.b, ME.eq.helm.r] : 0 };
  const loop = () => { if (openP !== 'eq' || !document.body.contains(c)) return; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, 240, 300); g.setTransform(4, 0, 0, 4, 120, 230); drawChar(g, 0, 0, look, now(), false, true); requestAnimationFrame(loop); };
  loop();
}
function renderQuest() {
  const P = $('#pquest'); let h = head('📜 퀘스트 일지');
  const where = id => `${D.NPCS[id].n} (${D.NPCS[id].map}${id === 'chief' ? ' · 내 마을' : ''})`;
  const act = Object.keys(ME.q).map(k => D.QUESTS.find(q => q.id === +k)).filter(Boolean);
  if (!act.length) h += `<p class="small">진행 중인 퀘스트가 없어요.</p>`;
  for (const q of act) {
    const goal = q.to ? `${where(q.to)}에게 가서 말 걸기` : q.kill ? `${q.kill === 'any' ? '아무 몬스터' : (D.MON.find(m => m.id === q.kill) || {}).n} 처치 ${qProg(q)}/${q.cnt}` : `${q.collect} 모으기 ${qProg(q)}/${q.cnt}`;
    const done = !q.to && qProg(q) >= q.cnt;
    h += `<div class="row"><div><div>${q.rep ? '🔁' : '⭐'} ${esc(q.n)}</div><div class="small">${esc(goal)}</div>${done ? `<div class="small" style="color:#69db7c">✅ 완료! ${esc(where(q.giver))}에게 보고하세요</div>` : ''}</div></div>`;
  }
  const nx = D.QUESTS.find(q => !q.rep && qAvail(q)), lock = QCH().find(q => !ME.qd[q.id] && !(q.id in ME.q));
  if (nx) h += `<div class="row"><div><div style="color:#ffd43b">❗ 새 이야기</div><div class="small">${esc(where(nx.giver))}에게 말을 걸어보세요 (머리 위 ! 표시)</div></div></div>`;
  else if (lock && !act.some(q => !q.rep)) h += `<div class="row"><div class="small">다음 이야기는 Lv.${lock.lv}부터 (${esc(where(lock.giver))})</div></div>`;
  else if (!lock) h += `<div class="row"><div class="small">🏆 모든 스토리를 끝냈어요!</div></div>`;
  const done = QCH().filter(q => ME.qd[q.id]).length;
  h += `<div class="small" style="margin-top:8px">스토리 진행 ${done}/${QCH().length} · 반복 퀘스트: 사우나 세신사 아저씨</div><div class="small">NPC를 터치하거나 옆에서 F키로 대화해요</div>`;
  P.innerHTML = h;
}
function renderShop() {
  const P = $('#pshop'); let h = head('🏪 동네 상점') + `<div class="small">💰 ${ME.gold.toLocaleString()}G · 팔기는 가방에서</div>`;
  for (const s of D.SHOP) h += `<div class="row"><div>${esc(s.n)} <span class="small">${s.p}G</span></div><div class="acts" style="margin:0"><button data-b="${s.k}" data-n="1">1개</button><button data-b="${s.k}" data-n="10">10개</button></div></div>`;
  P.innerHTML = h; P.querySelectorAll('[data-b]').forEach(b => b.onclick = () => send({ t: 'buy', k: b.dataset.b, n: +b.dataset.n }));
}
function renderJob() {
  const P = $('#pjob'), J = D.JOBS[ME.job]; let h = head('🌟 직업');
  if (ME.job === 'novice') {
    if (ME.lv < D.TIER1_LV) h += `<p>지금은 <b>🌱 초보자</b>예요. 레벨 ${D.TIER1_LV}이 되면 1차 직업을 고를 수 있어요! (현재 Lv.${ME.lv})</p>`;
    else h += `<p>1차 직업을 골라주세요! <span class="small">(한 번 고르면 바꿀 수 없어요)</span></p>`;
    h += `<div class="jobs">`;
    for (const [k, j] of Object.entries(D.JOBS)) if (j.tier === 1) h += `<div class="job" data-job="${k}"><div class="ic">${j.icon}</div><b>${esc(j.n)}</b><div class="small">${esc(j.d)}</div><div class="small" style="margin-top:4px;color:#ffe066">${j.sk.map(s => esc(s.n)).join(' · ')}</div></div>`;
    h += `</div>`;
  } else {
    h += `<p>${J.icon} <b>${esc(J.n)}</b> (1차) · ${esc(J.d)}</p>`;
    J.sk.forEach((s, i) => h += `<div class="row"><div><b>${i + 1}. ${esc(s.n)}</b> <span class="small">Lv${s.lv} · MP ${s.mp} · 쿨 ${s.cd / 1000}초</span><div class="small">${esc(s.d)}</div></div>${ME.lv >= s.lv ? '✅' : '🔒'}</div>`);
    h += `<p class="small">2차~4차 전직은 준비 중이에요.</p>`;
  }
  P.innerHTML = h;
  P.querySelectorAll('[data-job]').forEach(d => d.onclick = () => {
    if (ME.lv < D.TIER1_LV) return toast(`레벨 ${D.TIER1_LV}부터 고를 수 있어요`);
    const j = D.JOBS[d.dataset.job]; if (confirm(`[${j.n}] 직업으로 전직할까요?`)) { send({ t: 'job', job: d.dataset.job }); closeAll(); }
  });
}
function renderHelp() {
  $('#phelp').innerHTML = head('❓ 도움말') + `<div class="small" style="font-size:14px;line-height:1.6;color:var(--txt)">
  <b>조작</b>: 방향키/WASD 이동 · Space 공격 · 1~4 스킬 · Z/X 포션 · <b>F 줍기/NPC 대화</b> · Enter 채팅<br><b>퀘스트</b>: 머리 위 <span style="color:#ffd43b">!</span> 표시 NPC에게 말 걸면 스토리 퀘스트, <span style="color:#69db7c">?</span>는 완료 보고<br><b>드랍</b>: 몬스터를 잡으면 바닥에 떨어져요. 20초 동안은 잡은 사람만 주울 수 있어요<br>
  <b>창</b>: I 가방 · E 장비 · Q 퀘스트 · B 상점 · J 직업 · Esc 닫기<br>
  <b>채팅</b>: Enter 또는 💬 버튼 → 모두에게 보여요 · <code>/w 이름 내용</code> = 귓속말 · 📜 버튼 = 기록<br><b>월드맵</b>: 맵 이름 또는 M키 · <b>접속자</b>: 오른쪽 끝에서 왼쪽으로 밀기<br><b>레이드</b>: 부천 들판 가운데 포탈 → 보스 대기실 → 안내원에게 보스 참여<br>
  <b>진영전</b>: 다른 동네 사람은 공격 가능! 죽으면 가방 아이템 1~3개를 떨어뜨려요(장착 장비는 안전). 마을 왼쪽 안전지대는 PvP 불가.<br>
  <b>직업</b>: 초보자로 시작 → Lv.10에 1차 직업 선택<br>
  <b>등급</b>: <span style="color:#d0d0d0">일반</span> · <span style="color:#69db7c">고급</span> · <span style="color:#4dabf7">희귀</span> · <span style="color:#b197fc">영웅</span> · <span style="color:#ff922b">에픽</span> · <span style="color:#ffe600">전설(히든)</span><br>
  <b>히든 장비</b>: 영웅 이상 장비가 특정 접두사+종류 조합으로 나오면 노란색 전설로 바뀌어요. 에픽 3개 합성으로도 노릴 수 있어요.<br>
  <b>강화</b>: 무한 강화! +3부터 실패, +5부터 파괴 확률. 보호 주문서로 파괴 방지.<br>
  <b>보스</b>: 사냥터마다 약 1시간에 한 번 랜덤 색/장식의 보스가 등장해요.<br>
  <b>포커</b>: 다른 사람을 클릭 → 아이템 포커. 서로 아이템 하나씩 걸고 5장 드로우 포커 한 판!<br>
  <b>맵</b>: 부천 들판(5개 동네 마을이 위·대각선에 있고 마을 밖은 바로 사냥터 + 진영전, Lv1~7) → 상동역 술집거리(Lv8~13, 위쪽에 ♨️사우나 세이브존) → 디에이트 헬스장(Lv12~17) → 부천시청(Lv15~21, ✨쌍둥이 보스) → 춘의동굴(Lv17~24) → 원종 지하던전(Lv25+)</div>`;
}

/* ============ 접속자 목록 (오른쪽 서랍) ============ */
function renderWho() {
  $('#whotab').textContent = `👥 ${WHO.length}`;
  $('#wholist').innerHTML = `<div style="font-size:15px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">👥 접속자 ${WHO.length}명<button onclick="setWho(false)">✕</button></div>` + WHO.map(([n, f, j, l, mp, ad, tt]) => { const F = FACS[f] || ['?', '#fff'], J = D && D.JOBS[j], TT = tt && D && D.TITLES[tt]; return `<div class="wrow"><div><span style="color:${F[1]}">[${F[0]}]</span> ${ad ? '👑' : ''}${esc(n)} <span class="small">Lv${l}</span>${TT ? ` <span class="small" style="color:${TT.c}">${esc(TT.n)}</span>` : ''}</div><div class="small">${J ? J.icon + J.n : ''} · 📍${esc(mp)}</div></div>`; }).join('')
    + (ZR && ZR.list && ZR.list.length ? `<div style="margin-top:12px;color:#8ce99a">🧟 지난 좀비 습격 랭킹</div>` + ZR.list.map(([n, f, k], i) => `<div class="small" style="display:flex;justify-content:space-between;padding:2px 0"><span>${['🥇', '🥈', '🥉'][i] || (i + 1) + '.'} <span style="color:${(FACS[f] || ['', '#fff'])[1]}">${esc(n)}</span></span><b>${k}</b></div>`).join('') : '');
}
function renderZRank() {
  let el = $('#zrank'); if (!el) { el = document.createElement('div'); el.id = 'zrank'; document.body.appendChild(el); el.onclick = () => el.classList.toggle('mini'); }
  if (!ZST) { el.style.display = 'none'; return; } el.style.display = 'block';
  const left = Math.max(0, ZST.left - (now() - ZST.at)), sec = Math.ceil(left / 1000), mm = Math.floor(sec / 60), ss = String(sec % 60).padStart(2, '0');
  el.innerHTML = `<div class="zh">🧟 좀비 습격 <b>${mm}:${ss}</b></div><div class="zs">웨이브 ${ZST.wave} · 내 점수 <b>${ZST.me}</b> · 탭해서 접기</div>` + (ZST.top.length ? ZST.top.map(([n, f, k], i) => `<div class="zr ${ME && n === ME.name ? 'me' : ''}"><span>${['🥇', '🥈', '🥉'][i] || (i + 1) + '.'}</span><span style="color:${(FACS[f] || ['', '#fff'])[1]}">${esc(n)}</span><b>${k}</b></div>`).join('') : '<div class="zs">아직 아무도 못 잡았어요!</div>');
}
setInterval(() => { if (ZST) renderZRank(); }, 1000);
function showZRes(m) {
  let el = $('#zres'); if (!el) { el = document.createElement('div'); el.id = 'zres'; document.body.appendChild(el); }
  const L = m.list || [], rw = i => i === 0 ? '💀 좀비 군주의 지팡이 · 칭호 [🧟 좀비 학살자] · 100만G' : i < 3 ? `칭호 [🧟 좀비 사냥꾼] · ${i === 1 ? '50' : '30'}만G` : '10만G';
  el.innerHTML = `<h3 style="margin:0 0 4px;color:#8ce99a">🧟 좀비 습격 결과</h3>${m.reason ? `<div class="small">${esc(m.reason)}</div>` : ''}<div style="margin:8px 0">` + (L.length ? L.map(([n, f, k], i) => `<div class="zr ${ME && n === ME.name ? 'me' : ''}"><span>${['🥇', '🥈', '🥉'][i] || (i + 1) + '위'} <b style="color:${(FACS[f] || ['', '#fff'])[1]}">${esc(n)}</b> · ${k}점</span><span class="small">${rw(i)}</span></div>`).join('') : '<div class="small">아무도 좀비를 잡지 못했어요…</div>') + `</div><button id="zresx" class="pri">닫기</button>`;
  el.style.display = 'block'; $('#zresx').onclick = () => el.style.display = 'none';
  LOG.push(`<span style="color:#8ce99a">🧟 좀비 습격 결과: ${L.map(([n, , k], i) => `${i + 1}위 ${esc(n)}(${k})`).join(', ') || '없음'}</span>`);
}
const whoEl = () => $('#who');
function setWho(open) { whoEl().classList.toggle('open', open); $('#whotab').classList.toggle('open', open); }
$('#whotab').onclick = () => setWho(!whoEl().classList.contains('open'));
{ let sx = null, sy = 0, fromEdge = false;
  const st = (x, y) => { sx = x; sy = y; fromEdge = x > innerWidth - 30 || whoEl().classList.contains('open'); };
  const en = (x, y) => { if (sx == null) return; const dx = x - sx, dy = Math.abs(y - sy); if (fromEdge && dy < 80) { if (dx < -50) setWho(true); else if (dx > 50) setWho(false); } sx = null; };
  addEventListener('touchstart', e => st(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  addEventListener('touchend', e => en(e.changedTouches[0].clientX, e.changedTouches[0].clientY), { passive: true });
  $('#whotab').addEventListener('mousedown', e => st(innerWidth, e.clientY)); addEventListener('mouseup', e => en(e.clientX, e.clientY));
}
/* ============ 월드맵 ============ */
const WMAP = [ // [맵id, x, y]  (0~100 좌표)
  ['bucheon', 10, 48], ['bosshub', 24, 28], ['raid1', 7, 8], ['raid2', 19, 8], ['raid4', 31, 8], ['raid3', 43, 8], ['raid5', 55, 8], ['pub', 22, 66], ['sauna', 9, 84], ['gym', 36, 54], ['hall', 48, 66], ['cave1', 60, 54], ['cave2', 72, 66],
  ['station', 88, 80], ['market', 72, 92], ['dodang', 55, 92], ['lake', 38, 92], ['sewer', 90, 62], ['factory', 88, 44], ['wonmi', 90, 30], ['tunnel', 78, 19], ['castle', 92, 7], ['raid6', 67, 8], ['raid7', 58, 26], ['temple1', 4, 19], ['temple2', 13, 19], ['temple3', 36, 21], ['temple4', 46, 21], ['bunker', 78, 42], ['comic', 66, 36], ['ruins', 54, 40]];
const WLINK = [['bucheon', 'bosshub'], ['bosshub', 'raid1'], ['bosshub', 'raid2'], ['bosshub', 'raid3'], ['bosshub', 'raid4'], ['bosshub', 'raid5'], ['bucheon', 'pub'], ['pub', 'sauna'], ['pub', 'gym'], ['gym', 'hall'], ['hall', 'cave1'], ['cave1', 'cave2'],
  ['cave2', 'station'], ['bucheon', 'station'], ['station', 'market'], ['market', 'dodang'], ['dodang', 'lake'], ['station', 'sewer'], ['sewer', 'factory'], ['factory', 'wonmi'], ['wonmi', 'tunnel'], ['tunnel', 'castle'], ['bosshub', 'raid6'], ['bosshub', 'raid7'], ['bosshub', 'temple1'], ['bosshub', 'temple2'], ['bosshub', 'temple3'], ['bosshub', 'temple4'], ['castle', 'bunker'], ['bunker', 'comic'], ['comic', 'ruins']];
function renderWorld() {
  const P = $('#pworld'), seen = (ME && ME.seen) || {}, info = id => D.MAPLIST.find(m => m.id === id) || { n: id };
  const pos = Object.fromEntries(WMAP.map(([id, x, y]) => [id, [x, y]]));
  let h = head('🗺️ 월드맵') + `<div class="wmap"><svg viewBox="0 0 100 100" preserveAspectRatio="none">${WLINK.map(([a, b]) => `<line x1="${pos[a][0]}" y1="${pos[a][1]}" x2="${pos[b][0]}" y2="${pos[b][1]}" stroke="${seen[a] && seen[b] ? '#b197fc' : '#4a3f72'}" stroke-width="0.8" stroke-dasharray="${seen[a] && seen[b] ? '' : '2 1.5'}"/>`).join('')}</svg>`;
  for (const [id, x, y] of WMAP) { const M = info(id), on = seen[id], cur = MAP && MAP.id === id; h += `<div class="wnode ${on ? '' : 'dim'} ${cur ? 'cur' : ''}" style="left:${x}%;top:${y}%">${cur ? '📍' : ''}${esc(M.n)}<div class="small">${M.lvr && M.lvr !== '휴식' && M.lvr !== '레이드' ? 'Lv' + M.lvr : M.lvr || ''}${on ? '' : ' · 미발견'}</div></div>`; }
  h += `</div><div class="small" style="margin-top:6px">흐린 곳은 아직 가보지 않은 맵이에요 · 보기 전용</div>`;
  P.innerHTML = h;
}

/* ============ NPC / 퀘스트 ============ */
const QCH = () => D.QUESTS.filter(q => !q.rep);
function qAvail(q) { if (ME.qd[q.id] || (q.id in ME.q) || ME.lv < q.lv) return false; if (q.rep) return true; const c = QCH(), i = c.indexOf(q); return c.slice(0, i).every(x => ME.qd[x.id]); }
function qProg(q) { return q.collect ? Math.min(q.cnt, (ME.inv.find(i => i.type === 'mat' && i.k === q.collect) || { q: 0 }).q) : (ME.q[q.id] || 0); }
function npcMark(id) {
  if (!ME || !D) return '';
  for (const k in ME.q) { const q = D.QUESTS.find(x => x.id === +k); if (!q) continue; if (q.to === id) return '?'; if (q.giver === id && !q.to && qProg(q) >= q.cnt) return '?'; }
  return D.QUESTS.some(q => q.giver === id && qAvail(q)) ? '!' : '';
}
function nearNpc() { const m = me(); if (!m || !MAP) return null; return (MAP.npcs || []).find(n => Math.abs(n.x - m.x) <= 2 && Math.abs(n.y - m.y) <= 2); }
function actionKey() { const m = me(); if (!m) return; if (ground.some(g => Math.abs(g[1] - m.x) <= 1 && Math.abs(g[2] - m.y) <= 1)) return send({ t: 'pick' }); const n = nearNpc(); if (n) return send({ t: 'npc', id: n.id }); send({ t: 'pick' }); }
let dlg = null;
function showDlg(m) {
  if (m.keep) m.lines = [m.lines.join('\n')];
  dlg = { m, i: 0 }; closeAll(); drawDlg();
}
function drawDlg() {
  const P = $('#pdlg'); if (!dlg) { P.classList.add('hidden'); return; }
  const { m, i } = dlg, last = i >= m.lines.length - 1;
  P.classList.remove('hidden');
  P.innerHTML = `<div style="display:flex;gap:10px;align-items:flex-start"><canvas id="dlgc" width="120" height="140" style="width:60px;height:70px;background:#1a1530;border-radius:10px;flex:none"></canvas><div style="flex:1"><div style="color:#8ce99a;font-size:16px">${esc(m.name)}</div><div style="font-size:15px;line-height:1.45;margin-top:4px;min-height:44px;white-space:pre-line">${esc(m.lines[i] || '')}</div></div></div>
  <div class="acts" style="justify-content:flex-end;margin-top:8px">${last ? (m.acts.length ? m.acts.map((a, k) => `<button data-k="${k}" class="${a.k === 'close' ? '' : 'pri'}">${esc(a.label)}</button>`).join('') : '<button data-k="x">닫기</button>') : '<button class="pri" data-k="n">▶ 다음</button>'}</div>`;
  const g = $('#dlgc').getContext('2d'); g.setTransform(2.4, 0, 0, 2.4, 60, 125); drawChar(g, 0, 0, { n: m.name, d: 0, w: m.look.w, ar: m.look.ar, he: m.look.he }, now(), false, true);
  P.querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
    const k = b.dataset.k; if (k === 'n') { dlg.i++; return drawDlg(); } if (k === 'x') { dlg = null; return drawDlg(); }
    const a = m.acts[+k]; dlg = null; drawDlg();
    if (a.k === 'shop') openPanel('shop'); else if (a.k === 'raid') send({ t: 'raid', id: a.id, op: a.op }); else if (a.k === 'qa') send({ t: 'qa', id: a.id }); else if (a.k === 'qt') send({ t: 'qt', id: a.id }); else if (a.k === 'talk') send({ t: 'npc', id: m.npc });
  });
}

/* ============ 관리자 ============ */
const adm = o => send(Object.assign({ t: 'adm' }, o));
function renderAdm() {
  if (!ME.admin) return closeAll();
  const A = ME.admin, mapNm = id => (D.MAPLIST.find(m => m.id === id) || {}).n || id;
  let h = head('👑 관리자 모드');
  h += `<div class="acts"><button data-a="god" class="${A.god ? 'pri' : ''}">🛡 무적 ${A.god ? 'ON' : 'OFF'}</button><button data-a="onehit" class="${A.onehit ? 'pri' : ''}">💥 한방 ${A.onehit ? 'ON' : 'OFF'}</button><button data-a="fast" class="${A.fast ? 'pri' : ''}">⚡ 초고속 ${A.fast ? 'ON' : 'OFF'}</button><button data-a="heal">❤️ 완전회복</button><button data-a="clear">🧹 맵 몬스터 제거</button><button data-a="kill">☠️ 주변 몬스터 처치</button><button data-a="pickall">🧲 맵 아이템 다 줍기</button><button data-a="mount">🐶 밥풀이 탑승 ${ME.mount ? 'OFF' : 'ON'}</button><button data-a="tunabag">🐟 냉동참치 보따리</button><button data-a="tunamats">🧩 참치 재료</button><button data-a="hwangbag">🐲 황룡의 부적</button><button data-a="beastmats">🧩 4신수 재료</button><button data-a="gbuff">🐉 신수 버프 4종</button><button data-a="santabuff">🎅 산타 버프</button><button data-a="topdps">📊 신수 체력 계산</button></div>`;
  h += `<div class="small" style="margin-top:6px">무적 ON이면 피해 없음 + 스킬 쿨타임/MP 없음</div>`;
  h += `<h4 style="margin:12px 0 4px">🔥 경험치 이벤트 (전체)</h4><div class="acts">${[1, 2, 5, 10].map(v => `<button data-ev="${v}" class="${EVT === v ? 'pri' : ''}">${v === 1 ? '이벤트 끄기' : v + '배'}</button>`).join('')}<button data-a="raidreset">🧹 레이드 초기화</button></div>`;
  h += `<h4 style="margin:12px 0 4px">🔥 무한장 (배틀로얄)</h4><div class="acts"><button class="pri" data-a="royale">🔥 무한장 시작 (접속자 전원)</button><button data-a="royalestop">종료</button></div><div class="small">관리자를 뺀 접속자 전원이 무한장으로 이동 → 3초 카운트 → 진영 상관없이 싸워서 마지막 1명에게 골드</div>`;
  h += `<h4 style="margin:12px 0 4px">🧟 좀비 습격 이벤트</h4><div class="acts">${[3, 5, 10, 15].map(v => `<button data-zev="${v}" class="${v === 5 ? 'pri' : ''}">🧟 ${v}분 시작</button>`).join('')}<button data-a="zstop" class="red">종료</button><button data-a="zstaff">💀 좀비 지팡이 받기</button><button data-ttl="zslayer">칭호: 학살자</button><button data-ttl="">칭호 없애기</button></div><div class="small">모든 사냥터 몬스터가 사라지고 화면이 초록색으로 변하며 좀비 보스들이 몰려와요 (좀비 1점 · 좀비 킹 5점). 끝나면 1~10위 랭킹, 1위는 좀비 소환 지팡이 + 칭호 [좀비 학살자] (입장 문구도 바뀜). 관리자는 랭킹 제외</div>`;
  h += `<h4 style="margin:12px 0 4px">🧪 다른 사람 레벨 설정 (테스트용)</h4><div class="acts"><input id="admpn" placeholder="이름" style="width:100px;padding:5px"><input id="admpl" type="number" value="40" style="width:60px;padding:5px"><button id="admplgo">설정</button></div>`;
  h += `<h4 style="margin:12px 0 4px">👹 보스 소환 (내 옆에)</h4><div class="acts">${D.MON.filter(m => m.boss && !m.raid && !m.zev && !m.hw).map(m => `<button data-boss="${m.id}">${m.s === 'human' ? '✨' : ''}${esc(m.n)}</button>`).join('')}<button data-a="allboss" class="red">모든 사냥터 보스</button></div>`;
  h += `<h4 style="margin:12px 0 4px">🐾 몬스터 소환 (5마리, 죽으면 사라짐)</h4><select id="admmob" style="font-family:inherit;padding:5px;border-radius:8px;background:#14102a;color:#fff;border:2px solid #5b4d8a">${D.MON.filter(m => !m.boss && !m.pet && !m.guard).map(m => `<option value="${m.id}">${esc(m.n)} (Lv${m.lv})</option>`).join('')}</select> <button id="admmobgo">소환</button> <button id="admmat">재료 20개</button>`;
  h += `<h4 style="margin:12px 0 4px">🗺️ 순간이동</h4><div class="acts">${Object.entries(FACS).map(([k, [n, c]]) => `<button data-go="${k}" style="color:${c}">🏠${n}마을</button>`).join('')}${D.MAPLIST.filter(m => m.id !== 'bucheon').map(m => `<button data-go="${m.id}">${esc(m.n)}</button>`).join('')}</div>`;
  h += `<h4 style="margin:12px 0 4px">📜 퀘스트 / NPC</h4><div class="acts"><button data-a="qnext">⏩ 현재 퀘스트 바로 달성</button><button data-a="qreset">🔄 퀘스트 초기화</button>${Object.entries(D.NPCS).map(([k, n]) => `<button data-npc="${k}">🧑 ${esc(n.n)}</button>`).join('')}</div>`;
  h += `<h4 style="margin:12px 0 4px">📈 레벨 / 재화</h4><div class="acts"><input id="admlv" type="number" min="1" max="150" value="${ME.lv}" style="width:70px;padding:5px"><button id="admlvgo">레벨 설정</button><button data-a="exp">+1레벨</button><button data-a="gold">💰 +100만</button><button data-a="scroll">✦ 주문서</button><button data-a="pot">🧪 포션</button></div>`;
  h += `<h4 style="margin:12px 0 4px">⚔️ 장비 지급</h4><div class="acts">${['weapon', 'armor', 'helm'].map(t => `<select data-ity="${t}" style="font-family:inherit;padding:5px;border-radius:8px;background:#14102a;color:#fff;border:2px solid #5b4d8a"><option value="">${SLOTN[t]}…</option>${D.RAR.map((r, i) => `<option value="${i}">${r.n}${i === 5 ? '(히든)' : ''}</option>`).join('')}</select>`).join('')}</div>`;
  h += `<h4 style="margin:12px 0 4px">🌟 직업 변경</h4><div class="acts">${Object.entries(D.JOBS).map(([k, j]) => `<button data-job="${k}" class="${ME.job === k ? 'pri' : ''}">${j.icon}${esc(j.n)}</button>`).join('')}</div>`;
  h += `<h4 style="margin:12px 0 4px">🏳️ 진영 변경</h4><div class="acts">${Object.entries(FACS).map(([k, [n, c]]) => `<button data-fac="${k}" style="color:${c}">${n}</button>`).join('')}</div>`;
  const P = $('#padm'); P.innerHTML = h;
  P.querySelectorAll('[data-a]').forEach(b => b.onclick = () => adm({ op: b.dataset.a }));
  P.querySelectorAll('[data-zev]').forEach(b => b.onclick = () => adm({ op: 'zstart', min: +b.dataset.zev }));
  P.querySelectorAll('[data-ttl]').forEach(b => b.onclick = () => adm({ op: 'title', v: b.dataset.ttl }));
  P.querySelectorAll('[data-boss]').forEach(b => b.onclick = () => adm({ op: 'boss', id: b.dataset.boss }));
  P.querySelectorAll('[data-ev]').forEach(b => b.onclick = () => { adm({ op: 'expev', v: +b.dataset.ev }); setTimeout(renderAdm, 300); });
  P.querySelectorAll('[data-go]').forEach(b => b.onclick = () => adm({ op: 'go', map: b.dataset.go }));
  P.querySelectorAll('[data-npc]').forEach(b => b.onclick = () => adm({ op: 'tpnpc', id: b.dataset.npc }));
  P.querySelectorAll('[data-job]').forEach(b => b.onclick = () => adm({ op: 'job', job: b.dataset.job }));
  P.querySelectorAll('[data-fac]').forEach(b => b.onclick = () => adm({ op: 'faction', f: b.dataset.fac }));
  P.querySelectorAll('[data-ity]').forEach(sl => sl.onchange = () => { if (sl.value !== '') adm({ op: 'item', type: sl.dataset.ity, r: +sl.value, il: ME.lv }); sl.value = ''; });
  $('#admmobgo').onclick = () => adm({ op: 'mob', id: $('#admmob').value, n: 5 });
  $('#admmat').onclick = () => adm({ op: 'mat', id: $('#admmob').value });
  $('#admlvgo').onclick = () => adm({ op: 'lv', v: +$('#admlv').value });
  $('#admplgo').onclick = () => adm({ op: 'setlv', name: $('#admpn').value, v: +$('#admpl').value });
}

/* ============ 포커 ============ */
const SUIT = ['♠', '♥', '♦', '♣'], RK = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const cardHtml = (c, i, sel) => { const r = c >> 2, s = c & 3; return `<div class="card ${s === 1 || s === 2 ? 'red' : ''} ${sel ? 'sel' : ''}" data-ci="${i}"><div>${RK[r] || r}</div><div>${SUIT[s]}</div></div>`; };
let pkSel = new Set();
function pkShow(h) { const P = $('#ppk'); P.classList.remove('hidden'); P.innerHTML = `<h3>🃏 아이템 포커</h3>` + h; return P; }
function pkClose() { $('#ppk').classList.add('hidden'); stakeMode = false; }
function onPoker(m) {
  if (m.s === 'invited') { const P = pkShow(`<p><b>${esc(m.from)}</b>님이 아이템 포커를 신청했어요!</p><div class="acts"><button class="pri" id="pka">수락</button><button id="pkd">거절</button></div>`); P.querySelector('#pka').onclick = () => send({ t: 'pk', s: 'accept' }); P.querySelector('#pkd').onclick = () => { send({ t: 'pk', s: 'decline' }); pkClose(); }; }
  else if (m.s === 'wait') { const P = pkShow(`<p>${esc(m.opp)}님의 응답을 기다리는 중...</p><button id="pkc">취소</button>`); P.querySelector('#pkc').onclick = () => { send({ t: 'pk', s: 'cancel' }); pkClose(); }; }
  else if (m.s === 'stake') { const P = pkShow(`<p>${esc(m.opp)}님과 포커! 걸 아이템을 하나 고르세요.<br><span class="small">장비 또는 수량 1개짜리 아이템. 이기면 상대 아이템을 가져와요.</span></p><div class="acts"><button class="pri" id="pks">가방에서 고르기</button><button id="pkc">취소</button></div>`); P.querySelector('#pks').onclick = () => { stakeMode = true; invSel = null; openPanel('inv'); }; P.querySelector('#pkc').onclick = () => { send({ t: 'pk', s: 'cancel' }); pkClose(); }; }
  else if (m.s === 'staked') pkShow(`<p>상대가 아이템을 걸 때까지 기다리는 중...</p>`);
  else if (m.s === 'draw') {
    pkSel = new Set();
    const draw = () => { const P = pkShow(`<div class="small">내 판돈: ${esc(m.mine.n)}<br>상대(${esc(m.opp)}) 판돈: <span style="color:${D.RAR[m.theirs.r].c}">${esc(m.theirs.n)}</span></div><div class="cards">${m.hand.map((c, i) => cardHtml(c, i, pkSel.has(i))).join('')}</div><p class="small" style="text-align:center">바꿀 카드를 눌러 고르고 교체하세요 (0~5장)</p><div class="acts" style="justify-content:center"><button class="pri" id="pkdr">${pkSel.size ? pkSel.size + '장 교체' : '그대로 승부'}</button></div>`);
      P.querySelectorAll('.card').forEach(c => c.onclick = () => { const i = +c.dataset.ci; pkSel.has(i) ? pkSel.delete(i) : pkSel.add(i); draw(); });
      P.querySelector('#pkdr').onclick = () => send({ t: 'pk', s: 'draw', d: [...pkSel] }); };
    draw();
  }
  else if (m.s === 'drew') pkShow(`<p>상대가 카드를 고르는 중...</p>`);
  else if (m.s === 'res') {
    const r = m.win === 'win' ? '<span style="color:#ffe066;font-size:24px">🎉 승리!</span>' : m.win === 'lose' ? '<span style="color:#ff8787;font-size:24px">😭 패배...</span>' : '<span style="font-size:24px">🤝 무승부</span>';
    const P = pkShow(`<div style="text-align:center">${r}</div><div class="small">상대: ${esc(m.tn)}</div><div class="cards">${m.theirs.map((c, i) => cardHtml(c, i)).join('')}</div><div class="small">나: ${esc(m.mn)}</div><div class="cards">${m.mine.map((c, i) => cardHtml(c, i)).join('')}</div><div class="acts" style="justify-content:center"><button id="pkx">닫기</button></div>`);
    P.querySelector('#pkx').onclick = pkClose;
  }
  else if (m.s === 'cancel') { pkClose(); toast('포커 취소: ' + m.why); }
}

requestAnimationFrame(frame);

// 채팅/기록/월드맵 버튼
$('#chatbtn').onclick = () => { $('#chatwrap').classList.contains('hidden') ? openChat() : closeChat(); };
$('#chatsend').onclick = () => { const v = $('#chatin').value.trim(); if (v) send({ t: 'chat', m: v }); $('#chatin').value = ''; closeChat(); };
$('#logbtn').onclick = () => { const P = $('#plog'); if (P.classList.contains('hidden')) { P.classList.remove('hidden'); renderLog(); } else P.classList.add('hidden'); };
$('#mapname').onclick = () => togglePanel('world');
