// ============================================================================
//  메인 렌더러 — 지면 + 입체 건물 + 차량 + 오버레이 + 프리뷰
// ============================================================================
import {
  MAP_W, MAP_H, TW, TH, ZONE_DEF, ROADS, BUILDING_BY_ID, TICKS_PER_DAY,
  SECTOR, SECTORS_X, SECTORS_Y,
} from '../core/config.js';
import { idx, defOf } from '../core/world.js';
import { Camera, isoX, isoY, shade, heat, seededRng } from './gfx.js';
import { createGround, redrawGround } from './ground.js';
import { clamp, clamp01 } from '../core/utils.js';

export const OVERLAYS = {
  none:    { name: '없음', icon: '🚫' },
  land:    { name: '토지가치', icon: '💰', field: 'land', scale: 100 },
  ground:  { name: '지상 오염', icon: '☣️', field: 'ground', scale: 100, invert: true },
  air:     { name: '대기 오염', icon: '🌫️', field: 'air', scale: 100, invert: true },
  noise:   { name: '소음', icon: '🔊', field: 'noise', scale: 100, invert: true },
  crime:   { name: '범죄', icon: '🚔', field: 'crime', scale: 100, invert: true },
  traffic: { name: '교통량', icon: '🚗', special: 'traffic' },
  power:   { name: '전력망', icon: '⚡', special: 'power' },
  water:   { name: '상수도', icon: '💧', special: 'water' },
  health:  { name: '의료', icon: '🏥', field: 'health', scale: 1 },
  police:  { name: '치안', icon: '👮', field: 'police', scale: 1 },
  fire:    { name: '소방', icon: '🚒', field: 'fire', scale: 1 },
  edu:     { name: '교육', icon: '🎓', special: 'edu' },
  park:    { name: '공원', icon: '🌳', field: 'park', scale: 1 },
  transit: { name: '대중교통', icon: '🚌', field: 'transit', scale: 1 },
  mail:    { name: '우편/통신', icon: '📮', special: 'comm' },
  resource:{ name: '자연 자원', icon: '⛏️', special: 'resource' },
};

