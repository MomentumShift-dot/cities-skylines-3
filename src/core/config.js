// ============================================================================
//  Cities: Skylines III — 게임 데이터 / 밸런스 정의
//  (모든 수치는 게임 밸런스용 상수. DOM 의존 없음 → 노드에서도 로드 가능)
// ============================================================================

/** 맵 크기(셀). 1셀 = 8m 가정 → 120셀 = 960m */
export const MAP_W = 120;
export const MAP_H = 120;

/** 지면 텍스처 1셀당 픽셀(아이소 투영 전 그리드 공간 해상도) */
export const GS = 16;
/** 아이소 타일 화면 크기 */
export const TW = 64;
export const TH = 32;

/** 확장 구역(섹터) — 6 x 6 = 36개 */
export const SECTOR = 20;
export const SECTORS_X = MAP_W / SECTOR;
export const SECTORS_Y = MAP_H / SECTOR;

/** 시간: 1일 = 8틱, 1개월 = 30일 */
export const TICKS_PER_DAY = 8;
export const DAYS_PER_MONTH = 30;
export const TICKS_PER_MONTH = TICKS_PER_DAY * DAYS_PER_MONTH;

export const SPEEDS = [0, 1, 3, 9];          // 일시정지 / 1x / 2x / 3x
export const TICK_MS = 90;                    // 1x 기준 1틱 주기(ms)

// ---------------------------------------------------------------------------
//  용도지역(Zoning)
// ---------------------------------------------------------------------------
export const ZONE = {
  NONE: 0, RES_LOW: 1, RES_MED: 2, RES_HIGH: 3,
  COM_LOW: 4, COM_HIGH: 5, IND: 6, OFF: 7,
};

/**
 * cap    : 레벨 1~5 수용량(주거=거주민, 그 외=일자리)
 * height : 레벨별 건물 높이(px)
 * edu    : 일자리 학력 요구 비율 [저학력, 중학력, 고학력]
 * lvReq  : 레벨업에 필요한 토지가치
 */
