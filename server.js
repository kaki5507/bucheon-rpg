'use strict';
const express = require('express'), http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const ADMIN = process.env.ADMIN_NAME || '';
const R = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = a => a[Math.floor(Math.random() * a.length)];
const now = () => Date.now();
const DX = [0, -1, 1, 0], DY = [1, 0, 0, -1]; // 0 아래 1 왼 2 오른 3 위
const MAXINV = 48;

let db = { acc: {}, iid: 1 };
try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { }
db.acc = db.acc || {}; db.iid = db.iid || 1;
// DATABASE_URL(Postgres: Neon/Supabase 무료 등)이 있으면 거기에 저장 → Render 무료 서버가 재시작돼도 데이터 유지
let pg = null;
async function dbInit() {
  if (!process.env.DATABASE_URL) { console.log('⚠ DATABASE_URL 없음: data.json 파일에 저장 (Render 무료 플랜에선 재시작 시 초기화됨)'); return; }
  const { Pool } = require('pg');
  pg = new Pool({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false }, max: 2 });
  await pg.query('CREATE TABLE IF NOT EXISTS game_kv (k TEXT PRIMARY KEY, v JSONB NOT NULL)');
  const r = await pg.query("SELECT v FROM game_kv WHERE k='db'");
  if (r.rows[0]) { db = r.rows[0].v; db.acc = db.acc || {}; db.iid = db.iid || 1; }
  console.log('✅ Postgres 연결됨, 계정 수:', Object.keys(db.acc).length);
}

/* ===================== 정적 데이터 ===================== */
const FAC = {
  sangdong: { n: '상동', c: '#ff6b6b' }, jungdong: { n: '중동', c: '#4dabf7' }, wonjong: { n: '원종', c: '#51cf66' },
  yeokgok: { n: '역곡', c: '#ffd43b' }, sosa: { n: '소사', c: '#da77f2' }
};
const FK = Object.keys(FAC);
const RAR = [{ n: '일반', c: '#d0d0d0', m: 1 }, { n: '고급', c: '#69db7c', m: 1.3 }, { n: '희귀', c: '#4dabf7', m: 1.7 },
{ n: '영웅', c: '#b197fc', m: 2.2 }, { n: '에픽', c: '#ff922b', m: 3 }, { n: '전설', c: '#ffe600', m: 4.4 }];
const WB = [
  { n: '나무검', s: 'sword', r: 1, a: 6, cd: 500 }, { n: '프라이팬', s: 'pan', r: 1, a: 8, cd: 500 },
  { n: '야구방망이', s: 'bat', r: 1, a: 10, cd: 550 }, { n: '단궁', s: 'bow', r: 5, a: 9, cd: 600 },
  { n: '지팡이', s: 'staff', r: 4, a: 10, cd: 600 }, { n: '장창', s: 'spear', r: 2, a: 12, cd: 600 },
  { n: '도끼', s: 'axe', r: 1, a: 14, cd: 700 }, { n: '대검', s: 'great', r: 1, a: 18, cd: 750 }];
const AB = [{ n: '후드티', d: 3, c: '#74c0fc' }, { n: '가죽조끼', d: 4, c: '#a9744f' }, { n: '패딩', d: 5, c: '#f783ac' },
{ n: '정장', d: 6, c: '#495057' }, { n: '철갑옷', d: 7, c: '#adb5bd' }];
const HB = [{ n: '야구모자', d: 2, s: 'cap' }, { n: '털모자', d: 2, s: 'beanie' }, { n: '헬멧', d: 4, s: 'helm' },
{ n: '마법모자', d: 3, s: 'wiz' }, { n: '왕관', d: 5, s: 'crown' }];
const PF = [['낡은', '튼튼한'], ['튼튼한', '불꽃', '얼음'], ['불꽃', '얼음', '번개', '독'], ['황금', '그림자'], ['용', '별빛']];
// 히든 조합: 영웅~에픽 드랍/합성에서 특정 조합이 나오면 노란색 전설 장비
const HID = {
  'weapon|황금|1': '치킨왕의 황금프라이팬', 'weapon|그림자|3': '야행성 그림자활', 'weapon|황금|7': '엑스칼리버 대검',
  'weapon|용|7': '용왕의 대검', 'weapon|별빛|4': '유성우 지팡이', 'weapon|별빛|3': '큐피드의 단궁', 'weapon|용|6': '파천도끼', 'weapon|황금|2': '홈런왕의 방망이',
  'armor|용|4': '용린갑', 'armor|황금|2': '황금 롱패딩', 'armor|별빛|0': '은하수 후드티', 'armor|그림자|3': '암행어사 정장',
  'helm|황금|4': '황금왕관', 'helm|별빛|3': '별빛 마법모자', 'helm|용|2': '용기사의 투구'
};
const MON = [
  // id, 이름, 모양, 색, hp, atk, xp, 골드, lv, 재료
  ['slime', '초록슬라임', 'blob', '#7ed957', 30, 5, 8, 6, 1, '슬라임젤리'], ['bunny', '토끼', 'bunny', '#ffffff', 38, 6, 10, 7, 2, '토끼발'],
  ['mush', '아기버섯', 'mush', '#ff8a65', 48, 7, 13, 9, 3, '버섯갓'], ['bee', '꿀벌', 'bee', '#ffd43b', 55, 8, 15, 10, 4, '꿀'],
  ['crab', '꽃게', 'crab', '#ff6b6b', 70, 9, 19, 12, 5, '게딱지'], ['cat', '길고양이', 'cat', '#adb5bd', 85, 11, 24, 14, 6, '고양이털'],
  ['bat', '박쥐', 'bat', '#9775fa', 140, 16, 42, 25, 8, '박쥐날개'], ['ghost', '도깨비불', 'ghost', '#74c0fc', 170, 18, 50, 28, 9, '유령먼지'],
  ['pumpkin', '호박귀신', 'pumpkin', '#ff922b', 210, 21, 60, 32, 10, '호박씨'], ['snake', '꼬마뱀', 'snake', '#94d82d', 240, 23, 68, 36, 11, '뱀허물'],
  ['pmush', '독버섯', 'mush', '#be4bdb', 270, 26, 78, 40, 12, '독포자'], ['fox', '여우', 'fox', '#ffa94d', 300, 28, 90, 45, 13, '여우꼬리'],
  ['skull', '해골병사', 'skull', '#e9ecef', 520, 42, 160, 70, 15, '뼛조각'], ['spider', '거미', 'spider', '#495057', 580, 46, 190, 80, 16, '거미줄'],
  ['golem', '돌골렘', 'golem', '#868e96', 780, 50, 220, 90, 17, '마석'], ['iceblob', '얼음슬라임', 'blob', '#66d9e8', 640, 48, 200, 85, 18, '얼음조각'],
  ['fireblob', '불꽃슬라임', 'blob', '#ff6b6b', 700, 52, 230, 95, 19, '불꽃조각'], ['wisp', '불꽃정령', 'ghost', '#ff922b', 760, 55, 250, 100, 20, '정령의불씨'],
  ['imp', '꼬마악마', 'imp', '#e03131', 1200, 78, 430, 160, 25, '악마뿔'], ['shadow', '그림자', 'ghost', '#495057', 1400, 85, 500, 180, 27, '그림자조각'],
  ['dragonling', '아기용', 'dragon', '#40c057', 1700, 92, 620, 220, 28, '용비늘'], ['lavagolem', '용암골렘', 'golem', '#e8590c', 2000, 100, 720, 250, 30, '용암석'],
  // 보스
  ['kingslime', '대왕슬라임', 'blob', '#7ed957', 1100, 16, 600, 300, 4, '왕젤리', 1], ['mushking', '버섯대왕', 'mush', '#e64980', 5200, 42, 3200, 900, 12, '대왕버섯', 1],
  ['skullboss', '해골기사단장', 'skull', '#dee2e6', 15000, 95, 11000, 2500, 20, '기사단장의뼈', 1], ['dragonboss', '심곡의 용', 'dragon', '#2f9e44', 48000, 170, 38000, 8000, 30, '용의심장', 1]
].map((a, i) => ({ idx: i, id: a[0], n: a[1], s: a[2], c: a[3], hp: a[4], atk: a[5], xp: a[6], g: a[7], lv: a[8], mat: a[9], boss: a[10] || 0 }));
const MI = {}; MON.forEach(m => MI[m.id] = m);
const VAR = [{ p: '붉은', c: '#ff5252' }, { p: '푸른', c: '#4dabf7' }, { p: '황금', c: '#ffd43b' }, { p: '그림자', c: '#495057' }, { p: '분홍', c: '#f783ac' }, { p: '무지개', c: 'rainbow' }];

