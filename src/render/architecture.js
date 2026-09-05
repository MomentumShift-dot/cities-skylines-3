// ============================================================================
//  건축 렌더링 프리미티브 — 스프라이트 로컬 공간에서 입체 건물을 절차적으로 그린다
//
//  좌표계: 타일 로컬 (0..bw, 0..bh) + 높이(px, 확대 전 기준)
//          P(tx, ty, h) → 스프라이트 픽셀 좌표
//  야간 조명은 별도 캔버스(lights)에 그려 합성 시 가산 합성한다.
// ============================================================================
import { TW, TH } from '../core/config.js';
import { shade, seededRng } from './gfx.js';

// ---------------------------------------------------------------------------
//  투영기
// ---------------------------------------------------------------------------
export function makeProjector(bw, bh, z, topPx) {
  const hw = (TW / 2) * z, hh = (TH / 2) * z;
  const originX = bh * hw + 1;
  const originY = topPx + 1;
  const sw = Math.ceil((bw + bh) * hw) + 3;
  const sh = Math.ceil(topPx + (bw + bh) * hh) + 3;
  const P = (tx, ty, h) => [originX + (tx - ty) * hw, originY + (tx + ty) * hh - h * z];
  return { P, sw, sh, originX, originY, z, hw, hh, bw, bh };
}

// ---------------------------------------------------------------------------
//  기본 도형
// ---------------------------------------------------------------------------
export function poly(ctx, pts, fill, stroke, lw) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
}

/** 색 하나에서 세 면의 명암을 만든다 */
export function mat(base, tint = 1) {
  return {
    top: shade(base, 1.0 * tint), left: shade(base, 0.63 * tint), right: shade(base, 0.87 * tint),
    base,
  };
}

/** 축 정렬 상자 */
export function box(ctx, pr, x0, y0, x1, y1, hb, ht, m, o = {}) {
  const P = pr.P;
  const A = P(x0, y0, ht), B = P(x1, y0, ht), C = P(x1, y1, ht), D = P(x0, y1, ht);
  const Cb = P(x1, y1, hb), Bb = P(x1, y0, hb), Db = P(x0, y1, hb);
  if (!o.noSides) {
    poly(ctx, [D, C, Cb, Db], m.left);
    poly(ctx, [C, B, Bb, Cb], m.right);
  }
  if (!o.noTop) poly(ctx, [A, B, C, D], o.topColor || m.top);
  if (o.outline) {
    poly(ctx, [A, B, C, D], null, o.outline, o.lw || 1);
    ctx.beginPath();
    ctx.moveTo(D[0], D[1]); ctx.lineTo(Db[0], Db[1]);
    ctx.moveTo(C[0], C[1]); ctx.lineTo(Cb[0], Cb[1]);
    ctx.moveTo(B[0], B[1]); ctx.lineTo(Bb[0], Bb[1]);
    ctx.strokeStyle = o.outline; ctx.lineWidth = o.lw || 1; ctx.stroke();
  }
  return { A, B, C, D, Cb, Bb, Db };
}

/** 수직 원기둥 (굴뚝·사일로·물탱크·냉각탑) */
export function cyl(ctx, pr, cx, cy, r, hb, ht, m, o = {}) {
  const P = pr.P;
  const rx = r * pr.hw * 2 * 0.5, ry = r * pr.hh * 2 * 0.5;
  const top = P(cx, cy, ht), bot = P(cx, cy, hb);
  const taper = o.taper || 1;
  const rxT = rx * taper, ryT = ry * taper;
  // 몸통
  ctx.beginPath();
  ctx.moveTo(bot[0] - rx, bot[1]);
  ctx.ellipse(bot[0], bot[1], rx, ry, 0, Math.PI, 0, true);
  ctx.lineTo(top[0] + rxT, top[1]);
  ctx.ellipse(top[0], top[1], rxT, ryT, 0, 0, Math.PI, false);
  ctx.closePath();
  ctx.fillStyle = m.left; ctx.fill();
  // 밝은 쪽 하이라이트
  ctx.save();
  ctx.clip();
  ctx.fillStyle = m.right;
  ctx.fillRect(top[0], top[1] - (ht - hb) * pr.z - ryT, rx + 2, (ht - hb) * pr.z + ryT * 2 + 4);
  ctx.restore();
  // 상단면
  ctx.beginPath();
  ctx.ellipse(top[0], top[1], rxT, ryT, 0, 0, Math.PI * 2);
  ctx.fillStyle = o.topColor || m.top; ctx.fill();
  return { top, bot, rx, ry };
}

