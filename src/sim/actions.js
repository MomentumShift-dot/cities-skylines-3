// ============================================================================
//  플레이어 액션 — 도로/용도지역/건물 설치 및 철거 (비용·규칙 검사 포함)
// ============================================================================
import { ROADS, ZONE_DEF, BUILDING_BY_ID, MILESTONES } from '../core/config.js';
import {
  idx, inBounds, isOwned, areaFree, touchesRoad, nearWater, addBuilding, removeBuilding,
  buildingAt, markGroundDirty, defOf,
} from '../core/world.js';
import { buildingAvailable, zoneAvailable, roadAvailable } from './progression.js';
import { pushNote } from './growth.js';

const BULLDOZE_COST = 4;

function afford(w, cost) { return w.city.cash >= cost; }
function spend(w, cost) { w.city.cash -= cost; }

// ---------------------------------------------------------------------------
//  도로
// ---------------------------------------------------------------------------
export function roadPathTiles(x0, y0, x1, y1) {
  const tiles = [];
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  if (dx >= dy) {
    for (let x = x0; x !== x1 + sx; x += sx) tiles.push([x, y0]);
    for (let y = y0 + sy; y !== y1 + sy; y += sy) tiles.push([x1, y]);
  } else {
    for (let y = y0; y !== y1 + sy; y += sy) tiles.push([x0, y]);
    for (let x = x0 + sx; x !== x1 + sx; x += sx) tiles.push([x, y1]);
  }
  return tiles;
}

export function roadTileCost(w, x, y, typeIdx) {
  if (!inBounds(x, y) || !isOwned(w, x, y)) return null;
  const i = idx(x, y);
  const rd = ROADS[typeIdx];
  if (w.road[i] === typeIdx + 1) return 0;
  let cost = rd.cost;
  if (w.water[i]) cost *= 4;                    // 교량
  if (w.bidx[i] > 0) cost += BULLDOZE_COST * 4; // 기존 건물 철거
  return cost;
}

export function estimateRoad(w, tiles, typeIdx) {
  let cost = 0, valid = 0;
  for (const [x, y] of tiles) {
    const c = roadTileCost(w, x, y, typeIdx);
    if (c === null) continue;
    cost += c; valid++;
  }
  return { cost, valid, total: tiles.length };
}

