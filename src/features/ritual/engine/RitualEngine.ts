import * as THREE from 'three';
import { isTouch, tilt } from '../motion';
import { AltarCamera } from './AltarCamera';
import { Post } from './Post';
import { Particles } from './Particles';
import { GlyphSwarm } from './GlyphSwarm';
import { LAYER_MARGIN, renderChannelTextures, renderGlyphAtlas, type LayerTextures } from './textures';
import {
  BASIC_VERT, CERT_FRAG, CIRCLE_FRAG, FIRE_FRAG, FLARE_FRAG, PAPER_FRAG, PAPER_VERT, PASSER_FRAG, RING_FRAG,
  SHADOW_FRAG, SMOKE_FRAG,
} from './shaders';
import type { LayerArt } from '../art/generator';
import type { PaperArt } from '../art/paperArt';
import type { RGB } from '../art/palette';
import type { RitualParams } from '../params';
import type { VideoDeck } from '../VideoDeck';
import type { RitualAudio } from '../audio';
import type { CertificateLayers } from '../../certificate/renderCertificate';
import { makeRng } from '../../../utils/seed/seed';
import {
  ALTAR_CENTER_WIDE, ALTAR_CENTER_ZOOMED, CONSTRUCT_RADIUS, F as K, clamp01, diveProgress, easeInOutCubic,
  easeOutCubic, lerp, smooth, videoZoom,
} from '../timeline';

export interface EngineEvents {
  onLanded?: () => void;
  onCertBirth?: () => void;
  onUiReady?: () => void;
  onFrame?: (f: number) => void;
}

type Phase = 'idle' | 'paper' | 'ritual';

interface Layer {
  art: LayerArt;
  tex: LayerTextures;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  angle: number;
  lockT: number;
}

interface Passer {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  tex: LayerTextures;
  spawn: number;
  dur: number;
  z0: number;
  x: number;
  y: number;
  scale: number;
  rot: number;
  spin: number;
}

interface CertState {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  data: CertificateLayers;
  textures: THREE.Texture[];
  emitted: number;
}

const ADDITIVE = {
  transparent: true,
  depthTest: false,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.ZeroFactor,
  blendDstAlpha: THREE.OneFactor,
} as const;

const OVER = {
  transparent: true,
  depthTest: false,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor, // colour is premultiplied in the shader
  blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.OneFactor,
  blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
} as const;

const SHADOW_BLEND = { ...OVER, blendSrc: THREE.SrcAlphaFactor } as const;

/** World size of the note (construct radius = 1). */
const PAPER_W = 0.62;
const D0 = 3.0; // camera height at zoom 1 (in construct radii)
const D_FINAL = 2.4;
/** Height of the certificate above the altar plane at the end. */
const ZC = 0.8;
const SPREAD_K = 0.085; // layer slot spacing during the ritual, as a fraction of camera height
/** Lock plane during the ritual (top of the assembled circle), as a fraction of camera height. */
const LOCK_K = 0.42;
/**
 * How deep the finished circle's layers are stacked under the certificate. Each layer is
 * scaled up by exactly as much as perspective shrinks it, so at rest the circle looks like
 * one flat drawing — the depth only shows (strongly) when the camera moves with the mouse.
 */
const FINAL_DEPTH = 3.2;

// Paper phase timings (seconds)
const P_APPEAR = 0.7;
const P_HOLD_END = 2.3;
const P_FALL_END = 5.1;
const P_LAND_WAIT = 0.35;

/** renderOrder from height: things lower in the scene are drawn first. */
const orderFor = (z: number) => 1000 + z * 100;

export class RitualEngine {
  readonly renderer: THREE.WebGLRenderer;
  private post: Post;
  private cam = new AltarCamera();
  private scene = new THREE.Scene();
  private stableTex: THREE.VideoTexture;
  private pribTex: THREE.VideoTexture;
  private layers: Layer[] = [];
  private passers: Passer[] = [];
  private passerTextures: LayerTextures[] = [];
  private construct = new THREE.Group();
  private paper: THREE.Mesh;
  private paperMat: THREE.ShaderMaterial;
  private shadow: THREE.Mesh;
  private shadowMat: THREE.ShaderMaterial;
  private sparks: Particles;
  private dust: Particles;
  private engraveSparks: Particles;
  private swarm: GlyphSwarm | null = null;
  private atlas: THREE.Texture;
  private flare: THREE.Mesh;
  private ring: THREE.Mesh;
  private fire: THREE.Mesh;
  private smoke: THREE.Mesh;
  private params: RitualParams | null = null;
  private cert: CertState | null = null;
  private holder: HTMLDivElement;

  private phase: Phase = 'idle';
  private paperClock = 0;
  private landedFired = false;
  private lastF = -1;
  private time = 0;
  private raf = 0;
  private lastNow = 0;
  private running = false;
  private disposed = false;
  private quality: { dpr: number; maxTex: number; density: number; particles: number; passers: number };
  private silentUntil = -1;
  private paperRest = { x: 0, y: 0, rot: 0 };
  private paperDrift = { a: 0, b: 0, dir: 1 };
  private paperSpin = 0;
  private paperAspect = 1.43;
  private maxSlot = 5;
  private minSlot = 0;
  /** Orbit groups (satellites, medallions): shared slow rotation. */
  private groups = new Map<number, { angle: number; spin: number }>();
  /** Deferred texture work (drawn a little per frame). */
  private jobs: (() => void)[] = [];
  private blank: THREE.DataTexture;

  // pointer (−1..1), target and smoothed
  private mouse = new THREE.Vector2();
  private mouseS = new THREE.Vector2();
  private target = new THREE.Vector2();
  private touch = isTouch();
  private onPointer = (e: PointerEvent) => {
    this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
  };
  private onLeave = () => this.mouse.set(0, 0);

  // one-shot effect envelopes (seconds since trigger, strength)
  private fxFlare = { t: 99, s: 0 };
  private fxRing = { t: 99, s: 0, speed: 1 };
  private fxFire = { t: 99, s: 0, dur: 1 };
  private fxSmoke = { t: 99, s: 0 };
  private fxShake = { t: 99, s: 0 };
  private fxFlash = { t: 99, s: 0 };
  private fxShock = { t: 99, s: 0 };
  private spinBoost = 1;

  /** Debug: freeze on a frame (from ?frame=N). */
  frozenFrame: number | null = null;
  private finalCenter: { x: number; y: number; w: number; h: number } | null = null;

