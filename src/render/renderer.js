// ============================================================================
//  메인 렌더러 — 지면 + 캐시된 입체 건물 스프라이트 + 차량 + 야간 조명 + 오버레이
// ============================================================================
import {
  MAP_W, MAP_H, TW, TH, ZONE_DEF, ROADS, BUILDING_BY_ID,
  SECTOR, SECTORS_X, SECTORS_Y,
} from '../core/config.js';
import { idx, defOf } from '../core/world.js';
import { Camera, isoX, isoY, shade, heat } from './gfx.js';
import { createGround, redrawGround } from './ground.js';
import { SpriteCache, specOf } from './sprites.js';
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

/** 시각(0..1) → 야간 강도 비율 키프레임 */
const NIGHT_CURVE = [
  [0.00, 1.0], [0.16, 1.0], [0.26, 0.0], [0.72, 0.0], [0.84, 1.0], [1.00, 1.0],
];

/** 부드러운 원형 광원 스프라이트 (한 번만 생성해 재사용) */
function makeGlow(size, rgbPrefix, peak) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, rgbPrefix + peak + ')');
  grad.addColorStop(0.45, rgbPrefix + (peak * 0.32).toFixed(3) + ')');
  grad.addColorStop(1, rgbPrefix + '0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.cam = new Camera();
    this.ground = createGround();
    this.sprites = new SpriteCache(220);
    this.overlay = document.createElement('canvas');
    this.overlay.width = MAP_W; this.overlay.height = MAP_H;
    this.octx = this.overlay.getContext('2d');
    this.oimg = this.octx.createImageData(MAP_W, MAP_H);
    this.overlayMode = 'none';
    this.showGrid = false;
    // 낮/밤은 시뮬레이션 속도와 무관한 실시간 주기로 돈다.
    // (게임 내 1일은 1초 미만이라 그대로 쓰면 화면이 초 단위로 깜박인다)
    this.timeOfDay = 0.42;          // 0 = 자정, 0.5 = 정오
    this.dayLength = 300;           // 한 주기(초)
    this.dayNightMode = 'auto';     // auto | day | night
    this.maxNight = 0.78;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.frame = 0;
    this.lightQueue = [];
    this.fxQueue = [];
    this.lampSprite = makeGlow(64, 'rgba(255,214,140,', 0.55);
    this.headlight = makeGlow(32, 'rgba(255,240,190,', 0.7);
    this.stats = { drawn: 0 };
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(2, (r.width * this.dpr) | 0);
    this.canvas.height = Math.max(2, (r.height * this.dpr) | 0);
    this.cam.resize(r.width, r.height);
  }

  setOverlay(mode) { this.overlayMode = mode; }

  /** 실시간 dt(초)만큼 하루를 진행시킨다 */
  advanceClock(dt) {
    if (this.dayNightMode !== 'auto') return;
    this.timeOfDay = (this.timeOfDay + dt / this.dayLength) % 1;
  }

  setDayNightMode(mode) {
    this.dayNightMode = mode;
    if (mode === 'day') this.timeOfDay = 0.5;
    else if (mode === 'night') this.timeOfDay = 0.0;
  }

  /** 시각 → 야간 강도(0..maxNight). 낮 46% · 밤 32% · 여명/황혼 22% */
  nightFactor() {
    if (this.forceNight !== undefined) return this.forceNight;
    if (this.dayNightMode === 'day') return 0;
    if (this.dayNightMode === 'night') return this.maxNight;
    const t = this.timeOfDay;
    const K = NIGHT_CURVE;
    for (let i = 1; i < K.length; i++) {
      if (t <= K[i][0]) {
        const a = K[i - 1], b = K[i];
        const u = (t - a[0]) / (b[0] - a[0] || 1);
        const e = u * u * (3 - 2 * u);              // smoothstep
        return (a[1] + (b[1] - a[1]) * e) * this.maxNight;
      }
    }
    return this.maxNight;
  }

  /** 상태 표시용 시각 문자열 */
  clockLabel() {
    if (this.dayNightMode === 'day') return '☀️ 낮 고정';
    if (this.dayNightMode === 'night') return '🌙 밤 고정';
    const h = Math.floor(this.timeOfDay * 24), m = Math.floor((this.timeOfDay * 24 % 1) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  // =========================================================================
  render(w, ui) {
    const ctx = this.ctx, cam = this.cam;
    this.frame++;
    redrawGround(w, this.ground);
    const night = this.nightFactor();
    this.lightQueue.length = 0;
    this.fxQueue.length = 0;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = night > 0.5 ? '#070d16' : '#0d1520';
    ctx.fillRect(0, 0, cam.vw, cam.vh);

    // --- 지면 -------------------------------------------------------------
    const gm = cam.groundMatrix();
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.setTransform(this.dpr * gm[0], this.dpr * gm[1], this.dpr * gm[2],
                     this.dpr * gm[3], this.dpr * gm[4], this.dpr * gm[5]);
    ctx.drawImage(this.ground.canvas, 0, 0);
    ctx.restore();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    if (this.overlayMode !== 'none') this.drawOverlay(w);

    // --- 프롭 수집 및 깊이 정렬 ---------------------------------------------
    const b = cam.visibleBounds(8);
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

    // --- 굴뚝 연기 / 풍력 블레이드 ------------------------------------------
    for (const f of this.fxQueue) this.drawFx(f);

    // --- 야간 틴트 ----------------------------------------------------------
    if (night > 0.02) {
      ctx.fillStyle = `rgba(12,22,58,${(night * 0.52).toFixed(3)})`;
      ctx.fillRect(0, 0, cam.vw, cam.vh);
      this.drawNightLights(w, night, b);
    }

    // --- 상태 표시 / UI 보조 -------------------------------------------------
    for (const p of props) if (p.t === 0) this.drawBuildingOverlay(w, p.o, night);

    if (ui) {
      if (ui.showGrid && cam.zoom > 0.5) this.drawGrid(w);
      this.drawSectorBorders(w, ui);
      if (ui.preview) this.drawPreview(w, ui);
      if (ui.selected) this.drawSelection(w, ui.selected);
      if (ui.hover && ui.tool !== 'select') this.drawHover(w, ui);
    }
  }

  // =========================================================================
  //  건물
  // =========================================================================
  drawBuilding(w, b, night) {
    const ctx = this.ctx, cam = this.cam, z = cam.zoom;
    const def = defOf(b);
    if (!def) return;

    const [ax, ay] = cam.tileToScreen(b.x, b.y);
    const [cx2, cy2] = cam.tileToScreen(b.x + b.w, b.y + b.h);
    if (cx2 < -60 || ax > cam.vw + 60 || cy2 < -400 || ay > cam.vh + 80) return;

    // 그림자
    const [bx2, by2] = cam.tileToScreen(b.x + b.w, b.y);
    const [dx2, dy2] = cam.tileToScreen(b.x, b.y + b.h);
    const sh = 3.5 * z;
    ctx.fillStyle = `rgba(10,16,24,${(0.26 * (1 - night * 0.55)).toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(ax + sh, ay + sh * 0.5); ctx.lineTo(bx2 + sh, by2 + sh * 0.5);
    ctx.lineTo(cx2 + sh, cy2 + sh * 0.5); ctx.lineTo(dx2 + sh, dy2 + sh * 0.5);
    ctx.closePath(); ctx.fill();

    // 건설 중인 건물은 캐시를 쓰지 않고 골조를 그린다
    if (b.progress !== undefined && b.progress < 1) {
      this.drawConstruction(w, b, def, ax, ay, bx2, by2, cx2, cy2, dx2, dy2, night);
      return;
    }

    const spec = specOf(b);
    if (spec.kind === 'service') spec.def = def;
    const sp = this.sprites.get(spec, z, def);
    const s = z / sp.z;
    const dw = sp.w * s, dh = sp.h * s;
    const dx = ax - sp.ox * s, dy = ay - sp.oy * s;
    ctx.drawImage(sp.body, dx, dy, dw, dh);

    if (sp.hasLights && night > 0.05) this.lightQueue.push({ s: sp.lights, x: dx, y: dy, w: dw, h: dh });
    if (sp.fx && (sp.fx.smoke || sp.fx.blades)) this.fxQueue.push({ b, fx: sp.fx, night });
  }

  /** 건설 현장 — 기초 + 골조 + 타워크레인 */
  drawConstruction(w, b, def, ax, ay, bx2, by2, cx2, cy2, dx2, dy2, night) {
    const ctx = this.ctx, z = this.cam.zoom;
    const prog = Math.max(0.1, b.progress);
    const full = (b.kind === 'growth' ? def.height[b.level - 1] : (def.height || 20));
    const H = full * prog * z;
    const q = (p1, p2, p3, p4, fill) => {
      ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]);
      ctx.lineTo(p3[0], p3[1]); ctx.lineTo(p4[0], p4[1]); ctx.closePath();
      ctx.fillStyle = fill; ctx.fill();
    };
    // 부지
    q([ax, ay], [bx2, by2], [cx2, cy2], [dx2, dy2], '#8a8375');
    const A = [ax, ay - H], B = [bx2, by2 - H], C = [cx2, cy2 - H], D = [dx2, dy2 - H];
    q([dx2, dy2], [cx2, cy2], C, D, shade('#b9a887', 0.66, night));
    q([cx2, cy2], [bx2, by2], B, C, shade('#b9a887', 0.88, night));
    q(A, B, C, D, shade('#cbbb9a', 1.0, night));
    // 층 슬래브
    ctx.strokeStyle = 'rgba(60,50,40,.45)'; ctx.lineWidth = 1;
    const floors = Math.max(1, Math.round(full * prog / 11));
    ctx.beginPath();
    for (let f = 1; f <= floors; f++) {
      const hh = (H * f) / (floors + 1);
      ctx.moveTo(dx2, dy2 - hh); ctx.lineTo(cx2, cy2 - hh); ctx.lineTo(bx2, by2 - hh);
    }
    ctx.stroke();
    // 타워크레인
    const mast = H + 26 * z;
    ctx.strokeStyle = '#e0b23c'; ctx.lineWidth = Math.max(1, 1.6 * z);
    ctx.beginPath();
    ctx.moveTo(cx2, cy2); ctx.lineTo(cx2, cy2 - mast);
    ctx.lineTo(cx2 + 30 * z, cy2 - mast + 3 * z);
    ctx.moveTo(cx2, cy2 - mast); ctx.lineTo(cx2 - 12 * z, cy2 - mast + 2 * z);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(220,220,220,.7)'; ctx.lineWidth = Math.max(0.7, 1 * z);
    ctx.beginPath();
    ctx.moveTo(cx2 + 22 * z, cy2 - mast + 2 * z);
    ctx.lineTo(cx2 + 22 * z, cy2 - mast + 20 * z);
    ctx.stroke();
    // 안전 펜스
    ctx.strokeStyle = 'rgba(230,180,60,.75)'; ctx.lineWidth = Math.max(0.8, 1.2 * z);
    ctx.beginPath();
    ctx.moveTo(ax, ay - 4 * z); ctx.lineTo(bx2, by2 - 4 * z);
    ctx.lineTo(cx2, cy2 - 4 * z); ctx.lineTo(dx2, dy2 - 4 * z); ctx.closePath();
    ctx.stroke();
  }

  /** 화재 · 경고 아이콘 · 서비스 아이콘 (야간 틴트 위에 그린다) */
  drawBuildingOverlay(w, b, night) {
    const ctx = this.ctx, cam = this.cam, z = cam.zoom;
    if (z < 0.4) return;
    const def = defOf(b);
    if (!def) return;
    const [mx, my] = cam.tileToScreen(b.x + b.w / 2, b.y + b.h / 2);
    const H = (b.kind === 'growth' ? def.height[b.level - 1] : (def.height || 20)) * z;

    if (b.fire > 0) this.drawFire(mx, my - H * 0.6, z);

    if (b.kind === 'service' && z > 0.62 && def.icon) {
      ctx.font = `${Math.min(26, 13 * z + 6)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji"`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = 0.95;
      ctx.fillText(def.icon, mx, my - H - 10 * z);
      ctx.globalAlpha = 1;
    }
    if (b.kind === 'growth' && !b.abandoned) {
      let warn = null;
      if (!b.powered) warn = '⚡';
      else if (!b.watered) warn = '💧';
      if (warn) {
        ctx.globalAlpha = 0.55 + 0.45 * Math.sin(this.frame * 0.055);
        ctx.font = `${Math.min(20, 10 * z + 5)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji"`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(warn, mx, my - H - 4 * z);
        ctx.globalAlpha = 1;
      }
    }
    if (b.abandoned) {
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this.frame * 0.04);
      ctx.font = `${Math.min(20, 10 * z + 5)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji"`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText('🏚️', mx, my - H - 4 * z);
      ctx.globalAlpha = 1;
    }
  }

  // --- 애니메이션 이펙트 ----------------------------------------------------
  drawFx(f) {
    const ctx = this.ctx, cam = this.cam, z = cam.zoom;
    const b = f.b;
    const loc = (tx, ty, h) => {
      const [sx, sy] = cam.tileToScreen(b.x + tx, b.y + ty);
      return [sx, sy - h * z];
    };
    if (f.fx.smoke && z > 0.3) {
      for (const s of f.fx.smoke) {
        const p = loc(s.x, s.y, s.h);
        const dark = s.dark;
        for (let i = 0; i < 6; i++) {
          const t = ((this.frame * 0.006) + i / 6) % 1;
          const r = (s.r * 26 + t * 30) * z;
          const a = (1 - t) * (dark ? 0.30 : 0.24) * (0.6 + 0.4 * Math.sin(i));
          ctx.fillStyle = dark ? `rgba(70,72,76,${a.toFixed(3)})` : `rgba(226,232,238,${a.toFixed(3)})`;
          ctx.beginPath();
          ctx.ellipse(p[0] + Math.sin(t * 4 + i) * 8 * z, p[1] - t * 52 * z, r, r * 0.72, 0, 0, 6.2832);
          ctx.fill();
        }
      }
    }
    if (f.fx.blades) {
      for (const bl of f.fx.blades) {
        const p = loc(bl.x, bl.y, bl.h);
        const R = bl.r * z;
        const ang = this.frame * 0.045;
        ctx.strokeStyle = f.night > 0.4 ? '#c8ccd0' : '#f2f5f7';
        ctx.lineWidth = Math.max(1, 2.2 * z);
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          const a = ang + (i * Math.PI * 2) / 3;
          ctx.moveTo(p[0], p[1]);
          ctx.lineTo(p[0] + Math.cos(a) * R * 0.5, p[1] + Math.sin(a) * R);
        }
        ctx.stroke();
        ctx.lineCap = 'butt';
        ctx.fillStyle = '#dfe5ea';
        ctx.beginPath(); ctx.arc(p[0], p[1], 2 * z, 0, 6.2832); ctx.fill();
      }
    }
  }

  drawFire(cx, cy, z) {
    const ctx = this.ctx;
    const t = this.frame * 0.22;
    for (let i = 0; i < 6; i++) {
      const ph = t + i * 1.1;
      const ox = Math.sin(ph) * 9 * z;
      const oy = -((ph % 3) / 3) * 30 * z;
      const r = (5 + Math.sin(ph * 2) * 2.4) * z;
      ctx.fillStyle = i % 2 ? 'rgba(255,168,44,0.88)' : 'rgba(255,92,30,0.8)';
      ctx.beginPath(); ctx.arc(cx + ox, cy + oy, r, 0, 6.2832); ctx.fill();
    }
    ctx.fillStyle = 'rgba(70,70,80,0.32)';
    ctx.beginPath(); ctx.arc(cx, cy - 40 * z, 15 * z, 0, 6.2832); ctx.fill();
  }

  // --- 야간 조명 합성 --------------------------------------------------------
  drawNightLights(w, night, bounds) {
    const ctx = this.ctx, cam = this.cam, z = cam.zoom;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, night * 1.05);
    for (const l of this.lightQueue) ctx.drawImage(l.s, l.x, l.y, l.w, l.h);

    // 가로등 — 부드러운 광원 스프라이트를 블릿한다
    if (z > 0.55) {
      ctx.globalAlpha = Math.min(0.5, night * 0.45);
      const r = 11 * z;
      for (let y = bounds.y0; y <= bounds.y1; y++) {
        for (let x = bounds.x0; x <= bounds.x1; x++) {
          if (((x * 5 + y * 3) % 9) !== 0) continue;
          const i = idx(x, y);
          if (!w.road[i]) continue;
          const [sx, sy] = cam.tileToScreen(x + 0.5, y + 0.5);
          if (sx < -r || sx > cam.vw + r || sy < -r || sy > cam.vh + r) continue;
          ctx.drawImage(this.lampSprite, sx - r, sy - r * 0.62 - 4 * z, r * 2, r * 1.24);
        }
      }
    }
    // 차량 전조등
    ctx.globalAlpha = Math.min(1, night * 0.9);
    const hr = 9 * z;
    for (const c of this.carLights || []) {
      ctx.drawImage(this.headlight, c[0] - hr, c[1] - hr * 0.6, hr * 2, hr * 1.2);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // =========================================================================
  //  차량
  // =========================================================================
  drawCar(w, car, night) {
    const ctx = this.ctx, cam = this.cam, z = cam.zoom;
    if (z < 0.32) return;
    if (!this.carLights || this.carLights.frame !== this.frame) {
      this.carLights = []; this.carLights.frame = this.frame;
    }
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
    const px = -dy, py = dx;
    const off = 3.2 * z * car.lane;
    const cx = sx + px * off, cy = sy + py * off;

    const truck = car.kind === 'truck';
    const L = (truck ? 7.5 : 5.4) * z, Wd = (truck ? 3.2 : 2.6) * z;
    const bodyH = (truck ? 5.5 : 3.6) * z;
    const corner = (fw, sw2, h) => [cx + dx * fw + px * sw2, cy + dy * fw + py * sw2 - h];

    // 그림자
    ctx.fillStyle = 'rgba(10,16,24,.28)';
    ctx.beginPath();
    ctx.moveTo(...corner(L, Wd, 0)); ctx.lineTo(...corner(L, -Wd, 0));
    ctx.lineTo(...corner(-L, -Wd, 0)); ctx.lineTo(...corner(-L, Wd, 0));
    ctx.closePath(); ctx.fill();
    // 차체 측면
    const body = shade(car.color, 0.78, night * 0.7);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(...corner(L, -Wd, 0)); ctx.lineTo(...corner(-L, -Wd, 0));
    ctx.lineTo(...corner(-L, -Wd, bodyH)); ctx.lineTo(...corner(L, -Wd, bodyH));
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = shade(car.color, 0.66, night * 0.7);
    ctx.beginPath();
    ctx.moveTo(...corner(L, Wd, 0)); ctx.lineTo(...corner(L, -Wd, 0));
    ctx.lineTo(...corner(L, -Wd, bodyH)); ctx.lineTo(...corner(L, Wd, bodyH));
    ctx.closePath(); ctx.fill();
    // 지붕
    ctx.fillStyle = shade(car.color, 1.0, night * 0.7);
    ctx.beginPath();
    ctx.moveTo(...corner(L, Wd, bodyH)); ctx.lineTo(...corner(L, -Wd, bodyH));
    ctx.lineTo(...corner(-L, -Wd, bodyH)); ctx.lineTo(...corner(-L, Wd, bodyH));
    ctx.closePath(); ctx.fill();
    // 앞유리
    if (z > 0.7) {
      ctx.fillStyle = 'rgba(40,60,78,.75)';
      ctx.beginPath();
      ctx.moveTo(...corner(L * 0.45, Wd * 0.9, bodyH)); ctx.lineTo(...corner(L * 0.45, -Wd * 0.9, bodyH));
      ctx.lineTo(...corner(L * 0.05, -Wd * 0.9, bodyH)); ctx.lineTo(...corner(L * 0.05, Wd * 0.9, bodyH));
      ctx.closePath(); ctx.fill();
    }
    if (night > 0.3) this.carLights.push([cx + dx * L, cy + dy * L - bodyH * 0.4]);
  }

  // =========================================================================
  //  오버레이
  // =========================================================================
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
        const v = clamp01(arr[i] / sc);
        const c = heat(v);
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

  // =========================================================================
  //  보조 표시
  // =========================================================================
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
    const ctx = this.ctx;
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
