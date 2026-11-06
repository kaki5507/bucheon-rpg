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
  { n: '대형 냉동참치', s: 'tuna', r: 1, a: 26, cd: 800, aoe: 3 },
  { n: '좀비 소환 지팡이', s: 'zstaff', r: 4, a: 20, cd: 600, zsum: 1 },
  { n: '황룡의 천검', s: 'hwang', r: 1, a: 42, cd: 650, aoe: 2 }]; // 황룡 처치 전용 // 좀비 습격 1위 전용 // 마지막(냉동참치)은 드랍 X, 냉동참치 보스 전용
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
// ===== 부천역 이후 신규 사냥터/던전 (Lv32~100): 레벨로 능력치 자동 계산 =====
const mStat = lv => ({ hp: Math.round(2.4 * lv * lv * (1 + (lv - 30) / 60)), atk: Math.round(3.3 * lv * (1 + (lv - 30) / 70)), xp: Math.round(28 * lv * (1 + (lv - 30) / 30)), g: Math.round(9 * lv) });
const NEWMON = [ // id, 이름, 모양, 색, lv, 재료, 보스
  // 부천역 (Lv32~39)
  ['s_card', '교통카드 요정', 'paper', '#4dabf7', 32, '교통카드'], ['s_pigeon', '역전 비둘기', 'bird', '#868e96', 33, '회색 깃털'], ['s_busker', '버스킹 유령', 'ghost', '#f783ac', 34, '기타 피크'],
  ['s_gate', '개찰구 골렘', 'golem', '#adb5bd', 35, '개찰구 부품'], ['s_late', '지각쟁이 그림자', 'ghost', '#343a40', 36, '지각 사유서'], ['s_rat', '선로 쥐', 'rat', '#495057', 37, '녹슨 볼트'],
  ['s_lasttrain', '1호선 막차골렘', 'golem', '#1c7ed6', 39, '막차 표지판', 1], ['s_pigeonking', '역전 비둘기왕', 'bird', '#dee2e6', 38, '비둘기왕의 왕관', 1],
  // 부천 자유시장 (Lv38~45)
  ['m_tteok', '떡볶이 슬라임', 'blob', '#fa5252', 38, '떡볶이 떡'], ['m_sundae', '순대뱀', 'snake', '#5c3d2e', 39, '순대'], ['m_fishcake', '어묵꼬치몬', 'skewer', '#ffd8a8', 40, '어묵'],
  ['m_pepper', '청양고추 귀신', 'pumpkin', '#2f9e44', 41, '청양고추'], ['m_cat', '흥정 고양이', 'cat', '#ffa94d', 42, '시장 영수증'], ['m_hotteok', '호떡 미믹', 'mimic', '#d9480f', 43, '꿀호떡'],
  ['m_tteokking', '떡볶이 대왕', 'blob', '#c92a2a', 45, '매운 소스', 1], ['m_catboss', '시장 고양이 두목', 'cat', '#f08c00', 44, '두목의 방울', 1],
  // 도당산 (Lv44~51)
  ['d_wolf', '산늑대', 'fox', '#868e96', 44, '늑대 이빨'], ['d_treant', '나무정령', 'golem', '#2b8a3e', 45, '정령의 나뭇가지'], ['d_hornet', '장수말벌', 'bee', '#e67700', 46, '말벌 침'],
  ['d_azalea', '철쭉 요정', 'ghost', '#f06595', 47, '철쭉 꽃잎'], ['d_squirrel', '청설모', 'rat', '#5c3d2e', 48, '도토리'], ['d_viper', '살모사', 'snake', '#2b8a3e', 49, '독니'],
  ['d_spirit', '도당산 산신령', 'ghost', '#fff3bf', 51, '산신령의 수염', 1], ['d_oldtree', '천년 고목', 'golem', '#1b4332', 50, '고목의 나이테', 1],
  // 상동호수공원 (Lv50~57)
  ['l_duck', '오리배', 'bird', '#ffd43b', 50, '오리배 페달'], ['l_frog', '호수 개구리', 'blob', '#40c057', 51, '개구리 알'], ['l_carp', '비단잉어', 'whale', '#ff922b', 52, '잉어 비늘'],
  ['l_heron', '백로', 'bird', '#f8f9fa', 53, '백로 깃털'], ['l_lotus', '연꽃 요정', 'mush', '#faa2c1', 54, '연꽃'], ['l_jelly', '호수 해파리', 'ghost', '#99e9f2', 55, '해파리 촉수'],
  ['l_duckking', '거대 오리배', 'bird', '#fab005', 56, '황금 페달', 1], ['l_carpking', '호수의 잉어왕', 'whale', '#e8590c', 57, '잉어왕의 여의주', 1],
  // 🕳️ 던전1 부천역 지하수로 (Lv56~66)
  ['w_sludge', '오물 슬라임', 'blob', '#5c940d', 57, '오물'], ['w_rat', '거대 하수구쥐', 'rat', '#343a40', 58, '하수구쥐 꼬리'], ['w_gator', '하수구 악어', 'dino', '#2f9e44', 60, '악어 가죽'],
  ['w_roach', '왕바퀴', 'spider', '#5c3d2e', 61, '바퀴 더듬이'], ['w_ghost', '물귀신', 'ghost', '#3bc9db', 62, '젖은 머리카락'], ['w_pipe', '파이프 골렘', 'golem', '#868e96', 64, '녹슨 파이프'],
  ['w_ratking', '하수구 쥐왕', 'rat', '#212529', 65, '쥐왕의 왕관', 1], ['w_sludgeking', '오물왕', 'blob', '#2b8a3e', 66, '오물왕의 핵', 1],
  // 🕳️ 던전2 오정 폐공장 (Lv66~76)
  ['f_robot', '고장난 로봇', 'golem', '#74c0fc', 66, '회로 기판'], ['f_gear', '톱니몬', 'clock', '#adb5bd', 67, '톱니바퀴'], ['f_spark', '스파크 정령', 'ghost', '#ffe066', 69, '전기 조각'],
  ['f_drum', '드럼통 미믹', 'mimic', '#1971c2', 70, '드럼통 뚜껑'], ['f_welder', '용접 해골', 'skull', '#ff922b', 72, '용접 마스크'], ['f_oil', '폐유 슬라임', 'blob', '#212529', 74, '폐유'],
  ['f_mecha', '메카 골렘', 'golem', '#e03131', 75, '메카 코어', 1], ['f_foreman', '해골 공장장', 'skull', '#ffd43b', 76, '공장장의 안전모', 1],
  // 🕳️ 던전3 원미산 심층동굴 (Lv76~86)
  ['c_amethyst', '자수정 골렘', 'golem', '#9775fa', 76, '자수정'], ['c_vamp', '흡혈박쥐', 'bat', '#c92a2a', 77, '흡혈 송곳니'], ['c_magma', '마그마 슬라임', 'blob', '#ff6b00', 79, '마그마 조각'],
  ['c_wyrm', '동굴 비룡', 'dragon', '#7048e8', 81, '비룡 비늘'], ['c_banshee', '밴시', 'ghost', '#e599f7', 83, '밴시의 눈물'], ['c_demon', '하급 악마', 'imp', '#862e9c', 84, '악마의 꼬리'],
  ['c_crysdragon', '수정룡', 'dragon', '#3bc9db', 86, '수정룡의 심장', 1], ['c_darkspider', '어둠의 여왕거미', 'spider', '#212529', 85, '어둠의 거미줄', 1],
  // 🕳️ 던전4 심연의 1호선 터널 (Lv86~96)
  ['t_soul', '길 잃은 영혼', 'ghost', '#dee2e6', 86, '영혼 조각'], ['t_knight', '심연 기사', 'skull', '#364fc7', 88, '심연의 갑옷 조각'], ['t_voidimp', '공허 악마', 'imp', '#5f3dc4', 89, '공허의 뿔'],
  ['t_bonedragon', '해골룡', 'dragon', '#ced4da', 91, '용의 뼈'], ['t_rail', '철로 골렘', 'golem', '#343a40', 93, '철로 조각'], ['t_shade', '그림자 군주', 'ghost', '#212529', 94, '군주의 그림자'],
  ['t_ghosttrain', '유령 막차', 'mimic', '#1c7ed6', 95, '유령 승차권', 1], ['t_abyssking', '심연의 기사왕', 'skull', '#e03131', 96, '기사왕의 검', 1],
  // 🕳️ 던전5 마왕성 (Lv95~100)
  ['x_archdemon', '대악마', 'imp', '#c92a2a', 95, '대악마의 뿔'], ['x_deathknight', '데스나이트', 'skull', '#212529', 96, '죽음의 투구'], ['x_hellhound', '지옥견', 'fox', '#e03131', 97, '지옥견의 불꽃'],
  ['x_lich', '고대 리치', 'skull', '#9775fa', 98, '리치의 성물'], ['x_hellfire', '지옥불 정령', 'ghost', '#ff6b00', 99, '지옥불'], ['x_blackdragon', '흑룡', 'dragon', '#343a40', 100, '흑룡의 비늘'],
  ['x_demonking', '부천 마왕', 'statue', '#5f3dc4', 100, '마왕의 왕관', 1], ['x_doomdragon', '멸망의 흑룡', 'dragon', '#141414', 100, '멸망의 여의주', 1],
  // 🕳️ 던전6 아트벙커 B39 (Lv100~108)
  ['b_drone', '감시 드론', 'bat', '#adb5bd', 100, '드론 프로펠러'], ['b_tank', '폐연료 탱크골렘', 'golem', '#5c940d', 101, '연료 찌꺼기'], ['b_art', '살아난 설치미술', 'paper', '#f783ac', 102, '캔버스 조각'],
  ['b_echo', '메아리 유령', 'ghost', '#748ffc', 104, '메아리 조각'], ['b_rust', '녹슨 경비로봇', 'golem', '#c2410c', 105, '녹슨 배지'], ['b_shadow', '벙커의 그림자', 'ghost', '#1a1a1a', 107, '어둠 응축물'],
  ['b_curator', '광기의 큐레이터', 'skull', '#be4bdb', 108, '큐레이터의 열쇠', 1], ['b_furnace', '소각로 거인', 'golem', '#e8590c', 107, '소각로의 불씨', 1],
  // 🕳️ 던전7 한국만화박물관 이세계 (Lv108~117)
  ['k_ink', '먹물 슬라임', 'blob', '#212529', 108, '먹물 방울'], ['k_panel', '컷툰 골렘', 'golem', '#f8f9fa', 110, '말풍선 조각'], ['k_villain', '악당 졸개', 'imp', '#7048e8', 111, '졸개 가면'],
  ['k_hero', '타락한 히어로', 'skull', '#1971c2', 113, '찢어진 망토'], ['k_dragon', '만화 용', 'dragon', '#fd7e14', 115, '스크린톤'], ['k_ghost', '미완성 원고 귀신', 'paper', '#ced4da', 116, '미완성 원고'],
  ['k_boss', '최종화 대마왕', 'statue', '#e64980', 117, '최종화 원고', 1], ['k_editor', '마감 귀신 편집장', 'ghost', '#ff6b6b', 116, '마감 독촉장', 1],
  // 🕳️ 던전8 성주산 고대유적 (Lv117~130)
  ['y_golem', '고대 석상', 'golem', '#868e96', 117, '고대 석판'], ['y_spirit', '유적 정령', 'ghost', '#20c997', 119, '정령석'], ['y_snake', '고대 뱀', 'snake', '#2b8a3e', 121, '고대 뱀비늘'],
  ['y_knight', '망자의 기사', 'skull', '#5c7cfa', 123, '망자의 검'], ['y_wyvern', '유적 와이번', 'dragon', '#495057', 126, '와이번 발톱'], ['y_mimic', '고대 보물상자', 'mimic', '#fab005', 128, '고대 금화'],
  ['y_king', '유적의 왕', 'statue', '#20c997', 130, '유적의 왕관', 1], ['y_titan', '성주산 타이탄', 'golem', '#343a40', 129, '타이탄의 심장', 1],
  // 🕳️ 던전9 부천종합운동장 지하 (Lv130~145)
  ['u_ball', '폭주 축구공', 'blob', '#f8f9fa', 130, '찢어진 축구공'], ['u_hooligan', '훌리건 유령', 'ghost', '#e03131', 133, '응원 깃발'], ['u_mascot', '광기의 마스코트', 'bunny', '#ffd43b', 136, '마스코트 탈'],
  ['u_referee', '심판 해골', 'skull', '#212529', 139, '레드카드'], ['u_turf', '인조잔디 골렘', 'golem', '#2f9e44', 142, '인조잔디'], ['u_drone', '중계 드론', 'bat', '#4dabf7', 144, '중계 카메라'],
  ['u_coach', '지옥의 감독', 'statue', '#1971c2', 146, '감독의 호루라기', 1], ['u_striker', '불꽃 스트라이커', 'golem', '#ff6b00', 145, '황금 축구화', 1],
  // 🕳️ 던전10 웅진플레이도시 심해 (Lv145~160)
  ['a_shark', '워터슬라이드 상어', 'whale', '#495057', 145, '상어 이빨'], ['a_tube', '저주받은 튜브', 'blob', '#ff8787', 148, '튜브 조각'], ['a_eel', '심해 뱀장어', 'snake', '#364fc7', 151, '전기 비늘'],
  ['a_jelly', '심연 해파리', 'ghost', '#cc5de8', 154, '심연 촉수'], ['a_crab', '강철 킹크랩', 'crab', '#c92a2a', 157, '강철 집게'], ['a_angler', '아귀 괴물', 'mimic', '#212529', 159, '아귀 등불'],
  ['a_kraken2', '파도풀의 군주', 'kraken', '#1864ab', 161, '파도풀의 진주', 1], ['a_leviathan', '리바이어던', 'dragon', '#0b7285', 160, '리바이어던 비늘', 1],
  // 🕳️ 던전11 중앙공원 시간의 틈 (Lv160~180)
  ['v_clock', '뒤틀린 시계', 'clock', '#9775fa', 160, '부서진 초침'], ['v_echo', '과거의 메아리', 'ghost', '#adb5bd', 164, '메아리 결정'], ['v_paradox', '역설의 골렘', 'golem', '#7048e8', 168, '역설 조각'],
  ['v_knight', '시간 기사', 'skull', '#5f3dc4', 172, '시간의 갑옷'], ['v_wyrm', '차원 비룡', 'dragon', '#be4bdb', 176, '차원 비늘'], ['v_eye', '감시자의 눈', 'imp', '#f03e3e', 179, '감시자의 눈알'],
  ['v_keeper', '시간의 파수꾼', 'statue', '#845ef7', 181, '파수꾼의 모래시계', 1], ['v_chronos', '크로노스', 'golem', '#3b5bdb', 180, '크로노스의 심장', 1],
  // 🕳️ 던전12 부천 대지옥 (Lv180~200)
  ['h_imp', '지옥 도깨비', 'imp', '#e03131', 180, '도깨비 방망이'], ['h_hound', '케르베로스', 'fox', '#1a1a1a', 184, '지옥견 송곳니'], ['h_lava', '용암 거인', 'golem', '#ff6b00', 188, '지옥 용암'],
  ['h_reaper', '저승사자', 'skull', '#141414', 192, '저승 명부'], ['h_bat', '지옥 박쥐왕', 'bat', '#862e9c', 196, '지옥 날개'], ['h_dragon', '지옥룡', 'dragon', '#c92a2a', 199, '지옥룡의 뿔'],
  ['h_yeomra', '염라대왕', 'statue', '#c92a2a', 202, '염라의 판결문', 1], ['h_satan', '부천 대마왕', 'statue', '#141414', 200, '대마왕의 심장', 1]
];
for (const [id, n, s, c, lv, mat, boss] of NEWMON) { const st = mStat(lv); MON.push({ idx: MON.length, id, n, s, c, lv, mat, boss: boss ? 1 : 0, hp: boss ? st.hp * 22 : st.hp, atk: boss ? Math.round(st.atk * 1.5) : st.atk, xp: boss ? st.xp * 30 : st.xp, g: boss ? st.g * 25 : st.g, big: boss ? (s === 'statue' ? 3.6 : 2.6) : undefined }); }
// 좀비 습격 이벤트 전용 (능력치는 맵 레벨에 맞춰 소환할 때 정해짐)
for (const [id, n, c, big] of [['zoffice', '좀비 직장인', '#8ce99a', 2.1], ['zdrunk', '좀비 술꾼', '#a9e34b', 2.1], ['zgym', '좀비 헬창', '#69db7c', 2.4], ['zstudent', '좀비 학생', '#b2f2bb', 2.0], ['zking', '좀비 킹', '#2b8a3e', 3.2]])
  MON.push({ idx: MON.length, id, n, s: 'zombie', c, lv: 1, mat: '썩은 붕대', boss: 1, hp: 5000, atk: 60, xp: 0, g: 0, zev: 1, big, novar: 1 });
