// ============================================================================
//  건물 모델 — 용도지역/서비스 건물별 절차적 형상 정의
//  (스프라이트 캐시가 1회만 호출하므로 디테일을 아끼지 않는다)
// ============================================================================
import {
  makeProjector, poly, mat, box, cyl, gableRoof, slab,
  faceSW, faceSE, windowGrid, storefront, parapet, roofProps, wallClutter, cell,
} from './architecture.js';
import { shade, seededRng } from './gfx.js';
import { ZONE_DEF } from '../core/config.js';

const GLASS = ['#33556e', '#2d4a63', '#3a5f78', '#294357'];
const AWNINGS = ['#b8443c', '#2f6f9e', '#3f8a55', '#c1873a', '#7a4f8c'];

// ---------------------------------------------------------------------------
//  높이 계산 (프로젝터 생성 전에 필요)
// ---------------------------------------------------------------------------
export function modelMetrics(spec) {
  const { kind, level } = spec;
  if (kind === 'growth') {
    const zd = ZONE_DEF[spec.zone];
    const bodyH = zd.height[level - 1];
    let extra = 10;
    if (zd.cat === 'res' && zd.size === 1) extra = 14;          // 박공 지붕 + 굴뚝
    else if (zd.key === 'RES_HIGH') extra = 26;                  // 물탱크 + 안테나
    else if (zd.key === 'OFF') extra = 24;
    else if (zd.cat === 'ind') extra = 34;                       // 굴뚝
    else extra = 16;
    return { bodyH, extra };
  }
  const d = spec.def;
  const bodyH = d.height || 20;
  const EX = {
    wind: 66, coal: 54, gas: 40, nuclear: 46, pylon: 8, wtower: 6, obstower: 26,
    telecom: 10, incin: 46, cityhall: 26, stadium: 30, univ: 14, hospital: 14,
    airport: 26, cremat: 22, firehq: 16, policehq: 16, metro: 8,
  };
  return { bodyH, extra: EX[d.id] ?? 16 };
}

export function seedOf(spec) {
  const base = spec.kind === 'growth' ? spec.zone * 977 : hashStr(spec.def.id);
  return (base + spec.level * 131 + spec.variant * 7919 + spec.bw * 37 + spec.bh * 53) >>> 0;
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
//  공통 조각
// ---------------------------------------------------------------------------
/** 부지 바닥판 */
function plate(ctx, pr, color, inset = 0) {
  const { bw, bh } = pr;
  box(ctx, pr, inset, inset, bw - inset, bh - inset, -1.2, 0, mat(color), { noSides: true });
}

/** 보도블록 무늬 */
function paving(ctx, pr, color, line, inset = 0) {
  plate(ctx, pr, color, inset);
  ctx.strokeStyle = line; ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (let i = inset; i <= pr.bw - inset + 0.001; i += 0.5) {
    const a = pr.P(i, inset, 0), b = pr.P(i, pr.bh - inset, 0);
    ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
  }
  for (let i = inset; i <= pr.bh - inset + 0.001; i += 0.5) {
    const a = pr.P(inset, i, 0), b = pr.P(pr.bw - inset, i, 0);
    ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
  }
  ctx.stroke();
}

function tree(ctx, pr, x, y, s = 1, color = '#35702f') {
  const p = pr.P(x, y, 0);
  ctx.fillStyle = 'rgba(15,30,16,.28)';
  ctx.beginPath(); ctx.ellipse(p[0] + 2 * pr.z, p[1] + 1, 5 * s * pr.z, 2.6 * s * pr.z, 0, 0, 6.2832); ctx.fill();
  ctx.strokeStyle = '#5c4632'; ctx.lineWidth = Math.max(0.8, 1.4 * s * pr.z);
  ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0], p[1] - 7 * s * pr.z); ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(p[0], p[1] - 11 * s * pr.z, 5.2 * s * pr.z, 0, 6.2832); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.14)';
  ctx.beginPath(); ctx.arc(p[0] - 1.7 * s * pr.z, p[1] - 12.6 * s * pr.z, 2.3 * s * pr.z, 0, 6.2832); ctx.fill();
}

function hedge(ctx, pr, x0, y0, x1, y1) {
  box(ctx, pr, x0, y0, x1, y1, 0, 3.2, mat('#3d7a3a'));
}

function fence(ctx, pr, x0, y0, x1, y1, color = '#b9b2a4') {
  const h = 3.4;
  ctx.strokeStyle = color; ctx.lineWidth = Math.max(0.7, 1.1 * pr.z);
  const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
  ctx.beginPath();
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pr.P(pts[i][0], pts[i][1], h), b = pr.P(pts[i + 1][0], pts[i + 1][1], h);
    ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
  }
  ctx.stroke();
}

/** 주차장 (구획선 + 차 몇 대) */
function parking(ctx, pr, x0, y0, x1, y1, rnd) {
  box(ctx, pr, x0, y0, x1, y1, -1, 0, mat('#4a4d52'), { noSides: true });
  ctx.strokeStyle = 'rgba(230,230,220,.5)'; ctx.lineWidth = 0.7;
  ctx.beginPath();
  const n = Math.max(2, Math.round((x1 - x0) * 4));
  for (let i = 1; i < n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const a = pr.P(x, y0, 0), b = pr.P(x, y1, 0);
    ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
  }
  ctx.stroke();
  const CARS = ['#d8dade', '#333a45', '#8f3230', '#2f5f8a', '#b4a63c'];
  for (let i = 0; i < n; i++) {
    if (rnd() < 0.42) continue;
    const x = x0 + ((x1 - x0) * (i + 0.5)) / n;
    const cw = (x1 - x0) / n * 0.62, cd = Math.min(0.42, (y1 - y0) * 0.62);
    const cy = y0 + (y1 - y0 - cd) * 0.5;
    box(ctx, pr, x - cw / 2, cy, x + cw / 2, cy + cd, 0, 3.6, mat(CARS[(rnd() * CARS.length) | 0]));
  }
}

function entranceCanopy(ctx, pr, x0, x1, y, m) {
  box(ctx, pr, x0, y - 0.28, x1, y, 7.5, 8.6, m);
  const a = pr.P((x0 + x1) / 2, y - 0.26, 0), b = pr.P((x0 + x1) / 2, y - 0.26, 7.5);
  ctx.strokeStyle = shade(m.base, 0.6); ctx.lineWidth = Math.max(0.7, 1.1 * pr.z);
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
}

function levelBand(level) { return Math.min(2, Math.floor((level - 1) / 2)); } // 0,0,1,1,2

// ---------------------------------------------------------------------------
//  성장 건물
// ---------------------------------------------------------------------------
export function drawGrowth(ctx, lights, pr, spec) {
  const zd = ZONE_DEF[spec.zone];
  const rnd = seededRng(seedOf(spec));
  const fx = {};
  const lv = spec.level, band = levelBand(lv);
  const dead = spec.state !== 'n';
  const L = dead ? null : lights;

  let wall = zd.palette[spec.variant % zd.palette.length];
  let roof = zd.roofs ? zd.roofs[spec.variant % zd.roofs.length] : '#6a6258';
  if (spec.state === 'a') { wall = '#9d968c'; roof = '#736c63'; }
  if (spec.state === 'b') { wall = '#4f463d'; roof = '#332c25'; }

  const H = spec.bodyH;
  const glass = GLASS[spec.variant % GLASS.length];

  switch (zd.key) {
    case 'RES_LOW':  return drawHouse(ctx, L, pr, { rnd, lv, band, wall, roof, H, dead, spec }), fx;
    case 'RES_MED':  return drawRowBlock(ctx, L, pr, { rnd, lv, band, wall, roof, H, glass, dead }), fx;
    case 'RES_HIGH': return drawResTower(ctx, L, pr, { rnd, lv, band, wall, roof, H, glass, dead }), fx;
    case 'COM_LOW':  return drawShop(ctx, L, pr, { rnd, lv, band, wall, roof, H, glass, dead }), fx;
    case 'COM_HIGH': return drawMall(ctx, L, pr, { rnd, lv, band, wall, roof, H, glass, dead }), fx;
    case 'IND':      return drawFactory(ctx, L, pr, { rnd, lv, band, wall, roof, H, dead, fx }), fx;
    case 'OFF':      return drawOfficeTower(ctx, L, pr, { rnd, lv, band, wall, roof, H, glass, dead }), fx;
  }
  return fx;
}

// --- 저밀도 주거: 단독주택 ---------------------------------------------------
function drawHouse(ctx, L, pr, o) {
  const { rnd, lv, wall, roof, H, dead } = o;
  plate(ctx, pr, dead ? '#7d7f6d' : '#6f9d55');
  // 정원 디테일
  if (!dead && lv >= 3) { hedge(ctx, pr, 0.06, 0.06, 0.94, 0.16); }

  if (lv === 1) {
    // 트레일러 / 판잣집
    const m = mat(shade(wall, 0.92));
    box(ctx, pr, 0.14, 0.30, 0.86, 0.80, 1.5, 1.5 + H * 0.92, m);
    box(ctx, pr, 0.10, 0.28, 0.90, 0.82, 1.5 + H * 0.92, 1.5 + H, mat(roof));
    // 받침 블록
    box(ctx, pr, 0.18, 0.36, 0.30, 0.48, 0, 1.6, mat('#6b6b64'));
    box(ctx, pr, 0.70, 0.62, 0.82, 0.74, 0, 1.6, mat('#6b6b64'));
    const f = faceSW(pr, 0.14, 0.86, 0.80, 1.5, 1.5 + H * 0.92);
    windowGrid(ctx, f, { cols: 3, rows: 1, glass: '#42525c', rnd, lights: L, litChance: 0.5, marginY: 0.3 });
    tree(ctx, pr, 0.82, 0.20, 0.8);
    return;
  }

  const twoStory = lv >= 4;
  const bx0 = 0.13, bx1 = 0.87, by0 = 0.22, by1 = 0.78;
  const wallM = mat(wall), roofM = mat(roof);
  const bodyH = twoStory ? H * 0.74 : H * 0.62;

  // 본채
  box(ctx, pr, bx0, by0, bx1, by1, 0, bodyH, wallM);
  // 기단
  box(ctx, pr, bx0 - 0.02, by0 - 0.02, bx1 + 0.02, by1 + 0.02, 0, 1.6, mat('#9a938a'));
  // 창문
  const fSW = faceSW(pr, bx0, bx1, by1, 0, bodyH);
  const fSE = faceSE(pr, bx1, by0, by1, 0, bodyH);
  const rows = twoStory ? 2 : 1;
  windowGrid(ctx, fSW, { cols: 3, rows, glass: '#4a5a66', frame: shade(wall, 0.75),
    rnd, lights: L, litChance: 0.55, marginX: 0.22, marginY: 0.26 });
  windowGrid(ctx, fSE, { cols: 2, rows, glass: '#44535e', frame: shade(wall, 0.75),
    rnd, lights: L, litChance: 0.4, marginX: 0.24, marginY: 0.26 });
  // 현관문 + 포치
  poly(ctx, cell(fSW, 0.44, 0.58, 0.02, 0.42), shade(roof, 0.8));
  if (lv >= 3) {
    box(ctx, pr, 0.36, by1, 0.66, by1 + 0.14, bodyH * 0.55, bodyH * 0.60, mat('#cfc7b8'));
    const c0 = pr.P(0.38, by1 + 0.12, 0), c1 = pr.P(0.38, by1 + 0.12, bodyH * 0.55);
    const c2 = pr.P(0.64, by1 + 0.12, 0), c3 = pr.P(0.64, by1 + 0.12, bodyH * 0.55);
    ctx.strokeStyle = '#cfc7b8'; ctx.lineWidth = Math.max(0.7, 1.2 * pr.z);
    ctx.beginPath(); ctx.moveTo(c0[0], c0[1]); ctx.lineTo(c1[0], c1[1]);
    ctx.moveTo(c2[0], c2[1]); ctx.lineTo(c3[0], c3[1]); ctx.stroke();
  }
  // 지붕
  const ridge = gableRoof(ctx, pr, bx0 - 0.05, by0 - 0.05, bx1 + 0.05, by1 + 0.05,
                          bodyH, twoStory ? 9 : 7.5, roofM, 'x');
  // 지붕 기와 결
  ctx.strokeStyle = shade(roof, 0.72); ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (let t = 0.15; t < 1; t += 0.17) {
    const a = pr.P(bx0 - 0.05 + (bx1 - bx0 + 0.1) * t, by1 + 0.05, bodyH);
    const b = pr.P(bx0 - 0.05 + (bx1 - bx0 + 0.1) * t, (by0 + by1) / 2, bodyH + (twoStory ? 9 : 7.5));
    ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
  }
  ctx.stroke();
  // 도머창
  if (lv >= 4) {
    const dx = 0.30;
    box(ctx, pr, dx, 0.46, dx + 0.20, 0.62, bodyH + 2, bodyH + 7, mat(wall));
    const fd = faceSW(pr, dx, dx + 0.20, 0.62, bodyH + 3, bodyH + 6.6);
    windowGrid(ctx, fd, { cols: 1, rows: 1, glass: '#57687a', rnd, lights: L, litChance: 0.35 });
  }
  // 굴뚝
  if (lv >= 3) box(ctx, pr, 0.70, 0.34, 0.80, 0.46, bodyH + 2, bodyH + (twoStory ? 13 : 11), mat('#8d6f5f'));
  // 차고 + 진입로
  if (lv >= 3) {
    box(ctx, pr, 0.62, 0.80, 0.94, 0.99, 0, bodyH * 0.52, mat(shade(wall, 0.94)));
    gableRoof(ctx, pr, 0.60, 0.78, 0.96, 1.0, bodyH * 0.52, 3.5, roofM, 'y');
    poly(ctx, cell(faceSW(pr, 0.64, 0.92, 0.99, 0, bodyH * 0.52), 0.05, 0.95, 0.05, 0.8), '#6c6f74');
  }
  // 잔디 소품
  if (!dead) {
    tree(ctx, pr, 0.08, 0.86, lv >= 4 ? 1.05 : 0.85);
    if (lv >= 5) {
      box(ctx, pr, 0.04, 0.30, 0.11, 0.70, 0, 0.6, mat('#3d6fa0'));  // 작은 수영장
      tree(ctx, pr, 0.90, 0.10, 0.9, '#2f6b3a');
    }
  }
}