export const ZONE_DEF = [
  { id: 0, key: 'NONE', name: '없음', cat: 'none', size: 1, color: '#000' },
  {
    id: 1, key: 'RES_LOW', name: '저밀도 주거', short: '저주', cat: 'res', size: 1,
    color: '#4ec863', tint: 'rgba(78,200,99,.40)', cost: 6, unlock: 0,
    cap: [4, 6, 8, 10, 12], height: [15, 18, 22, 26, 31], lvReq: [0, 26, 42, 58, 74],
    palette: ['#d9cfc0', '#e3d7c4', '#cfc6b6', '#e6ddcd', '#d3ccc0'],
    roofs: ['#a4534a', '#8d6f5e', '#7c5f57', '#9a5d4f', '#6f6357'],
  },
  {
    id: 2, key: 'RES_MED', name: '중밀도 주거', short: '중주', cat: 'res', size: 2,
    color: '#37b04f', tint: 'rgba(55,176,79,.40)', cost: 9, unlock: 4,
    cap: [24, 32, 42, 54, 68], height: [34, 44, 56, 68, 82], lvReq: [0, 32, 48, 64, 80],
    palette: ['#cdc3b4', '#dcd3c2', '#c4bcae', '#d8cfbe', '#c9c2b6'],
    roofs: ['#8d7a6c', '#7f7164', '#9a7a6a', '#7a7268', '#6f6a62'],
  },
  {
    id: 3, key: 'RES_HIGH', name: '고밀도 주거', short: '고주', cat: 'res', size: 2,
    color: '#1f9440', tint: 'rgba(31,148,64,.40)', cost: 12, unlock: 9,
    cap: [54, 76, 102, 134, 172], height: [58, 82, 110, 144, 184], lvReq: [0, 40, 56, 70, 84],
    palette: ['#b9c2c6', '#c8d0d4', '#aeb8be', '#c2cbd0', '#b3bcc2'],
    roofs: ['#7c848b', '#727a80', '#868e94', '#6b7278', '#798187'],
  },
  {
    id: 4, key: 'COM_LOW', name: '저밀도 상업', short: '저상', cat: 'com', size: 1,
    color: '#57a6f5', tint: 'rgba(87,166,245,.40)', cost: 7, unlock: 0,
    cap: [5, 7, 9, 11, 14], height: [17, 20, 24, 28, 33], lvReq: [0, 26, 42, 58, 74],
    edu: [0.35, 0.45, 0.20],
    palette: ['#e2ddd2', '#dfe4ea', '#e8ddc9', '#d8e0e6', '#eee6d8'],
    roofs: ['#5c7fa0', '#6b8398', '#7d8a93', '#557a99', '#6d7f8c'],
  },
  {
    id: 5, key: 'COM_HIGH', name: '고밀도 상업', short: '고상', cat: 'com', size: 2,
    color: '#2f77d8', tint: 'rgba(47,119,216,.40)', cost: 12, unlock: 10,
    cap: [26, 36, 48, 62, 80], height: [44, 60, 78, 98, 124], lvReq: [0, 40, 56, 70, 84],
    edu: [0.28, 0.45, 0.27],
    palette: ['#9fc0d8', '#b6cfe2', '#8fb3cd', '#a9c6dc', '#96b8d2'],
    roofs: ['#5f7f98', '#6b8ba3', '#557389', '#648299', '#5a7a90'],
  },
  {
    id: 6, key: 'IND', name: '산업', short: '산업', cat: 'ind', size: 2,
    color: '#e6a92c', tint: 'rgba(230,169,44,.40)', cost: 8, unlock: 0,
    cap: [30, 40, 52, 66, 82], height: [24, 30, 37, 45, 54], lvReq: [0, 20, 34, 48, 62],
    edu: [0.60, 0.30, 0.10],
    palette: ['#c7bfae', '#bdb6a8', '#cdc4b2', '#b6afa2', '#c2b9a8'],
    roofs: ['#8a8272', '#7d7668', '#948b79', '#6f6a5e', '#847c6d'],
  },
  {
    id: 7, key: 'OFF', name: '사무', short: '사무', cat: 'off', size: 2,
    color: '#8a6ae8', tint: 'rgba(138,106,232,.40)', cost: 11, unlock: 12,
    cap: [24, 34, 46, 60, 76], height: [48, 66, 86, 110, 138], lvReq: [0, 42, 58, 72, 86],
    edu: [0.05, 0.30, 0.65],
    palette: ['#8fa8bd', '#9db6c9', '#7f99ae', '#93adc2', '#88a2b7'],
    roofs: ['#556b7f', '#5f7589', '#4d6375', '#5b7083', '#526777'],
  },
];

export const ZONE_LIST = ZONE_DEF.slice(1);

// ---------------------------------------------------------------------------
//  도로
// ---------------------------------------------------------------------------
export const ROADS = [
  {
    id: 'small', name: '2차선 도로', cost: 16, upkeep: 0.5, cap: 1400, speed: 1.0,
    width: 0.52, unlock: 0, color: '#4b4b53', edge: '#6a6a73', line: '#d8d8d8',
    noise: 0.5, zoneReach: 4,
  },
  {
    id: 'medium', name: '4차선 도로', cost: 34, upkeep: 1.1, cap: 3200, speed: 1.25,
    width: 0.70, unlock: 2, color: '#464650', edge: '#65656f', line: '#e2e2e2',
    noise: 0.9, zoneReach: 4,
  },
  {
    id: 'avenue', name: '6차선 대로', cost: 66, upkeep: 2.0, cap: 5400, speed: 1.45,
    width: 0.86, unlock: 5, color: '#42424c', edge: '#61616b', line: '#ececec',
    median: true, noise: 1.4, zoneReach: 4,
  },
  {
    id: 'highway', name: '고속도로', cost: 120, upkeep: 3.4, cap: 9500, speed: 1.95,
    width: 0.92, unlock: 7, color: '#3b3b45', edge: '#5a5a64', line: '#f0e58a',
    median: true, noise: 2.4, noZone: true, zoneReach: 0,
  },
];

