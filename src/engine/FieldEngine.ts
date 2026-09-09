import { clamp, damp, lerp, smoothstep } from './math';
import { Simplex } from './noise';
import { sampleText, sampleStamp } from './sampler';

/**
 * FieldEngine —— 全站唯一乐器：一片墨尘之场。
 *
 * 五种组织状态（drive ∈ [0,4]，由滚动连续驱动）：
 *   0 弥散 CHAOS    旋度噪声布朗漂移
 *   1 凝流 STREAM   层流：思路顺流成河
 *   2 结晶 LATTICE  收紧到确定性晶格格点，约束即骨架
 *   3 应答 DIALOGUE 场只对指针显形：环侍、收拢、迸发
 *   4 归一 CODA     聚回一点呼吸，卫星尘埃绕行
 *
 * 状态之间不是切换而是混融：上一态的力场参数按平滑权重衰减进下一态，
 * 动量是延续的——这是“同一片场”而非“五个区块”的物理证据。
 * 成形系统（Formations）叠加于状态之上：首屏问号、章印、终印
 * 都是这同一场尘埃被叙事临时“借走”，结束后如数归还。
 */

export const STATE_NAMES = ['弥散', '凝流', '结晶', '应答', '归一'] as const;
export const STATE_CODES = ['CHAOS', 'STREAM', 'LATTICE', 'DIALOGUE', 'CODA'] as const;

const PAPER = '#F4F0E6';
const INK_R = 24, INK_G = 20, INK_B = 16;
const VERM_R = 195, VERM_G = 61, VERM_B = 27;

const SERIF_FONT_STACK = '"Noto Serif SC","Songti SC","SimSun",serif';

interface Member { p: number; delay: number; }

interface Formation {
  id: string;
  members: Member[];
  phase: 'gather' | 'release' | 'dead';
  t: number;            // 阶段内计时 ms
  strength: number;     // 成形强度 0..1，控制弹簧与朱砂浓度
  rel?: Float32Array;   // 相对锚点的字形点（可重定位的印）
  ax?: number; ay?: number;
}

interface Seed {
  x: number; y: number;
  born: number;
  targetR: number;
  curR: number;
}

export class FieldEngine {
  private cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private W = 1; private H = 1;

  private N = 0;
  private px!: Float32Array; private py!: Float32Array;
  private vx!: Float32Array; private vy!: Float32Array;
  private psize!: Float32Array; private palpha!: Float32Array;
  private h1!: Float32Array; private h2!: Float32Array;
  private slotX!: Float32Array; private slotY!: Float32Array;
  private tickFlag!: Uint8Array; // 一部分粒子渲染为顺速度方向的短笔画

  private bindTo = new Int32Array(0);        // 粒子 -> 成形占用标记，-1 自由
  private btx!: Float32Array; private bty!: Float32Array;
  private bDelay!: Float32Array;             // 每粒被借尘埃的启动延迟（ms）
  private binds: Array<Formation | null> = [];

  private noise = new Simplex(20240826);

  private T = 0;
  private drive = 0;
  private driveSmoothed = 0;

  private pointerX = -9999; private pointerY = -9999;
  private pointerVX = 0; private pointerVY = 0;
  private pointerLastT = -99;
  private lastSwirlT = -999;
  private holding = false;
  private charge = 0;
  private holdMs = 0;
  private longestHoldMs = 0;
  private turbCount = 0;
  private gust = 0;

  private formations: Formation[] = [];
  private fmCursor = 0;

  private seeds: Seed[] = [];
  private stillMode = false;
  private blueprint = false;

