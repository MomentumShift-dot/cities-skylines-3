// ============================================================================
//  경제 / 인구 / 유틸리티 / 수요 / 예산
// ============================================================================
import { ZONE_DEF, BUILDING_BY_ID, ROADS, ECON, POLICIES, MILESTONES } from '../core/config.js';
import { eachBuilding, defOf, idx } from '../core/world.js';
import { sampleField } from './fields.js';
import { powerRoot } from './network.js';
import { clamp, clamp01, approach } from '../core/utils.js';

// ---------------------------------------------------------------------------
//  1) 유틸리티 (전력 / 상수도 / 하수 / 쓰레기)
// ---------------------------------------------------------------------------
export function updateUtilities(w) {
  const c = w.city;
  const pol = c.policies;
  const nets = new Map();          // root -> {pSup,pDem,wSup,wDem,sCap,sPro}
  const get = r => {
    let n = nets.get(r);
    if (!n) { n = { pSup: 0, pDem: 0, wSup: 0, wDem: 0, sCap: 0, sPro: 0 }; nets.set(r, n); }
    return n;
  };

  let powerSaveMul = 1;
  if (pol.powersave) powerSaveMul *= 0.86;
  if (pol.solarsub) powerSaveMul *= 0.91;

  let gCap = 0, gPro = 0, gStore = 0;
  let totalPowerDemand = 0, totalWaterDemand = 0;

  eachBuilding(w, b => {
    b.netRoot = powerRoot(w, b.compId);
    const root = b.netRoot;
    const d = defOf(b);
    if (!d) return;

    if (b.kind === 'service') {
      const bd = BUILDING_BY_ID[b.defId];
      if (!bd) return;
      if (root >= 0) {
        const n = get(root);
        if (bd.power) n.pSup += bd.power * (bd.needsWater ? 1 : 1);
        if (bd.water) n.wSup += bd.water;
        if (bd.sewage) n.sCap += bd.sewage;
        // 서비스 건물 자체 소비
        const jobs = bd.jobs || 0;
        const pd = (0.35 + jobs * ECON.powerPerJob) * powerSaveMul * (c.budget[budgetKeyOf(bd)] ?? 1);
        n.pDem += pd; totalPowerDemand += pd;
        const wd = 0.2 + jobs * ECON.waterPerJob;
        n.wDem += wd; totalWaterDemand += wd;
        n.sPro += wd * 0.85;
      }
      gCap += (bd.garbage || 0) * (c.budget.garbage ?? 1);
      if (bd.store) gStore += bd.store;
    } else if (!b.abandoned) {
      const zd = ZONE_DEF[b.zone];
      const people = b.residents + b.filled;
      const pd = (zd.cat === 'res'
        ? b.residents * ECON.powerPerRes
        : b.filled * ECON.powerPerJob) * powerSaveMul;
      const wd = zd.cat === 'res'
        ? b.residents * ECON.waterPerRes
        : b.filled * ECON.waterPerJob;
      if (root >= 0) {
        const n = get(root);
        n.pDem += pd; n.wDem += wd; n.sPro += wd * 0.9;
      }
      totalPowerDemand += pd; totalWaterDemand += wd;
      let g = (zd.cat === 'res' ? b.residents * ECON.garbagePerRes : b.filled * ECON.garbagePerJob);
      if (pol.recycle) g *= 0.78;
      gPro += g;
    }
  });

  // --- 네트워크별 충족률 ---------------------------------------------------
  let pSupT = 0, pDemT = 0, wSupT = 0, wDemT = 0, sCapT = 0, sProT = 0;
  for (const n of nets.values()) {
    n.pRatio = n.pDem > 0 ? clamp01(n.pSup / n.pDem) : 1;
    n.wRatio = n.wDem > 0 ? clamp01(n.wSup / n.wDem) : 1;
    n.sRatio = n.sPro > 0 ? clamp01(n.sCap / n.sPro) : 1;
    pSupT += n.pSup; pDemT += n.pDem;
    wSupT += n.wSup; wDemT += n.wDem;
    sCapT += n.sCap; sProT += n.sPro;
  }
  w.netStats = nets;

  const rnd = w.rand || Math.random;
  eachBuilding(w, b => {
    const n = nets.get(b.netRoot);
    if (!n) { b.powered = false; b.watered = false; b.sewered = false; return; }
    b.powered = n.pRatio >= 0.999 ? true : rnd() < n.pRatio;
    b.watered = n.wRatio >= 0.999 ? true : rnd() < n.wRatio;
    b.sewered = n.sRatio >= 0.999 ? true : rnd() < n.sRatio;
  });

  c.power = { supply: pSupT, demand: pDemT, ratio: pDemT > 0 ? pSupT / pDemT : 1 };
  c.water = { supply: wSupT, demand: wDemT, ratio: wDemT > 0 ? wSupT / wDemT : 1 };
  c.sewage = { capacity: sCapT, produced: sProT, ratio: sProT > 0 ? sCapT / sProT : 1 };

  // --- 쓰레기 -------------------------------------------------------------
  // 처리 시설이 없어도 쓰레기는 서서히 쌓인다(즉시 100%가 되지 않도록 완충 용량을 둔다)
  const gr = c.garbage;
  gr.capacity = gCap; gr.produced = gPro; gr.storage = gStore;
  const overflow = gPro - gCap;
  const softCap = Math.max(1200, c.population * 55) + gStore;
  gr.stored = clamp(gr.stored + (overflow > 0 ? overflow * 3 : overflow * 2.5), 0, softCap * 1.6);
  gr.ratio = gPro > 0 ? clamp01(gCap / gPro) : 1;
  gr.full = clamp01(gr.stored / softCap);
}