export function buildRoad(w, tiles, typeIdx) {
  if (!roadAvailable(w, typeIdx)) return { ok: false, msg: '아직 해금되지 않은 도로입니다.' };
  const est = estimateRoad(w, tiles, typeIdx);
  if (!est.valid) return { ok: false, msg: '건설할 수 없는 위치입니다.' };
  if (!afford(w, est.cost)) return { ok: false, msg: '자금이 부족합니다.' };
  spend(w, est.cost);

  let placed = 0, minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
  for (const [x, y] of tiles) {
    if (!inBounds(x, y) || !isOwned(w, x, y)) continue;
    const i = idx(x, y);
    const b = buildingAt(w, x, y);
    if (b) removeBuilding(w, b);
    if (w.road[i] === 0) w.city.stats.roadTiles++;
    w.road[i] = typeIdx + 1;
    w.tree[i] = 0;
    w.zone[i] = 0;
    placed++;
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  if (placed) {
    markGroundDirty(w, minX, minY, maxX, maxY);
    w.netDirty = true;
    w.city.xp += placed * 1.5;
  }
  return { ok: true, cost: est.cost, placed };
}

export function removeRoad(w, tiles) {
  let refund = 0, minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, n = 0;
  for (const [x, y] of tiles) {
    if (!inBounds(x, y)) continue;
    const i = idx(x, y);
    if (!w.road[i]) continue;
    refund += ROADS[w.road[i] - 1].cost * 0.15;
    w.road[i] = 0;
    w.city.stats.roadTiles--;
    n++;
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  if (n) {
    w.city.cash += refund;
    markGroundDirty(w, minX, minY, maxX, maxY);
    w.netDirty = true;
  }
  return { ok: n > 0, removed: n };
}

// ---------------------------------------------------------------------------
//  용도지역
// ---------------------------------------------------------------------------
export function paintZone(w, tiles, zoneId) {
  if (zoneId !== 0 && !zoneAvailable(w, zoneId))
    return { ok: false, msg: '아직 해금되지 않은 용도지역입니다.' };
  const zd = ZONE_DEF[zoneId];
  let cost = 0;
  const targets = [];
  for (const [x, y] of tiles) {
    if (!inBounds(x, y) || !isOwned(w, x, y)) continue;
    const i = idx(x, y);
    if (w.water[i] || w.road[i]) continue;
    if (w.zone[i] === zoneId) continue;
    if (zoneId !== 0 && w.bidx[i] > 0) continue;
    targets.push([x, y, i]);
    cost += zoneId === 0 ? 1 : (zd.cost || 0);
  }
  if (!targets.length) return { ok: false, msg: null };
  if (!afford(w, cost)) return { ok: false, msg: '자금이 부족합니다.' };
  spend(w, cost);

  let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
  for (const [x, y, i] of targets) {
    // 다른 용도로 바뀌면 기존 성장 건물은 철거
    const b = buildingAt(w, x, y);
    if (b && b.kind === 'growth' && b.zone !== zoneId) removeBuilding(w, b);
    w.zone[i] = zoneId;
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  markGroundDirty(w, minX, minY, maxX, maxY);
  return { ok: true, cost };
}

// ---------------------------------------------------------------------------
//  서비스 건물
// ---------------------------------------------------------------------------
export function checkBuildingPlacement(w, x, y, defId) {
  const d = BUILDING_BY_ID[defId];
  if (!d) return '알 수 없는 건물';
  if (w.city.milestone < (d.unlock || 0)) return `마일스톤 「${MILESTONES[d.unlock].name}」 필요`;
  if (!buildingAvailable(w, defId)) {
    if (d.dp && !w.city.devSpent[defId]) return `개발 포인트 ${d.dp} 필요 (개발 트리)`;
    if (d.requires === 'bus') return '버스 차고지가 필요합니다';
    if (d.unique) return '이미 건설된 고유 건물입니다';
    return '사용할 수 없습니다';
  }
  if (!areaFree(w, x, y, d.w, d.h)) return '부지를 확보할 수 없습니다';
  if (!d.noRoad && !touchesRoad(w, x, y, d.w, d.h)) return '도로에 접해야 합니다';
  if (d.needsWater && !nearWater(w, x, y, d.w, d.h, 4)) return '수변에 건설해야 합니다';
  if (w.city.cash < d.cost) return '자금이 부족합니다';
  return null;
}

export function placeBuilding(w, x, y, defId) {
  const err = checkBuildingPlacement(w, x, y, defId);
  if (err) return { ok: false, msg: err };
  const d = BUILDING_BY_ID[defId];
  spend(w, d.cost);
  const b = addBuilding(w, { x, y, w: d.w, h: d.h, kind: 'service', defId });
  b.jobsCount = d.jobs || 0;
  w.city.stats.built++;
  w.city.xp += Math.max(8, d.cost / 260);
  w.netDirty = true;
  return { ok: true, building: b };
}

// ---------------------------------------------------------------------------
//  철거
// ---------------------------------------------------------------------------
export function bulldozeTile(w, x, y) {
  if (!inBounds(x, y) || !isOwned(w, x, y)) return { ok: false };
  const i = idx(x, y);
  const b = buildingAt(w, x, y);
  if (b) {
    const d = defOf(b);
    const refund = b.kind === 'service' ? (d.cost || 0) * 0.2 : 0;
    removeBuilding(w, b);
    w.city.cash += refund - BULLDOZE_COST;
    w.city.stats.bulldozed++;
    return { ok: true, type: 'building' };
  }
  if (w.road[i]) { removeRoad(w, [[x, y]]); return { ok: true, type: 'road' }; }
  if (w.zone[i]) { w.zone[i] = 0; markGroundDirty(w, x, y, x, y); return { ok: true, type: 'zone' }; }
  if (w.tree[i]) {
    w.tree[i] = 0; w.city.cash -= 1;
    markGroundDirty(w, x, y, x, y);
    return { ok: true, type: 'tree' };
  }
  return { ok: false };
}