const { JOBS, TIER1_LV } = require('./jobs');
const QUESTS = [
  { id: 1, n: '슬라임 퇴치', lv: 1, kill: 'slime', cnt: 10, exp: 80, gold: 100, scroll: 1 },
  { id: 2, n: '토끼 사냥', lv: 1, kill: 'bunny', cnt: 10, exp: 130, gold: 150 },
  { id: 3, n: '젤리 수집', lv: 1, collect: '슬라임젤리', cnt: 8, exp: 160, gold: 200, scroll: 2 },
  { id: 4, n: '버섯 따기', lv: 3, kill: 'mush', cnt: 12, exp: 330, gold: 300 },
  { id: 5, n: '꿀 배달', lv: 4, collect: '꿀', cnt: 8, exp: 420, gold: 400, equip: 1 },
  { id: 6, n: '박쥐 소굴', lv: 8, kill: 'bat', cnt: 15, exp: 1100, gold: 800, scroll: 2 },
  { id: 7, n: '도깨비불 수집', lv: 9, collect: '유령먼지', cnt: 10, exp: 1400, gold: 900, equip: 2 },
  { id: 8, n: '뼈다귀 수집', lv: 15, collect: '뼛조각', cnt: 12, exp: 5500, gold: 2500, equip: 3 },
  { id: 9, n: '골렘 사냥', lv: 17, kill: 'golem', cnt: 20, exp: 9000, gold: 4000, scroll: 4 },
  { id: 10, n: '용비늘 수집', lv: 28, collect: '용비늘', cnt: 8, exp: 32000, gold: 12000, equip: 4 },
  { id: 100, n: '동네 청소 (반복)', lv: 1, kill: 'any', cnt: 30, exp: 0, gold: 300, rep: 1, scale: 1 }
];
const SHOP = [{ k: 'enh', n: '강화 주문서', p: 400 }, { k: 'ward', n: '보호 주문서', p: 1500 }, { k: 'hp', n: 'HP포션', p: 40 }, { k: 'mp', n: 'MP포션', p: 40 }];
const need = lv => Math.floor(30 * Math.pow(lv, 1.7));

/* ===================== 맵 ===================== */
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const MAPS = {};
function mk(id, o) {
  const { w, h, theme, seed, dens } = o, rnd = mulberry(seed), t = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) {
      let c = '.';
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) c = theme === 'cave' ? '#' : 't';
      else if (rnd() < dens) { const q = rnd(); c = theme === 'cave' ? (q < .75 ? '#' : 'r') : (q < .7 ? 't' : q < .88 ? 'r' : 'w'); }
      row.push(c);
    }
    t.push(row);
  }
  const clear = (cx, cy, r) => { for (let y = cy - r; y <= cy + r; y++)for (let x = cx - r; x <= cx + r; x++)if (x > 0 && y > 0 && x < w - 1 && y < h - 1) t[y][x] = '.'; };
  for (const p of o.portals) { t[p.y][p.x] = '.'; clear(p.x === 0 ? 2 : p.x === w - 1 ? w - 3 : p.x, p.y, 2); }
  if (o.spawn) clear(o.spawn.x, o.spawn.y, 3);
  const m = { id, name: o.name, w, h, theme, t, portals: o.portals, safe: o.safe || null, pool: o.pool, cnt: o.cnt, boss: o.boss, mobs: [], ground: [], spawn: o.spawn || { x: 2, y: 15 }, bossAt: 0, lvr: o.lvr };
  MAPS[id] = m;
}
FK.forEach((f, i) => mk(f, {
  name: FAC[f].n + ' 마을', w: 40, h: 30, theme: 'grass', seed: 100 + i, dens: .07, lvr: '1~6',
  portals: [{ x: 39, y: 15, to: 'wonmi', tx: 1, ty: 4 + i * 6 }], safe: { x0: 1, y0: 9, x1: 8, y1: 21 }, spawn: { x: 4, y: 15 },
  pool: ['slime', 'bunny', 'mush', 'bee', 'crab', 'cat'], cnt: 26, boss: ['kingslime']
}));
mk('wonmi', {
  name: '원미산', w: 50, h: 34, theme: 'forest', seed: 7, dens: .1, lvr: '8~14',
  portals: [...FK.map((f, i) => ({ x: 0, y: 4 + i * 6, to: f, tx: 38, ty: 15 })), { x: 49, y: 17, to: 'cave1', tx: 1, ty: 15 }],
  pool: ['bat', 'ghost', 'pumpkin', 'snake', 'pmush', 'fox', 'cat'], cnt: 48, boss: ['mushking']
});
mk('cave1', {
  name: '춘의 동굴', w: 50, h: 30, theme: 'cave', seed: 21, dens: .14, lvr: '15~20',
  portals: [{ x: 0, y: 15, to: 'wonmi', tx: 48, ty: 17 }, { x: 49, y: 15, to: 'cave2', tx: 1, ty: 15 }],
  pool: ['skull', 'spider', 'golem', 'iceblob', 'fireblob', 'wisp'], cnt: 42, boss: ['skullboss']
});
mk('cave2', {
  name: '심곡 지하던전', w: 50, h: 30, theme: 'cave', seed: 33, dens: .15, lvr: '25+',
  portals: [{ x: 0, y: 15, to: 'cave1', tx: 48, ty: 15 }],
  pool: ['imp', 'shadow', 'dragonling', 'lavagolem'], cnt: 40, boss: ['dragonboss']
});
const inSafe = (m, x, y) => !!m.safe && x >= m.safe.x0 && x <= m.safe.x1 && y >= m.safe.y0 && y <= m.safe.y1;
const walk = (m, x, y) => x >= 0 && y >= 0 && x < m.w && y < m.h && m.t[y][x] === '.';
const players = new Map();
let PID = 1, MID = 1;
function occ(m, x, y, self) {
  for (const o of m.mobs) if (!o.dead && o !== self && o.x === x && o.y === y) return true;
  for (const q of players.values()) if (q.map === m.id && !q.dead && q !== self && q.x === x && q.y === y) return true;
  return false;
}
function spawnMob(m, mob) {
  let x, y, n = 0;
  do { x = R(1, m.w - 2); y = R(1, m.h - 2); n++; }
  while ((!walk(m, x, y) || inSafe(m, x, y) || occ(m, x, y) || m.portals.some(p => Math.abs(p.x - x) < 4 && Math.abs(p.y - y) < 3)) && n < 80);
  const tp = mob ? MI[m.pool[0]] : null;
  const t = MI[pick(m.pool)];
  if (mob) { Object.assign(mob, { t: t.idx, x, y, hx: x, hy: y, hp: t.hp, mhp: t.hp, dead: 0, tgt: 0 }); return mob; }
  const o = { id: MID++, t: t.idx, x, y, hx: x, hy: y, hp: t.hp, mhp: t.hp, boss: 0, dead: 0, respawn: 0, atkAt: 0, mvAt: 0, tgt: 0 };
  m.mobs.push(o); return o;
}
function spawnBoss(m) {
  let x, y, n = 0;
  do { x = R(6, m.w - 6); y = R(4, m.h - 4); n++; } while ((!walk(m, x, y) || inSafe(m, x, y) || occ(m, x, y)) && n < 80);
  const t = MI[pick(m.boss)], v = R(0, VAR.length - 1);
  const o = { id: MID++, t: t.idx, x, y, hx: x, hy: y, hp: t.hp, mhp: t.hp, boss: 1, v, acc: R(0, 3), dead: 0, atkAt: 0, mvAt: 0, tgt: 0, until: now() + 40 * 60000 };
  m.mobs.push(o);
  announce(`📢 [${m.name}]에 ${VAR[v].p} ${t.n}이(가) 나타났다!`);
  return o;
}
Object.values(MAPS).forEach(m => { for (let i = 0; i < m.cnt; i++)spawnMob(m); });