// ---------------------------------------------------------------------------
//  서비스 건물
//  cat  : power water garbage health fire police edu park transport comm gov unique
//  dp   : 개발 포인트 비용(0이면 마일스톤만 충족하면 즉시 사용 가능)
//  svc  : { kind, radius, capacity }
// ---------------------------------------------------------------------------
export const BUILDINGS = [
  // ---- 전력 -------------------------------------------------------------
  { id:'wind',    name:'풍력 발전기',   cat:'power', icon:'🌬️', w:2,h:2, cost:6000,  upkeep:90,  unlock:0, dp:0,
    power:6,  noise:1.2, color:'#e9eef2', roof:'#cfd8de', height:56, shape:'tower' },
  { id:'coal',    name:'석탄 화력 발전소', cat:'power', icon:'🏭', w:4,h:4, cost:42000, upkeep:620, unlock:3, dp:2,
    power:40, air:9, ground:5, noise:2.6, jobs:40, color:'#9aa0a6', roof:'#7d848a', height:40, shape:'plant' },
  { id:'gas',     name:'가스 화력 발전소', cat:'power', icon:'🔥', w:3,h:3, cost:31000, upkeep:430, unlock:5, dp:2,
    power:28, air:4, noise:1.8, jobs:26, color:'#a8aeb4', roof:'#868d93', height:34 },
  { id:'solar',   name:'태양광 발전소', cat:'power', icon:'☀️', w:4,h:4, cost:68000, upkeep:400, unlock:8, dp:3,
    power:32, jobs:12, color:'#2f3a52', roof:'#25406b', height:10, shape:'flat' },
  { id:'nuclear', name:'원자력 발전소', cat:'power', icon:'☢️', w:5,h:5, cost:190000,upkeep:2100, unlock:14, dp:6,
    power:170, ground:2, noise:2, jobs:120, needsWater:true, color:'#c8ccd0', roof:'#a3a8ad', height:62, shape:'plant' },
  { id:'pylon',   name:'송전탑',        cat:'power', icon:'⚡', w:1,h:1, cost:900,   upkeep:10,  unlock:1, dp:0,
    link:14, color:'#8d939a', roof:'#767c83', height:46, shape:'pylon', noRoad:true },

  // ---- 상하수도 ---------------------------------------------------------
  { id:'pump',    name:'취수 펌프장',   cat:'water', icon:'🚰', w:2,h:2, cost:4200, upkeep:70, unlock:0, dp:0,
    water:14, needsWater:true, jobs:8, color:'#b9c6cf', roof:'#8fa2ae', height:18 },
  { id:'wtower',  name:'급수탑',        cat:'water', icon:'💧', w:1,h:1, cost:3200, upkeep:48, unlock:0, dp:0,
    water:6, jobs:2, color:'#d8e2e8', roof:'#9fb4c0', height:44, shape:'tower' },
  { id:'sewage',  name:'하수 방류구',   cat:'water', icon:'🕳️', w:2,h:2, cost:5200, upkeep:95, unlock:0, dp:0,
    sewage:16, needsWater:true, waterPollution:6, jobs:6, color:'#a9a49b', roof:'#867f76', height:14 },
  { id:'wtp',     name:'하수 처리장',   cat:'water', icon:'♻️', w:4,h:3, cost:36000, upkeep:480, unlock:9, dp:3,
    sewage:46, waterPollution:1, ground:1, jobs:38, color:'#b6bcc0', roof:'#8f959a', height:22 },

  // ---- 폐기물 -----------------------------------------------------------
  { id:'landfill',name:'쓰레기 매립지', cat:'garbage', icon:'🗑️', w:4,h:4, cost:12000, upkeep:230, unlock:0, dp:0,
    garbage:22, store:120000, ground:6, air:2, noise:1.2, jobs:20, color:'#8f8a76', roof:'#6f6b5c', height:12, shape:'flat' },
  { id:'incin',   name:'소각장',        cat:'garbage', icon:'🔥', w:4,h:4, cost:38000, upkeep:540, unlock:7, dp:3,
    garbage:44, power:5, air:6, noise:1.6, jobs:44, color:'#a5a099', roof:'#827d76', height:38, shape:'plant' },
  { id:'recycle', name:'재활용 센터',   cat:'garbage', icon:'♻️', w:4,h:4, cost:58000, upkeep:700, unlock:12, dp:4,
    garbage:60, air:1, jobs:60, color:'#93b08e', roof:'#71906d', height:24 },

  // ---- 의료 -------------------------------------------------------------
  { id:'clinic',  name:'진료소',   cat:'health', icon:'🏥', w:2,h:2, cost:3600, upkeep:110, unlock:0, dp:0,
    svc:{kind:'health', radius:22, capacity:600}, jobs:16, color:'#f0f2f4', roof:'#d64b53', height:22 },
  { id:'hospital',name:'병원',     cat:'health', icon:'🏨', w:4,h:4, cost:27000, upkeep:760, unlock:6, dp:2,
    svc:{kind:'health', radius:46, capacity:4200}, jobs:110, color:'#f2f4f6', roof:'#cf4048', height:46 },
  { id:'cemetery',name:'공동묘지', cat:'health', icon:'⚰️', w:3,h:3, cost:6200, upkeep:110, unlock:2, dp:0,
    svc:{kind:'death', radius:26, capacity:3000}, store:9000, jobs:8, color:'#8fa27f', roof:'#6f8262', height:8, shape:'flat' },
  { id:'cremat',  name:'화장장',   cat:'health', icon:'🏛️', w:3,h:3, cost:15000, upkeep:320, unlock:8, dp:2,
    svc:{kind:'death', radius:44, capacity:9000}, air:1, jobs:22, color:'#d5d2cb', roof:'#a09b93', height:26 },

  // ---- 소방 -------------------------------------------------------------
  { id:'firehouse',name:'소방서',   cat:'fire', icon:'🚒', w:2,h:2, cost:5200, upkeep:140, unlock:0, dp:0,
    svc:{kind:'fire', radius:30, capacity:900}, jobs:18, color:'#e9dcd6', roof:'#c0392b', height:22 },
  { id:'firehq',   name:'소방 본부', cat:'fire', icon:'🚨', w:4,h:3, cost:23000, upkeep:600, unlock:9, dp:2,
    svc:{kind:'fire', radius:62, capacity:5000}, jobs:70, color:'#eee1da', roof:'#a93226', height:34 },

  // ---- 경찰 -------------------------------------------------------------
  { id:'police',  name:'파출소',   cat:'police', icon:'👮', w:2,h:2, cost:6200, upkeep:165, unlock:1, dp:0,
    svc:{kind:'police', radius:30, capacity:900}, jobs:20, color:'#dde3ea', roof:'#2c5d9b', height:22 },
  { id:'policehq',name:'경찰서',   cat:'police', icon:'🚓', w:4,h:3, cost:25000, upkeep:640, unlock:9, dp:2,
    svc:{kind:'police', radius:62, capacity:5000}, jobs:80, color:'#dfe6ee', roof:'#22497a', height:36 },

  // ---- 교육 -------------------------------------------------------------
  { id:'elem',    name:'초등학교', cat:'edu', icon:'🏫', w:3,h:3, cost:8500, upkeep:250, unlock:2, dp:0,
    svc:{kind:'edu1', radius:28, capacity:600}, jobs:30, color:'#f0e4c8', roof:'#c8873f', height:20 },
  { id:'high',    name:'고등학교', cat:'edu', icon:'🎓', w:4,h:3, cost:19000, upkeep:520, unlock:5, dp:2,
    svc:{kind:'edu2', radius:42, capacity:1100}, jobs:60, color:'#efe2c4', roof:'#b3762f', height:28 },
  { id:'univ',    name:'대학교',   cat:'edu', icon:'🎓', w:6,h:5, cost:64000, upkeep:1400, unlock:11, dp:4,
    svc:{kind:'edu3', radius:56, capacity:2400}, jobs:180, land:8, color:'#e9dcc0', roof:'#8f5f2a', height:40 },
  { id:'library', name:'도서관',   cat:'edu', icon:'📚', w:3,h:2, cost:11000, upkeep:210, unlock:6, dp:1,
    svc:{kind:'edu2', radius:26, capacity:500}, land:6, jobs:16, color:'#e4dccb', roof:'#7d6a4f', height:22 },

  // ---- 공원 / 여가 ------------------------------------------------------
  { id:'park1',   name:'작은 공원', cat:'park', icon:'🌳', w:1,h:1, cost:900,  upkeep:14, unlock:0, dp:0,
    svc:{kind:'park', radius:12, capacity:1e9}, land:5, color:'#63a55c', roof:'#4f8c4a', height:4, shape:'park' },
  { id:'plaza',   name:'광장',     cat:'park', icon:'⛲', w:2,h:2, cost:2600, upkeep:36, unlock:1, dp:0,
    svc:{kind:'park', radius:18, capacity:1e9}, land:9, color:'#c9c2b2', roof:'#b3ab99', height:3, shape:'park' },
  { id:'playgr',  name:'놀이터',   cat:'park', icon:'🛝', w:2,h:2, cost:1800, upkeep:28, unlock:0, dp:0,
    svc:{kind:'park', radius:16, capacity:1e9}, land:7, color:'#77b46a', height:5, shape:'park' },
  { id:'citypark',name:'도시 공원', cat:'park', icon:'🏞️', w:4,h:4, cost:13000, upkeep:200, unlock:4, dp:1,
    svc:{kind:'park', radius:36, capacity:1e9}, land:16, jobs:12, color:'#4f9a4c', height:6, shape:'park' },
  { id:'garden',  name:'식물원',   cat:'park', icon:'🌷', w:5,h:4, cost:30000, upkeep:420, unlock:10, dp:2,
    svc:{kind:'park', radius:44, capacity:1e9}, land:24, jobs:30, color:'#5fae59', height:14, shape:'park' },

  // ---- 교통 -------------------------------------------------------------
  { id:'busdepot',name:'버스 차고지', cat:'transport', icon:'🚌', w:4,h:3, cost:19000, upkeep:340, unlock:4, dp:1,
    enables:'bus', jobs:40, noise:1, color:'#c9ced3', roof:'#5a8f3f', height:20 },
  { id:'busstop', name:'버스 정류장', cat:'transport', icon:'🚏', w:1,h:1, cost:700, upkeep:16, unlock:4, dp:0,
    svc:{kind:'transit', radius:15, capacity:1e9}, requires:'bus', color:'#9fb7c9', roof:'#4f7f9b', height:8, shape:'small' },
  { id:'metro',   name:'지하철역',   cat:'transport', icon:'🚇', w:2,h:2, cost:26000, upkeep:420, unlock:12, dp:3,
    svc:{kind:'transit', radius:26, capacity:1e9, strength:1.8}, jobs:24, color:'#b9c3cc', roof:'#31567a', height:16 },
  { id:'cargo',   name:'화물 터미널', cat:'transport', icon:'📦', w:5,h:4, cost:42000, upkeep:620, unlock:10, dp:3,
    freight:1, jobs:80, noise:1.8, air:1, color:'#b0a893', roof:'#8b8471', height:18 },

  // ---- 통신 / 행정 ------------------------------------------------------
  { id:'post',    name:'우체국',   cat:'comm', icon:'📮', w:3,h:2, cost:7400, upkeep:180, unlock:3, dp:0,
    svc:{kind:'mail', radius:34, capacity:6000}, jobs:26, color:'#e6dcd0', roof:'#c0392b', height:20 },
  { id:'telecom', name:'통신 기지국', cat:'comm', icon:'📡', w:1,h:1, cost:4200, upkeep:95, unlock:3, dp:0,
    svc:{kind:'telecom', radius:32, capacity:1e9}, color:'#a8aeb5', roof:'#8a9097', height:52, shape:'pylon' },
  { id:'cityhall',name:'시청',     cat:'gov', icon:'🏛️', w:4,h:4, cost:32000, upkeep:450, unlock:3, dp:1,
    unique:true, taxBonus:0.08, land:14, jobs:70, color:'#ece4d4', roof:'#9c7b4a', height:48 },
  { id:'welfare', name:'복지부',   cat:'gov', icon:'🤝', w:3,h:3, cost:21000, upkeep:420, unlock:8, dp:2,
    unique:true, welfare:1, jobs:50, color:'#dfe3e8', roof:'#4a6f8f', height:32 },

  // ---- 시그니처 ---------------------------------------------------------
  { id:'obstower',name:'전망 타워', cat:'unique', icon:'🗼', w:3,h:3, cost:38000, upkeep:380, unlock:6, dp:2,
    unique:true, land:26, tourism:220, jobs:24, color:'#d9dde1', roof:'#b4bbc1', height:130, shape:'tower' },
  { id:'stadium', name:'축구 경기장', cat:'unique', icon:'🏟️', w:6,h:5, cost:95000, upkeep:1300, unlock:13, dp:4,
    unique:true, land:22, tourism:700, svc:{kind:'park', radius:34, capacity:1e9}, jobs:160, noise:2.4,
    color:'#cfd6db', roof:'#3f6fa5', height:44 },
  { id:'convent', name:'컨벤션 센터', cat:'unique', icon:'🏢', w:6,h:4, cost:120000, upkeep:1500, unlock:15, dp:5,
    unique:true, land:20, tourism:900, jobs:220, color:'#c8d2da', roof:'#4d6b86', height:52 },
  { id:'airport', name:'국제공항',   cat:'unique', icon:'✈️', w:8,h:6, cost:220000, upkeep:3200, unlock:16, dp:6,
    unique:true, tourism:2400, freight:2, jobs:420, noise:3.4, air:2, color:'#c6ccd1', roof:'#7f868c', height:22 },
];