  private rafId = 0;
  private running = false;
  private fpsEma = 60;
  private lastFrame = 0;
  private introDone = false;
  private introTimers: number[] = [];
  private onIntroDone: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.allocate(this.calcBudget());
    this.setViewport();
  }

  // ---------- 预算与尺寸 ----------

  private calcBudget(): number {
    const area = window.innerWidth * window.innerHeight;
    const mobile = Math.min(window.innerWidth, window.innerHeight) < 720;
    const cores = navigator.hardwareConcurrency || 4;
    let n = Math.round(area / (mobile ? 900 : 600));
    return clamp(n, mobile ? 520 : 1000, cores <= 4 ? 2000 : 2600);
  }

  private allocate(n: number) {
    this.N = n;
    this.px = new Float32Array(n); this.py = new Float32Array(n);
    this.vx = new Float32Array(n); this.vy = new Float32Array(n);
    this.psize = new Float32Array(n); this.palpha = new Float32Array(n);
    this.h1 = new Float32Array(n); this.h2 = new Float32Array(n);
    this.slotX = new Float32Array(n); this.slotY = new Float32Array(n);
    this.tickFlag = new Uint8Array(n);
    this.btx = new Float32Array(n); this.bty = new Float32Array(n);
    this.bindTo = new Int32Array(n).fill(-1);
    this.binds = new Array(n).fill(null);
    this.vermMix = new Float32Array(n);
    this.bDelay = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.h1[i] = hash01(i * 7 + 1);
      this.h2[i] = hash01(i * 13 + 5);
      this.psize[i] = 1.05 + this.h1[i] * 1.6;   // 1.05~2.65px，含少量粗颗粒
      this.palpha[i] = 0.5 + this.h2[i] * 0.42;  // 墨要敢于黑
      this.tickFlag[i] = this.h1[i] > 0.86 ? 1 : 0;
      // 出生即满场分布——场从一开始就是完整的，不存在“从角落涌入”
      this.px[i] = this.h1[i] * window.innerWidth;
      this.py[i] = this.h2[i] * window.innerHeight;
      this.vx[i] = (hash01(i * 29 + 3) - 0.5) * 40;
      this.vy[i] = (hash01(i * 31 + 9) - 0.5) * 40;
    }
  }

  setViewport() {
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    const dpr = clamp(window.devicePixelRatio || 1, 1, 1.75);
    this.cv.width = Math.round(this.W * dpr);
    this.cv.height = Math.round(this.H * dpr);
    this.cv.style.width = this.W + 'px';
    this.cv.style.height = this.H + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.computeSlots();
    this.paintPaper();
    if (this.stillMode) this.composeStill(Math.round(this.drive));
  }

  /** 结晶态格点：哈希剔除约三成——晶格要有呼吸的孔洞。 */
  private computeSlots() {
    const cs = Math.min(this.W, this.H) < 720 ? 30 : 36;
    const cols = Math.ceil(this.W / cs), rows = Math.ceil(this.H / cs);
    const ox = (this.W - (cols - 1) * cs) / 2;
    const oy = (this.H - (rows - 1) * cs) / 2;
    const occupied: Array<[number, number]> = [];
    for (let gy = 0; gy < rows; gy++)
      for (let gx = 0; gx < cols; gx++)
        if (hash01(gx * 131 + gy * 31 + 7) > 0.3) occupied.push([ox + gx * cs, oy + gy * cs]);
    for (let i = 0; i < this.N; i++) {
      const pick = occupied[Math.floor(hash01(i * 101 + 17) * occupied.length)] ?? [this.W / 2, this.H / 2];
      this.slotX[i] = pick[0] + (hash01(i * 57 + 3) - 0.5) * 5;
      this.slotY[i] = pick[1] + (hash01(i * 89 + 11) - 0.5) * 5;
    }
  }

  // ---------- 外部开关 ----------

  setDrive(d: number) { this.drive = clamp(d, 0, 4); }

  setStillMode(v: boolean) {
    if (v === this.stillMode) return;
    this.stillMode = v;
    this.clearTimers();
    if (v) {
      this.stop();
      this.holding = false; this.charge = 0;
      this.unbindAll();
      this.composeStill(Math.round(this.drive));
    } else {
      this.paintPaper();
      this.start();
    }
  }

  setBlueprint(v: boolean) {
    this.blueprint = v;
    if (v && this.stillMode) this.composeStill(Math.round(this.drive));
  }

  pauseForHidden(hidden: boolean) { hidden ? this.stop() : (!this.stillMode && this.start()); }

  // ---------- 指针事件 ----------

  pointerMove(x: number, y: number) {
    const now = performance.now();
    if (this.pointerLastT > 0 && !this.stillMode) {
      const dts = Math.max(0.008, (now - this.pointerLastT) / 1000);
      this.pointerVX = damp(this.pointerVX, (x - this.pointerX) / dts, 30, dts);
      this.pointerVY = damp(this.pointerVY, (y - this.pointerY) / dts, 30, dts);
      const sp = Math.hypot(this.pointerVX, this.pointerVY);
      // 注入节流：高轮询率指针不会把湍流变成飓风
      if (sp > 780 && !this.holding && now - this.lastSwirlT > 90) {
        this.lastSwirlT = now;
        this.turbCount++;
        this.injectSwirl(x, y, sp);
      }
    }
    this.pointerX = x; this.pointerY = y;
    this.pointerLastT = now / 1000;
  }

  private injectSwirl(x: number, y: number, speed: number) {
    const R = Math.min(200, this.W * 0.24);
    const pow = clamp(speed / 2600, 0.15, 1) * 230;
    for (let i = 0; i < this.N; i++) {
      const dx = this.px[i] - x, dy = this.py[i] - y;
      const r2 = dx * dx + dy * dy;
      if (r2 > R * R) continue;
      const r = Math.sqrt(r2) + 1e-4;
      const f = (1 - r / R) * pow;
      this.vx[i] += (-dy / r) * f;
      this.vy[i] += (dx / r) * f * 0.62 - f * 0.18;
    }
  }

  pressStart() {
    if (this.stillMode || !this.introDone) return;
    this.holding = true;
    this.holdMs = 0;
  }

  pressEnd() {
    if (!this.holding) return;
    this.holding = false;
    if (this.charge > 0.06) this.bloom(this.charge);
    this.longestHoldMs = Math.max(this.longestHoldMs, this.holdMs);
    this.charge = 0;
  }

  plantSeed(x: number, y: number): boolean {
    if (this.stillMode || !this.introDone) return false;
    if (this.seeds.length >= 5) this.seeds.shift();
    this.seeds.push({
      x, y, born: this.T,
      targetR: 54 + this.seeds.length * 15,
      curR: 0,
    });
    try { navigator.vibrate?.(10); } catch { /* 无触觉设备静默 */ }
    return true;
  }

  private bloom(power: number) {
    const R = 170 + power * 210;
    const kick = 190 + power * 430;
    for (let i = 0; i < this.N; i++) {
      const dx = this.px[i] - this.pointerX, dy = this.py[i] - this.pointerY;
      const r = Math.hypot(dx, dy) + 1e-4;
      if (r > R) continue;
      const f = kick * Math.pow(1 - r / R, 1.6) * (0.65 + this.h1[i] * 0.7);
      this.vx[i] += (dx / r) * f;
      this.vy[i] += (dy / r) * f;
    }
    try { navigator.vibrate?.(power > 0.7 ? [16, 42, 26] : 12); } catch { /* 忽略 */ }
  }

  // ---------- 成形系统 ----------

  /**
   * 借走一部分尘埃去“成为”某个形状。
   * pts 为绝对坐标点对；holdForever=true 的成形（章印）由调用方显式释放。
   */
  private form(id: string, pts: Float32Array, opts: {
    maxBind?: number; holdForever?: boolean;
    anchor?: { x: number; y: number };
  }): void {
    const total = pts.length / 2;
    const maxBind = Math.min(
      opts.maxBind ?? Math.floor(this.N * 0.44),
      this.N - 40,
      total, // 字形点有多少对，就最多借多少粒——多借的只会叠在末点上
    );
    const stride = Math.max(1, total / maxBind);
    if (total < 4) return;

    // 收集借用者；目标按 x 排序决定延迟 → 从左往右落墨的书写感
    // 注意：j 必须取整——Float32Array 的非整数下标会返回 undefined（NaN 源）
    const members: Member[] = [];
    const taken = new Set<number>();
    let minX = Infinity, maxX = -Infinity;
    for (let k = 0; k < maxBind; k++) {
      const j = Math.min(total - 1, Math.round(k * stride));
      let p = (this.fmCursor + members.length * 3 + ((members.length * 13) % 29)) % this.N;
      let ok = false;
      for (let q = 0; q < 23; q++) {
        const cand = (p + q * 7) % this.N;
        if (this.bindTo[cand] === -1 && !taken.has(cand)) { p = cand; ok = true; break; }
      }
      if (!ok) continue;
      taken.add(p);
      const x = pts[j * 2];
      const y = pts[j * 2 + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      this.btx[p] = x;
      this.bty[p] = y;
      members.push({ p, delay: 0 });
    }
    const width = Math.max(1, maxX - minX);
    const fm: Formation = { id, members, phase: 'gather', t: 0, strength: 0 };
    if (opts.anchor) {
      // 可重定位的印：保存相对字形，随章节平滑跟手
      fm.ax = opts.anchor.x;
      fm.ay = opts.anchor.y;
      fm.rel = new Float32Array(members.length * 2);
      for (let u = 0; u < members.length; u++) {
        const m = members[u];
        fm.rel[u * 2] = this.btx[m.p] - opts.anchor.x;
        fm.rel[u * 2 + 1] = this.bty[m.p] - opts.anchor.y;
      }
    }
    const spanMs = width > 300 ? 1500 : 1050; // 大字汇聚得慢些、庄重些
    for (const m of members) {
      m.delay = ((this.btx[m.p] - minX) / width) * spanMs * 0.72 + this.h1[m.p] * 150;
      this.bDelay[m.p] = m.delay;
      this.bindTo[m.p] = 1;
      this.binds[m.p] = fm;
    }
    this.formations.push(fm);
    this.fmCursor = (this.fmCursor + 47) % this.N;
  }

  playIntro(onDone: () => void) {
    this.onIntroDone = onDone;
    const boxW = Math.min(this.W * (Math.min(this.W, this.H) < 720 ? 0.62 : 0.46), 500);
    const boxH = boxW * 1.2;
    const mobile = Math.min(this.W, this.H) < 720;
    const pts = sampleText({
      text: '?',
      font: `900 ${Math.round(boxH)}px ${SERIF_FONT_STACK}`,
      boxW, boxH,
      gap: mobile ? 5 : 5.5,
    });
    const cx = this.W / 2, cy = this.H * 0.5 - boxH * 0.08;
    for (let i = 0; i < pts.length; i += 2) { pts[i] += cx; pts[i + 1] += cy; }
    this.introDone = false;
    this.form('intro-q', pts, { maxBind: Math.floor(this.N * (mobile ? 0.58 : 0.46)) });
    // 时序：沉静 0.45s → 书写汇聚 ~1.6s → 站立 1.1s → 一阵风散场 → 标题显影
    this.introTimers.push(
      window.setTimeout(() => { this.gust = 1; this.releaseAllFormations(); }, 3350),
      window.setTimeout(() => {
        this.introDone = true;
        this.onIntroDone?.();
        this.onIntroDone = null;
      }, 4300),
    );
  }

  replayIntro() {
    this.clearTimers();
    this.releaseAllFormations(true);
    this.gust = 0;
    window.setTimeout(() => this.playIntro(() =>
      window.dispatchEvent(new CustomEvent('unformed:introdone'))), 350);
  }

  /** 深链/刷新落在页中或 reduced-motion：直接视为“问号已散场” */
  skipIntro() {
    this.clearTimers();
    this.introDone = true;
    this.onIntroDone = null;
  }

  showSeal(id: string, cx: number, cy: number, char: string, size: number) {
    if (this.formations.some((f) => f.id === id)) {
      this.moveSeal(id, cx, cy);
      return;
    }
    const mobile = Math.min(this.W, this.H) < 720;
    const stamp = sampleStamp(cx, cy, size, Math.max(5, size * 0.07));
    const glyph = sampleText({
      text: char,
      font: `900 ${Math.round(size * 0.58)}px ${SERIF_FONT_STACK}`,
      boxW: size * 0.74, boxH: size * 0.74,
      gap: mobile ? 5 : 3.8,
    });
    const merged = new Float32Array(stamp.length + glyph.length);
    merged.set(stamp, 0);
    for (let i = 0; i < glyph.length; i += 2) {
      merged[stamp.length + i] = cx + glyph[i];
      merged[stamp.length + i + 1] = cy + glyph[i + 1];
    }
    this.form(id, merged, {
      holdForever: true,
      maxBind: Math.floor(this.N * 0.36),
      anchor: { x: cx, y: cy },
    });
  }

  /** 印随章动：重设锚点，被借的尘埃用既有弹簧滑到新位置 */
  private moveSeal(id: string, nx: number, ny: number) {
    const f = this.formations.find((q) => q.id === id);
    if (!f || !f.rel || f.ax === undefined || f.ay === undefined) return;
    const dx = nx - f.ax, dy = ny - f.ay;
    if (Math.abs(dx) < 1.5 && Math.abs(dy) < 1.5) return;
    for (const m of f.members) {
      this.btx[m.p] += dx;
      this.bty[m.p] += dy;
    }
    f.ax = nx;
    f.ay = ny;
  }

  releaseSeal(id: string) {
    const f = this.formations.find((q) => q.id === id);
    if (f && f.phase === 'gather') {
      f.phase = 'release';
      f.t = 0;
    }
  }

  private releaseAllFormations(immediate = false) {
    for (const f of this.formations) {
      if (f.phase !== 'dead') {
        f.phase = 'release';
        f.t = immediate ? 99999 : 0;
      }
    }
  }

  private clearTimers() {
    for (const t of this.introTimers) clearTimeout(t);
    this.introTimers.length = 0;
  }

  private unbindAll() {
    for (let i = 0; i < this.N; i++) {
      this.bindTo[i] = -1;
      this.binds[i] = null;
    }
    this.formations.length = 0;
  }

  /** 成形的生命周期推进 */
  private updateFormations(dtMs: number) {
    for (const f of this.formations) {
      if (f.phase === 'gather') {
        f.t += dtMs;
        f.strength = Math.min(1, f.strength + dtMs / 750);
      } else if (f.phase === 'release') {
        f.t += dtMs;
        f.strength -= dtMs / 700;
        if (f.strength <= 0) {
          f.phase = 'dead';
          const scatter = 60 + this.gust * 190;
          for (const m of f.members) {
            const p = m.p;
            this.bindTo[p] = -1;
            this.binds[p] = null;
            // 松绑的尘埃带着各自的脾气离席
            this.vx[p] += (this.h2[p] - 0.5) * scatter - scatter * 0.35 * this.gust;
            this.vy[p] += (this.h1[p] - 0.5) * scatter;
          }
        }
      }
    }
    if (this.formations.some((f) => f.phase === 'dead')) {
      this.formations = this.formations.filter((f) => f.phase !== 'dead');
    }
    if (this.gust > 0) this.gust = Math.max(0, this.gust - dtMs / 2600);
  }

  // ---------- 物理主循环 ----------

  start() {
    if (this.running || this.stillMode) return;
    this.running = true;
    this.lastFrame = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const rawDt = now - this.lastFrame;
      this.lastFrame = now;
      const dt = clamp(rawDt, 4, 33) / 1000;
      this.fpsEma = lerp(this.fpsEma, 1000 / Math.max(rawDt, 1), 0.05);
      this.step(dt, rawDt);
      this.render(false);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private step(dt: number, rawDtMs: number) {
    this.T += dt;
    this.driveSmoothed = damp(this.driveSmoothed, this.drive, 7, dt);
    const w = stateWeights(this.driveSmoothed);

    if (this.holding) {
      this.holdMs += rawDtMs;
      this.charge = Math.min(1, this.charge + rawDtMs / 1700);
    }

    this.updateFormations(rawDtMs);

    const breathR = Math.min(this.W, this.H) * 0.3 + Math.sin(this.T * 0.55) * 13;
    const cx = this.W / 2, cy = this.H / 2;
    const pIdleS = this.T - this.pointerLastT;
    // 应答态注意力权重：指针在场 0~2s 满格，2~4.5s 温柔倦怠
    const attendW = pIdleS < 2 ? 1 : smoothstep(clamp(1 - (pIdleS - 2) / 2.5, 0, 1));

    const seedArr = this.seeds;
    const nSeeds = seedArr.length;

    for (let i = 0; i < this.N; i++) {
      let ax = 0, ay = 0;
      const xi = this.px[i], yi = this.py[i];

      if (w[0] > 0.001) { // 弥散
        const s = 0.0016, t = this.T * 0.11;
        const wl = w[0];
        const [cxr, cyr] = this.noise.curl(xi * s, yi * s + t);
        ax += cxr * 74 * wl; ay += cyr * 74 * wl;
        ax += (this.noise.noise2D(t * 0.3 + this.h1[i] * 9, 0) - 0.5) * 6 * wl;
      }
      if (w[1] > 0.001) { // 凝流
        const wl = w[1];
        const meander =
          this.noise.noise2D(xi * 0.002, this.T * 0.22) * 2.2 +
          Math.sin(yi * 0.0072 + this.T * 0.5);
        const laneY = cy + Math.sin(xi * 0.0026 + this.T * 0.35) * this.H * 0.2;
        ax += (86 + meander * 34) * wl;
        ay += (meander * 22 - (yi - laneY) * 1.5) * wl;
      }
      if (w[2] > 0.001) { // 结晶
        const wl = w[2];
        ax += (this.slotX[i] - xi) * 34 * wl;
        ay += (this.slotY[i] - yi) * 34 * wl;
      }
      if (w[3] > 0.001) { // 应答：以指针为圆心环侍
        const wl = w[3] * attendW;
        if (wl > 0.15) { // 阈值以下不许场被指针拽走——倦怠时归于自处
          const ang = this.h1[i] * Math.PI * 2 + this.T * 0.14;
          const rr = 148 + Math.sin(this.T * 0.8 + this.h2[i] * 9) * 12;
          ax += (this.pointerX + Math.cos(ang) * rr - xi) * 5.5 * wl;
          ay += (this.pointerY + Math.sin(ang) * rr - yi) * 5.5 * wl;
        } else {
          ax += 5 * w[3]; ay += 2.4 * w[3]; // 待机的极轻漂移
        }
      }
      if (w[4] > 0.001) { // 归一：一枚巨大的呼吸环拥抱着终章文字
        const wl = w[4];
        const dx = cx - xi, dy = cy - yi;
        const r = Math.hypot(dx, dy) + 1e-4;
        const sat = this.h2[i] > 0.9;                    // 少数做外环卫星
        const ambient = this.h2[i] < 0.05;               // 更少留作全场呼吸的底噪
        if (sat) {
          const want = breathR * 1.34 + this.h1[i] * 56 + Math.sin(this.T * 0.5 + this.h1[i] * 7) * 12;
          const radial = (r - want) * 6.5;
          ax += ((dx / r) * radial - (dy / r) * 50) * wl;
          ay += ((dy / r) * radial + (dx / r) * 50) * wl;
        } else if (ambient) {
          // 底噪：极慢的旋度漂移，让静定里仍有生命
          const s = 0.0021;
          const [cxr, cyr] = this.noise.curl(xi * s, yi * s + this.T * 0.06);
          ax += cxr * 16 * wl; ay += cyr * 16 * wl;
        } else {
          const myR = breathR + (this.h1[i] - 0.5) * 36;
          const shell = (r - myR) * 7.5;
          let ar = (dx / r) * shell;
          let ai = (dy / r) * shell;
          const innerVoid = breathR * 0.42;
          if (r < innerVoid) {                            // 环心留空给文字
            ar -= (dx / r) * (innerVoid - r) * 10;
            ai -= (dy / r) * (innerVoid - r) * 10;
          }
          ax += ar * wl + dx * 0.9 * wl;
          ay += ai * wl + dy * 0.9 * wl;
        }
      }

      // 种子晶圈（跨状态常驻的访客锚点）
      for (let s = 0; s < nSeeds; s++) {
        const sd = seedArr[s];
        sd.curR = damp(sd.curR, sd.targetR, 2.2, dt);
        const dx = xi - sd.x, dy = yi - sd.y;
        const r = Math.hypot(dx, dy) + 1e-4;
        if (r > 15 && r < 160) {
          const want = sd.curR + Math.sin(this.h1[i] * 41) * 8;
          const k = (r - want) * 8.5;
          ax -= (dx / r) * k;
          ay -= (dy / r) * k;
        }
      }

      // 蓄力收拢：带一点涡旋的引力，像沙漏里被搅起的沙
      if (this.charge > 0.004) {
        const dx = this.pointerX - xi, dy = this.pointerY - yi;
        const r = Math.hypot(dx, dy) + 1e-4;
        let pull = (360 + this.charge * 1500) / (r * 0.032 + 1);
        pull = Math.min(pull, 2700);
        const ux = dx / r, uy = dy / r;
        ax += ux * pull - uy * pull * 0.34;
        ay += uy * pull + ux * pull * 0.34;
      }

      // 成形约束：被借走的尘埃向自己的字形点咬合；重阻尼让它一次到位
      if (this.bindTo[i] !== -1) {
        const fm = this.binds[i];
        if (fm && fm.t > this.bDelay[i]) {
          const rel = clamp(fm.t - this.bDelay[i], 0, 450) / 450;
          const k = 95 + 165 * rel;
          ax += (this.btx[i] - xi) * k * fm.strength;
          ay += (this.bty[i] - yi) * k * fm.strength;
        }
      }

      // 积分与阻尼
      this.vx[i] += ax * dt;
      this.vy[i] += ay * dt;
      let drag =
        2.0 * w[0] + 1.3 * w[1] + 9.5 * w[2] + 2.2 * w[3] + 4.6 * w[4];
      if (this.bindTo[i] !== -1) drag += 14;            // 成形中的尘埃要“定”得住
      const dg = Math.exp(-drag * dt);
      const nvx = this.vx[i] * dg, nvy = this.vy[i] * dg;
      this.vx[i] = nvx; this.vy[i] = nvy;
      this.px[i] = xi + nvx * dt;
      this.py[i] = yi + nvy * dt;

      // 边界环绕（结晶/归一态不需要通量，改为软回弹）
      if (this.bindTo[i] === -1) {
        const wrapOK = w[0] + w[1] > 0.5;
        if (wrapOK) {
          if (this.px[i] < -34) this.px[i] += this.W + 68;
          else if (this.px[i] > this.W + 34) this.px[i] -= this.W + 68;
          if (this.py[i] < -34) this.py[i] += this.H + 68;
          else if (this.py[i] > this.H + 34) this.py[i] -= this.H + 68;
        } else {
          const M = 26;
          if (this.px[i] < -M) this.px[i] = -M;
          else if (this.px[i] > this.W + M) this.px[i] = this.W + M;
          if (this.py[i] < -M) this.py[i] = -M;
          else if (this.py[i] > this.H + M) this.py[i] = this.H + M;
        }
      }
    }

    // 环境阵风（首屏问号散场）：加速度形式，帧率无关
    if (this.gust > 0.004) {
      const g = this.gust;
      for (let i = 0; i < this.N; i++) {
        if (this.bindTo[i] !== -1) continue;
        this.vx[i] -= g * 780 * dt * (0.6 + this.h1[i]);
        this.vy[i] += (this.h2[i] - 0.5) * g * 620 * dt;
      }
    }
  }

  // ---------- 渲染 ----------

  private paintPaper() {
    this.ctx.fillStyle = PAPER;
    this.ctx.fillRect(0, 0, this.W, this.H);
  }

  private trailAlpha(): number {
    const w = stateWeights(this.driveSmoothed);
    return 0.13 * w[0] + 0.22 * w[1] + 0.07 * w[2] + 0.1 * w[3] + 0.085 * w[4];
  }

  /** reduced-motion 替代构图：把指定状态松弛到平衡后画完整一帧 */
  private composeStill(stateRaw: number) {
    const state = clamp(Math.round(stateRaw), 0, 4);
    this.drive = state;
    this.driveSmoothed = state;
    const cx = this.W / 2, cy = this.H / 2;
    for (let i = 0; i < this.N; i++) {
      const a = this.h1[i] * Math.PI * 2;
      if (state === 2) {
        this.px[i] = this.slotX[i]; this.py[i] = this.slotY[i];
        this.vx[i] = 0; this.vy[i] = 0;
      } else if (state === 4) {
        const sat = this.h2[i] > 0.9;
        const amb = this.h2[i] < 0.05;
        const R0 = Math.min(this.W, this.H) * 0.3;
        if (amb) {
          this.px[i] = this.h1[i] * this.W; this.py[i] = this.h2[i] * this.H;
        } else {
          const r = sat ? R0 * 1.34 + this.h1[i] * 56 : R0 + (this.h1[i] - 0.5) * 36;
          this.px[i] = cx + Math.cos(a) * r; this.py[i] = cy + Math.sin(a) * r;
        }
        this.vx[i] = 0; this.vy[i] = 0;
      } else if (state === 0) {
        const r = Math.sqrt(this.h2[i]) * Math.min(cx, cy) * 0.94;
        this.px[i] = cx + Math.cos(a) * r; this.py[i] = cy + Math.sin(a) * r;
        this.vx[i] = 0; this.vy[i] = 0;
      } else {
        // 流与应答态：给一组水平层流带
        const band = Math.sin((this.h2[i] - 0.5) * Math.PI * 3);
        const yy = cy + band * this.H * 0.34;
        this.px[i] = this.h1[i] * this.W; this.py[i] = yy + Math.sin(this.h1[i] * 20) * 26;
        this.vx[i] = 60; this.vy[i] = 0;
      }
    }
    this.paintPaper();
    this.render(true);
    this.drive = state;
  }

  private render(forceFull: boolean) {
    const ta = forceFull ? 1 : this.trailAlpha();
    this.ctx.globalAlpha = ta >= 0.99 ? 1 : ta;
    this.ctx.fillStyle = PAPER;
    this.ctx.fillRect(0, 0, this.W, this.H);
    this.ctx.globalAlpha = 1;

    const bp = this.blueprint;

    if (bp) { // 底稿模式的制图网格：细若铅笔，退居气氛之后
      this.ctx.strokeStyle = 'rgba(58,52,44,0.045)';
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      for (let x = 32; x < this.W; x += 64) { this.ctx.moveTo(x + 0.5, 0); this.ctx.lineTo(x + 0.5, this.H); }
      for (let y = 32; y < this.H; y += 64) { this.ctx.moveTo(0, y + 0.5); this.ctx.lineTo(this.W, y + 0.5); }
      this.ctx.stroke();
    }

    for (const sd of this.seeds) {
      const a = Math.min(0.42, (this.T - sd.born) * 0.4);
      this.ctx.strokeStyle = `rgba(${VERM_R},${VERM_G},${VERM_B},${a.toFixed(3)})`;
      this.ctx.lineWidth = 1.1;
      this.ctx.beginPath();
      this.ctx.arc(sd.x, sd.y, sd.curR, 0, Math.PI * 2);
      this.ctx.stroke();
      this.ctx.fillStyle = `rgba(${VERM_R},${VERM_G},${VERM_B},${(a * 1.6).toFixed(3)})`;
      this.ctx.fillRect(sd.x - 2, sd.y - 2, 4, 4);
    }

    if (this.charge > 0.01) { // 蓄力环：按住越久，询问越重
      const r = 22 + this.charge * 98;
      this.ctx.strokeStyle = `rgba(${VERM_R},${VERM_G},${VERM_B},${(0.22 + this.charge * 0.55).toFixed(3)})`;
      this.ctx.lineWidth = 1.2 + this.charge * 1.6;
      this.ctx.setLineDash([6, 7]);
      this.ctx.lineDashOffset = -this.T * 34;
      this.ctx.beginPath();
      this.ctx.arc(this.pointerX, this.pointerY, r, 0, Math.PI * 2);
      this.ctx.stroke();
      this.ctx.setLineDash([]);
    }

    const aw = stateWeights(this.driveSmoothed)[3];
    if (aw > 0.15 && this.pointerLastT > 0 && this.T - this.pointerLastT < 4 && !bp) {
      this.ctx.strokeStyle = `rgba(${INK_R},${INK_G},${INK_B},${(0.13 * aw).toFixed(3)})`;
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      this.ctx.arc(this.pointerX, this.pointerY, 152 + Math.sin(this.T * 1.25) * 7, 0, Math.PI * 2);
      this.ctx.stroke();
    }

    const tw = stateWeights(this.driveSmoothed);
    const inkScale = 1 - 0.3 * tw[2];
    // 诊断计数（每帧刷新到 window，供自动化测试只读探查）
    let dbgOff = 0, dbgNan = 0, dbgBound = 0;
    let bCx = 0, bCy = 0, bRms = 0, bTxCx = 0, bTxCy = 0;
    for (let i = 0; i < this.N; i++) {
      const x = this.px[i], y = this.py[i];
      if (Number.isNaN(x) || Number.isNaN(y)) { dbgNan++; continue; }
      if (x < -14 || x > this.W + 14 || y < -14 || y > this.H + 14) { dbgOff++; continue; }
      if (this.bindTo[i] !== -1) {
        dbgBound++;
        bCx += x; bCy += y; bTxCx += this.btx[i]; bTxCy += this.bty[i];
        bRms += (x - this.btx[i]) ** 2 + (y - this.bty[i]) ** 2;
      }
      const vm = this.vermOf(i);
      const cr = (INK_R + (VERM_R - INK_R) * vm) | 0;
      const cg = (INK_G + (VERM_G - INK_G) * vm) | 0;
      const cb = (INK_B + (VERM_B - INK_B) * vm) | 0;
      const al = Math.min(1, this.palpha[i] * inkScale + vm * 0.42);
      const col = `rgba(${cr},${cg},${cb},${al.toFixed(3)})`;
      const s = this.psize[i] * (1 + vm * 0.95);

      if (bp) {
        // 底稿：每个点是一小段速度矢量刻度；近静止时退化为坐标点
        const vx = this.vx[i], vy = this.vy[i];
        const vl = Math.hypot(vx, vy);
        if (vl > 6) {
          const ex = (vx / vl) * 8, ey = (vy / vl) * 8;
          this.ctx.strokeStyle = col;
          this.ctx.lineWidth = 1;
          this.ctx.beginPath();
          this.ctx.moveTo(x - ex, y - ey);
          this.ctx.lineTo(x + ex, y + ey);
          this.ctx.stroke();
        } else {
          this.ctx.fillStyle = col;
          this.ctx.fillRect(x - 1, y - 1, 2, 2);
        }
      } else if (this.tickFlag[i] === 1) {
        const vx = this.vx[i], vy = this.vy[i];
        const nl = Math.hypot(vx, vy);
        if (nl > 62) {
          const ux = vx / nl, uy = vy / nl;
          const hl = Math.min(11, nl * 0.026);
          this.ctx.strokeStyle = col;
          this.ctx.lineWidth = s;
          this.ctx.beginPath();
          this.ctx.moveTo(x - ux * hl, y - uy * hl);
          this.ctx.lineTo(x + ux * hl, y + uy * hl);
          this.ctx.stroke();
        } else {
          this.ctx.fillStyle = col;
          this.ctx.fillRect(x - s / 2, y - s / 2, s, s);
        }
      } else {
        this.ctx.fillStyle = col;
        this.ctx.fillRect(x - s / 2, y - s / 2, s, s);
      }
    }
    (window as unknown as Record<string, unknown>).__unformed = {
      at: Date.now(),
      off: dbgOff,
      nan: dbgNan,
      bound: dbgBound,
      boundCentroid: dbgBound ? { x: Math.round(bCx / dbgBound), y: Math.round(bCy / dbgBound) } : null,
      targetCentroid: dbgBound ? { x: Math.round(bTxCx / dbgBound), y: Math.round(bTxCy / dbgBound) } : null,
      boundRms: dbgBound ? Math.round(Math.sqrt(bRms / dbgBound)) : 0,
      samples: (() => {
        const out: Array<Record<string, number>> = [];
        for (let i = 0; i < this.N && out.length < 4; i++) {
          if (this.bindTo[i] !== -1 && Number.isFinite(this.px[i])) {
            out.push({
              i, x: Math.round(this.px[i]), y: Math.round(this.py[i]),
              tx: Math.round(this.btx[i]), ty: Math.round(this.bty[i]),
              delay: Math.round(this.bDelay[i]),
            });
          }
        }
        return out;
      })(),
      formations: this.formations.map((f) => ({ id: f.id, phase: f.phase, t: Math.round(f.t), strength: +f.strength.toFixed(2), members: f.members.length })),
      ...this.getMetrics(),
    };
  }

  /** 朱砂度：被成形的尘埃随成形强度染色，松绑后墨色缓缓归还 */
  private vermMix = new Float32Array(0);

  private vermOf(i: number): number {
    if (this.bindTo[i] !== -1 && this.binds[i]) {
      this.vermMix[i] = Math.min(0.92, this.vermMix[i] + 0.02);
      return this.vermMix[i];
    }
    if (this.vermMix[i] > 0) this.vermMix[i] = Math.max(0, this.vermMix[i] - 0.03);
    return this.vermMix[i];
  }

  /** still 模式下滚动切章时由 App 调用：重新松弛并绘制一帧 */
  refreshStill() { if (this.stillMode) this.composeStill(this.drive); }

  // ---------- 读数 ----------

  getMetrics() {
    const di = clamp(Math.round(this.driveSmoothed), 0, 4);
    let binds = 0;
    for (let i = 0; i < this.N; i++) if (this.bindTo[i] !== -1) binds++;
    return {
      fps: Math.round(this.fpsEma),
      n: this.N,
      stateNo: String(di + 1).padStart(2, '0'),
      state: STATE_NAMES[di],
      code: STATE_CODES[di],
      drive: +this.driveSmoothed.toFixed(3),
      charge: +this.charge.toFixed(2),
      binds,
      seeds: this.seeds.length,
      turb: this.turbCount,
      longestHoldSec: +(this.longestHoldMs / 1000).toFixed(1),
      still: this.stillMode,
      introDone: this.introDone,
    };
  }

  destroy() {
    this.stop();
    this.clearTimers();
    this.unbindAll();
  }
}

function hash01(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** drive∈[0,4] → 五态混合权重；每章节前半程稳定呈现本态，后半程平滑滑入下一态。 */
function stateWeights(d: number): number[] {
  const w = [0, 0, 0, 0, 0];
  const base = clamp(Math.floor(d), 0, 4);
  const frac = d - base;
  const localHold = smoothstep(clamp((frac - 0.45) / 0.35, 0, 1));
  w[base] = 1 - localHold;
  if (localHold > 0) w[Math.min(base + 1, 4)] = localHold;
  return w;
}
