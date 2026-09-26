// Drawing primitives shared by the circle generator and the large structures: rings, arcs,
// letters along rings and lines, stars, crescents, suns, ornament bands and the small seals.
import type { Rng } from '../../../utils/seed/seed';
import { drawGlyph, glyphWidth } from '../../../utils/glyphs/glyphLibrary';
import { drawSigil, makeSigil, type Sigil } from './sigils';
import type { GeneratorInput, Ink, Pen } from './generator';

export const TAU = Math.PI * 2;
// ------------------------------------------------------------------ primitives

export function circle(p: Pen, r: number, w = 1, a = 1) {
  const { ctx } = p;
  ctx.globalAlpha = a;
  ctx.lineWidth = p.lw * w;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
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

export function line(p: Pen, x1: number, y1: number, x2: number, y2: number, w = 1, a = 1) {
  const { ctx } = p;
  ctx.globalAlpha = a;
  ctx.lineWidth = p.lw * w;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

export function dot(p: Pen, x: number, y: number, r: number, a = 1) {
  const { ctx } = p;
  ctx.globalAlpha = a;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

export function disc(p: Pen, r: number) {
  p.ctx.save();
  p.erase();
  p.ctx.globalAlpha = 1;
  p.ctx.beginPath();
  p.ctx.arc(0, 0, r, 0, TAU);
  p.ctx.fill();
  p.ctx.restore();
}

export function dashedCircle(p: Pen, r: number, dashes: number, fill: number, w = 1, a = 1) {
  for (let i = 0; i < dashes; i++) {
    const t0 = (i / dashes) * TAU;
    arc(p, r, t0, t0 + (TAU / dashes) * fill, w, a);
  }
}

export const polar = (r: number, t: number): [number, number] => [Math.cos(t) * r, Math.sin(t) * r];

export function around(p: Pen, n: number, r: number, fn: (i: number) => void, phase = 0) {
  for (let i = 0; i < n; i++) {
    p.ctx.save();
    p.ctx.rotate(phase + (i / n) * TAU);
    p.ctx.translate(0, -r);
    fn(i);
    p.ctx.restore();
  }
}

/** Letters standing on a ring, repeated all the way around with small separators. */
export function glyphRing(p: Pen, rMid: number, h: number, glyphs: number[], opts: { spacing?: number; sep?: 'dot' | 'diamond' | 'bar' | 'none'; a?: number } = {}) {
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
export function glyphLine(p: Pen, x1: number, y1: number, x2: number, y2: number, h: number, glyphs: number[]) {
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

export function polygonPts(n: number, r: number, rot: number): [number, number][] {
  return Array.from({ length: n }, (_, i) => polar(r, rot + (i / n) * TAU));
}

export function strokePoly(p: Pen, pts: [number, number][], w = 1, a = 1, close = true) {
  const { ctx } = p;
  ctx.globalAlpha = a;
  ctx.lineWidth = p.lw * w;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  if (close) ctx.closePath();
  ctx.stroke();
}

/** Polygon whose edges are arcs: bulge > 0 = rounded outward ("almost a circle"), < 0 = inward. */
export function curvedPoly(p: Pen, n: number, r: number, rot: number, bulge: number, w = 1, a = 1) {
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

export function dashLine(p: Pen, x1: number, y1: number, x2: number, y2: number, n: number, fill: number, w = 1, a = 1) {
  for (let i = 0; i < n; i++) {
    const t0 = i / n;
    const t1 = t0 + fill / n;
    line(p, x1 + (x2 - x1) * t0, y1 + (y2 - y1) * t0, x1 + (x2 - x1) * t1, y1 + (y2 - y1) * t1, w, a);
  }
}

/** Small ring with a dot: the node that ends lines in sacred-geometry drawings. */
export function node(p: Pen, x: number, y: number, r: number, filled = false) {
  p.ctx.save();
  p.ctx.translate(x, y);
  disc(p, r);
  circle(p, r, 1, 1);
  dot(p, 0, 0, filled ? r * 0.7 : r * 0.35, 1);
  p.ctx.restore();
}

/** Crescent moon, horns opening towards +x (rotate to aim it). */
export function crescent(p: Pen, x: number, y: number, r: number, rot: number, thin = 0.4, fill = true, w = 1, alpha = 1) {
  const { ctx } = p;
  const r2 = r * (0.95 - thin * 0.15);
  const dx = r * thin;
  const xi = (r * r - r2 * r2 + dx * dx) / (2 * dx);
  const yi = Math.sqrt(Math.max(0, r * r - xi * xi));
  const t1 = Math.atan2(yi, xi);
  const t2 = Math.atan2(yi, xi - dx);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.globalAlpha = alpha;
  ctx.lineWidth = p.lw * w;
  ctx.beginPath();
  ctx.arc(0, 0, r, t1, TAU - t1);
  ctx.arc(dx, 0, r2, TAU - t2, t2, true);
  ctx.closePath();
  if (fill) ctx.fill();
  else ctx.stroke();
  ctx.restore();
}

/** Lotus: pointed petals from the centre, in one or two rows. */
export function lotus(p: Pen, r: number, petals: number, rows: number, w = 1) {
  const { ctx } = p;
  ctx.lineWidth = p.lw * w;
  for (let row = 0; row < rows; row++) {
    const len = r * (1 - row * 0.3);
    const half = len * (0.28 + row * 0.06);
    for (let i = 0; i < petals; i++) {
      ctx.save();
      ctx.rotate(((i + row * 0.5) / petals) * TAU);
      ctx.globalAlpha = 1 - row * 0.2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(half, -len * 0.55, 0, -len);
      ctx.quadraticCurveTo(-half, -len * 0.55, 0, 0);
      ctx.stroke();
      ctx.restore();
    }
  }
}

/** Sun: rays between r0 and r1, straight (alternating long/short) or wavy like flames. */
export function sunRays(p: Pen, r0: number, r1: number, n: number, wavy: boolean) {
  const { ctx } = p;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU;
    ctx.save();
    ctx.rotate(t);
    ctx.globalAlpha = 1;
    if (wavy) {
      const l = r1 - r0;
      const wv = l * 0.14 * (i % 2 ? 1 : -1);
      ctx.lineWidth = p.lw * 1.1;
      ctx.beginPath();
      ctx.moveTo(0, -r0);
      ctx.bezierCurveTo(wv * 2, -r0 - l * 0.35, -wv * 2, -r0 - l * 0.65, 0, -r1);
      ctx.stroke();
    } else {
      const l = i % 2 ? r0 + (r1 - r0) * 0.55 : r1;
      const hw = ((TAU * r0) / n) * 0.28;
      ctx.beginPath();
      ctx.moveTo(-hw, -r0);
      ctx.lineTo(0, -l);
      ctx.lineTo(hw, -r0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

/** Filled ring with letters cut out of it (a dark band of negative lettering). */
export function knockoutRing(p: Pen, r0: number, r1: number, glyphs: number[], fillAlpha: number, ink: Ink = 'c') {
  const { ctx } = p;
  p.ink(ink);
  ctx.globalAlpha = fillAlpha;
  ctx.beginPath();
  ctx.arc(0, 0, r1, 0, TAU);
  ctx.arc(0, 0, r0, 0, TAU, true);
  ctx.fill('evenodd');
  p.erase();
  glyphRing(p, (r0 + r1) / 2, (r1 - r0) * 0.72, glyphs, { sep: 'dot' });
}

/** Ring of big brush sigils, some of them enclosed in circles (no rails). */
export function sigilRing(p: Pen, rm: number, size: number, rng: Rng) {
  const n = Math.max(5, Math.round((TAU * rm) / (size * rng.range(2.3, 3.2))));
  const sigs = Array.from({ length: Math.min(n, 7) }, (_, k) => makeSigil(rng.fork(k), rng.range(0.8, 1.3)));
  const enclose = rng.pick(['none', 'alt', 'alt', 'some'] as const);
  around(p, n, rm, (i) => {
    const boxed = enclose === 'alt' ? i % 2 === 1 : enclose === 'some' ? i % 3 === 0 : false;
    if (boxed) {
      disc(p, size);
      circle(p, size, 0.9, 0.95);
    }
    p.ctx.globalAlpha = 1;
    drawSigil(p.ctx, sigs[i % sigs.length], size * (boxed ? 0.72 : 0.95), 0.9);
  });
}

export function starPoly(n: number, k: number, r: number, rot: number): [number, number][][] {
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

export type Motif = (p: Pen, w: number, h: number, i: number) => void;

/** Builds one ornament cell from 1-3 random primitives with continuous parameters. */
export function makeMotif(rng: Rng, glyphs: number[], sigil: Sigil): Motif {
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
export function motifBand(p: Pen, r0: number, r1: number, rng: Rng, glyphs: number[], sigil: Sigil) {
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
export function miniCircle(p: Pen, r: number, rng: Rng, g: GeneratorInput, sigil: Sigil, detail: number) {
  disc(p, r * 1.02);
  p.ink('c');
  circle(p, r, 1.3);
  if (rng.chance(0.6)) circle(p, r * 0.93, 0.6, 0.8);
  const kind = rng();
  const text = rng.pick([g.reason, g.name, g.punishment]);
  if (kind < 0.4 && detail > 0) {
    // ring of letters inside the satellite
    const rr = r * rng.range(0.7, 0.8);
    p.ink('b');
    glyphRing(p, rr, r * 0.2, text, { sep: 'dot' });
    p.ink('c');
    circle(p, rr - r * 0.13, 0.7, 0.9);
  } else if (kind < 0.54) {
    p.ink('c');
    dashedCircle(p, r * 0.78, rng.int(12, 36), rng.range(0.3, 0.7), 0.8, 0.8);
  } else if (kind < 0.66) {
    const n = rng.pick([3, 4, 5, 6]);
    p.ink('a');
    for (const loop of starPoly(n * 2, 2, r * 0.8, rng.range(0, TAU))) strokePoly(p, loop, 0.8, 0.9);
  } else if (kind < 0.8) {
    // dark band with the letters cut out of it
    knockoutRing(p, r * 0.62, r * 0.9, detail > 0 ? text : [-1], rng.range(0.3, 0.45));
    p.ink('c');
    circle(p, r * 0.62, 0.7, 0.9);
  } else if (kind < 0.9) {
    p.ink('c');
    sunRays(p, r * 0.52, r * 0.86, rng.pick([12, 16, 24]), rng.chance(0.5));
    circle(p, r * 0.52, 0.8, 0.9);
  } else {
    p.ink('c');
    lotus(p, r * 0.85, rng.pick([6, 8, 12]), rng.int(1, 2), 0.8);
  }
  if (detail > 1) {
    // big seals (constellations) get one more tier: a figure between the ring and the centre
    p.ink('a');
    const n = rng.pick([3, 4, 6, 6]);
    const loops = n === 6 ? starPoly(6, 2, r * 0.56, -Math.PI / 2) : [polygonPts(n, r * 0.56, -Math.PI / 2)];
    for (const loop of loops) strokePoly(p, loop, 0.9, 0.9);
    circle(p, r * 0.56, 0.6, 0.7);
  }
  const lw = p.lw;
  const k = detail > 1 ? 0.55 : 1;
  p.ctx.save();
  p.ctx.scale(k, k);
  p.lw = lw / k;
  miniCentre(p, r, rng, g, sigil);
  p.lw = lw;
  p.ctx.restore();
}

export function miniCentre(p: Pen, r: number, rng: Rng, g: GeneratorInput, sigil: Sigil) {
  // centre: a sigil, a star, a letter, a crescent, a cut-out sigil or an eye
  const c = rng();
  if (c < 0.36) {
    p.ink('a');
    p.ctx.globalAlpha = 1;
    drawSigil(p.ctx, sigil, r * 0.42, 1);
  } else if (c < 0.52) {
    p.ink('a');
    const n = rng.pick([5, 6, 7]);
    for (const loop of starPoly(n, n === 6 ? 2 : Math.floor(n / 2), r * 0.45, -Math.PI / 2)) strokePoly(p, loop, 0.9, 1);
  } else if (c < 0.68) {
    p.ink('b');
    p.ctx.globalAlpha = 1;
    const seq = g.name.filter((x) => x >= 0);
    drawGlyph(p.ctx, seq.length ? rng.pick(seq) : 0, r * 0.7);
  } else if (c < 0.8) {
    p.ink('a');
    crescent(p, 0, 0, r * 0.4, rng.pick([0, -Math.PI / 2, Math.PI / 2]), rng.range(0.35, 0.55));
  } else if (c < 0.92) {
    // a filled seal with the sigil cut out of it
    p.ink('c');
    p.ctx.globalAlpha = rng.range(0.45, 0.65);
    p.ctx.beginPath();
    p.ctx.arc(0, 0, r * 0.5, 0, TAU);
    p.ctx.fill();
    p.erase();
    p.ctx.globalAlpha = 1;
    drawSigil(p.ctx, sigil, r * 0.38, 1.1);
  } else {
    p.ink('a');
    const e = r * 0.42;
    p.ctx.globalAlpha = 1;
    p.ctx.lineWidth = p.lw;
    p.ctx.beginPath();
    p.ctx.moveTo(-e, 0);
    p.ctx.quadraticCurveTo(0, -e * 0.8, e, 0);
    p.ctx.quadraticCurveTo(0, e * 0.8, -e, 0);
    p.ctx.stroke();
    dot(p, 0, 0, e * 0.25, 1);
  }
}


// ------------------------------------------------------------------ free-form pieces
// (used by the large structures: letters along arcs and curves, links, terminals, emblems)

export type Pt = [number, number];

/** Open polyline. */
export function strokePath(p: Pen, pts: Pt[], w = 1, a = 1) {
  strokePoly(p, pts, w, a, false);
}

/** Points of a quadratic curve a → b bent through control point c. */
export function quadPts(a: Pt, c: Pt, b: Pt, n = 32): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return out;
}

/** Points of an arc of a circle centred at (cx, cy) (angles as in polar()). */
export function arcPts(cx: number, cy: number, r: number, a0: number, a1: number, n = 48): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = a0 + ((a1 - a0) * i) / n;
    return [cx + Math.cos(t) * r, cy + Math.sin(t) * r] as Pt;
  });
}

/** Moves a polyline sideways (positive = to the left of the direction of travel). */
export function offsetPath(pts: Pt[], d: number): Pt[] {
  return pts.map((pt, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [pt[0] + ((b[1] - a[1]) / l) * d, pt[1] - ((b[0] - a[0]) / l) * d] as Pt;
  });
}

function pathLength(pts: Pt[]) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return len;
}

/** Point and direction at distance s along a polyline. */
export function pathAt(pts: Pt[], s: number): { x: number; y: number; ang: number } {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const l = Math.hypot(x1 - x0, y1 - y0);
    if (acc + l >= s || i === pts.length - 1) {
      const t = l ? Math.max(0, Math.min(1, (s - acc) / l)) : 0;
      return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, ang: Math.atan2(y1 - y0, x1 - x0) };
    }
    acc += l;
  }
  return { x: pts[0][0], y: pts[0][1], ang: 0 };
}

/** Letters walking along any polyline (arcs, curves, spirals), each turned along the way. */
export function glyphPath(p: Pen, pts: Pt[], h: number, glyphs: number[], a = 1, shrinkTo = 1) {
  const src = glyphs.filter((x) => x >= 0);
  const seq = src.length ? src : [0];
  const len = pathLength(pts);
  const { ctx } = p;
  ctx.globalAlpha = a;
  let s = 0;
  let i = 0;
  while (s < len) {
    const k = 1 - (1 - shrinkTo) * (s / len);
    const unit = h * 0.78 * k;
    const w = Math.max(glyphWidth(seq[i % seq.length], unit), unit * 0.4) + unit * 0.3;
    if (s + w > len + unit * 0.2) break;
    const at = pathAt(pts, s + w / 2);
    ctx.save();
    ctx.translate(at.x, at.y);
    ctx.rotate(at.ang);
    drawGlyph(ctx, seq[i % seq.length], unit);
    ctx.restore();
    s += w;
    i++;
  }
}

/** Letters along an arc around the origin, standing on it (tops outward). */
export function glyphArc(p: Pen, r: number, a0: number, a1: number, h: number, glyphs: number[], a = 1) {
  glyphPath(p, arcPts(0, 0, r, a0, a1, Math.max(8, Math.ceil(Math.abs(a1 - a0) * 40))), h, glyphs, a);
}

export type CapKind = 'node' | 'crescent' | 'arrow' | 'trident' | 'ring' | 'diamond' | 'triangle' | 'fork' | 'dot' | 'bar' | 'star';
export const CAPS: readonly CapKind[] = ['node', 'crescent', 'arrow', 'trident', 'ring', 'diamond', 'triangle', 'fork', 'dot', 'bar', 'star'];

/** A terminal at (x, y) pointing in direction `ang` (the end of a ray, a branch or an axis). */
export function cap(p: Pen, kind: CapKind, x: number, y: number, ang: number, q: number) {
  const { ctx } = p;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang + Math.PI / 2); // local -y = the direction of travel
  switch (kind) {
    case 'node':
      node(p, 0, -q * 0.6, q * 0.6);
      break;
    case 'crescent':
      crescent(p, 0, -q * 0.5, q, -Math.PI / 2, 0.45);
      break;
    case 'arrow':
      strokePath(p, [[-q * 0.7, 0], [0, -q], [q * 0.7, 0]], 1, 1);
      break;
    case 'trident':
      line(p, -q, 0, q, 0, 1, 1);
      line(p, -q, 0, -q, -q, 1, 1);
      line(p, q, 0, q, -q, 1, 1);
      line(p, 0, 0, 0, -q * 1.4, 1, 1);
      break;
    case 'ring':
      ctx.translate(0, -q);
      circle(p, q, 1, 1);
      dot(p, 0, 0, q * 0.3, 1);
      break;
    case 'diamond':
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(q * 0.5, -q);
      ctx.lineTo(0, -q * 2);
      ctx.lineTo(-q * 0.5, -q);
      ctx.closePath();
      ctx.fill();
      break;
    case 'triangle':
      strokePoly(p, [[0, -q * 1.3], [q * 0.8, 0], [-q * 0.8, 0]], 1, 1);
      break;
    case 'fork':
      line(p, 0, 0, -q * 0.7, -q, 1, 1);
      line(p, 0, 0, q * 0.7, -q, 1, 1);
      dot(p, -q * 0.7, -q, q * 0.18, 1);
      dot(p, q * 0.7, -q, q * 0.18, 1);
      break;
    case 'dot':
      dot(p, 0, -q * 0.3, q * 0.35, 1);
      break;
    case 'bar':
      line(p, -q * 0.8, 0, q * 0.8, 0, 1.2, 1);
      dot(p, 0, -q * 0.5, q * 0.2, 1);
      break;
    case 'star':
      for (const loop of starPoly(5, 2, q * 0.8, -Math.PI / 2)) {
        ctx.save();
        ctx.translate(0, -q * 0.8);
        strokePoly(p, loop, 0.9, 1);
        ctx.restore();
      }
      break;
  }
  ctx.restore();
}

export type LinkKind = 'line' | 'rail' | 'dash' | 'beads' | 'wave' | 'ladder' | 'nodes' | 'zigzag';
export const LINKS: readonly LinkKind[] = ['line', 'rail', 'rail', 'dash', 'beads', 'wave', 'ladder', 'nodes', 'zigzag'];

/**
 * A link along a path (straight or curved): a thin line, a double rail with the words running
 * between, a dashed line, a string of beads, a wave, a ladder, a line with nodes or a zigzag.
 */
export function link(p: Pen, pts: Pt[], kind: LinkKind, rng: Rng, glyphs: number[], scale = 1) {
  const len = pathLength(pts);
  if (len < 0.02) return;
  const hw = 0.022 * scale;
  switch (kind) {
    case 'line':
      p.ink('a');
      strokePath(p, pts, 0.9, 0.9);
      break;
    case 'rail':
      p.ink('a');
      strokePath(p, offsetPath(pts, hw), 0.9, 0.95);
      strokePath(p, offsetPath(pts, -hw), 0.9, 0.95);
      p.ink('b');
      glyphPath(p, pts, hw * 1.45, glyphs, 1);
      break;
    case 'dash': {
      p.ink('a');
      const n = Math.max(3, Math.round(len / (0.04 * scale)));
      for (let i = 0; i < n; i++) {
        const a = pathAt(pts, (i / n) * len);
        const b = pathAt(pts, ((i + 0.55) / n) * len);
        line(p, a.x, a.y, b.x, b.y, 0.9, 0.9);
      }
      break;
    }
    case 'beads': {
      p.ink('a');
      strokePath(p, pts, 0.6, 0.6);
      const q = hw * 1.3;
      const n = Math.max(2, Math.floor(len / (q * 3.2)));
      const seq = glyphs.filter((x) => x >= 0);
      const inside = rng.pick(['glyph', 'dot', 'mixed'] as const);
      for (let i = 0; i < n; i++) {
        const a = pathAt(pts, ((i + 0.5) / n) * len);
        p.ctx.save();
        p.ctx.translate(a.x, a.y);
        p.ctx.rotate(a.ang);
        disc(p, q);
        p.ink('c');
        circle(p, q, 0.9, 1);
        p.ctx.globalAlpha = 1;
        if (inside === 'glyph' || (inside === 'mixed' && i % 2)) {
          p.ink('b');
          drawGlyph(p.ctx, seq.length ? seq[i % seq.length] : i, q * 1.25);
        } else dot(p, 0, 0, q * 0.32, 1);
        p.ctx.restore();
      }
      break;
    }
    case 'wave': {
      p.ink('a');
      const waves = Math.max(2, Math.round(len / (0.12 * scale)));
      const out: Pt[] = [];
      const steps = waves * 16;
      for (let i = 0; i <= steps; i++) {
        const s = (i / steps) * len;
        const a = pathAt(pts, s);
        const o = Math.sin((i / steps) * waves * TAU) * hw * 1.2;
        out.push([a.x - Math.sin(a.ang) * o, a.y + Math.cos(a.ang) * o]);
      }
      strokePath(p, out, 0.9, 0.9);
      if (rng.chance(0.5)) strokePath(p, pts, 0.5, 0.5);
      break;
    }
    case 'ladder': {
      p.ink('a');
      strokePath(p, offsetPath(pts, hw), 0.8, 0.9);
      strokePath(p, offsetPath(pts, -hw), 0.8, 0.9);
      const n = Math.max(3, Math.round(len / (0.05 * scale)));
      for (let i = 1; i < n; i++) {
        const a = pathAt(pts, (i / n) * len);
        const dx = -Math.sin(a.ang) * hw;
        const dy = Math.cos(a.ang) * hw;
        line(p, a.x - dx, a.y - dy, a.x + dx, a.y + dy, 0.6, 0.8);
      }
      break;
    }
    case 'nodes': {
      p.ink('a');
      strokePath(p, pts, 1, 0.95);
      const n = rng.int(1, 3);
      p.ink('c');
      for (let i = 0; i < n; i++) {
        const a = pathAt(pts, ((i + 1) / (n + 1)) * len);
        if (rng.chance(0.5)) node(p, a.x, a.y, hw * 0.9, rng.chance(0.4));
        else {
          const dx = -Math.sin(a.ang) * hw * 1.8;
          const dy = Math.cos(a.ang) * hw * 1.8;
          line(p, a.x - dx, a.y - dy, a.x + dx, a.y + dy, 1, 1);
        }
      }
      break;
    }
    case 'zigzag': {
      p.ink('a');
      const n = Math.max(4, Math.round(len / (0.035 * scale)));
      const out: Pt[] = [];
      for (let i = 0; i <= n; i++) {
        const a = pathAt(pts, (i / n) * len);
        const o = (i % 2 ? 1 : -1) * hw * (i === 0 || i === n ? 0 : 1);
        out.push([a.x - Math.sin(a.ang) * o, a.y + Math.cos(a.ang) * o]);
      }
      strokePath(p, out, 0.8, 0.9);
      break;
    }
  }
}

/** Cuts a path so it starts `t0` after its first point and stops `t1` before its last one. */
export function trimPath(pts: Pt[], t0: number, t1: number): Pt[] {
  const len = pathLength(pts);
  if (t0 + t1 >= len) return [];
  const n = Math.max(2, pts.length);
  return Array.from({ length: n }, (_, i) => {
    const a = pathAt(pts, t0 + ((len - t0 - t1) * i) / (n - 1));
    return [a.x, a.y] as Pt;
  });
}
