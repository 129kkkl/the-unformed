import { useEffect, useRef, useState } from 'react';
import type { FieldEngine } from '../engine/FieldEngine';

interface MetricsLite {
  fps: number; n: number; stateNo: string; state: string; code: string;
  drive: number; charge: number; binds: number; seeds: number;
  turb: number; longestHoldSec: number; still: boolean;
}

/** 底稿模式的机械读数：把“我如何看待自己”摊给访客。 */
export function Readout({ getEngine }: { getEngine: () => FieldEngine | null }) {
  const [m, setM] = useState<MetricsLite | null>(null);
  const last = useRef('');

  useEffect(() => {
    const id = window.setInterval(() => {
      const eng = getEngine();
      if (!eng) return;
      const mt = eng.getMetrics();
      const sig = `${mt.fps}|${mt.drive}|${mt.charge}|${mt.binds}|${mt.seeds}|${mt.turb}`;
      if (sig !== last.current) {
        last.current = sig;
        setM(mt);
      }
    }, 160);
    return () => clearInterval(id);
  }, [getEngine]);

  if (!m) return null;
  const rows: Array<[string, string, boolean?]> = [
    ['STATE', `${m.stateNo} ${m.code} ${m.state}`, false],
    ['DRIVE', m.drive.toFixed(3), false],
    ['DUST', `${m.n}`, false],
    ['BOUND', `${m.binds}`, m.binds > 0],
    ['CHARGE', m.charge.toFixed(2), m.charge > 0.05],
    ['SEEDS', `${m.seeds}`, m.seeds > 0],
    ['TURB', `${m.turb}`, false],
    ['HOLD·MAX', `${m.longestHoldSec}s`, m.longestHoldSec > 0],
    ['FPS', `${m.fps}`, m.fps < 40 && !m.still],
  ];
  return (
    <aside className="readout" aria-label="引擎实时读数">
      <div className="rt-head">
        <span>FIELD/READOUT</span>
        <span>{m.still ? 'STILL' : 'LIVE'}</span>
      </div>
      {rows.map(([k, v, hot]) => (
        <div className="row" key={k}>
          <span className="k">{k}</span>
          <span className={`v${hot ? ' hot' : ''}`}>{v}</span>
        </div>
      ))}
    </aside>
  );
}