/* ===================== 아이템 ===================== */
const power = it => { const arr = it.type === 'weapon' ? WB : it.type === 'armor' ? AB : HB; const base = arr[it.b][it.type === 'weapon' ? 'a' : 'd']; return Math.round(base * (1 + it.il * 0.22) * RAR[it.r].m * (1 + it.plus * 0.1) + it.plus); };
const isEq = it => it.type === 'weapon' || it.type === 'armor' || it.type === 'helm';
function rollRarity(boss) { const w = boss ? [0, 0, 500, 350, 150] : [600, 250, 100, 40, 10]; let r = Math.random() * w.reduce((a, b) => a + b); for (let i = 0; i < 5; i++) { if ((r -= w[i]) < 0) return i; } return 0; }
function buildEquip(type, il, r) {
  const arr = type === 'weapon' ? WB : type === 'armor' ? AB : HB;
  const b = R(0, Math.min(arr.length, 2 + Math.floor(il / (type === 'weapon' ? 4 : 6))) - 1);
  const pf = pick(PF[Math.min(r, 4)]); let nm = null;
  if (r >= 3) { const h = HID[type + '|' + pf + '|' + b]; if (h) { r = 5; nm = h; } }
  return { id: db.iid++, type, b, r, il, plus: 0, n: nm || (pf + ' ' + arr[b].n) };
}
function hiddenEquip(type, il) {
  const k = pick(Object.keys(HID).filter(k => k.startsWith(type + '|'))); const [, , b] = k.split('|');
  return { id: db.iid++, type, b: +b, r: 5, il, plus: 0, n: HID[k] };
}
const genEquip = (il, boss, type) => buildEquip(type || pick(['weapon', 'weapon', 'armor', 'helm']), il, rollRarity(boss));
const stackItem = (type, k, n, q) => ({ id: db.iid++, type, k, n, q });
const SN = { enh: '강화 주문서', ward: '보호 주문서', hp: 'HP포션', mp: 'MP포션' };
const mkScroll = (k, q) => stackItem('scroll', k, SN[k], q), mkPot = (k, q) => stackItem('potion', k, SN[k], q);
function giveItem(p, it) {
  if (!isEq(it)) { const s = p.inv.find(i => i.type === it.type && i.k === it.k); if (s) { s.q += it.q; p.dirty = 1; return true; } }
  if (p.inv.length >= MAXINV) { dropGround(MAPS[p.map], p.x, p.y, it); say(p, 'sys', '가방이 가득 차서 바닥에 떨어졌어요!'); return false; }
  p.inv.push(it); p.dirty = 1; return true;
}
function dropGround(m, x, y, it) { m.ground.push({ id: db.iid++, x, y, it, exp: now() + 120000 }); }
const itemLabel = it => isEq(it) ? `[${RAR[it.r].n}] ${it.n}${it.plus ? ' +' + it.plus : ''}` : `${it.n}${it.q > 1 ? ' x' + it.q : ''}`;
const sellPrice = it => isEq(it) ? Math.round((20 + it.il * 8) * RAR[it.r].m * RAR[it.r].m) + it.plus * 50 : it.type === 'scroll' ? (it.k === 'enh' ? 100 : 400) * it.q : it.type === 'potion' ? 10 * it.q : 5 * it.q;
const enhRate = plus => plus <= 2 ? 100 : Math.max(6, 100 - (plus - 2) * 8);
const boomRate = plus => plus < 5 ? 0 : Math.min(80, (plus - 4) * 10);

/* ===================== 플레이어 ===================== */
function hashPw(pw, salt) { return crypto.scryptSync(pw, salt, 32).toString('hex'); }
function send(p, o) { if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(o)); }
function bc(mapId, o) { const s = JSON.stringify(o); for (const p of players.values()) if (p.map === mapId && p.ws.readyState === 1) p.ws.send(s); }
function announce(m) { const s = JSON.stringify({ t: 'chat', ch: 'sys', m }); for (const p of players.values()) if (p.ws.readyState === 1) p.ws.send(s); }
const say = (p, ch, m, c) => send(p, { t: 'chat', ch, m, c });
function stats(p) {
  const j = JOBS[p.job], w = p.eq.weapon, a = p.eq.armor, h = p.eq.helm;
  p.mhp = Math.round((60 + p.lv * 22) * j.hp); p.mmp = Math.round((25 + p.lv * 7) * j.mp);
  p.atk = Math.round((6 + p.lv * 2.2) * j.atk + (w ? power(w) : 0));
  p.def = Math.round(p.lv * 0.8 + (a ? power(a) : 0) + (h ? power(h) : 0));
  p.hp = Math.min(p.hp, p.mhp); p.mp = Math.min(p.mp, p.mmp);
}
const defOf = p => p.def * bm(p, 'def');
const atkOf = p => p.atk * bm(p, 'atk');
function mePayload(p) {
  return {
    t: 'me', id: p.id, name: p.name, faction: p.faction, job: p.job, lv: p.lv, exp: p.exp, need: need(p.lv), gold: p.gold, hp: p.hp, mhp: p.mhp, mp: p.mp, mmp: p.mmp,
    atk: p.atk, def: p.def, inv: p.inv, eq: p.eq, q: p.q, qd: p.qd, lock: [...p.lock]
  };
}
function pubP(p) {
  const w = p.eq.weapon, a = p.eq.armor, h = p.eq.helm;
  return { i: p.id, n: p.name, f: p.faction, j: p.job, l: p.lv, x: p.x, y: p.y, d: p.d, h: p.hp, H: p.mhp, w: w ? [w.b, w.r, w.plus] : 0, ar: a ? [a.b, a.r] : 0, he: h ? [h.b, h.r] : 0, bb: p.bubT > now() ? p.bub : undefined, bf: (bm(p, 'atk') > 1 ? 1 : 0) | (bm(p, 'def') > 1 ? 2 : 0) | (bm(p, 'spd') > 1 ? 4 : 0) | (bm(p, 'spd') < 1 ? 8 : 0) | (p.stun > now() ? 16 : 0) };
}
function mapMsg(m) { return { t: 'map', id: m.id, name: m.name, w: m.w, h: m.h, theme: m.theme, rows: m.t.map(r => r.join('')), portals: m.portals.map(p => ({ x: p.x, y: p.y, n: MAPS[p.to].name })), safe: m.safe }; }
function warp(p, mapId, x, y) {
  const m = MAPS[mapId]; p.map = mapId;
  let n = 0; while (occ(m, x, y, p) && n < 20) { x += R(-1, 1); y += R(-1, 1); n++; if (!walk(m, x, y)) { x = m.spawn.x; y = m.spawn.y; } }
  p.x = x; p.y = y; send(p, mapMsg(m));
}
function save(p) {
  const a = db.acc[p.name]; if (!a) return;
  a.ch = { faction: p.faction, job: p.job, lv: p.lv, exp: p.exp, gold: p.gold, inv: p.inv, eq: p.eq, q: p.q, qd: p.qd, map: p.map, x: p.x, y: p.y, hp: p.hp, mp: p.mp };
}
let saveDirty = true;
let saving = false;
async function flush() {
  if (saving) return; saving = true;
  try {
    for (const p of players.values()) save(p);
    const json = JSON.stringify(db);
    if (pg) await pg.query("INSERT INTO game_kv (k, v) VALUES ('db', $1::jsonb) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v", [json]);
    else { fs.writeFileSync(DATA_FILE + '.tmp', json); fs.renameSync(DATA_FILE + '.tmp', DATA_FILE); }
  } catch (e) { console.error('save fail', e.message); }
  saving = false;
}
function newChar(faction) {
  const job = 'novice', J = JOBS[job], w = { id: db.iid++, type: 'weapon', b: J.w, r: 0, il: 1, plus: 0, n: '낡은 ' + WB[J.w].n };
  const a = { id: db.iid++, type: 'armor', b: 0, r: 0, il: 1, plus: 0, n: '낡은 후드티' };
  const h = { id: db.iid++, type: 'helm', b: 0, r: 0, il: 1, plus: 0, n: '낡은 야구모자' };
  return { faction, job, lv: 1, exp: 0, gold: 500, inv: [mkPot('hp', 5), mkPot('mp', 3), mkScroll('enh', 1)], eq: { weapon: w, armor: a, helm: h }, q: {}, qd: {}, map: faction, x: 4, y: 15, hp: 999, mp: 999 };
}
function addExp(p, x) {
  p.exp += x;
  while (p.exp >= need(p.lv) && p.lv < 99) {
    p.exp -= need(p.lv); p.lv++; stats(p); p.hp = p.mhp; p.mp = p.mmp; p.dirty = 1;
    bc(p.map, { t: 'fx', k: 'lvup', x: p.x, y: p.y, c: '#ffe600' }); say(p, 'sys', `🎉 레벨 ${p.lv} 달성!${p.lv >= TIER1_LV && p.job === 'novice' ? ' 🌟 1차 직업을 고를 수 있어요! (J키)' : ''}`);
    if (p.lv === TIER1_LV && p.job === 'novice') send(p, { t: 'jobpick' });
    if (p.lv % 10 === 0) announce(`🎉 ${p.name}님이 레벨 ${p.lv}에 도달했어요!`);
  }
  p.vdirty = 1;
}

