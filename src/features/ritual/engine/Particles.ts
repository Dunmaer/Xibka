import * as THREE from 'three';
import { POINTS_FRAG, POINTS_VERT } from './shaders';
import type { RGB } from '../art/palette';

export interface ParticleOptions {
  count: number;
  /** Constant acceleration (world units / s²). */
  gravity?: [number, number, number];
  drag?: number;
  /** Colour cools from the ink towards deep red as the particle dies. */
  cooling?: boolean;
  renderOrder?: number;
}

/**
 * CPU-simulated point particles: embers rising off the altar, sparks from impacts,
 * dust motes hanging around the final circle, engraving sparks falling off the seal.
 * "Up" is +Z (towards the camera).
 */
export class Particles {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size: Float32Array;
  private baseSize: Float32Array;
  private alpha: Float32Array;
  private color: Float32Array;
  private baseColor: Float32Array;
  private heat: Float32Array;
  private geo: THREE.BufferGeometry;
  private cursor = 0;
  private emitAcc = 0;
  readonly count: number;
  private gravity: [number, number, number];
  private drag: number;
  private cooling: boolean;
  /** Embers per second (continuous emission off the altar). */
  emberRate = 0;
  /** Dust motes per second (continuous emission in a volume). */
  dustRate = 0;
  dustVolume = { r: 1.6, z0: -0.4, z1: 1.2 };
  swirl = 0.3;
  emberRadius = 1.05;
  palette: RGB[] = [[1, 0.35, 0.1]];

  constructor(opts: ParticleOptions) {
    const n = (this.count = opts.count);
    this.gravity = opts.gravity ?? [0, 0, 0.05];
    this.drag = opts.drag ?? 1.6;
    this.cooling = opts.cooling ?? true;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.size = new Float32Array(n);
    this.baseSize = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.color = new Float32Array(n * 3);
    this.baseColor = new Float32Array(n * 3);
    this.heat = new Float32Array(n);
    this.geo = new THREE.BufferGeometry();
    const dyn = (a: Float32Array, k: number) => new THREE.BufferAttribute(a, k).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', dyn(this.pos, 3));
    this.geo.setAttribute('aSize', dyn(this.size, 1));
    this.geo.setAttribute('aAlpha', dyn(this.alpha, 1));
    this.geo.setAttribute('aColor', dyn(this.color, 3));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1000);
    this.material = new THREE.ShaderMaterial({
      vertexShader: POINTS_VERT,
      fragmentShader: POINTS_FRAG,
      uniforms: { uPointScale: { value: 100 }, uCamDist: { value: 3 }, uMaxSize: { value: 40 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = opts.renderOrder ?? 50;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, heat: number, color?: RGB) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    const i3 = i * 3;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.baseSize[i] = size;
    this.heat[i] = heat;
    const c = color ?? this.palette[Math.floor(Math.random() * this.palette.length)];
    this.baseColor[i3] = c[0];
    this.baseColor[i3 + 1] = c[1];
    this.baseColor[i3 + 2] = c[2];
  }

  /** Radial burst of sparks from a ring (r0 = 0 for a point burst). */
  burst(n: number, opts: { r0?: number; speed?: number; up?: number; z?: number; heat?: number; size?: number; life?: number } = {}) {
    const { r0 = 0, speed = 1.6, up = 0.9, z = 0.05, heat = 1, size = 0.012, life = 1.1 } = opts;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = r0 * (0.9 + Math.random() * 0.2);
      const s = speed * (0.35 + Math.random() * 0.9);
      this.emit(
        Math.cos(a) * r, Math.sin(a) * r, z + Math.random() * 0.05,
        Math.cos(a) * s, Math.sin(a) * s, up * (0.3 + Math.random()),
        life * (0.5 + Math.random() * 0.8), size * (0.5 + Math.random()), heat * (0.7 + Math.random() * 0.5),
      );
    }
  }

  update(dt: number, time: number) {
    this.emitAcc += this.emberRate * dt;
    while (this.emitAcc >= 1) {
      this.emitAcc -= 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * this.emberRadius;
      this.emit(
        Math.cos(a) * r, Math.sin(a) * r, Math.random() * 0.05,
        (Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.05, 0.12 + Math.random() * 0.25,
        2 + Math.random() * 3.5, 0.006 + Math.random() * 0.012, 0.45 + Math.random() * 0.5,
      );
    }
    if (this.dustRate > 0) {
      const n = this.dustRate * dt;
      const whole = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
      const v = this.dustVolume;
      for (let k = 0; k < whole; k++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * v.r;
        this.emit(
          Math.cos(a) * r, Math.sin(a) * r, v.z0 + Math.random() * (v.z1 - v.z0),
          (Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.04, (Math.random() - 0.3) * 0.05,
          4 + Math.random() * 5, 0.003 + Math.random() * 0.007, 0.2 + Math.random() * 0.4,
        );
      }
    }
    const [gx, gy, gz] = this.gravity;
    const drag = Math.exp(-dt * this.drag);
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const i3 = i * 3;
      const x = this.pos[i3];
      const y = this.pos[i3 + 1];
      const sw = this.swirl * dt;
      const wob = Math.sin(time * 2.1 + i * 1.7) * 0.03 * dt;
      this.vel[i3] = this.vel[i3] * drag - y * sw + wob + gx * dt;
      this.vel[i3 + 1] = this.vel[i3 + 1] * drag + x * sw - wob + gy * dt;
      this.vel[i3 + 2] = this.vel[i3 + 2] * Math.exp(-dt * 0.6) + gz * dt;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      const fadeIn = Math.min(1, (1 - t) * 8);
      const flick = 0.7 + 0.3 * Math.sin(time * 13 + i * 3.1);
      this.alpha[i] = t * fadeIn * flick * 1.6;
      this.size[i] = this.baseSize[i] * (0.6 + 0.4 * t);
      // hot particles glow white-ish, then cool into their ink (and deeper as they die)
      const h = this.heat[i] * (this.cooling ? 0.4 + 0.6 * t : 1);
      const cool = this.cooling ? 0.55 + 0.45 * t : 1;
      this.color[i3] = (this.baseColor[i3] * cool + h * 0.55) * (1 + h * 0.3);
      this.color[i3 + 1] = (this.baseColor[i3 + 1] * cool + h * 0.45) * (1 + h * 0.3);
      this.color[i3 + 2] = (this.baseColor[i3 + 2] * cool + h * 0.3) * (1 + h * 0.3);
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
  }

  dispose() {
    this.geo.dispose();
    this.material.dispose();
  }
}
