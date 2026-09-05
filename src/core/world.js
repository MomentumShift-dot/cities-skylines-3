// ============================================================================
//  World — 맵 상태 컨테이너 (지형 생성, 타일 접근, 건물 배치)
//  DOM 의존 없음.
// ============================================================================
import {
  MAP_W, MAP_H, SECTOR, SECTORS_X, SECTORS_Y,
  ZONE, ZONE_DEF, ROADS, BUILDING_BY_ID, ECON, MILESTONES,
} from './config.js';
import { makeNoise2D, makeRng, clamp, clamp01 } from './utils.js';

export const RES = { NONE: 0, FERTILE: 1, FOREST: 2, ORE: 3, OIL: 4 };
export const RES_NAME = ['없음', '비옥한 땅', '삼림', '광물', '석유'];

const N = MAP_W * MAP_H;
export const idx = (x, y) => y * MAP_W + x;
export const inBounds = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

export function createWorld(seed = (Math.random() * 1e9) | 0) {
  const w = {
    seed,
    W: MAP_W, H: MAP_H, N,

    // --- 지형 -------------------------------------------------------------
    height: new Float32Array(N),
    water: new Uint8Array(N),
    shore: new Uint8Array(N),
    tree: new Uint8Array(N),
    resource: new Uint8Array(N),
    variant: new Uint8Array(N),      // 지면 색 변화용 랜덤값

    // --- 플레이어 배치물 ---------------------------------------------------
    road: new Uint8Array(N),         // 0=없음, n=ROADS[n-1]
    zone: new Uint8Array(N),         // ZONE.*
    bidx: new Int32Array(N),         // 0=없음, n=buildings[n-1]
    sectorOwned: new Uint8Array(SECTORS_X * SECTORS_Y),

    // --- 시뮬레이션 필드 ---------------------------------------------------
    f: {
      land:     new Float32Array(N),  // 토지가치 0..100
      ground:   new Float32Array(N),  // 지상 오염
      air:      new Float32Array(N),  // 대기 오염
      noise:    new Float32Array(N),  // 소음
      police:   new Float32Array(N),
      fire:     new Float32Array(N),
      health:   new Float32Array(N),
      death:    new Float32Array(N),
      edu1:     new Float32Array(N),
      edu2:     new Float32Array(N),
      edu3:     new Float32Array(N),
      park:     new Float32Array(N),
      mail:     new Float32Array(N),
      telecom:  new Float32Array(N),
      transit:  new Float32Array(N),
      traffic:  new Float32Array(N),  // 도로 통행량(대/월)
      crime:    new Float32Array(N),
    },

    comp: new Int32Array(N).fill(-1), // 도로망 연결 컴포넌트 ID
    nets: [],                         // 컴포넌트별 유틸리티 수급

    buildings: [],
    freeSlots: [],

    // --- 도시 상태 ---------------------------------------------------------
    city: newCityState(),

    // --- 더티 플래그 -------------------------------------------------------
    dirtyGround: { x0: 0, y0: 0, x1: MAP_W - 1, y1: MAP_H - 1, any: true },
    netDirty: true,
  };

  w.rand = makeRng((seed ^ 0x5f3759df) >>> 0);
  generateTerrain(w, seed);
  claimStartingSectors(w);
  buildOutsideConnection(w);
  return w;
}

export function newCityState() {
  return {
    name: '뉴 스카이라인',
    cash: ECON.startCash,
    loan: 0,
    xp: 0,
    milestone: 0,
    devPoints: MILESTONES[0].dp,
    devSpent: {},        // buildingId -> true
    permits: MILESTONES[0].permits,

    tick: 0,
    day: 1, month: 1, year: 2026,

    tax: { ...ECON.taxDefault },
    fees: { power: 1.0, water: 1.0, garbage: 1.0 },
    budget: {                       // 서비스 예산 배율 (0.5 ~ 1.5)
      police: 1, fire: 1, health: 1, edu: 1, park: 1,
      power: 1, water: 1, garbage: 1, road: 1, transport: 1,
    },
    policies: {},

    population: 0,
    households: 0,
    ageGroups: { child: 0, teen: 0, adult: 0, senior: 0 },
    education: { low: 0, mid: 0, high: 0 },
    jobs: 0, jobsFilled: 0, unemployment: 0,
    happiness: 50,
    health: 70,
    crime: 0,
    trafficFlow: 100,
    tourists: 0,

    power: { supply: 0, demand: 0, ratio: 1 },
    water: { supply: 0, demand: 0, ratio: 1 },
    sewage: { capacity: 0, produced: 0, ratio: 1 },
    garbage: { capacity: 0, produced: 0, stored: 0, storage: 0, ratio: 1 },

    demand: { res: 60, com: 40, ind: 45, off: 10 },
    income: 0, expense: 0,
    lastMonth: { income: 0, expense: 0, detail: {} },

    history: {},
    notifications: [],
    stats: { built: 0, bulldozed: 0, roadTiles: 0 },
  };
}