/* ===================== 전투 ===================== */
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function enemiesOf(p) {
  const m = MAPS[p.map], res = [];
  for (const o of m.mobs) if (!o.dead) res.push({ k: 'm', o });
  if (!inSafe(m, p.x, p.y)) for (const q of players.values()) if (q.map === p.map && q !== p && !q.dead && q.faction !== p.faction && !inSafe(m, q.x, q.y)) res.push({ k: 'p', o: q });
  return res;
}
function nearest(p, range, list) { let best = null, bd = 1e9; for (const e of list || enemiesOf(p)) { const d = dist(p, e.o); if (d <= range + 0.42 && d < bd) { bd = d; best = e; } } return best; }
function face(p, o) { const dx = o.x - p.x, dy = o.y - p.y; if (Math.abs(dx) > Math.abs(dy)) p.d = dx < 0 ? 1 : 2; else if (dy !== 0) p.d = dy < 0 ? 3 : 0; }
function hit(p, e, mult, s) {
  const t = now();
  if (s && s.stun) e.o.stun = t + (e.k === 'p' ? s.stun * 0.6 : s.stun);
  if (s && (s.stun || s.slow) && e.k === 'p') e.o.vdirty = 1;
  let dmg = atkOf(p) * mult * (0.85 + Math.random() * 0.3); const crit = Math.random() < 0.1; if (crit) dmg *= 1.6;
  if (e.k === 'm') { dmg = Math.max(1, Math.round(dmg - MON[e.o.t].lv * 0.8)); damageMob(p, e.o, dmg, crit); }
  else { dmg = Math.max(1, Math.round(dmg * 0.5 - defOf(e.o) * 0.5)); damagePlayer(e.o, dmg, p, crit); }
}
function damageMob(p, mo, dmg, crit) {
  mo.hp -= dmg; mo.tgt = p.id; mo.last = p;
  bc(p.map, { t: 'dm', x: mo.x, y: mo.y, v: dmg, c: crit ? '#ffe600' : '#ffffff', cr: crit ? 1 : 0 });
  if (mo.hp <= 0) killMob(p, mo);
}
function damagePlayer(v, dmg, att, crit) {
  if (v.dead) return;
  v.hp -= dmg; v.vdirty = 1;
  bc(v.map, { t: 'dm', x: v.x, y: v.y, v: dmg, c: '#ff6b6b', cr: crit ? 1 : 0 });
  if (v.hp <= 0) die(v, att);
}
function die(v, att) {
  v.dead = 1; v.hp = 0; const m = MAPS[v.map];
  bc(v.map, { t: 'fx', k: 'die', x: v.x, y: v.y, c: '#ffffff' });
  if (att && att.name) {
    // 진영전 사망: 랜덤 아이템 1~3개 드랍
    const cand = v.inv.filter(i => !v.lock.has(i.id)); let n = R(1, 3); const lost = [];
    while (n-- > 0 && cand.length) { const it = cand.splice(R(0, cand.length - 1), 1)[0]; v.inv.splice(v.inv.indexOf(it), 1); dropGround(m, v.x + R(-1, 1), v.y + R(-1, 1), it); lost.push(itemLabel(it)); }
    for (const g of m.ground) if (!walk(m, g.x, g.y)) { g.x = v.x; g.y = v.y; }
    say(v, 'sys', `💀 ${att.name}님에게 쓰러졌어요!${lost.length ? ' 떨어뜨림: ' + lost.join(', ') : ''}`);
    say(att, 'sys', `⚔️ ${v.name}님을 처치했어요! 바닥의 아이템을 주워보세요`);
  } else say(v, 'sys', '💀 쓰러졌어요...');
  v.exp = Math.max(0, v.exp - Math.floor(need(v.lv) * 0.03)); v.dirty = 1;
  setTimeout(() => { if (!players.has(v.id)) return; v.dead = 0; stats(v); v.hp = v.mhp; v.mp = v.mmp; v.bf = {}; v.stun = 0; warp(v, v.faction, 4, 15); v.dirty = 1; }, 3000);
}
function killMob(p, mo) {
  const tp = MON[mo.t], m = MAPS[p.map]; mo.dead = 1;
  let xp = tp.xp; if (p.lv > tp.lv + 8) xp *= 0.3; xp = Math.round(xp);
  const gold = Math.round(tp.g * (0.6 + Math.random() * 0.8)); p.gold += gold;
  const loot = [];
  const add = it => { giveItem(p, it); loot.push(itemLabel(it)); if (isEq(it) && it.r >= 4) announce(`✨ ${p.name}님이 ${itemLabel(it)} 획득!`); };
  if (mo.boss) {
    for (let i = R(2, 3); i > 0; i--)add(genEquip(tp.lv, true));
    add(mkScroll('enh', R(3, 6))); add(mkScroll('ward', R(1, 2))); add(mkPot('hp', R(5, 10))); add(stackItem('mat', tp.mat, tp.mat, R(2, 4)));
    if (Math.random() < 0.05) add(hiddenEquip(pick(['weapon', 'armor', 'helm']), tp.lv));
    xp = tp.xp; announce(`🏆 ${p.name}님이 ${VAR[mo.v].p} ${tp.n}을(를) 처치했어요!`);
  } else {
    if (Math.random() < 0.12) add(mkPot('hp', 1)); if (Math.random() < 0.06) add(mkPot('mp', 1));
    if (Math.random() < 0.07) add(mkScroll('enh', 1)); if (Math.random() < 0.015) add(mkScroll('ward', 1));
    if (Math.random() < 0.35) add(stackItem('mat', tp.mat, tp.mat, R(1, 2)));
    if (Math.random() < 0.09) add(genEquip(tp.lv, false));
  }
  say(p, 'loot', `+${xp}exp +${gold}G ${loot.join(', ')}`);
  addExp(p, xp);
  for (const k in p.q) { const qd = QUESTS.find(q => q.id === +k); if (qd && qd.kill && (qd.kill === 'any' || qd.kill === tp.id)) p.q[k] = Math.min(qd.cnt, (p.q[k] || 0) + 1); }
  p.dirty = 1; bc(p.map, { t: 'fx', k: 'die', x: mo.x, y: mo.y, c: tp.c });
  if (mo.boss) m.mobs.splice(m.mobs.indexOf(mo), 1); else mo.respawn = now() + R(6000, 12000);
}
function basicAttack(p) {
  const t = now(); if (p.dead || t < p.atkAt || t < p.stun) return;
  const w = p.eq.weapon, wb = w ? WB[w.b] : { r: 1, cd: 500, s: 'fist' };
  p.atkAt = t + wb.cd;
  const e = nearest(p, wb.r); if (!e) return;
  face(p, e.o);
  bc(p.map, { t: 'fx', k: wb.r > 1 ? 'proj' : 'slash', i: p.id, x: p.x, y: p.y, x2: e.o.x, y2: e.o.y, c: w ? RAR[w.r].c : '#fff' });
  hit(p, e, 1);
}
const bm = (p, k) => p.bf && p.bf[k] && p.bf[k][1] > now() ? p.bf[k][0] : 1;
function castSkill(p, i) {
  const j = JOBS[p.job], s = j.sk[i], t = now();
  if (!s || p.dead || t < p.stun) return;
  if (p.lv < s.lv) return say(p, 'sys', '아직 사용할 수 없는 스킬이에요');
  if (t < p.cd[i]) return;
  if (p.mp < s.mp) return say(p, 'sys', 'MP가 부족해요');
  const use = () => { p.mp -= s.mp; p.cd[i] = t + s.cd; p.vdirty = 1; send(p, { t: 'cd', i, ms: s.cd }); };
  const fx = o => bc(p.map, Object.assign({ t: 'fx', i: p.id, c: s.c, f: s.fx, n: s.n }, o));
  const buffs = q => { if (!s.dur) return; if (s.atk) q.bf.atk = [s.atk, t + s.dur]; if (s.def) q.bf.def = [s.def, t + s.dur]; if (s.spd) q.bf.spd = [s.spd, t + s.dur]; };
  const heal = q => { if (!s.heal) return; const v = Math.round(q.mhp * s.heal); q.hp = Math.min(q.mhp, q.hp + v); q.vdirty = 1; bc(p.map, { t: 'dm', x: q.x, y: q.y, v, c: '#69db7c' }); };
  if (s.k === 'aoe') {
    const l = enemiesOf(p).filter(e => dist(p, e.o) <= s.r + 0.42).slice(0, 10); use(); fx({ k: 'ring', x: p.x, y: p.y, r: s.r }); l.forEach(e => hit(p, e, s.m, s));
  } else if (s.k === 'shot' || s.k === 'multi') {
    const e = nearest(p, s.range); if (!e) return say(p, 'sys', '대상이 없어요'); use(); face(p, e.o);
    const n = s.n || 1; for (let k = 0; k < n; k++)setTimeout(() => { if (p.dead || e.o.dead) return; fx({ k: s.range > 2 ? 'proj' : 'slash', x: p.x, y: p.y, x2: e.o.x, y2: e.o.y, big: 1 }); hit(p, e, s.m, s); }, k * 220);
  } else if (s.k === 'aoeT') {
    const e = nearest(p, s.range); if (!e) return say(p, 'sys', '대상이 없어요'); use(); face(p, e.o);
    fx({ k: 'proj', x: p.x, y: p.y, x2: e.o.x, y2: e.o.y, big: 1 });
    const cx = e.o.x, cy = e.o.y;
    setTimeout(() => { fx({ k: 'boom', x: cx, y: cy, r: s.r }); enemiesOf(p).filter(q => Math.hypot(q.o.x - cx, q.o.y - cy) <= s.r + 0.42).slice(0, 10).forEach(q => { if (!q.o.dead) hit(p, q, s.m, s); }); }, 250);
  } else if (s.k === 'dash') {
    use(); const m = MAPS[p.map], ox = p.x, oy = p.y;
    for (let k = 0; k < s.dist; k++) { const nx = p.x + DX[p.d], ny = p.y + DY[p.d]; if (!walk(m, nx, ny) || occ(m, nx, ny, p) || m.portals.some(q => q.x === nx && q.y === ny)) break; p.x = nx; p.y = ny; }
    fx({ k: 'dash', x: ox, y: oy, x2: p.x, y2: p.y });
    enemiesOf(p).filter(e => dist(p, e.o) <= 1.5).slice(0, 8).forEach(e => hit(p, e, s.m, s));
  } else if (s.k === 'abuff') {
    use(); fx({ k: 'abuff', x: p.x, y: p.y, r: s.r });
    for (const q of players.values()) if (q.map === p.map && !q.dead && q.faction === p.faction && dist(p, q) <= s.r + 0.42) { heal(q); buffs(q); }
  } else if (s.k === 'sbuff') {
    use(); fx({ k: 'sbuff', x: p.x, y: p.y }); heal(p); buffs(p);
    if (s.selfstun) { p.stun = t + s.selfstun; send(p, { t: 'stun', ms: s.selfstun }); }
  } else if (s.k === 'adebuff') {
    use(); fx({ k: 'ring', x: p.x, y: p.y, r: s.r }); buffs(p);
    for (const e of enemiesOf(p)) if (dist(p, e.o) <= s.r + 0.42) { if (e.k === 'm') e.o.slow = t + s.slow; else { e.o.bf.spd = [0.45, t + s.slow]; } }
  }
}

