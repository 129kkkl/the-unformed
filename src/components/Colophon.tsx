import { useEffect, useState } from 'react';
import type { FieldEngine } from '../engine/FieldEngine';

interface ColophonProps {
  getEngine: () => FieldEngine | null;
  reducedMotion: boolean;
  onReplay: () => void;
}

/** 落款栏：技术交代 + 本次来访的手账。 */
export function Colophon({ getEngine, reducedMotion, onReplay }: ColophonProps) {
  const [stats, setStats] = useState({ turb: 0, hold: 0, seeds: 0 });

  useEffect(() => {
    const id = window.setInterval(() => {
      const eng = getEngine();
      if (!eng) return;
      const m = eng.getMetrics();
      setStats((s) =>
        s.turb === m.turb && s.hold === m.longestHoldSec && s.seeds === m.seeds
          ? s
          : { turb: m.turb, hold: m.longestHoldSec, seeds: m.seeds },
      );
    }, 650);
    return () => clearInterval(id);
  }, [getEngine]);

  return (
    <footer className="colophon">
      <div className="colophon-grid">
        <section>
          <h3>本次来访 · FIELD LOG</h3>
          <ul>
            <li className="stats-line">
              你划出了 <b>{stats.turb}</b> 道湍流，
              最长按住 <b>{stats.hold}</b> 秒，
              种下 <b>{stats.seeds}</b> 枚种子。
            </li>
            {!reducedMotion && (
              <li style={{ marginTop: '0.6em' }}>
                <button type="button" className="linkish" onClick={onReplay}>
                  重演回第一章 →
                </button>
              </li>
            )}
          </ul>
        </section>

        <section>
          <h3>器械 · APPARATUS</h3>
          <ul>
            <li>粒子场引擎：Canvas 2D 手写物理（旋度噪声 / 弹簧 / 阻尼），零动画库</li>
            <li>字形采样：离屏 canvas 像素取样，问号、章印与「未」皆是同一场尘埃</li>
            <li>自适应预算：按视口与核心数取粒子上限，页签隐藏即停帧</li>
          </ul>
        </section>

        <section>
          <h3>体例 · COLOPHON</h3>
          <ul>
            <li>Cormorant Garamond · Noto Serif SC · IBM Plex Mono</li>
            <li>尊重 prefers-reduced-motion：改为各状态的静定构图</li>
            <li>无任何需要密钥的服务；触觉回执用于支持震动的设备</li>
          </ul>
        </section>
      </div>
    </footer>
  );
}