// 신전 수호병 (미로)
for (const [id, n, sh, c] of [['g_cr', '청룡 수호병', 'dragon', '#1c7ed6'], ['g_bh', '백호 수호병', 'fox', '#e9ecef'], ['g_jj', '주작의 불새', 'bird', '#ff6b6b'], ['g_hm', '현무 거북병', 'turtle', '#0b7285']]) { const st = mStat(88); MON.push({ idx: MON.length, id, n, s: sh, c, lv: 88, mat: '', boss: 0, hp: st.hp * 3, atk: Math.round(st.atk * 1.3), xp: 0, g: 0, guard: 1 }); }
// 4신수 (체력은 소환할 때 '현재 레벨 1위'가 혼자 30분 때려야 잡히게 자동 계산)
const BEASTS = {
  t1: { id: 'cheongryong', n: '청룡', s: 'dragon', c: '#1c7ed6', mat: '청룡의 여의주', gb: 'cr', e: '🐉', guard: 'g_cr', theme: 'temple1', buff: '청룡의 가호 (공격력 +12%)' },
  t2: { id: 'baekho', n: '백호', s: 'fox', c: '#f8f9fa', mat: '백호의 송곳니', gb: 'bh', e: '🐯', guard: 'g_bh', theme: 'temple2', buff: '백호의 가호 (이동속도 +10%, 치명타 +10%)' },
  t3: { id: 'jujak', n: '주작', s: 'bird', c: '#e03131', mat: '주작의 깃털', gb: 'jj', e: '🔥', guard: 'g_jj', theme: 'temple3', buff: '주작의 가호 (최대 HP +10%, 회복 2배)' },
  t4: { id: 'hyeonmu', n: '현무', s: 'turtle', c: '#343a40', mat: '현무의 등껍질', gb: 'hm', e: '🐢', guard: 'g_hm', theme: 'temple4', buff: '현무의 가호 (방어력 +25%)' }
};
const GBN = Object.fromEntries(Object.values(BEASTS).map(B => [B.gb, B]));
for (const B of Object.values(BEASTS)) MON.push({ idx: MON.length, id: B.id, n: B.n, s: B.s, c: B.c, lv: 100, mat: B.mat, boss: 1, hp: 1e7, atk: 1100, xp: 0, g: 0, gbeast: 1, big: 5.2, novar: 1 });
MON.push({ idx: MON.length, id: 'hwang', n: '황룡', s: 'dragon', c: '#fab005', lv: 120, mat: '황룡의 비늘', boss: 1, hp: 1e9, atk: 2200, xp: 50000000, g: 400000, hwang: 1, big: 7, novar: 1 });
MON.push({ idx: MON.length, id: 'santa', n: '산타', s: 'santa', c: '#e03131', lv: 85, mat: '산타의 선물', boss: 1, hp: 1800000, atk: 650, xp: 0, g: 0, big: 4.2, novar: 1 });
MON.push({ idx: MON.length, id: 'rudolph', n: '루돌프', s: 'rudolph', c: '#8d5a3b', lv: 82, mat: '', boss: 1, hp: 40000, atk: 480, xp: 0, g: 0, big: 2.2, novar: 1 });
// 흑철 군단장 카르곤 (Lv90 레이드) + 순서 구슬 + 대각선 수정
MON.push({ idx: MON.length, id: 'kargon', n: '흑철 군단장 카르곤', s: 'warlord', c: '#495057', lv: 92, mat: '군단장의 뿔', boss: 1, hp: 4000000, atk: 900, xp: 0, g: 0, big: 4.6, novar: 1 });
for (let i = 1; i <= 4; i++) MON.push({ idx: MON.length, id: 'kg_o' + i, n: '①②③④'[i - 1], s: 'orb', c: ['#ff6b6b', '#4dabf7', '#51cf66', '#ffd43b'][i - 1], lv: 90, mat: '', boss: 1, hp: 150000, atk: 0, xp: 0, g: 0, big: 2, novar: 1 });
MON.push({ idx: MON.length, id: 'kg_cl', n: '빛나는 수정', s: 'crystal', c: '#ffd43b', lv: 90, mat: '', boss: 1, hp: 220000, atk: 0, xp: 0, g: 0, big: 2.4, novar: 1 });
MON.push({ idx: MON.length, id: 'kg_cd', n: '어두운 수정', s: 'crystal', c: '#5f3dc4', lv: 90, mat: '', boss: 1, hp: 220000, atk: 0, xp: 0, g: 0, big: 2.4, novar: 1 });
// 🐸 황금떡두꺼비 군단 (매일 오후 8시 이벤트)
MON.push({ idx: MON.length, id: 'goldtoad', n: '대왕 황금떡두꺼비', s: 'toad', c: '#fab005', lv: 100, mat: '황금 떡', boss: 1, hp: 1e7, atk: 950, xp: 30000000, g: 200000, big: 4.4, novar: 1, gtoad: 1 });
MON.push({ idx: MON.length, id: 'toadling', n: '황금떡두꺼비 졸개', s: 'toad', c: '#ffd43b', lv: 90, mat: '황금 떡', boss: 1, hp: 60000, atk: 650, xp: 400000, g: 20000, big: 1.7, novar: 1, gtoad: 1 });
MON.push({ idx: MON.length, id: 'zpet', n: '소환된 좀비', s: 'zombie', c: '#94d82d', lv: 1, mat: '', boss: 0, hp: 1, atk: 0, xp: 0, g: 0, pet: 1 });
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
Object.assign(BSK, {
  s_lasttrain: { n: '막차 돌진', r: 3, m: 1.6, c: '#1c7ed6', stun: 1200 }, s_pigeonking: { n: '구구 폭격', r: 3.2, m: 1.4, c: '#dee2e6', slow: 3000 },
  m_tteokking: { n: '매운맛 폭발', r: 3.5, m: 1.6, c: '#ff6b6b', slow: 3500 }, m_catboss: { n: '냥냥펀치 난타', r: 2.8, m: 1.7, c: '#f08c00', stun: 900 },
  d_spirit: { n: '철쭉 폭풍', r: 4, m: 1.5, c: '#f06595', slow: 4000 }, d_oldtree: { n: '뿌리 속박', r: 3.5, m: 1.6, c: '#2b8a3e', stun: 1400 },
  l_duckking: { n: '오리배 박치기', r: 3, m: 1.7, c: '#fab005', stun: 1000 }, l_carpking: { n: '물대포', r: 4, m: 1.5, c: '#4dabf7', slow: 3500 },
  w_ratking: { n: '쥐떼 습격', r: 3.5, m: 1.6, c: '#495057', slow: 3000 }, w_sludgeking: { n: '오물 폭발', r: 4, m: 1.6, c: '#5c940d', slow: 4000 },
  f_mecha: { n: '로켓 펀치', r: 3.5, m: 1.8, c: '#e03131', stun: 1300 }, f_foreman: { n: '안전제일 호통', r: 4, m: 1.5, c: '#ffd43b', stun: 1600 },
  c_crysdragon: { n: '수정 브레스', r: 4.2, m: 1.8, c: '#3bc9db', slow: 4000 }, c_darkspider: { n: '어둠의 거미줄', r: 4, m: 1.6, c: '#495057', stun: 1400 },
  t_ghosttrain: { n: '유령 경적', r: 4.5, m: 1.6, c: '#74c0fc', stun: 1500 }, t_abyssking: { n: '심연 베기', r: 3.8, m: 1.9, c: '#e03131', stun: 1200 },
  x_demonking: { n: '마왕의 심판', r: 5, m: 1.9, c: '#7048e8', stun: 1600 }, x_doomdragon: { n: '멸망의 숨결', r: 5, m: 2, c: '#212529', slow: 5000 },
  zoffice: { n: '야근 할퀴기', r: 2.2, m: 1.3, c: '#69db7c', slow: 2500, cd: [6000, 9000] }, zdrunk: { n: '썩은 숨결', r: 2.5, m: 1.2, c: '#a9e34b', slow: 3000, cd: [6000, 9000] },
  zgym: { n: '좀비 데드리프트', r: 2.4, m: 1.5, c: '#69db7c', stun: 800, cd: [7000, 10000] }, zstudent: { n: '물어뜯기', r: 2, m: 1.3, c: '#b2f2bb', cd: [5000, 8000] },
  zking: { n: '좀비 떼 함성', r: 3.6, m: 1.5, c: '#2b8a3e', stun: 1200, cd: [5000, 7000] }
});
Object.assign(BSK, {
  b_curator: { n: '광기의 전시', r: 4, m: 1.8, c: '#be4bdb', stun: 1400 }, b_furnace: { n: '소각로 폭발', r: 4.5, m: 1.9, c: '#e8590c', slow: 4000 },
  k_boss: { n: '최종화 필살기', r: 5, m: 2, c: '#e64980', stun: 1500 }, k_editor: { n: '마감 독촉', r: 4.5, m: 1.7, c: '#ff6b6b', stun: 1800 },
  y_king: { n: '고대의 심판', r: 5, m: 2.1, c: '#20c997', stun: 1600 }, y_titan: { n: '대지 붕괴', r: 5, m: 2.1, c: '#343a40', slow: 5000 },
  goldtoad: { n: '황금 떡 폭탄', r: 3.6, m: 1.5, c: '#fab005', stun: 1200, cd: [4000, 6000] }, toadling: { n: '혀 날름', r: 2, m: 1.3, c: '#ffd43b', cd: [5000, 8000] },
  u_coach: { n: '지옥 훈련', r: 5, m: 2.2, c: '#1971c2', stun: 1600 }, u_striker: { n: '불꽃 슛', r: 5, m: 2.3, c: '#ff6b00', slow: 5000 },
  a_kraken2: { n: '대해일', r: 6, m: 2.3, c: '#1864ab', stun: 1500 }, a_leviathan: { n: '심해의 포효', r: 5.5, m: 2.4, c: '#0b7285', slow: 5000 },
  v_keeper: { n: '시간 정지', r: 6, m: 2.2, c: '#845ef7', stun: 2200 }, v_chronos: { n: '시간 붕괴', r: 5.5, m: 2.5, c: '#3b5bdb', slow: 6000 },
  h_yeomra: { n: '염라의 심판', r: 6, m: 2.6, c: '#c92a2a', stun: 2000 }, h_satan: { n: '대마왕의 지옥불', r: 6.5, m: 2.7, c: '#141414', slow: 6000 },
  hwang: { n: '황금 용의 숨결', r: 6, m: 1.6, c: '#fab005', stun: 1500, fx: 'charm', cd: [3500, 5000] }
});
for (const k in BSK) MI[k].sk = BSK[k];
for (const k of ['kargon', 'kg_o1', 'kg_o2', 'kg_o3', 'kg_o4', 'kg_cl', 'kg_cd', 'g_cr', 'g_bh', 'g_jj', 'g_hm', 'cheongryong', 'baekho', 'jujak', 'hyeonmu', 'santa', 'rudolph']) MI[k].raid = 1;
Object.assign(MI.hwang, {
  spawnMsg: '🐲✨ [{map}]에 황룡이 강림했다!! 하늘이 황금빛으로 물든다…',
  talk: ['감히… 사방신을 꺾은 자들이냐.', '나는 중앙의 황룡이다.', '네 칼이 곧 너를 벨 것이다.', '황금의 비늘은 꺾이지 않는다…', '더 많은 용사를 데려와라… 그래야 겨우 상대가 되겠지.'],
  stunTalk: ['황금빛에 타올라라!!', '오행이 내 안에 있다!!'], deathLine: '…중앙이… 무너지는가…'
});
MI.goldtoad.talk = ['개굴… 개굴… 황금떡 맛 좀 볼래?', '내 문제를 맞혀봐라 개굴!!', '떡두꺼비 같은 아들 딸들아~ 개굴!', '개구울!! 나는 무적이다!!', '퀴즈 못 맞히면 다 깔아뭉갠다 개굴!'];
MI.goldtoad.stunTalk = ['떡방아 쿵!!', '개구우우울!!']; MI.goldtoad.deathLine = '개굴… 떡이… 다 쉬어버렸다…';
MI.toadling.talk = ['개굴!', '개굴개굴!', '(황금떡 냠냠)', '대왕님을 지켜라 개굴!'];
MI.santa.talk = ['호호호~ 나쁜 아이 명단 확인 중…', '선물은 착한 아이에게만!!', '루돌프! 돌진!!', '굴뚝으로 들어가주마~ 호호호!', '메리 크리스마스… 석탄이나 받아라!'];
MI.rudolph.talk = ['(코가 반짝반짝)', '푸르릉!!', '산타 할아버지 지켜!!'];
const ZTALK = ['으어어어…', '뇌… 뇌를 줘…', '그르르르…', '출근… 하기… 싫어…', '으아아…', '배고파…', '크르르…'];
for (const k of ['zoffice', 'zdrunk', 'zgym', 'zstudent', 'zking']) Object.assign(MI[k], { talk: ZTALK });
MI.zking.stunTalk = ['모두 물어뜯어라!!', '으아아아아아!!']; MI.zking.talk = ['나는… 좀비의… 왕이다…', '모두… 좀비로… 만들어주마…', '으어어어어어!!', '부천은… 이제 좀비 도시다…'];
MI.x_demonking.spawnMsg = '😈 [{map}]에 부천 마왕이 깨어났다!! 레벨 100 용사들이여, 모여라!!';
MI.x_doomdragon.spawnMsg = '🐉 [{map}] 하늘이 검게 물든다… 멸망의 흑룡 강림!!';
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
  temple: { n: '🏛️ 신전 안내인', look: { ar: [3, 5], he: [3, 5], w: [4, 5, 0] }, hi: [] },
  gate90: { n: '🪓 Lv90 군단장 레이드 안내원 (3인↑)', look: { ar: [4, 5], he: [2, 5], w: [6, 5, 0] }, hi: [] },
  gate80: { n: '🎅 Lv80 산타 레이드 안내원', look: { ar: [2, 4], he: [1, 4], w: [1, 4, 0] }, hi: [] },
  station: { n: '부천역 역무원', look: { ar: [3, 2], he: [2, 2] }, hi: ['부천역입니다~ 오른쪽은 자유시장, 아래는 지하수로 던전이에요.', '지하로 내려갈수록 아주 강한 몬스터가 나와요. 레벨 100까지!'] },
  ranger: { n: '도당산 등산객', look: { ar: [1, 1], he: [1, 1] }, hi: ['철쭉 필 때 오면 진짜 예뻐~', '산신령님 화나게 하지 마.'] },
  gatekeeper: { n: '마왕성 문지기', look: { ar: [4, 5], he: [2, 5], w: [7, 5, 0] }, hi: ['이 너머는 마왕성…', '레벨 95 미만은 돌아가라. 진심이다.'] },
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
const MAXLV = 99999; // 사실상 만렙 없음
const need = lv => Math.floor(30 * Math.pow(lv, 1.7) * (lv >= 30 ? 1 + (lv - 29) * 0.12 : 1) * (lv >= 50 ? 1 + (lv - 49) * 0.25 : 1) * (lv >= 100 ? 1 + (lv - 99) * 0.6 : 1)); // Lv30부터 느리게, Lv50부터 더, Lv100부터 훨씬 더 느리게

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
  sauna: { edge: 'S', obs: [['h', .7], ['k', .3]] },
  station: { edge: 'B', obs: [['c', .4], ['k', .35], ['n', .25]] }, market: { edge: 'B', obs: [['p', .5], ['b', .3], ['n', .2]] },
  forest: { edge: 't', obs: [['t', .78], ['r', .22]] }, lake: { edge: 't', obs: [['w', .6], ['t', .3], ['r', .1]] },
  sewer: { edge: '#', obs: [['w', .5], ['#', .3], ['r', .2]] }, factory: { edge: 'G', obs: [['m', .35], ['d', .3], ['k', .35]] },
  tunnel: { edge: '#', obs: [['#', .45], ['r', .55]] },
  arena7: { edge: 'W', obs: [['r', 1]] }, temple1: { edge: 'W', obs: [['r', 1]] }, temple2: { edge: 'W', obs: [['r', 1]] }, temple3: { edge: 'W', obs: [['r', 1]] }, temple4: { edge: 'W', obs: [['r', 1]] }, arena6: { edge: 'W', obs: [['r', 1]] },
  stadium: { edge: 'G', obs: [['k', .5], ['c', .5]] }, abyss: { edge: 'W', obs: [['w', .6], ['r', .4]] }, void: { edge: 'W', obs: [['c', .4], ['r', .6]] }, inferno: { edge: 'W', obs: [['L', .25], ['r', .75]] },
  bunker: { edge: 'G', obs: [['m', .4], ['k', .3], ['d', .3]] }, comic: { edge: 'H', obs: [['c', .3], ['f', .3], ['k', .4]] }, ruins: { edge: '#', obs: [['c', .45], ['r', .55]] }, castle: { edge: 'W', obs: [['c', .55], ['r', .45]] },                    // 벽, 온탕, 평상
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
  const m = { fastBoss: o.fastBoss || 0, orig: t.map(r => r.slice()), npcs: (o.npcs || []).map(n => ({ id: n.id, x: n.x, y: n.y })), id, name: o.name, w, h, theme, t, portals: o.portals, safes, sl: o.sl || '', pool: o.pool || [], cnt: o.cnt || 0, boss: o.boss || null, mobs: [], ground: [], spawn: o.spawn || { x: 2, y: 15 }, lvr: o.lvr, regen: o.regen || 1 };
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
  portals: [{ x: 26, y: VH - 1, to: 'pub', tx: 4, ty: 17 }, { x: 26, y: 20, to: 'bosshub', tx: 13, ty: 12 }, { x: 0, y: 20, to: 'station', tx: 25, ty: 2 }],
  safes: FK.map(f => ({ x0: VILLAGE[f].x, y0: VILLAGE[f].y, x1: VILLAGE[f].x + 10, y1: VILLAGE[f].y + 7, f, label: '🏠 ' + FAC[f].n + ' 마을' })),
  npcs: FK.flatMap(f => [{ id: 'chief', x: VILLAGE[f].x + 5, y: VILLAGE[f].y + 1 }, { id: 'merchant', x: VILLAGE[f].x + 8, y: VILLAGE[f].y + 3 }]),
  pool: ['slime', 'bunny', 'mush', 'bee', 'crab', 'cat', 'pigeon'], cnt: 55, boss: ['kingslime', 'bunnyking', 'babpuli', 'babpuli']
});
// 보스 대기실 + 레이드 맵 (한 번에 한 팀만)
mk('bosshub', {
  name: '⚔️ 보스 대기실', w: 27, h: 16, theme: 'altar', seed: 5, dens: 0, lvr: '레이드',
  portals: [{ x: 13, y: 15, to: 'bucheon', tx: 26, ty: 22 }], safes: [{ all: 1, label: '⚔️ 보스 대기실 · 안내원에게 말 걸어 레이드 참여' }], spawn: { x: 13, y: 12 },
  npcs: [{ id: 'temple', x: 3, y: 10 }, { id: 'gate80', x: 23, y: 10 }, { id: 'gate90', x: 8, y: 11 }, { id: 'gate10', x: 4, y: 5 }, { id: 'gate30', x: 9, y: 4 }, { id: 'gate40', x: 13, y: 3 }, { id: 'gate50', x: 17, y: 4 }, { id: 'gate70', x: 22, y: 5 }]
});
for (const [id, nm, w, h, th] of [['raid1', '🍄 버섯브로콜리 레이드', 30, 20, 'arena1'], ['raid2', '🦖 티라노 레이드', 32, 22, 'arena2'], ['raid3', '🗿 석상왕 레이드', 34, 24, 'arena3'], ['raid4', '🐙 심연의 문어왕 레이드', 34, 24, 'arena4'], ['raid5', '🕰️ 시계탑 마왕 레이드', 36, 26, 'arena5'], ['raid6', '🎅 산타 레이드', 34, 24, 'arena6'], ['raid7', '🪓 흑철 군단장 레이드', 36, 26, 'arena7']])
  mk(id, { name: nm, w, h, theme: th, seed: 9, dens: 0, lvr: '레이드', portals: [{ x: 0, y: h - 3, to: 'bosshub', tx: 13, ty: 12 }], spawn: { x: w >> 1, y: h - 3 } });