/* ===================== 퀘스트/강화 등 ===================== */
function questTurn(p, id) {
  const q = QUESTS.find(x => x.id === id); if (!q || !(id in p.q)) return;
  if (q.collect) { const it = p.inv.find(i => i.type === 'mat' && i.k === q.collect); if (!it || it.q < q.cnt) return say(p, 'sys', '재료가 부족해요'); it.q -= q.cnt; if (it.q <= 0) p.inv.splice(p.inv.indexOf(it), 1); }
  else if (p.q[id] < q.cnt) return say(p, 'sys', '아직 완료하지 못했어요');
  delete p.q[id]; if (!q.rep) p.qd[id] = 1;
  const exp = q.scale ? p.lv * 60 : q.exp; p.gold += q.gold; addExp(p, exp);
  const rw = []; if (q.scroll) { giveItem(p, mkScroll('enh', q.scroll)); rw.push('강화주문서 x' + q.scroll); }
  if (q.equip) { const it = buildEquip(pick(['weapon', 'armor', 'helm']), p.lv, Math.min(4, 1 + q.equip)); giveItem(p, it); rw.push(itemLabel(it)); }
  say(p, 'sys', `✅ 퀘스트 완료! +${exp}exp +${q.gold}G ${rw.join(', ')}`); p.dirty = 1;
}
function enhance(p, id, ward) {
  const it = p.inv.find(i => i.id === id) || Object.values(p.eq).find(i => i && i.id === id); if (!it || !isEq(it) || p.lock.has(id)) return;
  const sc = p.inv.find(i => i.type === 'scroll' && i.k === 'enh'); if (!sc) return say(p, 'sys', '강화 주문서가 없어요');
  const cost = (it.plus + 1) * 100; if (p.gold < cost) return say(p, 'sys', `골드가 부족해요 (${cost}G)`);
  const wd = ward ? p.inv.find(i => i.type === 'scroll' && i.k === 'ward') : null; if (ward && !wd) return say(p, 'sys', '보호 주문서가 없어요');
  const use = s => { s.q--; if (s.q <= 0) p.inv.splice(p.inv.indexOf(s), 1); };
  use(sc); p.gold -= cost; if (wd) use(wd);
  const equipped = Object.keys(p.eq).find(k => p.eq[k] === it);
  if (Math.random() * 100 < enhRate(it.plus)) { it.plus++; say(p, 'loot', `✨ 강화 성공! ${itemLabel(it)}`, '#ffe600'); send(p, { t: 'enh', ok: 1 }); if (it.plus >= 10) announce(`🔥 ${p.name}님의 ${it.n}이(가) +${it.plus} 강화 성공!`); }
  else if (Math.random() * 100 < boomRate(it.plus)) {
    if (wd) { say(p, 'sys', '🛡️ 보호 주문서가 아이템을 지켜줬어요! (강화 실패)'); send(p, { t: 'enh', ok: 0 }); }
    else { if (equipped) p.eq[equipped] = null; else p.inv.splice(p.inv.indexOf(it), 1); say(p, 'sys', `💥 펑! ${it.n}이(가) 터졌어요...`); send(p, { t: 'enh', ok: -1 }); }
  } else { say(p, 'sys', '강화 실패... (아이템은 무사해요)'); send(p, { t: 'enh', ok: 0 }); }
  stats(p); p.dirty = 1;
}
function compose(p, ids) {
  ids = [...new Set(ids)]; if (ids.length !== 3) return say(p, 'sys', '같은 부위, 같은 등급 장비 3개가 필요해요');
  const its = ids.map(id => p.inv.find(i => i.id === id)); if (its.some(i => !i || !isEq(i) || p.lock.has(i.id))) return;
  const ty = its[0].type, r = its[0].r; if (its.some(i => i.type !== ty || i.r !== r) || r >= 5) return say(p, 'sys', '같은 부위, 같은 등급(전설 제외)만 합성돼요');
  const cost = 200 * (r + 1); if (p.gold < cost) return say(p, 'sys', `골드 부족 (${cost}G)`);
  p.gold -= cost; its.forEach(i => p.inv.splice(p.inv.indexOf(i), 1));
  const il = Math.max(...its.map(i => i.il)); const ok = r < 4 ? 0.55 : 0.12;
  if (Math.random() < ok) {
    const it = r < 4 ? buildEquip(ty, il, r + 1) : hiddenEquip(ty, il); p.inv.push(it);
    say(p, 'loot', `🔮 합성 성공! ${itemLabel(it)}`, RAR[it.r].c); if (it.r >= 4) announce(`🔮 ${p.name}님이 합성으로 ${itemLabel(it)} 획득!`);
  } else say(p, 'sys', '합성 실패... 재료가 사라졌어요');
  p.dirty = 1;
}