// --- 중밀도 주거: 연립·저층 아파트 -------------------------------------------
function drawRowBlock(ctx, L, pr, o) {
  const { rnd, lv, band, wall, roof, H, glass, dead } = o;
  const { bw, bh } = pr;
  paving(ctx, pr, '#8e8c85', 'rgba(0,0,0,.10)');
  const i = 0.08;
  const wallM = mat(wall);
  const floors = Math.max(3, Math.round(H / 11));

  // 저층 기단
  box(ctx, pr, i, i, bw - i, bh - i, 0, 4.5, mat(shade(wall, 0.86)));
  box(ctx, pr, i, i, bw - i, bh - i, 4.5, H, wallM);

  const fSW = faceSW(pr, i, bw - i, bh - i, 4.5, H);
  const fSE = faceSE(pr, bw - i, i, bh - i, 4.5, H);
  const cols = Math.max(3, Math.round((bw - 2 * i) * 2.6));
  windowGrid(ctx, fSW, { cols, rows: floors - 1, glass, frame: shade(wall, 0.72),
    rnd, lights: L, litChance: 0.45 });
  windowGrid(ctx, fSE, { cols: Math.max(3, Math.round((bh - 2 * i) * 2.6)), rows: floors - 1,
    glass, frame: shade(wall, 0.72), rnd, lights: L, litChance: 0.4 });

  // 발코니 (레벨 3 이상)
  if (band >= 1) {
    for (let r = 1; r < floors - 1; r++) {
      const h = 4.5 + ((H - 4.5) * r) / (floors - 1);
      box(ctx, pr, i + 0.05, bh - i, bw - i - 0.05, bh - i + 0.16, h - 0.8, h, mat(shade(wall, 1.06)));
      box(ctx, pr, i + 0.05, bh - i + 0.13, bw - i - 0.05, bh - i + 0.16, h, h + 2.6,
          mat(band >= 2 ? '#8fa6b5' : shade(wall, 0.8)));
    }
  }
  // 1층 현관
  poly(ctx, cell(faceSW(pr, i, bw - i, bh - i, 0, 4.5), 0.40, 0.56, 0.05, 0.85), '#3c4a55');
  entranceCanopy(ctx, pr, (bw - 0.5) / 2, (bw + 0.5) / 2, bh - i, mat('#b6bcc2'));
  if (L) poly(L, cell(faceSW(pr, i, bw - i, bh - i, 0, 4.5), 0.40, 0.56, 0.1, 0.8), '#ffe0a0');

  // 지붕
  parapet(ctx, pr, i, i, bw - i, bh - i, H, mat(roof));
  roofProps(ctx, L, pr, rnd, i, i, bw - i, bh - i, H + 1,
    { units: 3, tank: band >= 1, garden: band >= 2, antenna: false });
  if (!dead) { tree(ctx, pr, 0.05, bh - 0.06, 0.8); tree(ctx, pr, bw - 0.05, 0.06, 0.8); }
}

// --- 고밀도 주거: 아파트 타워 -------------------------------------------------
function drawResTower(ctx, L, pr, o) {
  const { rnd, lv, band, wall, roof, H, glass, dead } = o;
  const { bw, bh } = pr;
  paving(ctx, pr, '#8b8a84', 'rgba(0,0,0,.10)');
  if (!dead) { tree(ctx, pr, 0.10, bh - 0.10, 0.85); tree(ctx, pr, bw - 0.12, 0.12, 0.85); }

  const podH = 9;
  box(ctx, pr, 0.06, 0.06, bw - 0.06, bh - 0.06, 0, podH, mat(shade(wall, 0.82)));
  storefront(ctx, faceSW(pr, 0.06, bw - 0.06, bh - 0.06, 0.5, podH), {
    bays: 4, rnd, lights: L, glass: '#2b4457', frame: '#1d2c37', awning: false, sign: false,
  });
  entranceCanopy(ctx, pr, bw / 2 - 0.3, bw / 2 + 0.3, bh - 0.06, mat('#aeb6bd'));

  // 타워 본체 (레벨 4 이상은 상부 셋백)
  const t = 0.22;
  const towerTop = band >= 2 ? H * 0.72 : H;
  box(ctx, pr, t, t, bw - t, bh - t, podH, towerTop, mat(wall));
  const floors = Math.max(5, Math.round((towerTop - podH) / 11));
  const fSW = faceSW(pr, t, bw - t, bh - t, podH, towerTop);
  const fSE = faceSE(pr, bw - t, t, bh - t, podH, towerTop);
  const cols = Math.max(3, Math.round((bw - 2 * t) * 2.4));
  windowGrid(ctx, fSW, { cols, rows: floors, glass, frame: shade(wall, 0.7), rnd, lights: L, litChance: 0.5 });
  windowGrid(ctx, fSE, { cols, rows: floors, glass, frame: shade(wall, 0.7), rnd, lights: L, litChance: 0.42 });

  // 연속 발코니
  for (let r = 0; r < floors; r++) {
    const h = podH + ((towerTop - podH) * (r + 0.92)) / floors;
    box(ctx, pr, t + 0.02, bh - t, bw - t - 0.02, bh - t + 0.14, h - 0.7, h, mat(shade(wall, 1.08)));
    box(ctx, pr, t + 0.02, bh - t + 0.11, bw - t - 0.02, bh - t + 0.14, h, h + 2.4, mat('#93a8b6'));
  }

  let topH = towerTop;
  if (band >= 2) {
    const s = t + 0.16;
    box(ctx, pr, s, s, bw - s, bh - s, towerTop, H, mat(shade(wall, 1.04)));
    const fT = faceSW(pr, s, bw - s, bh - s, towerTop, H);
    windowGrid(ctx, fT, { cols: 3, rows: Math.max(2, Math.round((H - towerTop) / 11)),
      glass, frame: shade(wall, 0.7), rnd, lights: L, litChance: 0.6 });
    parapet(ctx, pr, s, s, bw - s, bh - s, H, mat(roof));
    topH = H;
    roofProps(ctx, L, pr, rnd, s, s, bw - s, bh - s, topH + 1,
      { units: 2, tank: true, antenna: true, antennaH: 18 });
  } else {
    parapet(ctx, pr, t, t, bw - t, bh - t, towerTop, mat(roof));
    roofProps(ctx, L, pr, rnd, t, t, bw - t, bh - t, towerTop + 1,
      { units: 3, tank: true, antenna: true, antennaH: 16 });
  }
}

// --- 저밀도 상업: 상점 / 주유소 / 바 -------------------------------------------
function drawShop(ctx, L, pr, o) {
  const { rnd, lv, band, wall, roof, H, glass, dead } = o;
  paving(ctx, pr, '#9b988f', 'rgba(0,0,0,.10)');
  const i = 0.10;
  const wallM = mat(wall);
  const floors = Math.max(1, Math.round(H / 12));

  box(ctx, pr, i, i, 1 - i, 1 - i, 0, H, wallM);
  const fSW = faceSW(pr, i, 1 - i, 1 - i, 0, H);
  const fSE = faceSE(pr, 1 - i, i, 1 - i, 0, H);

  // 1층 상점 전면
  const shopTop = Math.min(H, 10);
  storefront(ctx, faceSW(pr, i, 1 - i, 1 - i, 0, shopTop), {
    bays: 2, rnd, lights: L, glass: '#2e4a5e', frame: '#1c2b36',
    awning: band >= 1, awningColors: AWNINGS, sign: true,
    signColor: shade(wall, 0.7), signLit: AWNINGS[(rnd() * AWNINGS.length) | 0],
  });
  storefront(ctx, faceSE(pr, 1 - i, i, 1 - i, 0, shopTop), {
    bays: 2, rnd, lights: L, glass: '#2a4557', frame: '#1c2b36',
    awning: false, awningColors: AWNINGS, sign: false,
  });
  // 상층
  if (floors > 1) {
    windowGrid(ctx, faceSW(pr, i, 1 - i, 1 - i, shopTop, H),
      { cols: 3, rows: floors - 1, glass, frame: shade(wall, 0.72), rnd, lights: L, litChance: 0.4 });
    windowGrid(ctx, faceSE(pr, 1 - i, i, 1 - i, shopTop, H),
      { cols: 3, rows: floors - 1, glass, frame: shade(wall, 0.72), rnd, lights: L, litChance: 0.35 });
  }
  parapet(ctx, pr, i, i, 1 - i, 1 - i, H, mat(roof));
  roofProps(ctx, L, pr, rnd, i, i, 1 - i, 1 - i, H + 1,
    { units: 2, penthouse: false, tank: band >= 2, solar: band >= 2 });
  // 입간판
  if (band >= 1 && !dead) {
    box(ctx, pr, 0.03, 0.44, 0.07, 0.60, 0, H * 0.8, mat('#6d747a'));
    box(ctx, pr, 0.01, 0.40, 0.05, 0.64, H * 0.8, H * 0.8 + 9, mat(AWNINGS[(rnd() * 5) | 0]));
    if (L) {
      const p = pr.P(0.03, 0.52, H * 0.8 + 4.5);
      L.fillStyle = 'rgba(255,180,90,.9)';
      L.beginPath(); L.arc(p[0], p[1], 4 * pr.z, 0, 6.2832); L.fill();
    }
  }
}

// --- 고밀도 상업: 대형 마트 / 백화점 --------------------------------------------
function drawMall(ctx, L, pr, o) {
  const { rnd, lv, band, wall, roof, H, glass, dead } = o;
  const { bw, bh } = pr;
  paving(ctx, pr, '#8f8d86', 'rgba(0,0,0,.10)');
  // 앞마당 주차장
  parking(ctx, pr, 0.06, bh - 0.58, bw - 0.06, bh - 0.06, rnd);

  const i = 0.08, front = bh - 0.62;
  const wallM = mat(wall);
  box(ctx, pr, i, i, bw - i, front, 0, H, wallM);

  const fSW = faceSW(pr, i, bw - i, front, 0, H);
  const fSE = faceSE(pr, bw - i, i, front, 0, H);
  const floors = Math.max(2, Math.round(H / 16));
  // 커튼월 전면
  windowGrid(ctx, fSW, { cols: Math.round((bw - 2 * i) * 3), rows: floors, glass,
    frame: shade(wall, 0.66), style: band >= 1 ? 'curtain' : 'ribbon', rnd, lights: L, litChance: 0.6 });
  windowGrid(ctx, fSE, { cols: Math.round((front - i) * 3), rows: floors, glass,
    frame: shade(wall, 0.66), style: 'ribbon', rnd, lights: L, litChance: 0.5 });
  // 간판 띠
  poly(ctx, cell(fSW, 0.08, 0.92, 0.90, 0.99), shade(wall, 0.6));
  if (L) poly(L, cell(fSW, 0.12, 0.88, 0.915, 0.975), '#ff9c4a');
  // 입구 캐노피
  entranceCanopy(ctx, pr, bw / 2 - 0.45, bw / 2 + 0.45, front, mat('#c3c9cf'));

  parapet(ctx, pr, i, i, bw - i, front, H, mat(roof));
  roofProps(ctx, L, pr, rnd, i, i, bw - i, front, H + 1,
    { units: 6, tank: false, penthouse: true, solar: band >= 2, antenna: band >= 2, antennaH: 12 });
  // 카트 보관소
  if (!dead) box(ctx, pr, bw - 0.5, bh - 0.5, bw - 0.16, bh - 0.3, 0, 3.4, mat('#9aa2a8'));
}

