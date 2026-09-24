// Owns the two altar videos and reports which frame of pribliji.mp4 is on screen.
//
// stable.mp4   loops while the visitor fills the form and while the note falls.
// pribliji.mp4 plays once when the ritual starts. Its frame number drives the whole ritual.
//
// Both files are downloaded fully up front (blob URLs) so the switch never stalls.
import { FPS, HARD_CUT_MAX_FRAME, VIDEO_LAST_FRAME } from './timeline';

const BASE = import.meta.env.BASE_URL;

/** H.264 where available (everywhere that matters), VP9 WebM otherwise. */
function pickFormat(): { ext: 'mp4' | 'webm'; type: string } {
  const probe = document.createElement('video');
  if (probe.canPlayType('video/mp4; codecs="avc1.640028, mp4a.40.2"')) return { ext: 'mp4', type: 'video/mp4' };
  if (probe.canPlayType('video/webm; codecs="vp9, opus"')) return { ext: 'webm', type: 'video/webm' };
  return { ext: 'mp4', type: 'video/mp4' };
}
const FORMAT = pickFormat();
export const STABLE_URL = `${BASE}media/stable.${FORMAT.ext}`;
export const PRIBLIJI_URL = `${BASE}media/pribliji.${FORMAT.ext}`;

type VideoWithRVFC = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
  cancelVideoFrameCallback?: (h: number) => void;
};

function makeVideo(loop: boolean): VideoWithRVFC {
  const v = document.createElement('video') as VideoWithRVFC;
  v.playsInline = true;
  v.muted = true;
  v.loop = loop;
  v.preload = 'auto';
  v.crossOrigin = 'anonymous';
  v.setAttribute('playsinline', '');
  v.setAttribute('webkit-playsinline', '');
  return v;
}

async function fetchWithProgress(url: string, onProgress: (loaded: number, total: number) => void): Promise<string> {
  try {
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(String(res.status));
    const total = Number(res.headers.get('content-length')) || 0;
    const reader = res.body.getReader();
    const chunks: BlobPart[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value as BlobPart);
      loaded += value.byteLength;
      onProgress(loaded, total || loaded * 1.2);
    }
    onProgress(1, 1);
    return URL.createObjectURL(new Blob(chunks, { type: FORMAT.type }));
  } catch {
    // Streaming fallback: let the element fetch it itself.
    onProgress(1, 1);
    return url;
  }
}

export class VideoDeck {
  readonly stable = makeVideo(true);
  readonly pribliji = makeVideo(false);
  /** 0 = stable visible, 1 = pribliji visible. */
  mix = 0;
  private mixTarget = 0;
  private mixSpeed = 1.4; // per second
  private lastFrame = 0;
  private lastFrameAt = 0;
  private rvfcHandle = 0;
  private started = false;
  private endedAt = 0;
  private soundOn = false;
  onFrame: ((frame: number) => void) | null = null;

  /**
   * stable.mp4 streams straight away (it only loops in the background);
   * pribliji.mp4 is downloaded completely first so the ritual never stalls.
   */
  async load(onProgress: (p: number) => void): Promise<void> {
    this.stable.src = STABLE_URL;
    const stableReady = whenReady(this.stable);
    const p = await fetchWithProgress(PRIBLIJI_URL, (l, t) => onProgress(Math.min(1, l / t)));
    this.pribliji.src = p;
    await Promise.all([stableReady, whenReady(this.pribliji)]);
  }

  /** Resolves true once the background loop can play (false if it failed to load). */
  whenStableReady(): Promise<boolean> {
    return whenReady(this.stable).then(() => this.stable.readyState >= 2 && !this.stable.error);
  }

  /**
   * Must be called inside a click/tap handler: lets pribliji.mp4 start with sound later on
   * (Safari only allows unmuted playback of elements that were started from a gesture).
   */
  unlock() {
    const v = this.pribliji;
    if (this.started || !v.src) return;
    v.muted = !this.soundOn;
    const p = v.play();
    if (p) {
      p.then(() => {
        if (!this.started) {
          v.pause();
          v.currentTime = 0;
        }
      }).catch(() => {});
    }
  }

  /** Starts the looping background. Safe to call before any user gesture (muted). */
  playStable() {
    this.mix = this.mixTarget = 0;
    this.started = false;
    this.endedAt = 0;
    this.pribliji.pause();
    this.pribliji.currentTime = 0;
    this.stable.muted = !this.soundOn;
    void this.stable.play().catch(() => {
      this.stable.muted = true;
      void this.stable.play().catch(() => {});
    });
  }