/* ===================== 포커 ===================== */
const games = new Map();
const RNAME = ['하이카드', '원페어', '투페어', '트리플', '스트레이트', '플러시', '풀하우스', '포카드', '스트레이트 플러시'];
function newDeck() { const d = []; for (let s = 0; s < 4; s++)for (let r = 2; r <= 14; r++)d.push(r * 4 + s); for (let i = d.length - 1; i > 0; i--) { const j = R(0, i);[d[i], d[j]] = [d[j], d[i]]; } return d; }
function evalHand(h) {
  const rs = h.map(c => c >> 2).sort((a, b) => b - a), fl = h.every(c => (c & 3) === (h[0] & 3)), cn = {};
  rs.forEach(r => cn[r] = (cn[r] || 0) + 1);
  const gs = Object.keys(cn).map(Number).sort((a, b) => cn[b] - cn[a] || b - a), pat = gs.map(r => cn[r]).join('');
  let st = false, hi = rs[0];
  if (gs.length === 5) { if (rs[0] - rs[4] === 4) st = true; else if (rs.join() === '14,5,4,3,2') { st = true; hi = 5; } }
  let cat = 0; if (st && fl) cat = 8; else if (pat === '41') cat = 7; else if (pat === '32') cat = 6; else if (fl) cat = 5; else if (st) cat = 4; else if (pat === '311') cat = 3; else if (pat === '221') cat = 2; else if (pat === '2111') cat = 1;
  return [cat, ...(st ? [hi] : gs)];
}
const cmpH = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; } return 0; };
function endGame(g, why) {
  clearTimeout(g.to); for (const p of [g.a, g.b]) { games.delete(p.id); p.lock.clear(); p.dirty = 1; if (why) send(p, { t: 'pk', s: 'cancel', why }); }
}
function pkInfo(it) { return { n: itemLabel(it), r: isEq(it) ? it.r : 0, id: it.id }; }
function pkStart(g) {
  g.deck = newDeck(); g.hand = { [g.a.id]: g.deck.splice(0, 5), [g.b.id]: g.deck.splice(0, 5) }; g.sub = {}; g.st = 'draw';
  for (const [me, op] of [[g.a, g.b], [g.b, g.a]]) send(me, { t: 'pk', s: 'draw', hand: g.hand[me.id], mine: pkInfo(g.stake[me.id]), theirs: pkInfo(g.stake[op.id]), opp: op.name });
}
function pkResolve(g) {
  const ha = g.hand[g.a.id], hb = g.hand[g.b.id], ea = evalHand(ha), eb = evalHand(hb), c = cmpH(ea, eb);
  const ia = g.stake[g.a.id], ib = g.stake[g.b.id];
  const okA = g.a.inv.includes(ia), okB = g.b.inv.includes(ib);
  let w = c > 0 ? g.a : c < 0 ? g.b : null;
  if (okA && okB && w) { const lo = w === g.a ? g.b : g.a, it = w === g.a ? ib : ia; lo.inv.splice(lo.inv.indexOf(it), 1); g.a.lock.delete(ia.id); g.b.lock.delete(ib.id); giveItem(w, it); announceNear(w, `🃏 ${w.name}님이 포커에서 ${lo.name}님의 ${itemLabel(it)}을(를) 따냈어요!`); }
  for (const [me, op] of [[g.a, g.b], [g.b, g.a]]) send(me, { t: 'pk', s: 'res', mine: g.hand[me.id], theirs: g.hand[op.id], mn: RNAME[evalHand(g.hand[me.id])[0]], tn: RNAME[evalHand(g.hand[op.id])[0]], win: !w ? 'tie' : w === me ? 'win' : 'lose' });
  endGame(g);
}
function announceNear(p, m) { for (const q of players.values()) if (q.map === p.map) say(q, 'sys', m); }
function pkMsg(p, m) {
  let g = games.get(p.id);
  if (m.s === 'invite') {
    const o = players.get(+m.to); if (!o || o === p || o.map !== p.map || dist(p, o) > 8 || games.has(p.id) || games.has(o.id) || o.dead || p.dead) return say(p, 'sys', '지금은 신청할 수 없어요 (가까이 있어야 해요)');
    g = { a: p, b: o, st: 'invite', stake: {}, to: setTimeout(() => endGame(g, '시간 초과'), 120000) }; games.set(p.id, g); games.set(o.id, g);
    send(o, { t: 'pk', s: 'invited', from: p.name }); send(p, { t: 'pk', s: 'wait', opp: o.name });
  } else if (!g) return;
  else if (m.s === 'decline') endGame(g, '거절되었어요');
  else if (m.s === 'accept' && g.st === 'invite' && g.b === p) { g.st = 'stake'; for (const [me, op] of [[g.a, g.b], [g.b, g.a]]) send(me, { t: 'pk', s: 'stake', opp: op.name }); }
  else if (m.s === 'stake' && g.st === 'stake') {
    const it = p.inv.find(i => i.id === +m.id); if (!it || p.lock.has(it.id) || g.stake[p.id]) return;
    if (!isEq(it) && it.q > 1) return say(p, 'sys', '수량이 1개인 아이템이나 장비만 걸 수 있어요');
    g.stake[p.id] = it; p.lock.add(it.id); p.dirty = 1; send(p, { t: 'pk', s: 'staked' });
    if (g.stake[g.a.id] && g.stake[g.b.id]) pkStart(g);
  } else if (m.s === 'draw' && g.st === 'draw' && !g.sub[p.id]) {
    const idx = [...new Set((m.d || []).map(Number))].filter(i => i >= 0 && i < 5); const h = g.hand[p.id];
    idx.forEach(i => h[i] = g.deck.shift()); g.sub[p.id] = 1; send(p, { t: 'pk', s: 'drew' });
    if (g.sub[g.a.id] && g.sub[g.b.id]) pkResolve(g);
  } else if (m.s === 'cancel') endGame(g, p.name + '님이 취소했어요');
}

