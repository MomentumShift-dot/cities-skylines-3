// ============================================================================
//  렌더링 공통 — 카메라, 아이소메트릭 변환, 색상 유틸
// ============================================================================
import { TW, TH, GS, MAP_W, MAP_H } from '../core/config.js';
import { clamp } from '../core/utils.js';

/** 타일 좌표 → 월드(아이소) 픽셀 */
export const isoX = (x, y) => (x - y) * (TW / 2);
export const isoY = (x, y) => (x + y) * (TH / 2);

export class Camera {
  constructor() {
    this.cx = isoX(MAP_W / 2, MAP_H / 2);
    this.cy = isoY(MAP_W / 2, MAP_H / 2);
    this.zoom = 1;
    this.minZoom = 0.16;
    this.maxZoom = 3.2;
    this.vw = 800; this.vh = 600;
  }
  resize(w, h) { this.vw = w; this.vh = h; }

  toScreenX(wx) { return (wx - this.cx) * this.zoom + this.vw / 2; }
  toScreenY(wy) { return (wy - this.cy) * this.zoom + this.vh / 2; }

  tileToScreen(x, y) {
    return [this.toScreenX(isoX(x, y)), this.toScreenY(isoY(x, y))];
  }

  /** 화면 좌표 → 타일 좌표(실수) */
  screenToTile(sx, sy) {
    const wx = (sx - this.vw / 2) / this.zoom + this.cx;
    const wy = (sy - this.vh / 2) / this.zoom + this.cy;
    return [wy / TH + wx / TW, wy / TH - wx / TW];
  }

  panBy(dx, dy) { this.cx -= dx / this.zoom; this.cy -= dy / this.zoom; this.clampPos(); }

  zoomAt(sx, sy, factor) {
    const [tx, ty] = this.screenToTile(sx, sy);
    this.zoom = clamp(this.zoom * factor, this.minZoom, this.maxZoom);
    const wx = isoX(tx, ty), wy = isoY(tx, ty);
    this.cx = wx - (sx - this.vw / 2) / this.zoom;
    this.cy = wy - (sy - this.vh / 2) / this.zoom;
    this.clampPos();
  }

  centerOn(tx, ty) { this.cx = isoX(tx, ty); this.cy = isoY(tx, ty); this.clampPos(); }

  clampPos() {
    const pad = 400;
    this.cx = clamp(this.cx, isoX(0, MAP_H) - pad, isoX(MAP_W, 0) + pad);
    this.cy = clamp(this.cy, isoY(0, 0) - pad, isoY(MAP_W, MAP_H) + pad);
  }

  /** 지면 텍스처(uv) → 화면 변환 행렬 */
  groundMatrix() {
    const z = this.zoom;
    const a = (TW / (2 * GS)) * z, b = (TH / (2 * GS)) * z;
    return [a, b, -a, b, -this.cx * z + this.vw / 2, -this.cy * z + this.vh / 2];
  }

  /** 타일당 1픽셀 텍스처(오버레이) → 화면 변환 행렬 */
  overlayMatrix() {
    const z = this.zoom;
    const a = (TW / 2) * z, b = (TH / 2) * z;
    return [a, b, -a, b, -this.cx * z + this.vw / 2, -this.cy * z + this.vh / 2];
  }

  /** 화면에 보이는 타일 사각 범위 */
  visibleBounds(margin = 3) {
    const pts = [
      this.screenToTile(0, 0), this.screenToTile(this.vw, 0),
      this.screenToTile(0, this.vh), this.screenToTile(this.vw, this.vh),
    ];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    return {
      x0: Math.max(0, Math.floor(x0) - margin),
      y0: Math.max(0, Math.floor(y0) - margin),
      x1: Math.min(MAP_W - 1, Math.ceil(x1) + margin),
      y1: Math.min(MAP_H - 1, Math.ceil(y1) + margin),
    };
  }
}

/** 32비트 xorshift — 정수 정밀도 손실 없이 안정적인 시드 난수 */
export function seededRng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------
//  색상
// ---------------------------------------------------------------------------
const hexCache = new Map();
/** '#rgb' / '#rrggbb' / 'rgb(r,g,b)' 를 모두 받는다 */
export function parseHex(hex) {
  let v = hexCache.get(hex);
  if (v) return v;
  if (hex[0] === 'r') {                        // rgb(...) / rgba(...)
    const m = hex.match(/-?\d+(\.\d+)?/g);
    v = m ? [+m[0] | 0, +m[1] | 0, +m[2] | 0] : [128, 128, 128];
  } else {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    v = Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [128, 128, 128];
  }
  if (hexCache.size > 4000) hexCache.clear();
  hexCache.set(hex, v);
  return v;
}

const shadeCache = new Map();
/** 밝기 배율 + 야간 색온도 적용 */
export function shade(hex, mul, night = 0) {
  const key = hex + '|' + (mul * 100 | 0) + '|' + (night * 100 | 0);
  let c = shadeCache.get(key);
  if (c) return c;
  const [r, g, b] = parseHex(hex);
  let R = r * mul, G = g * mul, B = b * mul;
  if (night > 0) {
    R = R * (1 - night * 0.62) + 12 * night;
    G = G * (1 - night * 0.55) + 18 * night;
    B = B * (1 - night * 0.34) + 46 * night;
  }
  c = `rgb(${clamp(R, 0, 255) | 0},${clamp(G, 0, 255) | 0},${clamp(B, 0, 255) | 0})`;
  if (shadeCache.size > 6000) shadeCache.clear();
  shadeCache.set(key, c);
  return c;
}

export function mixHex(a, b, t) {
  const A = parseHex(a), B = parseHex(b);
  return `rgb(${(A[0] + (B[0] - A[0]) * t) | 0},${(A[1] + (B[1] - A[1]) * t) | 0},${(A[2] + (B[2] - A[2]) * t) | 0})`;
}

/** 값(0..1)을 히트맵 색으로 */
export function heat(v) {
  v = v < 0 ? 0 : v > 1 ? 1 : v;
  const stops = [
    [0.0, 30, 90, 190], [0.35, 40, 180, 120], [0.6, 235, 200, 60],
    [0.8, 240, 130, 40], [1.0, 210, 45, 45],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const a = stops[i - 1], b = stops[i];
      const t = (v - a[0]) / (b[0] - a[0]);
      return [
        (a[1] + (b[1] - a[1]) * t) | 0,
        (a[2] + (b[2] - a[2]) * t) | 0,
        (a[3] + (b[3] - a[3]) * t) | 0,
      ];
    }
  }
  return [210, 45, 45];
}
