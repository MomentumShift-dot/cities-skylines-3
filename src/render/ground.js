// ============================================================================
//  지면 텍스처 — 그리드 공간에 지형/도로/구역을 그린 뒤 아이소 행렬로 투영
//  (변경된 영역만 부분 갱신)
// ============================================================================
import { MAP_W, MAP_H, GS, ROADS, ZONE_DEF, SECTOR, SECTORS_X } from '../core/config.js';
import { idx } from '../core/world.js';
import { mixHex } from './gfx.js';

const WATER_DEEP = '#12354f';
const WATER_SHALLOW = '#2d6f92';
const SAND = '#d8c79c';
const GRASS_LOW = '#65984c';
const GRASS_MID = '#7ba553';
const GRASS_HIGH = '#9a9a6d';
const ROCK = '#9d968b';
const LOT = '#8f8f84';

export function createGround() {
  const c = document.createElement('canvas');
  c.width = MAP_W * GS; c.height = MAP_H * GS;
  const ctx = c.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;
  return { canvas: c, ctx };
}

function terrainColor(w, i) {
  const h = w.height[i];
  if (w.water[i]) {
    const d = Math.min(1, (0.335 - h) / 0.30);
    return mixHex(WATER_SHALLOW, WATER_DEEP, d);
  }
  if (h < 0.352) return mixHex(SAND, GRASS_LOW, (h - 0.335) / 0.017);
  if (h < 0.52) return mixHex(GRASS_LOW, GRASS_MID, (h - 0.365) / 0.155);
  if (h < 0.70) return mixHex(GRASS_MID, GRASS_HIGH, (h - 0.52) / 0.18);
  return mixHex(GRASS_HIGH, ROCK, Math.min(1, (h - 0.70) / 0.25));
}

function drawTile(ctx, w, x, y) {
  const i = idx(x, y);
  const px = x * GS, py = y * GS;

  // --- 지형 ---------------------------------------------------------------
  ctx.fillStyle = terrainColor(w, i);
  ctx.fillRect(px, py, GS, GS);

  const v = w.variant[i];
  if (!w.water[i]) {
    // 미세한 색 얼룩으로 단조로움 제거
    ctx.fillStyle = v > 128 ? 'rgba(255,255,255,0.030)' : 'rgba(0,0,0,0.030)';
    ctx.fillRect(px, py, GS, GS);
    if (v % 7 === 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      ctx.fillRect(px + (v % 9), py + (v % 5), 3, 3);
    }
  } else {
    ctx.fillStyle = (v % 11 === 0) ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.04)';
    ctx.fillRect(px + (v % 8), py + (v % 6), GS - (v % 8), 2);
  }

  // --- 건물 부지 ------------------------------------------------------------
  if (w.bidx[i] > 0) {
    ctx.fillStyle = LOT;
    ctx.fillRect(px + 1, py + 1, GS - 2, GS - 2);
  }

  // --- 나무 ----------------------------------------------------------------
  if (w.tree[i] && !w.bidx[i] && !w.road[i]) {
    const cx = px + GS / 2 + ((v % 5) - 2), cy = py + GS / 2 + ((v % 7) - 3);
    ctx.fillStyle = 'rgba(20,45,18,0.35)';
    ctx.beginPath(); ctx.ellipse(cx + 1.5, cy + 2, 5.6, 4.2, 0, 0, 6.2832); ctx.fill();
    ctx.fillStyle = v % 3 === 0 ? '#3d7a37' : v % 3 === 1 ? '#356b31' : '#48853e';
    ctx.beginPath(); ctx.arc(cx, cy, 5.2, 0, 6.2832); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath(); ctx.arc(cx - 1.6, cy - 1.6, 2.4, 0, 6.2832); ctx.fill();
  }

  // --- 용도지역 -------------------------------------------------------------
  const z = w.zone[i];
  if (z && !w.road[i]) {
    const zd = ZONE_DEF[z];
    if (w.bidx[i] > 0) {
      ctx.fillStyle = zd.color;
      ctx.globalAlpha = 0.14;
      ctx.fillRect(px, py, GS, GS);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = zd.tint;
      ctx.fillRect(px + 1, py + 1, GS - 2, GS - 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 1.5, py + 1.5, GS - 3, GS - 3);
    }
  }

  // --- 도로 ----------------------------------------------------------------
  if (w.road[i]) drawRoad(ctx, w, x, y, i);

  // --- 미해금 구역 ----------------------------------------------------------
  const s = Math.floor(y / SECTOR) * SECTORS_X + Math.floor(x / SECTOR);
  if (!w.sectorOwned[s]) {
    ctx.fillStyle = 'rgba(8,14,22,0.55)';
    ctx.fillRect(px, py, GS, GS);
    const inX = x % SECTOR, inY = y % SECTOR;
    if (inX === 0 || inY === 0 || inX === SECTOR - 1 || inY === SECTOR - 1) {
      ctx.fillStyle = 'rgba(120,180,255,0.18)';
      ctx.fillRect(px, py, GS, GS);
    }
  }
}

