import * as THREE from 'three';
import { AltarCamera } from './AltarCamera';
import { Post } from './Post';
import { Particles } from './Particles';
import { GlyphSwarm } from './GlyphSwarm';
import { renderGlyphAtlas, renderLayerTextures } from './textures';
import {
  BASIC_VERT, CIRCLE_FRAG, FIRE_FRAG, FLARE_FRAG, PAPER_FRAG, PAPER_VERT, RING_FRAG, SHADOW_FRAG, SMOKE_FRAG,
} from './shaders';
import { buildLayers, type LayerArt } from '../art/circleArt';
import type { PaperArt } from '../art/paperArt';
import type { RitualParams } from '../params';
import type { VideoDeck } from '../VideoDeck';
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
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  angle: number;
  spin: number;
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

const SHADOW_BLEND = {
  ...OVER,
  blendSrc: THREE.SrcAlphaFactor,
} as const;

/** World size of the note (construct radius = 1). */
const PAPER_W = 0.62;
const D0 = 3.0; // camera height at zoom 1 (in construct radii)
const D_FINAL = 2.45;
const SPREAD_K = 0.085; // layer slot spacing as a fraction of camera height

// Paper phase timings (seconds)
const P_APPEAR = 0.7;
const P_HOLD_END = 2.3;
const P_FALL_END = 5.1;
const P_LAND_WAIT = 0.35;

export class RitualEngine {
  readonly renderer: THREE.WebGLRenderer;
  private post: Post;
  private cam = new AltarCamera();
  private scene = new THREE.Scene();
  private stableTex: THREE.VideoTexture;
  private pribTex: THREE.VideoTexture;
  private layers: Layer[] = [];
  private construct = new THREE.Group();
  private paper: THREE.Mesh;
  private paperMat: THREE.ShaderMaterial;
  private shadow: THREE.Mesh;
  private shadowMat: THREE.ShaderMaterial;
  private particles: Particles;
  private swarm: GlyphSwarm | null = null;
  private atlas: THREE.DataTexture;
  private flare: THREE.Mesh;
  private ring: THREE.Mesh;
  private fire: THREE.Mesh;
  private smoke: THREE.Mesh;
  private params: RitualParams | null = null;

  private phase: Phase = 'idle';
  private paperClock = 0;
  private landedFired = false;
  private lastF = -1;
  private time = 0;
  private raf = 0;
  private lastNow = 0;
  private running = false;
  private disposed = false;
  private quality: { dpr: number; maxTex: number; density: number; particles: number };
  private silentUntil = -1;
  private paperRest = { x: 0, y: 0, rot: 0 };
  private paperDrift = { a: 0, b: 0, dir: 1 };
  private paperSpin = 0;
  private paperAspect = 1.43;

  // one-shot effect envelopes (seconds since trigger, strength)
  private fxFlare = { t: 99, s: 0 };
  private fxRing = { t: 99, s: 0, speed: 1 };
  private fxFire = { t: 99, s: 0, dur: 1 };
  private fxSmoke = { t: 99, s: 0 };
  private fxShake = { t: 99, s: 0 };
  private fxFlash = { t: 99, s: 0 };
  private fxShock = { t: 99, s: 0 };
  private spinBoost = 0;

  /** Debug: freeze on a frame (from ?frame=N). */
  frozenFrame: number | null = null;
  private finalCenter: { x: number; y: number } | null = null;
  private holder: HTMLDivElement;

  constructor(private canvas: HTMLCanvasElement, private deck: VideoDeck, private events: EngineEvents = {}) {
    const mobile = matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 700;
    this.quality = mobile
      ? { dpr: Math.min(devicePixelRatio, 1.5), maxTex: 1024, density: 1300, particles: 500 }
      : { dpr: Math.min(devicePixelRatio, 2), maxTex: 2048, density: 2400, particles: 1000 };

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
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
    this.paper.renderOrder = 5;
    this.paper.visible = false;
    this.scene.add(this.paper);

    this.shadowMat = new THREE.ShaderMaterial({
      vertexShader: BASIC_VERT,
      fragmentShader: SHADOW_FRAG,
      uniforms: { uOpacity: { value: 0 }, uSoft: { value: 0 } },
      ...SHADOW_BLEND,
    });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.shadowMat);
    this.shadow.renderOrder = 4;
    this.shadow.visible = false;
    this.scene.add(this.shadow);

