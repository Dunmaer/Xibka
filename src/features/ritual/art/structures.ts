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
  TAU, CAPS, LINKS, arc, arcPts, cap, circle, crescent, disc, dot, glyphArc, glyphPath, glyphRing, line,
  link, lotus, miniCircle, node, offsetPath, pathAt, polar, polygonPts, quadPts, starPoly, strokePath, strokePoly,
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

const seedOf = (r: Rng) => r.int(1, 2 ** 30);
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
function addEmblem(K: Kit, r: Rng, id: string, at: Pt, s: number, pool: readonly EmblemKind[], intensity = 1, e = pickEmblem(r, pool)) {
  const spin = TURNS.has(e.kind) && r.chance(0.7) ? spinOf(r) : 0;
  K.add(id, s * 1.12, intensity, (p) => drawEmblem(p, K, e, s), { at, spin });
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
  return r.pick(['mini', 'mini', 'ringed', 'ringed', 'rays', 'broken', 'ring'] as const);
}

function addSeal(K: Kit, r: Rng, id: string, at: Pt, R: number, words: number[], kind = pickSeal(r, R), intensity = 0.95) {
  const seed = seedOf(r);
  K.add(id, R * (kind === 'rays' ? 1.34 : 1.05), intensity, (p) => drawSeal(p, K, kind, seed, R, words), { at, spin: spinOf(r) });
}

/** A piece that is a seal or an emblem (for poles, chain links, constellations). */
function addPiece(K: Kit, r: Rng, id: string, at: Pt, s: number, words: number[], sealChance = 0.5, pool: readonly EmblemKind[] = ANY) {
  if (r.chance(sealChance)) addSeal(K, r, id, at, s, words);
  else addEmblem(K, r, id, at, s, pool);
}

/** Tiny stars and sparkles scattered around (the dust between big pieces). */
function dust(p: Pen, r: Rng, n: number, R: number, keepOut: { c: Pt; r: number }[] = []) {
  p.ink('c');
  for (let i = 0; i < n; i++) {
    const a = r.range(0, TAU);
    const d = Math.sqrt(r()) * R;
    const pt = polar(d, a);
    if (keepOut.some((k) => dist(pt, k.c) < k.r)) continue;
    const q = r.range(0.004, 0.012);
    if (r.chance(0.25)) {
      line(p, pt[0] - q * 2.2, pt[1], pt[0] + q * 2.2, pt[1], 0.7, 0.9);
      line(p, pt[0], pt[1] - q * 2.2, pt[0], pt[1] + q * 2.2, 0.7, 0.9);
    } else dot(p, pt[0], pt[1], q, r.range(0.5, 1));
  }
}

// ------------------------------------------------------------------ the archetypes

/** 2-4 big seals far apart, joined by lines, arcs and chains of letters. */
function separated(r: Rng, K: Kit) {
  const k = r.pick([2, 2, 3, 3, 3, 4]);
  const centres: Pt[] = [];
  const sizes: number[] = [];
  if (k === 2) {
    const ang = r.chance(0.6) ? r.range(-0.35, 0.35) : r.range(0, TAU);
    const D = r.range(0.55, 0.72);
    centres.push(polar(D, ang + Math.PI), polar(D, ang));
    sizes.push(r.range(0.3, 0.46), r.range(0.24, 0.46));
  } else {
    const ph = r.range(0, TAU);
    const rad = k === 3 ? r.range(0.6, 0.75) : r.range(0.66, 0.8);
    for (let i = 0; i < k; i++) {
      centres.push(polar(rad * r.range(0.85, 1.12), ph + (i / k) * TAU + r.range(-0.3, 0.3)));
      sizes.push(r.range(0.2, k === 3 ? 0.4 : 0.32));
    }
  }
  sizes.forEach((s, i) => {
    const md = Math.min(...centres.filter((_, j) => j !== i).map((c) => dist(c, centres[i])));
    sizes[i] = Math.min(s, md * 0.4);
  });
  const edges: [number, number][] = k === 2 ? [[0, 1]] : Array.from({ length: k }, (_, i) => [i, (i + 1) % k] as [number, number]);
  if (k > 2 && r.chance(0.35)) edges.pop();
  const hub = k > 2 && r.chance(0.5);
  const hubS = r.range(0.09, 0.17);
  const style: LinkKind = r.pick(LINKS);
  const style2: LinkKind = r.chance(0.4) ? r.pick(LINKS) : style;
  const bendK = r.chance(0.5) ? 0 : r.range(0.12, 0.3) * r.sign();
  const twin = k === 2 && r.chance(0.55);
  const spokes: LinkKind = r.pick(['line', 'dash', 'nodes'] as const);
  const dustN = r.chance(0.5) ? r.int(10, 30) : 0;
  const seed = seedOf(r);
  K.add('links', 1.35, 0.85, (p) => {
    const lr = makeRng(seed);
    edges.forEach(([i, j], e) => linkBetween(p, centres[i], sizes[i], centres[j], sizes[j], e % 2 ? style2 : style, bendK * (e % 2 ? -1 : 1), lr, K.words[e % 3]));
    if (twin) {
      linkBetween(p, centres[0], sizes[0], centres[1], sizes[1], 'line', 0.32, lr, K.words[1]);
      linkBetween(p, centres[0], sizes[0], centres[1], sizes[1], 'dash', -0.32, lr, K.words[1]);
    }
    if (hub) centres.forEach((c, i) => linkBetween(p, [0, 0], hubS, c, sizes[i], spokes, 0, lr, K.words[i % 3], 0.8));
    if (dustN) dust(p, lr, dustN, 1.2, centres.map((c, i) => ({ c, r: sizes[i] + 0.05 })));
  });
  centres.forEach((c, i) => addSeal(K, r, `sep${i}`, c, sizes[i], K.words[i % 3]));
  if (hub) addEmblem(K, r, 'hub', [0, 0], hubS, ROUND);
}

/** One heavy seal off the centre, wrapped in broken orbits carrying satellites and dots. */
function orbit(r: Rng, K: Kit) {
  const ang = r.range(0, TAU);
  const d = r.range(0.2, 0.42);
  const c = polar(d, ang);
  const R = r.range(0.26, 0.38);
  const maxRad = Math.min(1.05, 1.32 - d * 0.6);
  const n = r.int(4, 7);
  type Orb = { off: Pt; rad: number; a0: number; span: number; style: 'plain' | 'double' | 'text' | 'dash' | 'ticks'; end: CapKind | 'none'; sat: number; satS: number; satE: Emblem | null };
  const orbs: Orb[] = Array.from({ length: n }, (_, i) => {
    const rad = R + 0.08 + ((i + r.range(0, 0.6)) / n) * (maxRad - R - 0.08);
    return {
      off: r.chance(0.5) ? polar(r.range(0.02, 0.07), r.range(0, TAU)) : [0, 0],
      rad,
      a0: r.range(0, TAU),
      span: r.range(1.0, 3.6),
      style: r.pick(['plain', 'plain', 'double', 'text', 'dash', 'ticks'] as const),
      end: r.pick(['none', 'dot', 'node', 'bar', 'arrow', 'crescent'] as const),
      sat: r.chance(0.45) ? r.range(0.2, 0.9) : -1,
      satS: r.range(0.04, 0.09),
      satE: r.chance(0.5) ? pickEmblem(r, ANY) : null,
    };
  });
  const trail = r.chance(0.5) ? { rad: r.range(R + 0.1, maxRad), a0: r.range(0, TAU), n: r.int(4, 8) } : null;
  const seed = seedOf(r);
  const drawOrbs = (list: Orb[]) => (p: Pen) => {
    const lr = makeRng(seed + list.length);
    list.forEach((o, i) => {
      const a1 = o.a0 + o.span;
      p.ctx.save();
      p.ctx.translate(o.off[0], o.off[1]);
      if (o.style === 'text') arcBand(p, o.rad, 0.05, o.a0, a1, 'text', K.words[i % 3]);
      else if (o.style === 'double') arcBand(p, o.rad, 0.03, o.a0, a1, 'double', []);
      else if (o.style === 'ticks') arcBand(p, o.rad, 0.04, o.a0, a1, 'ticks', []);
      else if (o.style === 'dash') arcBand(p, o.rad, 0.03, o.a0, a1, 'dash', []);
      else {
        p.ink('a');
        arc(p, o.rad, o.a0, a1, 0.9, 0.9);
      }
      if (o.end !== 'none') {
        p.ink('c');
        for (const [t, s] of [[o.a0, -1], [a1, 1]] as const) {
          const [x, y] = polar(o.rad, t);
          cap(p, o.end, x, y, t + (s * Math.PI) / 2, 0.028);
        }
      }
      if (o.sat >= 0) {
        const t = o.a0 + o.span * o.sat;
        const [x, y] = polar(o.rad, t);
        p.ctx.save();
        p.ctx.translate(x, y);
        p.ctx.rotate(t + Math.PI / 2);
        if (o.satE) {
          disc(p, o.satS * 0.9);
          drawEmblem(p, K, o.satE, o.satS);
        } else miniCircle(p, o.satS, lr, K.g, K.sigils[i % K.sigils.length], 0);
        p.ctx.restore();
      }
      p.ctx.restore();
    });
  };
  const inner = orbs.filter((_, i) => i < Math.ceil(n / 2));
  const outer = orbs.filter((_, i) => i >= Math.ceil(n / 2));
  const s1 = r.range(0.03, 0.1) * r.sign();
  K.add('orbIn', maxRad * 0.8 + 0.12, 0.85, drawOrbs(inner), { at: c, spin: s1 });
  if (outer.length) K.add('orbOut', maxRad + 0.12, 0.8, drawOrbs(outer), { at: c, spin: -s1 * r.range(0.5, 1.2) });
  if (trail) {
    K.add('orbTrail', trail.rad + 0.06, 0.8, (p) => {
      p.ink('c');
      for (let i = 0; i < trail.n; i++) {
        const [x, y] = polar(trail.rad, trail.a0 + i * 0.13);
        dot(p, x, y, 0.022 * Math.pow(0.78, i), 1);
      }
    }, { at: c, spin: s1 * 1.6 });
  }
  addSeal(K, r, 'orbHeart', c, R, K.words[0], r.pick(['ringed', 'rays', 'mini', 'broken'] as const), 1);
  // a small counterweight on the other side, tied to the heart by a thin line
  if (r.chance(0.55)) {
    const w = polar(r.range(0.7, 0.95), ang + Math.PI + r.range(-0.5, 0.5));
    const ws = r.range(0.07, 0.13);
    const kind: LinkKind = r.pick(['line', 'dash', 'nodes', 'beads'] as const);
    const ls = seedOf(r);
    K.add('orbTie', 1.3, 0.75, (p) => linkBetween(p, c, R + 0.02, w, ws, kind, 0.12, makeRng(ls), K.words[2], 0.8));
    addEmblem(K, r, 'orbWeight', w, ws, ANY);
  }
}

