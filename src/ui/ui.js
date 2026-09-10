// ============================================================================
//  UI — 상단바, 툴바/팔레트, 정보 패널, 미니맵, 알림, 모달
// ============================================================================
import {
  ROADS, ZONE_DEF, BUILDINGS, BUILDING_BY_ID, CATEGORY_INFO, MILESTONES, POLICIES, ECON,
  MAP_W, MAP_H, SECTOR, SECTORS_X,
} from '../core/config.js';
import { idx, defOf, eachBuilding, sectorCost, buyableSectors } from '../core/world.js';
import { OVERLAYS } from '../render/renderer.js';
import { milestoneProgress, nextMilestone, research, buySector, buildingAvailable,
         zoneAvailable, roadAvailable, policyAvailable } from '../sim/progression.js';
import { loanLimit, takeLoan, repayLoan } from '../sim/economy.js';
import { sampleField } from '../sim/fields.js';
import { fmtInt, fmtMoney, fmtShort, clamp01, clamp } from '../core/utils.js';

const $ = s => document.querySelector(s);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

/** 툴바 구성 */
const TOOL_GROUPS = [
  { id: 'select',  name: '조회',      icon: '🔍', kind: 'select' },
  { id: 'road',    name: '도로',      icon: '🛣️', kind: 'road' },
  { id: 'zone',    name: '용도지역',  icon: '🧱', kind: 'zone' },
  { id: 'power',   name: '전력',      icon: '⚡', kind: 'build', cats: ['power'] },
  { id: 'water',   name: '상하수도',  icon: '💧', kind: 'build', cats: ['water'] },
  { id: 'garbage', name: '폐기물',    icon: '🗑️', kind: 'build', cats: ['garbage'] },
  { id: 'service', name: '공공서비스', icon: '🏥', kind: 'build', cats: ['health', 'fire', 'police'] },
  { id: 'edu',     name: '교육',      icon: '🎓', kind: 'build', cats: ['edu'] },
  { id: 'park',    name: '공원',      icon: '🌳', kind: 'build', cats: ['park'] },
  { id: 'transp',  name: '교통',      icon: '🚌', kind: 'build', cats: ['transport'] },
  { id: 'admin',   name: '통신·행정', icon: '🏛️', kind: 'build', cats: ['comm', 'gov'] },
  { id: 'unique',  name: '시그니처',  icon: '⭐', kind: 'build', cats: ['unique'] },
  { id: 'sector',  name: '구역 확장', icon: '🗺️', kind: 'sector' },
  { id: 'demolish',name: '철거',      icon: '💥', kind: 'bulldoze' },
];

/** 밀도별 구역 수요 막대 구성 */
const RCI_GROUPS = [
  { g: 'res', cap: '주거', bars: [
    { k: 'resLow',  label: '저', zone: 1 },
    { k: 'resMed',  label: '중', zone: 2 },
    { k: 'resHigh', label: '고', zone: 3 }] },
  { g: 'com', cap: '상업', bars: [
    { k: 'comLow',  label: '저', zone: 4 },
    { k: 'comHigh', label: '고', zone: 5 }] },
  { g: 'ind', cap: '산업', bars: [{ k: 'ind', label: '산', zone: 6 }] },
  { g: 'off', cap: '사무', bars: [{ k: 'off', label: '사', zone: 7 }] },
];

/** 상단 인프라 미니 게이지 */
const INFRA = [
  { k: 'power',   icon: '⚡', name: '전력' },
  { k: 'water',   icon: '💧', name: '상수도' },
  { k: 'sewage',  icon: '🚽', name: '하수 처리' },
  { k: 'garbage', icon: '🗑️', name: '쓰레기 처리' },
  { k: 'traffic', icon: '🚗', name: '교통 흐름' },
];

const MENUS = [
  { id: 'budget', icon: '💵', name: '예산 (B)' },
  { id: 'stats',  icon: '📊', name: '통계 (T)' },
  { id: 'miles',  icon: '🏆', name: '마일스톤 (M)' },
  { id: 'policy', icon: '📜', name: '정책 (P)' },
  { id: 'dev',    icon: '🔬', name: '개발 트리 (R)' },
  { id: 'save',   icon: '💾', name: '저장/불러오기' },
  { id: 'help',   icon: '❓', name: '도움말 (H)' },
];

export class UI {
  constructor(game) {
    this.g = game;
    this.openGroup = null;
    this.notifShown = 0;
    this.toasts = [];
    this.mmCanvas = $('#minimap');
    this.mmCtx = this.mmCanvas.getContext('2d');
    this.mmTimer = 0;
    this.modal = null;
  }

  // =========================================================================
  build() {
    this.buildRci();
    this.buildInfra();
    this.buildToolbar();
    this.buildOverlayBar();
    this.buildMenus();
    this.bindGlobal();
  }

  buildRci() {
    const root = $('#rci');
    root.innerHTML = '';
    for (const grp of RCI_GROUPS) {
      const g = el('div', 'rci-group');
      g.dataset.g = grp.g;
      const bars = el('div', 'rci-bars');
      for (const b of grp.bars) {
        const bar = el('div', 'rci-bar', `<div class="rci-fill"></div><span>${b.label}</span>`);
        bar.dataset.k = b.k;
        bar.dataset.zone = b.zone;
        bars.appendChild(bar);
      }
      g.appendChild(bars);
      g.appendChild(el('div', 'rci-cap', grp.cap));
      root.appendChild(g);
    }
  }

  buildInfra() {
    const root = $('#infra');
    if (!root) return;
    root.innerHTML = '';
    for (const m of INFRA) {
      const e = el('div', 'mini', `<span class="mi">${m.icon}</span><span class="mb"><div></div></span>`);
      e.dataset.k = m.k;
      root.appendChild(e);
    }
  }

  updateRci() {
    const w = this.g.world, c = w.city;
    document.querySelectorAll('.rci-bar').forEach(bar => {
      const k = bar.dataset.k, zone = +bar.dataset.zone;
      const zd = ZONE_DEF[zone];
      const locked = c.milestone < (zd.unlock || 0);
      const v = locked ? 0 : clamp(c.demand[k] || 0, 0, 100);
      bar.querySelector('.rci-fill').style.height = v + '%';
      bar.classList.toggle('locked', locked);
      const cap = (c.zoneCap && c.zoneCap[zone]) || 0;
      const occ = (c.zoneOcc && c.zoneOcc[zone]) || 0;
      bar.dataset.tip = locked
        ? `<b>${zd.name}</b><br>🔒 마일스톤 「${MILESTONES[zd.unlock].name}」에서 해금`
        : `<b>${zd.name}</b><br>수요 ${Math.round(v)} / 100<br>` +
          `${zd.cat === 'res' ? '거주' : '고용'} ${fmtInt(occ)} / ${fmtInt(cap)}` +
          (cap > 0 ? ` (공실 ${Math.round((1 - occ / cap) * 100)}%)` : '') +
          `<br>${v > 60 ? '수요가 높습니다 — 구역을 더 지정하세요' :
                v > 25 ? '완만한 수요' : '수요가 거의 없습니다'}`;
    });
  }

