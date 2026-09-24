// Procedural ink-brush sigils (in the spirit of hand-painted occult marks): a vertical spine,
// crossing diagonals, arrowheads, crescents, hooks, wings, swirls and ink spatter — mostly
// mirror-symmetric, never twice the same. Coordinates live in a [-1, 1] box (y down).
import type { Rng } from '../../../utils/seed/seed';

type P = [number, number];

interface Stroke {
  pts: P[];
  w: number; // max half-width
  tipA: number; // width factor at start (0 = sharp)
  tipB: number; // width factor at end
}

export interface Sigil {
  strokes: Stroke[];
  dots: [number, number, number][]; // x, y, r
}

const TAU = Math.PI * 2;

function quad(a: P, c: P, b: P, n = 18): P[] {
  const out: P[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return out;
}

function arcPts(cx: number, cy: number, r: number, a0: number, a1: number, n = 24): P[] {
  const out: P[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

const mirror = (s: Stroke): Stroke => ({ ...s, pts: s.pts.map(([x, y]) => [-x, y] as P) });

export function makeSigil(rng: Rng, complexity = 1): Sigil {
  const strokes: Stroke[] = [];
  const dots: [number, number, number][] = [];
  const W = rng.range(0.055, 0.09);
  const add = (pts: P[], w = W, tipA = 0.15, tipB = 0.15, sym = true) => {
    const s = { pts, w, tipA, tipB };
    strokes.push(s);
    if (sym && Math.abs(pts[0][0]) + Math.abs(pts[pts.length - 1][0]) > 0.02) strokes.push(mirror(s));
  };

  // spine
  const hasSpine = rng.chance(0.8);
  const top = -rng.range(0.75, 0.98);
  const bottom = rng.range(0.7, 0.98);
  if (hasSpine) {
    add([[0, top], [0, bottom]], W * rng.range(0.9, 1.25), 0.05, 0.1, false);
    if (rng.chance(0.55)) {
      // arrowhead on top
      const s = rng.range(0.14, 0.26);
      add([[0, top], [s, top + s * 1.1]], W * 0.8, 0.1, 0.05);
    }
    const tail = rng();
    if (tail < 0.3) add(quad([0, bottom * 0.7], [0.25, bottom], [0.35, bottom * 0.75]), W * 0.7, 0.3, 0.02);
    else if (tail < 0.55) add([[0, bottom * 0.78], [rng.range(0.15, 0.3), bottom * 0.78]], W * 0.7, 0.05, 0.02);
    else if (tail < 0.7) add([[0, bottom], [0.22, bottom - 0.25]], W * 0.7, 0.1, 0.05);
  }

  // crossing diagonals (the "X" skeleton)
  const diag = rng.int(complexity > 1 ? 1 : 0, 2 + (complexity > 1 ? 1 : 0));
  for (let i = 0; i < diag; i++) {
    const y0 = rng.range(-0.8, 0.1);
    const y1 = y0 + rng.range(0.6, 1.3);
    const x0 = rng.range(0.45, 0.9);
    const x1 = -rng.range(0.1, 0.6);
    add([[x0, y0], [x1, Math.min(0.95, y1)]], W * rng.range(0.6, 1), 0.05, 0.1);
    if (rng.chance(0.35)) {
      // arrow tip at the outer end
      const ang = Math.atan2(y0 - y1, x0 - x1);
      const s = 0.16;
      add([[x0, y0], [x0 - Math.cos(ang - 0.5) * s, y0 - Math.sin(ang - 0.5) * s]], W * 0.6, 0.1, 0.05);
    }
  }

  // horizontal bar with barbs
  if (rng.chance(0.45)) {
    const y = rng.range(-0.35, 0.35);
    const x = rng.range(0.5, 0.95);
    add([[-x, y], [x, y]], W * 0.85, 0.05, 0.05, false);
    if (rng.chance(0.6)) add([[x, y], [x - 0.15, y - 0.13]], W * 0.6, 0.1, 0.05);
  }

  // crescent
  if (rng.chance(0.5)) {
    const cy = rng.pick([-0.45, 0.45, 0, -0.1]);
    const r = rng.range(0.28, 0.55);
    const open = rng.range(0.6, 1.4);
    const a0 = (cy < 0 ? Math.PI / 2 : -Math.PI / 2) - Math.PI / 2 - open / 2;
    add(arcPts(0, cy, r, a0 + open, a0 + Math.PI * 2 - open), W * 0.85, 0.05, 0.05, false);
  }

  // small ring
  if (rng.chance(0.25)) add(arcPts(0, rng.range(-0.4, 0.4), rng.range(0.12, 0.22), 0, TAU, 28), W * 0.55, 1, 1, false);

  // zigzag crown / W
  if (rng.chance(0.32)) {
    const y = rng.range(-0.75, -0.2);
    const h = rng.range(0.25, 0.45);
    const x = rng.range(0.4, 0.75);
    add([[x, y], [x * 0.55, y + h], [x * 0.25, y], [0, y + h * 0.9]], W * 0.7, 0.05, 0.3);
  }

  // wings: curved flares from the spine
  if (rng.chance(0.4)) {
    const y = rng.range(-0.3, 0.3);
    const span = rng.range(0.6, 0.98);
    for (let k = 0; k < rng.int(1, 3); k++) {
      const yy = y + k * 0.14;
      add(quad([0.05, yy], [span * 0.6, yy - 0.5], [span, yy + 0.05 + k * 0.1]), W * (0.8 - k * 0.15), 0.9, 0.02);
    }
  }

  // hooks / curls at stroke ends
  if (rng.chance(0.4)) {
    const cx = rng.range(0.35, 0.7);
    const cy = rng.range(-0.6, 0.6);
    const r = rng.range(0.1, 0.18);
    add(arcPts(cx, cy, r, rng.range(0, TAU), rng.range(0, TAU) + Math.PI * 1.4, 22), W * 0.6, 0.6, 0.05);
  }

  // vortex swirl (rare)
  if (rng.chance(0.12 * complexity)) {
    const arms = rng.int(3, 5);
    for (let a = 0; a < arms; a++) {
      const pts: P[] = [];
      for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        const ang = (a / arms) * TAU + t * 2.2;
        pts.push([Math.cos(ang) * (0.15 + t * 0.7), Math.sin(ang) * (0.15 + t * 0.7)]);
      }
      add(pts, W * 0.7, 0.1, 0.02, false);
    }
  }

  // ink spatter
  for (let i = 0; i < rng.int(0, 4); i++) {
    dots.push([rng.range(-0.9, 0.9), rng.range(-0.9, 0.9), rng.range(0.015, 0.045)]);
  }
  if (!strokes.length) add([[0, -0.8], [0, 0.8]], W, 0.05, 0.05, false);
  return { strokes, dots };
}

/** Fills the sigil at the current transform; `size` = half size in current units. */
export function drawSigil(ctx: CanvasRenderingContext2D, s: Sigil, size: number, weight = 1) {
  ctx.save();
  ctx.scale(size, size);
  for (const st of s.strokes) {
    const pts = st.pts;
    const n = pts.length;
    if (n < 2) continue;
    const left: P[] = [];
    const right: P[] = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[Math.min(n - 1, i + 1)];
      let dx = p1[0] - p0[0];
      let dy = p1[1] - p0[1];
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      // brush profile: swell in the middle, taper to the tips
      const tip = t < 0.5 ? st.tipA + (1 - st.tipA) * Math.sin(Math.min(1, t * 2.4) * Math.PI / 2)
        : st.tipB + (1 - st.tipB) * Math.sin(Math.min(1, (1 - t) * 2.4) * Math.PI / 2);
      const w = st.w * weight * Math.max(0.12, tip);
      left.push([pts[i][0] - dy * w, pts[i][1] + dx * w]);
      right.push([pts[i][0] + dy * w, pts[i][1] - dx * w]);
    }
    ctx.beginPath();
    ctx.moveTo(left[0][0], left[0][1]);
    for (const p of left) ctx.lineTo(p[0], p[1]);
    for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
    ctx.closePath();
    ctx.fill();
  }
  for (const [x, y, r] of s.dots) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}
