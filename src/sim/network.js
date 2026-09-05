// ============================================================================
//  도로망 — 연결 컴포넌트, 경로 탐색, 교통량 배분, 차량 에이전트
// ============================================================================
import { MAP_W, MAP_H, ROADS, BUILDING_BY_ID } from '../core/config.js';
import { idx, inBounds, eachBuilding, adjacentRoadTile, nearRoadTile, defOf } from '../core/world.js';
import { MinHeap, clamp01 } from '../core/utils.js';

const N = MAP_W * MAP_H;

// --- A* 작업 버퍼 (전역 재사용) ---------------------------------------------
const gScore = new Float32Array(N);
const cameFrom = new Int32Array(N);
const stamp = new Int32Array(N);
const closed = new Uint8Array(N);
let curStamp = 0;
const heap = new MinHeap();

// ---------------------------------------------------------------------------
//  연결 컴포넌트 재계산
// ---------------------------------------------------------------------------
export function rebuildNetwork(w) {
  const comp = w.comp;
  comp.fill(-1);
  const comps = [];
  const queue = new Int32Array(N);

  for (let i = 0; i < N; i++) {
    if (w.road[i] === 0 || comp[i] !== -1) continue;
    const id = comps.length;
    const c = { id, tiles: [], size: 0, root: id };
    let head = 0, tail = 0;
    queue[tail++] = i; comp[i] = id;
    while (head < tail) {
      const cur = queue[head++];
      c.tiles.push(cur);
      const x = cur % MAP_W, y = (cur / MAP_W) | 0;
      if (x > 0)         tryPush(cur - 1);
      if (x < MAP_W - 1) tryPush(cur + 1);
      if (y > 0)         tryPush(cur - MAP_W);
      if (y < MAP_H - 1) tryPush(cur + MAP_W);
      function tryPush(n) {
        if (w.road[n] > 0 && comp[n] === -1) { comp[n] = id; queue[tail++] = n; }
      }
    }
    c.size = c.tiles.length;
    comps.push(c);
  }

  // --- 송전탑에 의한 전력망 병합 ---------------------------------------------
  const parent = comps.map((_, i) => i);
  const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };

  const pylons = [];
  eachBuilding(w, b => {
    if (b.kind !== 'service') return;
    const d = BUILDING_BY_ID[b.defId];
    if (d && d.link) pylons.push({ b, r: d.link });
  });

  if (pylons.length) {
    // 각 송전탑이 반경 안에 닿는 컴포넌트들을 하나로 묶는다
    for (const p of pylons) {
      const touched = new Set();
      const cx = p.b.x + p.b.w / 2, cy = p.b.y + p.b.h / 2;
      const r = p.r;
      for (let y = Math.max(0, (cy - r) | 0); y < Math.min(MAP_H, cy + r); y++) {
        for (let x = Math.max(0, (cx - r) | 0); x < Math.min(MAP_W, cx + r); x++) {
          const i = idx(x, y);
          if (comp[i] < 0) continue;
          if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > r * r) continue;
          touched.add(comp[i]);
        }
      }
      // 송전탑끼리도 연결
      for (const q of pylons) {
        if (q === p) continue;
        const qx = q.b.x + q.b.w / 2, qy = q.b.y + q.b.h / 2;
        if (Math.hypot(qx - cx, qy - cy) <= r + q.r) {
          const qi = adjacentRoadTile(w, q.b.x, q.b.y, q.b.w, q.b.h);
          if (qi >= 0 && comp[qi] >= 0) touched.add(comp[qi]);
        }
      }
      const list = [...touched];
      for (let k = 1; k < list.length; k++) union(list[0], list[k]);
      p.b.netTouch = list;
    }
  }
  for (const c of comps) c.root = find(c.id);

  w.comps = comps;
  w.compCount = comps.length;

  // --- 건물 ↔ 컴포넌트 연결 ---------------------------------------------
  eachBuilding(w, b => {
    const ri = nearRoadTile(w, b.x, b.y, b.w, b.h, 2);
    b.compId = ri >= 0 ? comp[ri] : -1;
    b.roadTile = ri;
  });

  // --- 외부 연결이 붙은 컴포넌트 표시 -------------------------------------
  w.outsideComp = -1;
  if (w.outside) {
    const oi = idx(w.outside.x, w.outside.y);
    if (w.road[oi] > 0) w.outsideComp = comp[oi];
  }
  w.netDirty = false;
}