// --- 산업: 공장 / 창고 ---------------------------------------------------------
function drawFactory(ctx, L, pr, o) {
  const { rnd, lv, band, wall, roof, H, dead, fx } = o;
  const { bw, bh } = pr;
  plate(ctx, pr, '#7c7a72');
  // 야적장 바닥
  box(ctx, pr, 0.04, bh - 0.5, bw - 0.04, bh - 0.04, -1, 0, mat('#5a5c60'), { noSides: true });
  fence(ctx, pr, 0.03, 0.03, bw - 0.03, bh - 0.03, '#8a8f93');

  const i = 0.10, back = 0.10, front = bh - 0.54;
  const wallM = mat(wall);
  // 본동 (톱니 지붕)
  box(ctx, pr, i, back, bw - i, front, 0, H, wallM);
  const bays = Math.max(2, Math.round((bw - 2 * i) * 1.5));
  for (let b = 0; b < bays; b++) {
    const x0 = i + ((bw - 2 * i) * b) / bays, x1 = i + ((bw - 2 * i) * (b + 1)) / bays;
    // 톱니: 낮은 쪽 → 높은 쪽 사면
    const P = pr.P;
    const p1 = P(x0, back, H), p2 = P(x1, back, H), p3 = P(x1, front, H), p4 = P(x0, front, H);
    const r1 = P(x0, back, H + 6), r2 = P(x1, back, H + 6);
    poly(ctx, [p1, p2, r2, r1], shade(roof, 0.78));
    poly(ctx, [r1, r2, p3, p4], shade(roof, 1.04));
    // 채광창
    poly(ctx, [p1, p2, r2, r1], '#5d7b8c');
    if (L) poly(L, [p1, p2, r2, r1], 'rgba(180,210,235,.35)');
  }
  // 벽면 디테일: 세로 골판 + 하역장 셔터
  ctx.strokeStyle = shade(wall, 0.74); ctx.lineWidth = 0.6;
  const fSW = faceSW(pr, i, bw - i, front, 0, H);
  ctx.beginPath();
  for (let t = 0.05; t < 1; t += 0.055) {
    const a = fSW(t, 0.02), b = fSW(t, 0.98);
    ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
  }
  ctx.stroke();
  const docks = 3;
  for (let d = 0; d < docks; d++) {
    const u0 = 0.10 + (0.76 * d) / docks, u1 = u0 + 0.18;
    poly(ctx, cell(fSW, u0, u1, 0.04, 0.46), '#4d5257');
    poly(ctx, cell(fSW, u0, u1, 0.04, 0.46), null, shade(wall, 0.6), 0.7);
    if (L && rnd() < 0.5) poly(L, cell(fSW, u0 + 0.02, u1 - 0.02, 0.06, 0.42), 'rgba(255,214,140,.55)');
  }
  // 사무동
  box(ctx, pr, bw - 0.62, front - 0.02, bw - i, front + 0.34, 0, H * 0.72, mat(shade(wall, 1.06)));
  windowGrid(ctx, faceSW(pr, bw - 0.62, bw - i, front + 0.34, 0, H * 0.72),
    { cols: 3, rows: 2, glass: '#3f5b6e', frame: shade(wall, 0.7), rnd, lights: L, litChance: 0.5 });

  // 사일로 / 저장탱크
  const silos = band >= 1 ? 3 : 2;
  for (let s = 0; s < silos; s++) {
    const sx = 0.30 + s * 0.34, sy = back - 0.02;
    if (sx > bw - 0.3) break;
    cyl(ctx, pr, sx, sy + 0.16, 0.24, 0, H * (0.9 + rnd() * 0.5), mat('#c3c0b4'));
  }
  // 굴뚝 (연기 이펙트 좌표 기록)
  const cx = bw - 0.42, cy = back + 0.16;
  cyl(ctx, pr, cx, cy, 0.17, 0, H + 26, mat('#b3aca0'), { taper: 0.8 });
  box(ctx, pr, cx - 0.09, cy - 0.09, cx + 0.09, cy + 0.09, H + 22, H + 24, mat('#8a5a4a'));
  if (fx) fx.smoke = [{ x: cx, y: cy, h: H + 26, r: 0.2 }];
  if (L) { const p = pr.P(cx, cy, H + 25); L.fillStyle = '#ff5a4a';
    L.beginPath(); L.arc(p[0], p[1], Math.max(1, 1.5 * pr.z), 0, 6.2832); L.fill(); }

  // 야적 컨테이너 / 팔레트
  const COL = ['#8a5a3c', '#3d6f8a', '#7a8a3d', '#8a3d3d'];
  for (let k = 0; k < 4; k++) {
    if (rnd() < 0.3) continue;
    const px = 0.12 + rnd() * (bw - 0.6), py = bh - 0.46 + rnd() * 0.16;
    box(ctx, pr, px, py, px + 0.4, py + 0.2, 0, 4.5, mat(COL[(rnd() * 4) | 0]));
  }
}