  updateInfra() {
    const c = this.g.world.city;
    const vals = {
      power:   { r: c.power.demand > 0 ? c.power.ratio : 1,
                 tip: `공급 ${c.power.supply.toFixed(1)} / 수요 ${c.power.demand.toFixed(1)} MW` },
      water:   { r: c.water.demand > 0 ? c.water.ratio : 1,
                 tip: `공급 ${c.water.supply.toFixed(1)} / 수요 ${c.water.demand.toFixed(1)}` },
      sewage:  { r: c.sewage.produced > 0 ? c.sewage.ratio : 1,
                 tip: `처리 용량 ${c.sewage.capacity.toFixed(1)} / 발생 ${c.sewage.produced.toFixed(1)}` },
      garbage: { r: Math.min(c.garbage.produced > 0 ? c.garbage.ratio : 1, 1 - (c.garbage.full || 0)),
                 tip: `처리 ${c.garbage.capacity.toFixed(0)} / 발생 ${c.garbage.produced.toFixed(1)}` +
                      `<br>매립 적재율 ${Math.round((c.garbage.full || 0) * 100)}%` },
      traffic: { r: (c.trafficFlow || 100) / 100,
                 tip: `교통 흐름 ${c.trafficFlow}%<br>대중교통 분담률 ${Math.round((c.transitShare || 0) * 100)}%` },
    };
    document.querySelectorAll('#infra .mini').forEach(e => {
      const k = e.dataset.k, v = vals[k];
      if (!v) return;
      const r = clamp01(v.r);
      const bar = e.querySelector('.mb > div');
      bar.style.width = (r * 100).toFixed(0) + '%';
      bar.style.background = r >= 0.98 ? '#5fd68a' : r >= 0.75 ? '#f5c04a' : '#ff6a5c';
      e.classList.toggle('crit', r < 0.75);
      const info = INFRA.find(x => x.k === k);
      e.dataset.tip = `<b>${info.name}</b> ${Math.round(r * 100)}%<br>${v.tip}`;
    });
  }

  buildToolbar() {
    const bar = $('#toolbar');
    bar.innerHTML = '';
    for (const t of TOOL_GROUPS) {
      const b = el('button', 'tool', `<span class="ti">${t.icon}</span><span>${t.name}</span>`);
      b.dataset.id = t.id;
      b.onclick = () => this.selectGroup(t.id);
      bar.appendChild(b);
    }
  }

  buildOverlayBar() {
    const bar = $('#overlayBar');
    bar.innerHTML = '';
    for (const [k, o] of Object.entries(OVERLAYS)) {
      const b = el('button', 'ov-btn' + (k === 'none' ? ' active' : ''),
        `<span class="oi">${o.icon}</span><span>${o.name}</span>`);
      b.dataset.k = k;
      b.onclick = () => {
        this.g.renderer.setOverlay(k);
        bar.querySelectorAll('.ov-btn').forEach(x => x.classList.toggle('active', x.dataset.k === k));
      };
      bar.appendChild(b);
    }
  }

  buildMenus() {
    const right = document.querySelector('.tb-right');
    const box = el('div', 'tb-menu');
    box.style.cssText = 'display:flex;gap:3px';
    const dn = el('button', 'spd', '🌗');
    dn.id = 'btnDayNight';
    dn.style.cssText = 'font-size:14px;padding:5px 8px';
    dn.title = '낮/밤 전환 (자동 · 낮 고정 · 밤 고정)';
    dn.onclick = () => this.g.cycleDayNight();
    box.appendChild(dn);
    for (const m of MENUS) {
      const b = el('button', 'spd', m.icon);
      b.style.cssText = 'font-size:14px;padding:5px 8px';
      b.title = m.name;
      b.onclick = () => this.openModal(m.id);
      box.appendChild(b);
    }
    right.insertBefore(box, right.firstChild);
  }

  bindGlobal() {
    $('#cityName').onclick = () => {
      const n = prompt('도시 이름', this.g.world.city.name);
      if (n) { this.g.world.city.name = n.slice(0, 24); this.update(true); }
    };
    document.querySelectorAll('.spd[data-speed]').forEach(b => {
      b.onclick = () => this.g.setSpeed(+b.dataset.speed);
    });
    document.querySelectorAll('[data-close]').forEach(b => {
      b.onclick = () => $('#' + b.dataset.close).classList.add('hidden');
    });
    this.mmCanvas.onclick = e => {
      const r = this.mmCanvas.getBoundingClientRect();
      const tx = ((e.clientX - r.left) / r.width) * MAP_W;
      const ty = ((e.clientY - r.top) / r.height) * MAP_H;
      this.g.renderer.cam.centerOn(tx, ty);
    };
    // 툴팁
    const tip = $('#tooltip');
    document.addEventListener('mouseover', e => {
      const t = e.target.closest('[data-tip]');
      if (!t) { tip.classList.add('hidden'); return; }
      tip.innerHTML = t.dataset.tip;
      tip.classList.remove('hidden');
      const r = t.getBoundingClientRect();
      tip.style.left = Math.min(window.innerWidth - 280, r.left) + 'px';
      tip.style.top = Math.max(4, r.top - tip.offsetHeight - 8) + 'px';
    });
    document.addEventListener('mouseout', e => {
      if (e.target.closest('[data-tip]')) $('#tooltip').classList.add('hidden');
    });
  }