/** 박공 지붕 (axis 'x' → 용마루가 x축 방향) */
export function gableRoof(ctx, pr, x0, y0, x1, y1, h, rise, m, axis = 'x') {
  const P = pr.P;
  const A = P(x0, y0, h), B = P(x1, y0, h), C = P(x1, y1, h), D = P(x0, y1, h);
  if (axis === 'x') {
    const my = (y0 + y1) / 2;
    const R1 = P(x0, my, h + rise), R2 = P(x1, my, h + rise);
    poly(ctx, [A, B, R2, R1], shade(m.base, 0.80));   // 북동 사면
    poly(ctx, [D, C, R2, R1], shade(m.base, 1.06));   // 남서 사면
    poly(ctx, [A, R1, D], shade(m.base, 0.60));       // 서쪽 박공
    poly(ctx, [B, R2, C], shade(m.base, 0.72));       // 동쪽 박공
    return [R1, R2];
  } else {
    const mx = (x0 + x1) / 2;
    const R1 = P(mx, y0, h + rise), R2 = P(mx, y1, h + rise);
    poly(ctx, [A, R1, R2, D], shade(m.base, 0.72));
    poly(ctx, [B, R1, R2, C], shade(m.base, 1.02));
    poly(ctx, [A, R1, B], shade(m.base, 0.86));
    poly(ctx, [D, R2, C], shade(m.base, 0.62));
    return [R1, R2];
  }
}

/** 얇은 수평 판 (발코니 바닥, 차양, 처마) */
export function slab(ctx, pr, x0, y0, x1, y1, h, thick, m) {
  box(ctx, pr, x0, y0, x1, y1, h - thick, h, m);
}

// ---------------------------------------------------------------------------
//  면(face) 파라미터화 — u: 가로(0..1), v: 세로(0=바닥,1=천장)
// ---------------------------------------------------------------------------
export const faceSW = (pr, x0, x1, y1, hb, ht) =>
  (u, v) => pr.P(x0 + (x1 - x0) * u, y1, hb + (ht - hb) * v);
export const faceSE = (pr, x1, y0, y1, hb, ht) =>
  (u, v) => pr.P(x1, y1 + (y0 - y1) * u, hb + (ht - hb) * v);

function cell(f, u0, u1, v0, v1) {
  return [f(u0, v0), f(u1, v0), f(u1, v1), f(u0, v1)];
}

/**
 * 창문 격자.
 * o = { cols, rows, glass, frame, sill, litChance, rnd, lights, style }
 * style: 'grid'(개별 창) | 'ribbon'(가로 띠창) | 'curtain'(커튼월)
 */
