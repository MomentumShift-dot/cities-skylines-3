// ============================================================================
//  데모 도시 생성 — ?demo=1 로 접속하면 자동으로 도시를 만들어 보여준다
// ============================================================================
import { MAP_W, MAP_H } from './core/config.js';
import { makeRng } from './core/utils.js';
import { buildRoad, paintZone, placeBuilding, roadPathTiles, checkBuildingPlacement } from './sim/actions.js';
import { step } from './sim/simulation.js';

export function buildDemoCity(w, months = 14) {
  const c = w.city;
  const oy = w.outside.y;
  const cx = Math.floor(MAP_W / 2), cy = oy;
  c.cash = 3_000_000;
  c.milestone = 13;
  c.xp = 220000;
  for (const b of ['coal','pump','wtp','landfill','clinic','hospital','firehouse','firehq','police',
                   'policehq','elem','high','citypark','post','telecom','busdepot','cityhall','cremat',
                   'library','incin','metro','obstower','plaza','garden','univ'])
    c.devSpent[b] = true;

  const x0 = cx - 19, x1 = cx + 19, y0 = cy - 17, y1 = cy + 17;
  for (let y = y0; y <= y1; y += 5) buildRoad(w, roadPathTiles(x0, y, x1, y), y === cy ? 2 : 0);
  for (let x = x0; x <= x1; x += 5) buildRoad(w, roadPathTiles(x, y0, x, y1), x === cx ? 1 : 0);
  buildRoad(w, roadPathTiles(0, oy, x0, oy), 3);

  const rng = makeRng(w.seed ^ 0x1234abcd);
  const auto = (id, n) => {
    let placed = 0;
    for (let t = 0; t < 12000 && placed < n; t++) {
      const x = 6 + ((rng() * (MAP_W - 14)) | 0);
      const y = 6 + ((rng() * (MAP_H - 14)) | 0);
      if (!checkBuildingPlacement(w, x, y, id) && placeBuilding(w, x, y, id).ok) placed++;
    }
  };
  for (const [id, n] of [['coal',1],['wind',2],['pump',2],['sewage',2],['landfill',1],
                         ['hospital',1],['clinic',1],['firehouse',2],['police',2],['elem',2],['high',1],
                         ['univ',1],['park1',6],['plaza',1],['citypark',1],['post',1],['telecom',2],
                         ['cityhall',1],['cremat',1],['busdepot',1],['busstop',5],['obstower',1]])
    auto(id, n);

  const rect = (ax, ay, bx, by) => {
    const t = [];
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) t.push([x, y]);
    return t;
  };
  paintZone(w, rect(cx - 18, cy - 16, cx - 4, cy - 2), 3);   // 고밀도 주거 (북서)
  paintZone(w, rect(cx - 18, cy + 2, cx - 4, cy + 16), 1);   // 저밀도 주거 (남서)
  paintZone(w, rect(cx - 2, cy - 16, cx + 8, cy - 6), 5);    // 고밀도 상업 (도심)
  paintZone(w, rect(cx - 2, cy - 4, cx + 8, cy + 4), 7);     // 사무 (도심)
  paintZone(w, rect(cx - 2, cy + 6, cx + 8, cy + 16), 2);    // 중밀도 주거
  paintZone(w, rect(cx + 10, cy - 16, cx + 18, cy + 16), 6); // 산업 (동쪽 외곽)

  const ticks = months * 240;
  for (let i = 0; i < ticks; i++) step(w);
  return w;
}
