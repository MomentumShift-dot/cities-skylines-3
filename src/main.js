// ============================================================================
//  Cities: Skylines III — 진입점
// ============================================================================
import { SPEEDS, TICK_MS, MAP_W, MAP_H } from './core/config.js';
import { createWorld, removeBuilding, defOf } from './core/world.js';
import { initSim, step } from './sim/simulation.js';
import { updateCars } from './sim/network.js';
import { Renderer } from './render/renderer.js';
import { markAllDirty } from './render/ground.js';
import { UI } from './ui/ui.js';
import { Input } from './ui/input.js';
import { pushNote } from './sim/growth.js';
import * as Save from './save.js';

const AUTOSAVE_KEY = 'autosave';

class Game {
  constructor() {
    this.world = createWorld();
    this.renderer = new Renderer(document.getElementById('view'));
    this.ui = new UI(this);
    this.speed = 1;
    this.tool = { type: 'select' };
    this.selected = null;
    this.hover = null;
    this.preview = null;
    this.hoverSector = -1;
    this.showGrid = false;
    this.acc = 0;
    this.lastTs = 0;
    this.fps = 60;
    this.uiTimer = 0;
    this.mmTimer = 0;
    this.autosaveTimer = 0;
  }

  start() {
    const q = new URLSearchParams(location.search);
    this.q = q;
    if (q.has('seed')) this.world = createWorld(parseInt(q.get('seed'), 10) || 1);
    initSim(this.world);
    this.renderer.resize();
    this.ui.build();
    this.input = new Input(this);
    window.addEventListener('resize', () => this.renderer.resize());

    this.renderer.cam.centerOn(MAP_W / 2 - 18, this.world.outside.y);
    this.renderer.cam.zoom = parseFloat(q.get('zoom')) || 1.0;

    if (q.has('selftest')) {
      this.ui.update(true);
      import('./selftest.js').then(m => m.runSelfTest(this));
      requestAnimationFrame(ts => this.loop(ts));
      return;
    }

    if (q.has('demo')) {
      import('./demo.js').then(m => {
        m.buildDemoCity(this.world, parseInt(q.get('demo'), 10) || 14);
        initSim(this.world);
        markAllDirty(this.world);
        this.renderer.cam.centerOn(MAP_W / 2, this.world.outside.y);
        this.renderer.cam.zoom = parseFloat(q.get('zoom')) || 0.62;
        this.ui.update(true); this.ui.updateMinimap();
      });
      if (q.has('overlay')) {
        this.renderer.setOverlay(q.get('overlay'));
        document.querySelectorAll('.ov-btn').forEach(x =>
          x.classList.toggle('active', x.dataset.k === q.get('overlay')));
      }
      if (q.has('night')) this.renderer.forceNight = parseFloat(q.get('night'));
      this.ui.update(true);
      requestAnimationFrame(ts => this.loop(ts));
      return;
    }

    const auto = q.get('auto') === '0' ? null : Save.listSaves().find(s => s.key === AUTOSAVE_KEY);
    if (auto) {
      if (confirm(`이전 도시 「${auto.name}」(인구 ${auto.pop})를 이어서 하시겠습니까?\n취소하면 새 도시를 시작합니다.`)) {
        this.loadGame(AUTOSAVE_KEY);
      } else this.welcome();
    } else this.welcome();

    if (q.has('overlay')) {
      this.renderer.setOverlay(q.get('overlay'));
      document.querySelectorAll('.ov-btn').forEach(x =>
        x.classList.toggle('active', x.dataset.k === q.get('overlay')));
    }
    if (q.has('night')) this.renderer.forceNight = parseFloat(q.get('night'));
    this.ui.update(true);
    this.ui.updateMinimap();
    requestAnimationFrame(ts => this.loop(ts));
  }

  welcome() {
    pushNote(this.world, 'good', '🏙️ 새 도시에 오신 것을 환영합니다! 고속도로에서 도로를 연결해 시작하세요.');
    pushNote(this.world, 'good', '❓ 상단의 도움말 버튼(또는 H 키)에서 조작법과 공략을 확인할 수 있습니다.');
    const seen = localStorage.getItem('cs3_seen_help');
    if (!seen && !(this.q && this.q.has('nohelp'))) {
      localStorage.setItem('cs3_seen_help', '1');
      setTimeout(() => this.ui.openModal('help'), 500);
    }
  }