export const BUILDING_BY_ID = Object.fromEntries(BUILDINGS.map(b => [b.id, b]));

export const CATEGORY_INFO = {
  road:      { name: '도로',   icon: '🛣️' },
  zone:      { name: '용도지역', icon: '🧱' },
  power:     { name: '전력',   icon: '⚡' },
  water:     { name: '상하수도', icon: '💧' },
  garbage:   { name: '폐기물', icon: '🗑️' },
  health:    { name: '의료',   icon: '🏥' },
  fire:      { name: '소방',   icon: '🚒' },
  police:    { name: '경찰',   icon: '👮' },
  edu:       { name: '교육',   icon: '🎓' },
  park:      { name: '공원',   icon: '🌳' },
  transport: { name: '교통',   icon: '🚌' },
  comm:      { name: '통신',   icon: '📡' },
  gov:       { name: '행정',   icon: '🏛️' },
  unique:    { name: '시그니처', icon: '⭐' },
};

// ---------------------------------------------------------------------------
//  마일스톤 (CS2의 20단계 진행 구조를 차용)
// ---------------------------------------------------------------------------
export const MILESTONES = [
  { name: '개척지',            en: 'Settlement',              xp: 0,       cash: 0,      dp: 0,  permits: 4,  loan: 60000 },
  { name: '아주 작은 마을',    en: 'Tiny Village',            xp: 600,     cash: 25000,  dp: 1,  permits: 3,  loan: 100000 },
  { name: '작은 마을',        en: 'Small Village',           xp: 1800,    cash: 50000,  dp: 2,  permits: 4,  loan: 150000 },
  { name: '큰 마을',          en: 'Large Village',           xp: 4000,    cash: 75000,  dp: 3,  permits: 5,  loan: 200000 },
  { name: '거대 마을',        en: 'Grand Village',           xp: 7500,    cash: 100000, dp: 4,  permits: 6,  loan: 250000 },
  { name: '작은 도시',        en: 'Tiny Town',               xp: 13000,   cash: 125000, dp: 5,  permits: 7,  loan: 400000 },
  { name: '성장하는 도시',    en: 'Boom Town',               xp: 21000,   cash: 150000, dp: 6,  permits: 8,  loan: 500000 },
  { name: '분주한 도시',      en: 'Busy Town',               xp: 32000,   cash: 175000, dp: 7,  permits: 9,  loan: 600000 },
  { name: '큰 도시',          en: 'Big Town',                xp: 47000,   cash: 200000, dp: 8,  permits: 10, loan: 700000 },
  { name: '위대한 도시',      en: 'Great Town',              xp: 67000,   cash: 225000, dp: 9,  permits: 12, loan: 800000 },
  { name: '소도시',           en: 'Small City',              xp: 93000,   cash: 250000, dp: 10, permits: 15, loan: 900000 },
  { name: '대도시',           en: 'Big City',                xp: 126000,  cash: 275000, dp: 11, permits: 18, loan: 1100000 },
  { name: '광역 도시',        en: 'Large City',              xp: 168000,  cash: 300000, dp: 12, permits: 21, loan: 1300000 },
  { name: '거대 도시',        en: 'Huge City',               xp: 220000,  cash: 325000, dp: 13, permits: 24, loan: 1500000 },
  { name: '웅장한 도시',      en: 'Grand City',              xp: 285000,  cash: 350000, dp: 14, permits: 28, loan: 1700000 },
  { name: '메트로폴리스',      en: 'Metropolis',              xp: 365000,  cash: 375000, dp: 15, permits: 32, loan: 1900000 },
  { name: '번영하는 메트로폴리스', en: 'Thriving Metropolis',  xp: 465000,  cash: 400000, dp: 17, permits: 36, loan: 2100000 },
  { name: '융성한 메트로폴리스',  en: 'Flourishing Metropolis', xp: 590000, cash: 425000, dp: 19, permits: 41, loan: 2300000 },
  { name: '광대한 메트로폴리스',  en: 'Expansive Metropolis',  xp: 745000,  cash: 450000, dp: 21, permits: 46, loan: 2600000 },
  { name: '초거대 메트로폴리스',  en: 'Massive Metropolis',    xp: 940000,  cash: 475000, dp: 25, permits: 51, loan: 3000000 },
  { name: '메갈로폴리스',      en: 'Megalopolis',             xp: 1200000, cash: 500000, dp: 30, permits: 56, loan: 4000000 },
];

