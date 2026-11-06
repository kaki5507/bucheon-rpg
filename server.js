'use strict';
const express = require('express'), http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const ADMIN = process.env.ADMIN_NAME || '관리자';
const ADMIN_PW = process.env.ADMIN_PW || ''; // 설정하면 이 비밀번호가 우선
const ADMIN_HASH = '41b6e75c27aca6bf421bfbbea583d230b38ce055b295fced5e93b41c416166a3'; // 기본 관리자 비밀번호의 해시
let adminFail = 0, adminLockUntil = 0;
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
  // 진영 보너스: atk/def/hp/mp 배율, spd 이동속도, gold 골드 획득
  sangdong: { n: '상동', c: '#ff6b6b', atk: 1.08, perk: '🔥 빨간 망토 · 공격력 +8%' },
  jungdong: { n: '중동', c: '#4dabf7', def: 1.15, perk: '🎒 파란 백팩 · 방어력 +15%' },
  wonjong: { n: '원종', c: '#51cf66', hp: 1.12, perk: '🌱 머리 새싹 · 최대 HP +12%' },
  yeokgok: { n: '역곡', c: '#ffd43b', spd: 1.1, perk: '🎧 노란 헤드폰 · 이동속도 +10%' },
  sosa: { n: '소사', c: '#da77f2', mp: 1.2, gold: 1.15, perk: '🐱 고양이귀 · MP +20%, 골드 +15%' }
};
const FK = Object.keys(FAC);
const RAR = [{ n: '일반', c: '#d0d0d0', m: 1 }, { n: '고급', c: '#69db7c', m: 1.3 }, { n: '희귀', c: '#4dabf7', m: 1.7 },
{ n: '영웅', c: '#b197fc', m: 2.2 }, { n: '에픽', c: '#ff922b', m: 3 }, { n: '전설', c: '#ffe600', m: 4.4 }];
const WB = [
  { n: '나무검', s: 'sword', r: 1, a: 6, cd: 500 }, { n: '프라이팬', s: 'pan', r: 1, a: 8, cd: 500 },
  { n: '야구방망이', s: 'bat', r: 1, a: 10, cd: 550 }, { n: '단궁', s: 'bow', r: 5, a: 9, cd: 600 },
  { n: '지팡이', s: 'staff', r: 4, a: 10, cd: 600 }, { n: '장창', s: 'spear', r: 2, a: 12, cd: 600 },
  { n: '도끼', s: 'axe', r: 1, a: 14, cd: 700 }, { n: '대검', s: 'great', r: 1, a: 18, cd: 750 },
  { n: '대형 냉동참치', s: 'tuna', r: 1, a: 26, cd: 800, aoe: 3 }]; // 마지막(냉동참치)은 드랍 X, 냉동참치 보스 전용
const WB_NORMAL = 8;
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
  // id, 이름, 모양, 색, hp, atk, xp, 골드, lv, 재료, 보스
  // 동네 마을 (Lv1~6)
  ['slime', '초록슬라임', 'blob', '#7ed957', 30, 5, 8, 6, 1, '슬라임젤리'], ['bunny', '토끼', 'bunny', '#ffffff', 38, 6, 10, 7, 2, '토끼발'],
  ['mush', '아기버섯', 'mush', '#ff8a65', 48, 7, 13, 9, 3, '버섯갓'], ['bee', '꿀벌', 'bee', '#ffd43b', 55, 8, 15, 10, 4, '꿀'],
  ['crab', '꽃게', 'crab', '#ff6b6b', 70, 9, 19, 12, 5, '게딱지'], ['cat', '길고양이', 'cat', '#adb5bd', 85, 11, 24, 14, 6, '고양이털'],
  ['pigeon', '비둘기', 'bird', '#a5b4c4', 75, 10, 21, 12, 5, '비둘기깃털'],
  // 상동역 술집거리 (Lv8~13)
  ['bat', '박쥐', 'bat', '#9775fa', 140, 16, 42, 25, 8, '박쥐날개'], ['beer', '맥주거품슬라임', 'blob', '#fcc419', 150, 16, 45, 26, 8, '맥주거품'],
  ['ghost', '도깨비불', 'ghost', '#74c0fc', 170, 18, 50, 28, 9, '유령먼지'], ['soju', '소주병요정', 'bottle', '#69db7c', 185, 19, 54, 30, 9, '소주병뚜껑'],
  ['skewer', '꼬치몬', 'skewer', '#e8590c', 205, 21, 60, 32, 10, '꼬치'], ['pumpkin', '호박귀신', 'pumpkin', '#ff922b', 210, 21, 60, 32, 10, '호박씨'],
  ['golbaeng', '골뱅이', 'snail', '#e9c46a', 235, 23, 67, 35, 11, '골뱅이껍데기'], ['rat', '시궁쥐', 'rat', '#868e96', 250, 24, 72, 36, 12, '쥐꼬리'],
  // 디에이트 헬스장 (Lv12~17)
  ['snake', '꼬마뱀', 'snake', '#94d82d', 240, 23, 68, 36, 11, '뱀허물'], ['pmush', '독버섯', 'mush', '#be4bdb', 270, 26, 78, 40, 12, '독포자'],
  ['fox', '여우', 'fox', '#ffa94d', 300, 28, 90, 45, 13, '여우꼬리'], ['dumbbell', '덤벨몬', 'dumbbell', '#868e96', 330, 31, 100, 48, 13, '덤벨원판'],
  ['shake', '프로틴슬라임', 'blob', '#c08552', 360, 33, 110, 52, 14, '프로틴가루'], ['muscle', '근육토끼', 'bunny', '#ffc9c9', 420, 36, 125, 58, 15, '근육토끼발'],
  ['kettle', '케틀벨몬', 'kettle', '#495057', 470, 40, 140, 62, 16, '케틀벨손잡이'],
  // 부천시청 (Lv15~21)
  ['skull', '해골병사', 'skull', '#e9ecef', 520, 42, 160, 70, 15, '뼛조각'], ['spider', '거미', 'spider', '#495057', 580, 46, 190, 80, 16, '거미줄'],
  ['paper', '서류귀신', 'paper', '#f8f9fa', 600, 46, 195, 82, 16, '결재서류'], ['stamp', '도장골렘', 'golem', '#e03131', 820, 52, 235, 95, 18, '인주'],
  ['minwon', '민원요정', 'ghost', '#ffa8a8', 720, 54, 245, 98, 19, '민원접수증'], ['clipbat', '클립박쥐', 'bat', '#adb5bd', 760, 56, 255, 100, 20, '클립'],
  // 춘의동굴 (Lv17~24)
  ['golem', '돌골렘', 'golem', '#868e96', 780, 50, 220, 90, 17, '마석'], ['iceblob', '얼음슬라임', 'blob', '#66d9e8', 640, 48, 200, 85, 18, '얼음조각'],
  ['fireblob', '불꽃슬라임', 'blob', '#ff6b6b', 700, 52, 230, 95, 19, '불꽃조각'], ['wisp', '불꽃정령', 'ghost', '#ff922b', 760, 55, 250, 100, 20, '정령의불씨'],
  ['cavebat', '동굴박쥐', 'bat', '#5f3dc4', 900, 62, 300, 115, 22, '동굴박쥐이빨'], ['crystal', '수정골렘', 'golem', '#99e9f2', 1050, 66, 340, 125, 23, '수정조각'],
  ['mole', '두더지', 'rat', '#8d5a3b', 980, 64, 320, 120, 22, '두더지발톱'],
  // 원종 지하던전 (Lv25+)
  ['imp', '꼬마악마', 'imp', '#e03131', 1200, 78, 430, 160, 25, '악마뿔'], ['shadow', '그림자', 'ghost', '#495057', 1400, 85, 500, 180, 27, '그림자조각'],
  ['dragonling', '아기용', 'dragon', '#40c057', 1700, 92, 620, 220, 28, '용비늘'], ['lavagolem', '용암골렘', 'golem', '#e8590c', 2000, 100, 720, 250, 30, '용암석'],
  ['darkknight', '흑기사', 'skull', '#343a40', 2300, 108, 820, 280, 32, '흑철조각'], ['mimic', '미믹상자', 'mimic', '#b5651d', 2100, 104, 900, 400, 31, '미믹의혀'],
  // ===== 레이드 보스 (보스 대기실 → 전용 맵) =====
  ['rmush', '거대 독버섯', 'mush', '#e8590c', 7000, 26, 0, 0, 12, '독버섯 포자', 1], ['rbroc', '거대 브로콜리', 'broccoli', '#2f9e44', 7000, 26, 0, 0, 12, '브로콜리 송이', 1],
  ['rmushbroc', '버섯브로콜리', 'mushbroc', '#74b816', 16000, 34, 0, 0, 14, '합체 포자', 1],
  ['rdino', '티라노', 'dino', '#5c940d', 45000, 72, 0, 0, 32, '공룡 이빨', 1], ['rdino2', '메가 티라노', 'dino', '#c92a2a', 80000, 96, 0, 0, 34, '메가 공룡 비늘', 1],
  ['zarm', '석상왕의 팔', 'arm', '#868e96', 12000, 92, 0, 0, 50, '석상 파편', 1], ['zbody', '석상왕', 'statue', '#adb5bd', 160000, 120, 0, 0, 52, '석상왕의 핵', 1],
  ['kraken', '심연의 문어왕', 'kraken', '#5f3dc4', 90000, 112, 0, 0, 42, '문어왕의 먹물', 1], ['tentacle', '문어 촉수', 'tentacle', '#7048e8', 9000, 82, 0, 0, 40, '촉수 조각', 1],
  ['clockking', '시계탑 마왕', 'clock', '#fab005', 220000, 185, 0, 0, 72, '시간의 톱니', 1], ['clockclone', '마왕의 분신', 'clock', '#868e96', 25000, 140, 0, 0, 70, '분신 파편', 1],
  ['zbody2', '분노한 석상왕', 'statue', '#c92a2a', 160000, 150, 0, 0, 55, '분노의 핵', 1],
  // ===== 보스 =====
  ['kingslime', '대왕슬라임', 'blob', '#7ed957', 1100, 16, 600, 300, 4, '왕젤리', 1], ['bunnyking', '대왕토끼', 'bunny', '#ffffff', 1500, 19, 800, 380, 5, '황금당근', 1],
  ['mushking', '버섯대왕', 'mush', '#e64980', 5200, 42, 3200, 900, 12, '대왕버섯', 1], ['drunkwhale', '술고래', 'whale', '#4dabf7', 6000, 45, 3600, 1000, 12, '고래수염', 1],
  ['gymking', '헬창골렘', 'golem', '#f783ac', 9000, 62, 6000, 1500, 17, '황금덤벨', 1], ['protein', '프로틴대왕', 'blob', '#a0522d', 8000, 58, 5600, 1400, 16, '대왕프로틴', 1],
  ['skullboss', '해골기사단장', 'skull', '#dee2e6', 15000, 95, 11000, 2500, 20, '기사단장의뼈', 1], ['papermaster', '결재왕 서류귀신', 'paper', '#fff3bf', 14000, 90, 10500, 2400, 21, '최종결재도장', 1],
  ['hyunchang', '천현창', 'human', '#ff8cc6', 16000, 70, 11500, 2600, 21, '천현창의 손거울', 1], ['dohyun', '김도현', 'human', '#ffe066', 16000, 66, 11500, 2600, 21, '도리스타 별조각', 1],
  ['seunghyun', '김승현', 'tennis', '#c0eb75', 1800, 14, 2000, 900, 9, '김승현의 테니스공', 1],
  ['babpuli', '밥풀이', 'dog', '#ffffff', 2400, 20, 1200, 600, 6, '밥풀이 털뭉치', 1],
  ['tuna', '냉동참치', 'tuna', '#a5d8ff', 450000, 135, 80000, 30000, 60, '참치 뱃살', 1],
  ['hwiseok', '박휘석', 'human', '#c92a2a', 52000, 160, 40000, 9000, 31, '박휘석의 볼펜', 1],
  ['grandma', '김포최명순', 'human', '#b197fc', 20000, 72, 13500, 3000, 22, '최명순의 마이크', 1],
  ['queenspider', '여왕거미', 'spider', '#862e9c', 25000, 120, 18000, 4000, 25, '여왕거미줄', 1], ['crystalking', '수정왕', 'golem', '#3bc9db', 26000, 115, 19000, 4200, 24, '왕수정', 1],
  ['dragonboss', '원종의 용', 'dragon', '#2f9e44', 48000, 170, 38000, 8000, 30, '용의심장', 1], ['lich', '리치왕', 'skull', '#9775fa', 60000, 190, 46000, 10000, 33, '리치의 왕관', 1]
].map((a, i) => ({ idx: i, id: a[0], n: a[1], s: a[2], c: a[3], hp: a[4], atk: a[5], xp: a[6], g: a[7], lv: a[8], mat: a[9], boss: a[10] || 0 }));
const MI = {}; MON.forEach(m => MI[m.id] = m);
const tp0 = o => MON[o.t];
for (const [k, b] of [['kraken', 5.0], ['tentacle', 1.8], ['clockking', 5.4], ['clockclone', 3.4], ['rmush', 3.0], ['rbroc', 3.0], ['rmushbroc', 4.4], ['rdino', 3.8], ['rdino2', 4.8], ['zarm', 1.9], ['zbody', 5.2], ['zbody2', 5.6]]) Object.assign(MI[k], { raid: 1, big: b, novar: 1 });
// 보스 스킬 (주변 범위 공격, stun/slow 가능)
const BSK = {
  kingslime: { n: '점프 착지', r: 2, m: 1.5, c: '#7ed957' }, bunnyking: { n: '당근 폭격', r: 2.5, m: 1.4, c: '#ff922b' },
  mushking: { n: '독포자 살포', r: 3, m: 1.4, c: '#be4bdb', slow: 3000 }, drunkwhale: { n: '술 분수', r: 3, m: 1.5, c: '#4dabf7', slow: 3000 },
  gymking: { n: '데드리프트 쾅', r: 2.5, m: 1.8, c: '#f783ac', stun: 1000 }, protein: { n: '프로틴 폭발', r: 3, m: 1.5, c: '#c08552' },
  skullboss: { n: '뼈 회오리', r: 3, m: 1.6, c: '#dee2e6' }, papermaster: { n: '반려 도장', r: 3, m: 1.6, c: '#e03131', stun: 1000 },
  hyunchang: { n: '잘생김 광선', r: 3.5, m: 1.7, c: '#ff8cc6', stun: 1200, fx: 'charm' }, dohyun: { n: '도리스타', r: 3.5, m: 1.3, c: '#ffe066', stun: 2200, fx: 'doristar' },
  seunghyun: { n: '스매시 난타', r: 3.2, m: 0.8, c: '#c0eb75', fx: 'tennis', cd: [5500, 8000] },
  babpuli: { n: '왈왈 짖기', r: 2.5, m: 1.2, c: '#ffc9c9', stun: 800, fx: 'charm', cd: [5000, 7000] },
  tuna: { n: '얼음 꼬리치기', r: 4.2, m: 1.3, c: '#74c0fc', stun: 1200, fx: 'tunafx', cd: [4500, 6500] },
  hwiseok: { n: '엑소시즘 볼펜 찌르기', r: 2.8, m: 1.5, c: '#4c6ef5', stun: 1200, fx: 'pen', cd: [4000, 6000] },
  grandma: { n: '마이크 샤우팅', r: 3.8, m: 1.15, c: '#ff6b6b', stun: 1600, fx: 'mic', cd: [3200, 4800] },
  queenspider: { n: '거미줄 감옥', r: 3, m: 1.5, c: '#862e9c', slow: 4000 }, crystalking: { n: '수정 파편', r: 3, m: 1.7, c: '#3bc9db' },
  dragonboss: { n: '용의 숨결', r: 3.5, m: 1.8, c: '#ff6b6b' }, lich: { n: '죽음의 저주', r: 4, m: 1.8, c: '#9775fa', slow: 4000 }
};
for (const k in BSK) MI[k].sk = BSK[k];
MI.hyunchang.twin = 'dohyun'; MI.dohyun.twin = 'hyunchang';
MI.hyunchang.look = { ar: [3, 5], he: [4, 5], w: [7, 5, 12] }; MI.dohyun.look = { ar: [2, 5], he: [3, 5], w: [4, 5, 12] };
MI.hyunchang.novar = MI.dohyun.novar = 1;
MI.hyunchang.look.shades = MI.dohyun.look.shades = 1;
// 박휘석: 하복 입은 중학생 드라큘라. 볼펜으로 엑소시스트처럼 찍음. 정석환(jsh) 직업에게 데미지 2.5배
Object.assign(MI.hwiseok, {
  novar: 1, hate: 'jsh', hateMul: 2.5, drain: .3,
  look: { skin: '#f1f3f5', hair: '#111', cardigan: '#f8f9fa', tie: '#1c3d7a', cape: ['#111', '#c92a2a'], fangs: 1, redeyes: 1, ws: 'pen', w: [0, 5, 0], pants: '#1c3d7a' },
  spawnMsg: '🧛 [{map}]에 하복 입은 드라큘라 박휘석이 볼펜을 딸깍이며 나타났다! 정석환은 도망쳐!!',
  talk: ['볼펜은 칼보다 강하다…!', '수행평가보다 무서운 게 뭔지 알려주지.', '크큭… 하복 단추는 끝까지 잠그는 게 예의다.', '악령 퇴치! 딸깍딸깍!',
    '정석환… 네놈의 정스카니즘 댄스, 오늘로 봉인이다!', '피… 아니, 잉크가 모자라…', '담임쌤한테 이르기 전에 꺼져라.', '십자가 대신 볼펜 뚜껑이다!',
    '석식 먹기 전에 끝내주지.', '흡혈은 하지만 급식은 남기지 않는다.', '0.5mm의 심판을 받아라.', '야자 째고 퇴마하러 왔다.'],
  stunTalk: ['딸깍! 퇴마!!', '엑소시즘 필기체 찌르기!!', '모나미의 이름으로!!'],
  hateTalk: ['정석환 발견!! 볼펜 연타!!!', '거기 정석환! 춤추지 마!!', '정석환은 특별히 두 배로 찍어주지!'],
  deathLine: '크윽… 내일 1교시… 수학인데…'
});
// 김승현: 거대한 테니스 괴물. 테니스공을 던져 원거리 공격하지만 약해서 Lv10 근처면 잡을 수 있음
Object.assign(MI.seunghyun, {
  novar: 1, big: 2.7, ranged: 4,
  spawnMsg: '🎾 [{map}]에 거대한 테니스 괴물 김승현이 나타났다! 라켓을 휘두르는 중…',
  talk: ['15-0!', '아웃 아니야! 인이야!!', '러브 게임 가자~', '듀스!', '에이스!!', '라켓 줄 끊어졌잖아!', '내 서브 받아봐!', '테니스 칠 사람~?', '발리! 발리!', '포핸드는 자신 있다고!', '오늘 코트 예약했어?', '공 주워 와!'],
  stunTalk: ['스매시!!!', '받아라 서브 에이스!!', '게임 셋!!'],
  deathLine: '…40-0… 내가 졌다… 다음엔 복식으로 하자…'
});
// 냉동참치: 보따리로만 소환되는 필드 보스. HP 매우 많음. 처치 시 대형 냉동참치(평타 광역 무기) 확정
Object.assign(MI.tuna, {
  novar: 1, big: 5.6,
  talk: ['…(꽁꽁 얼어 있다)', '참치는 신선함이 생명이다!!', '해동되기 전에 끝내주지!', '뱃살은 못 준다!!', '❄️ 얼어붙어라!', '나는 원양어선 출신이다…', '초밥이 될 생각은 없다!!'],
  stunTalk: ['❄️ 냉동 꼬리치기!!', '얼음 파도!!', '꽁꽁 얼어라!!'],
  deathLine: '…해동… 되어버렸다…'
});
// 밥풀이: 흰색 말티즈. 윤태정(ytj) 직업이 다가오면 주인으로 따르며 영구 탈것이 됨
Object.assign(MI.babpuli, {
  novar: 1, tameJob: 'ytj',
  spawnMsg: '🐶 [{map}]에 흰색 말티즈 밥풀이가 나타났다! 꼬리를 살랑살랑…',
  talk: ['왈!', '왈왈!!', '멍멍! 🦴', '(꼬리 살랑살랑)', '끼잉…', '왈? (갸웃)', '🐾 총총총', '(배 보여주기)'],
  deathLine: '끼잉… (털썩)'
});
const MOUNT_SPD = 1.35;
function tameCheck(m, o, t) {
  const tp = MON[o.t]; if (!tp.tameJob) return false;
  const q = [...players.values()].find(p => p.map === m.id && !p.dead && p.job === tp.tameJob && p.mount !== o.t && !p.mount && dist(o, p) <= 2.5);
  if (!q) return false;
  q.mount = 'babpuli'; q.dirty = 1; q.vdirty = 1;
  bc(m.id, { t: 'mtalk', id: o.id, m: '왈왈!! 🐶💕 (꼬리를 미친 듯이 흔든다)', loud: 1 });
  bc(m.id, { t: 'fx', k: 'abuff', x: q.x, y: q.y, r: 2, c: '#ff8cc6', f: 'charm', n: '밥풀이 탑승!', i: q.id });
  sendAll({ t: 'notice', m: `🐶 밥풀이가 [윤태정] ${q.name}님을 주인으로 선택했다! 이제 밥풀이를 타고 다닙니다 (이동속도 영구 +35%)`, c: '#ffc9c9', big: 1 });
  m.mobs.splice(m.mobs.indexOf(o), 1);
  return true;
}
// 김포최명순: 무서운 할머니 (시청 과장 st.) - 잔소리가 끝이 없음
Object.assign(MI.grandma, {
  novar: 1, look: { ar: [2, 4], w: [0, 4, 0], ws: 'mic', hair: '#dee2e6', perm: 1, glasses: 1, cardigan: '#9c36b5', grandma: 1 },
  spawnMsg: '🎤 [{map}]에 무서운 김포최명순 할머니가 마이크를 들고 나타났다! 다들 자리로!!',
  talk: ['주임! 이거 결재 누가 이렇게 올렸어!', '내가 몇 번을 말했어? 보고는 두괄식으로 하라고!', '지금 몇 시야? 9시 출근이 9시 도착이야?!',
    '이거 오타 봐라, 오타! 시민들이 보면 뭐라고 하겠어!', '엑셀 수식 또 깨졌잖아! 값 붙여넣기 하랬지!', '회의 자료 10부 뽑으랬는데 왜 9부야!',
    '내가 젊었을 땐 말이야~ 야근이 기본이었어!', '민원 전화 또 돌렸어? 응대 매뉴얼 다시 읽어!', '공문 글자 크기 15포인트로 맞추랬지!',
    '어디서 말대꾸야! 마이크 켜!', '점심 먹고 왔으면 일을 해야지 왜 졸아!', '이 보고서 다시 써와. 처음부터!',
    '주무관한테 미루지 말고 네가 해!', '연가? 이 시국에 연가를 쓴다고?', '도장 삐뚤게 찍지 말랬지!', '메신저 답장이 왜 이렇게 늦어!',
    '복사기 종이 걸린 거 누가 그냥 두고 갔어!', '내 말 듣고 있어? 메모 안 해?', '결론부터 말해, 결론부터!', '그래서 예산은 어디서 나오는데!'],
  stunTalk: ['정신 차려!!!', '똑바로 서!!', '마이크 테스트! 하나 둘! 셋!!', '전원 집합!!!'],
  deathLine: '…오늘은 이만 봐준다. 내일 아침 8시까지 보고서 올려.',
  lshEvent: 1
});
// 김포최명순 x 이소현 이벤트: 이소현 발견 → 전체에 외침 → 쫓아가서 잔소리 폭탄 → 혼자 술 먹고 꽈당
const LSH_SCOLD = ['이소현!! 거기 서!!!', '니온앤니온? 근무 시간에 춤을 춰?!', '아이돌 연습은 퇴근하고 해!!', '힐을 줘? 일을 줘야지 일을!!',
  '버프 걸 시간에 보고서를 써!!', '내가 너 신입 때부터 봤어! 응?!', '앵콜 무대? 앵콜은 야근으로 해!!', '결재판 들고 따라와! 당장!!', '…하아… 속 터져 죽겠네.'];
