// Procedural magic-circle generator.
//
// A circle is not picked from presets: it is grown from the curse's seed. The generator
// decides how many tiers there are, where they sit, what architecture the main figure has
// (star, triangle, rounded heptagon, compound polygons, letters running along its edges ...),
// whether satellites break out of the frame, blades radiate outward, medallions sit on the
// cardinal points, and what the ornament of every band is made of. Motifs are assembled
// from primitives with continuous random parameters, so no two circles repeat.
//
// Every layer is drawn into three colour channels (R = structure, G = inscriptions,
// B = accents); the shader turns them into the curse's own palette.
import type { Rng } from '../../../utils/seed/seed';
import { makeRng } from '../../../utils/seed/seed';
import { drawGlyph, glyphWidth } from '../../../utils/glyphs/glyphLibrary';
import { drawSigil, makeSigil, type Sigil } from './sigils';
import { layerPalette, makePalette, type Palette } from './palette';

const TAU = Math.PI * 2;

export type Ink = 'a' | 'b' | 'c';

export interface Pen {
  ctx: CanvasRenderingContext2D;
  lw: number;
  ink: (c: Ink) => void;
  /** Paint "nothing" (black) — cuts holes inside the layer being drawn. */
  erase: () => void;
}

export interface LayerArt {
  id: string;
  radius: number;
  /** Final depth slot (multiplied by the spread). */
  zSlot: number;
  /** Where it waits deep in the tunnel before flying up (world units below the altar). */
  zStart: number;
  /** Frame at which it locks into the assembled circle. */
  arrive: number;
  /** Lateral spiral radius during the flight. */
  spiral: number;
  /** Extra turns while flying. */
  twist: number;
  reveal: [number, number];
  intensity: number;
  spin: number;
  palette: Palette;
  /** Hangs above the certificate at the end. */
  hang: boolean;
  draw: (p: Pen) => void;
}

export interface PasserArt {
  radius: number;
  draw: (p: Pen) => void;
}

export interface CircleDesign {
  palette: Palette;
  layers: LayerArt[];
  passers: PasserArt[];
  sigils: Sigil[];
  architecture: string;
}

export interface GeneratorInput {
  seed: number;
  name: number[];
  reason: number[];
  punishment: number[];
}

// ------------------------------------------------------------------ primitives

function circle(p: Pen, r: number, w = 1, a = 1) {
  const { ctx } = p;
  ctx.globalAlpha = a;
  ctx.lineWidth = p.lw * w;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.stroke();
}

function arc(p: Pen, r: number, a0: number, a1: number, w = 1, a = 1) {
  const { ctx } = p;
  ctx.globalAlpha = a;
  ctx.lineWidth = p.lw * w;
  ctx.beginPath();
  ctx.arc(0, 0, r, a0, a1);
  ctx.stroke();
}

