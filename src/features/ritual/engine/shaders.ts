// GLSL for the ritual. Everything is authored in display (sRGB-ish) space; values above 1
// are allowed in the FX buffer (half float) and feed the bloom.

export const NOISE = /* glsl */ `
float hash21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash21(i), hash21(i+vec2(1,0)), u.x), mix(hash21(i+vec2(0,1)), hash21(i+vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++){ s += a*vnoise(p); p = p*2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return s;
}
`;

export const BASIC_VERT = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const SCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** One layer of the magic circle. Core + glow are single-channel textures. */
export const CIRCLE_FRAG = /* glsl */ `
uniform sampler2D uCore;
uniform sampler2D uGlow;
uniform float uReveal;
uniform float uIntensity;
uniform float uGlowAmt;
uniform float uHeat;
uniform float uTime;
uniform float uPhase;
uniform float uFade;
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uHot;
uniform vec3 uGlowCol;
varying vec2 vUv;
${NOISE}
void main(){
  vec2 p = vUv*2.0 - 1.0;
  float ang = fract(atan(p.x, p.y)/6.2831853 + 1.0 + uPhase);
  float c = texture2D(uCore, vUv).r;
  float g = texture2D(uGlow, vUv).r;
  float rv = uReveal * 1.08;
  float vis = 1.0 - smoothstep(rv - 0.04, rv, ang);
  float running = step(0.0005, uReveal) * (1.0 - step(0.999, uReveal));
  float lead = exp(-pow((rv - 0.02 - ang) * 18.0, 2.0)) * running;
  float fl = 0.8 + 0.2 * vnoise(vec2(ang*90.0 + uTime*1.3, uTime*3.1 + length(p)*20.0));
  float heat = c * uHeat * (0.85 + 0.3*fl);
  vec3 lineCol = mix(uDeep, uMid, smoothstep(0.0, 0.55, heat));
  lineCol = mix(lineCol, uHot, smoothstep(0.95, 1.7, heat));
  vec3 col = lineCol * c * 0.95 + uGlowCol * g * uGlowAmt * 0.32 * (0.8 + 0.4*fl);
  col *= vis * uIntensity * uFade;
  col += uHot * lead * (c * 2.2 + g * 0.8) * uIntensity * uFade;
  gl_FragColor = vec4(col, 0.0);
}
`;

/** The handwritten note: bends, gets scorched, burns from the edges inward. */
export const PAPER_VERT = /* glsl */ `
uniform float uBend;
uniform float uWave;
uniform float uTime;
varying vec2 vUv;
varying float vShade;
void main(){
  vUv = uv;
  vec3 p = position;
  float bx = p.x / 0.5;
  float by = p.y / 0.35;
  float lift = uBend * (bx*bx - 0.35) + uWave * sin(by*2.4 + uTime*3.0) * 0.5 * (0.6 + 0.4*bx);
  p.z += lift * 0.12;
  vShade = clamp(1.0 + lift * 0.9, 0.55, 1.25);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

export const PAPER_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uOpacity;
uniform float uBurn;
uniform float uScorch;
uniform float uTime;
uniform vec3 uTint;
uniform float uRunes;
uniform sampler2D uRuneMap;
uniform vec3 uRuneCol;
varying vec2 vUv;
varying float vShade;
${NOISE}
void main(){
  vec4 tex = texture2D(uMap, vUv);
  if (tex.a < 0.01) discard;
  vec2 q = vUv - 0.5;
  float edge = max(abs(q.x)*2.0, abs(q.y)*2.0);
  float n = fbm(vUv*vec2(5.0, 3.6) + 3.0);
  // Burn field: high at the edges and in noisy patches, so the fire eats inward.
  float b = mix(n, edge, 0.55) + 0.12*fbm(vUv*18.0);
  float burning = step(0.0001, uBurn);
  float T = 1.2 - uBurn * 1.45;
  float gone = smoothstep(T - 0.012, T + 0.012, b) * burning;
  float alive = 1.0 - gone;
  float charred = smoothstep(T - 0.14, T, b) * burning;
  float emberBand = exp(-pow((b - T) / 0.022, 2.0)) * burning;
  vec3 col = tex.rgb * uTint * vShade;
  // soft light falloff towards the edges + warm bounce light from the lava below
  col *= 1.0 - 0.28 * smoothstep(0.45, 1.05, edge);
  col *= mix(vec3(1.0), vec3(1.06, 0.9, 0.78), smoothstep(0.1, -0.5, q.y));
  // scorch: browning from the edges, like paper on a hot stone
  float scorch = clamp(uScorch * (edge*1.2 + n*0.6) - 0.35, 0.0, 1.0);
  col = mix(col, col*vec3(0.55, 0.35, 0.2), scorch);
  col = mix(col, vec3(0.05, 0.02, 0.01), charred * 0.92);
  // infernal letters burning through the paper
  float rune = texture2D(uRuneMap, vUv).r * uRunes;
  col = mix(col, col*0.45, rune*0.5);
  vec3 emit = uRuneCol * rune * (0.55 + 0.25*vnoise(vec2(uTime*4.0, vUv.x*30.0)));
  emit += vec3(1.6, 0.55, 0.12) * emberBand * (1.5 + fbm(vUv*30.0 + uTime*2.0));
  float a = tex.a * uOpacity * alive;
  gl_FragColor = vec4(col * a + emit * uOpacity * (alive + emberBand), a);
}
`;