// --- 사무: 유리 오피스 타워 -----------------------------------------------------
function drawOfficeTower(ctx, L, pr, o) {
  const { rnd, lv, band, wall, roof, H, glass, dead } = o;
  const { bw, bh } = pr;
  paving(ctx, pr, '#918f89', 'rgba(0,0,0,.10)');
  if (!dead) { tree(ctx, pr, 0.12, bh - 0.10, 0.8); tree(ctx, pr, bw - 0.12, bh - 0.10, 0.8); }

  const podH = 11;
  box(ctx, pr, 0.05, 0.05, bw - 0.05, bh - 0.05, 0, podH, mat(shade(wall, 0.88)));
  windowGrid(ctx, faceSW(pr, 0.05, bw - 0.05, bh - 0.05, 1, podH),
    { cols: 6, rows: 1, glass: '#2b4a63', frame: '#1b2c3a', style: 'curtain', rnd, lights: L, litChance: 0.7 });
  entranceCanopy(ctx, pr, bw / 2 - 0.4, bw / 2 + 0.4, bh - 0.05, mat('#c8ced4'));

  const t = 0.18;
  const seg1 = band >= 1 ? H * 0.66 : H;
  box(ctx, pr, t, t, bw - t, bh - t, podH, seg1, mat(wall));
  const floors1 = Math.max(4, Math.round((seg1 - podH) / 10));
  const glassCols = Math.max(4, Math.round((bw - 2 * t) * 3));
  windowGrid(ctx, faceSW(pr, t, bw - t, bh - t, podH, seg1),
    { cols: glassCols, rows: floors1, glass, frame: shade(wall, 0.62), style: 'curtain',
      rnd, lights: L, litChance: 0.42 });
  windowGrid(ctx, faceSE(pr, bw - t, t, bh - t, podH, seg1),
    { cols: glassCols, rows: floors1, glass: shade(glass, 0.9), frame: shade(wall, 0.62),
      style: 'curtain', rnd, lights: L, litChance: 0.45 });
  // 모서리 기둥
  box(ctx, pr, t, t, t + 0.1, bh - t, podH, seg1, mat(shade(wall, 1.12)));
  box(ctx, pr, bw - t - 0.1, t, bw - t, bh - t, podH, seg1, mat(shade(wall, 1.12)));

  let top = seg1;
  if (band >= 1) {
    const s = t + 0.14;
    box(ctx, pr, s, s, bw - s, bh - s, seg1, H, mat(shade(wall, 1.05)));
    const floors2 = Math.max(3, Math.round((H - seg1) / 10));
    windowGrid(ctx, faceSW(pr, s, bw - s, bh - s, seg1, H),
      { cols: glassCols - 1, rows: floors2, glass, frame: shade(wall, 0.62), style: 'curtain',
        rnd, lights: L, litChance: 0.6 });
    windowGrid(ctx, faceSE(pr, bw - s, s, bh - s, seg1, H),
      { cols: glassCols - 1, rows: floors2, glass: shade(glass, 0.9), frame: shade(wall, 0.62),
        style: 'curtain', rnd, lights: L, litChance: 0.5 });
    parapet(ctx, pr, s, s, bw - s, bh - s, H, mat(roof));
    top = H;
    roofProps(ctx, L, pr, rnd, s, s, bw - s, bh - s, top + 1,
      { units: 2, antenna: true, antennaH: 22, penthouseColor: '#aab1b8' });
    // 헬리패드
    if (band >= 2) {
      const c = pr.P(bw / 2, bh / 2, top + 2.5);
      ctx.fillStyle = '#5f666c';
      ctx.beginPath(); ctx.ellipse(c[0], c[1], 0.55 * pr.hw, 0.55 * pr.hh, 0, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = '#e8e4d8'; ctx.lineWidth = Math.max(0.8, 1.2 * pr.z);
      ctx.beginPath(); ctx.ellipse(c[0], c[1], 0.42 * pr.hw, 0.42 * pr.hh, 0, 0, 6.2832); ctx.stroke();
    }
  } else {
    parapet(ctx, pr, t, t, bw - t, bh - t, H, mat(roof));
    roofProps(ctx, L, pr, rnd, t, t, bw - t, bh - t, H + 1, { units: 3, antenna: true, antennaH: 18 });
  }
}

// ============================================================================
//  서비스 건물
// ============================================================================
function dome(ctx, pr, cx, cy, r, hb, rise, m) {
  const c = pr.P(cx, cy, hb);
  const rx = r * pr.hw, ry = r * pr.hh, rh = rise * pr.z;
  ctx.beginPath();
  ctx.moveTo(c[0] - rx, c[1]);
  ctx.bezierCurveTo(c[0] - rx, c[1] - rh, c[0] + rx, c[1] - rh, c[0] + rx, c[1]);
  ctx.ellipse(c[0], c[1], rx, ry, 0, 0, Math.PI, false);
  ctx.closePath();
  ctx.fillStyle = m.right; ctx.fill();
  ctx.beginPath();
  ctx.moveTo(c[0] - rx, c[1]);
  ctx.bezierCurveTo(c[0] - rx, c[1] - rh, c[0], c[1] - rh * 1.05, c[0], c[1] - rh * 0.98);
  ctx.lineTo(c[0], c[1] + ry); ctx.closePath();
  ctx.fillStyle = m.left; ctx.fill();
}

/** 경사진 태양광 패널 한 줄 */
function solarRow(ctx, pr, x0, x1, y, hb, ht) {
  const P = pr.P;
  const a = P(x0, y + 0.22, hb), b = P(x1, y + 0.22, hb);
  const c = P(x1, y, ht), d = P(x0, y, ht);
  poly(ctx, [d, c, b, a], '#26456e');
  poly(ctx, [d, c, b, a], null, '#8d949b', 0.6);
}

function flagpole(ctx, pr, x, y, h, color = '#c0392b') {
  const a = pr.P(x, y, 0), b = pr.P(x, y, h);
  ctx.strokeStyle = '#c9ced3'; ctx.lineWidth = Math.max(0.7, 1.2 * pr.z);
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  poly(ctx, [b, [b[0] + 7 * pr.z, b[1] + 2 * pr.z], [b[0], b[1] + 5 * pr.z]], color);
}

function bay(ctx, f, u0, u1, color, frame) {
  poly(ctx, cell(f, u0, u1, 0.04, 0.62), color);
  poly(ctx, cell(f, u0, u1, 0.04, 0.62), null, frame, 0.7);
}

function vehicle(ctx, pr, x, y, w, d, h, color) {
  box(ctx, pr, x, y, x + w, y + d, 0, h, mat(color));
  box(ctx, pr, x + w * 0.18, y + d * 0.12, x + w * 0.82, y + d * 0.88, h, h + 2.2, mat('#39424c'));
}

function roofSign(ctx, L, pr, cx, cy, h, color, lit) {
  box(ctx, pr, cx - 0.32, cy - 0.05, cx + 0.32, cy + 0.05, h, h + 7, mat(color));
  if (L) { const p = pr.P(cx, cy, h + 3.5); L.fillStyle = lit || 'rgba(255,140,90,.85)';
    L.beginPath(); L.ellipse(p[0], p[1], 12 * pr.z, 5 * pr.z, 0, 0, 6.2832); L.fill(); }
}

// --- 기본형 -------------------------------------------------------------------
function genericBlock(ctx, L, pr, a) {
  const { rnd, d, H } = a;
  const { bw, bh } = pr;
  paving(ctx, pr, '#918f88', 'rgba(0,0,0,.10)');
  const i = Math.min(0.12, bw * 0.08);
  const front = bh > 2.5 ? bh - 0.5 : bh - i;
  if (bh > 2.5) parking(ctx, pr, i, front + 0.06, bw - i, bh - i, rnd);

  const m = mat(d.color || '#c8cdd2');
  box(ctx, pr, i, i, bw - i, front, 0, H, m);
  const floors = Math.max(1, Math.round(H / 12));
  const cols = Math.max(3, Math.round((bw - 2 * i) * 2.4));
  windowGrid(ctx, faceSW(pr, i, bw - i, front, 0, H),
    { cols, rows: floors, glass: '#3d5a70', frame: shade(d.color || '#c8cdd2', 0.7),
      rnd, lights: L, litChance: 0.5 });
  windowGrid(ctx, faceSE(pr, bw - i, i, front, 0, H),
    { cols: Math.max(2, Math.round((front - i) * 2.4)), rows: floors, glass: '#37535f',
      frame: shade(d.color || '#c8cdd2', 0.7), rnd, lights: L, litChance: 0.4 });
  entranceCanopy(ctx, pr, bw / 2 - 0.35, bw / 2 + 0.35, front, mat('#bfc5cb'));
  parapet(ctx, pr, i, i, bw - i, front, H, mat(d.roof || d.color || '#9aa0a6'));
  roofProps(ctx, L, pr, rnd, i, i, bw - i, front, H + 1,
    { units: Math.min(4, Math.round(bw)), tank: bw > 2.5, antenna: false });
  if (bw >= 3) { tree(ctx, pr, i + 0.2, front + 0.2, 0.85); tree(ctx, pr, bw - i - 0.2, front + 0.2, 0.85); }
}

// --- 전력 ---------------------------------------------------------------------
const M = {};

M.wind = (ctx, L, pr, a) => {
  const { bw, bh, } = pr, { fx } = a;
  plate(ctx, pr, '#6f9d55');
  box(ctx, pr, bw / 2 - 0.28, bh / 2 - 0.28, bw / 2 + 0.28, bh / 2 + 0.28, 0, 2.2, mat('#b9bec3'));
  cyl(ctx, pr, bw / 2, bh / 2, 0.20, 2, 58, mat('#eef2f5'), { taper: 0.55 });
  box(ctx, pr, bw / 2 - 0.10, bh / 2 - 0.10, bw / 2 + 0.16, bh / 2 + 0.10, 56, 62, mat('#dfe5ea'));
  fx.blades = [{ x: bw / 2 + 0.14, y: bh / 2, h: 59, r: 22 }];
  if (L) { const p = pr.P(bw / 2, bh / 2, 60); L.fillStyle = '#ff5a4a';
    L.beginPath(); L.arc(p[0], p[1], 1.6 * pr.z, 0, 6.2832); L.fill(); }
};

M.coal = (ctx, L, pr, a) => {
  const { rnd, H, fx } = a, { bw, bh } = pr;
  plate(ctx, pr, '#77746c');
  fence(ctx, pr, 0.05, 0.05, bw - 0.05, bh - 0.05, '#8a8f93');
  // 석탄 야적
  box(ctx, pr, 0.15, bh - 1.15, 1.35, bh - 0.25, 0, 7, mat('#2f2c2a'));
  box(ctx, pr, 0.35, bh - 0.95, 1.15, bh - 0.45, 7, 11, mat('#3a3634'));
  // 보일러 하우스
  box(ctx, pr, 0.2, 0.25, bw * 0.62, bh - 1.35, 0, H, mat(a.d.color));
  windowGrid(ctx, faceSW(pr, 0.2, bw * 0.62, bh - 1.35, 0, H),
    { cols: 6, rows: 3, glass: '#3f5a6e', frame: '#6f767c', rnd, lights: L, litChance: 0.4 });
  parapet(ctx, pr, 0.2, 0.25, bw * 0.62, bh - 1.35, H, mat(a.d.roof));
  roofProps(ctx, L, pr, rnd, 0.2, 0.25, bw * 0.62, bh - 1.35, H + 1, { units: 4, penthouse: false });
  // 냉각탑 2기
  cyl(ctx, pr, bw - 0.85, 0.9, 0.62, 0, 34, mat('#c6c9cc'), { taper: 0.82 });
  cyl(ctx, pr, bw - 0.85, 2.2, 0.62, 0, 34, mat('#c6c9cc'), { taper: 0.82 });
  // 굴뚝
  cyl(ctx, pr, 0.55, 0.55, 0.24, 0, H + 42, mat('#d5d2cb'), { taper: 0.85 });
  box(ctx, pr, 0.42, 0.42, 0.68, 0.68, H + 30, H + 36, mat('#b3453a'));
  fx.smoke = [
    { x: 0.55, y: 0.55, h: H + 42, r: 0.28, dark: true },
    { x: bw - 0.85, y: 0.9, h: 34, r: 0.5, steam: true },
    { x: bw - 0.85, y: 2.2, h: 34, r: 0.5, steam: true },
  ];
  if (L) { const p = pr.P(0.55, 0.55, H + 41); L.fillStyle = '#ff5a4a';
    L.beginPath(); L.arc(p[0], p[1], 1.8 * pr.z, 0, 6.2832); L.fill(); }
};

M.gas = (ctx, L, pr, a) => {
  const { rnd, H, fx } = a, { bw, bh } = pr;
  plate(ctx, pr, '#7a776f');
  fence(ctx, pr, 0.05, 0.05, bw - 0.05, bh - 0.05, '#8a8f93');
  box(ctx, pr, 0.18, 0.5, bw - 0.7, bh - 0.2, 0, H, mat(a.d.color));
  windowGrid(ctx, faceSW(pr, 0.18, bw - 0.7, bh - 0.2, 0, H),
    { cols: 5, rows: 2, glass: '#3f5a6e', frame: '#767d83', rnd, lights: L, litChance: 0.45 });
  parapet(ctx, pr, 0.18, 0.5, bw - 0.7, bh - 0.2, H, mat(a.d.roof));
  roofProps(ctx, L, pr, rnd, 0.18, 0.5, bw - 0.7, bh - 0.2, H + 1, { units: 3 });
  cyl(ctx, pr, bw - 0.42, 0.45, 0.18, 0, H + 26, mat('#cfd3d6'), { taper: 0.9 });
  cyl(ctx, pr, bw - 0.42, 1.05, 0.18, 0, H + 22, mat('#cfd3d6'), { taper: 0.9 });
  cyl(ctx, pr, 0.5, 0.28, 0.34, 0, 12, mat('#b9c0c6'));
  fx.smoke = [{ x: bw - 0.42, y: 0.45, h: H + 26, r: 0.2, steam: true }];
};

M.solar = (ctx, L, pr, a) => {
  const { rnd, bw, bh } = { rnd: a.rnd, bw: pr.bw, bh: pr.bh };
  plate(ctx, pr, '#8a8571');
  fence(ctx, pr, 0.04, 0.04, bw - 0.04, bh - 0.04, '#9aa0a6');
  const rows = Math.round(bh * 1.6);
  for (let r = 0; r < rows; r++) {
    const y = 0.25 + (r * (bh - 0.7)) / rows;
    solarRow(ctx, pr, 0.2, bw - 0.55, y, 1.5, 7);
  }
  box(ctx, pr, bw - 0.5, bh - 0.7, bw - 0.12, bh - 0.2, 0, 9, mat('#b8bec4'));
  box(ctx, pr, bw - 0.5, 0.2, bw - 0.2, 0.5, 0, 6, mat('#9aa0a6'));
};

M.nuclear = (ctx, L, pr, a) => {
  const { rnd, H, fx } = a, { bw, bh } = pr;
  plate(ctx, pr, '#79766e');
  fence(ctx, pr, 0.04, 0.04, bw - 0.04, bh - 0.04, '#9aa0a6');
  // 격납건물 (원통 + 돔)
  cyl(ctx, pr, 1.1, 1.2, 0.7, 0, H * 0.62, mat('#d0d4d8'));
  dome(ctx, pr, 1.1, 1.2, 0.7, H * 0.62, 22, mat('#c2c7cb'));
  // 터빈 홀
  box(ctx, pr, 2.1, 0.6, bw - 0.25, 2.1, 0, H * 0.5, mat(a.d.color));
  gableRoof(ctx, pr, 2.05, 0.55, bw - 0.2, 2.15, H * 0.5, 8, mat(a.d.roof), 'y');
  windowGrid(ctx, faceSW(pr, 2.1, bw - 0.25, 2.1, 0, H * 0.5),
    { cols: 6, rows: 2, glass: '#43607a', frame: '#8d949b', rnd, lights: L, litChance: 0.5 });
  // 냉각탑
  cyl(ctx, pr, 1.0, bh - 1.0, 0.85, 0, 44, mat('#c9ccd0'), { taper: 0.8 });
  cyl(ctx, pr, 2.9, bh - 1.0, 0.85, 0, 44, mat('#c9ccd0'), { taper: 0.8 });
  fx.smoke = [
    { x: 1.0, y: bh - 1.0, h: 44, r: 0.7, steam: true },
    { x: 2.9, y: bh - 1.0, h: 44, r: 0.7, steam: true },
  ];
};

M.pylon = (ctx, L, pr) => {
  const { bw, bh } = pr;
  const cx = bw / 2, cy = bh / 2;
  const m = '#9298a0';
  ctx.strokeStyle = m; ctx.lineWidth = Math.max(0.8, 1.5 * pr.z);
  const legs = [[-0.30, -0.30], [0.30, -0.30], [0.30, 0.30], [-0.30, 0.30]];
  ctx.beginPath();
  for (const [ox, oy] of legs) {
    const a = pr.P(cx + ox, cy + oy, 0), b = pr.P(cx + ox * 0.18, cy + oy * 0.18, 44);
    ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
  }
  for (let h = 6; h < 44; h += 7) {
    const p = legs.map(([ox, oy]) => {
      const t = 1 - h / 52;
      return pr.P(cx + ox * t, cy + oy * t, h);
    });
    ctx.moveTo(p[0][0], p[0][1]);
    for (let i = 1; i < 4; i++) ctx.lineTo(p[i][0], p[i][1]);
    ctx.closePath();
  }
  ctx.stroke();
  // 완철 + 애자
  for (const h of [34, 42]) {
    const a = pr.P(cx - 0.62, cy, h), b = pr.P(cx + 0.62, cy, h);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    for (const p of [a, b]) { ctx.fillStyle = '#5f666c';
      ctx.beginPath(); ctx.arc(p[0], p[1] + 2 * pr.z, 1.4 * pr.z, 0, 6.2832); ctx.fill(); }
  }
  if (L) { const p = pr.P(cx, cy, 46); L.fillStyle = '#ff5a4a';
    L.beginPath(); L.arc(p[0], p[1], 1.5 * pr.z, 0, 6.2832); L.fill(); }
};

// --- 상하수도 ------------------------------------------------------------------
M.pump = (ctx, L, pr, a) => {
  const { rnd, H } = a, { bw, bh } = pr;
  plate(ctx, pr, '#8b8d84');
  box(ctx, pr, 0.2, 0.2, bw - 0.5, bh - 0.5, 0, H, mat(a.d.color));
  gableRoof(ctx, pr, 0.15, 0.15, bw - 0.45, bh - 0.45, H, 5, mat(a.d.roof), 'x');
  windowGrid(ctx, faceSW(pr, 0.2, bw - 0.5, bh - 0.5, 0, H),
    { cols: 3, rows: 1, glass: '#3f6076', frame: '#7d858c', rnd, lights: L, litChance: 0.5 });
  // 취수관
  for (let i = 0; i < 3; i++) {
    const y = bh - 0.42 + i * 0.14;
    box(ctx, pr, 0.3, y, bw - 0.1, y + 0.08, 1, 3.4, mat('#8d949b'));
  }
  cyl(ctx, pr, bw - 0.3, 0.4, 0.22, 0, 10, mat('#9fb0bc'));
};

M.wtower = (ctx, L, pr, a) => {
  const { bw, bh } = pr;
  plate(ctx, pr, '#8b8d84');
  const cx = bw / 2, cy = bh / 2;
  ctx.strokeStyle = '#8d949b'; ctx.lineWidth = Math.max(0.9, 1.6 * pr.z);
  ctx.beginPath();
  for (const [ox, oy] of [[-0.26, -0.26], [0.26, -0.26], [0.26, 0.26], [-0.26, 0.26]]) {
    const p0 = pr.P(cx + ox, cy + oy, 0), p1 = pr.P(cx + ox * 0.45, cy + oy * 0.45, 30);
    ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]);
  }
  const c0 = pr.P(cx - 0.26, cy + 0.26, 16), c1 = pr.P(cx + 0.26, cy - 0.26, 16);
  ctx.moveTo(c0[0], c0[1]); ctx.lineTo(c1[0], c1[1]);
  ctx.stroke();
  cyl(ctx, pr, cx, cy, 0.42, 30, 42, mat(a.d.color));
  dome(ctx, pr, cx, cy, 0.42, 42, 7, mat(a.d.roof));
  if (L) { const p = pr.P(cx, cy, 44); L.fillStyle = 'rgba(255,90,74,.9)';
    L.beginPath(); L.arc(p[0], p[1], 1.4 * pr.z, 0, 6.2832); L.fill(); }
};

M.sewage = (ctx, L, pr, a) => {
  const { rnd } = a, { bw, bh } = pr;
  plate(ctx, pr, '#84867d');
  clarifier(ctx, pr, 0.62, 0.62, 0.5);
  clarifier(ctx, pr, bw - 0.62, 0.62, 0.5);
  box(ctx, pr, 0.35, bh - 0.62, bw - 0.35, bh - 0.2, 0, 10, mat(a.d.color));
  gableRoof(ctx, pr, 0.30, bh - 0.67, bw - 0.30, bh - 0.15, 10, 4, mat(a.d.roof), 'x');
  for (let i = 0; i < 2; i++)
    box(ctx, pr, 0.2 + i * 0.9, bh - 0.15, 0.5 + i * 0.9, bh, 1, 3.2, mat('#8d949b'));
};

function clarifier(ctx, pr, cx, cy, r) {
  cyl(ctx, pr, cx, cy, r, 0, 5, mat('#b6bcc0'));
  const c = pr.P(cx, cy, 5);
  ctx.beginPath();
  ctx.ellipse(c[0], c[1], r * pr.hw * 0.86, r * pr.hh * 0.86, 0, 0, 6.2832);
  ctx.fillStyle = '#4a6a78'; ctx.fill();
  const a = pr.P(cx - r * 0.9, cy, 6.5), b = pr.P(cx + r * 0.9, cy, 6.5);
  ctx.strokeStyle = '#9aa1a8'; ctx.lineWidth = Math.max(0.8, 1.3 * pr.z);
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
}

M.wtp = (ctx, L, pr, a) => {
  const { rnd, H } = a, { bw, bh } = pr;
  plate(ctx, pr, '#84867d');
  fence(ctx, pr, 0.05, 0.05, bw - 0.05, bh - 0.05, '#9aa0a6');
  clarifier(ctx, pr, 0.75, 0.8, 0.6);
  clarifier(ctx, pr, 2.0, 0.8, 0.6);
  clarifier(ctx, pr, 3.2, 0.8, 0.6);
  // 폭기조
  box(ctx, pr, 0.3, bh - 1.3, bw - 1.1, bh - 0.35, 0, 5, mat('#aeb4b8'));
  box(ctx, pr, 0.4, bh - 1.2, bw - 1.2, bh - 0.45, 3, 4.4, mat('#4f7180'), { noSides: true });
  // 관리동
  box(ctx, pr, bw - 0.95, bh - 1.2, bw - 0.2, bh - 0.3, 0, H, mat(a.d.color));
  parapet(ctx, pr, bw - 0.95, bh - 1.2, bw - 0.2, bh - 0.3, H, mat(a.d.roof));
  windowGrid(ctx, faceSW(pr, bw - 0.95, bw - 0.2, bh - 0.3, 0, H),
    { cols: 3, rows: 2, glass: '#3f6076', frame: '#8d949b', rnd, lights: L, litChance: 0.5 });
};