  // =========================================================================
  //  툴 선택
  // =========================================================================
  selectGroup(id) {
    const g = this.g;
    const t = TOOL_GROUPS.find(x => x.id === id);
    if (!t) return;
    if (this.openGroup === id) { this.closePalette(); return; }
    this.openGroup = id;
    document.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.id === id));

    if (t.kind === 'select') { g.setTool({ type: 'select' }); this.closePalette(false); return; }
    if (t.kind === 'bulldoze') { g.setTool({ type: 'bulldoze' }); this.closePalette(false); return; }
    if (t.kind === 'sector') { g.setTool({ type: 'sector' }); this.closePalette(false); return; }
    this.showPalette(t);
  }

  closePalette(clearActive = true) {
    $('#palette').classList.add('hidden');
    if (clearActive) {
      this.openGroup = null;
      document.querySelectorAll('.tool').forEach(b => b.classList.remove('active'));
    }
  }

  showPalette(t) {
    const g = this.g, w = g.world;
    const p = $('#palette');
    p.innerHTML = '';
    p.classList.remove('hidden');

    const mk = (icon, name, sub, active, locked, tip, onclick) => {
      const b = el('button', 'pal-item' + (active ? ' active' : '') + (locked ? ' locked' : ''),
        `<span class="pi-ico">${icon}</span><span><span class="pi-name">${name}</span><br>
         <span class="pi-sub">${sub}</span></span>`);
      if (tip) b.dataset.tip = tip;
      b.onclick = () => { if (!locked) { onclick(); this.showPalette(t); } };
      p.appendChild(b);
    };

    if (t.kind === 'road') {
      ROADS.forEach((r, i) => {
        const locked = !roadAvailable(w, i);
        mk('🛣️', r.name,
           locked ? `🔒 ${MILESTONES[r.unlock].name}` : `₡${r.cost}/칸 · 유지 ₡${r.upkeep}`,
           g.tool.type === 'road' && g.tool.roadType === i, locked,
           `<b>${r.name}</b><br>통행 용량: ${fmtInt(r.cap)}<br>속도 계수: ${r.speed}×<br>
            소음: ${r.noise}<br>${r.noZone ? '구역 지정 불가 (고속도로)' : '양옆 구역 개발 가능'}`,
           () => g.setTool({ type: 'road', roadType: i }));
      });
      mk('❌', '도로 철거', 'Shift+드래그로도 가능',
         g.tool.type === 'roadRemove', false, '드래그하여 도로를 철거합니다.',
         () => g.setTool({ type: 'roadRemove' }));
    }

    if (t.kind === 'zone') {
      for (const z of ZONE_DEF) {
        if (!z.id) continue;
        const locked = !zoneAvailable(w, z.id);
        mk('▦', z.name,
           locked ? `🔒 ${MILESTONES[z.unlock].name}` : `₡${z.cost}/칸 · ${z.size}×${z.size}`,
           g.tool.type === 'zone' && g.tool.zone === z.id, locked,
           `<b>${z.name}</b><br>최대 수용: ${z.cap[4]} (레벨5)<br>
            건물 크기: ${z.size}×${z.size}<br>도로에서 4칸 이내에만 개발됩니다.`,
           () => g.setTool({ type: 'zone', zone: z.id }));
      }
      mk('🧹', '구역 해제', '지정된 용도를 제거',
         g.tool.type === 'zone' && g.tool.zone === 0, false, null,
         () => g.setTool({ type: 'zone', zone: 0 }));
    }

    if (t.kind === 'build') {
      for (const cat of t.cats) {
        const list = BUILDINGS.filter(b => b.cat === cat);
        if (!list.length) continue;
        if (t.cats.length > 1) p.appendChild(el('div', 'pal-group', CATEGORY_INFO[cat].name));
        for (const d of list) {
          const ms = w.city.milestone >= d.unlock;
          const needDp = d.dp && !w.city.devSpent[d.id];
          const avail = buildingAvailable(w, d.id);
          const locked = !avail;
          let sub;
          if (!ms) sub = `🔒 ${MILESTONES[d.unlock].name}`;
          else if (needDp) sub = `🔬 개발 포인트 ${d.dp}`;
          else if (d.unique && !avail) sub = '이미 건설됨';
          else if (d.requires === 'bus' && !avail) sub = '버스 차고지 필요';
          else sub = `${fmtMoney(d.cost)} · 유지 ₡${d.upkeep}`;
          mk(d.icon, d.name, sub, g.tool.type === 'build' && g.tool.defId === d.id, locked,
             buildingTip(d), () => g.setTool({ type: 'build', defId: d.id }));
        }
      }
    }
  }

  // =========================================================================
  //  매 프레임 갱신
  // =========================================================================
  update(force) {
    const g = this.g, w = g.world, c = w.city;

    // 상단 통계
    const net = c.lastMonth.net || 0;
    setStat('#stat-cash', fmtMoney(c.cash), (net >= 0 ? '+' : '') + fmtShort(net) + '/월', c.cash < 0);
    setStat('#stat-pop', fmtInt(c.population), '/' + fmtShort(c.resCapacity || 0));
    setStat('#stat-happy', Math.round(c.happiness), happyFace(c.happiness), c.happiness < 40);
    setStat('#stat-jobs', c.unemployment.toFixed(0) + '%', '실업', c.unemployment > 20);
    this.updateInfra();

    $('#dateLabel').textContent = `${c.year}년 ${c.month}월 ${c.day}일 · ${g.renderer.clockLabel()}`;
    const dnBtn = document.getElementById('btnDayNight');
    if (dnBtn) {
      const m = g.renderer.dayNightMode;
      dnBtn.textContent = m === 'day' ? '☀️' : m === 'night' ? '🌙' : '🌗';
      dnBtn.classList.toggle('active', m !== 'auto');
    }
    $('#cityName').textContent = c.name;
    $('#milestoneName').textContent = `${MILESTONES[c.milestone].name} · Lv.${c.milestone}`;

    const prog = milestoneProgress(w);
    $('#xpFill').style.width = (prog * 100).toFixed(1) + '%';
    const nx = nextMilestone(w);
    $('#xpLabel').textContent = nx ? `XP ${fmtShort(c.xp)}/${fmtShort(nx.xp)}` : `XP ${fmtShort(c.xp)}`;
    $('#dpLabel').textContent = '🔬 ' + c.devPoints;
    $('#permitLabel').textContent = '🗺️ ' + c.permits;

    this.updateRci();

    // 속도 버튼
    document.querySelectorAll('.spd[data-speed]').forEach(b => {
      b.classList.toggle('active', +b.dataset.speed === g.speed);
    });

    this.updateNotifications();
    if (g.selected && g.selected.slot !== undefined && w.buildings[g.selected.slot] !== g.selected) {
      g.selected = null; $('#infoPanel').classList.add('hidden');
    }
    if (g.selected) this.renderInfo(g.selected);
  }

  updateMinimap() {
    const w = this.g.world, ctx = this.mmCtx;
    const S = this.mmCanvas.width / MAP_W;
    ctx.fillStyle = '#0d1219';
    ctx.fillRect(0, 0, this.mmCanvas.width, this.mmCanvas.height);
    const img = ctx.createImageData(MAP_W, MAP_H);
    const d = img.data;
    for (let i = 0; i < MAP_W * MAP_H; i++) {
      let r, g, b;
      const s = Math.floor((i / MAP_W | 0) / SECTOR) * SECTORS_X + Math.floor((i % MAP_W) / SECTOR);
      if (w.water[i]) { r = 30; g = 70; b = 105; }
      else if (w.road[i]) { r = 90; g = 92; b = 100; }
      else if (w.bidx[i]) {
        const bd = w.buildings[w.bidx[i] - 1];
        if (bd && bd.kind === 'growth') {
          const zc = ZONE_DEF[bd.zone];
          const cat = zc.cat;
          if (cat === 'res') { r = 78; g = 200; b = 99; }
          else if (cat === 'com') { r = 87; g = 166; b = 245; }
          else if (cat === 'ind') { r = 230; g = 169; b = 44; }
          else { r = 138; g = 106; b = 232; }
        } else { r = 220; g = 220; b = 225; }
      } else if (w.zone[i]) { r = 60; g = 80; b = 70; }
      else if (w.tree[i]) { r = 40; g = 78; b = 42; }
      else { const h = w.height[i]; r = 60 + h * 60; g = 95 + h * 45; b = 55 + h * 40; }
      if (!w.sectorOwned[s]) { r *= 0.35; g *= 0.35; b *= 0.42; }
      const o = i * 4;
      d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
    }
    const tmp = document.createElement('canvas');
    tmp.width = MAP_W; tmp.height = MAP_H;
    tmp.getContext('2d').putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, this.mmCanvas.width, this.mmCanvas.height);

    // 시야 사각형
    const cam = this.g.renderer.cam;
    const b = cam.visibleBounds(0);
    ctx.strokeStyle = 'rgba(255,255,255,.8)';
    ctx.lineWidth = 1;
    ctx.strokeRect(b.x0 * S, b.y0 * S, (b.x1 - b.x0) * S, (b.y1 - b.y0) * S);
  }

  updateNotifications() {
    const list = this.g.world.city.notifications;
    const box = $('#notifs');
    while (this.notifShown < list.length) {
      const n = list[this.notifShown++];
      const t = el('div', 'notif ' + (n.type || ''),
        `${n.text}${n.count > 1 ? `<span class="n-count">×${n.count}</span>` : ''}`);
      if (n.x !== undefined) t.onclick = () => this.g.renderer.cam.centerOn(n.x, n.y);
      box.appendChild(t);
      const life = n.type === 'danger' ? 14000 : 9000;
      setTimeout(() => { t.style.transition = 'opacity .4s'; t.style.opacity = '0';
        setTimeout(() => t.remove(), 400); }, life);
      while (box.children.length > 5) box.firstChild.remove();
    }
  }

  // =========================================================================
  //  정보 패널
  // =========================================================================
  renderInfo(b) {
    const w = this.g.world;
    const panel = $('#infoPanel'), body = $('#infoBody');
    panel.classList.remove('hidden');
    const d = defOf(b);
    if (!d) { panel.classList.add('hidden'); return; }

    const rows = [];
    const row = (k, v) => rows.push(`<div class="p-row"><span>${k}</span><span>${v}</span></div>`);
    const chip = (ok, txt) => `<span class="chip ${ok ? 'ok' : 'bad'}">${ok ? '✔' : '✘'} ${txt}</span>`;

    let title, sub;
    if (b.kind === 'growth') {
      title = `${d.name} <span style="font-size:11px;color:#93a2b5">Lv.${b.level}</span>`;
      sub = b.abandoned ? (b.burnt ? '🔥 화재로 소실됨' : '🏚️ 버려진 건물')
        : b.progress < 1 ? '🚧 건설 중' : `${b.x},${b.y} · ${b.w}×${b.h}`;
      if (d.cat === 'res') {
        row('거주민', `${Math.round(b.residents)} / ${d.cap[b.level - 1]}`);
      } else {
        row('일자리', `${Math.round(b.filled)} / ${d.cap[b.level - 1]}`);
      }
      row('만족도', `${Math.round(b.happiness)} ${happyFace(b.happiness)}`);
      row('토지가치', Math.round(sampleField(w, w.f.land, b)));
      const nextReq = d.lvReq[b.level];
      if (b.level < 5) row('다음 레벨 요구 토지가치', nextReq);
    } else {
      title = `${d.icon} ${d.name}`;
      sub = `${CATEGORY_INFO[d.cat]?.name || d.cat} · ${b.x},${b.y} · ${b.w}×${b.h}`;
      row('건설비', fmtMoney(d.cost));
      row('월 유지비', fmtMoney(d.upkeep * (w.city.budget[budgetKeyOfCat(d.cat)] ?? 1)));
      if (d.power) row('발전량', d.power.toFixed(1) + ' MW');
      if (d.water) row('급수량', d.water.toFixed(1));
      if (d.sewage) row('하수 처리', d.sewage.toFixed(1));
      if (d.garbage) row('쓰레기 처리', d.garbage + '/월');
      if (d.svc) {
        row('서비스 반경', d.svc.radius + '칸');
        if (d.svc.capacity < 1e8) row('수용 인원', fmtInt(d.svc.capacity));
      }
      if (d.jobs) row('일자리', d.jobs);
      if (d.tourism) row('관광 유치', fmtInt(d.tourism));
      if (d.link) row('전력 연결 반경', d.link + '칸');
    }

    const statusChips = [];
    if (!d.noRoad) statusChips.push(chip(b.compId >= 0, '도로 연결'));
    if (b.kind === 'growth' || (d.power === undefined)) statusChips.push(chip(b.powered, '전력'));
    statusChips.push(chip(b.watered, '상수도'));
    statusChips.push(chip(b.sewered, '하수'));

    let extra = '';
    if (b.kind === 'growth' && !b.abandoned) {
      const f = w.f;
      const bars = [
        ['치안', Math.min(sampleField(w, f.police, b), 1)],
        ['소방', Math.min(sampleField(w, f.fire, b), 1)],
        ['의료', Math.min(sampleField(w, f.health, b), 1)],
        ['교육', Math.min((sampleField(w, f.edu1, b) + sampleField(w, f.edu2, b) + sampleField(w, f.edu3, b)) / 3, 1)],
        ['공원', Math.min(sampleField(w, f.park, b), 1)],
        ['대중교통', Math.min(sampleField(w, f.transit, b), 1)],
      ];
      extra += '<div class="p-sec">서비스 도달률</div>';
      for (const [n, v] of bars) {
        extra += `<div style="font-size:11px;display:flex;justify-content:space-between">
          <span>${n}</span><span>${Math.round(v * 100)}%</span></div>
          <div class="meter"><div style="width:${v * 100}%;background:${v > .6 ? '#5fd68a' : v > .3 ? '#f5c04a' : '#ff6a5c'}"></div></div>`;
      }
      const negs = [
        ['지상 오염', sampleField(w, f.ground, b)],
        ['대기 오염', sampleField(w, f.air, b)],
        ['소음', sampleField(w, f.noise, b)],
        ['범죄', sampleField(w, f.crime, b)],
      ];
      extra += '<div class="p-sec">환경 문제</div>';
      for (const [n, v] of negs) {
        extra += `<div style="font-size:11px;display:flex;justify-content:space-between">
          <span>${n}</span><span>${Math.round(v)}</span></div>
          <div class="meter"><div style="width:${clamp(v, 0, 100)}%;background:${v > 55 ? '#ff6a5c' : v > 25 ? '#f5c04a' : '#5fd68a'}"></div></div>`;
      }
    }

    body.innerHTML = `
      <div class="p-title">${title}</div>
      <div class="p-sub">${sub}</div>
      <div>${statusChips.join('')}</div>
      ${rows.join('')}
      ${extra}
      <div style="margin-top:14px;display:flex;gap:6px">
        <button class="btn danger" id="btnDemolish">철거</button>
        <button class="btn" id="btnCenter">위치로 이동</button>
      </div>`;
    $('#btnDemolish').onclick = () => { this.g.demolishBuilding(b); panel.classList.add('hidden'); };
    $('#btnCenter').onclick = () => this.g.renderer.cam.centerOn(b.x + b.w / 2, b.y + b.h / 2);
  }

  renderTileInfo(x, y) {
    const w = this.g.world, i = idx(x, y), f = w.f;
    const panel = $('#infoPanel'), body = $('#infoBody');
    panel.classList.remove('hidden');
    const rd = w.road[i] ? ROADS[w.road[i] - 1] : null;
    const rows = [];
    const row = (k, v) => rows.push(`<div class="p-row"><span>${k}</span><span>${v}</span></div>`);
    row('좌표', `${x}, ${y}`);
    row('지형', w.water[i] ? '수역' : w.tree[i] ? '수목' : '지면');
    row('고도', (w.height[i] * 100).toFixed(0));
    if (w.resource[i]) row('자연 자원', ['','비옥한 땅','삼림','광물','석유'][w.resource[i]]);
    if (rd) {
      row('도로', rd.name);
      row('통행량', `${fmtInt(f.traffic[i])} / ${fmtInt(rd.cap)}`);
      row('혼잡도', Math.round(clamp01(f.traffic[i] / rd.cap) * 100) + '%');
    }
    if (w.zone[i]) row('용도지역', ZONE_DEF[w.zone[i]].name);
    row('토지가치', Math.round(f.land[i]));
    row('지상 오염', Math.round(f.ground[i]));
    row('대기 오염', Math.round(f.air[i]));
    row('소음', Math.round(f.noise[i]));
    row('범죄', Math.round(f.crime[i]));
    body.innerHTML = `<div class="p-title">타일 정보</div><div class="p-sub">지형 및 환경 지표</div>${rows.join('')}`;
  }

  // =========================================================================
  //  모달
  // =========================================================================
  openModal(kind) {
    this.closeModal();
    const back = el('div', 'modal-back');
    const m = el('div', 'modal');
    m.style.position = 'relative';
    const close = el('button', 'modal-close btn', '✕');
    close.onclick = () => this.closeModal();
    m.appendChild(close);
    back.appendChild(m);
    back.onclick = e => { if (e.target === back) this.closeModal(); };
    $('#modalRoot').appendChild(back);
    this.modal = back;
    this.modalKind = kind;

    const body = el('div');
    m.appendChild(body);
    switch (kind) {
      case 'budget': this.mBudget(body); break;
      case 'stats': this.mStats(body); break;
      case 'miles': this.mMilestones(body); break;
      case 'policy': this.mPolicies(body); break;
      case 'dev': this.mDev(body); break;
      case 'save': this.mSave(body); break;
      default: this.mHelp(body);
    }
  }

  closeModal() {
    if (this.modal) { this.modal.remove(); this.modal = null; this.modalKind = null; }
  }
  refreshModal() { if (this.modalKind) this.openModal(this.modalKind); }

  // --- 예산 ---------------------------------------------------------------
  mBudget(root) {
    const w = this.g.world, c = w.city, lm = c.lastMonth, dt = lm.detail || {};
    const upkeep = dt.upkeep || {};
    const upTotal = Object.values(upkeep).reduce((a, b) => a + b, 0);

    root.innerHTML = `<h2>💵 예산</h2><div class="m-sub">세율과 서비스 예산을 조절해 재정을 관리하세요.</div>`;
    const grid = el('div', 'grid2');
    root.appendChild(grid);

    // 좌: 손익계산서
    const left = el('div');
    left.innerHTML = `<div class="p-sec">지난 달 손익</div>
      <table class="budget">
        <tr><td>주거 세수</td><td class="pos">${fmtMoney(dt.taxRes || 0)}</td></tr>
        <tr><td>상업 세수</td><td class="pos">${fmtMoney(dt.taxCom || 0)}</td></tr>
        <tr><td>산업 세수</td><td class="pos">${fmtMoney(dt.taxInd || 0)}</td></tr>
        <tr><td>사무 세수</td><td class="pos">${fmtMoney(dt.taxOff || 0)}</td></tr>
        <tr><td>공공요금</td><td class="pos">${fmtMoney(dt.fees || 0)}</td></tr>
        <tr><td>관광 수입</td><td class="pos">${fmtMoney(dt.tourism || 0)}</td></tr>
        <tr class="total"><td>수입 합계</td><td class="pos">${fmtMoney(lm.income || 0)}</td></tr>
        ${Object.entries(upkeep).map(([k, v]) =>
          `<tr><td>${CATEGORY_INFO[k]?.name || k} 유지비</td><td class="neg">-${fmtMoney(v)}</td></tr>`).join('')}
        <tr><td>도로 유지비</td><td class="neg">-${fmtMoney(dt.road || 0)}</td></tr>
        <tr><td>정책 비용</td><td class="neg">-${fmtMoney(dt.policy || 0)}</td></tr>
        <tr><td>대출 이자</td><td class="neg">-${fmtMoney(dt.interest || 0)}</td></tr>
        <tr class="total"><td>지출 합계</td><td class="neg">-${fmtMoney(lm.expense || 0)}</td></tr>
        <tr class="total"><td>월 순수지</td>
          <td class="${(lm.net || 0) >= 0 ? 'pos' : 'neg'}">${fmtMoney(lm.net || 0)}</td></tr>
      </table>
      <div class="p-sec">대출</div>
      <div class="p-row"><span>현재 대출</span><span>${fmtMoney(c.loan)} / ${fmtMoney(loanLimit(w))}</span></div>
      <div class="p-row"><span>월 이자율</span><span>${(ECON.loanInterest * 100).toFixed(1)}%</span></div>
      <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn" data-loan="50000">₡50,000 대출</button>
        <button class="btn" data-loan="200000">₡200,000 대출</button>
        <button class="btn" data-repay="1">전액 상환</button>
      </div>`;
    grid.appendChild(left);

    // 우: 세율/예산/요금
    const right = el('div');
    right.innerHTML = `<div class="p-sec">세율</div><div id="taxRows"></div>
      <div class="p-sec">공공요금 (요금이 높으면 만족도 하락)</div><div id="feeRows"></div>
      <div class="p-sec">서비스 예산 (예산이 높을수록 성능 향상)</div><div id="budRows"></div>`;
    grid.appendChild(right);

    const sliders = (host, obj, defs, fmt, min, max, step) => {
      for (const [key, label] of defs) {
        const r = el('div', 'slider-row');
        r.innerHTML = `<label>${label}</label>
          <input type="range" min="${min}" max="${max}" step="${step}" value="${obj[key]}">
          <span class="sv">${fmt(obj[key])}</span>`;
        const inp = r.querySelector('input'), sv = r.querySelector('.sv');
        inp.oninput = () => { obj[key] = +inp.value; sv.textContent = fmt(+inp.value); };
        host.appendChild(r);
      }
    };
    sliders(right.querySelector('#taxRows'), c.tax,
      [['res', '주거'], ['com', '상업'], ['ind', '산업'], ['off', '사무']],
      v => v + '%', 0, ECON.taxMax, 1);
    sliders(right.querySelector('#feeRows'), c.fees,
      [['power', '전기 요금'], ['water', '수도 요금'], ['garbage', '쓰레기 수수료']],
      v => (+v).toFixed(1) + '×', 0, ECON.feeMax, 0.1);
    sliders(right.querySelector('#budRows'), c.budget,
      [['police', '경찰'], ['fire', '소방'], ['health', '의료'], ['edu', '교육'],
       ['park', '공원'], ['garbage', '폐기물'], ['transport', '교통'], ['road', '도로']],
      v => Math.round(v * 100) + '%', 0.5, 1.5, 0.05);

    left.querySelectorAll('[data-loan]').forEach(b => b.onclick = () => {
      const got = takeLoan(w, +b.dataset.loan);
      if (!got) alert('대출 한도를 초과했습니다.');
      this.refreshModal();
    });
    left.querySelector('[data-repay]').onclick = () => { repayLoan(w, w.city.loan); this.refreshModal(); };
  }

  // --- 통계 ---------------------------------------------------------------
  mStats(root) {
    const w = this.g.world, c = w.city, h = c.history;
    root.innerHTML = `<h2>📊 도시 통계</h2><div class="m-sub">${c.name} · ${MILESTONES[c.milestone].name}</div>`;

    const kpi = el('div', 'grid3');
    const card = (t, v, s) => `<div style="padding:11px;border:1px solid var(--line);border-radius:9px">
      <div style="font-size:11px;color:var(--txt-dim)">${t}</div>
      <div style="font-size:19px;font-weight:700">${v}</div>
      <div style="font-size:11px;color:var(--txt-dim)">${s || ''}</div></div>`;
    kpi.innerHTML =
      card('인구', fmtInt(c.population), `수용 ${fmtInt(c.resCapacity || 0)} · 가구 ${fmtInt(c.households)}`) +
      card('만족도', Math.round(c.happiness), happyFace(c.happiness)) +
      card('실업률', c.unemployment.toFixed(1) + '%', `일자리 ${fmtInt(c.jobsFilled)}/${fmtInt(c.jobs)}`) +
      card('교통 흐름', c.trafficFlow + '%', `대중교통 분담 ${Math.round((c.transitShare || 0) * 100)}%`) +
      card('건강', c.health, `범죄 지수 ${Math.round(c.crime)}`) +
      card('관광객', fmtInt(c.tourists), '월 방문') +
      card('주거 수요', `저${Math.round(c.demand.resLow)} 중${Math.round(c.demand.resMed)} 고${Math.round(c.demand.resHigh)}`,
           `평균 토지가치 ${Math.round(c.avgLand || 0)}`) +
      card('상업·산업·사무', `저${Math.round(c.demand.comLow)} 고${Math.round(c.demand.comHigh)} · 산${Math.round(c.demand.ind)} · 사${Math.round(c.demand.off)}`,
           '구역 수요');
    root.appendChild(kpi);

    const mkChart = (title, series, colors, labels, maxHint) => {
      const box = el('div');
      box.innerHTML = `<div class="p-sec">${title}</div><canvas class="chart"></canvas>
        <div class="legend">${labels.map((l, i) =>
          `<span><i style="background:${colors[i]}"></i>${l}</span>`).join('')}</div>`;
      root.appendChild(box);
      const cv = box.querySelector('canvas');
      requestAnimationFrame(() => drawChart(cv, series, colors, maxHint));
    };
    mkChart('인구 추이', [h.population || []], ['#49b8ff'], ['인구']);
    mkChart('재정 (월)', [h.income || [], h.expense || []], ['#5fd68a', '#ff6a5c'], ['수입', '지출']);
    mkChart('만족도 · 교통 · 실업률', [h.happiness || [], h.traffic || [], h.unemployment || []],
      ['#ffd452', '#49b8ff', '#ff8a5c'], ['만족도', '교통 흐름', '실업률'], 100);
    mkChart('주거 수요 (밀도별)',
      [h.demandResLow || [], h.demandResMed || [], h.demandResHigh || []],
      ['#4ec863', '#38ad4f', '#1f8f3d'], ['저밀도', '중밀도', '고밀도'], 100);
    mkChart('상업·산업·사무 수요',
      [h.demandCom || [], h.demandInd || [], h.demandOff || []],
      ['#57a6f5', '#e6a92c', '#8a6ae8'], ['상업', '산업', '사무'], 100);

    const demo = el('div');
    const ag = c.ageGroups, ed = c.education;
    const pct = (v) => c.population > 0 ? ((v / c.population) * 100).toFixed(1) + '%' : '0%';
    demo.innerHTML = `<div class="p-sec">인구 구조</div>
      <div class="grid2">
        <table class="budget">
          <tr><td>유아·아동</td><td>${fmtInt(ag.child)} (${pct(ag.child)})</td></tr>
          <tr><td>청소년</td><td>${fmtInt(ag.teen)} (${pct(ag.teen)})</td></tr>
          <tr><td>성인</td><td>${fmtInt(ag.adult)} (${pct(ag.adult)})</td></tr>
          <tr><td>노인</td><td>${fmtInt(ag.senior)} (${pct(ag.senior)})</td></tr>
        </table>
        <table class="budget">
          <tr><td>저학력</td><td>${fmtInt(ed.low)} (${pct(ed.low)})</td></tr>
          <tr><td>중학력</td><td>${fmtInt(ed.mid)} (${pct(ed.mid)})</td></tr>
          <tr><td>고학력</td><td>${fmtInt(ed.high)} (${pct(ed.high)})</td></tr>
          <tr><td>노동인구</td><td>${fmtInt(c.workforce || 0)}</td></tr>
        </table>
      </div>
      <div class="p-sec">인프라</div>
      <table class="budget">
        <tr><td>전력</td><td>${c.power.supply.toFixed(1)} / ${c.power.demand.toFixed(1)} MW</td></tr>
        <tr><td>상수도</td><td>${c.water.supply.toFixed(1)} / ${c.water.demand.toFixed(1)}</td></tr>
        <tr><td>하수 처리</td><td>${c.sewage.capacity.toFixed(1)} / ${c.sewage.produced.toFixed(1)}</td></tr>
        <tr><td>쓰레기 처리</td><td>${c.garbage.capacity.toFixed(1)} / ${c.garbage.produced.toFixed(1)}
          (매립 ${Math.round((c.garbage.full || 0) * 100)}%)</td></tr>
        <tr><td>도로</td><td>${fmtInt(c.stats.roadTiles)}칸</td></tr>
      </table>`;
    root.appendChild(demo);
  }

  // --- 마일스톤 ------------------------------------------------------------
  mMilestones(root) {
    const w = this.g.world, c = w.city;
    root.innerHTML = `<h2>🏆 마일스톤</h2>
      <div class="m-sub">확장 포인트(XP)는 인구 증가와 시민 만족, 그리고 도시 건설 활동으로 얻습니다.
      현재 <b>${fmtInt(c.xp)} XP</b> · 개발 포인트 <b>${c.devPoints}</b> · 확장 허가증 <b>${c.permits}</b></div>`;
    const list = el('div');
    MILESTONES.forEach((m, i) => {
      const done = c.milestone >= i, cur = c.milestone + 1 === i;
      const unlocks = [
        ...BUILDINGS.filter(b => b.unlock === i).map(b => b.name),
        ...ZONE_DEF.filter(z => z.id > 0 && z.unlock === i).map(z => z.name),
        ...ROADS.filter(r => r.unlock === i).map(r => r.name),
      ];
      const it = el('div', 'ms-item' + (done ? ' done' : cur ? ' cur' : ''));
      it.innerHTML = `<div class="ms-num">${i}</div>
        <div style="flex:1">
          <div style="font-weight:700">${m.name} <span style="font-size:11px;color:var(--txt-dim)">${m.en}</span></div>
          <div style="font-size:11px;color:var(--txt-dim)">필요 XP ${fmtInt(m.xp)} ·
            보상 ${fmtMoney(m.cash)} · 🔬${m.dp} · 🗺️${m.permits} · 대출한도 ${fmtMoney(m.loan)}</div>
          ${unlocks.length ? `<div style="margin-top:4px">${unlocks.map(u => `<span class="chip">${u}</span>`).join('')}</div>` : ''}
        </div>`;
      list.appendChild(it);
    });
    root.appendChild(list);
  }

  // --- 정책 ---------------------------------------------------------------
  mPolicies(root) {
    const w = this.g.world, c = w.city;
    root.innerHTML = `<h2>📜 도시 정책</h2>
      <div class="m-sub">정책은 매월 인구에 비례한 비용이 듭니다. 현재 적용 중:
      <b>${Object.keys(c.policies).filter(k => c.policies[k]).length}개</b></div>`;
    for (const p of POLICIES) {
      const avail = policyAvailable(w, p.id);
      const on = !!c.policies[p.id];
      const it = el('div', 'pol-item' + (on ? ' on' : '') + (avail ? '' : ' locked'));
      it.innerHTML = `<div class="pol-ico">${p.icon}</div>
        <div style="flex:1">
          <div style="font-weight:700">${p.name} ${on ? '<span class="chip ok">적용 중</span>' : ''}</div>
          <div style="font-size:11.5px;color:var(--txt-dim)">${p.desc}</div>
          <div style="font-size:11px;color:var(--txt-dim);margin-top:3px">
            ${avail ? `월 비용 ≈ ${fmtMoney(p.costPerPop * Math.max(60, c.population) * 0.35)}`
                    : `🔒 마일스톤 「${MILESTONES[p.unlock].name}」 필요`}</div>
        </div>`;
      if (avail) it.onclick = () => { c.policies[p.id] = !on; this.refreshModal(); };
      root.appendChild(it);
    }
  }

  // --- 개발 트리 ------------------------------------------------------------
  mDev(root) {
    const w = this.g.world, c = w.city;
    root.innerHTML = `<h2>🔬 개발 트리</h2>
      <div class="m-sub">마일스톤 보상으로 얻은 개발 포인트로 고급 시설을 개방합니다.
      보유 포인트: <b>${c.devPoints}</b></div>`;
    const cats = [...new Set(BUILDINGS.filter(b => b.dp).map(b => b.cat))];
    for (const cat of cats) {
      root.appendChild(el('div', 'p-sec', CATEGORY_INFO[cat]?.name || cat));
      for (const d of BUILDINGS.filter(b => b.cat === cat && b.dp)) {
        const done = !!c.devSpent[d.id];
        const msOk = c.milestone >= d.unlock;
        const it = el('div', 'dev-item' + (done ? ' done' : msOk ? '' : ' locked'));
        it.innerHTML = `<div style="font-size:19px">${d.icon}</div>
          <div style="flex:1">
            <div style="font-weight:700">${d.name}</div>
            <div style="font-size:11px;color:var(--txt-dim)">
              ${done ? '개발 완료' : msOk ? `개발 포인트 ${d.dp} 필요`
                : `🔒 마일스톤 「${MILESTONES[d.unlock].name}」 필요`}</div>
          </div>`;
        if (!done && msOk) {
          const b = el('button', 'btn primary', `🔬 ${d.dp}`);
          b.disabled = c.devPoints < d.dp;
          b.onclick = () => {
            const r = research(w, d.id);
            if (!r.ok) alert(r.msg); else this.refreshModal();
          };
          it.appendChild(b);
        }
        root.appendChild(it);
      }
    }
  }

  // --- 저장 ---------------------------------------------------------------
  mSave(root) {
    const canStore = this.g.storageOk();
    // 임베드(아티팩트·iframe) 환경은 파일 다운로드·선택이 막혀 있으므로 텍스트 방식만 제공한다
    const embedded = this.g.isEmbedded();
    root.innerHTML = `<h2>💾 저장 / 불러오기</h2>
      <div class="m-sub">브라우저 저장소에 도시를 보관하거나, 파일·텍스트로 주고받을 수 있습니다.</div>
      ${canStore ? '' : `<div class="chip bad" style="display:block;padding:8px 10px;margin-bottom:12px">
        이 브라우저에서는 저장소를 사용할 수 없습니다(시크릿 창·사이트 데이터 차단 등).
        아래 <b>텍스트로 백업</b>으로 도시를 보관하세요.</div>`}
      ${embedded && canStore ? `<div class="chip" style="display:block;padding:8px 10px;margin-bottom:12px">
        저장 슬롯은 이 브라우저에만 보관됩니다. 다른 기기로 옮기려면
        <b>텍스트로 백업</b>한 뒤 붙여넣어 불러오세요.</div>` : ''}
      <div id="slotList"></div>
      <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn primary" id="sv">현재 도시 저장</button>
        ${embedded ? '' : `<button class="btn" id="ex">파일로 내보내기</button>
        <button class="btn" id="im">파일에서 불러오기</button>`}
        <button class="btn" id="tx">텍스트로 ${embedded ? '백업' : '내보내기'}</button>
        <button class="btn" id="ti">텍스트로 불러오기</button>
        <button class="btn danger" id="nw">새 도시 시작</button>
      </div>
      <div id="textArea" class="hidden" style="margin-top:12px">
        <div class="p-sec" id="textLabel"></div>
        <textarea id="saveText" spellcheck="false" style="width:100%;height:110px;font-size:10px;
          font-family:ui-monospace,monospace;background:rgba(0,0,0,.3);color:var(--txt-dim);
          border:1px solid var(--line);border-radius:8px;padding:8px;resize:vertical"></textarea>
        <div style="margin-top:8px;display:flex;gap:8px">
          <button class="btn" id="txCopy">전체 복사</button>
          <button class="btn primary hidden" id="txLoad">이 데이터로 불러오기</button>
        </div>
      </div>`;
    const list = root.querySelector('#slotList');
    const slots = this.g.listSaves();
    list.innerHTML = slots.length ? '' : '<div style="color:var(--txt-dim);font-size:12px">저장된 도시가 없습니다.</div>';
    for (const s of slots) {
      const it = el('div', 'dev-item');
      it.innerHTML = `<div style="flex:1"><div style="font-weight:700">${s.name}</div>
        <div style="font-size:11px;color:var(--txt-dim)">인구 ${fmtInt(s.pop)} · ${s.date} · 저장 ${s.saved}</div></div>`;
      const lb = el('button', 'btn primary', '불러오기');
      lb.onclick = () => { this.g.loadGame(s.key); this.closeModal(); };
      const db = el('button', 'btn danger', '삭제');
      db.onclick = () => { this.g.deleteSave(s.key); this.refreshModal(); };
      it.appendChild(lb); it.appendChild(db);
      list.appendChild(it);
    }
    const box = root.querySelector('#textArea');
    const ta = root.querySelector('#saveText');
    const showText = (label, value, loadable) => {
      box.classList.remove('hidden');
      root.querySelector('#textLabel').textContent = label;
      ta.value = value;
      root.querySelector('#txLoad').classList.toggle('hidden', !loadable);
      root.querySelector('#txCopy').classList.toggle('hidden', loadable);
      if (!loadable) { ta.focus(); ta.select(); }
    };
    root.querySelector('#sv').onclick = () => { this.g.saveGame(); this.refreshModal(); };
    if (!embedded) {
      root.querySelector('#ex').onclick = () => {
        if (!this.g.exportSave()) showText('다운로드가 막혀 있어 텍스트로 대신 내보냅니다 — 복사해서 보관하세요',
                                           this.g.saveText(), false);
      };
      root.querySelector('#im').onclick = () => this.g.importSave();
    }
    root.querySelector('#tx').onclick = () =>
      showText('아래 내용을 복사해 보관하세요', this.g.saveText(), false);
    root.querySelector('#ti').onclick = () =>
      showText('백업해 둔 저장 데이터를 붙여넣으세요', '', true);
    root.querySelector('#txCopy').onclick = () => {
      ta.focus(); ta.select();
      try { navigator.clipboard.writeText(ta.value); } catch { document.execCommand('copy'); }
      this.g.toast('📋 저장 데이터를 복사했습니다.', 'good');
    };
    root.querySelector('#txLoad').onclick = () => {
      if (this.g.loadText(ta.value.trim())) this.closeModal();
    };
    root.querySelector('#nw').onclick = () => {
      if (confirm('현재 진행 상황을 버리고 새 도시를 시작할까요?')) { this.g.newGame(); this.closeModal(); }
    };
  }

  // --- 도움말 --------------------------------------------------------------
  mHelp(root) {
    root.innerHTML = `<h2>❓ 도움말</h2>
      <div class="m-sub">Cities: Skylines III — 아이소메트릭 도시 건설 시뮬레이션</div>
      <div class="grid2">
        <div>
          <div class="p-sec">조작</div>
          <table class="budget">
            <tr><td>화면 이동</td><td><kbd>우클릭 드래그</kbd> / <kbd>WASD</kbd></td></tr>
            <tr><td>확대·축소</td><td><kbd>마우스 휠</kbd></td></tr>
            <tr><td>건설·지정</td><td><kbd>좌클릭 드래그</kbd></td></tr>
            <tr><td>취소</td><td><kbd>Esc</kbd></td></tr>
            <tr><td>일시정지</td><td><kbd>Space</kbd></td></tr>
            <tr><td>속도</td><td><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd></td></tr>
            <tr><td>철거 도구</td><td><kbd>X</kbd></td></tr>
            <tr><td>도로 / 구역</td><td><kbd>Q</kbd> / <kbd>E</kbd></td></tr>
            <tr><td>브러시 크기</td><td><kbd>[</kbd> <kbd>]</kbd></td></tr>
            <tr><td>격자 표시</td><td><kbd>G</kbd></td></tr>
            <tr><td>낮/밤 전환</td><td><kbd>N</kbd></td></tr>
            <tr><td>예산·통계·정책</td><td><kbd>B</kbd> <kbd>T</kbd> <kbd>P</kbd></td></tr>
          </table>
        </div>
        <div>
          <div class="p-sec">시작 가이드</div>
          <ol style="font-size:12px;line-height:1.85;padding-left:18px;color:#cdd8e5">
            <li>고속도로에서 <b>2차선 도로</b>를 끌어와 도로망을 만듭니다.</li>
            <li>도로 양옆에 <b>주거·상업·산업</b> 구역을 지정합니다 (도로에서 4칸 이내).</li>
            <li><b>풍력 발전기</b>와 <b>급수탑·하수 방류구</b>를 세워 전기·물을 공급합니다.
                전선과 수도관은 도로 밑으로 함께 깔립니다.</li>
            <li>인구가 늘면 <b>쓰레기 매립지 · 진료소 · 소방서 · 학교</b>를 배치하세요.</li>
            <li>XP가 쌓이면 마일스톤이 오르고 새 시설과 <b>확장 허가증</b>을 얻습니다.
                🗺️ 구역 확장 도구로 새 땅을 사세요.</li>
            <li>교통 정체는 <b>대로 · 버스 · 지하철</b>로 해결합니다.</li>
          </ol>
          <div class="p-sec">알아두면 좋은 것</div>
          <ul style="font-size:12px;line-height:1.8;padding-left:18px;color:#cdd8e5">
            <li>건물은 <b>토지가치</b>가 높아야 레벨업합니다. 공원·서비스는 올리고, 오염·소음·범죄는 낮춥니다.</li>
            <li>산업은 오염이 심하니 주거지에서 멀리 두세요.</li>
            <li>사무 구역은 고학력 시민이 필요합니다 (대학교).</li>
            <li>왼쪽 <b>정보 오버레이</b>로 오염·교통·토지가치를 눈으로 확인하세요.</li>
          </ul>
        </div>
      </div>`;
  }
}

