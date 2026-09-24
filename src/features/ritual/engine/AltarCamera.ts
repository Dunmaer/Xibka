import * as THREE from 'three';

/**
 * A camera that always looks straight down at the altar (no tilt), but whose frustum is
 * shifted ("lens shift") so the altar plane z=0 stays glued to the altar in the video,
 * wherever the altar is on screen and however far the video has zoomed.
 *
 * - `ppu`      pixels per world unit on the altar plane (follows the video's zoom)
 * - `distance` camera height above the altar in world units. Smaller = stronger perspective:
 *              layers lifted towards the camera grow and slide apart faster.
 * - `offset`   lateral camera drift (world units). Because z=0 stays locked, only the lifted
 *              layers move -> parallax that reveals the depth of the mechanism.
 */
export class AltarCamera {
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.01, 200);
  width = 1;
  height = 1;
  centerX = 0.5; // px
  centerY = 0.5; // px (top-down)
  ppu = 100;
  distance = 3;
  offsetX = 0;
  offsetY = 0;
  /**
   * Height of the plane that stays glued to the screen (0 = the altar in the video;
   * at the end the certificate's plane, so the sheet stays put while the circle below
   * and the inscriptions above slide with the mouse).
   */
  lockZ = 0;

  setViewport(w: number, h: number) {
    this.width = w;
    this.height = h;
  }

  update() {
    const { camera: cam, width: W, height: H } = this;
    const D = this.distance;
    cam.position.set(this.offsetX, this.offsetY, this.lockZ + D);
    cam.rotation.set(0, 0, 0);
    cam.updateMatrixWorld(true);

    const n = Math.max(0.01, D * 0.01);
    const f = D + this.lockZ + 150;
    const rl = (n * W) / (D * this.ppu); // r - l
    const tb = (n * H) / (D * this.ppu); // t - b
    const cxNdc = (2 * (this.centerX + this.offsetX * this.ppu)) / W - 1;
    const cyNdc = 1 - (2 * (this.centerY - this.offsetY * this.ppu)) / H;
    // three.js: x_ndc = 2n/(r-l) * x/(-z) - (r+l)/(r-l)  (note the minus on the shift term)
    const rpl = -rl * cxNdc; // r + l
    const tpb = -tb * cyNdc; // t + b
    const l = (rpl - rl) / 2;
    const r = (rpl + rl) / 2;
    const b = (tpb - tb) / 2;
    const t = (tpb + tb) / 2;
    cam.near = n;
    cam.far = f;
    cam.projectionMatrix.makePerspective(l, r, t, b, n, f);
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  }

  /** Scale factor of something at height z relative to the locked plane. */
  liftScale(z: number) {
    return this.distance / Math.max(this.distance - (z - this.lockZ), 1e-3);
  }

  /** Height at which an object appears `s` times larger than on the locked plane. */
  heightForScale(s: number) {
    return this.lockZ + this.distance * (1 - 1 / s);
  }

  /** World height of the camera. */
  get z() {
    return this.lockZ + this.distance;
  }

  /** Converts world units to device-independent pixels at the altar plane. */
  get pointScale() {
    // gl_PointSize = size * scale / depth  ->  scale = projection[0] * viewportWidth / 2
    return (this.camera.projectionMatrix.elements[0] * this.width) / 2;
  }
}
