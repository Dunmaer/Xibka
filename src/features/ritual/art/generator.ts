// Procedural magic-circle generator.
//
// A circle is not picked from presets: it is grown from the curse's seed. The generator
// decides how many tiers there are, where they sit, what architecture the main figure has
// (star, triangle, rounded heptagon, compound polygons, letters running along its edges, a square
// seal, Metatron's cube, the flower of life, a cube ...), whether big off-centre circles, an axis
// break the symmetry, whether satellites break out of the frame (alone or
// linked into a constellation), blades radiate outward, medallions sit on the cardinal points,
// and what the ornament of every band is made of. Motifs are assembled from primitives with
// continuous random parameters, so no two circles repeat.
//
// Every layer is drawn into three colour channels (R = structure, G = inscriptions,
// B = accents); the shader turns them into the curse's own palette.
import { makeRng } from '../../../utils/seed/seed';
import { drawGlyph } from '../../../utils/glyphs/glyphLibrary';
import { drawSigil, makeSigil, type Sigil } from './sigils';
import { layerPalette, makePalette, type Palette } from './palette';
import {
  TAU, around, arc, circle, crescent, curvedPoly, dashLine, dashedCircle, disc, dot, glyphLine, glyphRing, knockoutRing,
  line, lotus, miniCircle, motifBand, node, polar, polygonPts, sigilRing, starPoly, strokePoly, sunRays,
} from './primitives';

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
  /** Hangs just under the certificate at the end (inscription rings framing the sheet). */
  hang: boolean;
  /**
   * Separate small circle (satellite / medallion) sitting on an orbit: it is drawn centred on
   * its own origin, placed at (r, a) and rotated so its top faces outward; `spin` turns it
   * around its own centre while the whole group turns with `groupSpin`.
   */
  orbit?: { r: number; a: number; group: number; groupSpin: number };
  /** Fixed centre of a layer off the middle (large structures); `spin` turns it in place. */
  at?: [number, number];
  /** Centred layer that turns together with an orbit group (links drawn to its satellites). */
  follow?: number;
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

// ------------------------------------------------------------------ the generator

