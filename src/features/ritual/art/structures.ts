// Large Structure: the composition archetype of the magic circle.
//
// Before anything is drawn the curse picks WHAT KIND of figure it grows into: the classic
// ringed circle is only one of them. The others have no big outer ring at all: seals far apart
// and linked, an off-centre orbit, a chain of overlapping circles, a broken ring, two poles, a
// vertical totem, a cross of long rays, an asymmetric trunk with branches, a frame of brackets
// around an empty centre, a constellation of signs, a spiral, an arch, wings, a wedge, and a
// "seal without a seal" (a big geometric silhouette with no rim). Each archetype then grows
// its own parts (seals, emblems, links, terminals, inscriptions) with continuous random
// parameters, so the same archetype never looks the same twice.
//
// Every piece that can move by itself is its own layer: it sits at its own depth and position
// (`at`) and round pieces spin in place, while lines and non-round pieces keep their angle.
import type { Rng } from '../../../utils/seed/seed';
import { makeRng } from '../../../utils/seed/seed';
import { drawGlyph } from '../../../utils/glyphs/glyphLibrary';
import { drawSign, EMBLEM_SIGNS, ORNATE_SIGNS } from '../../../utils/glyphs/signLibrary';
import { drawSigil, type Sigil } from './sigils';
import type { GeneratorInput, Pen } from './generator';
import {
  TAU, CAPS, arc, cap, circle, crescent, disc, dot, glyphArc, glyphPath, glyphRing, line,
  link, lotus, miniCircle, node, offsetPath, pathAt, pathLength, polar, polygonPts, quadPts, starPoly, strokePath, strokePoly,
  sunRays, trimPath, type CapKind, type LinkKind, type Pt,
} from './primitives';

export type Structure =
  | 'classic' | 'separated' | 'orbit' | 'chain' | 'broken' | 'poles' | 'totem' | 'cross' | 'trunk' | 'frame'
  | 'constellation' | 'spiral' | 'arch' | 'wings' | 'wedge' | 'silhouette';

/** The draw: the classic circle is one archetype among many (and rarer than it used to be). */
const WEIGHTS: [Structure, number][] = [
  ['classic', 2], ['separated', 1.2], ['orbit', 1], ['chain', 1], ['broken', 1.1], ['poles', 1], ['totem', 1.1],
  ['cross', 1], ['trunk', 0.9], ['frame', 1], ['constellation', 1], ['spiral', 0.9], ['arch', 0.9], ['wings', 1.1],
  ['wedge', 0.8], ['silhouette', 1.1],
];

export function pickStructure(r: Rng): Structure {
  const forced = typeof location !== 'undefined' && import.meta.env.DEV ? new URLSearchParams(location.search).get('structure') : null;
  if (forced && WEIGHTS.some(([s]) => s === forced)) return forced as Structure;
  const total = WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [s, w] of WEIGHTS) {
    x -= w;
    if (x < 0) return s;
  }
  return 'classic';
}

export interface AddOpt {
  /** Centre of the layer (default: the middle). */
  at?: Pt;
  /** Own turning speed; 0 (default) keeps the drawn angle. */
  spin?: number;
}

export interface Kit {
  g: GeneratorInput;
  words: number[][];
  sigils: Sigil[];
  dir: 1 | -1;
  add: (id: string, radius: number, intensity: number, draw: (p: Pen) => void, opt?: AddOpt) => void;
}

// ------------------------------------------------------------------ helpers

/**
 * The field the structures fill: a 16:9 screen at the end of the ritual (the frame radius 1 is
 * 0.54 of the screen height). The certificate then covers the middle, so the sides matter most.
 */
const FW = 1.56;
const FH = 0.88;

interface Foot {
  c: Pt;
  r: number;
}

/** How the links of one structure look: a main line plus companions and a middle ornament. */
interface Bundle {
  main: LinkKind;
  side: 'lines' | 'dashes' | 'braid' | 'bridge' | 'none';
  mid: 'node' | 'emblem' | 'bars' | 'none';
  e: Emblem;
  gap: number;
}

/** The kit as the archetypes see it: it also remembers where things are (to fill the gaps). */
interface SKit extends Kit {
  foot: Foot[];
  mark: (c: Pt, r: number) => void;
  B: Bundle;
}

const seedOf = (r: Rng) => r.int(1, 2 ** 30);
const clampF = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const add2 = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];

/** Own spin of a round piece: some turn briskly, most barely move. */
function spinOf(r: Rng) {
  return (r.chance(0.45) ? r.range(0.25, 0.7) : r.range(0.04, 0.14)) * r.sign();
}

/** A straight or bent path between two points (bend = sideways pull, relative to the length). */
function bend(a: Pt, b: Pt, k: number, n = 32): Pt[] {
  if (Math.abs(k) < 1e-3) return [a, b];
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  return quadPts(a, [mx - (b[1] - a[1]) * k, my + (b[0] - a[0]) * k], b, n);
}

/** A link between two pieces, starting and ending just outside their rims. */
function linkBetween(p: Pen, a: Pt, ra: number, b: Pt, rb: number, kind: LinkKind, k: number, r: Rng, glyphs: number[], scale = 1) {
  const pts = trimPath(bend(a, b, k), ra + 0.03, rb + 0.03);
  if (pts.length > 1) link(p, pts, kind, r, glyphs, scale);
}

/** Letters between two rails along any path. */
function textRail(p: Pen, pts: Pt[], h: number, glyphs: number[], a = 1) {
  p.ink('a');
  strokePath(p, offsetPath(pts, h * 0.62), 0.8, 0.9 * a);
  strokePath(p, offsetPath(pts, -h * 0.62), 0.8, 0.9 * a);
  p.ink('b');
  glyphPath(p, pts, h, glyphs, a);
}

/** A band along an arc of the circle of radius R around the origin, from a0 to a1. */
function arcBand(p: Pen, R: number, h: number, a0: number, a1: number, style: 'text' | 'knock' | 'double' | 'ticks' | 'dash', glyphs: number[]) {
  const { ctx } = p;
  if (style === 'text') {
    p.ink('a');
    arc(p, R + h / 2, a0, a1, 0.9, 0.95);
    arc(p, R - h / 2, a0, a1, 0.9, 0.95);
    p.ink('b');
    glyphArc(p, R, a0 + h / R, a1 - h / R, h * 0.95, glyphs);
  } else if (style === 'knock') {
    p.ink('c');
    ctx.globalAlpha = 0.34;
    ctx.beginPath();
    ctx.arc(0, 0, R + h / 2, a0, a1);
    ctx.arc(0, 0, R - h / 2, a1, a0, true);
    ctx.closePath();
    ctx.fill();
    p.erase();
    glyphArc(p, R, a0 + h / R, a1 - h / R, h * 0.72, glyphs);
    p.ink('a');
    arc(p, R + h / 2, a0, a1, 0.8, 0.9);
    arc(p, R - h / 2, a0, a1, 0.8, 0.9);
  } else if (style === 'double') {
    p.ink('a');
    arc(p, R + h * 0.3, a0, a1, 1.4, 1);
    arc(p, R - h * 0.3, a0, a1, 0.6, 0.8);
  } else if (style === 'ticks') {
    p.ink('a');
    arc(p, R - h / 2, a0, a1, 1, 0.95);
    const n = Math.max(3, Math.round(((a1 - a0) * R) / (h * 0.45)));
    for (let i = 0; i <= n; i++) {
      const t = a0 + ((a1 - a0) * i) / n;
      const [x1, y1] = polar(R - h / 2, t);
      const [x2, y2] = polar(R + (i % 4 === 0 ? h * 0.7 : h * 0.15), t);
      line(p, x1, y1, x2, y2, 0.8, 0.9);
    }
  } else {
    p.ink('a');
    const n = Math.max(4, Math.round(((a1 - a0) * R) / 0.035));
    for (let i = 0; i < n; i++) {
      const t = a0 + ((a1 - a0) * i) / n;
      arc(p, R, t, t + ((a1 - a0) / n) * 0.55, 1, 0.9);
    }
  }
}

// ------------------------------------------------------------------ emblems and seals

type EmblemKind =
  | 'sigil' | 'sign' | 'ornate' | 'star' | 'moonStar' | 'eye' | 'eyeTri' | 'sun' | 'lotus' | 'letter' | 'hexagram'
  | 'seal' | 'hourglass' | 'ankh' | 'mercury' | 'sulfur' | 'spiral';

/** Stand upright on an axis (totem heads, wing centres, wedge tips). */
const UPRIGHT: readonly EmblemKind[] = ['sigil', 'ornate', 'ornate', 'ornate', 'sign', 'sign', 'moonStar', 'eyeTri', 'hourglass', 'ankh', 'mercury', 'sulfur', 'letter'];
/** Look good turning. */
const ROUND: readonly EmblemKind[] = ['seal', 'seal', 'seal', 'sun', 'lotus', 'star', 'hexagram', 'eye', 'sign', 'spiral'];
const ANY: readonly EmblemKind[] = [...UPRIGHT, ...ROUND];
const TURNS = new Set<EmblemKind>(['seal', 'sun', 'lotus', 'star', 'hexagram', 'spiral']);

interface Emblem {
  kind: EmblemKind;
  seed: number;
}

function pickEmblem(r: Rng, pool: readonly EmblemKind[]): Emblem {
  return { kind: r.pick(pool), seed: seedOf(r) };
}

/** Draws an emblem centred at the origin; `s` = half of its size. */
function drawEmblem(p: Pen, K: Kit, e: Emblem, s: number) {
  const r = makeRng(e.seed);
  const { ctx } = p;
  const sigil = K.sigils[r.int(0, K.sigils.length - 1)];
  ctx.globalAlpha = 1;
  switch (e.kind) {
    case 'sigil':
      p.ink('c');
      drawSigil(ctx, sigil, s * 0.95, 1.1);
      break;
    case 'sign':
      // solid silhouettes: kept small enough not to turn into blots
      p.ink(r.chance(0.6) ? 'c' : 'a');
      drawSign(ctx, r.pick(EMBLEM_SIGNS), Math.min(s, 0.2) * 0.95);
      break;
    case 'ornate':
      p.ink(r.chance(0.6) ? 'c' : 'a');
      drawSign(ctx, r.pick(ORNATE_SIGNS), Math.min(s, 0.24));
      break;
    case 'star': {
      p.ink('a');
      const n = r.int(5, 9);
      const k = n === 6 ? 2 : Math.max(2, Math.floor((n - 1) / 2) - (r.chance(0.3) ? 1 : 0));
      for (const loop of starPoly(n, k, s, -Math.PI / 2)) strokePoly(p, loop, 1.3, 1);
      p.ink('c');
      if (r.chance(0.5)) circle(p, s * 0.3, 0.9, 1);
      dot(p, 0, 0, s * 0.09, 1);
      break;
    }
    case 'moonStar':
      p.ink('c');
      if (s > 0.17) {
        // a big moon is drawn in outline, with a faint body
        crescent(p, 0, s * 0.18, s * 0.78, -Math.PI / 2, 0.42, false, 1.4, 1);
        crescent(p, 0, s * 0.18, s * 0.78, -Math.PI / 2, 0.42, true, 1, 0.3);
      } else crescent(p, 0, s * 0.18, s * 0.78, -Math.PI / 2, r.range(0.38, 0.5));
      p.ink('a');
      ctx.save();
      ctx.translate(0, -s * 0.12);
      for (const loop of starPoly(5, 2, s * 0.26, -Math.PI / 2)) strokePoly(p, loop, 1, 1);
      ctx.restore();
      break;
    case 'eye': {
      p.ink('a');
      ctx.lineWidth = p.lw * 1.3;
      ctx.beginPath();
      ctx.moveTo(-s, 0);
      ctx.quadraticCurveTo(0, -s * 0.85, s, 0);
      ctx.quadraticCurveTo(0, s * 0.85, -s, 0);
      ctx.stroke();
      p.ink('c');
      circle(p, s * 0.32, 1, 1);
      dot(p, 0, 0, s * 0.14, 1);
      if (r.chance(0.6)) {
        for (let i = -3; i <= 3; i++) {
          const a = -Math.PI / 2 + i * 0.32;
          const [x1, y1] = polar(s * 0.62, a);
          const [x2, y2] = polar(s * (i % 2 ? 0.82 : 0.95), a);
          line(p, x1, y1 + s * 0.05, x2, y2 + s * 0.05, 0.9, 0.9);
        }
      }
      break;
    }
    case 'eyeTri': {
      p.ink('a');
      strokePoly(p, polygonPts(3, s, -Math.PI / 2), 1.3, 1);
      p.ink('c');
      const q = s * 0.42;
      ctx.lineWidth = p.lw * 1.1;
      ctx.beginPath();
      ctx.moveTo(-q, s * 0.12);
      ctx.quadraticCurveTo(0, s * 0.12 - q * 0.75, q, s * 0.12);
      ctx.quadraticCurveTo(0, s * 0.12 + q * 0.75, -q, s * 0.12);
      ctx.stroke();
      dot(p, 0, s * 0.12, q * 0.26, 1);
      break;
    }
    case 'sun':
      p.ink('c');
      sunRays(p, s * 0.46, s, r.pick([12, 16, 20]), r.chance(0.5));
      circle(p, s * 0.46, 1.2, 1);
      p.ink('a');
      if (r.chance(0.5)) drawSigil(ctx, sigil, s * 0.3, 1);
      else dot(p, 0, 0, s * 0.12, 1);
      break;
    case 'lotus':
      p.ink('c');
      lotus(p, s, r.pick([6, 8, 10, 12]), r.int(1, 2), 1);
      p.ink('a');
      circle(p, s * 0.16, 1, 1);
      break;
    case 'letter': {
      p.ink('b');
      const seq = K.g.name.filter((x) => x >= 0);
      drawGlyph(ctx, seq.length ? seq[r.int(0, seq.length - 1)] : 0, s * 1.5);
      break;
    }
    case 'hexagram': {
      p.ink('a');
      for (const loop of starPoly(6, 2, s, -Math.PI / 2)) strokePoly(p, loop, 1.2, 1);
      p.ink('c');
      polygonPts(6, s, -Math.PI / 2).forEach(([x, y]) => dot(p, x, y, s * 0.07, 1));
      dot(p, 0, 0, s * 0.1, 1);
      break;
    }
    case 'seal':
      miniCircle(p, s * 0.95, r, K.g, sigil, s > 0.2 ? 2 : 1);
      break;
    case 'hourglass': {
      p.ink('a');
      const w = s * 0.55;
      strokePoly(p, [[-w, -s * 0.85], [w, -s * 0.85], [0, 0]], 1.2, 1);
      strokePoly(p, [[-w, s * 0.85], [w, s * 0.85], [0, 0]], 1.2, 1);
      line(p, -w * 1.3, -s, w * 1.3, -s, 1.2, 1);
      line(p, -w * 1.3, s, w * 1.3, s, 1.2, 1);
      p.ink('c');
      dot(p, 0, s * 0.55, s * 0.1, 1);
      break;
    }
    case 'ankh':
      p.ink('a');
      ctx.lineWidth = p.lw * 1.4;
      ctx.beginPath();
      ctx.ellipse(0, -s * 0.52, s * 0.3, s * 0.42, 0, 0, TAU);
      ctx.stroke();
      line(p, 0, -s * 0.1, 0, s, 1.4, 1);
      line(p, -s * 0.55, -s * 0.05, s * 0.55, -s * 0.05, 1.4, 1);
      p.ink('c');
      dot(p, 0, -s * 0.52, s * 0.08, 1);
      break;
    case 'mercury':
      p.ink('a');
      circle(p, s * 0.3, 1.3, 1);
      arc(p, s * 0.3, Math.PI * 1.1, Math.PI * 1.9, 1.3, 1);
      ctx.save();
      ctx.translate(0, -s * 0.52);
      arc(p, s * 0.3, 0.15, Math.PI - 0.15, 1.3, 1);
      ctx.restore();
      line(p, 0, s * 0.3, 0, s, 1.3, 1);
      line(p, -s * 0.28, s * 0.66, s * 0.28, s * 0.66, 1.3, 1);
      break;
    case 'sulfur':
      p.ink('a');
      strokePoly(p, [[0, -s], [s * 0.58, -s * 0.05], [-s * 0.58, -s * 0.05]], 1.3, 1);
      line(p, 0, -s * 0.05, 0, s, 1.3, 1);
      line(p, -s * 0.4, s * 0.35, s * 0.4, s * 0.35, 1.3, 1);
      if (r.chance(0.6)) line(p, -s * 0.28, s * 0.7, s * 0.28, s * 0.7, 1.3, 1);
      p.ink('c');
      dot(p, 0, -s * 0.36, s * 0.08, 1);
      break;
    case 'spiral': {
      p.ink('c');
      if (r.chance(0.5)) {
        drawSign(ctx, 0, s * 0.95);
        break;
      }
      const arms = r.int(2, 4);
      for (let a = 0; a < arms; a++) {
        const pts: Pt[] = [];
        for (let i = 0; i <= 50; i++) {
          const t = i / 50;
          pts.push(polar(s * (0.1 + 0.9 * t), (a / arms) * TAU + K.dir * t * 2.8));
        }
        strokePath(p, pts, 1.3, 1);
      }
      break;
    }
  }
  ctx.globalAlpha = 1;
}