/* ===================== 접속/메시지 ===================== */
const app = express(); app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app); const wss = new WebSocketServer({ server, maxPayload: 8192 });
const INIT = { t: 'init', TIER1_LV, MON: MON.map(m => ({ id: m.id, n: m.n, s: m.s, c: m.c, boss: m.boss, lv: m.lv })), RAR, WB, AB, HB, FAC, VAR, SHOP, QUESTS, MAXINV, JOBS: Object.fromEntries(Object.entries(JOBS).map(([k, j]) => [k, { n: j.n, icon: j.icon, tier: j.tier, d: j.d, sk: j.sk, hp: j.hp, atk: j.atk, mp: j.mp }])) };
function login(ws, m) {
  const name = String(m.name || '').trim(), pw = String(m.pw || '');
  if (!/^[가-힣a-zA-Z0-9_]{2,8}$/.test(name)) return ws.send(JSON.stringify({ t: 'err', m: '이름은 2~8자 (한글/영문/숫자)' }));
  if (pw.length < 3 || pw.length > 30) return ws.send(JSON.stringify({ t: 'err', m: '비밀번호는 3자 이상' }));
  let acc = db.acc[name];
  if (acc) {
    const h = Buffer.from(hashPw(pw, acc.salt)), o = Buffer.from(acc.hash);
    if (h.length !== o.length || !crypto.timingSafeEqual(h, o)) return ws.send(JSON.stringify({ t: 'err', m: '비밀번호가 틀렸어요' }));
    for (const q of players.values()) if (q.name === name) { save(q); q.ws.close(); players.delete(q.id); }
  } else {
    if (!FAC[m.faction]) return ws.send(JSON.stringify({ t: 'need_create' }));
    const salt = crypto.randomBytes(8).toString('hex'); acc = db.acc[name] = { salt, hash: hashPw(pw, salt), ch: newChar(m.faction) };
  }
  const c = acc.ch;
  const p = Object.assign({ ws, id: PID++, name, d: 0, dead: 0, mvAt: 0, atkAt: 0, cd: [0, 0, 0, 0], bf: {}, stun: 0, lock: new Set(), dirty: 1, vdirty: 1 }, JSON.parse(JSON.stringify(c)));
  if (!MAPS[p.map]) { p.map = p.faction; p.x = 4; p.y = 15; }
  if (!JOBS[p.job]) p.job = 'novice';
  if (p.job === 'novice' && p.lv >= TIER1_LV) setTimeout(() => send(p, { t: 'jobpick' }), 500);
  stats(p); if (p.hp > 900 && c.hp === 999) { p.hp = p.mhp; p.mp = p.mmp; } p.hp = Math.max(1, p.hp);
  players.set(p.id, p); ws.pid = p.id;
  ws.send(JSON.stringify(INIT)); warp(p, p.map, p.x, p.y);
  say(p, 'sys', `${FAC[p.faction].n} 진영 ${p.name}님 환영해요! 방향키 이동 / Space 공격 / 1~4 스킬 / I 가방 / E 장비 / Q 퀘스트`);
  say(p, 'sys', '다른 진영 사람은 공격할 수 있어요. 마을 왼쪽 안전지대에서는 PvP가 안 돼요.');
  announce(`👋 ${FAC[p.faction].n} ${name}님이 접속했어요`);
}
function onMsg(p, m) {
  const t = now(), mp = MAPS[p.map];
  switch (m.t) {
    case 'mv': {
      if (p.dead || t < p.mvAt || t < p.stun) return; const d = m.d | 0; if (d < 0 || d > 3) return; p.d = d;
      const nx = p.x + DX[d], ny = p.y + DY[d]; if (!walk(mp, nx, ny) || occ(mp, nx, ny, p)) return;
      p.x = nx; p.y = ny; p.mvAt = t + Math.round(150 / bm(p, 'spd')) - 25;
      for (let i = mp.ground.length - 1; i >= 0; i--) { const g = mp.ground[i]; if (g.x === p.x && g.y === p.y) { if (p.inv.length < MAXINV || (!isEq(g.it) && p.inv.some(s => s.type === g.it.type && s.k === g.it.k))) { mp.ground.splice(i, 1); giveItem(p, g.it); say(p, 'loot', `줍기: ${itemLabel(g.it)}`); } } }
      const po = mp.portals.find(q => q.x === p.x && q.y === p.y); if (po) warp(p, po.to, po.tx, po.ty);
      break;
    }
    case 'atk': basicAttack(p); break;
    case 'sk': castSkill(p, m.i | 0); break;
    case 'chat': {
      let s = String(m.m || '').slice(0, 80).trim(); if (!s) return;
      if (ADMIN && p.name === ADMIN) { if (s === '/boss') { spawnBoss(mp); return; } if (s.startsWith('/lv ')) { p.lv = Math.min(99, +s.slice(4) || 1); p.exp = 0; stats(p); p.hp = p.mhp; p.dirty = 1; return; } if (s.startsWith('/go ')) { const mm = MAPS[s.slice(4).trim()]; if (mm) warp(p, mm.id, mm.spawn.x + 6, mm.spawn.y); return; } if (s.startsWith('/give ')) { const o = [...players.values()].find(q => q.name === s.slice(6).trim()); if (o) { o.lv = Math.max(o.lv, 1); giveItem(o, genEquip(20, true)); } return; } if (s === '/gold') { p.gold += 100000; p.dirty = 1; return; } if (s === '/scroll') { giveItem(p, mkScroll('enh', 20)); giveItem(p, mkScroll('ward', 5)); return; } }
      if (s.startsWith('/w ')) { const [, to, ...r] = s.split(' '); const o = [...players.values()].find(q => q.name === to); if (!o) return say(p, 'sys', '그런 사람이 없어요'); const msg = r.join(' '); say(o, 'w', `${p.name} → 나: ${msg}`); say(p, 'w', `나 → ${o.name}: ${msg}`); return; }
      if (s[0] === '!') { s = s.slice(1).trim(); if (!s) return; const o = JSON.stringify({ t: 'chat', ch: 'all', n: p.name, f: p.faction, m: s }); for (const q of players.values()) q.ws.send(o); return; }
      p.bub = s; p.bubT = t + 4000; bc(p.map, { t: 'chat', ch: 'map', n: p.name, f: p.faction, m: s }); break;
    }
    case 'use': {
      const it = p.inv.find(i => i.id === (m.id | 0)); if (!it || it.type !== 'potion' || p.dead) return;
      if (it.k === 'hp') { const v = Math.max(100, Math.round(p.mhp * 0.4)); p.hp = Math.min(p.mhp, p.hp + v); bc(p.map, { t: 'dm', x: p.x, y: p.y, v, c: '#69db7c' }); } else p.mp = Math.min(p.mmp, p.mp + Math.max(60, Math.round(p.mmp * 0.4)));
      if (--it.q <= 0) p.inv.splice(p.inv.indexOf(it), 1); p.dirty = 1; p.vdirty = 1; break;
    }
    case 'potion': { const it = p.inv.find(i => i.type === 'potion' && i.k === m.k); if (it) onMsg(p, { t: 'use', id: it.id }); break; }
    case 'equip': {
      const it = p.inv.find(i => i.id === (m.id | 0)); if (!it || !isEq(it) || p.lock.has(it.id)) return; const sl = it.type;
      p.inv.splice(p.inv.indexOf(it), 1); if (p.eq[sl]) p.inv.push(p.eq[sl]); p.eq[sl] = it; stats(p); p.dirty = 1; break;
    }
    case 'unequip': { const sl = m.slot; if (!p.eq[sl] || p.inv.length >= MAXINV) return; p.inv.push(p.eq[sl]); p.eq[sl] = null; stats(p); p.dirty = 1; break; }
    case 'enh': enhance(p, m.id | 0, !!m.ward); break;
    case 'compose': compose(p, (m.ids || []).map(Number).slice(0, 3)); break;
    case 'sell': { const it = p.inv.find(i => i.id === (m.id | 0)); if (!it || p.lock.has(it.id)) return; p.gold += sellPrice(it); p.inv.splice(p.inv.indexOf(it), 1); p.dirty = 1; break; }
    case 'drop': { const it = p.inv.find(i => i.id === (m.id | 0)); if (!it || p.lock.has(it.id)) return; p.inv.splice(p.inv.indexOf(it), 1); p.dirty = 1; break; }
    case 'buy': {
      const s = SHOP.find(x => x.k === m.k); const n = Math.max(1, Math.min(99, m.n | 0)); if (!s || p.gold < s.p * n) return say(p, 'sys', '골드가 부족해요');
      p.gold -= s.p * n; giveItem(p, s.k === 'hp' || s.k === 'mp' ? mkPot(s.k, n) : mkScroll(s.k, n)); p.dirty = 1; break;
    }
    case 'qa': { const q = QUESTS.find(x => x.id === (m.id | 0)); if (!q || p.lv < q.lv || (m.id in p.q) || p.qd[m.id]) return; p.q[m.id] = 0; p.dirty = 1; break; }
    case 'qt': questTurn(p, m.id | 0); break;
    case 'job': {
      const J = JOBS[m.job]; if (!J || J.tier !== 1 || p.job !== 'novice' || p.lv < TIER1_LV) return;
      p.job = m.job; p.cd = [0, 0, 0, 0]; stats(p); p.hp = p.mhp; p.mp = p.mmp; p.dirty = 1;
      bc(p.map, { t: 'fx', k: 'lvup', x: p.x, y: p.y, c: '#ff8cff' }); announce(`🌟 ${p.name}님이 [${J.n}] 직업으로 전직했어요!`); break;
    }
    case 'pk': pkMsg(p, m); break;
  }
}
wss.on('connection', ws => {
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    try { if (m.t === 'login') { if (!ws.pid) login(ws, m); } else { const p = players.get(ws.pid); if (p) onMsg(p, m); } } catch (e) { console.error(e); }
  });
  ws.on('close', () => { const p = players.get(ws.pid); if (!p) return; const g = games.get(p.id); if (g) endGame(g, p.name + '님이 나갔어요'); save(p); players.delete(p.id); });
});