function budgetKeyOf(bd) {
  switch (bd.cat) {
    case 'police': return 'police';
    case 'fire': return 'fire';
    case 'health': return 'health';
    case 'edu': return 'edu';
    case 'park': return 'park';
    case 'power': return 'power';
    case 'water': return 'water';
    case 'garbage': return 'garbage';
    case 'transport': return 'transport';
    default: return 'road';
  }
}
export { budgetKeyOf };

// ---------------------------------------------------------------------------
//  2) 건물 만족도
// ---------------------------------------------------------------------------
export function updateBuildingHappiness(w) {
  const f = w.f, c = w.city, pol = c.policies;
  const taxPenalty = {
    res: (c.tax.res - 11) * 1.5,
    com: (c.tax.com - 11) * 1.2,
    ind: (c.tax.ind - 11) * 1.1,
    off: (c.tax.off - 11) * 1.2,
  };
  const garbageBad = clamp01(c.garbage.full) * 20 + (1 - clamp01(c.garbage.ratio)) * 10;

  eachBuilding(w, b => {
    if (b.kind !== 'growth') return;
    const zd = ZONE_DEF[b.zone];
    const land = sampleField(w, f.land, b);
    const cong = sampleField(w, f.traffic, b);
    let h = 50 + land * 0.32;

    const cov = k => Math.min(sampleField(w, f[k], b), c.capRatio ? (c.capRatio[k] ?? 1) : 1);

    if (zd.cat === 'res') {
      h += cov('police') * 8 + cov('fire') * 6 + cov('health') * 10;
      h += cov('edu1') * 7 + cov('edu2') * 6 + cov('edu3') * 4;
      h += cov('park') * 10 + cov('mail') * 5 + cov('telecom') * 6;
      h += cov('transit') * 6 + cov('death') * 4;
    } else {
      h += cov('police') * 7 + cov('fire') * 6 + cov('mail') * 5 + cov('telecom') * 7;
      h += cov('transit') * 6 + cov('park') * 4;
      if (zd.cat === 'com') h += clamp01(w.city.population / 400) * 4;
    }

    h -= sampleField(w, f.ground, b) * 0.30;
    h -= sampleField(w, f.air, b) * 0.22;
    h -= sampleField(w, f.noise, b) * 0.20;
    h -= sampleField(w, f.crime, b) * 0.24;
    h -= garbageBad * (zd.cat === 'res' ? 1 : 0.6);
    h -= taxPenalty[zd.cat] || 0;
    h -= clamp01(cong / 2600) * 10;

    if (!b.powered) h -= 34;
    if (!b.watered) h -= 30;
    if (!b.sewered) h -= 10;
    if (b.noPath > 2) h -= 12;
    if (pol.bikelane) h += 2;
    if (pol.smokeban) h += 1.5;
    if (pol.freetransit) h += 3;
    if (pol.highrent && zd.cat === 'res') h += 4;
    if (c.welfare && zd.cat === 'res') h += 3 + clamp01(c.unemployment / 20) * 4;

    b.happiness = approach(b.happiness, clamp(h, 0, 100), 0.35);
  });
}