const LSH_DRINK = ['안 되겠다… 소주 한 잔만…', '🍶 꿀꺽꿀꺽꿀꺽…', '한 잔 더… 🍶 꿀꺽…', '어어…? 세상이 빙글빙글 도네…', '꽈당!!!'];
function grandmaEvent(m, o, t) {
  const ev = o.evt;
  if (!ev) {
    if (o.evDone) return false;
    const q = [...players.values()].find(p => p.map === m.id && !p.dead && p.job === 'lsh'); if (!q) return false;
    o.evt = { ph: 'hunt', tid: q.id, t0: t, step: 0, next: 0 };
    bc(m.id, { t: 'mtalk', id: o.id, m: '이소현!!!!!!!!', loud: 1 });
    sendAll({ t: 'notice', m: '🎤 김포최명순: "이소현!!!!!!!!" (' + m.name + ')', c: '#ff6b6b', big: 1 });
    return true;
  }
  const q = players.get(ev.tid), here = q && !q.dead && q.map === m.id;
  if (ev.ph === 'hunt') {
    if (!here || t - ev.t0 > 60000) { o.evt = null; bc(m.id, { t: 'mtalk', id: o.id, m: '…어디로 도망갔어?! 다음에 보자!', loud: 1 }); return false; }
    if (dist(o, q) <= 1.5) { ev.ph = 'scold'; ev.step = 0; ev.next = t; return true; }
    if (t > o.mvAt) {
      o.mvAt = t + 210; const dx = q.x - o.x, dy = q.y - o.y;
      const tries = Math.abs(dx) > Math.abs(dy) ? [[Math.sign(dx), 0], [0, Math.sign(dy) || 1], [0, -(Math.sign(dy) || 1)]] : [[0, Math.sign(dy)], [Math.sign(dx) || 1, 0], [-(Math.sign(dx) || 1), 0]];
      for (const [a, b] of tries) { if (!a && !b) continue; const nx = o.x + a, ny = o.y + b; if (walk(m, nx, ny) && !occ(m, nx, ny, o)) { o.x = nx; o.y = ny; break; } }
    }
    return true;
  }
  if (t < ev.next) return true;
  if (ev.ph === 'scold') {
    if (ev.step < LSH_SCOLD.length) {
      bc(m.id, { t: 'mtalk', id: o.id, m: LSH_SCOLD[ev.step], loud: 1 });
      if (here) { q.stun = t + 1300; q.vdirty = 1; }
      if (ev.step % 3 === 0) bc(m.id, { t: 'fx', k: 'ring', x: o.x, y: o.y, r: 2.5, c: '#ff6b6b', f: 'mic', mi: o.id });
      ev.step++; ev.next = t + 1250; return true;
    }
    ev.ph = 'drink'; ev.step = 0; o.drunk = 1; ev.next = t + 600; return true;
  }
  if (ev.ph === 'drink') {
    if (ev.step < LSH_DRINK.length) { bc(m.id, { t: 'mtalk', id: o.id, m: LSH_DRINK[ev.step], loud: 1 }); ev.step++; ev.next = t + 1400; return true; }
    o.evDone = 1; o.evt = null;
    sendAll({ t: 'notice', m: '🍶 김포최명순이 혼자 술 먹고 꽈당! 쓰러졌다…', c: '#ffa94d', big: 1 });
    bc(m.id, { t: 'fx', k: 'die', x: o.x, y: o.y, c: '#b197fc' });
    const winner = here ? q : [...players.values()].find(p => p.map === m.id && !p.dead);
    if (winner) { o.collapse = 1; killMob(winner, o); } else { o.dead = 1; m.mobs.splice(m.mobs.indexOf(o), 1); }
    return true;
  }
  return false;
}
const VAR = [{ p: '붉은', c: '#ff5252' }, { p: '푸른', c: '#4dabf7' }, { p: '황금', c: '#ffd43b' }, { p: '그림자', c: '#495057' }, { p: '분홍', c: '#f783ac' }, { p: '무지개', c: 'rainbow' }];

const { JOBS, TIER1_LV } = require('./jobs');
// 스토리 퀘스트: 배열 순서대로 이어짐 (rep 제외). giver=퀘스트 주는 NPC, to=찾아가서 말 걸면 완료
const QUESTS = [
  { id: 1, n: '동네의 골칫거리', giver: 'chief', lv: 1, kill: 'slime', cnt: 8, exp: 120, gold: 150, scroll: 1,
    talk: ['어이, 젊은이! 마침 잘 왔네.', '요즘 동네에 슬라임이 너무 불어나서 장독대가 남아나질 않아.', '초록슬라임 8마리만 혼내주게나!'], fin: ['허허, 역시 듬직하구먼! 이건 내 작은 성의일세.'] },
  { id: 2, n: '비둘기 소동', giver: 'chief', lv: 3, kill: 'pigeon', cnt: 8, exp: 350, gold: 300, equip: 1,
    talk: ['이번엔 비둘기들이 말썽이야.', '과자 봉지를 다 털어간다니까! 8마리만 쫓아내 주게.'], fin: ['고맙네! 이 장비는 내가 젊을 때 쓰던 걸세.'] },
  { id: 3, n: '포차 이모에게 편지를', giver: 'chief', lv: 6, to: 'pocha', exp: 500, gold: 300,
    talk: ['자네 실력이면 동네 밖에서도 통하겠어.', '상동역 술집거리 포차 이모에게 이 편지 좀 전해주게.', '마을 오른쪽 포탈로 나가면 바로일세.'], fin: ['어머, 이장님 편지네? 고마워~', '마침 일손이 필요했는데 잘 왔다!'] },
  { id: 4, n: '거품 대소동', giver: 'pocha', lv: 8, kill: 'beer', cnt: 12, exp: 1300, gold: 900, scroll: 2,
    talk: ['우리 가게 맥주가 살아서 돌아다녀!', '맥주거품슬라임 12마리만 잡아줘~ 이러다 장사 망하겠어.'], fin: ['아이고 살았다! 오늘 꼬치는 서비스야~'] },
  { id: 5, n: '꼬치 재료 구하기', giver: 'pocha', lv: 10, collect: '꼬치', cnt: 6, exp: 1800, gold: 1100, equip: 2,
    talk: ['꼬치몬들이 재료를 다 들고 도망갔어.', '꼬치몬을 잡으면 꼬치가 떨어질 거야. 6개만 주워다 줄래?'], fin: ['역시 믿을만 해! 이거 손님이 두고 간 건데 너 가져~'] },
  { id: 6, n: '헬스장의 부름', giver: 'pocha', lv: 12, to: 'gymboss', exp: 2000, gold: 800,
    talk: ['디에이트 헬스장 관장님이 사람을 찾더라.', '술집거리 오른쪽으로 쭉 가면 있어. 근육 조심해~'], fin: ['오, 포차 이모가 보냈다고? 좋은 어깨네!'] },
  { id: 7, n: '덤벨 반납 운동', giver: 'gymboss', lv: 12, kill: 'dumbbell', cnt: 12, exp: 3500, gold: 1800, scroll: 3,
    talk: ['덤벨몬들이 기구를 점령했어. 3대 몇 쳐?', '덤벨몬 12마리 정리해 주면 PT 한 달 공짜!'], fin: ['훌륭해! 오늘 하체는 쉬어도 좋아.'] },
  { id: 8, n: '시청의 긴급 호출', giver: 'gymboss', lv: 15, to: 'secretary', exp: 3000, gold: 1200,
    talk: ['부천시청에서 SOS가 왔어.', '헬스장 오른쪽 포탈로 가서 시장 비서를 만나봐.'], fin: ['와주셨군요! 시청이 엉망이에요…'] },
  { id: 9, n: '민원 폭주', giver: 'secretary', lv: 16, kill: 'minwon', cnt: 15, exp: 9000, gold: 4000, equip: 3,
    talk: ['민원요정들이 폭주해서 업무가 마비됐어요.', '15마리만 처리해 주세요!', '그리고… 가끔 엄청 잘생긴 쌍둥이가 나타난다는 소문이 있어요. 조심하세요.'], fin: ['덕분에 결재가 다시 돌아가요! 감사합니다.'] },
  { id: 10, n: '동굴의 광부', giver: 'secretary', lv: 18, to: 'miner', exp: 6000, gold: 2000,
    talk: ['시청 오른쪽, 춘의동굴 입구에 광부 할아버지가 계세요.', '동굴에 이상한 일이 생겼대요.'], fin: ['허허, 시청에서 보냈나. 앉게나.'] },
  { id: 11, n: '수정 채굴', giver: 'miner', lv: 20, collect: '수정조각', cnt: 8, exp: 16000, gold: 6000, equip: 4,
    talk: ['수정골렘들이 광맥을 다 먹어치웠어.', '수정조각 8개를 모아다 주게. 그걸로 깊은 곳의 문을 열 수 있어.'], fin: ['좋아, 문이 열렸네.', '원종 지하던전 입구의 점술가를 찾아가게.'] },
  { id: 12, n: '흑기사의 그림자', giver: 'fortune', lv: 26, kill: 'darkknight', cnt: 15, exp: 60000, gold: 25000, scroll: 10, equip: 4,
    talk: ['기다리고 있었다, 부천의 용사여…', '지하던전의 흑기사들이 원종의 용을 깨우려 한다.', '흑기사 15명을 쓰러뜨려라. 용과 리치왕을 조심하거라.'], fin: ['네가 바로 부천의 영웅이구나.', '이 이야기는… 다음 장에서 계속된다.'] },
  { id: 100, n: '때밀이 알바 (반복)', giver: 'sesin', lv: 5, kill: 'any', cnt: 30, exp: 0, gold: 500, scale: 1, rep: 1,
    talk: ['사우나 오니까 개운하지?', '어디서든 몬스터 30마리 잡고 오면 용돈 줄게. 몇 번이고 해도 돼!'], fin: ['수고했어! 시원하게 한 판 더?'] }
];
const NPCS = {
  gate10: { n: '🍄 Lv10 레이드 안내원', look: { ar: [1, 2], he: [1, 2], w: [5, 2, 0] }, hi: [] },
  gate30: { n: '🦖 Lv30 레이드 안내원', look: { ar: [4, 3], he: [2, 3], w: [6, 3, 0] }, hi: [] },
  merchant: { n: '🛒 잡화상인', look: { ar: [1, 0], he: [0, 0] }, hi: ['포션이랑 주문서 있어요~'] },
  gate40: { n: '🐙 Lv40 레이드 안내원 (3인↑)', look: { ar: [1, 3], he: [3, 3], w: [5, 3, 0] }, hi: [] },
  gate70: { n: '🕰️ Lv70 레이드 안내원 (3인↑)', look: { ar: [3, 5], he: [4, 5], w: [4, 5, 0] }, hi: [] },
  gate50: { n: '🗿 Lv50 레이드 안내원', look: { ar: [3, 4], he: [4, 4], w: [7, 4, 0] }, hi: [] },
  chief: { n: '이장님', look: { ar: [3, 0], he: [1, 0] }, hi: ['오늘도 평화로운 동네일세.', '마을 오른쪽 포탈로 나가면 상동역 술집거리야.'] },
  pocha: { n: '포차 이모', look: { ar: [2, 0], he: [1, 1], w: [1, 0, 0] }, hi: ['어서 와~ 오늘 꼬치 맛있어!', '위쪽 포탈로 가면 사우나야. 피로 풀고 와~'] },
  sesin: { n: '세신사 아저씨', look: { ar: [0, 0] }, hi: ['때 밀 사람~?', '여긴 세이브존이라 싸움 금지야. 푹 쉬다 가.'] },
  gymboss: { n: '관장님', look: { ar: [4, 0] }, hi: ['득근하자!', '단백질은 몬스터한테서 나온다.'] },
  secretary: { n: '시장 비서', look: { ar: [3, 2] }, hi: ['번호표 뽑고 기다려 주세요.', '시청은 오늘도 바쁩니다…'] },
  miner: { n: '광부 할아버지', look: { ar: [1, 0], he: [2, 0], w: [6, 0, 0] }, hi: ['동굴은 위험해. 조심하게.', '수정이 반짝이는 쪽이 깊은 곳이야.'] },
  fortune: { n: '수상한 점술가', look: { ar: [3, 4], he: [3, 4], w: [4, 4, 0] }, hi: ['너의 운명이 보인다…', '용의 숨결이 느껴지는구나.'] }
};
const QCHAIN = QUESTS.filter(q => !q.rep);
function qAvail(p, q) {
  if (p.qd[q.id] || (q.id in p.q) || p.lv < q.lv) return false;
  if (q.rep) return true;
  const i = QCHAIN.indexOf(q); return QCHAIN.slice(0, i).every(x => p.qd[x.id]);
}
function qReady(p, q) {
  if (!(q.id in p.q)) return false;
  if (q.collect) { const it = p.inv.find(i => i.type === 'mat' && i.k === q.collect); return !!it && it.q >= q.cnt; }
  if (q.to) return false;
  return p.q[q.id] >= q.cnt;
}
const SHOP = [{ k: 'hp', n: 'HP포션 (40% 회복)', p: 40 }, { k: 'mp', n: 'MP포션 (40% 회복)', p: 40 }, { k: 'hp2', n: '고급 HP포션 (75% 회복)', p: 160 }, { k: 'mp2', n: '고급 MP포션 (75% 회복)', p: 160 },
  { k: 'elixir', n: '엘릭서 (HP·MP 완전 회복)', p: 1200 }, { k: 'enh', n: '강화 주문서', p: 400 }, { k: 'bless', n: '축복 주문서 (강화 성공률 +15%)', p: 3000 }, { k: 'ward', n: '보호 주문서 (파괴 방지)', p: 1500 }];
const POTS = { hp: [.4, 0], mp: [0, .4], hp2: [.75, 0], mp2: [0, .75], elixir: [1, 1] };
const need = lv => Math.floor(30 * Math.pow(lv, 1.7) * (lv >= 30 ? 1 + (lv - 29) * 0.12 : 1)); // Lv30부터 점점 느리게

