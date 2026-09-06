// ============================================================================
//  입력 처리 — 마우스/키보드, 도구 적용, 프리뷰 계산
// ============================================================================
import { MAP_W, MAP_H, ROADS, ZONE_DEF, BUILDING_BY_ID, SECTOR, SECTORS_X, SECTORS_Y } from '../core/config.js';
import { idx, inBounds, isOwned, buildingAt, sectorCost } from '../core/world.js';
import {
  roadPathTiles, estimateRoad, buildRoad, removeRoad, paintZone,
  placeBuilding, checkBuildingPlacement, bulldozeTile,
} from '../sim/actions.js';
import { buySector } from '../sim/progression.js';
import { fmtMoney } from '../core/utils.js';

export class Input {
  constructor(game) {
    this.g = game;
    this.canvas = game.renderer.canvas;
    this.drag = null;          // {mode:'pan'|'tool', ...}
    this.brush = 3;
    this.keys = new Set();
    this.lastPaint = null;
    this.bind();
  }

  tileAt(e) {
    const r = this.canvas.getBoundingClientRect();
    const [tx, ty] = this.g.renderer.cam.screenToTile(e.clientX - r.left, e.clientY - r.top);
    return { x: Math.floor(tx), y: Math.floor(ty), fx: tx, fy: ty };
  }