/** Circles strung along a diagonal or an arc, partly overlapping. */
function chain(r: Rng, K: Kit) {
  const n = r.int(3, 6);
  const pattern = r.pick(['grow', 'mid', 'even', 'random', 'alt'] as const);
  const sizes = Array.from({ length: n }, (_, i) => {
    const t = n > 1 ? i / (n - 1) : 0;
    if (pattern === 'grow') return 0.13 + t * 0.22;
    if (pattern === 'mid') return 0.14 + Math.sin(t * Math.PI) * 0.2;
    if (pattern === 'even') return 0.22;
    if (pattern === 'alt') return i % 2 ? 0.15 : 0.27;
    return r.range(0.12, 0.34);
  });
  const overlap = r.range(0.62, 0.95);
  const gaps = sizes.slice(1).map((s, i) => (s + sizes[i]) * overlap);
  let total = gaps.reduce((a, b) => a + b, 0);
  const span = total + sizes[0] + sizes[n - 1];
  const k = Math.max(0.6, Math.min(1.5, 2.2 / span));
  sizes.forEach((s, i) => (sizes[i] = Math.min(0.42, s * k)));
  gaps.forEach((g, i) => (gaps[i] = g * k));
  total *= k;
  const along = [0];
  gaps.forEach((g) => along.push(along[along.length - 1] + g));
  const curved = r.chance(0.45);
  const ang = r.pick([-Math.PI / 4, Math.PI / 4, -Math.PI / 5, Math.PI / 6, 0, Math.PI / 2, -Math.PI / 3]) + r.range(-0.15, 0.15);
  const Rc = r.range(0.9, 1.5) * r.sign();
  const u: Pt = [Math.cos(ang + Math.PI / 2), Math.sin(ang + Math.PI / 2)];
  const at = (s: number): Pt => {
    const x = s - total / 2;
    if (!curved) return [Math.cos(ang) * x, Math.sin(ang) * x];
    // on a circle through the middle: centre at -Rc along the normal
    const th = x / Rc;
    return [-u[0] * Rc + (Math.cos(ang) * Math.sin(th) + u[0] * Math.cos(th)) * Rc, -u[1] * Rc + (Math.sin(ang) * Math.sin(th) + u[1] * Math.cos(th)) * Rc];
  };
  const raw = along.map(at);
  const bx = [Math.min(...raw.map((c, i) => c[0] - sizes[i])), Math.max(...raw.map((c, i) => c[0] + sizes[i]))];
  const by = [Math.min(...raw.map((c, i) => c[1] - sizes[i])), Math.max(...raw.map((c, i) => c[1] + sizes[i]))];
  const o: Pt = [(bx[0] + bx[1]) / 2, (by[0] + by[1]) / 2];
  const atC = (s: number): Pt => {
    const q = at(s);
    return [q[0] - o[0], q[1] - o[1]];
  };
  const centres = raw.map((c) => [c[0] - o[0], c[1] - o[1]] as Pt);
  const look = r.pick(['seals', 'rings', 'mixed'] as const);
  const tails = r.chance(0.7);
  const tailLen = r.range(0.15, 0.3);
  const tailCap: CapKind = r.pick(CAPS);
  const tailText = r.chance(0.5);
  const junction = r.chance(0.45);
  K.add('chainSpine', 1.35, 0.8, (p) => {
    if (tails) {
      const ends: [number, number][] = [[-sizes[0], -1], [total + sizes[n - 1], 1]];
      for (const [s0, sg] of ends) {
        const pts: Pt[] = Array.from({ length: 12 }, (_, i) => atC(s0 + sg * (0.02 + (i / 11) * tailLen)));
        if (tailText) textRail(p, pts, 0.04, K.words[sg > 0 ? 2 : 0]);
        else {
          p.ink('a');
          strokePath(p, pts, 1, 0.95);
        }
        const e = pts[pts.length - 1];
        const b = pts[pts.length - 2];
        p.ink('c');
        cap(p, tailCap, e[0], e[1], Math.atan2(e[1] - b[1], e[0] - b[0]), 0.035);
      }
    }
    if (junction) {
      // little signs on both sides of every joint
      p.ink('c');
      for (let i = 0; i < n - 1; i++) {
        const m = atC(along[i] + sizes[i] - (sizes[i] + sizes[i + 1] - gaps[i]) / 2);
        const nx = -Math.sin(ang) * 1;
        const ny = Math.cos(ang) * 1;
        const off = Math.min(sizes[i], sizes[i + 1]) * 0.95 + 0.05;
        node(p, m[0] + nx * off, m[1] + ny * off, 0.014, true);
        node(p, m[0] - nx * off, m[1] - ny * off, 0.014, true);
      }
    }
  });
  centres.forEach((c, i) => {
    const kind: SealKind = look === 'rings' ? 'ring' : look === 'seals' ? pickSeal(r, sizes[i]) : i % 2 ? 'ring' : pickSeal(r, sizes[i]);
    addSeal(K, r, `chain${i}`, c, sizes[i], K.words[i % 3], kind);
  });
}

/** No full rim: 2-5 arcs around an empty centre, with gaps, terminals and signs in the gaps. */
function broken(r: Rng, K: Kit) {
  const R = r.range(0.78, 1.0);
  const m = r.int(2, 5);
  const ph = r.range(0, TAU);
  const gap = r.range(0.14, 0.34);
  const stagger = r.chance(0.5) ? r.range(0.03, 0.07) : 0;
  const radii = Array.from({ length: m }, () => R * (1 + (stagger ? r.range(-stagger, stagger) : 0)));
  const spokes = r.chance(0.35);
  const spokeCap: CapKind = r.pick(CAPS);
  const uneven = r.chance(0.5);
  const cuts = Array.from({ length: m + 1 }, (_, i) => ph + ((i + (uneven && i > 0 && i < m ? r.range(-0.3, 0.3) : 0)) / m) * TAU);
  const h = r.range(0.06, 0.1);
  const style = r.pick(['text', 'text', 'knock', 'double', 'ticks'] as const);
  const alt = r.chance(0.4) ? r.pick(['double', 'ticks', 'dash'] as const) : style;
  const end: CapKind = r.pick(['bar', 'node', 'arrow', 'crescent', 'dot', 'diamond'] as const);
  const gapSign = r.chance(0.5) ? pickEmblem(r, ANY) : null;
  const gapS = Math.min(0.09, gap * R * 0.35);
  K.add('brokenOuter', R + h + 0.08, 0.95, (p) => {
    for (let i = 0; i < m; i++) {
      const g = Math.max(0.1, ((cuts[i + 1] - cuts[i]) * gap) / 2);
      const a0 = cuts[i] + g;
      const a1 = cuts[i + 1] - g;
      const Ri = radii[i];
      arcBand(p, Ri, h, a0, a1, i % 2 ? alt : style, K.words[i % 3]);
      p.ink('c');
      cap(p, end, ...polar(Ri, a0), a0 - Math.PI / 2, h * 0.5);
      cap(p, end, ...polar(Ri, a1), a1 + Math.PI / 2, h * 0.5);
      if (spokes) {
        // a ray passing through the gap, from inside the ring to beyond it
        const t = cuts[i + 1];
        p.ink('a');
        const [x1, y1] = polar(R * 0.45, t);
        const [x2, y2] = polar(R * 1.16, t);
        line(p, x1, y1, x2, y2, 0.9, 0.9);
        p.ink('c');
        cap(p, spokeCap, x2, y2, t, 0.03);
        dot(p, x1, y1, 0.012, 1);
      }
      if (gapSign && !spokes) {
        const t = cuts[i + 1];
        const [x, y] = polar(R, t);
        p.ctx.save();
        p.ctx.translate(x, y);
        p.ctx.rotate(t + Math.PI / 2);
        drawEmblem(p, K, gapSign, gapS);
        p.ctx.restore();
      }
    }
  }, { spin: r.range(0.02, 0.07) * K.dir });
  if (r.chance(0.65)) {
    const R2 = R * r.range(0.52, 0.72);
    const m2 = r.int(2, 6);
    const ph2 = r.range(0, TAU);
    const st2 = r.pick(['double', 'dash', 'ticks', 'text'] as const);
    const rays = r.chance(0.35);
    K.add('brokenInner', R2 + 0.08, 0.85, (p) => {
      for (let i = 0; i < m2; i++) {
        const a0 = ph2 + (i / m2) * TAU + 0.15;
        const a1 = ph2 + ((i + 1) / m2) * TAU - 0.15;
        arcBand(p, R2, 0.045, a0, a1, st2, K.words[(i + 1) % 3]);
        if (rays) {
          p.ink('a');
          const [x1, y1] = polar(R2 - 0.04, (a0 + a1) / 2);
          const [x2, y2] = polar(R2 * 0.55, (a0 + a1) / 2);
          line(p, x1, y1, x2, y2, 0.8, 0.8);
          p.ink('c');
          dot(p, x2, y2, 0.01, 1);
        }
      }
    }, { spin: -r.range(0.03, 0.09) * K.dir });
  }
  if (r.chance(0.4)) {
    const k = r.int(2, 5);
    const fr = Array.from({ length: k }, () => ({ rad: R * r.range(1.1, 1.22), a: r.range(0, TAU), l: r.range(0.2, 0.7) }));
    K.add('brokenFrag', R * 1.25 + 0.05, 0.7, (p) => {
      p.ink('c');
      for (const f of fr) {
        arc(p, f.rad, f.a, f.a + f.l, 0.8, 0.85);
        dot(p, ...polar(f.rad, f.a + f.l), 0.012, 1);
      }
    });
  }
  if (r.chance(0.3)) nested(r, K, R * r.range(0.32, 0.42));
  else if (r.chance(0.45)) addEmblem(K, r, 'brokenCore', [0, 0], r.range(0.08, 0.17), ANY);
}