/** Adds an emblem as its own layer (round ones may spin, the others keep upright). */
function addEmblem(K: SKit, r: Rng, id: string, at: Pt, s: number, pool: readonly EmblemKind[], intensity = 1, e = pickEmblem(r, pool)) {
  const spin = TURNS.has(e.kind) && r.chance(0.7) ? spinOf(r) : 0;
  K.add(id, s * 1.12, intensity, (p) => drawEmblem(p, K, e, s), { at, spin });
  K.mark(at, s);
  return e;
}

type SealKind = 'mini' | 'ringed' | 'rays' | 'broken' | 'ring';

/** A seal: a rich small circle (letters, a figure and a heart), sometimes with a corona or a broken rim. */
function drawSeal(p: Pen, K: Kit, kind: SealKind, seed: number, R: number, words: number[]) {
  const r = makeRng(seed);
  const sigil = K.sigils[r.int(0, K.sigils.length - 1)];
  if (kind === 'mini') {
    miniCircle(p, R, r, K.g, sigil, R > 0.24 ? 2 : 1);
  } else if (kind === 'ringed') {
    disc(p, R * 1.02);
    const h = R * r.range(0.13, 0.18);
    p.ink('a');
    circle(p, R, 1.4, 1);
    circle(p, R - h, 0.9, 0.95);
    p.ink('b');
    glyphRing(p, R - h / 2, h * 0.8, words, { sep: r.pick(['dot', 'diamond', 'bar'] as const) });
    miniCircle(p, (R - h) * 0.94, r, K.g, sigil, R > 0.3 ? 2 : 1);
  } else if (kind === 'rays') {
    p.ink('c');
    sunRays(p, R * 1.02, R * r.range(1.2, 1.32), r.pick([16, 24, 32]), r.chance(0.4));
    miniCircle(p, R, r, K.g, sigil, R > 0.24 ? 2 : 1);
  } else if (kind === 'broken') {
    disc(p, R);
    const m = r.int(3, 5);
    const ph = r.range(0, TAU);
    const h = R * 0.16;
    for (let i = 0; i < m; i++) {
      const a0 = ph + (i / m) * TAU + 0.12;
      const a1 = ph + ((i + 1) / m) * TAU - 0.12;
      arcBand(p, R - h / 2, h, a0, a1, i % 2 ? 'text' : 'double', words);
      p.ink('c');
      const [x, y] = polar(R - h / 2, a1 + 0.12);
      dot(p, x, y, h * 0.22, 1);
    }
    drawEmblem(p, K, { kind: r.pick(['sigil', 'star', 'sign', 'hexagram', 'eye'] as const), seed: seedOf(r) }, R * 0.55);
  } else {
    // a plain ring with letters and one sign in it (reads as "interlocked rings" in a chain)
    const h = R * 0.2;
    p.ink('a');
    circle(p, R, 1.3, 1);
    circle(p, R - h, 0.8, 0.9);
    p.ink('b');
    glyphRing(p, R - h / 2, h * 0.8, words, { sep: 'dot' });
    drawEmblem(p, K, { kind: r.pick(['sigil', 'sign', 'star', 'letter', 'moonStar'] as const), seed: seedOf(r) }, (R - h) * 0.6);
  }
}

function pickSeal(r: Rng, R: number): SealKind {
  if (R < 0.14) return r.pick(['mini', 'mini', 'ring'] as const);
  if (R > 0.3) return r.pick(['ringed', 'ringed', 'rays', 'broken', 'mini'] as const);
  return r.pick(['mini', 'mini', 'ringed', 'ringed', 'rays', 'broken', 'ring'] as const);
}

function addSeal(K: SKit, r: Rng, id: string, at: Pt, R: number, words: number[], kind = pickSeal(r, R), intensity = 1) {
  const seed = seedOf(r);
  K.add(id, R * (kind === 'rays' ? 1.34 : 1.05), intensity, (p) => drawSeal(p, K, kind, seed, R, words), { at, spin: spinOf(r) });
  K.mark(at, R * (kind === 'rays' ? 1.2 : 1));
}

/** A piece that is a seal or an emblem (for poles, chain links, constellations). */
function addPiece(K: SKit, r: Rng, id: string, at: Pt, s: number, words: number[], sealChance = 0.5, pool: readonly EmblemKind[] = ANY) {
  if (r.chance(sealChance)) addSeal(K, r, id, at, s, words);
  else addEmblem(K, r, id, at, s, pool);
}

// ------------------------------------------------------------------ paths, bands and bundles

/** Points of an (optionally tilted) ellipse arc around (cx, cy). */
function ellArc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 64, rot = 0): Pt[] {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = a0 + ((a1 - a0) * i) / n;
    const x = Math.cos(t) * rx;
    const y = Math.sin(t) * ry;
    return [cx + x * c - y * s, cy + x * s + y * c] as Pt;
  });
}

const endAngle = (pts: Pt[], atStart: boolean) => {
  const a = atStart ? pts[0] : pts[pts.length - 1];
  const b = atStart ? pts[1] : pts[pts.length - 2];
  return Math.atan2(a[1] - b[1], a[0] - b[0]);
};

type BandStyle = 'text' | 'knock' | 'double' | 'ticks' | 'dash';

/** A band of height h along any path: letters between rails, a dark band with cut letters, ... */
function pathBand(p: Pen, pts: Pt[], h: number, style: BandStyle, glyphs: number[]) {
  const { ctx } = p;
  if (style === 'text') {
    p.ink('a');
    strokePath(p, offsetPath(pts, h / 2), 1, 0.95);
    strokePath(p, offsetPath(pts, -h / 2), 1, 0.95);
    p.ink('b');
    glyphPath(p, trimPath(pts, h * 0.6, h * 0.6), h * 0.95, glyphs);
  } else if (style === 'knock') {
    const a = offsetPath(pts, h / 2);
    const b = offsetPath(pts, -h / 2).reverse();
    p.ink('c');
    ctx.globalAlpha = 0.36;
    ctx.beginPath();
    [...a, ...b].forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
    p.erase();
    glyphPath(p, trimPath(pts, h * 0.6, h * 0.6), h * 0.75, glyphs);
    p.ink('a');
    strokePath(p, a, 0.9, 0.95);
    strokePath(p, b, 0.9, 0.95);
  } else if (style === 'double') {
    p.ink('a');
    strokePath(p, offsetPath(pts, h * 0.3), 1.6, 1);
    strokePath(p, offsetPath(pts, -h * 0.3), 0.7, 0.85);
  } else if (style === 'ticks') {
    p.ink('a');
    const base = offsetPath(pts, -h / 2);
    strokePath(p, base, 1.1, 1);
    const len = pathLength(pts);
    const n = Math.max(3, Math.round(len / (h * 0.45)));
    for (let i = 0; i <= n; i++) {
      const q = pathAt(base, (i / n) * len);
      const l = i % 4 === 0 ? h * 1.15 : h * 0.55;
      line(p, q.x, q.y, q.x + Math.sin(q.ang) * l, q.y - Math.cos(q.ang) * l, 0.8, 0.9);
    }
  } else {
    link(p, pts, 'dash', makeRng(1), [], 1.2);
    p.ink('a');
    strokePath(p, offsetPath(pts, h * 0.45), 0.6, 0.7);
  }
}

function markPath(K: SKit, pts: Pt[], w: number) {
  const len = pathLength(pts);
  const n = Math.max(1, Math.round(len / 0.12));
  for (let i = 0; i <= n; i++) {
    const q = pathAt(pts, (i / n) * len);
    K.mark([q.x, q.y], w);
  }
}

function pickBundle(r: Rng): Bundle {
  return {
    main: r.pick(['rail', 'rail', 'rail', 'ladder', 'beads', 'nodes', 'wave'] as const),
    side: r.pick(['lines', 'lines', 'dashes', 'braid', 'bridge', 'bridge'] as const),
    mid: r.pick(['node', 'emblem', 'emblem', 'bars', 'none'] as const),
    e: pickEmblem(r, ANY),
    gap: r.range(0.05, 0.08),
  };
}

/** A rich link: the main line, its companions (rails, dashes, a braid or bridges) and an ornament. */
function bundle(p: Pen, K: Kit, B: Bundle, pts: Pt[], r: Rng, glyphs: number[], scale = 1) {
  const len = pathLength(pts);
  if (len < 0.05) return;
  link(p, pts, B.main, r, glyphs, scale * 1.15);
  const g = B.gap * scale;
  if (B.side === 'lines') {
    p.ink('a');
    strokePath(p, offsetPath(pts, g), 0.7, 0.8);
    strokePath(p, offsetPath(pts, -g), 0.7, 0.8);
  } else if (B.side === 'dashes') {
    link(p, offsetPath(pts, g), 'dash', r, [], scale * 0.8);
    link(p, offsetPath(pts, -g), 'dash', r, [], scale * 0.8);
  } else if (B.side === 'braid') {
    const waves = Math.max(2, Math.round(len / 0.22));
    for (const ph of [0, Math.PI]) {
      const out: Pt[] = [];
      const steps = waves * 16;
      for (let i = 0; i <= steps; i++) {
        const q = pathAt(pts, (i / steps) * len);
        const o = Math.sin((i / steps) * waves * TAU + ph) * g * Math.sin((i / steps) * Math.PI);
        out.push([q.x + Math.sin(q.ang) * o, q.y - Math.cos(q.ang) * o]);
      }
      p.ink(ph ? 'c' : 'a');
      strokePath(p, out, 0.8, 0.9);
    }
  } else if (B.side === 'bridge' && len > 0.3) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    for (const k of [0.16, -0.16]) {
      const br = bend(a, b, k, 30);
      link(p, br, 'dash', r, [], scale * 0.8);
      const m = pathAt(br, pathLength(br) / 2);
      p.ink('c');
      dot(p, m.x, m.y, 0.011 * scale, 1);
    }
  }
  if (B.mid !== 'none' && len > 0.35) {
    const m = pathAt(pts, len / 2);
    p.ctx.save();
    p.ctx.translate(m.x, m.y);
    p.ctx.rotate(m.ang);
    if (B.mid === 'node') {
      p.ink('c');
      node(p, 0, 0, 0.032 * scale, true);
    } else if (B.mid === 'emblem') {
      disc(p, 0.055 * scale);
      p.ink('a');
      circle(p, 0.055 * scale, 1, 1);
      p.ctx.rotate(Math.PI / 2);
      drawEmblem(p, K, B.e, 0.04 * scale);
    } else {
      p.ink('a');
      for (const x of [-len / 6, len / 6]) {
        line(p, x, -g * 1.6, x, g * 1.6, 1.1, 1);
        p.ink('c');
        dot(p, x, -g * 1.6, 0.01, 1);
        dot(p, x, g * 1.6, 0.01, 1);
        p.ink('a');
      }
    }
    p.ctx.restore();
  }
}

function bundleBetween(p: Pen, K: Kit, B: Bundle, a: Pt, ra: number, b: Pt, rb: number, k: number, r: Rng, glyphs: number[], scale = 1) {
  const pts = trimPath(bend(a, b, k), ra + 0.03, rb + 0.03);
  if (pts.length > 1) bundle(p, K, B, pts, r, glyphs, scale);
}

/** Partial arcs and little signs around a piece (makes a lone seal look heavier). */
function halo(p: Pen, K: Kit, c: Pt, R: number, face: number, e: Emblem, words: number[]) {
  p.ctx.save();
  p.ctx.translate(c[0], c[1]);
  arcBand(p, R * 1.2, Math.min(0.06, R * 0.16), face - 1.3, face + 1.3, 'text', words);
  p.ink('a');
  arc(p, R * 1.36, face - 0.8, face + 0.8, 0.8, 0.8);
  p.ink('c');
  for (const s of [-1, 1]) {
    const [x, y] = polar(R * 1.2, face + s * 1.45);
    p.ctx.save();
    p.ctx.translate(x, y);
    drawEmblem(p, K, e, 0.035);
    p.ctx.restore();
    dot(p, ...polar(R * 1.36, face + s * 0.85), 0.01, 1);
  }
  p.ctx.restore();
}

// ------------------------------------------------------------------ the archetypes

