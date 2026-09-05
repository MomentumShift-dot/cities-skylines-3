// ============================================================================
//  유틸리티 — 난수, 보간, 노이즈, 포맷터
// ============================================================================

/** 시드 기반 난수 (mulberry32) */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = t => t * t * (3 - 2 * t);

/** 값 목표치로 서서히 수렴 */
export const approach = (cur, target, rate) => cur + (target - cur) * rate;

/** 2D 밸류 노이즈 (옥타브 합성) */
export function makeNoise2D(seed) {
  const rng = makeRng(seed);
  const P = new Uint8Array(512);
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
  }
  for (let i = 0; i < 512; i++) P[i] = perm[i & 255];

  const grad = (h, x, y) => {
    switch (h & 3) {
      case 0: return x + y;
      case 1: return -x + y;
      case 2: return x - y;
      default: return -x - y;
    }
  };

  function noise(x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = smooth(xf), v = smooth(yf);
    const aa = P[P[X] + Y], ab = P[P[X] + Y + 1];
    const ba = P[P[X + 1] + Y], bb = P[P[X + 1] + Y + 1];
    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v); // 대략 -1..1
  }

  return function fbm(x, y, octaves = 4, lac = 2, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += noise(x * freq, y * freq) * amp;
      norm += amp;
      amp *= gain; freq *= lac;
    }
    return sum / norm; // -1..1
  };
}

// ---------------------------------------------------------------------------
//  숫자 포맷
// ---------------------------------------------------------------------------
export function fmtInt(n) {
  return Math.round(n).toLocaleString('ko-KR');
}

export function fmtMoney(n) {
  const s = n < 0 ? '-' : '';
  const a = Math.abs(Math.round(n));
  return s + '₡' + a.toLocaleString('ko-KR');
}

export function fmtShort(n) {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (a >= 1e4) return (n / 1e3).toFixed(0) + 'k';
  if (a >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return Math.round(n).toString();
}

export function fmtPct(v, digits = 0) {
  return (v * 100).toFixed(digits) + '%';
}

// ---------------------------------------------------------------------------
//  간단한 이진 힙 (A* 용)
// ---------------------------------------------------------------------------
export class MinHeap {
  constructor() { this.items = []; this.prio = []; this.n = 0; }
  clear() { this.n = 0; }
  push(item, p) {
    let i = this.n++;
    this.items[i] = item; this.prio[i] = p;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (this.prio[par] <= this.prio[i]) break;
      this._swap(par, i); i = par;
    }
  }
  pop() {
    if (this.n === 0) return undefined;
    const top = this.items[0];
    this.n--;
    if (this.n > 0) {
      this.items[0] = this.items[this.n];
      this.prio[0] = this.prio[this.n];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.n && this.prio[l] < this.prio[m]) m = l;
        if (r < this.n && this.prio[r] < this.prio[m]) m = r;
        if (m === i) break;
        this._swap(m, i); i = m;
      }
    }
    return top;
  }
  _swap(a, b) {
    const ti = this.items[a]; this.items[a] = this.items[b]; this.items[b] = ti;
    const tp = this.prio[a]; this.prio[a] = this.prio[b]; this.prio[b] = tp;
  }
  get size() { return this.n; }
}

/** 이동 평균 링버퍼 (통계 그래프용) */
export class Series {
  constructor(len = 240) { this.len = len; this.data = []; }
  push(v) {
    this.data.push(v);
    if (this.data.length > this.len) this.data.shift();
  }
  get last() { return this.data.length ? this.data[this.data.length - 1] : 0; }
  get max() { let m = 0; for (const v of this.data) if (v > m) m = v; return m; }
  get min() { let m = Infinity; for (const v of this.data) if (v < m) m = v; return this.data.length ? m : 0; }
}