  // -------------------------------------------------------------------------
  loop(ts) {
    const dt = Math.min(0.1, (ts - this.lastTs) / 1000 || 0.016);
    this.lastTs = ts;
    this.fps = this.fps * 0.9 + (1 / dt) * 0.1;

    const w = this.world;
    const mult = SPEEDS[this.speed];
    if (mult > 0) {
      this.acc += dt * 1000 * mult;
      const period = TICK_MS;
      let n = 0;
      while (this.acc >= period && n < 14) { step(w); this.acc -= period; n++; }
      if (this.acc > period * 20) this.acc = 0;
      w.subTick = this.acc / period;
      updateCars(w, dt * Math.min(mult, 3));
    }

    this.input.updateCameraKeys(dt);
    this.renderer.showGrid = this.showGrid;
    this.renderer.render(w, {
      hover: this.hover, tool: this.tool.type, preview: this.preview,
      selected: this.selected, showGrid: this.showGrid,
      sectorMode: this.tool.type === 'sector', hoverSector: this.hoverSector,
    });

    this.uiTimer += dt;
    if (this.uiTimer > 0.2) { this.uiTimer = 0; this.ui.update(); }
    this.mmTimer += dt;
    if (this.mmTimer > 0.6) { this.mmTimer = 0; this.ui.updateMinimap(); }
    this.autosaveTimer += dt;
    if (this.autosaveTimer > 120) {
      this.autosaveTimer = 0;
      Save.saveTo(AUTOSAVE_KEY, w);
    }

    document.getElementById('fpsText').textContent =
      `${this.fps.toFixed(0)} FPS · 건물 ${w.buildings.filter(Boolean).length} · 차량 ${w.cars.length}`;

    requestAnimationFrame(t => this.loop(t));
  }

  // -------------------------------------------------------------------------
  setSpeed(n) { this.speed = n; this.ui.update(true); }

  setTool(t) {
    this.tool = t;
    this.preview = null;
    document.getElementById('view').style.cursor =
      t.type === 'select' ? 'default' : t.type === 'bulldoze' ? 'not-allowed' : 'crosshair';
  }

  status(txt) { document.getElementById('statusText').textContent = txt || '좌클릭: 건설 · 우클릭 드래그: 이동 · 휠: 확대/축소 · H: 도움말'; }

  toast(msg, type = 'warn') { if (msg) pushNote(this.world, type, msg); }

  demolishBuilding(b) {
    const d = defOf(b);
    const refund = b.kind === 'service' ? (d.cost || 0) * 0.2 : 0;
    removeBuilding(this.world, b);
    this.world.city.cash += refund;
    this.world.city.stats.bulldozed++;
    this.selected = null;
  }

  markAllGroundDirty() { markAllDirty(this.world); }

  // --- 저장 ---------------------------------------------------------------
  saveGame(key) {
    const k = key || (this.world.city.name.replace(/\s+/g, '_') + '_' + Date.now().toString(36));
    const r = Save.saveTo(k, this.world);
    this.toast(r.ok ? '💾 도시를 저장했습니다.' : r.msg, r.ok ? 'good' : 'danger');
  }
  loadGame(key) {
    const w = Save.loadFrom(key);
    if (!w) { this.toast('불러오기에 실패했습니다.', 'danger'); return; }
    this.adoptWorld(w);
  }
  adoptWorld(w) {
    this.world = w;
    this.selected = null;
    initSim(w);
    markAllDirty(w);
    this.renderer.cam.centerOn(MAP_W / 2, MAP_H / 2);
    this.ui.notifShown = 0;
    this.ui.update(true);
    this.ui.updateMinimap();
    pushNote(w, 'good', `🏙️ 「${w.city.name}」 도시를 불러왔습니다.`);
  }
  listSaves() { return Save.listSaves(); }
  deleteSave(k) { Save.deleteSave(k); }
  exportSave() { Save.exportFile(this.world); }
  async importSave() {
    const w = await Save.importFile();
    if (w) this.adoptWorld(w);
  }
  newGame() {
    this.adoptWorld(createWorld());
    this.speed = 1;
    this.welcome();
  }
}

const game = new Game();
window.game = game;
game.start();