/** Big seals far apart (row, triangle, diamond, zigzag, ellipse, cluster...), tied by rich links. */
function separated(r: Rng, K: SKit) {
  const layout = r.pick(['row', 'row', 'triangle', 'diamond', 'pairHub', 'zigzag', 'ellipse', 'cluster'] as const);
  const C: Pt[] = [];
  const S: number[] = [];
  const E: [number, number][] = [];
  const E2: [number, number][] = [];
  let hub = 0;
  const flip = r.sign();
  if (layout === 'row') {
    const n = r.int(3, 4);
    const bow = r.range(-0.4, 0.4);
    const pat = r.pick(['even', 'mid', 'ends', 'alt'] as const);
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1)) * 2 - 1;
      C.push([t * 1.16, bow * t * t - bow / 2]);
      S.push(pat === 'even' ? 0.36 : pat === 'mid' ? (Math.abs(t) < 0.5 ? 0.46 : 0.3) : pat === 'ends' ? (Math.abs(t) > 0.9 ? 0.44 : 0.28) : i % 2 ? 0.28 : 0.42);
      if (i) E.push([i - 1, i]);
    }
  } else if (layout === 'triangle') {
    C.push([-1.1, 0.24 * flip], [1.1, 0.24 * flip], [0, -0.4 * flip]);
    S.push(0.42, 0.42, r.range(0.3, 0.38));
    E.push([0, 2], [2, 1], [0, 1]);
  } else if (layout === 'diamond') {
    C.push([-1.18, 0], [0, -0.56], [1.18, 0], [0, 0.56]);
    S.push(0.4, 0.26, 0.4, 0.26);
    E.push([0, 1], [1, 2], [2, 3], [3, 0]);
    if (r.chance(0.5)) hub = r.range(0.16, 0.22);
  } else if (layout === 'pairHub') {
    C.push([-1.1, 0], [1.1, 0]);
    S.push(0.44, 0.44);
    hub = r.range(0.24, 0.32);
  } else if (layout === 'zigzag') {
    const n = r.int(4, 5);
    for (let i = 0; i < n; i++) {
      C.push([((i / (n - 1)) * 2 - 1) * 1.24, (i % 2 ? 1 : -1) * 0.36 * flip]);
      S.push(r.range(0.27, 0.33));
      if (i) E.push([i - 1, i]);
      if (i > 1) E2.push([i - 2, i]);
    }
  } else if (layout === 'ellipse') {
    const n = r.int(5, 6);
    const ph = r.chance(0.5) ? -Math.PI / 2 : 0;
    for (let i = 0; i < n; i++) {
      const a = ph + (i / n) * TAU;
      C.push([Math.cos(a) * 1.2, Math.sin(a) * 0.6]);
      S.push(r.range(0.23, 0.27));
      E.push([i, (i + 1) % n]);
    }
    hub = r.range(0.2, 0.26);
  } else {
    // one big seal on one side and a fan of smaller ones on the other, all tied to it
    const sx = r.sign();
    C.push([-0.78 * sx, 0]);
    S.push(0.54);
    const k = r.int(3, 4);
    for (let i = 0; i < k; i++) {
      const a = ((i / (k - 1)) - 0.5) * 1.9;
      C.push([-0.78 * sx + sx * Math.cos(a) * 1.95, Math.sin(a) * 0.72]);
      S.push(r.range(0.2, 0.25));
      E.push([0, i + 1]);
      if (i) E2.push([i, i + 1]);
    }
  }
  C.forEach((c, i) => {
    c[0] += r.range(-0.05, 0.05);
    c[1] += r.range(-0.05, 0.05);
    const md = Math.min(...C.filter((_, j) => j !== i).map((q) => dist(q, c)), hub ? dist(c, [0, 0]) - hub : 9);
    S[i] = Math.min(S[i], md * 0.44);
  });
  const bendK = r.chance(0.5) ? 0 : r.range(0.1, 0.22) * r.sign();
  const halos = r.chance(0.5);
  const hE = pickEmblem(r, ANY);
  const seed = seedOf(r);
  K.add('links', 1.75, 1, (p) => {
    const lr = makeRng(seed);
    E.forEach(([i, j], e) => bundleBetween(p, K, K.B, C[i], S[i], C[j], S[j], bendK * (e % 2 ? -1 : 1), lr, K.words[e % 3]));
    E2.forEach(([i, j]) => linkBetween(p, C[i], S[i], C[j], S[j], 'dash', 0.1, lr, [], 0.8));
    if (hub) C.forEach((c, i) => bundleBetween(p, K, { ...K.B, side: 'none', mid: 'none', main: 'rail' }, [0, 0], hub, c, S[i], 0, lr, K.words[i % 3], 0.9));
    if (halos) C.forEach((c, i) => S[i] > 0.26 && halo(p, K, c, S[i], Math.atan2(c[1], c[0]), hE, K.words[(i + 1) % 3]));
  });
  E.forEach(([i, j]) => markPath(K, [C[i], C[j]], 0.08));
  C.forEach((c, i) => addSeal(K, r, `sep${i}`, c, S[i], K.words[i % 3]));
  if (hub) addSeal(K, r, 'hub', [0, 0], hub, K.words[0]);
}

/** One heavy seal off the centre, wrapped in broken eccentric orbits with satellites and a counterweight. */
function orbit(r: Rng, K: SKit) {
  const sx = r.sign();
  const h: Pt = [sx * r.range(0.35, 0.62), r.range(-0.1, 0.1)];
  const R = r.range(0.36, 0.46);
  const tilt = r.range(-0.15, 0.15);
  const n = r.int(5, 8);
  const maxRx = FW + Math.abs(h[0]) * 0.9;
  type Orb = { rx: number; ry: number; a0: number; span: number; style: BandStyle | 'plain'; end: CapKind | 'none' };
  const orbs: Orb[] = Array.from({ length: n }, (_, i) => {
    const rx = R + 0.1 + ((i + r.range(0.2, 0.8)) / n) * (maxRx - R - 0.1);
    return {
      rx,
      ry: Math.min(FH + 0.05, rx * r.range(0.48, 0.66)),
      a0: r.range(0, TAU),
      span: r.range(1.4, 4.2),
      style: r.pick(['plain', 'plain', 'double', 'text', 'text', 'dash', 'ticks'] as const),
      end: r.pick(['none', 'dot', 'node', 'bar', 'arrow', 'crescent'] as const),
    };
  });
  const sats = orbs.map((o, i) => (i > 0 && r.chance(0.55) ? { t: o.a0 + o.span * r.range(0.15, 0.85), s: r.range(0.07, 0.15) } : null));
  K.add('orbits', FW + 0.4, 1, (p) => {
    orbs.forEach((o, i) => {
      const pts = ellArc(h[0], h[1], o.rx, o.ry, o.a0, o.a0 + o.span, 80, tilt);
      if (o.style === 'plain') {
        p.ink('a');
        strokePath(p, pts, 1.1, 0.95);
      } else pathBand(p, pts, 0.05, o.style, K.words[i % 3]);
      if (o.end !== 'none') {
        p.ink('c');
        cap(p, o.end, pts[0][0], pts[0][1], endAngle(pts, true), 0.03);
        const e = pts[pts.length - 1];
        cap(p, o.end, e[0], e[1], endAngle(pts, false), 0.03);
      }
    });
  });
  orbs.forEach((o) => markPath(K, ellArc(h[0], h[1], o.rx, o.ry, o.a0, o.a0 + o.span, 40, tilt), 0.05));
  sats.forEach((s, i) => {
    if (!s) return;
    const [q] = ellArc(h[0], h[1], orbs[i].rx, orbs[i].ry, s.t, s.t, 1, tilt);
    if (Math.abs(q[0]) > FW + 0.05 || Math.abs(q[1]) > FH + 0.05) return;
    addPiece(K, r, `orbSat${i}`, q, s.s, K.words[i % 3], 0.6);
  });
  addSeal(K, r, 'orbHeart', h, R, K.words[0], r.pick(['ringed', 'rays', 'broken'] as const));
  // the counterweight on the other side: a smaller seal with its own little orbits, tied to the heart
  const w: Pt = [-sx * r.range(1.02, 1.22), r.range(-0.35, 0.35)];
  const ws = r.range(0.2, 0.28);
  const seed = seedOf(r);
  K.add('orbTie', 1.75, 0.95, (p) => {
    const lr = makeRng(seed);
    bundleBetween(p, K, K.B, h, R * 1.02, w, ws, 0.12, lr, K.words[2]);
    p.ctx.save();
    p.ctx.translate(w[0], w[1]);
    arcBand(p, ws * 1.35, 0.04, sx > 0 ? 0.6 : Math.PI + 0.6, sx > 0 ? 3.9 : Math.PI + 3.9, 'text', K.words[1]);
    p.ink('a');
    arc(p, ws * 1.6, 0, 2.2, 0.8, 0.8);
    p.ctx.restore();
  });
  markPath(K, [h, w], 0.08);
  addSeal(K, r, 'orbWeight', w, ws, K.words[1]);
}

/** Circles strung along a line, an arc, a wave or a V across the whole field, partly overlapping. */
function chain(r: Rng, K: SKit) {
  const shape = r.pick(['line', 'arc', 'arc', 'wave', 'vee', 'diagonal'] as const);
  const amp = r.range(0.28, 0.5) * r.sign();
  const tiltY = r.range(-0.25, 0.25);
  const waves = r.pick([1, 1.5]);
  const f = (u: number): Pt => {
    const x = u * 1.5;
    if (shape === 'line') return [x, tiltY * u];
    if (shape === 'arc') return [x, amp * u * u - amp / 2];
    if (shape === 'wave') return [x, amp * 0.9 * Math.sin(u * Math.PI * waves)];
    if (shape === 'vee') return [x, amp * Math.abs(u) - amp / 2];
    return [x * 0.85, u * 0.62 * Math.sign(amp)];
  };
  const path: Pt[] = Array.from({ length: 201 }, (_, i) => f((i / 200) * 2 - 1));
  const L = pathLength(path);
  const n = r.int(4, 7);
  const pattern = r.pick(['grow', 'mid', 'even', 'random', 'alt'] as const);
  let sizes = Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    if (pattern === 'grow') return 0.2 + t * 0.22;
    if (pattern === 'mid') return 0.2 + Math.sin(t * Math.PI) * 0.24;
    if (pattern === 'even') return 0.3;
    if (pattern === 'alt') return i % 2 ? 0.22 : 0.36;
    return r.range(0.2, 0.42);
  });
  const overlap = r.range(0.66, 0.95);
  const span = (sz: number[]) => sz.slice(1).reduce((a, s, i) => a + (s + sz[i]) * overlap, 0) + sz[0] + sz[n - 1];
  const k = clampF((L * 0.9) / span(sizes), 0.5, 1.6);
  sizes = sizes.map((s) => Math.min(0.48, s * k));
  const along: number[] = [];
  let s0 = (L - span(sizes)) / 2 + sizes[0];
  for (let i = 0; i < n; i++) {
    if (i) s0 += (sizes[i] + sizes[i - 1]) * overlap;
    along.push(s0);
  }
  const centres = along.map((s) => {
    const q = pathAt(path, s);
    return [q.x, q.y] as Pt;
  });
  const maxS = Math.max(...sizes);
  const look = r.pick(['seals', 'seals', 'rings', 'mixed'] as const);
  const track = r.pick(['text', 'dash', 'both'] as const);
  const tailCap: CapKind = r.pick(CAPS);
  const junction = r.chance(0.55);
  const jE = pickEmblem(r, ANY);
  K.add('chainTrack', 1.75, 0.95, (p) => {
    // tracks running along the chain above and below it, and tails beyond its ends
    const first = along[0] - sizes[0];
    const last = along[n - 1] + sizes[n - 1];
    const body = trimPath(path, Math.max(0, first - 0.1), Math.max(0, L - last - 0.1));
    const up = offsetPath(body, maxS + 0.08);
    const dn = offsetPath(body, -(maxS + 0.08));
    if (track !== 'dash') pathBand(p, up, 0.05, 'text', K.words[0]);
    else link(p, up, 'dash', makeRng(2), [], 1);
    link(p, dn, track === 'text' ? 'nodes' : 'dash', makeRng(3), [], 1);
    for (const [a, b] of [[0, first - 0.02], [last + 0.02, L]] as const) {
      if (b - a < 0.05) continue;
      const tail = trimPath(path, a, L - b);
      pathBand(p, tail, 0.045, 'text', K.words[2]);
      p.ink('c');
      const atStart = a === 0;
      const e = atStart ? tail[0] : tail[tail.length - 1];
      cap(p, tailCap, e[0], e[1], endAngle(tail, atStart), 0.04);
    }
    if (junction) {
      for (let i = 0; i < n - 1; i++) {
        const m = pathAt(path, (along[i] + sizes[i] + along[i + 1] - sizes[i + 1]) / 2);
        for (const sg of [-1, 1]) {
          const off = Math.min(sizes[i], sizes[i + 1]) + 0.04;
          p.ctx.save();
          p.ctx.translate(m.x + Math.sin(m.ang) * off * sg, m.y - Math.cos(m.ang) * off * sg);
          disc(p, 0.035);
          drawEmblem(p, K, jE, 0.03);
          p.ctx.restore();
        }
      }
    }
  });
  markPath(K, offsetPath(path, maxS + 0.08), 0.05);
  markPath(K, offsetPath(path, -(maxS + 0.08)), 0.05);
  markPath(K, path, 0.06);
  centres.forEach((c, i) => {
    const kind: SealKind = look === 'rings' ? 'ring' : look === 'seals' ? pickSeal(r, sizes[i]) : i % 2 ? 'ring' : pickSeal(r, sizes[i]);
    addSeal(K, r, `chain${i}`, c, sizes[i], K.words[i % 3], kind);
  });
}

/** No full rim: pieces of a wide ellipse and of inner rings around an empty middle. */
function broken(r: Rng, K: SKit) {
  const rx = r.range(1.32, 1.5);
  const ry = r.range(0.74, 0.86);
  const m = r.int(4, 7);
  const ph = r.range(0, TAU);
  const cuts = Array.from({ length: m + 1 }, (_, i) => ph + ((i + (i > 0 && i < m ? r.range(-0.25, 0.25) : 0)) / m) * TAU);
  const gap = r.range(0.14, 0.3);
  const h = r.range(0.065, 0.095);
  const style = r.pick(['text', 'text', 'knock', 'double', 'ticks'] as const);
  const alt = r.chance(0.5) ? r.pick(['double', 'ticks', 'dash', 'text'] as const) : style;
  const end: CapKind = r.pick(['bar', 'node', 'arrow', 'crescent', 'dot', 'diamond'] as const);
  const spokes = r.chance(0.4);
  const spokeCap: CapKind = r.pick(CAPS);
  const gapPieces = r.chance(0.6);
  const segs = cuts.slice(0, m).map((c, i) => {
    const g = Math.max(0.1, ((cuts[i + 1] - c) * gap) / 2);
    return [c + g, cuts[i + 1] - g] as [number, number];
  });
  K.add('brokenOuter', FW + 0.2, 1, (p) => {
    segs.forEach(([a0, a1], i) => {
      const pts = ellArc(0, 0, rx, ry, a0, a1, 80);
      pathBand(p, pts, h, i % 2 ? alt : style, K.words[i % 3]);
      p.ink('c');
      cap(p, end, pts[0][0], pts[0][1], endAngle(pts, true), h * 0.5);
      const e = pts[pts.length - 1];
      cap(p, end, e[0], e[1], endAngle(pts, false), h * 0.5);
      if (spokes) {
        const t = cuts[i + 1];
        p.ink('a');
        const [x1, y1] = [Math.cos(t) * 0.5, Math.sin(t) * 0.42];
        const [x2, y2] = [Math.cos(t) * (rx + 0.14), Math.sin(t) * (ry + 0.1)];
        line(p, x1, y1, x2, y2, 1, 0.9);
        p.ink('c');
        cap(p, spokeCap, x2, y2, Math.atan2(y2 - y1, x2 - x1), 0.032);
        dot(p, x1, y1, 0.012, 1);
      }
    });
  });
  segs.forEach(([a0, a1]) => markPath(K, ellArc(0, 0, rx, ry, a0, a1, 30), h));
  if (gapPieces) {
    const gs = r.range(0.1, 0.16);
    const e = pickEmblem(r, ANY);
    const seal = r.chance(0.5);
    cuts.slice(1).forEach((t, i) => {
      if (spokes) return;
      const at: Pt = [Math.cos(t) * rx, Math.sin(t) * ry];
      if (seal) addSeal(K, r, `gap${i}`, at, gs, K.words[i % 3], 'mini');
      else addEmblem(K, r, `gap${i}`, at, gs * 0.8, ANY, 1, { kind: e.kind, seed: e.seed + i });
    });
  }
  // a middle ellipse in pieces and an inner ring in pieces (this one turns)
  if (r.chance(0.6)) {
    const k = r.int(3, 6);
    const ph2 = r.range(0, TAU);
    const st: BandStyle = r.pick(['dash', 'ticks', 'double'] as const);
    K.add('brokenMid', rx * 0.75, 0.9, (p) => {
      for (let i = 0; i < k; i++) pathBand(p, ellArc(0, 0, rx * 0.72, ry * 0.72, ph2 + (i / k) * TAU + 0.18, ph2 + ((i + 1) / k) * TAU - 0.18, 50), 0.04, st, []);
    });
    for (let i = 0; i < k; i++) markPath(K, ellArc(0, 0, rx * 0.72, ry * 0.72, ph2 + (i / k) * TAU + 0.18, ph2 + ((i + 1) / k) * TAU - 0.18, 20), 0.04);
  }
  const R2 = r.range(0.44, 0.56);
  const m2 = r.int(2, 5);
  const ph3 = r.range(0, TAU);
  const st2 = r.pick(['double', 'text', 'ticks', 'knock'] as const);
  K.add('brokenInner', R2 + 0.08, 0.95, (p) => {
    for (let i = 0; i < m2; i++) arcBand(p, R2, 0.055, ph3 + (i / m2) * TAU + 0.16, ph3 + ((i + 1) / m2) * TAU - 0.16, st2 === 'knock' ? 'knock' : st2, K.words[(i + 1) % 3]);
  }, { spin: r.range(0.03, 0.08) * K.dir });
  K.mark([0, 0], R2 + 0.05);
  if (r.chance(0.45)) nested(r, K, R2 * 0.75);
  else addPiece(K, r, 'brokenCore', [0, 0], r.range(0.16, 0.24), K.words[0], 0.6);
}