    this.particles = new Particles(this.quality.particles);
    this.scene.add(this.particles.points);

    const fxMat = (frag: string, uniforms: Record<string, THREE.IUniform>, blend: object = ADDITIVE) =>
      new THREE.ShaderMaterial({ vertexShader: BASIC_VERT, fragmentShader: frag, uniforms, ...blend });
    this.flare = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      fxMat(FLARE_FRAG, { uIntensity: { value: 0 }, uColor: { value: new THREE.Color(1, 0.4, 0.1) }, uStreak: { value: 1 } }),
    );
    this.ring = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      fxMat(RING_FRAG, {
        uRadius: { value: 0 }, uWidth: { value: 0.02 }, uIntensity: { value: 0 }, uColor: { value: new THREE.Color(1, 0.5, 0.15) },
      }),
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
      fxMat(SMOKE_FRAG, {
        uTime: { value: 0 }, uOpacity: { value: 0 }, uSeed: { value: 0 }, uColor: { value: new THREE.Color(0.55, 0.3, 0.2) },
      }, OVER),
    );
    this.flare.renderOrder = 70;
    this.ring.renderOrder = 60;
    this.fire.renderOrder = 45;
    this.smoke.renderOrder = 65;
    for (const m of [this.flare, this.ring, this.fire, this.smoke]) {
      m.frustumCulled = false;
      m.visible = false;
      this.scene.add(m);
    }

    this.resize();
    if (import.meta.env.DEV) (window as unknown as { __engine: RitualEngine }).__engine = this;
  }

  // ---------------------------------------------------------------- setup

  /** Builds the circle layers, note texture and letter swarm for a curse. */
  prepare(params: RitualParams, paper: PaperArt) {
    this.clearCurse();
    this.params = params;
    const pal = params.palette;
    const arts = buildLayers(params);
    const lw = 0.0042 * params.lineWeight;
    arts.forEach((art, i) => {
      const tex = renderLayerTextures(art, this.quality.maxTex, this.quality.density, lw);
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
          uDeep: { value: new THREE.Color(...pal.deep) },
          uMid: { value: new THREE.Color(...pal.mid) },
          uHot: { value: new THREE.Color(...pal.hot) },
          uGlowCol: { value: new THREE.Color(...pal.glow) },
        },
        side: THREE.DoubleSide,
        ...ADDITIVE,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2 * tex.extent, 2 * tex.extent), mat);
      mesh.renderOrder = 10 + i;
      mesh.frustumCulled = false;
      this.construct.add(mesh);
      this.layers.push({ art, mesh, mat, angle: (i * 0.7) % (Math.PI * 2), spin: params.spin[i % params.spin.length] });
    });
    this.construct.visible = false;

    const map = new THREE.CanvasTexture(paper.paper);
    map.colorSpace = THREE.NoColorSpace;
    map.anisotropy = 8;
    const runes = new THREE.CanvasTexture(paper.runes);
    runes.colorSpace = THREE.NoColorSpace;
    this.paperMat.uniforms.uMap.value = map;
    this.paperMat.uniforms.uRuneMap.value = runes;
    this.paperAspect = paper.aspect;
    this.paper.scale.set(PAPER_W, PAPER_W / paper.aspect / 0.7, 1);

    const g = params.glyphs;
    this.swarm = new GlyphSwarm(this.atlas, [g.name, g.punishment, g.reason], params.seed);
    this.swarm.mesh.visible = false;
    this.scene.add(this.swarm.mesh);

    const rng = mulberry(params.seed);
    this.paperRest = { x: (rng() - 0.5) * 0.04, y: (rng() - 0.5) * 0.04, rot: (rng() - 0.5) * 0.5 };
    this.paperDrift = { a: rng() * 6, b: rng() * 6, dir: rng() < 0.5 ? -1 : 1 };
  }

  private clearCurse() {
    for (const l of this.layers) {
      l.mesh.geometry.dispose();
      (l.mat.uniforms.uCore.value as THREE.Texture).dispose();
      (l.mat.uniforms.uGlow.value as THREE.Texture).dispose();
      l.mat.dispose();
      this.construct.remove(l.mesh);
    }
    this.layers = [];
    (this.paperMat.uniforms.uMap.value as THREE.Texture | null)?.dispose();
    (this.paperMat.uniforms.uRuneMap.value as THREE.Texture | null)?.dispose();
    if (this.swarm) {
      this.scene.remove(this.swarm.mesh);
      this.swarm.dispose();
      this.swarm = null;
    }
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
    if (this.swarm) this.swarm.mesh.visible = false;
    this.particles.clear();
    this.lastF = -1;
    this.silentUntil = -1;
    for (const l of this.layers) l.mat.uniforms.uReveal.value = 0;
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
  }

  /** Called once the video has switched to pribliji.mp4. */
  beginRitual() {
    this.phase = 'ritual';
    this.lastF = -1;
  }

  /** Jumps to a frame without firing the effects in between (skip / debug). */
  jumpTo(frame: number, freeze = false) {
    this.phase = 'ritual';
    this.paper.visible = true;
    this.silentUntil = frame;
    this.lastF = frame - 0.001;
    this.frozenFrame = freeze ? frame : null;
    this.deck.seekRitual(frame, freeze);
  }

  /** Where the certificate will sit (CSS px); the circle settles behind it. */
  setFinalCenter(x: number, y: number) {
    this.finalCenter = { x, y };
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
    const s = Math.max(W / vw, H / vh);
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

  private frame(dt: number, now: number) {
    if (this.disposed) return;
    this.time += dt;
    this.deck.tick(dt);
    const t = this.time;
    const P = this.params;
    const cv = this.cover();
    const { W, H } = cv;

    let F = this.phase === 'ritual' ? this.deck.ritualFrame(now) : -1;
    if (this.frozenFrame !== null && this.phase === 'ritual') F = this.frozenFrame;
    if (F >= 0) this.events.onFrame?.(F);

    // ---------- framing (camera locked to the altar of the video, then pulling back)
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
    const ppuFinal = Math.min(W, H) * (portrait ? 0.5 : 0.46);
    this.cam.ppu = Math.exp(lerp(Math.log(ppuVideo), Math.log(ppuFinal), pull));
    const fc = this.finalCenter ?? { x: W / 2, y: H * (portrait ? 0.42 : 0.5) };
    this.cam.centerX = lerp(vcx, fc.x, pull);
    this.cam.centerY = lerp(vcy, fc.y, pull);
    this.cam.distance = lerp(dVideo, D_FINAL, pull);

    // ---------- depth spread of the layers (open / stamp / reopen)
    let spread01 = 0;
    if (F >= K.circlesOn) {
      spread01 = easeOutCubic((F - K.circlesOn) / 26);
      for (const s of K.stamps) spread01 *= stampFactor(F, s, 4, 12);
      // the big stamp, then the mechanism opens wider than ever
      if (F >= K.bigStamp - 6) {
        const collapse = 1 - smooth(K.bigStamp - 6, K.bigStamp, F);
        const reopen = easeOutCubic((F - (K.bigStamp + 2)) / 26) * 1.35;
        spread01 = F < K.bigStamp + 2 ? spread01 * collapse : reopen;
      }
    }
    const spread = spread01 * SPREAD_K * this.cam.distance;

    // lateral drift for parallax (z=0 stays locked to the video)
    const driftAmp = (F >= K.circlesOn ? lerp(0.03, 0.06, pull) : 0.02) * this.cam.distance;
    this.cam.offsetX = Math.sin(t * 0.37 + 1.3) * driftAmp;
    this.cam.offsetY = Math.cos(t * 0.29) * driftAmp;
    this.cam.update();

    // ---------- events
    if (F >= 0) {
      for (const s of K.stamps) {
        if (this.trigger(F, s)) this.stamp(0.55);
      }
      if (this.trigger(F, K.bigStamp)) this.stamp(1);
      if (this.trigger(F, K.certBirth)) {
        this.certBurst();
        this.events.onCertBirth?.();
      } else if (this.lastF < K.certBirth && F >= K.certBirth) this.events.onCertBirth?.();
      if (this.lastF < K.uiOn && F >= K.uiOn) this.events.onUiReady?.();
    }

    // ---------- circles
    const circlesVisible = F >= K.circlesOn - 1;
    this.construct.visible = circlesVisible && this.layers.length > 0;
    const stampHeat = this.envelope(this.fxFlare, 0.5) * this.fxFlare.s;
    const idle = F >= K.certSettled;
    const spinTarget = F < 0 ? 1 : lerp(1, 2.6, smooth(K.circlesOn, K.zoomSettled, F)) * (1 - 0.55 * pull);
    this.spinBoost = lerp(this.spinBoost, spinTarget, 1 - Math.exp(-dt * 2));
    if (this.construct.visible && P) {
      this.layers.forEach((l, i) => {
        const [r0, r1] = l.art.reveal;
        const reveal = clamp01((F - r0) / (r1 - r0));
        l.angle += l.spin * P.spinScale * this.spinBoost * dt;
        l.mesh.rotation.z = l.angle;
        l.mesh.position.z = l.art.zSlot * spread;
        const u = l.mat.uniforms;
        u.uReveal.value = reveal;
        u.uTime.value = t;
        const breathe = idle ? 0.08 * Math.sin(t * 1.3 + i) : 0;
        const settle = lerp(1, 0.72, smooth(K.certBirth, K.certSettled, F));
        u.uIntensity.value = l.art.intensity * (1 + stampHeat * 0.7) * settle * (1 + breathe);
        u.uHeat.value = 0.8 + stampHeat * 0.8 + 0.08 * Math.sin(t * 2 + i);
        // layers rushing past the camera fade out instead of turning into huge blurry blobs
        u.uFade.value = 1 - smooth(1.9, 3.2, this.cam.liftScale(l.mesh.position.z));
        u.uGlowAmt.value = 0.9 * P.bloom * (1 + stampHeat * 0.6);
      });
    }

    // ---------- paper
    this.updatePaper(dt, F);

    // ---------- letters
    if (this.swarm) {
      const on = F >= 0 ? smooth(K.lettersOn, K.lettersOn + 18, F) : 0;
      this.swarm.mesh.visible = on > 0.001;
      const u = this.swarm.material.uniforms;
      u.uTime.value = t;
      u.uSpread.value = Math.max(spread, 0.06 * this.cam.distance * on);
      u.uOpacity.value = on * 0.3;
    }

    // ---------- particles
    let rate = 5;
    let swirl = 0.15;
    if (this.phase === 'paper') rate = 6;
    if (F >= 0) {
      rate = lerp(8, 26, smooth(40, 175, F));
      rate = lerp(rate, 70, smooth(K.circlesOn, K.zoomSettled, F));
      rate = lerp(rate, 20, smooth(K.bigStamp + 10, K.certSettled, F));
      swirl = lerp(0.2, 1.4, smooth(K.circlesOn, K.zoomSettled, F));
      swirl = lerp(swirl, 0.35, pull);
    }
    this.particles.emberRate = rate * (P?.particleDensity ?? 1);
    this.particles.swirl = swirl * Math.sign(P?.spin[5] ?? 1) * -1;
    this.particles.emberRadius = F >= K.circlesOn ? 1.1 : 0.9;
    const pu = this.particles.material.uniforms;
    pu.uPointScale.value = this.cam.pointScale * this.renderer.getPixelRatio();
    pu.uCamDist.value = this.cam.distance;
    pu.uMaxSize.value = 36 * this.renderer.getPixelRatio();
    this.particles.update(dt, t);

    // ---------- one-shot effects
    this.updateEffects(dt, spread);

    // ---------- composite uniforms
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
    cu.uShock.value.set(
      this.cam.centerX / W,
      1 - this.cam.centerY / H,
      sh.t * 0.9,
      sh.t < 1 ? sh.s * (1 - sh.t) : 0,
    );
    // heat haze over the note while it lies on the hot stone
    const haze = F >= 0 ? smooth(30, 120, F) * (1 - smooth(K.paperGone - 20, K.paperGone, F)) : 0;
    cu.uHeatHaze.value = haze;
    cu.uHazeCenter.value.set(this.cam.centerX / W, 1 - this.cam.centerY / H);

    // ---------- render
    this.post.renderFx(this.scene, this.cam.camera);
    this.post.bloom(0.45);
    this.post.present();

    if (F >= 0) this.lastF = F;
  }

  private updatePaper(dt: number, F: number) {
    const u = this.paperMat.uniforms;
    u.uTime.value = this.time;
    const rest = this.paperRest;
    const lie = 0.012;
    const aspectScale = this.paper.scale.x;

    if (this.phase === 'paper') {
      this.paperClock += dt;
      const tp = this.paperClock;
      // Big and readable in front of the viewer, then it falls like a leaf.
      const targetPx = Math.min(this.cam.width * 0.84, this.cam.height * 0.62 * 1.43, 860);
      const sShow = Math.max(1.05, targetPx / (aspectScale * this.cam.ppu));
      const zShow = Math.min(this.cam.heightForScale(sShow), this.cam.distance * 0.82);
      const appear = easeOutCubic(tp / P_APPEAR);
      const fallT = clamp01((tp - P_HOLD_END) / (P_FALL_END - P_HOLD_END));
      const fall = easeInOutCubic(fallT);
      const flutter = Math.sin(Math.PI * fallT); // strongest mid-fall
      const d = this.paperDrift;
      const z = lerp(zShow + (1 - appear) * 0.08 * this.cam.distance, lie, Math.pow(fall, 1.25));
      const x = lerp(0, rest.x, fall) + Math.sin(tp * 1.9 + d.a) * 0.22 * flutter;
      const y = lerp(-0.02 * (1 - appear), rest.y, fall) + Math.cos(tp * 1.4 + d.b) * 0.12 * flutter;
      this.paper.position.set(x, y, z);
      this.paper.rotation.set(
        Math.sin(tp * 3.1 + d.a) * 0.55 * flutter + (1 - appear) * 0.4,
        Math.sin(tp * 2.3 + d.b) * 0.45 * flutter,
        lerp(0.02 * Math.sin(tp), rest.rot, fall) + d.dir * 0.9 * flutter,
      );
      u.uOpacity.value = appear;
      u.uBend.value = 0.35 * Math.sin(tp * 4.2) * flutter + 0.05 * (1 - fall);
      u.uWave.value = 0.5 * flutter;
      u.uBurn.value = 0;
      u.uScorch.value = 0;
      u.uRunes.value = 0;
      // lit by the viewer while close, then by the altar's lava glow as it lands
      const lit = lerp(0.93, 0.72, fall);
      u.uTint.value.setRGB(lit, lit * lerp(0.93, 0.78, fall), lit * lerp(0.84, 0.66, fall));
      this.placeShadow(x, y, z, appear);

      if (tp >= P_FALL_END && !this.landedFired) {
        this.landedFired = true;
        this.particles.burst(40, { r0: 0.28, speed: 0.5, up: 0.25, heat: 0.5, size: 0.01, life: 0.9 });
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

    // On the altar: heat builds, letters burn through, then it is pulled into the vortex.
    const pullT = clamp01((F - K.paperPullStart) / (K.paperGone - K.paperPullStart));
    const pullE = pullT * pullT * (3 - 2 * pullT);
    const visible = F < K.paperGone + 2;
    this.paper.visible = visible;
    this.shadow.visible = visible && pullT < 0.5;
    if (!visible) return;
    this.paperSpin += dt * (0.2 + pullE * 7) * Math.sign(this.params?.spin[5] ?? 1);
    const zoomNow = videoZoom(F);
    const s = lerp(1, 1 / zoomNow, smooth(K.zoomStart, K.zoomSettled, F)) * (1 - 0.8 * pullE);
    const jolt = this.envelope(this.fxFlare, 0.25) * this.fxFlare.s * 0.06;
    this.paper.scale.set(PAPER_W * s * (1 - jolt), (PAPER_W / this.paperAspect / 0.7) * s * (1 - jolt), 1);
    this.paper.position.set(rest.x * (1 - pullE), rest.y * (1 - pullE), lie + pullE * 0.15);
    this.paper.rotation.set(0, 0, rest.rot + this.paperSpin * pullE);
    u.uOpacity.value = 1;
    u.uBend.value = 0.08 * pullE * Math.sin(this.time * 5);
    u.uWave.value = 0.15 * pullE;
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

  private stamp(power: number) {
    this.fxFlare = { t: 0, s: power };
    this.fxRing = { t: 0, s: power, speed: 1.1 + power * 0.6 };
    this.fxShake = { t: 0, s: 0.6 + power };
    this.fxFlash = { t: 0, s: 0.06 + power * 0.22 };
    this.fxShock = { t: 0, s: 0.4 + power * 0.8 };
    this.fxFire = { t: 0, s: power, dur: power > 0.9 ? 1.6 : 0.7 };
    const n = Math.round((power > 0.9 ? 380 : 150) * (this.params?.particleDensity ?? 1));
    this.particles.burst(n, { r0: 0.05, speed: 1.4 + power * 1.4, up: 1.2, heat: 1.2, size: 0.013, life: 1.2 });
    this.particles.burst(Math.round(n * 0.6), { r0: 0.64, speed: 0.9, up: 0.8, heat: 0.9, size: 0.01, life: 1 });
  }

  private certBurst() {
    this.fxFlare = { t: 0, s: 0.8 };
    this.fxFire = { t: 0, s: 0.8, dur: 1.2 };
    this.fxSmoke = { t: 0, s: 1 };
    this.fxFlash = { t: 0, s: 0.18 };
    this.fxShock = { t: 0, s: 0.5 };
    this.particles.burst(220, { r0: 0.02, speed: 1.1, up: 1.6, heat: 1.1, size: 0.012, life: 1.4 });
  }

  /** Exponential-ish decay envelope: 1 at trigger -> 0 after `len` seconds. */
  private envelope(e: { t: number }, len: number) {
    if (e.t >= len * 4) return 0;
    const x = e.t / len;
    return Math.exp(-x * x * 1.2);
  }

  private updateEffects(dt: number, spread: number) {
    for (const e of [this.fxFlare, this.fxRing, this.fxFire, this.fxSmoke, this.fxShake, this.fxFlash, this.fxShock]) e.t += dt;
    const top = 4.6 * spread;

    // flare
    const fl = this.envelope(this.fxFlare, 0.35) * this.fxFlare.s;
    this.flare.visible = fl > 0.002;
    if (this.flare.visible) {
      this.flare.position.set(0, 0, top + 0.02);
      const s = 0.45 + this.fxFlare.s * 0.8;
      this.flare.scale.set(s * 2.4, s, 1);
      (this.flare.material as THREE.ShaderMaterial).uniforms.uIntensity.value = fl * 1.1;
    }

    // shock ring
    const r = this.fxRing;
    const ringLife = 1.1;
    this.ring.visible = r.t < ringLife;
    if (this.ring.visible) {
      const k = r.t / ringLife;
      const u = (this.ring.material as THREE.ShaderMaterial).uniforms;
      this.ring.position.set(0, 0, spread * 1.8);
      this.ring.scale.setScalar(3.2);
      u.uRadius.value = easeOutCubic(k) * 0.95 * r.speed * 0.8;
      u.uWidth.value = 0.012 + k * 0.03;
      u.uIntensity.value = r.s * (1 - k) * (1 - k) * 2.2;
    }

    // magical flame
    const f = this.fxFire;
    this.fire.visible = f.t < f.dur;
    if (this.fire.visible) {
      const k = f.t / f.dur;
      const u = (this.fire.material as THREE.ShaderMaterial).uniforms;
      this.fire.position.set(0, 0, spread * 0.5 + 0.01);
      this.fire.scale.setScalar(1.6 + f.s * 1.4);
      u.uTime.value = this.time;
      u.uRadius.value = 0.08 + k * 0.25;
      u.uIntensity.value = f.s * Math.sin(Math.PI * Math.min(1, k * 1.4 + 0.05)) * 1.1;
    }

    // vapour puff (certificate birth)
    const sm = this.fxSmoke;
    const smLife = 2.4;
    this.smoke.visible = sm.t < smLife;
    if (this.smoke.visible) {
      const k = sm.t / smLife;
      const u = (this.smoke.material as THREE.ShaderMaterial).uniforms;
      this.smoke.position.set(0, 0, spread * 3 + 0.05);
      this.smoke.scale.setScalar(0.4 + easeOutCubic(k) * 1.6);
      u.uTime.value = this.time;
      u.uSeed.value = 3.7;
      u.uOpacity.value = sm.s * Math.sin(Math.PI * Math.min(1, k * 1.2 + 0.02)) * 0.85;
    }
  }

  dispose() {
    this.disposed = true;
    this.stop();
    this.clearCurse();
    this.particles.dispose();
    this.post.dispose();
    this.atlas.dispose();
    this.stableTex.dispose();
    this.pribTex.dispose();
    this.renderer.dispose();
    this.holder.remove();
  }
}

/** Multiplier for a quick stamp: collapse over `down` frames, reopen over `up` frames. */
function stampFactor(F: number, at: number, down: number, up: number) {
  if (F < at - down) return 1;
  if (F < at) return 1 - smooth(at - down, at, F);
  if (F < at + 1) return 0;
  const k = clamp01((F - at - 1) / up);
  // ease-out-back: a little overshoot as the mechanism springs open again
  const c = 1.7;
  return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2);
}

function mulberry(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
