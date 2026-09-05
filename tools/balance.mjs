// 밸런스 점검 — 시나리오별 도시를 시뮬레이션하고 지표를 출력한다 (결정론적)
import { createWorld, idx } from '../src/core/world.js';
import { initSim, step } from '../src/sim/simulation.js';
import { buildRoad, paintZone, placeBuilding, roadPathTiles, checkBuildingPlacement } from '../src/sim/actions.js';
import { buildDemoCity } from '../src/demo.js';
import { ZONE_DEF, MAP_W } from '../src/core/config.js';

function report(label, w) {
  const c = w.city;
  const gr = w.buildings.filter(b => b && b.kind === 'growth');
  const cats = {};
  for (const b of gr) { const k = ZONE_DEF[b.zone].cat; cats[k] = (cats[k] || 0) + 1; }
  const lv = {};
  for (const b of gr) lv[b.level] = (lv[b.level] || 0) + 1;
  console.log(`\n── ${label} ────────────────────────────────────`);
  console.log(`인구 ${Math.round(c.population)} / 수용 ${Math.round(c.resCapacity)} ` +
              `(입주율 ${(c.population / Math.max(1, c.resCapacity) * 100).toFixed(0)}%)`);
  console.log(`만족도 ${c.happiness.toFixed(1)} · 건강 ${c.health} · 범죄 ${c.crime.toFixed(0)} ` +
              `· 실업률 ${c.unemployment.toFixed(1)}% · 교통 ${c.trafficFlow}%`);
  console.log(`수요 R${c.demand.res.toFixed(0)} C${c.demand.com.toFixed(0)} ` +
              `I${c.demand.ind.toFixed(0)} O${c.demand.off.toFixed(0)} · 마일스톤 ${c.milestone}`);
  console.log(`건물 ${gr.length}동 ${JSON.stringify(cats)} · 레벨 ${JSON.stringify(lv)} ` +
              `· 폐허 ${gr.filter(b => b.abandoned).length}`);
  console.log(`월수지 ${Math.round(c.lastMonth.net || 0)} · 전력 ${c.power.supply.toFixed(0)}/${c.power.demand.toFixed(1)}` +
              ` · 쓰레기 ${c.garbage.capacity.toFixed(0)}/${c.garbage.produced.toFixed(1)}`);
}

// ① 최소 도시: 전기·물·쓰레기만 갖춘 초기 정착지
{
  const w = createWorld(5); initSim(w);
  const oy = w.outside.y, cx = Math.floor(MAP_W / 2);
  const T = (a, b, c, d) => { const t = []; for (let y = b; y <= d; y++) for (let x = a; x <= c; x++) t.push([x, y]); return t; };
  buildRoad(w, roadPathTiles(cx - 18, oy, cx + 10, oy), 0);
  buildRoad(w, roadPathTiles(cx - 10, oy - 12, cx - 10, oy + 12), 0);
  buildRoad(w, roadPathTiles(cx, oy - 12, cx, oy + 12), 0);
  buildRoad(w, roadPathTiles(cx - 18, oy - 12, cx + 10, oy - 12), 0);
  buildRoad(w, roadPathTiles(cx - 18, oy + 12, cx + 10, oy + 12), 0);
  paintZone(w, T(cx - 16, oy - 10, cx - 2, oy + 10), 1);
  paintZone(w, T(cx + 1, oy - 10, cx + 8, oy - 4), 4);
  paintZone(w, T(cx + 1, oy + 4, cx + 8, oy + 10), 6);
  w.city.cash = 500000;
  const P = (id, x, y) => { if (!checkBuildingPlacement(w, x, y, id)) placeBuilding(w, x, y, id); };
  P('wind', cx - 15, oy - 14); P('wind', cx - 12, oy - 14);
  P('wtower', cx - 8, oy - 13); P('wtower', cx - 6, oy - 13);
  P('landfill', cx + 6, oy + 8); P('park1', cx - 9, oy - 1); P('clinic', cx - 9, oy + 1);
  for (let i = 0; i < 3200; i++) step(w);
  report('① 최소 도시 (13개월, 서비스 최소)', w);
}

// ② 데모 도시: 충분한 서비스와 계획된 용도지역
{
  const w = createWorld(7); initSim(w);
  buildDemoCity(w, 12);
  report('② 계획 도시 (12개월, 서비스 완비)', w);
}
