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

/** One layer of the magic circle: R/G/B channels = structure / inscriptions / accents. */
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
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uColC;
uniform vec3 uHot;
varying vec2 vUv;
${NOISE}
void main(){
  vec2 p = vUv*2.0 - 1.0;
  float ang = fract(atan(p.x, p.y)/6.2831853 + 1.0 + uPhase);
  vec3 c = texture2D(uCore, vUv).rgb;
  vec3 g = texture2D(uGlow, vUv).rgb;
  float rv = uReveal * 1.08;
  float vis = 1.0 - smoothstep(rv - 0.04, rv, ang);
  float running = step(0.0005, uReveal) * (1.0 - step(0.999, uReveal));
  float lead = exp(-pow((rv - 0.02 - ang) * 18.0, 2.0)) * running;
  float fl = 0.82 + 0.18 * vnoise(vec2(ang*90.0 + uTime*1.3, uTime*3.1 + length(p)*20.0));
  float lines = max(c.r, max(c.g, c.b));
  vec3 ink = uColA * c.r + uColB * c.g + uColC * c.b;
  vec3 glow = uColA * g.r + uColB * g.g + uColC * g.b;
  // hot cores: the brightest strokes lean towards white when heated
  vec3 col = mix(ink, uHot * lines, smoothstep(1.0, 1.8, uHeat) * 0.6) * 1.05 * fl;
  col += glow * uGlowAmt * 0.38;
  col *= vis * uIntensity * uFade;
  col += uHot * lead * (lines * 2.2 + (g.r + g.g + g.b) * 0.4) * uIntensity * uFade;
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
  vec3 col = tex.rgb / tex.a * uTint * vShade; // texture is premultiplied
  // soft light falloff towards the edges + warm bounce light from the lava below
  col *= 1.0 - 0.28 * smoothstep(0.45, 1.05, edge);
  col *= mix(vec3(1.0), vec3(1.06, 0.9, 0.78), smoothstep(0.1, -0.5, q.y));
  // scorch: browning from the edges, like paper on a hot stone
  float scorch = clamp(uScorch * (edge*1.2 + n*0.6) - 0.35, 0.0, 1.0);
  col = mix(col, col*vec3(0.55, 0.35, 0.2), scorch);
  col = mix(col, vec3(0.05, 0.02, 0.01), charred * 0.92);
  // infernal letters burning through the paper
  float rune = texture2D(uRuneMap, vUv).r * uRunes;
  col = mix(col, col*0.55, rune*0.4);
  vec3 emit = uRuneCol * rune * (0.3 + 0.18*vnoise(vec2(uTime*4.0, vUv.x*30.0)));
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

/** Flying infernal letters (and the chain links between them), instanced along wavy orbits. */
export const GLYPH_VERT = /* glsl */ `
attribute float aGlyph;
attribute vec4 aOrbit;   // radius, z (slot or camera fraction), angularSpeed, phase
attribute vec4 aWave;    // radialAmp, radialFreq, zAmp, size
attribute vec4 aExtra;   // alpha, blur, mode (0 = in the circle, 1 = in front of the camera), flicker
uniform float uTime;
uniform float uSpread;
uniform float uSwirl;
uniform float uCamZ;
uniform float uCamD;
uniform float uFinalMix;
uniform float uZTop;
uniform float uDepth;
varying vec2 vUv;
varying float vAlpha;
varying float vGlyph;
varying float vBlur;
void main(){
  float th = aOrbit.w + uTime * aOrbit.z * uSwirl;
  float r = aOrbit.x + aWave.x * sin(th * aWave.y + uTime * 0.7 + aOrbit.w * 3.0);
  // chains: compact around the circle during the ritual, spread down the stack at the end
  float stacked = uZTop - (1.0 - clamp((aOrbit.y + 0.5) / 6.5, 0.0, 1.0)) * uDepth;
  float zc = aExtra.z > 0.5 ? uCamZ - aOrbit.y * uCamD : mix(aOrbit.y * uSpread, stacked, uFinalMix);
  float z = zc + aWave.z * sin(th * 2.0 + uTime * 0.9 + aOrbit.w);
  vec3 center = vec3(cos(th) * r, sin(th) * r, z);
  float dir = sign(aOrbit.z);
  vec2 tangent = vec2(-sin(th), cos(th)) * dir;
  vec2 outward = vec2(cos(th), sin(th));
  float s = aWave.w;
  vec3 pos = center + vec3(tangent * position.x * s + outward * position.y * s, 0.0);
  vUv = uv;
  vGlyph = aGlyph;
  vBlur = aExtra.y;
  float flick = 1.0 - aExtra.w + aExtra.w * (0.6 + 0.4 * sin(uTime * 3.0 + aOrbit.w * 17.0));
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  float near = smoothstep(0.12, 0.3, -mv.z / uCamD);
  vAlpha = aExtra.x * flick * near;
  gl_Position = projectionMatrix * mv;
}
`;

export const GLYPH_FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uOpacity;
uniform vec3 uColor;
uniform vec3 uColor2;
varying vec2 vUv;
varying float vAlpha;
varying float vGlyph;
varying float vBlur;
void main(){
  float gi = floor(vGlyph + 0.5);
  vec2 cell = vec2(mod(gi, 8.0), 4.0 - floor(gi / 8.0));
  vec2 uv = (cell + vUv) / vec2(8.0, 5.0);
  float g = texture2D(uAtlas, uv, vBlur).r;
  float a = g * vAlpha * uOpacity;
  vec3 col = gi > 31.5 ? uColor2 : uColor;
  gl_FragColor = vec4(col * a, 0.0);
}
`;

/** Tunnel passers: a textured ring/sigil in the curse's inks, fading with distance. */
export const PASSER_FRAG = /* glsl */ `
uniform sampler2D uCore;
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uColC;
uniform float uAlpha;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(uCore, vUv).rgb;
  vec3 col = (uColA * c.r + uColB * c.g + uColC * c.b) * uAlpha;
  gl_FragColor = vec4(col, 0.0);
}
`;

/**
 * The certificate as a real sheet in the scene:
 *  - a shimmering, mouse-reactive fragment of the magic circle in the curse's colours
 *  - the seal being engraved: a glowing front runs down the stamp and reveals the impression
 */
export const CERT_FRAG = /* glsl */ `
uniform sampler2D uBase;
uniform sampler2D uSealed;
uniform sampler2D uSealMask;
uniform sampler2D uShimmer;
uniform vec4 uSealRect;   // x, y, w, h in uv (y up)
uniform float uEngrave;
uniform float uOpacity;
uniform float uHeat;
uniform float uTime;
uniform float uShimmerAmt;
uniform vec2 uMouse;
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uColC;
uniform vec3 uHot;
varying vec2 vUv;
${NOISE}
void main(){
  vec4 base = texture2D(uBase, vUv);
  if (base.a < 0.005) discard;
  vec3 col = base.rgb / base.a; // texture is premultiplied

  // iridescent fragment of the circle: colour flows with time and the viewing angle (mouse)
  float m = texture2D(uShimmer, vUv).r;
  float phase = dot(vUv, vec2(2.4, 1.6)) + uMouse.x * 1.4 - uMouse.y * 1.1 + uTime * 0.15;
  vec3 iri = mix(uColA, uColB, 0.5 + 0.5 * sin(phase * 3.0));
  iri = mix(iri, uColC, 0.5 + 0.5 * sin(phase * 4.3 + 1.7));
  float sheen = pow(0.5 + 0.5 * sin(phase * 5.0 - uTime * 0.6), 3.0);
  col = mix(col, col * (0.45 + 0.65 * iri), m * uShimmerAmt);
  col += iri * m * uShimmerAmt * (0.07 + 0.14 * sheen);

  // seal engraving
  vec2 su = (vUv - uSealRect.xy) / uSealRect.zw;
  vec3 emit = vec3(0.0);
  if (su.x > 0.0 && su.x < 1.0 && su.y > 0.0 && su.y < 1.0) {
    vec3 sealed = texture2D(uSealed, su).rgb;
    float ink = texture2D(uSealMask, su).r;
    float y = 1.0 - su.y; // 0 at the top of the seal
    float n = fbm(su * 9.0 + 3.0) * 0.18;
    float front = uEngrave * 1.25 - 0.1;
    float revealed = smoothstep(front + 0.02, front - 0.03, y + n);
    col = mix(col, sealed, revealed);
    float band = exp(-pow((y + n - front) / 0.035, 2.0)) * step(0.001, uEngrave) * (1.0 - step(0.999, uEngrave));
    emit = mix(uColA, uHot, 0.5) * ink * band * 2.2;
    // freshly cut lines keep a fading glow
    emit += uColA * ink * revealed * (1.0 - smoothstep(0.0, 0.35, front - (y + n))) * 0.6 * step(0.001, uEngrave) * (1.0 - uEngrave * 0.8);
  }

  // birth heat: the sheet arrives glowing along its edges
  vec2 q = abs(vUv - 0.5) * 2.0;
  float edge = smoothstep(0.75, 1.0, max(q.x, q.y));
  emit += mix(uColA, uHot, 0.4) * uHeat * (0.03 + edge * 0.9);
  col = mix(col, col * vec3(1.08, 1.0, 0.92), uHeat * 0.4);

  float a = base.a * uOpacity;
  gl_FragColor = vec4(col * a + emit * uOpacity, a);
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
vec3 tap(vec2 o){
  vec4 c = texture2D(tSrc, vUv + uTexel * o);
  // opaque sheets (the note, the certificate) do not bloom; light on top of them does
  return max(c.rgb - vec3(0.85) * clamp(c.a, 0.0, 1.0), 0.0);
}
void main(){
  vec3 c = (tap(vec2(-0.5,-0.5)) + tap(vec2(0.5,-0.5)) + tap(vec2(-0.5,0.5)) + tap(vec2(0.5,0.5))) * 0.25;
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
uniform vec2 uParallax;   // video parallax (uv), follows the mouse
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
  vec2 vuv = (uv + uShake + uParallax) * uCoverScale + uCoverOffset;
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