/** A big sign on the left and on the right, bound together. */
function poles(r: Rng, K: Kit) {
  const axis = r.chance(0.65) ? r.range(-0.2, 0.2) : r.chance(0.5) ? Math.PI / 2 + r.range(-0.15, 0.15) : r.range(0, TAU);
  const D = r.range(0.6, 0.82);
  const A = polar(D, axis + Math.PI);
  const B = polar(D, axis);
  const sa = r.range(0.24, 0.4);
  const sb = r.chance(0.5) ? sa : r.range(0.2, 0.4);
  const conn = r.pick(['rail', 'vesica', 'beads', 'bridge', 'twist', 'wave', 'ladder'] as const);
  const mid = r.chance(0.6) ? r.range(0.07, 0.14) : 0;
  const halos = r.chance(0.5);
  const sats = r.chance(0.5) ? r.int(3, 6) : 0;
  const satE = pickEmblem(r, ANY);
  const overArcs = r.chance(0.45);
  const seed = seedOf(r);
  K.add('poleLink', 1.3, 0.85, (p) => {
    const lr = makeRng(seed);
    const w0 = K.words[1];
    if (conn === 'vesica') {
      for (const k of [0.3, -0.3]) {
        const pts = trimPath(bend(A, B, k), sa + 0.03, sb + 0.03);
        if (k > 0) textRail(p, pts, 0.04, w0);
        else {
          p.ink('a');
          strokePath(p, pts, 1, 0.95);
        }
      }
    } else if (conn === 'bridge') {
      linkBetween(p, A, sa, B, sb, 'nodes', 0, lr, w0);
      linkBetween(p, A, sa, B, sb, 'dash', 0.18, lr, w0);
      linkBetween(p, A, sa, B, sb, 'dash', -0.18, lr, w0);
    } else if (conn === 'twist') {
      const len = dist(A, B) - sa - sb - 0.06;
      const ux = (B[0] - A[0]) / dist(A, B);
      const uy = (B[1] - A[1]) / dist(A, B);
      const turns = lr.int(2, 4);
      for (const ph of [0, Math.PI]) {
        const pts: Pt[] = [];
        for (let i = 0; i <= 80; i++) {
          const t = i / 80;
          const o = Math.sin(t * turns * TAU + ph) * 0.07 * Math.sin(t * Math.PI);
          const s = sa + 0.03 + t * len;
          pts.push([A[0] + ux * s - uy * o, A[1] + uy * s + ux * o]);
        }
        p.ink(ph ? 'c' : 'a');
        strokePath(p, pts, 1, 0.95);
      }
    } else if (mid) {
      linkBetween(p, A, sa, [0, 0], mid, conn, 0, lr, K.words[0]);
      linkBetween(p, [0, 0], mid, B, sb, conn, 0, lr, K.words[2]);
    } else linkBetween(p, A, sa, B, sb, conn, 0, lr, w0);
    if (overArcs) {
      // inscriptions arching over and under the bond, from rim to rim
      const up = trimPath(bend(A, B, 0.42, 40), sa + 0.08, sb + 0.08);
      const dn = trimPath(bend(A, B, -0.42, 40), sa + 0.08, sb + 0.08);
      if (up.length > 1) textRail(p, up, 0.035, K.words[0], 0.9);
      p.ink('a');
      if (dn.length > 1) link(p, dn, 'dash', lr, [], 0.8);
    }
    if (sats) {
      for (const [c, s, a] of [[A, sa, axis + Math.PI], [B, sb, axis]] as const) {
        for (let i = 0; i < sats; i++) {
          const t = a + (i - (sats - 1) / 2) * 0.42;
          const [x, y] = polar(s * 1.55, t);
          p.ctx.save();
          p.ctx.translate(c[0] + x, c[1] + y);
          if (i % 2) {
            p.ink('c');
            dot(p, 0, 0, 0.012, 1);
          } else drawEmblem(p, K, satE, 0.035);
          p.ctx.restore();
        }
      }
    }
    if (halos) {
      p.ink('a');
      for (const [c, s, a] of [[A, sa, axis + Math.PI], [B, sb, axis]] as const) {
        p.ctx.save();
        p.ctx.translate(c[0], c[1]);
        arc(p, s * 1.25, a - 1.4, a + 1.4, 0.9, 0.9);
        arc(p, s * 1.4, a - 0.9, a + 0.9, 0.6, 0.7);
        p.ink('c');
        cap(p, 'dot', ...polar(s * 1.25, a - 1.4), a - 1.4 - Math.PI / 2, 0.03);
        cap(p, 'dot', ...polar(s * 1.25, a + 1.4), a + 1.4 + Math.PI / 2, 0.03);
        p.ink('a');
        p.ctx.restore();
      }
    }
  });
  // contrasting poles: a seal and a sign, a sun and a moon, two different ornate signs...
  const pair = r.pick(['seal+sign', 'seal+seal', 'sign+sign', 'sun+moon'] as const);
  if (pair === 'sun+moon') {
    addEmblem(K, r, 'poleA', A, sa, ROUND, 1, { kind: 'sun', seed: seedOf(r) });
    addEmblem(K, r, 'poleB', B, sb, UPRIGHT, 1, { kind: 'moonStar', seed: seedOf(r) });
  } else {
    const [a, b] = pair.split('+');
    if (a === 'seal') addSeal(K, r, 'poleA', A, sa, K.words[0]);
    else addEmblem(K, r, 'poleA', A, sa, UPRIGHT);
    if (b === 'seal') addSeal(K, r, 'poleB', B, sb, K.words[2]);
    else addEmblem(K, r, 'poleB', B, sb, UPRIGHT);
  }
  if (mid && conn !== 'twist') addEmblem(K, r, 'poleMid', [0, 0], mid, ANY);
}

/** No circle at all: a sign on top, a shaft with stations, another sign at the bottom. */
function totem(r: Rng, K: Kit) {
  const top = -r.range(0.9, 1.08);
  const bottom = r.range(0.88, 1.08);
  const topS = r.range(0.16, 0.26);
  const botS = r.range(0.11, 0.2);
  const y0 = top + topS + 0.03;
  const y1 = bottom - botS - 0.03;
  const shaft = r.pick(['single', 'double', 'text', 'text', 'ladder'] as const);
  type Station = { kind: 'diamond' | 'crossbar' | 'branches' | 'ring' | 'cup' | 'wings' | 'eye' | 'nodes' | 'hourglass'; y: number; w: number; e: Emblem };
  const count = r.int(2, 4);
  const stations: Station[] = Array.from({ length: count }, (_, i) => ({
    kind: r.pick(['diamond', 'crossbar', 'crossbar', 'branches', 'branches', 'ring', 'ring', 'cup', 'wings', 'eye', 'nodes', 'hourglass'] as const),
    y: y0 + ((i + 0.5 + r.range(-0.2, 0.2)) / count) * (y1 - y0),
    w: r.range(0.14, 0.4),
    e: pickEmblem(r, ANY),
  }));
  const barCap: CapKind = r.pick(CAPS);
  const base = r.pick(['emblem', 'emblem', 'roots', 'steps'] as const);
  const sides = r.pick(['none', 'none', 'parens', 'satellites'] as const);
  const sideE = pickEmblem(r, ANY);
  K.add('totem', 1.25, 0.95, (p) => {
    const { ctx } = p;
    // the shaft (letters run down it)
    const pts: Pt[] = [[0, y0], [0, y1]];
    if (shaft === 'single') {
      p.ink('a');
      line(p, 0, y0, 0, y1, 1.4, 1);
    } else if (shaft === 'double') {
      p.ink('a');
      line(p, -0.018, y0, -0.018, y1, 0.9, 1);
      line(p, 0.018, y0, 0.018, y1, 0.9, 1);
    } else if (shaft === 'text') textRail(p, pts, 0.045, K.words[0]);
    else link(p, pts, 'ladder', makeRng(1), K.words[0]);
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
          strokePoly(p, [[0, y - w * 0.8], [w * 0.5, y], [0, y + w * 0.8], [-w * 0.5, y]], 1.2, 1);
          strokePoly(p, [[0, y - w * 0.6], [w * 0.36, y], [0, y + w * 0.6], [-w * 0.36, y]], 0.6, 0.8);
          line(p, -w * 0.9, y, -w * 0.5, y, 0.9, 0.9);
          line(p, w * 0.5, y, w * 0.9, y, 0.9, 0.9);
          p.ink('c');
          dot(p, -w * 0.9, y, 0.012, 1);
          dot(p, w * 0.9, y, 0.012, 1);
          ctx.save();
          ctx.translate(0, y);
          drawEmblem(p, K, { kind: 'letter', seed: s.e.seed }, w * 0.22);
          ctx.restore();
          break;
        case 'crossbar':
          p.ink('a');
          line(p, -w, y, w, y, 1.2, 1);
          if (w > 0.22) line(p, -w * 0.6, y + 0.05, w * 0.6, y + 0.05, 0.8, 0.9);
          p.ink('c');
          cap(p, barCap, -w, y, Math.PI, 0.03);
          cap(p, barCap, w, y, 0, 0.03);
          break;
        case 'branches':
          p.ink('a');
          for (const sx of [-1, 1]) {
            const b = quadPts([0, y + w * 0.3], [sx * w * 0.9, y + w * 0.25], [sx * w, y - w * 0.6], 20);
            strokePath(p, b, 1, 1);
            p.ink('c');
            cap(p, barCap, sx * w, y - w * 0.6, -Math.PI / 2, 0.028);
            p.ink('a');
          }
          break;
        case 'cup':
          p.ink('c');
          crescent(p, 0, y, w * 0.5, -Math.PI / 2, 0.45);
          break;
        case 'wings':
          p.ink('a');
          for (const sx of [-1, 1]) {
            for (let k = 0; k < 3; k++) {
              const l = w * (1 - k * 0.22);
              strokePath(p, quadPts([sx * 0.02, y + k * 0.03], [sx * l * 0.6, y - l * 0.35 + k * 0.03], [sx * l, y + l * 0.1 + k * 0.05], 16), 1 - k * 0.2, 1 - k * 0.15);
            }
          }
          break;
        case 'eye':
          ctx.save();
          ctx.translate(0, y);
          drawEmblem(p, K, { kind: 'eye', seed: s.e.seed }, w * 0.6);
          ctx.restore();
          break;
        case 'nodes':
          p.ink('c');
          for (const x of [-w * 0.7, 0, w * 0.7]) node(p, x, y, 0.022, x === 0);
          p.ink('a');
          line(p, -w * 0.7 + 0.022, y, -0.022, y, 0.8, 0.9);
          line(p, 0.022, y, w * 0.7 - 0.022, y, 0.8, 0.9);
          break;
        case 'hourglass':
          ctx.save();
          ctx.translate(0, y);
          drawEmblem(p, K, { kind: 'hourglass', seed: s.e.seed }, w * 0.45);
          ctx.restore();
          break;
        case 'ring':
          break; // its own spinning layer
      }
    }
    if (base === 'roots') {
      p.ink('a');
      const n = 3 + (stations.length % 3);
      for (let i = 0; i < n; i++) {
        const t = (i / (n - 1) - 0.5) * 2;
        strokePath(p, quadPts([0, y1], [t * 0.1, y1 + 0.12], [t * 0.32, bottom + 0.02], 16), 1, 0.95);
        p.ink('c');
        dot(p, t * 0.32, bottom + 0.02, 0.012, 1);
        p.ink('a');
      }
    } else if (base === 'steps') {
      p.ink('a');
      for (let k = 0; k < 3; k++) line(p, -0.08 - k * 0.08, y1 + 0.04 + k * 0.05, 0.08 + k * 0.08, y1 + 0.04 + k * 0.05, 1.2 - k * 0.2, 1);
    }
    if (sides === 'parens') {
      p.ink('a');
      for (const sx of [-1, 1]) {
        const pts2 = quadPts([sx * 0.42, y0 + 0.1], [sx * 0.72, (y0 + y1) / 2], [sx * 0.42, y1 - 0.1], 30);
        strokePath(p, pts2, 1, 0.9);
        p.ink('c');
        dot(p, sx * 0.42, y0 + 0.1, 0.014, 1);
        dot(p, sx * 0.42, y1 - 0.1, 0.014, 1);
        p.ink('a');
      }
    } else if (sides === 'satellites') {
      for (const sx of [-1, 1]) {
        ctx.save();
        ctx.translate(sx * 0.55, (y0 + y1) / 2);
        drawEmblem(p, K, sideE, 0.09);
        ctx.restore();
      }
    }
  });
  addEmblem(K, r, 'totemTop', [0, top + topS * 0.2], topS, UPRIGHT);
  if (base === 'emblem') addEmblem(K, r, 'totemBase', [0, bottom - botS * 0.2], botS, UPRIGHT);
  stations.forEach((s, i) => {
    if (s.kind === 'ring') addSeal(K, r, `totemRing${i}`, [0, s.y], s.w * 0.5, K.words[i % 3]);
  });
}