/** Soft contact shadow under the falling note. */
export const SHADOW_FRAG = /* glsl */ `
uniform float uOpacity;
uniform float uSoft;
varying vec2 vUv;
void main(){
  vec2 q = (vUv - 0.5) * 2.0;
  float d = length(max(abs(q) - vec2(0.62, 0.55) * (1.0 - uSoft*0.5), 0.0));
  float a = (1.0 - smoothstep(0.0, 0.25 + uSoft*0.6, d)) * uOpacity;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}
`;

/** Point sprites for embers and sparks. */
export const POINTS_VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uPointScale;
uniform float uCamDist;
uniform float uMaxSize;
varying float vAlpha;
varying vec3 vColor;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float depth = max(-mv.z, 0.02);
  gl_PointSize = clamp(aSize * uPointScale / depth, 0.0, uMaxSize);
  // particles rising too close to the lens fade away instead of becoming big blobs
  float near = smoothstep(0.18, 0.5, depth / uCamDist);
  vAlpha = aAlpha * near;
  vColor = aColor;
}
`;

export const POINTS_FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main(){
  vec2 q = gl_PointCoord - 0.5;
  float d = length(q) * 2.0;
  float core = exp(-d*d*9.0);
  float halo = exp(-d*d*2.5) * 0.35;
  float a = (core + halo) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * a, 0.0);
}
`;

/** Flying infernal letters, instanced along wavy orbits. */
export const GLYPH_VERT = /* glsl */ `
attribute float aGlyph;
attribute vec4 aOrbit;   // radius, zBase, angularSpeed, phase
attribute vec4 aWave;    // radialAmp, radialFreq, zAmp, size
attribute float aAlpha;
uniform float uTime;
uniform float uSpread;
uniform float uSwirl;
varying vec2 vUv;
varying float vAlpha;
varying float vGlyph;
void main(){
  float th = aOrbit.w + uTime * aOrbit.z * uSwirl;
  float r = aOrbit.x + aWave.x * sin(th * aWave.y + uTime * 0.7 + aOrbit.w * 3.0);
  float z = aOrbit.y * uSpread + aWave.z * sin(th * 2.0 + uTime * 0.9 + aOrbit.w);
  vec3 center = vec3(cos(th) * r, sin(th) * r, z);
  // local frame: x along the path, y pointing outward (letters stand on the orbit)
  float dir = sign(aOrbit.z);
  vec2 tangent = vec2(-sin(th), cos(th)) * dir;
  vec2 outward = vec2(cos(th), sin(th));
  float s = aWave.w;
  vec3 pos = center + vec3(tangent * position.x * s + outward * position.y * s, 0.0);
  vUv = uv;
  vGlyph = aGlyph;
  float flick = 0.75 + 0.25 * sin(uTime * 3.0 + aOrbit.w * 17.0);
  vAlpha = aAlpha * flick;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

export const GLYPH_FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uOpacity;
uniform vec3 uColor;
varying vec2 vUv;
varying float vAlpha;
varying float vGlyph;
void main(){
  float gi = floor(vGlyph + 0.5);
  vec2 cell = vec2(mod(gi, 8.0), 3.0 - floor(gi / 8.0));
  vec2 uv = (cell + vUv) / vec2(8.0, 4.0);
  float g = texture2D(uAtlas, uv).r;
  float a = g * vAlpha * uOpacity;
  gl_FragColor = vec4(uColor * a, 0.0);
}
`;

