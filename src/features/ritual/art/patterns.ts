// Library of ornamental "pattern blocks" used to fill the insides of the magic circles.
// Every block draws in unit space (radius 1 = outer edge of the whole construct) with white
// strokes/fills; the colour, glow and burn-in are added later by the circle shader.
//
// Band blocks fill an annulus r0..r1. Disc blocks fill a disc of radius r.
// All randomness comes from the seeded rng so a curse always gets the same ornament.
import type { Rng } from '../../../utils/seed/seed';
import { drawGlyph } from '../../../utils/glyphs/glyphLibrary';

const TAU = Math.PI * 2;

export interface Pen {
  ctx: CanvasRenderingContext2D;
  /** Base line width in unit space. */
  lw: number;
}

// ---------- primitives ----------

export function circle(p: Pen, r: number, w = 1, a = 1) {
  const { ctx } = p;
  ctx.globalAlpha = a;
  ctx.lineWidth = p.lw * w;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.stroke();
}

export function dot(p: Pen, x: number, y: number, r: number, a = 1) {
  const { ctx } = p;
  ctx.globalAlpha = a;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

export function line(p: Pen, x1: number, y1: number, x2: number, y2: number, w = 1, a = 1) {
  const { ctx } = p;
  ctx.globalAlpha = a;
  ctx.lineWidth = p.lw * w;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

export function arc(p: Pen, r: number, a0: number, a1: number, w = 1, a = 1) {
  const { ctx } = p;
  ctx.globalAlpha = a;
  ctx.lineWidth = p.lw * w;
  ctx.beginPath();
  ctx.arc(0, 0, r, a0, a1);
  ctx.stroke();
}

const polar = (r: number, t: number): [number, number] => [Math.cos(t) * r, Math.sin(t) * r];

/** Places `count` items evenly around the ring, calling fn with a rotated/translated context. */
export function around(p: Pen, count: number, r: number, fn: (i: number) => void, phase = 0) {
  const { ctx } = p;
  for (let i = 0; i < count; i++) {
    const t = phase + (i / count) * TAU;
    ctx.save();
    ctx.rotate(t);
    ctx.translate(0, -r);
    fn(i);
    ctx.restore();
  }
}

/** Glyph band: letters standing on the ring, reading clockwise. -1 entries are gaps. */
export function glyphBand(p: Pen, rMid: number, height: number, glyphs: number[], a = 1, fillWhole = true) {
  const { ctx } = p;
  const seq = glyphs.length ? glyphs : [0];
  const pitch = height * 0.95; // roughly square cells
  const circumference = TAU * rMid;
  const cells = Math.max(8, Math.floor(circumference / pitch));
  const items: number[] = [];
  if (fillWhole) {
    // Repeat the text around the whole ring, separated by a divider gap.
    let k = 0;
    while (items.length < cells) {
      items.push(seq[k % seq.length]);
      k++;
      if (k % seq.length === 0 && items.length < cells) items.push(-2);
    }
  } else items.push(...seq.slice(0, cells));
  ctx.globalAlpha = a;
  for (let i = 0; i < items.length; i++) {
    const t = (i / cells) * TAU;
    const g = items[i];
    ctx.save();
    ctx.rotate(t);
    ctx.translate(0, -rMid);
    if (g === -2) {
      // divider: small diamond
      ctx.beginPath();
      const s = height * 0.16;
      ctx.moveTo(0, -s);
      ctx.lineTo(s * 0.6, 0);
      ctx.lineTo(0, s);
      ctx.lineTo(-s * 0.6, 0);
      ctx.closePath();
      ctx.fill();
    } else if (g >= 0) drawGlyph(ctx, g, height * 0.78);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

// ---------- band blocks (annulus r0..r1) ----------

export type BandBlock = (p: Pen, r0: number, r1: number, rng: Rng) => void;

/** Greek key / meander running around the ring. */
const meander: BandBlock = (p, r0, r1, rng) => {
  const { ctx } = p;
  const h = r1 - r0;
  const n = Math.max(12, Math.round((TAU * (r0 + r1)) / 2 / (h * 1.25)));
  const step = TAU / n;
  const rr = (f: number) => r0 + h * f;
  ctx.globalAlpha = 1;
  ctx.lineWidth = p.lw * 1.1;
  ctx.lineJoin = 'miter';
  const flip = rng.chance(0.5);
  // Each cell: a hook rising from the shared base line and curling inward (Greek key).
  // Points are [angle fraction within the cell, radius fraction within the band].
  const hook: [number, number][] = [
    [0, 0.1], [0, 0.9], [0.78, 0.9], [0.78, 0.32], [0.3, 0.32], [0.3, 0.62], [0.52, 0.62],
  ];
  ctx.beginPath();
  ctx.arc(0, 0, rr(0.1), 0, TAU);
  for (let i = 0; i < n; i++) {
    const t0 = i * step;
    hook.forEach(([ta, ra], j) => {
      const t = t0 + step * (flip ? 1 - ta : ta);
      const [x, y] = polar(rr(ra), t);
      if (j === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
  }
  ctx.stroke();
  circle(p, r0, 0.8, 0.8);
  circle(p, r1, 0.8, 0.8);
};

/** Double zig-zag teeth with beads in the pockets. */
const chevrons: BandBlock = (p, r0, r1, rng) => {
  const { ctx } = p;
  const h = r1 - r0;
  const n = Math.max(18, Math.round((TAU * r1) / (h * 0.9)));
  ctx.lineWidth = p.lw;
  for (const [lo, hi, a] of [[0.05, 0.95, 1], [0.3, 0.7, 0.55]] as const) {
    ctx.globalAlpha = a;
    ctx.beginPath();
    for (let i = 0; i <= n * 2; i++) {
      const t = (i / (n * 2)) * TAU;
      const r = r0 + h * (i % 2 ? hi : lo);
      const [x, y] = polar(r, t);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const beadR = h * (rng.chance(0.5) ? 0.07 : 0.1);
  for (let i = 0; i < n; i++) {
    const t = ((i + 0.5) / n) * TAU;
    const [x, y] = polar(r0 + h * 0.2, t);
    dot(p, x, y, beadR, 0.9);
    const [x2, y2] = polar(r0 + h * 0.8, t - TAU / (n * 2));
    dot(p, x2, y2, beadR * 0.7, 0.7);
  }
};

/** Overlapping fish-scale arcs. */
const scales: BandBlock = (p, r0, r1) => {
  const h = r1 - r0;
  const n = Math.max(16, Math.round((TAU * r1) / (h * 0.85)));
  for (let row = 0; row < 2; row++) {
    const rc = r0 + h * (row ? 0.62 : 0.2);
    const rad = h * 0.36;
    around(p, n, rc, () => {
      const { ctx } = p;
      ctx.globalAlpha = row ? 0.95 : 0.6;
      ctx.lineWidth = p.lw;
      ctx.beginPath();
      ctx.arc(0, 0, rad, Math.PI * 0.05, Math.PI * 0.95);
      ctx.stroke();
      dot(p, 0, rad * 0.35, rad * 0.12, row ? 0.9 : 0.5);
    }, row ? Math.PI / n : 0);
  }
  circle(p, r0, 0.7, 0.7);
  circle(p, r1, 0.7, 0.7);
};

/** Chain of interlaced circles (vesica links). */
const interlace: BandBlock = (p, r0, r1, rng) => {
  const h = r1 - r0;
  const rm = (r0 + r1) / 2;
  const rad = h * 0.48;
  const n = Math.max(14, Math.round((TAU * rm) / (rad * 1.3)));
  around(p, n, rm, () => circle(p, rad, 0.9, 0.9));
  if (rng.chance(0.6)) around(p, n, rm, () => dot(p, 0, 0, rad * 0.14, 1), Math.PI / n);
};

/** Crescent moons alternating with stars/dots. */
const crescents: BandBlock = (p, r0, r1, rng) => {
  const h = r1 - r0;
  const rm = (r0 + r1) / 2;
  const n = Math.max(10, Math.round((TAU * rm) / (h * 1.5)));
  const { ctx } = p;
  const s = h * 0.36;
  const phases = rng.chance(0.5);
  around(p, n, rm, (i) => {
    ctx.globalAlpha = 1;
    if (i % 2 === 0) {
      ctx.save();
      if (phases) ctx.rotate((i / n) * Math.PI);
      ctx.beginPath();
      ctx.arc(0, 0, s, 0, TAU);
      ctx.arc(s * 0.38, -s * 0.12, s * 0.82, 0, TAU, true);
      ctx.fill('evenodd');
      ctx.restore();
    } else {
      // tiny 4-point star
      ctx.beginPath();
      const k = s * 0.55;
      ctx.moveTo(0, -k);
      ctx.quadraticCurveTo(0, 0, k, 0);
      ctx.quadraticCurveTo(0, 0, 0, k);
      ctx.quadraticCurveTo(0, 0, -k, 0);
      ctx.quadraticCurveTo(0, 0, 0, -k);
      ctx.fill();
    }
  });
  circle(p, r0, 0.6, 0.6);
  circle(p, r1, 0.6, 0.6);
};

/** Castle-like crenellation / stepped labyrinth band. */
const battlement: BandBlock = (p, r0, r1) => {
  const { ctx } = p;
  const h = r1 - r0;
  const n = Math.max(20, Math.round((TAU * r1) / (h * 0.7)));
  ctx.lineWidth = p.lw;
  ctx.globalAlpha = 0.95;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * TAU;
    const a1 = ((i + 0.5) / n) * TAU;
    const a2 = ((i + 1) / n) * TAU;
    const lo = r0 + h * 0.2;
    const hi = r0 + h * 0.8;
    const pts: [number, number][] = [
      polar(lo, a0), polar(hi, a0), polar(hi, a1), polar(lo, a1), polar(lo, a2),
    ];
    pts.forEach(([x, y], j) => (i === 0 && j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  }
  ctx.closePath();
  ctx.stroke();
  for (let i = 0; i < n; i++) {
    const [x, y] = polar(r0 + h * 0.5, ((i + 0.75) / n) * TAU);
    dot(p, x, y, h * 0.06, 0.8);
  }
  circle(p, r0, 0.6, 0.55);
  circle(p, r1, 0.6, 0.55);
};

/** Sunburst: alternating long/short rays tipped with beads. */
const rays: BandBlock = (p, r0, r1, rng) => {
  const h = r1 - r0;
  const n = rng.pick([36, 48, 60, 72]);
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU;
    const long = i % 3 === 0;
    const re = r0 + h * (long ? 0.95 : 0.6);
    const [x1, y1] = polar(r0, t);
    const [x2, y2] = polar(re, t);
    line(p, x1, y1, x2, y2, long ? 1 : 0.7, long ? 1 : 0.6);
    if (long) dot(p, x2, y2, h * 0.07, 1);
  }
  circle(p, r0, 1, 0.9);
};

/** Petals (lens shapes) radiating like a rosette. */
const petals: BandBlock = (p, r0, r1, rng) => {
  const { ctx } = p;
  const h = r1 - r0;
  const n = rng.pick([12, 16, 18, 24]);
  const w = ((TAU * (r0 + h / 2)) / n) * 0.42;
  for (let layer = 0; layer < 2; layer++) {
    around(p, n, r0 + h / 2, () => {
      ctx.globalAlpha = layer ? 0.5 : 1;
      ctx.lineWidth = p.lw * (layer ? 0.7 : 1);
      const hh = (h / 2) * (layer ? 0.55 : 0.95);
      ctx.beginPath();
      ctx.moveTo(0, -hh);
      ctx.quadraticCurveTo(w, 0, 0, hh);
      ctx.quadraticCurveTo(-w, 0, 0, -hh);
      ctx.stroke();
    }, layer ? Math.PI / n : 0);
  }
  circle(p, r0, 0.6, 0.6);
};

/** Braided rope: two sine waves crossing around the ring. */
const braid: BandBlock = (p, r0, r1, rng) => {
  const { ctx } = p;
  const h = r1 - r0;
  const rm = (r0 + r1) / 2;
  const waves = Math.max(16, Math.round((TAU * rm) / (h * 1.6)));
  const strands = rng.chance(0.5) ? 2 : 3;
  ctx.lineWidth = p.lw * 1.05;
  for (let s = 0; s < strands; s++) {
    ctx.globalAlpha = 1 - s * 0.2;
    ctx.beginPath();
    const steps = waves * 24;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * TAU;
      const r = rm + Math.sin(t * waves + (s * TAU) / strands) * h * 0.42;
      const [x, y] = polar(r, t);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let i = 0; i < waves * strands; i++) {
    const t = ((i + 0.5) / (waves * strands)) * TAU;
    const [x, y] = polar(rm, t);
    dot(p, x, y, h * 0.05, 0.9);
  }
};

/** Watching eyes (vesica with pupil) between ticks. */
const eyes: BandBlock = (p, r0, r1, rng) => {
  const { ctx } = p;
  const h = r1 - r0;
  const rm = (r0 + r1) / 2;
  const n = rng.pick([8, 10, 12]);
  const w = h * 0.55;
  around(p, n, rm, () => {
    ctx.globalAlpha = 1;
    ctx.lineWidth = p.lw;
    ctx.beginPath();
    ctx.moveTo(-w, 0);
    ctx.quadraticCurveTo(0, -h * 0.5, w, 0);
    ctx.quadraticCurveTo(0, h * 0.5, -w, 0);
    ctx.stroke();
    circle(p, h * 0.14, 0.8, 0.9);
    dot(p, 0, 0, h * 0.07, 1);
  });
  around(p, n * 3, rm, (i) => {
    if (i % 3 === 0) return;
    line(p, 0, -h * 0.3, 0, h * 0.3, 0.7, 0.5);
  }, Math.PI / n);
  circle(p, r0, 0.7, 0.8);
  circle(p, r1, 0.7, 0.8);
};

/** Cartouches: segmented cells each holding a letter. */
const cartouches = (glyphs: number[]): BandBlock => (p, r0, r1, rng) => {
  const h = r1 - r0;
  const rm = (r0 + r1) / 2;
  const n = rng.pick([7, 9, 11, 13]);
  const seq = glyphs.filter((g) => g >= 0);
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU;
    const [x1, y1] = polar(r0, t);
    const [x2, y2] = polar(r1, t);
    line(p, x1, y1, x2, y2, 0.9, 0.9);
  }
  around(p, n, rm, (i) => {
    p.ctx.globalAlpha = 1;
    drawGlyph(p.ctx, seq.length ? seq[i % seq.length] : i, h * 0.62);
  }, Math.PI / n);
  circle(p, r0, 0.9, 0.9);
  circle(p, r1, 0.9, 0.9);
};

/** Clock-work ticks: fine minute ticks + bold hour marks. */
const ticks: BandBlock = (p, r0, r1, rng) => {
  const h = r1 - r0;
  const major = rng.pick([12, 16, 24]);
  const minor = major * 5;
  for (let i = 0; i < minor; i++) {
    const t = (i / minor) * TAU;
    const isMajor = i % 5 === 0;
    const [x1, y1] = polar(r1, t);
    const [x2, y2] = polar(r1 - h * (isMajor ? 0.9 : 0.35), t);
    line(p, x1, y1, x2, y2, isMajor ? 1.3 : 0.6, isMajor ? 1 : 0.55);
  }
  circle(p, r1, 0.9, 0.9);
};

export const BAND_BLOCKS: Record<string, BandBlock> = {
  meander, chevrons, scales, interlace, crescents, battlement, rays, petals, braid, eyes, ticks,
};

export function bandBlockWithGlyphs(glyphs: number[]): Record<string, BandBlock> {
  return { ...BAND_BLOCKS, cartouches: cartouches(glyphs) };
}

// ---------- disc blocks (radius r) ----------

export type DiscBlock = (p: Pen, r: number, rng: Rng) => void;

/** Spiral arms, echoing the vortex of the altar. */
const spiral: DiscBlock = (p, r, rng) => {
  const { ctx } = p;
  const arms = rng.pick([3, 4, 5, 6]);
  const turns = rng.range(0.55, 0.9);
  const dir = rng.sign();
  for (let a = 0; a < arms; a++) {
    for (const [off, w, al] of [[0, 1.2, 1], [0.1, 0.6, 0.5]] as const) {
      ctx.globalAlpha = al;
      ctx.lineWidth = p.lw * w;
      ctx.beginPath();
      const steps = 120;
      for (let i = 0; i <= steps; i++) {
        const f = i / steps;
        const t = (a / arms) * TAU + dir * (f * turns * TAU + off);
        const rr = r * (0.12 + 0.88 * Math.pow(f, 0.8));
        const [x, y] = polar(rr, t);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  circle(p, r * 0.12, 1, 1);
};

/** Seed-of-life rosette. */
const seedOfLife: DiscBlock = (p, r, rng) => {
  const n = rng.pick([6, 8]);
  const rad = r * 0.5;
  circle(p, rad, 0.9, 0.9);
  around(p, n, rad, () => circle(p, rad, 0.9, 0.85));
  circle(p, r, 1, 1);
};

/** String-art star: chords i -> i+k. */
const stringStar: DiscBlock = (p, r, rng) => {
  const n = rng.pick([9, 11, 12, 13, 15, 16]);
  const k = Math.max(2, Math.floor(n / rng.pick([2.2, 3, 3.4])));
  const pts = Array.from({ length: n }, (_, i) => polar(r, (i / n) * TAU - Math.PI / 2));
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + k) % n];
    line(p, x1, y1, x2, y2, 0.8, 0.8);
  }
  pts.forEach(([x, y]) => dot(p, x, y, r * 0.035, 1));
};

/** Nested rotated squares/triangles. */
const nested: DiscBlock = (p, r, rng) => {
  const { ctx } = p;
  const sides = rng.pick([3, 4, 6]);
  const count = rng.int(3, 5);
  for (let j = 0; j < count; j++) {
    const rr = r * Math.pow(Math.cos(Math.PI / sides), j);
    const rot = (j * Math.PI) / sides;
    ctx.globalAlpha = 1 - j * 0.12;
    ctx.lineWidth = p.lw * (1.1 - j * 0.12);
    ctx.beginPath();
    for (let i = 0; i <= sides; i++) {
      const [x, y] = polar(rr, rot + (i / sides) * TAU - Math.PI / 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
};

export const DISC_BLOCKS: Record<string, DiscBlock> = { spiral, seedOfLife, stringStar, nested };
