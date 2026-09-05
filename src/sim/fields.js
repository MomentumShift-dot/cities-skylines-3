// ============================================================================
//  시뮬레이션 필드 — 서비스 커버리지, 오염, 소음, 토지가치, 범죄
// ============================================================================
import { MAP_W, MAP_H, ROADS, ZONE_DEF, BUILDING_BY_ID } from '../core/config.js';
import { idx, eachBuilding } from '../core/world.js';
import { clamp, clamp01 } from '../core/utils.js';

const N = MAP_W * MAP_H;
const landBonus = new Float32Array(N);
const tmp = new Float32Array(N);

/** 반경 감쇠 스탬프 */
function stamp(field, cx, cy, r, strength) {
  if (r <= 0 || strength === 0) return;
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(MAP_W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(MAP_H - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const t = 1 - Math.sqrt(d2) / r;
      field[y * MAP_W + x] += strength * t * t;
    }
  }
}

/** 3x3 박스 블러 (오염 확산) */
function blur(field, passes = 1) {
  for (let p = 0; p < passes; p++) {
    tmp.set(field);
    for (let y = 1; y < MAP_H - 1; y++) {
      const row = y * MAP_W;
      for (let x = 1; x < MAP_W - 1; x++) {
        const i = row + x;
        field[i] = (
          tmp[i] * 4 +
          tmp[i - 1] + tmp[i + 1] + tmp[i - MAP_W] + tmp[i + MAP_W] +
          (tmp[i - MAP_W - 1] + tmp[i - MAP_W + 1] + tmp[i + MAP_W - 1] + tmp[i + MAP_W + 1]) * 0.5
        ) / 10;
      }
    }
  }
}

/**
 * 모든 필드 재계산 (하루 1회 호출)
 * 서비스 커버리지는 "반경 도달" x "수용량 충족" 두 축으로 평가한다.
 */
