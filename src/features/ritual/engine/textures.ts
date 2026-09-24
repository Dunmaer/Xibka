import * as THREE from 'three';
import type { Ink, Pen } from '../art/generator';
import { drawGlyph, getGlyphs } from '../../../utils/glyphs/glyphLibrary';

/** Extra room around a layer so its glow is not clipped. */
export const LAYER_MARGIN = 1.08;

const CHANNEL: Record<Ink, string> = { a: '#ff0000', b: '#00ff00', c: '#0000ff' };

function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** A pen that writes each ink into its own colour channel of a black canvas. */
export function channelPen(ctx: CanvasRenderingContext2D, lw: number): Pen {
  const pen: Pen = {
    ctx,
    lw,
    ink: (c) => {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = CHANNEL[c];
      ctx.fillStyle = CHANNEL[c];
    },
    erase: () => {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = '#000';
      ctx.fillStyle = '#000';
    },
  };
  pen.ink('a');
  return pen;
}

/** Repeated 2x downsampling = cheap, good-looking blur. */
function downsample(src: HTMLCanvasElement, factor: number): HTMLCanvasElement {
  let cur = src;
  let f = 1;
  while (f < factor) {
    const next = makeCanvas(Math.max(2, Math.round(cur.width / 2)), Math.max(2, Math.round(cur.height / 2)));
    const ctx = next.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, next.width, next.height);
    cur = next;
    f *= 2;
  }
  return cur;
}

function canvasTexture(c: HTMLCanvasElement, mipmaps: boolean) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = mipmaps;
  t.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

export interface LayerTextures {
  core: THREE.Texture;
  glow: THREE.Texture;
  /** Half size of the textured square in unit space. */
  extent: number;
}

/** Draws a layer (unit space) into an RGB canvas + a blurred glow copy. */
export function renderChannelTextures(
  radius: number, draw: (p: Pen) => void, maxSize: number, density: number, lw: number,
): LayerTextures {
  const extent = radius * LAYER_MARGIN;
  const size = Math.max(256, Math.min(maxSize, Math.round(2 * extent * density)));
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  const k = size / (2 * extent);
  ctx.setTransform(k, 0, 0, k, size / 2, size / 2);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Keep lines at least ~1.5 px wide so they don't shimmer.
  draw(channelPen(ctx, Math.max(lw, 1.5 / k)));

  const gw = Math.max(64, Math.round(size / 4));
  const glowCanvas = makeCanvas(gw, gw);
  const g = glowCanvas.getContext('2d')!;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.fillStyle = '#000';
  g.fillRect(0, 0, gw, gw);
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = 0.7;
  g.drawImage(downsample(canvas, 8), 0, 0, gw, gw);
  g.globalAlpha = 0.8;
  g.drawImage(downsample(canvas, 32), 0, 0, gw, gw);

  return { core: canvasTexture(canvas, true), glow: canvasTexture(glowCanvas, false), extent };
}

/** Atlas: 32 infernal letters + chain link + chain bead, 8 x 5 cells, white with a soft halo. */
export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 5;
export const ATLAS_LINK = 32;
export const ATLAS_BEAD = 33;

export function renderGlyphAtlas(cellW = 128, cellH = 192): THREE.Texture {
  const glyphs = getGlyphs();
  const canvas = makeCanvas(cellW * ATLAS_COLS, cellH * ATLAS_ROWS);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  const cell = (i: number) => [(i % ATLAS_COLS) * cellW + cellW / 2, Math.floor(i / ATLAS_COLS) * cellH + cellH / 2];
  for (let i = 0; i < 32; i++) {
    const [cx, cy] = cell(i);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.shadowColor = 'rgba(255,255,255,0.8)';
    ctx.shadowBlur = 14;
    if (i < glyphs.length) drawGlyph(ctx, i, cellH * 0.66);
    ctx.restore();
  }
  // chain link: an oval ring lying along the path (quad x = along the path)
  {
    const [cx, cy] = cell(ATLAS_LINK);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.shadowColor = 'rgba(255,255,255,0.8)';
    ctx.shadowBlur = 8;
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.ellipse(0, 0, cellW * 0.42, cellH * 0.13, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  {
    const [cx, cy] = cell(ATLAS_BEAD);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.shadowColor = 'rgba(255,255,255,0.9)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(0, -cellH * 0.14);
    ctx.lineTo(cellW * 0.12, 0);
    ctx.lineTo(0, cellH * 0.14);
    ctx.lineTo(-cellW * 0.12, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  return canvasTexture(canvas, true);
}
