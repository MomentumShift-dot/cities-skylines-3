// ============================================================================
//  진행도 — 확장 포인트(XP), 마일스톤, 개발 포인트, 해금
// ============================================================================
import { MILESTONES, BUILDINGS, BUILDING_BY_ID, ROADS, ZONE_DEF, POLICIES } from '../core/config.js';
import { pushNote } from './growth.js';
import { sectorCost } from '../core/world.js';

export function addXp(w, amount) {
  w.city.xp += amount;
}

export function nextMilestone(w) {
  const m = w.city.milestone;
  return m + 1 < MILESTONES.length ? MILESTONES[m + 1] : null;
}

export function milestoneProgress(w) {
  const cur = MILESTONES[w.city.milestone];
  const nxt = nextMilestone(w);
  if (!nxt) return 1;
  const span = nxt.xp - cur.xp;
  return span > 0 ? Math.min(1, (w.city.xp - cur.xp) / span) : 1;
}

export function checkMilestone(w) {
  const c = w.city;
  let leveled = false;
  while (c.milestone + 1 < MILESTONES.length && c.xp >= MILESTONES[c.milestone + 1].xp) {
    c.milestone++;
    const m = MILESTONES[c.milestone];
    c.cash += m.cash;
    c.devPoints += m.dp;
    c.permits += m.permits;
    leveled = true;
    pushNote(w, 'good',
      `🏆 마일스톤 달성: ${m.name} (${m.en}) — ${m.cash.toLocaleString('ko-KR')}₡, 개발 포인트 +${m.dp}, 확장 허가증 +${m.permits}`);
    const newly = BUILDINGS.filter(b => b.unlock === c.milestone);
    if (newly.length) pushNote(w, 'good', `새 시설 해금: ${newly.map(b => b.name).join(', ')}`);
    const newZones = ZONE_DEF.filter(z => z.id > 0 && z.unlock === c.milestone);
    if (newZones.length) pushNote(w, 'good', `새 용도지역 해금: ${newZones.map(z => z.name).join(', ')}`);
    const newRoads = ROADS.filter(r => r.unlock === c.milestone);
    if (newRoads.length) pushNote(w, 'good', `새 도로 해금: ${newRoads.map(r => r.name).join(', ')}`);
  }
  return leveled;
}

// ---------------------------------------------------------------------------
//  해금 상태
// ---------------------------------------------------------------------------
export function milestoneOk(w, def) { return w.city.milestone >= (def.unlock || 0); }
export function isResearched(w, def) { return !def.dp || !!w.city.devSpent[def.id]; }
export function isUnlocked(w, def) { return milestoneOk(w, def) && isResearched(w, def); }

export function buildingAvailable(w, id) {
  const d = BUILDING_BY_ID[id];
  if (!d) return false;
  if (!isUnlocked(w, d)) return false;
  if (d.requires === 'bus' && !hasEnabler(w, 'bus')) return false;
  if (d.unique && hasBuilding(w, id)) return false;
  return true;
}

export function hasBuilding(w, id) {
  return w.buildings.some(b => b && b.kind === 'service' && b.defId === id);
}

export function hasEnabler(w, key) {
  return w.buildings.some(b => b && b.kind === 'service' && BUILDING_BY_ID[b.defId]?.enables === key);
}

export function zoneAvailable(w, zoneId) {
  const z = ZONE_DEF[zoneId];
  return !!z && w.city.milestone >= (z.unlock || 0);
}
export function roadAvailable(w, roadIdx) {
  return w.city.milestone >= (ROADS[roadIdx].unlock || 0);
}
export function policyAvailable(w, id) {
  const p = POLICIES.find(p => p.id === id);
  return !!p && w.city.milestone >= p.unlock;
}

// ---------------------------------------------------------------------------
//  개발 포인트 소비
// ---------------------------------------------------------------------------
export function research(w, id) {
  const d = BUILDING_BY_ID[id];
  if (!d || !d.dp) return { ok: false, msg: '연구할 항목이 아닙니다.' };
  if (w.city.devSpent[id]) return { ok: false, msg: '이미 개발되었습니다.' };
  if (!milestoneOk(w, d)) return { ok: false, msg: `마일스톤 ${MILESTONES[d.unlock].name} 필요` };
  if (w.city.devPoints < d.dp) return { ok: false, msg: '개발 포인트가 부족합니다.' };
  w.city.devPoints -= d.dp;
  w.city.devSpent[id] = true;
  pushNote(w, 'good', `🔬 ${d.name} 개발 완료`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
//  섹터 구매
// ---------------------------------------------------------------------------
export function buySector(w, s) {
  if (w.sectorOwned[s]) return { ok: false, msg: '이미 소유한 구역입니다.' };
  const cost = sectorCost(w);
  if (w.city.permits < cost) return { ok: false, msg: `확장 허가증 ${cost}장이 필요합니다.` };
  w.city.permits -= cost;
  w.sectorOwned[s] = 1;
  w.city.xp += 120;
  pushNote(w, 'good', `🗺️ 새 구역을 확보했습니다. (허가증 ${cost}장 사용)`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
//  월간 XP
// ---------------------------------------------------------------------------
export function monthlyXp(w) {
  const c = w.city;
  const pop = c.population;
  const gain = pop * 0.5 * (0.4 + c.happiness / 90) + Math.sqrt(Math.max(0, pop)) * 3;
  c.xp += gain;
  return gain;
}
