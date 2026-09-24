import * as THREE from 'three';
import type { LayerArt } from '../art/circleArt';
import { drawGlyph, getGlyphs } from '../../../utils/glyphs/glyphLibrary';

/** Extra room around a layer so its glow is not clipped. */
export const LAYER_MARGIN = 1.1;

function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Copies one channel of a canvas into a compact single-channel texture (4x less VRAM). */
function redTexture(canvas: HTMLCanvasElement, mipmaps: boolean): THREE.DataTexture {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const { width: w, height: h } = canvas;
  const src = ctx.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(w * h);
  // Canvas rows go top-down, GL expects bottom-up.
  for (let y = 0; y < h; y++) {
    const srcRow = y * w * 4;
    const dstRow = (h - 1 - y) * w;
    for (let x = 0; x < w; x++) out[dstRow + x] = src[srcRow + x * 4 + 3];
  }
  const tex = new THREE.DataTexture(out, w, h, THREE.RedFormat, THREE.UnsignedByteType);
  tex.unpackAlignment = 1;
  tex.generateMipmaps = mipmaps;
  tex.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
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

export interface LayerTextures {
  core: THREE.DataTexture;
  glow: THREE.DataTexture;
  /** Half size of the textured square in unit space. */
  extent: number;
}

export function renderLayerTextures(layer: LayerArt, maxSize: number, density: number, lw: number): LayerTextures {
  const extent = layer.radius * LAYER_MARGIN;
  const size = Math.max(256, Math.min(maxSize, Math.round(2 * extent * density)));
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const k = size / (2 * extent);
  ctx.setTransform(k, 0, 0, k, size / 2, size / 2);
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Keep lines at least ~1.6 px wide so they don't shimmer.
  const lwUnit = Math.max(lw, 1.6 / k);
  layer.draw({ ctx, lw: lwUnit });

  // Glow: two blur radii mixed (tight + wide), stored at 1/4 resolution.
  const gw = Math.max(64, Math.round(size / 4));
  const glowCanvas = makeCanvas(gw, gw);
  const g = glowCanvas.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  const tight = downsample(canvas, 8);
  const wide = downsample(canvas, 32);
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = 0.7;
  g.drawImage(tight, 0, 0, gw, gw);
  g.globalAlpha = 0.8;
  g.drawImage(wide, 0, 0, gw, gw);

  return { core: redTexture(canvas, true), glow: redTexture(glowCanvas, false), extent };
}

/** 8x4 atlas of the 32 infernal letters (white on transparent + soft halo). */
export function renderGlyphAtlas(cellW = 128, cellH = 192): THREE.DataTexture {
  const glyphs = getGlyphs();
  const canvas = makeCanvas(cellW * 8, cellH * 4);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  for (let i = 0; i < 32; i++) {
    const cx = (i % 8) * cellW + cellW / 2;
    const cy = Math.floor(i / 8) * cellH + cellH / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.shadowColor = 'rgba(255,255,255,0.8)';
    ctx.shadowBlur = 14;
    ctx.globalAlpha = 1;
    if (i < glyphs.length) drawGlyph(ctx, i, cellH * 0.66);
    ctx.restore();
  }
  const tex = redTexture(canvas, true);
  return tex;
}
