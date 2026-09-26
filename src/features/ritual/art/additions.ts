// Additions around the classic circle: sometimes the circle grows wings to both sides, or a
// spiral winds out of its rim. The circle itself stays exactly as it is; an addition only
// fills the sides of the screen around it (the certificate covers the middle at the end).
//
// Each addition is made of its own layers (they sit at their own depth); the emblems at their
// ends include a few hand-drawn signs from signs.svg ("Symbol 2 grp").
import type { Rng } from '../../../utils/seed/seed';
import { makeRng } from '../../../utils/seed/seed';
import { drawGlyph } from '../../../utils/glyphs/glyphLibrary';
import { drawSign, EMBLEM_SIGNS, ORNATE_SIGNS } from '../../../utils/glyphs/signLibrary';
import { drawSigil, type Sigil } from './sigils';
import type { GeneratorInput, Pen } from './generator';
import {
  TAU, CAPS, arc, cap, circle, crescent, disc, dot, glyphPath, line, link, lotus, miniCircle, node,
  offsetPath, pathAt, pathLength, polar, polygonPts, quadPts, starPoly, strokePath, strokePoly, sunRays, trimPath,
  type CapKind, type Pt,
} from './primitives';

export type Addition = 'wings' | 'spiral';

/** About a third of the circles stay alone, the others get wings or a spiral. */
export function pickAddition(r: Rng): Addition | null {
  const forced = typeof location !== 'undefined' && import.meta.env.DEV ? new URLSearchParams(location.search).get('addition') : null;
  if (forced === 'wings' || forced === 'spiral') return forced;
  if (forced === 'none') return null;
  const x = r();
  return x < 0.36 ? 'wings' : x < 0.7 ? 'spiral' : null;
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

const seedOf = (r: Rng) => r.int(1, 2 ** 30);

const add2 = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];

type EmblemKind =
  | 'sigil' | 'sign' | 'ornate' | 'star' | 'moonStar' | 'eye' | 'eyeTri' | 'sun' | 'lotus' | 'letter' | 'hexagram'
  | 'seal' | 'hourglass' | 'ankh' | 'mercury' | 'sulfur' | 'spiral';

/** Stand upright on an axis (totem heads, wing centres, wedge tips). */
const UPRIGHT: readonly EmblemKind[] = ['sigil', 'ornate', 'ornate', 'ornate', 'sign', 'sign', 'moonStar', 'eyeTri', 'hourglass', 'ankh', 'mercury', 'sulfur', 'letter'];

/** Look good turning. */
const ROUND: readonly EmblemKind[] = ['seal', 'seal', 'seal', 'sun', 'lotus', 'star', 'hexagram', 'eye', 'sign', 'spiral'];

const ANY: readonly EmblemKind[] = [...UPRIGHT, ...ROUND];

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

// ------------------------------------------------------------------ wings