// --- 폐기물 --------------------------------------------------------------------
M.landfill = (ctx, L, pr, a) => {
  const { rnd } = a, { bw, bh } = pr;
  plate(ctx, pr, '#7e7a68');
  fence(ctx, pr, 0.05, 0.05, bw - 0.05, bh - 0.05, '#8f9490');
  // 계단식 매립 더미
  const layers = [[0.35, 0.35, bw - 0.35, bh - 0.35, 0, 5],
                  [0.7, 0.7, bw - 0.7, bh - 0.7, 5, 9],
                  [1.15, 1.15, bw - 1.15, bh - 1.15, 9, 13]];
  const cols = ['#6e6a55', '#7a7560', '#847e68'];
  layers.forEach((l, i) => box(ctx, pr, l[0], l[1], l[2], l[3], l[4], l[5], mat(cols[i])));
  // 쓰레기 알갱이
  for (let i = 0; i < 26; i++) {
    const p = pr.P(0.4 + rnd() * (bw - 0.8), 0.4 + rnd() * (bh - 0.8), 5 + rnd() * 8);
    ctx.fillStyle = ['#9a5b4a', '#5d7a8a', '#8a8a4e', '#7a6f8a'][(rnd() * 4) | 0];
    ctx.fillRect(p[0], p[1], 2.4 * pr.z, 1.6 * pr.z);
  }
  // 진입로 + 관리동 + 불도저
  box(ctx, pr, 0.1, bh - 0.42, bw - 0.1, bh - 0.12, -1, 0, mat('#5b5c58'), { noSides: true });
  box(ctx, pr, 0.15, 0.12, 0.75, 0.5, 0, 9, mat('#c3c7ca'));
  gableRoof(ctx, pr, 0.10, 0.07, 0.80, 0.55, 9, 3.5, mat('#8b6f4e'), 'x');
  vehicle(ctx, pr, bw - 1.0, bh - 0.36, 0.5, 0.24, 4.5, '#d2a02a');
};

M.incin = (ctx, L, pr, a) => {
  const { rnd, H, fx } = a, { bw, bh } = pr;
  plate(ctx, pr, '#7c7a72');
  fence(ctx, pr, 0.05, 0.05, bw - 0.05, bh - 0.05, '#8f9490');
  box(ctx, pr, 0.25, 0.45, bw - 0.9, bh - 0.5, 0, H, mat(a.d.color));
  parapet(ctx, pr, 0.25, 0.45, bw - 0.9, bh - 0.5, H, mat(a.d.roof));
  windowGrid(ctx, faceSW(pr, 0.25, bw - 0.9, bh - 0.5, 0, H),
    { cols: 5, rows: 3, glass: '#3f5a6e', frame: '#7d858c', style: 'ribbon', rnd, lights: L, litChance: 0.5 });
  roofProps(ctx, L, pr, rnd, 0.25, 0.45, bw - 0.9, bh - 0.5, H + 1, { units: 4 });
  // 반입 홀 + 셔터
  bay(ctx, faceSW(pr, 0.25, bw - 0.9, bh - 0.5, 0, H), 0.10, 0.34, '#4d5257', '#8d949b');
  // 굴뚝
  cyl(ctx, pr, bw - 0.55, 0.85, 0.22, 0, H + 40, mat('#d3d6d9'), { taper: 0.86 });
  box(ctx, pr, bw - 0.68, 0.72, bw - 0.42, 0.98, H + 28, H + 33, mat('#b3453a'));
  fx.smoke = [{ x: bw - 0.55, y: 0.85, h: H + 40, r: 0.24, steam: true }];
  vehicle(ctx, pr, 0.6, bh - 0.4, 0.7, 0.3, 5, '#8a8f93');
};

M.recycle = (ctx, L, pr, a) => {
  const { rnd, H } = a, { bw, bh } = pr;
  plate(ctx, pr, '#7d7f76');
  fence(ctx, pr, 0.05, 0.05, bw - 0.05, bh - 0.05, '#8f9490');
  box(ctx, pr, 0.25, 0.3, bw - 0.3, bh - 1.1, 0, H, mat(a.d.color));
  gableRoof(ctx, pr, 0.20, 0.25, bw - 0.25, bh - 1.05, H, 7, mat(a.d.roof), 'x');
  windowGrid(ctx, faceSW(pr, 0.25, bw - 0.3, bh - 1.1, 0, H),
    { cols: 5, rows: 2, glass: '#3f6b58', frame: '#7d858c', style: 'ribbon', rnd, lights: L, litChance: 0.45 });
  // 분류 야적장
  const cols2 = ['#5f8ab0', '#c9a13c', '#7fa14a', '#a0574a'];
  for (let i = 0; i < 4; i++) {
    const x = 0.3 + i * ((bw - 0.9) / 4);
    box(ctx, pr, x, bh - 0.95, x + (bw - 1.1) / 4, bh - 0.25, 0, 1.2, mat('#6b6d6a'));
    box(ctx, pr, x + 0.05, bh - 0.88, x + (bw - 1.1) / 4 - 0.05, bh - 0.32, 1.2, 5.5,
        mat(cols2[i % cols2.length]));
  }
  vehicle(ctx, pr, bw - 0.9, bh - 0.2, 0.6, 0.26, 4.6, '#4d8a5a');
};

// --- 의료 ---------------------------------------------------------------------
function redCross(ctx, pr, cx, cy, h, s = 0.22) {
  box(ctx, pr, cx - s, cy - s * 0.42, cx + s, cy + s * 0.42, h, h + 0.6, mat('#e03a3a'), { noSides: true });
  box(ctx, pr, cx - s * 0.42, cy - s, cx + s * 0.42, cy + s, h, h + 0.6, mat('#e03a3a'), { noSides: true });
}

M.clinic = (ctx, L, pr, a) => {
  const { rnd, H } = a, { bw, bh } = pr;
  paving(ctx, pr, '#95938c', 'rgba(0,0,0,.10)');
  box(ctx, pr, 0.12, 0.12, bw - 0.12, bh - 0.45, 0, H, mat(a.d.color));
  windowGrid(ctx, faceSW(pr, 0.12, bw - 0.12, bh - 0.45, 0, H),
    { cols: 4, rows: 2, glass: '#4a6d84', frame: '#c2c6ca', style: 'ribbon', rnd, lights: L, litChance: 0.65 });
  entranceCanopy(ctx, pr, bw / 2 - 0.3, bw / 2 + 0.3, bh - 0.45, mat('#d8dcdf'));
  parapet(ctx, pr, 0.12, 0.12, bw - 0.12, bh - 0.45, H, mat(a.d.roof));
  redCross(ctx, pr, bw / 2, (bh - 0.33) / 2, H + 2.6, 0.3);
  roofProps(ctx, L, pr, rnd, 0.12, 0.12, bw - 0.12, bh - 0.45, H + 1, { units: 2, penthouse: false });
  vehicle(ctx, pr, 0.2, bh - 0.36, 0.6, 0.26, 5, '#eef1f3');
  if (L) { const p = pr.P(0.5, bh - 0.23, 5.4); L.fillStyle = 'rgba(255,70,60,.9)';
    L.beginPath(); L.arc(p[0], p[1], 2.2 * pr.z, 0, 6.2832); L.fill(); }
};

M.hospital = (ctx, L, pr, a) => {
  const { rnd, H } = a, { bw, bh } = pr;
  paving(ctx, pr, '#95938c', 'rgba(0,0,0,.10)');
  parking(ctx, pr, 0.15, bh - 0.85, bw - 0.15, bh - 0.15, rnd);
  const front = bh - 0.95;
  // 본관 + 양쪽 병동
  box(ctx, pr, 0.15, 0.2, bw - 0.15, front, 0, H, mat(a.d.color));
  box(ctx, pr, 0.15, 0.2, 0.9, front + 0.35, 0, H * 0.72, mat(shade(a.d.color, 0.95)));
  box(ctx, pr, bw - 0.9, 0.2, bw - 0.15, front + 0.35, 0, H * 0.72, mat(shade(a.d.color, 0.95)));
  const floors = Math.max(4, Math.round(H / 11));
  windowGrid(ctx, faceSW(pr, 0.15, bw - 0.15, front, 0, H),
    { cols: 8, rows: floors, glass: '#4a6d84', frame: '#cbcfd3', style: 'ribbon', rnd, lights: L, litChance: 0.66 });
  windowGrid(ctx, faceSE(pr, bw - 0.15, 0.2, front, 0, H),
    { cols: 5, rows: floors, glass: '#43647a', frame: '#cbcfd3', style: 'ribbon', rnd, lights: L, litChance: 0.55 });
  entranceCanopy(ctx, pr, bw / 2 - 0.55, bw / 2 + 0.55, front + 0.35, mat('#dde1e4'));
  parapet(ctx, pr, 0.15, 0.2, bw - 0.15, front, H, mat(a.d.roof));
  // 옥상 헬리패드
  const c = pr.P(bw / 2, (0.2 + front) / 2, H + 2.6);
  ctx.fillStyle = '#5f666c';
  ctx.beginPath(); ctx.ellipse(c[0], c[1], 0.75 * pr.hw, 0.75 * pr.hh, 0, 0, 6.2832); ctx.fill();
  ctx.strokeStyle = '#f0ece0'; ctx.lineWidth = Math.max(0.9, 1.4 * pr.z);
  ctx.beginPath(); ctx.ellipse(c[0], c[1], 0.58 * pr.hw, 0.58 * pr.hh, 0, 0, 6.2832); ctx.stroke();
  ctx.font = `${8 * pr.z}px system-ui`; ctx.fillStyle = '#f0ece0';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('H', c[0], c[1]);
  redCross(ctx, pr, 0.55, 0.5, H * 0.72 + 2.6, 0.28);
  roofProps(ctx, L, pr, rnd, bw - 0.9, 0.25, bw - 0.2, front - 0.1, H * 0.72 + 1, { units: 3, penthouse: false });
  vehicle(ctx, pr, 0.3, front + 0.42, 0.65, 0.28, 5.4, '#eef1f3');
  vehicle(ctx, pr, 1.1, front + 0.42, 0.65, 0.28, 5.4, '#eef1f3');
};

M.cemetery = (ctx, L, pr, a) => {
  const { rnd } = a, { bw, bh } = pr;
  plate(ctx, pr, '#63914f');
  // 산책로
  box(ctx, pr, bw / 2 - 0.10, 0.1, bw / 2 + 0.10, bh - 0.1, -0.8, 0, mat('#b3ab96'), { noSides: true });
  // 예배당
  box(ctx, pr, 0.2, 0.15, 0.95, 0.75, 0, 11, mat('#d8d4c8'));
  gableRoof(ctx, pr, 0.15, 0.10, 1.0, 0.80, 11, 6, mat('#7d6a52'), 'x');
  const cs = pr.P(0.575, 0.45, 20.5), ce = pr.P(0.575, 0.45, 26);
  ctx.strokeStyle = '#9a9384'; ctx.lineWidth = Math.max(0.8, 1.3 * pr.z);
  ctx.beginPath(); ctx.moveTo(cs[0], cs[1]); ctx.lineTo(ce[0], ce[1]);
  ctx.moveTo(ce[0] - 3 * pr.z, ce[1] + 3 * pr.z); ctx.lineTo(ce[0] + 3 * pr.z, ce[1] + 3 * pr.z);
  ctx.stroke();
  // 묘비
  for (let r = 0; r < 5; r++) {
    for (let c2 = 0; c2 < 7; c2++) {
      const x = 0.25 + c2 * 0.38, y = 1.0 + r * 0.36;
      if (x > bw - 0.2 || y > bh - 0.2) continue;
      if (Math.abs(x - bw / 2) < 0.16) continue;
      box(ctx, pr, x, y, x + 0.12, y + 0.07, 0, 2.8 + rnd() * 1.2, mat(rnd() < 0.5 ? '#c9c6bd' : '#b3b0a6'));
    }
  }
  tree(ctx, pr, bw - 0.3, 0.4, 1.05, '#2f6b3a');
  tree(ctx, pr, 0.25, bh - 0.3, 1.0, '#2f6b3a');
  fence(ctx, pr, 0.06, 0.06, bw - 0.06, bh - 0.06, '#a8a396');
};

M.cremat = (ctx, L, pr, a) => {
  const { rnd, H, fx } = a, { bw, bh } = pr;
  plate(ctx, pr, '#6f9d55');
  box(ctx, pr, bw / 2 - 0.1, 0.15, bw / 2 + 0.1, bh - 0.15, -0.8, 0, mat('#b3ab96'), { noSides: true });
  box(ctx, pr, 0.25, 0.3, bw - 0.25, bh - 0.5, 0, H, mat(a.d.color));
  gableRoof(ctx, pr, 0.20, 0.25, bw - 0.20, bh - 0.45, H, 9, mat(a.d.roof), 'x');
  windowGrid(ctx, faceSW(pr, 0.25, bw - 0.25, bh - 0.5, 0, H),
    { cols: 4, rows: 1, glass: '#5d6f86', frame: '#b6b1a6', rnd, lights: L, litChance: 0.5, marginY: 0.18 });
  cyl(ctx, pr, bw - 0.45, 0.5, 0.14, 0, H + 20, mat('#c6c2b8'), { taper: 0.85 });
  fx.smoke = [{ x: bw - 0.45, y: 0.5, h: H + 20, r: 0.16, steam: true }];
  tree(ctx, pr, 0.3, bh - 0.25, 0.9, '#2f6b3a');
  tree(ctx, pr, bw - 0.3, bh - 0.25, 0.9, '#2f6b3a');
};

