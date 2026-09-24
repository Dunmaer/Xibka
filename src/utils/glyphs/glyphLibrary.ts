// Loads the 32 hand-drawn infernal letters from glyphs.svg (a copy of "infernal pact/symbols.svg")
// and exposes them as Path2D objects normalised to a unit box, ready for canvas drawing.
import glyphsSvg from '../../assets/glyphs.svg?raw';

export interface Glyph {
  paths: Path2D[];
  /** Bounding box in SVG units. */
  x: number;
  y: number;
  w: number;
  h: number;
}

let cache: Glyph[] | null = null;

export function getGlyphs(): Glyph[] {
  if (cache) return cache;
  const doc = new DOMParser().parseFromString(glyphsSvg, 'image/svg+xml');
  const root = doc.documentElement;
  const groups = Array.from(root.children).filter((el) => el.tagName.toLowerCase() === 'g');

  // Measure every glyph with a hidden live SVG (getBBox needs layout).
  const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  host.setAttribute('viewBox', root.getAttribute('viewBox') ?? '0 0 255 407.29');
  host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden';
  document.body.appendChild(host);

  cache = groups.map((g) => {
    const live = document.importNode(g, true) as SVGGElement;
    host.appendChild(live);
    let bb = { x: 0, y: 0, width: 255, height: 407 };
    try {
      const b = live.getBBox();
      if (b.width > 0 && b.height > 0) bb = b;
    } catch {
      /* keep the default box */
    }
    host.removeChild(live);
    const paths = Array.from(g.querySelectorAll('path'))
      .map((p) => p.getAttribute('d'))
      .filter((d): d is string => !!d)
      .map((d) => new Path2D(d));
    return { paths, x: bb.x, y: bb.y, w: bb.width, h: bb.height };
  });
  document.body.removeChild(host);
  return cache;
}

/**
 * Draws glyph `i` centred at the current origin, `size` = glyph height in current units.
 * The caller sets fillStyle / shadow / transforms.
 */
export function drawGlyph(ctx: CanvasRenderingContext2D, i: number, size: number) {
  const glyphs = getGlyphs();
  const g = glyphs[((i % glyphs.length) + glyphs.length) % glyphs.length];
  const s = size / Math.max(g.h, 1);
  ctx.save();
  ctx.scale(s, s);
  ctx.translate(-(g.x + g.w / 2), -(g.y + g.h / 2));
  for (const p of g.paths) ctx.fill(p);
  ctx.restore();
}

/** Width of glyph `i` when drawn at height `size`. */
export function glyphWidth(i: number, size: number): number {
  const glyphs = getGlyphs();
  const g = glyphs[((i % glyphs.length) + glyphs.length) % glyphs.length];
  return (g.w / Math.max(g.h, 1)) * size;
}