/** A big sign on the left and on the right, bound together (with a crown and a root between them). */
function poles(r: Rng, K: SKit) {
  const D = r.range(1.0, 1.16);
  const dy = r.range(-0.1, 0.1);
  const A: Pt = [-D, dy];
  const B: Pt = [D, -dy];
  const pair = r.pick(['seal+seal', 'seal+sign', 'sign+seal', 'sun+moon', 'seal+seal'] as const);
  const big = r.range(0.4, 0.5);
  const sa = pair.startsWith('seal') ? big : 0.32;
  const sb = pair.endsWith('seal') ? (r.chance(0.5) ? big : r.range(0.34, 0.46)) : 0.32;
  const mid = r.chance(0.75) ? r.range(0.14, 0.22) : 0;
  const overArcs = r.chance(0.6);
  const crown = r.pick(['crown', 'root', 'both', 'none'] as const);
  const cy = -0.62;
  const ry = 0.62;
  const seed = seedOf(r);
  const hE = pickEmblem(r, ANY);
  const halos = r.chance(0.65);
  K.add('poleLink', 1.75, 1, (p) => {
    const lr = makeRng(seed);
    if (mid) {
      bundleBetween(p, K, K.B, A, sa, [0, 0], mid, 0, lr, K.words[0]);
      bundleBetween(p, K, K.B, [0, 0], mid, B, sb, 0, lr, K.words[2]);
    } else bundleBetween(p, K, K.B, A, sa, B, sb, 0, lr, K.words[1]);
    if (overArcs) {
      const up = trimPath(bend(A, B, 0.28, 50), sa + 0.1, sb + 0.1);
      const dn = trimPath(bend(A, B, -0.28, 50), sa + 0.1, sb + 0.1);
      pathBand(p, up, 0.05, 'text', K.words[0]);
      pathBand(p, dn, 0.045, r.chance(0.5) ? 'text' : 'dash', K.words[2]);
    }
    for (const [on, y] of [[crown === 'crown' || crown === 'both', cy], [crown === 'root' || crown === 'both', ry]] as const) {
      if (!on) continue;
      linkBetween(p, A, sa, [0, y], 0.12, 'line', 0, lr, [], 1);
      linkBetween(p, B, sb, [0, y], 0.12, 'line', 0, lr, [], 1);
      linkBetween(p, A, sa, [0, y], 0.12, 'dash', 0.12, lr, [], 0.8);
      linkBetween(p, B, sb, [0, y], 0.12, 'dash', -0.12, lr, [], 0.8);
    }
    if (halos) {
      halo(p, K, A, sa, Math.PI, hE, K.words[1]);
      halo(p, K, B, sb, 0, hE, K.words[2]);
    }
  });
  markPath(K, [A, B], 0.1);
  if (overArcs) {
    markPath(K, bend(A, B, 0.28, 30), 0.05);
    markPath(K, bend(A, B, -0.28, 30), 0.05);
  }
  if (pair === 'sun+moon') {
    addEmblem(K, r, 'poleA', A, sa, ROUND, 1, { kind: 'sun', seed: seedOf(r) });
    addEmblem(K, r, 'poleB', B, sb, UPRIGHT, 1, { kind: 'moonStar', seed: seedOf(r) });
    K.mark(A, sa * 1.4);
    K.mark(B, sb * 1.4);
  } else {
    const [a, b] = pair.split('+');
    if (a === 'seal') addSeal(K, r, 'poleA', A, sa, K.words[0]);
    else addEmblem(K, r, 'poleA', A, sa, UPRIGHT);
    if (b === 'seal') addSeal(K, r, 'poleB', B, sb, K.words[2]);
    else addEmblem(K, r, 'poleB', B, sb, UPRIGHT);
  }
  if (mid) addSeal(K, r, 'poleMid', [0, 0], mid, K.words[1]);
  if (crown === 'crown' || crown === 'both') addEmblem(K, r, 'poleCrown', [0, cy], 0.12, UPRIGHT);
  if (crown === 'root' || crown === 'both') addEmblem(K, r, 'poleRoot', [0, ry], 0.12, ANY);
}

type StationKind = 'diamond' | 'crossbar' | 'branches' | 'ring' | 'cup' | 'wings' | 'eye' | 'nodes' | 'hourglass';

/** Draws a totem shaft with its stations (used for the main totem and for the side ones). */
function drawTotem(p: Pen, K: Kit, x0: number, y0: number, y1: number, shaft: string, stations: { kind: StationKind; y: number; w: number; seed: number }[], barCap: CapKind, words: number[]) {
  const { ctx } = p;
  ctx.save();
  ctx.translate(x0, 0);
  const pts: Pt[] = [[0, y0], [0, y1]];
  if (shaft === 'single') {
    p.ink('a');
    line(p, 0, y0, 0, y1, 1.6, 1);
  } else if (shaft === 'double') {
    p.ink('a');
    line(p, -0.02, y0, -0.02, y1, 1, 1);
    line(p, 0.02, y0, 0.02, y1, 1, 1);
  } else if (shaft === 'text') textRail(p, pts, 0.05, words);
  else link(p, pts, 'ladder', makeRng(1), words, 1.3);
  for (const s of stations) {
    const { y, w } = s;
    switch (s.kind) {
      case 'diamond':
        ctx.save();
        p.erase();
        ctx.beginPath();
        ctx.moveTo(0, y - w * 0.8);
        ctx.lineTo(w * 0.5, y);
        ctx.lineTo(0, y + w * 0.8);
        ctx.lineTo(-w * 0.5, y);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        p.ink('a');
        strokePoly(p, [[0, y - w * 0.8], [w * 0.5, y], [0, y + w * 0.8], [-w * 0.5, y]], 1.3, 1);
        strokePoly(p, [[0, y - w * 0.6], [w * 0.36, y], [0, y + w * 0.6], [-w * 0.36, y]], 0.6, 0.8);
        line(p, -w, y, -w * 0.5, y, 1, 0.9);
        line(p, w * 0.5, y, w, y, 1, 0.9);
        p.ink('c');
        cap(p, barCap, -w, y, Math.PI, 0.028);
        cap(p, barCap, w, y, 0, 0.028);
        ctx.save();
        ctx.translate(0, y);
        drawEmblem(p, K, { kind: 'letter', seed: s.seed }, w * 0.22);
        ctx.restore();
        break;
      case 'crossbar':
        p.ink('a');
        line(p, -w, y, w, y, 1.4, 1);
        line(p, -w * 0.6, y + 0.05, w * 0.6, y + 0.05, 0.8, 0.9);
        p.ink('c');
        cap(p, barCap, -w, y, Math.PI, 0.032);
        cap(p, barCap, w, y, 0, 0.032);
        break;
      case 'branches':
        for (const sx of [-1, 1]) {
          for (const k of [1, 0.62]) {
            p.ink('a');
            strokePath(p, quadPts([0, y + w * 0.3 * k], [sx * w * 0.9 * k, y + w * 0.25 * k], [sx * w * k, y - w * 0.6 * k], 20), 1.1, 1);
            p.ink('c');
            cap(p, barCap, sx * w * k, y - w * 0.6 * k, -Math.PI / 2, 0.026);
          }
        }
        break;
      case 'cup':
        p.ink('c');
        crescent(p, 0, y, w * 0.5, -Math.PI / 2, 0.45, false, 1.3, 1);
        crescent(p, 0, y, w * 0.5, -Math.PI / 2, 0.45, true, 1, 0.35);
        break;
      case 'wings':
        p.ink('a');
        for (const sx of [-1, 1]) {
          for (let k = 0; k < 4; k++) {
            const l = w * (1.1 - k * 0.2);
            strokePath(p, quadPts([sx * 0.02, y + k * 0.03], [sx * l * 0.6, y - l * 0.35 + k * 0.03], [sx * l, y + l * 0.1 + k * 0.05], 16), 1.1 - k * 0.2, 1 - k * 0.12);
          }
        }
        break;
      case 'eye':
        ctx.save();
        ctx.translate(0, y);
        drawEmblem(p, K, { kind: 'eye', seed: s.seed }, w * 0.6);
        ctx.restore();
        break;
      case 'nodes':
        p.ink('a');
        line(p, -w, y, w, y, 0.9, 0.9);
        p.ink('c');
        for (const x of [-w, -w / 2, 0, w / 2, w]) node(p, x, y, 0.022, x === 0);
        break;
      case 'hourglass':
        ctx.save();
        ctx.translate(0, y);
        drawEmblem(p, K, { kind: 'hourglass', seed: s.seed }, w * 0.45);
        ctx.restore();
        break;
      case 'ring':
        break; // its own spinning layer
    }
  }
  ctx.restore();
}

function makeStations(r: Rng, y0: number, y1: number, count: number, wMax: number) {
  return Array.from({ length: count }, (_, i) => ({
    kind: r.pick(['diamond', 'crossbar', 'crossbar', 'branches', 'branches', 'ring', 'ring', 'cup', 'wings', 'eye', 'nodes', 'hourglass'] as const) as StationKind,
    y: y0 + ((i + 0.5 + r.range(-0.15, 0.15)) / count) * (y1 - y0),
    w: r.range(0.45, 1) * wMax,
    seed: seedOf(r),
  }));
}

/** A central totem (sign on top, stations down the shaft, sign or roots at the bottom) with flanks. */
function totem(r: Rng, K: SKit) {
  const top = -0.86;
  const bottom = 0.86;
  const topS = r.range(0.16, 0.22);
  const botS = r.range(0.12, 0.18);
  const y0 = top + topS + 0.03;
  const y1 = bottom - botS - 0.03;
  const shaft = r.pick(['single', 'double', 'text', 'text', 'ladder'] as const);
  const stations = makeStations(r, y0, y1, r.int(3, 5), 0.45);
  const barCap: CapKind = r.pick(CAPS);
  const flank = r.pick(['twins', 'beam', 'brackets', 'twins', 'beam'] as const);
  const sideX = r.range(1.0, 1.25);
  const sideStations = makeStations(r, -0.42, 0.42, r.int(2, 3), 0.28);
  const sideShaft = r.pick(['single', 'double', 'text'] as const);
  const beamY = r.range(-0.45, -0.2);
  const pendants = r.int(2, 3);
  const pendE = pickEmblem(r, ANY);
  const seed = seedOf(r);
  K.add('totem', 1.75, 1, (p) => {
    const lr = makeRng(seed);
    drawTotem(p, K, 0, y0, y1, shaft, stations, barCap, K.words[0]);
    if (flank === 'twins') {
      for (const sx of [-1, 1]) drawTotem(p, K, sx * sideX, -0.42, 0.42, sideShaft, sideStations, barCap, K.words[sx > 0 ? 2 : 1]);
      // tied to the middle by beams
      bundle(p, K, K.B, [[-sideX + 0.06, beamY * 0.6], [-0.08, beamY * 0.6]], lr, K.words[1], 0.9);
      bundle(p, K, K.B, [[0.08, beamY * 0.6], [sideX - 0.06, beamY * 0.6]], lr, K.words[2], 0.9);
    } else if (flank === 'beam') {
      // a long beam across with pendants hanging from it, like scales
      pathBand(p, [[-FW + 0.08, beamY], [-0.06, beamY]], 0.055, 'text', K.words[1]);
      pathBand(p, [[0.06, beamY], [FW - 0.08, beamY]], 0.055, 'text', K.words[2]);
      p.ink('c');
      cap(p, barCap, -FW + 0.08, beamY, Math.PI, 0.04);
      cap(p, barCap, FW - 0.08, beamY, 0, 0.04);
      for (const sx of [-1, 1]) {
        for (let i = 0; i < pendants; i++) {
          const x = sx * (0.5 + ((i + 0.5) / pendants) * 0.95);
          const yEnd = beamY + 0.35 + ((i + 1) % 2) * 0.25;
          link(p, [[x, beamY + 0.03], [x, yEnd - 0.1]], i % 2 ? 'beads' : 'dash', lr, K.words[i % 3], 0.9);
          p.ctx.save();
          p.ctx.translate(x, yEnd);
          disc(p, 0.1);
          p.ink('a');
          circle(p, 0.1, 1.2, 1);
          drawEmblem(p, K, { kind: pendE.kind, seed: pendE.seed + i }, 0.07);
          p.ctx.restore();
        }
      }
    } else {
      for (const sx of [-1, 1]) {
        const pts = quadPts([sx * 0.55, -0.78], [sx * 1.25, 0], [sx * 0.55, 0.78], 50);
        pathBand(p, sx > 0 ? pts : pts.slice().reverse(), 0.055, 'text', K.words[sx > 0 ? 2 : 1]);
        p.ink('c');
        node(p, sx * 0.55, -0.78, 0.022, true);
        node(p, sx * 0.55, 0.78, 0.022, true);
        const pts2 = quadPts([sx * 0.62, -0.6], [sx * 1.12, 0], [sx * 0.62, 0.6], 40);
        link(p, pts2, 'dash', lr, [], 1);
      }
    }
  });
  markPath(K, [[0, y0], [0, y1]], 0.28);
  if (flank === 'twins') {
    for (const sx of [-1, 1]) {
      markPath(K, [[sx * sideX, -0.5], [sx * sideX, 0.5]], 0.2);
      addEmblem(K, r, `twinTop${sx}`, [sx * sideX, -0.58], 0.12, UPRIGHT);
      addEmblem(K, r, `twinBase${sx}`, [sx * sideX, 0.58], 0.1, ANY);
      sideStations.forEach((s, i) => s.kind === 'ring' && addSeal(K, r, `twinRing${sx}${i}`, [sx * sideX, s.y], s.w * 0.5, K.words[i % 3]));
    }
    markPath(K, [[-sideX, beamY * 0.6], [sideX, beamY * 0.6]], 0.06);
  } else if (flank === 'beam') {
    markPath(K, [[-FW, beamY], [FW, beamY]], 0.06);
    for (const sx of [-1, 1]) for (let i = 0; i < pendants; i++) {
      const x = sx * (0.5 + ((i + 0.5) / pendants) * 0.95);
      const yEnd = beamY + 0.35 + ((i + 1) % 2) * 0.25;
      markPath(K, [[x, beamY], [x, yEnd]], 0.12);
    }
  } else {
    for (const sx of [-1, 1]) markPath(K, quadPts([sx * 0.55, -0.78], [sx * 1.25, 0], [sx * 0.55, 0.78], 20), 0.08);
  }
  addEmblem(K, r, 'totemTop', [0, top + topS * 0.2], topS, UPRIGHT);
  addEmblem(K, r, 'totemBase', [0, bottom - botS * 0.2], botS, UPRIGHT);
  stations.forEach((s, i) => s.kind === 'ring' && addSeal(K, r, `totemRing${i}`, [0, s.y], s.w * 0.5, K.words[i % 3]));
}

