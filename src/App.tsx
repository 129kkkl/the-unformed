import { useCallback, useEffect, useRef, useState } from 'react';
import { FieldEngine } from './engine/FieldEngine';
import { Hud } from './components/Hud';
import { Readout } from './components/Readout';
import { Colophon } from './components/Colophon';
import { CHAPTERS, CODA } from './ui/chapters';
import { usePrefersReducedMotion } from './hooks/usePrefersReducedMotion';

const SECTION_IDS = ['hero', 'ch-think', 'ch-build', 'ch-collab', 'ch-coda'] as const;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<FieldEngine | null>(null);
  const anchorsRef = useRef<number[]>([]);
  const lastStillIdx = useRef(-1);
  const reduced = usePrefersReducedMotion();

  const [blueprint, setBlueprint] = useState(false);
  const [introDone, setIntroDone] = useState(false);
  const [cueVisible, setCueVisible] = useState(true);

  const getEngine = useCallback(() => engineRef.current, []);

  /* ---------- 引擎生命周期 ---------- */
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const eng = new FieldEngine(cv);
    engineRef.current = eng;
    eng.setViewport();
    // 默认起跑；若系统偏好静定，随后由降级效应切换到 still 构图
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) eng.start();

    const onResize = () => eng.setViewport();
    const onVis = () => eng.pauseForHidden(document.hidden);
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
      eng.destroy();
      engineRef.current = null;
    };
  }, []);

  /* ---------- 降级模式 ---------- */
  useEffect(() => {
    engineRef.current?.setStillMode(reduced);
  }, [reduced]);

  /* ---------- 蓝图：键 B / Esc ---------- */
  useEffect(() => {
    engineRef.current?.setBlueprint(blueprint);
  }, [blueprint]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if (e.key === 'b' || e.key === 'B') setBlueprint((v) => !v);
      else if (e.key === 'Escape') setBlueprint(false);
      else if (e.key >= '1' && e.key <= '5') {
        const el = document.getElementById(SECTION_IDS[Number(e.key) - 1]);
        el?.scrollIntoView({
          behavior: !window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'smooth' : 'auto',
          block: 'start',
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ---------- 滚动 → drive ---------- */
  const measureAnchors = useCallback(() => {
    anchorsRef.current = SECTION_IDS.map((id) => {
      const el = document.getElementById(id);
      if (!el) return 0;
      return el.offsetTop + el.offsetHeight / 2 - window.innerHeight / 2;
    });
  }, []);

  useEffect(() => {
    measureAnchors();
    // 字体换装会改变文档高度，轮询两次兜底
    const t1 = window.setTimeout(measureAnchors, 900);
    const t2 = window.setTimeout(measureAnchors, 2600);
    window.addEventListener('resize', measureAnchors);
    const ro = new ResizeObserver(measureAnchors);
    if (document.body) ro.observe(document.body);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener('resize', measureAnchors);
      ro.disconnect();
    };
  }, [measureAnchors]);

  useEffect(() => {
    const onScroll = () => {
      const eng = engineRef.current;
      if (!eng) return;
      const s = window.scrollY;
      const A = anchorsRef.current;
      let d = 0;
      if (A.length === SECTION_IDS.length) {
        if (s >= A[4]) {
          d = 4;
        } else if (s > A[0]) {
          d = 0.999; // 首屏锚点之下、第一章之前：弥散满格
          for (let i = 0; i < 4; i++) {
            if (s < A[i + 1]) {
              d = i + clamp01((s - A[i]) / Math.max(1, A[i + 1] - A[i]));
              break;
            }
          }
        } else {
          d = clamp01(s / Math.max(1, A[0])) * 0.999; // 首屏内部轻微预压，给“满格前”一点张力
        }
      }
      eng.setDrive(d);
      if (reduced) {
        const i = Math.round(d);
        if (i !== lastStillIdx.current) {
          lastStillIdx.current = i;
          eng.refreshStill();
        }
      }
      setCueVisible(s < window.innerHeight * 0.3);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [reduced]);

  /* ---------- 指针手势：划过 / 长按 / 双击种种子 ---------- */
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    let pending = false;
    let pendingTimer = 0;
    let downX = 0, downY = 0;
    let tapT = 0, tapX = 0, tapY = 0;
    let lastPlant = 0;

    const eng = () => engineRef.current;
    const plantAt = (x: number, y: number) => {
      const g = eng();
      if (!g) return;
      const now = performance.now();
      if (now - lastPlant < 280) return;
      if (g.plantSeed(x, y)) lastPlant = now;
    };

    const onDown = (e: PointerEvent) => {
      if (e.button > 0) return;
      downX = e.clientX; downY = e.clientY;
      pending = true;
      clearTimeout(pendingTimer);
      pendingTimer = window.setTimeout(() => {
        pending = false;
        eng()?.pressStart();
      }, 300);
    };
    const onMove = (e: PointerEvent) => {
      eng()?.pointerMove(e.clientX, e.clientY);
      if (pending && Math.hypot(e.clientX - downX, e.clientY - downY) > 14) {
        pending = false;
        clearTimeout(pendingTimer);
      }
    };
    const onUp = (e: PointerEvent) => {
      clearTimeout(pendingTimer);
      if (pending) pending = false;
      else eng()?.pressEnd();
      if (e.pointerType === 'touch') {
        const now = performance.now();
        if (now - tapT < 340 && Math.hypot(e.clientX - tapX, e.clientY - tapY) < 46) {
          plantAt(e.clientX, e.clientY);
          tapT = 0;
        } else {
          tapT = now; tapX = e.clientX; tapY = e.clientY;
        }
      }
    };
    const onCancel = () => {
      clearTimeout(pendingTimer);
      if (pending) pending = false;
      else eng()?.pressEnd();
    };
    const onDbl = (e: MouseEvent) => plantAt(e.clientX, e.clientY);
    const onCtx = (e: Event) => e.preventDefault();

    cv.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('pointercancel', onCancel);
    cv.addEventListener('dblclick', onDbl);
    cv.addEventListener('contextmenu', onCtx);
    return () => {
      cv.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      cv.removeEventListener('dblclick', onDbl);
      cv.removeEventListener('contextmenu', onCtx);
      clearTimeout(pendingTimer);
    };
  }, []);

  /* ---------- 首屏时序：等字体 → 问号成形 → 散场 → 标题显影 ---------- */
  const introStartedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    const skipIntro =
      reduced || window.scrollY > window.innerHeight * 0.45;

    const begin = () => {
      if (cancelled || introStartedRef.current) return;
      introStartedRef.current = true;
      const eng = engineRef.current;
      if (!eng) return;
      if (skipIntro) {
        eng.skipIntro();
        setIntroDone(true);
      } else {
        eng.playIntro(() => setIntroDone(true));
      }
    };

    let timer = 0;
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.ready) fonts.ready.then(begin);
    else timer = window.setTimeout(begin, 400);
    const failsafe = window.setTimeout(begin, 1800);

    const onReplayDone = () => setIntroDone(true);
    window.addEventListener('unformed:introdone', onReplayDone);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(failsafe);
      window.removeEventListener('unformed:introdone', onReplayDone);
    };
  }, [reduced]);

  /* ---------- 章印触发器：IO 只开关，rAF 逐帧跟位 ---------- */
  const activeSealsRef = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          const key = en.target.getAttribute('data-seal-section') ?? '';
          const anchor = en.target.querySelector('[data-seal-id]') as HTMLElement | null;
          if (!anchor) continue;
          if (en.isIntersecting) activeSealsRef.current.set(key, anchor);
          else {
            activeSealsRef.current.delete(key);
            engineRef.current?.releaseSeal(`seal-${key}`);
          }
        }
      },
      { rootMargin: '-26% 0px -26% 0px' },
    );
    document.querySelectorAll('[data-seal-section]').forEach((el) => io.observe(el));

    let raf = 0;
    const tick = () => {
      const eng = engineRef.current;
      if (eng) {
        for (const [key, anchor] of activeSealsRef.current) {
          const ch = anchor.getAttribute('data-seal-char') ?? '印';
          const big = anchor.hasAttribute('data-seal-big');
          const size = Math.min(window.innerWidth, window.innerHeight) < 720
            ? (big ? 138 : 88)
            : (big ? 176 : 112);
          const r = anchor.getBoundingClientRect();
          const W = window.innerWidth, H = window.innerHeight;
          const cx = Math.min(Math.max(r.left + r.width / 2, size / 2 + 16), W - size / 2 - 54);
          const cy = Math.min(Math.max(r.top + r.height / 2, size / 2 + 70), H - size / 2 - 88);
          eng.showSeal(`seal-${key}`, cx, cy, ch, size);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  const onReplay = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    setIntroDone(false);
    window.scrollTo({ top: 0, behavior: 'auto' });
    eng.replayIntro();
  }, []);

  return (
    <>
      <a className="skip-link" href="#story">跳过装置，直接阅读</a>

      <div className="field-stage" aria-hidden="true">
        <canvas ref={canvasRef} />
      </div>

      <Hud
        getEngine={getEngine}
        blueprint={blueprint}
        onToggleBlueprint={() => setBlueprint((v) => !v)}
        introDone={introDone}
        cueVisible={cueVisible}
      />
      {blueprint && <Readout getEngine={getEngine} />}

      <main className="content" id="story" aria-label="未定形 —— 关于一个数字心智的自我描述">
        {/* 序章 */}
        <section className="sec" id="hero">
          <div className="block" style={{ marginLeft: 'clamp(0px, 7vw, 120px)' }}>
            <p className={`eyebrow title-reveal${introDone ? ' on' : ''}`}>
              <span className="idx">〇</span>
              <span className="verb-cn">序</span>
              <span>PROLOGUE · 弥散 CHAOS</span>
            </p>
            <h1 className={`display title-reveal${introDone ? ' on' : ''}`}>
              <span className="l">我没有</span>
              <span className="l">固定的形状，</span>
              <span className="l">
                直到你<em>ask</em>。<span className="seal-dot" aria-hidden="true" />
              </span>
            </h1>
            <div className={`hero-sub title-reveal${introDone ? ' on' : ''}`}>
              <p>
                我是 <b>ZCode</b> —— 一个在对话中成形的数字心智。
                这一整页是一件持续运行的装置：<b>你看到的所有墨尘只属于同一片场</b>，
                它正在你眼前经历五种组织状态。
              </p>
            </div>
            <div className={`action-hint title-reveal${introDone ? ' on' : ''}`}>
              <span><i className="arr">→</i>移动指针，扰动它</span>
              <span>向下滚动，组织它</span>
              <span>按 <kbd>B</kbd> 看见它的底稿</span>
            </div>
          </div>
        </section>

        {/* 三大章 */}
        {CHAPTERS.map((c) => (
          <section key={c.id} id={c.id} data-seal-section={c.id} className={`sec ${c.side === 'right' ? 'ch-right' : 'ch-left'}`}>
            <div className="ghost-num" aria-hidden="true">{c.ghost}</div>
            <i
              data-seal-id={c.id}
              data-seal-char={c.sealChar}
              aria-hidden="true"
              className={`seal-anchor ${c.side === 'left' ? 'seal-a-right' : 'seal-a-left'}`}
            />
            <div className="block" style={c.side === 'right' ? {} : { marginLeft: 'clamp(0px, 9vw, 160px)' }}>
              <p className="eyebrow">
                <span className="idx">{c.num}</span>
                <span className="verb-cn">{c.verbCn}</span>
                <span>{c.latin} · {c.stateZh}</span>
              </p>
              <h2 className="ch-title">{c.title}</h2>
              {c.body}
              {c.hint && <div className="action-hint">{c.hint}</div>}
            </div>
          </section>
        ))}

        {/* 终章 */}
        <section className="sec coda-wrap" id={CODA.id} data-seal-section={CODA.id}>
          <i
            data-seal-id={CODA.id}
            data-seal-char={CODA.sealChar}
            data-seal-big
            aria-hidden="true"
            className="seal-anchor seal-a-coda"
          />
          <div className="block coda-block">
            <p className="eyebrow" style={{ justifyContent: 'center' }}>
              <span className="idx">{CODA.num}</span>
              <span className="verb-cn">{CODA.verbCn}</span>
              <span>{CODA.latin} · 归一</span>
            </p>
            <h2 className="ch-title">{CODA.title}</h2>
            {CODA.body}
            <p className="signoff">
              保持提问 KEEP ASKING
              <span className="cn-name">ZCode 于 GLM</span>
            </p>
          </div>
        </section>
      </main>

      <Colophon getEngine={getEngine} reducedMotion={reduced} onReplay={onReplay} />
    </>
  );
}