// ---------------------------------------------------------------------------
//  3) 인구 / 일자리 / 교육
// ---------------------------------------------------------------------------
export function updateCitizens(w, dt = 1) {
  const c = w.city, f = w.f, pol = c.policies;

  let pop = 0, resCap = 0, households = 0;
  let jobs = 0, jobsByEdu = [0, 0, 0];
  let eduCov1 = 0, eduCov2 = 0, eduCov3 = 0, healthCov = 0, covW = 0;

  eachBuilding(w, b => {
    if (b.kind === 'growth' && !b.abandoned) {
      const zd = ZONE_DEF[b.zone];
      if (zd.cat === 'res') {
        pop += b.residents;
        resCap += zd.cap[b.level - 1];
        households += Math.ceil(b.residents / 2.4);
        const wgt = b.residents;
        covW += wgt;
        eduCov1 += Math.min(sampleField(w, f.edu1, b), 1) * wgt;
        eduCov2 += Math.min(sampleField(w, f.edu2, b), 1) * wgt;
        eduCov3 += Math.min(sampleField(w, f.edu3, b), 1) * wgt;
        healthCov += Math.min(sampleField(w, f.health, b), 1) * wgt;
      } else {
        const n = zd.cap[b.level - 1];
        jobs += n;
        const e = zd.edu || [0.4, 0.4, 0.2];
        jobsByEdu[0] += n * e[0]; jobsByEdu[1] += n * e[1]; jobsByEdu[2] += n * e[2];
      }
    } else if (b.kind === 'service' && b.active) {
      const bd = BUILDING_BY_ID[b.defId];
      if (bd && bd.jobs) {
        b.jobsCount = bd.jobs;
        jobs += bd.jobs;
        jobsByEdu[0] += bd.jobs * 0.28; jobsByEdu[1] += bd.jobs * 0.42; jobsByEdu[2] += bd.jobs * 0.30;
      }
    }
  });

  c.resCapacity = resCap;
  c.households = households;
  c.population = Math.round(pop);
  c.jobs = Math.round(jobs);

  const cw = covW || 1;
  c.cov = {
    edu1: eduCov1 / cw, edu2: eduCov2 / cw, edu3: eduCov3 / cw, health: healthCov / cw,
  };

  // --- 연령 구조 -----------------------------------------------------------
  const ag = c.ageGroups;
  let total = ag.child + ag.teen + ag.adult + ag.senior;
  const delta = c.population - total;
  if (delta > 0) {
    // 신규 유입 시민
    ag.child += delta * 0.19; ag.teen += delta * 0.11;
    ag.adult += delta * 0.53; ag.senior += delta * 0.17;
  } else if (delta < 0 && total > 0) {
    const k = c.population / total;
    ag.child *= k; ag.teen *= k; ag.adult *= k; ag.senior *= k;
  }
  // 노화 (월 단위 근사)
  const flowCT = ag.child * 0.010 * dt, flowTA = ag.teen * 0.014 * dt, flowAS = ag.adult * 0.0040 * dt;
  ag.child -= flowCT; ag.teen += flowCT - flowTA;
  ag.adult += flowTA - flowAS; ag.senior += flowAS;

  total = ag.child + ag.teen + ag.adult + ag.senior;
  if (total > 0) {
    const k = c.population / total;
    ag.child *= k; ag.teen *= k; ag.adult *= k; ag.senior *= k;
  }

  // --- 교육 수준 -----------------------------------------------------------
  const ed = c.education;
  let edTotal = ed.low + ed.mid + ed.high;
  const edDelta = c.population - edTotal;
  if (edDelta > 0) { ed.low += edDelta * 0.68; ed.mid += edDelta * 0.26; ed.high += edDelta * 0.06; }
  else if (edDelta < 0 && edTotal > 0) { const k = c.population / edTotal; ed.low *= k; ed.mid *= k; ed.high *= k; }

  const eduSpeed = (pol.edusub ? 1.35 : 1) * (c.budget.edu ?? 1) * dt;
  const capR = c.capRatio || {};
  const up1 = ed.low * 0.030 * c.cov.edu1 * Math.min(1, capR.edu1 ?? 1) * eduSpeed;
  const up2 = ed.mid * 0.018 * c.cov.edu3 * Math.min(1, capR.edu3 ?? 1) * eduSpeed;
  const mid2 = ed.low * 0.016 * c.cov.edu2 * Math.min(1, capR.edu2 ?? 1) * eduSpeed;
  ed.low -= up1 + mid2; ed.mid += up1 + mid2 - up2; ed.high += up2;
  ed.low = Math.max(0, ed.low); ed.mid = Math.max(0, ed.mid); ed.high = Math.max(0, ed.high);

  // --- 고용 ---------------------------------------------------------------
  const workforce = ag.adult + ag.teen * 0.25;
  c.workforce = workforce;
  const share = edTotal > 0 ? [ed.low / c.population, ed.mid / c.population, ed.high / c.population] : [1, 0, 0];
  const supply = [workforce * share[0], workforce * share[1], workforce * share[2]];
  let filled = 0;
  // 고학력자는 하위 직군도 채울 수 있다 (하향 취업)
  let carry = 0;
  for (let t = 2; t >= 0; t--) {
    const avail = supply[t] + carry;
    const take = Math.min(avail, jobsByEdu[t]);
    filled += take;
    carry = avail - take;
  }
  c.jobsFilled = Math.round(filled);
  c.unemployment = workforce > 0 ? clamp((1 - filled / workforce) * 100, 0, 100) : 0;
  c.jobVacancy = jobs > 0 ? clamp01(1 - filled / jobs) : 0;

  // --- 건강 / 사망 ----------------------------------------------------------
  const sick = (1 - c.cov.health) * 0.40 + clamp01(avgField(w, 'ground') / 70) * 0.24
             + clamp01(avgField(w, 'air') / 70) * 0.16;
  c.health = Math.round(clamp(100 - sick * 100 * (pol.smokeban ? 0.75 : 1), 5, 100));
  c.deaths = ag.senior * 0.006 * (2 - c.health / 100);
  c.serviceNeed = {
    police: c.population * 0.9,
    fire: c.population * 0.9,
    health: c.population * 0.85,
    death: c.deaths * 260,
    edu1: ag.child * 0.9,
    edu2: ag.teen * 0.95,
    edu3: ag.adult * 0.14,
    mail: c.population * ECON.mailPerRes,
  };

  // --- 대중교통 분담률 ------------------------------------------------------
  let transitW = 0, transitPop = 0;
  eachBuilding(w, b => {
    if (b.kind !== 'growth' || b.zone > 3 || b.abandoned) return;
    transitW += Math.min(sampleField(w, f.transit, b), 1) * b.residents;
    transitPop += b.residents;
  });
  const base = transitPop > 0 ? transitW / transitPop : 0;
  c.transitShare = clamp01(base * (pol.freetransit ? 0.85 : 0.55) + (pol.bikelane ? 0.08 : 0));

  // --- 도시 만족도 ----------------------------------------------------------
  let hs = 0, hw = 0;
  eachBuilding(w, b => {
    if (b.kind !== 'growth' || b.abandoned) return;
    const zd = ZONE_DEF[b.zone];
    const wgt = zd.cat === 'res' ? b.residents : b.filled * 0.35;
    hs += b.happiness * wgt; hw += wgt;
  });
  const target = hw > 0 ? hs / hw : 50;
  c.happiness = approach(c.happiness, clamp(target, 0, 100), 0.4);

  let crimeSum = 0, crimeW = 0;
  eachBuilding(w, b => {
    if (b.kind !== 'growth' || b.abandoned) return;
    crimeSum += sampleField(w, f.crime, b) * (b.residents + b.filled);
    crimeW += b.residents + b.filled;
  });
  c.crime = crimeW > 0 ? crimeSum / crimeW : 0;

  // --- 관광 ---------------------------------------------------------------
  let tour = 0;
  eachBuilding(w, b => {
    if (b.kind !== 'service' || !b.active || !b.powered) return;
    const bd = BUILDING_BY_ID[b.defId];
    if (bd && bd.tourism) tour += bd.tourism;
  });
  c.tourists = Math.round(tour * (0.5 + c.happiness / 140) * (0.6 + clamp01(c.population / 20000) * 0.8));

  c.welfare = false;
  eachBuilding(w, b => {
    if (b.kind === 'service' && BUILDING_BY_ID[b.defId]?.welfare && b.active) c.welfare = true;
  });
}

