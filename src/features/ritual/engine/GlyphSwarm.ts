import * as THREE from 'three';
import { GLYPH_FRAG, GLYPH_VERT } from './shaders';
import { makeRng } from '../../../utils/seed/seed';

/**
 * Faint inscriptions of the visitor's words (in infernal letters) flowing around the circle
 * along wavy, breathing orbits at several depths.
 */
export class GlyphSwarm {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private geo: THREE.InstancedBufferGeometry;

  constructor(atlas: THREE.Texture, texts: number[][], seed: number) {
    const rng = makeRng(seed).fork(99);
    const base = new THREE.PlaneGeometry(128 / 192, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));

    const glyph: number[] = [];
    const orbit: number[] = [];
    const wave: number[] = [];
    const alpha: number[] = [];
    const sources = texts.map((t) => t.filter((g) => g >= 0)).filter((t) => t.length);
    if (!sources.length) sources.push([0, 5, 12, 19]);

    // Ribbons: sentences following each other on one orbit.
    const ribbons = 7;
    for (let r = 0; r < ribbons; r++) {
      const seq = sources[r % sources.length];
      const radius = 0.55 + rng() * 0.8;
      const size = 0.035 + rng() * 0.03;
      const speed = (0.08 + rng() * 0.14) * rng.sign();
      const zSlot = rng.range(-0.5, 5.5);
      const ampR = rng.range(0.02, 0.08);
      const freq = rng.int(2, 6);
      const ampZ = rng.range(0.02, 0.1);
      const start = rng() * Math.PI * 2;
      const step = (size * 0.8) / radius;
      const count = Math.min(Math.floor((Math.PI * 1.6) / step), seq.length * 3 + 2);
      for (let k = 0; k < count; k++) {
        glyph.push(seq[k % (seq.length + 1)] ?? -1);
        orbit.push(radius, zSlot, speed, start + k * step * Math.sign(speed));
        wave.push(ampR, freq, ampZ, size);
        alpha.push(0.5 + rng() * 0.5);
      }
    }
    // Loose letters drifting close to the camera (big, very faint).
    for (let k = 0; k < 26; k++) {
      const seq = sources[k % sources.length];
      glyph.push(seq[k % seq.length]);
      orbit.push(0.3 + rng() * 1.2, rng.range(4, 8), (0.05 + rng() * 0.1) * rng.sign(), rng() * Math.PI * 2);
      wave.push(rng.range(0.05, 0.2), rng.int(1, 3), rng.range(0.05, 0.2), 0.05 + rng() * 0.06);
      alpha.push(0.25 + rng() * 0.3);
    }
    // Remove gaps (-1): keep them invisible by zero alpha.
    for (let i = 0; i < glyph.length; i++) if (glyph[i] < 0) {
      glyph[i] = 0;
      alpha[i] = 0;
    }

    geo.setAttribute('aGlyph', new THREE.InstancedBufferAttribute(new Float32Array(glyph), 1));
    geo.setAttribute('aOrbit', new THREE.InstancedBufferAttribute(new Float32Array(orbit), 4));
    geo.setAttribute('aWave', new THREE.InstancedBufferAttribute(new Float32Array(wave), 4));
    geo.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(new Float32Array(alpha), 1));
    geo.instanceCount = glyph.length;
    this.geo = geo;

    this.material = new THREE.ShaderMaterial({
      vertexShader: GLYPH_VERT,
      fragmentShader: GLYPH_FRAG,
      uniforms: {
        uAtlas: { value: atlas },
        uTime: { value: 0 },
        uSpread: { value: 0.1 },
        uSwirl: { value: 1 },
        uOpacity: { value: 0 },
        uColor: { value: new THREE.Color(1.0, 0.45, 0.16) },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 40;
  }

  dispose() {
    this.geo.dispose();
    this.material.dispose();
  }
}