// --- 소방 / 경찰 ----------------------------------------------------------------
function stationBlock(ctx, L, pr, a, opt) {
  const { rnd, H } = a, { bw, bh } = pr;
  paving(ctx, pr, '#8e8c86', 'rgba(0,0,0,.10)');
  const apron = bh - 0.55;
  box(ctx, pr, 0.1, apron, bw - 0.1, bh - 0.08, -1, 0, mat('#55585c'), { noSides: true });
  box(ctx, pr, 0.12, 0.15, bw - 0.12, apron, 0, H, mat(a.d.color));
  const f = faceSW(pr, 0.12, bw - 0.12, apron, 0, H);
  // 차고 셔터
  const bays = opt.bays;
  for (let i = 0; i < bays; i++) {
    const u0 = 0.06 + (0.88 * i) / bays + 0.02, u1 = 0.06 + (0.88 * (i + 1)) / bays - 0.02;
    poly(ctx, cell(f, u0, u1, 0.03, 0.52), opt.doorColor);
    poly(ctx, cell(f, u0, u1, 0.03, 0.52), null, '#e6e6e6', 0.7);
    if (L) poly(L, cell(f, u0 + 0.01, u1 - 0.01, 0.05, 0.48), 'rgba(255,225,150,.45)');
  }
  windowGrid(ctx, f, { cols: bays * 2, rows: 1, glass: '#41607a', frame: '#dcdcdc',
    rnd, lights: L, litChance: 0.6, marginY: 0.2 });
  parapet(ctx, pr, 0.12, 0.15, bw - 0.12, apron, H, mat(a.d.roof));
  roofProps(ctx, L, pr, rnd, 0.12, 0.15, bw - 0.12, apron, H + 1,
    { units: 2, penthouse: false, antenna: true, antennaH: opt.antennaH || 14 });
  // 훈련탑 / 통신탑
  if (opt.tower) {
    box(ctx, pr, bw - 0.62, 0.2, bw - 0.2, 0.62, 0, H + 16, mat(shade(a.d.color, 0.95)));
    box(ctx, pr, bw - 0.62, 0.2, bw - 0.2, 0.62, H + 16, H + 18, mat(a.d.roof));
  }
  // 차량
  for (let i = 0; i < Math.min(3, bays); i++)
    vehicle(ctx, pr, 0.25 + i * 0.85, apron + 0.12, 0.62, 0.28, 5.6, opt.vehicle);
  if (L) for (let i = 0; i < Math.min(3, bays); i++) {
    const p = pr.P(0.56 + i * 0.85, apron + 0.26, 8);
    L.fillStyle = opt.beacon; L.beginPath(); L.arc(p[0], p[1], 2.2 * pr.z, 0, 6.2832); L.fill();
  }
  flagpole(ctx, pr, 0.2, apron + 0.35, 16, opt.flag);
}

M.firehouse = (ctx, L, pr, a) => stationBlock(ctx, L, pr, a,
  { bays: 2, doorColor: '#8e2f26', vehicle: '#c0392b', beacon: 'rgba(255,60,50,.9)', flag: '#c0392b' });
M.firehq = (ctx, L, pr, a) => stationBlock(ctx, L, pr, a,
  { bays: 4, doorColor: '#8e2f26', vehicle: '#c0392b', beacon: 'rgba(255,60,50,.9)', flag: '#c0392b', tower: true });
M.police = (ctx, L, pr, a) => stationBlock(ctx, L, pr, a,
  { bays: 2, doorColor: '#26415f', vehicle: '#2c5d9b', beacon: 'rgba(80,150,255,.9)', flag: '#2c5d9b' });
M.policehq = (ctx, L, pr, a) => stationBlock(ctx, L, pr, a,
  { bays: 3, doorColor: '#26415f', vehicle: '#2c5d9b', beacon: 'rgba(80,150,255,.9)', flag: '#2c5d9b',
    tower: true, antennaH: 22 });

// --- 교육 ---------------------------------------------------------------------
function school(ctx, L, pr, a, opt) {
  const { rnd, H } = a, { bw, bh } = pr;
  plate(ctx, pr, '#6f9d55');
  // 운동장
  box(ctx, pr, 0.15, bh - opt.yard, bw - 0.15, bh - 0.12, -1, 0, mat('#b5794a'), { noSides: true });
  if (opt.track) {
    const c = pr.P(bw / 2, bh - opt.yard / 2 - 0.06, 0.4);
    ctx.strokeStyle = '#e4e0d2'; ctx.lineWidth = Math.max(0.8, 1.3 * pr.z);
    ctx.beginPath(); ctx.ellipse(c[0], c[1], (bw / 2 - 0.4) * pr.hw * 1.6, (opt.yard / 2 - 0.2) * pr.hh * 1.6, 0, 0, 6.2832);
    ctx.stroke();
    ctx.fillStyle = '#4f8f4a';
    ctx.beginPath(); ctx.ellipse(c[0], c[1], (bw / 2 - 0.7) * pr.hw * 1.5, (opt.yard / 2 - 0.35) * pr.hh * 1.5, 0, 0, 6.2832);
    ctx.fill();
  }
  const front = bh - opt.yard - 0.08;
  box(ctx, pr, 0.15, 0.15, bw - 0.15, front, 0, H, mat(a.d.color));
  const floors = Math.max(2, Math.round(H / 10));
  windowGrid(ctx, faceSW(pr, 0.15, bw - 0.15, front, 0, H),
    { cols: Math.round(bw * 2.2), rows: floors, glass: '#4a6a84', frame: '#e0d5bb',
      style: 'ribbon', rnd, lights: L, litChance: 0.55 });
  windowGrid(ctx, faceSE(pr, bw - 0.15, 0.15, front, 0, H),
    { cols: Math.round(front * 2.2), rows: floors, glass: '#43617a', frame: '#e0d5bb',
      style: 'ribbon', rnd, lights: L, litChance: 0.4 });
  entranceCanopy(ctx, pr, bw / 2 - 0.35, bw / 2 + 0.35, front, mat('#e6dcc4'));
  gableRoof(ctx, pr, 0.10, 0.10, bw - 0.10, front + 0.05, H, opt.roofRise || 6, mat(a.d.roof), 'x');
  flagpole(ctx, pr, 0.3, front + 0.2, 18, '#2c5d9b');
  tree(ctx, pr, bw - 0.28, front + 0.25, 0.95);
  if (opt.clock) {
    box(ctx, pr, bw / 2 - 0.3, 0.2, bw / 2 + 0.3, 0.7, H, H + 20, mat(a.d.color));
    gableRoof(ctx, pr, bw / 2 - 0.34, 0.16, bw / 2 + 0.34, 0.74, H + 20, 7, mat(a.d.roof), 'x');
    const p = pr.P(bw / 2, 0.72, H + 13);
    ctx.fillStyle = '#f2ece0'; ctx.beginPath(); ctx.arc(p[0], p[1], 4.5 * pr.z, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = '#4a4137'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0], p[1] - 3 * pr.z);
    ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0] + 2.2 * pr.z, p[1]); ctx.stroke();
  }
}
M.elem = (ctx, L, pr, a) => school(ctx, L, pr, a, { yard: 1.0 });
M.high = (ctx, L, pr, a) => school(ctx, L, pr, a, { yard: 1.2, track: true });
M.univ = (ctx, L, pr, a) => school(ctx, L, pr, a, { yard: 2.0, track: true, clock: true, roofRise: 8 });
M.library = (ctx, L, pr, a) => {
  const { rnd, H } = a, { bw, bh } = pr;
  paving(ctx, pr, '#93918a', 'rgba(0,0,0,.10)');
  box(ctx, pr, 0.15, 0.15, bw - 0.15, bh - 0.35, 0, H, mat(a.d.color));
  // 열주
  for (let i = 0; i < 5; i++) {
    const x = 0.3 + i * ((bw - 0.6) / 4);
    cyl(ctx, pr, x, bh - 0.32, 0.09, 0, H * 0.85, mat('#efe8d8'));
  }
  box(ctx, pr, 0.12, bh - 0.42, bw - 0.12, bh - 0.24, H * 0.85, H * 0.95, mat('#efe8d8'));
  windowGrid(ctx, faceSE(pr, bw - 0.15, 0.15, bh - 0.35, 0, H),
    { cols: 4, rows: 2, glass: '#4a6a84', frame: '#cbbd9d', rnd, lights: L, litChance: 0.6 });
  gableRoof(ctx, pr, 0.10, 0.10, bw - 0.10, bh - 0.20, H, 6, mat(a.d.roof), 'x');
  tree(ctx, pr, 0.2, bh - 0.15, 0.85);
};