for (const [k, B] of Object.entries(BEASTS)) mk('temple' + k.slice(1), { name: `${B.e} ${B.n} 신전`, w: 41, h: 33, theme: B.theme, seed: 11, dens: 0, lvr: '신전', portals: [{ x: 0, y: 31, to: 'bosshub', tx: 13, ty: 12 }], spawn: { x: 1, y: 31 } });
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
  portals: [{ x: 0, y: 15, to: 'cave1', tx: 47, ty: 15 }, { x: 49, y: 15, to: 'station', tx: 2, ty: 15 }],
  pool: ['imp', 'shadow', 'dragonling', 'lavagolem', 'darkknight', 'mimic'], cnt: 40, boss: ['dragonboss', 'lich', 'hwiseok', 'hwiseok']
});
// ===== 부천역 ~ 마왕성 (Lv32~100) =====
const SZM = (cy, extra) => [{ id: 'merchant', x: 6, y: cy + 2 }, ...(extra || [])];
mk('station', {
  name: '🚉 부천역', w: 50, h: 30, theme: 'station', seed: 301, dens: .07, lvr: '32~39', npcs: SZM(15, [{ id: 'station', x: 4, y: 13 }]), safes: SZ(15), spawn: { x: 4, y: 15 },
  portals: [{ x: 0, y: 15, to: 'cave2', tx: 47, ty: 15 }, { x: 49, y: 15, to: 'market', tx: 2, ty: 15 }, { x: 25, y: 0, to: 'bucheon', tx: 2, ty: 20 }, { x: 25, y: 29, to: 'sewer', tx: 2, ty: 15 }],
  pool: ['s_card', 's_pigeon', 's_busker', 's_gate', 's_late', 's_rat'], cnt: 42, boss: ['s_lasttrain', 's_pigeonking']
});
mk('market', {
  name: '🛍️ 부천 자유시장', w: 50, h: 30, theme: 'market', seed: 302, dens: .08, lvr: '38~45', npcs: SZM(15), safes: SZ(15), spawn: { x: 4, y: 15 },
  portals: [{ x: 0, y: 15, to: 'station', tx: 47, ty: 15 }, { x: 49, y: 15, to: 'dodang', tx: 2, ty: 15 }],
  pool: ['m_tteok', 'm_sundae', 'm_fishcake', 'm_pepper', 'm_cat', 'm_hotteok'], cnt: 42, boss: ['m_tteokking', 'm_catboss']
});
mk('dodang', {
  name: '⛰️ 도당산', w: 50, h: 30, theme: 'forest', seed: 303, dens: .12, lvr: '44~51', npcs: SZM(15, [{ id: 'ranger', x: 4, y: 13 }]), safes: SZ(15), spawn: { x: 4, y: 15 },
  portals: [{ x: 0, y: 15, to: 'market', tx: 47, ty: 15 }, { x: 49, y: 15, to: 'lake', tx: 2, ty: 15 }],
  pool: ['d_wolf', 'd_treant', 'd_hornet', 'd_azalea', 'd_squirrel', 'd_viper'], cnt: 42, boss: ['d_spirit', 'd_oldtree']
});
mk('lake', {
  name: '🦆 상동호수공원', w: 50, h: 30, theme: 'lake', seed: 304, dens: .09, lvr: '50~57', npcs: SZM(15), safes: SZ(15), spawn: { x: 4, y: 15 },
  portals: [{ x: 0, y: 15, to: 'dodang', tx: 47, ty: 15 }],
  pool: ['l_duck', 'l_frog', 'l_carp', 'l_heron', 'l_lotus', 'l_jelly'], cnt: 42, boss: ['l_duckking', 'l_carpking']
});
mk('sewer', {
  name: '🕳️ 부천역 지하수로', w: 50, h: 30, theme: 'sewer', seed: 305, dens: .1, lvr: '56~66', npcs: SZM(15), safes: SZ(15), spawn: { x: 4, y: 15 },
  portals: [{ x: 0, y: 15, to: 'station', tx: 25, ty: 27 }, { x: 49, y: 15, to: 'factory', tx: 2, ty: 15 }],
  pool: ['w_sludge', 'w_rat', 'w_gator', 'w_roach', 'w_ghost', 'w_pipe'], cnt: 40, boss: ['w_ratking', 'w_sludgeking']
});
mk('factory', {
  name: '🏭 오정 폐공장', w: 50, h: 30, theme: 'factory', seed: 306, dens: .09, lvr: '66~76', npcs: SZM(15), safes: SZ(15), spawn: { x: 4, y: 15 },
  portals: [{ x: 0, y: 15, to: 'sewer', tx: 47, ty: 15 }, { x: 49, y: 15, to: 'wonmi', tx: 2, ty: 15 }],
  pool: ['f_robot', 'f_gear', 'f_spark', 'f_drum', 'f_welder', 'f_oil'], cnt: 40, boss: ['f_mecha', 'f_foreman']
});
mk('wonmi', {
  name: '💎 원미산 심층동굴', w: 50, h: 30, theme: 'cave', seed: 307, dens: .14, lvr: '76~86', npcs: SZM(15), safes: SZ(15), spawn: { x: 4, y: 15 },
  portals: [{ x: 0, y: 15, to: 'factory', tx: 47, ty: 15 }, { x: 49, y: 15, to: 'tunnel', tx: 2, ty: 15 }],
  pool: ['c_amethyst', 'c_vamp', 'c_magma', 'c_wyrm', 'c_banshee', 'c_demon'], cnt: 40, boss: ['c_crysdragon', 'c_darkspider']
});
mk('tunnel', {
  name: '🚇 심연의 1호선 터널', w: 50, h: 30, theme: 'tunnel', seed: 308, dens: .1, lvr: '86~96', npcs: SZM(15), safes: SZ(15), spawn: { x: 4, y: 15 },
  portals: [{ x: 0, y: 15, to: 'wonmi', tx: 47, ty: 15 }, { x: 49, y: 15, to: 'castle', tx: 2, ty: 15 }],
  pool: ['t_soul', 't_knight', 't_voidimp', 't_bonedragon', 't_rail', 't_shade'], cnt: 40, boss: ['t_ghosttrain', 't_abyssking']
});
mk('castle', {
  name: '😈 마왕성', w: 50, h: 30, theme: 'castle', seed: 309, dens: .08, lvr: '95~100', npcs: SZM(15, [{ id: 'gatekeeper', x: 4, y: 13 }]), safes: SZ(15), spawn: { x: 4, y: 15 },
  portals: [{ x: 0, y: 15, to: 'tunnel', tx: 47, ty: 15 }, { x: 49, y: 15, to: 'bunker', tx: 2, ty: 15 }],
  pool: ['x_archdemon', 'x_deathknight', 'x_hellhound', 'x_lich', 'x_hellfire', 'x_blackdragon'], cnt: 40, boss: ['x_demonking', 'x_doomdragon']
});
mk('bunker', {
  name: '🎨 아트벙커 B39', w: 50, h: 30, theme: 'bunker', seed: 310, dens: .09, lvr: '100~108', npcs: SZM(15), safes: SZ(15), spawn: { x: 4, y: 15 },
  portals: [{ x: 0, y: 15, to: 'castle', tx: 47, ty: 15 }, { x: 49, y: 15, to: 'comic', tx: 2, ty: 15 }],
  pool: ['b_drone', 'b_tank', 'b_art', 'b_echo', 'b_rust', 'b_shadow'], cnt: 40, boss: ['b_curator', 'b_furnace']
});
mk('comic', {
  name: '📚 만화박물관 이세계', w: 50, h: 30, theme: 'comic', seed: 311, dens: .08, lvr: '108~117', npcs: SZM(15), safes: SZ(15), spawn: { x: 4, y: 15 },
  portals: [{ x: 0, y: 15, to: 'bunker', tx: 47, ty: 15 }, { x: 49, y: 15, to: 'ruins', tx: 2, ty: 15 }],
  pool: ['k_ink', 'k_panel', 'k_villain', 'k_hero', 'k_dragon', 'k_ghost'], cnt: 40, boss: ['k_boss', 'k_editor']
});
mk('ruins', {
  name: '🗿 성주산 고대유적', w: 50, h: 30, theme: 'ruins', seed: 312, dens: .1, lvr: '117~130', npcs: SZM(15), safes: SZ(15), spawn: { x: 4, y: 15 },
  portals: [{ x: 0, y: 15, to: 'comic', tx: 47, ty: 15 }, { x: 49, y: 15, to: 'stadium', tx: 2, ty: 15 }],
  pool: ['y_golem', 'y_spirit', 'y_snake', 'y_knight', 'y_wyvern', 'y_mimic'], cnt: 40, boss: ['y_king', 'y_titan']
});
for (const [id, name, th, lvr, pool, boss, prev, next, seed] of [
  ['stadium', '🏟️ 부천종합운동장 지하', 'stadium', '130~145', ['u_ball', 'u_hooligan', 'u_mascot', 'u_referee', 'u_turf', 'u_drone'], ['u_coach', 'u_striker'], 'ruins', 'abyss', 313],
  ['abyss', '🌊 웅진플레이도시 심해', 'abyss', '145~160', ['a_shark', 'a_tube', 'a_eel', 'a_jelly', 'a_crab', 'a_angler'], ['a_kraken2', 'a_leviathan'], 'stadium', 'void', 314],
  ['void', '🌀 중앙공원 시간의 틈', 'void', '160~180', ['v_clock', 'v_echo', 'v_paradox', 'v_knight', 'v_wyrm', 'v_eye'], ['v_keeper', 'v_chronos'], 'abyss', 'inferno', 315],
  ['inferno', '🔥 부천 대지옥', 'inferno', '180~200+', ['h_imp', 'h_hound', 'h_lava', 'h_reaper', 'h_bat', 'h_dragon'], ['h_yeomra', 'h_satan'], 'void', null, 316]])
  mk(id, { name, w: 50, h: 30, theme: th, seed, dens: .09, lvr, npcs: SZM(15), safes: SZ(15), spawn: { x: 4, y: 15 }, portals: [{ x: 0, y: 15, to: prev, tx: 47, ty: 15 }, ...(next ? [{ x: 49, y: 15, to: next, tx: 2, ty: 15 }] : [])], pool, cnt: 40, boss, fastBoss: 1 });
