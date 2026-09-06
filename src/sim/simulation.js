// ============================================================================
//  시뮬레이션 오케스트레이터 — 시간 진행 및 서브시스템 호출 주기 관리
// ============================================================================
import { TICKS_PER_DAY, DAYS_PER_MONTH } from '../core/config.js';
import { rebuildNetwork, decayTraffic, assignTraffic, initCars, updateCars } from './network.js';
import { updateFields } from './fields.js';
import {
  updateUtilities, updateBuildingHappiness, updateCitizens, updateDemand, monthlyBudget,
} from './economy.js';
import { growthTick, pushNote } from './growth.js';
import { monthlyXp, checkMilestone } from './progression.js';
import { eachBuilding } from '../core/world.js';

const HIST_KEYS = ['population', 'happiness', 'cash', 'income', 'expense', 'unemployment',
                   'traffic', 'demandRes', 'demandCom', 'demandInd', 'demandOff', 'crime', 'health',
                   'demandResLow', 'demandResMed', 'demandResHigh'];

export function initSim(w) {
  initCars(w);
  rebuildNetwork(w);
  updateFields(w);
  updateUtilities(w);
  for (const k of HIST_KEYS) if (!w.city.history[k]) w.city.history[k] = [];
}

export function step(w) {
  const c = w.city;
  c.tick++;

  if (w.netDirty) rebuildNetwork(w);

  growthTick(w);
  decayTraffic(w);
  assignTraffic(w, 26, true);

  if (c.tick % TICKS_PER_DAY === 0) dayEnd(w);
}

function dayEnd(w) {
  const c = w.city;
  updateFields(w);
  updateUtilities(w);
  updateBuildingHappiness(w);
  updateCitizens(w, 1 / DAYS_PER_MONTH);
  updateDemand(w);
  emitWarnings(w);

  c.day++;
  if (c.day > DAYS_PER_MONTH) {
    c.day = 1;
    c.month++;
    monthEnd(w);
    if (c.month > 12) { c.month = 1; c.year++; }
  }
}

function monthEnd(w) {
  const c = w.city;
  monthlyBudget(w);
  monthlyXp(w);
  checkMilestone(w);

  const h = c.history;
  const push = (k, v) => { const a = h[k] || (h[k] = []); a.push(v); if (a.length > 360) a.shift(); };
  push('population', c.population);
  push('happiness', c.happiness);
  push('cash', c.cash);
  push('income', c.income);
  push('expense', c.expense);
  push('unemployment', c.unemployment);
  push('traffic', c.trafficFlow);
  push('demandRes', c.demand.res);
  push('demandCom', c.demand.com);
  push('demandInd', c.demand.ind);
  push('demandOff', c.demand.off);
  push('demandResLow', c.demand.resLow);
  push('demandResMed', c.demand.resMed);
  push('demandResHigh', c.demand.resHigh);
  push('crime', c.crime);
  push('health', c.health);

  if (c.cash < 0) {
    c.bankruptMonths = (c.bankruptMonths || 0) + 1;
    pushNote(w, 'danger', `💸 적자 상태입니다 (${c.bankruptMonths}개월). 세금을 올리거나 지출을 줄이세요.`);
  } else c.bankruptMonths = 0;
}

// ---------------------------------------------------------------------------
//  경고 알림
// ---------------------------------------------------------------------------
function emitWarnings(w) {
  const c = w.city;
  c.warnCd = c.warnCd || {};
  const cd = (key, ticks = 900) => {
    if ((c.warnCd[key] || -1e9) + ticks > c.tick) return false;
    c.warnCd[key] = c.tick; return true;
  };

  if (c.power.demand > 0 && c.power.ratio < 0.98 && cd('power'))
    pushNote(w, 'danger', '⚡ 전력이 부족합니다. 발전소를 증설하세요.');
  if (c.water.demand > 0 && c.water.ratio < 0.98 && cd('water'))
    pushNote(w, 'danger', '💧 상수도가 부족합니다.');
  if (c.sewage.produced > 0 && c.sewage.ratio < 0.95 && cd('sewage'))
    pushNote(w, 'warn', '🚱 하수 처리 용량이 부족합니다.');
  if (c.garbage.produced > 0 && c.garbage.ratio < 0.9 && cd('garbage'))
    pushNote(w, 'warn', '🗑️ 쓰레기 처리 용량이 부족합니다.');
  if (c.garbage.full > 0.9 && cd('landfill'))
    pushNote(w, 'warn', '🗑️ 매립지가 거의 가득 찼습니다.');
  if (c.population > 120 && (c.capRatio?.health ?? 1) < 0.6 && cd('health'))
    pushNote(w, 'warn', '🏥 의료 시설이 부족합니다.');
  if (c.population > 150 && (c.capRatio?.edu1 ?? 1) < 0.6 && cd('edu'))
    pushNote(w, 'warn', '🏫 학교가 부족합니다.');
  if (c.population > 200 && (c.capRatio?.death ?? 1) < 0.5 && cd('death'))
    pushNote(w, 'warn', '⚰️ 장례 시설이 부족합니다.');
  if (c.unemployment > 22 && cd('unemp'))
    pushNote(w, 'warn', `👷 실업률이 ${c.unemployment.toFixed(0)}%입니다. 일자리를 늘리세요.`);
  if (c.trafficFlow < 55 && cd('traffic'))
    pushNote(w, 'warn', '🚗 교통 정체가 심각합니다. 도로를 확장하거나 대중교통을 도입하세요.');
  if (c.crime > 55 && cd('crime'))
    pushNote(w, 'warn', '🚔 범죄율이 높습니다. 경찰 시설을 늘리세요.');

  let disconnected = 0;
  eachBuilding(w, b => { if (b.kind === 'growth' && b.compId < 0) disconnected++; });
  if (disconnected > 4 && cd('road'))
    pushNote(w, 'warn', '🛣️ 도로와 연결되지 않은 건물이 있습니다.');
}

export { updateCars };