// --- 공원 ---------------------------------------------------------------------
function park(ctx, L, pr, a, opt) {
  const { rnd } = a, { bw, bh } = pr;
  plate(ctx, pr, opt.ground || '#5f9d4f');
  // 산책로
  ctx.strokeStyle = '#c8c0aa'; ctx.lineWidth = Math.max(1.2, 2.6 * pr.z);
  ctx.beginPath();
  const p0 = pr.P(0.1, bh / 2, 0.4), p1 = pr.P(bw - 0.1, bh / 2, 0.4);
  ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]);
  const q0 = pr.P(bw / 2, 0.1, 0.4), q1 = pr.P(bw / 2, bh - 0.1, 0.4);
  ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q1[0], q1[1]);
  ctx.stroke();
  // 연못
  if (opt.pond) {
    const c = pr.P(bw * 0.68, bh * 0.32, 0);
    ctx.fillStyle = '#3f6f96';
    ctx.beginPath(); ctx.ellipse(c[0], c[1], bw * 0.22 * pr.hw * 1.4, bh * 0.18 * pr.hh * 1.4, 0, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 0.8; ctx.stroke();
  }
  // 분수
  if (opt.fountain) {
    const cx = bw / 2, cy = bh / 2;
    cyl(ctx, pr, cx, cy, 0.34, 0, 2.6, mat('#c6c0b0'));
    const c = pr.P(cx, cy, 2.6);
    ctx.fillStyle = '#4f86ad';
    ctx.beginPath(); ctx.ellipse(c[0], c[1], 0.28 * pr.hw, 0.28 * pr.hh, 0, 0, 6.2832); ctx.fill();
    cyl(ctx, pr, cx, cy, 0.07, 2.6, 7, mat('#d8d2c2'));
    ctx.strokeStyle = 'rgba(190,225,240,.75)'; ctx.lineWidth = Math.max(0.8, 1.2 * pr.z);
    const t = pr.P(cx, cy, 7);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      ctx.moveTo(t[0], t[1] - 2 * pr.z);
      ctx.quadraticCurveTo(t[0] + Math.cos(ang) * 5 * pr.z, t[1] - 7 * pr.z,
                           t[0] + Math.cos(ang) * 9 * pr.z, t[1] + Math.sin(ang) * 3 * pr.z);
    }
    ctx.stroke();
    if (L) { L.fillStyle = 'rgba(150,210,255,.5)';
      L.beginPath(); L.ellipse(t[0], t[1], 12 * pr.z, 6 * pr.z, 0, 0, 6.2832); L.fill(); }
  }
  // 놀이기구
  if (opt.play) {
    const cx = bw * 0.3, cy = bh * 0.65;
    box(ctx, pr, cx - 0.3, cy - 0.3, cx + 0.3, cy + 0.3, -0.6, 0, mat('#d9c08e'), { noSides: true });
    box(ctx, pr, cx - 0.05, cy - 0.22, cx + 0.05, cy - 0.12, 0, 9, mat('#c0563a'));
    box(ctx, pr, cx - 0.05, cy + 0.12, cx + 0.05, cy + 0.22, 0, 9, mat('#c0563a'));
    box(ctx, pr, cx - 0.06, cy - 0.24, cx + 0.06, cy + 0.24, 9, 9.8, mat('#e0b23c'));
    poly(ctx, [pr.P(cx + 0.06, cy + 0.2, 9), pr.P(cx + 0.42, cy + 0.2, 0.4),
               pr.P(cx + 0.42, cy + 0.04, 0.4), pr.P(cx + 0.06, cy + 0.04, 9)], '#3f8ab0');
  }
  // 벤치
  const benches = opt.benches ?? 3;
  for (let i = 0; i < benches; i++) {
    const bx = 0.25 + rnd() * (bw - 0.5), by = 0.25 + rnd() * (bh - 0.5);
    box(ctx, pr, bx, by, bx + 0.22, by + 0.08, 0, 2.2, mat('#8b6a45'));
  }
  // 나무
  const n = opt.trees ?? Math.round(bw * bh * 1.1);
  for (let i = 0; i < n; i++) {
    const tx = 0.2 + rnd() * (bw - 0.4), ty = 0.2 + rnd() * (bh - 0.4);
    if (opt.fountain && Math.hypot(tx - bw / 2, ty - bh / 2) < 0.55) continue;
    tree(ctx, pr, tx, ty, 0.85 + rnd() * 0.45, rnd() < 0.4 ? '#2f6b3a' : '#3f8038');
  }
  // 가로등 (야간 조명)
  if (L) {
    for (let i = 0; i < Math.max(2, Math.round(bw)); i++) {
      const lx = 0.3 + (i * (bw - 0.6)) / Math.max(1, Math.round(bw) - 1 || 1);
      const p = pr.P(lx, bh / 2 - 0.18, 12);
      ctx.strokeStyle = '#7d858c'; ctx.lineWidth = Math.max(0.7, 1.1 * pr.z);
      const g = pr.P(lx, bh / 2 - 0.18, 0);
      ctx.beginPath(); ctx.moveTo(g[0], g[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
      L.fillStyle = 'rgba(255,225,160,.55)';
      L.beginPath(); L.ellipse(p[0], p[1] + 2 * pr.z, 9 * pr.z, 5 * pr.z, 0, 0, 6.2832); L.fill();
    }
  }
}
M.park1 = (ctx, L, pr, a) => park(ctx, L, pr, a, { trees: 2, benches: 1 });
M.playgr = (ctx, L, pr, a) => park(ctx, L, pr, a, { play: true, trees: 2, benches: 1, ground: '#63a153' });
M.plaza = (ctx, L, pr, a) => {
  const { bw, bh } = pr;
  paving(ctx, pr, '#c3bcab', 'rgba(0,0,0,.12)');
  park(ctx, L, pr, a, { fountain: true, trees: 3, benches: 3, ground: null });
};
M.citypark = (ctx, L, pr, a) => park(ctx, L, pr, a, { pond: true, play: true, trees: 12, benches: 4 });
M.garden = (ctx, L, pr, a) => {
  const { rnd } = a, { bw, bh } = pr;
  park(ctx, L, pr, a, { pond: true, trees: 8, benches: 3 });
  // 온실
  box(ctx, pr, bw - 1.5, 0.25, bw - 0.25, 1.35, 0, 12, mat('#cfe0e6'));
  gableRoof(ctx, pr, bw - 1.55, 0.2, bw - 0.2, 1.4, 12, 7, mat('#b6d2da'), 'x');
  if (L) poly(L, [pr.P(bw - 1.5, 1.35, 2), pr.P(bw - 0.25, 1.35, 2),
                  pr.P(bw - 0.25, 1.35, 11), pr.P(bw - 1.5, 1.35, 11)], 'rgba(190,230,240,.35)');
  // 화단
  for (let i = 0; i < 5; i++) {
    const fx2 = 0.3 + i * 0.5;
    if (fx2 > bw - 1.8) break;
    box(ctx, pr, fx2, bh - 1.0, fx2 + 0.34, bh - 0.4, 0, 1.8,
        mat(['#c85a7a', '#d8a13c', '#8a5ac8', '#d85a5a'][i % 4]));
  }
};

// --- 교통 ---------------------------------------------------------------------
M.busdepot = (ctx, L, pr, a) => {
  const { rnd, H } = a, { bw, bh } = pr;
  plate(ctx, pr, '#5a5c60');
  fence(ctx, pr, 0.05, 0.05, bw - 0.05, bh - 0.05, '#8f9490');
  box(ctx, pr, 0.15, 0.15, bw - 0.15, 1.1, 0, H, mat(a.d.color));
  gableRoof(ctx, pr, 0.10, 0.10, bw - 0.10, 1.15, H, 5, mat(a.d.roof), 'x');
  const f = faceSW(pr, 0.15, bw - 0.15, 1.1, 0, H);
  for (let i = 0; i < 3; i++) bay(ctx, f, 0.08 + i * 0.29, 0.30 + i * 0.29, '#4d5257', '#9aa0a6');
  // 주차된 버스
  const BUS = ['#5a8f3f', '#3f7f9f', '#c9a13c'];
  for (let i = 0; i < 4; i++) {
    const x = 0.25 + i * 0.85;
    if (x > bw - 0.9) break;
    box(ctx, pr, x, bh - 0.85, x + 0.68, bh - 0.28, 0, 8, mat(BUS[i % 3]));
    poly(ctx, cell(faceSW(pr, x, x + 0.68, bh - 0.28, 3.5, 7), 0.05, 0.95, 0.1, 0.9), '#33454f');
    if (L) poly(L, cell(faceSW(pr, x, x + 0.68, bh - 0.28, 3.5, 7), 0.08, 0.92, 0.15, 0.85),
                'rgba(255,225,160,.35)');
  }
};

M.busstop = (ctx, L, pr, a) => {
  paving(ctx, pr, '#9d9a92', 'rgba(0,0,0,.12)');
  box(ctx, pr, 0.20, 0.30, 0.72, 0.66, 0, 0.6, mat('#8d8a82'));
  // 기둥 + 지붕
  for (const [x, y] of [[0.22, 0.32], [0.68, 0.32], [0.22, 0.62], [0.68, 0.62]])
    box(ctx, pr, x - 0.02, y - 0.02, x + 0.02, y + 0.02, 0, 9, mat('#9aa0a6'));
  box(ctx, pr, 0.17, 0.26, 0.76, 0.70, 9, 10, mat('#4f7f9b'));
  // 뒷벽 유리 + 벤치
  poly(ctx, [pr.P(0.22, 0.32, 1), pr.P(0.68, 0.32, 1), pr.P(0.68, 0.32, 8.6), pr.P(0.22, 0.32, 8.6)],
       'rgba(150,190,215,.55)');
  box(ctx, pr, 0.26, 0.42, 0.66, 0.50, 0, 2.4, mat('#8b6a45'));
  // 표지판
  box(ctx, pr, 0.84, 0.46, 0.88, 0.52, 0, 11, mat('#9aa0a6'));
  box(ctx, pr, 0.80, 0.42, 0.92, 0.56, 11, 14, mat('#2c5d9b'));
  if (L) { const p = pr.P(0.45, 0.5, 9); L.fillStyle = 'rgba(255,230,170,.6)';
    L.beginPath(); L.ellipse(p[0], p[1], 11 * pr.z, 6 * pr.z, 0, 0, 6.2832); L.fill(); }
};

M.metro = (ctx, L, pr, a) => {
  const { rnd, H } = a, { bw, bh } = pr;
  paving(ctx, pr, '#9b988f', 'rgba(0,0,0,.12)');
  box(ctx, pr, 0.25, 0.25, bw - 0.25, bh - 0.25, 0, H, mat(a.d.color));
  // 유리 파빌리온
  windowGrid(ctx, faceSW(pr, 0.25, bw - 0.25, bh - 0.25, 1, H),
    { cols: 4, rows: 1, glass: 'rgba(120,170,200,.7)', frame: '#8d949b',
      style: 'curtain', rnd, lights: L, litChance: 0.9 });
  box(ctx, pr, 0.18, 0.18, bw - 0.18, bh - 0.18, H, H + 1.6, mat(a.d.roof));
  // 계단 입구
  box(ctx, pr, 0.5, bh - 0.3, bw - 0.5, bh - 0.1, -3, 0, mat('#4a4d52'), { noSides: true });
  // M 사인
  box(ctx, pr, bw - 0.35, 0.3, bw - 0.28, 0.4, 0, 12, mat('#8d949b'));
  const p = pr.P(bw - 0.315, 0.35, 14);
  ctx.fillStyle = '#2c5d9b';
  ctx.beginPath(); ctx.arc(p[0], p[1], 4.5 * pr.z, 0, 6.2832); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = `bold ${6 * pr.z}px system-ui`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('M', p[0], p[1]);
  if (L) { L.fillStyle = 'rgba(90,150,240,.8)';
    L.beginPath(); L.arc(p[0], p[1], 5 * pr.z, 0, 6.2832); L.fill(); }
};

M.cargo = (ctx, L, pr, a) => {
  const { rnd, H } = a, { bw, bh } = pr;
  plate(ctx, pr, '#6d6f72');
  fence(ctx, pr, 0.05, 0.05, bw - 0.05, bh - 0.05, '#8f9490');
  box(ctx, pr, 0.2, 0.25, bw - 1.4, bh - 0.9, 0, H, mat(a.d.color));
  gableRoof(ctx, pr, 0.15, 0.20, bw - 1.35, bh - 0.85, H, 5, mat(a.d.roof), 'x');
  const f = faceSW(pr, 0.2, bw - 1.4, bh - 0.9, 0, H);
  for (let i = 0; i < 3; i++) bay(ctx, f, 0.10 + i * 0.28, 0.30 + i * 0.28, '#4d5257', '#9aa0a6');
  // 컨테이너 야드
  const CC = ['#b0563a', '#3d6f8a', '#7a8a3d', '#8a7a3d', '#5a5f8a'];
  for (let r = 0; r < 3; r++) for (let c2 = 0; c2 < 4; c2++) {
    const x = bw - 1.25 + (c2 % 2) * 0.55, y = 0.3 + r * 0.7;
    if (y > bh - 0.6) continue;
    const stack = 1 + ((rnd() * 2.4) | 0);
    for (let s = 0; s < stack; s++)
      box(ctx, pr, x, y, x + 0.5, y + 0.28, s * 4.6, (s + 1) * 4.6, mat(CC[(rnd() * 5) | 0]));
  }
  // 갠트리 크레인
  const gy0 = bh - 0.75, gy1 = bh - 0.15;
  for (const y of [gy0, gy1]) {
    box(ctx, pr, 0.35, y, 0.45, y + 0.08, 0, 26, mat('#c9a13c'));
    box(ctx, pr, bw - 1.6, y, bw - 1.5, y + 0.08, 0, 26, mat('#c9a13c'));
  }
  box(ctx, pr, 0.35, gy0, bw - 1.5, gy0 + 0.10, 26, 29, mat('#d8b04a'));
  box(ctx, pr, 0.35, gy1, bw - 1.5, gy1 + 0.10, 26, 29, mat('#d8b04a'));
  vehicle(ctx, pr, 0.4, bh - 0.55, 0.8, 0.3, 6, '#d8dade');
};

// --- 통신 / 행정 ----------------------------------------------------------------
M.post = (ctx, L, pr, a) => {
  const { rnd, H } = a, { bw, bh } = pr;
  paving(ctx, pr, '#93918a', 'rgba(0,0,0,.10)');
  box(ctx, pr, 0.15, 0.15, bw - 0.15, bh - 0.45, 0, H, mat(a.d.color));
  windowGrid(ctx, faceSW(pr, 0.15, bw - 0.15, bh - 0.45, 0, H),
    { cols: 4, rows: 2, glass: '#4a6a84', frame: '#d6cec0', style: 'ribbon', rnd, lights: L, litChance: 0.6 });
  entranceCanopy(ctx, pr, bw / 2 - 0.3, bw / 2 + 0.3, bh - 0.45, mat('#ddd6c8'));
  parapet(ctx, pr, 0.15, 0.15, bw - 0.15, bh - 0.45, H, mat(a.d.roof));
  roofSign(ctx, L, pr, bw / 2, (bh - 0.3) / 2, H + 2, '#c0392b', 'rgba(255,120,90,.8)');
  vehicle(ctx, pr, 0.3, bh - 0.36, 0.55, 0.24, 5, '#d94f42');
  vehicle(ctx, pr, 1.1, bh - 0.36, 0.55, 0.24, 5, '#d94f42');
  // 우체통
  box(ctx, pr, bw - 0.35, bh - 0.3, bw - 0.25, bh - 0.2, 0, 4.5, mat('#c0392b'));
};

M.telecom = (ctx, L, pr, a) => {
  const { bw, bh } = pr;
  plate(ctx, pr, '#8b8d84');
  box(ctx, pr, 0.12, 0.62, 0.5, 0.9, 0, 8, mat('#b6bcc2'));
  const cx = bw * 0.55, cy = bh * 0.42;
  ctx.strokeStyle = '#a2a8ae'; ctx.lineWidth = Math.max(0.8, 1.4 * pr.z);
  ctx.beginPath();
  for (const [ox, oy] of [[-0.18, -0.18], [0.18, -0.18], [0, 0.2]]) {
    const p0 = pr.P(cx + ox, cy + oy, 0), p1 = pr.P(cx + ox * 0.15, cy + oy * 0.15, 48);
    ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]);
  }
  for (let h = 6; h < 48; h += 6) {
    const t = 1 - h / 56;
    const p = [[-0.18, -0.18], [0.18, -0.18], [0, 0.2]].map(([ox, oy]) => pr.P(cx + ox * t, cy + oy * t, h));
    ctx.moveTo(p[0][0], p[0][1]); ctx.lineTo(p[1][0], p[1][1]);
    ctx.lineTo(p[2][0], p[2][1]); ctx.closePath();
  }
  ctx.stroke();
  // 안테나 접시
  for (const h of [30, 38]) {
    const p = pr.P(cx + 0.16, cy, h);
    ctx.fillStyle = '#dfe3e6';
    ctx.beginPath(); ctx.ellipse(p[0], p[1], 4 * pr.z, 5.5 * pr.z, -0.4, 0, 6.2832); ctx.fill();
  }
  if (L) { const p = pr.P(cx, cy, 50); L.fillStyle = '#ff5a4a';
    L.beginPath(); L.arc(p[0], p[1], 2 * pr.z, 0, 6.2832); L.fill(); }
};