/* ===================== 맵 ===================== */
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const MAPS = {};
// 테마별: 테두리 문자, 장애물 [문자, 비율]
const THEME = {
  grass: { edge: 't', obs: [['t', .7], ['r', .18], ['w', .12]] },
  cave: { edge: '#', obs: [['#', .75], ['r', .25]] },
  street: { edge: 'B', obs: [['p', .45], ['b', .3], ['n', .25]] },   // 건물, 포장마차, 맥주박스, 네온간판
  gym: { edge: 'G', obs: [['m', .5], ['d', .3], ['k', .2]] },          // 벽, 운동기구, 덤벨랙, 벤치
  hall: { edge: 'H', obs: [['c', .35], ['f', .35], ['k', .3]] },        // 벽, 기둥, 화분, 책상
  sauna: { edge: 'S', obs: [['h', .7], ['k', .3]] },                    // 벽, 온탕, 평상
  altar: { edge: 'W', obs: [['r', 1]] }, arena4: { edge: 'W', obs: [['r', 1]] }, arena5: { edge: 'W', obs: [['r', 1]] }, arena1: { edge: 'W', obs: [['r', 1]] }, arena2: { edge: 'W', obs: [['r', 1]] }, arena3: { edge: 'W', obs: [['r', 1]] }
};
function mk(id, o) {
  const { w, h, theme, seed, dens } = o, rnd = mulberry(seed), t = [], TH = THEME[theme];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) {
      let c = '.';
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) c = TH.edge;
      else if (rnd() < dens) { let q = rnd(); c = TH.obs[TH.obs.length - 1][0]; for (const [ch, pr] of TH.obs) { if ((q -= pr) < 0) { c = ch; break; } } }
      row.push(c);
    }
    t.push(row);
  }
  const clear = (cx, cy, r) => { for (let y = cy - r; y <= cy + r; y++)for (let x = cx - r; x <= cx + r; x++)if (x > 0 && y > 0 && x < w - 1 && y < h - 1) t[y][x] = '.'; };
  for (const p of o.portals) { t[p.y][p.x] = '.'; clear(p.x === 0 ? 2 : p.x === w - 1 ? w - 3 : p.x, p.y === 0 ? 2 : p.y === h - 1 ? h - 3 : p.y, 2); }
  if (o.spawn) clear(o.spawn.x, o.spawn.y, 3);
  const safes = (o.safes || []).map(z => z.all ? { x0: 0, y0: 0, x1: w - 1, y1: h - 1, all: 1, label: z.label } : z);
  for (const z of safes) if (!z.all) { for (let y = z.y0; y <= z.y1; y++) for (let x = z.x0; x <= z.x1; x++) if (x > 0 && y > 0 && x < w - 1 && y < h - 1) t[y][x] = '.'; if (z.f) { t[z.y0][z.x0] = 'Y'; t[z.y0][z.x1] = 'Y'; } }
  // 안전지대에서 반드시 걸어 나갈 수 있게 길 뚫기
  for (const z of safes) if (!z.all) {
    const cy = (z.y0 + z.y1) >> 1, cx = (z.x0 + z.x1) >> 1, open = (x, y) => { if (x > 0 && y > 0 && x < w - 1 && y < h - 1 && t[y][x] !== 'Y') t[y][x] = '.'; };
    if (z.f) { for (let x = z.x0 - 1; x <= z.x1 + 1; x++) { open(x, z.y0 - 1); open(x, z.y1 + 1); } for (let y = z.y0 - 1; y <= z.y1 + 1; y++) { open(z.x0 - 1, y); open(z.x1 + 1, y); } }
    else for (let x = z.x1 + 1; x <= z.x1 + 8; x++) for (let y = cy - 1; y <= cy + 1; y++) open(x, y);
  }
  for (const n of o.npcs || []) t[n.y][n.x] = 'N';
  for (const n of o.npcs || []) { clear(n.x, n.y, 1); t[n.y][n.x] = 'N'; }
  const m = { orig: t.map(r => r.slice()), npcs: (o.npcs || []).map(n => ({ id: n.id, x: n.x, y: n.y })), id, name: o.name, w, h, theme, t, portals: o.portals, safes, sl: o.sl || '', pool: o.pool || [], cnt: o.cnt || 0, boss: o.boss || null, mobs: [], ground: [], spawn: o.spawn || { x: 2, y: 15 }, lvr: o.lvr, regen: o.regen || 1 };
  MAPS[id] = m;
}
// 첫 맵: 부천 들판. 5개 동네 마을(안전지대)이 위/대각선/아래에 있고 바로 밖에서 사냥·진영전
const VW = 52, VH = 40;
const VILLAGE = { // 마을 안전지대 좌상단 (가로 11, 세로 8)
  sangdong: { x: 21, y: 1, dir: '위' }, jungdong: { x: 2, y: 2, dir: '왼쪽 위' }, yeokgok: { x: 39, y: 2, dir: '오른쪽 위' },
  wonjong: { x: 2, y: 30, dir: '왼쪽 아래' }, sosa: { x: 39, y: 30, dir: '오른쪽 아래' }
};
const villageSpawn = f => { const v = VILLAGE[f] || VILLAGE.sangdong; return { map: 'bucheon', x: v.x + 5, y: v.y + 4 }; };
mk('bucheon', {
  name: '부천 들판', w: VW, h: VH, theme: 'grass', seed: 101, dens: .06, lvr: '1~7',
  portals: [{ x: 26, y: VH - 1, to: 'pub', tx: 4, ty: 17 }, { x: 26, y: 20, to: 'bosshub', tx: 13, ty: 12 }],
  safes: FK.map(f => ({ x0: VILLAGE[f].x, y0: VILLAGE[f].y, x1: VILLAGE[f].x + 10, y1: VILLAGE[f].y + 7, f, label: '🏠 ' + FAC[f].n + ' 마을' })),
  npcs: FK.flatMap(f => [{ id: 'chief', x: VILLAGE[f].x + 5, y: VILLAGE[f].y + 1 }, { id: 'merchant', x: VILLAGE[f].x + 8, y: VILLAGE[f].y + 3 }]),
  pool: ['slime', 'bunny', 'mush', 'bee', 'crab', 'cat', 'pigeon'], cnt: 55, boss: ['kingslime', 'bunnyking', 'babpuli', 'babpuli']
});
// 보스 대기실 + 레이드 맵 (한 번에 한 팀만)
mk('bosshub', {
  name: '⚔️ 보스 대기실', w: 27, h: 16, theme: 'altar', seed: 5, dens: 0, lvr: '레이드',
  portals: [{ x: 13, y: 15, to: 'bucheon', tx: 26, ty: 22 }], safes: [{ all: 1, label: '⚔️ 보스 대기실 · 안내원에게 말 걸어 레이드 참여' }], spawn: { x: 13, y: 12 },
  npcs: [{ id: 'gate10', x: 4, y: 5 }, { id: 'gate30', x: 9, y: 4 }, { id: 'gate40', x: 13, y: 3 }, { id: 'gate50', x: 17, y: 4 }, { id: 'gate70', x: 22, y: 5 }]
});
for (const [id, nm, w, h, th] of [['raid1', '🍄 버섯브로콜리 레이드', 30, 20, 'arena1'], ['raid2', '🦖 티라노 레이드', 32, 22, 'arena2'], ['raid3', '🗿 석상왕 레이드', 34, 24, 'arena3'], ['raid4', '🐙 심연의 문어왕 레이드', 34, 24, 'arena4'], ['raid5', '🕰️ 시계탑 마왕 레이드', 36, 26, 'arena5']])
  mk(id, { name: nm, w, h, theme: th, seed: 9, dens: 0, lvr: '레이드', portals: [{ x: 0, y: h - 3, to: 'bosshub', tx: 13, ty: 12 }], spawn: { x: w >> 1, y: h - 3 } });
mk('royale', { name: '🔥 무한장', w: 44, h: 32, theme: 'grass', seed: 77, dens: .05, lvr: '이벤트', portals: [], spawn: { x: 22, y: 16 } });
const SZ = (cy, label) => [{ x0: 1, y0: cy - 3, x1: 7, y1: cy + 3, label: label || '🏕️ 안전지대' }];
mk('pub', {
  name: '상동역 술집거리', w: 50, h: 34, theme: 'street', seed: 7, dens: .08, lvr: '8~13', npcs: [{ id: 'pocha', x: 4, y: 15 }, { id: 'merchant', x: 6, y: 19 }], safes: SZ(17), spawn: { x: 4, y: 17 },
  portals: [{ x: 0, y: 17, to: 'bucheon', tx: 38, ty: VH - 3 }, { x: 49, y: 17, to: 'gym', tx: 2, ty: 15 }, { x: 25, y: 0, to: 'sauna', tx: 15, ty: 17 }],
  pool: ['bat', 'beer', 'ghost', 'soju', 'skewer', 'pumpkin', 'golbaeng', 'rat'], cnt: 46, boss: ['mushking', 'drunkwhale', 'seunghyun', 'seunghyun']
});
mk('sauna', {
  name: '♨️ 사우나 (세이브존)', w: 30, h: 20, theme: 'sauna', seed: 55, dens: .06, lvr: '휴식',
  portals: [{ x: 15, y: 19, to: 'pub', tx: 25, ty: 2 }], npcs: [{ id: 'sesin', x: 15, y: 6 }], safes: [{ all: 1, label: '♨️ 세이브존 · PvP/몬스터 없음 · HP/MP 빠른 회복' }], sl: '♨️ 세이브존 · PvP/몬스터 없음 · HP/MP 빠른 회복', spawn: { x: 15, y: 10 }, regen: 6
});
mk('gym', {
  name: '디에이트 헬스장', w: 44, h: 30, theme: 'gym', seed: 77, dens: .09, lvr: '12~17', npcs: [{ id: 'gymboss', x: 4, y: 13 }], safes: SZ(15), spawn: { x: 4, y: 15 },
  portals: [{ x: 0, y: 15, to: 'pub', tx: 47, ty: 17 }, { x: 43, y: 15, to: 'hall', tx: 2, ty: 15 }],
  pool: ['snake', 'pmush', 'fox', 'dumbbell', 'shake', 'muscle', 'kettle'], cnt: 40, boss: ['gymking', 'protein']
});
mk('hall', {
  name: '부천시청', w: 50, h: 30, theme: 'hall', seed: 88, dens: .08, lvr: '15~21', npcs: [{ id: 'secretary', x: 4, y: 13 }], safes: SZ(15), spawn: { x: 4, y: 15 },
  portals: [{ x: 0, y: 15, to: 'gym', tx: 41, ty: 15 }, { x: 49, y: 15, to: 'cave1', tx: 2, ty: 15 }],
  pool: ['skull', 'spider', 'paper', 'stamp', 'minwon', 'clipbat'], cnt: 42, boss: ['hyunchang', 'hyunchang', 'grandma', 'grandma', 'skullboss', 'papermaster']
});
mk('cave1', {
  name: '춘의동굴', w: 50, h: 30, theme: 'cave', seed: 21, dens: .14, lvr: '17~24', npcs: [{ id: 'miner', x: 4, y: 13 }], safes: SZ(15), spawn: { x: 4, y: 15 },
  portals: [{ x: 0, y: 15, to: 'hall', tx: 47, ty: 15 }, { x: 49, y: 15, to: 'cave2', tx: 2, ty: 15 }],
  pool: ['golem', 'iceblob', 'fireblob', 'wisp', 'cavebat', 'crystal', 'mole'], cnt: 42, boss: ['queenspider', 'crystalking']
});
mk('cave2', {
  name: '원종 지하던전', w: 50, h: 30, theme: 'cave', seed: 33, dens: .15, lvr: '25+', npcs: [{ id: 'fortune', x: 4, y: 13 }], safes: SZ(15), spawn: { x: 4, y: 15 },
  portals: [{ x: 0, y: 15, to: 'cave1', tx: 47, ty: 15 }],
  pool: ['imp', 'shadow', 'dragonling', 'lavagolem', 'darkknight', 'mimic'], cnt: 40, boss: ['dragonboss', 'lich', 'hwiseok', 'hwiseok']
});
const inSafe = (m, x, y) => m.safes.some(z => x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1);
const walk = (m, x, y) => x >= 0 && y >= 0 && x < m.w && y < m.h && (m.t[y][x] === '.' || m.t[y][x] === 'L');
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
function spawnBoss(m, id, near) {
  let x, y, n = 0;
  do { if (near) { x = near.x + R(-4, 4); y = near.y + R(-4, 4); } else { x = R(6, m.w - 6); y = R(4, m.h - 4); } n++; } while ((!walk(m, x, y) || inSafe(m, x, y) || occ(m, x, y)) && n < 120);
  const t = MI[id] || MI[pick(m.boss)], v = t.novar ? null : R(0, VAR.length - 1);
  const o = { id: MID++, t: t.idx, x, y, hx: x, hy: y, hp: t.hp, mhp: t.hp, boss: 1, v, acc: R(0, 3), dead: 0, atkAt: 0, mvAt: 0, tgt: 0, skAt: now() + 4000, until: now() + 40 * 60000 };
  m.mobs.push(o);
  const nm = (v == null ? '' : VAR[v].p + ' ') + t.n;
  if (t.twin && !near?.twin) { spawnBoss(m, t.twin, { x, y, twin: 1 }); announce(`📢 [${m.name}]에 잘생긴 쌍둥이 보스 ${t.n} & ${MI[t.twin].n}이(가) 나타났다! ✨`); }
  else if (!near?.twin) announce(t.spawnMsg ? t.spawnMsg.replace('{map}', m.name) : `📢 [${m.name}]에 ${nm}이(가) 나타났다!`);
  return o;
}
Object.values(MAPS).forEach(m => { if (m.pool.length) for (let i = 0; i < m.cnt; i++)spawnMob(m); });

/* ===================== 아이템 ===================== */
const power = it => { const arr = it.type === 'weapon' ? WB : it.type === 'armor' ? AB : HB; const base = arr[it.b][it.type === 'weapon' ? 'a' : 'd']; return Math.round(base * (1 + it.il * 0.22) * RAR[it.r].m * (1 + it.plus * 0.1) + it.plus); };
const ADMIN_TIP = '👑 관리자 모드 (👑 버튼)';
const isEq = it => it.type === 'weapon' || it.type === 'armor' || it.type === 'helm';
// 등급 확률 (일반/고급/희귀/영웅/에픽). 크게 하향
function rollRarity(boss) { const w = boss ? [300, 420, 210, 62, 8] : [820, 155, 22, 2.7, 0.3]; let r = Math.random() * w.reduce((a, b) => a + b); for (let i = 0; i < 5; i++) { if ((r -= w[i]) < 0) return i; } return 0; }
const tunaWeapon = () => ({ id: db.iid++, type: 'weapon', b: 8, r: 5, il: 70, plus: 0, n: '대형 냉동참치', atkb: 160, hpb: 600 });
const TUNA_RECIPE = { '합체 포자': 2, '메가 공룡 비늘': 2, '문어왕의 먹물': 1, '분노의 핵': 1 }, TUNA_GOLD = 500000;
function craftTuna(p) {
  const cnt = k => (p.inv.find(i => i.type === 'mat' && i.k === k) || { q: 0 }).q;
  const lack = Object.entries(TUNA_RECIPE).filter(([k, n]) => cnt(k) < n).map(([k, n]) => `${k} ${cnt(k)}/${n}`);
  if (lack.length) return say(p, 'sys', '재료가 부족해요: ' + lack.join(', '));
  if (p.gold < TUNA_GOLD) return say(p, 'sys', `골드가 부족해요 (${TUNA_GOLD.toLocaleString()}G)`);
  for (const [k, n] of Object.entries(TUNA_RECIPE)) { const it = p.inv.find(i => i.type === 'mat' && i.k === k); it.q -= n; if (it.q <= 0) p.inv.splice(p.inv.indexOf(it), 1); }
  p.gold -= TUNA_GOLD; giveItem(p, stackItem('bundle', 'tuna', '냉동참치 보따리', 1)); p.dirty = 1;
  say(p, 'loot', '🧊 냉동참치 보따리 제작 완료! 가방에서 사용하면 그 자리에 냉동참치 보스가 나타나요', '#a5d8ff');
  sendAll({ t: 'notice', m: `🧊 ${p.name}님이 냉동참치 보따리를 만들었다…!`, c: '#a5d8ff' });
}
function useTunaBag(p, it) {
  const m = MAPS[p.map];
  if (inSafe(m, p.x, p.y) || m.id.startsWith('raid') || ['royale', 'bosshub', 'sauna'].includes(m.id)) return say(p, 'sys', '여기서는 냉동참치를 꺼낼 수 없어요 (사냥터에서 사용하세요)');
  if (Object.values(MAPS).some(mm => mm.mobs.some(o => !o.dead && MON[o.t].id === 'tuna'))) return say(p, 'sys', '이미 어딘가에 냉동참치가 있어요!');
  if (--it.q <= 0) p.inv.splice(p.inv.indexOf(it), 1); p.dirty = 1;
  const o = spawnBoss(m, 'tuna', p); o.until = now() + 60 * 60000;
  bc(m.id, { t: 'fx', k: 'boom', x: o.x, y: o.y, r: 5, c: '#a5d8ff' }); bc(m.id, { t: 'shake', ms: 1000 });
  sendAll({ t: 'notice', m: `🐟 [${m.name}] ${p.name}님이 냉동참치 보따리를 풀었다!! 거대한 냉동참치 보스 등장!!`, c: '#a5d8ff', big: 1 });
}
function buildEquip(type, il, r) {
  const arr = type === 'weapon' ? WB : type === 'armor' ? AB : HB;
  const b = R(0, Math.min(type === 'weapon' ? WB_NORMAL : arr.length, 2 + Math.floor(il / (type === 'weapon' ? 4 : 6))) - 1);
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
const SN = { enh: '강화 주문서', ward: '보호 주문서', bless: '축복 주문서', hp: 'HP포션', mp: 'MP포션', hp2: '고급 HP포션', mp2: '고급 MP포션', elixir: '엘릭서' };
const mkScroll = (k, q) => stackItem('scroll', k, SN[k], q), mkPot = (k, q) => stackItem('potion', k, SN[k], q);
function giveItem(p, it) {
  if (!isEq(it)) { const s = p.inv.find(i => i.type === it.type && i.k === it.k); if (s) { s.q += it.q; p.dirty = 1; return true; } }
  if (p.inv.length >= MAXINV) { dropGround(MAPS[p.map], p.x, p.y, it); say(p, 'sys', '가방이 가득 차서 바닥에 떨어졌어요!'); return false; }
  p.inv.push(it); p.dirty = 1; return true;
}
function dropGround(m, x, y, it, own) { m.ground.push({ id: db.iid++, x, y, it, exp: now() + 120000, own: own || 0, ownT: now() + 20000 }); }
const SPIRAL = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1], [2, 0], [-2, 0], [0, 2], [0, -2], [2, 1], [-2, -1], [1, 2], [-1, -2]];
function spreadDrop(m, x, y, items, own) {
  let k = 0; for (const it of items) { for (let n = 0; n < SPIRAL.length; n++) { const [dx, dy] = SPIRAL[(k + n) % SPIRAL.length]; if (walk(m, x + dx, y + dy)) { dropGround(m, x + dx, y + dy, it, own); break; } } k++; }
}
const mkGold = q => ({ id: db.iid++, type: 'gold', k: 'gold', n: '골드', q });
function pickUp(p) {
  const m = MAPS[p.map], t = now(); let got = 0, full = 0, other = 0;
  for (let i = m.ground.length - 1; i >= 0; i--) {
    const g = m.ground[i]; if (Math.abs(g.x - p.x) > 1 || Math.abs(g.y - p.y) > 1) continue;
    if (g.own && g.own !== p.id && t < g.ownT) { other++; continue; }
    if (g.it.type === 'gold') { p.gold += g.it.q; m.ground.splice(i, 1); got++; say(p, 'loot', `💰 +${g.it.q}G`); continue; }
    if (p.inv.length >= MAXINV && (isEq(g.it) || !p.inv.some(s => s.type === g.it.type && s.k === g.it.k))) { full++; continue; }
    m.ground.splice(i, 1); giveItem(p, g.it); got++; say(p, 'loot', `줍기: ${itemLabel(g.it)}`, isEq(g.it) ? RAR[g.it.r].c : null);
    if (isEq(g.it) && g.it.r >= 3) { const msg = { t: 'notice', m: `✨ ${p.name}님이 ${itemLabel(g.it)}을(를) 획득했습니다!`, c: RAR[g.it.r].c, big: g.it.r >= 5 ? 1 : 0 }; sendAll(msg, g.it.r >= 4 ? null : p.map); }
  }
  if (full) say(p, 'sys', '가방이 가득 찼어요!'); else if (!got && other) say(p, 'sys', '다른 사람의 아이템이에요 (20초 뒤 누구나 주울 수 있어요)');
  if (got) { p.dirty = 1; p.vdirty = 1; }
}
const itemLabel = it => it.type === 'gold' ? `💰 ${it.q}G` : isEq(it) ? `[${RAR[it.r].n}] ${it.n}${it.plus ? ' +' + it.plus : ''}` : `${it.n}${it.q > 1 ? ' x' + it.q : ''}`;
const sellPrice = it => isEq(it) ? Math.round((20 + it.il * 8) * RAR[it.r].m * RAR[it.r].m) + it.plus * 50 : it.type === 'scroll' ? (it.k === 'enh' ? 100 : 400) * it.q : it.type === 'potion' ? 10 * it.q : 5 * it.q;
// 강화 확률: 높이 올릴수록 성공률 ↓, 실패 시 파괴 확률 ↑
const enhRate = plus => plus <= 2 ? 100 : plus <= 5 ? 100 - (plus - 2) * 10 : Math.max(5, 70 - (plus - 5) * 7);
const boomRate = plus => plus < 4 ? 0 : plus <= 6 ? (plus - 3) * 10 : Math.min(90, 30 + (plus - 6) * 8);

