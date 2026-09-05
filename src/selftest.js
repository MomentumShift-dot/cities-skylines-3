// ============================================================================
//  셀프 테스트 — ?selftest=1 로 접속하면 게임 전 기능을 자동 점검한다
//  (결과는 #selftestResult 및 document.title 에 기록되어 --dump-dom 으로 확인 가능)
// ============================================================================
import { OVERLAYS } from './render/renderer.js';
import { step } from './sim/simulation.js';
import { idx, buildingAt } from './core/world.js';
import { ROADS, BUILDINGS, BUILDING_BY_ID, ZONE_DEF, MAP_W, SECTOR, SECTORS_X } from './core/config.js';
import { SpriteCache } from './render/sprites.js';
import * as Save from './save.js';
import { research } from './sim/progression.js';

export function runSelfTest(game) {
  const results = [];
  const errors = [];
  window.addEventListener('error', e => errors.push('window.onerror: ' + e.message));

  let detail = '';
  const note = s => { detail = s; };
  const t = (name, fn) => {
    detail = '';
    try {
      const r = fn();
      results.push({ name, ok: r === true, detail });
    } catch (e) {
      results.push({ name, ok: false, detail: e.message + ' @ ' + (e.stack || '').split('\n')[1] });
    }
  };

  const w = game.world;
  const oy = w.outside.y;
  const cx = Math.floor(MAP_W / 2);

  // --- UI 구성 -------------------------------------------------------------
  t('툴바 버튼이 생성된다', () => document.querySelectorAll('#toolbar .tool').length >= 12);
  t('오버레이 버튼이 생성된다', () => document.querySelectorAll('#overlayBar .ov-btn').length >= 15);
  t('상단 메뉴 버튼이 생성된다', () => document.querySelectorAll('.tb-menu button').length === 7);

  // --- 도로 팔레트 & 건설 ---------------------------------------------------
  t('도로 팔레트가 열린다', () => {
    game.ui.selectGroup('road');
    return !document.getElementById('palette').classList.contains('hidden') &&
           document.querySelectorAll('#palette .pal-item').length >= 5;
  });
  t('도로를 건설할 수 있다', () => {
    game.setTool({ type: 'road', roadType: 0 });
    const before = w.city.cash;
    game.input.applyRoad({ x: cx - 18, y: oy }, { x: cx + 10, y: oy });
    game.input.applyRoad({ x: cx - 10, y: oy - 12 }, { x: cx - 10, y: oy + 12 });
    game.input.applyRoad({ x: cx, y: oy - 12 }, { x: cx, y: oy + 12 });
    game.input.applyRoad({ x: cx - 18, y: oy - 12 }, { x: cx + 10, y: oy - 12 });
    game.input.applyRoad({ x: cx - 18, y: oy + 12 }, { x: cx + 10, y: oy + 12 });
    note(`비용 ${Math.round(before - w.city.cash)}`);
    return w.road[idx(cx, oy)] === 1 && w.city.cash < before;
  });
  t('잠긴 도로는 건설되지 않는다', () => {
    const r = game.input.applyRoad({ x: cx + 4, y: oy + 4 }, { x: cx + 6, y: oy + 4 });
    game.setTool({ type: 'road', roadType: 3 });
    const before = w.city.cash;
    game.input.applyRoad({ x: cx + 4, y: oy + 6 }, { x: cx + 6, y: oy + 6 });
    game.setTool({ type: 'road', roadType: 0 });
    return w.city.cash === before;
  });

  // --- 구역 지정 -----------------------------------------------------------
  t('용도지역 팔레트가 열린다', () => {
    game.ui.selectGroup('zone');
    return document.querySelectorAll('#palette .pal-item').length >= 8;
  });
  t('구역을 지정할 수 있다', () => {
    game.input.brush = 5;
    game.setTool({ type: 'zone', zone: 1 });
    for (let x = cx - 16; x <= cx - 2; x += 3)
      for (let y = oy - 10; y <= oy + 10; y += 3) game.input.applyPaint({ x, y });
    game.setTool({ type: 'zone', zone: 4 });
    for (let y = oy - 10; y <= oy - 4; y += 3) game.input.applyPaint({ x: cx + 4, y });
    game.setTool({ type: 'zone', zone: 6 });
    for (let y = oy + 4; y <= oy + 10; y += 3) game.input.applyPaint({ x: cx + 4, y });
    let n = 0;
    for (let i = 0; i < w.N; i++) if (w.zone[i]) n++;
    note(`${n}칸 지정됨`);
    return n > 100;
  });

  // --- 서비스 건물 ---------------------------------------------------------
  t('서비스 건물을 배치할 수 있다', () => {
    w.city.cash = 500000;
    const place = (id, x, y) => { game.setTool({ type: 'build', defId: id }); game.input.applyBuild({ x, y }); };
    place('wind', cx - 15, oy - 14);
    place('wind', cx - 12, oy - 14);
    place('wtower', cx - 8, oy - 13);
    place('wtower', cx - 6, oy - 13);
    place('sewage', cx - 3, oy - 14);
    place('landfill', cx + 6, oy + 8);
    place('park1', cx - 9, oy - 1);
    place('clinic', cx - 9, oy + 1);
    const n = w.buildings.filter(b => b && b.kind === 'service').length;
    note(`${n}개 배치`);
    return n >= 6;
  });
  t('도로에서 떨어진 곳에는 건설되지 않는다', () => {
    const before = w.buildings.filter(Boolean).length;
    game.setTool({ type: 'build', defId: 'wind' });
    game.input.applyBuild({ x: 5, y: 5 });
    return w.buildings.filter(Boolean).length === before;
  });
  t('잠긴 건물은 배치되지 않는다', () => {
    const before = w.city.cash;
    game.setTool({ type: 'build', defId: 'nuclear' });
    game.input.applyBuild({ x: cx - 4, y: oy - 8 });
    return w.city.cash === before;
  });

  // --- 시뮬레이션 -----------------------------------------------------------
  t('시뮬레이션이 진행되고 인구가 생긴다', () => {
    for (let i = 0; i < 3200; i++) step(w);
    note(`인구 ${Math.round(w.city.population)} / 건물 ${w.buildings.filter(Boolean).length}`);
    return w.city.population > 40;
  });
  t('전력·수도가 공급된다', () => {
    note(`전력 ${w.city.power.supply.toFixed(1)}/${w.city.power.demand.toFixed(1)}MW · ` +
         `수도 ${w.city.water.supply.toFixed(1)}/${w.city.water.demand.toFixed(1)} · ` +
         `하수 ${w.city.sewage.capacity.toFixed(1)}/${w.city.sewage.produced.toFixed(1)}`);
    return w.city.power.demand > 0 && w.city.power.ratio > 0.9 &&
           w.city.water.demand > 0 && w.city.water.ratio > 0.9;
  });
  t('건물이 전기·물을 공급받는다', () => {
    const gs = w.buildings.filter(b => b && b.kind === 'growth' && !b.abandoned);
    const ok = gs.filter(b => b.powered && b.watered).length;
    note(`${ok}/${gs.length}동 공급됨`);
    return gs.length > 0 && ok / gs.length > 0.85;
  });
  t('교통량이 집계된다', () => {
    let sum = 0, peak = 0;
    for (let i = 0; i < w.N; i++) { sum += w.f.traffic[i]; if (w.f.traffic[i] > peak) peak = w.f.traffic[i]; }
    note(`총 통행량 ${Math.round(sum)} · 최대 ${Math.round(peak)} · 차량 ${w.cars.length}대 · 흐름 ${w.city.trafficFlow}%`);
    return sum > 0 && w.cars.length > 0;
  });
  t('예산이 계산된다', () => {
    note(`수입 ${Math.round(w.city.lastMonth.income)} 지출 ${Math.round(w.city.lastMonth.expense)}`);
    return w.city.lastMonth.income > 0 && w.city.lastMonth.expense > 0;
  });
  t('XP가 누적되고 마일스톤이 오른다', () => {
    note(`XP ${Math.round(w.city.xp)} · 마일스톤 ${w.city.milestone}`);
    return w.city.xp > 0 && w.city.milestone >= 1;
  });

  // --- 정보 패널 -----------------------------------------------------------
  t('건물 정보 패널이 렌더링된다', () => {
    const b = w.buildings.find(x => x && x.kind === 'growth');
    if (!b) return false;
    game.ui.renderInfo(b);
    return !document.getElementById('infoPanel').classList.contains('hidden') &&
           document.getElementById('infoBody').innerHTML.length > 200;
  });
  t('타일 정보 패널이 렌더링된다', () => {
    game.ui.renderTileInfo(cx, oy);
    return document.getElementById('infoBody').innerHTML.includes('타일 정보');
  });

  // --- 모달 ---------------------------------------------------------------
  for (const kind of ['budget', 'stats', 'miles', 'policy', 'dev', 'save', 'help']) {
    t(`모달(${kind})이 열린다`, () => {
      game.ui.openModal(kind);
      const ok = !!document.querySelector('.modal') &&
                 document.querySelector('.modal').innerHTML.length > 100;
      game.ui.closeModal();
      return ok;
    });
  }

  // --- 오버레이 + 렌더 --------------------------------------------------------
  t('모든 오버레이가 오류 없이 그려진다', () => {
    for (const k of Object.keys(OVERLAYS)) {
      game.renderer.setOverlay(k);
      game.renderer.render(w, { hover: { x: cx, y: oy }, tool: 'select', preview: null,
                                selected: null, showGrid: true, sectorMode: true, hoverSector: 0 });
    }
    game.renderer.setOverlay('none');
    note(Object.keys(OVERLAYS).length + '종');
    return true;
  });
  t('모든 건물 모델이 오류 없이 렌더링된다', () => {
    const cache = new SpriteCache(900);
    let n = 0, px = 0;
    for (const d of BUILDINGS) {
      const sp = cache.get({ key: 'T_s_' + d.id, kind: 'service', def: d, defId: d.id,
                             level: 1, variant: 0, bw: d.w, bh: d.h, state: 'n' }, 1.0, d);
      px += sp.w * sp.h; n++;
    }
    for (let z = 1; z <= 7; z++) {
      const zd = ZONE_DEF[z];
      for (let lv = 1; lv <= 5; lv++) {
        for (const st of ['n', 'a', 'b']) {
          const sp = cache.get({ key: `T_g${z}.${lv}.${st}`, kind: 'growth', zone: z, level: lv,
                                 variant: (lv + z) % 5, bw: zd.size, bh: zd.size, state: st }, 1.0);
          px += sp.w * sp.h; n++;
        }
      }
    }
    note(`${n}종 · ${(px / 1e6).toFixed(1)}M px`);
    return n === BUILDINGS.length + 7 * 5 * 3;
  });

  t('스프라이트 캐시가 재사용된다', () => {
    const cache = new SpriteCache(50);
    const spec = { key: 'T_cache', kind: 'service', def: BUILDING_BY_ID.clinic, defId: 'clinic',
                   level: 1, variant: 0, bw: 2, bh: 2, state: 'n' };
    cache.get(spec, 1.0, BUILDING_BY_ID.clinic);
    const before = cache.built;
    for (let i = 0; i < 20; i++) cache.get(spec, 1.0, BUILDING_BY_ID.clinic);
    const sameBucket = cache.built === before;
    cache.get(spec, 2.0, BUILDING_BY_ID.clinic);   // 확대 단계가 바뀌면 다시 그린다
    note(`재사용 ${sameBucket ? 'OK' : 'FAIL'} · 총 생성 ${cache.built}`);
    return sameBucket && cache.built === before + 1;
  });

  t('프리뷰가 계산된다', () => {
    game.setTool({ type: 'build', defId: 'clinic' });
    game.input.updatePreview({ x: cx - 3, y: oy - 3 });
    const okBox = !!game.preview && !!game.preview.box;
    game.setTool({ type: 'road', roadType: 0 });
    game.input.updatePreview({ x: cx - 3, y: oy - 3 });
    const okTiles = !!game.preview && !!game.preview.tiles;
    return okBox && okTiles;
  });

  // --- 정책 / 개발 / 확장 -----------------------------------------------------
  t('정책을 켜고 끌 수 있다', () => {
    w.city.milestone = 8;
    w.city.policies.recycle = true;
    step(w);
    const on = w.city.policies.recycle === true;
    w.city.policies.recycle = false;
    return on;
  });
  t('개발 포인트로 시설을 개방한다', () => {
    w.city.milestone = 9;
    w.city.devPoints = 10;
    const before = w.city.devPoints;
    const r = research(w, 'wtp');
    note(`${r.ok ? '개발 성공' : r.msg} · 잔여 ${w.city.devPoints}`);
    return r.ok && w.city.devSpent.wtp === true && w.city.devPoints === before - 3;
  });
  t('구역을 구매할 수 있다', () => {
    w.city.permits = 50;
    const before = [...w.sectorOwned].reduce((a, b) => a + b, 0);
    game.setTool({ type: 'sector' });
    // 시작 구역(2,2)-(3,3)에 인접한 미소유 구역
    game.input.applySector({ x: 1 * SECTOR + 2, y: 2 * SECTOR + 2 });
    const after = [...w.sectorOwned].reduce((a, b) => a + b, 0);
    note(`${before} → ${after}구역`);
    return after === before + 1;
  });

  // --- 철거 ---------------------------------------------------------------
  t('철거 도구가 동작한다', () => {
    const b = w.buildings.find(x => x && x.kind === 'growth');
    if (!b) return false;
    game.setTool({ type: 'bulldoze' });
    game.input.brush = 1;
    game.input.applyPaint({ x: b.x, y: b.y });
    return buildingAt(w, b.x, b.y) === null;
  });

  // --- 저장 / 불러오기 ---------------------------------------------------------
  t('저장 후 불러오면 상태가 보존된다', () => {
    const pop = Math.round(w.city.population);
    let roads = 0;
    for (let i = 0; i < w.N; i++) if (w.road[i]) roads++;
    const r = Save.saveTo('__selftest__', w);
    if (!r.ok) { note(r.msg); return false; }
    const w2 = Save.loadFrom('__selftest__');
    Save.deleteSave('__selftest__');
    if (!w2) { note('불러오기 실패'); return false; }
    let roads2 = 0;
    for (let i = 0; i < w2.N; i++) if (w2.road[i]) roads2++;
    const bd = w2.buildings.filter(Boolean).length;
    const bd1 = w.buildings.filter(Boolean).length;
    note(`인구 ${pop}, 도로 ${roads}칸, 건물 ${bd}개`);
    return Math.round(w2.city.population) === pop && roads2 === roads && bd === bd1 &&
           w2.city.milestone === w.city.milestone && w2.city.devSpent.wtp === true;
  });

  // --- 결과 출력 -----------------------------------------------------------
  const pass = results.filter(r => r.ok).length;
  const fail = results.length - pass;
  const box = document.createElement('div');
  box.id = 'selftestResult';
  box.style.cssText = `position:fixed;inset:40px;z-index:999;background:#0e141c;border:1px solid #2a3a4d;
    border-radius:12px;padding:22px;overflow:auto;font-size:13px;line-height:1.7`;
  box.innerHTML = `<h2 style="margin:0 0 12px">셀프 테스트 결과 —
    <span style="color:${fail ? '#ff6a5c' : '#5fd68a'}">${pass}/${results.length} 통과</span></h2>` +
    results.map(r => `<div style="color:${r.ok ? '#8fe8b0' : '#ff8a7d'}">
      ${r.ok ? '✅' : '❌'} ${r.name}${r.detail ? ` <span style="color:#93a2b5">— ${r.detail}</span>` : ''}</div>`).join('') +
    (errors.length ? `<div style="margin-top:12px;color:#ff8a7d">런타임 오류:<br>${errors.join('<br>')}</div>` : '');
  document.body.appendChild(box);
  document.title = `SELFTEST ${pass}/${results.length} ${fail ? 'FAIL' : 'PASS'}`;
  console.log(document.title);
  return { pass, fail, results };
}