/** A central seal and 4-8 long directions reaching to the edges of the field, with no ring. */
function cross(r: Rng, K: SKit) {
  const n = r.pick([4, 4, 6, 6, 8, 8]);
  const ph = n === 6 ? 0 : r.chance(0.7) ? 0 : Math.PI / n;
  const coreR = r.range(0.2, 0.3);
  const reach = (a: number) => 1 / Math.sqrt((Math.cos(a) / (FW - 0.08)) ** 2 + (Math.sin(a) / (FH - 0.04)) ** 2);
  const rays = Array.from({ length: n }, (_, i) => {
    const a = ph + (i / n) * TAU;
    return { a, len: reach(a) * (i % 2 && n > 4 ? r.range(0.72, 0.85) : 0.98) };
  });
  const endKind = r.pick(['seal', 'seal', 'emblem', 'cap'] as const);
  const endCap: CapKind = r.pick(CAPS);
  const endS = (a: number) => clampF(0.1 + Math.abs(Math.cos(a)) * 0.1, 0.1, 0.2);
  const arcs = r.chance(0.6);
  const minor = r.chance(0.5);
  const bars = r.chance(0.6);
  const seed = seedOf(r);
  K.add('crossRays', FW + 0.1, 1, (p) => {
    const lr = makeRng(seed);
    rays.forEach((q, i) => {
      const stop = endKind === 'cap' ? 0.03 : endS(q.a) + 0.03;
      const pts: Pt[] = [polar(coreR + 0.05, q.a), polar(q.len - stop, q.a)];
      bundle(p, K, { ...K.B, mid: bars ? 'bars' : K.B.mid }, pts, lr, K.words[i % 3]);
      if (endKind === 'cap') {
        p.ink('c');
        cap(p, endCap, ...polar(q.len, q.a), q.a, 0.05);
      }
    });
    if (arcs) {
      // pieces of ellipses between the rays, carrying words
      rays.forEach((q, i) => {
        const nx = rays[(i + 1) % n].a + (i === n - 1 ? TAU : 0);
        pathBand(p, ellArc(0, 0, 0.62, 0.48, q.a + 0.14, nx - 0.14, 30), 0.045, i % 2 ? 'double' : 'text', K.words[i % 3]);
      });
    }
    if (minor) {
      rays.forEach((q, i) => {
        const nx = rays[(i + 1) % n].a + (i === n - 1 ? TAU : 0);
        const a = (q.a + nx) / 2;
        const L = reach(a) * 0.55;
        p.ink('a');
        line(p, ...polar(coreR + 0.08, a), ...polar(L, a), 0.8, 0.8);
        p.ink('c');
        cap(p, 'dot', ...polar(L, a), a, 0.03);
      });
    }
  });
  rays.forEach((q) => markPath(K, [[0, 0], polar(q.len, q.a)], 0.1));
  if (arcs) K.mark([0, 0], 0.66);
  addSeal(K, r, 'crossCore', [0, 0], coreR, K.words[0], r.pick(['ringed', 'rays', 'broken'] as const));
  if (endKind !== 'cap') {
    const e = pickEmblem(r, ANY);
    rays.forEach((q, i) => {
      const s = endS(q.a);
      const at = polar(q.len - s, q.a);
      if (endKind === 'seal') addSeal(K, r, `crossEnd${i}`, at, s, K.words[i % 3]);
      else addEmblem(K, r, `crossEnd${i}`, at, s, ANY, 1, { kind: e.kind, seed: e.seed + i });
    });
  }
}

/** One big trunk across the field with branches, twigs, fruits and hugging arcs: no symmetry. */
function trunk(r: Rng, K: SKit) {
  const sx = r.sign();
  const P0: Pt = [-1.5 * sx, r.range(-0.45, 0.45)];
  const P3: Pt = [1.42 * sx, r.range(-0.5, 0.5)];
  const c1: Pt = [-0.5 * sx, r.range(-0.9, 0.9)];
  const c2: Pt = [0.5 * sx, r.range(-0.9, 0.9)];
  const trunkPts: Pt[] = Array.from({ length: 90 }, (_, i) => {
    const t = i / 89;
    const u = 1 - t;
    return [
      u * u * u * P0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * P3[0],
      clampF(u * u * u * P0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * P3[1], -0.7, 0.7),
    ] as Pt;
  });
  const tlen = pathLength(trunkPts);
  const crownS = r.range(0.2, 0.28);
  const style = r.pick(['text', 'text', 'ladder', 'double', 'knock'] as const);
  const side = r.sign();
  type Branch = { pts: Pt[]; end: CapKind | 'fruit' | 'node'; sub: Pt[][]; w: number; text: boolean };
  const branches: Branch[] = [];
  const nb = r.int(9, 13);
  for (let i = 0; i < nb; i++) {
    const t = 0.08 + ((i + r.range(0, 0.8)) / nb) * 0.82;
    const at = pathAt(trunkPts, t * tlen);
    const sg = r.chance(0.62) ? side : -side;
    const ang = at.ang + sg * r.range(0.5, 1.25);
    let len = r.range(0.28, 0.58);
    const start: Pt = [at.x, at.y];
    let end = add2(start, polar(len, ang));
    // keep inside the field
    const over = Math.max(Math.abs(end[0]) / (FW - 0.05), Math.abs(end[1]) / (FH - 0.05));
    if (over > 1) {
      len /= over;
      end = add2(start, polar(len, ang));
    }
    const pts = bend(start, end, r.range(-0.22, 0.22), 24);
    const sub: Pt[][] = [];
    const subs = r.chance(0.7) ? r.int(1, 2) : 0;
    for (let k = 0; k < subs; k++) {
      const m = pathAt(pts, len * r.range(0.35, 0.7));
      const sa = m.ang + (k % 2 ? -1 : 1) * sg * r.range(0.5, 1);
      sub.push(bend([m.x, m.y], add2([m.x, m.y], polar(len * r.range(0.25, 0.45), sa)), r.range(-0.25, 0.25), 12));
    }
    branches.push({ pts, end: r.chance(0.3) ? 'fruit' : r.chance(0.3) ? 'node' : r.pick(CAPS), sub, w: 1 - t * 0.3, text: false });
  }
  [...branches].sort((a, b) => pathLength(b.pts) - pathLength(a.pts)).slice(0, r.int(1, 3)).forEach((b) => (b.text = true));
  const hugs = Array.from({ length: r.int(2, 4) }, () => {
    const at = pathAt(trunkPts, r.range(0.15, 0.85) * tlen);
    return { c: [at.x, at.y] as Pt, rad: r.range(0.18, 0.36), a: at.ang + (r.sign() * Math.PI) / 2, span: r.range(1.2, 2.4), text: r.chance(0.5) };
  });
  const shadow = r.range(0.1, 0.16) * -side;
  const body = trimPath(trunkPts, 0.02, crownS + 0.03);
  const roots = r.int(3, 5);
  K.add('trunk', FW + 0.2, 1, (p) => {
    const lr = makeRng(7);
    if (style === 'ladder') link(p, body, 'ladder', lr, K.words[0], 1.5);
    else pathBand(p, body, 0.07, style, K.words[0]);
    link(p, offsetPath(trimPath(body, 0.2, 0.2), shadow), 'dash', lr, [], 1);
    // roots at the start
    const b0 = body[0];
    const ra = endAngle(body, true);
    for (let i = 0; i < roots; i++) {
      const a = ra + (i / (roots - 1) - 0.5) * 1.6;
      const e = add2(b0, polar(0.16 + (i % 2) * 0.08, a));
      p.ink('a');
      strokePath(p, bend(b0, e, 0.15, 10), 1, 1);
      p.ink('c');
      dot(p, e[0], e[1], 0.012, 1);
    }
    for (const b of branches) {
      if (b.text) pathBand(p, trimPath(b.pts, 0.03, 0.02), 0.045, 'text', K.words[1]);
      else {
        p.ink('a');
        strokePath(p, b.pts, 1.3 * b.w, 1);
      }
      p.ink('c');
      const e = b.pts[b.pts.length - 1];
      if (b.end === 'node') node(p, e[0], e[1], 0.026, true);
      else if (b.end !== 'fruit') cap(p, b.end, e[0], e[1], endAngle(b.pts, false), 0.036);
      for (const sb of b.sub) {
        p.ink('a');
        strokePath(p, sb, 0.9, 0.9);
        p.ink('c');
        const se = sb[sb.length - 1];
        dot(p, se[0], se[1], 0.013, 1);
      }
      p.ink('c');
      node(p, b.pts[0][0], b.pts[0][1], 0.02);
    }
    for (const h of hugs) {
      p.ctx.save();
      p.ctx.translate(h.c[0], h.c[1]);
      arcBand(p, h.rad, 0.045, h.a - h.span / 2, h.a + h.span / 2, h.text ? 'text' : 'double', K.words[2]);
      p.ink('c');
      dot(p, ...polar(h.rad, h.a + h.span / 2 + 0.06), 0.014, 1);
      p.ctx.restore();
    }
  });
  markPath(K, trunkPts, 0.1);
  branches.forEach((b) => {
    markPath(K, b.pts, 0.06);
    b.sub.forEach((q) => markPath(K, q, 0.04));
  });
  hugs.forEach((h) => K.mark(h.c, h.rad));
  addPiece(K, r, 'trunkCrown', P3, crownS, K.words[0], 0.6, ROUND);
  branches.forEach((b, i) => {
    if (b.end !== 'fruit') return;
    addSeal(K, r, `fruit${i}`, b.pts[b.pts.length - 1], r.range(0.08, 0.14), K.words[i % 3], r.pick(['mini', 'ring', 'mini'] as const));
  });
}

/** Broken lines, brackets and corners around an empty place: a wide frame filling the field. */
function frame(r: Rng, K: SKit) {
  const shape = r.pick(['rect', 'rect', 'octagon', 'hexWide', 'diamondWide'] as const);
  const fx = r.range(1.36, 1.5);
  const fy = r.range(0.72, 0.82);
  const ch = r.range(0.18, 0.3);
  const V: Pt[] =
    shape === 'rect' ? [[-fx, -fy], [fx, -fy], [fx, fy], [-fx, fy]]
    : shape === 'octagon' ? [[-fx + ch, -fy], [fx - ch, -fy], [fx, -fy + ch], [fx, fy - ch], [fx - ch, fy], [-fx + ch, fy], [-fx, fy - ch], [-fx, -fy + ch]]
    : shape === 'hexWide' ? [[-fx * 0.62, -fy], [fx * 0.62, -fy], [fx, 0], [fx * 0.62, fy], [-fx * 0.62, fy], [-fx, 0]]
    : [[0, -fy - 0.04], [fx, 0], [0, fy + 0.04], [-fx, 0]];
  const n = V.length;
  const mode = r.pick(['brackets', 'gapped', 'mixed'] as const);
  const f = r.range(0.2, 0.36);
  const gapF = r.range(0.14, 0.3);
  const off = r.range(0.05, 0.075);
  const corner = r.pick(['seal', 'emblem', 'node', 'diamond'] as const);
  const cE = pickEmblem(r, ANY);
  const midE = pickEmblem(r, ANY);
  K.add('frameOuter', FW + 0.15, 1, (p) => {
    for (let i = 0; i < n; i++) {
      const a = V[i];
      const b = V[(i + 1) % n];
      const L = dist(a, b);
      const at = (t: number): Pt => [a[0] + ((b[0] - a[0]) * t), a[1] + ((b[1] - a[1]) * t)];
      const edgeMode = mode === 'mixed' ? (i % 2 ? 'brackets' : 'gapped') : mode;
      const segs: [number, number][] = edgeMode === 'brackets' ? [[0, f], [1 - f, 1]] : [[0, 0.5 - gapF / 2], [0.5 + gapF / 2, 1]];
      // inward normal
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      const ml = Math.hypot(mx, my) || 1;
      const nx = -mx / ml;
      const ny = -my / ml;
      for (const [t0, t1] of segs) {
        const p0 = at(t0);
        const p1 = at(t1);
        p.ink('a');
        line(p, p0[0], p0[1], p1[0], p1[1], 1.8, 1);
        const q0: Pt = [p0[0] + nx * off * 2, p0[1] + ny * off * 2];
        const q1: Pt = [p1[0] + nx * off * 2, p1[1] + ny * off * 2];
        line(p, q0[0], q0[1], q1[0], q1[1], 0.9, 0.95);
        p.ink('b');
        glyphPath(p, trimPath([[p0[0] + nx * off, p0[1] + ny * off], [p1[0] + nx * off, p1[1] + ny * off]], 0.05, 0.05), off * 1.3, K.words[i % 3]);
        p.ink('c');
        if (t0 > 0) cap(p, 'bar', p0[0] + nx * off, p0[1] + ny * off, Math.atan2(a[1] - b[1], a[0] - b[0]), 0.03);
        if (t1 < 1) cap(p, 'bar', p1[0] + nx * off, p1[1] + ny * off, Math.atan2(b[1] - a[1], b[0] - a[0]), 0.03);
      }
      if (edgeMode === 'gapped' && L > 0.6) {
        // a sign in the gap and a stub pointing inwards
        const m = at(0.5);
        p.ctx.save();
        p.ctx.translate(m[0] + nx * off, m[1] + ny * off);
        p.ctx.rotate(Math.atan2(-ny, -nx) + Math.PI / 2);
        disc(p, 0.06);
        drawEmblem(p, K, midE, Math.min(0.06, (gapF * L) / 3));
        p.ctx.restore();
        p.ink('a');
        line(p, m[0] + nx * off * 3, m[1] + ny * off * 3, m[0] + nx * 0.2, m[1] + ny * 0.2, 0.9, 0.9);
        p.ink('c');
        dot(p, m[0] + nx * 0.21, m[1] + ny * 0.21, 0.012, 1);
      } else {
        // brackets: ticks on the open middle
        const m = at(0.5);
        p.ink('a');
        for (let k = -3; k <= 3; k++) {
          const q = at(0.5 + k * 0.025);
          line(p, q[0], q[1], q[0] + nx * (k === 0 ? 0.1 : 0.04), q[1] + ny * (k === 0 ? 0.1 : 0.04), 0.8, 0.85);
        }
        p.ink('c');
        dot(p, m[0] + nx * 0.12, m[1] + ny * 0.12, 0.012, 1);
      }
    }
    if (corner === 'node' || corner === 'diamond') {
      p.ink('c');
      V.forEach(([x, y]) => (corner === 'node' ? node(p, x, y, 0.032, true) : cap(p, 'diamond', x, y, Math.atan2(y, x), 0.04)));
    }
  });
  for (let i = 0; i < n; i++) markPath(K, [V[i], V[(i + 1) % n]], 0.12);
  if (corner === 'seal') V.forEach((v, i) => addSeal(K, r, `corner${i}`, v, n > 6 ? 0.1 : 0.14, K.words[i % 3], r.pick(['mini', 'ring'] as const)));
  else if (corner === 'emblem') V.forEach((v, i) => addEmblem(K, r, `corner${i}`, v, 0.09, ANY, 1, { kind: cE.kind, seed: cE.seed + i }));
  // an inner frame (turning slowly or still) and the heart
  const inner = r.pick(['rect', 'diamond', 'arcs'] as const);
  const ix = fx * r.range(0.5, 0.62);
  const iy = fy * r.range(0.5, 0.62);
  const f2 = r.range(0.25, 0.4);
  K.add('frameInner', ix + 0.1, 0.95, (p) => {
    if (inner === 'arcs') {
      for (let i = 0; i < 4; i++) pathBand(p, ellArc(0, 0, ix, iy, (i / 4) * TAU + 0.25, ((i + 1) / 4) * TAU - 0.25, 30), 0.045, i % 2 ? 'double' : 'text', K.words[i % 3]);
      return;
    }
    const W: Pt[] = inner === 'rect' ? [[-ix, -iy], [ix, -iy], [ix, iy], [-ix, iy]] : [[0, -iy], [ix, 0], [0, iy], [-ix, 0]];
    for (let i = 0; i < 4; i++) {
      const a = W[i];
      const b = W[(i + 1) % 4];
      p.ink('a');
      line(p, a[0], a[1], a[0] + (b[0] - a[0]) * f2, a[1] + (b[1] - a[1]) * f2, 1.3, 1);
      line(p, b[0], b[1], b[0] + (a[0] - b[0]) * f2, b[1] + (a[1] - b[1]) * f2, 1.3, 1);
      pathBand(p, [[a[0] + (b[0] - a[0]) * (f2 + 0.06), a[1] + (b[1] - a[1]) * (f2 + 0.06)], [b[0] + (a[0] - b[0]) * (f2 + 0.06), b[1] + (a[1] - b[1]) * (f2 + 0.06)]], 0.04, 'dash', []);
      p.ink('c');
      node(p, a[0], a[1], 0.02, true);
    }
  });
  K.mark([0, 0], Math.max(ix, iy));
  // medallions on the short sides, tied to the frame
  if (r.chance(0.6) && shape !== 'diamondWide' && shape !== 'hexWide') {
    const ms = r.range(0.16, 0.22);
    for (const s of [-1, 1]) addSeal(K, r, `side${s}`, [s * fx, 0], ms, K.words[1]);
  }
  if (r.chance(0.4)) nested(r, K, Math.min(ix, iy) * 0.8);
  else addPiece(K, r, 'frameCore', [0, 0], r.range(0.16, 0.26), K.words[0], 0.5);
}