/** Radial flare with an anamorphic streak. */
export const FLARE_FRAG = /* glsl */ `
uniform float uIntensity;
uniform vec3 uColor;
uniform float uStreak;
varying vec2 vUv;
void main(){
  vec2 q = (vUv - 0.5) * 2.0;
  float r = length(q);
  float core = exp(-r*r*28.0) * 2.5;
  float halo = exp(-r*r*4.0) * 0.6;
  float streak = exp(-abs(q.y)*60.0) * exp(-abs(q.x)*1.8) * uStreak;
  vec3 col = uColor * (halo + streak) + vec3(1.0, 0.92, 0.8) * core;
  gl_FragColor = vec4(col * uIntensity, 0.0);
}
`;

/** Expanding shock ring. */
export const RING_FRAG = /* glsl */ `
uniform float uRadius;
uniform float uWidth;
uniform float uIntensity;
uniform vec3 uColor;
varying vec2 vUv;
void main(){
  float r = length((vUv - 0.5) * 2.0);
  float ring = exp(-pow((r - uRadius) / uWidth, 2.0));
  float inner = exp(-pow((r - uRadius*0.92) / (uWidth*2.5), 2.0)) * 0.35;
  gl_FragColor = vec4(uColor * (ring + inner) * uIntensity, 0.0);
}
`;

/** Ring of magical fire licking outward from the centre. */
export const FIRE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform float uRadius;
uniform vec3 uColA;
uniform vec3 uColB;
varying vec2 vUv;
${NOISE}
void main(){
  vec2 q = (vUv - 0.5) * 2.0;
  float r = length(q);
  float a = atan(q.y, q.x);
  vec2 pc = vec2(a * 3.0, r * 4.0 - uTime * 2.2);
  float n = fbm(pc) * 0.7 + fbm(pc * 2.3 + 7.0) * 0.4;
  float base = smoothstep(uRadius - 0.05, uRadius + 0.02, r);
  float reach = 1.0 - smoothstep(uRadius, uRadius + 0.55 * n, r);
  float f = base * reach;
  f = pow(f, 1.4) * (0.6 + n);
  vec3 col = mix(uColA, uColB, smoothstep(0.2, 1.0, f));
  gl_FragColor = vec4(col * f * uIntensity, 0.0);
}
`;

/** Warm vapour / smoke puff. */
export const SMOKE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform float uSeed;
uniform vec3 uColor;
varying vec2 vUv;
${NOISE}
void main(){
  vec2 q = (vUv - 0.5) * 2.0;
  float r = length(q);
  float n = fbm(q * 2.2 + vec2(uSeed, uTime * 0.15));
  float m = smoothstep(1.0, 0.2, r + (n - 0.5) * 0.7);
  float a = m * n * uOpacity;
  gl_FragColor = vec4(uColor * a, a * 0.55);
}
`;

// ---------- post ----------