/** 두 건물이 같은 도로망(직접 연결)에 있는지 */
export function sameNet(w, a, b) {
  return a.compId >= 0 && a.compId === b.compId;
}

/** 전력망 루트 (송전탑 병합 반영) */
export function powerRoot(w, compId) {
  if (compId < 0 || !w.comps || !w.comps[compId]) return -1;
  return w.comps[compId].root;
}

// ---------------------------------------------------------------------------
//  경로 탐색 (A*)
// ---------------------------------------------------------------------------
function tileCost(w, i) {
  const rt = w.road[i];
  if (rt === 0) return Infinity;
  const rd = ROADS[rt - 1];
  const cong = clamp01(w.f.traffic[i] / rd.cap);
  return (1 / rd.speed) * (1 + 3.2 * cong * cong);
}

export function findPath(w, start, goal, maxNodes = 4500) {
  if (start === goal) return [start];
  if (w.road[start] === 0 || w.road[goal] === 0) return null;
  curStamp++;
  heap.clear();
  const gx = goal % MAP_W, gy = (goal / MAP_W) | 0;
  gScore[start] = 0; stamp[start] = curStamp; cameFrom[start] = -1; closed[start] = 0;
  heap.push(start, 0);
  let expanded = 0;

  while (heap.size) {
    const cur = heap.pop();
    if (cur === goal) return reconstruct(cur);
    if (closed[cur] === 1 && stamp[cur] === curStamp) continue;
    closed[cur] = 1;
    if (++expanded > maxNodes) return null;

    const x = cur % MAP_W, y = (cur / MAP_W) | 0;
    for (let d = 0; d < 4; d++) {
      let nx = x, ny = y;
      if (d === 0) nx++; else if (d === 1) nx--; else if (d === 2) ny++; else ny--;
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
      const ni = ny * MAP_W + nx;
      if (w.road[ni] === 0) continue;
      const step = tileCost(w, ni);
      if (!isFinite(step)) continue;
      const ng = gScore[cur] + step;
      if (stamp[ni] !== curStamp || ng < gScore[ni]) {
        stamp[ni] = curStamp; gScore[ni] = ng; cameFrom[ni] = cur; closed[ni] = 0;
        const hcost = (Math.abs(nx - gx) + Math.abs(ny - gy)) * 0.5;
        heap.push(ni, ng + hcost);
      }
    }
  }
  return null;

  function reconstruct(end) {
    const path = [];
    let c = end;
    while (c !== -1) { path.push(c); c = cameFrom[c]; }
    path.reverse();
    return path;
  }
}

// ---------------------------------------------------------------------------
//  교통량 배분
// ---------------------------------------------------------------------------
const TRAFFIC_DECAY = 0.94;

export function decayTraffic(w) {
  const t = w.f.traffic;
  for (let i = 0; i < N; i++) t[i] *= TRAFFIC_DECAY;
}

/**
 * 통행 샘플링: 주거 → 직장 / 산업 → 외부연결 OD 쌍을 뽑아 경로에 부하 배분.
 * 실제 시민 전원을 시뮬레이션하는 대신 표본 통행을 확대 적용한다.
 */