// ---------------------------------------------------------------------------
function setStat(sel, val, sub, bad) {
  const e = document.querySelector(sel);
  if (!e) return;
  e.querySelector('.s-val').textContent = val;
  e.querySelector('.s-sub').textContent = sub || '';
  e.classList.toggle('bad', !!bad);
}

function happyFace(h) {
  return h >= 75 ? '😄' : h >= 60 ? '🙂' : h >= 45 ? '😐' : h >= 30 ? '🙁' : '😡';
}

function budgetKeyOfCat(cat) {
  return ({ police: 'police', fire: 'fire', health: 'health', edu: 'edu', park: 'park',
            power: 'power', water: 'water', garbage: 'garbage', transport: 'transport' })[cat] || 'road';
}

function buildingTip(d) {
  const parts = [`<b>${d.name}</b>`];
  parts.push(`건설비 ${fmtMoney(d.cost)} · 유지 ₡${d.upkeep}/월 · ${d.w}×${d.h}`);
  if (d.power) parts.push(`발전 ${d.power} MW`);
  if (d.water) parts.push(`급수 ${d.water}`);
  if (d.sewage) parts.push(`하수 처리 ${d.sewage}`);
  if (d.garbage) parts.push(`쓰레기 처리 ${d.garbage}/월`);
  if (d.svc) parts.push(`반경 ${d.svc.radius}칸` +
    (d.svc.capacity < 1e8 ? ` · 수용 ${fmtInt(d.svc.capacity)}명` : ''));
  if (d.jobs) parts.push(`일자리 ${d.jobs}`);
  if (d.land) parts.push(`토지가치 +${d.land}`);
  if (d.tourism) parts.push(`관광 +${fmtInt(d.tourism)}`);
  if (d.taxBonus) parts.push(`세수 +${Math.round(d.taxBonus * 100)}%`);
  if (d.air) parts.push(`⚠ 대기오염 ${d.air}`);
  if (d.ground) parts.push(`⚠ 지상오염 ${d.ground}`);
  if (d.noise) parts.push(`⚠ 소음 ${d.noise}`);
  if (d.needsWater) parts.push('💧 수변에만 건설 가능');
  if (d.noRoad) parts.push('도로 연결 불필요');
  if (d.link) parts.push(`전력망 연결 반경 ${d.link}칸`);
  return parts.join('<br>');
}

