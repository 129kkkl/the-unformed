/**
 * 文字/路径采样器：把字形变成一组屏幕坐标点，交给粒子场去“成为”它。
 * 采样发生在离屏 canvas 上，一次性成本；粒子数不足时按等比稀疏取样。
 */

export interface SampleOptions {
  text: string;
  font: string;          // 完整 css font 简写（含字重与字号）
  boxW: number;
  boxH: number;
  gap?: number;          // 采样间距（css px）
  jitter?: number;       // 抖动幅度比例 0~1
}

export function sampleText(o: SampleOptions): Float32Array {
  const gap = o.gap ?? 5;
  const jitter = o.jitter ?? 0.45;
  const c = document.createElement('canvas');
  const scale = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.max(2, Math.ceil(o.boxW * scale));
  c.height = Math.max(2, Math.ceil(o.boxH * scale));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.scale(scale, scale);
  ctx.clearRect(0, 0, o.boxW, o.boxH);
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // o.font 是完整简写；超宽时按比例缩字号（替换简写里的 px 值）
  ctx.font = o.font;
  const m = ctx.measureText(o.text);
  const wRatio = m.width / o.boxW;
  if (wRatio > 0.94) {
    const fitted = Math.floor((0.94 / wRatio) * (parseFloat(o.font.match(/([\d.]+)px/)?.[1] ?? '0')));
    ctx.font = o.font.replace(/([\d.]+)px/, `${Math.max(8, fitted)}px`);
  }
  ctx.fillText(o.text, o.boxW / 2, o.boxH / 2 + m.actualBoundingBoxAscent * 0.08);

  const img = ctx.getImageData(0, 0, c.width, c.height).data;
  const pts: number[] = [];
  for (let y = 0; y < o.boxH; y += gap) {
    for (let x = 0; x < o.boxW; x += gap) {
      const px = ((y * scale) | 0) * c.width + ((x * scale) | 0);
      if (img[px * 4 + 3] > 120) {
        pts.push(
          x - o.boxW / 2 + (Math.random() - 0.5) * gap * jitter,
          y - o.boxH / 2 + (Math.random() - 0.5) * gap * jitter,
        );
      }
    }
  }
  return new Float32Array(pts);
}

/** 印章框：圆角方框描边采样。cx/cy 为中心，相对坐标输出。 */
export function sampleStamp(cx: number, cy: number, size: number, stroke: number): Float32Array {
  const gap = Math.max(3, stroke * 0.42);
  const half = size / 2;
  const r = size * 0.12;
  const pts: number[] = [];
  // 四条边逐点推进（含圆角近似：直接补齐到边内）
  const pushSeg = (x0: number, y0: number, x1: number, y1: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(2, Math.round(len / gap));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      pts.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
    }
  };
  const inset = r;
  pushSeg(-half + inset, -half, half - inset, -half);
  pushSeg(half, -half + inset, half, half - inset);
  pushSeg(half - inset, half, -half + inset, half);
  pushSeg(-half, half - inset, -half, -half + inset);
  // 四个圆角：以角点为圆心画四分之一弧
  // 右上：角度 -π/2 → 0；右下：0 → π/2；左下：π/2 → π；左上：-π/2 → -π
  const arcs: Array<[number, number, number, number]> = [
    [half - r, -half + r, -Math.PI / 2, 0],
    [half - r, half - r, 0, Math.PI / 2],
    [-half + r, half - r, Math.PI / 2, Math.PI],
    [-half + r, -half + r, -Math.PI, -Math.PI / 2],
  ];
  for (const [bx, by, a0, a1] of arcs) {
    const steps = Math.max(3, Math.round((r * (a1 - a0)) / gap));
    for (let i = 0; i <= steps; i++) {
      const ang = a0 + ((a1 - a0) * i) / steps;
      pts.push(bx + Math.cos(ang) * r, by + Math.sin(ang) * r);
    }
  }
  const out = new Float32Array(pts.length);
  for (let i = 0; i < pts.length; i += 2) {
    out[i] = cx + pts[i];
    out[i + 1] = cy + pts[i + 1];
  }
  return out;
}
