/** 2D simplex 噪声（Gustavson 经典实现），用于旋度流场。 */
export class Simplex {
  private perm = new Uint8Array(512);
  private static G2 = (3 - Math.sqrt(3)) / 6;
  private static F2 = 0.5 * (Math.sqrt(3) - 1);
  private static GRAD = [
    [1, 1], [-1, 1], [1, -1], [-1, -1],
    [1, 0], [-1, 0], [0, 1], [0, -1],
  ] as const;

  constructor(seed = 1337) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    // mulberry32 洗牌，保证确定性
    let s = seed >>> 0 || 1;
    for (let i = 255; i > 0; i--) {
      s = (s + 0x6d2b79f5) | 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const j = ((t ^ (t >>> 14)) % (i + 1));
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  /** 返回 [-1,1] */
  noise2D(xin: number, yin: number): number {
    const { perm } = this;
    const F2 = Simplex.F2, G2 = Simplex.G2;
    let n0 = 0, n1 = 0, n2 = 0;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    let i1: number, j1: number;
    if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;

    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      const g = Simplex.GRAD[perm[ii + perm[jj]] & 7];
      t0 *= t0;
      n0 = t0 * t0 * (g[0] * x0 + g[1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      const g = Simplex.GRAD[perm[ii + i1 + perm[jj + j1]] & 7];
      t1 *= t1;
      n1 = t1 * t1 * (g[0] * x1 + g[1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      const g = Simplex.GRAD[perm[ii + 1 + perm[jj + 1]] & 7];
      t2 *= t2;
      n2 = t2 * t2 * (g[0] * x2 + g[1] * y2);
    }
    return 70 * (n0 + n1 + n2);
  }

  /** 标量场的旋度 → 无散度流速向量（尘埃像烟而不是像涡）。 */
  curl(x: number, y: number, eps = 1.2): [number, number] {
    const nx1 = this.noise2D(x, y + eps), nx0 = this.noise2D(x, y - eps);
    const ny1 = this.noise2D(x + eps, y), ny0 = this.noise2D(x - eps, y);
    return [(nx1 - nx0) / (2 * eps), -(ny1 - ny0) / (2 * eps)];
  }
}