  bind() {
    const c = this.canvas;
    c.addEventListener('contextmenu', e => e.preventDefault());

    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId);
      const t = this.tileAt(e);
      if (e.button === 2 || e.button === 1) {
        this.drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, moved: 0 };
        return;
      }
      if (e.button !== 0) return;
      const tool = this.g.tool;
      this.g.ui.closeModal();

      if (tool.type === 'road' || tool.type === 'roadRemove') {
        this.drag = { mode: 'road', start: t };
      } else if (tool.type === 'zone' || tool.type === 'bulldoze') {
        this.drag = { mode: 'paint' };
        this.applyPaint(t);
      } else if (tool.type === 'build') {
        this.applyBuild(t);
      } else if (tool.type === 'sector') {
        this.applySector(t);
      } else {
        this.applySelect(t);
      }
    });

    c.addEventListener('pointermove', e => {
      const t = this.tileAt(e);
      this.g.hover = t;
      if (this.drag && this.drag.mode === 'pan') {
        const dx = e.clientX - this.drag.sx, dy = e.clientY - this.drag.sy;
        this.drag.moved += Math.abs(dx) + Math.abs(dy);
        this.g.renderer.cam.panBy(dx, dy);
        this.drag.sx = e.clientX; this.drag.sy = e.clientY;
        return;
      }
      if (this.drag && this.drag.mode === 'paint') this.applyPaint(t);
      this.updatePreview(t);
    });

    const end = e => {
      if (!this.drag) return;
      if (this.drag.mode === 'road') {
        const t = this.tileAt(e);
        this.applyRoad(this.drag.start, t);
      }
      this.drag = null;
      this.lastPaint = null;
      this.updatePreview(this.g.hover);
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', () => { this.drag = null; this.lastPaint = null; });
    c.addEventListener('pointerleave', () => { this.g.hover = null; this.g.preview = null; });

    c.addEventListener('wheel', e => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      this.g.renderer.cam.zoomAt(e.clientX - r.left, e.clientY - r.top,
                                e.deltaY < 0 ? 1.16 : 1 / 1.16);
    }, { passive: false });

    // --- 키보드 -------------------------------------------------------------
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      this.keys.add(e.key.toLowerCase());
      const g = this.g;
      switch (e.key.toLowerCase()) {
        case ' ': e.preventDefault(); g.setSpeed(g.speed === 0 ? 1 : 0); break;
        case '1': g.setSpeed(1); break;
        case '2': g.setSpeed(2); break;
        case '3': g.setSpeed(3); break;
        case 'escape': g.setTool({ type: 'select' }); g.ui.closePalette(); g.ui.closeModal(); break;
        case 'q': g.ui.selectGroup('road'); break;
        case 'e': g.ui.selectGroup('zone'); break;
        case 'x': g.ui.selectGroup('demolish'); break;
        case 'g': g.showGrid = !g.showGrid; break;
        case 'n': g.cycleDayNight(); break;
        case 'b': g.ui.openModal('budget'); break;
        case 't': g.ui.openModal('stats'); break;
        case 'm': g.ui.openModal('miles'); break;
        case 'p': g.ui.openModal('policy'); break;
        case 'r': g.ui.openModal('dev'); break;
        case 'h': g.ui.openModal('help'); break;
        case '[': this.brush = Math.max(1, this.brush - 1); break;
        case ']': this.brush = Math.min(12, this.brush + 1); break;
      }
    });
    window.addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()));
  }

  /** 매 프레임: 키보드 팬 */
  updateCameraKeys(dt) {
    const k = this.keys, cam = this.g.renderer.cam;
    let dx = 0, dy = 0;
    if (k.has('a') || k.has('arrowleft')) dx += 1;
    if (k.has('d') || k.has('arrowright')) dx -= 1;
    if (k.has('w') || k.has('arrowup')) dy += 1;
    if (k.has('s') || k.has('arrowdown')) dy -= 1;
    if (dx || dy) cam.panBy(dx * 900 * dt, dy * 900 * dt);
  }

  // -------------------------------------------------------------------------
  //  프리뷰
  // -------------------------------------------------------------------------
  brushTiles(t) {
    const out = [];
    const r = Math.floor(this.brush / 2);
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const x = t.x + dx, y = t.y + dy;
        if (inBounds(x, y)) out.push([x, y]);
      }
    return out;
  }

  updatePreview(t) {
    const g = this.g, w = g.world;
    g.preview = null;
    g.hoverSector = -1;
    if (!t || !inBounds(t.x, t.y)) { g.status(''); return; }
    const tool = g.tool;

    if (tool.type === 'road' || tool.type === 'roadRemove') {
      const start = this.drag && this.drag.mode === 'road' ? this.drag.start : t;
      const tiles = roadPathTiles(start.x, start.y, t.x, t.y);
      if (tool.type === 'road') {
        const est = estimateRoad(w, tiles, tool.roadType);
        g.preview = {
          tiles: tiles.map(([x, y]) => [x, y, isOwned(w, x, y)]),
        };
        g.status(`${ROADS[tool.roadType].name} · ${tiles.length}칸 · ${fmtMoney(est.cost)}` +
                 (est.cost > w.city.cash ? ' ⚠ 자금 부족' : ''));
      } else {
        g.preview = { tiles: tiles.map(([x, y]) => [x, y, w.road[idx(x, y)] > 0]) };
        g.status(`도로 철거 · ${tiles.length}칸`);
      }
      return;
    }

    if (tool.type === 'zone') {
      const tiles = this.brushTiles(t);
      const zd = ZONE_DEF[tool.zone];
      g.preview = {
        tiles: tiles.map(([x, y]) => {
          const i = idx(x, y);
          return [x, y, isOwned(w, x, y) && !w.water[i] && !w.road[i]];
        }),
      };
      g.status(tool.zone === 0 ? `구역 해제 · 브러시 ${this.brush}`
        : `${zd.name} · 브러시 ${this.brush} · ${fmtMoney(zd.cost * tiles.length)}`);
      return;
    }

    if (tool.type === 'bulldoze') {
      const tiles = this.brushTiles(t);
      g.preview = { tiles: tiles.map(([x, y]) => [x, y, isOwned(w, x, y)]) };
      g.status(`철거 · 브러시 ${this.brush}`);
      return;
    }

    if (tool.type === 'build') {
      const d = BUILDING_BY_ID[tool.defId];
      if (!d) return;
      const x = t.x - ((d.w - 1) >> 1), y = t.y - ((d.h - 1) >> 1);
      const err = checkBuildingPlacement(w, x, y, tool.defId);
      g.preview = {
        box: { x, y, w: d.w, h: d.h, ok: !err },
        radius: d.svc ? d.svc.radius : (d.link || 0),
      };
      g.status(err ? `⚠ ${err}` : `${d.name} · ${fmtMoney(d.cost)} · 유지 ₡${d.upkeep}/월`);
      return;
    }

    if (tool.type === 'sector') {
      const s = Math.floor(t.y / SECTOR) * SECTORS_X + Math.floor(t.x / SECTOR);
      if (!w.sectorOwned[s]) {
        g.hoverSector = s;
        const cost = sectorCost(w);
        g.status(`구역 구매 · 확장 허가증 ${cost}장 (보유 ${w.city.permits}장)`);
      } else g.status('이미 소유한 구역입니다.');
      return;
    }

    const b = buildingAt(w, t.x, t.y);
    g.status(b ? '클릭하여 건물 정보 보기' : `타일 ${t.x}, ${t.y}`);
  }

  // -------------------------------------------------------------------------
  //  적용
  // -------------------------------------------------------------------------
  applyRoad(start, t) {
    const g = this.g, w = g.world;
    const tiles = roadPathTiles(start.x, start.y, t.x, t.y);
    const res = g.tool.type === 'road'
      ? buildRoad(w, tiles, g.tool.roadType)
      : removeRoad(w, tiles);
    if (!res.ok && res.msg) g.toast(res.msg, 'warn');
  }

  applyPaint(t) {
    const g = this.g, w = g.world;
    if (!t || !inBounds(t.x, t.y)) return;
    let tiles;
    if (this.lastPaint) {
      // 이동 사이 빈틈 보간
      tiles = [];
      const steps = Math.max(Math.abs(t.x - this.lastPaint.x), Math.abs(t.y - this.lastPaint.y));
      for (let s = 0; s <= steps; s++) {
        const x = Math.round(this.lastPaint.x + (t.x - this.lastPaint.x) * (s / (steps || 1)));
        const y = Math.round(this.lastPaint.y + (t.y - this.lastPaint.y) * (s / (steps || 1)));
        tiles.push(...this.brushTiles({ x, y }));
      }
    } else tiles = this.brushTiles(t);
    this.lastPaint = { x: t.x, y: t.y };

    if (g.tool.type === 'zone') {
      const r = paintZone(w, tiles, g.tool.zone);
      if (!r.ok && r.msg) g.toast(r.msg, 'warn');
    } else {
      for (const [x, y] of tiles) bulldozeTile(w, x, y);
    }
  }

  applyBuild(t) {
    const g = this.g, w = g.world;
    const d = BUILDING_BY_ID[g.tool.defId];
    if (!d) return;
    const x = t.x - ((d.w - 1) >> 1), y = t.y - ((d.h - 1) >> 1);
    const res = placeBuilding(w, x, y, g.tool.defId);
    if (!res.ok) g.toast(res.msg, 'warn');
    else if (d.unique) { g.setTool({ type: 'select' }); g.ui.closePalette(); }
  }

  applySector(t) {
    const g = this.g, w = g.world;
    const s = Math.floor(t.y / SECTOR) * SECTORS_X + Math.floor(t.x / SECTOR);
    if (w.sectorOwned[s]) return;
    // 인접 구역만 구매 가능
    const sx = s % SECTORS_X, sy = (s / SECTORS_X) | 0;
    const adj = [[1,0],[-1,0],[0,1],[0,-1]].some(([dx, dy]) => {
      const nx = sx + dx, ny = sy + dy;
      return nx >= 0 && ny >= 0 && nx < SECTORS_X && ny < SECTORS_Y && w.sectorOwned[ny * SECTORS_X + nx];
    });
    if (!adj) { g.toast('이미 소유한 구역과 인접해야 합니다.', 'warn'); return; }
    const r = buySector(w, s);
    if (!r.ok) g.toast(r.msg, 'warn');
    else { g.renderer.ground && g.markAllGroundDirty(); }
  }

  applySelect(t) {
    const g = this.g, w = g.world;
    const b = buildingAt(w, t.x, t.y);
    if (b) { g.selected = b; g.ui.renderInfo(b); }
    else { g.selected = null; g.ui.renderTileInfo(t.x, t.y); }
  }
}