/** A central node and 3-8 long directions, with no ring holding them. */
function cross(r: Rng, K: Kit) {
  const n = r.pick([3, 4, 4, 5, 6, 6, 8]);
  const ph = r.chance(0.6) ? -Math.PI / 2 : r.range(0, TAU);
  const jit = r.chance(0.3) ? r.range(0.05, 0.25) : 0;
  const pattern = r.pick(['even', 'alt', 'sword', 'random'] as const);
  const rays = Array.from({ length: n }, (_, i) => {
    const len = pattern === 'even' ? 1.05 : pattern === 'alt' ? (i % 2 ? 0.7 : 1.15) : pattern === 'sword' ? (i === 0 ? 1.2 : i === Math.floor(n / 2) ? 0.95 : 0.75) : r.range(0.65, 1.2);
    return { a: ph + (i / n) * TAU + (jit ? r.range(-jit, jit) : 0), len: len * r.range(0.95, 1.05) };
  });
  const coreR = r.range(0.13, 0.24);
  const style: LinkKind = r.pick(['rail', 'rail', 'ladder', 'beads', 'nodes', 'line']);
  const endKind = r.pick(['cap', 'cap', 'seal', 'emblem'] as const);
  const endCap: CapKind = r.pick(CAPS);
  const altCap: CapKind = r.chance(0.4) ? r.pick(CAPS) : endCap;
  const endS = r.range(0.06, 0.12);
  const bars = r.chance(0.5);
  const arcs = r.chance(0.4);
  const petals = r.chance(0.3) ? pickEmblem(r, ANY) : null;
  const minor = r.chance(0.4);
  const seed = seedOf(r);
  const reach = Math.max(...rays.map((q) => q.len)) + 0.1;
  K.add('crossRays', reach, 0.95, (p) => {
    const lr = makeRng(seed);
    rays.forEach((q, i) => {
      const stop = endKind === 'cap' ? 0.02 : endS + 0.02;
      const pts: Pt[] = [polar(coreR + 0.04, q.a), polar(q.len - stop, q.a)];
      link(p, pts, style, lr, K.words[i % 3]);
      if (endKind === 'cap') {
        p.ink('c');
        cap(p, i % 2 ? altCap : endCap, ...polar(q.len, q.a), q.a, 0.04);
      }
      if (bars) {
        p.ink('a');
        const t = coreR + (q.len - coreR) * 0.62;
        const [cx, cy] = polar(t, q.a);
        const w = 0.07;
        const nx = -Math.sin(q.a) * w;
        const ny = Math.cos(q.a) * w;
        line(p, cx - nx, cy - ny, cx + nx, cy + ny, 1, 1);
        p.ink('c');
        dot(p, cx - nx, cy - ny, 0.01, 1);
        dot(p, cx + nx, cy + ny, 0.01, 1);
      }
    });
    if (arcs) {
      p.ink('a');
      const rad = lr.range(0.42, 0.62);
      rays.forEach((q, i) => {
        const nx = rays[(i + 1) % n].a + (i === n - 1 ? TAU : 0);
        arc(p, rad, q.a + 0.12, nx - 0.12, 0.8, 0.8);
      });
    }
    if (minor) {
      p.ink('a');
      rays.forEach((q, i) => {
        const nx = rays[(i + 1) % n].a + (i === n - 1 ? TAU : 0);
        const a = (q.a + nx) / 2;
        const [x1, y1] = polar(coreR + 0.06, a);
        const [x2, y2] = polar(q.len * 0.45, a);
        line(p, x1, y1, x2, y2, 0.6, 0.7);
        p.ink('c');
        dot(p, x2, y2, 0.01, 1);
        p.ink('a');
      });
    }
    if (petals) {
      rays.forEach((q, i) => {
        const nx = rays[(i + 1) % n].a + (i === n - 1 ? TAU : 0);
        const a = (q.a + nx) / 2;
        const [x, y] = polar(0.5, a);
        p.ctx.save();
        p.ctx.translate(x, y);
        p.ctx.rotate(a + Math.PI / 2);
        drawEmblem(p, K, petals, 0.06);
        p.ctx.restore();
      });
    }
  }, { spin: endKind === 'cap' && r.chance(0.4) ? r.range(0.015, 0.05) * K.dir : 0 });
  addSeal(K, r, 'crossCore', [0, 0], coreR, K.words[0]);
  if (endKind !== 'cap') {
    const e = pickEmblem(r, ANY);
    rays.forEach((q, i) => {
      const at = polar(q.len - endS * 0.5, q.a);
      if (endKind === 'seal') addSeal(K, r, `crossEnd${i}`, at, endS, K.words[i % 3], r.pick(['mini', 'ring'] as const), 0.9);
      else addEmblem(K, r, `crossEnd${i}`, at, endS, ANY, 0.9, e);
    });
  }
}