function avgField(w, key) {
  const arr = w.f[key];
  let s = 0, n = 0;
  eachBuilding(w, b => {
    if (b.kind !== 'growth') return;
    s += arr[idx(b.x, b.y)]; n++;
  });
  return n ? s / n : 0;
}

// ---------------------------------------------------------------------------
//  4) RCI 수요
// ---------------------------------------------------------------------------
export function updateDemand(w) {
  const c = w.city, pol = c.policies;
  const d = c.demand;
  const ms = c.milestone;

  // --- 용도지역별 수용량/입주량 집계 ------------------------------------------
  const cap = {}, occ = {};
  let landSum = 0, landN = 0;
  eachBuilding(w, b => {
    if (b.kind !== 'growth' || b.abandoned) return;
    const zd = ZONE_DEF[b.zone];
    cap[b.zone] = (cap[b.zone] || 0) + zd.cap[b.level - 1];
    occ[b.zone] = (occ[b.zone] || 0) + (zd.cat === 'res' ? b.residents : b.filled);
    landSum += sampleField(w, w.f.land, b); landN++;
  });
  const land = landN ? landSum / landN : 38;
  c.avgLand = land;
  c.zoneCap = cap; c.zoneOcc = occ;

  /** 공실률 0..1 — 밀도가 달라도 같은 척도로 비교된다 */
  const vac = z => {
    const cp = cap[z] || 0;
    return cp > 0 ? clamp01(1 - (occ[z] || 0) / cp) : 0;
  };

  const jobSurplus = c.jobs - c.jobsFilled;
  const labor = clamp((c.unemployment - 6) * 2.0, -22, 34);   // 실업률 자기조정 항
  const urban = clamp01(c.population / 9000);                 // 도시화 정도

  // --- 주거: 공통 압력 + 밀도별 선호 ------------------------------------------
  const resBase = 42
    + clamp(jobSurplus * 0.10, -35, 35)
    + (c.happiness - 50) * 0.55
    - (c.tax.res - 11) * 2.4
    - clamp(labor * 0.55, -6, 20)
    + (pol.highrent ? 8 : 0);

  // 도시가 작고 땅값이 쌀수록 단독주택을, 커지고 땅값이 오를수록 고층을 원한다
  const prefLow  = 20 - urban * 32 - (land - 45) * 0.20;
  const prefMed  = 2 + urban * 12 - Math.abs(land - 52) * 0.14;
  const prefHigh = -26 + urban * 42 + (land - 45) * 0.44;

  const rawLow  = resBase + prefLow  - vac(1) * 60;
  const rawMed  = ms >= ZONE_DEF[2].unlock ? resBase + prefMed  - vac(2) * 60 : -100;
  const rawHigh = ms >= ZONE_DEF[3].unlock ? resBase + prefHigh - vac(3) * 60 : -100;

  // --- 상업: 저밀도(동네 상권) vs 고밀도(대형 점포) ------------------------------
  const comCap = (cap[4] || 0) + (cap[5] || 0);
  const comBase = 18
    + clamp(c.population * 0.055 - comCap * 0.45, -35, 40)
    + labor
    - (c.tax.com - 11) * 2.0
    + c.tourists * 0.02;
  const rawComLow  = comBase + 12 - urban * 22 + (pol.smallbiz ? 14 : 0) - vac(4) * 55;
  const rawComHigh = ms >= ZONE_DEF[5].unlock
    ? comBase - 12 + urban * 28 + (land - 45) * 0.30 - vac(5) * 55 : -100;

  // --- 산업 / 사무 -------------------------------------------------------------
  const indCap = cap[6] || 0, offCap = cap[7] || 0;
  const rawInd = 18
    + clamp(comCap * 0.30 + c.population * 0.030 - indCap * 0.45, -35, 40)
    + labor
    - (c.tax.ind - 11) * 1.9
    + (pol.greenind ? -14 : 0)
    - vac(6) * 45;
  const rawOff = ms >= ZONE_DEF[7].unlock
    ? 10 + clamp(c.education.high * 0.50 - offCap * 0.55, -35, 42)
      + labor * 0.8 - (c.tax.off - 11) * 2.0 + (pol.greenind ? 16 : 0) - vac(7) * 45
    : -100;

  // 초기 정착지는 최소한의 주거 수요를 보장한다
  const bootstrap = c.population < 60;

  const set = (k, v) => { d[k] = approach(d[k] ?? 0, clamp(v, 0, 100), 0.25); };
  set('resLow',  bootstrap ? Math.max(rawLow, 70) : rawLow);
  set('resMed',  rawMed);
  set('resHigh', rawHigh);
  set('comLow',  rawComLow);
  set('comHigh', rawComHigh);
  set('ind',     rawInd);
  set('off',     rawOff);

  // 요약값 (통계 그래프·툴팁용)
  d.res = Math.max(d.resLow, d.resMed, d.resHigh);
  d.com = Math.max(d.comLow, d.comHigh);
}