// ---------------------------------------------------------------------------
//  지형 생성
// ---------------------------------------------------------------------------
function generateTerrain(w, seed) {
  const nH = makeNoise2D(seed);
  const nT = makeNoise2D(seed + 7919);
  const nR = makeNoise2D(seed + 104729);
  const rng = makeRng(seed + 555);

  const cx = MAP_W / 2, cy = MAP_H / 2;

  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const i = idx(x, y);
      let h = nH(x / 46, y / 46, 5) * 0.5 + 0.5;
      // 중앙부는 평지 보정(시작 지점 확보)
      const d = Math.hypot(x - cx, y - cy) / (MAP_W * 0.5);
      h = h * 0.86 + 0.14 * (1 - clamp01(d));
      h += 0.07 * (1 - clamp01(d * 1.6));
      w.height[i] = clamp01(h);
      w.variant[i] = (rng() * 255) | 0;
    }
  }

  // 강: 사인 곡선을 따라 물길을 냄
  const riverPhase = rng() * Math.PI * 2;
  const riverAmp = 13 + rng() * 9;
  for (let x = 0; x < MAP_W; x++) {
    const ry = cy + Math.sin(x / 30 + riverPhase) * riverAmp + Math.sin(x / 11 + 2.1) * 3.5;
    const halfW = 3.4 + Math.sin(x / 19 + 1.3) * 1.3;
    const reach = halfW + 4.5;
    for (let y = 0; y < MAP_H; y++) {
      const dd = Math.abs(y - ry);
      if (dd >= reach) continue;
      const t = clamp01(1 - dd / reach);
      // 하상은 평평하게, 가장자리는 완만하게 깎는다
      w.height[idx(x, y)] -= 0.60 * Math.min(1, t * 1.9) * (0.45 + 0.55 * t);
    }
  }

  const SEA = 0.335;
  for (let i = 0; i < N; i++) {
    w.height[i] = clamp01(w.height[i]);
    w.water[i] = w.height[i] < SEA ? 1 : 0;
  }
  // 해안선 표시
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const i = idx(x, y);
      if (w.water[i]) continue;
      let near = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (inBounds(nx, ny) && w.water[idx(nx, ny)]) near = 1;
      }
      w.shore[i] = near;
    }
  }

  // 나무 & 자원
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const i = idx(x, y);
      if (w.water[i]) continue;
      const t = nT(x / 13, y / 13, 3) * 0.5 + 0.5;
      const centerDist = Math.hypot(x - cx, y - cy) / (MAP_W * 0.5);
      if (t > 0.60 - centerDist * 0.08 && rng() < 0.72) w.tree[i] = 1;

      const r = nR(x / 21, y / 21, 3);
      const r2 = nR(x / 9 + 100, y / 9 + 100, 2);
      if (r > 0.42) w.resource[i] = RES.ORE;
      else if (r < -0.46) w.resource[i] = RES.OIL;
      else if (w.tree[i] && r2 > 0.25) w.resource[i] = RES.FOREST;
      else if (Math.abs(r) < 0.06 && w.height[i] < 0.5) w.resource[i] = RES.FERTILE;
    }
  }
}

function claimStartingSectors(w) {
  const sx = Math.floor(SECTORS_X / 2) - 1, sy = Math.floor(SECTORS_Y / 2) - 1;
  for (let y = sy; y <= sy + 1; y++)
    for (let x = sx; x <= sx + 1; x++)
      w.sectorOwned[y * SECTORS_X + x] = 1;
}

