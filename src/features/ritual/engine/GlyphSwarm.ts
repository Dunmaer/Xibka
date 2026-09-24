import * as THREE from 'three';
import { GLYPH_FRAG, GLYPH_VERT } from './shaders';
import { makeRng } from '../../../utils/seed/seed';
import { ATLAS_BEAD, ATLAS_LINK } from './textures';

/**
 * Inscriptions of the visitor's words (in infernal letters) flowing around the circle:
 * - chains: letters linked by chain links, drifting on wavy orbits at several depths
 * - loose big letters close to the camera, out of focus, slowly crossing the view
 */
export class GlyphSwarm {
  /** Chains of letters around the circle (behind the certificate). */
  readonly back: THREE.Mesh;
  /** Big loose letters in front of everything. */
  readonly front: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private geos: THREE.InstancedBufferGeometry[] = [];

  constructor(atlas: THREE.Texture, texts: number[][], seed: number) {
    const rng = makeRng(seed).fork(99);
    const base = new THREE.PlaneGeometry(128 / 192, 1);
    let glyph: number[] = [];
    let orbit: number[] = [];
    let wave: number[] = [];
    let extra: number[] = [];
    const push = (g: number, o: number[], w: number[], e: number[]) => {
      glyph.push(g);
      orbit.push(...o);
      wave.push(...w);
      extra.push(...e);
    };
    const build = () => {
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = base.index;
      geo.setAttribute('position', base.getAttribute('position'));
      geo.setAttribute('uv', base.getAttribute('uv'));
      geo.setAttribute('aGlyph', new THREE.InstancedBufferAttribute(new Float32Array(glyph), 1));
      geo.setAttribute('aOrbit', new THREE.InstancedBufferAttribute(new Float32Array(orbit), 4));
      geo.setAttribute('aWave', new THREE.InstancedBufferAttribute(new Float32Array(wave), 4));
      geo.setAttribute('aExtra', new THREE.InstancedBufferAttribute(new Float32Array(extra), 4));
      geo.instanceCount = glyph.length;
      this.geos.push(geo);
      glyph = [];
      orbit = [];
      wave = [];
      extra = [];
      return geo;
    };

    const sources = texts.map((t) => t.filter((g) => g >= 0)).filter((t) => t.length);
    if (!sources.length) sources.push([0, 5, 12, 19]);

    // Chains: words written on an orbit, each letter linked to the next.
    const chains = rng.int(5, 8);
    for (let c = 0; c < chains; c++) {
      const seq = sources[c % sources.length];
      const radius = rng.range(0.55, 1.45);
      const size = rng.range(0.055, 0.1);
      const speed = rng.range(0.06, 0.16) * rng.sign();
      const zSlot = rng.range(-0.5, 6);
      const ampR = rng.range(0.02, 0.09);
      const freq = rng.int(2, 6);
      const ampZ = rng.range(0.02, 0.12);
      const start = rng() * Math.PI * 2;
      const step = (size * 0.78) / radius;
      const letters = Math.max(2, Math.min(seq.length * 2, Math.floor((Math.PI * 1.3) / (step * 2))));
      const alpha = rng.range(0.55, 0.95);
      const dir = Math.sign(speed);
      for (let k = 0; k < letters; k++) {
        const th = start + k * step * 2 * dir;
        push(seq[k % seq.length], [radius, zSlot, speed, th], [ampR, freq, ampZ, size], [alpha, 0, 0, 0.35]);
        if (k < letters - 1) {
          // chain link, a bead every few letters
          const link = k % 4 === 3 ? ATLAS_BEAD : ATLAS_LINK;
          push(link, [radius, zSlot, speed, th + step * dir], [ampR, freq, ampZ, size * 0.8], [alpha * 0.8, 0, 0, 0.2]);
        }
      }
    }
    const backGeo = build();

    // Loose big letters close to the camera: out of focus, few, slow.
    const loose = rng.int(7, 12);
    for (let k = 0; k < loose; k++) {
      const seq = sources[k % sources.length];
      push(
        seq[k % seq.length],
        [rng.range(0.25, 1.1), rng.range(0.28, 0.55), rng.range(0.03, 0.08) * rng.sign(), rng() * Math.PI * 2],
        [rng.range(0.04, 0.15), rng.int(1, 3), rng.range(0.02, 0.06), rng.range(0.1, 0.2)],
        [rng.range(0.25, 0.45), rng.range(1.5, 3.2), 1, 0.3],
      );
    }
    const frontGeo = build();

    this.material = new THREE.ShaderMaterial({
      vertexShader: GLYPH_VERT,
      fragmentShader: GLYPH_FRAG,
      uniforms: {
        uAtlas: { value: atlas },
        uTime: { value: 0 },
        uSpread: { value: 0.1 },
        uSwirl: { value: 1 },
        uCamZ: { value: 3 },
        uCamD: { value: 3 },
        uFinalMix: { value: 0 },
        uZTop: { value: 0.7 },
        uDepth: { value: 2 },
        uOpacity: { value: 0 },
        uColor: { value: new THREE.Color(1.0, 0.45, 0.16) },
        uColor2: { value: new THREE.Color(1.0, 0.45, 0.16) },
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
    this.back = new THREE.Mesh(backGeo, this.material);
    this.front = new THREE.Mesh(frontGeo, this.material);
    for (const m of [this.back, this.front]) m.frustumCulled = false;
  }

  set visible(v: boolean) {
    this.back.visible = v;
    this.front.visible = v;
  }

  dispose() {
    this.geos.forEach((g) => g.dispose());
    this.material.dispose();
  }
}
