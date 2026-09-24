// Colour of a curse. Every ritual gets its own palette from the whole colour wheel:
// three inks (A = structure, B = inscriptions, C = accents) + a white-hot highlight.
import type { Rng } from '../../../utils/seed/seed';

export type RGB = [number, number, number];

export interface Palette {
  name: string;
  /** Structure lines, rings, polygons. */
  a: RGB;
  /** Inscriptions and letters. */
  b: RGB;
  /** Accents: satellites, nodes, dots. */
  c: RGB;
  /** White-hot highlight (burn-in front, flashes). */
  hot: RGB;
  /** Deep tone for dim parts. */
  deep: RGB;
  /** Hue of A in degrees, used by CSS / certificate. */
  hue: number;
}

export function hsv(h: number, s: number, v: number): RGB {
  h = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

const mix = (p: RGB, q: RGB, t: number): RGB => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];

/**
 * Hue families and how often they come up. A plain uniform pick over the hue circle gives a lot
 * of green/cyan/blue (they span a wide part of the wheel), so the warm infernal colours get
 * extra weight: red, crimson, orange and gold show up noticeably more often.
 */
const HUES: { from: number; to: number; weight: number }[] = [
  { from: 345, to: 375, weight: 16 }, // red / crimson
  { from: 15, to: 32, weight: 10 }, // orange / ember
  { from: 32, to: 58, weight: 13 }, // gold / yellow
  { from: 58, to: 150, weight: 12 }, // lime / green
  { from: 150, to: 200, weight: 8 }, // teal / cyan
  { from: 200, to: 250, weight: 10 }, // blue
  { from: 250, to: 295, weight: 10 }, // violet
  { from: 295, to: 345, weight: 12 }, // magenta / pink
];

function pickHue(rng: Rng): number {
  const total = HUES.reduce((s, h) => s + h.weight, 0);
  let r = rng() * total;
  for (const h of HUES) {
    r -= h.weight;
    if (r <= 0) return rng.range(h.from, h.to) % 360;
  }
  return rng.range(0, 360);
}

/**
 * One hue per curse. The three inks are the same hue in different strength:
 * A = saturated lines, B = paler inscriptions, C = deep, rich accents.
 */
export function makePalette(rng: Rng): Palette {
  const roll = rng();
  // rare near-white "holy silver" circle (still a single, faint hue)
  if (roll < 0.025) {
    const h = rng.range(0, 360);
    return finish('silver', hsv(h, 0.1, 1), hsv(h, 0.04, 1), hsv(h, 0.22, 0.95), h);
  }
  const h = pickHue(rng);
  const sat = rng.range(0.72, 0.98);
  const a = hsv(h, sat, 1);
  const b = hsv(h, sat * rng.range(0.35, 0.6), 1);
  const c = hsv(h, Math.min(1, sat + 0.1), rng.range(0.72, 0.88));
  return finish(`hue ${Math.round(h)}`, a, b, c, h);
}

function finish(name: string, a: RGB, b: RGB, c: RGB, hue: number): Palette {
  return {
    name,
    a,
    b,
    c,
    hot: mix(mix(a, c, 0.3), [1, 1, 1], 0.72),
    deep: mix(a, [0, 0, 0], 0.7),
    hue,
  };
}

/** A slightly shifted copy of the palette for one layer (keeps the curse's harmony, adds life). */
export function layerPalette(p: Palette, rng: Rng): Palette {
  const roll = rng();
  // Some layers swap roles so inscriptions or accents can lead.
  if (roll < 0.25) return { ...p, a: p.b, b: p.a };
  if (roll < 0.4) return { ...p, a: p.c, c: p.a };
  return p;
}

export function cssColor(c: RGB, alpha = 1) {
  return `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${alpha})`;
}