  constructor(private canvas: HTMLCanvasElement, private deck: VideoDeck, private events: EngineEvents = {}, private audio: RitualAudio | null = null) {
    const mobile = matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 700;
    this.quality = mobile
      ? { dpr: Math.min(devicePixelRatio, 1.5), maxTex: 1536, density: 1300, particles: 600, passers: 22 }
      : { dpr: Math.min(devicePixelRatio, 2), maxTex: 2048, density: 2000, particles: 1200, passers: 36 };

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.autoClear = false;
    this.renderer.setPixelRatio(this.quality.dpr);

    // Keep the videos in the document (tiny + invisible) so every browser keeps decoding
    // them and reports presented frames.
    this.holder = document.createElement('div');
    this.holder.className = 'video-holder';
    this.holder.append(deck.stable, deck.pribliji);
    document.body.appendChild(this.holder);

    this.stableTex = new THREE.VideoTexture(deck.stable);
    this.pribTex = new THREE.VideoTexture(deck.pribliji);
    for (const t of [this.stableTex, this.pribTex]) {
      t.colorSpace = THREE.NoColorSpace;
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
    }
    this.post = new Post(this.renderer, this.stableTex, this.pribTex);

    this.scene.add(this.construct);
    this.atlas = renderGlyphAtlas();
    this.blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.blank.needsUpdate = true;

    // Paper + its contact shadow
    this.paperMat = new THREE.ShaderMaterial({
      vertexShader: PAPER_VERT,
      fragmentShader: PAPER_FRAG,
      uniforms: {
        uMap: { value: null },
        uRuneMap: { value: null },
        uOpacity: { value: 0 },
        uBurn: { value: 0 },
        uScorch: { value: 0 },
        uTime: { value: 0 },
        uBend: { value: 0 },
        uWave: { value: 0 },
        uTint: { value: new THREE.Color(1, 1, 1) },
        uRunes: { value: 0 },
        uRuneCol: { value: new THREE.Color(1.6, 0.45, 0.1) },
      },
      side: THREE.DoubleSide,
      ...OVER,
    });
    this.paper = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.7, 24, 16), this.paperMat);
    this.paper.visible = false;
    this.scene.add(this.paper);

    this.shadowMat = new THREE.ShaderMaterial({
      vertexShader: BASIC_VERT,
      fragmentShader: SHADOW_FRAG,
      uniforms: { uOpacity: { value: 0 }, uSoft: { value: 0 } },
      ...SHADOW_BLEND,
    });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.shadowMat);
    this.shadow.visible = false;
    this.scene.add(this.shadow);

    this.sparks = new Particles({ count: this.quality.particles, renderOrder: 5000 });
    this.dust = new Particles({ count: Math.round(this.quality.particles * 0.6), gravity: [0, 0, 0.004], drag: 0.4, cooling: false, renderOrder: 5001 });
    this.engraveSparks = new Particles({ count: 500, gravity: [0, -0.9, 0.05], drag: 0.8, renderOrder: 5002 });
    this.engraveSparks.swirl = 0;
    this.dust.swirl = 0.05;
    this.scene.add(this.sparks.points, this.dust.points, this.engraveSparks.points);

    const fxMat = (frag: string, uniforms: Record<string, THREE.IUniform>, blend: object = ADDITIVE) =>
      new THREE.ShaderMaterial({ vertexShader: BASIC_VERT, fragmentShader: frag, uniforms, ...blend });
    this.flare = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      fxMat(FLARE_FRAG, { uIntensity: { value: 0 }, uColor: { value: new THREE.Color(1, 0.4, 0.1) }, uStreak: { value: 1 } }),
    );
    this.ring = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      fxMat(RING_FRAG, { uRadius: { value: 0 }, uWidth: { value: 0.02 }, uIntensity: { value: 0 }, uColor: { value: new THREE.Color(1, 0.5, 0.15) } }),
    );
    this.fire = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      fxMat(FIRE_FRAG, {
        uTime: { value: 0 }, uIntensity: { value: 0 }, uRadius: { value: 0.15 },
        uColA: { value: new THREE.Color(0.9, 0.12, 0.02) }, uColB: { value: new THREE.Color(1.6, 0.9, 0.35) },
      }),
    );
    this.smoke = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      fxMat(SMOKE_FRAG, { uTime: { value: 0 }, uOpacity: { value: 0 }, uSeed: { value: 0 }, uColor: { value: new THREE.Color(0.55, 0.3, 0.2) } }, OVER),
    );
    for (const m of [this.flare, this.ring, this.fire, this.smoke]) {
      m.frustumCulled = false;
      m.visible = false;
      this.scene.add(m);
    }

    window.addEventListener('pointermove', this.onPointer, { passive: true });
    tilt.start();
    window.addEventListener('pointerdown', this.onPointer, { passive: true });
    document.addEventListener('pointerleave', this.onLeave);

    this.resize();
    if (import.meta.env.DEV) (window as unknown as { __engine: RitualEngine }).__engine = this;
  }

  // ---------------------------------------------------------------- setup

  /** Builds the circle layers, tunnel pieces, note texture and letter swarm for a curse. */
  prepare(params: RitualParams, paper: PaperArt) {
    this.clearCurse();
    this.params = params;
    const pal = params.palette;
    const design = params.design;
    const lw = 0.0042 * params.lineWeight;
    const only = import.meta.env.DEV ? new URLSearchParams(location.search).get('layers') : null;

    design.layers.forEach((art, i) => {
      // textures are drawn a few per frame (see pumpJobs) so the page never freezes
      const tex: LayerTextures = { core: this.blank, glow: this.blank, extent: art.radius * LAYER_MARGIN };
      this.jobs.push(() => {
        const t = renderChannelTextures(art.radius, art.draw, this.quality.maxTex, this.quality.density, lw);
        tex.core = t.core;
        tex.glow = t.glow;
        mat.uniforms.uCore.value = t.core;
        mat.uniforms.uGlow.value = t.glow;
      });
      const lp = art.palette;
      const mat = new THREE.ShaderMaterial({
        vertexShader: BASIC_VERT,
        fragmentShader: CIRCLE_FRAG,
        uniforms: {
          uCore: { value: tex.core },
          uGlow: { value: tex.glow },
          uReveal: { value: 0 },
          uIntensity: { value: art.intensity },
          uGlowAmt: { value: 0.9 * params.bloom },
          uHeat: { value: 0.8 },
          uTime: { value: 0 },
          uPhase: { value: (i * 0.137) % 1 },
          uFade: { value: 1 },
          uColA: { value: new THREE.Color(...lp.a) },
          uColB: { value: new THREE.Color(...lp.b) },
          uColC: { value: new THREE.Color(...lp.c) },
          uHot: { value: new THREE.Color(...lp.hot) },
        },
        side: THREE.DoubleSide,
        ...ADDITIVE,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2 * tex.extent, 2 * tex.extent), mat);
      mesh.frustumCulled = false;
      if (only) mesh.visible = only.split(',').includes(art.id);
      this.construct.add(mesh);
      // layers that must not turn on their own (links, bead trails) start at their drawn angle
      const still = art.spin === 0 || art.follow !== undefined;
      this.layers.push({ art, tex, mesh, mat, angle: still ? 0 : (i * 0.7) % (Math.PI * 2), lockT: 99 });
    });
    const slots = design.layers.filter((l) => !l.hang).map((l) => l.zSlot);
    this.maxSlot = Math.max(1, ...slots);
    this.minSlot = Math.min(this.maxSlot - 0.5, ...slots);
    this.groups.clear();
    for (const l of design.layers) {
      if (l.orbit && !this.groups.has(l.orbit.group)) this.groups.set(l.orbit.group, { angle: 0, spin: l.orbit.groupSpin });
    }
    this.construct.visible = false;

    // tunnel passers share a few textures (also drawn lazily)
    this.passerTextures = design.passers.map((pa) => {
      const tex: LayerTextures = { core: this.blank, glow: this.blank, extent: pa.radius * LAYER_MARGIN };
      this.jobs.push(() => {
        const t = renderChannelTextures(pa.radius, pa.draw, Math.min(1024, this.quality.maxTex), this.quality.density * 0.5, lw * 1.4);
        tex.core = t.core;
        tex.glow = t.glow;
        for (const p of this.passers) if (p.tex === tex) p.mat.uniforms.uCore.value = t.core;
      });
      return tex;
    });
    const rng = makeRng(params.seed).fork(777);
    const inks: RGB[][] = [[pal.a, pal.b, pal.c], [pal.b, pal.c, pal.a], [pal.c, pal.a, pal.b]];
    for (let i = 0; i < this.quality.passers; i++) {
      const ti = i % this.passerTextures.length;
      const tex = this.passerTextures[ti];
      const ink = rng.pick(inks);
      const mat = new THREE.ShaderMaterial({
        vertexShader: BASIC_VERT,
        fragmentShader: PASSER_FRAG,
        uniforms: {
          uCore: { value: tex.core },
          uColA: { value: new THREE.Color(...ink[0]) },
          uColB: { value: new THREE.Color(...ink[1]) },
          uColC: { value: new THREE.Color(...ink[2]) },
          uAlpha: { value: 0 },
        },
        side: THREE.DoubleSide,
        ...ADDITIVE,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2 * tex.extent, 2 * tex.extent), mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.scene.add(mesh);
      // rings mostly around the axis (the tunnel), sigils and medallions off to the sides
      const ring = ti === 0 || ti === 2 || ti === 4;
      const off = ring ? rng.range(0, 0.25) : rng.range(0.35, 1.5);
      const a = rng.range(0, Math.PI * 2);
      this.passers.push({
        mesh,
        mat,
        tex,
        spawn: rng.range(K.passersFrom, K.passersTo),
        dur: rng.range(30, 62),
        z0: -rng.range(12, 34),
        x: Math.cos(a) * off,
        y: Math.sin(a) * off,
        scale: ring ? rng.range(0.55, 1.7) : rng.range(0.12, 0.35),
        rot: rng.range(0, Math.PI * 2),
        spin: rng.range(-2, 2),
      });
    }

    const map = new THREE.CanvasTexture(paper.paper);
    map.colorSpace = THREE.NoColorSpace;
    map.anisotropy = 8;
    map.premultiplyAlpha = true;
    const runes = new THREE.CanvasTexture(paper.runes);
    runes.colorSpace = THREE.NoColorSpace;
    this.paperMat.uniforms.uMap.value = map;
    this.paperMat.uniforms.uRuneMap.value = runes;
    (this.paperMat.uniforms.uRuneCol.value as THREE.Color).setRGB(pal.a[0] * 1.5, pal.a[1] * 1.5, pal.a[2] * 1.5);
    this.paperAspect = paper.aspect;
    this.paper.scale.set(PAPER_W, PAPER_W / paper.aspect / 0.7, 1);

    const g = params.glyphs;
    this.swarm = new GlyphSwarm(this.atlas, [g.name, g.punishment, g.reason], params.seed);
    this.swarm.visible = false;
    (this.swarm.material.uniforms.uColor.value as THREE.Color).setRGB(...pal.b);
    (this.swarm.material.uniforms.uColor2.value as THREE.Color).setRGB(...pal.c);
    this.scene.add(this.swarm.back, this.swarm.front);

    const inkList: RGB[] = [pal.a, pal.b, pal.c];
    this.sparks.palette = inkList;
    this.dust.palette = inkList;
    this.engraveSparks.palette = [pal.hot, pal.a, pal.c];
    (this.flare.material as THREE.ShaderMaterial).uniforms.uColor.value.setRGB(...pal.a);
    (this.ring.material as THREE.ShaderMaterial).uniforms.uColor.value.setRGB(...pal.c);
    const fu = (this.fire.material as THREE.ShaderMaterial).uniforms;
    fu.uColA.value.setRGB(pal.a[0] * 0.9, pal.a[1] * 0.9, pal.a[2] * 0.9);
    fu.uColB.value.setRGB(pal.hot[0] * 1.5, pal.hot[1] * 1.5, pal.hot[2] * 1.5);
    (this.smoke.material as THREE.ShaderMaterial).uniforms.uColor.value.setRGB(pal.b[0] * 0.5, pal.b[1] * 0.5, pal.b[2] * 0.5);

    const prng = makeRng(params.seed);
    this.paperRest = { x: (prng() - 0.5) * 0.04, y: (prng() - 0.5) * 0.04, rot: (prng() - 0.5) * 0.5 };
    this.paperDrift = { a: prng() * 6, b: prng() * 6, dir: prng() < 0.5 ? -1 : 1 };
  }

  /** The finished certificate (layers from renderCertificateLayers). */
  setCertificate(data: CertificateLayers | null) {
    this.clearCert();
    if (!data || !this.params) return;
    const pal = this.params.palette;
    const tex = (c: HTMLCanvasElement, mip = true) => {
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.NoColorSpace;
      t.generateMipmaps = mip;
      t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
      t.anisotropy = 8;
      return t;
    };
    // the stamp mask is alpha-only: bake it onto black so .r = coverage
    const mask = document.createElement('canvas');
    mask.width = data.sealMask.width;
    mask.height = data.sealMask.height;
    const mc = mask.getContext('2d')!;
    mc.fillStyle = '#000';
    mc.fillRect(0, 0, mask.width, mask.height);
    mc.drawImage(data.sealMask, 0, 0);
    const baseTex = tex(data.base);
    // premultiplied: the transparent, torn edges filter cleanly (no dark fringe)
    baseTex.premultiplyAlpha = true;
    const textures = [baseTex, tex(data.sealed), tex(mask, false), tex(data.shimmer)];
    const mat = new THREE.ShaderMaterial({
      vertexShader: BASIC_VERT,
      fragmentShader: CERT_FRAG,
      uniforms: {
        uBase: { value: textures[0] },
        uSealed: { value: textures[1] },
        uSealMask: { value: textures[2] },
        uShimmer: { value: textures[3] },
        uSealRect: { value: new THREE.Vector4(...data.sealRect) },
        uEngrave: { value: 0 },
        uOpacity: { value: 0 },
        uHeat: { value: 1 },
        uTime: { value: 0 },
        uShimmerAmt: { value: 0.55 },
        uMouse: { value: new THREE.Vector2() },
        uColA: { value: new THREE.Color(...pal.a) },
        uColB: { value: new THREE.Color(...pal.b) },
        uColC: { value: new THREE.Color(...pal.c) },
        uHot: { value: new THREE.Color(...pal.hot) },
      },
      side: THREE.DoubleSide,
      ...OVER,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    this.scene.add(mesh);
    this.cert = { mesh, mat, data, textures, emitted: 0 };
  }

  private clearCert() {
    if (!this.cert) return;
    this.scene.remove(this.cert.mesh);
    this.cert.mesh.geometry.dispose();
    this.cert.mat.dispose();
    this.cert.textures.forEach((t) => t.dispose());
    this.cert = null;
  }

  private clearCurse() {
    this.jobs = [];
    const drop = (t: THREE.Texture) => t !== this.blank && t.dispose();
    for (const l of this.layers) {
      l.mesh.geometry.dispose();
      drop(l.tex.core);
      drop(l.tex.glow);
      l.mat.dispose();
      this.construct.remove(l.mesh);
    }
    this.layers = [];
    for (const p of this.passers) {
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mat.dispose();
    }
    this.passers = [];
    for (const t of this.passerTextures) {
      drop(t.core);
      drop(t.glow);
    }
    this.passerTextures = [];

    (this.paperMat.uniforms.uMap.value as THREE.Texture | null)?.dispose();
    (this.paperMat.uniforms.uRuneMap.value as THREE.Texture | null)?.dispose();
    if (this.swarm) {
      this.scene.remove(this.swarm.back, this.swarm.front);
      this.swarm.dispose();
      this.swarm = null;
    }
    this.clearCert();
  }

  // ---------------------------------------------------------------- control

  start() {
    if (this.running) return;
    this.running = true;
    this.lastNow = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, Math.max(0, (now - this.lastNow) / 1000));
      this.lastNow = now;
      this.frame(dt, now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Back to the empty altar (form screen). */
  toIdle() {
    this.phase = 'idle';
    this.paper.visible = false;
    this.shadow.visible = false;
    this.construct.visible = false;
    if (this.swarm) this.swarm.visible = false;
    for (const p of this.passers) p.mesh.visible = false;
    if (this.cert) this.cert.mesh.visible = false;
    this.sparks.clear();
    this.dust.clear();
    this.engraveSparks.clear();
    this.lastF = -1;
    this.silentUntil = -1;
    for (const l of this.layers) l.mat.uniforms.uReveal.value = 0;
    this.audio?.reset();
  }

  /** The note appears in front of the viewer and falls onto the altar. */
  dropPaper() {
    this.toIdle();
    this.phase = 'paper';
    this.paperClock = 0;
    this.landedFired = false;
    this.paper.visible = true;
    this.shadow.visible = true;
    this.paperSpin = 0;
    this.paper.scale.set(PAPER_W, PAPER_W / this.paperAspect / 0.7, 1);
    if (this.cert) this.cert.emitted = 0;
  }

  /** Called once the video has switched to pribliji.mp4. */
  beginRitual() {
    this.flushJobs();
    this.phase = 'ritual';
    this.lastF = -1;
  }

  /** Jumps to a frame without firing the effects in between (skip / debug). */
  jumpTo(frame: number, freeze = false) {
    this.flushJobs();
    this.phase = 'ritual';
    this.paper.visible = true;
    this.silentUntil = frame;
    this.lastF = frame - 0.001;
    this.frozenFrame = freeze ? frame : null;
    this.deck.seekRitual(frame, freeze);
    this.audio?.jump(frame);
  }

  /** Where the certificate will sit (CSS px, centre + size); the circle settles behind it. */
  setFinalCenter(x: number, y: number, w = 0, h = 0) {
    this.finalCenter = { x, y, w, h };
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    const buf = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.post.setSize(buf.x, buf.y);
    this.cam.setViewport(w, h);
  }

  // ---------------------------------------------------------------- per frame

  private cover() {
    const W = this.cam.width;
    const H = this.cam.height;
    const vw = this.deck.stable.videoWidth || 1280;
    const vh = this.deck.stable.videoHeight || 720;
    // 4% overscan so the video can drift with the mouse without showing its edges
    const s = Math.max(W / vw, H / vh) * 1.04;
    const dispW = vw * s;
    const dispH = vh * s;
    const offX = (W - dispW) / 2;
    const offY = (H - dispH) / 2;
    const u = this.post.composite.uniforms;
    u.uCoverScale.value.set(W / dispW, H / dispH);
    u.uCoverOffset.value.set(-offX / dispW, -offY / dispH);
    return { W, H, dispW, dispH, offX, offY };
  }

  private trigger(f: number, at: number) {
    return this.lastF < at && f >= at && f > this.silentUntil;
  }

  /** On-screen radius (px) of the circle's outer frame at the end. */
  private frameRadiusPx(W: number, H: number) {
    return Math.min(W, H) * (H > W ? 0.78 : 0.54);
  }

  /** Where a layer rests at the end: a deep stack under the certificate, rings just below it. */
  private finalZ(a: LayerArt, hangIdx: number) {
    if (a.hang) return ZC - 0.05 - hangIdx * 0.07;
    const u = clamp01((a.zSlot - this.minSlot) / Math.max(0.01, this.maxSlot - this.minSlot));
    return ZC - 0.2 - (1 - u) * FINAL_DEPTH;
  }

  /**
   * Final framing: pixels per world unit on the certificate plane. Thanks to the depth
   * compensation every layer keeps its designed size, so the frame (radius 1) simply gets
   * the target radius on screen.
   */
  private finalPpu(W: number, H: number) {
    return this.frameRadiusPx(W, H);
  }

  /** Runs deferred texture work within a small time budget per frame. */
  private pumpJobs(budgetMs: number) {
    const t0 = performance.now();
    while (this.jobs.length && performance.now() - t0 < budgetMs) this.jobs.shift()!();
  }

  /** Finishes all pending texture work now (skip / debug jumps). */
  private flushJobs() {
    while (this.jobs.length) this.jobs.shift()!();
  }

  private frame(dt: number, now: number) {
    if (this.disposed) return;
    this.pumpJobs(8);
    this.time += dt;
    this.deck.tick(dt);
    const t = this.time;
    const P = this.params;
    const cv = this.cover();
    const { W, H } = cv;

    let F = this.phase === 'ritual' ? this.deck.ritualFrame(now) : -1;
    if (this.frozenFrame !== null && this.phase === 'ritual') F = this.frozenFrame;
    if (F >= 0) this.events.onFrame?.(F);

    // ---------- pointer (a little eager, so the scene follows the hand). On a phone nobody
    // hovers: the camera drifts on its own, the tilt of the phone steers it, a finger still can.
    if (this.touch) {
      const tx = 0.42 * Math.sin(t * 0.23) + 0.18 * Math.sin(t * 0.61 + 2);
      const ty = 0.36 * Math.sin(t * 0.19 + 1) + 0.15 * Math.sin(t * 0.53);
      const drift = tilt.active ? 0.6 : 1;
      this.target.set(
        Math.max(-1, Math.min(1, tx * drift + tilt.value.x * 1.1 + this.mouse.x * 0.5)),
        Math.max(-1, Math.min(1, ty * drift + tilt.value.y * 1.1 + this.mouse.y * 0.5)),
      );
    } else this.target.copy(this.mouse);
    this.mouseS.lerp(this.target, 1 - Math.exp(-dt * 5));
    const mx = this.mouseS.x;
    const my = this.mouseS.y;

    // ---------- framing
    // The camera looks straight down. One plane is glued to the screen (the "lock plane"):
    // during the ritual it is the top of the circle, at the end the certificate. Everything
    // below it — circle layers, the altar video, the tunnel — slides the same way when the
    // camera moves, and the deeper it is the more it slides: a well / tunnel.
    const zoom = F >= 0 ? videoZoom(F) : 1;
    const dive = F >= 0 ? diveProgress(F) : 0;
    const vc: [number, number] = [
      lerp(ALTAR_CENTER_WIDE[0], ALTAR_CENTER_ZOOMED[0], dive),
      lerp(ALTAR_CENTER_WIDE[1], ALTAR_CENTER_ZOOMED[1], dive),
    ];
    const vcx = cv.offX + vc[0] * cv.dispW;
    const vcy = cv.offY + vc[1] * cv.dispH;
    const ppuVideo = CONSTRUCT_RADIUS * cv.dispH * zoom;
    const dVideo = D0 / Math.pow(zoom, 0.8);
    const pull = F >= 0 ? easeInOutCubic((F - K.pullBackStart) / (K.pullBackEnd - K.pullBackStart)) : 0;
    const portrait = H > W;
    const fc = this.finalCenter ?? { x: W / 2, y: H * (portrait ? 0.42 : 0.5), w: 0, h: 0 };
    const ppuF = this.finalPpu(W, H);
    const D = lerp(dVideo, D_FINAL, pull);
    const lockRitual = LOCK_K * D;
    const lockZ = lerp(lockRitual, ZC, pull);
    // the altar plane must keep matching the video: its scale relative to the lock plane
    const sAltarRitual = D / (D + lockRitual);
    const ppuL = Math.exp(lerp(Math.log(ppuVideo / sAltarRitual), Math.log(ppuF), pull));
    this.cam.ppu = ppuL;
    this.cam.distance = D;
    this.cam.lockZ = lockZ;
    this.cam.centerX = lerp(vcx, fc.x, pull);
    this.cam.centerY = lerp(vcy, fc.y, pull);

    // pointer parallax: during the ritual limited so the video (the bottom of the well)
    // never shows its edges; at the end much freer
    const sAltar = D / (D + lockZ);
    const pxPerOffset = ppuL * (1 - sAltar); // how far the altar plane slides per unit of camera offset
    const ampRx = Math.min(0.16 * D, (0.018 * W) / Math.max(pxPerOffset, 1e-3));
    const ampRy = Math.min(0.16 * D, (0.018 * H) / Math.max(pxPerOffset, 1e-3));
    const ampF = 0.2 * D;
    const ampX = lerp(ampRx, ampF, pull);
    const ampY = lerp(ampRy, ampF, pull);
    this.cam.offsetX = mx * ampX + Math.sin(t * 0.37 + 1.3) * ampX * 0.18;
    this.cam.offsetY = -my * ampY + Math.cos(t * 0.29) * ampY * 0.18;
    this.cam.update();
    // the video slides exactly like the altar plane
    const shiftX = pxPerOffset * this.cam.offsetX;
    const shiftY = -pxPerOffset * this.cam.offsetY;
    this.post.composite.uniforms.uParallax.value.set(-shiftX / W, shiftY / H);

    // ---------- depth of the circle: compact during the ritual, a deep stack at the end
    const spreadRitual = SPREAD_K * D;
    const tighten = F >= 0 ? 1 - 0.7 * smooth(K.assembled - 6, K.assembled, F) * (1 - smooth(K.assembled, K.assembled + 4, F)) : 1;
    const reopen = F >= 0 ? easeOutCubic((F - K.assembled) / 32) : 0;
    const spread = spreadRitual * tighten;

    // ---------- events
    if (F >= 0) {
      if (F > this.silentUntil) this.audio?.frame(F, this.lastF);
      if (this.trigger(F, K.assembled)) this.impact();
      if (this.lastF < K.tailAudio && F >= K.tailAudio) void this.audio?.startTail();
      if (this.trigger(F, K.certBirth)) this.certBurst();
      if (this.lastF < K.certBirth && F >= K.certBirth) this.events.onCertBirth?.();
      if (this.trigger(F, K.engraveStart)) this.audio?.engrave((K.engraveEnd - K.engraveStart) / 24);
      if (this.lastF < K.uiOn && F >= K.uiOn) this.events.onUiReady?.();
    }

    // ---------- circle layers: fly up the tunnel, lock in, then open into a deep stack
    const circlesVisible = F >= K.circlesOn - 1;
    this.construct.visible = circlesVisible && this.layers.length > 0;
    const impactHeat = this.envelope(this.fxFlare, 0.5) * this.fxFlare.s;
    const idle = F >= K.certSettled;
    const spinTarget = F < 0 ? 1 : lerp(1, 2.4, smooth(K.circlesOn, K.zoomSettled, F)) * (1 - 0.5 * pull);
    this.spinBoost = lerp(this.spinBoost, spinTarget, 1 - Math.exp(-dt * 2));
    if (this.construct.visible && P) {
      for (const [gid, g] of this.groups) {
        g.angle += g.spin * P.spinScale * this.spinBoost * dt;
        this.groups.set(gid, g);
      }
      let hangIdx = 0;
      this.layers.forEach((l, i) => {
        const a = l.art;
        const u = l.mat.uniforms;
        const fl = clamp01((F - K.circlesOn) / Math.max(1, a.arrive - K.circlesOn));
        const e = easeInOutCubic(fl);
        const zFinal = this.finalZ(a, a.hang ? hangIdx++ : 0);
        const zTarget = lerp(a.zSlot * spread, zFinal, reopen);
        const z = lerp(a.zStart, zTarget, e);
        const sp = a.spiral * (1 - e);
        const sa = t * 0.6 + i * 1.7;
        l.angle += a.spin * P.spinScale * this.spinBoost * dt;
        let x = Math.cos(sa) * sp;
        let y = Math.sin(sa) * sp;
        let rot = l.angle + a.twist * (1 - e);
        if (a.orbit) {
          const ga = (this.groups.get(a.orbit.group)?.angle ?? 0) + a.orbit.a;
          x += Math.cos(ga) * a.orbit.r;
          y += Math.sin(ga) * a.orbit.r;
          rot += ga + Math.PI / 2;
        }
        if (a.at) {
          x += a.at[0];
          y += a.at[1];
        }
        if (a.follow !== undefined) rot += this.groups.get(a.follow)?.angle ?? 0;
        // depth compensation at the end: same picture at rest, real depth under the mouse
        const sRel = D / Math.max(D + lockZ - z, 1e-3);
        const comp = lerp(1, 1 / Math.max(sRel, 0.05), reopen);
        l.mesh.scale.setScalar(comp);
        l.mesh.position.set(x * comp, y * comp, z);
        l.mesh.rotation.z = rot;
        l.mesh.renderOrder = orderFor(z);
        if (this.trigger(F, a.arrive)) {
          l.lockT = 0;
          this.audio?.layerLocked(Math.max(-1, Math.min(1, x / 1.3)), a.radius);
          this.sparks.burst(Math.round((a.orbit || a.at ? 8 : 24) * P.particleDensity), { r0: a.radius * 0.95, x: a.orbit || a.at ? x : 0, y: a.orbit || a.at ? y : 0, speed: 0.35, up: 0.4, z, heat: 0.9, size: 0.008, life: 0.7 });
        }
        l.lockT += dt;
        const lock = Math.exp(-l.lockT * 4);
        const [r0, r1] = a.reveal;
        u.uReveal.value = clamp01((F - r0) / (r1 - r0));
        u.uTime.value = t;
        const breathe = idle ? 0.08 * Math.sin(t * 1.3 + i) : 0;
        const settle = lerp(1, a.hang ? 0.7 : 0.66, smooth(K.certBirth, K.certArrive, F));
        const deep = 1 - 0.25 * dive * (1 - pull) * (portrait ? 1.3 : 1);
        // fog: the deeper below the locked plane, the dimmer
        const fog = Math.exp(Math.min(0, z - lockZ + 0.3) / (pull > 0.5 ? 7 : 8));
        u.uIntensity.value = a.intensity * (1 + impactHeat * 0.7 + lock * 0.8) * settle * deep * fog * (1 + breathe);
        u.uHeat.value = 0.8 + impactHeat * 0.8 + lock * 1.2 + 0.08 * Math.sin(t * 2 + i);
        u.uGlowAmt.value = 0.9 * P.bloom * (1 + impactHeat * 0.6 + lock);
        u.uFade.value = 1 - smooth(1.9, 3.2, this.cam.liftScale(z));
      });
    }

    // ---------- tunnel passers: rise from the depth and fly past the camera
    for (const p of this.passers) {
      const k = (F - p.spawn) / p.dur;
      const on = F >= 0 && k >= 0 && k <= 1;
      // the moment it rushes past the camera
      if (on && F > this.silentUntil && (this.lastF - p.spawn) / p.dur < 0.8 && k >= 0.8) this.audio?.passerNear(Math.max(-1, Math.min(1, p.x / 1.2)));
      p.mesh.visible = on;
      if (!on) continue;
      const z = lerp(p.z0, this.cam.z + 0.25, k * k);
      p.mesh.position.set(p.x, p.y, z);
      p.mesh.rotation.z = p.rot + p.spin * k;
      p.mesh.scale.setScalar(p.scale);
      p.mesh.renderOrder = orderFor(z);
      const fog = Math.exp(Math.min(0, z) / 10);
      const near = 1 - smooth(1.6, 3.4, this.cam.liftScale(z));
      p.mat.uniforms.uAlpha.value = 0.75 * fog * near * smooth(0, 0.08, k);
    }

    // ---------- paper
    this.updatePaper(dt, F);

    // ---------- letters
    if (this.swarm) {
      const on = F >= 0 ? smooth(K.lettersOn, K.lettersOn + 18, F) : 0;
      this.swarm.visible = on > 0.001;
      const u = this.swarm.material.uniforms;
      u.uTime.value = t;
      u.uSpread.value = Math.max(spread, 0.05);
      u.uCamZ.value = this.cam.z;
      u.uCamD.value = D;
      u.uFinalMix.value = reopen;
      u.uZTop.value = ZC - 0.12;
      u.uDepth.value = FINAL_DEPTH + 0.9;
      u.uOpacity.value = on * 0.55;
      this.swarm.back.renderOrder = orderFor(lerp(0, ZC - 0.1, reopen)) - 1;
      this.swarm.front.renderOrder = 6000;
    }

    // ---------- certificate
    this.updateCert(F, ppuF, fc);

    // ---------- particles
    let rate = 0;
    let swirl = 0.15;
    if (this.phase === 'paper') rate = 6;
    if (F >= 0) {
      rate = lerp(8, 26, smooth(40, 175, F));
      rate = lerp(rate, 60, smooth(K.circlesOn, K.zoomSettled, F));
      rate = lerp(rate, 0, smooth(K.assembled + 5, K.certArrive, F));
      swirl = lerp(0.2, 1.4, smooth(K.circlesOn, K.zoomSettled, F));
      swirl = lerp(swirl, 0.35, pull);
    }
    const density = P?.particleDensity ?? 1;
    this.sparks.emberRate = rate * density;
    this.sparks.swirl = swirl * -(P?.spinDir ?? 1);
    this.sparks.emberRadius = F >= K.circlesOn ? 1.1 : 0.9;
    // lots of fine motes hanging around the finished circle, in front of and behind the sheet
    this.dust.dustRate = F >= 0 ? smooth(K.assembled, K.certArrive, F) * 55 * density : 0;
    this.dust.dustVolume = { r: 1.9, z0: ZC - 0.2 - FINAL_DEPTH - 1.5, z1: ZC + 0.5 };
    const pointScale = this.cam.pointScale * this.renderer.getPixelRatio();
    for (const ps of [this.sparks, this.dust, this.engraveSparks]) {
      const pu = ps.material.uniforms;
      pu.uPointScale.value = pointScale;
      pu.uCamDist.value = this.cam.distance;
      pu.uMaxSize.value = 36 * this.renderer.getPixelRatio();
      ps.update(dt, t);
    }

    // ---------- one-shot effects
    this.updateEffects(dt, spread);

    // ---------- composite
    const cu = this.post.composite.uniforms;
    cu.uMix.value = this.deck.mix;
    cu.uTime.value = t;
    cu.uVideoFade.value = F >= 0 ? 1 - smooth(K.videoFadeStart, 269, F) : 1;
    cu.uBloom.value = 0.55 * (P?.bloom ?? 1);
    const shake = this.envelope(this.fxShake, 0.45) * this.fxShake.s;
    cu.uShake.value.set(
      (Math.sin(t * 91) + Math.sin(t * 57)) * 0.004 * shake,
      (Math.cos(t * 83) + Math.sin(t * 61)) * 0.004 * shake * (W / H),
    );
    cu.uFlash.value = this.envelope(this.fxFlash, 0.35) * this.fxFlash.s;
    const sh = this.fxShock;
    cu.uShock.value.set(this.cam.centerX / W, 1 - this.cam.centerY / H, sh.t * 0.9, sh.t < 1 ? sh.s * (1 - sh.t) : 0);
    const haze = F >= 0 ? smooth(30, 120, F) * (1 - smooth(K.paperGone - 20, K.paperGone, F)) : 0;
    cu.uHeatHaze.value = haze;
    cu.uHazeCenter.value.set(this.cam.centerX / W, 1 - this.cam.centerY / H);

    this.post.renderFx(this.scene, this.cam.camera);
    this.post.bloom(0.45);
    this.post.present();

    if (F >= 0) this.lastF = F;
  }

  private updateCert(F: number, ppuF: number, fc: { w: number; h: number }) {
    const c = this.cert;
    if (!c) return;
    const visible = F >= K.certBirth;
    c.mesh.visible = visible;
    if (!visible) return;
    const u = c.mat.uniforms;
    // size: exactly the certificate slot of the page at the end
    const aspect = c.data.base.width / c.data.base.height;
    let wPx = fc.w;
    let hPx = fc.h;
    if (!wPx || !hPx) {
      hPx = Math.min(this.cam.height * 0.8, 1000);
      wPx = hPx * aspect;
    }
    const cw = wPx / ppuF;
    const ch = hPx / ppuF;
    c.mesh.scale.set(cw, ch, 1);

    // birth: rises from the depth of the vortex, spinning, towards the viewer
    const b = easeOutCubic((F - K.certBirth) / (K.certArrive - K.certBirth));
    const z = lerp(-3.5, ZC, b);
    // engraving: the sheet trembles and slowly leans, then returns to its place
    const eng = smooth(K.engraveStart - 2, K.engraveStart + 20, F) * (1 - smooth(K.engraveEnd, K.certRest, F));
    const tremble = eng * 0.0035;
    const jx = (Math.sin(this.time * 71) + Math.sin(this.time * 113)) * tremble;
    const jy = (Math.cos(this.time * 83) + Math.sin(this.time * 97)) * tremble;
    const rest = smooth(K.certArrive, K.certArrive + 20, F);
    c.mesh.position.set(jx, jy, z);
    c.mesh.rotation.set(
      lerp(1.15, 0, b) + eng * 0.07 - this.mouseS.y * 0.07 * rest,
      eng * -0.05 + this.mouseS.x * 0.09 * rest,
      lerp(-2.6, 0, b),
    );
    c.mesh.renderOrder = orderFor(z);
    u.uOpacity.value = smooth(K.certBirth, K.certBirth + 4, F);
    u.uHeat.value = 1 - smooth(K.certBirth + 6, K.certArrive + 6, F);
    u.uTime.value = this.time;
    u.uMouse.value.set(this.mouseS.x, this.mouseS.y);
    u.uShimmerAmt.value = 0.85 * smooth(K.certArrive - 10, K.certArrive + 20, F);
    const eProg = clamp01((F - K.engraveStart) / (K.engraveEnd - K.engraveStart));
    u.uEngrave.value = eProg;

    // sparks falling off the engraving front
    if (eProg > 0 && eProg < 1 && F > this.silentUntil) {
      const front = eProg * 1.25 - 0.1;
      const pts = c.data.engrave;
      let limit = 30;
      c.mesh.updateMatrixWorld();
      const v = new THREE.Vector3();
      while (c.emitted < pts.length && pts[c.emitted][1] < front && limit-- > 0) {
        const [px, py] = pts[c.emitted];
        c.emitted += 1 + Math.floor(Math.random() * 2);
        const [rx, ry, rw, rh] = c.data.sealRect;
        const uu = rx + px * rw;
        const vv = ry + (1 - py) * rh;
        v.set(uu - 0.5, vv - 0.5, 0.002).applyMatrix4(c.mesh.matrixWorld);
        this.engraveSparks.emit(
          v.x, v.y, v.z,
          (Math.random() - 0.5) * 0.12, -0.05 - Math.random() * 0.12, 0.02 + Math.random() * 0.06,
          0.5 + Math.random() * 0.7, 0.004 + Math.random() * 0.005, 0.9,
        );
      }
    } else if (F < K.engraveStart) c.emitted = 0;
  }

  private updatePaper(dt: number, F: number) {
    const u = this.paperMat.uniforms;
    u.uTime.value = this.time;
    const rest = this.paperRest;
    const lie = 0.012;

    if (this.phase === 'paper') {
      this.paperClock += dt;
      const tp = this.paperClock;
      // Big and readable in front of the viewer, then it falls like a leaf.
      const targetPx = Math.min(this.cam.width * 0.84, this.cam.height * 0.62 * 1.43, 860);
      const sShow = Math.max(1.05, targetPx / (PAPER_W * this.cam.ppu));
      const zShow = Math.min(this.cam.heightForScale(sShow), this.cam.lockZ + this.cam.distance * 0.82);
      const appear = easeOutCubic(tp / P_APPEAR);
      const fallT = clamp01((tp - P_HOLD_END) / (P_FALL_END - P_HOLD_END));
      const fall = easeInOutCubic(fallT);
      const flutter = Math.sin(Math.PI * fallT);
      const d = this.paperDrift;
      const z = lerp(zShow + (1 - appear) * 0.08 * this.cam.distance, lie, Math.pow(fall, 1.25));
      const x = lerp(0, rest.x, fall) + Math.sin(tp * 1.9 + d.a) * 0.22 * flutter;
      const y = lerp(-0.02 * (1 - appear), rest.y, fall) + Math.cos(tp * 1.4 + d.b) * 0.12 * flutter;
      this.paper.position.set(x, y, z);
      this.paper.rotation.set(
        Math.sin(tp * 3.1 + d.a) * 0.55 * flutter + (1 - appear) * 0.4 - this.mouseS.y * 0.08 * (1 - fall),
        Math.sin(tp * 2.3 + d.b) * 0.45 * flutter + this.mouseS.x * 0.1 * (1 - fall),
        lerp(0.02 * Math.sin(tp), rest.rot, fall) + d.dir * 0.9 * flutter,
      );
      this.paper.renderOrder = orderFor(z);
      this.shadow.renderOrder = orderFor(0) - 1;
      u.uOpacity.value = appear;
      u.uBend.value = 0.35 * Math.sin(tp * 4.2) * flutter + 0.05 * (1 - fall);
      u.uWave.value = 0.5 * flutter;
      u.uBurn.value = 0;
      u.uScorch.value = 0;
      u.uRunes.value = 0;
      const lit = lerp(0.93, 0.72, fall);
      u.uTint.value.setRGB(lit, lit * lerp(0.93, 0.78, fall), lit * lerp(0.84, 0.66, fall));
      this.placeShadow(x, y, z, appear);

      if (tp >= P_FALL_END && !this.landedFired) {
        this.landedFired = true;
        this.sparks.burst(40, { r0: 0.28, speed: 0.5, up: 0.25, heat: 0.5, size: 0.01, life: 0.9 });
        this.fxRing = { t: 0, s: 0.35, speed: 0.6 };
        this.fxFlare = { t: 0, s: 0.25 };
      }
      if (tp >= P_FALL_END + P_LAND_WAIT && this.landedFired && tp - dt < P_FALL_END + P_LAND_WAIT) {
        this.events.onLanded?.();
      }
      return;
    }

    if (this.phase !== 'ritual' || F < 0) {
      if (this.phase === 'idle') {
        this.paper.visible = false;
        this.shadow.visible = false;
      }
      return;
    }

    // On the altar: heat builds, letters burn through, then it sinks into the tunnel and burns.
    const pullT = clamp01((F - K.paperPullStart) / (K.paperGone - K.paperPullStart));
    const pullE = pullT * pullT * (3 - 2 * pullT);
    const visible = F < K.paperGone + 2;
    this.paper.visible = visible;
    this.shadow.visible = visible && pullT < 0.3;
    if (!visible) return;
    this.paperSpin += dt * (0.2 + pullE * 6) * (this.params?.spinDir ?? 1);
    // keep its size on screen while the camera dives, then it sinks into the tunnel
    const zoomNow = videoZoom(F);
    const sc = lerp(1, 1 / zoomNow, smooth(K.zoomStart, K.zoomSettled, F));
    this.paper.scale.set(PAPER_W * sc, (PAPER_W / this.paperAspect / 0.7) * sc, 1);
    const z = lie - pullE * pullE * 5;
    this.paper.position.set(rest.x * (1 - pullE), rest.y * (1 - pullE), z);
    this.paper.rotation.set(0, 0, rest.rot + this.paperSpin * pullE);
    this.paper.renderOrder = orderFor(z);
    u.uOpacity.value = 1;
    u.uBend.value = 0.12 * pullE * Math.sin(this.time * 5);
    u.uWave.value = 0.2 * pullE;
    u.uScorch.value = smooth(40, 185, F) * 0.9 + pullE * 0.5;
    u.uRunes.value = smooth(80, 180, F) * 0.6 * (0.8 + 0.2 * Math.sin(this.time * 6));
    u.uBurn.value = smooth(K.paperBurnStart, K.paperGone - 2, F);
    const warm = lerp(0.72, 0.62, smooth(100, 186, F));
    u.uTint.value.setRGB(warm * 1.02, warm * 0.78, warm * 0.62);
    this.placeShadow(this.paper.position.x, this.paper.position.y, lie, 1 - pullE);
  }

  private placeShadow(x: number, y: number, z: number, opacity: number) {
    const h = clamp01(z / Math.max(this.cam.distance * 0.8, 0.001));
    const size = 1 + h * 0.7;
    this.shadow.position.set(x + 0.02 + h * 0.18, y - 0.03 - h * 0.12, 0.002);
    this.shadow.rotation.set(0, 0, this.paper.rotation.z);
    this.shadow.scale.set(this.paper.scale.x * size * 1.15, this.paper.scale.y * 0.7 * size * 1.2, 1);
    this.shadowMat.uniforms.uOpacity.value = opacity * lerp(0.6, 0.12, h);
    this.shadowMat.uniforms.uSoft.value = 0.15 + h;
  }

  /** The circle is complete. */
  private impact() {
    const power = 1;
    this.fxFlare = { t: 0, s: power };
    this.fxRing = { t: 0, s: power, speed: 1.7 };
    this.fxShake = { t: 0, s: 1.4 };
    this.fxFlash = { t: 0, s: 0.24 };
    this.fxShock = { t: 0, s: 1.1 };
    this.fxFire = { t: 0, s: power, dur: 1.6 };
    const n = Math.round(380 * (this.params?.particleDensity ?? 1));
    this.sparks.burst(n, { r0: 0.05, speed: 2.6, up: 1.2, heat: 1.2, size: 0.013, life: 1.2 });
    this.sparks.burst(Math.round(n * 0.6), { r0: 0.64, speed: 0.9, up: 0.8, heat: 0.9, size: 0.01, life: 1 });
  }

  private certBurst() {
    this.fxFlare = { t: 0, s: 0.7 };
    this.fxFire = { t: 0, s: 0.7, dur: 1.2 };
    this.fxSmoke = { t: 0, s: 1 };
    this.fxFlash = { t: 0, s: 0.14 };
    this.fxShock = { t: 0, s: 0.5 };
    this.sparks.burst(220, { r0: 0.02, speed: 1.1, up: 1.6, heat: 1.1, size: 0.012, life: 1.4 });
  }

  /** Decay envelope: 1 at trigger -> 0 after `len` seconds. */
  private envelope(e: { t: number }, len: number) {
    if (e.t >= len * 4) return 0;
    const x = e.t / len;
    return Math.exp(-x * x * 1.2);
  }

  private updateEffects(dt: number, spread: number) {
    for (const e of [this.fxFlare, this.fxRing, this.fxFire, this.fxSmoke, this.fxShake, this.fxFlash, this.fxShock]) e.t += dt;
    const top = this.maxSlot * spread;

    const fl = this.envelope(this.fxFlare, 0.35) * this.fxFlare.s;
    this.flare.visible = fl > 0.002;
    if (this.flare.visible) {
      this.flare.position.set(0, 0, top + 0.02);
      const s = 0.45 + this.fxFlare.s * 0.8;
      this.flare.scale.set(s * 2.4, s, 1);
      this.flare.renderOrder = orderFor(top + 0.02);
      (this.flare.material as THREE.ShaderMaterial).uniforms.uIntensity.value = fl * 1.1;
    }

    const r = this.fxRing;
    const ringLife = 1.1;
    this.ring.visible = r.t < ringLife;
    if (this.ring.visible) {
      const k = r.t / ringLife;
      const u = (this.ring.material as THREE.ShaderMaterial).uniforms;
      this.ring.position.set(0, 0, spread * 1.8);
      this.ring.renderOrder = orderFor(spread * 1.8);
      this.ring.scale.setScalar(3.2);
      u.uRadius.value = easeOutCubic(k) * 0.95 * r.speed * 0.8;
      u.uWidth.value = 0.012 + k * 0.03;
      u.uIntensity.value = r.s * (1 - k) * (1 - k) * 2.2;
    }

    const f = this.fxFire;
    this.fire.visible = f.t < f.dur;
    if (this.fire.visible) {
      const k = f.t / f.dur;
      const u = (this.fire.material as THREE.ShaderMaterial).uniforms;
      this.fire.position.set(0, 0, spread * 0.5 + 0.01);
      this.fire.renderOrder = orderFor(spread * 0.5);
      this.fire.scale.setScalar(1.6 + f.s * 1.4);
      u.uTime.value = this.time;
      u.uRadius.value = 0.08 + k * 0.25;
      u.uIntensity.value = f.s * Math.sin(Math.PI * Math.min(1, k * 1.4 + 0.05)) * 1.1;
    }

    const sm = this.fxSmoke;
    const smLife = 2.4;
    this.smoke.visible = sm.t < smLife;
    if (this.smoke.visible) {
      const k = sm.t / smLife;
      const u = (this.smoke.material as THREE.ShaderMaterial).uniforms;
      this.smoke.position.set(0, 0, ZC * 0.6);
      this.smoke.renderOrder = orderFor(ZC * 0.6);
      this.smoke.scale.setScalar(0.4 + easeOutCubic(k) * 1.6);
      u.uTime.value = this.time;
      u.uSeed.value = 3.7;
      u.uOpacity.value = sm.s * Math.sin(Math.PI * Math.min(1, k * 1.2 + 0.02)) * 0.6;
    }
  }

  dispose() {
    this.disposed = true;
    this.stop();
    window.removeEventListener('pointermove', this.onPointer);
    window.removeEventListener('pointerdown', this.onPointer);
    document.removeEventListener('pointerleave', this.onLeave);
    this.clearCurse();
    this.sparks.dispose();
    this.dust.dispose();
    this.engraveSparks.dispose();
    this.post.dispose();
    this.atlas.dispose();
    this.blank.dispose();
    this.stableTex.dispose();
    this.pribTex.dispose();
    this.renderer.dispose();
    this.holder.remove();
  }
}