// ---------------------------------------------------------------------------
//  도시 정책
// ---------------------------------------------------------------------------
export const POLICIES = [
  { id:'recycle',  name:'분리수거 의무화', icon:'♻️', desc:'쓰레기 배출량 22% 감소, 시민 만족도 소폭 상승', costPerPop:0.9, unlock:2 },
  { id:'smokeban', name:'금연 정책',      icon:'🚭', desc:'질병 발생률 25% 감소', costPerPop:0.5, unlock:3 },
  { id:'edusub',   name:'교육 장려금',    icon:'📖', desc:'학교 진학 속도 35% 증가', costPerPop:1.4, unlock:4 },
  { id:'freetransit', name:'대중교통 무료화', icon:'🎫', desc:'대중교통 분담률 크게 상승, 교통량 감소', costPerPop:2.2, unlock:6 },
  { id:'indreg',   name:'산업 공해 규제',  icon:'🏭', desc:'산업 공해 35% 감소, 산업 세수 12% 감소', costPerPop:0.3, unlock:5 },
  { id:'smallbiz', name:'소상공인 지원',   icon:'🏪', desc:'저밀도 상업 수요 상승, 상업 세수 8% 감소', costPerPop:1.1, unlock:4 },
  { id:'powersave',name:'절전 캠페인',    icon:'🔌', desc:'전력 소비 14% 감소', costPerPop:0.6, unlock:3 },
  { id:'solarsub', name:'태양광 보조금',   icon:'🔆', desc:'전력 소비 9% 감소, 토지가치 상승', costPerPop:1.6, unlock:8 },
  { id:'bikelane', name:'자전거 도로',    icon:'🚲', desc:'교통량 12% 감소, 건강·만족도 상승', costPerPop:1.0, unlock:5 },
  { id:'nightpat', name:'야간 순찰 강화',  icon:'🔦', desc:'범죄율 30% 감소', costPerPop:1.2, unlock:6 },
  { id:'highrent', name:'임대료 상한제',   icon:'🏘️', desc:'주거 수요 상승, 주거 세수 10% 감소', costPerPop:0.4, unlock:7 },
  { id:'greenind', name:'첨단산업 전환',   icon:'🧪', desc:'사무 수요 상승, 산업 수요 감소', costPerPop:1.8, unlock:12 },
];

// ---------------------------------------------------------------------------
//  경제 상수
// ---------------------------------------------------------------------------
export const ECON = {
  startCash: 100000,
  taxDefault: { res: 11, com: 11, ind: 11, off: 11 },
  taxMax: 30,
  // 1인/1일자리 당 월 과세표준
  taxBase: { res: 21, com: 26, ind: 24, off: 30 },
  loanInterest: 0.035,      // 월 이자
  roadUpkeepScale: 1.0,
  // 소비/생산
  powerPerRes: 0.0022,      // MW / 명
  powerPerJob: 0.0040,
  waterPerRes: 0.0026,
  waterPerJob: 0.0034,
  garbagePerRes: 0.0135,
  garbagePerJob: 0.0165,
  mailPerRes: 0.9,
  // 유틸리티 요금(월 수입)
  feeMax: 2.0,
};