/** Many independent signs across the field, tied by thin lines and labelled paths, with dust. */
function constellation(r: Rng, K: SKit) {
  const m = r.int(8, 12);
  const pos: Pt[] = [];
  for (let tries = 0; pos.length < m && tries < 1500; tries++) {
    const c: Pt = [r.range(-FW + 0.15, FW - 0.15), r.range(-FH + 0.12, FH - 0.12)];
    if (pos.every((q) => dist(q, c) > 0.4)) pos.push(c);
  }
  const bigs = new Set([r.int(0, pos.length - 1), r.int(0, pos.length - 1)]);
  const sizes = pos.map((_, i) => (bigs.has(i) ? r.range(0.24, 0.32) : r.range(0.1, 0.18)));
  const inTree = [0];
  const edges: [number, number][] = [];
  while (inTree.length < pos.length) {
    let best: [number, number] = [0, 0];
    let bd = Infinity;
    for (const i of inTree) {
      for (let j = 0; j < pos.length; j++) {
        if (inTree.includes(j)) continue;
        const d = dist(pos[i], pos[j]);
        if (d < bd) {
          bd = d;
          best = [i, j];
        }
      }
    }
    edges.push(best);
    inTree.push(best[1]);
  }
  for (let e = 0; e < r.int(2, 4); e++) {
    const i = r.int(0, pos.length - 1);
    const near = pos.map((q, j) => [dist(q, pos[i]), j] as const).filter(([, j]) => j !== i).sort((a, b) => a[0] - b[0]);
    const j = near[r.int(1, Math.min(2, near.length - 1))]?.[1];
    if (j !== undefined && !edges.some(([a, b]) => (a === i && b === j) || (a === j && b === i))) edges.push([i, j]);
  }
  const labelled = new Set([...edges.keys()].sort((a, b) => dist(pos[edges[b][0]], pos[edges[b][1]]) - dist(pos[edges[a][0]], pos[edges[a][1]])).slice(0, r.int(2, 4)));
  const seed = seedOf(r);
  const lite: Bundle = { ...K.B, main: r.pick(['line', 'nodes', 'dash'] as const), mid: r.chance(0.5) ? 'node' : 'none' };
  K.add('constLinks', FW + 0.2, 1, (p) => {
    const lr = makeRng(seed);
    edges.forEach(([i, j], e) => {
      if (labelled.has(e)) {
        const pts = trimPath([pos[i], pos[j]], sizes[i] + 0.05, sizes[j] + 0.05);
        if (pts.length > 1) pathBand(p, pts, 0.045, 'text', K.words[e % 3]);
      } else bundleBetween(p, K, lite, pos[i], sizes[i], pos[j], sizes[j], 0, lr, K.words[e % 3], 0.8);
    });
    // dust, and a few asterisms of tiny stars
    p.ink('c');
    for (let i = 0; i < 70; i++) {
      const q: Pt = [lr.range(-FW, FW), lr.range(-FH, FH)];
      if (pos.some((c, k) => dist(q, c) < sizes[k] + 0.04)) continue;
      const s = lr.range(0.004, 0.013);
      if (lr.chance(0.25)) {
        line(p, q[0] - s * 2.4, q[1], q[0] + s * 2.4, q[1], 0.7, 0.9);
        line(p, q[0], q[1] - s * 2.4, q[0], q[1] + s * 2.4, 0.7, 0.9);
      } else dot(p, q[0], q[1], s, lr.range(0.5, 1));
    }
  });
  edges.forEach(([i, j]) => markPath(K, [pos[i], pos[j]], 0.06));
  pos.forEach((c, i) => addPiece(K, r, `star${i}`, c, sizes[i], K.words[i % 3], bigs.has(i) ? 0.8 : 0.35));
}

/** Spirals (one wide, a pair of volutes, or three) winding in; no circle anywhere. */
function spiral(r: Rng, K: SKit) {
  const mode = r.pick(['wide', 'volutes', 'volutes', 'triple'] as const);
  const kind = r.pick(['text', 'text', 'beads', 'emblems', 'double'] as const);
  const endCap: CapKind = r.pick(CAPS);
  const e = pickEmblem(r, ANY);
  type Sp = { c: Pt; sx: number; sy: number; r1: number; r0: number; turns: number; arms: number; ph: number; d: number };
  const list: Sp[] = [];
  if (mode === 'wide') {
    list.push({ c: [0, 0], sx: 1.5, sy: 0.86, r1: 1, r0: 0.12, turns: r.range(1.6, 2.4), arms: r.pick([1, 2, 3]), ph: r.range(0, TAU), d: K.dir });
  } else if (mode === 'volutes') {
    const rr = r.range(0.62, 0.74);
    for (const s of [-1, 1]) list.push({ c: [s * (FW - rr - 0.06), r.range(-0.08, 0.08)], sx: rr, sy: rr * 0.95, r1: 1, r0: 0.14, turns: r.range(1.8, 2.6), arms: 1, ph: s > 0 ? Math.PI : 0, d: s * K.dir });
  } else {
    const rr = r.range(0.44, 0.52);
    const P: Pt[] = [[-1.0, 0.3], [1.0, 0.3], [0, -0.38]];
    for (const [i, c] of P.entries()) list.push({ c, sx: rr, sy: rr, r1: 1, r0: 0.14, turns: r.range(1.6, 2.2), arms: 1, ph: (i / 3) * TAU, d: K.dir });
  }
  const armPts = (sp: Sp, a: number, dr = 0): Pt[] =>
    Array.from({ length: 180 }, (_, i) => {
      const t = i / 179;
      const rad = sp.r1 + (sp.r0 - sp.r1) * t + dr * (1 - 0.6 * t);
      const ang = sp.ph + (a / sp.arms) * TAU + sp.d * t * sp.turns * TAU;
      return [sp.c[0] + Math.cos(ang) * rad * sp.sx, sp.c[1] + Math.sin(ang) * rad * sp.sy] as Pt;
    });
  const seed = seedOf(r);
  K.add('spiral', FW + 0.1, 1, (p) => {
    const lr = makeRng(seed);
    list.forEach((sp, si) => {
      for (let a = 0; a < sp.arms; a++) {
        const pts = armPts(sp, a);
        const w = K.words[(a + si) % 3];
        const hh = 0.075 / Math.max(sp.sx, 0.6);
        if (kind === 'text') {
          p.ink('a');
          strokePath(p, armPts(sp, a, hh * 0.62), 1, 0.95);
          strokePath(p, armPts(sp, a, -hh * 0.62), 1, 0.95);
          p.ink('b');
          glyphPath(p, pts, 0.07, w, 1, 0.45);
        } else if (kind === 'beads') {
          p.ink('a');
          strokePath(p, pts, 0.8, 0.8);
          const nb = lr.int(12, 20);
          for (let i = 0; i < nb; i++) {
            const t = i / nb;
            const q = pts[Math.round(t * 179)];
            const s = 0.05 * (1 - 0.65 * t);
            p.ctx.save();
            p.ctx.translate(q[0], q[1]);
            disc(p, s);
            p.ink('c');
            circle(p, s, 1, 1);
            p.ink('b');
            p.ctx.globalAlpha = 1;
            const seq = w.filter((x) => x >= 0);
            drawGlyph(p.ctx, seq.length ? seq[i % seq.length] : i, s * 1.2);
            p.ctx.restore();
          }
        } else if (kind === 'emblems') {
          pathBand(p, pts, 0.03, 'double', []);
          for (let i = 1; i < 8; i++) {
            const t = i / 8;
            const q = pts[Math.round(t * 179)];
            p.ctx.save();
            p.ctx.translate(q[0], q[1]);
            disc(p, 0.075 * (1 - 0.6 * t));
            drawEmblem(p, K, { kind: e.kind, seed: e.seed + i }, 0.07 * (1 - 0.6 * t));
            p.ctx.restore();
          }
        } else {
          pathBand(p, pts, 0.05, lr.chance(0.5) ? 'ticks' : 'double', []);
          p.ink('a');
          strokePath(p, armPts(sp, a, -0.09), 0.6, 0.7);
        }
        p.ink('c');
        cap(p, endCap, pts[0][0], pts[0][1], endAngle(pts, true), 0.045);
      }
    });
    if (mode === 'volutes') {
      // the two scrolls are one figure: a band joining their outer turns across the middle
      const a = list[0];
      const b = list[1];
      const up = bend([a.c[0] + a.sx * 0.2, a.c[1] - a.sy * 0.98], [b.c[0] - b.sx * 0.2, b.c[1] - b.sy * 0.98], 0.08, 40);
      const dn = bend([a.c[0] + a.sx * 0.2, a.c[1] + a.sy * 0.98], [b.c[0] - b.sx * 0.2, b.c[1] + b.sy * 0.98], -0.08, 40);
      pathBand(p, up, 0.05, 'text', K.words[0]);
      pathBand(p, dn, 0.05, 'double', []);
    } else if (mode === 'triple') {
      for (let i = 0; i < 3; i++) bundleBetween(p, K, K.B, list[i].c, list[i].sx + 0.02, list[(i + 1) % 3].c, list[(i + 1) % 3].sx + 0.02, 0.15, lr, K.words[i]);
    }
  });
  list.forEach((sp) => {
    for (let a = 0; a < sp.arms; a++) markPath(K, armPts(sp, a), 0.06);
    K.mark(sp.c, Math.min(sp.sx, sp.sy) * 0.9);
  });
  if (mode === 'volutes') K.mark([0, 0], 0.4);
  list.forEach((sp, i) => addEmblem(K, r, `spEye${i}`, sp.c, Math.max(0.08, sp.r0 * Math.min(sp.sx, 0.8) * 0.9), ANY, 1, r.chance(0.35) ? { kind: 'spiral', seed: seedOf(r) } : pickEmblem(r, ANY)));
}

/** The composition fills only the upper (or the lower) part: a wide arch on a base line, with pillars. */
function arch(r: Rng, K: SKit) {
  const up = r.chance(0.7) ? 1 : -1;
  const rx = r.range(1.3, 1.46);
  const ry = r.range(1.1, 1.3);
  const yb = up * r.range(0.46, 0.56);
  const a0 = up > 0 ? Math.PI : 0;
  const a1 = up > 0 ? TAU : Math.PI;
  type Band = { k: number; h: number; style: BandStyle };
  const list: Band[] = [];
  let k = 1;
  for (let i = 0; i < r.int(3, 4) && k > 0.4; i++) {
    const h = r.range(0.055, 0.085);
    list.push({ k, h, style: i === 0 ? r.pick(['text', 'knock', 'double'] as const) : r.pick(['text', 'double', 'ticks', 'dash', 'text'] as const) });
    k -= (h + r.range(0.05, 0.1)) / ry;
  }
  const inner = r.pick(['rays', 'arcade', 'rays', 'both'] as const);
  const nRays = r.int(9, 17);
  const arcadeN = r.pick([3, 5]);
  const steps = r.int(2, 3);
  const pCap: CapKind = r.pick(CAPS);
  K.add('arch', FW + 0.2, 1, (p) => {
    p.ctx.save();
    p.ctx.translate(0, yb);
    list.forEach((b, i) => pathBand(p, ellArc(0, 0, rx * b.k, ry * b.k, a0, a1, 90), b.h, b.style, K.words[i % 3]));
    const ik = k + 0.04;
    if (inner === 'rays' || inner === 'both') {
      p.ink('c');
      for (let i = 1; i < nRays; i++) {
        const t = a0 + ((a1 - a0) * i) / nRays;
        const e = i % 2 ? 0.72 : 0.96;
        line(p, Math.cos(t) * 0.16, Math.sin(t) * 0.16, Math.cos(t) * rx * ik * e, Math.sin(t) * ry * ik * e, i % 2 ? 0.8 : 1.2, 0.95);
      }
      arc(p, 0.16, a0, a1, 1.2, 1);
    }
    if (inner === 'arcade' || inner === 'both') {
      const w = (rx * ik * 2) / arcadeN;
      for (let i = 0; i < arcadeN; i++) {
        const cx = -rx * ik + w * (i + 0.5);
        const hk = 1 - Math.abs(cx) / (rx * ik) * 0.6;
        pathBand(p, ellArc(cx, 0, w * 0.44, w * 0.7 * hk, a0, a1, 30), 0.03, 'double', []);
      }
    }
    // base line with steps
    const sg = up;
    pathBand(p, [[-FW + 0.05, 0], [FW - 0.05, 0]], 0.05, 'text', K.words[1]);
    for (let s = 1; s <= steps; s++) {
      p.ink('a');
      line(p, -rx + s * 0.2, sg * (0.03 + s * 0.055), rx - s * 0.2, sg * (0.03 + s * 0.055), 1.3 - s * 0.2, 0.95);
    }
    p.ink('c');
    for (const sx of [-1, 1]) {
      p.ink('a');
      line(p, sx * rx, 0, sx * rx, sg * 0.3, 1.4, 1);
      line(p, sx * (rx - 0.05), 0, sx * (rx - 0.05), sg * 0.24, 0.8, 0.9);
      p.ink('c');
      cap(p, pCap, sx * rx, sg * 0.3, (sg * Math.PI) / 2, 0.04);
      cap(p, 'arrow', sx * (FW - 0.05), 0, sx > 0 ? 0 : Math.PI, 0.035);
    }
    p.ctx.restore();
  });
  list.forEach((b) => markPath(K, ellArc(0, yb, rx * b.k, ry * b.k, a0, a1, 40), b.h));
  markPath(K, [[-FW, yb], [FW, yb]], 0.1);
  K.mark([0, yb - up * ry * k * 0.45], ry * k * 0.5);
  addEmblem(K, r, 'archKey', [0, yb - up * (ry + 0.02)], r.range(0.12, 0.17), UPRIGHT);
  addPiece(K, r, 'archHeart', [0, yb - up * 0.2], r.range(0.16, 0.22), K.words[0], 0.5);
  // the corners beside the arch hold pieces too
  const cs = r.range(0.14, 0.2);
  const ce = pickEmblem(r, ANY);
  const cSeal = r.chance(0.5);
  for (const sx of [-1, 1]) {
    const at: Pt = [sx * (rx - 0.05), yb - up * ry * 0.72];
    if (Math.abs(at[1]) < FH) {
      if (cSeal) addSeal(K, r, `archSide${sx}`, at, cs, K.words[1]);
      else addEmblem(K, r, `archSide${sx}`, at, cs * 0.8, ANY, 1, ce);
    }
  }
}