/* ===================== 틱 ===================== */
let tk = 0;
function tick() {
  const t = now(); tk++;
  for (const m of Object.values(MAPS)) {
    for (let i = m.mobs.length - 1; i >= 0; i--) {
      const o = m.mobs[i];
      if (o.dead) { if (!o.boss && t > o.respawn) spawnMob(m, o); continue; }
      if (o.boss && t > o.until) { m.mobs.splice(i, 1); continue; }
      if (t < (o.stun || 0)) continue;
      const slowM = t < (o.slow || 0) ? 2.2 : 1;
      const tp = MON[o.t]; let tg = null, bd = 1e9;
      for (const q of players.values()) if (q.map === m.id && !q.dead && !inSafe(m, q.x, q.y)) { const d = dist(o, q); if (d < bd && d <= (o.tgt === q.id ? 9 : 5)) { bd = d; tg = q; } }
      if (tg) {
        if (bd <= 1.42) { if (t > o.atkAt) { o.atkAt = t + (o.boss ? 900 : 1200); const dmg = Math.max(1, Math.round(tp.atk * (0.8 + Math.random() * 0.4) - defOf(tg) * 0.5)); damagePlayer(tg, dmg, null); bc(m.id, { t: 'fx', k: 'bite', x: tg.x, y: tg.y, c: '#ff6b6b' }); } }
        else if (t > o.mvAt) { o.mvAt = t + (o.boss ? 320 : 480) * slowM; const dx = tg.x - o.x, dy = tg.y - o.y; const o1 = Math.abs(dx) > Math.abs(dy) ? [[Math.sign(dx), 0], [0, Math.sign(dy)]] : [[0, Math.sign(dy)], [Math.sign(dx), 0]]; for (const [a, b] of o1) { if (!a && !b) continue; const nx = o.x + a, ny = o.y + b; if (walk(m, nx, ny) && !occ(m, nx, ny, o) && !inSafe(m, nx, ny)) { o.x = nx; o.y = ny; break; } } }
      } else if (t > o.mvAt && Math.random() < 0.04) {
        o.mvAt = t + 600; const d = R(0, 3); let nx = o.x + DX[d], ny = o.y + DY[d]; if (Math.abs(nx - o.hx) > 8 || Math.abs(ny - o.hy) > 8) { nx = o.x + Math.sign(o.hx - o.x); ny = o.y; }
        if (walk(m, nx, ny) && !occ(m, nx, ny, o) && !inSafe(m, nx, ny)) { o.x = nx; o.y = ny; }
        if (o.hp < o.mhp) o.hp = Math.min(o.mhp, o.hp + Math.ceil(o.mhp * 0.05));
      }
    }
    for (let i = m.ground.length - 1; i >= 0; i--) if (t > m.ground[i].exp) m.ground.splice(i, 1);
    if (tk % 600 === 0 && m.boss && !m.mobs.some(o => o.boss && !o.dead) && Math.random() < 1 / 60) spawnBoss(m); // 약 1시간에 1번 (1분마다 1/60)
    const ps = []; for (const p of players.values()) if (p.map === m.id && !p.dead) ps.push(pubP(p));
    if (ps.length) bc(m.id, { t: 'st', p: ps, m: m.mobs.filter(o => !o.dead).map(o => [o.id, o.t, o.x, o.y, o.hp, o.mhp, o.v, o.acc, (t < (o.stun || 0) ? 1 : 0) | (t < (o.slow || 0) ? 2 : 0)]), g: m.ground.map(g => [g.id, g.x, g.y, isEq(g.it) ? g.it.r : 0, itemLabel(g.it)]) });
  }
  if (tk % 20 === 0) for (const p of players.values()) if (!p.dead) { p.hp = Math.min(p.mhp, p.hp + Math.ceil(p.mhp * 0.02)); p.mp = Math.min(p.mmp, p.mp + Math.ceil(p.mmp * 0.04)); p.vdirty = 1; }
  for (const p of players.values()) {
    if (p.dirty) { p.dirty = 0; send(p, mePayload(p)); }
    if (p.vdirty && tk % 3 === 0) { p.vdirty = 0; send(p, { t: 'v', hp: p.hp, mhp: p.mhp, mp: p.mp, mmp: p.mmp, exp: p.exp, need: need(p.lv), lv: p.lv, gold: p.gold }); }
  }
  if (tk % 300 === 0) flush();
}
const bye = async () => { saving = false; await flush(); process.exit(0); };
process.on('SIGTERM', bye); process.on('SIGINT', bye);
dbInit().catch(e => { console.error('DB 연결 실패:', e.message); process.exit(1); }).then(() => {
  setInterval(tick, 100);
  server.listen(PORT, () => console.log('부천 RPG 서버 시작: http://localhost:' + PORT));
});