/** One big trunk with branches, nodes and hugging arcs: no symmetry at all. */
function trunk(r: Rng, K: Kit) {
  const a0 = r.range(0, TAU);
  const P0raw = polar(r.range(1.0, 1.15), a0);
  const P2raw = polar(r.range(0.9, 1.08), a0 + Math.PI + r.range(-0.5, 0.5));
  const P1 = polar(r.range(0.25, 0.55), a0 + (Math.PI / 2) * r.sign());
  const ctrl: Pt = [2 * P1[0] - (P0raw[0] + P2raw[0]) / 2, 2 * P1[1] - (P0raw[1] + P2raw[1]) / 2];
  const crownS = r.range(0.14, 0.24);
  let trunkPts = quadPts(P0raw, ctrl, P2raw, 70);
  let tlen = 0;
  for (let i = 1; i < trunkPts.length; i++) tlen += dist(trunkPts[i], trunkPts[i - 1]);
  const style = r.pick(['text', 'text', 'ladder', 'double', 'triple'] as const);
  const side = r.sign();
  type Branch = { pts: Pt[]; end: CapKind | 'fruit' | 'node'; sub: Pt[][]; w: number; text: boolean };
  const branches: Branch[] = [];
  const nb = r.int(5, 9);
  for (let i = 0; i < nb; i++) {
    const t = 0.12 + ((i + r.range(0, 0.8)) / nb) * 0.75;
    const at = pathAt(trunkPts, t * tlen);
    const sg = r.chance(0.72) ? side : -side;
    const ang = at.ang + sg * r.range(0.45, 1.2);
    const len = r.range(0.28, 0.62) * (1 - t * 0.35);
    const start: Pt = [at.x, at.y];
    const pts = bend(start, add2(start, polar(len, ang)), r.range(-0.22, 0.22), 24);
    const sub: Pt[][] = [];
    const subs = r.chance(0.65) ? r.int(1, 2) : 0;
    for (let k = 0; k < subs; k++) {
      const m = pathAt(pts, len * r.range(0.35, 0.7));
      const sa = m.ang + (k % 2 ? -1 : 1) * sg * r.range(0.5, 1);
      sub.push(bend([m.x, m.y], add2([m.x, m.y], polar(len * r.range(0.25, 0.45), sa)), r.range(-0.25, 0.25), 12));
    }
    branches.push({ pts, end: r.chance(0.28) ? 'fruit' : r.chance(0.3) ? 'node' : r.pick(CAPS), sub, w: 1 - t * 0.4, text: false });
  }
  // the longest branch sometimes carries words too
  if (r.chance(0.45)) {
    let best = branches[0];
    for (const b of branches) if (dist(b.pts[0], b.pts[b.pts.length - 1]) > dist(best.pts[0], best.pts[best.pts.length - 1])) best = b;
    best.text = true;
  }
  const hugs = Array.from({ length: r.int(1, 3) }, () => {
    const at = pathAt(trunkPts, r.range(0.2, 0.8) * tlen);
    return { c: [at.x, at.y] as Pt, rad: r.range(0.16, 0.36), a: at.ang + (r.sign() * Math.PI) / 2, span: r.range(1.1, 2.4), text: r.chance(0.35) };
  });
  const shadow = r.chance(0.4) ? r.range(0.08, 0.14) * -side : 0;
  // centre the whole figure
  const all: Pt[] = [...trunkPts, ...branches.flatMap((b) => [...b.pts, ...b.sub.flat()])];
  const cx = (Math.min(...all.map((q) => q[0])) + Math.max(...all.map((q) => q[0]))) / 2;
  const cy = (Math.min(...all.map((q) => q[1])) + Math.max(...all.map((q) => q[1]))) / 2;
  const mv = (q: Pt): Pt => [q[0] - cx, q[1] - cy];
  trunkPts = trunkPts.map(mv);
  for (const b of branches) {
    b.pts = b.pts.map(mv);
    b.sub = b.sub.map((q) => q.map(mv));
  }
  for (const h of hugs) h.c = mv(h.c);
  const P2 = mv(P2raw);
  const body = trimPath(trunkPts, 0.02, crownS + 0.03);
  const rootCap: CapKind = r.pick(CAPS);
  K.add('trunk', 1.4, 0.95, (p) => {
    if (style === 'text') textRail(p, body, 0.055, K.words[0]);
    else if (style === 'ladder') link(p, body, 'ladder', makeRng(3), K.words[0], 1.4);
    else {
      p.ink('a');
      strokePath(p, offsetPath(body, 0.022), 1.3, 1);
      strokePath(p, offsetPath(body, -0.022), 1.3, 1);
      if (style === 'triple') strokePath(p, body, 0.6, 0.7);
    }
    if (shadow) link(p, offsetPath(trimPath(body, 0.25, 0.25), shadow), 'dash', makeRng(4), [], 0.9);
    p.ink('c');
    const b0 = body[0];
    const b1 = body[1];
    cap(p, rootCap, b0[0], b0[1], Math.atan2(b0[1] - b1[1], b0[0] - b1[0]), 0.05);
    for (const b of branches) {
      if (b.text) textRail(p, trimPath(b.pts, 0.03, 0.02), 0.035, K.words[1]);
      else {
        p.ink('a');
        strokePath(p, b.pts, 1.2 * b.w, 1);
      }
      p.ink('c');
      const e = b.pts[b.pts.length - 1];
      const e0 = b.pts[b.pts.length - 2];
      if (b.end === 'node') node(p, e[0], e[1], 0.024, true);
      else if (b.end !== 'fruit') cap(p, b.end, e[0], e[1], Math.atan2(e[1] - e0[1], e[0] - e0[0]), 0.034);
      for (const sb of b.sub) {
        p.ink('a');
        strokePath(p, sb, 0.8, 0.9);
        p.ink('c');
        const se = sb[sb.length - 1];
        dot(p, se[0], se[1], 0.012, 1);
      }
      p.ink('c');
      node(p, b.pts[0][0], b.pts[0][1], 0.018);
    }
    for (const h of hugs) {
      p.ctx.save();
      p.ctx.translate(h.c[0], h.c[1]);
      if (h.text) arcBand(p, h.rad, 0.04, h.a - h.span / 2, h.a + h.span / 2, 'text', K.words[2]);
      else {
        p.ink('a');
        arc(p, h.rad, h.a - h.span / 2, h.a + h.span / 2, 0.9, 0.85);
      }
      p.ink('c');
      dot(p, ...polar(h.rad, h.a + h.span / 2), 0.013, 1);
      dot(p, ...polar(h.rad, h.a - h.span / 2), 0.009, 1);
      p.ctx.restore();
    }
  });
  addPiece(K, r, 'trunkCrown', P2, crownS, K.words[0], 0.4, r.chance(0.5) ? UPRIGHT : ROUND);
  branches.forEach((b, i) => {
    if (b.end !== 'fruit') return;
    const e = b.pts[b.pts.length - 1];
    addSeal(K, r, `fruit${i}`, e, r.range(0.07, 0.13), K.words[i % 3], r.pick(['mini', 'ring', 'mini'] as const), 0.9);
  });
}

/** Broken lines, brackets and corners around an empty place. */
function frame(r: Rng, K: Kit) {
  const n = r.pick([3, 4, 4, 4, 5, 6, 6, 8]);
  const R = r.range(0.85, 1.05);
  const rot = n === 4 ? (r.chance(0.5) ? -Math.PI / 4 : -Math.PI / 2) : -Math.PI / 2 + (r.chance(0.3) ? Math.PI / n : 0);
  const pts = polygonPts(n, R, rot);
  const mode = r.pick(['brackets', 'gapped', 'mixed'] as const);
  const f = r.range(0.18, 0.38);
  const gapF = r.range(0.2, 0.45);
  const dbl = r.chance(0.78);
  const off = r.range(0.035, 0.06);
  const corner = r.pick(['node', 'diamond', 'square', 'star', 'none'] as const);
  const mids = r.pick(['tick', 'emblem', 'none'] as const);
  const midE = pickEmblem(r, ANY);
  const textEdges = r.chance(0.75);
  K.add('frameOuter', R + 0.12, 0.95, (p) => {
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const L = dist(a, b);
      const ux = (b[0] - a[0]) / L;
      const uy = (b[1] - a[1]) / L;
      const at = (t: number): Pt => [a[0] + ux * t * L, a[1] + uy * t * L];
      // inward normal
      const cx = (a[0] + b[0]) / 2;
      const cy = (a[1] + b[1]) / 2;
      const cl = Math.hypot(cx, cy) || 1;
      const nx = -cx / cl;
      const ny = -cy / cl;
      const edgeMode = mode === 'mixed' ? (i % 2 ? 'brackets' : 'gapped') : mode;
      const segs: [number, number][] = edgeMode === 'brackets' ? [[0, f], [1 - f, 1]] : [[0, 0.5 - gapF / 2], [0.5 + gapF / 2, 1]];
      for (const [t0, t1] of segs) {
        const p0 = at(t0);
        const p1 = at(t1);
        p.ink('a');
        line(p, p0[0], p0[1], p1[0], p1[1], 1.5, 1);
        if (dbl) {
          const q0: Pt = [p0[0] + nx * off, p0[1] + ny * off];
          const q1: Pt = [p1[0] + nx * off, p1[1] + ny * off];
          line(p, q0[0], q0[1], q1[0], q1[1], 0.8, 0.9);
          if (textEdges && edgeMode === 'gapped') {
            p.ink('b');
            glyphPath(p, [[(p0[0] + q0[0]) / 2, (p0[1] + q0[1]) / 2], [(p1[0] + q1[0]) / 2, (p1[1] + q1[1]) / 2]], off * 0.8, K.words[i % 3]);
          }
        }
        // the open ends of a broken edge
        p.ink('c');
        if (t0 > 0) dot(p, p0[0], p0[1], 0.012, 1);
        if (t1 < 1) dot(p, p1[0], p1[1], 0.012, 1);
      }
      const m = at(0.5);
      if (mids === 'tick') {
        p.ink('a');
        line(p, m[0] + nx * 0.02, m[1] + ny * 0.02, m[0] + nx * 0.14, m[1] + ny * 0.14, 1, 0.9);
        p.ink('c');
        dot(p, m[0] + nx * 0.15, m[1] + ny * 0.15, 0.014, 1);
      } else if (mids === 'emblem' && edgeMode === 'gapped') {
        p.ctx.save();
        p.ctx.translate(m[0], m[1]);
        p.ctx.rotate(Math.atan2(-ny, -nx) + Math.PI / 2);
        drawEmblem(p, K, midE, Math.min(0.08, (gapF * L) / 3));
        p.ctx.restore();
      }
    }
    pts.forEach(([x, y]) => {
      p.ink('c');
      if (corner === 'node') node(p, x, y, 0.028, true);
      else if (corner === 'diamond') cap(p, 'diamond', x, y, Math.atan2(y, x), 0.035);
      else if (corner === 'square') {
        p.ctx.save();
        p.ctx.translate(x, y);
        p.ctx.rotate(Math.atan2(y, x) + Math.PI / 4);
        disc(p, 0);
        strokePoly(p, [[-0.03, -0.03], [0.03, -0.03], [0.03, 0.03], [-0.03, 0.03]], 1.1, 1);
        p.ctx.restore();
      } else if (corner === 'star') cap(p, 'star', x, y, Math.atan2(y, x), 0.035);
    });
  });
  if (r.chance(0.7)) {
    const n2 = r.pick([n, n, 3, 4, 6]);
    const R2 = R * r.range(0.45, 0.68);
    const rot2 = rot + Math.PI / n2;
    const pts2 = polygonPts(n2, R2, rot2);
    const f2 = r.range(0.2, 0.4);
    const inner = r.pick(['corners', 'dashed', 'text'] as const);
    K.add('frameInner', R2 + 0.06, 0.85, (p) => {
      for (let i = 0; i < n2; i++) {
        const a = pts2[i];
        const b = pts2[(i + 1) % n2];
        if (inner === 'dashed') link(p, [a, b], 'dash', makeRng(i), []);
        else if (inner === 'text') {
          textRail(p, trimPath([a, b], 0.04, 0.04), 0.04, K.words[(i + 1) % 3]);
        } else {
          p.ink('a');
          line(p, a[0], a[1], a[0] + (b[0] - a[0]) * f2, a[1] + (b[1] - a[1]) * f2, 1.1, 1);
          line(p, b[0], b[1], b[0] + (a[0] - b[0]) * f2, b[1] + (a[1] - b[1]) * f2, 1.1, 1);
        }
      }
    }, { spin: r.chance(0.5) ? r.range(0.02, 0.07) * K.dir : 0 });
  }
  if (r.chance(0.3)) nested(r, K, R * r.range(0.3, 0.4));
  else if (r.chance(0.5)) addEmblem(K, r, 'frameCore', [0, 0], r.range(0.1, 0.22), ANY);
}

