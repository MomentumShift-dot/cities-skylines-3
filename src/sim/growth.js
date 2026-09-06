// ============================================================================
//  성장(Zoned) 건물 — 신축 / 입주 / 레벨업 / 쇠퇴 / 화재
// ============================================================================
import { MAP_W, MAP_H, ZONE_DEF, ROADS } from '../core/config.js';
import {
  idx, inBounds, isOwned, eachBuilding, addBuilding, removeBuilding,
  markGroundDirty, nearRoadTile,
} from '../core/world.js';
import { sampleField } from './fields.js';
import { demandOfZone } from './economy.js';
import { clamp, clamp01 } from '../core/utils.js';

const CAT_OF_ZONE = [null, 'res', 'res', 'res', 'com', 'com', 'ind', 'off'];

/** 해당 좌표가 도로에서 zoneReach 이내인가 */
function nearRoad(w, x, y, reach = 4) {
  for (let dy = -reach; dy <= reach; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= MAP_H) continue;
    const span = reach - Math.abs(dy);
    for (let dx = -span; dx <= span; dx++) {
      const xx = x + dx;
      if (xx < 0 || xx >= MAP_W) continue;
      const rt = w.road[idx(xx, yy)];
      if (rt && !ROADS[rt - 1].noZone) return true;
    }
  }
  return false;
}

function canPlaceGrowth(w, x, y, zone) {
  const size = ZONE_DEF[zone].size;
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const xx = x + dx, yy = y + dy;
      if (!inBounds(xx, yy) || !isOwned(w, xx, yy)) return false;
      const i = idx(xx, yy);
      if (w.zone[i] !== zone) return false;
      if (w.water[i] || w.road[i] || w.bidx[i]) return false;
    }
  }
  return nearRoadTile(w, x, y, size, size, 2) >= 0;
}