export function windowGrid(ctx, f, o) {
  const { cols, rows, rnd } = o;
  const glass = o.glass || '#3f5a72';
  const lit = o.lit || '#ffd88a';
  const litChance = o.litChance ?? 0.5;
  const lights = o.lights;
  const style = o.style || 'grid';
  const mx = o.marginX ?? 0.16, my = o.marginY ?? 0.24;

  for (let r = 0; r < rows; r++) {
    const v0 = (r + my * 0.9) / rows, v1 = (r + 1 - my * 0.5) / rows;
    if (style === 'ribbon' || style === 'curtain') {
      // 가로 띠 유리
      const q = cell(f, 0.06, 0.94, v0, v1);
      poly(ctx, q, glass);
      // 수직 멀리언
      if (o.frame) {
        ctx.strokeStyle = o.frame; ctx.lineWidth = Math.max(0.6, o.mullion || 0.8);
        ctx.beginPath();
        for (let c = 0; c <= cols; c++) {
          const u = 0.06 + (0.88 * c) / cols;
          const a = f(u, v0), b = f(u, v1);
          ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
        }
        ctx.stroke();
      }
      if (lights) {
        for (let c = 0; c < cols; c++) {
          if (rnd() > litChance) continue;
          const u0 = 0.06 + (0.88 * c) / cols + 0.008;
          const u1 = 0.06 + (0.88 * (c + 1)) / cols - 0.008;
          poly(lights, cell(f, u0, u1, v0, v1), lit);
        }
      }
    } else {
      for (let c = 0; c < cols; c++) {
        const u0 = (c + mx) / cols, u1 = (c + 1 - mx) / cols;
        const on = lights && rnd() < litChance;
        poly(ctx, cell(f, u0, u1, v0, v1), glass);
        if (o.frame) poly(ctx, cell(f, u0, u1, v0, v1), null, o.frame, 0.7);
        if (on) poly(lights, cell(f, u0, u1, v0, v1), lit);
        else if (lights) rnd();
      }
    }
  }
}

/** 1층 상점 전면 (쇼윈도 + 차양 + 간판) */
export function storefront(ctx, f, o) {
  const { rnd, lights } = o;
  const bays = o.bays || 3;
  const glass = o.glass || '#2f4b60';
  for (let i = 0; i < bays; i++) {
    const u0 = (i + 0.10) / bays, u1 = (i + 0.90) / bays;
    poly(ctx, cell(f, u0, u1, 0.10, 0.78), glass);
    poly(ctx, cell(f, u0, u1, 0.10, 0.78), null, o.frame || '#20313f', 0.7);
    if (lights && rnd() < 0.8) poly(lights, cell(f, u0, u1, 0.12, 0.74), o.lit || '#ffe6a8');
    // 차양
    if (o.awning && rnd() < 0.65) {
      const aw = o.awningColors[(rnd() * o.awningColors.length) | 0];
      poly(ctx, [f(u0, 0.80), f(u1, 0.80), f(u1 - 0.01, 0.92), f(u0 + 0.01, 0.92)], aw);
    }
  }
  // 간판 띠
  if (o.sign) {
    poly(ctx, cell(f, 0.06, 0.94, 0.86, 0.99), o.signColor || '#2b3742');
    if (lights) poly(lights, cell(f, 0.10, 0.90, 0.88, 0.97), o.signLit || '#ff9d5c');
  }
}

// ---------------------------------------------------------------------------
//  지붕 소품
// ---------------------------------------------------------------------------
export function parapet(ctx, pr, x0, y0, x1, y1, h, m, t = 0.06) {
  box(ctx, pr, x0, y0, x1, y1, h, h + 2.6, m, { noTop: true });
  // 옥상 방수 데크: 지붕 색을 기반으로 한 중간 회색조 (검게 뭉개지지 않도록)
  const deck = shade(m.base, 0.72);
  box(ctx, pr, x0 + t, y0 + t, x1 - t, y1 - t, h, h + 2.1, mat(deck), { noSides: true });
  // 배수 라인
  ctx.strokeStyle = shade(m.base, 0.58); ctx.lineWidth = 0.6;
  ctx.beginPath();
  const a = pr.P(x0 + t, y0 + t, h + 2.1), b = pr.P(x1 - t, y1 - t, h + 2.1);
  ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
  const c = pr.P(x1 - t, y0 + t, h + 2.1), d = pr.P(x0 + t, y1 - t, h + 2.1);
  ctx.moveTo(c[0], c[1]); ctx.lineTo(d[0], d[1]);
  ctx.stroke();
}