/** Several independent signs tied together by thin lines, with star dust around. */
function constellation(r: Rng, K: Kit) {
  const m = r.int(4, 7);
  const pos: Pt[] = [];
  for (let tries = 0; pos.length < m && tries < 600; tries++) {
    const c = polar(Math.sqrt(r()) * 1.0, r.range(0, TAU));
    if (pos.every((q) => dist(q, c) > 0.42)) pos.push(c);
  }
  const big = r.int(0, pos.length - 1);
  const sizes = pos.map((_, i) => (i === big ? r.range(0.19, 0.27) : r.range(0.08, 0.16)));
  // minimum spanning tree + a couple of extra links
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
  const extra = r.int(0, 2);
  for (let e = 0; e < extra; e++) {
    const i = r.int(0, pos.length - 1);
    const j = r.int(0, pos.length - 1);
    if (i !== j && !edges.some(([a, b]) => (a === i && b === j) || (a === j && b === i))) edges.push([i, j]);
  }
  const style: LinkKind = r.pick(['line', 'line', 'dash', 'nodes'] as const);
  const labelled = r.int(0, 2);
  const seed = seedOf(r);
  K.add('constLinks', 1.3, 0.8, (p) => {
    const lr = makeRng(seed);
    edges.forEach(([i, j], e) => {
      if (e < labelled) {
        const pts = trimPath([pos[i], pos[j]], sizes[i] + 0.05, sizes[j] + 0.05);
        if (pts.length > 1) textRail(p, pts, 0.035, K.words[e % 3], 0.9);
      } else linkBetween(p, pos[i], sizes[i], pos[j], sizes[j], style, 0, lr, K.words[e % 3], 0.7);
    });
    dust(p, lr, lr.int(14, 36), 1.25, pos.map((c, i) => ({ c, r: sizes[i] + 0.04 })));
  });
  pos.forEach((c, i) => addPiece(K, r, `star${i}`, c, sizes[i], K.words[i % 3], i === big ? 0.6 : 0.3));
}

/** Pieces winding in towards the middle; no circle anywhere. */
function spiral(r: Rng, K: Kit) {
  const arms = r.pick([1, 1, 2, 3]);
  const turns = r.range(1.1, 2.3) / (arms > 1 ? 1.6 : 1);
  const r0 = r.range(0.1, 0.2);
  const r1 = r.range(0.95, 1.12);
  const k = r.range(0.8, 1.3);
  const ph = r.range(0, TAU);
  const kind = r.pick(['text', 'text', 'beads', 'emblems', 'double'] as const);
  const endCap: CapKind = r.pick(CAPS);
  const e = pickEmblem(r, ANY);
  const d = K.dir;
  const armPts = (a: number, rad = (t: number) => r1 + (r0 - r1) * Math.pow(t, k)): Pt[] =>
    Array.from({ length: 160 }, (_, i) => {
      const t = i / 159;
      return polar(rad(t), ph + (a / arms) * TAU + d * t * turns * TAU);
    });
  const seed = seedOf(r);
  K.add('spiral', r1 + 0.1, 0.95, (p) => {
    const lr = makeRng(seed);
    for (let a = 0; a < arms; a++) {
      const pts = armPts(a);
      const w = K.words[a % 3];
      if (kind === 'text') {
        const h = (t: number) => 0.06 * (1 - 0.6 * t);
        p.ink('a');
        strokePath(p, armPts(a, (t) => r1 + (r0 - r1) * Math.pow(t, k) + h(t) * 0.62), 0.8, 0.9);
        strokePath(p, armPts(a, (t) => r1 + (r0 - r1) * Math.pow(t, k) - h(t) * 0.62), 0.8, 0.9);
        p.ink('b');
        glyphPath(p, pts, 0.06, w, 1, 0.4);
      } else if (kind === 'beads') {
        p.ink('a');
        strokePath(p, pts, 0.6, 0.7);
        const n = lr.int(9, 16);
        for (let i = 0; i < n; i++) {
          const t = i / n;
          const at = pts[Math.round(t * 159)];
          const q = 0.045 * (1 - 0.7 * t);
          p.ctx.save();
          p.ctx.translate(at[0], at[1]);
          disc(p, q);
          p.ink('c');
          circle(p, q, 0.9, 1);
          p.ink('b');
          p.ctx.globalAlpha = 1;
          const seq = w.filter((x) => x >= 0);
          drawGlyph(p.ctx, seq.length ? seq[i % seq.length] : i, q * 1.2);
          p.ctx.restore();
        }
      } else if (kind === 'emblems') {
        p.ink('a');
        strokePath(p, pts, 1, 0.95);
        for (let i = 1; i < 6; i++) {
          const t = i / 6;
          const at = pts[Math.round(t * 159)];
          p.ctx.save();
          p.ctx.translate(at[0], at[1]);
          disc(p, 0.07 * (1 - 0.6 * t));
          drawEmblem(p, K, { kind: e.kind, seed: e.seed + i }, 0.065 * (1 - 0.6 * t));
          p.ctx.restore();
        }
      } else {
        p.ink('a');
        strokePath(p, pts, 1.4, 1);
        strokePath(p, armPts(a, (t) => r1 + (r0 - r1) * Math.pow(t, k) - 0.03 * (1 - t)), 0.6, 0.8);
      }
      p.ink('c');
      const b0 = pts[0];
      const b1 = pts[2];
      cap(p, endCap, b0[0], b0[1], Math.atan2(b0[1] - b1[1], b0[0] - b1[0]), 0.04);
    }
  }, { spin: r.range(0.03, 0.09) * d });
  if (r.chance(0.5)) {
    // a faint counter-spiral behind
    const t2 = turns * r.range(0.5, 0.9);
    K.add('spiralGhost', r1 + 0.05, 0.45, (p) => {
      p.ink('a');
      const pts = Array.from({ length: 120 }, (_, i) => {
        const t = i / 119;
        return polar(r1 * 0.95 + (r0 - r1) * t, ph + Math.PI - d * t * t2 * TAU);
      });
      strokePath(p, pts, 0.6, 0.6);
    }, { spin: -r.range(0.02, 0.05) * d });
  }
  if (r.chance(0.6)) {
    const c = r.chance(0.35) ? { kind: 'spiral' as const, seed: seedOf(r) } : pickEmblem(r, ANY);
    addEmblem(K, r, 'spiralCore', [0, 0], Math.max(0.08, r0 * 0.8), ANY, 1, c);
  }
}

/** The composition fills only the upper (or the lower) half: an arch on a base line. */
function arch(r: Rng, K: Kit) {
  const up = r.chance(0.7);
  const R = r.range(0.85, 1.08);
  const yb = (up ? 1 : -1) * R * r.range(0.35, 0.48);
  const a0 = up ? Math.PI : 0;
  const a1 = up ? TAU : Math.PI;
  const bands = r.int(2, 4);
  type Band = { rad: number; h: number; style: 'text' | 'knock' | 'double' | 'ticks' | 'dash' };
  const list: Band[] = [];
  let rad = R;
  for (let i = 0; i < bands && rad > R * 0.45; i++) {
    const h = r.range(0.05, 0.09);
    list.push({ rad: rad - h / 2, h, style: i === 0 ? r.pick(['text', 'knock', 'double'] as const) : r.pick(['text', 'double', 'ticks', 'dash'] as const) });
    rad -= h + r.range(0.04, 0.12);
  }
  const inner = r.pick(['rays', 'arcade', 'none', 'rays'] as const);
  const rays = r.int(7, 15);
  const steps = r.int(1, 3);
  const pillars = r.chance(0.45);
  const pCap: CapKind = r.pick(CAPS);
  K.add('arch', R + 0.2, 0.95, (p) => {
    p.ctx.save();
    p.ctx.translate(0, yb);
    list.forEach((b, i) => arcBand(p, b.rad, b.h, a0, a1, b.style, K.words[i % 3]));
    const innerR = rad + 0.02;
    if (inner === 'rays') {
      p.ink('c');
      for (let i = 1; i < rays; i++) {
        const t = a0 + ((a1 - a0) * i) / rays;
        const [x1, y1] = polar(0.12, t);
        const [x2, y2] = polar(innerR * (i % 2 ? 0.7 : 0.95), t);
        line(p, x1, y1, x2, y2, i % 2 ? 0.7 : 1, 0.9);
      }
      arc(p, 0.12, a0, a1, 1, 1);
    } else if (inner === 'arcade') {
      p.ink('a');
      const k = 3;
      const w = (innerR * 2) / k;
      for (let i = 0; i < k; i++) {
        const cx = -innerR + w * (i + 0.5);
        p.ctx.save();
        p.ctx.translate(cx, 0);
        arc(p, w * 0.42, a0, a1, 0.9, 0.9);
        p.ctx.restore();
      }
    }
    // base line with steps
    p.ink('a');
    const sg = up ? 1 : -1;
    line(p, -R - 0.1, 0, R + 0.1, 0, 1.5, 1);
    for (let s = 1; s <= steps; s++) line(p, -R + s * 0.14, sg * s * 0.045, R - s * 0.14, sg * s * 0.045, 1.1 - s * 0.2, 0.9);
    p.ink('c');
    node(p, -R - 0.1, 0, 0.018, true);
    node(p, R + 0.1, 0, 0.018, true);
    if (pillars) {
      p.ink('a');
      for (const sx of [-1, 1]) {
        line(p, sx * R, 0, sx * R, sg * 0.25, 1.1, 1);
        p.ink('c');
        cap(p, pCap, sx * R, sg * 0.25, (sg * Math.PI) / 2, 0.035);
        p.ink('a');
      }
    }
    p.ctx.restore();
  });
  addEmblem(K, r, 'archKey', [0, yb - (up ? 1 : -1) * (R + 0.02)], r.range(0.1, 0.17), UPRIGHT);
  if (r.chance(0.65)) addEmblem(K, r, 'archHeart', [0, yb - (up ? 1 : -1) * rad * 0.5], Math.min(0.22, rad * 0.4), ANY);
}