function drawRoad(ctx, w, x, y, i) {
  const rd = ROADS[w.road[i] - 1];
  const px = x * GS, py = y * GS, c = GS / 2;
  const half = (rd.width * GS) / 2;
  const halfE = half + 1.6;                 // 인도 포함 폭

  const E = x < MAP_W - 1 && w.road[i + 1] > 0;
  const We = x > 0 && w.road[i - 1] > 0;
  const S = y < MAP_H - 1 && w.road[i + MAP_W] > 0;
  const Nn = y > 0 && w.road[i - MAP_W] > 0;
  const none = !E && !We && !S && !Nn;

  // 인도/노견
  ctx.fillStyle = rd.edge;
  paint(halfE);
  // 노면
  ctx.fillStyle = rd.color;
  paint(half);

  function paint(hw) {
    ctx.fillRect(px + c - hw, py + c - hw, hw * 2, hw * 2);
    if (E || none) ctx.fillRect(px + c, py + c - hw, c, hw * 2);
    if (We || none) ctx.fillRect(px, py + c - hw, c, hw * 2);
    if (S || none) ctx.fillRect(px + c - hw, py + c, hw * 2, c);
    if (Nn || none) ctx.fillRect(px + c - hw, py, hw * 2, c);
  }

  // 차선 표시
  const nConn = (E ? 1 : 0) + (We ? 1 : 0) + (S ? 1 : 0) + (Nn ? 1 : 0);
  const straightH = E && We && !S && !Nn;
  const straightV = S && Nn && !E && !We;
  if (nConn <= 2) {
    ctx.fillStyle = rd.line;
    const lw = rd.median ? 1.4 : 1;
    if (straightH || (E && We)) {
      if (rd.median) {
        ctx.fillRect(px, py + c - 1.6, GS, lw);
        ctx.fillRect(px, py + c + 0.6, GS, lw);
      } else {
        ctx.fillRect(px + 2, py + c - 0.5, 5, 1);
        ctx.fillRect(px + 9, py + c - 0.5, 5, 1);
      }
    } else if (straightV || (S && Nn)) {
      if (rd.median) {
        ctx.fillRect(px + c - 1.6, py, lw, GS);
        ctx.fillRect(px + c + 0.6, py, lw, GS);
      } else {
        ctx.fillRect(px + c - 0.5, py + 2, 1, 5);
        ctx.fillRect(px + c - 0.5, py + 9, 1, 5);
      }
    }
  } else {
    // 교차로: 정지선
    ctx.fillStyle = 'rgba(240,240,240,0.55)';
    if (E) ctx.fillRect(px + c + half - 1.5, py + c - half, 1.2, half * 2);
    if (We) ctx.fillRect(px + c - half + 0.3, py + c - half, 1.2, half * 2);
    if (S) ctx.fillRect(px + c - half, py + c + half - 1.5, half * 2, 1.2);
    if (Nn) ctx.fillRect(px + c - half, py + c - half + 0.3, half * 2, 1.2);
  }
}

/** 더티 영역만 다시 그린다 */
export function redrawGround(w, g) {
  const d = w.dirtyGround;
  if (!d.any) return 0;
  const ctx = g.ctx;
  let n = 0;
  for (let y = d.y0; y <= d.y1; y++) {
    for (let x = d.x0; x <= d.x1; x++) { drawTile(ctx, w, x, y); n++; }
  }
  d.any = false;
  return n;
}

export function markAllDirty(w) {
  w.dirtyGround = { x0: 0, y0: 0, x1: MAP_W - 1, y1: MAP_H - 1, any: true };
}