/** Wings spreading from the rim of the circle (radius R) to both edges of the screen. */
function wings(r: Rng, K: Kit, R: number) {
  const style = r.pick(['feathers', 'feathers', 'blades', 'bat'] as const);
  const root = R * 0.94;
  const span = r.range(1.62, 1.75);
  const lift = r.range(-0.42, 0.05);
  const len = span - root;
  const X = (u: number) => root + len * u;
  const n = style === 'blades' ? r.int(7, 11) : r.int(6, 9);
  const lower = r.chance(0.5);
  const seed = seedOf(r);
  const tipE = pickEmblem(r, ANY);
  const bone = quadPts([root, -0.08], [X(0.45), lift * 0.8 - 0.28], [span, lift], 40);
  const draw = (sx: 1 | -1) => (p: Pen) => {
    const lr = makeRng(seed);
    const M = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [x * sx, y] as Pt);
    // letters must not be mirrored: on the left wing the path runs towards the middle
    const band = (pts: Pt[], h: number, st: BandStyle, w: number[]) => pathBand(p, sx > 0 ? M(pts) : M(pts).reverse(), h, st, w);
    if (style === 'feathers') {
      band(bone, 0.055, 'text', K.words[0]);
      for (const row of [0, 1]) {
        for (let i = 0; i < n; i++) {
          const t = 0.08 + (i / (n - 1)) * 0.92;
          const b = pathAt(bone, t * pathLength(bone));
          const fl = (row ? 0.16 : 0.26) + (row ? 0.14 : 0.34) * t;
          const a = Math.PI / 2 - 0.2 - t * 0.75 + row * 0.1;
          const tip = add2([b.x, b.y], polar(fl * lr.range(0.9, 1.05), a));
          p.ink(row ? 'c' : 'a');
          strokePath(p, M(quadPts([b.x, b.y], add2([b.x, b.y], polar(fl * 0.5, a - 0.25)), tip, 16)), row ? 0.8 : 1.2, 0.95);
          strokePath(p, M(quadPts([b.x, b.y], add2([b.x, b.y], polar(fl * 0.5, a + 0.12)), tip, 16)), 0.6, 0.7);
          dot(p, tip[0] * sx, tip[1], 0.011, 1);
        }
      }
    } else if (style === 'blades') {
      band(bone, 0.045, 'double', []);
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const a = -0.95 + t * 1.5 + lift * 0.3;
        const bl = len * (0.55 + 0.45 * Math.sin((1 - t) * Math.PI * 0.9)) * lr.range(0.9, 1.05);
        const base: Pt = [root + 0.03, -0.05 + 0.02 * i];
        const tip = add2(base, polar(bl, a));
        const w = 0.022 * (1 - t * 0.4);
        const nx = -Math.sin(a) * w;
        const ny = Math.cos(a) * w;
        p.ink(i % 2 ? 'c' : 'a');
        p.ctx.globalAlpha = 0.9;
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
      // bat: leading edge, finger bones and a scalloped trailing edge
      const wrist: Pt = [X(0.4), lift * 0.5 - 0.32];
      const lead = quadPts([root, -0.1], [X(0.15), -0.36 + lift * 0.3], wrist, 20).concat(quadPts(wrist, [X(0.75), lift - 0.3], [span, lift], 24).slice(1));
      band(lead, 0.05, 'text', K.words[2]);
      const tips: Pt[] = [[span, lift], [X(0.88), lift + 0.4], [X(0.62), 0.5], [X(0.35), 0.46], [root + 0.02, 0.2]];
      p.ink('a');
      for (const tp of tips.slice(1, 4)) line(p, wrist[0] * sx, wrist[1], tp[0] * sx, tp[1], 1.1, 0.95);
      p.ink('c');
      for (let i = 0; i < tips.length - 1; i++) {
        const a = tips[i];
        const b = tips[i + 1];
        strokePath(p, M(quadPts(a, [(a[0] + b[0]) / 2 - 0.05, (a[1] + b[1]) / 2 - 0.08], b, 16)), 1.2, 1);
        dot(p, a[0] * sx, a[1], 0.014, 1);
      }
      node(p, wrist[0] * sx, wrist[1], 0.022, true);
    }
    if (lower) {
      // a smaller lower wing
      for (let i = 0; i < 4; i++) {
        const t = i / 3;
        const pts = quadPts([root * 0.98, 0.18 + i * 0.03], [X(0.3 + t * 0.1), 0.34 + t * 0.12], [X(0.5 + t * 0.2), 0.6 + t * 0.1], 24);
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
    // a sign at the tip of the wing
    p.ctx.save();
    p.ctx.translate(span * sx, lift - 0.12);
    drawEmblem(p, K, tipE, 0.06);
    p.ctx.restore();
  };
  K.add('wingR', span + 0.12, 1, draw(1));
  K.add('wingL', span + 0.12, 1, draw(-1));
}

// ------------------------------------------------------------------ spiral

/** Arms winding out of the rim of the circle (radius R), turning slowly around it. */
function spiral(r: Rng, K: Kit, R: number) {
  const arms = r.pick([2, 2, 3, 4]);
  const r0 = R * 1.02;
  const r1 = r.range(1.65, 1.85);
  const turns = r.range(0.45, 0.8);
  const kind = r.pick(['text', 'text', 'beads', 'double'] as const);
  const endCap: CapKind = r.pick(CAPS);
  const tipE = pickEmblem(r, ANY);
  const ph = r.range(0, TAU);
  const d = K.dir;
  const armPts = (a: number, dr = 0): Pt[] =>
    Array.from({ length: 120 }, (_, i) => {
      const t = i / 119;
      const rad = r0 + (r1 - r0) * t + dr * (0.4 + 0.6 * t);
      return polar(rad, ph + (a / arms) * TAU + d * t * turns * TAU);
    });
  const seed = seedOf(r);
  K.add('spiral', r1 + 0.12, 1, (p) => {
    const lr = makeRng(seed);
    for (let a = 0; a < arms; a++) {
      const pts = armPts(a);
      const w = K.words[a % 3];
      if (kind === 'text') {
        p.ink('a');
        strokePath(p, armPts(a, 0.04), 1, 0.95);
        strokePath(p, armPts(a, -0.04), 1, 0.95);
        p.ink('b');
        glyphPath(p, trimPath(pts, 0.05, 0.05), 0.065, w);
      } else if (kind === 'beads') {
        p.ink('a');
        strokePath(p, pts, 0.8, 0.85);
        const nb = lr.int(8, 12);
        const seq = w.filter((x) => x >= 0);
        for (let i = 1; i < nb; i++) {
          const t = i / nb;
          const q = pts[Math.round(t * 119)];
          const s = 0.022 + 0.03 * t;
          p.ctx.save();
          p.ctx.translate(q[0], q[1]);
          disc(p, s);
          p.ink('c');
          circle(p, s, 1, 1);
          p.ink('b');
          p.ctx.globalAlpha = 1;
          drawGlyph(p.ctx, seq.length ? seq[i % seq.length] : i, s * 1.2);
          p.ctx.restore();
        }
      } else {
        pathBand(p, pts, 0.05, lr.chance(0.5) ? 'ticks' : 'double', []);
        p.ink('a');
        strokePath(p, armPts(a, 0.09), 0.6, 0.7);
      }
      const e = pts[pts.length - 1];
      p.ink('c');
      cap(p, endCap, e[0], e[1], endAngle(pts, false), 0.045);
      p.ctx.save();
      p.ctx.translate(...pts[Math.round(0.8 * 119)]);
      disc(p, 0.07);
      drawEmblem(p, K, { kind: tipE.kind, seed: tipE.seed + a }, 0.06);
      p.ctx.restore();
    }
  }, { spin: r.range(0.02, 0.05) * d });
  // a faint counter-turning echo behind
  if (r.chance(0.5)) {
    K.add('spiralEcho', r1 + 0.05, 0.45, (p) => {
      p.ink('a');
      for (let a = 0; a < arms; a++) {
        strokePath(p, Array.from({ length: 90 }, (_, i) => {
          const t = i / 89;
          return polar(r0 + 0.1 + (r1 - r0) * t, ph + Math.PI / arms + (a / arms) * TAU - d * t * turns * 0.8 * TAU);
        }), 0.6, 0.6);
      }
    }, { spin: -r.range(0.015, 0.035) * d });
  }
}

/** Grows an addition around the classic circle (the circle's rim has radius about 1). */
export function growAddition(kind: Addition, r: Rng, K: Kit) {
  if (kind === 'wings') wings(r, K, 1);
  else spiral(r, K, 1);
}