function line(p: Pen, x1: number, y1: number, x2: number, y2: number, w = 1, a = 1) {
  const { ctx } = p;
  ctx.globalAlpha = a;
  ctx.lineWidth = p.lw * w;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function dot(p: Pen, x: number, y: number, r: number, a = 1) {
  const { ctx } = p;
  ctx.globalAlpha = a;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

function disc(p: Pen, r: number) {
  p.ctx.save();
  p.erase();
  p.ctx.globalAlpha = 1;
  p.ctx.beginPath();
  p.ctx.arc(0, 0, r, 0, TAU);
  p.ctx.fill();
  p.ctx.restore();
}

function dashedCircle(p: Pen, r: number, dashes: number, fill: number, w = 1, a = 1) {
  for (let i = 0; i < dashes; i++) {
    const t0 = (i / dashes) * TAU;
    arc(p, r, t0, t0 + (TAU / dashes) * fill, w, a);
  }
}

const polar = (r: number, t: number): [number, number] => [Math.cos(t) * r, Math.sin(t) * r];

function around(p: Pen, n: number, r: number, fn: (i: number) => void, phase = 0) {
  for (let i = 0; i < n; i++) {
    p.ctx.save();
    p.ctx.rotate(phase + (i / n) * TAU);
    p.ctx.translate(0, -r);
    fn(i);
    p.ctx.restore();
  }
}

/** Letters standing on a ring, repeated all the way around with small separators. */
function glyphRing(p: Pen, rMid: number, h: number, glyphs: number[], opts: { spacing?: number; sep?: 'dot' | 'diamond' | 'bar' | 'none'; a?: number } = {}) {
  const seq = glyphs.filter((g) => g >= -1);
  const src = seq.length ? seq : [0];
  const spacing = opts.spacing ?? 1.05;
  const circumference = TAU * rMid;
  const items: number[] = [];
  let len = 0;
  let k = 0;
  const unit = h * 0.8;
  while (len < circumference - unit) {
    const g = src[k % src.length];
    const w = g < 0 ? unit * 0.6 : glyphWidth(g, unit) * spacing + unit * 0.12;
    items.push(g);
    len += w;
    k++;
    if (k % src.length === 0) {
      items.push(-2);
      len += unit * 0.8;
    }
  }
  const scale = circumference / Math.max(len, 1e-6);
  let pos = 0;
  const { ctx } = p;
  ctx.globalAlpha = opts.a ?? 1;
  for (const g of items) {
    const w = (g === -2 ? unit * 0.8 : g < 0 ? unit * 0.6 : glyphWidth(g, unit) * spacing + unit * 0.12) * scale;
    const t = (pos + w / 2) / rMid;
    ctx.save();
    ctx.rotate(t);
    ctx.translate(0, -rMid);
    if (g === -2) {
      const sep = opts.sep ?? 'diamond';
      const s = h * 0.14;
      if (sep === 'dot') dot(p, 0, 0, s * 0.6, 1);
      else if (sep === 'bar') line(p, 0, -h * 0.35, 0, h * 0.35, 0.8, 1);
      else if (sep === 'diamond') {
        ctx.beginPath();
        ctx.moveTo(0, -s);
        ctx.lineTo(s * 0.6, 0);
        ctx.lineTo(0, s);
        ctx.lineTo(-s * 0.6, 0);
        ctx.closePath();
        ctx.fill();
      }
    } else if (g >= 0) drawGlyph(ctx, g, unit);
    ctx.restore();
    pos += w;
  }
  ctx.globalAlpha = 1;
}

/** Letters running along a straight segment (e.g. the edges of a polygon). */
function glyphLine(p: Pen, x1: number, y1: number, x2: number, y2: number, h: number, glyphs: number[]) {
  const src = glyphs.filter((g) => g >= 0);
  const seq = src.length ? src : [0];
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const unit = h * 0.78;
  const n = Math.max(1, Math.floor(len / (unit * 0.9)));
  const { ctx } = p;
  ctx.save();
  ctx.translate(x1, y1);
  ctx.rotate(ang);
  for (let i = 0; i < n; i++) {
    ctx.save();
    ctx.translate(((i + 0.5) / n) * len, 0);
    ctx.rotate(Math.PI / 2);
    ctx.rotate(-Math.PI / 2);
    drawGlyph(ctx, seq[i % seq.length], unit);
    ctx.restore();
  }
  ctx.restore();
}

function polygonPts(n: number, r: number, rot: number): [number, number][] {
  return Array.from({ length: n }, (_, i) => polar(r, rot + (i / n) * TAU));
}

function strokePoly(p: Pen, pts: [number, number][], w = 1, a = 1, close = true) {
  const { ctx } = p;
  ctx.globalAlpha = a;
  ctx.lineWidth = p.lw * w;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  if (close) ctx.closePath();
  ctx.stroke();
}

/** Polygon whose edges are arcs: bulge > 0 = rounded outward ("almost a circle"), < 0 = inward. */
function curvedPoly(p: Pen, n: number, r: number, rot: number, bulge: number, w = 1, a = 1) {
  const pts = polygonPts(n, r, rot);
  const { ctx } = p;
  ctx.globalAlpha = a;
  ctx.lineWidth = p.lw * w;
  ctx.beginPath();
  pts.forEach(([x, y], i) => {
    const [x2, y2] = pts[(i + 1) % n];
    const mx = (x + x2) / 2;
    const my = (y + y2) / 2;
    const ml = Math.hypot(mx, my) || 1;
    const cx = mx + (mx / ml) * bulge * r;
    const cy = my + (my / ml) * bulge * r;
    if (i === 0) ctx.moveTo(x, y);
    ctx.quadraticCurveTo(cx, cy, x2, y2);
  });
  ctx.closePath();
  ctx.stroke();
}

function starPoly(n: number, k: number, r: number, rot: number): [number, number][][] {
  const pts = polygonPts(n, r, rot);
  const loops: [number, number][][] = [];
  const seen = new Set<number>();
  for (let s = 0; s < n; s++) {
    if (seen.has(s)) continue;
    const loop: [number, number][] = [];
    let i = s;
    do {
      seen.add(i);
      loop.push(pts[i]);
      i = (i + k) % n;
    } while (i !== s);
    loops.push(loop);
  }
  return loops;
}

// ------------------------------------------------------------------ procedural motifs

type Motif = (p: Pen, w: number, h: number, i: number) => void;

/** Builds one ornament cell from 1-3 random primitives with continuous parameters. */
function makeMotif(rng: Rng, glyphs: number[], sigil: Sigil): Motif {
  const parts: Motif[] = [];
  const count = rng.int(1, 3);
  const pick = () => rng.pick(['chevron', 'arc', 'dot', 'bar', 'cross', 'diamond', 'loop', 'crescent', 'tri', 'hook', 'sigil', 'glyph', 'spike', 'eye'] as const);
  for (let k = 0; k < count; k++) {
    const kind = pick();
    const y = rng.range(-0.35, 0.35);
    const s = rng.range(0.35, 0.95);
    const wgt = rng.range(0.6, 1.2);
    const alpha = rng.range(0.55, 1);
    const inv = rng.chance(0.5) ? 1 : -1;
    switch (kind) {
      case 'chevron':
        parts.push((pp, w, h) => {
          const { ctx } = pp;
          ctx.globalAlpha = alpha;
          ctx.lineWidth = pp.lw * wgt;
          ctx.beginPath();
          ctx.moveTo(-w * 0.5 * s, (y - 0.25 * inv) * h);
          ctx.lineTo(0, (y + 0.25 * inv) * h);
          ctx.lineTo(w * 0.5 * s, (y - 0.25 * inv) * h);
          ctx.stroke();
        });
        break;
      case 'arc':
        parts.push((pp, w, h) => {
          const { ctx } = pp;
          ctx.globalAlpha = alpha;
          ctx.lineWidth = pp.lw * wgt;
          ctx.beginPath();
          ctx.arc(0, y * h, Math.min(w, h) * 0.5 * s, inv > 0 ? 0 : Math.PI, inv > 0 ? Math.PI : TAU);
          ctx.stroke();
        });
        break;
      case 'dot':
        parts.push((pp, w, h) => dot(pp, 0, y * h, Math.min(w, h) * 0.09 * s + pp.lw, alpha));
        break;
      case 'bar':
        parts.push((pp, _w, h) => line(pp, 0, (y - 0.35 * s) * h, 0, (y + 0.35 * s) * h, wgt, alpha));
        break;
      case 'cross':
        parts.push((pp, w, h) => {
          const q = Math.min(w, h) * 0.25 * s;
          line(pp, -q, y * h - q, q, y * h + q, wgt, alpha);
          line(pp, q, y * h - q, -q, y * h + q, wgt, alpha);
        });
        break;
      case 'diamond':
        parts.push((pp, w, h) => {
          const { ctx } = pp;
          const q = Math.min(w, h) * 0.3 * s;
          ctx.globalAlpha = alpha;
          ctx.lineWidth = pp.lw * wgt;
          ctx.beginPath();
          ctx.moveTo(0, y * h - q);
          ctx.lineTo(q * 0.6, y * h);
          ctx.lineTo(0, y * h + q);
          ctx.lineTo(-q * 0.6, y * h);
          ctx.closePath();
          if (inv > 0) ctx.stroke();
          else ctx.fill();
        });
        break;
      case 'loop':
        parts.push((pp, w, h) => {
          const { ctx } = pp;
          ctx.globalAlpha = alpha;
          ctx.lineWidth = pp.lw * wgt;
          ctx.beginPath();
          ctx.arc(0, y * h, Math.min(w, h) * 0.28 * s, 0, TAU);
          ctx.stroke();
        });
        break;
      case 'crescent':
        parts.push((pp, w, h) => {
          const { ctx } = pp;
          const q = Math.min(w, h) * 0.3 * s;
          ctx.globalAlpha = alpha;
          ctx.save();
          ctx.translate(0, y * h);
          ctx.rotate(inv > 0 ? 0 : Math.PI);
          ctx.beginPath();
          ctx.arc(0, 0, q, 0, TAU);
          ctx.arc(q * 0.4, -q * 0.15, q * 0.8, 0, TAU, true);
          ctx.fill('evenodd');
          ctx.restore();
        });
        break;
      case 'tri':
        parts.push((pp, w, h) => {
          const q = Math.min(w, h) * 0.4 * s;
          strokePoly(pp, [[0, y * h - q * inv], [q * 0.8, y * h + q * 0.6 * inv], [-q * 0.8, y * h + q * 0.6 * inv]], wgt, alpha);
        });
        break;
      case 'hook':
        parts.push((pp, w, h) => {
          const { ctx } = pp;
          ctx.globalAlpha = alpha;
          ctx.lineWidth = pp.lw * wgt;
          ctx.beginPath();
          const q = Math.min(w, h) * 0.35 * s;
          for (let i = 0; i <= 20; i++) {
            const t = i / 20;
            const a = t * 4.2 * inv;
            const r = q * (1 - t * 0.8);
            const x = Math.cos(a) * r;
            const yy = y * h + Math.sin(a) * r;
            if (i) ctx.lineTo(x, yy);
            else ctx.moveTo(x, yy);
          }
          ctx.stroke();
        });
        break;
      case 'sigil':
        parts.push((pp, w, h) => {
          pp.ctx.globalAlpha = alpha;
          pp.ctx.save();
          pp.ctx.translate(0, y * h * 0.5);
          drawSigil(pp.ctx, sigil, Math.min(w, h) * 0.42 * s, 0.9);
          pp.ctx.restore();
        });
        break;
      case 'glyph':
        parts.push((pp, w, h, i) => {
          const seq = glyphs.filter((g) => g >= 0);
          pp.ctx.globalAlpha = alpha;
          pp.ctx.save();
          pp.ctx.translate(0, y * h * 0.4);
          drawGlyph(pp.ctx, seq.length ? seq[i % seq.length] : i, Math.min(w * 1.3, h) * 0.7 * s);
          pp.ctx.restore();
        });
        break;
      case 'spike':
        parts.push((pp, w, h) => {
          const { ctx } = pp;
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          ctx.moveTo(-w * 0.08, h * 0.45);
          ctx.lineTo(0, -h * 0.45 * s);
          ctx.lineTo(w * 0.08, h * 0.45);
          ctx.closePath();
          ctx.fill();
        });
        break;
      case 'eye':
        parts.push((pp, w, h) => {
          const { ctx } = pp;
          const q = Math.min(w, h) * 0.45 * s;
          ctx.globalAlpha = alpha;
          ctx.lineWidth = pp.lw * wgt;
          ctx.beginPath();
          ctx.moveTo(-q, y * h);
          ctx.quadraticCurveTo(0, y * h - q * 0.7, q, y * h);
          ctx.quadraticCurveTo(0, y * h + q * 0.7, -q, y * h);
          ctx.stroke();
          dot(pp, 0, y * h, q * 0.18, 1);
        });
        break;
    }
  }
  return (pp, w, h, i) => parts.forEach((f) => f(pp, w, h, i));
}

/** Ornament band: repeated motif cells, sometimes alternating two motifs, plus a continuous thread. */
function motifBand(p: Pen, r0: number, r1: number, rng: Rng, glyphs: number[], sigil: Sigil) {
  const h = r1 - r0;
  const rm = (r0 + r1) / 2;
  const cellAspect = rng.range(0.6, 1.8);
  const n = Math.max(6, Math.round((TAU * rm) / (h * cellAspect)));
  const w = (TAU * rm) / n;
  const m1 = makeMotif(rng, glyphs, sigil);
  const m2 = rng.chance(0.4) ? makeMotif(rng, glyphs, sigil) : m1;
  const thread = rng();
  // continuous threads that run through the cells
  if (thread < 0.25) {
    // wave / braid
    const strands = rng.int(1, 3);
    const waves = n * rng.pick([0.5, 1, 1]);
    for (let s = 0; s < strands; s++) {
      p.ctx.globalAlpha = 0.85;
      p.ctx.lineWidth = p.lw * 0.9;
      p.ctx.beginPath();
      const steps = Math.max(200, n * 20);
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * TAU;
        const [x, y] = polar(rm + Math.sin(t * waves + (s * TAU) / strands) * h * 0.4, t);
        if (i) p.ctx.lineTo(x, y);
        else p.ctx.moveTo(x, y);
      }
      p.ctx.stroke();
    }
  } else if (thread < 0.45) {
    // zigzag
    p.ctx.globalAlpha = 0.8;
    p.ctx.lineWidth = p.lw * 0.9;
    p.ctx.beginPath();
    for (let i = 0; i <= n * 2; i++) {
      const [x, y] = polar(r0 + h * (i % 2 ? 0.9 : 0.1), (i / (n * 2)) * TAU);
      if (i) p.ctx.lineTo(x, y);
      else p.ctx.moveTo(x, y);
    }
    p.ctx.stroke();
  }
  around(p, n, rm, (i) => ((i % 2 ? m2 : m1)(p, w, h, i)));
  const border = rng();
  if (border < 0.7) {
    circle(p, r0, 0.8, 0.85);
    circle(p, r1, 0.8, 0.85);
  } else if (border < 0.85) {
    dashedCircle(p, r1, n, 0.6, 0.8, 0.8);
  }
  if (rng.chance(0.35)) {
    // radial separators between cells
    for (let i = 0; i < n; i++) {
      const t = (i / n) * TAU - Math.PI / 2 + Math.PI / n;
      const [x1, y1] = polar(r0, t);
      const [x2, y2] = polar(r1, t);
      line(p, x1, y1, x2, y2, 0.6, 0.6);
    }
  }
}

/** A mini circle (satellite / medallion) — recursive generation, one level deep. */
function miniCircle(p: Pen, r: number, rng: Rng, g: GeneratorInput, sigil: Sigil, detail: number) {
  disc(p, r * 1.02);
  p.ink('c');
  circle(p, r, 1.3);
  if (rng.chance(0.6)) circle(p, r * 0.93, 0.6, 0.8);
  const kind = rng();
  if (kind < 0.55 && detail > 0) {
    // ring of letters inside the satellite
    const rr = r * rng.range(0.7, 0.8);
    p.ink('b');
    glyphRing(p, rr, r * 0.2, rng.pick([g.reason, g.name, g.punishment]), { sep: 'dot' });
    p.ink('c');
    circle(p, rr - r * 0.13, 0.7, 0.9);
  } else if (kind < 0.8) {
    p.ink('c');
    dashedCircle(p, r * 0.78, rng.int(12, 36), rng.range(0.3, 0.7), 0.8, 0.8);
  } else {
    const n = rng.pick([3, 4, 5, 6]);
    p.ink('a');
    for (const loop of starPoly(n * 2, 2, r * 0.8, rng.range(0, TAU))) strokePoly(p, loop, 0.8, 0.9);
  }
  // centre: a sigil, a star or a letter
  const c = rng();
  if (c < 0.5) {
    p.ink('a');
    p.ctx.globalAlpha = 1;
    drawSigil(p.ctx, sigil, r * 0.42, 1);
  } else if (c < 0.75) {
    p.ink('a');
    const n = rng.pick([5, 6, 7]);
    for (const loop of starPoly(n, n === 6 ? 2 : Math.floor(n / 2), r * 0.45, -Math.PI / 2)) strokePoly(p, loop, 0.9, 1);
  } else {
    p.ink('b');
    p.ctx.globalAlpha = 1;
    const seq = g.name.filter((x) => x >= 0);
    drawGlyph(p.ctx, seq.length ? rng.pick(seq) : 0, r * 0.7);
  }
}

// ------------------------------------------------------------------ the generator

export function generateCircle(g: GeneratorInput): CircleDesign {
  const rng = makeRng(g.seed).fork(4242);
  const palette = makePalette(rng.fork(1));
  const sigils = Array.from({ length: 10 }, (_, i) => makeSigil(rng.fork(100 + i), i === 0 ? 1.6 : 1));
  const words = [g.name, g.reason, g.punishment];
  const text = (a: number[], b: number[]) => [...a, -1, ...b];
  const layers: LayerArt[] = [];
  const dir = rng.sign();

  // Architecture: where the depth goes (a cone towards the viewer, a bowl, or a scattered mechanism)
  const arch = rng.pick(['cone', 'bowl', 'scatter', 'cone'] as const);
  const slotFor = (radius: number) => {
    const t = 1 - Math.min(1, radius / 1.1); // 0 outer .. 1 centre
    if (arch === 'cone') return t * 5 + rng.range(-0.4, 0.4);
    if (arch === 'bowl') return (1 - t) * 4 + rng.range(-0.4, 0.4);
    return rng.range(0, 5);
  };
  let order = 0;
  const addLayer = (id: string, radius: number, intensity: number, draw: (p: Pen) => void, extra: Partial<LayerArt> = {}) => {
    const lr = rng.fork(900 + order);
    const i = order++;
    layers.push({
      id,
      radius,
      zSlot: slotFor(radius),
      zStart: -lr.range(7, 28),
      arrive: Math.round(lr.range(214, 241)),
      spiral: lr.range(0, 0.7),
      twist: lr.range(2, 7) * lr.sign(),
      reveal: [175 + i * 3 + lr.int(0, 6), 196 + i * 3 + lr.int(0, 8)],
      intensity,
      spin: lr.range(0.03, 0.28) * (i % 2 ? -dir : dir),
      palette: layerPalette(palette, lr),
      hang: false,
      draw,
      ...extra,
    });
  };

  // ---------- 1. Frame (+ what breaks out of it)
  {
    const fr = rng.fork(11);
    const style = fr.int(0, 3);
    const bandH = fr.range(0.06, 0.13);
    const bigLetters = fr.chance(0.4);
    const outerExtras = {
      blades: fr.chance(0.35),
      ticks: fr.chance(0.4),
      arcs: fr.chance(0.55),
    };
    const reach = outerExtras.blades ? 1.5 : outerExtras.arcs || outerExtras.ticks ? 1.22 : 1.04;
    addLayer('frame', reach, 0.9, (p) => {
      p.ink('a');
      circle(p, 1, style === 0 ? 2.2 : 1.6);
      if (style !== 1) circle(p, 0.985, 0.6, 0.8);
      if (style === 2) dashedCircle(p, 1.02, fr.int(40, 90), 0.5, 0.7, 0.7);
      const r1 = 0.965;
      const r0 = r1 - bandH;
      p.ink('b');
      if (bigLetters) {
        // few, big letters with separators (like the old grimoires)
        const n = fr.pick([6, 8, 10, 12]);
        const seq = text(g.name, g.punishment).filter((x) => x >= 0);
        around(p, n, (r0 + r1) / 2, (i) => {
          p.ctx.globalAlpha = 1;
          drawGlyph(p.ctx, seq.length ? seq[i % seq.length] : i, bandH * 0.9);
        });
        p.ink('a');
        for (let i = 0; i < n; i++) {
          const t = ((i + 0.5) / n) * TAU - Math.PI / 2;
          const [x1, y1] = polar(r0, t);
          const [x2, y2] = polar(r1, t);
          line(p, x1, y1, x2, y2, 0.8, 0.8);
        }
      } else glyphRing(p, (r0 + r1) / 2, bandH, text(g.name, g.reason), { sep: fr.pick(['dot', 'diamond', 'bar'] as const) });
      p.ink('a');
      circle(p, r0, 1.2);
      if (fr.chance(0.6)) circle(p, r0 - 0.012, 0.5, 0.7);
      if (outerExtras.blades) {
        // sword-like blades radiating outwards
        p.ink('c');
        const n = fr.pick([8, 12, 16, 24]);
        const len = fr.range(0.25, 0.45);
        around(p, n, 1.04, (i) => {
          const l = len * (i % 2 ? 0.65 : 1);
          const { ctx } = p;
          ctx.globalAlpha = 0.95;
          ctx.beginPath();
          ctx.moveTo(-0.012, 0);
          ctx.lineTo(0, -l);
          ctx.lineTo(0.012, 0);
          ctx.closePath();
          ctx.fill();
          line(p, -0.035, -0.02, 0.035, -0.02, 1, 0.9);
          dot(p, 0, 0.012, 0.008, 1);
        }, fr.range(0, TAU));
      }
      if (outerExtras.ticks) {
        p.ink('a');
        const groups = fr.pick([4, 6, 8, 12]);
        for (let gi = 0; gi < groups; gi++) {
          const base = (gi / groups) * TAU;
          for (let k = -3; k <= 3; k++) {
            const t = base + k * 0.018;
            const [x1, y1] = polar(1.09, t);
            const [x2, y2] = polar(k === 0 ? 1.18 : 1.13, t);
            line(p, x1, y1, x2, y2, 0.8, 0.8);
          }
        }
      }
      if (outerExtras.arcs) {
        p.ink('c');
        const segs = fr.int(3, 9);
        for (let i = 0; i < segs; i++) {
          const t = fr.range(0, TAU);
          const l = fr.range(0.3, 1.2);
          const r = fr.range(1.06, 1.2);
          arc(p, r, t, t + l, fr.range(0.6, 1.2), 0.85);
          const [x, y] = polar(r, t + l);
          dot(p, x, y, 0.012, 1);
        }
      }
    });
  }

  // ---------- 2. Satellites (often breaking out of the frame)
  if (rng.chance(0.78)) {
    const sr = rng.fork(22);
    const k = sr.pick([2, 3, 3, 4, 4, 5, 6, 7, 8]);
    const orbit = sr.range(0.78, 1.12);
    const size = Math.min(0.34, sr.range(0.12, 0.3) * (k <= 4 ? 1.25 : 0.85));
    const irregular = sr.chance(0.2);
    const phase = sr.range(0, TAU);
    const angles = Array.from({ length: k }, (_, i) => phase + (i / k) * TAU + (irregular ? sr.range(-0.3, 0.3) : 0));
    const detail = 1;
    addLayer('satellites', orbit + size + 0.02, 0.85, (p) => {
      if (sr.chance(0.5)) {
        p.ink('a');
        circle(p, orbit, 0.5, 0.5);
      }
      angles.forEach((a, i) => {
        p.ctx.save();
        p.ctx.translate(Math.cos(a) * orbit, Math.sin(a) * orbit);
        p.ctx.rotate(a + Math.PI / 2);
        miniCircle(p, size, sr.fork(i), g, sigils[1 + (i % 4)], detail);
        p.ctx.restore();
      });
    });
  }

  // ---------- 3. Main figure — varied architecture
  let figure = '';
  {
    const fr = rng.fork(33);
    const R = fr.range(0.6, 0.86);
    const rot = -Math.PI / 2 + (fr.chance(0.3) ? Math.PI / fr.int(3, 9) : 0);
    const kind = fr.pick(['star', 'star', 'polygon', 'compound', 'rounded', 'concave', 'glyphEdges', 'nested', 'triangle'] as const);
    const n = kind === 'triangle' ? 3 : fr.int(kind === 'star' ? 5 : 3, kind === 'star' ? 12 : 9);
    const k = Math.max(2, Math.min(Math.floor((n - 1) / 2), fr.int(2, 4)));
    const vertexDecor = fr.pick(['none', 'dots', 'rings', 'medallions', 'medallions', 'spokes'] as const);
    figure = `${kind}-${n}`;
    addLayer('figure', R * 1.12, 1, (p) => {
      p.ink('a');
      const pts = polygonPts(n, R, rot);
      switch (kind) {
        case 'star':
          for (const loop of starPoly(n, k, R, rot)) strokePoly(p, loop, 1.4, 1);
          if (fr.chance(0.5)) {
            p.ctx.save();
            p.ctx.scale(0.95, 0.95);
            for (const loop of starPoly(n, k, R, rot)) strokePoly(p, loop, 0.6 / 0.95, 0.45);
            p.ctx.restore();
          }
          break;
        case 'triangle':
        case 'polygon':
          strokePoly(p, pts, 1.6, 1);
          if (fr.chance(0.6)) strokePoly(p, polygonPts(n, R * Math.cos(Math.PI / n), rot + Math.PI / n), 0.8, 0.7);
          break;
        case 'compound': {
          const copies = fr.int(2, 4);
          for (let c = 0; c < copies; c++) strokePoly(p, polygonPts(n, R, rot + (c / copies) * (TAU / n)), 1.2, 1 - c * 0.12);
          break;
        }
        case 'rounded':
          curvedPoly(p, n, R, rot, fr.range(0.08, 0.3), 1.5, 1);
          curvedPoly(p, n, R * 0.9, rot + Math.PI / n, fr.range(0.05, 0.2), 0.7, 0.6);
          break;
        case 'concave':
          curvedPoly(p, n, R, rot, -fr.range(0.15, 0.45), 1.5, 1);
          break;
        case 'glyphEdges': {
          // letters running along the edges of the figure (two parallel rails)
          const loops = n >= 5 && fr.chance(0.6) ? starPoly(n, k, R, rot) : [pts];
          for (const loop of loops) {
            for (let i = 0; i < loop.length; i++) {
              const [x1, y1] = loop[i];
              const [x2, y2] = loop[(i + 1) % loop.length];
              const nx = -(y2 - y1);
              const ny = x2 - x1;
              const nl = Math.hypot(nx, ny) || 1;
              const off = 0.035;
              p.ink('a');
              line(p, x1 + (nx / nl) * off, y1 + (ny / nl) * off, x2 + (nx / nl) * off, y2 + (ny / nl) * off, 1, 1);
              line(p, x1 - (nx / nl) * off, y1 - (ny / nl) * off, x2 - (nx / nl) * off, y2 - (ny / nl) * off, 1, 1);
              p.ink('b');
              glyphLine(p, x1, y1, x2, y2, off * 1.7, words[i % 3]);
            }
          }
          p.ink('a');
          break;
        }
        case 'nested': {
          const depth = fr.int(3, 5);
          for (let d = 0; d < depth; d++) {
            const rr = R * Math.pow(Math.cos(Math.PI / n), d);
            strokePoly(p, polygonPts(n, rr, rot + (d * Math.PI) / n), 1.3 - d * 0.15, 1 - d * 0.12);
          }
          break;
        }
      }
      if (fr.chance(0.55)) circle(p, R, 0.8, 0.8);
      if (fr.chance(0.4)) circle(p, R * Math.cos(Math.PI / n) * 0.98, 0.6, 0.6);
      // vertex decorations
      pts.forEach(([x, y], i) => {
        p.ctx.save();
        p.ctx.translate(x, y);
        if (vertexDecor === 'dots') {
          p.ink('c');
          dot(p, 0, 0, 0.018, 1);
        } else if (vertexDecor === 'rings') {
          disc(p, 0.035);
          p.ink('c');
          circle(p, 0.035, 1);
          dot(p, 0, 0, 0.01, 1);
        } else if (vertexDecor === 'medallions') {
          p.ctx.rotate(Math.atan2(y, x) + Math.PI / 2);
          miniCircle(p, fr.range(0.06, 0.1), fr.fork(i), g, sigils[5 + (i % 3)], 0);
        }
        p.ctx.restore();
        if (vertexDecor === 'spokes') {
          p.ink('a');
          line(p, 0, 0, x, y, 0.5, 0.5);
        }
      });
    });
  }

  // ---------- 4. Bands (1..3), each with a freshly grown ornament
  {
    const br = rng.fork(44);
    const bands = br.int(1, 3);
    let top = br.range(0.6, 0.74);
    for (let b = 0; b < bands && top > 0.3; b++) {
      const h = br.range(0.045, 0.1);
      const r1 = top;
      const r0 = r1 - h;
      const kind = br();
      const lrng = br.fork(b);
      addLayer(`band${b}`, r1 + 0.02, 0.85, (p) => {
        if (kind < 0.35) {
          p.ink('b');
          glyphRing(p, (r0 + r1) / 2, h, text(words[(b + 2) % 3], words[b % 3]), { sep: lrng.pick(['dot', 'diamond', 'bar', 'none'] as const) });
          p.ink('a');
          circle(p, r0, 0.9);
          circle(p, r1, 0.9);
        } else {
          p.ink(lrng.chance(0.7) ? 'a' : 'c');
          motifBand(p, r0, r1, lrng, words[b % 3], sigils[2 + b]);
        }
        if (lrng.chance(0.3)) {
          p.ink('c');
          dashedCircle(p, r0 - 0.015, lrng.int(24, 72), lrng.range(0.2, 0.6), 0.7, 0.8);
        }
      });
      top = r0 - br.range(0.03, 0.12);
    }
  }

  // ---------- 5. Cardinal medallions (sit on a middle ring, overlapping it)
  if (rng.chance(0.45)) {
    const mr = rng.fork(55);
    const k = mr.pick([3, 4, 4, 5, 6]);
    const orbit = mr.range(0.34, 0.5);
    const size = mr.range(0.1, 0.16);
    const phase = -Math.PI / 2 + (mr.chance(0.5) ? Math.PI / k : 0);
    addLayer('medallions', orbit + size + 0.02, 0.9, (p) => {
      p.ink('a');
      circle(p, orbit, 1.2, 0.9);
      for (let i = 0; i < k; i++) {
        const a = phase + (i / k) * TAU;
        p.ctx.save();
        p.ctx.translate(Math.cos(a) * orbit, Math.sin(a) * orbit);
        p.ctx.rotate(a + Math.PI / 2);
        miniCircle(p, size, mr.fork(i), g, sigils[(i % 3) + 6], 1);
        p.ctx.restore();
      }
    });
  }

  // ---------- 6. Mechanism: gear, lattice or string art
  if (rng.chance(0.6)) {
    const gr = rng.fork(66);
    const kind = gr.pick(['gear', 'lattice', 'chords', 'seed'] as const);
    const R = gr.range(0.28, 0.46);
    addLayer('mechanism', R + 0.04, 0.7, (p) => {
      p.ink(gr.chance(0.5) ? 'a' : 'c');
      if (kind === 'gear') {
        const teeth = gr.int(24, 64);
        const { ctx } = p;
        ctx.lineWidth = p.lw;
        ctx.globalAlpha = 0.95;
        ctx.beginPath();
        for (let i = 0; i < teeth; i++) {
          const a0 = (i / teeth) * TAU;
          const s = [[R * 0.93, a0], [R, a0 + 0.2 * TAU / teeth], [R, a0 + 0.5 * TAU / teeth], [R * 0.93, a0 + 0.7 * TAU / teeth]] as const;
          s.forEach(([r, a], j) => {
            const [x, y] = polar(r, a);
            if (i === 0 && j === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
        }
        ctx.closePath();
        ctx.stroke();
        const sp = gr.int(3, 8);
        for (let i = 0; i < sp; i++) {
          const t = (i / sp) * TAU;
          const [x1, y1] = polar(R * 0.25, t);
          const [x2, y2] = polar(R * 0.88, t);
          line(p, x1, y1, x2, y2, 1.4, 0.9);
        }
        circle(p, R * 0.88, 0.8);
        circle(p, R * 0.25, 1);
      } else if (kind === 'lattice') {
        const n = gr.int(6, 12);
        const rr = R * 0.5;
        circle(p, rr, 0.8, 0.8);
        around(p, n, rr, () => circle(p, rr, 0.6, 0.6));
      } else if (kind === 'chords') {
        const n = gr.int(9, 19);
        const k = Math.max(2, Math.floor(n / gr.range(2.1, 3.5)));
        const pts = polygonPts(n, R, -Math.PI / 2);
        for (let i = 0; i < n; i++) line(p, pts[i][0], pts[i][1], pts[(i + k) % n][0], pts[(i + k) % n][1], 0.7, 0.75);
        p.ink('c');
        pts.forEach(([x, y]) => dot(p, x, y, 0.009, 1));
      } else {
        const n = gr.pick([6, 8, 12]);
        const rr = R * 0.5;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU;
          p.ctx.save();
          p.ctx.translate(Math.cos(a) * rr, Math.sin(a) * rr);
          circle(p, rr, 0.6, 0.7);
          p.ctx.restore();
        }
        circle(p, R, 1, 0.9);
      }
    });
  }

  // ---------- 7. Core emblem
  {
    const cr = rng.fork(77);
    const R = cr.range(0.13, 0.26);
    const kind = cr.pick(['sigil', 'sigil', 'spiral', 'letter', 'eye'] as const);
    const thick = cr.chance(0.4);
    addLayer('core', R + 0.03, 1.1, (p) => {
      disc(p, R);
      p.ink('a');
      if (thick) {
        // a solid glowing annulus, like the heart of the seal
        p.ctx.globalAlpha = 0.42;
        p.ctx.beginPath();
        p.ctx.arc(0, 0, R, 0, TAU);
        p.ctx.arc(0, 0, R * 0.86, 0, TAU, true);
        p.ctx.fill('evenodd');
        p.erase();
        dashedCircle(p, R * 0.91, cr.int(8, 20), 0.12, 1.4, 1);
        p.ink('a');
      } else {
        circle(p, R, 1.4);
        circle(p, R * 0.92, 0.6, 0.7);
      }
      const inner = R * (thick ? 0.78 : 0.88);
      if (cr.chance(0.55)) {
        p.ink('b');
        glyphRing(p, inner - R * 0.08, R * 0.14, g.name, { sep: 'dot' });
        p.ink('a');
        circle(p, inner - R * 0.17, 0.7, 0.9);
      }
      const e = inner * 0.72;
      p.ctx.globalAlpha = 1;
      if (kind === 'sigil') {
        p.ink('c');
        drawSigil(p.ctx, sigils[0], e, 1.2);
      } else if (kind === 'spiral') {
        p.ink('c');
        const arms = cr.int(3, 6);
        for (let a = 0; a < arms; a++) {
          p.ctx.lineWidth = p.lw * 1.3;
          p.ctx.beginPath();
          for (let i = 0; i <= 60; i++) {
            const t = i / 60;
            const [x, y] = polar(e * (0.1 + 0.9 * t), (a / arms) * TAU + dir * t * 2.6);
            if (i) p.ctx.lineTo(x, y);
            else p.ctx.moveTo(x, y);
          }
          p.ctx.stroke();
        }
      } else if (kind === 'letter') {
        p.ink('b');
        const first = g.name.find((x) => x >= 0) ?? 0;
        drawGlyph(p.ctx, first, e * 1.5);
      } else {
        p.ink('c');
        p.ctx.lineWidth = p.lw * 1.3;
        p.ctx.beginPath();
        p.ctx.moveTo(-e, 0);
        p.ctx.quadraticCurveTo(0, -e * 0.8, e, 0);
        p.ctx.quadraticCurveTo(0, e * 0.8, -e, 0);
        p.ctx.stroke();
        dot(p, 0, 0, e * 0.25, 1);
      }
    });
  }

  // ---------- 8. Faint giant geometry behind everything (big triangles / lines)
  if (rng.chance(0.55)) {
    const hr = rng.fork(88);
    const n = hr.pick([3, 4, 6]);
    addLayer('ghost', 1.05, 0.35, (p) => {
      p.ink('a');
      for (const loop of starPoly(n * 2, 2, 1, hr.range(0, TAU))) strokePoly(p, loop, 0.6, 0.5);
      const spokes = hr.pick([4, 6, 8]);
      for (let i = 0; i < spokes; i++) {
        const [x, y] = polar(1, (i / spokes) * TAU);
        line(p, 0, 0, x, y, 0.4, 0.35);
      }
    }, { zSlot: -0.6 });
  }

  // ---------- 9. Hanging inscriptions: float above the certificate at the end
  {
    const hr = rng.fork(99);
    const count = hr.int(1, 2);
    for (let i = 0; i < count; i++) {
      // radius chosen so that, lifted above the certificate, it frames the sheet
      const R = 0.66 + i * 0.1 + hr.range(0, 0.05);
      const h = hr.range(0.04, 0.06);
      addLayer(`hang${i}`, R + h, 0.55, (p) => {
        p.ink('b');
        glyphRing(p, R, h, text(words[(i + 1) % 3], words[i % 3]), { sep: 'diamond' });
        p.ink('a');
        if (hr.chance(0.6)) {
          dashedCircle(p, R + h * 0.75, hr.int(20, 60), 0.5, 0.6, 0.8);
          dashedCircle(p, R - h * 0.75, hr.int(20, 60), 0.5, 0.6, 0.8);
        }
      }, { hang: true, zSlot: 2 + i });
    }
  }

  // ---------- tunnel passers: rings, sigils and inscriptions that fly past the camera
  const passers: PasserArt[] = [];
  for (let i = 0; i < 6; i++) {
    const pr = rng.fork(500 + i);
    const kind = i % 6;
    passers.push({
      radius: 1.08,
      draw: (p) => {
        if (kind === 0) {
          p.ink('b');
          glyphRing(p, 0.93, 0.1, words[i % 3], { sep: 'dot' });
          p.ink('a');
          circle(p, 1, 1.2);
          circle(p, 0.86, 0.8);
        } else if (kind === 1) {
          miniCircle(p, 0.95, pr, g, sigils[i % sigils.length], 1);
        } else if (kind === 2) {
          p.ink('c');
          dashedCircle(p, 1, pr.int(12, 40), pr.range(0.2, 0.7), 1.4, 1);
          dashedCircle(p, 0.9, pr.int(40, 90), 0.4, 0.8, 0.8);
        } else if (kind === 3) {
          p.ink('a');
          const n = pr.int(5, 9);
          for (const loop of starPoly(n, Math.floor(n / 2), 0.95, -Math.PI / 2)) strokePoly(p, loop, 1.4, 1);
          circle(p, 0.95, 1);
        } else if (kind === 4) {
          p.ink('a');
          motifBand(p, 0.8, 0.98, pr, words[i % 3], sigils[i]);
        } else {
          p.ink('c');
          p.ctx.globalAlpha = 1;
          drawSigil(p.ctx, sigils[3 + (i % 5)], 0.9, 1.1);
        }
      },
    });
  }

  return { palette, layers, passers, sigils, architecture: `${arch}/${figure}/${palette.name}` };
}