/** A sign in the middle and a big form spreading to both sides across the field. */
function wings(r: Rng, K: SKit) {
  const style = r.pick(['feathers', 'arcs', 'blades', 'bat'] as const);
  const span = r.range(1.45, 1.56);
  const lift = r.range(-0.5, 0.05);
  const root = r.range(0.2, 0.28);
  const n = style === 'blades' ? r.int(8, 12) : r.int(6, 10);
  const wr = seedOf(r);
  const lower = r.chance(0.5);
  const bone = quadPts([root, 0], [span * 0.5, lift * 0.8 - 0.3], [span, lift], 50);
  const wingDraw = (sx: 1 | -1) => (p: Pen) => {
    const lr = makeRng(wr);
    const M = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [x * sx, y] as Pt);
    // letters must not be mirrored: on the left wing the path runs towards the middle
    const band = (pts: Pt[], h: number, st: BandStyle, w: number[]) => pathBand(p, sx > 0 ? M(pts) : M(pts).reverse(), h, st, w);
    if (style === 'feathers') {
      band(bone, 0.06, 'text', K.words[0]);
      for (const row of [0, 1]) {
        for (let i = 0; i < n; i++) {
          const t = 0.1 + (i / (n - 1)) * 0.9;
          const b = pathAt(bone, t * pathLength(bone));
          const len = (row ? 0.22 : 0.34) + (row ? 0.18 : 0.42) * t;
          const a = Math.PI / 2 - 0.25 - t * 0.7 + row * 0.1;
          const tip = add2([b.x, b.y], polar(len * lr.range(0.9, 1.05), a));
          p.ink(row ? 'c' : 'a');
          strokePath(p, M(quadPts([b.x, b.y], add2([b.x, b.y], polar(len * 0.5, a - 0.25)), tip, 16)), row ? 0.8 : 1.2, 0.95);
          strokePath(p, M(quadPts([b.x, b.y], add2([b.x, b.y], polar(len * 0.5, a + 0.12)), tip, 16)), 0.6, 0.7);
          dot(p, tip[0] * sx, tip[1], 0.011, 1);
        }
      }
    } else if (style === 'arcs') {
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const rad = 0.3 + t * (span - 0.34);
        const cx = root * 0.6 - rad * 0.35;
        const pts = ellArc(cx, lift * t * 0.6, rad, rad * 0.8, -1.15 + t * 0.2, 0.6 - t * 0.2, 36);
        if (i === n - 1 || i === Math.floor(n / 2)) band(pts, 0.05, 'text', K.words[i % 3]);
        else {
          p.ink(i % 2 ? 'a' : 'c');
          strokePath(p, M(pts), 1.4 - t * 0.5, 1);
          const e = M(pts)[pts.length - 1];
          dot(p, e[0], e[1], 0.013, 1);
        }
      }
    } else if (style === 'blades') {
      band(bone, 0.05, 'double', []);
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const a = -1.1 + t * 1.75 + lift * 0.3;
        const len = (span - root) * (0.6 + 0.4 * Math.sin((1 - t) * Math.PI * 0.9)) * lr.range(0.9, 1.05);
        const base: Pt = [root + 0.02, 0.02 * i];
        const tip = add2(base, polar(len, a));
        const w = 0.024 * (1 - t * 0.4);
        const nx = -Math.sin(a) * w;
        const ny = Math.cos(a) * w;
        p.ink(i % 2 ? 'c' : 'a');
        p.ctx.globalAlpha = 0.95;
        p.ctx.beginPath();
        p.ctx.moveTo((base[0] + nx) * sx, base[1] + ny);
        p.ctx.lineTo(tip[0] * sx, tip[1]);
        p.ctx.lineTo((base[0] - nx) * sx, base[1] - ny);
        p.ctx.closePath();
        p.ctx.fill();
        const g = add2(base, polar(0.08, a));
        line(p, (g[0] + nx * 1.8) * sx, g[1] + ny * 1.8, (g[0] - nx * 1.8) * sx, g[1] - ny * 1.8, 1, 0.9);
      }
    } else {
      const wrist: Pt = [span * 0.42, lift * 0.5 - 0.3];
      const lead = quadPts([root, 0], [span * 0.2, -0.36 + lift * 0.3], wrist, 20).concat(quadPts(wrist, [span * 0.75, lift - 0.3], [span, lift], 24).slice(1));
      band(lead, 0.055, 'text', K.words[2]);
      const tips: Pt[] = [[span, lift], [span * 0.9, lift + 0.42], [span * 0.68, 0.55], [span * 0.44, 0.5], [root + 0.02, 0.18]];
      p.ink('a');
      for (const tp of tips.slice(1, 4)) {
        line(p, wrist[0] * sx, wrist[1], tp[0] * sx, tp[1], 1.1, 0.95);
        link(p, M([add2(wrist, [0, 0.03]), add2(tp, [-0.04, -0.04])]), 'dash', lr, [], 0.7);
      }
      p.ink('c');
      for (let i = 0; i < tips.length - 1; i++) {
        const a = tips[i];
        const b = tips[i + 1];
        const mid: Pt = [(a[0] + b[0]) / 2 - 0.06, (a[1] + b[1]) / 2 - 0.08];
        strokePath(p, M(quadPts(a, mid, b, 16)), 1.2, 1);
        dot(p, a[0] * sx, a[1], 0.014, 1);
      }
      node(p, wrist[0] * sx, wrist[1], 0.022, true);
    }
    if (lower) {
      // a smaller lower wing
      for (let i = 0; i < 4; i++) {
        const t = i / 3;
        const pts = quadPts([root * 0.9, 0.12 + i * 0.03], [span * (0.35 + t * 0.1), 0.3 + t * 0.15], [span * (0.55 + t * 0.18), 0.62 + t * 0.12], 24);
        if (i === 2) band(pts, 0.04, 'text', K.words[1]);
        else {
          p.ink('a');
          strokePath(p, M(pts), 1 - t * 0.2, 0.9);
          p.ink('c');
          const e = pts[pts.length - 1];
          dot(p, e[0] * sx, e[1], 0.012, 1);
        }
      }
    }
  };
  K.add('wingR', span + 0.12, 1, wingDraw(1), { at: [0, 0] });
  K.add('wingL', span + 0.12, 1, wingDraw(-1), { at: [0, 0] });
  for (const sx of [-1, 1]) {
    markPath(K, bone.map(([x, y]) => [x * sx, y] as Pt), 0.2);
    K.mark([sx * span * 0.5, 0.25], 0.28);
    if (lower) K.mark([sx * span * 0.5, 0.55], 0.22);
  }
  const cs = r.range(0.2, 0.28);
  if (r.chance(0.55)) addSeal(K, r, 'wingHeart', [0, 0], cs, K.words[0], r.pick(['ringed', 'rays', 'broken'] as const));
  else addEmblem(K, r, 'wingHeart', [0, 0], cs, UPRIGHT);
  const tailLen = r.range(0.4, 0.55);
  const tCap: CapKind = r.pick(CAPS);
  const haloE = pickEmblem(r, UPRIGHT);
  K.add('wingExtra', 0.95, 1, (p) => {
    // a halo above, a tail below with bars
    p.ink('a');
    p.ctx.save();
    p.ctx.translate(0, -cs - 0.14);
    p.ctx.scale(1, 0.32);
    circle(p, cs * 1.3, 1.4, 1);
    p.ctx.restore();
    p.ctx.save();
    p.ctx.translate(0, -cs - 0.34);
    drawEmblem(p, K, haloE, 0.1);
    p.ctx.restore();
    textRail(p, [[0, cs + 0.04], [0, cs + tailLen]], 0.045, K.words[2]);
    p.ink('c');
    cap(p, tCap, 0, cs + tailLen, Math.PI / 2, 0.045);
    for (let k = 1; k <= 2; k++) {
      const y = cs + tailLen * (k / 3);
      p.ink('a');
      line(p, -0.07 * (3 - k), y, 0.07 * (3 - k), y, 1.1, 1);
    }
  });
  K.mark([0, -cs - 0.25], 0.18);
  K.mark([0, cs + tailLen / 2], tailLen / 2);
}

/** Everything points one way across the field: chevrons, a shaft, a sign at the tip, a seal at the tail. */
function wedge(r: Rng, K: SKit) {
  const dirX = r.sign();
  const ang = r.chance(0.75) ? (dirX > 0 ? 0 : Math.PI) : r.pick([-0.35, 0.35, Math.PI - 0.35, Math.PI + 0.35]);
  const rot = ang + Math.PI / 2;
  const L1 = r.range(1.3, 1.45);
  const L2 = r.range(1.25, 1.4);
  const W = r.range(0.6, 0.78);
  const k = r.int(5, 8);
  const slope = r.range(0.45, 0.85);
  const shaft = r.pick(['text', 'text', 'ladder', 'beads'] as const);
  const tipS = r.range(0.14, 0.2);
  const armCap: CapKind = r.pick(CAPS);
  const echo = r.chance(0.6);
  const seed = seedOf(r);
  const chev = (i: number) => {
    const t = i / (k - 1);
    const y = L2 * 0.72 - t * (L2 * 0.72 + L1 * 0.62);
    const w = W * (1 - t * 0.7);
    return { t, y, w };
  };
  K.add('wedge', Math.max(L1, L2) + 0.15, 1, (p) => {
    const lr = makeRng(seed);
    p.ctx.save();
    p.ctx.rotate(rot);
    const pts: Pt[] = [[0, L2 - 0.2], [0, -L1 + tipS + 0.02]];
    if (shaft === 'text') pathBand(p, pts, 0.06, 'text', K.words[0]);
    else link(p, pts, shaft, lr, K.words[0], 1.3);
    for (let i = 0; i < k; i++) {
      const { t, y, w } = chev(i);
      for (const sx of [-1, 1]) {
        const arm: Pt[] = [[sx * w, y + w * slope], [0, y]];
        if (i % 2 === 0) pathBand(p, sx > 0 ? [arm[1], arm[0]] : arm, 0.045, 'text', K.words[(i + 1) % 3]);
        else {
          p.ink('a');
          line(p, arm[0][0], arm[0][1], arm[1][0], arm[1][1], 1.5 - t * 0.5, 1);
        }
        if (echo) link(p, [[sx * w * 1.12, y + w * slope + 0.1], [0, y + 0.1]], 'dash', lr, [], 0.8);
        p.ink('c');
        cap(p, armCap, arm[0][0], arm[0][1], Math.atan2(arm[0][1] - arm[1][1], arm[0][0] - arm[1][0]), 0.032);
      }
    }
    p.ink('a');
    for (const sx of [-1, 1]) {
      const a: Pt = [sx * W * 1.18, L2 * 0.72 + W * slope + 0.05];
      const b: Pt = [0, -L1];
      for (const [t0, t1] of [[0, 0.3], [0.38, 0.62], [0.7, 0.93]]) {
        line(p, a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0, a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1, 1, 0.9);
      }
    }
    p.ink('c');
    for (let j = 0; j < 7; j++) dot(p, 0, -L1 * 0.4 + j * (L2 * 0.16), 0.009 + j * 0.003, 1);
    p.ctx.restore();
  });
  const T = (x: number, y: number): Pt => [x * Math.cos(rot) - y * Math.sin(rot), x * Math.sin(rot) + y * Math.cos(rot)];
  markPath(K, [T(0, L2), T(0, -L1)], 0.1);
  for (let i = 0; i < k; i++) {
    const { y, w } = chev(i);
    for (const sx of [-1, 1]) markPath(K, [T(sx * w, y + w * slope), T(0, y)], 0.08);
  }
  const e = pickEmblem(r, UPRIGHT);
  K.add('wedgeTip', tipS * 1.15, 1, (p) => {
    p.ctx.rotate(rot);
    drawEmblem(p, K, e, tipS);
  }, { at: T(0, -L1 + tipS * 0.5) });
  K.mark(T(0, -L1 + tipS * 0.5), tipS);
  addSeal(K, r, 'wedgeTail', T(0, L2 - 0.02), r.range(0.2, 0.26), K.words[2], r.pick(['ringed', 'rays', 'broken'] as const));
}

