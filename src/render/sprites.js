// ============================================================================
//  건물 스프라이트 캐시
//  (type, level, variant, state) × 확대 단계별로 한 번만 그려 두고 재사용한다.
//  본체(body)와 야간 조명(lights)을 분리해 두어 밤에는 조명만 가산 합성한다.
// ============================================================================
import { makeProjector } from './architecture.js';
import { modelMetrics, drawBuildingModel } from './models.js';
import { ZONE_DEF } from '../core/config.js';

const ZOOM_BUCKETS = [0.28, 0.42, 0.62, 0.88, 1.2, 1.6, 2.1];

export function zoomBucket(zoom) {
  for (const b of ZOOM_BUCKETS) if (zoom <= b * 1.001) return b;
  return ZOOM_BUCKETS[ZOOM_BUCKETS.length - 1];
}

/** 건물 인스턴스 → 캐시 키 + 스펙 */
export function specOf(b) {
  const state = b.burnt ? 'b' : b.abandoned ? 'a' : 'n';
  if (b.kind === 'growth') {
    const zd = ZONE_DEF[b.zone];
    return {
      key: `g${b.zone}.${b.level}.${b.variant % 5}.${state}`,
      kind: 'growth', zone: b.zone, level: b.level, variant: b.variant % 5,
      bw: zd.size, bh: zd.size, state,
    };
  }
  return {
    key: `s${b.defId}.${b.variant % 3}.${state}`,
    kind: 'service', def: b.def, defId: b.defId, level: 1, variant: b.variant % 3,
    bw: b.w, bh: b.h, state,
  };
}

export class SpriteCache {
  constructor(max = 220) {
    this.map = new Map();
    this.bucket = 0;
    this.max = max;
    this.built = 0;
    this.pixels = 0;
  }

  clear() { this.map.clear(); this.pixels = 0; }

  get(spec, zoom, def) {
    const zb = zoomBucket(zoom);
    if (zb !== this.bucket) { this.clear(); this.bucket = zb; }
    let s = this.map.get(spec.key);
    if (s) {                                   // LRU 갱신
      this.map.delete(spec.key);
      this.map.set(spec.key, s);
      return s;
    }
    if (def) spec.def = def;
    s = renderSprite(spec, zb);
    this.map.set(spec.key, s);
    this.built++;
    this.pixels += s.body.width * s.body.height;
    while (this.map.size > this.max) {
      const k = this.map.keys().next().value;
      const old = this.map.get(k);
      this.pixels -= old.body.width * old.body.height;
      this.map.delete(k);
    }
    return s;
  }
}

function renderSprite(spec, z) {
  const { bodyH, extra } = modelMetrics(spec);
  spec.bodyH = bodyH;
  const topPx = (bodyH + extra) * z;
  const pr = makeProjector(spec.bw, spec.bh, z, topPx);

  const body = document.createElement('canvas');
  body.width = Math.max(2, pr.sw); body.height = Math.max(2, pr.sh);
  const bctx = body.getContext('2d');
  bctx.lineJoin = 'round';
  bctx.imageSmoothingEnabled = true;

  const lights = document.createElement('canvas');
  lights.width = body.width; lights.height = body.height;
  const lctx = lights.getContext('2d');
  lctx.lineJoin = 'round';

  const fx = drawBuildingModel(bctx, spec.state === 'n' ? lctx : null, pr, spec) || {};

  // 조명 캔버스에 실제로 그려진 것이 있는지 확인 (없으면 합성 생략)
  let hasLights = spec.state === 'n';
  return {
    body, lights, hasLights,
    ox: pr.originX, oy: pr.originY, z, fx,
    w: body.width, h: body.height,
  };
}
