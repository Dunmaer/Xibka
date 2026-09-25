// Tilting the phone moves the camera (as the mouse does on a computer). Only the change of the
// tilt counts: the resting angle is followed slowly, so it works however the phone is held.

const RANGE = 14; // degrees of tilt for a full swing
const FOLLOW = 3.5; // s: how fast the resting angle catches up

class TiltInput {
  /** Current tilt, -1..1 on both axes (x right, y down). */
  readonly value = { x: 0, y: 0 };
  /** True once orientation events arrive. */
  active = false;
  private base: { a: number; b: number } | null = null;
  private last = 0;
  private listening = false;

  private onOrient = (e: DeviceOrientationEvent) => {
    if (e.beta == null || e.gamma == null) return;
    // screen rotation: map the device axes onto the screen axes
    const angle = (screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) as number;
    let a = e.gamma; // left/right
    let b = e.beta; // towards/away
    if (angle === 90) [a, b] = [e.beta, -e.gamma];
    else if (angle === -90 || angle === 270) [a, b] = [-e.beta, e.gamma];
    else if (angle === 180) [a, b] = [-e.gamma, -e.beta];
    const now = performance.now();
    const dt = this.last ? Math.min(0.5, (now - this.last) / 1000) : 0;
    this.last = now;
    if (!this.base) this.base = { a, b };
    const k = 1 - Math.exp(-dt / FOLLOW);
    this.base.a += (a - this.base.a) * k;
    this.base.b += (b - this.base.b) * k;
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    this.value.x = clamp((a - this.base.a) / RANGE);
    this.value.y = clamp((b - this.base.b) / RANGE);
    this.active = true;
  };

  /** Starts listening (enough on Android; iOS also needs request() from a tap). */
  start() {
    if (this.listening || typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return;
    this.listening = true;
    window.addEventListener('deviceorientation', this.onOrient);
  }

  /** Call inside a tap handler: iOS asks the visitor for motion access (once). */
  request() {
    const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
    if (DOE?.requestPermission && !this.active) {
      DOE.requestPermission()
        .then((r) => r === 'granted' && this.start())
        .catch(() => {});
    } else this.start();
  }
}

export const tilt = new TiltInput();

/** Phones and tablets: no mouse to hover with. */
export const isTouch = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
