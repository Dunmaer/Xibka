import * as THREE from 'three';
import { POINTS_FRAG, POINTS_VERT } from './shaders';

interface Pool {
  pos: Float32Array;
  vel: Float32Array;
  life: Float32Array;
  maxLife: Float32Array;
  size: Float32Array;
  baseSize: Float32Array;
  alpha: Float32Array;
  color: Float32Array;
  heat: Float32Array;
}

/**
 * CPU-simulated point particles (embers drifting up from the altar and sparks thrown out by
 * the stamps). "Up" is +Z: towards the camera, so particles grow as they rise.
 */
export class Particles {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  private p: Pool;
  private geo: THREE.BufferGeometry;
  private cursor = 0;
  private emitAcc = 0;
  /** Embers per second. */
  emberRate = 12;
  /** Swirl around the centre (rad/s at radius 1). */
  swirl = 0.3;
  emberRadius = 1.05;

  constructor(readonly count: number) {
    const n = count;
    this.p = {
      pos: new Float32Array(n * 3),
      vel: new Float32Array(n * 3),
      life: new Float32Array(n),
      maxLife: new Float32Array(n),
      size: new Float32Array(n),
      baseSize: new Float32Array(n),
      alpha: new Float32Array(n),
      color: new Float32Array(n * 3),
      heat: new Float32Array(n),
    };
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.p.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.p.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.p.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.p.color, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
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
    this.points.renderOrder = 50;
  }

  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, heat: number) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    const P = this.p;
    P.pos[i * 3] = x;
    P.pos[i * 3 + 1] = y;
    P.pos[i * 3 + 2] = z;
    P.vel[i * 3] = vx;
    P.vel[i * 3 + 1] = vy;
    P.vel[i * 3 + 2] = vz;
    P.life[i] = life;
    P.maxLife[i] = life;
    P.baseSize[i] = size;
    P.heat[i] = heat;
  }

  /** Radial burst of sparks from a ring (r0 = 0 for a point burst). */
  burst(n: number, opts: { r0?: number; speed?: number; up?: number; z?: number; heat?: number; size?: number; life?: number } = {}) {
    const { r0 = 0, speed = 1.6, up = 0.9, z = 0.05, heat = 1, size = 0.012, life = 1.1 } = opts;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = r0 * (0.9 + Math.random() * 0.2);
      const s = speed * (0.35 + Math.random() * 0.9);
      this.spawn(
        Math.cos(a) * r, Math.sin(a) * r, z + Math.random() * 0.05,
        Math.cos(a) * s, Math.sin(a) * s, up * (0.3 + Math.random()),
        life * (0.5 + Math.random() * 0.8),
        size * (0.5 + Math.random()),
        heat * (0.7 + Math.random() * 0.5),
      );
    }
  }

  update(dt: number, time: number) {
    // continuous embers rising off the altar
    this.emitAcc += this.emberRate * dt;
    while (this.emitAcc >= 1) {
      this.emitAcc -= 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * this.emberRadius;
      this.spawn(
        Math.cos(a) * r, Math.sin(a) * r, Math.random() * 0.05,
        (Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.05, 0.12 + Math.random() * 0.25,
        2 + Math.random() * 3.5,
        0.006 + Math.random() * 0.012,
        0.45 + Math.random() * 0.5,
      );
    }
    const P = this.p;
    const drag = Math.exp(-dt * 1.6);
    for (let i = 0; i < this.count; i++) {
      if (P.life[i] <= 0) {
        P.alpha[i] = 0;
        continue;
      }
      P.life[i] -= dt;
      const i3 = i * 3;
      const x = P.pos[i3];
      const y = P.pos[i3 + 1];
      // swirl + wander
      const sw = this.swirl * dt;
      const wob = Math.sin(time * 2.1 + i * 1.7) * 0.03 * dt;
      P.vel[i3] = P.vel[i3] * drag - y * sw + wob;
      P.vel[i3 + 1] = P.vel[i3 + 1] * drag + x * sw - wob;
      P.vel[i3 + 2] = P.vel[i3 + 2] * Math.exp(-dt * 0.6) + 0.05 * dt;
      P.pos[i3] += P.vel[i3] * dt;
      P.pos[i3 + 1] += P.vel[i3 + 1] * dt;
      P.pos[i3 + 2] += P.vel[i3 + 2] * dt;
      const t = Math.max(0, P.life[i] / P.maxLife[i]);
      const fadeIn = Math.min(1, (1 - t) * 8);
      const flick = 0.7 + 0.3 * Math.sin(time * 13 + i * 3.1);
      P.alpha[i] = t * fadeIn * flick * 1.6;
      P.size[i] = P.baseSize[i] * (0.6 + 0.4 * t);
      // colour cools from yellow-white to deep red as it dies
      const h = P.heat[i] * (0.4 + 0.6 * t);
      P.color[i3] = 1.0 + h * 0.8;
      P.color[i3 + 1] = 0.18 + h * 0.7;
      P.color[i3 + 2] = 0.03 + h * h * 0.35;
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
  }

  clear() {
    this.p.life.fill(0);
    this.p.alpha.fill(0);
  }

  dispose() {
    this.geo.dispose();
    this.material.dispose();
  }
}
