// The magic circle is a stack of separate layers (like the gears of an opened watch).
// Each layer is drawn here in unit space; the 3D engine places every layer at its own depth.
import type { RitualParams } from '../params';
import { makeRng } from '../../../utils/seed/seed';
import { drawGlyph } from '../../../utils/glyphs/glyphLibrary';
import {
  around, arc, bandBlockWithGlyphs, circle, DISC_BLOCKS, dot, glyphBand, line, type Pen,
} from './patterns';

const TAU = Math.PI * 2;

export interface LayerArt {
  id: string;
  /** Outer radius of the drawing in unit space. */
  radius: number;
  /** Depth slot; multiplied by the current spread to get the world Z. */
  zSlot: number;
  /** Frames (of pribliji.mp4) when this layer burns in. */
  reveal: [number, number];
  /** Base brightness. */
  intensity: number;
  draw: (p: Pen) => void;
}

export function buildLayers(P: RitualParams): LayerArt[] {
  const bands = bandBlockWithGlyphs(P.glyphs.punishment);
  const rngFor = (salt: number) => makeRng(P.seed).fork(salt);
  const text = (a: number[], b: number[]) => [...a, -1, -1, ...b];

  const foundation: LayerArt = {
    id: 'foundation',
    radius: 1.0,
    zSlot: 0,
    reveal: [175, 199],
    intensity: 0.85,
    draw: (p) => {
      const rng = rngFor(1);
      circle(p, 1.0, 1.8);
      circle(p, 0.982, 0.7, 0.8);
      glyphBand(p, 0.935, 0.072, text(P.glyphs.name, P.glyphs.reason), 1);
      circle(p, 0.888, 1.3);
      bands[P.outerBand](p, 0.8, 0.874, rng);
      circle(p, 0.792, 0.9, 0.85);
      // anchor medallions sitting on the outer rim
      around(p, P.anchors, 1.0, () => {
        p.ctx.save();
        p.ctx.globalCompositeOperation = 'destination-out';
        dot(p, 0, 0, 0.04, 1);
        p.ctx.restore();
        circle(p, 0.04, 1.1);
        circle(p, 0.026, 0.6, 0.8);
        dot(p, 0, 0, 0.01, 1);
      });
    },
  };

  const star: LayerArt = {
    id: 'star',
    radius: 0.8,
    zSlot: 0.9,
    reveal: [180, 203],
    intensity: 0.85,
    draw: (p) => {
      const { ctx } = p;
      const n = P.starPoints;
      const k = P.starStep;
      const R = 0.765;
      const pts = Array.from({ length: n }, (_, i) => {
        const t = (i / n) * TAU - Math.PI / 2;
        return [Math.cos(t) * R, Math.sin(t) * R] as const;
      });
      // polygram {n/k}
      ctx.lineWidth = p.lw * 1.4;
      ctx.globalAlpha = 1;
      ctx.lineJoin = 'miter';
      const visited = new Set<number>();
      for (let s = 0; s < n; s++) {
        if (visited.has(s)) continue;
        ctx.beginPath();
        let i = s;
        ctx.moveTo(pts[i][0], pts[i][1]);
        do {
          visited.add(i);
          i = (i + k) % n;
          ctx.lineTo(pts[i][0], pts[i][1]);
        } while (i !== s);
        ctx.stroke();
      }
      // echo lines just inside the star for a double-struck look
      ctx.save();
      ctx.scale(0.955, 0.955);
      ctx.lineWidth = (p.lw * 0.6) / 0.955;
      ctx.globalAlpha = 0.45;
      visited.clear();
      for (let s = 0; s < n; s++) {
        if (visited.has(s)) continue;
        ctx.beginPath();
        let i = s;
        ctx.moveTo(pts[i][0], pts[i][1]);
        do {
          visited.add(i);
          i = (i + k) % n;
          ctx.lineTo(pts[i][0], pts[i][1]);
        } while (i !== s);
        ctx.stroke();
      }
      ctx.restore();
      circle(p, R, 0.8, 0.8);
      // inscribed circle touching the star's inner vertices
      const inner = (R * Math.cos((Math.PI * k) / n)) / Math.cos(Math.PI / n);
      circle(p, Math.abs(inner) * 0.98, 0.7, 0.6);
      // vertex medallions carrying letters of the punishment
      const seq = P.glyphs.punishment.filter((g) => g >= 0);
      pts.forEach(([x, y], i) => {
        ctx.save();
        ctx.translate(x, y);
        ctx.globalCompositeOperation = 'destination-out';
        dot(p, 0, 0, 0.064, 1);
        ctx.globalCompositeOperation = 'source-over';
        circle(p, 0.064, 1.2);
        circle(p, 0.052, 0.5, 0.7);
        ctx.rotate(Math.atan2(y, x) + Math.PI / 2);
        ctx.globalAlpha = 1;
        drawGlyph(ctx, seq.length ? seq[i % seq.length] : i * 7, 0.07);
        ctx.restore();
      });
    },
  };

  const band: LayerArt = {
    id: 'band',
    radius: 0.64,
    zSlot: 1.8,
    reveal: [185, 206],
    intensity: 0.75,
    draw: (p) => {
      const rng = rngFor(3);
      circle(p, 0.64, 1.3);
      bands[P.midBand](p, 0.565, 0.628, rng);
      circle(p, 0.556, 0.9);
      glyphBand(p, 0.522, 0.052, text(P.glyphs.punishment, P.glyphs.name), 0.95);
      circle(p, 0.49, 1.1);
    },
  };

  const gear: LayerArt = {
    id: 'gear',
    radius: 0.47,
    zSlot: 2.7,
    reveal: [189, 209],
    intensity: 0.62,
    draw: (p) => {
      const { ctx } = p;
      const teeth = P.gearTeeth;
      const r0 = 0.425;
      const r1 = 0.455;
      ctx.lineWidth = p.lw * 1.1;
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      for (let i = 0; i < teeth; i++) {
        const a0 = (i / teeth) * TAU;
        const a1 = ((i + 0.18) / teeth) * TAU;
        const a2 = ((i + 0.5) / teeth) * TAU;
        const a3 = ((i + 0.68) / teeth) * TAU;
        const a4 = ((i + 1) / teeth) * TAU;
        const P2 = (r: number, a: number) => [Math.cos(a) * r, Math.sin(a) * r] as const;
        const seq = [P2(r0, a0), P2(r1, a1), P2(r1, a2), P2(r0, a3), P2(r0, a4)];
        seq.forEach(([x, y], j) => (i === 0 && j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      }
      ctx.closePath();
      ctx.stroke();
      circle(p, 0.4, 1);
      circle(p, 0.385, 0.5, 0.6);
      // spokes: double lines with a hollow between (watch wheel)
      const s = P.spokes;
      for (let i = 0; i < s; i++) {
        const t = (i / s) * TAU;
        ctx.save();
        ctx.rotate(t);
        line(p, -0.018, -0.385, -0.018, -0.13, 0.9, 0.9);
        line(p, 0.018, -0.385, 0.018, -0.13, 0.9, 0.9);
        dot(p, 0, -0.26, 0.012, 1);
        ctx.restore();
        // cut-out arcs between the spokes
        arc(p, 0.34, t + 0.22, t + TAU / s - 0.22, 0.7, 0.55);
        arc(p, 0.18, t + 0.3, t + TAU / s - 0.3, 0.7, 0.55);
      }
      circle(p, 0.13, 1.1);
      circle(p, 0.1, 0.6, 0.7);
    },
  };

  const inner: LayerArt = {
    id: 'inner',
    radius: 0.335,
    zSlot: 3.6,
    reveal: [193, 211],
    intensity: 0.8,
    draw: (p) => {
      const rng = rngFor(5);
      circle(p, 0.33, 1.2);
      bands[P.innerBand](p, 0.262, 0.318, rng);
      circle(p, 0.252, 0.9);
      DISC_BLOCKS[P.innerDisc](p, 0.235, rng);
    },
  };

  const core: LayerArt = {
    id: 'core',
    radius: 0.2,
    zSlot: 4.6,
    reveal: [197, 213],
    intensity: 0.95,
    draw: (p) => {
      const rng = rngFor(6);
      circle(p, 0.195, 1.2);
      circle(p, 0.182, 0.5, 0.7);
      DISC_BLOCKS[P.coreDisc](p, 0.17, rng);
      const first = P.glyphs.name.find((g) => g >= 0) ?? 0;
      p.ctx.save();
      p.ctx.globalCompositeOperation = 'destination-out';
      dot(p, 0, 0, 0.056, 1);
      p.ctx.restore();
      circle(p, 0.056, 1.1);
      p.ctx.globalAlpha = 1;
      drawGlyph(p.ctx, first, 0.075);
    },
  };

  const halo: LayerArt = {
    id: 'halo',
    radius: 1.13,
    zSlot: 1.3,
    reveal: [200, 216],
    intensity: 0.5,
    draw: (p) => {
      const rng = rngFor(7);
      const segs = rng.pick([7, 9, 11]);
      for (let i = 0; i < segs; i++) {
        const t = (i / segs) * TAU;
        const len = (TAU / segs) * rng.range(0.45, 0.8);
        arc(p, 1.085, t, t + len, 1, 0.9);
        arc(p, 1.105, t + len * 0.1, t + len * 0.6, 0.6, 0.6);
        const [x, y] = [Math.cos(t + len) * 1.085, Math.sin(t + len) * 1.085];
        dot(p, x, y, 0.01, 1);
      }
      around(p, 90, 1.06, (i) => {
        if (i % 3) dot(p, 0, 0, 0.0035, 0.7);
      });
      // three short inscriptions
      const words = [P.glyphs.name, P.glyphs.punishment, P.glyphs.reason];
      for (let w = 0; w < 3; w++) {
        const seq = words[w].filter((g) => g >= 0).slice(0, 9);
        const base = (w / 3) * TAU + 0.4;
        seq.forEach((g, i) => {
          p.ctx.save();
          p.ctx.rotate(base + i * 0.045);
          p.ctx.translate(0, -1.125);
          p.ctx.globalAlpha = 0.85;
          drawGlyph(p.ctx, g, 0.04);
          p.ctx.restore();
        });
      }
    },
  };

  return [foundation, halo, star, band, gear, inner, core];
}

/** Draws the full stack flat (used for the certificate watermark). */
export function drawFlatCircle(ctx: CanvasRenderingContext2D, P: RitualParams, lw: number) {
  const layers = buildLayers(P);
  for (const l of layers) {
    ctx.save();
    l.draw({ ctx, lw });
    ctx.restore();
  }
}

