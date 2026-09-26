// Hand-drawn signs from signs.svg ("Symbol 2 grp"): a few unique ones are used as emblems in the
// large structures of the magic circle (totem heads, poles, wing centres, constellation stars).
// Every sign is a filled silhouette, normalised to a unit box and drawn as Path2D.
import signsSvg from '../../assets/signs.svg?raw';

/**
 * The signs that are used, by their order in the file.
 * Layer_1 (plain emblems): 0 spiral, 1 triskelion, 2 triquetra, 4 flame, 5 cross, 8 tree, 11 crowned skull.
 * Layer_2 (ornate, tall): 12 horned spike, 13 haloed wings, 14 bat wings, 15 moons and star,
 * 16 triple moon, 17 eclipse, 18 eye, 19 four stars.
 */
export const EMBLEM_SIGNS = [0, 1, 2, 4, 5, 8, 11] as const;
export const ORNATE_SIGNS = [12, 13, 14, 15, 16, 17, 18, 19] as const;
/** Symmetric enough to stand upright on an axis (totems, poles, wings). */
export const UPRIGHT_SIGNS = [5, 11, 12, 13, 14, 15, 16, 17, 18, 19] as const;

interface Sign {
  paths: Path2D[];
  x: number;
  y: number;
  w: number;
  h: number;
}

let cache: Sign[] | null = null;

function load(): Sign[] {
  if (cache) return cache;
  const doc = new DOMParser().parseFromString(signsSvg, 'image/svg+xml');
  const root = doc.documentElement;
  const items = Array.from(root.children)
    .filter((el) => el.tagName.toLowerCase() === 'g')
    .flatMap((layer) => Array.from(layer.children));
  const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  host.setAttribute('viewBox', root.getAttribute('viewBox') ?? '0 0 850 850');
  host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden';
  document.body.appendChild(host);
  cache = items.map((el) => {
    const live = document.importNode(el, true) as SVGGraphicsElement;
    host.appendChild(live);
    let bb = { x: 0, y: 0, width: 850, height: 850 };
    try {
      const b = live.getBBox();
      if (b.width > 0 && b.height > 0) bb = b;
    } catch {
      /* keep the default box */
    }
    host.removeChild(live);
    const shapes = [el, ...Array.from(el.querySelectorAll('*'))];
    const paths: Path2D[] = [];
    for (const s of shapes) {
      const tag = s.tagName.toLowerCase();
      const num = (a: string) => Number(s.getAttribute(a) ?? 0);
      if (tag === 'path') {
        const d = s.getAttribute('d');
        if (d) paths.push(new Path2D(d));
      } else if (tag === 'circle') {
        const p = new Path2D();
        p.arc(num('cx'), num('cy'), num('r'), 0, Math.PI * 2);
        paths.push(p);
      } else if (tag === 'ellipse') {
        const p = new Path2D();
        p.ellipse(num('cx'), num('cy'), num('rx'), num('ry'), 0, 0, Math.PI * 2);
        paths.push(p);
      } else if (tag === 'polygon' || tag === 'polyline') {
        const pts = (s.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number);
        if (pts.length >= 4) paths.push(new Path2D(`M${pts.slice(0, 2).join(',')}L${pts.slice(2).join(',')}Z`));
      }
    }
    return { paths, x: bb.x, y: bb.y, w: bb.width, h: bb.height };
  });
  document.body.removeChild(host);
  return cache;
}

/** Draws sign `i` centred at the origin; `size` = half of its larger side. */
export function drawSign(ctx: CanvasRenderingContext2D, i: number, size: number) {
  const signs = load();
  const s = signs[((i % signs.length) + signs.length) % signs.length];
  const k = (size * 2) / Math.max(s.w, s.h, 1);
  ctx.save();
  ctx.scale(k, k);
  ctx.translate(-(s.x + s.w / 2), -(s.y + s.h / 2));
  for (const p of s.paths) ctx.fill(p);
  ctx.restore();
}

/** Width / height of sign `i`. */
export function signAspect(i: number): number {
  const signs = load();
  const s = signs[((i % signs.length) + signs.length) % signs.length];
  return s.w / Math.max(s.h, 1);
}