export const BRIGHT_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(tSrc, vUv + uTexel*vec2(-0.5,-0.5)).rgb
         + texture2D(tSrc, vUv + uTexel*vec2( 0.5,-0.5)).rgb
         + texture2D(tSrc, vUv + uTexel*vec2(-0.5, 0.5)).rgb
         + texture2D(tSrc, vUv + uTexel*vec2( 0.5, 0.5)).rgb;
  c *= 0.25;
  float l = max(c.r, max(c.g, c.b));
  float k = smoothstep(uThreshold, uThreshold + 0.6, l);
  gl_FragColor = vec4(c * k, 1.0);
}
`;

export const DOWN_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
  c += texture2D(tSrc, vUv + uTexel*vec2(-1.0,-1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel*vec2( 1.0,-1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel*vec2(-1.0, 1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel*vec2( 1.0, 1.0)).rgb;
  gl_FragColor = vec4(c / 8.0, 1.0);
}
`;

export const UP_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform sampler2D tBase;
uniform vec2 uTexel;
uniform float uRadius;
varying vec2 vUv;
void main(){
  vec2 o = uTexel * uRadius;
  vec3 c = texture2D(tSrc, vUv + vec2(-o.x*2.0, 0.0)).rgb;
  c += texture2D(tSrc, vUv + vec2(-o.x, o.y)).rgb * 2.0;
  c += texture2D(tSrc, vUv + vec2(0.0, o.y*2.0)).rgb;
  c += texture2D(tSrc, vUv + vec2(o.x, o.y)).rgb * 2.0;
  c += texture2D(tSrc, vUv + vec2(o.x*2.0, 0.0)).rgb;
  c += texture2D(tSrc, vUv + vec2(o.x, -o.y)).rgb * 2.0;
  c += texture2D(tSrc, vUv + vec2(0.0, -o.y*2.0)).rgb;
  c += texture2D(tSrc, vUv + vec2(-o.x, -o.y)).rgb * 2.0;
  gl_FragColor = vec4((c / 12.0 + texture2D(tBase, vUv).rgb) * 0.6, 1.0);
}
`;

export const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tStable;
uniform sampler2D tPribliji;
uniform sampler2D tFx;
uniform sampler2D tBloom;
uniform float uMix;
uniform float uVideoFade;
uniform float uBloom;
uniform float uFlash;
uniform float uTime;
uniform float uAspect;
uniform vec2 uCoverScale;
uniform vec2 uCoverOffset;
uniform vec2 uShake;
uniform vec4 uShock;      // centre.xy (uv), radius (in screen heights), strength
uniform float uHeatHaze;
uniform vec2 uHazeCenter;
varying vec2 vUv;
${NOISE}
vec3 shoulder(vec3 x){
  vec3 k = 0.82 + 0.18 * (1.0 - exp(-(x - 0.82) / 0.18));
  return mix(x, k, step(0.82, x));
}
void main(){
  vec2 uv = vUv;
  vec2 d = (uv - uShock.xy) * vec2(uAspect, 1.0);
  float r = length(d);
  float ring = exp(-pow((r - uShock.z) * 14.0, 2.0)) * uShock.w;
  vec2 dir = d / max(r, 1e-4);
  uv -= dir / vec2(uAspect, 1.0) * ring * 0.025;
  // heat haze above the altar
  vec2 hd = (uv - uHazeCenter) * vec2(uAspect, 1.0);
  float hz = uHeatHaze * exp(-dot(hd, hd) * 6.0);
  uv += (vec2(vnoise(uv*40.0 + uTime*1.5), vnoise(uv*40.0 - uTime*1.7)) - 0.5) * 0.006 * hz;
  vec2 vuv = (uv + uShake) * uCoverScale + uCoverOffset;
  vec3 vid = mix(texture2D(tStable, vuv).rgb, texture2D(tPribliji, vuv).rgb, uMix);
  vid *= uVideoFade;
  vec4 fx = texture2D(tFx, uv + uShake);
  vec3 bloom = texture2D(tBloom, uv + uShake).rgb;
  vec3 col = vid * (1.0 - clamp(fx.a, 0.0, 1.0)) + fx.rgb + bloom * uBloom;
  col += uFlash * vec3(1.0, 0.72, 0.45);
  col = shoulder(col);
  // vignette + fine grain
  vec2 v = vUv - 0.5;
  col *= 1.0 - dot(v, v) * 0.55;
  col += (hash21(vUv * 1000.0 + fract(uTime) * 91.0) - 0.5) * 0.018;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
