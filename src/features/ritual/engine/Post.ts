import * as THREE from 'three';
import { BRIGHT_FRAG, COMPOSITE_FRAG, DOWN_FRAG, SCREEN_VERT, UP_FRAG } from './shaders';

/**
 * FX render target -> dual-filter bloom -> final composite with the altar video.
 * The video is sampled here directly (cover-fit), so everything is one image and the
 * shockwave / heat haze can distort the video itself.
 */
export class Post {
  readonly fx: THREE.WebGLRenderTarget;
  private levels: THREE.WebGLRenderTarget[] = [];
  private ups: THREE.WebGLRenderTarget[] = [];
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private bright: THREE.ShaderMaterial;
  private down: THREE.ShaderMaterial;
  private up: THREE.ShaderMaterial;
  readonly composite: THREE.ShaderMaterial;
  private type: THREE.TextureDataType;

  constructor(private renderer: THREE.WebGLRenderer, stable: THREE.Texture, pribliji: THREE.Texture) {
    const gl = renderer.getContext();
    const canHalf =
      renderer.capabilities.isWebGL2 &&
      (!!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float'));
    this.type = canHalf ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.fx = this.makeRT(1, 1);
    for (let i = 0; i < 6; i++) {
      this.levels.push(this.makeRT(1, 1));
      this.ups.push(this.makeRT(1, 1));
    }
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    const common = { vertexShader: SCREEN_VERT, depthTest: false, depthWrite: false };
    this.bright = new THREE.ShaderMaterial({
      ...common,
      fragmentShader: BRIGHT_FRAG,
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0.35 } },
    });
    this.down = new THREE.ShaderMaterial({
      ...common,
      fragmentShader: DOWN_FRAG,
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
    });
    this.up = new THREE.ShaderMaterial({
      ...common,
      fragmentShader: UP_FRAG,
      uniforms: {
        tSrc: { value: null },
        tBase: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uRadius: { value: 1.0 },
      },
    });
    this.composite = new THREE.ShaderMaterial({
      ...common,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        tStable: { value: stable },
        tPribliji: { value: pribliji },
        tFx: { value: this.fx.texture },
        tBloom: { value: null },
        uMix: { value: 0 },
        uVideoFade: { value: 1 },
        uBloom: { value: 1 },
        uFlash: { value: 0 },
        uTime: { value: 0 },
        uAspect: { value: 1 },
        uCoverScale: { value: new THREE.Vector2(1, 1) },
        uCoverOffset: { value: new THREE.Vector2(0, 0) },
        uShake: { value: new THREE.Vector2(0, 0) },
        uParallax: { value: new THREE.Vector2(0, 0) },
        uShock: { value: new THREE.Vector4(0.5, 0.5, 0, 0) },
        uHeatHaze: { value: 0 },
        uHazeCenter: { value: new THREE.Vector2(0.5, 0.5) },
      },
    });
  }

  private makeRT(w: number, h: number) {
    return new THREE.WebGLRenderTarget(w, h, {
      type: this.type,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }

  setSize(w: number, h: number) {
    // w/h are drawing-buffer pixels
    this.fx.setSize(w, h);
    let lw = Math.max(1, Math.round(w / 2));
    let lh = Math.max(1, Math.round(h / 2));
    for (let i = 0; i < this.levels.length; i++) {
      this.levels[i].setSize(lw, lh);
      this.ups[i].setSize(lw, lh);
      lw = Math.max(1, Math.round(lw / 2));
      lh = Math.max(1, Math.round(lh / 2));
    }
    this.composite.uniforms.uAspect.value = w / h;
  }

  private pass(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  /** Renders the FX scene into the FX target (transparent black background). */
  renderFx(scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer.setRenderTarget(this.fx);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear(true, false, false);
    this.renderer.render(scene, camera);
  }

  bloom(threshold: number) {
    const L = this.levels;
    this.bright.uniforms.tSrc.value = this.fx.texture;
    this.bright.uniforms.uTexel.value.set(1 / this.fx.width, 1 / this.fx.height);
    this.bright.uniforms.uThreshold.value = threshold;
    this.pass(this.bright, L[0]);
    for (let i = 1; i < L.length; i++) {
      this.down.uniforms.tSrc.value = L[i - 1].texture;
      this.down.uniforms.uTexel.value.set(1 / L[i - 1].width, 1 / L[i - 1].height);
      this.pass(this.down, L[i]);
    }
    // Upsample from the smallest level, accumulating each level on the way up.
    let src = L[L.length - 1];
    for (let i = L.length - 2; i >= 0; i--) {
      this.up.uniforms.tSrc.value = src.texture;
      this.up.uniforms.tBase.value = L[i].texture;
      this.up.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      this.pass(this.up, this.ups[i]);
      src = this.ups[i];
    }
    this.composite.uniforms.tBloom.value = src.texture;
  }

  present() {
    this.pass(this.composite, null);
  }

  dispose() {
    this.fx.dispose();
    [...this.levels, ...this.ups].forEach((r) => r.dispose());
    this.bright.dispose();
    this.down.dispose();
    this.up.dispose();
    this.composite.dispose();
    this.quad.geometry.dispose();
  }
}