/** 옥상 설비: 실외기, 물탱크, 계단탑, 안테나, 태양광 */
export function roofProps(ctx, lights, pr, rnd, x0, y0, x1, y1, h, o = {}) {
  const w = x1 - x0, d = y1 - y0;
  const gray = mat('#8d949b'), dark = mat('#5c636a'), duct = mat('#a7aeb4');
  const n = o.units ?? Math.min(5, Math.max(1, Math.round(w * d * 0.8)));
  for (let i = 0; i < n; i++) {
    const uw = 0.22 + rnd() * 0.26, ud = 0.20 + rnd() * 0.24;
    const ux = x0 + 0.12 + rnd() * Math.max(0.01, w - uw - 0.24);
    const uy = y0 + 0.12 + rnd() * Math.max(0.01, d - ud - 0.24);
    const uh = 2.5 + rnd() * 4;
    box(ctx, pr, ux, uy, ux + uw, uy + ud, h, h + uh, rnd() < 0.5 ? gray : duct);
    if (rnd() < 0.4) box(ctx, pr, ux + 0.04, uy + 0.04, ux + uw - 0.04, uy + ud - 0.04,
                         h + uh, h + uh + 1.2, dark);
  }
  // 계단탑
  if (o.penthouse !== false && w > 0.9 && d > 0.9) {
    const pw = Math.min(0.75, w * 0.34), pd = Math.min(0.7, d * 0.32);
    const px = x0 + w * 0.14, py = y0 + d * 0.5;
    box(ctx, pr, px, py, px + pw, py + pd, h, h + 8 + rnd() * 5, mat(o.penthouseColor || '#9aa1a8'));
  }
  // 물탱크
  if (o.tank && w > 0.8) {
    const tx = x1 - w * 0.28, ty = y0 + d * 0.26;
    box(ctx, pr, tx - 0.09, ty - 0.09, tx + 0.09, ty + 0.09, h, h + 5, mat('#6f757b'));
    cyl(ctx, pr, tx, ty, 0.30, h + 5, h + 12, mat('#b8b0a2'));
  }
  // 안테나 / 통신 마스트
  if (o.antenna) {
    const ax = x0 + w * 0.72, ay = y0 + d * 0.72;
    const a0 = pr.P(ax, ay, h), a1 = pr.P(ax, ay, h + (o.antennaH || 20));
    ctx.strokeStyle = '#6b7278'; ctx.lineWidth = Math.max(0.8, 1.4 * pr.z);
    ctx.beginPath(); ctx.moveTo(a0[0], a0[1]); ctx.lineTo(a1[0], a1[1]); ctx.stroke();
    if (lights) { lights.fillStyle = '#ff5a4a'; lights.beginPath();
      lights.arc(a1[0], a1[1], Math.max(1, 1.6 * pr.z), 0, 6.2832); lights.fill(); }
  }
  // 옥상 태양광
  if (o.solar) {
    const rows = Math.max(1, Math.round(d * 1.6));
    for (let r = 0; r < rows; r++) {
      const sy = y0 + 0.2 + (r * (d - 0.4)) / rows;
      box(ctx, pr, x0 + 0.2, sy, x1 - 0.2, sy + 0.16, h + 1.6, h + 2.4, mat('#26456e'));
    }
  }
  // 옥상 정원
  if (o.garden) {
    for (let i = 0; i < 4; i++) {
      const gx = x0 + 0.18 + rnd() * (w - 0.36), gy = y0 + 0.18 + rnd() * (d - 0.36);
      const p = pr.P(gx, gy, h);
      ctx.fillStyle = '#3f7f3c';
      ctx.beginPath(); ctx.arc(p[0], p[1] - 2 * pr.z, 2.6 * pr.z, 0, 6.2832); ctx.fill();
    }
  }
}

/** 벽면 에어컨 실외기 / 잡다한 디테일 (저층 건물 느낌) */
export function wallClutter(ctx, f, rnd, count) {
  for (let i = 0; i < count; i++) {
    const u = 0.1 + rnd() * 0.8, v = 0.25 + rnd() * 0.6;
    poly(ctx, cell(f, u, u + 0.06, v, v + 0.08), '#7d848a');
  }
}

export { cell, seededRng };