/* ===================== 플레이어 ===================== */
function hashPw(pw, salt) { return crypto.scryptSync(pw, salt, 32).toString('hex'); }
function send(p, o) { if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(o)); }
function bc(mapId, o) { const s = JSON.stringify(o); for (const p of players.values()) if (p.map === mapId && p.ws.readyState === 1) p.ws.send(s); }
function sendAll(o, mapId) { const s = JSON.stringify(o); for (const p of players.values()) if (p.ws.readyState === 1 && (!mapId || p.map === mapId)) p.ws.send(s); }
const who = p => ({ n: p.name, f: p.faction });
function announce(m) { const s = JSON.stringify({ t: 'chat', ch: 'sys', m }); for (const p of players.values()) if (p.ws.readyState === 1) p.ws.send(s); }
const say = (p, ch, m, c) => send(p, { t: 'chat', ch, m, c });
function stats(p) {
  const j = JOBS[p.job], w = p.eq.weapon, a = p.eq.armor, h = p.eq.helm;
  const F = FAC[p.faction] || {};
  p.mhp = Math.round((60 + p.lv * 22) * j.hp * (F.hp || 1)); p.mmp = Math.round((25 + p.lv * 7) * j.mp * (F.mp || 1));
  const eqs = [w, a, h].filter(Boolean), sumB = k => eqs.reduce((n, it) => n + (it[k] || 0), 0);
  p.mhp += sumB('hpb');
  p.atk = Math.round(((6 + p.lv * 2.2) * j.atk + (w ? power(w) : 0) + sumB('atkb')) * (F.atk || 1));
  // 방어력 하향: 레벨 0.5, 장비 60%
  p.def = Math.round((p.lv * 0.5 + (a ? power(a) * 0.6 : 0) + (h ? power(h) * 0.6 : 0) + sumB('defb')) * (F.def || 1));
  p.hp = Math.min(p.hp, p.mhp); p.mp = Math.min(p.mp, p.mmp);
}
const defOf = p => p.def * bm(p, 'def');
const atkOf = p => p.atk * bm(p, 'atk');
function mePayload(p) {
  return {
    t: 'me', id: p.id, name: p.name, faction: p.faction, job: p.job, lv: p.lv, exp: p.exp, need: need(p.lv), gold: p.gold, hp: p.hp, mhp: p.mhp, mp: p.mp, mmp: p.mmp,
    atk: p.atk, def: p.def, inv: p.inv, eq: p.eq, q: p.q, qd: p.qd, lock: [...p.lock], mount: p.mount || '', seen: p.seen || {}, admin: p.admin ? { god: p.god ? 1 : 0, onehit: p.onehit ? 1 : 0, fast: p.fast ? 1 : 0 } : 0
  };
}
function pubP(p) {
  const w = p.eq.weapon, a = p.eq.armor, h = p.eq.helm;
  return { i: p.id, n: p.name, f: p.faction, j: p.job, l: p.lv, x: p.x, y: p.y, d: p.d, h: p.hp, H: p.mhp, w: w ? [w.b, w.r, w.plus] : 0, ar: a ? [a.b, a.r] : 0, he: h ? [h.b, h.r] : 0, bb: p.bubT > now() ? p.bub : undefined, ad: p.admin ? 1 : 0, mt: p.mount ? 1 : 0, bf: (bm(p, 'atk') > 1 ? 1 : 0) | (bm(p, 'def') > 1 ? 2 : 0) | (bm(p, 'spd') > 1 ? 4 : 0) | (bm(p, 'spd') < 1 ? 8 : 0) | (p.stun > now() ? 16 : 0) };
}
function mapMsg(m) { return { t: 'map', id: m.id, name: m.name, w: m.w, h: m.h, theme: m.theme, rows: m.t.map(r => r.join('')), portals: m.portals.map(p => ({ x: p.x, y: p.y, n: MAPS[p.to].name })), safes: m.safes, sl: m.sl, lvr: m.lvr, npcs: m.npcs.map(n => ({ id: n.id, x: n.x, y: n.y, n: NPCS[n.id].n, look: NPCS[n.id].look })) }; }
function warp(p, mapId, x, y) {
  const m = MAPS[mapId]; p.map = mapId; p.seen = p.seen || {}; if (!p.seen[mapId]) { p.seen[mapId] = 1; p.dirty = 1; }
  let n = 0; while (occ(m, x, y, p) && n < 20) { x += R(-1, 1); y += R(-1, 1); n++; if (!walk(m, x, y)) { x = m.spawn.x; y = m.spawn.y; } }
  p.x = x; p.y = y; send(p, mapMsg(m));
  const Rd = Object.values(RAIDS || {}).find(r => r.map === mapId); if (Rd) { send(p, { t: 'mood', m: Rd.mood || '' }); send(p, { t: 'plates', l: (Rd.plates || []).map(q => [q.x, q.y, q.ci, q.on > now() ? 1 : 0]), seq: Rd.seq, i: Rd.seqI || 0, sim: Rd.sim ? 1 : 0, hold: 0 }); }
}
function save(p) {
  const a = db.acc[p.name]; if (!a) return;
  a.ch = { faction: p.faction, job: p.job, lv: p.lv, exp: p.exp, gold: p.gold, inv: p.inv, eq: p.eq, q: p.q, qd: p.qd, qv: p.qv, mount: p.mount || '', seen: p.seen || {}, map: p.map, x: p.x, y: p.y, hp: p.hp, mp: p.mp };
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
  return { faction, job, lv: 1, exp: 0, gold: 500, inv: [mkPot('hp', 5), mkPot('mp', 3), mkScroll('enh', 1)], eq: { weapon: w, armor: a, helm: h }, q: {}, qd: {}, qv: 2, map: 'bucheon', x: villageSpawn(faction).x, y: villageSpawn(faction).y, hp: 999, mp: 999 };
}
let EXPM = 1;
function addExp(p, x, raw) {
  if (!raw) x = Math.round(x * EXPM);
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
const edist = (a, o) => Math.max(0, dist(a, o) - (o.sz || 0));
function enemiesOf(p) {
  const m = MAPS[p.map], res = [];
  if (m.id === 'royale') { if (ROY.st === 'fight' && ROY.alive.has(p.id)) for (const q of players.values()) if (q.map === 'royale' && q !== p && !q.dead && ROY.alive.has(q.id)) res.push({ k: 'p', o: q }); return res; }
  for (const o of m.mobs) if (!o.dead) res.push({ k: 'm', o });
  if (!inSafe(m, p.x, p.y)) for (const q of players.values()) if (q.map === p.map && q !== p && !q.dead && q.faction !== p.faction && !inSafe(m, q.x, q.y)) res.push({ k: 'p', o: q });
  return res;
}
function nearest(p, range, list) { let best = null, bd = 1e9; for (const e of list || enemiesOf(p)) { const d = edist(p, e.o); if (d <= range + 0.42 && d < bd) { bd = d; best = e; } } return best; }
function face(p, o) { const dx = o.x - p.x, dy = o.y - p.y; if (Math.abs(dx) > Math.abs(dy)) p.d = dx < 0 ? 1 : 2; else if (dy !== 0) p.d = dy < 0 ? 3 : 0; }
function hit(p, e, mult, s) {
  const t = now();
  if (s && s.stun) e.o.stun = t + (e.k === 'p' ? s.stun * 0.6 : s.stun);
  if (s && s.slow && s.k !== 'adebuff') { if (e.k === 'm') e.o.slow = t + s.slow; else e.o.bf.spd = [0.45, t + s.slow]; }
  if (s && (s.stun || s.slow) && e.k === 'p') e.o.vdirty = 1;
  let dmg = atkOf(p) * mult * (0.85 + Math.random() * 0.3); const crit = Math.random() < 0.1; if (crit) dmg *= 1.6;
  if (e.k === 'm') { dmg = p.onehit ? e.o.hp : Math.max(1, Math.round(dmg - MON[e.o.t].lv * 0.8)); damageMob(p, e.o, dmg, crit); }
  else { dmg = Math.max(1, Math.round(dmg * 0.5 - defOf(e.o) * 0.35)); damagePlayer(e.o, dmg, p, crit); }
}
function damageMob(p, mo, dmg, crit) {
  if (mo.inv) { bc(p.map, { t: 'dm', x: mo.x, y: mo.y, v: mo.shield ? '🛡보호막' : '무적', c: '#74c0fc' }); return; }
  if (mo.groggy > now()) { dmg = Math.round(dmg * 1.5); crit = true; }
  mo.hp -= dmg; mo.tgt = p.id; mo.last = p;
  bc(p.map, { t: 'dm', x: mo.x, y: mo.y, v: dmg, c: crit ? '#ffe600' : '#ffffff', cr: crit ? 1 : 0 });
  if (mo.hp <= 0) killMob(p, mo);
}
function damagePlayer(v, dmg, att, crit) {
  if (v.dead) return;
  if (v.god) { bc(v.map, { t: 'dm', x: v.x, y: v.y, v: 0, c: '#adb5bd' }); return; }
  v.hp -= dmg; v.vdirty = 1;
  bc(v.map, { t: 'dm', x: v.x, y: v.y, v: dmg, c: '#ff6b6b', cr: crit ? 1 : 0 });
  if (v.hp <= 0) die(v, att);
}
function die(v, att) {
  v.dead = 1; v.hp = 0; v.streak = 0; const m = MAPS[v.map];
  bc(v.map, { t: 'fx', k: 'die', x: v.x, y: v.y, c: '#ffffff' });
  if (v.map === 'royale' && ROY.alive.has(v.id)) { royaleOut(v, att); }
  else if (att && att.name) {
    // 진영전 사망: 랜덤 아이템 1~3개 드랍
    const cand = v.inv.filter(i => !v.lock.has(i.id)); let n = R(1, 3); const lost = [];
    while (n-- > 0 && cand.length) { const it = cand.splice(R(0, cand.length - 1), 1)[0]; v.inv.splice(v.inv.indexOf(it), 1); dropGround(m, v.x + R(-1, 1), v.y + R(-1, 1), it); lost.push(itemLabel(it)); }
    for (const g of m.ground) if (!walk(m, g.x, g.y)) { g.x = v.x; g.y = v.y; }
    say(v, 'sys', `💀 ${att.name}님에게 쓰러졌어요!${lost.length ? ' 떨어뜨림: ' + lost.join(', ') : ''}`);
    say(att, 'sys', `⚔️ ${v.name}님을 처치했어요! 바닥의 아이템을 주워보세요`);
    att.kills = (att.kills || 0) + 1; att.streak = (att.streak || 0) + 1;
    sendAll({ t: 'kill', a: who(att), v: who(v), map: MAPS[v.map].name, st: att.streak, lost: lost.length });
  } else say(v, 'sys', '💀 쓰러졌어요...');
  v.exp = Math.max(0, v.exp - Math.floor(need(v.lv) * 0.03)); v.dirty = 1;
  setTimeout(() => { if (!players.has(v.id)) return; v.dead = 0; stats(v); v.hp = v.mhp; v.mp = v.mmp; v.bf = {}; v.stun = 0; const vs = villageSpawn(v.faction); warp(v, vs.map, vs.x, vs.y); v.dirty = 1; }, 3000);
}
function killMob(p, mo) {
  const tp = MON[mo.t], m = MAPS[p.map]; mo.dead = 1;
  if (mo.raid) { const i = m.mobs.indexOf(mo); if (i >= 0) m.mobs.splice(i, 1); bc(m.id, { t: 'fx', k: 'die', x: mo.x, y: mo.y, c: tp.c }); raidMobDied(mo, p); return; }
  let xp = tp.xp; if (p.lv > tp.lv + 8) xp *= 0.3; xp = Math.round(xp);
  const gold = Math.round(tp.g * (0.6 + Math.random() * 0.8) * (FAC[p.faction].gold || 1));
  const loot = [mkGold(mo.boss ? gold * 3 : gold)];
  const add = it => loot.push(it);
  if (mo.boss) {
    add(genEquip(tp.lv, true)); if (Math.random() < 0.25) add(genEquip(tp.lv, true));
    add(mkScroll('enh', R(1, 3))); if (Math.random() < 0.3) add(mkScroll('ward', 1)); add(mkPot('hp', R(3, 6))); add(stackItem('mat', tp.mat, tp.mat, R(1, 3)));
    if (Math.random() < 0.01) add(hiddenEquip(pick(['weapon', 'armor', 'helm']), tp.lv));
    if (tp.id === 'tuna') { add(tunaWeapon()); sendAll({ t: 'notice', m: `🐟 ${p.name}님이 냉동참치를 쓰러뜨렸다!! 🐟 대형 냉동참치가 떨어졌다!!`, c: '#a5d8ff', big: 1 }); }
    if (mo.collapse) { xp = tp.xp; announce(`🍶 보상은 잔소리를 끝까지 버틴 ${p.name}님에게!`); }
    else { xp = tp.xp; announce(`🏆 ${p.name}님이 ${mo.v == null ? '' : VAR[mo.v].p + ' '}${tp.n}을(를) 처치했어요!`); }
    if (tp.deathLine && !mo.collapse) { bc(m.id, { t: 'mtalk', id: mo.id, m: tp.deathLine, loud: 1, x: mo.x, y: mo.y, n: tp.n }); announce(`🎤 ${tp.n}: "${tp.deathLine}"`); }
    sendAll({ t: 'kill', a: who(p), boss: (mo.v == null ? '' : VAR[mo.v].p + ' ') + tp.n, map: m.name });
  } else {
    if (Math.random() < 0.12) add(mkPot('hp', 1)); if (Math.random() < 0.06) add(mkPot('mp', 1));
    if (Math.random() < 0.035) add(mkScroll('enh', 1)); if (Math.random() < 0.005) add(mkScroll('ward', 1));
    if (Math.random() < 0.35) add(stackItem('mat', tp.mat, tp.mat, R(1, 2)));
    if (Math.random() < 0.04) add(genEquip(tp.lv, false));
  }
  spreadDrop(m, mo.x, mo.y, loot, p.id);
  const rare = loot.filter(it => isEq(it) && it.r >= 2);
  say(p, 'loot', `+${Math.round(xp * EXPM)}exp${loot.length > 1 ? ' · 바닥에 아이템이 떨어졌어요 (F로 줍기)' : ''}${rare.length ? ' ✨ ' + rare.map(itemLabel).join(', ') : ''}`);
  addExp(p, xp);
  for (const k in p.q) { const qd = QUESTS.find(q => q.id === +k); if (qd && qd.kill && (qd.kill === 'any' || qd.kill === tp.id)) p.q[k] = Math.min(qd.cnt, (p.q[k] || 0) + 1); }
  p.dirty = 1; bc(p.map, { t: 'fx', k: 'die', x: mo.x, y: mo.y, c: tp.c });
  if (mo.boss || mo.temp) m.mobs.splice(m.mobs.indexOf(mo), 1); else mo.respawn = now() + R(6000, 12000);
}
function basicAttack(p) {
  const t = now(); if (p.dead || t < p.atkAt || t < p.stun) return;
  const w = p.eq.weapon, wb = w ? WB[w.b] : { r: 1, cd: 500, s: 'fist' };
  p.atkAt = t + wb.cd;
  const e = nearest(p, wb.aoe || wb.r); if (!e) return;
  face(p, e.o);
  if (wb.aoe) { bc(p.map, { t: 'fx', k: 'ring', i: p.id, x: p.x, y: p.y, r: wb.aoe, c: '#a5d8ff', f: 'tunaswing' }); bc(p.map, { t: 'fx', k: 'slash', i: p.id, x: p.x, y: p.y, x2: e.o.x, y2: e.o.y, c: '#a5d8ff' }); enemiesOf(p).filter(q => edist(p, q.o) <= wb.aoe + .42).slice(0, 15).forEach(q => hit(p, q, 1.1)); return; }
  bc(p.map, { t: 'fx', k: wb.r > 1 ? 'proj' : 'slash', i: p.id, x: p.x, y: p.y, x2: e.o.x, y2: e.o.y, c: w ? RAR[w.r].c : '#fff' });
  hit(p, e, 1);
}
const bm = (p, k) => p.bf && p.bf[k] && p.bf[k][1] > now() ? p.bf[k][0] : 1;
function castSkill(p, i) {
  const j = JOBS[p.job], s = j.sk[i], t = now();
  if (!s || p.dead || t < p.stun) return;
  if (p.lv < s.lv && !p.admin) return say(p, 'sys', '아직 사용할 수 없는 스킬이에요');
  if (t < p.cd[i] && !p.god) return;
  if (p.mp < s.mp && !p.god) return say(p, 'sys', 'MP가 부족해요');
  const use = () => { if (!p.god) { p.mp -= s.mp; p.cd[i] = t + s.cd; } p.vdirty = 1; send(p, { t: 'cd', i, ms: s.cd }); };
  const fx = o => bc(p.map, Object.assign({ t: 'fx', i: p.id, c: s.c, f: s.fx, n: s.n }, o));
  const buffs = q => { if (!s.dur) return; if (s.atk) q.bf.atk = [s.atk, t + s.dur]; if (s.def) q.bf.def = [s.def, t + s.dur]; if (s.spd) q.bf.spd = [s.spd, t + s.dur]; };
  const heal = q => { if (!s.heal) return; const v = Math.round(q.mhp * s.heal); q.hp = Math.min(q.mhp, q.hp + v); q.vdirty = 1; bc(p.map, { t: 'dm', x: q.x, y: q.y, v, c: '#69db7c' }); };
  if (s.k === 'aoe') {
    const l = enemiesOf(p).filter(e => edist(p, e.o) <= s.r + 0.42).slice(0, s.ult ? 20 : 10); use(); fx({ k: 'ring', x: p.x, y: p.y, r: s.r }); l.forEach(e => hit(p, e, s.m, s));
    if (s.healAll || s.buffAll) for (const q of players.values()) if (q.map === p.map && !q.dead && q.faction === p.faction && dist(p, q) <= s.r + 0.42) { if (s.healAll) { const v = Math.round(q.mhp * s.healAll); q.hp = Math.min(q.mhp, q.hp + v); q.vdirty = 1; bc(p.map, { t: 'dm', x: q.x, y: q.y, v, c: '#69db7c' }); } if (s.buffAll) q.bf.atk = [s.buffAll, t + 10000]; }
  } else if (s.k === 'shot' || s.k === 'multi') {
    const e = nearest(p, s.range); if (!e) return say(p, 'sys', '대상이 없어요'); use(); face(p, e.o);
    const n = s.hits || 1; for (let k = 0; k < n; k++)setTimeout(() => { if (p.dead || e.o.dead) return; fx({ k: s.range > 2 ? 'proj' : 'slash', x: p.x, y: p.y, x2: e.o.x, y2: e.o.y, big: 1 }); hit(p, e, s.m, s); }, k * 220);
  } else if (s.k === 'aoeT') {
    const e = nearest(p, s.range); if (!e) return say(p, 'sys', '대상이 없어요'); use(); face(p, e.o);
    fx({ k: 'proj', x: p.x, y: p.y, x2: e.o.x, y2: e.o.y, big: 1 });
    const cx = e.o.x, cy = e.o.y;
    setTimeout(() => { fx({ k: 'boom', x: cx, y: cy, r: s.r }); enemiesOf(p).filter(q => Math.hypot(q.o.x - cx, q.o.y - cy) - (q.o.sz || 0) <= s.r + 0.42).slice(0, 10).forEach(q => { if (!q.o.dead) hit(p, q, s.m, s); }); }, 250);
  } else if (s.k === 'dash') {
    use(); const m = MAPS[p.map], ox = p.x, oy = p.y;
    for (let k = 0; k < s.dist; k++) { const nx = p.x + DX[p.d], ny = p.y + DY[p.d]; if (!walk(m, nx, ny) || occ(m, nx, ny, p) || m.portals.some(q => q.x === nx && q.y === ny)) break; p.x = nx; p.y = ny; }
    fx({ k: 'dash', x: ox, y: oy, x2: p.x, y2: p.y });
    { const hr = s.hitR || 1.5; enemiesOf(p).filter(e => Math.min(edist(p, e.o), edist({ x: ox, y: oy }, e.o)) <= hr || (s.hitR && Math.abs((e.o.x - ox) * (p.y - oy) - (e.o.y - oy) * (p.x - ox)) / Math.max(1, Math.hypot(p.x - ox, p.y - oy)) <= hr && Math.min(ox, p.x) - hr <= e.o.x && e.o.x <= Math.max(ox, p.x) + hr && Math.min(oy, p.y) - hr <= e.o.y && e.o.y <= Math.max(oy, p.y) + hr)).slice(0, s.ult ? 20 : 8).forEach(e => hit(p, e, s.m, s)); }
  } else if (s.k === 'abuff') {
    use(); fx({ k: 'abuff', x: p.x, y: p.y, r: s.r });
    for (const q of players.values()) if (q.map === p.map && !q.dead && q.faction === p.faction && dist(p, q) <= s.r + 0.42) { heal(q); buffs(q); }
  } else if (s.k === 'sbuff') {
    use(); fx({ k: 'sbuff', x: p.x, y: p.y }); heal(p); buffs(p);
    if (s.selfstun) { p.stun = t + s.selfstun; send(p, { t: 'stun', ms: s.selfstun }); }
  } else if (s.k === 'adebuff') {
    use(); fx({ k: 'ring', x: p.x, y: p.y, r: s.r }); buffs(p);
    for (const e of enemiesOf(p)) if (edist(p, e.o) <= s.r + 0.42) { if (e.k === 'm') e.o.slow = t + s.slow; else { e.o.bf.spd = [0.45, t + s.slow]; } }
  }
}

/* ===================== 퀘스트/강화 등 ===================== */
function questTurn(p, id) {
  const q = QUESTS.find(x => x.id === id); if (!q || !(id in p.q)) return;
  if (q.collect) { const it = p.inv.find(i => i.type === 'mat' && i.k === q.collect); if (!it || it.q < q.cnt) return say(p, 'sys', '재료가 부족해요'); it.q -= q.cnt; if (it.q <= 0) p.inv.splice(p.inv.indexOf(it), 1); }
  else if (!q.to && p.q[id] < q.cnt) return say(p, 'sys', '아직 완료하지 못했어요');
  delete p.q[id]; if (!q.rep) p.qd[id] = 1;
  const exp = q.scale ? p.lv * 60 : q.exp; p.gold += q.gold; addExp(p, exp);
  const rw = []; if (q.scroll) { giveItem(p, mkScroll('enh', q.scroll)); rw.push('강화주문서 x' + q.scroll); }
  if (q.equip) { const it = buildEquip(pick(['weapon', 'armor', 'helm']), p.lv, Math.min(4, 1 + q.equip)); giveItem(p, it); rw.push(itemLabel(it)); }
  say(p, 'sys', `✅ [${q.n}] 완료! +${exp}exp +${q.gold}G ${rw.join(', ')}`); p.dirty = 1;
  bc(p.map, { t: 'fx', k: 'lvup', x: p.x, y: p.y, c: '#69db7c' });
}
function npcNear(p, id) { const m = MAPS[p.map]; return (m.npcs || []).find(n => n.id === id && Math.abs(n.x - p.x) <= 2 && Math.abs(n.y - p.y) <= 2); }
function talkNpc(p, id) {
  const npc = npcNear(p, id); if (!npc) return say(p, 'sys', 'NPC에게 더 가까이 가세요');
  const N = NPCS[id], dlg = (lines, acts = []) => send(p, { t: 'dlg', npc: id, name: N.n, look: N.look, lines, acts });
  if (id.startsWith('gate')) return raidDlg(p, 'r' + id.slice(4));
  if (id === 'merchant') return dlg(['어서 오세요! 포션, 강화 주문서, 축복 주문서 다 있어요~', '강화는 +6부터 조심하세요. 높을수록 잘 터져요!'], [{ k: 'shop', label: '🏪 상점 열기' }, { k: 'close', label: '닫기' }]);
  for (const k in p.q) { const q = QUESTS.find(x => x.id === +k); if (q && q.to === id) { questTurn(p, q.id); const nx = QUESTS.find(x => x.giver === id && qAvail(p, x)); return dlg(q.fin, nx ? [{ k: 'talk', label: '이야기를 계속 듣는다' }] : []); } }
  for (const k in p.q) { const q = QUESTS.find(x => x.id === +k); if (q && q.giver === id && !q.to) {
    if (qReady(p, q)) return dlg(['오, 벌써 해냈어?'], [{ k: 'qt', id: q.id, label: `✅ [${q.n}] 완료 보고` }]);
    const prog = q.collect ? Math.min(q.cnt, (p.inv.find(i => i.type === 'mat' && i.k === q.collect) || { q: 0 }).q) : p.q[k];
    return dlg([`[${q.n}] 아직이야?`, `${q.collect ? q.collect + ' 모으기' : (q.kill === 'any' ? '몬스터' : MI[q.kill].n) + ' 처치'} ${prog}/${q.cnt}`]);
  } }
  const av = QUESTS.find(x => x.giver === id && qAvail(p, x));
  if (av) return dlg(av.talk, [{ k: 'qa', id: av.id, label: `📜 [${av.n}] 수락` }, { k: 'close', label: '나중에' }]);
  const lock = QUESTS.find(x => x.giver === id && !p.qd[x.id] && !(x.id in p.q) && !x.rep);
  if (lock && p.lv < lock.lv) return dlg([...N.hi.slice(0, 1), `(Lv.${lock.lv}이 되면 다시 찾아와)`]);
  dlg(N.hi);
}
function enhance(p, id, ward, bless) {
  const it = p.inv.find(i => i.id === id) || Object.values(p.eq).find(i => i && i.id === id); if (!it || !isEq(it) || p.lock.has(id)) return;
  const sc = p.inv.find(i => i.type === 'scroll' && i.k === 'enh'); if (!sc) return say(p, 'sys', '강화 주문서가 없어요');
  const cost = (it.plus + 1) * 100; if (p.gold < cost) return say(p, 'sys', `골드가 부족해요 (${cost}G)`);
  const wd = ward ? p.inv.find(i => i.type === 'scroll' && i.k === 'ward') : null; if (ward && !wd) return say(p, 'sys', '보호 주문서가 없어요');
  const bl = bless ? p.inv.find(i => i.type === 'scroll' && i.k === 'bless') : null; if (bless && !bl) return say(p, 'sys', '축복 주문서가 없어요');
  const use = s => { s.q--; if (s.q <= 0) p.inv.splice(p.inv.indexOf(s), 1); };
  use(sc); p.gold -= cost; if (wd) use(wd); if (bl) use(bl);
  const equipped = Object.keys(p.eq).find(k => p.eq[k] === it);
  if (Math.random() * 100 < Math.min(100, enhRate(it.plus) + (bl ? 15 : 0))) { it.plus++; say(p, 'loot', `✨ 강화 성공! ${itemLabel(it)}`, '#ffe600'); send(p, { t: 'enh', ok: 1 }); if (it.plus >= 10) announce(`🔥 ${p.name}님의 ${it.n}이(가) +${it.plus} 강화 성공!`); }
  else if (Math.random() * 100 < boomRate(it.plus)) {
    if (wd) { say(p, 'sys', '🛡️ 보호 주문서가 아이템을 지켜줬어요! (강화 실패)'); send(p, { t: 'enh', ok: 0 }); }
    else { if (equipped) p.eq[equipped] = null; else p.inv.splice(p.inv.indexOf(it), 1); say(p, 'sys', `💥 펑! ${it.n} +${it.plus}이(가) 터졌어요...`); send(p, { t: 'enh', ok: -1 }); if (it.plus >= 8) sendAll({ t: 'notice', m: `💥 ${p.name}님의 ${it.n} +${it.plus}이(가) 강화하다 터졌습니다…`, c: '#ff8787' }); }
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

/* ===================== 관리자 ===================== */
function adminCmd(p, m) {
  const mp = MAPS[p.map], ok = msg => say(p, 'sys', '👑 ' + msg);
  switch (m.op) {
    case 'boss': { const t = MI[m.id]; if (!t || !t.boss) return; spawnBoss(mp, t.id, p); return ok(t.n + ' 소환'); }
    case 'mob': { const t = MI[m.id]; if (!t || t.boss) return; const n = Math.max(1, Math.min(20, m.n | 0)); let c = 0;
      for (let k = 0; k < n * 6 && c < n; k++) { const x = p.x + R(-4, 4), y = p.y + R(-4, 4); if (!walk(mp, x, y) || occ(mp, x, y)) continue; mp.mobs.push({ id: MID++, t: t.idx, x, y, hx: x, hy: y, hp: t.hp, mhp: t.hp, boss: 0, temp: 1, dead: 0, respawn: 0, atkAt: 0, mvAt: 0, tgt: 0 }); c++; }
      return ok(`${t.n} ${c}마리 소환`); }
    case 'clear': { for (let i = mp.mobs.length - 1; i >= 0; i--) { const o = mp.mobs[i]; if (o.boss || o.temp) mp.mobs.splice(i, 1); else { o.dead = 1; o.respawn = now() + 3000; } } return ok('맵의 몬스터를 모두 지웠어요'); }
    case 'lv': p.lv = Math.max(1, Math.min(99, m.v | 0)); p.exp = 0; stats(p); p.hp = p.mhp; p.mp = p.mmp; p.dirty = 1; return ok('레벨 ' + p.lv);
    case 'exp': addExp(p, need(p.lv) - p.exp, 1); return;
    case 'expev': { const v = [1, 2, 5, 10].includes(m.v | 0) ? m.v | 0 : 1; EXPM = v; sendAll({ t: 'evt', mult: v }); sendAll({ t: 'notice', m: v > 1 ? `🔥 경험치 ${v}배 이벤트 시작!! 🔥` : '경험치 이벤트가 끝났어요', c: '#ffd43b', big: v > 1 ? 1 : 0 }); return ok('경험치 ' + v + '배'); }
    case 'raidreset': { for (const k in RAIDS) raidReset(k, '관리자가 레이드를 초기화했어요'); return ok('레이드 초기화'); }
    case 'gold': p.gold += 1000000; p.dirty = 1; return ok('골드 +1,000,000');
    case 'scroll': giveItem(p, mkScroll('enh', 50)); giveItem(p, mkScroll('ward', 20)); return ok('강화 50 / 보호 20');
    case 'pot': giveItem(p, mkPot('hp', 100)); giveItem(p, mkPot('mp', 100)); return ok('포션 100개씩');
    case 'item': { const ty = ['weapon', 'armor', 'helm'].includes(m.type) ? m.type : 'weapon', r = Math.max(0, Math.min(5, m.r | 0)), il = Math.max(1, Math.min(99, m.il | 0 || p.lv));
      const it = r === 5 ? hiddenEquip(ty, il) : buildEquip(ty, il, r); if (r < 5 && it.r === 5) { } giveItem(p, it); return ok(itemLabel(it) + ' 지급'); }
    case 'mat': { const t = MI[m.id]; if (t) giveItem(p, stackItem('mat', t.mat, t.mat, 20)); return; }
    case 'go': { if (VILLAGE[m.map]) { const v = villageSpawn(m.map); return warp(p, v.map, v.x, v.y); } const mm = MAPS[m.map]; if (!mm) return; if (mm.id === 'bucheon') { const v = villageSpawn(p.faction); return warp(p, v.map, v.x, v.y); } warp(p, mm.id, mm.spawn.x, mm.spawn.y); return; }
    case 'heal': p.hp = p.mhp; p.mp = p.mmp; p.stun = 0; p.cd = [0, 0, 0, 0]; p.vdirty = 1; return ok('완전 회복');
    case 'god': p.god = !p.god; p.dirty = 1; return ok('무적 ' + (p.god ? 'ON (피해 없음, 스킬 쿨/MP 없음)' : 'OFF'));
    case 'onehit': p.onehit = !p.onehit; p.dirty = 1; return ok('한방 ' + (p.onehit ? 'ON' : 'OFF'));
    case 'fast': p.fast = !p.fast; p.dirty = 1; return ok('초고속 이동 ' + (p.fast ? 'ON' : 'OFF'));
    case 'job': { if (!JOBS[m.job]) return; p.job = m.job; p.cd = [0, 0, 0, 0]; stats(p); p.dirty = 1; bc(p.map, { t: 'fx', k: 'lvup', x: p.x, y: p.y, c: '#ff8cff' }); return ok('직업: ' + JOBS[m.job].n); }
    case 'mount': p.mount = p.mount ? '' : 'babpuli'; p.dirty = 1; return ok('밥풀이 탑승 ' + (p.mount ? 'ON' : 'OFF'));
    case 'faction': if (FAC[m.f]) { p.faction = m.f; stats(p); p.dirty = 1; ok('진영: ' + FAC[m.f].n); } return;
    case 'qnext': { const act = Object.keys(p.q).map(Number).find(id => !QUESTS.find(q => q.id === id).rep);
      if (act) { const q = QUESTS.find(x => x.id === act); if (q.collect) giveItem(p, stackItem('mat', q.collect, q.collect, q.cnt)); else p.q[act] = q.cnt; if (q.to) { delete p.q[act]; p.qd[act] = 1; } p.dirty = 1; return ok(`[${q.n}] 조건 달성 (NPC에게 보고하세요)`); }
      const nx = QCHAIN.find(q => !p.qd[q.id]); if (!nx) return ok('모든 스토리 완료'); p.qd[nx.id] = 1; p.dirty = 1; return ok(`[${nx.n}] 완료 처리`); }
    case 'qreset': p.q = {}; p.qd = {}; p.dirty = 1; return ok('퀘스트 초기화');
    case 'tp': { const x = m.x | 0, y = m.y | 0; if (walk(mp, x, y)) { p.x = x; p.y = y; } return; }
    case 'pickall': { for (const g of mp.ground) { g.x = p.x; g.y = p.y; g.own = 0; } pickUp(p); return; }
    case 'kill': { for (const o of [...mp.mobs]) if (!o.dead && !o.inv && dist(o, p) <= (mp.id.startsWith('raid') ? 60 : 6)) { damageMob(p, o, o.hp, true); } return; }
    case 'tpnpc': { for (const mm of Object.values(MAPS)) { const n = (mm.npcs || []).find(x => x.id === m.id); if (n) return warp(p, mm.id, n.x, n.y + 1); } return; }
    case 'tunabag': giveItem(p, stackItem('bundle', 'tuna', '냉동참치 보따리', 1)); return ok('냉동참치 보따리 지급');
    case 'tunamats': for (const [k, n] of Object.entries(TUNA_RECIPE)) giveItem(p, stackItem('mat', k, k, n)); return ok('냉동참치 재료 지급');
    case 'royale': return royaleStart(p);
    case 'royalestop': if (ROY.st !== 'idle') royaleEnd('👑 관리자가 무한장을 종료했어요'); return;
    case 'tpp': { const o = [...players.values()].find(q => q.name === String(m.name || '').trim()); if (!o) return ok('그런 사람이 없어요'); const x = m.x == null ? p.x : m.x | 0, y = m.y == null ? p.y : m.y | 0; if (o.map !== p.map) warp(o, p.map, x, y); else if (walk(mp, x, y)) { o.x = x; o.y = y; } return ok(`${o.name} 소환`); }
    case 'setlv': { const o = [...players.values()].find(q => q.name === String(m.name || '').trim()); if (!o) return ok('그런 사람이 없어요'); o.lv = Math.max(1, Math.min(99, m.v | 0)); o.exp = 0; stats(o); o.hp = o.mhp; o.dirty = 1; return ok(`${o.name} → Lv${o.lv}`); }
    case 'allboss': { for (const mm of Object.values(MAPS)) if (mm.boss) spawnBoss(mm); return ok('모든 사냥터에 보스 소환'); }
  }
}

/* ===================== 무한장 (배틀로얄) ===================== */
const ROY = { st: 'idle', alive: new Set(), all: new Set(), startAt: 0, ring: 0, ringAt: 0, prize: 500000 };
function royaleStart(admin) {
  if (ROY.st !== 'idle') return say(admin, 'sys', '👑 무한장이 이미 진행 중이에요');
  const ps = [...players.values()].filter(q => !q.admin && !q.dead && !games.has(q.id));
  if (ps.length < 2) return say(admin, 'sys', '👑 무한장은 관리자 제외 2명 이상 접속해 있어야 해요 (현재 ' + ps.length + '명)');
  const m = MAPS.royale; m.t = m.orig.map(r => r.slice()); m.ground.length = 0;
  ROY.alive = new Set(ps.map(q => q.id)); ROY.all = new Set(ROY.alive); ROY.st = 'count'; ROY.startAt = now() + 3500; ROY.ring = 0; ROY.prize = Math.max(300000, ps.length * 100000);
  const n = ps.length;
  ps.forEach((q, i) => { const a = i / n * Math.PI * 2, x = Math.round(22 + Math.cos(a) * 15), y = Math.round(16 + Math.sin(a) * 11); let tx = x, ty = y; for (let k = 0; k < 30 && !walk(m, tx, ty); k++) { tx = x + R(-2, 2); ty = y + R(-2, 2); } stats(q); q.hp = q.mhp; q.mp = q.mmp; q.bf = {}; warp(q, 'royale', walk(m, tx, ty) ? tx : 22, walk(m, tx, ty) ? ty : 16); q.stun = ROY.startAt; q.dirty = 1; send(q, { t: 'count', ms: 3500 }); });
  for (const q of ps) send(q, { t: 'roy', n, st: 'count' });
  sendAll({ t: 'notice', m: `🔥 무한장 이벤트!! ${n}명 참가 — 마지막까지 살아남으면 💰${ROY.prize.toLocaleString()}G`, c: '#ff922b', big: 1 });
}
function royaleOut(v, att) {
  ROY.alive.delete(v.id);
  for (const id of ROY.all) { const q = players.get(id); if (q) send(q, { t: 'roy', n: ROY.alive.size, st: 'fight' }); }
  const left = ROY.alive.size, msg = att && att.name ? `💀 ${v.name} 탈락! (${att.name} 처치) · 남은 인원 ${left}명` : `💀 ${v.name} 탈락! · 남은 인원 ${left}명`;
  for (const id of ROY.all) { const q = players.get(id); if (q) send(q, { t: 'notice', m: msg, c: '#ff8787' }); }
  if (att && att.name) sendAll({ t: 'kill', a: who(att), v: who(v), map: '🔥 무한장', st: 0, lost: 0 });
  say(v, 'sys', '💀 무한장에서 탈락했어요');
}
function royaleEnd(reason) {
  const m = MAPS.royale;
  for (const q of players.values()) if (q.map === 'royale') { q.stun = 0; const vs = villageSpawn(q.faction); warp(q, vs.map, vs.x, vs.y); }
  for (const id of ROY.all) { const q = players.get(id); if (q) send(q, { t: 'roy', n: 0, st: 'idle' }); }
  m.t = m.orig.map(r => r.slice()); ROY.st = 'idle'; ROY.alive.clear(); ROY.all.clear(); if (reason) sendAll({ t: 'notice', m: reason, c: '#adb5bd' });
}
function royaleTick(t) {
  if (ROY.st === 'idle') return;
  const m = MAPS.royale;
  for (const id of [...ROY.alive]) { const q = players.get(id); if (!q || q.map !== 'royale') ROY.alive.delete(id); }
  if (ROY.st === 'count') { if (t >= ROY.startAt) { ROY.st = 'fight'; ROY.ringAt = t + 20000; for (const id of ROY.alive) { const q = players.get(id); if (q) send(q, { t: 'notice', m: '⚔️ 무한장 시작!! 진영 상관없이 모두가 적! 자기장을 피하세요', c: '#ff6b6b', big: 1 }); } } return; }
  if (ROY.st === 'fight') {
    if (ROY.alive.size <= 1) {
      const w = players.get([...ROY.alive][0]);
      if (w) { w.gold += ROY.prize; w.dirty = 1; sendAll({ t: 'notice', m: `🏆 무한장 우승: [${FAC[w.faction].n}] ${w.name}!! 상금 💰${ROY.prize.toLocaleString()}G`, c: '#ffe066', big: 1 }); sendAll({ t: 'kill', a: who(w), boss: '🔥 무한장 우승', map: '무한장' }); bc('royale', { t: 'fx', k: 'lvup', x: w.x, y: w.y, c: '#ffe066' }); }
      ROY.st = 'end'; ROY.endAt = t + 6000; return;
    }
    if (t >= ROY.ringAt && ROY.ring < 6) {
      ROY.ring++; ROY.ringAt = t + 18000; const wdt = ROY.ring * 2 + 1, tiles = [];
      for (let y = 1; y < m.h - 1; y++) for (let x = 1; x < m.w - 1; x++) if (Math.min(x, y, m.w - 1 - x, m.h - 1 - y) <= wdt && m.t[y][x] !== 'V') tiles.push([x, y]);
      bc('royale', { t: 'warn', tiles, ms: 4000, c: '#7048e8' }); for (const id of ROY.alive) { const q = players.get(id); if (q) send(q, { t: 'notice', m: '🌀 자기장이 줄어든다!! 4초 안에 안쪽으로!', c: '#b197fc' }); }
      setTimeout(() => {
        if (ROY.st !== 'fight') return; const set = []; for (const [x, y] of tiles) { m.t[y][x] = 'V'; set.push([x, y]); } bc('royale', { t: 'tiles', set, ch: 'V' }); bc('royale', { t: 'shake', ms: 600 });
        for (const q of players.values()) if (q.map === 'royale' && !q.dead && m.t[q.y][q.x] === 'V') { damagePlayer(q, Math.round(q.mhp * .35), null); if (!q.dead) { q.x = 22 + R(-2, 2); q.y = 16 + R(-1, 1); } }
      }, 4000);
    }
    if (tk % 10 === 0 && ROY.ring >= 6) for (const id of ROY.alive) { const q = players.get(id); if (q && !q.dead) damagePlayer(q, Math.round(q.mhp * .04), null); }
  }
  if (ROY.st === 'end' && t >= ROY.endAt) royaleEnd();
}

/* ===================== 접속자 목록 ===================== */
function sendWho() { sendAll({ t: 'who', l: [...players.values()].map(p => [p.name, p.faction, p.job, p.lv, MAPS[p.map].name, p.admin ? 1 : 0]) }); }

/* ===================== 레이드 (보스 대기실) ===================== */
const RAIDS = {
  r10: { n: '버섯브로콜리', lv: 10, map: 'raid1', exp: 60000, ilv: 14, items: 2, mat: '합체 포자' },
  r30: { n: '티라노', lv: 30, map: 'raid2', exp: 600000, ilv: 34, items: 3, mat: '메가 공룡 비늘' },
  r50: { n: '석상왕', lv: 50, map: 'raid3', exp: 5000000, ilv: 55, items: 5, mat: '분노의 핵' },
  r40: { n: '심연의 문어왕', lv: 40, map: 'raid4', exp: 1800000, ilv: 45, items: 4, lives: 4, min3: 1, mat: '문어왕의 먹물' },
  r70: { n: '시계탑 마왕', lv: 70, map: 'raid5', exp: 18000000, ilv: 75, items: 6, lives: 5, min3: 1, mat: '시간의 톱니' }
};
for (const k in RAIDS) Object.assign(RAIDS[k], { id: k, st: 'idle', mem: new Set(), haz: [], ph: 0 });
const LOBBY_MS = 20000;
const rmem = R => [...R.mem].map(id => players.get(id)).filter(Boolean);
function raidDlg(p, id) {
  const Rd = RAIDS[id]; if (!Rd) return;
  const N = NPCS['gate' + id.slice(1)], names = rmem(Rd).map(q => q.name);
  const stTxt = Rd.st === 'idle' ? '🟢 대기 중 — 참여하면 20초 뒤 다 같이 입장해요' : Rd.st === 'lobby' ? `🟡 모집 중 — ${Math.max(0, Math.ceil((Rd.startAt - now()) / 1000))}초 뒤 출발` : Rd.st === 'fight' ? '🔴 전투 중 — 끝나면 다시 도전할 수 있어요' : '🟣 정리 중 — 잠시 뒤 다시 도전할 수 있어요';
  const lines = [`[${Rd.n}] 레이드 · Lv${Rd.lv} 이상 · 한 번에 한 팀만${Rd.min3 ? '\n⚠️ 3명이 동시에 해야 풀리는 기믹이 있어요 (3인 이상 권장)' : ''}${Rd.lives ? ' · 보스가 ' + (Rd.lives - 1) + '번 부활' : ''}`, stTxt + (names.length ? `\n참여자(${names.length}): ${names.join(', ')}` : '')];
  const acts = [];
  if (Rd.mem.has(p.id) && Rd.st === 'lobby') acts.push({ k: 'raid', id, op: 'start', label: '⚔️ 지금 바로 출발' }, { k: 'raid', id, op: 'leave', label: '참여 취소' });
  else if (Rd.st === 'idle' || Rd.st === 'lobby') { if (p.lv >= Rd.lv || p.admin) acts.push({ k: 'raid', id, op: 'join', label: '🙋 보스 참여' }); else lines.push(`(Lv.${Rd.lv}부터 참여할 수 있어요)`); }
  acts.push({ k: 'close', label: '닫기' });
  send(p, { t: 'dlg', npc: 'gate' + id.slice(1), name: N.n, look: N.look, lines, acts, keep: 1 });
}
function raidOp(p, id, op) {
  const Rd = RAIDS[id]; if (!Rd || !npcNear(p, 'gate' + id.slice(1))) return;
  if (op === 'join') {
    if (!(Rd.st === 'idle' || Rd.st === 'lobby') || (p.lv < Rd.lv && !p.admin)) return raidDlg(p, id);
    for (const k in RAIDS) RAIDS[k].mem.delete(p.id);
    Rd.mem.add(p.id);
    if (Rd.st === 'idle') { Rd.st = 'lobby'; Rd.startAt = now() + LOBBY_MS; sendAll({ t: 'notice', m: `⚔️ ${Rd.n} 레이드 모집 시작! (보스 대기실 · 20초 뒤 출발)`, c: '#ffa94d' }); }
    else for (const q of rmem(Rd)) say(q, 'sys', `🙋 ${p.name}님이 ${Rd.n} 레이드에 참여했어요 (${Rd.mem.size}명)`);
  } else if (op === 'leave') { Rd.mem.delete(p.id); if (!Rd.mem.size && Rd.st === 'lobby') Rd.st = 'idle'; }
  else if (op === 'start' && Rd.mem.has(p.id) && Rd.st === 'lobby') Rd.startAt = now();
  raidDlg(p, id);
}
function raidReset(id, msg) {
  const Rd = RAIDS[id], m = MAPS[Rd.map];
  m.mobs.length = 0; m.ground.length = 0; Rd.haz = []; Rd.ph = 0; rClean(Rd);
  for (const q of players.values()) if (q.map === m.id && !q.dead) { warp(q, 'bosshub', 13 + R(-2, 2), 12); if (msg) say(q, 'sys', msg); }
  Rd.mem.clear(); Rd.st = 'idle';
}
function rSpawn(Rd, key, x, y, extra) {
  const m = MAPS[Rd.map], t = MI[key];
  const o = Object.assign({ id: MID++, t: t.idx, x, y, hx: x, hy: y, hp: t.hp, mhp: t.hp, boss: 1, v: null, acc: 0, dead: 0, atkAt: 0, mvAt: 0, tgt: 0, skAt: Infinity, until: Infinity, raid: Rd.id, sz: Math.max(.3, (t.big || 1.9) / 1.9 * .9 - .4) }, extra || {});
  m.mobs.push(o); return o;
}
// 기믹: 경고 타일 → delay 뒤 피해
function rTiles(m, list) { const seen = new Set(), out = []; for (const [x, y] of list) { const k = x + ',' + y; if (seen.has(k) || x < 1 || y < 1 || x >= m.w - 1 || y >= m.h - 1) continue; seen.add(k); out.push([x, y]); } return out; }
const circleT = (cx, cy, r) => { const o = []; for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) if (Math.hypot(x - cx, y - cy) <= r) o.push([x, y]); return o; };
const donutT = (cx, cy, r0, r1) => circleT(cx, cy, r1).filter(([x, y]) => Math.hypot(x - cx, y - cy) >= r0);
const randT = (m, n) => { const o = []; for (let i = 0; i < n; i++) o.push([R(1, m.w - 2), R(1, m.h - 2)]); return o; };
function coneT(o, q, len, spread) { const a = Math.atan2(q.y - o.y, q.x - o.x), out = []; for (let d = 1; d <= len; d++) { const w = Math.round(d * spread); for (let k = -w; k <= w; k++) out.push([Math.round(o.x + Math.cos(a) * d - Math.sin(a) * k), Math.round(o.y + Math.sin(a) * d + Math.cos(a) * k)]); } return out; }
function lineT(m, x0, y0, q, len) { const a = Math.atan2(q.y - y0, q.x - x0), out = []; for (let d = 0; d <= len; d++) for (const k of [-1, 0, 1]) out.push([Math.round(x0 + Math.cos(a) * d - Math.sin(a) * k), Math.round(y0 + Math.sin(a) * d + Math.cos(a) * k)]); return out; }
function warnT(Rd, tiles, ms, dmg, c, opt = {}) {
  const m = MAPS[Rd.map]; tiles = rTiles(m, tiles); if (!tiles.length) return;
  Rd.haz.push(Object.assign({ at: now() + ms, tiles, dmg, c }, opt));
  bc(m.id, { t: 'warn', tiles, ms, c });
}
const rAlive = Rd => rmem(Rd).filter(q => q.map === Rd.map && !q.dead);
const rTarget = Rd => { const a = rAlive(Rd); return a.length ? pick(a) : null; };
const rBoss = (Rd, key) => MAPS[Rd.map].mobs.find(o => !o.dead && MON[o.t].id === key);
function rTalk(Rd, o, msg) { if (o) bc(Rd.map, { t: 'mtalk', id: o.id, m: msg, loud: 1 }); }
function raidStart(Rd) {
  const ps = rmem(Rd).filter(q => q.map === 'bosshub' && !q.dead);
  if (!ps.length) { Rd.mem.clear(); Rd.st = 'idle'; return; }
  Rd.mem = new Set(ps.map(q => q.id));
  const m = MAPS[Rd.map]; m.mobs.length = 0; m.ground.length = 0; Rd.haz = []; rClean(Rd);
  ps.forEach((q, i) => warp(q, m.id, (m.w >> 1) + (i % 7) - 3, m.h - 3 - Math.floor(i / 7)));
  Rd.st = 'fight'; Rd.ph = 1; Rd.next = now() + 3500; Rd.t0 = now();
  sendAll({ t: 'notice', m: `⚔️ ${Rd.n} 레이드 시작! (${ps.length}명 참여)`, c: '#ff922b' });
  const cx = m.w >> 1;
  if (Rd.id === 'r10') { const a = rSpawn(Rd, 'rmush', cx - 6, 7), b = rSpawn(Rd, 'rbroc', cx + 6, 7); rTalk(Rd, a, '버섯 등장!!'); rTalk(Rd, b, '브로콜리도 있다!!'); }
  if (Rd.id === 'r30') { rTalk(Rd, rSpawn(Rd, 'rdino', cx, 6, { inv: 1, shield: 1 }), '크아아아앙!!! 불꽃 갑옷이 나를 지킨다!!'); Rd.plateAt = now() + 4000; rHint(Rd, '🔥 티라노는 불꽃 갑옷(보호막) 상태! 파란 냉각 발판을 모두 밟아 갑옷을 식히세요'); }
  Rd.left = Rd.lives || 1; Rd.marks = []; Rd.share = null; Rd.tent = [];
  if (Rd.id === 'r40') { rTalk(Rd, rSpawn(Rd, 'kraken', cx, 7, { still: 1, inv: 1, shield: 1 }), '심연이… 너희를 삼킨다…'); rTentacles(Rd); Rd.plateAt = now() + 4000; rMood(Rd, 'deep'); rHint(Rd, '🐙 문어왕은 보호막 상태! 노란 등대 발판 3개를 3명이 동시에 2초 밟아야 깨져요'); }
  if (Rd.id === 'r70') { rTalk(Rd, rSpawn(Rd, 'clockking', cx, 9, { still: 1, inv: 1, shield: 1 }), '째깍… 째깍… 너희의 시간은 끝났다.'); Rd.plateAt = now() + 4000; rHint(Rd, '🕰️ 마왕의 보호막! 톱니 발판 3개를 3명이 동시에 밟으세요. 노란 원(운명의 일격)은 3명 이상 모여서 나눠 맞기!'); }
  if (Rd.id === 'r50') {
    const b = rSpawn(Rd, 'zbody', cx, 8, { inv: 1, still: 1 }); rTalk(Rd, b, '…감히 내 잠을 깨우는가.');
    for (const [dx, dy] of [[-7, -3], [-7, 1], [-5, 5], [-2, 7], [2, 7], [5, 5], [7, 1], [7, -3]]) rSpawn(Rd, 'zarm', cx + dx, 8 + dy, { still: 1, armAt: now() + R(3000, 7000) });
  }
}
function raidMobDied(mo, p) {
  const Rd = RAIDS[mo.raid]; if (!Rd || Rd.st !== 'fight') return;
  const m = MAPS[Rd.map], key = MON[mo.t].id, left = k => m.mobs.some(o => !o.dead && MON[o.t].id === k);
  if (Rd.id === 'r10' && Rd.ph === 1 && !left('rmush') && !left('rbroc')) {
    Rd.ph = 2; Rd.next = now() + 3000; sendAll({ t: 'notice', m: '🍄🥦 버섯과 브로콜리가 합체했다!! (2페이즈)', c: '#74b816', big: 1 });
    rTalk(Rd, rSpawn(Rd, 'rmushbroc', m.w >> 1, 8), '합체!!! 버섯브로콜리!!');
  } else if (Rd.id === 'r10' && key === 'rmushbroc') raidWin(Rd, p, mo);
  else if (Rd.id === 'r30' && key === 'rdino') {
    Rd.ph = 2; Rd.next = now() + 4500; bc(m.id, { t: 'fx', k: 'boom', x: mo.x, y: mo.y, r: 4, c: '#c92a2a' });
    sendAll({ t: 'notice', m: '🦖 쿠웅… 찌이익!! 티라노 안에서 더 큰 공룡이 찢고 나왔다!! (2페이즈)', c: '#ff6b6b', big: 1 });
    const x = mo.x, y = mo.y; Rd.plates = []; rPlates(Rd);
    setTimeout(() => { if (Rd.st !== 'fight') return; rTalk(Rd, rSpawn(Rd, 'rdino2', x, y, { inv: 1, shield: 1 }), '크와아아아아앙!!!!! 화산아 터져라!!'); rLava(Rd); Rd.plateAt = now() + 3000; }, 1500);
  } else if (Rd.id === 'r30' && key === 'rdino2') raidWin(Rd, p, mo);
  else if (Rd.id === 'r50' && key === 'zarm' && !left('zarm') && Rd.ph === 1) {
    Rd.ph = 2; Rd.next = now() + 2500; const b = rBoss(Rd, 'zbody'); if (b) b.shield = 1; Rd.plateAt = now() + 2500; rMood(Rd, 'quake'); rHint(Rd, '🗿 석상왕의 보호막! 석상왕이 보여주는 색깔 순서대로 발판을 밟으세요');
    sendAll({ t: 'notice', m: '🗿 석상왕의 팔이 모두 부서졌다! 본체 공격 가능!! (2페이즈)', c: '#adb5bd', big: 1 }); rTalk(Rd, b, '내 팔을…!! 용서하지 않겠다!!');
  } else if (Rd.id === 'r50' && key === 'zbody') {
    Rd.ph = 3; Rd.next = now() + 4000; sendAll({ t: 'notice', m: '🔥 석상왕이 분노하며 다시 일어났다!! (3페이즈)', c: '#ff6b6b', big: 1 });
    const x = mo.x, y = mo.y; Rd.plates = []; rPlates(Rd); rCollapse(Rd, 3);
    setTimeout(() => { if (Rd.st !== 'fight') return; rTalk(Rd, rSpawn(Rd, 'zbody2', x, y, { still: 1, inv: 1, shield: 1 }), '이것이… 나의 진짜 힘이다!!!'); Rd.plateAt = now() + 3500;
      for (const [dx, dy] of [[-7, 1], [-2, 7], [2, 7], [7, 1]]) rSpawn(Rd, 'zarm', x + dx, y + dy, { still: 1, armAt: now() + R(3000, 6000) }); }, 1500);
  } else if (Rd.id === 'r50' && key === 'zbody2') raidWin(Rd, p, mo);
  else if (Rd.id === 'r40' && key === 'tentacle') Rd.tent.push({ x: mo.x, y: mo.y, at: now() + 20000 });
  else if ((Rd.id === 'r40' && key === 'kraken') || (Rd.id === 'r70' && key === 'clockking')) {
    if (Rd.left > 1) {
      Rd.left--; Rd.ph++; Rd.plates = []; rPlates(Rd); Rd.share = null; const x = mo.x, y = mo.y, id = key;
      sendAll({ t: 'notice', m: id === 'kraken' ? `🐙 문어왕이 심연에서 다시 살아났다!! (남은 목숨 ${Rd.left})` : `⏪ 시간 되감기!! 시계탑 마왕이 부활했다!! (남은 목숨 ${Rd.left})`, c: '#b197fc', big: 1 });
      bc(Rd.map, { t: 'shake', ms: 1200 });
      setTimeout(() => {
        if (Rd.st !== 'fight') return;
        const b = rSpawn(Rd, id, x, y, { still: 1, inv: 1, shield: 1 }); Rd.plateAt = now() + 3000;
        rTalk(Rd, b, id === 'kraken' ? pick(['아직이다…!!', '심연은 끝나지 않는다!!', '촉수여 다시 일어나라!!']) : pick(['시간은 내 편이다!!', '되감기!! 처음부터 다시!!', '너희는 영원히 이 시계탑에 갇힌다!!']));
        if (id === 'kraken') { rTentacles(Rd); if (Rd.left === 1) rCollapse(Rd, 3); }
        if (id === 'clockking') { if (Rd.ph >= 3) rClones(Rd, b); if (Rd.ph === 4) rMood(Rd, 'dark'); if (Rd.left === 1) rCollapse(Rd, 3); }
      }, 2500);
    } else raidWin(Rd, p, mo);
  }
}
function raidWin(Rd, p, mo) {
  const m = MAPS[Rd.map], ps = rmem(Rd).filter(q => q.map === m.id);
  const each = Math.round(Rd.exp / Math.max(1, ps.length));
  for (const q of ps) { giveItem(q, stackItem('mat', Rd.mat, Rd.mat, 1)); say(q, 'loot', `🧩 레이드 재료 [${Rd.mat}] 획득! (냉동참치 보따리 재료)`, '#a5d8ff'); }
  for (const q of ps) { addExp(q, each); q.gold += Math.round(Rd.exp / 20 / Math.max(1, ps.length)); q.dirty = 1; say(q, 'loot', `🏆 레이드 클리어! +${Math.round(each * EXPM)}exp (참여자 ${ps.length}명 분배)`); }
  m.mobs.length = 0; Rd.haz = [];
  const items = []; for (let i = 0; i < Rd.items; i++) items.push(buildEquip(pick(['weapon', 'armor', 'helm']), Rd.ilv, rollRarity(true)));
  items.push(mkScroll('enh', Math.ceil(Rd.items / 2)), mkGold(Rd.exp / 60 | 0)); if (Math.random() < .4) items.push(mkScroll('ward', 1));
  if (Rd.id !== 'r10' && Math.random() < ({ r30: .03, r40: .05, r50: .08, r70: .12 }[Rd.id] || 0)) items.push(hiddenEquip(pick(['weapon', 'armor']), Rd.ilv));
  if (Rd.id === 'r50' && Math.random() < .3) items.push({ id: db.iid++, type: 'helm', b: 4, r: 5, il: 60, plus: 0, n: '석상왕의 왕관', atkb: 120, defb: 40, hpb: 800 });
  if (Rd.id === 'r50') { for (const it of items) dropGround(m, R(2, m.w - 3), R(2, m.h - 3), it, 0); } else spreadDrop(m, mo.x, mo.y, items, 0);
  sendAll({ t: 'notice', m: `🏆 ${Rd.n} 레이드 클리어!! (${ps.map(q => q.name).join(', ')})${items.some(i => i.n === '석상왕의 왕관') ? ' 👑 석상왕의 왕관이 떨어졌다!' : ''}`, c: '#ffe066', big: 1 });
  sendAll({ t: 'kill', a: who(p), boss: Rd.n + ' 레이드', map: m.name });
  Rd.st = 'done'; Rd.endAt = now() + 45000; Rd.ph = 0;
  for (const q of ps) say(q, 'sys', '45초 안에 바닥의 보상을 주우세요! (F키)');
}
// ===== 발판 / 그로기 / 맵 변환 =====
const PCOL = ['#ff6b6b', '#4dabf7', '#51cf66', '#ffd43b', '#da77f2'], PEMO = ['🔴', '🔵', '🟢', '🟡', '🟣'];
function rClean(Rd) {
  const m = MAPS[Rd.map]; m.t = m.orig.map(r => r.slice()); Rd.plates = []; Rd.seq = null; Rd.seqI = 0; Rd.plateAt = 0; Rd.coll = 0; Rd.mood = ''; Rd.sim = 0; Rd.hold = 0; Rd.share = null; Rd.marks = []; Rd.tent = [];
  bc(m.id, { t: 'mood', m: '' }); bc(m.id, mapMsg(m));
}
function rHint(Rd, msg) { for (const q of rmem(Rd)) send(q, { t: 'notice', m: msg, c: '#74c0fc' }); }
function rMood(Rd, mood) { Rd.mood = mood; bc(Rd.map, { t: 'mood', m: mood }); bc(Rd.map, { t: 'shake', ms: 900 }); }
function rSetTiles(Rd, list, ch) { const m = MAPS[Rd.map], set = []; for (const [x, y] of list) if (x > 0 && y > 0 && x < m.w - 1 && y < m.h - 1 && m.t[y][x] !== 'W') { m.t[y][x] = ch; set.push([x, y]); } bc(m.id, { t: 'tiles', set, ch }); return set; }
function rPlates(Rd) { bc(Rd.map, { t: 'plates', l: Rd.plates.map(p => [p.x, p.y, p.ci, p.on > now() ? 1 : 0]), seq: Rd.seq, i: Rd.seqI || 0, sim: Rd.sim ? 1 : 0, hold: Rd.hold || 0 }); }
function rFree(Rd, b, n) {
  const m = MAPS[Rd.map], out = [];
  for (let k = 0; k < 400 && out.length < n; k++) { const x = R(2, m.w - 3), y = R(2, m.h - 3); if (m.t[y][x] !== '.' || (b && dist(b, { x, y }) < 4.5) || out.some(o => Math.hypot(o.x - x, o.y - y) < 5)) continue; out.push({ x, y }); }
  return out;
}
function rMakePlates(Rd, b) {
  if (Rd.id === 'r40' || Rd.id === 'r70') { const pos = []; for (let k = 0; k < 60 && pos.length < 3; k++) { const c = rFree(Rd, b, 6); for (const o of c) if (pos.length < 3 && pos.every(q => Math.hypot(q.x - o.x, q.y - o.y) >= 8)) pos.push(o); } Rd.plates = pos.map(o => ({ x: o.x, y: o.y, ci: 3, on: 0 })); Rd.seq = null; Rd.sim = 1; Rd.hold = 0; rTalk(Rd, b, Rd.id === 'r40' ? '등대에 불을 켤 수 있을까…? 셋이서 동시에…' : '세 개의 톱니가 동시에 돌아야… 내 시간이 멈춘다…'); }
  else if (Rd.id === 'r30') { Rd.plates = rFree(Rd, b, Rd.ph === 1 ? 3 : 4).map(o => ({ x: o.x, y: o.y, ci: 1, on: 0 })); Rd.seq = null; }
  else { const n = Rd.ph === 3 ? 5 : 4, pos = rFree(Rd, b, n), order = [...Array(n).keys()].sort(() => Math.random() - .5); Rd.plates = pos.map((o, i) => ({ x: o.x, y: o.y, ci: i, on: 0 })); Rd.seq = order; Rd.seqI = 0; rTalk(Rd, b, '순서를 기억하라… ' + order.map(i => PEMO[i]).join(' → ')); }
  rPlates(Rd);
}
function rGroggy(Rd, b) {
  const gt = Rd.id === 'r40' || Rd.id === 'r70' ? 10000 : 12000; const t = now(); b.inv = 0; b.groggy = t + gt; b.stun = t + gt; b.air = 0; Rd.plates = []; Rd.seq = null; rPlates(Rd); Rd.plateAt = t + gt;
  bc(Rd.map, { t: 'fx', k: 'boom', x: b.x, y: b.y, r: 4, c: '#74c0fc' }); bc(Rd.map, { t: 'shake', ms: 600 });
  for (const q of rmem(Rd)) send(q, { t: 'notice', m: `💥 보호막 파괴! 그로기 ${gt / 1000}초 — 지금 집중 공격!! (피해 1.5배)`, c: '#ffe066', big: 1 });
  rTalk(Rd, b, pick(['크윽…!! 내 갑옷이…!!', '말도 안 돼…!!', '움직일 수가… 없다…']));
}
function rTentacles(Rd) { const m = MAPS[Rd.map], cx = m.w >> 1; Rd.tent = []; for (const o of m.mobs.filter(o => MON[o.t].id === 'tentacle')) o.dead = 1; m.mobs = m.mobs.filter(o => !o.dead); for (const [dx, dy] of [[-8, -1], [-7, 4], [-3, 7], [3, 7], [7, 4], [8, -1]]) rSpawn(Rd, 'tentacle', cx + dx, 7 + dy, { still: 1, armAt: now() + R(3000, 7000) }); }
function rClones(Rd, b) { for (const [dx, dy] of [[-8, 3], [8, 3], [0, 9]]) rSpawn(Rd, 'clockclone', b.x + dx, b.y + dy, { still: 1 }); rHint(Rd, '👥 마왕의 분신 3체! 분신을 모두 쓰러뜨려야 톱니 발판이 나타나요'); }
function rMainBoss(Rd) {
  if (Rd.id === 'r30') return rBoss(Rd, Rd.ph === 1 ? 'rdino' : 'rdino2');
  if (Rd.id === 'r50') return Rd.ph >= 2 ? rBoss(Rd, Rd.ph === 3 ? 'zbody2' : 'zbody') : null;
  if (Rd.id === 'r40') return rBoss(Rd, 'kraken');
  if (Rd.id === 'r70') return rBoss(Rd, 'clockking');
  return null;
}
function rPlateTick(Rd, t) {
  const b = rMainBoss(Rd);
  if (!b || !b.shield) return;
  if (Rd.id === 'r70' && MAPS[Rd.map].mobs.some(o => !o.dead && MON[o.t].id === 'clockclone')) { if (Rd.plates.length) { Rd.plates = []; rPlates(Rd); } return; }
  if (b.groggy && t > b.groggy) { b.groggy = 0; b.inv = 1; Rd.sim = 0; rTalk(Rd, b, '다시 보호막이다!!'); rHint(Rd, '🛡 보호막이 다시 생겼어요! 발판을 다시 밟으세요'); }
  if (!b.inv) return;
  if (!Rd.plates.length) { if (t > Rd.plateAt) rMakePlates(Rd, b); return; }
  if (Rd.sim) {
    const al = rAlive(Rd); let all = true;
    for (const pl of Rd.plates) { const occ = al.some(q => q.x === pl.x && q.y === pl.y); if (occ !== !!pl.on) { pl.on = occ ? Infinity : 0; } if (!occ) all = false; }
    Rd.hold = all ? (Rd.hold || 0) + 100 : 0;
    if (Rd.hold >= 2000) { Rd.hold = 0; Rd.sim = 0; return rGroggy(Rd, b); }
    if (tk % 3 === 0) rPlates(Rd);
    return;
  }
  let changed = false;
  for (const pl of Rd.plates) {
    if (pl.on > t) continue;
    const q = rAlive(Rd).find(q => q.x === pl.x && q.y === pl.y); if (!q) continue;
    if (Rd.seq) {
      if (Rd.seq[Rd.seqI] === pl.ci) { pl.on = Infinity; Rd.seqI++; changed = true; bc(Rd.map, { t: 'fx', k: 'ring', x: pl.x, y: pl.y, r: 1, c: PCOL[pl.ci] }); }
      else if (!pl.on) { for (const x of Rd.plates) x.on = 0; Rd.seqI = 0; changed = true; warnT(Rd, donutT(q.x, q.y, 0, 2.5), 700, Rd.ph === 3 ? 500 : 400, '#e03131', { stun: 800 }); rTalk(Rd, b, '틀렸다!! 처음부터 다시!!'); }
    } else { pl.on = t + 10000; changed = true; bc(Rd.map, { t: 'fx', k: 'ring', x: pl.x, y: pl.y, r: 1, c: '#4dabf7' }); }
  }
  for (const pl of Rd.plates) if (!Rd.seq && pl.on && pl.on <= t && pl.on !== 1) { pl.on = 0; changed = true; }
  if (Rd.plates.every(pl => pl.on > t)) return rGroggy(Rd, b);
  if (changed || (t % 1000) < 100) rPlates(Rd);
}
function rLava(Rd) {
  const m = MAPS[Rd.map], tiles = [];
  for (let y = 1; y < m.h - 1; y++) for (let x = 1; x < m.w - 1; x++) { const edge = Math.min(x, y, m.w - 1 - x, m.h - 1 - y); if (edge <= 2 || (Math.abs(y - (m.h >> 1)) <= 1 && Math.abs(x - (m.w >> 1)) > 5) || (Math.abs(x - (m.w >> 1)) <= 1 && y > m.h - 9 && y < m.h - 4)) tiles.push([x, y]); }
  rSetTiles(Rd, tiles, 'L'); rMood(Rd, 'lava');
  for (const q of rmem(Rd)) send(q, { t: 'notice', m: '🌋 화산 폭발!! 바닥 곳곳이 용암으로 변했다 (밟으면 계속 피해)', c: '#ff6b00', big: 1 });
}
function rCollapse(Rd, w) {
  const m = MAPS[Rd.map], tiles = [];
  for (let y = 1; y < m.h - 1; y++) for (let x = 1; x < m.w - 1; x++) if (Math.min(x, y, m.w - 1 - x, m.h - 1 - y) <= w) tiles.push([x, y]);
  warnT(Rd, tiles, 1800, 99999, '#000000');
  setTimeout(() => {
    if (Rd.st !== 'fight') return; rSetTiles(Rd, tiles, 'V'); Rd.coll = w;
    for (const q of players.values()) if (q.map === m.id && !q.dead && m.t[q.y][q.x] === 'V') { q.x = m.w >> 1; q.y = (m.h >> 1) + 4; }
    rMood(Rd, 'dark');
    for (const q of rmem(Rd)) send(q, { t: 'notice', m: w > 3 ? '🕳️ 바닥이 더 무너졌다!! 가운데로 모이세요' : '🕳️ 석상왕의 분노로 바닥이 무너지기 시작했다!!', c: '#b197fc', big: 1 });
  }, 1800);
}
function raidTick(t) {
  for (const Rd of Object.values(RAIDS)) {
    const m = MAPS[Rd.map];
    if (Rd.st === 'lobby') { for (const id of [...Rd.mem]) { const q = players.get(id); if (!q) Rd.mem.delete(id); } if (!Rd.mem.size) { Rd.st = 'idle'; continue; } if (t >= Rd.startAt) raidStart(Rd); continue; }
    if (Rd.st === 'done') { if (t >= Rd.endAt) raidReset(Rd.id, '레이드가 끝났어요. 보스 대기실로 돌아왔어요.'); continue; }
    if (Rd.st !== 'fight') continue;
    if (!rAlive(Rd).length) { sendAll({ t: 'notice', m: `💀 ${Rd.n} 레이드 실패…`, c: '#868e96' }); raidReset(Rd.id); continue; }
    if (Rd.share && t >= Rd.share.at) {
      const S = Rd.share; Rd.share = null; const al = rAlive(Rd), inn = al.filter(q => Math.hypot(q.x - S.x, q.y - S.y) <= S.r + .3);
      bc(m.id, { t: 'hz', tiles: rTiles(m, circleT(S.x, S.y, S.r)), c: '#ffd43b' }); bc(m.id, { t: 'share', x: S.x, y: S.y, r: 0, ms: 0 }); bc(m.id, { t: 'shake', ms: 700 });
      if (inn.length >= 3) { for (const q of inn) damagePlayer(q, Math.max(1, Math.round(S.dmg / inn.length - defOf(q) * .2)), null); for (const q of rmem(Rd)) send(q, { t: 'notice', m: `✅ 운명의 일격을 ${inn.length}명이 나눠 맞았다!`, c: '#69db7c' }); }
      else { for (const q of inn) damagePlayer(q, S.dmg, null); for (const q of al) if (!inn.includes(q)) damagePlayer(q, 1200, null); const b = rBoss(Rd, 'clockking'); if (b) b.hp = Math.min(b.mhp, b.hp + Math.round(b.mhp * .05)); for (const q of rmem(Rd)) send(q, { t: 'notice', m: `❌ 3명이 모이지 못했다!! (원 안 ${inn.length}명) 전원 피해 + 마왕 회복`, c: '#ff6b6b', big: 1 }); }
    }
    if (tk % 10 === 0) for (const q of players.values()) if (q.map === m.id && !q.dead && m.t[q.y][q.x] === 'L') damagePlayer(q, Math.max(1, Math.round(110 - defOf(q) * .2)), null);
    rPlateTick(Rd, t);
    if (Rd.id === 'r50' && Rd.ph === 3 && Rd.coll === 3) { const b = rBoss(Rd, 'zbody2'); if (b && b.hp < b.mhp * .5) { Rd.coll = 5; rCollapse(Rd, 5); } }
    // 기믹 피해 처리
    for (let i = Rd.haz.length - 1; i >= 0; i--) {
      const h = Rd.haz[i]; if (t < h.at) continue; Rd.haz.splice(i, 1);
      const set = new Set(h.tiles.map(([x, y]) => x + ',' + y));
      bc(m.id, { t: 'hz', tiles: h.tiles, c: h.c });
      if (h.dmg < 99999) for (const q of players.values()) if (q.map === m.id && !q.dead && set.has(q.x + ',' + q.y)) { if (h.stun) q.stun = t + h.stun; damagePlayer(q, Math.max(1, Math.round(h.dmg - defOf(q) * 0.3)), null); }
      if (h.land) { const o = m.mobs.find(x => x.id === h.land); if (o) { o.air = 0; if (walk(m, h.lx, h.ly)) { o.x = h.lx; o.y = h.ly; } } }
    }
    if (t < Rd.next) continue;
    const tg = rTarget(Rd); if (!tg) continue;
    if (Rd.id === 'r10') {
      if (Rd.ph === 1) {
        const mu = rBoss(Rd, 'rmush'), br = rBoss(Rd, 'rbroc');
        if (mu) for (const q of rAlive(Rd).slice(0, 4)) warnT(Rd, circleT(q.x, q.y, 1.2), 1600, 70, '#be4bdb');
        if (br) { const q = rTarget(Rd); warnT(Rd, Math.random() < .5 ? Array.from({ length: m.w }, (_, x) => [x, q.y]) : Array.from({ length: m.h }, (_, y) => [q.x, y]), 1600, 70, '#40c057'); }
        Rd.next = t + 3600;
      } else {
        const b = rBoss(Rd, 'rmushbroc'); if (!b) continue;
        if (!Rd.flip) { const q = rTarget(Rd); b.air = 1; rTalk(Rd, b, pick(['점프!!!', '깔아뭉개주마!!', '쿠웅 간다!!'])); warnT(Rd, circleT(q.x, q.y, 2.6), 1900, 220, '#e8590c', { stun: 1000, land: b.id, lx: q.x, ly: q.y }); }
        else warnT(Rd, randT(m, 10).flatMap(([x, y]) => circleT(x, y, .8)), 1500, 70, '#be4bdb');
        Rd.flip = !Rd.flip; Rd.next = t + 3000;
      }
    }
    if (Rd.id === 'r30') {
      const b = rBoss(Rd, Rd.ph === 1 ? 'rdino' : 'rdino2'); if (!b) continue;
      if (b.groggy > t) { Rd.next = t + 800; continue; }
      const n = Rd.ph === 1 ? 1 : 2;
      for (let k = 0; k < n; k++) { const q = rTarget(Rd); warnT(Rd, coneT(b, q, Rd.ph === 1 ? 8 : 10, .4), 1300, Rd.ph === 1 ? 300 : 380, '#ff6b00'); }
      rTalk(Rd, b, pick(['불이야아아!!', '크아앙!! 🔥', '다 태워버리겠다!!']));
      if ((Rd.cnt = (Rd.cnt || 0) + 1) % 2 === 0) warnT(Rd, Rd.ph === 1 ? circleT(b.x, b.y, 3.2) : randT(m, 12).flatMap(([x, y]) => circleT(x, y, 1)), 1100, Rd.ph === 1 ? 220 : 300, '#c92a2a', { stun: Rd.ph === 2 ? 800 : 0 });
      Rd.next = t + (Rd.ph === 1 ? 4200 : 3500);
    }
    if (Rd.id === 'r40') {
      for (const tn of [...Rd.tent]) if (t > tn.at && rBoss(Rd, 'kraken')) { Rd.tent.splice(Rd.tent.indexOf(tn), 1); rSpawn(Rd, 'tentacle', tn.x, tn.y, { still: 1, armAt: t + 3000 }); bc(m.id, { t: 'mtalk', id: rBoss(Rd, 'kraken').id, m: '촉수여… 되살아나라!!', loud: 1 }); }
      for (const a of m.mobs.filter(o => !o.dead && MON[o.t].id === 'tentacle')) if (t > (a.armAt || 0)) { a.armAt = t + R(5500, 8500); warnT(Rd, lineT(m, a.x, a.y, rTarget(Rd), 14), 1400, 420, '#7048e8'); }
      const b = rBoss(Rd, 'kraken'); if (!b) { Rd.next = t + 800; continue; }
      if (b.groggy > t) { Rd.next = t + 800; continue; }
      const c = Rd.cnt = (Rd.cnt || 0) + 1, ph = Rd.ph;
      warnT(Rd, randT(m, 7 + ph * 3).flatMap(([x, y]) => circleT(x, y, 1)), 1500, 330 + ph * 40, '#212529');
      if (c % 3 === 0) { warnT(Rd, circleT(b.x, b.y, 4 + ph), 1800, 520, '#1864ab', { stun: 900 }); rTalk(Rd, b, '소용돌이에 빨려 들어가라!!'); }
      if (ph >= 3 && c % 3 === 1) { const gap = R(2, m.w - 6); for (let k = 0; k * 3 < m.h - 2; k++) { const tiles = []; for (let y = 1 + k * 3; y < Math.min(m.h - 1, 4 + k * 3); y++) for (let x = 1; x < m.w - 1; x++) if (x < gap || x > gap + 3) tiles.push([x, y]); warnT(Rd, tiles, 1300 + k * 380, 480, '#4dabf7'); } rTalk(Rd, b, '해일이다!! 틈으로 피해봐라!!'); }
      Rd.next = t + Math.max(2600, 4000 - ph * 300);
    }
    if (Rd.id === 'r70') {
      const b = rBoss(Rd, 'clockking'); if (!b) { Rd.next = t + 800; continue; }
      if (b.groggy > t) { Rd.next = t + 800; continue; }
      const c = Rd.cnt = (Rd.cnt || 0) + 1, ph = Rd.ph, a0 = Math.random() * Math.PI * 2, dir = Math.random() < .5 ? 1 : -1;
      for (let k = 0; k < 6 + ph; k++) { const a = a0 + dir * k * .45, q = { x: b.x + Math.cos(a) * 20, y: b.y + Math.sin(a) * 20 }; warnT(Rd, lineT(m, b.x, b.y, q, 22), 1300 + k * 280, 600 + ph * 50, '#fab005'); }
      if (c % 3 === 1) { const al = rAlive(Rd).sort(() => Math.random() - .5).slice(0, Math.min(2, Math.max(1, rAlive(Rd).length - 1))); for (const q of al) { bc(m.id, { t: 'mark', id: q.id, ms: 4000 }); send(q, { t: 'notice', m: '💣 시한폭탄이 붙었다! 4초 뒤 폭발 — 다른 사람과 떨어지세요!', c: '#ff922b', big: 1 }); setTimeout(() => { if (Rd.st === 'fight' && q.map === m.id && !q.dead) warnT(Rd, circleT(q.x, q.y, 2.5), 500, 850 + ph * 60, '#ff922b'); }, 3500); } rTalk(Rd, b, '째깍째깍… 펑!!'); }
      if (c % 3 === 2 && !Rd.share) { const q = rTarget(Rd), sx = Math.max(3, Math.min(m.w - 4, q.x + R(-3, 3))), sy = Math.max(3, Math.min(m.h - 4, q.y + R(-3, 3))); Rd.share = { x: sx, y: sy, r: 2.2, at: t + 5000, dmg: 3300 + ph * 300 }; bc(m.id, { t: 'share', x: sx, y: sy, r: 2.2, ms: 5000 }); for (const q2 of rmem(Rd)) send(q2, { t: 'notice', m: '⚠️ 운명의 일격! 노란 원 안에 3명 이상 모여서 나눠 맞으세요!!', c: '#ffd43b', big: 1 }); rTalk(Rd, b, '운명의 일격… 함께 견딜 수 있겠나?'); }
      if (ph >= 4 && c % 2 === 0) { const sq = R(0, 3), tiles = []; for (let y = 1; y < m.h - 1; y++) for (let x = 1; x < m.w - 1; x++) { const qd = (x < (m.w >> 1) ? 0 : 1) + (y < (m.h >> 1) ? 0 : 2); if (qd !== sq) tiles.push([x, y]); } warnT(Rd, tiles, 2400, 900, '#9c36b5'); rTalk(Rd, b, '시간의 틈은 하나뿐이다!!'); }
      Rd.next = t + Math.max(2600, 3800 - ph * 200);
    }
    if (Rd.id === 'r50') {
      const body = rBoss(Rd, Rd.ph === 3 ? 'zbody2' : 'zbody');
      for (const a of m.mobs.filter(o => !o.dead && MON[o.t].id === 'zarm')) if (t > (a.armAt || 0)) { a.armAt = t + R(5000, 8000); warnT(Rd, lineT(m, a.x, a.y, rTarget(Rd), 12), 1400, 420, '#868e96'); }
      if (!body) { Rd.next = t + 1000; continue; }
      if (body.groggy > t) { Rd.next = t + 800; continue; }
      if (Rd.ph >= 2) warnT(Rd, randT(m, Rd.ph === 3 ? 22 : 14).flatMap(([x, y]) => circleT(x, y, .8)), 1500, Rd.ph === 3 ? 650 : 550, '#495057');
      if ((Rd.cnt = (Rd.cnt || 0) + 1) % 2 === 0) { warnT(Rd, donutT(body.x, body.y, 3, Rd.ph === 3 ? 6.5 : 5.5), 1500, Rd.ph === 3 ? 600 : 480, '#e03131', { stun: Rd.ph === 3 ? 1200 : 0 }); rTalk(Rd, body, pick(['무릎 꿇어라!!', '돌이 되어라…', '이 땅은 나의 것이다!!'])); }
      Rd.next = t + (Rd.ph === 3 ? 3400 : 4000);
    }
  }
}

/* ===================== 접속/메시지 ===================== */
const app = express(); app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app); const wss = new WebSocketServer({ server, maxPayload: 8192 });
const INIT = { t: 'init', TIER1_LV, TUNA: { need: TUNA_RECIPE, gold: TUNA_GOLD }, NPCS: Object.fromEntries(Object.entries(NPCS).map(([k, v]) => [k, { n: v.n, map: (Object.values(MAPS).find(m => (m.npcs || []).some(n => n.id === k)) || {}).name }])), VILLAGES: Object.fromEntries(FK.map(f => [f, VILLAGE[f].dir])), MAPLIST: Object.values(MAPS).map(m => ({ id: m.id, n: m.name, lvr: m.lvr, boss: m.boss })), RAIDS: Object.fromEntries(Object.entries(RAIDS).map(([k, r]) => [k, { n: r.n, lv: r.lv }])), MON: MON.map(m => ({ raid: m.raid, big: m.big, look: m.look, skn: m.sk && m.sk.n, id: m.id, n: m.n, s: m.s, c: m.c, boss: m.boss, lv: m.lv })), RAR, WB, AB, HB, FAC, VAR, SHOP, QUESTS, MAXINV, JOBS: Object.fromEntries(Object.entries(JOBS).map(([k, j]) => [k, { n: j.n, icon: j.icon, tier: j.tier, d: j.d, sk: j.sk, hp: j.hp, atk: j.atk, mp: j.mp }])) };
function login(ws, m) {
  const name = String(m.name || '').trim(), pw = String(m.pw || '');
  if (!/^[가-힣a-zA-Z0-9_]{2,8}$/.test(name)) return ws.send(JSON.stringify({ t: 'err', m: '이름은 2~8자 (한글/영문/숫자)' }));
  if (pw.length < 3 || pw.length > 30) return ws.send(JSON.stringify({ t: 'err', m: '비밀번호는 3자 이상' }));
  let acc = db.acc[name];
  const isAdmin = name === ADMIN;
  if (isAdmin) {
    if (now() < adminLockUntil) return ws.send(JSON.stringify({ t: 'err', m: '잠시 후 다시 시도하세요' }));
    const ok = ADMIN_PW ? (pw.length === ADMIN_PW.length && crypto.timingSafeEqual(Buffer.from(pw), Buffer.from(ADMIN_PW)))
      : crypto.timingSafeEqual(crypto.scryptSync(pw, 'bcrpg-admin-v1', 32), Buffer.from(ADMIN_HASH, 'hex'));
    if (!ok) { if (++adminFail >= 5) { adminFail = 0; adminLockUntil = now() + 60000; } return ws.send(JSON.stringify({ t: 'err', m: '비밀번호가 틀렸어요' })); }
    adminFail = 0;
    const salt = crypto.randomBytes(8).toString('hex');
    if (!acc) acc = db.acc[name] = { salt, hash: hashPw(pw, salt), ch: newChar(FAC[m.faction] ? m.faction : 'sangdong') };
    for (const q of players.values()) if (q.name === name) { save(q); q.ws.close(); players.delete(q.id); }
  } else if (acc) {
    const h = Buffer.from(hashPw(pw, acc.salt)), o = Buffer.from(acc.hash);
    if (h.length !== o.length || !crypto.timingSafeEqual(h, o)) return ws.send(JSON.stringify({ t: 'err', m: '비밀번호가 틀렸어요' }));
    for (const q of players.values()) if (q.name === name) { save(q); q.ws.close(); players.delete(q.id); }
  } else {
    if (!FAC[m.faction]) return ws.send(JSON.stringify({ t: 'need_create' }));
    const salt = crypto.randomBytes(8).toString('hex'); acc = db.acc[name] = { salt, hash: hashPw(pw, salt), ch: newChar(m.faction) };
  }
  const c = acc.ch;
  const p = Object.assign({ ws, id: PID++, name, d: 0, dead: 0, mvAt: 0, atkAt: 0, cd: [0, 0, 0, 0], bf: {}, stun: 0, lock: new Set(), dirty: 1, vdirty: 1 }, JSON.parse(JSON.stringify(c)));
  if (!MAPS[p.map] || !walk(MAPS[p.map], p.x, p.y)) { const vs = villageSpawn(p.faction); p.map = vs.map; p.x = vs.x; p.y = vs.y; }
  if (!JOBS[p.job]) p.job = 'novice';
  if (p.qv !== 2) { p.q = {}; p.qd = {}; p.qv = 2; }
  if (p.job === 'novice' && p.lv >= TIER1_LV) setTimeout(() => send(p, { t: 'jobpick' }), 500);
  stats(p); if (p.hp > 900 && c.hp === 999) { p.hp = p.mhp; p.mp = p.mmp; } p.hp = Math.max(1, p.hp);
  if (isAdmin) { p.admin = 1; p.god = 1; }
  players.set(p.id, p); ws.pid = p.id;
  ws.send(JSON.stringify(INIT)); warp(p, p.map, p.x, p.y);
  if (p.admin) say(p, 'sys', ADMIN_TIP);
  send(p, { t: 'evt', mult: EXPM });
  sendAll({ t: 'notice', m: `👋 [${FAC[p.faction].n}] ${name}님이 입장하셨습니다`, c: FAC[p.faction].c, small: 1 });
  sendWho();
}
function onMsg(p, m) {
  const t = now(), mp = MAPS[p.map];
  switch (m.t) {
    case 'mv': {
      if (p.dead || t < p.mvAt || t < p.stun) return; const d = m.d | 0; if (d < 0 || d > 3) return; p.d = d;
      const nx = p.x + DX[d], ny = p.y + DY[d]; if (!walk(mp, nx, ny)) return; // 플레이어는 몬스터/다른 플레이어를 통과
      p.x = nx; p.y = ny; p.mvAt = p.fast ? t + 40 : t + Math.round(150 / (bm(p, 'spd') * (FAC[p.faction].spd || 1) * (p.mount ? MOUNT_SPD : 1))) - 25;
      const po = mp.portals.find(q => q.x === p.x && q.y === p.y); if (po) warp(p, po.to, po.tx, po.ty);
      break;
    }
    case 'atk': basicAttack(p); break;
    case 'sk': castSkill(p, m.i | 0); break;
    case 'chat': {
      let s = String(m.m || '').slice(0, 80).trim(); if (!s) return;
      if (p.admin) { if (s === '/boss') { spawnBoss(mp); return; } if (s.startsWith('/lv ')) { p.lv = Math.min(99, +s.slice(4) || 1); p.exp = 0; stats(p); p.hp = p.mhp; p.dirty = 1; return; } if (s.startsWith('/go ')) { const mm = MAPS[s.slice(4).trim()]; if (mm) warp(p, mm.id, mm.spawn.x + 6, mm.spawn.y); return; } if (s.startsWith('/give ')) { const o = [...players.values()].find(q => q.name === s.slice(6).trim()); if (o) { o.lv = Math.max(o.lv, 1); giveItem(o, genEquip(20, true)); } return; } if (s === '/gold') { p.gold += 100000; p.dirty = 1; return; } if (s === '/scroll') { giveItem(p, mkScroll('enh', 20)); giveItem(p, mkScroll('ward', 5)); return; } }
      if (s.startsWith('/w ')) { const [, to, ...r] = s.split(' '); const o = [...players.values()].find(q => q.name === to); if (!o) return say(p, 'sys', '그런 사람이 없어요'); const msg = r.join(' '); say(o, 'w', `${p.name} → 나: ${msg}`); say(p, 'w', `나 → ${o.name}: ${msg}`); return; }
      if (s[0] === '!') s = s.slice(1).trim(); if (!s) return;
      p.bub = s; p.bubT = t + 4000; sendAll({ t: 'chat', ch: 'all', n: p.name, f: p.faction, m: s, map: mp.name }); break;
    }
    case 'use': {
      const it = p.inv.find(i => i.id === (m.id | 0)); if (!it || p.dead) return;
      if (it.type === 'bundle') { useTunaBag(p, it); break; }
      if (it.type !== 'potion') return;
      const [hr, mr] = POTS[it.k] || [0, 0];
      if (hr) { const v = Math.max(100, Math.round(p.mhp * hr)); p.hp = Math.min(p.mhp, p.hp + v); bc(p.map, { t: 'dm', x: p.x, y: p.y, v, c: '#69db7c' }); }
      if (mr) p.mp = Math.min(p.mmp, p.mp + Math.max(60, Math.round(p.mmp * mr)));
      if (--it.q <= 0) p.inv.splice(p.inv.indexOf(it), 1); p.dirty = 1; p.vdirty = 1; break;
    }
    case 'potion': { const it = p.inv.find(i => i.type === 'potion' && i.k === m.k) || p.inv.find(i => i.type === 'potion' && i.k === m.k + '2'); if (it) onMsg(p, { t: 'use', id: it.id }); break; }
    case 'equip': {
      const it = p.inv.find(i => i.id === (m.id | 0)); if (!it || !isEq(it) || p.lock.has(it.id)) return; const sl = it.type;
      p.inv.splice(p.inv.indexOf(it), 1); if (p.eq[sl]) p.inv.push(p.eq[sl]); p.eq[sl] = it; stats(p); p.dirty = 1; break;
    }
    case 'unequip': { const sl = m.slot; if (!p.eq[sl] || p.inv.length >= MAXINV) return; p.inv.push(p.eq[sl]); p.eq[sl] = null; stats(p); p.dirty = 1; break; }
    case 'enh': enhance(p, m.id | 0, !!m.ward, !!m.bless); break;
    case 'compose': compose(p, (m.ids || []).map(Number).slice(0, 3)); break;
    case 'craft': if (m.k === 'tuna') craftTuna(p); break;
    case 'sell': { const it = p.inv.find(i => i.id === (m.id | 0)); if (!it || p.lock.has(it.id)) return; p.gold += sellPrice(it); p.inv.splice(p.inv.indexOf(it), 1); p.dirty = 1; break; }
    case 'drop': { const it = p.inv.find(i => i.id === (m.id | 0)); if (!it || p.lock.has(it.id) || p.dead) return; p.inv.splice(p.inv.indexOf(it), 1); dropGround(mp, p.x, p.y, it, 0); p.dirty = 1; say(p, 'sys', `🗑️ ${itemLabel(it)}을(를) 바닥에 버렸어요 (누구나 주울 수 있어요)`);
      if (isEq(it) && it.r >= 3) sendAll({ t: 'notice', m: `🗑️ ${p.name}님이 ${itemLabel(it)}을(를) 바닥에 버렸다!`, c: RAR[it.r].c }, p.map); break; }
    case 'buy': {
      const s = SHOP.find(x => x.k === m.k); const n = Math.max(1, Math.min(99, m.n | 0)); if (!s || p.gold < s.p * n) return say(p, 'sys', '골드가 부족해요');
      p.gold -= s.p * n; giveItem(p, POTS[s.k] ? mkPot(s.k, n) : mkScroll(s.k, n)); p.dirty = 1; say(p, 'loot', `🛒 ${SN[s.k]} x${n} 구매 (-${(s.p * n).toLocaleString()}G)`); break;
    }
    case 'qa': { const q = QUESTS.find(x => x.id === (m.id | 0)); if (!q || !qAvail(p, q) || !npcNear(p, q.giver)) return; p.q[q.id] = 0; p.dirty = 1; say(p, 'sys', `📜 [${q.n}] 퀘스트 시작!`); break; }
    case 'qt': { const q = QUESTS.find(x => x.id === (m.id | 0)); if (!q || !npcNear(p, q.giver) || !qReady(p, q)) return; questTurn(p, q.id); talkNpc(p, q.giver); break; }
    case 'npc': talkNpc(p, String(m.id)); break;
    case 'pick': pickUp(p); break;
    case 'job': {
      const J = JOBS[m.job]; if (!J || J.tier !== 1 || p.job !== 'novice' || p.lv < TIER1_LV) return;
      p.job = m.job; p.cd = [0, 0, 0, 0]; stats(p); p.hp = p.mhp; p.mp = p.mmp; p.dirty = 1;
      bc(p.map, { t: 'fx', k: 'lvup', x: p.x, y: p.y, c: '#ff8cff' }); announce(`🌟 ${p.name}님이 [${J.n}] 직업으로 전직했어요!`); break;
    }
    case 'pk': pkMsg(p, m); break;
    case 'adm': if (p.admin) adminCmd(p, m); break;
    case 'raid': raidOp(p, String(m.id), String(m.op)); break;
  }
}
wss.on('connection', ws => {
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    try { if (m.t === 'login') { if (!ws.pid) login(ws, m); } else { const p = players.get(ws.pid); if (p) onMsg(p, m); } } catch (e) { console.error(e); }
  });
  ws.on('close', () => { const p = players.get(ws.pid); if (!p) return; const g = games.get(p.id); if (g) endGame(g, p.name + '님이 나갔어요'); for (const k in RAIDS) RAIDS[k].mem.delete(p.id); save(p); players.delete(p.id); sendWho(); });
});

