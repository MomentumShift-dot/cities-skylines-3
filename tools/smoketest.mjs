// 노드 환경에서 시뮬레이션 코어를 검증하는 스모크 테스트 (DOM 미사용)
import { createWorld, idx, isOwned, inBounds } from '../src/core/world.js';
import { initSim, step } from '../src/sim/simulation.js';
import { buildRoad, paintZone, placeBuilding, roadPathTiles, checkBuildingPlacement } from '../src/sim/actions.js';
import { MAP_W, MAP_H } from '../src/core/config.js';

const w = createWorld(12345);
initSim(w);
const oy = w.outside.y;
const cx = Math.floor(MAP_W / 2), cy = oy;
w.city.cash = 5_000_000;
w.city.milestone = 20;           // 전 시설 해금
for (const b of ['coal','pump','wtp','landfill','clinic','firehouse','police','elem','citypark','post','telecom','busdepot','high','hospital','cremat'])
  w.city.devSpent[b] = true;

// --- 격자 도로망 ---------------------------------------------------------
const x0 = cx - 18, x1 = cx + 18, y0 = cy - 18, y1 = cy + 18;
for (let y = y0; y <= y1; y += 6) buildRoad(w, roadPathTiles(x0, y, x1, y), 1);
for (let x = x0; x <= x1; x += 6) buildRoad(w, roadPathTiles(x, y0, x, y1), 0);
buildRoad(w, roadPathTiles(0, oy, x0, oy), 3);

// --- 용도지역 ------------------------------------------------------------
const tilesFor = (ax, ay, bx, by) => {
  const t = [];
  for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) t.push([x, y]);
  return t;
};
paintZone(w, tilesFor(cx - 17, cy - 17, cx - 2, cy - 2), 1);   // 저밀도 주거
paintZone(w, tilesFor(cx + 2, cy - 17, cx + 17, cy - 2), 4);   // 저밀도 상업
paintZone(w, tilesFor(cx - 17, cy + 2, cx - 2, cy + 17), 6);   // 산업
paintZone(w, tilesFor(cx + 2, cy + 2, cx + 17, cy + 17), 1);

// --- 서비스 건물 자동 배치 -------------------------------------------------
function autoPlace(defId, count = 1) {
  let placed = 0;
  for (let t = 0; t < 20000 && placed < count; t++) {
    const x = 10 + ((Math.random() * (MAP_W - 20)) | 0);
    const y = 10 + ((Math.random() * (MAP_H - 20)) | 0);
    if (!checkBuildingPlacement(w, x, y, defId)) {
      if (placeBuilding(w, x, y, defId).ok) placed++;
    }
  }
  return placed;
}
const placedReport = {};
for (const [id, n] of [['coal',1],['pump',2],['sewage',2],['wtower',2],['landfill',1],
                       ['clinic',2],['firehouse',2],['police',2],['elem',2],['park1',10],
                       ['post',1],['telecom',2],['cremat',1]]) {
  placedReport[id] = autoPlace(id, n);
}
console.log('배치 결과:', placedReport);

// --- 시뮬레이션 실행 ------------------------------------------------------
const t0 = Date.now();
const TICKS = 4800;   // 약 20개월
for (let i = 0; i < TICKS; i++) step(w);
const ms = Date.now() - t0;

const c = w.city;
const alive = w.buildings.filter(Boolean);
console.log('---------------------------------------------');
console.log(`${TICKS}틱 실행 ${ms}ms  (틱당 ${(ms / TICKS).toFixed(2)}ms)`);
console.log(`날짜        : ${c.year}년 ${c.month}월 ${c.day}일`);
console.log(`인구        : ${Math.round(c.population)} / 수용 ${Math.round(c.resCapacity)}`);
console.log(`일자리      : ${c.jobsFilled} / ${c.jobs}  실업률 ${c.unemployment.toFixed(1)}%`);
console.log(`만족도      : ${c.happiness.toFixed(1)}   건강 ${c.health}   범죄 ${c.crime.toFixed(1)}`);
console.log(`교통 흐름   : ${c.trafficFlow}%   차량 ${w.cars.length}대`);
console.log(`전력        : ${c.power.supply.toFixed(1)}/${c.power.demand.toFixed(1)} MW`);
console.log(`수도        : ${c.water.supply.toFixed(1)}/${c.water.demand.toFixed(1)}`);
console.log(`하수        : ${c.sewage.capacity.toFixed(1)}/${c.sewage.produced.toFixed(1)}`);
console.log(`쓰레기      : ${c.garbage.capacity.toFixed(1)}/${c.garbage.produced.toFixed(1)} 적재 ${Math.round(c.garbage.stored)}`);
console.log(`자금        : ${Math.round(c.cash)}  수입 ${Math.round(c.income)} 지출 ${Math.round(c.expense)}`);
console.log(`XP/마일스톤 : ${Math.round(c.xp)} / lv ${c.milestone}`);
console.log(`수요 RCI-O  : R${c.demand.res.toFixed(0)} C${c.demand.com.toFixed(0)} I${c.demand.ind.toFixed(0)} O${c.demand.off.toFixed(0)}`);
console.log(`건물 수     : ${alive.length} (성장 ${alive.filter(b=>b.kind==='growth').length}, 서비스 ${alive.filter(b=>b.kind==='service').length}, 폐허 ${alive.filter(b=>b.abandoned).length})`);
console.log(`교육        : 저 ${Math.round(c.education.low)} / 중 ${Math.round(c.education.mid)} / 고 ${Math.round(c.education.high)}`);
console.log(`연령        : 유아 ${Math.round(c.ageGroups.child)} 청소년 ${Math.round(c.ageGroups.teen)} 성인 ${Math.round(c.ageGroups.adult)} 노인 ${Math.round(c.ageGroups.senior)}`);
console.log('최근 알림   :', c.notifications.slice(-5).map(n => n.text));

let fail = 0;
const assert = (cond, msg) => { if (!cond) { console.error('  ❌ ' + msg); fail++; } else console.log('  ✅ ' + msg); };
console.log('---------------------------------------------');
assert(c.population > 200, '인구가 성장했다 (>200)');
assert(alive.filter(b => b.kind === 'growth').length > 60, '성장 건물이 다수 생성되었다');
assert(c.jobs > 100, '일자리가 생성되었다');
assert(Number.isFinite(c.cash), '자금이 유한한 수치다');
assert(c.trafficFlow >= 0 && c.trafficFlow <= 100, '교통 흐름이 0~100 범위다');
assert(c.happiness > 0 && c.happiness <= 100, '만족도가 유효 범위다');
assert(c.xp > 0, 'XP가 누적되었다');
assert(alive.some(b => b.level > 1), '건물 레벨업이 발생했다');
assert(ms / TICKS < 8, '틱당 8ms 미만으로 동작한다');
process.exit(fail ? 1 : 0);