M.cityhall = (ctx, L, pr, a) => {
  const { rnd, H } = a, { bw, bh } = pr;
  plate(ctx, pr, '#6f9d55');
  box(ctx, pr, 0.1, bh - 0.9, bw - 0.1, bh - 0.1, -0.8, 0, mat('#c3bcab'), { noSides: true });
  // 계단 기단
  for (let s = 0; s < 3; s++)
    box(ctx, pr, 0.4 + s * 0.06, 0.4 + s * 0.06, bw - 0.4 - s * 0.06, bh - 0.75 + s * 0.06,
        s * 1.6, (s + 1) * 1.6, mat('#d8d2c2'));
  const base = 4.8;
  box(ctx, pr, 0.55, 0.55, bw - 0.55, bh - 0.7, base, H, mat(a.d.color));
  // 열주
  for (let i = 0; i < 6; i++) {
    const x = 0.62 + i * ((bw - 1.24) / 5);
    cyl(ctx, pr, x, bh - 0.66, 0.10, base, H * 0.86, mat('#f0e9d8'));
  }
  box(ctx, pr, 0.5, bh - 0.78, bw - 0.5, bh - 0.58, H * 0.86, H * 0.94, mat('#f0e9d8'));
  // 페디먼트
  gableRoof(ctx, pr, 0.5, 0.5, bw - 0.5, bh - 0.6, H, 8, mat(a.d.roof), 'x');
  // 돔
  cyl(ctx, pr, bw / 2, (0.5 + bh - 0.6) / 2, 0.45, H + 8, H + 14, mat('#e6dfcd'));
  dome(ctx, pr, bw / 2, (0.5 + bh - 0.6) / 2, 0.45, H + 14, 16, mat('#a8783f'));
  flagpole(ctx, pr, bw / 2, (0.5 + bh - 0.6) / 2 - 0.02, H + 40, '#2c5d9b');
  windowGrid(ctx, faceSE(pr, bw - 0.55, 0.55, bh - 0.7, base, H),
    { cols: 4, rows: 2, glass: '#4a6a84', frame: '#cbbd9d', rnd, lights: L, litChance: 0.7 });
  if (L) { const p = pr.P(bw / 2, bh - 0.66, base + 2);
    L.fillStyle = 'rgba(255,220,150,.5)';
    L.beginPath(); L.ellipse(p[0], p[1], 30 * pr.z, 12 * pr.z, 0, 0, 6.2832); L.fill(); }
  tree(ctx, pr, 0.2, bh - 0.2, 1.0); tree(ctx, pr, bw - 0.2, bh - 0.2, 1.0);
};

// --- 시그니처 -------------------------------------------------------------------
M.obstower = (ctx, L, pr, a) => {
  const { rnd, H } = a, { bw, bh } = pr;
  paving(ctx, pr, '#9b988f', 'rgba(0,0,0,.12)');
  box(ctx, pr, 0.35, 0.35, bw - 0.35, bh - 0.35, 0, 10, mat('#d2d7db'));
  windowGrid(ctx, faceSW(pr, 0.35, bw - 0.35, bh - 0.35, 1, 10),
    { cols: 4, rows: 1, glass: '#3f6076', frame: '#b6bcc2', style: 'curtain', rnd, lights: L, litChance: 0.8 });
  cyl(ctx, pr, bw / 2, bh / 2, 0.30, 10, H * 0.78, mat(a.d.color), { taper: 0.75 });
  // 전망 디스크
  cyl(ctx, pr, bw / 2, bh / 2, 0.62, H * 0.78, H * 0.90, mat('#e2e7ea'));
  const p = pr.P(bw / 2, bh / 2, H * 0.84);
  ctx.fillStyle = 'rgba(110,160,190,.75)';
  ctx.beginPath(); ctx.ellipse(p[0], p[1], 0.60 * pr.hw, 0.60 * pr.hh, 0, 0, 6.2832); ctx.fill();
  if (L) { L.fillStyle = 'rgba(255,225,170,.75)';
    L.beginPath(); L.ellipse(p[0], p[1], 0.66 * pr.hw, 0.66 * pr.hh, 0, 0, 6.2832); L.fill(); }
  cyl(ctx, pr, bw / 2, bh / 2, 0.16, H * 0.90, H, mat('#cfd5d9'));
  const t0 = pr.P(bw / 2, bh / 2, H), t1 = pr.P(bw / 2, bh / 2, H + 24);
  ctx.strokeStyle = '#9aa1a8'; ctx.lineWidth = Math.max(1, 1.8 * pr.z);
  ctx.beginPath(); ctx.moveTo(t0[0], t0[1]); ctx.lineTo(t1[0], t1[1]); ctx.stroke();
  if (L) { L.fillStyle = '#ff5a4a'; L.beginPath(); L.arc(t1[0], t1[1], 2.2 * pr.z, 0, 6.2832); L.fill(); }
};

M.stadium = (ctx, L, pr, a) => {
  const { rnd, H } = a, { bw, bh } = pr;
  paving(ctx, pr, '#8e8c86', 'rgba(0,0,0,.10)');
  parking(ctx, pr, 0.15, bh - 0.75, bw - 0.15, bh - 0.12, rnd);
  const cx = bw / 2, cy = (bh - 0.85) / 2 + 0.15;
  const rx = (bw / 2 - 0.3), ry = ((bh - 1.0) / 2);
  // 관중석 (동심 타원)
  const c0 = pr.P(cx, cy, 0), c1 = pr.P(cx, cy, H);
  ctx.fillStyle = shade(a.d.color, 0.72);
  ctx.beginPath(); ctx.ellipse(c0[0], c0[1], rx * pr.hw * 1.42, ry * pr.hh * 1.42, 0, 0, 6.2832); ctx.fill();
  ctx.fillStyle = shade(a.d.color, 0.92);
  ctx.beginPath();
  ctx.moveTo(c0[0] - rx * pr.hw * 1.42, c0[1]);
  ctx.ellipse(c0[0], c0[1], rx * pr.hw * 1.42, ry * pr.hh * 1.42, 0, Math.PI, 0, true);
  ctx.lineTo(c1[0] + rx * pr.hw * 1.42, c1[1]);
  ctx.ellipse(c1[0], c1[1], rx * pr.hw * 1.42, ry * pr.hh * 1.42, 0, 0, Math.PI, false);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = shade(a.d.roof, 1.0);
  ctx.beginPath(); ctx.ellipse(c1[0], c1[1], rx * pr.hw * 1.42, ry * pr.hh * 1.42, 0, 0, 6.2832); ctx.fill();
  // 그라운드
  ctx.fillStyle = '#3f8a45';
  ctx.beginPath(); ctx.ellipse(c1[0], c1[1], rx * pr.hw * 0.95, ry * pr.hh * 0.95, 0, 0, 6.2832); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = Math.max(0.8, 1.2 * pr.z);
  ctx.beginPath(); ctx.ellipse(c1[0], c1[1], rx * pr.hw * 0.5, ry * pr.hh * 0.5, 0, 0, 6.2832); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(c1[0] - rx * pr.hw * 0.95, c1[1]);
  ctx.lineTo(c1[0] + rx * pr.hw * 0.95, c1[1]); ctx.stroke();
  // 조명탑
  for (const [ox, oy] of [[-0.85, -0.85], [0.85, -0.85], [-0.85, 0.85], [0.85, 0.85]]) {
    const lx = cx + ox * rx, ly = cy + oy * ry;
    box(ctx, pr, lx - 0.06, ly - 0.06, lx + 0.06, ly + 0.06, 0, H + 22, mat('#9aa0a6'));
    box(ctx, pr, lx - 0.22, ly - 0.10, lx + 0.22, ly + 0.10, H + 22, H + 27, mat('#dfe4e8'));
    if (L) { const p = pr.P(lx, ly, H + 24.5); L.fillStyle = 'rgba(255,245,200,.85)';
      L.beginPath(); L.ellipse(p[0], p[1], 14 * pr.z, 7 * pr.z, 0, 0, 6.2832); L.fill(); }
  }
  if (L) { L.fillStyle = 'rgba(210,235,255,.28)';
    L.beginPath(); L.ellipse(c1[0], c1[1], rx * pr.hw * 1.0, ry * pr.hh * 1.0, 0, 0, 6.2832); L.fill(); }
};

M.convent = (ctx, L, pr, a) => {
  const { rnd, H } = a, { bw, bh } = pr;
  paving(ctx, pr, '#93918a', 'rgba(0,0,0,.10)');
  parking(ctx, pr, 0.2, bh - 0.7, bw - 0.2, bh - 0.15, rnd);
  const front = bh - 0.8;
  box(ctx, pr, 0.2, 0.25, bw - 0.2, front, 0, H, mat(a.d.color));
  windowGrid(ctx, faceSW(pr, 0.2, bw - 0.2, front, 0, H),
    { cols: 12, rows: Math.max(3, Math.round(H / 14)), glass: '#3f6b8c', frame: '#9fb0bd',
      style: 'curtain', rnd, lights: L, litChance: 0.75 });
  windowGrid(ctx, faceSE(pr, bw - 0.2, 0.25, front, 0, H),
    { cols: 6, rows: Math.max(3, Math.round(H / 14)), glass: '#39627f', frame: '#9fb0bd',
      style: 'curtain', rnd, lights: L, litChance: 0.45 });
  // 곡면 지붕
  const cA = pr.P(0.2, 0.25, H), cB = pr.P(bw - 0.2, 0.25, H);
  const cC = pr.P(bw - 0.2, front, H), cD = pr.P(0.2, front, H);
  ctx.beginPath();
  ctx.moveTo(cD[0], cD[1]);
  ctx.quadraticCurveTo((cD[0] + cA[0]) / 2, cD[1] - 18 * pr.z, cA[0], cA[1]);
  ctx.lineTo(cB[0], cB[1]);
  ctx.quadraticCurveTo((cB[0] + cC[0]) / 2, cC[1] - 18 * pr.z, cC[0], cC[1]);
  ctx.closePath();
  ctx.fillStyle = shade(a.d.roof, 1.0); ctx.fill();
  entranceCanopy(ctx, pr, bw / 2 - 0.8, bw / 2 + 0.8, front, mat('#c8d2da'));
  flagpole(ctx, pr, 0.3, front + 0.2, 20, '#2c5d9b');
};

M.airport = (ctx, L, pr, a) => {
  const { rnd, H } = a, { bw, bh } = pr;
  plate(ctx, pr, '#7d8079');
  // 활주로
  box(ctx, pr, 0.2, 0.25, bw - 0.2, 1.35, -1, 0, mat('#55585c'), { noSides: true });
  ctx.strokeStyle = 'rgba(240,240,225,.75)'; ctx.lineWidth = Math.max(0.8, 1.4 * pr.z);
  ctx.setLineDash([6 * pr.z, 6 * pr.z]);
  const r0 = pr.P(0.3, 0.8, 0.2), r1 = pr.P(bw - 0.3, 0.8, 0.2);
  ctx.beginPath(); ctx.moveTo(r0[0], r0[1]); ctx.lineTo(r1[0], r1[1]); ctx.stroke();
  ctx.setLineDash([]);
  // 유도로 + 계류장
  box(ctx, pr, 0.4, 1.5, bw - 0.4, 2.4, -1, 0, mat('#5f6266'), { noSides: true });
  // 터미널
  const front = bh - 0.6;
  box(ctx, pr, 0.5, 2.6, bw - 0.5, front, 0, H, mat(a.d.color));
  windowGrid(ctx, faceSW(pr, 0.5, bw - 0.5, front, 0, H),
    { cols: 14, rows: 2, glass: '#3f6b8c', frame: '#b6bcc2', style: 'curtain', rnd, lights: L, litChance: 0.8 });
  windowGrid(ctx, faceSE(pr, bw - 0.5, 2.6, front, 0, H),
    { cols: 5, rows: 2, glass: '#39627f', frame: '#b6bcc2', style: 'curtain', rnd, lights: L, litChance: 0.45 });
  box(ctx, pr, 0.45, 2.55, bw - 0.45, front + 0.05, H, H + 2, mat(a.d.roof));
  roofProps(ctx, L, pr, rnd, 0.5, 2.6, bw - 0.5, front, H + 2, { units: 6, penthouse: false });
  // 관제탑
  cyl(ctx, pr, bw - 1.1, 2.2, 0.22, 0, 40, mat('#cfd4d8'), { taper: 0.8 });
  box(ctx, pr, bw - 1.42, 1.9, bw - 0.78, 2.5, 40, 48, mat('#dfe4e8'));
  poly(ctx, cell(faceSW(pr, bw - 1.42, bw - 0.78, 2.5, 41, 47), 0.05, 0.95, 0.05, 0.95), 'rgba(110,160,190,.8)');
  if (L) { poly(L, cell(faceSW(pr, bw - 1.42, bw - 0.78, 2.5, 41, 47), 0.05, 0.95, 0.05, 0.95),
                'rgba(255,235,180,.6)');
    const p = pr.P(bw - 1.1, 2.2, 50); L.fillStyle = '#ff5a4a';
    L.beginPath(); L.arc(p[0], p[1], 2 * pr.z, 0, 6.2832); L.fill(); }
  // 여객기
  const px = 1.6, py = 1.85;
  box(ctx, pr, px, py, px + 1.5, py + 0.22, 4, 9, mat('#eef1f4'));      // 동체
  box(ctx, pr, px + 0.45, py - 0.55, px + 0.75, py + 0.8, 6, 6.8, mat('#dfe4e8')); // 주익
  box(ctx, pr, px + 1.32, py + 0.02, px + 1.46, py + 0.18, 9, 16, mat('#3f7fb0')); // 수직미익
  // 보딩브리지
  box(ctx, pr, px + 0.4, py + 0.9, px + 0.5, 2.55, 6, 7.5, mat('#b6bcc2'));
};

// ---------------------------------------------------------------------------
export function drawService(ctx, lights, pr, spec) {
  const d = spec.def;
  const rnd = seededRng(seedOf(spec));
  const fx = {};
  const a = { rnd, d, H: spec.bodyH, fx, spec };
  const fn = M[d.id] || genericBlock;
  fn(ctx, lights, pr, a);
  return fx;
}

export function drawBuildingModel(ctx, lights, pr, spec) {
  return spec.kind === 'growth' ? drawGrowth(ctx, lights, pr, spec)
                                : drawService(ctx, lights, pr, spec);
}