/** 용도지역 id → 해당 구역의 현재 수요 */
export function demandOfZone(city, zone) {
  const d = city.demand;
  switch (zone) {
    case 1: return d.resLow;
    case 2: return d.resMed;
    case 3: return d.resHigh;
    case 4: return d.comLow;
    case 5: return d.comHigh;
    case 6: return d.ind;
    case 7: return d.off;
    default: return 0;
  }
}

// ---------------------------------------------------------------------------
//  5) 월간 예산
// ---------------------------------------------------------------------------
export function monthlyBudget(w) {
  const c = w.city, pol = c.policies;
  const detail = { taxRes: 0, taxCom: 0, taxInd: 0, taxOff: 0, fees: 0, tourism: 0,
                   upkeep: {}, road: 0, policy: 0, interest: 0, loanRepay: 0 };

  let taxBonus = 1;
  eachBuilding(w, b => {
    if (b.kind === 'service' && b.active && BUILDING_BY_ID[b.defId]?.taxBonus)
      taxBonus += BUILDING_BY_ID[b.defId].taxBonus;
  });

  eachBuilding(w, b => {
    if (b.kind !== 'growth' || b.abandoned) return;
    const zd = ZONE_DEF[b.zone];
    const lvMul = 1 + (b.level - 1) * 0.12;
    const hMul = 0.6 + b.happiness / 125;
    if (zd.cat === 'res') {
      detail.taxRes += b.residents * ECON.taxBase.res * (c.tax.res / 100) * lvMul * hMul;
    } else if (zd.cat === 'com') {
      detail.taxCom += b.filled * ECON.taxBase.com * (c.tax.com / 100) * lvMul * hMul;
    } else if (zd.cat === 'ind') {
      detail.taxInd += b.filled * ECON.taxBase.ind * (c.tax.ind / 100) * lvMul * hMul;
    } else if (zd.cat === 'off') {
      detail.taxOff += b.filled * ECON.taxBase.off * (c.tax.off / 100) * lvMul * hMul;
    }
  });
  if (pol.indreg) detail.taxInd *= 0.88;
  if (pol.smallbiz) detail.taxCom *= 0.92;
  if (pol.highrent) detail.taxRes *= 0.90;

  detail.taxRes *= taxBonus; detail.taxCom *= taxBonus;
  detail.taxInd *= taxBonus; detail.taxOff *= taxBonus;

  // 공공요금
  detail.fees = (c.power.demand * 620 * c.fees.power)
              + (c.water.demand * 480 * c.fees.water)
              + (c.garbage.produced * 26 * c.fees.garbage);
  detail.tourism = c.tourists * 3.2;

  // 유지비
  let upkeepTotal = 0;
  eachBuilding(w, b => {
    if (b.kind !== 'service' || !b.active) return;
    const bd = BUILDING_BY_ID[b.defId];
    if (!bd) return;
    const key = budgetKeyOf(bd);
    const mul = c.budget[key] ?? 1;
    const v = bd.upkeep * mul;
    detail.upkeep[bd.cat] = (detail.upkeep[bd.cat] || 0) + v;
    upkeepTotal += v;
  });

  let roadUp = 0;
  for (let i = 0; i < w.N; i++) {
    const rt = w.road[i];
    if (rt) roadUp += ROADS[rt - 1].upkeep;
  }
  roadUp *= (c.budget.road ?? 1);
  detail.road = roadUp;

  let policyCost = 0;
  for (const p of POLICIES) if (c.policies[p.id]) policyCost += p.costPerPop * Math.max(60, c.population) * 0.35;
  detail.policy = policyCost;

  detail.interest = c.loan * ECON.loanInterest;

  const income = detail.taxRes + detail.taxCom + detail.taxInd + detail.taxOff + detail.fees + detail.tourism;
  const expense = upkeepTotal + roadUp + policyCost + detail.interest;

  c.income = income;
  c.expense = expense;
  c.lastMonth = { income, expense, detail, net: income - expense };
  c.cash += income - expense;

  if (!c.history.balance) c.history.balance = [];
  return c.lastMonth;
}

// ---------------------------------------------------------------------------
//  6) 대출
// ---------------------------------------------------------------------------
export function loanLimit(w) {
  return MILESTONES[Math.min(w.city.milestone, MILESTONES.length - 1)].loan;
}
export function takeLoan(w, amount) {
  const c = w.city;
  const limit = loanLimit(w);
  amount = Math.min(amount, limit - c.loan);
  if (amount <= 0) return 0;
  c.loan += amount; c.cash += amount;
  return amount;
}
export function repayLoan(w, amount) {
  const c = w.city;
  amount = Math.min(amount, c.loan, c.cash);
  if (amount <= 0) return 0;
  c.loan -= amount; c.cash -= amount;
  return amount;
}
