// ============================================================================
//  저장 / 불러오기 — localStorage + 파일 내보내기
// ============================================================================
import { MAP_W, MAP_H } from './core/config.js';
import { createWorld, newCityState } from './core/world.js';

const PREFIX = 'cs3_save_';
export const SAVE_VERSION = 3;

/**
 * localStorage 안전 래퍼.
 * 시크릿 창·사이트 데이터 차단·샌드박스 등에서 접근 자체가 예외를 던질 수 있어
 * 모든 읽기/쓰기를 try/catch 로 감싼다.
 */
export const store = {
  ok: (() => {
    try { const k = '__cs3'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; }
    catch { return false; }
  })(),
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch {} },
  keys() {
    try { return Object.keys(localStorage); } catch { return []; }
  },
};

const TYPED = {
  height: Float32Array, water: Uint8Array, shore: Uint8Array, tree: Uint8Array,
  resource: Uint8Array, variant: Uint8Array, road: Uint8Array, zone: Uint8Array,
  bidx: Int32Array, sectorOwned: Uint8Array,
};

function toB64(arr) {
  const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  }
  return btoa(s);
}

function fromB64(str, Type) {
  const bin = atob(str);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Type(u8.buffer);
}

export function serialize(w) {
  const grids = {};
  for (const k of Object.keys(TYPED)) grids[k] = toB64(w[k]);
  return {
    v: SAVE_VERSION,
    seed: w.seed,
    mapW: MAP_W, mapH: MAP_H,
    outside: w.outside,
    grids,
    trafficPeak: 0,
    buildings: w.buildings.map(b => b && ({
      uid: b.uid, x: b.x, y: b.y, w: b.w, h: b.h, kind: b.kind, defId: b.defId,
      zone: b.zone, level: b.level, variant: b.variant, residents: b.residents,
      jobs: b.jobs, filled: b.filled, happiness: b.happiness, abandoned: b.abandoned,
      burnt: b.burnt, fire: b.fire, age: b.age, progress: b.progress, slot: b.slot,
      badTicks: b.badTicks || 0,
    })),
    freeSlots: w.freeSlots,
    city: w.city,
  };
}

export function deserialize(data) {
  const w = createWorld(data.seed || 1);
  for (const [k, T] of Object.entries(TYPED)) {
    if (data.grids[k]) {
      const arr = fromB64(data.grids[k], T);
      w[k].set(arr.subarray(0, w[k].length));
    }
  }
  w.outside = data.outside || w.outside;
  w.buildings = (data.buildings || []).map(b => b && {
    ...b,
    powered: true, watered: true, sewered: true,
    compId: -1, roadTile: -1, active: true, garbage: 0,
    jobsCount: 0, noPath: 0,
  });
  w.freeSlots = data.freeSlots || [];
  w.city = Object.assign(newCityState(), data.city || {});
  w.city.notifications = [];
  w.netDirty = true;
  w.dirtyGround = { x0: 0, y0: 0, x1: MAP_W - 1, y1: MAP_H - 1, any: true };
  return w;
}

// ---------------------------------------------------------------------------
export function saveTo(key, w) {
  if (!store.ok) return { ok: false, msg: '이 브라우저에서는 저장소를 쓸 수 없습니다. 텍스트로 내보내기를 사용하세요.' };
  const payload = JSON.stringify(serialize(w));
  const meta = JSON.stringify({
    name: w.city.name,
    pop: Math.round(w.city.population),
    date: `${w.city.year}년 ${w.city.month}월`,
    saved: new Date().toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }),
  });
  if (!store.set(PREFIX + key, payload)) return { ok: false, msg: '저장 공간이 부족합니다.' };
  store.set(PREFIX + key + '_meta', meta);
  return { ok: true };
}

export function loadFrom(key) {
  const raw = store.get(PREFIX + key);
  if (!raw) return null;
  try { return deserialize(JSON.parse(raw)); }
  catch (e) { console.error('불러오기 실패', e); return null; }
}

export function listSaves() {
  const out = [];
  for (const k of store.keys()) {
    if (!k.startsWith(PREFIX) || k.endsWith('_meta')) continue;
    const key = k.slice(PREFIX.length);
    let meta = {};
    try { meta = JSON.parse(store.get(k + '_meta') || '{}'); } catch {}
    out.push({ key, name: meta.name || key, pop: meta.pop || 0,
               date: meta.date || '-', saved: meta.saved || '-' });
  }
  return out.sort((a, b) => (a.saved < b.saved ? 1 : -1));
}

export function deleteSave(key) {
  store.del(PREFIX + key);
  store.del(PREFIX + key + '_meta');
}

/** 저장 데이터를 텍스트로 (다운로드가 막힌 환경용) */
export function toText(w) { return JSON.stringify(serialize(w)); }
export function fromText(text) { return deserialize(JSON.parse(text)); }

export function exportFile(w) {
  try {
    const blob = new Blob([JSON.stringify(serialize(w))], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${w.city.name.replace(/\s+/g, '_')}_${w.city.year}.cs3city.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return true;
  } catch { return false; }
}

export function importFile() {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.onchange = () => {
      const f = inp.files[0];
      if (!f) return resolve(null);
      const fr = new FileReader();
      fr.onload = () => {
        try { resolve(deserialize(JSON.parse(fr.result))); }
        catch (e) { alert('파일을 읽을 수 없습니다: ' + e.message); resolve(null); }
      };
      fr.readAsText(f);
    };
    inp.click();
  });
}