/** A small sign in the middle and a big form spreading out to both sides. */
function wings(r: Rng, K: Kit) {
  const style = r.pick(['feathers', 'arcs', 'blades', 'bat'] as const);
  const span = r.range(1.0, 1.28);
  const lift = r.range(-0.5, 0.15);
  const root = r.range(0.14, 0.22);
  const n = r.int(4, 8);
  const wr = seedOf(r);
  const textEdge = r.chance(0.6);
  // geometry of the right wing; the left one is its mirror
  const bone = quadPts([root, 0], [span * 0.5, lift * 0.8 - 0.25], [span, lift], 40);
  const wingDraw = (sx: 1 | -1) => (p: Pen) => {
    const lr = makeRng(wr);
    const M = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [x * sx, y] as Pt);
    // letters must not be mirrored: on the left wing the path runs towards the middle
    const text = (pts: Pt[], h: number, w: number[]) => textRail(p, sx > 0 ? M(pts) : M(pts).reverse(), h, w);
    if (style === 'feathers') {
      if (textEdge) text(bone, 0.045, K.words[0]);
      else {
        p.ink('a');
        strokePath(p, M(bone), 1.4, 1);
      }
      for (let i = 0; i < n; i++) {
        const t = 0.15 + (i / (n - 1)) * 0.85;
        const b = pathAt(bone, t * 1.3 * span);
        const len = (0.25 + 0.4 * t) * lr.range(0.85, 1.1);
        const a = Math.PI / 2 - 0.3 - t * 0.6;
        const tip = add2([b.x, b.y], polar(len, a));
        const ctrl: Pt = add2([b.x, b.y], polar(len * 0.5, a - 0.25));
        p.ink(i % 2 ? 'a' : 'c');
        const f = M(quadPts([b.x, b.y], ctrl, tip, 16));
        strokePath(p, f, 1 - t * 0.3, 0.95);
        strokePath(p, M(quadPts([b.x, b.y], add2([b.x, b.y], polar(len * 0.5, a + 0.12)), tip, 16)), 0.6, 0.7);
        dot(p, tip[0] * sx, tip[1], 0.01, 1);
      }
    } else if (style === 'arcs') {
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const rad = 0.25 + t * (span - 0.3);
        const cx = root * 0.6 - rad * 0.35;
        const pts = arcPts(cx, lift * t * 0.6, rad, -1.1 + t * 0.2, 0.55 - t * 0.2, 30);
        if (i === n - 1 && textEdge) text(pts, 0.045, K.words[1]);
        else {
          p.ink(i % 2 ? 'a' : 'c');
          strokePath(p, M(pts), 1.3 - t * 0.5, 1);
          const e = M(pts)[pts.length - 1];
          dot(p, e[0], e[1], 0.012, 1);
        }
      }
    } else if (style === 'blades') {
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const a = -1.2 + t * 1.7 + lift * 0.3;
        const len = (span - root) * (0.55 + 0.45 * Math.sin((1 - t) * Math.PI * 0.9)) * lr.range(0.9, 1.05);
        const base: Pt = [root + 0.02, 0.02 * i];
        const tip = add2(base, polar(len, a));
        const w = 0.022 * (1 - t * 0.4);
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
        const g = add2(base, polar(0.06, a));
        line(p, (g[0] + nx * 1.8) * sx, g[1] + ny * 1.8, (g[0] - nx * 1.8) * sx, g[1] - ny * 1.8, 1, 0.9);
      }
    } else {
      // bat: leading edge, finger bones and a scalloped trailing edge
      const wrist: Pt = [span * 0.42, lift * 0.5 - 0.22];
      const lead = quadPts([root, 0], [span * 0.2, -0.28 + lift * 0.3], wrist, 20).concat(quadPts(wrist, [span * 0.75, lift - 0.25], [span, lift], 20).slice(1));
      if (textEdge) text(lead, 0.04, K.words[2]);
      else {
        p.ink('a');
        strokePath(p, M(lead), 1.4, 1);
      }
      const tips: Pt[] = [[span, lift], [span * 0.85, lift + 0.35], [span * 0.6, 0.42], [span * 0.35, 0.34], [root, 0.12]];
      p.ink('a');
      for (const tp of tips.slice(1, 4)) line(p, wrist[0] * sx, wrist[1], tp[0] * sx, tp[1], 0.9, 0.9);
      p.ink('c');
      for (let i = 0; i < tips.length - 1; i++) {
        const a = tips[i];
        const b = tips[i + 1];
        const mid: Pt = [(a[0] + b[0]) / 2 - 0.05, (a[1] + b[1]) / 2 - 0.06];
        strokePath(p, M(quadPts(a, mid, b, 14)), 1, 0.95);
        dot(p, a[0] * sx, a[1], 0.012, 1);
      }
      node(p, wrist[0] * sx, wrist[1], 0.018, true);
    }
  };
  K.add('wingR', span + 0.12, 0.95, wingDraw(1));
  K.add('wingL', span + 0.12, 0.95, wingDraw(-1));
  const cs = r.range(0.12, 0.22);
  if (r.chance(0.5)) addSeal(K, r, 'wingHeart', [0, 0], cs, K.words[0]);
  else addEmblem(K, r, 'wingHeart', [0, 0], cs * 1.1, UPRIGHT);
  const extra = r.pick(['halo', 'tail', 'both', 'none'] as const);
  if (extra !== 'none') {
    const tailLen = r.range(0.35, 0.65);
    const tCap: CapKind = r.pick(CAPS);
    K.add('wingExtra', Math.max(cs + 0.2, tailLen + cs + 0.1), 0.85, (p) => {
      if (extra === 'halo' || extra === 'both') {
        p.ink('a');
        p.ctx.save();
        p.ctx.translate(0, -cs - 0.1);
        p.ctx.scale(1, 0.35);
        circle(p, cs * 1.2, 1.2, 1);
        p.ctx.restore();
      }
      if (extra === 'tail' || extra === 'both') {
        p.ink('a');
        line(p, 0, cs + 0.04, 0, cs + tailLen, 1.2, 1);
        p.ink('c');
        cap(p, tCap, 0, cs + tailLen, Math.PI / 2, 0.04);
        for (let k = 1; k <= 2; k++) {
          const y = cs + tailLen * (k / 3);
          line(p, -0.05 * (3 - k), y, 0.05 * (3 - k), y, 0.9, 0.9);
        }
      }
    });
  }
}

/** Everything points one way: chevrons, a shaft and a sign at the tip. */
function wedge(r: Rng, K: Kit) {
  const ang = r.chance(0.5) ? -Math.PI / 2 : r.pick([-Math.PI / 4, (-3 * Math.PI) / 4, 0, Math.PI, Math.PI / 2, r.range(0, TAU)]);
  const rot = ang + Math.PI / 2;
  const L1 = r.range(0.9, 1.1);
  const L2 = r.range(0.7, 0.95);
  const W = r.range(0.45, 0.7);
  const k = r.int(3, 6);
  const slope = r.range(0.5, 1.1);
  const shaft = r.pick(['single', 'text', 'ladder', 'beads'] as const);
  const outline = r.chance(0.5);
  const tail = r.pick(['fletch', 'seal', 'fork'] as const);
  const armCap: CapKind = r.pick(CAPS);
  const textChev = r.int(0, 2);
  const tipS = r.range(0.1, 0.16);
  const seed = seedOf(r);
  K.add('wedge', Math.max(L1, L2) + 0.12, 0.95, (p) => {
    const lr = makeRng(seed);
    p.ctx.save();
    p.ctx.rotate(rot);
    const pts: Pt[] = [[0, L2], [0, -L1 + tipS + 0.02]];
    if (shaft === 'single') {
      p.ink('a');
      line(p, 0, L2, 0, -L1 + tipS + 0.02, 1.4, 1);
    } else if (shaft === 'text') textRail(p, pts, 0.045, K.words[0]);
    else link(p, pts, shaft, lr, K.words[0]);
    for (let i = 0; i < k; i++) {
      const t = i / (k - 1 || 1);
      const y = L2 * 0.8 - t * (L2 * 0.8 + L1 * 0.55);
      const w = W * (1 - t * 0.75);
      const arm = (sx: number): Pt[] => [[sx * w, y + w * slope], [0, y]];
      for (const sx of [-1, 1]) {
        const a = arm(sx);
        if (i < textChev) textRail(p, sx > 0 ? [a[1], a[0]] : [a[0], a[1]], 0.035, K.words[(i + 1) % 3]);
        else {
          p.ink(i % 2 ? 'c' : 'a');
          line(p, a[0][0], a[0][1], a[1][0], a[1][1], 1.3 - t * 0.4, 1);
        }
        p.ink('c');
        cap(p, armCap, a[0][0], a[0][1], Math.atan2(a[0][1] - a[1][1], a[0][0] - a[1][0]), 0.028);
      }
    }
    if (outline) {
      p.ink('a');
      for (const sx of [-1, 1]) {
        const a: Pt = [sx * W * 1.12, L2];
        const b: Pt = [0, -L1];
        for (const [t0, t1] of [[0, 0.3], [0.4, 0.62], [0.72, 0.92]]) {
          line(p, a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0, a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1, 0.8, 0.85);
        }
      }
    }
    if (tail === 'fletch') {
      p.ink('a');
      for (let j = 0; j < 3; j++) {
        const y = L2 - j * 0.07;
        line(p, 0, y - 0.05, -0.12, y + 0.06, 1, 0.95);
        line(p, 0, y - 0.05, 0.12, y + 0.06, 1, 0.95);
      }
    } else if (tail === 'fork') {
      p.ink('c');
      cap(p, 'fork', 0, L2, Math.PI / 2, 0.08);
    }
    // dots growing towards the tail
    p.ink('c');
    for (let j = 0; j < 5; j++) dot(p, 0, -L1 * 0.2 + j * (L2 * 0.18), 0.008 + j * 0.003, 1);
    p.ctx.restore();
  });
  const tip = polar(L1 - tipS * 0.5, ang);
  const e = pickEmblem(r, UPRIGHT);
  K.add('wedgeTip', tipS * 1.15, 1, (p) => {
    p.ctx.rotate(rot);
    drawEmblem(p, K, e, tipS);
  }, { at: tip });
  if (tail === 'seal') addSeal(K, r, 'wedgeTail', polar(L2, ang + Math.PI), r.range(0.1, 0.16), K.words[2]);
}