/** "A seal without a seal": big geometry with no outer ring, stretched over the field or flanked. */
function silhouette(r: Rng, K: SKit) {
  const kind = r.pick(['star', 'hexagram', 'triangles', 'squares', 'rhombus', 'bowtie', 'lens', 'crescent'] as const);
  const R = r.range(0.8, 0.88);
  const n = kind === 'star' ? r.int(5, 9) : 3;
  const kk = Math.max(2, Math.floor((n - 1) / 2));
  const glyphEdges = r.chance(0.7);
  const vtx: CapKind | 'none' = r.pick([...CAPS, 'none'] as const);
  const rot = -Math.PI / 2;
  let verts: Pt[] = [];
  const edgeLoop = (p: Pen, loop: Pt[], i0: number) => {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      if (glyphEdges && (i + i0) % 2 === 0) pathBand(p, [a, b], 0.055, 'text', K.words[(i + i0) % 3]);
      else {
        p.ink('a');
        line(p, a[0], a[1], b[0], b[1], 1.7, 1);
        line(p, a[0] * 0.96, a[1] * 0.96, b[0] * 0.96, b[1] * 0.96, 0.6, 0.7);
      }
    }
  };
  if (kind === 'star') verts = polygonPts(n, R, rot);
  else if (kind === 'hexagram') verts = polygonPts(6, R, rot);
  else if (kind === 'triangles') verts = [...polygonPts(3, R, rot), ...polygonPts(3, R * 0.8, rot + Math.PI)];
  else if (kind === 'squares') verts = [...polygonPts(4, R, rot), ...polygonPts(4, R, rot + Math.PI / 4)];
  else if (kind === 'rhombus') verts = [[0, -FH], [FW - 0.05, 0], [0, FH], [-FW + 0.05, 0]];
  else if (kind === 'bowtie') verts = [[-FW + 0.05, -0.8], [-FW + 0.05, 0.8], [FW - 0.05, -0.8], [FW - 0.05, 0.8]];
  else if (kind === 'lens') verts = [[-FW + 0.05, 0], [FW - 0.05, 0]];
  else verts = [[-R * 1.02, 0], [R * 1.02, 0]];
  const wide = kind === 'rhombus' || kind === 'bowtie' || kind === 'lens';
  const seed = seedOf(r);
  K.add('silhouette', FW + 0.15, 1, (p) => {
    const lr = makeRng(seed);
    if (kind === 'star') {
      starPoly(n, kk, R, rot).forEach((loop, i) => edgeLoop(p, loop, i));
      p.ink('a');
      strokePoly(p, polygonPts(n, R * 0.45, rot + Math.PI / n), 0.9, 0.85);
    } else if (kind === 'hexagram') {
      starPoly(6, 2, R, rot).forEach((loop, i) => edgeLoop(p, loop, i));
      p.ink('a');
      strokePoly(p, polygonPts(6, R * 0.577, rot + Math.PI / 6), 1, 0.9);
    } else if (kind === 'triangles') {
      edgeLoop(p, polygonPts(3, R, rot), 0);
      edgeLoop(p, polygonPts(3, R * 0.8, rot + Math.PI), 1);
      p.ink('a');
      strokePoly(p, polygonPts(3, R * 0.4, rot), 1, 0.9);
    } else if (kind === 'squares') {
      edgeLoop(p, polygonPts(4, R, rot), 0);
      edgeLoop(p, polygonPts(4, R, rot + Math.PI / 4), 1);
      p.ink('a');
      strokePoly(p, polygonPts(4, R * 0.55, rot), 1, 0.9);
    } else if (kind === 'rhombus') {
      edgeLoop(p, verts, 0);
      p.ink('a');
      strokePoly(p, verts.map(([x, y]) => [x * 0.68, y * 0.68] as Pt), 1.1, 1);
      strokePoly(p, verts.map(([x, y]) => [x * 0.36, y * 0.36] as Pt), 0.9, 0.9);
      line(p, -FW * 0.95, 0, FW * 0.95, 0, 0.8, 0.8);
      line(p, 0, -FH * 0.95, 0, FH * 0.95, 0.8, 0.8);
    } else if (kind === 'bowtie') {
      // two triangles pointing at the middle from both sides
      for (const sx of [-1, 1]) {
        const tri: Pt[] = [[sx * (FW - 0.05), -0.8], [sx * (FW - 0.05), 0.8], [sx * 0.18, 0]];
        edgeLoop(p, sx > 0 ? tri : tri.slice().reverse(), sx > 0 ? 0 : 1);
        p.ink('a');
        strokePoly(p, [[sx * (FW - 0.2), -0.52], [sx * (FW - 0.2), 0.52], [sx * 0.5, 0]], 1, 0.9);
      }
    } else if (kind === 'lens') {
      const up = bend([-FW + 0.05, 0], [FW - 0.05, 0], 0.26, 80);
      const dn = bend([-FW + 0.05, 0], [FW - 0.05, 0], -0.26, 80);
      pathBand(p, up, 0.06, 'text', K.words[0]);
      pathBand(p, dn, 0.06, glyphEdges ? 'text' : 'double', K.words[2]);
      pathBand(p, bend([-FW + 0.3, 0], [FW - 0.3, 0], 0.16, 60), 0.04, 'double', []);
      pathBand(p, bend([-FW + 0.3, 0], [FW - 0.3, 0], -0.16, 60), 0.04, 'dash', []);
      p.ink('a');
      line(p, -FW + 0.05, 0, FW - 0.05, 0, 0.8, 0.8);
    } else {
      p.ink('a');
      const up = lr.chance(0.5) ? -1 : 1;
      crescent(p, 0, 0, R * 1.02, up * (Math.PI / 2), 0.38, false, 1.7, 1);
      crescent(p, 0, 0, R * 0.96, up * (Math.PI / 2), 0.38, false, 0.6, 0.7);
      strokePoly(p, polygonPts(3, R * 0.42, rot), 1.2, 1);
      p.ink('c');
      for (let i = 0; i < 9; i++) dot(p, ...polar(R * 1.12, -up * (Math.PI / 2) + (i - 4) * 0.22), 0.014, 1);
    }
    if (vtx !== 'none') {
      p.ink('c');
      verts.forEach(([x, y]) => cap(p, vtx, x, y, Math.atan2(y, x), 0.042));
    }
  });
  if (wide) {
    if (kind === 'rhombus') for (let i = 0; i < 4; i++) markPath(K, [verts[i], verts[(i + 1) % 4]], 0.1);
    else if (kind === 'bowtie') for (const sx of [-1, 1]) {
      markPath(K, [[sx * FW, -0.8], [sx * FW, 0.8]], 0.1);
      markPath(K, [[sx * FW, -0.8], [sx * 0.18, 0]], 0.1);
      markPath(K, [[sx * FW, 0.8], [sx * 0.18, 0]], 0.1);
    } else {
      markPath(K, bend([-FW, 0], [FW, 0], 0.26, 30), 0.1);
      markPath(K, bend([-FW, 0], [FW, 0], -0.26, 30), 0.1);
    }
  } else {
    K.mark([0, 0], R);
    // the flanks: medallions on both sides, tied to the figure
    const ms = r.range(0.2, 0.28);
    const mx = r.range(1.18, 1.3);
    const seedL = seedOf(r);
    K.add('silFlank', FW + 0.1, 1, (p) => {
      const lr = makeRng(seedL);
      for (const sx of [-1, 1]) {
        const tgt = verts.reduce((best, v) => (Math.abs(v[0] - sx * 2) < Math.abs(best[0] - sx * 2) ? v : best), verts[0]);
        bundleBetween(p, K, K.B, [sx * mx, 0], ms, tgt, 0.04, 0.1 * sx, lr, K.words[sx > 0 ? 2 : 1], 0.9);
        linkBetween(p, [sx * mx, 0], ms, [sx * mx, -0.7], 0.04, 'beads', 0, lr, K.words[0], 0.9);
        linkBetween(p, [sx * mx, 0], ms, [sx * mx, 0.7], 0.04, 'beads', 0, lr, K.words[1], 0.9);
        p.ink('c');
        cap(p, 'star', sx * mx, -0.72, -Math.PI / 2, 0.04);
        cap(p, 'star', sx * mx, 0.72, Math.PI / 2, 0.04);
      }
    });
    for (const sx of [-1, 1]) {
      markPath(K, [[sx * mx, -0.75], [sx * mx, 0.75]], 0.08);
      markPath(K, [[sx * mx, 0], [sx * R, 0]], 0.06);
      addSeal(K, r, `silSide${sx}`, [sx * mx, 0], ms, K.words[1]);
    }
  }
  addPiece(K, r, 'silCore', [0, 0], r.range(0.18, 0.26), K.words[0], 0.6);
}

// ------------------------------------------------------------------ filling, garnish, nesting

/**
 * Density: finds the emptiest places of the field and puts seals or signs there, each tied to the
 * nearest piece of the structure (mirrored in pairs when the structure is symmetric).
 */
function fill(r: Rng, K: SKit, sym: boolean, maxN: number) {
  const grid: Pt[] = [];
  for (let x = -FW + 0.12; x <= FW - 0.12; x += 0.07) for (let y = -FH + 0.1; y <= FH - 0.1; y += 0.07) grid.push([x, y]);
  const clearance = (q: Pt) => {
    let d = Math.min(FW + 0.04 - Math.abs(q[0]), FH + 0.04 - Math.abs(q[1]));
    for (const f of K.foot) d = Math.min(d, dist(q, f.c) - f.r);
    return d;
  };
  const ties: { a: Pt; ra: number; b: Pt; rb: number; kind: LinkKind }[] = [];
  const e = pickEmblem(r, ANY);
  let placed = 0;
  while (placed < maxN) {
    let best: Pt | null = null;
    let bd = 0;
    for (const q of grid) {
      if (sym && q[0] < -0.02) continue;
      const d = clearance(q);
      if (d > bd) {
        bd = d;
        best = q;
      }
    }
    if (!best || bd < 0.16) break;
    const s = Math.min(0.26, bd * 0.62);
    const targets: Pt[] = sym && best[0] > 0.2 ? [best, [-best[0], best[1]]] : [best];
    const seal = s > 0.13 && r.chance(0.7);
    const kind: LinkKind = r.pick(['line', 'dash', 'beads', 'nodes'] as const);
    const sealKind = pickSeal(r, s);
    const seed = seedOf(r);
    for (const q of targets) {
      let near: Foot | null = null;
      let nd = Infinity;
      for (const f of K.foot) {
        const d = dist(q, f.c) - f.r;
        if (d < nd) {
          nd = d;
          near = f;
        }
      }
      if (near && nd < 0.9) {
        // tie it to the nearest point of the nearest piece
        const dx = q[0] - near.c[0];
        const dy = q[1] - near.c[1];
        const l = Math.hypot(dx, dy) || 1;
        ties.push({ a: q, ra: s, b: [near.c[0] + (dx / l) * near.r, near.c[1] + (dy / l) * near.r], rb: 0, kind });
      }
      const id = `fill${placed}`;
      const words = K.words[placed % 3];
      if (seal) {
        K.add(id, s * (sealKind === 'rays' ? 1.34 : 1.05), 1, (p) => drawSeal(p, K, sealKind, seed, s, words), { at: q, spin: spinOf(r) });
        K.mark(q, s);
      } else addEmblem(K, r, id, q, s * 0.85, ANY, 1, e);
      placed++;
    }
  }
  if (ties.length) {
    const seed = seedOf(r);
    K.add('fillTies', FW + 0.2, 0.9, (p) => {
      const lr = makeRng(seed);
      for (const t of ties) {
        linkBetween(p, t.a, t.ra, t.b, t.rb, t.kind, 0, lr, K.words[1], 0.8);
        p.ink('c');
        dot(p, t.b[0], t.b[1], 0.012, 1);
      }
    });
  }
}

/** A kit that draws a whole structure smaller and elsewhere (a structure inside a structure). */
function scaledKit(K: SKit, k: number, o: Pt): SKit {
  return {
    ...K,
    add: (id, radius, intensity, draw, opt = {}) =>
      K.add(id, radius * k, intensity, (p) => {
        const lw = p.lw;
        p.ctx.scale(k, k);
        p.lw = lw / k;
        draw(p);
        p.lw = lw;
      }, { ...opt, at: [o[0] + (opt.at?.[0] ?? 0) * k, o[1] + (opt.at?.[1] ?? 0) * k] }),
    mark: (c, rad) => K.mark([o[0] + c[0] * k, o[1] + c[1] * k], rad * k),
  };
}

/** Fills an empty centre with a small structure of another kind. */
function nested(r: Rng, K: SKit, size: number) {
  const kind = r.pick(['silhouette', 'cross', 'spiral', 'constellation', 'totem', 'separated'] as const);
  BUILDERS[kind](r.fork(71), scaledKit(K, size / FW, [0, 0]));
}

/** Extra touches on top of any structure: star dust, fragments of inscriptions, faint geometry. */
function garnish(r: Rng, K: SKit, kind: Structure) {
  const opts = (['dust', 'fragments', 'ghost', 'ticks'] as const).filter((x) => !(x === 'dust' && kind === 'constellation'));
  const picks = new Set(Array.from({ length: r.int(1, 2) }, () => r.pick(opts)));
  for (const g of picks) {
    const seed = seedOf(r);
    if (g === 'dust') {
      const n = r.int(30, 60);
      K.add('dust', FW + 0.2, 0.8, (p) => {
        const lr = makeRng(seed);
        p.ink('c');
        for (let i = 0; i < n; i++) {
          const q: Pt = [lr.range(-FW, FW), lr.range(-FH, FH)];
          const s = lr.range(0.004, 0.012);
          if (lr.chance(0.25)) {
            line(p, q[0] - s * 2.2, q[1], q[0] + s * 2.2, q[1], 0.7, 0.9);
            line(p, q[0], q[1] - s * 2.2, q[0], q[1] + s * 2.2, 0.7, 0.9);
          } else dot(p, q[0], q[1], s, lr.range(0.5, 1));
        }
      });
    } else if (g === 'fragments') {
      const frs = Array.from({ length: r.int(3, 5) }, () => ({ a: r.range(0, TAU), l: r.range(0.25, 0.55), w: r.int(0, 2), k: r.range(1.02, 1.08) }));
      K.add('fragments', FW + 0.2, 0.85, (p) => {
        for (const f of frs) {
          const pts = ellArc(0, 0, FW * f.k * 0.97, FH * f.k * 0.97, f.a, f.a + f.l, 24);
          p.ink('b');
          glyphPath(p, pts, 0.045, K.words[f.w], 0.9);
          p.ink('c');
          dot(p, pts[0][0], pts[0][1], 0.01, 1);
          const e = pts[pts.length - 1];
          dot(p, e[0], e[1], 0.01, 1);
        }
      });
    } else if (g === 'ghost') {
      const lines = r.int(1, 3);
      const ph = r.range(0, Math.PI);
      K.add('ghost', FW + 0.2, 0.35, (p) => {
        p.ink('a');
        strokePoly(p, [[0, -FH], [FW, 0], [0, FH], [-FW, 0]], 0.5, 0.4);
        for (let i = 0; i < lines; i++) {
          const a = ph + (i / lines) * Math.PI;
          line(p, -Math.cos(a) * FW, -Math.sin(a) * FH, Math.cos(a) * FW, Math.sin(a) * FH, 0.4, 0.35);
        }
      });
    } else {
      const groups = Array.from({ length: r.int(2, 4) }, () => ({ a: r.range(0, TAU) }));
      K.add('ticks', FW + 0.2, 0.8, (p) => {
        p.ink('a');
        for (const gr of groups) {
          for (let k = -5; k <= 5; k++) {
            const t = gr.a + k * 0.02;
            const x = Math.cos(t) * FW;
            const y = Math.sin(t) * FH;
            const l = k === 0 ? 0.09 : k % 2 ? 0.025 : 0.045;
            line(p, x, y, x * (1 - l), y * (1 - l), 0.8, 0.85);
          }
        }
      });
    }
  }
}

const BUILDERS: Record<Exclude<Structure, 'classic'>, (r: Rng, K: SKit) => void> = {
  separated, orbit, chain, broken, poles, totem, cross, trunk, frame, constellation, spiral, arch, wings, wedge, silhouette,
};

/** Mirror-symmetric archetypes get their filler pieces in pairs. */
const SYMMETRIC = new Set<Structure>(['poles', 'totem', 'cross', 'frame', 'arch', 'wings', 'silhouette', 'broken']);

/**
 * On a tall screen the whole structure turns a quarter (its long side then runs along the
 * height), but the pieces (seals and signs) only move: they keep standing upright.
 */
function portraitKit(K: Kit): Kit {
  const turn = (q: Pt): Pt => [-q[1], q[0]];
  return {
    ...K,
    add: (id, radius, intensity, draw, opt = {}) => {
      if (opt.at && radius < 0.7) return K.add(id, radius, intensity, draw, { ...opt, at: turn(opt.at) });
      K.add(id, radius, intensity, (p) => {
        p.ctx.rotate(Math.PI / 2);
        draw(p);
      }, { ...opt, at: opt.at ? turn(opt.at) : undefined });
    },
  };
}

/** Grows the large structure of the given archetype (not the classic circle). */
export function buildStructure(kind: Exclude<Structure, 'classic'>, r: Rng, portrait: boolean, base: Kit) {
  const K = portrait ? portraitKit(base) : base;
  const foot: Foot[] = [];
  const S: SKit = { ...K, foot, mark: (c, rad) => foot.push({ c, r: rad }), B: pickBundle(r.fork(5)) };
  BUILDERS[kind](r, S);
  fill(r.fork(97), S, SYMMETRIC.has(kind), kind === 'constellation' ? 2 : 6);
  if (r.chance(0.55)) garnish(r.fork(99), S, kind);
}