/* ===================== 틱 ===================== */
let tk = 0;
function tick() {
  const t = now(); tk++;
  for (const m of Object.values(MAPS)) {
    for (let i = m.mobs.length - 1; i >= 0; i--) {
      const o = m.mobs[i];
      if (o.dead) { if (o.temp) { m.mobs.splice(i, 1); continue; } if (!o.boss && t > o.respawn) spawnMob(m, o); continue; }
      if (o.boss && t > o.until) { m.mobs.splice(i, 1); continue; }
      if (tp0(o).lshEvent && grandmaEvent(m, o, t)) continue;
      if (tp0(o).tameJob && tameCheck(m, o, t)) continue;
      if (tp0(o).talk && t > (o.talkAt || 0) && players.size) { o.talkAt = t + R(2600, 4200); bc(m.id, { t: 'mtalk', id: o.id, m: pick(tp0(o).talk) }); }
      if (t < (o.stun || 0)) continue;
      const slowM = t < (o.slow || 0) ? 2.2 : 1;
      const tp = MON[o.t]; let tg = null, bd = 1e9;
      for (const q of players.values()) if (q.map === m.id && !q.dead && !inSafe(m, q.x, q.y)) { const d = dist(o, q), dd = tp.hate && q.job === tp.hate ? d - 4 : d; if (d <= (o.raid ? 60 : o.tgt === q.id || (tp.hate && q.job === tp.hate) ? 9 : 5) && dd < (tg ? (tp.hate && tg.job === tp.hate ? bd - 4 : bd) : 1e9)) { bd = d; tg = q; } }
      if (tg) {
        if (o.boss && tp.sk && t > o.skAt && bd <= tp.sk.r + 0.5) {
          const k = tp.sk; o.skAt = t + (k.cd ? R(k.cd[0], k.cd[1]) : R(6000, 9000));
          if (tp.stunTalk) { bc(m.id, { t: 'mtalk', id: o.id, m: pick(tp.stunTalk), loud: 1 }); o.talkAt = t + 2500; }
          bc(m.id, { t: 'fx', k: 'ring', x: o.x, y: o.y, r: k.r, c: k.c, f: k.fx, n: k.n, mi: o.id });
          for (const q of players.values()) if (q.map === m.id && !q.dead && !inSafe(m, q.x, q.y) && dist(o, q) <= k.r + 0.42) {
            if (k.stun) { q.stun = t + k.stun; } if (k.slow) q.bf.spd = [0.45, t + k.slow];
            damagePlayer(q, Math.max(1, Math.round((tp.atk * k.m * (0.85 + Math.random() * 0.3) - defOf(q) * 0.4) * (tp.hate && q.job === tp.hate ? tp.hateMul : 1))), null);
          }
          continue;
        }
        if (o.air) continue;
        if (bd - (o.sz || 0) <= (tp.ranged || 1.42)) { if (t > o.atkAt) { o.atkAt = t + (o.boss ? (tp.ranged ? 1500 : 900) : 1200); if (tp.ranged) bc(m.id, { t: 'fx', k: 'proj', x: o.x, y: o.y, x2: tg.x, y2: tg.y, c: tp.c, f: 'tball', big: 1 }); const hm = tp.hate && tg.job === tp.hate ? tp.hateMul : 1; const dmg = Math.max(1, Math.round((tp.atk * (0.8 + Math.random() * 0.4) - defOf(tg) * 0.4) * hm)); damagePlayer(tg, dmg, null); if (tp.drain) o.hp = Math.min(o.mhp, o.hp + Math.round(dmg * tp.drain)); if (hm > 1 && tp.hateTalk && Math.random() < .35) bc(m.id, { t: 'mtalk', id: o.id, m: pick(tp.hateTalk), loud: 1 }); bc(m.id, { t: 'fx', k: 'bite', x: tg.x, y: tg.y, c: '#ff6b6b' }); } }
        else if (!o.still && t > o.mvAt) { o.mvAt = t + (o.raid ? 700 : o.boss ? 320 : 480) * slowM; const dx = tg.x - o.x, dy = tg.y - o.y; const o1 = Math.abs(dx) > Math.abs(dy) ? [[Math.sign(dx), 0], [0, Math.sign(dy)]] : [[0, Math.sign(dy)], [Math.sign(dx), 0]]; for (const [a, b] of o1) { if (!a && !b) continue; const nx = o.x + a, ny = o.y + b; if (walk(m, nx, ny) && !occ(m, nx, ny, o) && !inSafe(m, nx, ny)) { o.x = nx; o.y = ny; break; } } }
      } else if (t > o.mvAt && Math.random() < 0.04) {
        o.mvAt = t + 600; const d = R(0, 3); let nx = o.x + DX[d], ny = o.y + DY[d]; if (Math.abs(nx - o.hx) > 8 || Math.abs(ny - o.hy) > 8) { nx = o.x + Math.sign(o.hx - o.x); ny = o.y; }
        if (walk(m, nx, ny) && !occ(m, nx, ny, o) && !inSafe(m, nx, ny)) { o.x = nx; o.y = ny; }
        if (o.hp < o.mhp) o.hp = Math.min(o.mhp, o.hp + Math.ceil(o.mhp * 0.05));
      }
    }
    for (let i = m.ground.length - 1; i >= 0; i--) if (t > m.ground[i].exp) m.ground.splice(i, 1);
    if (tk % 600 === 0 && m.boss && !m.mobs.some(o => o.boss && !o.dead) && Math.random() < 1 / 60) spawnBoss(m); // 약 1시간에 1번 (1분마다 1/60)
    const ps = []; for (const p of players.values()) if (p.map === m.id && !p.dead) ps.push(pubP(p));
    if (ps.length) bc(m.id, { t: 'st', p: ps, m: m.mobs.filter(o => !o.dead).map(o => [o.id, o.t, o.x, o.y, o.hp, o.mhp, o.v, o.acc, (t < (o.stun || 0) ? 1 : 0) | (t < (o.slow || 0) ? 2 : 0) | (o.drunk ? 4 : 0) | (o.air ? 8 : 0) | (o.inv ? 16 : 0) | (o.groggy > t ? 32 : 0)]), g: m.ground.map(g => [g.id, g.x, g.y, isEq(g.it) ? g.it.r : 0, itemLabel(g.it), t < g.ownT ? g.own : 0, g.it.type === 'gold' ? 1 : isEq(g.it) ? 2 : 0]) });
  }
  if (tk % 20 === 0) for (const p of players.values()) if (!p.dead) { const k = MAPS[p.map].regen; p.hp = Math.min(p.mhp, p.hp + Math.ceil(p.mhp * 0.02 * k)); p.mp = Math.min(p.mmp, p.mp + Math.ceil(p.mmp * 0.04 * k)); p.vdirty = 1; }
  for (const p of players.values()) {
    if (p.dirty) { p.dirty = 0; send(p, mePayload(p)); }
    if (p.vdirty && tk % 3 === 0) { p.vdirty = 0; send(p, { t: 'v', hp: p.hp, mhp: p.mhp, mp: p.mp, mmp: p.mmp, exp: p.exp, need: need(p.lv), lv: p.lv, gold: p.gold }); }
  }
  raidTick(t); royaleTick(t);
  if (tk % 50 === 0) sendWho();
  if (tk % 300 === 0) flush();
}
const bye = async () => { saving = false; await flush(); process.exit(0); };
process.on('SIGTERM', bye); process.on('SIGINT', bye);
dbInit().catch(e => { console.error('DB 연결 실패:', e.message); process.exit(1); }).then(() => {
  setInterval(tick, 100);
  server.listen(PORT, () => console.log('부천 RPG 서버 시작: http://localhost:' + PORT));
});
