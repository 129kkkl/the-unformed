import { useEffect, useRef } from 'react';
import type { FieldEngine } from '../engine/FieldEngine';

const STATE_KEYS = ['chaos', 'stream', 'lattice', 'dialogue', 'coda'] as const;
const RAIL = [
  { no: '00', zh: '序', target: 'hero' },
  { no: '01', zh: '凝', target: 'ch-think' },
  { no: '02', zh: '构', target: 'ch-build' },
  { no: '03', zh: '答', target: 'ch-collab' },
  { no: '04', zh: '归', target: 'ch-coda' },
];

interface HudProps {
  getEngine: () => FieldEngine | null;
  blueprint: boolean;
  onToggleBlueprint: () => void;
  introDone: boolean;
  cueVisible: boolean;
}

/**
 * HUD：字标、状态轨、底稿开关、滚动提示。
 * 状态轨的滑块不是“到站切换”，而是连续映射 drive ——
 * 滚动与 UI 之间的因果肉眼可见。全部逐帧更新在一个 rAF 内直写 DOM，
 * 不经过 React 重渲染。
 */
export function Hud({ getEngine, blueprint, onToggleBlueprint, introDone, cueVisible }: HudProps) {
  const thumbRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const wordmarkRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    let lastActive = -2;
    const tick = () => {
      const eng = getEngine();
      if (eng) {
        const d = eng.getMetrics().drive;
        // 滑块：节点中心之间线性插值
        const el = thumbRef.current;
        const items = itemRefs.current.filter(Boolean) as HTMLButtonElement[];
        if (el && items.length === RAIL.length) {
          const cy = (i: number) => items[i].offsetTop + items[i].offsetHeight / 2;
          const i0 = Math.min(3, Math.max(0, Math.floor(d)));
          const frac = Math.min(1, Math.max(0, d - i0));
          el.style.transform = `translateY(${(cy(i0) * (1 - frac) + cy(i0 + 1) * frac - 4.5).toFixed(1)}px)`;
        }
        // 当前章字标高亮
        const act = Math.round(Math.min(4, Math.max(0, d)));
        if (act !== lastActive) {
          lastActive = act;
          items.forEach((b, i) => {
            b.classList.toggle('active', i === act);
            if (i === act) b.setAttribute('aria-current', 'steps');
            else b.removeAttribute('aria-current');
          });
          if (wordmarkRef.current) {
            wordmarkRef.current.dataset.state = STATE_KEYS[act];
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getEngine]);

  return (
    <>
      <header className="hud">
        <div className="wordmark" data-state="chaos" ref={wordmarkRef}>
          <span className="mark" aria-hidden="true" />
          <span className="words">
            <span className="cn">未定形</span>
            <br />
            <span className="en">THE UNFORMED</span>
          </span>
        </div>
        <button
          type="button"
          className="blueprint-toggle"
          aria-pressed={blueprint}
          onClick={onToggleBlueprint}
        >
          {blueprint ? '底稿 · 开' : '底稿'}<kbd style={{ marginLeft: 8 }}>B</kbd>
        </button>
      </header>

      <nav className="rail" aria-label="章节导航">
        <div className="rail-track" aria-hidden="true" />
        <div className="rail-thumb" ref={thumbRef} aria-hidden="true" />
        {RAIL.map((r, i) => (
          <RailItem
            key={r.target}
            {...r}
            idx={i}
            innerRef={(el) => { itemRefs.current[i] = el; }}
          />
        ))}
      </nav>

      <div className={`scroll-cue${introDone && cueVisible ? ' show' : ''}`} aria-hidden="true">
        <span>SCROLL</span>
        <span className="tick" />
      </div>
    </>
  );
}

function RailItem(props: {
  no: string; zh: string; target: string; idx: number;
  innerRef: (el: HTMLButtonElement | null) => void;
}) {
  const go = () => {
    document.getElementById(props.target)?.scrollIntoView({
      behavior:
        typeof window !== 'undefined' &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'smooth'
          : 'auto',
      block: 'start',
    });
  };
  return (
    <button type="button" className="rail-item" onClick={go} ref={props.innerRef}
      aria-label={`跳转${props.zh}`.replace('跳转序', '回到序章')}>
      <span className="zh">{props.zh}</span>
      <span className="no">{props.no}</span>
    </button>
  );
}