export function assignTraffic(w, sampleCount, spawnCars) {
  const homes = [], works = [];
  eachBuilding(w, b => {
    if (!b.active || b.abandoned || b.compId < 0) return;
    if (b.kind === 'growth') {
      if (b.residents > 0 && b.zone <= 3) homes.push(b);
      else if (b.filled > 0 && b.zone >= 4) works.push(b);
    } else if (b.jobsCount > 0) works.push(b);
  });
  if (!homes.length) return;

  const transitShare = w.city.transitShare || 0;
  const outsideTile = w.outside ? idx(w.outside.x, w.outside.y) : -1;
  const traffic = w.f.traffic;
  let loadTotal = 0, capTotal = 0;

  const rnd = w.rand || Math.random;
  for (let s = 0; s < sampleCount; s++) {
    const home = homes[(rnd() * homes.length) | 0];
    let destTile;
    let kind = 'car';
    const roll = rnd();
    if (works.length && roll < 0.72) {
      const wk = works[(rnd() * works.length) | 0];
      destTile = wk.roadTile;
      if (wk.kind === 'growth' && wk.zone === 6) kind = 'truck';
    } else if (outsideTile >= 0) {
      destTile = outsideTile;
      kind = roll > 0.93 ? 'truck' : 'car';
    } else continue;
    if (destTile == null || destTile < 0 || home.roadTile < 0) continue;

    const path = findPath(w, home.roadTile, destTile);
    if (!path) { home.noPath = (home.noPath || 0) + 1; continue; }
    home.noPath = 0;

    // 표본 1건 = 실제 통행 weight건
    const weight = Math.max(1, home.residents * 0.55) * (1 - transitShare * 0.75);
    for (let k = 0; k < path.length; k++) traffic[path[k]] += weight;

    if (spawnCars && w.cars.length < MAX_CARS && rnd() < 0.55) {
      spawnCar(w, path, kind);
    }
  }

  for (let i = 0; i < N; i++) {
    const rt = w.road[i];
    if (!rt) continue;
    loadTotal += Math.min(traffic[i], ROADS[rt - 1].cap * 2);
    capTotal += ROADS[rt - 1].cap;
  }
  w.city.roadLoad = loadTotal;
  w.city.roadCap = capTotal;
  const util = capTotal > 0 ? loadTotal / capTotal : 0;
  // 교통 흐름 100 = 완전 원활
  w.city.trafficFlow = Math.round(100 * clamp01(1 - Math.pow(clamp01(util), 1.35)));
}

/** 특정 타일의 혼잡도 0..1 */
export function congestionAt(w, i) {
  const rt = w.road[i];
  if (!rt) return 0;
  return clamp01(w.f.traffic[i] / ROADS[rt - 1].cap);
}

// ---------------------------------------------------------------------------
//  차량 에이전트 (시각 표현)
// ---------------------------------------------------------------------------
export const MAX_CARS = 340;
const CAR_COLORS = ['#e8e8ec', '#2f3d55', '#8f2f2f', '#2f6b8f', '#c9a227', '#4b4b52', '#5a8f4b', '#b06a2f'];
const TRUCK_COLORS = ['#d8d8d0', '#9aa4ad', '#6f7d8c', '#c0563a'];

export function initCars(w) { w.cars = []; }

function spawnCar(w, path, kind) {
  if (path.length < 3) return;
  w.cars.push({
    path,
    t: 0,
    speed: (kind === 'truck' ? 0.85 : 1.25) * (0.8 + Math.random() * 0.5),
    color: kind === 'truck'
      ? TRUCK_COLORS[(Math.random() * TRUCK_COLORS.length) | 0]
      : CAR_COLORS[(Math.random() * CAR_COLORS.length) | 0],
    kind,
    lane: Math.random() < 0.5 ? -1 : 1,
  });
}

export function updateCars(w, dt) {
  const cars = w.cars;
  for (let i = cars.length - 1; i >= 0; i--) {
    const c = cars[i];
    const seg = Math.floor(c.t);
    const ti = c.path[Math.min(seg, c.path.length - 1)];
    const rt = w.road[ti];
    if (!rt) { cars.splice(i, 1); continue; }
    const rd = ROADS[rt - 1];
    const cong = clamp01(w.f.traffic[ti] / rd.cap);
    const v = c.speed * rd.speed * (1 - 0.78 * cong * cong);
    c.t += v * dt * 2.2;
    if (c.t >= c.path.length - 1) cars.splice(i, 1);
  }
}