/** 시작 고속도로 연결: 맵 왼쪽 가장자리에서 중앙 근처까지 */
function buildOutsideConnection(w) {
  const cy = Math.floor(MAP_H / 2);
  let y = cy;
  // 물을 피해서 진입 y 선정
  for (let t = 0; t < 30; t++) {
    const cand = cy + (t % 2 ? -1 : 1) * Math.ceil(t / 2) * 2;
    if (cand < 4 || cand > MAP_H - 5) continue;
    let ok = true;
    for (let x = 0; x < 12; x++) if (w.water[idx(x, cand)]) { ok = false; break; }
    if (ok) { y = cand; break; }
  }
  const endX = Math.floor(MAP_W / 2) - SECTOR;
  for (let x = 0; x <= Math.max(endX, 8); x++) {
    const i = idx(x, y);
    if (w.water[i]) { w.water[i] = 0; w.height[i] = 0.4; } // 간이 교량
    w.road[i] = 4; // 고속도로
    w.tree[i] = 0;
    w.bidx[i] = 0;
  }
  w.outside = { x: 0, y };
  w.city.stats.roadTiles += Math.max(endX, 8) + 1;
  markGroundDirty(w, 0, y - 2, Math.max(endX, 8) + 2, y + 2);
  w.netDirty = true;
}

// ---------------------------------------------------------------------------
//  더티 영역 관리 (지면 텍스처 부분 갱신)
// ---------------------------------------------------------------------------
export function markGroundDirty(w, x0, y0, x1, y1) {
  const d = w.dirtyGround;
  x0 = clamp(x0 - 1, 0, MAP_W - 1); y0 = clamp(y0 - 1, 0, MAP_H - 1);
  x1 = clamp(x1 + 1, 0, MAP_W - 1); y1 = clamp(y1 + 1, 0, MAP_H - 1);
  if (!d.any) { d.x0 = x0; d.y0 = y0; d.x1 = x1; d.y1 = y1; d.any = true; }
  else {
    d.x0 = Math.min(d.x0, x0); d.y0 = Math.min(d.y0, y0);
    d.x1 = Math.max(d.x1, x1); d.y1 = Math.max(d.y1, y1);
  }
}

// ---------------------------------------------------------------------------
//  섹터
// ---------------------------------------------------------------------------
export const sectorAt = (x, y) => Math.floor(y / SECTOR) * SECTORS_X + Math.floor(x / SECTOR);
export const isOwned = (w, x, y) => inBounds(x, y) && w.sectorOwned[sectorAt(x, y)] === 1;

export function buyableSectors(w) {
  const out = [];
  for (let sy = 0; sy < SECTORS_Y; sy++) {
    for (let sx = 0; sx < SECTORS_X; sx++) {
      const s = sy * SECTORS_X + sx;
      if (w.sectorOwned[s]) continue;
      // 인접한 소유 섹터가 있어야 구매 가능
      const nb = [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => {
        const nx = sx + dx, ny = sy + dy;
        return nx >= 0 && ny >= 0 && nx < SECTORS_X && ny < SECTORS_Y &&
               w.sectorOwned[ny * SECTORS_X + nx] === 1;
      });
      if (nb) out.push({ s, sx, sy, cost: sectorCost(w) });
    }
  }
  return out;
}

export function sectorCost(w) {
  let owned = 0;
  for (let i = 0; i < w.sectorOwned.length; i++) owned += w.sectorOwned[i];
  return Math.max(1, Math.floor((owned - 3) / 2) + 1); // 확장 허가증 비용
}

// ---------------------------------------------------------------------------
//  타일 조회
// ---------------------------------------------------------------------------
export function buildingAt(w, x, y) {
  if (!inBounds(x, y)) return null;
  const b = w.bidx[idx(x, y)];
  return b > 0 ? w.buildings[b - 1] : null;
}

export function isFree(w, x, y) {
  if (!inBounds(x, y)) return false;
  const i = idx(x, y);
  return w.water[i] === 0 && w.road[i] === 0 && w.bidx[i] === 0;
}

export function areaFree(w, x, y, bw, bh) {
  for (let dy = 0; dy < bh; dy++)
    for (let dx = 0; dx < bw; dx++) {
      if (!isOwned(w, x + dx, y + dy)) return false;
      if (!isFree(w, x + dx, y + dy)) return false;
    }
  return true;
}

/** 건물 발자국이 도로에 직접 접해 있는가 */
export function touchesRoad(w, x, y, bw, bh) {
  for (let dx = -1; dx <= bw; dx++) {
    for (let dy = -1; dy <= bh; dy++) {
      const onEdge = dx === -1 || dy === -1 || dx === bw || dy === bh;
      const corner = (dx === -1 || dx === bw) && (dy === -1 || dy === bh);
      if (!onEdge || corner) continue;
      const nx = x + dx, ny = y + dy;
      if (inBounds(nx, ny) && w.road[idx(nx, ny)] > 0) return true;
    }
  }
  return false;
}

/**
 * 발자국에서 maxDist 이내의 가장 가까운 도로 타일 (없으면 -1).
 * 용도지역은 도로에서 2칸 깊이까지 개발되며, 전기·수도도 그 범위에서 연결된다.
 */
