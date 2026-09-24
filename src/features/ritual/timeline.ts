// The ritual is keyed to frame numbers of pribliji.mp4 (24 fps, 271 frames).
//   0-175  "stable" part of the video (the note lies on the altar, heat builds up)
//   175    the tunnel opens: rings, letters and signs fly up from the depth of the vortex
//   175-245 the camera dives into the altar; the pieces arrive one by one and assemble the
//           magic circle, others overshoot and fly past the camera; the note sinks and burns
//   245    the circle is complete: impact, flying inscriptions
//   245-270 the video recedes and vanishes; the circle stays and opens up in depth
//   262    the certificate rises from the depth and comes to rest in front of the viewer
//   302-356 the seal is engraved (sparks falling, the sheet trembles), then it settles
// After the video ends (frame 270) the frame counter keeps running on the clock, so the
// ritual can be described by one continuous number F.

export const FPS = 24;
export const VIDEO_LAST_FRAME = 270;

export const F = {
  circlesOn: 175,
  zoomStart: 180,
  zoomSettled: 207,
  paperPullStart: 186,
  paperBurnStart: 198,
  paperGone: 240,
  passersFrom: 172,
  passersTo: 236,
  assembled: 245,
  lettersOn: 245,
  videoFadeStart: 256,
  tailAudio: 258,
  pullBackStart: 247,
  pullBackEnd: 300,
  certBirth: 262,
  certArrive: 298,
  engraveStart: 304,
  engraveEnd: 356,
  certRest: 374,
  certSettled: 300,
  uiOn: 362,
} as const;

/** Stable-video frames that visually match pribliji frames 1:1 (safe for a hard cut). */
export const HARD_CUT_MAX_FRAME = 40;

/** Measured zoom of pribliji.mp4 (scale of the altar relative to frame 0). */
const ZOOM_KEYS: [number, number][] = [
  [0, 1], [180, 1], [183, 1.08], [186, 1.34], [189, 1.72], [192, 2.2], [195, 2.55], [198, 2.85],
  [201, 3.22], [204, 3.55], [207, 3.8], [212, 3.95], [245, 4.3], [260, 4.45], [270, 4.5],
];

/** Altar centre in normalised video coordinates (x right, y down), before and after the dive. */
export const ALTAR_CENTER_WIDE: [number, number] = [0.5, 0.47];
export const ALTAR_CENTER_ZOOMED: [number, number] = [0.505, 0.5];
/** Radius of the magic circle construct as a fraction of the video height at zoom 1. */
export const CONSTRUCT_RADIUS = 0.355;

export function clamp01(x: number) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
export function smooth(e0: number, e1: number, x: number) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
export function easeOutCubic(t: number) {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
}
export function easeInOutCubic(t: number) {
  t = clamp01(t);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
export function easeOutExpo(t: number) {
  t = clamp01(t);
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

/** Monotone piecewise-cubic (smoothstep between keys) — no overshoot. */
export function keyed(keys: [number, number][], x: number) {
  if (x <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [x1, y1] = keys[i];
    if (x <= x1) {
      const [x0, y0] = keys[i - 1];
      const t = (x - x0) / (x1 - x0);
      // Catmull-Rom-ish tangent from neighbours, clamped to keep it monotone.
      const yPrev = i >= 2 ? keys[i - 2][1] : y0;
      const yNext = i + 1 < keys.length ? keys[i + 1][1] : y1;
      const m0 = Math.min(Math.abs((y1 - yPrev) / 2), Math.abs(y1 - y0) * 3) * Math.sign(y1 - y0);
      const m1 = Math.min(Math.abs((yNext - y0) / 2), Math.abs(y1 - y0) * 3) * Math.sign(y1 - y0);
      const t2 = t * t;
      const t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * m1;
    }
  }
  return keys[keys.length - 1][1];
}

export function videoZoom(frame: number) {
  return keyed(ZOOM_KEYS, frame);
}

/** 0 before the dive, 1 once the camera has settled in the vortex. */
export function diveProgress(frame: number) {
  return clamp01((videoZoom(frame) - 1) / (3.8 - 1));
}