const RES_COLOR = [null, [140, 190, 70], [40, 120, 50], [150, 120, 90], [60, 55, 70]];

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.cam = new Camera();
    this.ground = createGround();
    this.overlay = document.createElement('canvas');
    this.overlay.width = MAP_W; this.overlay.height = MAP_H;
    this.octx = this.overlay.getContext('2d');
    this.oimg = this.octx.createImageData(MAP_W, MAP_H);
    this.overlayMode = 'none';
    this.overlayDirty = true;
    this.showGrid = false;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.frame = 0;
    this.stats = { drawn: 0 };
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(2, (r.width * this.dpr) | 0);
    this.canvas.height = Math.max(2, (r.height * this.dpr) | 0);
    this.cam.resize(r.width, r.height);
  }

  setOverlay(mode) { this.overlayMode = mode; this.overlayDirty = true; }

  // -------------------------------------------------------------------------
  render(w, ui) {
    const ctx = this.ctx, cam = this.cam;
    this.frame++;
    redrawGround(w, this.ground);

    const night = this.nightFactor(w);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = night > 0.5 ? '#070d16' : '#0d1520';
    ctx.fillRect(0, 0, cam.vw, cam.vh);

    // --- 지면 -------------------------------------------------------------
    const gm = cam.groundMatrix();
    ctx.save();
    ctx.imageSmoothingEnabled = cam.zoom < 1.2;
    ctx.setTransform(this.dpr * gm[0], this.dpr * gm[1], this.dpr * gm[2],
                     this.dpr * gm[3], this.dpr * gm[4], this.dpr * gm[5]);
    ctx.drawImage(this.ground.canvas, 0, 0);
    ctx.restore();

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (night > 0.02) {
      ctx.fillStyle = `rgba(10,20,58,${(night * 0.46).toFixed(3)})`;
      ctx.fillRect(0, 0, cam.vw, cam.vh);
    }

    // --- 오버레이 ----------------------------------------------------------
    if (this.overlayMode !== 'none') this.drawOverlay(w);

    // --- 프롭(건물/차량) ----------------------------------------------------
    const b = cam.visibleBounds(6);
    const props = [];
    const seen = new Set();
    for (let y = b.y0; y <= b.y1; y++) {
      for (let x = b.x0; x <= b.x1; x++) {
        const bi = w.bidx[idx(x, y)];
        if (!bi || seen.has(bi)) continue;
        seen.add(bi);
        const bd = w.buildings[bi - 1];
        if (bd) props.push({ t: 0, d: bd.x + bd.y + bd.w + bd.h, o: bd });
      }
    }
    for (const car of w.cars) {
      const seg = Math.floor(car.t);
      const ti = car.path[Math.min(seg, car.path.length - 1)];
      const cx = ti % MAP_W, cy = (ti / MAP_W) | 0;
      if (cx < b.x0 - 1 || cx > b.x1 + 1 || cy < b.y0 - 1 || cy > b.y1 + 1) continue;
      props.push({ t: 1, d: cx + cy + 0.9, o: car });
    }
    props.sort((p, q) => p.d - q.d);

    ctx.lineJoin = 'round';
    for (const p of props) {
      if (p.t === 0) this.drawBuilding(w, p.o, night);
      else this.drawCar(w, p.o, night);
    }
    this.stats.drawn = props.length;

    // --- 그리드 / 프리뷰 / 선택 ---------------------------------------------
    if (ui) {
      if (ui.showGrid && cam.zoom > 0.5) this.drawGrid(w);
      this.drawSectorBorders(w, ui);
      if (ui.preview) this.drawPreview(w, ui);
      if (ui.selected) this.drawSelection(w, ui.selected);
      if (ui.hover && ui.tool !== 'select') this.drawHover(w, ui);
    }
  }

  nightFactor(w) {
    const phase = ((w.city.tick % TICKS_PER_DAY) + (w.subTick || 0)) / TICKS_PER_DAY;
    const light = 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);
    return clamp01(1 - light * 1.35);
  }

  // -------------------------------------------------------------------------
  //  건물
  // -------------------------------------------------------------------------
  drawBuilding(w, b, night) {
    const ctx = this.ctx, cam = this.cam, z = cam.zoom;
    const d = defOf(b);
    if (!d) return;
    const isGrowth = b.kind === 'growth';
    const lvl = b.level - 1;

    let baseH = isGrowth ? d.height[lvl] : (d.height || 20);
    let color, roofColor;
    if (isGrowth) {
      color = d.palette[b.variant % d.palette.length];
      roofColor = d.roofs ? d.roofs[b.variant % d.roofs.length] : '#6a6258';
    } else {
      color = d.color || '#c8cdd2';
      roofColor = d.roof || color;
    }
    if (b.abandoned) { color = b.burnt ? '#4a4038' : '#8a857c'; roofColor = b.burnt ? '#3a332c' : '#6c665e'; }

    const prog = b.progress !== undefined && b.progress < 1 ? Math.max(0.12, b.progress) : 1;
    const H = baseH * prog * z;

    const [ax, ay] = cam.tileToScreen(b.x, b.y);
    const [bx2, by2] = cam.tileToScreen(b.x + b.w, b.y);
    const [cx2, cy2] = cam.tileToScreen(b.x + b.w, b.y + b.h);
    const [dx2, dy2] = cam.tileToScreen(b.x, b.y + b.h);

    // 화면 밖 컬링
    const minX = Math.min(ax, dx2), maxX = Math.max(bx2, cx2);
    if (maxX < -40 || minX > cam.vw + 40) return;
    const maxY = Math.max(ay, cy2), minY = Math.min(ay, cy2) - H;
    if (maxY < -40 || minY > cam.vh + 40) return;

    const shp = d.shape;
    if (shp === 'park') { this.drawPark(b, d, ax, ay, bx2, by2, cx2, cy2, dx2, dy2, night); return; }
    if (shp === 'pylon') { this.drawPylon(b, d, ax, ay, cx2, cy2, H, night); return; }

    // 그림자
    ctx.fillStyle = `rgba(8,14,20,${0.30 * (1 - night * 0.6)})`;
    ctx.beginPath();
    const sh = 4 * z;
    ctx.moveTo(ax + sh, ay + sh * 0.5); ctx.lineTo(bx2 + sh, by2 + sh * 0.5);
    ctx.lineTo(cx2 + sh, cy2 + sh * 0.5); ctx.lineTo(dx2 + sh, dy2 + sh * 0.5);
    ctx.closePath(); ctx.fill();

    const inset = isGrowth ? 0.10 : 0.06;
    const ix = (p, q, t) => p + (q - p) * t;
    const A = [ix(ax, cx2, inset), ix(ay, cy2, inset)];
    const B = [ix(bx2, dx2, inset), ix(by2, dy2, inset)];
    const C = [ix(cx2, ax, inset), ix(cy2, ay, inset)];
    const D = [ix(dx2, bx2, inset), ix(dy2, by2, inset)];
    const Au = [A[0], A[1] - H], Bu = [B[0], B[1] - H], Cu = [C[0], C[1] - H], Du = [D[0], D[1] - H];

    const constructing = prog < 1;
    const cLeft = constructing ? '#b08a45' : shade(color, 0.66, night);
    const cRight = constructing ? '#c79c50' : shade(color, 0.88, night);

    // 좌측면 (D-C)
    quad(ctx, D, C, Cu, Du, cLeft);
    // 우측면 (C-B)
    quad(ctx, C, B, Bu, Cu, cRight);

    // 지붕
    const pitched = isGrowth && d.cat === 'res' && d.size === 1;
    if (pitched && !constructing) {
      const R1 = [(Au[0] + Du[0]) / 2, (Au[1] + Du[1]) / 2 - 7 * z];
      const R2 = [(Bu[0] + Cu[0]) / 2, (Bu[1] + Cu[1]) / 2 - 7 * z];
      quad(ctx, Au, Bu, R2, R1, shade(roofColor, 0.80, night));
      quad(ctx, Du, Cu, R2, R1, shade(roofColor, 1.02, night));
    } else {
      quad(ctx, Au, Bu, Cu, Du, shade(roofColor, constructing ? 0.7 : 1.0, night));
      if (!constructing && H > 12 * z) {
        // 옥상 난간
        ctx.strokeStyle = shade(roofColor, 0.7, night);
        ctx.lineWidth = Math.max(1, 1.2 * z);
        ctx.beginPath();
        ctx.moveTo(Au[0], Au[1]); ctx.lineTo(Bu[0], Bu[1]);
        ctx.lineTo(Cu[0], Cu[1]); ctx.lineTo(Du[0], Du[1]); ctx.closePath();
        ctx.stroke();
      }
    }

    // 창문
    if (!constructing && !b.burnt && z > 0.45 && H > 16 * z) {
      const floors = clamp(Math.round(baseH / 11), 1, 9);
      const cols = clamp(Math.round(b.w * 2.2), 2, 6);
      const lit = night > 0.35 && !b.abandoned;
      this.windows(D, C, H, cols, floors, lit, b.uid, night, 0.55);
      this.windows(C, B, H, cols, floors, lit, b.uid * 7 + 3, night, 0.75);
    }

    // 건설 중 표시
    if (constructing) {
      ctx.strokeStyle = 'rgba(255,220,120,0.85)';
      ctx.lineWidth = Math.max(1, 1.5 * z);
      ctx.beginPath();
      ctx.moveTo(C[0], C[1]); ctx.lineTo(Cu[0], Cu[1] - 10 * z);
      ctx.lineTo(Cu[0] + 16 * z, Cu[1] - 10 * z);
      ctx.stroke();
    }

    // 화재
    if (b.fire > 0) this.drawFire(C, B, D, H, z);

    // 서비스 아이콘
    if (!isGrowth && z > 0.62 && d.icon) {
      const cxm = (Au[0] + Cu[0]) / 2, cym = (Au[1] + Cu[1]) / 2;
      ctx.font = `${Math.min(26, 13 * z + 6)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji"`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = 0.95;
      ctx.fillText(d.icon, cxm, cym - 4 * z);
      ctx.globalAlpha = 1;
    }

    // 상태 경고 아이콘
    if (z > 0.5 && b.kind === 'growth' && !b.abandoned) {
      let warn = null;
      if (!b.powered) warn = '⚡';
      else if (!b.watered) warn = '💧';
      if (warn && (this.frame >> 5) % 2 === 0) {
        ctx.font = `${Math.min(20, 10 * z + 5)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji"`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(warn, (Au[0] + Cu[0]) / 2, Au[1] - 2);
      }
    }
    if (b.abandoned && z > 0.5 && (this.frame >> 6) % 2 === 0) {
      ctx.font = `${Math.min(20, 10 * z + 5)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji"`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText('🏚️', (Au[0] + Cu[0]) / 2, Au[1] - 2);
    }
  }

  windows(p0, p1, H, cols, rows, lit, seed, night, faceShade) {
    const ctx = this.ctx;
    const rnd = seededRng(seed * 2654435761);
    const dark = `rgba(30,40,55,${0.55 - night * 0.2})`;
    for (let r = 0; r < rows; r++) {
      const y0 = (r + 0.24) / rows, y1 = (r + 0.74) / rows;
      for (let c = 0; c < cols; c++) {
        const t0 = (c + 0.22) / cols, t1 = (c + 0.78) / cols;
        const on = lit && rnd() < 0.55;
        ctx.fillStyle = on ? 'rgba(255,214,130,0.92)' : dark;
        const P = (t, yy) => [
          p0[0] + (p1[0] - p0[0]) * t,
          p0[1] + (p1[1] - p0[1]) * t - H * yy,
        ];
        const a = P(t0, y0), b = P(t1, y0), c2 = P(t1, y1), d = P(t0, y1);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
        ctx.lineTo(c2[0], c2[1]); ctx.lineTo(d[0], d[1]);
        ctx.closePath(); ctx.fill();
        if (!on) rnd();
      }
    }
  }

  drawPark(b, d, ax, ay, bx2, by2, cx2, cy2, dx2, dy2, night) {
    const ctx = this.ctx, z = this.cam.zoom;
    ctx.beginPath();
    ctx.moveTo(ax, ay); ctx.lineTo(bx2, by2); ctx.lineTo(cx2, cy2); ctx.lineTo(dx2, dy2);
    ctx.closePath();
    ctx.fillStyle = shade(d.color || '#5aa055', 1, night);
    ctx.fill();
    ctx.strokeStyle = shade('#d8d2bd', 0.9, night);
    ctx.lineWidth = Math.max(1, 1.6 * z);
    ctx.stroke();
    // 나무 몇 그루
    const rnd = seededRng(b.uid * 7919 + 13);
    // 산책로
    ctx.strokeStyle = shade('#cfc7b0', 0.85, night);
    ctx.lineWidth = Math.max(1, 2.4 * z);
    ctx.beginPath();
    ctx.moveTo((ax + dx2) / 2, (ay + dy2) / 2);
    ctx.lineTo((bx2 + cx2) / 2, (by2 + cy2) / 2);
    ctx.stroke();
    // 나무를 격자 지터로 고르게 배치
    const cols = Math.max(1, b.w), rows = Math.max(1, b.h);
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        if (rnd() < 0.34) continue;
        const tx = b.x + gx + 0.25 + rnd() * 0.5;
        const ty = b.y + gy + 0.25 + rnd() * 0.5;
        const [sx, sy] = this.cam.tileToScreen(tx, ty);
        const rr = (3.0 + rnd() * 2.0) * z;
        ctx.fillStyle = `rgba(12,24,14,${0.22 * (1 - night * 0.5)})`;
        ctx.beginPath(); ctx.ellipse(sx + rr * 0.3, sy, rr * 0.95, rr * 0.5, 0, 0, 6.2832); ctx.fill();
        ctx.fillStyle = shade(rnd() < 0.5 ? '#2f6b2c' : '#3c7d35', 1, night);
        ctx.beginPath(); ctx.arc(sx, sy - rr * 1.25, rr, 0, 6.2832); ctx.fill();
        ctx.fillStyle = `rgba(255,255,255,${0.12 * (1 - night)})`;
        ctx.beginPath(); ctx.arc(sx - rr * 0.32, sy - rr * 1.55, rr * 0.42, 0, 6.2832); ctx.fill();
      }
    }
    if (d.icon && z > 0.75) {
      ctx.font = `${Math.min(22, 11 * z + 5)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji"`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(d.icon, (ax + cx2) / 2, (ay + cy2) / 2 - 6 * z);
    }
  }

  drawPylon(b, d, ax, ay, cx2, cy2, H, night) {
    const ctx = this.ctx, z = this.cam.zoom;
    const mx = (ax + cx2) / 2, my = (ay + cy2) / 2;
    ctx.strokeStyle = shade(d.color || '#8d939a', 0.9, night);
    ctx.lineWidth = Math.max(1, 1.6 * z);
    ctx.beginPath();
    ctx.moveTo(mx - 5 * z, my); ctx.lineTo(mx, my - H);
    ctx.moveTo(mx + 5 * z, my); ctx.lineTo(mx, my - H);
    ctx.moveTo(mx - 6 * z, my - H * 0.72); ctx.lineTo(mx + 6 * z, my - H * 0.72);
    ctx.moveTo(mx - 4 * z, my - H * 0.88); ctx.lineTo(mx + 4 * z, my - H * 0.88);
    ctx.stroke();
  }

  drawFire(C, B, D, H, z) {
    const ctx = this.ctx;
    const t = this.frame * 0.22;
    const cx = (C[0] + B[0] + D[0]) / 3, cy = (C[1] + B[1] + D[1]) / 3 - H;
    for (let i = 0; i < 5; i++) {
      const ph = t + i * 1.3;
      const ox = Math.sin(ph) * 8 * z;
      const oy = -((ph % 3) / 3) * 26 * z;
      const r = (5 + Math.sin(ph * 2) * 2) * z;
      ctx.fillStyle = i % 2 ? 'rgba(255,160,40,0.85)' : 'rgba(255,90,30,0.75)';
      ctx.beginPath(); ctx.arc(cx + ox, cy + oy, r, 0, 6.2832); ctx.fill();
    }
    ctx.fillStyle = 'rgba(70,70,80,0.35)';
    ctx.beginPath(); ctx.arc(cx, cy - 34 * z, 13 * z, 0, 6.2832); ctx.fill();
  }

  // -------------------------------------------------------------------------
  //  차량
  // -------------------------------------------------------------------------
  drawCar(w, car, night) {
    const ctx = this.ctx, cam = this.cam, z = cam.zoom;
    if (z < 0.35) return;
    const seg = Math.floor(car.t);
    const f = car.t - seg;
    const p = car.path;
    const i0 = p[Math.min(seg, p.length - 1)];
    const i1 = p[Math.min(seg + 1, p.length - 1)];
    const x0 = i0 % MAP_W + 0.5, y0 = (i0 / MAP_W | 0) + 0.5;
    const x1 = i1 % MAP_W + 0.5, y1 = (i1 / MAP_W | 0) + 0.5;
    const tx = x0 + (x1 - x0) * f, ty = y0 + (y1 - y0) * f;

    const [sx, sy] = cam.tileToScreen(tx, ty);
    const [nx, ny] = cam.tileToScreen(tx + (x1 - x0) * 0.35, ty + (y1 - y0) * 0.35);
    let dx = nx - sx, dy = ny - sy;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const px = -dy, py = dx;                     // 수직(차로 오프셋)
    const off = 3.2 * z * car.lane;
    const cx = sx + px * off, cy = sy + py * off;

    const L = (car.kind === 'truck' ? 7 : 5.2) * z;
    const Wd = (car.kind === 'truck' ? 3.2 : 2.6) * z;
    ctx.fillStyle = shade(car.color, 1, night * 0.8);
    ctx.beginPath();
    ctx.moveTo(cx + dx * L + px * Wd, cy + dy * L + py * Wd);
    ctx.lineTo(cx + dx * L - px * Wd, cy + dy * L - py * Wd);
    ctx.lineTo(cx - dx * L - px * Wd, cy - dy * L - py * Wd);
    ctx.lineTo(cx - dx * L + px * Wd, cy - dy * L + py * Wd);
    ctx.closePath();
    ctx.fill();
    if (night > 0.35 && z > 0.6) {
      ctx.fillStyle = 'rgba(255,240,180,0.9)';
      ctx.beginPath();
      ctx.arc(cx + dx * L, cy + dy * L, 1.3 * z, 0, 6.2832);
      ctx.fill();
    }
  }

  // -------------------------------------------------------------------------
  //  오버레이
  // -------------------------------------------------------------------------
  drawOverlay(w) {
    const mode = OVERLAYS[this.overlayMode];
    if (!mode) return;
    const data = this.oimg.data;
    const f = w.f;

    const put = (i, r, g, b, a) => {
      const o = i * 4;
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = a;
    };

    if (mode.field) {
      const arr = f[mode.field], sc = mode.scale;
      for (let i = 0; i < MAP_W * MAP_H; i++) {
        if (w.water[i]) { put(i, 0, 0, 0, 0); continue; }
        let v = clamp01(arr[i] / sc);
        const c = heat(mode.invert ? v : v);
        put(i, c[0], c[1], c[2], v < 0.02 ? 26 : 140);
      }
    } else if (mode.special === 'traffic') {
      for (let i = 0; i < MAP_W * MAP_H; i++) {
        const rt = w.road[i];
        if (!rt) { put(i, 0, 0, 0, 0); continue; }
        const v = clamp01(f.traffic[i] / ROADS[rt - 1].cap);
        const c = heat(v);
        put(i, c[0], c[1], c[2], 210);
      }
    } else if (mode.special === 'power' || mode.special === 'water') {
      const key = mode.special === 'power' ? 'pRatio' : 'wRatio';
      for (let i = 0; i < MAP_W * MAP_H; i++) {
        const rt = w.road[i];
        if (!rt) { put(i, 0, 0, 0, 0); continue; }
        const comp = w.comps && w.comps[w.comp[i]];
        const st = comp && w.netStats ? w.netStats.get(comp.root) : null;
        const ratio = st ? st[key] : 0;
        if (!st) put(i, 90, 90, 100, 170);
        else if (ratio >= 0.999) put(i, 60, 200, 110, 200);
        else if (ratio > 0.5) put(i, 235, 190, 60, 210);
        else put(i, 225, 60, 55, 220);
      }
    } else if (mode.special === 'edu') {
      for (let i = 0; i < MAP_W * MAP_H; i++) {
        if (w.water[i]) { put(i, 0, 0, 0, 0); continue; }
        const v = clamp01((f.edu1[i] + f.edu2[i] + f.edu3[i]) / 3);
        const c = heat(v);
        put(i, c[0], c[1], c[2], v < 0.02 ? 26 : 140);
      }
    } else if (mode.special === 'comm') {
      for (let i = 0; i < MAP_W * MAP_H; i++) {
        if (w.water[i]) { put(i, 0, 0, 0, 0); continue; }
        const v = clamp01((f.mail[i] + f.telecom[i]) / 2);
        const c = heat(v);
        put(i, c[0], c[1], c[2], v < 0.02 ? 26 : 140);
      }
    } else if (mode.special === 'resource') {
      for (let i = 0; i < MAP_W * MAP_H; i++) {
        const r = w.resource[i];
        if (!r || w.water[i]) { put(i, 0, 0, 0, 0); continue; }
        const c = RES_COLOR[r];
        put(i, c[0], c[1], c[2], 165);
      }
    }

    this.octx.putImageData(this.oimg, 0, 0);
    const ctx = this.ctx, m = this.cam.overlayMatrix();
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 0.72;
    ctx.setTransform(this.dpr * m[0], this.dpr * m[1], this.dpr * m[2],
                     this.dpr * m[3], this.dpr * m[4], this.dpr * m[5]);
    ctx.drawImage(this.overlay, 0, 0);
    ctx.restore();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  // -------------------------------------------------------------------------
  //  보조 표시
  // -------------------------------------------------------------------------
  tilePath(x, y, w = 1, h = 1) {
    const ctx = this.ctx, cam = this.cam;
    const [ax, ay] = cam.tileToScreen(x, y);
    const [bx, by] = cam.tileToScreen(x + w, y);
    const [cx, cy] = cam.tileToScreen(x + w, y + h);
    const [dx, dy] = cam.tileToScreen(x, y + h);
    ctx.beginPath();
    ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy); ctx.lineTo(dx, dy);
    ctx.closePath();
  }

  drawGrid(w) {
    const ctx = this.ctx, cam = this.cam;
    const b = cam.visibleBounds(1);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = b.x0; x <= b.x1 + 1; x++) {
      const [x0, y0] = cam.tileToScreen(x, b.y0);
      const [x1, y1] = cam.tileToScreen(x, b.y1 + 1);
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
    }
    for (let y = b.y0; y <= b.y1 + 1; y++) {
      const [x0, y0] = cam.tileToScreen(b.x0, y);
      const [x1, y1] = cam.tileToScreen(b.x1 + 1, y);
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
    }
    ctx.stroke();
  }

  drawSectorBorders(w, ui) {
    const ctx = this.ctx, cam = this.cam;
    ctx.lineWidth = 2;
    for (let sy = 0; sy < SECTORS_Y; sy++) {
      for (let sx = 0; sx < SECTORS_X; sx++) {
        const s = sy * SECTORS_X + sx;
        const owned = w.sectorOwned[s];
        if (!owned && !ui.sectorMode) continue;
        this.tilePath(sx * SECTOR, sy * SECTOR, SECTOR, SECTOR);
        if (!owned && ui.sectorMode) {
          const hov = ui.hoverSector === s;
          ctx.fillStyle = hov ? 'rgba(90,180,255,0.28)' : 'rgba(90,150,255,0.10)';
          ctx.fill();
          ctx.strokeStyle = hov ? '#7fc4ff' : 'rgba(140,190,255,0.45)';
          ctx.stroke();
        } else if (owned) {
          ctx.strokeStyle = 'rgba(255,255,255,0.10)';
          ctx.stroke();
        }
      }
    }
  }

  drawHover(w, ui) {
    const ctx = this.ctx;
    const { x, y } = ui.hover;
    if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return;
    this.tilePath(x, y);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  drawSelection(w, b) {
    const ctx = this.ctx;
    this.tilePath(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = '#ffd452';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,212,82,0.14)';
    ctx.fill();
  }

  /** ui.preview = { tiles:[[x,y,ok]], box:{x,y,w,h,ok} } */
  drawPreview(w, ui) {
    const ctx = this.ctx;
    const p = ui.preview;
    if (p.tiles) {
      for (const [x, y, ok] of p.tiles) {
        this.tilePath(x, y);
        ctx.fillStyle = ok ? 'rgba(110,230,140,0.34)' : 'rgba(240,80,70,0.34)';
        ctx.fill();
        ctx.strokeStyle = ok ? 'rgba(150,255,180,0.7)' : 'rgba(255,130,120,0.7)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    if (p.box) {
      const { x, y, w: bw, h: bh, ok } = p.box;
      this.tilePath(x, y, bw, bh);
      ctx.fillStyle = ok ? 'rgba(110,230,140,0.30)' : 'rgba(240,80,70,0.30)';
      ctx.fill();
      ctx.strokeStyle = ok ? '#8dffb4' : '#ff8a7d';
      ctx.lineWidth = 2;
      ctx.stroke();
      if (p.radius) {
        const [sx, sy] = this.cam.tileToScreen(x + bw / 2, y + bh / 2);
        ctx.strokeStyle = 'rgba(140,200,255,0.55)';
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.ellipse(sx, sy, p.radius * (TW / 2) * this.cam.zoom,
                    p.radius * (TH / 2) * this.cam.zoom, 0, 0, 6.2832);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }
}

function quad(ctx, a, b, c, d, fill) {
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
  ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}