/** 간단한 선 그래프 */
function drawChart(cv, seriesList, colors, maxHint) {
  const r = cv.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = r.width * dpr; cv.height = r.height * dpr;
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = r.width, H = r.height, pad = 6;
  ctx.clearRect(0, 0, W, H);

  let max = maxHint || 1;
  if (!maxHint) for (const s of seriesList) for (const v of s) if (v > max) max = v;
  max *= 1.08;
  let len = 0;
  for (const s of seriesList) len = Math.max(len, s.length);
  if (len < 2) {
    ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.font = '12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('데이터가 쌓이는 중… (매월 기록)', W / 2, H / 2);
    return;
  }
  ctx.strokeStyle = 'rgba(255,255,255,.08)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad + (H - pad * 2) * (i / 4);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  seriesList.forEach((s, si) => {
    if (s.length < 2) return;
    ctx.strokeStyle = colors[si]; ctx.lineWidth = 1.8;
    ctx.beginPath();
    s.forEach((v, i) => {
      const x = (i / (len - 1)) * W;
      const y = H - pad - (v / max) * (H - pad * 2);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
  });
  ctx.fillStyle = 'rgba(255,255,255,.45)';
  ctx.font = '10px system-ui'; ctx.textAlign = 'left';
  ctx.fillText(fmtShort(max), 4, 11);
}