export function generateCircle(g: GeneratorInput): CircleDesign {
  const rng = makeRng(g.seed).fork(4242);
  const palette = makePalette(rng.fork(1));
  const sigils = Array.from({ length: 10 }, (_, i) => makeSigil(rng.fork(100 + i), i === 0 ? 1.6 : 1));
  const words = [g.name, g.reason, g.punishment];
  const text = (a: number[], b: number[]) => [...a, -1, ...b];
  const layers: LayerArt[] = [];
  const dir = rng.sign();
  // Every draw function takes its randomness from a fresh fork, so drawing a layer twice
  // (3D texture, certificate watermark, gallery) always gives exactly the same picture.
  const fresh = (salt: number) => () => rng.fork(salt);

  // Architecture: where the depth goes (a cone towards the viewer, a bowl, or a scattered mechanism)
  const arch = rng.pick(['cone', 'bowl', 'scatter', 'cone'] as const);
  const slotFor = (radius: number) => {
    const t = 1 - Math.min(1, radius / 1.1); // 0 outer .. 1 centre
    if (arch === 'cone') return t * 5 + rng.range(-0.4, 0.4);
    if (arch === 'bowl') return (1 - t) * 4 + rng.range(-0.4, 0.4);
    return rng.range(0, 5);
  };
  let order = 0;
  const addLayer = (id: string, radius: number, intensity: number, draw: (p: Pen) => void, extra: Partial<LayerArt> = {}, depthRadius = radius) => {
    const lr = rng.fork(900 + order);
    const i = order++;
    layers.push({
      id,
      radius,
      zSlot: slotFor(depthRadius),
      zStart: -lr.range(7, 28),
      arrive: Math.round(lr.range(214, 241)),
      spiral: lr.range(0, 0.7),
      twist: lr.range(2, 7) * lr.sign(),
      reveal: [175 + Math.min(i, 14) * 2 + lr.int(0, 6), 196 + Math.min(i, 14) * 2 + lr.int(0, 8)],
      intensity,
      spin: lr.range(0.03, 0.28) * (i % 2 ? -dir : dir),
      palette: layerPalette(palette, lr),
      hang: false,
      draw,
      ...extra,
    });
  };

  /** A group of small circles on an orbit, each its own layer (so each can spin by itself). */
  const addOrbitGroup = (
    id: string, group: number, orbitR: number, size: number | number[], angles: number[], intensity: number,
    drawOne: (p: Pen, i: number) => void,
  ) => {
    const gr = rng.fork(3000 + group);
    const groupSpin = gr.range(0.02, 0.09) * gr.sign();
    const baseSlot = slotFor(orbitR);
    angles.forEach((a, i) => {
      const sr = gr.fork(i);
      // some spin briskly on their own axis, the others barely move
      const spin = (sr.chance(0.55) ? sr.range(0.35, 0.9) : sr.range(0.03, 0.12)) * sr.sign();
      const sz = Array.isArray(size) ? size[i] : size;
      addLayer(`${id}${i}`, sz * 1.04, intensity, (p) => drawOne(p, i), {
        orbit: { r: orbitR, a, group, groupSpin },
        spin,
        zSlot: baseSlot + sr.range(-0.6, 0.6),
      });
    });
  };

  let figure = '';
  // ---------- 1. Frame: rings, the letter band and what breaks out of it (three depths)
  {
    const fr = rng.fork(11);
    const style = fr.int(0, 3);
    const tr = fr();
    // letters around the band, few big letters, a ring of brush sigils, or a dark band with cut-out letters
    const textStyle = tr < 0.42 ? 'ring' : tr < 0.7 ? 'big' : tr < 0.85 ? 'sigils' : 'knockout';
    const bandH = textStyle === 'sigils' ? fr.range(0.1, 0.14) : fr.range(0.06, 0.13);
    const blades = fr.chance(0.35);
    fr(); // (the draw that decided the groups of ticks, now gone: keeps the rest unchanged)
    const arcs = fr.chance(0.55);
    const r1 = 0.965;
    const r0 = r1 - bandH;
    const d = fresh(12);
    addLayer('frame', 1.04, 0.9, (p) => {
      const r = d();
      p.ink('a');
      circle(p, 1, style === 0 ? 2.2 : 1.6);
      if (style !== 1) circle(p, 0.985, 0.6, 0.8);
      if (style === 2) dashedCircle(p, 1.02, r.int(40, 90), 0.5, 0.7, 0.7);
      circle(p, r0, 1.2);
      if (r.chance(0.6)) circle(p, r0 - 0.012, 0.5, 0.7);
    });
    const dt = fresh(13);
    addLayer('frameText', r1 + 0.02, 0.9, (p) => {
      const r = dt();
      p.ink('b');
      if (textStyle === 'sigils') {
        p.ink(r.chance(0.5) ? 'a' : 'c');
        sigilRing(p, (r0 + r1) / 2, bandH * 0.42, r);
      } else if (textStyle === 'knockout') {
        knockoutRing(p, r0 + 0.006, r1 - 0.006, text(g.name, g.reason), r.range(0.26, 0.38));
      } else if (textStyle === 'big') {
        // few, big letters with separators (like the old grimoires)
        const n = r.pick([6, 8, 10, 12]);
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
      } else glyphRing(p, (r0 + r1) / 2, bandH, text(g.name, g.reason), { sep: r.pick(['dot', 'diamond', 'bar'] as const) });
    }, {}, 0.93);
    if (blades || arcs) {
      const reach = blades ? 1.5 : 1.22;
      const de = fresh(14);
      addLayer('frameOuter', reach, 0.85, (p) => {
        const r = de();
        if (blades) {
          // sword-like blades radiating outwards
          p.ink('c');
          const n = r.pick([8, 12, 16, 24]);
          const len = r.range(0.25, 0.45);
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
          }, r.range(0, TAU));
        }
        if (arcs) {
          p.ink('c');
          const segs = r.int(3, 9);
          for (let i = 0; i < segs; i++) {
            const t = r.range(0, TAU);
            const l = r.range(0.3, 1.2);
            const rr = r.range(1.06, 1.2);
            arc(p, rr, t, t + l, r.range(0.6, 1.2), 0.85);
            const [x, y] = polar(rr, t + l);
            dot(p, x, y, 0.012, 1);
          }
        }
      }, {}, 1.2);
    }
  }

  // ---------- 2. Satellites (often breaking out of the frame), each spinning on its own
  if (rng.chance(0.8)) {
    const sr = rng.fork(22);
    // ring: evenly on an orbit; trinity: a few big seals joined to the centre and to each other
    // (a constellation of circles); scatter: uneven sizes and gaps, the symmetry is broken
    const mode = sr.pick(['ring', 'ring', 'ring', 'trinity', 'scatter', 'scatter'] as const);
    const k = mode === 'trinity' ? sr.pick([2, 3, 3, 4]) : mode === 'scatter' ? sr.int(3, 6) : sr.pick([2, 3, 3, 4, 4, 5, 6, 7, 8]);
    const orbit = mode === 'trinity' ? sr.range(0.98, 1.1) : sr.range(0.78, 1.12);
    const base = mode === 'trinity' ? sr.range(0.27, 0.36) : Math.min(0.34, sr.range(0.12, 0.3) * (k <= 4 ? 1.25 : 0.85));
    const phase = sr.range(0, TAU);
    const jitter = mode === 'scatter' ? 0.32 : sr.chance(0.2) ? 0.3 / Math.max(1, k / 4) : 0;
    const angles = Array.from({ length: k }, (_, i) => phase + ((i + (jitter ? sr.range(-jitter, jitter) : 0)) / k) * TAU);
    const sizes = angles.map(() => (mode === 'scatter' ? base * sr.range(0.5, 1.25) : base));
    // uneven neighbours may touch but must not swallow each other
    const chord = (i: number, j: number) => 2 * orbit * Math.abs(Math.sin((angles[j] - angles[i]) / 2));
    if (k > 1) sizes.forEach((sz, i) => (sizes[i] = Math.min(sz, 0.52 * Math.min(chord(i, (i + 1) % k), chord(i, (i + k - 1) % k)))));
    if (sr.chance(0.5)) {
      addLayer('satOrbit', orbit + 0.02, 0.6, (p) => {
        p.ink('a');
        circle(p, orbit, 0.5, 0.5);
      });
    }
    if (mode === 'trinity' || sr.chance(0.4)) {
      // links from the heart of the circle to every satellite (and between them): they turn with the group
      const style = mode === 'trinity' ? sr.pick(['bars', 'bars+chain', 'lines+chain'] as const) : sr.pick(['bars', 'lines', 'lines', 'chain'] as const);
      const inner = sr.range(0.26, 0.5);
      const dl = fresh(23);
      addLayer('satLinks', orbit + base * 0.3, 0.8, (p) => {
        const r = dl();
        angles.forEach((a, i) => {
          const cx = Math.cos(a);
          const cy = Math.sin(a);
          const end = orbit - sizes[i];
          if (style.startsWith('bars')) {
            // double rail with the words running between
            const hw = Math.max(0.018, sizes[i] * 0.13);
            const nx = -cy * hw;
            const ny = cx * hw;
            p.ink('a');
            line(p, cx * inner + nx, cy * inner + ny, cx * end + nx, cy * end + ny, 1, 0.95);
            line(p, cx * inner - nx, cy * inner - ny, cx * end - nx, cy * end - ny, 1, 0.95);
            p.ink('b');
            glyphLine(p, cx * inner, cy * inner, cx * end, cy * end, hw * 1.35, words[i % 3]);
            p.ink('c');
            dot(p, cx * inner, cy * inner, hw * 0.7, 1);
          } else if (style.startsWith('lines')) {
            p.ink('a');
            line(p, cx * inner, cy * inner, cx * end, cy * end, 0.9, 0.9);
            p.ink('c');
            node(p, cx * inner, cy * inner, 0.016);
            const m = (inner + end) / 2;
            line(p, cx * m - cy * 0.03, cy * m + cx * 0.03, cx * m + cy * 0.03, cy * m - cx * 0.03, 0.9, 0.9);
          }
        });
        if (style.endsWith('chain')) {
          // the satellites joined to each other rim to rim
          p.ink('a');
          const pairs = k === 2 ? 1 : k;
          for (let i = 0; i < pairs; i++) {
            const j = (i + 1) % k;
            const [x0, y0] = polar(orbit, angles[i]);
            const [x1, y1] = polar(orbit, angles[j]);
            const len = Math.hypot(x1 - x0, y1 - y0);
            if (len < sizes[i] + sizes[j] + 0.04) continue;
            const ux = (x1 - x0) / len;
            const uy = (y1 - y0) / len;
            const ax = x0 + ux * sizes[i];
            const ay = y0 + uy * sizes[i];
            const bx = x1 - ux * sizes[j];
            const by = y1 - uy * sizes[j];
            if (r.chance(0.5)) {
              line(p, ax, ay, bx, by, 1, 0.9);
            } else {
              const o = 0.012;
              line(p, ax - uy * o, ay + ux * o, bx - uy * o, by + ux * o, 0.8, 0.9);
              line(p, ax + uy * o, ay - ux * o, bx + uy * o, by - ux * o, 0.8, 0.9);
            }
          }
        }
      }, { follow: 1, spin: 0 });
    }
    addOrbitGroup('sat', 1, orbit, sizes, angles, 0.9, (p, i) =>
      miniCircle(p, sizes[i], sr.fork(i), g, sigils[1 + (i % 4)], sizes[i] > 0.26 ? 2 : sizes[i] > 0.09 ? 1 : 0));
  }

  // ---------- 3. Main figure — varied architecture
  const fr = rng.fork(33);
  const figKind = fr.pick(['star', 'star', 'star', 'polygon', 'compound', 'compound', 'rounded', 'concave', 'glyphEdges',
    'glyphEdges', 'nested', 'triangle', 'square', 'square', 'metatron', 'flower', 'cube'] as const);
  const figR = figKind === 'square' ? fr.range(0.74, 0.86) : fr.range(0.6, 0.86);
  const figRot = figKind === 'square' ? (fr.chance(0.55) ? -Math.PI / 4 : -Math.PI / 2)
    : -Math.PI / 2 + (fr.chance(0.3) ? Math.PI / fr.int(3, 9) : 0);
  const figN = figKind === 'triangle' ? 3 : figKind === 'square' ? 4 : figKind === 'metatron' || figKind === 'cube' || figKind === 'flower' ? 6
    : fr.int(figKind === 'star' ? 5 : 3, figKind === 'star' ? 12 : 9);
  {
    const kind = figKind;
    const R = figR;
    const rot = figRot;
    const n = figN;
    const k = Math.max(2, Math.min(Math.floor((n - 1) / 2), fr.int(2, 4)));
    const vertexDecor = fr.pick(['none', 'dots', 'rings', 'medallions', 'medallions', 'spokes', 'nodes', 'nodes'] as const);
    figure = `${kind}-${n}`;
    const df = fresh(34);
    const layerR = Math.max(R * (kind === 'metatron' ? 1.3 : 1.12), R + 0.11);
    addLayer('figure', layerR, 1, (p) => {
      const r = df();
      p.ink('a');
      const pts = polygonPts(n, R, rot);
      switch (kind) {
        case 'star':
          for (const loop of starPoly(n, k, R, rot)) strokePoly(p, loop, 1.4, 1);
          if (r.chance(0.5)) {
            p.ctx.save();
            p.ctx.scale(0.95, 0.95);
            for (const loop of starPoly(n, k, R, rot)) strokePoly(p, loop, 0.6 / 0.95, 0.45);
            p.ctx.restore();
          }
          break;
        case 'triangle':
        case 'polygon':
          strokePoly(p, pts, 1.6, 1);
          if (r.chance(0.6)) strokePoly(p, polygonPts(n, R * Math.cos(Math.PI / n), rot + Math.PI / n), 0.8, 0.7);
          break;
        case 'compound': {
          const copies = r.int(2, 4);
          for (let c = 0; c < copies; c++) strokePoly(p, polygonPts(n, R, rot + (c / copies) * (TAU / n)), 1.2, 1 - c * 0.12);
          break;
        }
        case 'rounded':
          curvedPoly(p, n, R, rot, r.range(0.08, 0.3), 1.5, 1);
          curvedPoly(p, n, R * 0.9, rot + Math.PI / n, r.range(0.05, 0.2), 0.7, 0.6);
          break;
        case 'concave':
          curvedPoly(p, n, R, rot, -r.range(0.15, 0.45), 1.5, 1);
          break;
        case 'glyphEdges': {
          // letters running along the edges of the figure (two parallel rails)
          const loops = n >= 5 && r.chance(0.6) ? starPoly(n, k, R, rot) : [pts];
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
          const depth = r.int(3, 5);
          for (let d = 0; d < depth; d++) {
            const rr = R * Math.pow(Math.cos(Math.PI / n), d);
            strokePoly(p, polygonPts(n, rr, rot + (d * Math.PI) / n), 1.3 - d * 0.15, 1 - d * 0.12);
          }
          break;
        }
        case 'square': {
          // a square seal: the words run along the four sides, cells in the corners
          p.ctx.save();
          p.ctx.rotate(rot + Math.PI / 4);
          const S = R / Math.SQRT2;
          const bw = S * r.range(0.16, 0.24);
          const Si = S - bw;
          const sq = (h: number, w = 1, a = 1) => strokePoly(p, [[-h, -h], [h, -h], [h, h], [-h, h]], w, a);
          sq(S, 1.6);
          sq(Si, 1.1);
          if (r.chance(0.4)) sq(S + 0.018, 0.5, 0.7);
          const cells = r.pick(['box', 'box', 'box', 'none'] as const);
          const sides: [number, number, number, number][] = [
            [-Si, -(S - bw / 2), Si, -(S - bw / 2)], [S - bw / 2, -Si, S - bw / 2, Si],
            [Si, S - bw / 2, -Si, S - bw / 2], [-(S - bw / 2), Si, -(S - bw / 2), -Si],
          ];
          sides.forEach(([x1, y1, x2, y2], i) => {
            p.ink('b');
            const pad = cells === 'none' ? 0 : bw * 0.1;
            const dx = Math.sign(x2 - x1) * pad;
            const dy = Math.sign(y2 - y1) * pad;
            glyphLine(p, x1 + dx, y1 + dy, x2 - dx, y2 - dy, bw * 0.62, words[i % 3]);
          });
          if (cells === 'box') {
            const inside = r.pick(['dot', 'glyph', 'sigil', 'node'] as const);
            const seq = g.name.filter((x) => x >= 0);
            for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
              p.ink('a');
              line(p, sx * Si, sy * Si, sx * Si, sy * S, 1, 1);
              line(p, sx * Si, sy * Si, sx * S, sy * Si, 1, 1);
              const cx = sx * (S - bw / 2);
              const cy = sy * (S - bw / 2);
              p.ink('c');
              if (inside === 'dot') dot(p, cx, cy, bw * 0.16, 1);
              else if (inside === 'node') node(p, cx, cy, bw * 0.25);
              else {
                p.ctx.save();
                p.ctx.translate(cx, cy);
                p.ctx.globalAlpha = 1;
                if (inside === 'glyph') drawGlyph(p.ctx, seq.length ? seq[(sx + 1 + (sy + 1) * 2) % seq.length] : 0, bw * 0.62);
                else drawSigil(p.ctx, sigils[(sx + 1 + (sy + 1)) % sigils.length], bw * 0.34, 1);
                p.ctx.restore();
              }
            }
          }
          p.ink('a');
          const inner = r.pick(['diamond', 'diamondCircle', 'circle', 'window', 'diagonals'] as const);
          if (inner === 'diamond' || inner === 'diamondCircle') strokePoly(p, [[0, -Si], [Si, 0], [0, Si], [-Si, 0]], 1.1, 1);
          if (inner === 'diamondCircle' || inner === 'circle') circle(p, inner === 'circle' ? Si : Si / Math.SQRT2, 0.9, 0.9);
          if (inner === 'window') {
            const c = Si * r.range(0.22, 0.34);
            line(p, 0, -Si, 0, -c, 0.9, 0.9);
            line(p, 0, Si, 0, c, 0.9, 0.9);
            line(p, -Si, 0, -c, 0, 0.9, 0.9);
            line(p, Si, 0, c, 0, 0.9, 0.9);
            sq(c, 1, 1);
          }
          if (inner === 'diagonals') {
            line(p, -Si, -Si, -Si * 0.35, -Si * 0.35, 0.8, 0.8);
            line(p, Si, Si, Si * 0.35, Si * 0.35, 0.8, 0.8);
            line(p, Si, -Si, Si * 0.35, -Si * 0.35, 0.8, 0.8);
            line(p, -Si, Si, -Si * 0.35, Si * 0.35, 0.8, 0.8);
            circle(p, Si * 0.5, 0.9, 0.9);
          }
          p.ctx.restore();
          break;
        }
        case 'metatron': {
          // Metatron's cube: thirteen circles and the lines that join their centres
          const d = R / 2;
          const c13: [number, number][] = [[0, 0], ...polygonPts(6, d, rot), ...polygonPts(6, 2 * d, rot)];
          if (r.chance(0.6)) {
            for (let i = 1; i < 13; i++) for (let j = i + 1; j < 13; j++) line(p, c13[i][0], c13[i][1], c13[j][0], c13[j][1], 0.55, 0.38);
          } else {
            for (const loop of starPoly(6, 2, 2 * d, rot)) strokePoly(p, loop, 0.9, 0.9);
            for (const loop of starPoly(6, 2, d, rot)) strokePoly(p, loop, 0.7, 0.7);
            strokePoly(p, polygonPts(6, 2 * d, rot), 0.9, 0.8);
          }
          const cr = d * r.range(0.46, 0.5);
          c13.forEach(([x, y], i) => {
            if (i === 0) return;
            p.ctx.save();
            p.ctx.translate(x, y);
            circle(p, cr, 1, 1);
            p.ctx.restore();
          });
          break;
        }
        case 'flower': {
          // flower (or seed) of life, cut by its circle
          const rings = r.chance(0.45) ? 1 : 2;
          const rho = R / (rings + 1);
          const outer = r.chance(0.5) ? 1 : 0; // the cut arcs of the next ring, like the real flower of life
          const { ctx } = p;
          ctx.save();
          ctx.beginPath();
          ctx.arc(0, 0, R, 0, TAU);
          ctx.clip();
          ctx.rotate(rot);
          ctx.globalAlpha = 0.9;
          ctx.lineWidth = p.lw * 0.9;
          for (let a = -rings - 1; a <= rings + 1; a++) {
            for (let b = -rings - 1; b <= rings + 1; b++) {
              const hex = (Math.abs(a) + Math.abs(b) + Math.abs(a + b)) / 2;
              if (hex > rings + outer || hex === 0) continue;
              ctx.beginPath();
              ctx.arc(rho * (a + b / 2), (rho * b * Math.sqrt(3)) / 2, rho, 0, TAU);
              ctx.stroke();
            }
          }
          ctx.restore();
          circle(p, R, 1.5, 1);
          circle(p, R * 0.97, 0.6, 0.7);
          break;
        }
        case 'cube': {
          // a cube seen along its diagonal: the near corner in solid lines, the far one dashed
          strokePoly(p, pts, 1.6, 1);
          const h0 = R * 0.3;
          for (let i = 0; i < 6; i++) {
            const [x, y] = pts[i];
            const l = Math.hypot(x, y);
            if (i % 2) line(p, (x / l) * h0, (y / l) * h0, x, y, 1.2, 1);
            else dashLine(p, (x / l) * h0, (y / l) * h0, x, y, 8, 0.55, 0.8, 0.7);
          }
          if (r.chance(0.5)) {
            const inner = polygonPts(6, R * 0.5, rot);
            strokePoly(p, inner, 0.9, 0.85);
            pts.forEach(([x, y], i) => line(p, x, y, inner[i][0], inner[i][1], 0.6, 0.6));
          } else {
            for (const loop of starPoly(6, 2, R, rot)) strokePoly(p, loop, 0.6, 0.45);
            circle(p, R * Math.cos(Math.PI / 6), 0.8, 0.8);
          }
          break;
        }
      }
      if (kind !== 'flower' && r.chance(0.55)) circle(p, R, 0.8, 0.8);
      if (kind !== 'square' && kind !== 'flower' && r.chance(0.4)) circle(p, R * Math.cos(Math.PI / n) * 0.98, 0.6, 0.6);
      pts.forEach(([x, y]) => {
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
        } else if (vertexDecor === 'nodes') {
          // a node on the corner and a short stub pointing out of it
          const l = Math.hypot(x, y) || 1;
          p.ink('c');
          node(p, 0, 0, 0.022);
          line(p, (x / l) * 0.024, (y / l) * 0.024, (x / l) * 0.075, (y / l) * 0.075, 0.9, 0.9);
          dot(p, (x / l) * 0.085, (y / l) * 0.085, 0.008, 1);
        }
        p.ctx.restore();
        if (vertexDecor === 'spokes') {
          p.ink('a');
          line(p, 0, 0, x, y, 0.5, 0.5);
        }
      });
    });
    if (vertexDecor === 'medallions') {
      // medallions on the vertices: separate little circles that spin by themselves
      const size = n <= 4 ? fr.range(0.11, 0.17) : fr.range(0.06, 0.1);
      const angles = Array.from({ length: n }, (_, i) => rot + (i / n) * TAU);
      addOrbitGroup('vtx', 3, R, size, angles, 1, (p, i) => miniCircle(p, size, fr.fork(i), g, sigils[5 + (i % 3)], size > 0.1 ? 1 : 0));
    }
  }

  // ---------- 3b. Eccentric circles: big circles off the centre — on the corners of the figure,
  // passing through the centre, crossing orbits, or simply placed off balance
  if (rng.chance(0.55)) {
    const wr = rng.fork(36);
    const mode = wr.pick(['vertex', 'vertex', 'offset', 'offset', 'offset', 'rosette', 'orbits'] as const);
    const dw = fresh(37);
    addLayer('weave', 1.16, 0.75, (p) => {
      const r = dw();
      p.ink(r.chance(0.6) ? 'a' : 'c');
      const { ctx } = p;
      if (mode === 'vertex') {
        const every = figN > 6 ? 2 : 1;
        const rho = Math.min(1.12 - figR, figR * r.range(0.45, 0.8));
        const twin = r.chance(0.45);
        polygonPts(figN, figR, figRot).forEach(([x, y], i) => {
          if (i % every) return;
          ctx.save();
          ctx.translate(x, y);
          circle(p, rho, 1, 0.9);
          if (twin) circle(p, rho * 0.92, 0.5, 0.6);
          ctx.restore();
        });
      } else if (mode === 'offset') {
        const count = r.int(2, 3);
        for (let c = 0; c < count; c++) {
          const t = r.range(0, TAU);
          const d = r.range(0.14, 0.42);
          const rho = Math.min(1.1 - d, r.range(0.38, 0.7));
          ctx.save();
          ctx.translate(Math.cos(t) * d, Math.sin(t) * d);
          ctx.rotate(r.range(0, TAU));
          p.ink('a');
          circle(p, rho, 1.2, 1);
          if (r.chance(0.55)) {
            // an inscription running along the eccentric circle
            const h = r.range(0.035, 0.05);
            circle(p, rho - h, 0.6, 0.8);
            p.ink('b');
            glyphRing(p, rho - h / 2, h * 0.9, words[c % 3], { sep: 'dot', a: 0.9 });
          } else if (r.chance(0.5)) {
            p.ink('c');
            dashedCircle(p, rho - 0.02, r.int(30, 80), 0.45, 0.7, 0.8);
          }
          p.ink('c');
          const [nx, ny] = polar(rho, r.range(0, TAU));
          node(p, nx, ny, 0.02, r.chance(0.5));
          ctx.restore();
        }
      } else if (mode === 'rosette') {
        const n = r.pick([3, 4, 5, 6, 8]);
        const rho = r.range(0.3, 0.5);
        const ph = r.range(0, TAU);
        for (let i = 0; i < n; i++) {
          const [x, y] = polar(rho, ph + (i / n) * TAU);
          ctx.save();
          ctx.translate(x, y);
          circle(p, rho, 0.9, 0.85);
          ctx.restore();
        }
        circle(p, rho * 2, 0.7, 0.6);
      } else {
        const n = r.int(2, 4);
        const A = r.range(0.72, 1.05);
        const B = A * r.range(0.22, 0.42);
        const ph = r.range(0, TAU);
        for (let i = 0; i < n; i++) {
          ctx.save();
          ctx.rotate(ph + (i / n) * Math.PI);
          ctx.globalAlpha = 0.9;
          ctx.lineWidth = p.lw;
          ctx.beginPath();
          ctx.ellipse(0, 0, A, B, 0, 0, TAU);
          ctx.stroke();
          const e = r.range(0, TAU);
          p.ink('c');
          node(p, Math.cos(e) * A, Math.sin(e) * B, 0.022, true);
          p.ink('a');
          ctx.restore();
        }
      }
    });
  }

  // ---------- 4. Bands (1..3), each with a freshly grown ornament
  {
    const br = rng.fork(44);
    const bands = br.int(1, 3);
    let top = br.range(0.6, 0.74);
    // inside a square seal the rings sit within its inner square
    if (figKind === 'square') top = Math.min(top, (figR / Math.SQRT2) * 0.74);
    for (let b = 0; b < bands && top > 0.3; b++) {
      const kind = br();
      // glyph ring | dark band with cut-out letters | ring of sigils | beads | ornament
      const type = kind < 0.28 ? 'glyphs' : kind < 0.4 ? 'knockout' : kind < 0.52 ? 'sigils' : kind < 0.6 ? 'beads' : 'motif';
      const h = type === 'sigils' ? br.range(0.075, 0.11) : br.range(0.045, 0.1);
      const r1 = top;
      const r0 = r1 - h;
      const db = fresh(4400 + b);
      addLayer(`band${b}`, r1 + 0.02, 0.85, (p) => {
        const lrng = db();
        const rm = (r0 + r1) / 2;
        if (type === 'glyphs') {
          p.ink('b');
          glyphRing(p, rm, h, text(words[(b + 2) % 3], words[b % 3]), { sep: lrng.pick(['dot', 'diamond', 'bar', 'none'] as const) });
          p.ink('a');
          circle(p, r0, 0.9);
          circle(p, r1, 0.9);
        } else if (type === 'knockout') {
          knockoutRing(p, r0, r1, text(words[(b + 1) % 3], words[b % 3]), lrng.range(0.26, 0.4));
          p.ink('a');
          circle(p, r0, 0.9);
          circle(p, r1, 0.9);
        } else if (type === 'sigils') {
          p.ink(lrng.chance(0.6) ? 'a' : 'c');
          sigilRing(p, rm, h * 0.42, lrng);
          if (lrng.chance(0.5)) {
            p.ink('a');
            circle(p, r0, 0.6, 0.7);
            circle(p, r1, 0.6, 0.7);
          }
        } else if (type === 'beads') {
          // a string of small circles, each holding a letter, a dot or a moon
          const q = h * 0.4;
          const n = Math.max(8, Math.floor((TAU * rm) / (q * 2.3)));
          const seq = words[b % 3].filter((x) => x >= 0);
          const inside = lrng.pick(['glyph', 'glyph', 'dot', 'moon'] as const);
          p.ink('a');
          circle(p, rm, 0.6, 0.7);
          around(p, n, rm, (i) => {
            disc(p, q);
            p.ink('c');
            circle(p, q, 0.9, 1);
            p.ctx.globalAlpha = 1;
            if (inside === 'glyph') {
              p.ink('b');
              drawGlyph(p.ctx, seq.length ? seq[i % seq.length] : i, q * 1.3);
            } else if (inside === 'dot') dot(p, 0, 0, q * 0.35, 1);
            else crescent(p, 0, 0, q * 0.6, -Math.PI / 2 + (i % 2) * Math.PI, 0.45);
            p.ink('a');
          });
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
  if (rng.chance(0.5)) {
    const mr = rng.fork(55);
    const k = mr.pick([3, 4, 4, 5, 6]);
    const orbit = mr.range(0.34, 0.5);
    const size = mr.range(0.1, 0.16);
    const phase = -Math.PI / 2 + (mr.chance(0.5) ? Math.PI / k : 0);
    addLayer('medRing', orbit + 0.02, 0.85, (p) => {
      p.ink('a');
      circle(p, orbit, 1.2, 0.9);
    });
    const angles = Array.from({ length: k }, (_, i) => phase + (i / k) * TAU);
    addOrbitGroup('med', 2, orbit, size, angles, 0.95, (p, i) => miniCircle(p, size, mr.fork(i), g, sigils[(i % 3) + 6], 1));
  }

  // ---------- 6. Mechanism: gear, lattice or string art
  if (rng.chance(0.6)) {
    const gr = rng.fork(66);
    const kind = gr.pick(['gear', 'lattice', 'chords', 'seed'] as const);
    const R = gr.range(0.28, 0.46);
    const dm = fresh(67);
    addLayer('mechanism', R + 0.04, 0.7, (p) => {
      const r = dm();
      p.ink(r.chance(0.5) ? 'a' : 'c');
      if (kind === 'gear') {
        const teeth = r.int(24, 64);
        const { ctx } = p;
        ctx.lineWidth = p.lw;
        ctx.globalAlpha = 0.95;
        ctx.beginPath();
        for (let i = 0; i < teeth; i++) {
          const a0 = (i / teeth) * TAU;
          const s = [[R * 0.93, a0], [R, a0 + (0.2 * TAU) / teeth], [R, a0 + (0.5 * TAU) / teeth], [R * 0.93, a0 + (0.7 * TAU) / teeth]] as const;
          s.forEach(([rr, a], j) => {
            const [x, y] = polar(rr, a);
            if (i === 0 && j === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
        }
        ctx.closePath();
        ctx.stroke();
        const sp = r.int(3, 8);
        for (let i = 0; i < sp; i++) {
          const t = (i / sp) * TAU;
          const [x1, y1] = polar(R * 0.25, t);
          const [x2, y2] = polar(R * 0.88, t);
          line(p, x1, y1, x2, y2, 1.4, 0.9);
        }
        circle(p, R * 0.88, 0.8);
        circle(p, R * 0.25, 1);
      } else if (kind === 'lattice') {
        const n = r.int(6, 12);
        const rr = R * 0.5;
        circle(p, rr, 0.8, 0.8);
        around(p, n, rr, () => circle(p, rr, 0.6, 0.6));
      } else if (kind === 'chords') {
        const n = r.int(9, 19);
        const k = Math.max(2, Math.floor(n / r.range(2.1, 3.5)));
        const pts = polygonPts(n, R, -Math.PI / 2);
        for (let i = 0; i < n; i++) line(p, pts[i][0], pts[i][1], pts[(i + k) % n][0], pts[(i + k) % n][1], 0.7, 0.75);
        p.ink('c');
        pts.forEach(([x, y]) => dot(p, x, y, 0.009, 1));
      } else {
        const n = r.pick([6, 8, 12]);
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
    const kind = cr.pick(['sigil', 'sigil', 'spiral', 'letter', 'eye', 'crescent', 'sun', 'lotus', 'eyeTri', 'bigSigil', 'bigSigil'] as const);
    const thick = cr.chance(0.4);
    const dc = fresh(78);
    // a big brush sigil needs no seal around it: it stands alone in the middle of the circle
    const big = kind === 'bigSigil';
    addLayer('core', big ? R * 1.9 + 0.05 : R + 0.03, 1.1, (p) => {
      const r = dc();
      if (big) {
        p.ink('c');
        p.ctx.globalAlpha = 1;
        drawSigil(p.ctx, sigils[0], R * 1.8, 0.85);
        return;
      }
      disc(p, R);
      p.ink('a');
      if (thick) {
        // a glowing annulus, like the heart of the seal
        p.ctx.globalAlpha = 0.42;
        p.ctx.beginPath();
        p.ctx.arc(0, 0, R, 0, TAU);
        p.ctx.arc(0, 0, R * 0.86, 0, TAU, true);
        p.ctx.fill('evenodd');
        p.erase();
        dashedCircle(p, R * 0.93, r.int(8, 20), 0.12, 1.4, 1);
        p.ink('a');
      } else {
        circle(p, R, 1.4);
        circle(p, R * 0.92, 0.6, 0.7);
      }
      const inner = R * (thick ? 0.78 : 0.88);
      if (r.chance(0.55)) {
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
        const arms = r.int(3, 6);
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
      } else if (kind === 'crescent') {
        // a moon holding a small star (or a dot)
        p.ink('c');
        crescent(p, 0, 0, e * 0.95, -Math.PI / 2 + (r.chance(0.3) ? Math.PI : 0), r.range(0.35, 0.5), true, 1, 0.7);
        p.ink('a');
        if (r.chance(0.6)) for (const loop of starPoly(5, 2, e * 0.3, -Math.PI / 2)) strokePoly(p, loop, 0.9, 1);
        else dot(p, 0, 0, e * 0.12, 1);
      } else if (kind === 'sun') {
        p.ink('c');
        sunRays(p, e * 0.48, e * 1.02, r.pick([12, 16, 20, 24]), r.chance(0.5));
        circle(p, e * 0.48, 1.2, 1);
        p.ink('a');
        drawSigil(p.ctx, sigils[0], e * 0.32, 1);
      } else if (kind === 'lotus') {
        p.ink('c');
        lotus(p, e, r.pick([6, 8, 10, 12]), r.int(1, 2), 1);
        p.ink('a');
        circle(p, e * 0.18, 1, 1);
        dot(p, 0, 0, e * 0.07, 1);
      } else if (kind === 'eyeTri') {
        // the eye inside a triangle, with short rays around it
        p.ink('a');
        const tri = polygonPts(3, e * 1.05, -Math.PI / 2);
        strokePoly(p, tri, 1.3, 1);
        p.ink('c');
        const s = e * 0.42;
        p.ctx.lineWidth = p.lw * 1.1;
        p.ctx.beginPath();
        p.ctx.moveTo(-s, e * 0.12);
        p.ctx.quadraticCurveTo(0, e * 0.12 - s * 0.75, s, e * 0.12);
        p.ctx.quadraticCurveTo(0, e * 0.12 + s * 0.75, -s, e * 0.12);
        p.ctx.stroke();
        dot(p, 0, e * 0.12, s * 0.26, 1);
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
    }, {}, R + 0.03);
  }

  // ---------- 7b. Axis: a line through the whole circle with stations on it, breaking out of the
  // frame at both ends (mirror symmetry only, the two ends differ)
  if (rng.chance(0.3)) {
    const ar = rng.fork(79);
    const reach = ar.range(1.15, 1.4);
    const cross = ar.chance(0.45);
    const crossReach = ar.range(0.95, 1.2);
    const tilt = ar.chance(0.6) ? 0 : ar.range(0, TAU);
    const da = fresh(80);
    addLayer('axis', reach + 0.1, 0.85, (p) => {
      const r = da();
      const { ctx } = p;
      ctx.rotate(tilt);
      const hole = r.range(0.2, 0.3); // keeps the core clear
      const dbl = r.chance(0.4);
      p.ink('a');
      for (const s of [-1, 1]) {
        const y0 = s * hole;
        const y1 = s * reach * 0.9;
        if (dbl) {
          line(p, -0.011, y0, -0.011, y1, 0.8, 0.95);
          line(p, 0.011, y0, 0.011, y1, 0.8, 0.95);
        } else line(p, 0, y0, 0, y1, 1.2, 1);
      }
      for (const s of [-1, 1]) {
        const y = s * reach * 0.9;
        const cap = r.pick(['node', 'crescent', 'arrow', 'trident', 'ring', 'diamond', 'triangle'] as const);
        p.ink('c');
        const q = r.range(0.035, 0.06);
        if (cap === 'node') node(p, 0, y + s * q * 0.6, q * 0.6, r.chance(0.4));
        else if (cap === 'crescent') crescent(p, 0, y + s * q * 0.5, q, s * (Math.PI / 2), 0.45);
        else if (cap === 'arrow') {
          line(p, 0, y + s * q, -q * 0.7, y, 1, 1);
          line(p, 0, y + s * q, q * 0.7, y, 1, 1);
          line(p, 0, y, 0, y + s * q, 1, 1);
        } else if (cap === 'trident') {
          line(p, -q, y, q, y, 1, 1);
          line(p, -q, y, -q, y + s * q, 1, 1);
          line(p, q, y, q, y + s * q, 1, 1);
          line(p, 0, y, 0, y + s * q * 1.4, 1, 1);
        } else if (cap === 'ring') {
          ctx.save();
          ctx.translate(0, y + s * q);
          circle(p, q, 1, 1);
          dot(p, 0, 0, q * 0.3, 1);
          ctx.restore();
        } else if (cap === 'diamond') {
          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(q * 0.5, y + s * q);
          ctx.lineTo(0, y + s * q * 2);
          ctx.lineTo(-q * 0.5, y + s * q);
          ctx.closePath();
          ctx.fill();
        } else strokePoly(p, [[0, y + s * q * 1.3], [q * 0.8, y], [-q * 0.8, y]], 1, 1);
        // cross-bars ending in nodes
        const bars = r.int(0, 2);
        for (let b = 0; b < bars; b++) {
          const yb = s * r.range(0.4, reach * 0.8);
          const hw = r.range(0.06, 0.16);
          p.ink('a');
          line(p, -hw, yb, hw, yb, 0.9, 0.95);
          p.ink('c');
          node(p, -hw, yb, 0.014);
          node(p, hw, yb, 0.014);
        }
        // a small ring strung on the axis
        if (r.chance(0.6)) {
          p.ink('c');
          node(p, 0, s * r.range(hole + 0.08, 0.75), r.range(0.025, 0.045), r.chance(0.3));
        }
      }
      if (cross) {
        p.ink('a');
        for (const s of [-1, 1]) {
          line(p, s * hole, 0, s * crossReach, 0, 0.8, 0.85);
          p.ink('c');
          node(p, s * crossReach, 0, 0.018, true);
          p.ink('a');
        }
      }
    }, { spin: ar.range(0.015, 0.05) * ar.sign() });
  }

  rng(); // (the draw that decided the trail of beads, now gone: keeps the rest unchanged)

  // ---------- 8. Faint giant geometry behind everything (big triangles / lines)
  if (rng.chance(0.55)) {
    const hr = rng.fork(88);
    const n = hr.pick([3, 4, 6]);
    const rot = hr.range(0, TAU);
    const spokes = hr.pick([4, 6, 8]);
    addLayer('ghost', 1.05, 0.35, (p) => {
      p.ink('a');
      for (const loop of starPoly(n * 2, 2, 1, rot)) strokePoly(p, loop, 0.6, 0.5);
      for (let i = 0; i < spokes; i++) {
        const [x, y] = polar(1, (i / spokes) * TAU);
        line(p, 0, 0, x, y, 0.4, 0.35);
      }
    }, { zSlot: -0.6 });
  }



  // ---------- 9. Hanging inscriptions: rings framing the certificate at the end
  {
    const hr = rng.fork(99);
    const count = hr.int(1, 2);
    for (let i = 0; i < count; i++) {
      // radius chosen so that, lifted up to the certificate, it frames the sheet
      const R = 0.66 + i * 0.1 + hr.range(0, 0.05);
      const h = hr.range(0.04, 0.06);
      const dashes = hr.chance(0.6) ? [hr.int(20, 60), hr.int(20, 60)] : null;
      addLayer(`hang${i}`, R + h, 0.55, (p) => {
        p.ink('b');
        glyphRing(p, R, h, text(words[(i + 1) % 3], words[i % 3]), { sep: 'diamond' });
        p.ink('a');
        if (dashes) {
          dashedCircle(p, R + h * 0.75, dashes[0], 0.5, 0.6, 0.8);
          dashedCircle(p, R - h * 0.75, dashes[1], 0.5, 0.6, 0.8);
        }
      }, { hang: true, zSlot: 2 + i });
    }
  }

  // ---------- tunnel pieces: rings, sigils and inscriptions (the flight + the tunnel below)
  const passers: PasserArt[] = [];
  for (let i = 0; i < 6; i++) {
    const kind = i % 6;
    const dp = fresh(500 + i);
    passers.push({
      radius: 1.08,
      draw: (p) => {
        const pr = dp();
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