export function updateFields(w) {
  const f = w.f;
  const budget = w.city.budget;
  const pol = w.city.policies;

  for (const k of ['police','fire','health','death','edu1','edu2','edu3','park','mail','telecom','transit','ground','air','noise','crime']) {
    f[k].fill(0);
  }
  landBonus.fill(0);

  // --- 서비스 수용량 집계 --------------------------------------------------
  const cap = { police:0, fire:0, health:0, death:0, edu1:0, edu2:0, edu3:0, mail:0 };
  w.city.serviceCap = cap;

  eachBuilding(w, b => {
    if (b.kind !== 'service' || !b.active) return;
    const d = BUILDING_BY_ID[b.defId];
    if (!d) return;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const powerMul = b.powered ? 1 : 0.25;

    if (d.svc) {
      const kind = d.svc.kind;
      const budKey = kind === 'police' ? 'police' : kind === 'fire' ? 'fire'
        : (kind === 'health' || kind === 'death') ? 'health'
        : kind.startsWith('edu') ? 'edu' : kind === 'park' ? 'park' : 'transport';
      const bm = budget[budKey] ?? 1;
      const r = d.svc.radius * (0.65 + 0.45 * bm);
      const st = (d.svc.strength || 1) * powerMul;
      stamp(f[kind === 'edu1' ? 'edu1' : kind === 'edu2' ? 'edu2' : kind === 'edu3' ? 'edu3' : kind], cx, cy, r, st);
      if (cap[kind] !== undefined) cap[kind] += d.svc.capacity * bm * powerMul;
    }
    if (d.land) stamp(landBonus, cx, cy, (d.svc ? d.svc.radius : 20), d.land * powerMul);

    // 오염 배출
    let air = d.air || 0, ground = d.ground || 0, noise = d.noise || 0;
    if (pol.indreg) { air *= 0.65; ground *= 0.65; }
    if (air)    stamp(f.air, cx, cy, 14 + air * 3, air * 1.6);
    if (ground) stamp(f.ground, cx, cy, 8 + ground * 2, ground * 2.2);
    if (noise)  stamp(f.noise, cx, cy, 8 + noise * 4, noise * 2.4);
  });

  // --- 성장 건물의 오염/소음 ------------------------------------------------
  eachBuilding(w, b => {
    if (b.kind !== 'growth' || b.abandoned) return;
    const zd = ZONE_DEF[b.zone];
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    if (zd.cat === 'ind') {
      let m = 1;
      if (pol.indreg) m = 0.65;
      const lv = b.level;
      stamp(f.air, cx, cy, 11 + lv, (1.6 + lv * 0.28) * m);
      stamp(f.ground, cx, cy, 7 + lv * 0.6, (1.3 + lv * 0.22) * m);
      stamp(f.noise, cx, cy, 7, 1.5 * m);
    } else if (zd.cat === 'com') {
      stamp(f.noise, cx, cy, 6, 0.7 + b.level * 0.12);
    } else if (zd.cat === 'off') {
      stamp(f.noise, cx, cy, 4, 0.3);
    }
  });

  // --- 도로 소음 & 대기오염 -------------------------------------------------
  for (let i = 0; i < N; i++) {
    const rt = w.road[i];
    if (!rt) continue;
    const rd = ROADS[rt - 1];
    const load = clamp01(f.traffic[i] / rd.cap);
    const x = i % MAP_W, y = (i / MAP_W) | 0;
    const s = rd.noise * (0.35 + load * 1.1);
    if (s > 0.05) stamp(f.noise, x + 0.5, y + 0.5, 3 + rd.noise * 2, s * 0.3);
    if (load > 0.25) stamp(f.air, x + 0.5, y + 0.5, 4, load * 0.35);
  }

  blur(f.air, 2);
  blur(f.ground, 1);
  blur(f.noise, 1);

  // --- 커버리지 정규화 ------------------------------------------------------
  const capRatio = k => {
    const need = w.city.serviceNeed ? (w.city.serviceNeed[k] || 0) : 0;
    if (need <= 0) return 1;
    return clamp01((cap[k] || 0) / need);
  };
  w.city.capRatio = {
    police: capRatio('police'), fire: capRatio('fire'), health: capRatio('health'),
    death: capRatio('death'), edu1: capRatio('edu1'), edu2: capRatio('edu2'),
    edu3: capRatio('edu3'), mail: capRatio('mail'),
  };

  for (const k of ['police','fire','health','death','edu1','edu2','edu3','park','mail','telecom','transit']) {
    const arr = f[k];
    for (let i = 0; i < N; i++) if (arr[i] > 1) arr[i] = 1;
  }
  for (const [k, sc] of [['ground', 14], ['air', 14], ['noise', 10]]) {
    const arr = f[k];
    for (let i = 0; i < N; i++) { const v = arr[i] * sc; arr[i] = v > 100 ? 100 : v; }
  }

  // --- 범죄 ----------------------------------------------------------------
  const unemp = clamp01(w.city.unemployment / 25);
  const nightPat = pol.nightpat ? 0.7 : 1;
  eachBuilding(w, b => {
    if (b.kind !== 'growth' || b.abandoned) return;
    const zd = ZONE_DEF[b.zone];
    if (zd.cat === 'none') return;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const dens = (b.residents + b.filled) / 60;
    stamp(f.crime, cx, cy, 6, (0.4 + dens * 0.7) * (0.55 + unemp * 0.8) * nightPat);
  });
  for (let i = 0; i < N; i++) {
    const c = f.crime[i] * 16 * (1 - f.police[i] * 0.85);
    f.crime[i] = c > 100 ? 100 : c < 0 ? 0 : c;
  }

  // --- 토지가치 -------------------------------------------------------------
  const solarBonus = pol.solarsub ? 4 : 0;
  const bikeBonus = pol.bikelane ? 3 : 0;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const i = y * MAP_W + x;
      if (w.water[i]) { f.land[i] = 0; continue; }
      let v = 20 + solarBonus + bikeBonus;
      v += f.park[i] * 26;
      v += f.police[i] * 8 + f.fire[i] * 6 + f.health[i] * 9;
      v += f.edu1[i] * 6 + f.edu2[i] * 7 + f.edu3[i] * 9;
      v += f.mail[i] * 5 + f.telecom[i] * 6 + f.transit[i] * 8;
      v += landBonus[i];
      if (w.shore[i]) v += 8;
      v += (w.height[i] - 0.4) * 22;
      v -= f.ground[i] * 0.42;
      v -= f.air[i] * 0.30;
      v -= f.noise[i] * 0.34;
      v -= f.crime[i] * 0.26;
      f.land[i] = clamp(v, 0, 100);
    }
  }
  // 주변 건물 등급이 토지가치를 끌어올림
  eachBuilding(w, b => {
    if (b.kind !== 'growth' || b.abandoned || b.level < 3) return;
    stamp(f.land, b.x + b.w / 2, b.y + b.h / 2, 5 + b.level, (b.level - 2) * 1.6);
  });
  for (let i = 0; i < N; i++) if (f.land[i] > 100) f.land[i] = 100;
}

/** 건물이 깔고 앉은 타일들의 필드 평균 */
export function sampleField(w, field, b) {
  let s = 0, n = 0;
  for (let dy = 0; dy < b.h; dy++)
    for (let dx = 0; dx < b.w; dx++) {
      s += field[idx(b.x + dx, b.y + dy)]; n++;
    }
  return n ? s / n : 0;
}