/** "A seal without a seal": big geometry that reads as one silhouette, with no outer ring. */
function silhouette(r: Rng, K: Kit) {
  const kind = r.pick(['star', 'star', 'triangles', 'squares', 'hexagram', 'diamond', 'vesica', 'crescent'] as const);
  const R = r.range(0.92, 1.1);
  const rot = -Math.PI / 2 + (r.chance(0.25) ? Math.PI / r.int(3, 8) : 0);
  const n = kind === 'star' ? r.int(5, 9) : kind === 'squares' ? 4 : 3;
  const kk = Math.max(2, Math.floor((n - 1) / 2));
  const glyphEdges = r.chance(0.5);
  const vtx: CapKind | 'medallion' | 'none' = r.pick([...CAPS, 'medallion', 'medallion', 'none'] as const);
  const seed = seedOf(r);
  let verts: Pt[] = [];
  const edgeLoop = (p: Pen, loop: Pt[], i0: number) => {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      if (glyphEdges && (i + i0) % 2 === 0) textRail(p, [a, b], 0.045, K.words[(i + i0) % 3]);
      else {
        p.ink('a');
        line(p, a[0], a[1], b[0], b[1], 1.5, 1);
      }
    }
  };
  if (kind === 'star') verts = polygonPts(n, R, rot);
  else if (kind === 'triangles') verts = [...polygonPts(3, R, rot), ...polygonPts(3, R * 0.8, rot + Math.PI)];
  else if (kind === 'squares') verts = [...polygonPts(4, R, rot), ...polygonPts(4, R, rot + Math.PI / 4)];
  else if (kind === 'hexagram') verts = polygonPts(6, R, rot);
  else if (kind === 'diamond') verts = [[0, -R], [R * 0.55, 0], [0, R], [-R * 0.55, 0]];
  else if (kind === 'vesica') verts = [[0, -R * 0.85], [0, R * 0.85]];
  else verts = [];
  K.add('silhouette', R + 0.15, 1, (p) => {
    const lr = makeRng(seed);
    const { ctx } = p;
    if (kind === 'star') {
      starPoly(n, kk, R, rot).forEach((loop, i) => edgeLoop(p, loop, i));
      p.ink('a');
      strokePoly(p, polygonPts(n, R * Math.cos((Math.PI * kk) / n) / Math.cos(Math.PI / n) * 0.98, rot + Math.PI / n), 0.7, 0.7);
    } else if (kind === 'triangles') {
      edgeLoop(p, polygonPts(3, R, rot), 0);
      p.ink('a');
      strokePoly(p, polygonPts(3, R * 0.8, rot + Math.PI), 1.2, 1);
      strokePoly(p, polygonPts(3, R * 0.4, rot), 0.8, 0.8);
    } else if (kind === 'squares') {
      edgeLoop(p, polygonPts(4, R, rot), 0);
      p.ink('a');
      strokePoly(p, polygonPts(4, R, rot + Math.PI / 4), 1.2, 1);
      strokePoly(p, polygonPts(4, R * 0.55, rot), 0.8, 0.85);
    } else if (kind === 'hexagram') {
      starPoly(6, 2, R, rot).forEach((loop, i) => edgeLoop(p, loop, i));
      p.ink('a');
      strokePoly(p, polygonPts(6, R * 0.577, rot + Math.PI / 6), 0.8, 0.8);
    } else if (kind === 'diamond') {
      edgeLoop(p, verts, 0);
      p.ink('a');
      strokePoly(p, [[0, -R * 0.62], [R * 0.34, 0], [0, R * 0.62], [-R * 0.34, 0]], 0.9, 0.9);
      line(p, -R * 0.85, 0, R * 0.85, 0, 1, 1);
      line(p, 0, -R * 0.62, 0, R * 0.62, 0.6, 0.7);
      p.ink('c');
      cap(p, 'arrow', R * 0.85, 0, 0, 0.04);
      cap(p, 'arrow', -R * 0.85, 0, Math.PI, 0.04);
    } else if (kind === 'vesica') {
      const rv = R * 0.49 / Math.sin(Math.PI / 3);
      const cx = rv / 2;
      p.ink('a');
      for (const sx of [-1, 1]) {
        ctx.save();
        ctx.translate(sx * cx, 0);
        arc(p, rv, sx > 0 ? (2 * Math.PI) / 3 : -Math.PI / 3, sx > 0 ? (4 * Math.PI) / 3 : Math.PI / 3, 1.5, 1);
        ctx.restore();
      }
      p.ink('b');
      glyphPath(p, arcPts(cx, 0, rv - 0.05, (2 * Math.PI) / 3 + 0.12, (4 * Math.PI) / 3 - 0.12, 40), 0.045, K.words[0]);
      p.ink('a');
      strokePoly(p, polygonPts(3, R * 0.45, -Math.PI / 2), 1, 1);
      line(p, 0, -R * 0.85, 0, R * 0.85, 0.6, 0.6);
    } else {
      p.ink('a');
      crescent(p, 0, 0, R * 0.9, -Math.PI / 2 + (lr.chance(0.5) ? Math.PI : 0), 0.38, false, 1.5, 1);
      strokePoly(p, polygonPts(3, R * 0.42, rot), 1.1, 1);
      p.ink('c');
      for (let i = 0; i < 7; i++) dot(p, ...polar(R * 1.02, -Math.PI / 2 + (i - 3) * 0.28), 0.012, 1);
    }
    if (vtx !== 'none' && vtx !== 'medallion') {
      p.ink('c');
      verts.forEach(([x, y]) => cap(p, vtx, x, y, Math.atan2(y, x), 0.035));
    }
  }, { spin: r.chance(0.35) ? r.range(0.01, 0.04) * K.dir : 0 });
  if (vtx === 'medallion' && verts.length) {
    const s = verts.length > 6 ? r.range(0.06, 0.09) : r.range(0.08, 0.13);
    verts.forEach((v, i) => addSeal(K, r, `silVtx${i}`, v, s, K.words[i % 3], r.pick(['mini', 'ring'] as const), 0.9));
  }
  addPiece(K, r, 'silCore', [0, 0], r.range(0.13, 0.24), K.words[0], 0.5);
}

/** A kit that draws a whole structure smaller and elsewhere (a structure inside a structure). */
function scaledKit(K: Kit, k: number, o: Pt): Kit {
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
  };
}

/** Fills an empty centre with a small structure of another kind. */
function nested(r: Rng, K: Kit, size: number) {
  const kind = r.pick(['silhouette', 'cross', 'spiral', 'constellation', 'totem', 'separated'] as const);
  BUILDERS[kind](r.fork(71), scaledKit(K, size / 1.1, [0, 0]));
}

/** Extra touches on top of any structure: star dust, fragments of inscriptions, faint geometry, lost signs. */
function garnish(r: Rng, K: Kit, kind: Structure) {
  const opts = (['dust', 'fragments', 'ghost', 'signs', 'ticks'] as const).filter((x) => !(x === 'dust' && kind === 'constellation'));
  const picks = new Set(Array.from({ length: r.int(1, 2) }, () => r.pick(opts)));
  for (const g of picks) {
    const seed = seedOf(r);
    if (g === 'dust') {
      const n = r.int(12, 34);
      K.add('dust', 1.35, 0.7, (p) => dust(p, makeRng(seed), n, 1.3));
    } else if (g === 'fragments') {
      const frs = Array.from({ length: r.int(2, 4) }, () => ({ rad: r.range(1.08, 1.25), a: r.range(0, TAU), l: r.range(0.25, 0.6), w: r.int(0, 2) }));
      K.add('fragments', 1.32, 0.75, (p) => {
        for (const f of frs) {
          p.ink('b');
          glyphArc(p, f.rad, f.a, f.a + f.l, 0.04, K.words[f.w], 0.85);
          p.ink('c');
          dot(p, ...polar(f.rad, f.a - 0.03), 0.009, 1);
          dot(p, ...polar(f.rad, f.a + f.l + 0.03), 0.009, 1);
        }
      }, { spin: r.range(0.01, 0.04) * K.dir });
    } else if (g === 'ghost') {
      const n = r.pick([3, 4, 6]);
      const rot = r.range(0, TAU);
      const lines = r.int(0, 2);
      K.add('ghost', 1.2, 0.3, (p) => {
        p.ink('a');
        strokePoly(p, polygonPts(n, 1.12, rot), 0.6, 0.5);
        if (n === 6) for (const loop of starPoly(6, 2, 1.12, rot)) strokePoly(p, loop, 0.5, 0.4);
        for (let i = 0; i < lines; i++) {
          const [x, y] = polar(1.15, rot + (i / Math.max(1, lines)) * Math.PI);
          line(p, -x, -y, x, y, 0.4, 0.35);
        }
      });
    } else if (g === 'signs') {
      const k = r.int(2, 4);
      const e = pickEmblem(r, ANY);
      for (let i = 0; i < k; i++) {
        const at = polar(r.range(1.05, 1.2), r.range(0, TAU));
        addEmblem(K, r, `lost${i}`, at, r.range(0.04, 0.07), ANY, 0.8, { kind: e.kind, seed: e.seed + i });
      }
    } else {
      const groups = Array.from({ length: r.int(1, 3) }, () => ({ a: r.range(0, TAU), rad: r.range(1.05, 1.2) }));
      K.add('ticks', 1.3, 0.75, (p) => {
        p.ink('a');
        for (const gr of groups) {
          for (let k = -4; k <= 4; k++) {
            const t = gr.a + k * 0.022;
            const [x1, y1] = polar(gr.rad, t);
            const [x2, y2] = polar(gr.rad + (k === 0 ? 0.08 : k % 2 ? 0.025 : 0.045), t);
            line(p, x1, y1, x2, y2, 0.8, 0.85);
          }
        }
      });
    }
  }
}

const BUILDERS: Record<Exclude<Structure, 'classic'>, (r: Rng, K: Kit) => void> = {
  separated, orbit, chain, broken, poles, totem, cross, trunk, frame, constellation, spiral, arch, wings, wedge, silhouette,
};

/** Grows the large structure of the given archetype (not the classic circle). */
export function buildStructure(kind: Exclude<Structure, 'classic'>, r: Rng, K: Kit) {
  BUILDERS[kind](r, K);
  if (r.chance(0.6)) garnish(r.fork(99), K, kind);
}