  setSound(on: boolean) {
    this.soundOn = on;
    this.stable.muted = !on;
    this.pribliji.muted = !on;
    if (on) {
      // Called from a click, so unmuted playback is allowed now.
      if (!this.stable.paused) void this.stable.play().catch(() => {});
      if (this.started && !this.pribliji.paused) void this.pribliji.play().catch(() => {});
    }
  }

  /** Switches to pribliji.mp4 as seamlessly as the two renders allow. */
  startRitual() {
    const stableFrame = Math.round(this.stable.currentTime * FPS);
    const v = this.pribliji;
    this.started = true;
    this.endedAt = 0;
    v.muted = !this.soundOn;
    if (stableFrame <= HARD_CUT_MAX_FRAME) {
      // The first seconds of both renders are identical: cut on the same frame.
      v.currentTime = stableFrame / FPS;
      this.mix = this.mixTarget = 1;
    } else {
      v.currentTime = 0;
      this.mixTarget = 1;
      this.mixSpeed = 1.6;
    }
    this.lastFrame = Math.round(v.currentTime * FPS);
    this.lastFrameAt = performance.now();
    void v.play().catch(() => {
      v.muted = true;
      void v.play().catch(() => {});
    });
    this.watchFrames();
  }

  /** Jump straight to a frame and keep playing from there (skip button). */
  seekRitual(frame: number, freeze = false) {
    this.started = true;
    this.mix = this.mixTarget = 1;
    this.stable.pause();
    const v = this.pribliji;
    const f = Math.min(frame, VIDEO_LAST_FRAME);
    v.currentTime = f / FPS;
    this.lastFrame = f;
    this.lastFrameAt = performance.now();
    this.endedAt = 0;
    if (frame >= VIDEO_LAST_FRAME) {
      v.pause();
      this.endedAt = performance.now() - ((frame - VIDEO_LAST_FRAME) / FPS) * 1000;
    } else if (freeze) {
      v.pause();
    } else {
      v.muted = !this.soundOn;
      void v.play().catch(() => {
        v.muted = true;
        void v.play().catch(() => {});
      });
    }
    this.watchFrames();
  }

  pauseAll() {
    this.stable.pause();
    this.pribliji.pause();
  }

  private watchFrames() {
    const v = this.pribliji;
    if (v.requestVideoFrameCallback) {
      if (this.rvfcHandle && v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(this.rvfcHandle);
      const cb = (_now: number, meta: { mediaTime: number }) => {
        this.lastFrame = Math.round(meta.mediaTime * FPS);
        this.lastFrameAt = performance.now();
        if (this.started) this.rvfcHandle = v.requestVideoFrameCallback!(cb);
      };
      this.rvfcHandle = v.requestVideoFrameCallback(cb);
    }
  }

  /** Continuous ritual frame F (fractional), or -1 before the ritual started. */
  ritualFrame(now = performance.now()): number {
    if (!this.started) return -1;
    const v = this.pribliji;
    if (this.endedAt) return VIDEO_LAST_FRAME + ((now - this.endedAt) / 1000) * FPS;
    if (v.ended || (v.duration && v.currentTime >= v.duration - 0.01)) {
      this.endedAt = now;
      return VIDEO_LAST_FRAME;
    }
    if (!v.requestVideoFrameCallback) {
      return v.currentTime * FPS;
    }
    if (v.paused) return this.lastFrame;
    // No frame callback for a while (element throttled?) -> trust currentTime.
    if (now - this.lastFrameAt > 250) return v.currentTime * FPS;
    // Interpolate between presented frames for smooth motion.
    return Math.min(this.lastFrame + ((now - this.lastFrameAt) / 1000) * FPS, this.lastFrame + 1.5);
  }

  /** Current frame of the stable loop (for idle animation phases). */
  stableTime() {
    return this.stable.currentTime;
  }

  tick(dt: number) {
    if (this.mix !== this.mixTarget) {
      const d = this.mixSpeed * dt;
      this.mix = this.mix < this.mixTarget ? Math.min(this.mixTarget, this.mix + d) : Math.max(this.mixTarget, this.mix - d);
      if (this.mix >= 1 && !this.stable.paused) this.stable.pause();
    }
  }

  get isRitualRunning() {
    return this.started;
  }

  stopRitual() {
    this.started = false;
    if (this.rvfcHandle && this.pribliji.cancelVideoFrameCallback) this.pribliji.cancelVideoFrameCallback(this.rvfcHandle);
    this.rvfcHandle = 0;
  }
}

function whenReady(v: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    if (v.readyState >= 3) return resolve();
    const done = () => {
      v.removeEventListener('canplaythrough', done);
      v.removeEventListener('loadeddata', done);
      v.removeEventListener('error', done);
      resolve();
    };
    v.addEventListener('canplaythrough', done);
    v.addEventListener('loadeddata', done);
    v.addEventListener('error', done);
  });
}