/** 한 틱 동안의 신축 시도 */
export function growthTick(w, rng = w.rand || Math.random) {
  const c = w.city;
  const d = c.demand;
  const tries = 90;

  // 밀도별 수요를 그대로 신축 확률로 쓴다 (저·중·고가 각각 독립적으로 성장)
  const wants = {
    1: d.resLow * 0.010, 2: d.resMed * 0.009, 3: d.resHigh * 0.009,
    4: d.comLow * 0.011, 5: d.comHigh * 0.009,
    6: d.ind * 0.011, 7: d.off * 0.010,
  };

  let built = 0;
  for (let t = 0; t < tries && built < 7; t++) {
    const x = (rng() * MAP_W) | 0, y = (rng() * MAP_H) | 0;
    const i = idx(x, y);
    const z = w.zone[i];
    if (!z || w.bidx[i] || w.road[i] || w.water[i]) continue;
    if (rng() > wants[z]) continue;
    if (!nearRoad(w, x, y, 4)) continue;

    const zd = ZONE_DEF[z];
    // 큰 건물은 인접한 앵커 후보도 시도해 빈틈 없이 채워지도록 한다
    let ax = -1, ay = -1;
    if (zd.size === 1) {
      if (canPlaceGrowth(w, x, y, z)) { ax = x; ay = y; }
    } else {
      const cands = [[x, y], [x - 1, y], [x, y - 1], [x - 1, y - 1]];
      for (const [px, py] of cands) {
        if (px < 0 || py < 0) continue;
        if (canPlaceGrowth(w, px, py, z)) { ax = px; ay = py; break; }
      }
    }
    if (ax < 0) continue;

    const b = addBuilding(w, {
      x: ax, y: ay, w: zd.size, h: zd.size, kind: 'growth', zone: z, level: 1,
      variant: (rng() * 5) | 0,
    });
    b.progress = 0;
    b.happiness = 50;
    built++;
    c.xp += 2;
  }

  // --- 입주 / 레벨 / 쇠퇴 --------------------------------------------------
  eachBuilding(w, b => {
    if (b.kind !== 'growth') {
      // 서비스 건물도 짧은 공사 기간을 거쳐 완공된다
      if (b.progress < 1) b.progress = Math.min(1, b.progress + 0.14);
      return;
    }
    const zd = ZONE_DEF[b.zone];
    const cat = CAT_OF_ZONE[b.zone];
    b.age++;

    // 건설 진행
    if (b.progress < 1) {
      b.progress = Math.min(1, b.progress + 0.12);
      return;
    }

    if (b.fire > 0) { updateFire(w, b); return; }

    const cap = zd.cap[b.level - 1];
    const demand = demandOfZone(c, b.zone);
    // 입주율은 주로 「살기 좋은 정도」가 결정하고, 신축 여부는 수요가 통제한다.
    // (수요를 입주율에 직접 곱하면 도시 전체가 반쯤 빈 건물로 가득 차게 된다)
    const attract = clamp01(0.30 + b.happiness / 95) * clamp01(0.55 + demand / 90);

    if (b.abandoned) {
      // 여건이 회복되면 재입주
      if (b.happiness > 40 && demand > 22 && rng() < 0.08) {
        b.abandoned = false; b.badTicks = 0;
      } else if (b.age > 400 && rng() < 0.004) {
        removeBuilding(w, b);
      }
      return;
    }

    const occTarget = cap * attract;
    if (cat === 'res') {
      b.residents = clamp(b.residents + (occTarget - b.residents) * 0.10 + (b.residents < 1 && attract > 0.3 ? 1 : 0), 0, cap);
      b.filled = 0;
    } else {
      b.jobs = cap;
      b.filled = clamp(b.filled + (occTarget - b.filled) * 0.10 + (b.filled < 1 && attract > 0.3 ? 1 : 0), 0, cap);
      b.residents = 0;
    }

    // 레벨업 / 다운
    const land = sampleField(w, w.f.land, b);
    const need = zd.lvReq[b.level];
    if (b.level < 5 && need !== undefined && land >= need && b.happiness > 56
        && (b.residents + b.filled) > cap * 0.7 && rng() < 0.02) {
      b.level++;
      w.city.xp += 6;
      markGroundDirty(w, b.x, b.y, b.x + b.w - 1, b.y + b.h - 1);
    } else if (b.level > 1 && land < zd.lvReq[b.level - 1] - 14 && rng() < 0.008) {
      b.level--;
    }

    // 폐허화
    const bad = b.happiness < 18 || (!b.powered && !b.watered) || b.noPath > 6;
    b.badTicks = bad ? (b.badTicks || 0) + 1 : Math.max(0, (b.badTicks || 0) - 2);
    if (b.badTicks > 150) {
      b.abandoned = true;
      b.residents = 0; b.filled = 0;
      b.badTicks = 0;
      markGroundDirty(w, b.x, b.y, b.x + b.w - 1, b.y + b.h - 1);
      pushNote(w, 'warn', `${zd.name} 건물이 버려졌습니다.`, b.x, b.y);
    }

    // 화재 발생
    const fireCov = Math.min(sampleField(w, w.f.fire, b), w.city.capRatio?.fire ?? 1);
    const risk = (1 - fireCov) * 0.00016 * (1 + b.level * 0.15) * (b.powered ? 1 : 1.8);
    if (rng() < risk) {
      b.fire = 1;
      pushNote(w, 'danger', `🔥 ${zd.name} 건물에 화재가 발생했습니다!`, b.x, b.y);
    }
  });
}

function updateFire(w, b) {
  const cov = Math.min(sampleField(w, w.f.fire, b), w.city.capRatio?.fire ?? 1);
  b.fire += 0.02 - cov * 0.055;
  b.residents = 0; b.filled = 0;
  if (b.fire <= 0) { b.fire = 0; return; }
  if (b.fire > 1.6) {
    b.fire = 0; b.abandoned = true; b.burnt = true;
    b.level = 1;
    markGroundDirty(w, b.x, b.y, b.x + b.w - 1, b.y + b.h - 1);
  }
}

export function pushNote(w, type, text, x, y) {
  const list = w.city.notifications;
  if (list.length && list[list.length - 1].text === text) {
    list[list.length - 1].count++;
    list[list.length - 1].t = w.city.tick;
    return;
  }
  list.push({ type, text, x, y, t: w.city.tick, count: 1 });
  if (list.length > 60) list.shift();
}