export function nearRoadTile(w, x, y, bw, bh, maxDist = 1) {
  for (let d = 1; d <= maxDist; d++) {
    for (let dy = -d; dy < bh + d; dy++) {
      for (let dx = -d; dx < bw + d; dx++) {
        if (dx >= 0 && dx < bw && dy >= 0 && dy < bh) continue;
        const ddx = dx < 0 ? -dx : dx >= bw ? dx - bw + 1 : 0;
        const ddy = dy < 0 ? -dy : dy >= bh ? dy - bh + 1 : 0;
        if (Math.max(ddx, ddy) !== d) continue;
        const nx = x + dx, ny = y + dy;
        if (inBounds(nx, ny) && w.road[idx(nx, ny)] > 0) return idx(nx, ny);
      }
    }
  }
  return -1;
}

/** 인접 도로 타일 인덱스 (없으면 -1) */
export function adjacentRoadTile(w, x, y, bw, bh) {
  for (let dx = -1; dx <= bw; dx++) {
    for (let dy = -1; dy <= bh; dy++) {
      const onEdge = dx === -1 || dy === -1 || dx === bw || dy === bh;
      const corner = (dx === -1 || dx === bw) && (dy === -1 || dy === bh);
      if (!onEdge || corner) continue;
      const nx = x + dx, ny = y + dy;
      if (inBounds(nx, ny) && w.road[idx(nx, ny)] > 0) return idx(nx, ny);
    }
  }
  return -1;
}

export function nearWater(w, x, y, bw, bh, r = 4) {
  for (let yy = y - r; yy < y + bh + r; yy++)
    for (let xx = x - r; xx < x + bw + r; xx++)
      if (inBounds(xx, yy) && w.water[idx(xx, yy)]) return true;
  return false;
}

// ---------------------------------------------------------------------------
//  건물 추가 / 제거
// ---------------------------------------------------------------------------
let nextBuildingUid = 1;

export function addBuilding(w, spec) {
  const b = {
    uid: nextBuildingUid++,
    x: spec.x, y: spec.y, w: spec.w, h: spec.h,
    kind: spec.kind,                 // 'service' | 'growth'
    defId: spec.defId || null,       // 서비스 건물 id
    zone: spec.zone || 0,            // 성장 건물 용도지역
    level: spec.level || 1,
    variant: spec.variant ?? ((Math.random() * 5) | 0),
    residents: 0, jobs: 0, filled: 0,
    happiness: 55,
    powered: true, watered: true, sewered: true,
    garbage: 0,
    abandoned: false, fire: 0, burnt: false,
    age: 0, progress: 0,
    built: 0,
    compId: -1,
    active: true,
  };
  let slot = w.freeSlots.pop();
  if (slot === undefined) { w.buildings.push(b); slot = w.buildings.length - 1; }
  else w.buildings[slot] = b;
  b.slot = slot;

  for (let dy = 0; dy < b.h; dy++)
    for (let dx = 0; dx < b.w; dx++) {
      const i = idx(b.x + dx, b.y + dy);
      w.bidx[i] = slot + 1;
      w.tree[i] = 0;
    }
  markGroundDirty(w, b.x, b.y, b.x + b.w - 1, b.y + b.h - 1);
  w.netDirty = true;
  return b;
}

export function removeBuilding(w, b) {
  if (!b || !w.buildings[b.slot]) return;
  for (let dy = 0; dy < b.h; dy++)
    for (let dx = 0; dx < b.w; dx++) {
      const i = idx(b.x + dx, b.y + dy);
      if (w.bidx[i] === b.slot + 1) w.bidx[i] = 0;
    }
  w.buildings[b.slot] = null;
  w.freeSlots.push(b.slot);
  markGroundDirty(w, b.x, b.y, b.x + b.w - 1, b.y + b.h - 1);
  w.netDirty = true;
}

export function eachBuilding(w, fn) {
  const arr = w.buildings;
  for (let i = 0; i < arr.length; i++) {
    const b = arr[i];
    if (b) fn(b, i);
  }
}

/** 건물 정의(성장 건물이면 ZONE_DEF, 서비스면 BUILDINGS) */
export function defOf(b) {
  return b.kind === 'growth' ? ZONE_DEF[b.zone] : BUILDING_BY_ID[b.defId];
}

export function roadDef(w, i) {
  const r = w.road[i];
  return r > 0 ? ROADS[r - 1] : null;
}

export { ZONE };