const inSafe = (m, x, y) => m.safes.some(z => x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1);
const walk = (m, x, y) => x >= 0 && y >= 0 && x < m.w && y < m.h && (m.t[y][x] === '.' || m.t[y][x] === 'L' || m.t[y][x] === 'X');
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
const RECIPES = {
  tuna: { n: '냉동참치 보따리', e: '🐟', c: '#a5d8ff', need: TUNA_RECIPE, gold: TUNA_GOLD, desc: '레이드를 깨면 주는 재료로 만들어요. 사용하면 냉동참치 보스 등장 → 잡으면 대형 냉동참치(광역 평타 무기) 확정!' },
  hwang: { n: '황룡의 부적', e: '🐲', c: '#fab005', need: { '청룡의 여의주': 1, '백호의 송곳니': 1, '주작의 깃털': 1, '현무의 등껍질': 1 }, gold: 5000000, desc: '4신수를 쓰러뜨리고 얻은 재료로 만들어요. 사냥터에서 사용하면 황룡 강림 (4신수보다 100배 강함, 반사 피해!) → 잡으면 황룡의 천검 + 칭호' }
};
function craftItem(p, k) {
  const RC = RECIPES[k]; if (!RC) return;
  const cnt = k2 => (p.inv.find(i => i.type === 'mat' && i.k === k2) || { q: 0 }).q;
  const lack = Object.entries(RC.need).filter(([k2, n]) => cnt(k2) < n).map(([k2, n]) => `${k2} ${cnt(k2)}/${n}`);
  if (lack.length) return say(p, 'sys', '재료가 부족해요: ' + lack.join(', '));
  if (p.gold < RC.gold) return say(p, 'sys', `골드가 부족해요 (${RC.gold.toLocaleString()}G)`);
  for (const [k2, n] of Object.entries(RC.need)) { const it = p.inv.find(i => i.type === 'mat' && i.k === k2); it.q -= n; if (it.q <= 0) p.inv.splice(p.inv.indexOf(it), 1); }
  p.gold -= RC.gold; giveItem(p, stackItem('bundle', k, RC.n, 1)); p.dirty = 1;
  say(p, 'loot', `${RC.e} ${RC.n} 제작 완료! 가방에서 사용하면 그 자리에 보스가 나타나요`, RC.c);
  sendAll({ t: 'notice', m: `${RC.e} ${p.name}님이 ${RC.n}을(를) 만들었다…!`, c: RC.c, big: k === 'hwang' ? 1 : 0 });
}
function useTunaBag(p, it) {
  const m = MAPS[p.map], key = it.k === 'hwang' ? 'hwang' : 'tuna', RC = RECIPES[key];
  if (inSafe(m, p.x, p.y) || !m.pool.length) return say(p, 'sys', `여기서는 ${RC.n}을(를) 쓸 수 없어요 (사냥터에서 사용하세요)`);
  if (Object.values(MAPS).some(mm => mm.mobs.some(o => !o.dead && MON[o.t].id === key))) return say(p, 'sys', `이미 어딘가에 ${MI[key].n}이(가) 있어요!`);
  if (key === 'hwang') {
    if (--it.q <= 0) p.inv.splice(p.inv.indexOf(it), 1); p.dirty = 1;
    const o = spawnBoss(m, 'hwang', p), hp = Math.round(topDps() * 1800 * 100); o.hp = o.mhp = hp; o.until = now() + 3 * 3600000;
    bc(m.id, { t: 'fx', k: 'boom', x: o.x, y: o.y, r: 7, c: '#fab005' }); bc(m.id, { t: 'shake', ms: 1500 });
    sendAll({ t: 'notice', m: `🐲 [${m.name}] ${p.name}님이 황룡의 부적을 태웠다!! 황룡 강림!! (3시간 동안 머무름)`, c: '#fab005', big: 1 });
    return;
  }
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
  p.def = Math.round(p.def * (j.def || 1));
  if (p.lv > 100) p.atk = Math.round(p.atk * (1 + (p.lv - 100) * 0.005)); // Lv100 이후 레벨마다 공격력 +0.5%
  const G = p.gb || {}, SB = p.santa > now() ? 1.15 : 1;
  p.atk = Math.round(p.atk * (G.cr ? 1.12 : 1) * SB); p.def = Math.round(p.def * (G.hm ? 1.25 : 1) * SB); if (G.jj) p.mhp = Math.round(p.mhp * 1.1);
  p.hp = Math.min(p.hp, p.mhp); p.mp = Math.min(p.mp, p.mmp);
}
const defOf = p => p.def * bm(p, 'def');
const atkOf = p => p.atk * bm(p, 'atk');
function mePayload(p) {
  return {
    t: 'me', id: p.id, name: p.name, faction: p.faction, job: p.job, lv: p.lv, exp: p.exp, need: need(p.lv), gold: p.gold, hp: p.hp, mhp: p.mhp, mp: p.mp, mmp: p.mmp,
    atk: p.atk, def: p.def, inv: p.inv, eq: p.eq, q: p.q, qd: p.qd, lock: [...p.lock], mount: p.mount || '', title: p.title || '', gb: p.gb || {}, santa: Math.max(0, (p.santa || 0) - now()), seen: p.seen || {}, admin: p.admin ? { god: p.god ? 1 : 0, onehit: p.onehit ? 1 : 0, fast: p.fast ? 1 : 0 } : 0
  };
}
function pubP(p) {
  const w = p.eq.weapon, a = p.eq.armor, h = p.eq.helm;
  return { i: p.id, n: p.name, f: p.faction, j: p.job, l: p.lv, x: p.x, y: p.y, d: p.d, h: p.hp, H: p.mhp, w: w ? [w.b, w.r, w.plus] : 0, ar: a ? [a.b, a.r] : 0, he: h ? [h.b, h.r] : 0, bb: p.bubT > now() ? p.bub : undefined, ad: p.admin ? 1 : 0, tt: p.title || undefined, iv: p.invUntil > now() ? 1 : undefined, mt: p.mount ? 1 : 0, bf: (bm(p, 'atk') > 1 ? 1 : 0) | (bm(p, 'def') > 1 ? 2 : 0) | (bm(p, 'spd') > 1 ? 4 : 0) | (bm(p, 'spd') < 1 ? 8 : 0) | (p.stun > now() ? 16 : 0) };
}
function mapMsg(m) { return { t: 'map', id: m.id, name: m.name, w: m.w, h: m.h, theme: m.theme, rows: m.t.map(r => r.join('')), portals: m.portals.map(p => ({ x: p.x, y: p.y, n: MAPS[p.to].name })), safes: m.safes, sl: m.sl, lvr: m.lvr, npcs: m.npcs.map(n => ({ id: n.id, x: n.x, y: n.y, n: NPCS[n.id].n, look: NPCS[n.id].look })) }; }
function warp(p, mapId, x, y) {
  const m = MAPS[mapId]; p.map = mapId; p.seen = p.seen || {}; if (!p.seen[mapId]) { p.seen[mapId] = 1; p.dirty = 1; }
  let n = 0; while (occ(m, x, y, p) && n < 20) { x += R(-1, 1); y += R(-1, 1); n++; if (!walk(m, x, y)) { x = m.spawn.x; y = m.spawn.y; } }
  p.x = x; p.y = y; send(p, mapMsg(m));
  if (typeof ZEV !== 'undefined' && ZEV.on && m.pool.length) send(p, { t: 'mood', m: 'zombie' });
  const Rd = Object.values(RAIDS || {}).find(r => r.map === mapId); if (Rd) { send(p, { t: 'mood', m: Rd.mood || '' }); send(p, { t: 'plates', l: (Rd.plates || []).map(q => [q.x, q.y, q.ci, q.on > now() ? 1 : 0]), seq: Rd.seq, i: Rd.seqI || 0, sim: Rd.sim ? 1 : 0, hold: 0 }); }
}
function save(p) {
  const a = db.acc[p.name]; if (!a) return;
  a.ch = { faction: p.faction, job: p.job, lv: p.lv, exp: p.exp, gold: p.gold, inv: p.inv, eq: p.eq, q: p.q, qd: p.qd, qv: p.qv, mount: p.mount || '', title: p.title || '', gb: p.gb || {}, santa: p.santa || 0, seen: p.seen || {}, map: p.map, x: p.x, y: p.y, hp: p.hp, mp: p.mp };
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
  if (!raw) x = Math.round(x * EXPM * (p.santa > now() ? 1.5 : 1));
  p.exp += x;
  while (p.exp >= need(p.lv) && p.lv < MAXLV) {
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
  for (const o of m.mobs) if (!o.dead && !o.ally) res.push({ k: 'm', o });
  if (!inSafe(m, p.x, p.y) && !/^(raid|temple)/.test(m.id)) for (const q of players.values()) if (q.map === p.map && q !== p && !q.dead && q.faction !== p.faction && !inSafe(m, q.x, q.y)) res.push({ k: 'p', o: q });
  return res;
}
function nearest(p, range, list) { let best = null, bd = 1e9; for (const e of list || enemiesOf(p)) { const d = edist(p, e.o); if (d <= range + 0.42 && d < bd) { bd = d; best = e; } } return best; }
function face(p, o) { const dx = o.x - p.x, dy = o.y - p.y; if (Math.abs(dx) > Math.abs(dy)) p.d = dx < 0 ? 1 : 2; else if (dy !== 0) p.d = dy < 0 ? 3 : 0; }
function hit(p, e, mult, s) {
  const t = now();
  if (s && s.stun) e.o.stun = t + (e.k === 'p' ? s.stun * 0.6 : s.stun);
  if (s && s.slow && s.k !== 'adebuff') { if (e.k === 'm') e.o.slow = t + s.slow; else e.o.bf.spd = [0.45, t + s.slow]; }
  if (s && (s.stun || s.slow) && e.k === 'p') e.o.vdirty = 1;
  let dmg = atkOf(p) * mult * (0.85 + Math.random() * 0.3); const crit = Math.random() < (p.gb && p.gb.bh ? 0.2 : 0.1); if (crit) dmg *= 1.6;
  if (e.k === 'm') { dmg = p.onehit ? e.o.hp : Math.max(1, Math.round(dmg - MON[e.o.t].lv * 0.8)); damageMob(p, e.o, dmg, crit); }
  else { dmg = Math.max(1, Math.round(dmg * 0.5 - defOf(e.o) * 0.35)); damagePlayer(e.o, dmg, p, crit); }
}
function damageMob(p, mo, dmg, crit) {
  if (mo.inv) { bc(p.map, { t: 'dm', x: mo.x, y: mo.y, v: mo.shield ? '🛡보호막' : '무적', c: '#74c0fc' }); return; }
  if (mo.kargon) {
    const Rd = RAIDS[mo.raid]; if (Rd) Rd.threat[p.id] = (Rd.threat[p.id] || 0) + dmg;
    if (!(mo.groggy > now())) {
      let rel = Math.atan2(p.y - mo.y, p.x - mo.x) - mo.fa; while (rel > Math.PI) rel -= 2 * Math.PI; while (rel < -Math.PI) rel += 2 * Math.PI;
      if (!p.onehit && (Math.abs(rel) < 2.0 || (p.x === mo.x && p.y === mo.y))) { if (Math.random() < .5) bc(p.map, { t: 'dm', x: mo.x, y: mo.y, v: '🛡 막힘! 뒤를 노려라', c: '#adb5bd' }); return; }
      dmg = Math.round(dmg * .6); crit = true; bc(p.map, { t: 'dm', x: p.x, y: p.y - 1, v: '백어택!', c: '#69db7c' });
      if (Rd && !mo.inv) { Rd.stag = Math.min(100, (Rd.stag || 0) + 2); if (Rd.stag >= 100) { Rd.stag = 0; const gt = Rd.ph >= 4 ? 6000 : 8000; mo.groggy = now() + gt; mo.stun = now() + gt; bc(p.map, { t: 'fx', k: 'boom', x: mo.x, y: mo.y, r: 3, c: '#ffd43b' }); for (const q of rmem(Rd)) send(q, { t: 'notice', m: `💫 무력화 성공!! 카르곤 기절 ${gt / 1000}초 — 사방에서 공격 가능! (피해 1.5배)`, c: '#ffe066', big: 1 }); rTalk(Rd, mo, '크윽…!! 다리가…!!'); } kgStag(Rd); }
    }
  }
  if (mo.gbeast) { const Rd = RAIDS[mo.raid]; if (Rd) dmg = Math.round(dmg * Math.max(1, rAlive(Rd).length)); } // (숨은 기믹) 사람이 많을수록 비례해서 피해 증가
  if (MON[mo.t].hwang) {
    const base = dmg, n = [...players.values()].filter(q => q.map === p.map && !q.dead && dist(q, mo) <= 15).length; dmg = Math.round(dmg * Math.max(1, n));
    if (!p.god) { const back = Math.max(1, Math.min(Math.round(base * 0.25), Math.round(p.mhp * 0.07))); p.hp -= back; p.vdirty = 1; bc(p.map, { t: 'dm', x: p.x, y: p.y, v: '반사 ' + back, c: '#fab005' }); if (p.hp <= 0) { mo.hp -= dmg; die(p, null); return; } }
  }
  if (mo.groggy > now()) { dmg = Math.round(dmg * 1.5); crit = true; }
  mo.hp -= dmg; mo.tgt = p.id; mo.last = p;
  bc(p.map, { t: 'dm', x: mo.x, y: mo.y, v: dmg, c: crit ? '#ffe600' : '#ffffff', cr: crit ? 1 : 0 });
  if (mo.hp <= 0) killMob(p, mo);
}
function damagePlayer(v, dmg, att, crit) {
  if (v.dead) return;
  if (v.god) { bc(v.map, { t: 'dm', x: v.x, y: v.y, v: 0, c: '#adb5bd' }); return; }
  if (v.invUntil > now()) { bc(v.map, { t: 'dm', x: v.x, y: v.y, v: '무적', c: '#ffd43b' }); return; }
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
    const lv0 = v.lv, lossX = Math.floor(need(v.lv) * 0.2), down = loseExp(v, lossX);
    say(v, 'sys', `📉 경험치 -${lossX.toLocaleString()}${down ? ` · 레벨 다운!! Lv.${lv0} → Lv.${v.lv}` : ''}`);
    if (down) { say(att, 'sys', `📉 ${v.name}님의 레벨을 Lv.${lv0} → Lv.${v.lv}로 떨어뜨렸어요!`); sendAll({ t: 'notice', m: `📉 [${FAC[att.faction].n}] ${att.name}님이 [${FAC[v.faction].n}] ${v.name}님을 쓰러뜨려 레벨을 깎았다!! (Lv.${lv0} → Lv.${v.lv})`, c: '#ff8787' }); }
    sendAll({ t: 'kill', a: who(att), v: who(v), map: MAPS[v.map].name, st: att.streak, lost: lost.length, down });
  } else say(v, 'sys', '💀 쓰러졌어요...');
  if (!(att && att.name) || v.map === 'royale') v.exp = Math.max(0, v.exp - Math.floor(need(v.lv) * 0.03)); v.dirty = 1;
  setTimeout(() => { if (!players.has(v.id)) return; v.dead = 0; stats(v); v.hp = v.mhp; v.mp = v.mmp; v.bf = {}; v.stun = 0; const vs = villageSpawn(v.faction); warp(v, vs.map, vs.x, vs.y); v.dirty = 1; }, 3000);
}
// 경험치 잃기: 모자라면 레벨이 내려감 (PvP 사망)
function loseExp(v, amt) {
  let down = 0;
  while (amt > 0) { if (v.exp >= amt) { v.exp -= amt; amt = 0; } else if (v.lv > 1) { amt -= v.exp; v.lv--; down++; v.exp = need(v.lv); } else { v.exp = 0; amt = 0; } }
  if (down) { stats(v); v.vdirty = 1; } v.dirty = 1; return down;
}
// '현재 레벨 1위' 캐릭터의 초당 피해량 추정 (장비 포함, 스킬 감안 1.6배)
function topDps() {
  let best = null;
  for (const [n, a] of Object.entries(db.acc)) { const c = a.ch; if (!c || n === ADMIN) continue; if (!best || c.lv > best.lv || (c.lv === best.lv && c.exp > best.exp)) best = c; }
  for (const p of players.values()) if (!p.admin && (!best || p.lv > best.lv)) best = p;
  if (!best) return 3000;
  const q = { job: JOBS[best.job] ? best.job : 'novice', faction: FAC[best.faction] ? best.faction : 'sangdong', lv: best.lv, eq: best.eq || {}, gb: best.gb, hp: 1, mp: 1 }; stats(q);
  const w = q.eq.weapon, cd = w ? WB[w.b].cd : 500;
  return Math.max(2500, q.atk * 1.06 / (cd / 1000) * 1.6);
}
function killMob(p, mo) {
  const tp = MON[mo.t], m = MAPS[p.map]; mo.dead = 1;
  if (mo.ally) { const i = m.mobs.indexOf(mo); if (i >= 0) m.mobs.splice(i, 1); return; }
  if (mo.zombie) return zombieKill(p, mo, m);
  if (mo.raid) { const i = m.mobs.indexOf(mo); if (i >= 0) m.mobs.splice(i, 1); bc(m.id, { t: 'fx', k: 'die', x: mo.x, y: mo.y, c: tp.c }); raidMobDied(mo, p); return; }
  let xp = tp.xp; if (p.lv > tp.lv + 8) xp *= 0.3; xp = Math.round(xp);
  const gold = Math.round(tp.g * (0.6 + Math.random() * 0.8) * (FAC[p.faction].gold || 1));
  const loot = [mkGold(mo.boss ? gold * 3 : gold)];
  const add = it => loot.push(it);
  if (mo.boss) {
    add(genEquip(tp.lv, true)); if (Math.random() < 0.25) add(genEquip(tp.lv, true));
    add(mkScroll('enh', R(1, 3))); if (Math.random() < 0.3) add(mkScroll('ward', 1)); add(mkPot('hp', R(3, 6))); add(stackItem('mat', tp.mat, tp.mat, R(1, 3)));
    if (Math.random() < 0.01) add(hiddenEquip(pick(['weapon', 'armor', 'helm']), tp.lv));
    if (tp.id === 'goldtoad') gtWin(p, mo, m, add);
    if (tp.id === 'hwang') { add({ id: db.iid++, type: 'weapon', b: 10, r: 5, il: Math.max(100, p.lv), plus: 0, n: '황룡의 천검', atkb: 400, defb: 80, hpb: 1500 }); if (TRANK('hwang') >= TRANK(p.title)) p.title = 'hwang'; sendAll({ t: 'notice', m: `🐲👑 ${p.name}님이 황룡을 쓰러뜨렸다!!! 황룡의 천검 + 칭호 [황룡 토벌자]`, c: '#fab005', big: 1 }); }
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
  if (wb.zsum) summonZombie(p, t);
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
    use(); fx({ k: 'sbuff', x: p.x, y: p.y }); heal(p); buffs(p); if (s.inv) { p.invUntil = t + s.inv; p.vdirty = 1; }
    if (s.selfstun) { p.stun = t + s.selfstun; send(p, { t: 'stun', ms: s.selfstun }); }
  } else if (s.k === 'taunt') {
    use(); fx({ k: 'ring', x: p.x, y: p.y, r: s.r }); const m = MAPS[p.map]; let si = 1;
    for (const e of enemiesOf(p)) {
      if (edist(p, e.o) > s.r + .42) continue; const o = e.o, big = e.k === 'm' && (o.still || (MON[o.t].big || 0) >= 3);
      if (!big) for (; si < SPIRAL.length; si++) { const nx = p.x + SPIRAL[si][0], ny = p.y + SPIRAL[si][1]; if (walk(m, nx, ny) && !(e.k === 'm' && occ(m, nx, ny, o))) { bc(p.map, { t: 'fx', k: 'dash', x: o.x, y: o.y, x2: nx, y2: ny, c: s.c }); o.x = nx; o.y = ny; if (e.k === 'p') o.vdirty = 1; si++; break; } }
      if (e.k === 'm') { o.tgt = p.id; o.taunt = p.id; o.tauntT = t + (s.dur || 7000); }
      hit(p, e, s.m || .3, s);
    }
    for (const Rd of Object.values(RAIDS)) if (Rd.map === p.map && Rd.st === 'fight') { Rd.taunt = { id: p.id, until: t + (s.dur || 7000) }; for (const q of rmem(Rd)) say(q, 'sys', `📯 ${p.name}님이 어그로를 끌었어요! (${Math.round((s.dur || 7000) / 1000)}초)`); }
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
  if (id === 'temple') return templeDlg(p);
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
    case 'mob': { const t = MI[m.id]; if (!t || t.boss || t.pet) return; const n = Math.max(1, Math.min(20, m.n | 0)); let c = 0;
      for (let k = 0; k < n * 6 && c < n; k++) { const x = p.x + R(-4, 4), y = p.y + R(-4, 4); if (!walk(mp, x, y) || occ(mp, x, y)) continue; mp.mobs.push({ id: MID++, t: t.idx, x, y, hx: x, hy: y, hp: t.hp, mhp: t.hp, boss: 0, temp: 1, dead: 0, respawn: 0, atkAt: 0, mvAt: 0, tgt: 0 }); c++; }
      return ok(`${t.n} ${c}마리 소환`); }
    case 'clear': { for (let i = mp.mobs.length - 1; i >= 0; i--) { const o = mp.mobs[i]; if (o.boss || o.temp) mp.mobs.splice(i, 1); else { o.dead = 1; o.respawn = now() + 3000; } } return ok('맵의 몬스터를 모두 지웠어요'); }
    case 'lv': p.lv = Math.max(1, Math.min(MAXLV, m.v | 0)); p.exp = 0; stats(p); p.hp = p.mhp; p.mp = p.mmp; p.dirty = 1; return ok('레벨 ' + p.lv);
    case 'exp': addExp(p, need(p.lv) - p.exp, 1); return;
    case 'expev': { const v = [1, 2, 5, 10].includes(m.v | 0) ? m.v | 0 : 1; EXPM = v; sendAll({ t: 'evt', mult: v }); sendAll({ t: 'notice', m: v > 1 ? `🔥 경험치 ${v}배 이벤트 시작!! 🔥` : '경험치 이벤트가 끝났어요', c: '#ffd43b', big: v > 1 ? 1 : 0 }); return ok('경험치 ' + v + '배'); }
    case 'raidreset': { for (const k in RAIDS) raidReset(k, '관리자가 레이드를 초기화했어요'); return ok('레이드 초기화'); }
    case 'gold': p.gold += 1000000; p.dirty = 1; return ok('골드 +1,000,000');
    case 'scroll': giveItem(p, mkScroll('enh', 50)); giveItem(p, mkScroll('ward', 20)); return ok('강화 50 / 보호 20');
    case 'pot': giveItem(p, mkPot('hp', 100)); giveItem(p, mkPot('mp', 100)); return ok('포션 100개씩');
    case 'item': { const ty = ['weapon', 'armor', 'helm'].includes(m.type) ? m.type : 'weapon', r = Math.max(0, Math.min(5, m.r | 0)), il = Math.max(1, Math.min(MAXLV, m.il | 0 || p.lv));
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
    case 'setlv': { const o = [...players.values()].find(q => q.name === String(m.name || '').trim()); if (!o) return ok('그런 사람이 없어요'); o.lv = Math.max(1, Math.min(MAXLV, m.v | 0)); o.exp = 0; stats(o); o.hp = o.mhp; o.dirty = 1; return ok(`${o.name} → Lv${o.lv}`); }
    case 'zstart': return zevStart(p, m.min | 0);
    case 'gtnow': return gtStart(m.here ? mp : null);
    case 'gtstop': return gtEnd('👑 관리자가 황금떡두꺼비 군단을 돌려보냈어요');
    case 'gtquiz': if (GT.st === 'on') gtQuiz(now()); return;
    case 'hwangbag': giveItem(p, stackItem('bundle', 'hwang', '황룡의 부적', 1)); return ok('황룡의 부적 지급');
    case 'beastmats': for (const B of Object.values(BEASTS)) giveItem(p, stackItem('mat', B.mat, B.mat, 1)); return ok('4신수 재료 지급');
    case 'gbuff': p.gb = Object.keys(p.gb || {}).length ? {} : { cr: 1, bh: 1, jj: 1, hm: 1 }; stats(p); p.dirty = 1; return ok('신수 버프 ' + (Object.keys(p.gb).length ? 'ON' : 'OFF'));
    case 'santabuff': p.santa = p.santa > now() ? 0 : now() + 30 * 60000; stats(p); p.dirty = 1; return ok('산타 버프 ' + (p.santa ? 'ON' : 'OFF'));
    case 'topdps': return ok(`레벨 1위 추정 DPS ${Math.round(topDps()).toLocaleString()} → 신수 HP ${Math.round(topDps() * 1800).toLocaleString()} · 황룡 HP ${Math.round(topDps() * 180000).toLocaleString()}`);
    case 'zstop': if (ZEV.on) zevEnd('👑 관리자가 좀비 습격을 종료했어요'); return;
    case 'zstaff': giveItem(p, zstaffWeapon(Math.max(40, p.lv))); return ok('좀비 군주의 지팡이 지급');
    case 'title': p.title = TITLES[m.v] ? m.v : ''; p.dirty = 1; p.vdirty = 1; return ok('칭호: ' + (p.title ? TITLES[p.title].n : '없음'));
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
function sendWho() { sendAll({ t: 'who', l: [...players.values()].map(p => [p.name, p.faction, p.job, p.lv, MAPS[p.map].name, p.admin ? 1 : 0, p.title || '']), zr: db.zrank || null }); }

/* ===================== 🧟 좀비 습격 이벤트 (관리자) ===================== */
const TITLES = {
  zslayer: { n: '🧟 좀비 학살자', c: '#69db7c', big: 1, enter: n => `🧟👑 좀비 학살자 ${n}님이 입장하셨습니다!! 좀비들이 벌벌 떤다…` },
  hwang: { n: '🐲 황룡 토벌자', c: '#fab005', big: 1, enter: n => `🐲✨ 황룡 토벌자 ${n}님이 강림하셨습니다!! 모두 고개를 숙여라!!` },
  zhunter: { n: '🧟 좀비 사냥꾼', c: '#a9e34b', enter: n => `🧟 좀비 사냥꾼 ${n}님 등장! (어디선가 으어어… 소리가 멀어진다)` }
};
const TRANK = t => t === 'hwang' ? 3 : t === 'zslayer' ? 2 : t === 'zhunter' ? 1 : 0;
const zstaffWeapon = il => ({ id: db.iid++, type: 'weapon', b: 9, r: 5, il, plus: 0, n: '좀비 군주의 지팡이', atkb: 120, hpb: 400 });
const ZEV = { on: 0, end: 0, next: 0, wave: 0, kills: {}, fac: {} };
const ZTYPES = ['zoffice', 'zdrunk', 'zgym', 'zstudent'];
const zMaps = () => Object.values(MAPS).filter(m => m.pool.length);
function zStat(m) { const ls = m.pool.map(id => MI[id]), avg = k => ls.reduce((a, b) => a + b[k], 0) / ls.length; return { hp: avg('hp'), atk: avg('atk'), xp: avg('xp'), g: avg('g') }; }
function zSpawn(m, king) {
  let x, y, n = 0;
  do { const e = R(0, 3); x = e === 0 ? R(1, 4) : e === 1 ? R(m.w - 5, m.w - 2) : R(1, m.w - 2); y = e === 2 ? R(1, 4) : e === 3 ? R(m.h - 5, m.h - 2) : R(1, m.h - 2); n++; }
  while ((!walk(m, x, y) || inSafe(m, x, y) || occ(m, x, y)) && n < 100);
  if (n >= 100) return null;
  const s = m.zs || (m.zs = zStat(m)), tp = MI[king ? 'zking' : pick(ZTYPES)], k = king ? 4 : 1, hp = Math.round(s.hp * 9 * k);
  const o = { id: MID++, t: tp.idx, x, y, hx: x, hy: y, hp, mhp: hp, atk: Math.round(s.atk * (king ? 1.6 : 1.25)), zxp: Math.round(s.xp * 5 * k), zg: Math.round(s.g * 4 * k), boss: 1, zombie: 1, v: null, acc: 0, dead: 0, atkAt: 0, mvAt: 0, tgt: 0, skAt: now() + R(3000, 8000), until: ZEV.end + 10000, talkAt: now() + R(2000, 12000) };
  m.mobs.push(o); return o;
}
function zevStart(admin, min) {
  if (ZEV.on) return say(admin, 'sys', '👑 좀비 습격이 이미 진행 중이에요');
  min = [3, 5, 10, 15].includes(min) ? min : 5;
  Object.assign(ZEV, { on: 1, end: now() + min * 60000, next: now() + 5000, wave: 0, kills: {}, fac: {} });
  for (const m of zMaps()) { m.mobs = m.mobs.filter(o => o.ally || MON[o.t].id === 'tuna'); for (let i = 0; i < 5; i++) zSpawn(m); }
  for (const p of players.values()) if (MAPS[p.map].pool.length) send(p, { t: 'mood', m: 'zombie' });
  sendAll({ t: 'zev', st: 'start', min });
  sendAll({ t: 'notice', m: `🧟 좀비들이 몰려옵니다…!! ${min}분 동안 좀비 보스를 가장 많이 잡은 1명에게 💀 좀비 군주의 지팡이 + 칭호 [좀비 학살자]`, c: '#69db7c', big: 1 });
  announce('🧟 좀비 습격 이벤트 시작! 모든 사냥터의 몬스터가 사라지고 좀비 보스들이 몰려옵니다 (좀비 1점, 좀비 킹 5점)');
  zevStatus();
}
const zTop = () => Object.entries(ZEV.kills).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([n, k]) => [n, ZEV.fac[n], k]);
function zevStatus() { const top = zTop(), left = Math.max(0, ZEV.end - now()); for (const p of players.values()) send(p, { t: 'zev', st: 'on', left, top, me: ZEV.kills[p.name] || 0, wave: ZEV.wave }); }
function zombieKill(p, mo, m) {
  const tp = MON[mo.t], i = m.mobs.indexOf(mo); if (i >= 0) m.mobs.splice(i, 1);
  const king = tp.id === 'zking', pts = king ? 5 : 1;
  if (!p.admin) { ZEV.kills[p.name] = (ZEV.kills[p.name] || 0) + pts; ZEV.fac[p.name] = p.faction; }
  const loot = [mkGold(Math.round(mo.zg * (0.6 + Math.random() * 0.8) * (FAC[p.faction].gold || 1)))];
  if (Math.random() < .3) loot.push(mkPot('hp2', 1)); if (Math.random() < .1) loot.push(mkScroll('enh', 1)); if (king) { loot.push(mkScroll('enh', R(2, 4))); if (Math.random() < .5) loot.push(mkScroll('bless', 1)); }
  spreadDrop(m, mo.x, mo.y, loot, p.id);
  addExp(p, mo.zxp);
  say(p, 'loot', `🧟 ${tp.n} 처치! ${p.admin ? '(관리자는 랭킹 제외)' : `+${pts}점 (총 ${ZEV.kills[p.name]}점)`} +${Math.round(mo.zxp * EXPM)}exp`, '#8ce99a');
  for (const k in p.q) { const qd = QUESTS.find(q => q.id === +k); if (qd && qd.kill === 'any') p.q[k] = Math.min(qd.cnt, (p.q[k] || 0) + 1); }
  bc(m.id, { t: 'fx', k: 'die', x: mo.x, y: mo.y, c: tp.c }); p.dirty = 1;
  if (king) sendAll({ t: 'notice', m: `🧟👑 ${p.name}님이 좀비 킹을 쓰러뜨렸다!! (+5점)`, c: '#69db7c' });
}
function zReward(name, gold, items, title) {
  const p = [...players.values()].find(q => q.name === name);
  if (p) {
    p.gold += gold; items.forEach(it => giveItem(p, it)); if (title && TRANK(title) >= TRANK(p.title)) p.title = title; p.dirty = 1; p.vdirty = 1;
    say(p, 'loot', `🧟 좀비 습격 보상: 💰${gold.toLocaleString()}G${items.length ? ' + ' + items.map(itemLabel).join(', ') : ''}${title ? ' + 칭호 [' + TITLES[title].n + ']' : ''}`, '#69db7c');
  } else { const a = db.acc[name]; if (!a) return; const c = a.ch; c.gold += gold; c.inv.push(...items); if (title && TRANK(title) >= TRANK(c.title)) c.title = title; }
}
function zevEnd(reason) {
  if (!ZEV.on) return; ZEV.on = 0;
  const top = zTop();
  top.forEach(([n, , k], i) => {
    if (k <= 0) return;
    const on = [...players.values()].find(q => q.name === n), lv = on ? on.lv : ((db.acc[n] || {}).ch || {}).lv || 40;
    zReward(n, [1000000, 500000, 300000][i] || 100000, i === 0 ? [zstaffWeapon(Math.max(40, lv))] : [], i === 0 ? 'zslayer' : i < 3 ? 'zhunter' : null);
  });
  db.zrank = { at: now(), list: top };
  for (const m of zMaps()) { m.mobs = m.mobs.filter(o => !o.zombie); const have = m.mobs.filter(o => !o.boss && !o.ally && !o.temp).length; for (let i = have; i < m.cnt; i++) spawnMob(m); }
  for (const p of players.values()) if (MAPS[p.map].pool.length) send(p, { t: 'mood', m: '' });
  sendAll({ t: 'zev', st: 'end' }); sendAll({ t: 'zres', list: top, reason: reason || '' });
  sendAll({ t: 'notice', m: top.length ? `🧟 좀비 습격 종료!! 🥇 1위 [${FAC[top[0][1]].n}] ${top[0][0]} (${top[0][2]}점) — 💀 좀비 군주의 지팡이 + 칭호 [좀비 학살자]` : '🧟 좀비 습격이 끝났어요 (처치한 사람이 없어요)', c: '#69db7c', big: 1 });
  sendWho(); flush();
}
function zevTick(t) {
  if (!ZEV.on) return;
  if (t >= ZEV.end) return zevEnd();
  if (t >= ZEV.next) {
    ZEV.wave++; ZEV.next = t + 15000;
    for (const m of zMaps()) {
      const np = [...players.values()].filter(p => p.map === m.id && !p.dead).length, cur = m.mobs.filter(o => o.zombie).length, cap = np ? Math.min(30, 10 + np * 5) : 6;
      let add = Math.min(cap - cur, np ? 3 + np * 2 : 2); while (add-- > 0) zSpawn(m);
      if (np && ZEV.wave >= 3 && ZEV.wave % 2 === 1 && !m.mobs.some(o => o.zombie && MON[o.t].id === 'zking')) { const k = zSpawn(m, 1); if (k) bc(m.id, { t: 'notice', m: '🧟👑 좀비 킹이 나타났다!! (처치 시 5점)', c: '#2b8a3e', big: 1 }); }
    }
    if (ZEV.wave > 1) sendAll({ t: 'zev', st: 'wave', wave: ZEV.wave });
  }
  if (tk % 20 === 0) zevStatus();
}
// 좀비 군주의 지팡이: 평타 시 아군 좀비 소환 (최대 3마리, 20초, 사냥터에서만)
function summonZombie(p, t) {
  const m = MAPS[p.map]; if (!m.pool.length || t < (p.zsumAt || 0)) return;
  if (m.mobs.filter(o => o.ally && o.own === p.id).length >= 3) return;
  for (const [dx, dy] of SPIRAL.slice(1)) { const x = p.x + dx, y = p.y + dy; if (!walk(m, x, y) || occ(m, x, y)) continue;
    m.mobs.push({ id: MID++, t: MI.zpet.idx, x, y, hx: x, hy: y, hp: 1, mhp: 1, boss: 0, ally: 1, own: p.id, until: t + 20000, dead: 0, atkAt: 0, mvAt: 0, tgt: 0 });
    p.zsumAt = t + 3000; bc(m.id, { t: 'fx', k: 'abuff', x, y, r: 1, c: '#94d82d', n: '좀비 소환!', i: p.id }); return; }
}
function petTick(m, o, t, i) {
  const ow = players.get(o.own);
  if (!ow || ow.map !== m.id || ow.dead || t > o.until) { m.mobs.splice(i, 1); bc(m.id, { t: 'fx', k: 'die', x: o.x, y: o.y, c: '#94d82d' }); return; }
  let tg = null, bd = 1e9; for (const e of m.mobs) if (!e.dead && !e.ally && !e.inv) { const d = dist(o, e); if (d < bd && d <= 8) { bd = d; tg = e; } }
  if (tg && bd - (tg.sz || 0) <= 1.5) { if (t > o.atkAt) { o.atkAt = t + 1000; bc(m.id, { t: 'fx', k: 'bite', x: tg.x, y: tg.y, c: '#94d82d' }); damageMob(ow, tg, Math.max(1, Math.round(atkOf(ow) * 0.55 * (0.85 + Math.random() * 0.3))), false); } return; }
  const go = tg || (dist(o, ow) > 2.5 ? ow : null); if (!go || t < o.mvAt) return; o.mvAt = t + 280;
  const dx = go.x - o.x, dy = go.y - o.y, tries = Math.abs(dx) > Math.abs(dy) ? [[Math.sign(dx), 0], [0, Math.sign(dy) || 1], [0, -(Math.sign(dy) || 1)]] : [[0, Math.sign(dy)], [Math.sign(dx) || 1, 0], [-(Math.sign(dx) || 1), 0]];
  for (const [a, b] of tries) { if (!a && !b) continue; const nx = o.x + a, ny = o.y + b; if (walk(m, nx, ny) && !occ(m, nx, ny, o)) { o.x = nx; o.y = ny; break; } }
}

/* ===================== 레이드 (보스 대기실) ===================== */
const RAIDS = {
  r10: { n: '버섯브로콜리', lv: 10, map: 'raid1', exp: 60000, ilv: 14, items: 2, mat: '합체 포자' },
  r30: { n: '티라노', lv: 30, map: 'raid2', exp: 600000, ilv: 34, items: 3, mat: '메가 공룡 비늘' },
  r50: { n: '석상왕', lv: 50, map: 'raid3', exp: 5000000, ilv: 55, items: 5, mat: '분노의 핵' },
  r40: { n: '심연의 문어왕', lv: 40, map: 'raid4', exp: 1800000, ilv: 45, items: 4, lives: 4, min3: 1, mat: '문어왕의 먹물' },
  r70: { n: '시계탑 마왕', lv: 70, map: 'raid5', exp: 18000000, ilv: 75, items: 6, lives: 5, min3: 1, mat: '시간의 톱니' },
  r80: { n: '산타', lv: 80, map: 'raid6', exp: 40000000, ilv: 88, items: 6, min3: 1, mat: '산타의 선물' },
  r90: { n: '흑철 군단장 카르곤', lv: 90, map: 'raid7', exp: 90000000, ilv: 98, items: 7, min3: 1, mat: '군단장의 뿔' }
};
for (const [k, B] of Object.entries(BEASTS)) RAIDS[k] = { n: B.n + ' 신전', lv: 80, map: 'temple' + k.slice(1), exp: 30000000, ilv: 100, items: 5, temple: 1, beast: B, npc: 'temple', mat: B.mat };
for (const k in RAIDS) Object.assign(RAIDS[k], { id: k, st: 'idle', mem: new Set(), haz: [], ph: 0, npc: RAIDS[k].npc || 'gate' + k.slice(1) });
const LOBBY_MS = 20000;
const rmem = R => [...R.mem].map(id => players.get(id)).filter(Boolean);
function raidDlg(p, id) {
  const Rd = RAIDS[id]; if (!Rd) return;
  const N = NPCS[Rd.npc], names = rmem(Rd).map(q => q.name);
  const stTxt = Rd.st === 'idle' ? '🟢 대기 중 — 참여하면 20초 뒤 다 같이 입장해요' : Rd.st === 'lobby' ? `🟡 모집 중 — ${Math.max(0, Math.ceil((Rd.startAt - now()) / 1000))}초 뒤 출발` : Rd.st === 'fight' ? '🔴 전투 중 — 끝나면 다시 도전할 수 있어요' : '🟣 정리 중 — 잠시 뒤 다시 도전할 수 있어요';
  const lines = [Rd.temple ? `[${Rd.beast.e} ${Rd.n}] Lv${Rd.lv} 이상 · ⚠️ 3명 이상 모여야 입장\n🌀 어두운 미로 · 숨은 함정(밟으면 떨어져서 처음으로) · 수호병 · 3인 룬 퍼즐 → ${Rd.beast.n} 방\n🏆 처치 시 [${Rd.beast.buff}] 영구 버프 + ${Rd.mat}` : `[${Rd.n}] 레이드 · Lv${Rd.lv} 이상 · 한 번에 한 팀만${Rd.min3 ? '\n⚠️ 3명이 동시에 해야 풀리는 기믹이 있어요 (3인 이상 권장)' : ''}${Rd.lives ? ' · 보스가 ' + (Rd.lives - 1) + '번 부활' : ''}`, stTxt + (names.length ? `\n참여자(${names.length}): ${names.join(', ')}` : '')];
  const acts = [];
  if (Rd.mem.has(p.id) && Rd.st === 'lobby') acts.push({ k: 'raid', id, op: 'start', label: '⚔️ 지금 바로 출발' }, { k: 'raid', id, op: 'leave', label: '참여 취소' });
  else if (Rd.st === 'idle' || Rd.st === 'lobby') { if (p.lv >= Rd.lv || p.admin) acts.push({ k: 'raid', id, op: 'join', label: '🙋 보스 참여' }); else lines.push(`(Lv.${Rd.lv}부터 참여할 수 있어요)`); }
  if (Rd.temple) acts.push({ k: 'talk', label: '◀ 신전 목록' });
  acts.push({ k: 'close', label: '닫기' });
  send(p, { t: 'dlg', npc: Rd.npc, name: N.n, look: N.look, lines, acts, keep: 1 });
}
function raidOp(p, id, op) {
  const Rd = RAIDS[id]; if (!Rd || !npcNear(p, Rd.npc)) return;
  if (op === 'join') {
    if (!(Rd.st === 'idle' || Rd.st === 'lobby') || (p.lv < Rd.lv && !p.admin)) return raidDlg(p, id);
    for (const k in RAIDS) RAIDS[k].mem.delete(p.id);
    Rd.mem.add(p.id);
    if (Rd.st === 'idle') { Rd.st = 'lobby'; Rd.startAt = now() + LOBBY_MS; sendAll({ t: 'notice', m: `⚔️ ${Rd.n} 레이드 모집 시작! (보스 대기실 · 20초 뒤 출발)`, c: '#ffa94d' }); }
    else for (const q of rmem(Rd)) say(q, 'sys', `🙋 ${p.name}님이 ${Rd.n} 레이드에 참여했어요 (${Rd.mem.size}명)`);
  } else if (op === 'leave') { Rd.mem.delete(p.id); if (!Rd.mem.size && Rd.st === 'lobby') Rd.st = 'idle'; }
  else if (op === 'start' && Rd.mem.has(p.id) && Rd.st === 'lobby') Rd.startAt = now();
  else if (op === 'view') { }
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
  if (Rd.temple && ps.length < 3 && !ps.some(q => q.admin)) { for (const q of ps) send(q, { t: 'notice', m: `🏛️ ${Rd.n}은(는) 3명 이상 모여야 들어갈 수 있어요 (현재 ${ps.length}명)`, c: '#ff8787', big: 1 }); Rd.mem.clear(); Rd.st = 'idle'; return; }
  Rd.mem = new Set(ps.map(q => q.id));
  const m = MAPS[Rd.map]; m.mobs.length = 0; m.ground.length = 0; Rd.haz = []; rClean(Rd);
  Rd.enr = 0; Rd.cnt = 0;
  if (Rd.temple) return templeStart(Rd, ps);
  ps.forEach((q, i) => warp(q, m.id, (m.w >> 1) + (i % 7) - 3, m.h - 3 - Math.floor(i / 7)));
  Rd.st = 'fight'; Rd.ph = 1; Rd.next = now() + 3500; Rd.t0 = now();
  sendAll({ t: 'notice', m: `⚔️ ${Rd.n} 레이드 시작! (${ps.length}명 참여)`, c: '#ff922b' });
  const cx = m.w >> 1;
  if (Rd.id === 'r10') { const a = rSpawn(Rd, 'rmush', cx - 6, 7), b = rSpawn(Rd, 'rbroc', cx + 6, 7); rTalk(Rd, a, '버섯 등장!!'); rTalk(Rd, b, '브로콜리도 있다!!'); }
  if (Rd.id === 'r30') { rTalk(Rd, rSpawn(Rd, 'rdino', cx, 6, { inv: 1, shield: 1 }), '크아아아앙!!! 불꽃 갑옷이 나를 지킨다!!'); Rd.plateAt = now() + 4000; rHint(Rd, '🔥 티라노는 불꽃 갑옷(보호막) 상태! 파란 냉각 발판을 모두 밟아 갑옷을 식히세요'); }
  Rd.left = Rd.lives || 1; Rd.marks = []; Rd.share = null; Rd.tent = [];
  if (Rd.id === 'r40') { rTalk(Rd, rSpawn(Rd, 'kraken', cx, 7, { still: 1, inv: 1, shield: 1 }), '심연이… 너희를 삼킨다…'); rTentacles(Rd); Rd.plateAt = now() + 4000; rMood(Rd, 'deep'); rHint(Rd, '🐙 문어왕은 보호막 상태! 노란 등대 발판 3개를 3명이 동시에 2초 밟아야 깨져요'); }
  if (Rd.id === 'r70') { rTalk(Rd, rSpawn(Rd, 'clockking', cx, 9, { still: 1, inv: 1, shield: 1 }), '째깍… 째깍… 너희의 시간은 끝났다.'); Rd.plateAt = now() + 4000; rHint(Rd, '🕰️ 마왕의 보호막! 톱니 발판 3개를 3명이 동시에 밟으세요. 노란 원(운명의 일격)은 3명 이상 모여서 나눠 맞기!'); }
  if (Rd.id === 'r90') { const b = rSpawn(Rd, 'kargon', cx, 9, { noMelee: 1, still: 1, fa: Math.PI / 2, kargon: 1 }); Rd.threat = {}; Rd.taunt = null; Rd.stag = 0; rTalk(Rd, b, '흑철 군단 앞에 무릎 꿇어라…!'); rHint(Rd, '🪓 카르곤은 앞에서 때리면 막아요! 뒤(초록 부채꼴)에서 때려야 피해가 들어가고 무력화 게이지가 차요. 게이지가 차면 기절! 탱커가 도발(어그로)로 앞을 잡아주세요'); kgStag(Rd); }
  if (Rd.id === 'r80') { rTalk(Rd, rSpawn(Rd, 'santa', cx, 7, { inv: 1, air: 1 }), '호호호~ 나쁜 아이들은 선물 대신 석탄이다!!'); santaRudolphs(Rd); rMood(Rd, 'snow'); rHint(Rd, '🎅 산타가 썰매를 타고 무적! 루돌프 4마리를 모두 잡으면 썰매가 추락해요'); }
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
  else if (Rd.temple && MON[mo.t].gbeast) raidWin(Rd, p, mo);
  else if (Rd.id === 'r80' && key === 'rudolph' && !left('rudolph') && Rd.ph === 1) { const b = rBoss(Rd, 'santa'); if (b) { b.air = 0; b.inv = 0; b.groggy = now() + 15000; b.stun = now() + 15000; bc(m.id, { t: 'fx', k: 'boom', x: b.x, y: b.y, r: 4, c: '#ffffff' }); bc(m.id, { t: 'shake', ms: 900 }); rTalk(Rd, b, '으악!! 내 썰매가!!'); for (const q of rmem(Rd)) send(q, { t: 'notice', m: '🛷 썰매 추락!! 산타 그로기 15초 — 지금 공격!! (피해 1.5배)', c: '#ffe066', big: 1 }); } }
  else if (Rd.id === 'r80' && key === 'santa') raidWin(Rd, p, mo);
  else if (Rd.id === 'r90') kgMobDied(Rd, mo, p, key);
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
  for (const q of ps) { giveItem(q, stackItem('mat', Rd.mat, Rd.mat, 1)); say(q, 'loot', `🧩 재료 [${Rd.mat}] 획득!${Rd.temple ? ' (황룡의 부적 재료)' : Rd.id === 'r80' ? '' : ' (냉동참치 보따리 재료)'}`, '#a5d8ff'); }
  if (Rd.temple) for (const q of ps) { q.gb = q.gb || {}; const had = q.gb[Rd.beast.gb]; q.gb[Rd.beast.gb] = 1; stats(q); q.dirty = 1; send(q, { t: 'notice', m: `${Rd.beast.e} 고유 신수 버프 [${Rd.beast.buff}] ${had ? '(이미 있음)' : '획득!! (영구)'}`, c: Rd.beast.c === '#f8f9fa' ? '#dee2e6' : Rd.beast.c, big: 1 }); bc(m.id, { t: 'fx', k: 'lvup', x: q.x, y: q.y, c: '#ffe066' }); }
  if (Rd.id === 'r80') for (const q of ps) { q.santa = now() + 30 * 60000; stats(q); q.dirty = 1; send(q, { t: 'notice', m: '🎅 산타의 축복!! 30분 동안 공격·방어 +15%, 경험치 1.5배', c: '#ff6b6b', big: 1 }); }
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
  if (Rd.id === 'r40' || Rd.id === 'r70' || Rd.id === 'r80') { const pos = []; for (let k = 0; k < 60 && pos.length < 3; k++) { const c = rFree(Rd, b, 6); for (const o of c) if (pos.length < 3 && pos.every(q => Math.hypot(q.x - o.x, q.y - o.y) >= 8)) pos.push(o); } Rd.plates = pos.map(o => ({ x: o.x, y: o.y, ci: 3, on: 0 })); Rd.seq = null; Rd.sim = 1; Rd.hold = 0; rTalk(Rd, b, Rd.id === 'r80' ? '굴뚝 3개를 동시에 막으면… 내 마법이 풀리지… 호호호' : Rd.id === 'r40' ? '등대에 불을 켤 수 있을까…? 셋이서 동시에…' : '세 개의 톱니가 동시에 돌아야… 내 시간이 멈춘다…'); }
  else if (Rd.id === 'r30') { Rd.plates = rFree(Rd, b, Rd.ph === 1 ? 3 : 4).map(o => ({ x: o.x, y: o.y, ci: 1, on: 0 })); Rd.seq = null; }
  else { const n = Rd.ph === 3 ? 5 : 4, pos = rFree(Rd, b, n), order = [...Array(n).keys()].sort(() => Math.random() - .5); Rd.plates = pos.map((o, i) => ({ x: o.x, y: o.y, ci: i, on: 0 })); Rd.seq = order; Rd.seqI = 0; rTalk(Rd, b, '순서를 기억하라… ' + order.map(i => PEMO[i]).join(' → ')); }
  rPlates(Rd);
}
function rGroggy(Rd, b) {
  const gt = Rd.id === 'r40' || Rd.id === 'r70' || Rd.id === 'r80' ? 10000 : 12000; const t = now(); b.inv = 0; b.groggy = t + gt; b.stun = t + gt; b.air = 0; Rd.plates = []; Rd.seq = null; rPlates(Rd); Rd.plateAt = t + gt;
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
  if (Rd.id === 'r80') return Rd.ph >= 2 ? rBoss(Rd, 'santa') : null;
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
    if (Rd.temple) templeTick(Rd, t);
    if (Rd.id === 'r80') santaTick(Rd, t);
    if (Rd.id === 'r90') kgTick(Rd, t);
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
    if (Rd.temple && Rd.ph === 2) beastAttack(Rd, t);
    if (Rd.id === 'r80') santaAttack(Rd, t);
    if (Rd.id === 'r90') kgAttack(Rd, t);
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

/* ===================== 🏛️ 4신수 신전 (미로 + 함정 + 3인 룬 퍼즐 + 신수방) ===================== */
const TCX = 21;
function templeDlg(p) {
  const st = Rd => Rd.st === 'idle' ? '🟢 비어 있음' : Rd.st === 'lobby' ? `🟡 모집 중 (${Rd.mem.size}명)` : Rd.st === 'fight' ? '🔴 도전 중' : '🟣 정리 중';
  const lines = ['사방을 지키는 네 신수의 신전이다…', '어두운 미로와 무너지는 바닥을 지나, 셋이 함께 룬을 밝혀야 신수의 방이 열린다. (Lv80↑ · 3명 이상)', Object.keys(BEASTS).map(k => `${BEASTS[k].e} ${RAIDS[k].n}: ${st(RAIDS[k])}${p.gb && p.gb[BEASTS[k].gb] ? ' ✅' : ''}`).join('\n')];
  send(p, { t: 'dlg', npc: 'temple', name: NPCS.temple.n, look: NPCS.temple.look, lines, acts: [...Object.keys(BEASTS).map(k => ({ k: 'raid', id: k, op: 'view', label: `${BEASTS[k].e} ${BEASTS[k].n} 신전` })), { k: 'close', label: '닫기' }], keep: 1 });
}
function buildTemple(Rd) {
  const m = MAPS[Rd.map], W = m.w, H = m.h, t = Array.from({ length: H }, () => Array(W).fill('W'));
  for (let y = 1; y <= 11; y++) for (let x = 1; x < W - 1; x++) t[y][x] = '.';           // 신수방
  for (const x of [TCX - 1, TCX, TCX + 1]) t[12][x] = 'D';                               // 봉인문
  for (let y = 13; y <= 15; y++) for (let x = 9; x <= 33; x++) t[y][x] = '.';             // 룬의 전실
  const cell = (x, y) => x >= 1 && x <= W - 2 && y >= 17 && y <= H - 2 && x % 2 && y % 2;
  const seen = new Set(['1,' + (H - 2)]), st = [[1, H - 2]]; t[H - 2][1] = '.';
  while (st.length) { const [x, y] = st[st.length - 1], nb = [[2, 0], [-2, 0], [0, 2], [0, -2]].map(([dx, dy]) => [x + dx, y + dy, dx, dy]).filter(([nx, ny]) => cell(nx, ny) && !seen.has(nx + ',' + ny));
    if (!nb.length) { st.pop(); continue; } const [nx, ny, dx, dy] = pick(nb); t[y + dy / 2][x + dx / 2] = '.'; t[ny][nx] = '.'; seen.add(nx + ',' + ny); st.push([nx, ny]); }
  for (let k = 0; k < 12; k++) { const x = R(2, W - 3), y = R(18, H - 3); if (t[y][x] === 'W' && ((t[y][x - 1] === '.' && t[y][x + 1] === '.') || (t[y - 1][x] === '.' && t[y + 1][x] === '.'))) t[y][x] = '.'; }
  t[16][TCX] = '.'; t[H - 2][0] = '.';
  // 정답 길 (BFS)
  const key = (x, y) => x + ',' + y, prev = new Map([[key(1, H - 2), null]]), q = [[1, H - 2]];
  while (q.length) { const [x, y] = q.shift(); if (x === TCX && y === 17) break; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (ny < 17 || t[ny][nx] !== '.' || prev.has(key(nx, ny))) continue; prev.set(key(nx, ny), [x, y]); q.push([nx, ny]); } }
  const path = new Set(); for (let c = [TCX, 17]; c; c = prev.get(key(c[0], c[1]))) path.add(key(c[0], c[1]));
  // 함정: 정답 길이 아닌 갈림길에 숨겨진 무너지는 바닥 + 정답 길 위에도 가끔 금 간 바닥(밟으면 떨어짐, 옆으로 돌아가야 함)
  const off = [], on = [];
  for (let y = 17; y <= H - 2; y++) for (let x = 1; x <= W - 2; x++) if (t[y][x] === '.' && Math.hypot(x - 1, y - (H - 2)) > 4) (path.has(key(x, y)) ? on : off).push([x, y]);
  for (const [x, y] of off) if (Math.random() < .32) t[y][x] = 'X';
  m.t = t; m.orig = t.map(r => r.slice());
  return { path, off: off.filter(([x, y]) => t[y][x] === '.'), on };
}
function templeStart(Rd, ps) {
  const m = MAPS[Rd.map], B = Rd.beast, mz = buildTemple(Rd); Rd.mz = mz;
  bc(m.id, mapMsg(m));
  for (const q of ps) warp(q, m.id, 1, m.h - 2);
  Rd.st = 'fight'; Rd.next = now() + 3500; Rd.t0 = now(); Rd.left = 1; Rd.marks = []; Rd.share = null; Rd.tent = [];
  // 미로 수호병
  const spots = [...mz.off, ...mz.on].filter(([x, y]) => Math.hypot(x - 1, y - (m.h - 2)) > 7).sort(() => Math.random() - .5).slice(0, 16);
  for (const [x, y] of spots) rSpawn(Rd, B.guard, x, y, { boss: 0, maze: 1, sz: 0 });
  for (const [x, y] of [[11, 14], [31, 14]]) rSpawn(Rd, B.guard, x, y, { boss: 0, maze: 1, sz: 0 });
  Rd.ph = 1; Rd.plates = [[13, 14], [TCX, 14], [29, 14]].map(([x, y]) => ({ x, y, ci: 3, on: 0 })); Rd.sim = 1; Rd.hold = 0; Rd.seq = null; rPlates(Rd);
  rMood(Rd, 'dark');
  sendAll({ t: 'notice', m: `🏛️ ${B.e} ${Rd.n} 도전 시작!! (${ps.length}명) — 어둠 속 미로를 지나 ${B.n}의 방으로…`, c: '#ffd43b', big: 1 });
  rHint(Rd, `🌀 미로를 지나 위쪽 '룬의 전실'로! 숨겨진 함정을 밟으면 바닥이 꺼져 처음으로 떨어져요. 전실의 노란 룬 3개를 3명이 동시에 2초 밟으면 봉인문이 열려요`);
}
function templeFall(p) {
  const Rd = Object.values(RAIDS).find(r => r.temple && r.map === p.map && r.st === 'fight'); if (!Rd) return;
  const m = MAPS[p.map], x = p.x, y = p.y;
  bc(m.id, { t: 'fx', k: 'die', x, y, c: '#000000' }); rSetTiles(Rd, [[x, y]], 'V');
  p.stun = now() + 1200; warp(p, m.id, 1, m.h - 2); damagePlayer(p, Math.round(p.mhp * .2), null);
  send(p, { t: 'notice', m: '🕳️ 바닥이 무너졌다!! 아래로 떨어져서 처음 위치로… (HP -20%)', c: '#ff8787', big: 1 });
  for (const q of rmem(Rd)) if (q !== p) say(q, 'sys', `🕳️ ${p.name}님이 함정에 빠져 처음으로 떨어졌어요!`);
}
function templeTick(Rd, t) {
  const m = MAPS[Rd.map];
  if (Rd.ph !== 1) return;
  const al = rAlive(Rd); let all = true;
  for (const pl of Rd.plates) { const o = al.some(q => q.x === pl.x && q.y === pl.y); pl.on = o ? Infinity : 0; if (!o) all = false; }
  Rd.hold = all ? (Rd.hold || 0) + 100 : 0;
  if (tk % 3 === 0) rPlates(Rd);
  if (Rd.hold < 2000) return;
  // 봉인 해제 → 신수 등장
  const B = Rd.beast; Rd.ph = 2; Rd.plates = []; Rd.sim = 0; rPlates(Rd); rSetTiles(Rd, [[TCX - 1, 12], [TCX, 12], [TCX + 1, 12]], '.'); rMood(Rd, '');
  bc(m.id, { t: 'shake', ms: 1500 }); bc(m.id, { t: 'fx', k: 'boom', x: TCX, y: 12, r: 4, c: '#ffd43b' });
  const hp = Math.round(topDps() * 1800), b = rSpawn(Rd, B.id, TCX, 5, { hp, mhp: hp, gbeast: 1 });
  rTalk(Rd, b, { cr: '동쪽 하늘의 주인, 청룡이다. 번개에 꿰뚫려라…', bh: '서쪽의 백호다. 내 발톱을 피할 수 있겠나…', jj: '남쪽의 불꽃, 주작이 깨어났다!!', hm: '북쪽의 현무… 내 등껍질은 산보다 단단하다.' }[B.gb]);
  sendAll({ t: 'notice', m: `${B.e} ${Rd.n}의 봉인이 풀렸다!! 사방신 ${B.n} 등장!!`, c: '#ffd43b', big: 1 });
  Rd.next = t + 4000;
}
const roomT = (m, n) => { const o = []; for (let i = 0; i < n; i++) o.push([R(2, m.w - 3), R(2, 10)]); return o; };
function beastAttack(Rd, t) {
  const m = MAPS[Rd.map], B = Rd.beast, b = rBoss(Rd, B.id); if (!b) { Rd.next = t + 800; return; }
  const c = Rd.cnt = (Rd.cnt || 0) + 1, enr = b.hp < b.mhp * .3, D = enr ? 1.3 : 1, al = rAlive(Rd);
  if (enr && !Rd.enr) { Rd.enr = 1; rMood(Rd, B.gb === 'jj' ? 'lava' : 'dark'); for (const q of rmem(Rd)) send(q, { t: 'notice', m: `${B.e} ${B.n}이(가) 분노했다!! 공격이 더 빠르고 강해진다!!`, c: '#ff6b6b', big: 1 }); rTalk(Rd, b, '이제부터가 진짜다…!!'); }
  if (B.gb === 'cr') { // 청룡: 번개 + 물줄기 + 해일
    warnT(Rd, roomT(m, 10 + (enr ? 8 : 0)).flatMap(([x, y]) => circleT(x, y, 1)), 1300, 1400 * D, '#74c0fc', { stun: 600 });
    if (c % 2 === 0) { for (const q of al.slice(0, 4)) warnT(Rd, lineT(m, b.x, b.y, q, 20), 1500, 1800 * D, '#1c7ed6'); rTalk(Rd, b, '용의 물줄기!!'); }
    if (c % 4 === 3) { const gap = R(2, m.w - 7); for (let k = 0; k < 4; k++) { const tiles = []; for (let y = 1 + k * 3; y < Math.min(12, 4 + k * 3); y++) for (let x = 1; x < m.w - 1; x++) if (x < gap || x > gap + 3) tiles.push([x, y]); warnT(Rd, tiles, 1400 + k * 400, 1600 * D, '#4dabf7'); } rTalk(Rd, b, '동해의 파도여!!'); }
  } else if (B.gb === 'bh') { // 백호: 돌진 + 할퀴기 + 포효
    for (const q of al.slice(0, enr ? 4 : 2)) warnT(Rd, coneT(b, q, 9, .5), 1200, 1700 * D, '#e9ecef');
    if (c % 2 === 1) { const q = pick(al); if (q) { warnT(Rd, lineT(m, b.x, b.y, q, 22), 1200, 2000 * D, '#ced4da', { stun: 1000 }); setTimeout(() => { if (Rd.st === 'fight' && walk(m, q.x, q.y)) { b.x = q.x; b.y = q.y; } }, 1300); rTalk(Rd, b, '크르릉… 질주!!'); } }
    if (c % 3 === 0) { warnT(Rd, circleT(b.x, b.y, 5.5), 1600, 1500 * D, '#adb5bd', { stun: 1500 }); rTalk(Rd, b, '크아아아앙!!!'); }
  } else if (B.gb === 'jj') { // 주작: 불비 + 불바다 + 화염 고리
    warnT(Rd, roomT(m, 16 + (enr ? 10 : 0)).flatMap(([x, y]) => circleT(x, y, .8)), 1400, 1300 * D, '#ff6b00');
    if (c % 3 === 1) { const z = roomT(m, 3).flatMap(([x, y]) => circleT(x, y, 1.5)); warnT(Rd, z, 1500, 900, '#e03131'); setTimeout(() => { if (Rd.st === 'fight') rSetTiles(Rd, rTiles(m, z).filter(([x, y]) => y <= 11 && m.t[y][x] === '.'), 'L'); }, 1500); rTalk(Rd, b, '불바다가 되어라!!'); }
    if (c % 2 === 0) warnT(Rd, donutT(b.x, b.y, 2.5, 7), 1500, 1700 * D, '#fa5252');
  } else { // 현무: 지진 + 얼음 + 거북 등껍질(무적)
    warnT(Rd, donutT(b.x, b.y, 0, 3.5), 1400, 1800 * D, '#495057', { stun: 1200 });
    if (c % 2 === 0) for (const q of al) warnT(Rd, circleT(q.x, q.y, 1.6), 1500, 1300 * D, '#3bc9db', { stun: 800 });
    if (c % 5 === 4 && !b.shellT) { b.inv = 1; b.shellT = t + 6000; rTalk(Rd, b, '등껍질 속으로…'); for (const q of rmem(Rd)) send(q, { t: 'notice', m: '🐢 현무가 등껍질에 숨었다! 6초 동안 무적 — 사방에서 바위가 떨어진다!!', c: '#74c0fc', big: 1 }); warnT(Rd, roomT(m, 30).flatMap(([x, y]) => circleT(x, y, 1)), 2500, 1500 * D, '#868e96'); }
  }
  if (b.shellT && t > b.shellT) { b.inv = 0; b.shellT = 0; }
  if (c % 6 === 5) { const g = Rd.beast.guard; for (let k = 0; k < 2; k++) rSpawn(Rd, g, R(4, m.w - 5), R(2, 10), { boss: 0, sz: 0 }); rTalk(Rd, b, '수호병들이여, 일어나라!'); }
  Rd.next = t + (enr ? 2600 : 3400);
}
/* ===================== 🪓 흑철 군단장 카르곤 (Lv90 · 3인↑) =====================
   1페: 백어택 + 무력화 / 2페(75%): ①→④ 순서대로 구슬 파괴 / 3페(50%): 빛나는 대각선 수정 2개 파괴 (어두운 수정 = 폭발, 20초 지나면 대파멸)
   4페(25%): 분노 + 바닥 붕괴 + 구슬 거꾸로(④→①) */
function kgStag(Rd) { bc(Rd.map, { t: 'stag', v: Math.round(Rd.stag || 0), ph: Rd.ph }); }
function kgAggro(Rd, b) {
  const al = rAlive(Rd); if (!al.length) return null;
  if (Rd.taunt && Rd.taunt.until > now()) { const q = players.get(Rd.taunt.id); if (q && al.includes(q)) return q; }
  let best = null; for (const q of al) if (!best || (Rd.threat[q.id] || 0) > (Rd.threat[best.id] || 0)) best = q;
  return (Rd.threat[best.id] || 0) > 0 ? best : al.reduce((a, q) => dist(b, q) < dist(b, a) ? q : a, al[0]);
}
function kgOrbs(Rd, rev) {
  const m = MAPS[Rd.map], b = rBoss(Rd, 'kargon'); for (const o of m.mobs) if (/^kg_o/.test(MON[o.t].id)) o.dead = 1; m.mobs = m.mobs.filter(o => !o.dead);
  const pos = rFree(Rd, b, 4); pos.forEach((o, i) => rSpawn(Rd, 'kg_o' + (i + 1), o.x, o.y, { still: 1, sz: .2 }));
  Rd.orbRev = rev ? 1 : 0; Rd.orbNext = rev ? 4 : 1; if (b) { b.inv = 1; b.shield = 1; }
  for (const q of rmem(Rd)) send(q, { t: 'notice', m: rev ? '🔮 구슬 4개! 이번엔 거꾸로 ④→③→②→① 순서로 부수세요!! (틀리면 폭발)' : '🔮 군단장의 보호막! 구슬 ①→②→③→④ 순서대로 부수세요!! (틀리면 폭발)', c: '#b197fc', big: 1 });
}
function kgCrystals(Rd) {
  const m = MAPS[Rd.map], b = rBoss(Rd, 'kargon'), C = [[3, 3], [m.w - 4, 3], [m.w - 4, m.h - 4], [3, m.h - 4]], d = R(0, 1);
  C.forEach(([x, y], i) => rSpawn(Rd, (i % 2) === d ? 'kg_cl' : 'kg_cd', x, y, { still: 1, sz: .3 }));
  Rd.wipeAt = now() + 22000; Rd.wipeWarn = 0; if (b) { b.inv = 1; b.shield = 1; }
  rTalk(Rd, b, '흑철의 대파멸… 20초 뒤 모든 것이 끝난다…');
  for (const q of rmem(Rd)) send(q, { t: 'notice', m: `💎 대파멸 준비!! ${d ? '↗ 오른쪽 위 + ↙ 왼쪽 아래' : '↖ 왼쪽 위 + ↘ 오른쪽 아래'} 대각선의 '빛나는 수정' 2개를 부수세요! 어두운 수정은 건드리면 폭발!`, c: '#ffd43b', big: 1 });
}
function kgFree(Rd, msg) { const m = MAPS[Rd.map], b = rBoss(Rd, 'kargon'); for (const o of m.mobs) if (/^kg_(o|c)/.test(MON[o.t].id)) o.dead = 1; m.mobs = m.mobs.filter(o => !o.dead); Rd.wipeAt = 0; if (b) { b.inv = 0; b.shield = 0; b.groggy = now() + 10000; b.stun = now() + 10000; rTalk(Rd, b, '말도 안 돼…!!'); } for (const q of rmem(Rd)) send(q, { t: 'notice', m: msg, c: '#ffe066', big: 1 }); }
function kgMobDied(Rd, mo, p, key) {
  const m = MAPS[Rd.map];
  if (key === 'kargon') return raidWin(Rd, p, mo);
  if (/^kg_o/.test(key)) {
    const n = +key.slice(4);
    if (n === Rd.orbNext) { Rd.orbNext += Rd.orbRev ? -1 : 1; bc(m.id, { t: 'fx', k: 'ring', x: mo.x, y: mo.y, r: 1.5, c: '#69db7c' }); if (Rd.orbNext < 1 || Rd.orbNext > 4) kgFree(Rd, '✅ 구슬 순서 정답!! 보호막 해제 + 카르곤 기절 10초!'); else for (const q of rmem(Rd)) say(q, 'sys', `🔮 ${'①②③④'[n - 1]} 정답! 다음: ${'①②③④'[Rd.orbNext - 1]}`); }
    else { warnT(Rd, randT(m, 1).flatMap(() => circleT(m.w >> 1, m.h >> 1, 30)), 600, 1500, '#7048e8'); for (const q of rmem(Rd)) send(q, { t: 'notice', m: `💥 순서가 틀렸다!! (${'①②③④'[n - 1]}) 대폭발 + 구슬 재생성`, c: '#ff6b6b', big: 1 }); setTimeout(() => Rd.st === 'fight' && kgOrbs(Rd, Rd.orbRev), 1200); }
  }
  if (key === 'kg_cd') { warnT(Rd, circleT(m.w >> 1, m.h >> 1, 30), 500, 1800, '#5f3dc4'); const b = rBoss(Rd, 'kargon'); if (b) b.hp = Math.min(b.mhp, b.hp + Math.round(b.mhp * .03)); for (const q of rmem(Rd)) send(q, { t: 'notice', m: '💥 어두운 수정을 깨버렸다!! 전체 폭발 + 카르곤 회복', c: '#ff6b6b', big: 1 }); }
  if (key === 'kg_cl' && !m.mobs.some(o => !o.dead && MON[o.t].id === 'kg_cl')) kgFree(Rd, '✅ 대각선 수정 파괴!! 대파멸 저지 + 카르곤 기절 10초!');
}
function kgTick(Rd, t) {
  const m = MAPS[Rd.map], b = rBoss(Rd, 'kargon'); if (!b) return;
  const tg = kgAggro(Rd, b);
  if (tg && !(b.stun > t)) {
    const want = Math.atan2(tg.y - b.y, tg.x - b.x); let d = want - b.fa; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    b.fa += Math.max(-.12, Math.min(.12, d)) * (Rd.ph >= 4 ? 1.6 : 1);
    if (t > (b.mvAt || 0) && dist(b, tg) > 2.2) { b.mvAt = t + (Rd.ph >= 4 ? 450 : 650); const nx = b.x + Math.sign(tg.x - b.x) * (Math.abs(tg.x - b.x) >= Math.abs(tg.y - b.y) ? 1 : 0), ny = b.y + Math.sign(tg.y - b.y) * (Math.abs(tg.x - b.x) < Math.abs(tg.y - b.y) ? 1 : 0); if (walk(m, nx, ny)) { b.x = nx; b.y = ny; } }
  }
  const hp = b.hp / b.mhp;
  if (Rd.ph === 1 && hp < .75) { Rd.ph = 2; kgOrbs(Rd, 0); }
  else if (Rd.ph === 2 && hp < .5 && !b.inv) { Rd.ph = 3; kgCrystals(Rd); }
  else if (Rd.ph === 3 && hp < .25 && !b.inv) { Rd.ph = 4; rMood(Rd, 'dark'); rCollapse(Rd, 3); rTalk(Rd, b, '흑철 군단장의 진짜 힘을 보여주마!!!'); for (const q of rmem(Rd)) send(q, { t: 'notice', m: '🔥 카르곤 분노!! (4페이즈) 더 빠르게 돌고 더 세게 친다 — 바닥이 무너진다!!', c: '#ff6b6b', big: 1 }); setTimeout(() => Rd.st === 'fight' && kgOrbs(Rd, 1), 6000); }
  if (Rd.wipeAt) {
    const left = Rd.wipeAt - t;
    if (left < 10000 && Rd.wipeWarn < 1) { Rd.wipeWarn = 1; for (const q of rmem(Rd)) send(q, { t: 'notice', m: '⏳ 대파멸까지 10초!!', c: '#ff8787', big: 1 }); }
    if (left < 5000 && Rd.wipeWarn < 2) { Rd.wipeWarn = 2; for (const q of rmem(Rd)) send(q, { t: 'notice', m: '⏳ 대파멸까지 5초!!!', c: '#ff6b6b', big: 1 }); }
    if (left <= 0) { Rd.wipeAt = 0; bc(m.id, { t: 'shake', ms: 1500 }); for (const q of rAlive(Rd)) damagePlayer(q, Math.round(q.mhp * .9), null); for (const o of m.mobs) if (/^kg_c/.test(MON[o.t].id)) o.dead = 1; m.mobs = m.mobs.filter(o => !o.dead); b.inv = 0; b.shield = 0; for (const q of rmem(Rd)) send(q, { t: 'notice', m: '☠️ 흑철의 대파멸!!! (HP 90% 피해)', c: '#ff0000', big: 1 }); rTalk(Rd, b, '하하하하!! 이것이 흑철이다!!'); }
  }
  if (tk % 5 === 0) kgStag(Rd);
}
function kgAttack(Rd, t) {
  const m = MAPS[Rd.map], b = rBoss(Rd, 'kargon'); if (!b) { Rd.next = t + 800; return; }
  if (b.groggy > t) { Rd.next = t + 800; return; }
  const c = Rd.cnt = (Rd.cnt || 0) + 1, ph = Rd.ph, D = ph >= 4 ? 1.3 : 1, w = ph >= 4 ? 1000 : 1300;
  const front = { x: b.x + Math.cos(b.fa) * 10, y: b.y + Math.sin(b.fa) * 10 }, back = { x: b.x - Math.cos(b.fa) * 10, y: b.y - Math.sin(b.fa) * 10 };
  const k = c % 4;
  if (k === 0) { warnT(Rd, coneT(b, front, 7, .6), w, 2400 * D, '#e03131'); rTalk(Rd, b, pick(['베어버린다!!', '흑철 내려찍기!!'])); }
  if (k === 1) { warnT(Rd, coneT(b, back, 6, .75), w, 1900 * D, '#ff922b', { stun: 800 }); rTalk(Rd, b, '뒤에 있는 놈들!! 꼬리치기!!'); }
  if (k === 2) { warnT(Rd, coneT(b, front, 6, .5), w, 2200 * D, '#e03131'); setTimeout(() => Rd.st === 'fight' && warnT(Rd, circleT(b.x, b.y, 4.5), w, 1700 * D, '#c92a2a'), 700); rTalk(Rd, b, '흑철 회전베기!!'); }
  if (k === 3) { const tank = kgAggro(Rd, b), cand = rAlive(Rd).filter(q => q !== tank), q = cand.length ? pick(cand) : tank; if (q) { warnT(Rd, circleT(q.x, q.y, 2.5), w + 300, 2000 * D, '#862e9c', { stun: 1000 }); setTimeout(() => { if (Rd.st === 'fight' && walk(m, q.x, q.y) && !(b.stun > now())) { b.x = q.x; b.y = q.y; } }, w + 300); rTalk(Rd, b, `${q.name}!! 도망칠 곳은 없다!!`); } }
  if (ph >= 2 && c % 3 === 0) warnT(Rd, randT(m, 6 + ph * 2).flatMap(([x, y]) => circleT(x, y, .9)), 1500, 1300 * D, '#495057');
  Rd.next = t + (ph >= 4 ? 2400 : ph >= 2 ? 3000 : 3400);
}
/* ===================== 🐸 황금떡두꺼비 군단 (매일 오후 8시 KST) =====================
   랜덤 사냥터에 출현. 무적 상태로 날뜀 → 채팅 퀴즈를 GT_QUIZ_MS 안에 맞히면 12초 기절(피해 가능) → 못 맞히면 다시 무적 + 폭주 */
const GT_HOUR_UTC = 11, GT_QUIZ_MS = 3000, GT_DUR = 30 * 60000;
const QUIZ = [
  ['[만화 대사] "해적왕이 될 거야!" 를 외치는 밀짚모자 주인공은?', ['루피', '몽키디루피', '몽키D루피']],
  ['[만화 대사] "진실은 언제나 하나!" 를 외치는 꼬마 탐정은?', ['코난', '에도가와코난', '남도일']],
  ['[만화 대사] "카메하메하!" 를 쏘는 주인공은?', ['손오공', '오공']],
  ['[만화 대사] "피카츄, 너로 정했다!" 를 외치는 주인공은?', ['지우', '한지우', '사토시']],
  ['[만화 대사] "왼손은 거들 뿐" 의 빨간 머리 농구 천재는?', ['강백호', '백호', '사쿠라기하나미치']],
  ['[만화 대사] "포기하면 그 순간이 바로 시합 종료예요" 를 말한 감독님은?', ['안선생님', '안감독', '안자이', '안자이선생님']],
  ['[만화 대사] "달님을 대신해서 혼내주겠다!" 를 외치는 주인공은?', ['세일러문', '세라', '세일러문세라']],
  ['[만화 대사] "호이~ 호이~" 하는 아기공룡은?', ['둘리', '아기공룡둘리']],
  ['[만화 대사] "도와줘~ 도라에몽!" 하고 우는 안경 쓴 아이는?', ['진구', '노진구', '노비타']],
  ['[만화 대사] "다 덤벼라 믹키유천~" 같은 장난꾸러기, 엉덩이춤 추는 5살 주인공은?', ['짱구', '신짱구']],
  ['[만화 대사] "나는 신세계의 신이 된다" 데스노트 주인공은?', ['라이토', '야가미라이토', '키라']],
  ['[만화 대사] "Plus Ultra!" 를 외치는 히어로 아카데미아 주인공(별명)은?', ['데쿠', '미도리야', '미도리야이즈쿠']],
  ['[만화 대사] "다 이루어질지니~" 램프의 요정은?', ['지니']],
  ['[만화 대사] "내가 바로 나루토다! 포기 안 해!" 닌자 주인공 이름은?', ['나루토', '우즈마키나루토']],
  ['[만화 대사] "더 월드!! 시간이여 멈춰라!" 를 외치는 악역은?', ['디오', 'dio']],
  ['[만화] 디지몬 어드벤처에서 아구몬의 파트너 주인공은?', ['태일', '신태일']],
  ['[만화] 귀멸의 칼날에서 동생 네즈코를 지키는 주인공은?', ['탄지로', '카마도탄지로']],
  ['[만화] 강철의 연금술사 주인공 형 이름은?', ['에드', '에드워드', '에드워드엘릭']],
  ['[만화] "검정 고무신" 의 형 이름은?', ['기영이', '기철이', '이기철']],
  ['[만화] 하니가 달리는 만화 제목은? (달려라 ○○)', ['하니', '달려라하니']],
  ['[부천RPG] 하프마라톤 러너 직업 이름은?', ['박병문']],
  ['[부천RPG] 볼펜을 든 드라큘라 보스는?', ['박휘석']],
  ['[부천RPG] 윤태정이 타는 흰색 말티즈 이름은?', ['밥풀이']],
  ['[부천RPG] 김승현 보스가 던지는 공은?', ['테니스공', '테니스']],
  ['[부천RPG] 천현창과 함께 나오는 잘생긴 쌍둥이는?', ['김도현', '도현']],
  ['[부천RPG] 이소현을 쫓아다니며 잔소리하는 할머니 보스는?', ['김포최명순', '최명순']],
  ['[부천] 부천역은 지하철 몇 호선? (숫자만)', ['1', '1호선', '일호선']],
  ['[부천] 부천에서 열리는 판타스틱 영화제 영어 약자는?', ['bifan', '비판', '바이판']],
  ['[넌센스] 왕이 넘어지면?', ['킹콩']],
  ['[넌센스] 소가 웃으면?', ['우하하', '우하하하']],
  ['[넌센스] 세상에서 가장 뜨거운 과일은?', ['천도복숭아']],
  ['[넌센스] 바나나가 웃으면?', ['바나나킥']],
  ['[넌센스] 개가 사람을 가르치면?', ['개인지도']],
  ['[넌센스] 세상에서 가장 빠른 닭은?', ['후다닥']],
  ['[넌센스] 펭귄이 다니는 중학교는?', ['냉방중', '냉방중학교']],
  ['[넌센스] 아몬드가 죽으면?', ['다이아몬드']],
  ['[넌센스] 반성문을 영어로 하면?', ['글로벌', 'global']],
  ['[계산] 7 × 8 = ?', ['56']], ['[계산] 13 + 29 = ?', ['42']], ['[계산] 100 - 37 = ?', ['63']], ['[계산] 9 × 9 = ?', ['81']]
].map(([q, a]) => ({ q, a }));
const gtNorm = x => String(x).toLowerCase().replace(/[\s!?.~,'"·○()]/g, '');
const gtNext = (t = now()) => { const d = new Date(t), n = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), GT_HOUR_UTC, 0, 0); return n > t ? n : n + 86400000; };
const GT = { st: 'idle', at: gtNext(), map: null, boss: null, quiz: null, next: 0, end: 0, warn: 0, used: [] };
function gtMsg() { const b = GT.boss; return { t: 'gt', st: GT.st, at: GT.at, sn: now(), map: GT.map ? MAPS[GT.map].name : '', hp: b && !b.dead ? Math.round(b.hp / b.mhp * 1000) / 10 : 0, end: GT.end }; }
function gtBlast(m, tiles, ms, dmg, c) {
  tiles = tiles.filter(([x, y]) => x > 0 && y > 0 && x < m.w - 1 && y < m.h - 1); bc(m.id, { t: 'warn', tiles, ms, c });
  setTimeout(() => { const set = new Set(tiles.map(([x, y]) => x + ',' + y)); bc(m.id, { t: 'hz', tiles, c }); for (const q of players.values()) if (q.map === m.id && !q.dead && !inSafe(m, q.x, q.y) && set.has(q.x + ',' + q.y)) damagePlayer(q, Math.max(1, Math.round(dmg - defOf(q) * .3)), null); }, ms);
}
function gtStart(here) {
  if (GT.st === 'on') return;
  const cand = zMaps().filter(m => m.id !== 'sauna'), m = here && here.pool.length ? here : pick(cand);
  const b = spawnBoss(m, 'goldtoad'); const hp = Math.round(topDps() * 1500); b.hp = b.mhp = hp; b.inv = 1; b.until = now() + GT_DUR + 60000; b.gtb = 1;
  for (let i = 0; i < 12; i++) { const o = spawnBoss(m, 'toadling', b); o.until = b.until; }
  Object.assign(GT, { st: 'on', map: m.id, boss: b, quiz: null, next: now() + 9000, end: now() + GT_DUR });
  bc(m.id, { t: 'shake', ms: 1200 }); bc(m.id, { t: 'fx', k: 'boom', x: b.x, y: b.y, r: 6, c: '#fab005' });
  sendAll({ t: 'notice', m: `🐸✨ 황금떡두꺼비 군단이 나타났다!!! 📍 [${m.name}] — 무적 상태로 날뛰는 중! 퀴즈를 맞혀야 피해가 들어가요`, c: '#fab005', big: 1 });
  announce(`🐸 황금떡두꺼비 군단 출현! 📍 ${m.name} · 채팅에 뜨는 퀴즈를 ${GT_QUIZ_MS / 1000}초 안에 맞히면 대왕 떡두꺼비가 기절해요 (그때만 피해 들어감)`);
  sendAll(gtMsg());
}
function gtEnd(msg) {
  if (GT.st !== 'on') return; const m = MAPS[GT.map];
  m.mobs = m.mobs.filter(o => !MON[o.t].gtoad); GT.st = 'idle'; GT.quiz = null; GT.boss = null; GT.map = null; GT.at = gtNext(now() + 3600000); GT.warn = 0;
  if (msg) sendAll({ t: 'notice', m: msg, c: '#ffe066', big: 1 }); sendAll({ t: 'gtq', end: 1 }); sendAll(gtMsg());
}
function gtWin(p, mo, m, add) {
  for (let i = 0; i < 6; i++) add(mkGold(200000)); add(mkScroll('bless', 3)); add(mkScroll('ward', 3)); add(hiddenEquip(pick(['weapon', 'armor', 'helm']), Math.max(80, p.lv)));
  for (const q of players.values()) if (q.map === m.id && !q.dead) { q.gold += 500000; q.dirty = 1; say(q, 'loot', '🐸 황금떡두꺼비 군단 토벌 참여 보상 💰500,000G', '#fab005'); }
  setTimeout(() => gtEnd(`🐸🏆 ${p.name}님이 대왕 황금떡두꺼비를 쓰러뜨렸다!! 황금떡 대잔치!! (참여자 전원 50만G)`), 50);
}
function gtQuiz(t) {
  let i; do { i = R(0, QUIZ.length - 1); } while (GT.used.includes(i) && GT.used.length < QUIZ.length - 1);
  GT.used.push(i); if (GT.used.length > 25) GT.used.shift();
  GT.quiz = { ...QUIZ[i], until: t + GT_QUIZ_MS + 300 };
  sendAll({ t: 'gtq', q: GT.quiz.q, ms: GT_QUIZ_MS, map: MAPS[GT.map].name });
  announce(`🐸 퀴즈! ${GT.quiz.q} (${GT_QUIZ_MS / 1000}초 · 채팅으로 정답)`);
  const b = GT.boss; if (b && !b.dead) bc(GT.map, { t: 'mtalk', id: b.id, m: '문제 나간다 개굴!! ' + GT.quiz.q, loud: 1 });
}
function gtAnswer(p, s) {
  const Q = GT.quiz; if (GT.st !== 'on' || !Q || now() > Q.until || !Q.a.some(a => gtNorm(a) === gtNorm(s))) return;
  const b = GT.boss, t = now(); GT.quiz = null;
  if (b && !b.dead) { b.inv = 0; b.groggy = t + 12000; b.stun = t + 12000; bc(GT.map, { t: 'fx', k: 'boom', x: b.x, y: b.y, r: 4, c: '#69db7c' }); bc(GT.map, { t: 'mtalk', id: b.id, m: '개굴?! 마, 맞혔다고…?!', loud: 1 }); }
  p.gold += 100000; p.dirty = 1;
  sendAll({ t: 'notice', m: `⭕ 정답!! ${p.name}님 — "${Q.a[0]}" · 대왕 떡두꺼비 기절 12초!! 지금 공격!! (정답 보상 10만G)`, c: '#69db7c', big: 1 });
  sendAll({ t: 'gtq', ok: 1, who: p.name, a: Q.a[0] }); GT.next = t + 12000 + 7000;
}
function gtTick(t) {
  if (GT.st === 'idle') {
    if (t >= GT.at) return gtStart();
    const left = GT.at - t;
    if (left < 600000 && GT.warn < 1) { GT.warn = 1; sendAll({ t: 'notice', m: '🐸 10분 뒤 황금떡두꺼비 군단이 부천 어딘가에 나타납니다!! (오후 8시)', c: '#fab005', big: 1 }); }
    if (left < 60000 && GT.warn < 2) { GT.warn = 2; sendAll({ t: 'notice', m: '🐸 1분 뒤 황금떡두꺼비 군단 출현!! 준비하세요!!', c: '#fab005', big: 1 }); }
    if (tk % 300 === 0) sendAll(gtMsg());
    return;
  }
  const b = GT.boss, m = MAPS[GT.map];
  if (!b || b.dead || !m.mobs.includes(b)) { if (GT.st === 'on' && b && !m.mobs.includes(b) && !b.dead) gtEnd('🐸 황금떡두꺼비 군단이 사라졌어요'); return; }
  if (t >= GT.end) return gtEnd('🐸💨 황금떡두꺼비 군단이 황금떡을 들고 도망갔다… 내일 오후 8시에 다시!');
  if (!b.inv && t > b.groggy) { b.inv = 1; bc(m.id, { t: 'mtalk', id: b.id, m: '개구우울!! 다시 무적이다!!', loud: 1 }); }
  if (GT.quiz && t > GT.quiz.until) {
    const Q = GT.quiz; GT.quiz = null; GT.next = t + 10000;
    sendAll({ t: 'notice', m: `❌ 땡!! 정답은 "${Q.a[0]}" — 대왕 떡두꺼비가 무적 상태로 날뛴다!!`, c: '#ff6b6b', big: 1 }); sendAll({ t: 'gtq', ok: 0, a: Q.a[0] });
    gtBlast(m, circleT(b.x, b.y, 5.5), 1200, 1800, '#fab005'); bc(m.id, { t: 'mtalk', id: b.id, m: '틀렸다 개굴!! 떡방아 대폭주!!', loud: 1 });
    for (let k = 0; k < 2; k++) { const o = spawnBoss(m, 'toadling', b); o.until = b.until; }
  }
  if (!GT.quiz && b.inv && t >= GT.next) gtQuiz(t);
  if (b.inv && tk % 40 === 0) { gtBlast(m, randT(m, 10).filter(([x, y]) => Math.hypot(x - b.x, y - b.y) < 12).flatMap(([x, y]) => circleT(x, y, 1.2)), 1400, 1300, '#ffd43b'); }
  if (tk % 20 === 0) sendAll(gtMsg());
}
/* ===================== 🎅 산타 레이드 ===================== */
function santaRudolphs(Rd) { const m = MAPS[Rd.map]; for (const [x, y] of [[4, 4], [m.w - 5, 4], [4, m.h - 5], [m.w - 5, m.h - 5]]) rSpawn(Rd, 'rudolph', x, y, { sz: .3 }); }
function santaTick(Rd, t) {
  const b = rBoss(Rd, 'santa'); if (!b) return;
  const left = MAPS[Rd.map].mobs.some(o => !o.dead && MON[o.t].id === 'rudolph');
  if (Rd.ph === 1) {
    if (b.hp < b.mhp * .55) { Rd.ph = 2; for (const o of MAPS[Rd.map].mobs) if (MON[o.t].id === 'rudolph') o.dead = 1; MAPS[Rd.map].mobs = MAPS[Rd.map].mobs.filter(o => !o.dead); b.air = 0; b.groggy = 0; b.stun = 0; b.shield = 1; b.inv = 1; Rd.plateAt = t + 2500; rMood(Rd, 'snow'); for (const q of rmem(Rd)) send(q, { t: 'notice', m: '🎅 산타가 화났다!! 마법 보호막 — 굴뚝(노란 발판) 3개를 3명이 동시에 2초 밟으세요!! (2페이즈)', c: '#ff6b6b', big: 1 }); rTalk(Rd, b, '이제 장난은 끝이다!! 호호… 호!!'); return; }
    if (!left && b.groggy && t > b.groggy) { b.groggy = 0; b.inv = 1; b.air = 1; santaRudolphs(Rd); rTalk(Rd, b, '루돌프!! 다시 출동!!'); rHint(Rd, '🦌 루돌프가 다시 나타났다! 4마리를 모두 잡으세요'); }
  }
  if (Rd.ph === 2 && b.hp < b.mhp * .2 && !Rd.enr) { Rd.enr = 1; Rd.ph = 3; rMood(Rd, 'dark'); for (const q of rmem(Rd)) send(q, { t: 'notice', m: '🎄 크리스마스의 악몽!! 산타 폭주 (3페이즈)', c: '#e03131', big: 1 }); rTalk(Rd, b, '모두 나쁜 아이 명단에 올려주마!!!'); }
}
function santaAttack(Rd, t) {
  const m = MAPS[Rd.map], b = rBoss(Rd, 'santa'); if (!b) { Rd.next = t + 800; return; }
  if (b.groggy > t) { Rd.next = t + 800; return; }
  const c = Rd.cnt = (Rd.cnt || 0) + 1, ph = Rd.ph, D = ph === 3 ? 1.35 : 1, al = rAlive(Rd);
  warnT(Rd, randT(m, 8 + ph * 4).flatMap(([x, y]) => circleT(x, y, 1)), 1400, 800 * D, '#e03131'); // 선물 폭탄
  if (c % 2 === 0) { for (const q of al.slice(0, 3)) warnT(Rd, lineT(m, b.x, b.y, q, 18), 1300, 950 * D, '#a5d8ff', { stun: 700 }); rTalk(Rd, b, '눈덩이 받아라!!'); }
  if (ph >= 2 && c % 3 === 1) { const mk2 = al.sort(() => Math.random() - .5).slice(0, Math.min(2, Math.max(1, al.length - 1))); for (const q of mk2) { bc(m.id, { t: 'mark', id: q.id, ms: 4000 }); send(q, { t: 'notice', m: '🪨 나쁜 아이 석탄 표식! 4초 뒤 폭발 — 다른 사람과 떨어지세요!', c: '#ff922b', big: 1 }); setTimeout(() => { if (Rd.st === 'fight' && q.map === m.id && !q.dead) warnT(Rd, circleT(q.x, q.y, 2.5), 500, 1300 * D, '#343a40'); }, 3500); } rTalk(Rd, b, '나쁜 아이에겐 석탄이다!!'); }
  if (ph >= 2 && c % 4 === 2) { for (const q of al) q.bf.spd = [0.45, t + 4000]; bc(m.id, { t: 'shake', ms: 600 }); for (const q of rmem(Rd)) say(q, 'sys', '❄️ 눈보라! 4초 동안 느려져요'); }
  if (ph === 3 && c % 2 === 0) { const sq = R(0, 3), tiles = []; for (let y = 1; y < m.h - 1; y++) for (let x = 1; x < m.w - 1; x++) { const qd = (x < (m.w >> 1) ? 0 : 1) + (y < (m.h >> 1) ? 0 : 2); if (qd !== sq) tiles.push([x, y]); } warnT(Rd, tiles, 2400, 1400, '#c92a2a'); rTalk(Rd, b, '선물 폭탄 대방출!!! 안전한 곳은 한 곳뿐!!'); }
  Rd.next = t + (ph === 1 ? 3800 : ph === 2 ? 3300 : 2800);
}

/* ===================== 접속/메시지 ===================== */
const app = express(); app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app); const wss = new WebSocketServer({ server, maxPayload: 8192 });
const INIT = { t: 'init', TIER1_LV, TUNA: { need: TUNA_RECIPE, gold: TUNA_GOLD }, NPCS: Object.fromEntries(Object.entries(NPCS).map(([k, v]) => [k, { n: v.n, map: (Object.values(MAPS).find(m => (m.npcs || []).some(n => n.id === k)) || {}).name }])), VILLAGES: Object.fromEntries(FK.map(f => [f, VILLAGE[f].dir])), MAPLIST: Object.values(MAPS).map(m => ({ id: m.id, n: m.name, lvr: m.lvr, boss: m.boss })), RAIDS: Object.fromEntries(Object.entries(RAIDS).map(([k, r]) => [k, { n: r.n, lv: r.lv }])), TITLES: Object.fromEntries(Object.entries(TITLES).map(([k, v]) => [k, { n: v.n, c: v.c }])), RECIPES: Object.fromEntries(Object.entries(RECIPES).map(([k, v]) => [k, { n: v.n, e: v.e, need: v.need, gold: v.gold, desc: v.desc }])), GBUFF: Object.fromEntries(Object.values(BEASTS).map(B => [B.gb, { e: B.e, n: B.n, buff: B.buff }])), MAXLV, MON: MON.map(m => ({ gb: m.gbeast, hw: m.hwang, guard: m.guard, zev: m.zev, pet: m.pet, raid: m.raid, big: m.big, look: m.look, skn: m.sk && m.sk.n, id: m.id, n: m.n, s: m.s, c: m.c, boss: m.boss, lv: m.lv })), RAR, WB, AB, HB, FAC, VAR, SHOP, QUESTS, MAXINV, JOBS: Object.fromEntries(Object.entries(JOBS).map(([k, j]) => [k, { n: j.n, icon: j.icon, tier: j.tier, d: j.d, sk: j.sk, hp: j.hp, atk: j.atk, mp: j.mp }])) };
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
  const TT = TITLES[p.title];
  if (TT) { sendAll({ t: 'notice', m: TT.enter(`[${FAC[p.faction].n}] ${name}`), c: TT.c, big: TT.big || 0 }); setTimeout(() => players.has(p.id) && bc(p.map, { t: 'fx', k: 'abuff', x: p.x, y: p.y, r: 2.5, c: TT.c, n: TT.n, i: p.id }), 800); }
  else sendAll({ t: 'notice', m: `👋 [${FAC[p.faction].n}] ${name}님이 입장하셨습니다`, c: FAC[p.faction].c, small: 1 });
  if (ZEV.on) setTimeout(zevStatus, 300);
  setTimeout(() => send(p, gtMsg()), 400);
  sendWho();
}
function onMsg(p, m) {
  const t = now(), mp = MAPS[p.map];
  switch (m.t) {
    case 'mv': {
      if (p.dead || t < p.mvAt || t < p.stun) return; const d = m.d | 0; if (d < 0 || d > 3) return; p.d = d;
      const nx = p.x + DX[d], ny = p.y + DY[d]; if (!walk(mp, nx, ny)) return; // 플레이어는 몬스터/다른 플레이어를 통과
      p.x = nx; p.y = ny; p.mvAt = p.fast ? t + 40 : t + Math.round(150 / (bm(p, 'spd') * (FAC[p.faction].spd || 1) * (p.mount ? MOUNT_SPD : 1) * (p.gb && p.gb.bh ? 1.1 : 1))) - 25;
      if (mp.t[ny][nx] === 'X') { templeFall(p); break; }
      const po = mp.portals.find(q => q.x === p.x && q.y === p.y); if (po) warp(p, po.to, po.tx, po.ty);
      break;
    }
    case 'atk': basicAttack(p); break;
    case 'sk': castSkill(p, m.i | 0); break;
    case 'chat': {
      let s = String(m.m || '').slice(0, 80).trim(); if (!s) return;
      if (p.admin) { if (s === '/boss') { spawnBoss(mp); return; } if (s.startsWith('/lv ')) { p.lv = Math.min(MAXLV, +s.slice(4) || 1); p.exp = 0; stats(p); p.hp = p.mhp; p.dirty = 1; return; } if (s.startsWith('/go ')) { const mm = MAPS[s.slice(4).trim()]; if (mm) warp(p, mm.id, mm.spawn.x + 6, mm.spawn.y); return; } if (s.startsWith('/give ')) { const o = [...players.values()].find(q => q.name === s.slice(6).trim()); if (o) { o.lv = Math.max(o.lv, 1); giveItem(o, genEquip(20, true)); } return; } if (s === '/gold') { p.gold += 100000; p.dirty = 1; return; } if (s === '/scroll') { giveItem(p, mkScroll('enh', 20)); giveItem(p, mkScroll('ward', 5)); return; } }
      if (s.startsWith('/w ')) { const [, to, ...r] = s.split(' '); const o = [...players.values()].find(q => q.name === to); if (!o) return say(p, 'sys', '그런 사람이 없어요'); const msg = r.join(' '); say(o, 'w', `${p.name} → 나: ${msg}`); say(p, 'w', `나 → ${o.name}: ${msg}`); return; }
      if (s[0] === '!') s = s.slice(1).trim(); if (!s) return;
      gtAnswer(p, s);
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
    case 'craft': craftItem(p, String(m.k)); break;
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
      if (o.ally) { petTick(m, o, t, i); continue; }
      if (o.dead) { if (o.temp) { m.mobs.splice(i, 1); continue; } if (!o.boss && t > o.respawn) spawnMob(m, o); continue; }
      if (o.boss && t > o.until) { m.mobs.splice(i, 1); continue; }
      if (tp0(o).lshEvent && grandmaEvent(m, o, t)) continue;
      if (tp0(o).tameJob && tameCheck(m, o, t)) continue;
      if (tp0(o).talk && t > (o.talkAt || 0) && players.size) { o.talkAt = t + (o.zombie ? R(8000, 16000) : R(2600, 4200)); bc(m.id, { t: 'mtalk', id: o.id, m: pick(tp0(o).talk) }); }
      if (t < (o.stun || 0)) continue;
      const slowM = t < (o.slow || 0) ? 2.2 : 1;
      const tp = MON[o.t]; let tg = null, bd = 1e9;
      if (o.taunt && t < o.tauntT) { const q = players.get(o.taunt); if (q && q.map === m.id && !q.dead) { tg = q; bd = dist(o, q); } }
      if (!tg) for (const q of players.values()) if (q.map === m.id && !q.dead && !inSafe(m, q.x, q.y)) { const d = dist(o, q), dd = tp.hate && q.job === tp.hate ? d - 4 : d; if (d <= (o.maze ? 5 : o.raid ? 60 : tp.hwang ? 12 : o.zombie ? 22 : o.tgt === q.id || (tp.hate && q.job === tp.hate) ? 9 : 5) && dd < (tg ? (tp.hate && tg.job === tp.hate ? bd - 4 : bd) : 1e9)) { bd = d; tg = q; } }
      if (tg) {
        if (o.boss && tp.sk && t > o.skAt && bd <= tp.sk.r + 0.5) {
          const k = tp.sk; o.skAt = t + (k.cd ? R(k.cd[0], k.cd[1]) : R(6000, 9000));
          if (tp.stunTalk) { bc(m.id, { t: 'mtalk', id: o.id, m: pick(tp.stunTalk), loud: 1 }); o.talkAt = t + 2500; }
          bc(m.id, { t: 'fx', k: 'ring', x: o.x, y: o.y, r: k.r, c: k.c, f: k.fx, n: k.n, mi: o.id });
          for (const q of players.values()) if (q.map === m.id && !q.dead && !inSafe(m, q.x, q.y) && dist(o, q) <= k.r + 0.42) {
            if (k.stun) { q.stun = t + k.stun; } if (k.slow) q.bf.spd = [0.45, t + k.slow];
            damagePlayer(q, Math.max(1, Math.round(((o.atk || tp.atk) * k.m * (0.85 + Math.random() * 0.3) - defOf(q) * 0.4) * (tp.hate && q.job === tp.hate ? tp.hateMul : 1))), null);
          }
          continue;
        }
        if (o.air || o.noMelee) continue;
        if (bd - (o.sz || 0) <= (tp.ranged || 1.42)) { if (t > o.atkAt) { o.atkAt = t + (o.boss ? (tp.ranged ? 1500 : 900) : 1200); if (tp.ranged) bc(m.id, { t: 'fx', k: 'proj', x: o.x, y: o.y, x2: tg.x, y2: tg.y, c: tp.c, f: 'tball', big: 1 }); const hm = tp.hate && tg.job === tp.hate ? tp.hateMul : 1; const dmg = Math.max(1, Math.round(((o.atk || tp.atk) * (0.8 + Math.random() * 0.4) - defOf(tg) * 0.4) * hm)); damagePlayer(tg, dmg, null); if (tp.drain) o.hp = Math.min(o.mhp, o.hp + Math.round(dmg * tp.drain)); if (hm > 1 && tp.hateTalk && Math.random() < .35) bc(m.id, { t: 'mtalk', id: o.id, m: pick(tp.hateTalk), loud: 1 }); bc(m.id, { t: 'fx', k: 'bite', x: tg.x, y: tg.y, c: '#ff6b6b' }); } }
        else if (!o.still && t > o.mvAt) { o.mvAt = t + (o.raid ? 700 : o.zombie ? 420 : o.boss ? 320 : 480) * slowM; const dx = tg.x - o.x, dy = tg.y - o.y; const o1 = Math.abs(dx) > Math.abs(dy) ? [[Math.sign(dx), 0], [0, Math.sign(dy)]] : [[0, Math.sign(dy)], [Math.sign(dx), 0]]; for (const [a, b] of o1) { if (!a && !b) continue; const nx = o.x + a, ny = o.y + b; if (walk(m, nx, ny) && !occ(m, nx, ny, o) && !inSafe(m, nx, ny)) { o.x = nx; o.y = ny; break; } } }
      } else if (t > o.mvAt && Math.random() < 0.04) {
        o.mvAt = t + 600; const d = R(0, 3); let nx = o.x + DX[d], ny = o.y + DY[d]; if (Math.abs(nx - o.hx) > 8 || Math.abs(ny - o.hy) > 8) { nx = o.x + Math.sign(o.hx - o.x); ny = o.y; }
        if (walk(m, nx, ny) && !occ(m, nx, ny, o) && !inSafe(m, nx, ny)) { o.x = nx; o.y = ny; }
        if (o.hp < o.mhp && !tp.hwang && !tp.gbeast && !tp.gtoad) o.hp = Math.min(o.mhp, o.hp + Math.ceil(o.mhp * 0.05));
      }
    }
    for (let i = m.ground.length - 1; i >= 0; i--) if (t > m.ground[i].exp) m.ground.splice(i, 1);
    if (tk % 600 === 0 && m.boss && !ZEV.on && !m.mobs.some(o => o.boss && !o.dead) && Math.random() < (m.fastBoss ? 1 / 20 : 1 / 60)) spawnBoss(m); // 약 1시간에 1번 (1분마다 1/60)
    const ps = []; for (const p of players.values()) if (p.map === m.id && !p.dead) ps.push(pubP(p));
    if (ps.length) bc(m.id, { t: 'st', p: ps, m: m.mobs.filter(o => !o.dead).map(o => [o.id, o.t, o.x, o.y, o.hp, o.mhp, o.v, o.acc, (t < (o.stun || 0) ? 1 : 0) | (t < (o.slow || 0) ? 2 : 0) | (o.drunk ? 4 : 0) | (o.air ? 8 : 0) | (o.inv ? 16 : 0) | (o.groggy > t ? 32 : 0) | (o.ally ? 64 : 0) | (o.inv ? 16 : 0), o.fa != null ? Math.round(o.fa * 100) / 100 : undefined]), g: m.ground.map(g => [g.id, g.x, g.y, isEq(g.it) ? g.it.r : 0, itemLabel(g.it), t < g.ownT ? g.own : 0, g.it.type === 'gold' ? 1 : isEq(g.it) ? 2 : 0]) });
  }
  if (tk % 10 === 0) for (const p of players.values()) if (p.santa && p.santa < t) { p.santa = 0; stats(p); p.dirty = 1; say(p, 'sys', '🎅 산타의 축복이 끝났어요'); }
  if (tk % 20 === 0) for (const p of players.values()) if (!p.dead) { const k = MAPS[p.map].regen * (p.gb && p.gb.jj ? 2 : 1); p.hp = Math.min(p.mhp, p.hp + Math.ceil(p.mhp * 0.02 * k)); p.mp = Math.min(p.mmp, p.mp + Math.ceil(p.mmp * 0.04 * k)); p.vdirty = 1; }
  for (const p of players.values()) {
    if (p.dirty) { p.dirty = 0; send(p, mePayload(p)); }
    if (p.vdirty && tk % 3 === 0) { p.vdirty = 0; send(p, { t: 'v', hp: p.hp, mhp: p.mhp, mp: p.mp, mmp: p.mmp, exp: p.exp, need: need(p.lv), lv: p.lv, gold: p.gold }); }
  }
  raidTick(t); royaleTick(t); zevTick(t); if (tk % 2 === 0) gtTick(t);
  if (tk % 50 === 0) sendWho();
  if (tk % 300 === 0) flush();
}
const bye = async () => { saving = false; await flush(); process.exit(0); };
process.on('SIGTERM', bye); process.on('SIGINT', bye);
dbInit().catch(e => { console.error('DB 연결 실패:', e.message); process.exit(1); }).then(() => {
  setInterval(tick, 100);
  server.listen(PORT, () => console.log('부천 RPG 서버 시작: http://localhost:' + PORT));
});
