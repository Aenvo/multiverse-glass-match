// Orbkit GLSL and default Idle presets adapted for a shared WebGL2 atlas.
// Copyright (c) 2026 zzzzshawn. MIT, see licenses/Orbkit.txt.
// XorDev shader notices are preserved below. See licenses/Orbkit-shaders.md.
// Source: https://github.com/zzzzshawn/orbkit/tree/5dbd641ee0d08a9135a2c13b75c4685c36b02150/orbs
const helpers = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform vec2 uRes;
uniform float uTime;   // slow ambient clock (half real-time)
uniform float uAnim;   // flow clock — its speed follows the output volume
uniform float uInput;  // input volume 0..1: user speech energy
uniform float uOutput; // output volume 0..1: agent speech energy

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(11.7, 7.3);
    a *= 0.5;
  }
  return v;
}
vec2 orbUV() { return (2.0 * (vUv * uRes) - uRes) / min(uRes.x, uRes.y); }

// GLSL ES 1.0 has no tanh() — it arrived in ES 3.0. Shader-golf listings lean
// on it as a tone-mapper, so it ships here. Clamped against exp() overflow;
// accurate for the non-negative accumulators those shaders produce.
vec3 tanh3(vec3 x) {
  x = clamp(x, -10.0, 10.0);
  vec3 e = exp(2.0 * x);
  return (e - 1.0) / (e + 1.0);
}

`;

/*
 * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's
 * permission. Non-commercial use only, with attribution to XorDev; keep this
 * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.
 */
// shdr-01
const shdr01 = `#version 300 es
${helpers}
uniform float uP_speed;
uniform float uP_spin;
uniform float uP_camDist;
uniform float uP_focal;
uniform float uP_tilt;
uniform float uP_turb;
uniform float uP_sheets;
uniform float uP_disperse;
uniform float uP_stria;
uniform float uP_envRadius;
uniform float uP_envCore;
uniform float uP_fill;
uniform float uP_stepClamp;
uniform float uP_scatter;
uniform float uP_exposure;
uniform float uP_contrast;
uniform float uP_saturation;
uniform float uP_alphaGain;
uniform float uP_edge;
uniform float uP_edgeFade;
uniform vec3 uC_tint;

#define STEPS 60
#define TURB 5
#define AA 1

// Volume-reactive values, resolved once per fragment in main().
float dispersionTurb;
float dispersionExposure;

mat2 rot2(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

vec3 dispersionRender(vec2 fragCoord) {
  float animTime = uP_speed; // integrated clock: turbulence + sheet drift
  float spinAng = uP_spin;   // integrated clock: prism precession

  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  vec3 ro = vec3(0.0, 0.0, uP_camDist);
  vec3 rd = normalize(vec3(uv, -uP_focal));

  vec3 acc = vec3(0.0);

  // transmittance carried front-to-back, as in shdr-21 and the README's
  // diffusion note — near sheets veil far ones, which is where the depth
  // read comes from
  float T = 1.0;

  /*
    March only the span that can contribute. The tube is infinite, so a ray
    grazing its wall far in FRONT of the ball would otherwise stall there —
    small d, step after step — and exhaust STEPS before ever reaching the
    envelope, leaving a dark notch across the orb. Start at the envelope's
    near edge and break past its far edge; all 60 steps land where the
    envelope is non-zero.
  */
  float z = max(uP_camDist - uP_envRadius * 1.3, 0.0);
  float zEnd = uP_camDist + uP_envRadius * 1.3;

  for (int it = 0; it < STEPS; it++) {
    vec3 p = ro + rd * z;

    // orient the prism: static tilt about x, then precession about y from
    // the spin clock. Real rotations — see the header note.
    vec3 q = p;
    q.xz = rot2(spinAng) * q.xz;
    q.yz = rot2(uP_tilt) * q.yz;

    // turbulence in the prism's rotating frame; the +float(it) offset is the
    // original's +i, decorrelating octaves per step for a smoky depth
    vec3 a = q;
    for (int j = 0; j < TURB; j++) {
      float dj = float(j) + 3.0;
      a -= dispersionTurb * sin(a * dj + animTime + float(it)).yzx / dj;
    }

    /*
      The orb's own shell, in place of the original's square tube
      (golfed there as max(p=abs(p),p.y).x — just max(|x|,|y|)). Evaluated
      on the WARPED point, so the turbulence shimmers the surface itself
      like an oil film; at turb 0 it is a perfect glass shell. The cos
      sheets fill the interior with the dispersive volume.
    */
    float wall = abs(length(a) - uP_envRadius);
    float s = a.z + a.y - animTime;
    float d = max(wall + abs(cos(s)) / uP_sheets, 1e-4);

    /*
      Per-channel palette: one cosine phase per channel, scaled by uP_disperse
      (0 collapses to monochrome breathing, 1 is the original rainbow). The
      -z term couples depth into the phase, which is what turns the sheets
      into striations; uP_stria scales it.

      The CLAMP is load-bearing, same as the other accumulators here: 1/d
      spikes where a ray grazes the wall exactly where a sheet sits, and one
      unclamped sample would own the whole 60-step sum at some phases.
    */
    vec3 w = (cos(s - z * uP_stria + vec3(0.0, 1.0, 8.0) * uP_disperse) + 1.0) / d;
    w = min(w, vec3(uP_stepClamp));

    /*
      Envelope: bounds the sheet glow (the cos field lives EVERYWHERE in
      space, not just inside the ball) and adds the uP_fill floor that
      guarantees a body. The outer bound sits 12% PAST the radius on
      purpose: the shell IS the radius now, the silhouette is cut
      analytically in main(), and a hard cut only reads as a sharp edge if
      there is still emission left at the boundary to cut. envCore is where
      the plateau saturates — 1 keeps the shell at full strength, lower
      values pull the brightness into the core.
    */
    float env = smoothstep(uP_envRadius * 1.12, uP_envRadius * uP_envCore, length(p));
    w = (w + uP_fill) * env;

    acc += T * w;
    T *= exp(-dot(w, vec3(0.299, 0.587, 0.114)) * uP_scatter);

    z += d;
    if (T < 0.004 || z > zEnd) break;
  }

  return acc;
}

void main() {
  dispersionTurb = uP_turb * (1.0 + 0.5 * uInput);
  dispersionExposure = uP_exposure * (1.0 - 0.35 * uOutput);

  vec3 acc = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 offset = vec2(float(mx), float(my)) / float(AA) - 0.5;
      acc += dispersionRender((vUv * uRes) + offset);
    }
  }
  acc /= float(AA * AA);
#else
  acc = dispersionRender((vUv * uRes));
#endif

  // tanh tone map, as in the original but per channel and with a tunable
  // knee — the envelope and transmittance change the accumulator's scale
  // completely, so the golfed /2e2 constant means nothing here
  vec3 col = tanh3(acc / max(dispersionExposure, 1.0));
  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));

  // saturation about luminance, then the tint
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);
  col *= uC_tint;

  // alpha from the brightest channel, not luminance — a saturated violet
  // fringe has low luminance but must not go transparent
  float peak = max(col.r, max(col.g, col.b));
  float a = clamp(peak * uP_alphaGain, 0.0, 1.0);

  /*
    Analytic silhouette: the perpendicular distance from the sphere's centre
    to this pixel's ray, against the shell radius. Exact — not a fade of the
    accumulated glow — which is what makes the edge read as cut glass.
    uP_edge trades the transition band: 1 is a couple of pixels, 0 falls
    back to a soft feather. Colour AND alpha, as always.
  */
  vec3 mrd = normalize(vec3(orbUV(), -uP_focal));
  float closest = length(cross(vec3(0.0, 0.0, uP_camDist), mrd));
  float band = mix(0.35, 0.012, clamp(uP_edge, 0.0, 1.0));
  float mask = 1.0 - smoothstep(uP_envRadius * (1.0 - band), uP_envRadius * 1.005, closest);
  col *= mask;
  a *= mask;

  // Fade colour as well as alpha — with premultiplied output, fading only
  // alpha leaves the pixel emitting at full brightness up to the cutoff,
  // which reads as a hard rim. With the analytic mask doing the real work
  // this is only a safety taper at the frame boundary.
  float r2d = length(orbUV());
  float fade = 1.0 - smoothstep(uP_edgeFade, 1.0, r2d);
  col *= fade;
  a *= fade;

  // Emitted light, so rgb is already premultiplied — do NOT scale by alpha
  // again (see the same note in shdr-31).
  fragColor = vec4(col, a);
}
`;

/*
 * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's
 * permission. Non-commercial use only, with attribution to XorDev; keep this
 * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.
 */
// shdr-02
const shdr02 = `#version 300 es
${helpers}
uniform float uP_speed;
uniform float uP_swirl;
uniform float uP_radius;
uniform float uP_swell;
uniform float uP_zoom;
uniform float uP_bulge;
uniform float uP_warpFreq;
uniform float uP_hueShift;
uniform float uP_coreClamp;
uniform float uP_falloff;
uniform float uP_gain;
uniform float uP_rim;
uniform float uP_rimPow;
uniform float uP_alphaGain;
uniform float uP_baseVis;

#define LAYERS 10
#define WARP 9

void main() {
  vec2 uv = orbUV();
  float R = uP_radius + uP_swell * uInput;
  float r2d = length(uv);
  float mask = smoothstep(0.012, -0.012, r2d - R);
  float nr = clamp(r2d / max(R, 0.001), 0.0, 1.0);
  float z = sqrt(max(1.0 - nr * nr, 0.0));

  float animTime = uP_speed; // integrated clock

  vec3 sp = vec3(uv / max(R, 0.001), z);

  /*
    Stereographic projection: sphere → plane. Equal steps in screen space map to
    ever-larger steps in pattern space as the rim is approached, which is exactly
    the foreshortening that sells a flat field as wrapped geometry. uP_bulge
    softens the divisor — higher flattens it back toward a disc.

    DO NOT rotate sp in 3D before this. Spinning the dome about Y mixes sp.x
    into sp.z, so near the rim the divisor collapses toward zero, p explodes,
    length(v) goes huge, and 1/length(v) leaves most of the sphere black. That
    is what hollowed the orb out. The projection needs sp.z to stay the
    view-facing component.

    Motion comes from animTime inside the warp below instead, which changes the
    scrollwork without ever touching the projection. If you want the pattern to
    travel, rotate or translate p here in 2D — that is projection-safe.
  */
  vec2 p = sp.xy / (sp.z + 1.0 + uP_bulge) * uP_zoom;

  // projection-safe 2D drift, in place of a dome spin
  float sw = animTime * uP_swirl;
  p = mat2(cos(sw), -sin(sw), sin(sw), cos(sw)) * p;

  // input volume tightens the warp; output volume brightens the layers
  float warpFreq = uP_warpFreq * (1.0 + 0.35 * uInput);
  float gain = uP_gain * (0.75 + 0.7 * uOutput);

  vec4 acc = vec4(0.0);
  for (int i = 1; i <= LAYERS; i++) {
    float fi = float(i);
    vec2 v = p;
    for (int j = 1; j <= WARP; j++) {
      float f = float(j);
      v += sin(v.yx * f * warpFreq + fi + animTime) / f;
    }
    // uP_coreClamp guards the divide and doubles as the flare size — the
    // original has no guard and relies on length(v) never hitting zero.
    //
    // uP_falloff is the FILL control. The original's plain 1/length(v) decays
    // fast, so only the knots where the warp lands near the origin light up and
    // the rest of the sphere stays near black. An exponent below 1 flattens the
    // tail — at length(v)=10 a 0.6 power is ~4x brighter than 1/x — which lifts
    // the filigree between the knots without blowing the knots themselves out.
    float rad = pow(max(length(v), uP_coreClamp), uP_falloff);
    acc += (cos(fi + vec4(0.0, 1.0, 2.0, 3.0) + uP_hueShift) + 1.0) / 6.0 / rad;
  }

  // the original squares before tone-mapping, which is what crushes the dim
  // filigree and leaves the bright scrollwork
  vec3 col = tanh3(acc.rgb * acc.rgb * gain);

  // rim light, so the silhouette reads as a ball rather than a cut-out
  float fresnel = pow(1.0 - z, uP_rimPow);
  col += vec3(fresnel) * uP_rim;

  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float visibility = clamp(lum * uP_alphaGain + uP_baseVis + fresnel * 0.25, 0.0, 1.0);

  // Surface-lit and mask-bounded, so alpha is coverage: premultiply normally.
  // (Unlike Corona and Nimbus, which are emissive and must not be.)
  float a = mask * visibility;
  fragColor = vec4(col * a, a);
}
`;

/*
 * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's
 * permission. Non-commercial use only, with attribution to XorDev; keep this
 * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.
 */
// shdr-03
const shdr03 = `#version 300 es
${helpers}
uniform float uP_speed;
uniform float uP_wander;
uniform float uP_feedback;
uniform float uP_camDist;
uniform float uP_focal;
uniform float uP_shellR;
uniform float uP_shellW;
uniform float uP_plane;
uniform float uP_turb;
uniform float uP_width;
uniform float uP_pulse;
uniform float uP_surge;
uniform float uP_hue;
uniform float uP_spread;
uniform float uP_envRadius;
uniform float uP_envCore;
uniform float uP_fill;
uniform float uP_stepClamp;
uniform float uP_scatter;
uniform float uP_exposure;
uniform float uP_contrast;
uniform float uP_saturation;
uniform float uP_alphaGain;
uniform float uP_edge;
uniform float uP_edgeFade;
uniform vec3 uC_tint;

#define STEPS 80
#define TURB 8
#define AA 1

// Volume-reactive values, resolved once per fragment in main().
float eclipticTurb;
float eclipticPlane;
float eclipticExposure;
float eclipticWidth;

vec3 eclipticRender(vec2 fragCoord) {
  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  vec3 ro = vec3(0.0, 0.0, uP_camDist);
  vec3 rd = normalize(vec3(uv, -uP_focal));

  float animTime = uP_speed; // integrated clock: the warp
  float wander = uP_wander;  // integrated clock: the belt's tilt

  vec3 acc = vec3(0.0);

  // transmittance carried front-to-back — the near belt veils the far one
  float T = 1.0;

  // march only the span the envelope can light, as in shdr-01
  float z = max(uP_camDist - uP_envRadius * 1.3, 0.0);
  float zEnd = uP_camDist + uP_envRadius * 1.3;

  /*
    The listing's feedback variable, explicit. On the first iteration the
    axis below reads this before anything has written it — zero is what the
    golfed version gets, so zero is what it gets here.
  */
  float d = 0.0;

  for (int it = 0; it < STEPS; it++) {
    vec3 p = ro + rd * z;

    /*
      The axis, steered by the PREVIOUS step's density: the belt's tilt
      settles as the ray closes on the surface and swings away from it out
      in the open. The three phases are far enough apart that the cosines
      can never null together, so the normalize is safe without a guard.
    */
    vec3 axis = normalize(cos(wander + vec3(4.0, 2.0, 0.0) - d * uP_feedback));

    // the exact minus-90-degree rotation about that axis
    vec3 a = dot(axis, p) * axis - cross(axis, p);

    // eight octaves of plain feedback warp — no lattice quantizer here,
    // unlike its cousins shdr-22 and shdr-04
    for (int j = 0; j < TURB; j++) {
      float f = float(j) + 2.0;
      a += eclipticTurb * sin(a * f + animTime).yzx / f;
    }

    /*
      Sphere plus plane. The shell reads the RAW point so the ball stays a
      ball; the plane reads the WARPED one so the belt writhes across it.
      uP_plane at zero drops the belt and lights the whole shell, which is
      worth being able to see once.
    */
    d = uP_shellW * abs(length(p) - uP_shellR) + eclipticPlane * abs(a.y);
    d = max(d, eclipticWidth);

    /*
      Hue from the DENSITY — the belt contoured in rainbow along its own
      distance field — and the listing's z in the numerator, which burns
      the far limb hotter than the near one.
    */
    vec3 w = cos(d * uP_hue + vec3(0.0, 2.0, 4.0) * uP_spread) + 1.0;
    w *= z / d;
    w = min(w, vec3(uP_stepClamp));

    // envelope: plateau through the ball, cut 12% past the radius so the
    // analytic silhouette in main() still has emission left to cut
    float env = smoothstep(uP_envRadius * 1.12, uP_envRadius * uP_envCore, length(p));
    w = (w + uP_fill) * env;

    acc += T * w;
    T *= exp(-dot(w, vec3(0.299, 0.587, 0.114)) * uP_scatter);

    z += d;
    if (T < 0.004 || z > zEnd) break;
  }

  return acc;
}

void main() {
  /*
    The SURGE: tightness and warp swept together on one phase, so the belt
    gathers into a hard warped girdle and then opens back into a smooth
    shell. Two params, one gesture — swept apart they read as two unrelated
    things happening at once.

    Absolute bounds rather than a swing around what was dialled, so the range
    is exactly the range: tightness 0.1 to 0.3, warp 0.5 to 1.6. That is why
    the mix sits OUTSIDE the volume terms below — folding the surge under
    them would shave the top of both ranges by whatever the agent happened to
    be doing. At surge zero those terms are all that is left, so a state that
    does not ask for this is untouched.
  */
  float surge = 0.5 - 0.5 * cos(uAnim * 4.0);

  eclipticTurb = mix(uP_turb * (1.0 + 0.4 * uInput), mix(0.5, 1.6, surge), uP_surge);
  // the belt broadens toward a full shell while the agent speaks
  eclipticPlane = mix(uP_plane * (1.0 - 0.35 * uOutput), mix(0.1, 0.3, surge), uP_surge);
  eclipticExposure = uP_exposure * (1.0 - 0.3 * uOutput);

  /*
    The belt BREATHES. At pulse zero the width is exactly what was dialled,
    so a state that does not ask for this is untouched; at one it sweeps the
    whole way from nothing to that width and back, once every few seconds.

    It cannot truly reach zero. Belt width is the march's step floor — see
    the port note above — and a zero step stalls the ray on one point, which
    with no scatter to close the transmittance accumulates the clamp eighty
    times into a white flare. The floor is the param's own minimum, four
    times finer than what the resting belt uses, so it reads as gone.

    Off uAnim rather than a raw clock, so the breath quickens with the agent
    like every other motion in the engine.
  */
  eclipticWidth = max(uP_width * (1.0 - uP_pulse * (0.5 + 0.5 * cos(uAnim * 3.0))), 5e-4);

  vec3 acc = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 offset = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;
      acc += eclipticRender((vUv * uRes) + offset);
    }
  }
  acc /= float(AA * AA);
#else
  acc = eclipticRender((vUv * uRes));
#endif

  // tanh tone map per channel — the envelope and transmittance change the
  // accumulator's scale, so the golfed /1e4 knee is a tunable here
  vec3 col = tanh3(acc / max(eclipticExposure, 1.0));
  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));

  // saturation about luminance, then the tint
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);
  col *= uC_tint;

  // alpha from the brightest channel, not luminance — a deep blue contour
  // has low luminance but must not go transparent
  float peak = max(col.r, max(col.g, col.b));
  float a = clamp(peak * uP_alphaGain, 0.0, 1.0);

  // Analytic silhouette — identical construction to shdr-01: exact
  // ray-to-centre distance against the radius, colour AND alpha.
  vec3 mrd = normalize(vec3(orbUV(), -uP_focal));
  float closest = length(cross(vec3(0.0, 0.0, uP_camDist), mrd));
  float band = mix(0.35, 0.012, clamp(uP_edge, 0.0, 1.0));
  float mask = 1.0 - smoothstep(uP_envRadius * (1.0 - band), uP_envRadius * 1.005, closest);
  col *= mask;
  a *= mask;

  // safety taper at the frame boundary — colour as well as alpha
  float r2d = length(orbUV());
  float fade = 1.0 - smoothstep(uP_edgeFade, 1.0, r2d);
  col *= fade;
  a *= fade;

  // Emitted light, so rgb is already premultiplied — do NOT scale by alpha
  // again (see the same note in shdr-31).
  fragColor = vec4(col, a);
}
`;

/*
 * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's
 * permission. Non-commercial use only, with attribution to XorDev; keep this
 * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.
 */
// shdr-04
const shdr04 = `#version 300 es
${helpers}
uniform float uP_speed;
uniform float uP_camDist;
uniform float uP_focal;
uniform float uP_shellR;
uniform float uP_pitch;
uniform float uP_turb;
uniform float uP_slack;
uniform float uP_width;
uniform float uP_hueGain;
uniform float uP_floorLevel;
uniform float uP_envScale;
uniform float uP_exposure;
uniform float uP_contrast;
uniform float uP_saturation;
uniform float uP_alphaGain;
uniform float uP_edge;
uniform float uP_edgeFade;
uniform vec3 uC_tint;

#define STEPS 50
#define TURB 6
#define AA 1

// Volume-reactive values, resolved once per fragment in main().
float geodeTurb;
float geodeWidth;
float geodeExposure;

// GLSL ES 1.0 has no round() — it arrived in ES 3.0. The listing quantizes
// with it, so it ships here.
vec3 roundv(vec3 x) { return floor(x + 0.5); }

vec3 geodeRender(vec2 fragCoord) {
  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  vec3 ro = vec3(0.0, 0.0, uP_camDist);
  vec3 rd = normalize(vec3(uv, -uP_focal));

  float animTime = uP_speed; // integrated clock
  float shellR = uP_shellR;
  float pitch = max(uP_pitch, 0.002);

  // the run-away bound for rays that miss the shell entirely
  float zEnd = uP_camDist + shellR * 2.5;

  vec3 acc = vec3(0.0);

  // The listing starts its march at the camera and lets the trace do the
  // travelling — see the header. z is the distance already walked.
  float z = 0.0;

  for (int it = 0; it < STEPS; it++) {
    vec3 p = ro + rd * z;

    /*
      Six octaves on ONE lattice. The pitch never changes; only the phase
      multiplier does, so the displacement is piecewise constant on a
      single grid and the shell facets at one scale.
    */
    for (int j = 0; j < TURB; j++) {
      float f = float(j) + 2.0;
      p += geodeTurb * sin(roundv(p.zxy / pitch) * pitch * f - animTime) / f;
    }

    /*
      Sphere trace toward the shell, on the WARPED point — so the facets
      are what the ray is chasing, not a smooth ball underneath them. The
      slack is the listing's tenth, and the floor is the surface width.
    */
    float d = geodeWidth + uP_slack * abs(length(p) - shellR);

    z += d;

    /*
      Position as colour, washing toward white with depth. Guarded on z:
      the listing gets away with reading p/z here because its comma
      operator advances z first, which is worth knowing before anyone
      reorders these two lines.
    */
    acc += (p * uP_hueGain / max(z, 1e-3) + uP_floorLevel) / d;

    if (z > zEnd) break;
  }

  return acc;
}

void main() {
  geodeTurb = uP_turb * (1.0 + 0.5 * uInput);
  geodeWidth = max(uP_width * (1.0 - 0.4 * uOutput), 0.0002);
  geodeExposure = uP_exposure * (1.0 - 0.3 * uOutput);

  vec3 acc = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 offset = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;
      acc += geodeRender((vUv * uRes) + offset);
    }
  }
  acc /= float(AA * AA);
#else
  acc = geodeRender((vUv * uRes));
#endif

  // tanh tone map per channel — the golfed /2e3 knee is a tunable here
  vec3 col = tanh3(acc / max(geodeExposure, 1.0));
  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));

  // saturation about luminance, then the tint
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);
  col *= uC_tint;

  // alpha from the brightest channel, not luminance — a deep blue facet
  // has low luminance but must not go transparent
  float peak = max(col.r, max(col.g, col.b));
  float a = clamp(peak * uP_alphaGain, 0.0, 1.0);

  /*
    Analytic silhouette against the shell, widened by uP_envScale because
    the turbulence pushes the visible surface OUT past the nominal radius —
    cut at the bare radius and the facets would be shaved flat all round
    the limb.
  */
  vec3 mrd = normalize(vec3(orbUV(), -uP_focal));
  float closest = length(cross(vec3(0.0, 0.0, uP_camDist), mrd));
  float sil = uP_shellR * uP_envScale;
  float band = mix(0.35, 0.012, clamp(uP_edge, 0.0, 1.0));
  float mask = 1.0 - smoothstep(sil * (1.0 - band), sil * 1.005, closest);
  col *= mask;
  a *= mask;

  // safety taper at the frame boundary — colour as well as alpha
  float r2d = length(orbUV());
  float fade = 1.0 - smoothstep(uP_edgeFade, 1.0, r2d);
  col *= fade;
  a *= fade;

  // Emitted light, so rgb is already premultiplied — do NOT scale by alpha
  // again (see the same note in shdr-31).
  fragColor = vec4(col, a);
}
`;

/*
 * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's
 * permission. Non-commercial use only, with attribution to XorDev; keep this
 * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.
 */
// shdr-05
const shdr05 = `#version 300 es
${helpers}
uniform float uP_ring;
uniform float uP_swirl;
uniform float uP_slide;
uniform float uP_radius;
uniform float uP_scale;
uniform float uP_bulge;
uniform float uP_lens;
uniform float uP_poleSoft;
uniform float uP_freq;
uniform float uP_spread;
uniform float uP_gain;
uniform float uP_contrast;
uniform float uP_saturation;
uniform float uP_floorLevel;
uniform float uP_light;
uniform float uP_rim;
uniform vec3 uC_tint;
uniform vec3 uC_body;
uniform vec3 uC_sheen;

#define AA 3

// Volume-reactive values, resolved once per fragment in main().
float causticSoft;
float causticGain;
float causticSpread;

/*
  Softened tangent. Equal to sin/cos wherever cos is not near zero, capped
  at 1/(2*sqrt(g)) where it is — see the header for why the raw pole cannot
  be supersampled away.
*/
vec2 tanSoft(vec2 x, float g) {
  vec2 s = sin(x);
  vec2 c = cos(x);
  return s * c / (c * c + g);
}

vec3 causticRender(vec2 fragCoord) {
  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  float R = max(uP_radius, 0.001);

  // the dome: the front hemisphere of a unit ball, in screen space
  vec2 pl = uv / R;
  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));

  float ring = uP_ring; // integrated clock: the rings travel

  // stereographic wrap of the unrotated dome, as in shdr-08 — the lens
  // lattice compresses toward the limb the way a texture on a sphere does
  vec2 p = pl / (z + 1.0 + uP_bulge) * uP_scale;

  // projection-safe 2D motion: the lattice turns and slides
  float sw = uP_swirl; // integrated clock
  p = mat2(cos(sw), -sin(sw), sin(sw), cos(sw)) * p;
  p += vec2(uP_slide, uP_slide * 0.6); // integrated clock

  /*
    The lens lattice. Adding p back to its own tangent is what gives every
    cell a different view instead of tiling one image — see the header.
  */
  float L = length(tanSoft(p, causticSoft) * uP_lens + p);

  /*
    One cosine, three phases. The listing's (0, .7, 1) sit well under a
    radian apart, so the channels overlap through most of a band and only
    separate at its shoulders — white cores with coloured edges, not three
    independent rainbows.
  */
  vec3 col = cos(L * uP_freq - ring + vec3(0.0, 0.7, 1.0) * causticSpread);

  // the listing's clamp: half of every period is hard black, and that is
  // what makes these read as bands rather than as a gradient
  col = max(col, vec3(0.0)) * causticGain;

  col = pow(col, vec3(uP_contrast));

  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);
  col *= uC_tint;

  // a dark body under the bands, so the black half of the cosine reads as
  // the ball rather than as a hole in it
  col += uC_body * uP_floorLevel;

  // dome shading keeps the ball a ball under the lattice
  vec3 n = vec3(pl, z);
  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.72))), 0.0, 1.0);
  col *= 0.6 + uP_light * lambert;

  float fres = 1.0 - z;
  fres = fres * fres * fres;
  col += uC_sheen * uP_rim * fres;

  return col;
}

void main() {
  // Volume coupling: the user's voice lets the walls crowd tighter, the
  // agent's brightens the bands and opens the colour split.
  causticSoft = max(uP_poleSoft * (1.0 - 0.5 * uInput), 0.0008);
  causticGain = uP_gain * (0.85 + 0.45 * uOutput);
  causticSpread = uP_spread * (1.0 + 0.5 * uOutput);

  vec2 uv = orbUV();
  float mask = smoothstep(0.012, -0.012, length(uv) - max(uP_radius, 0.001));

  if (mask <= 0.0) {
    fragColor = vec4(0.0);
    return;
  }

  vec3 col = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 off = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;
      col += causticRender((vUv * uRes) + off);
    }
  }
  col /= float(AA * AA);
#else
  col = causticRender((vUv * uRes));
#endif

  // Surface orb bounded by a mask: alpha IS coverage, so premultiply — the
  // opposite convention from the emissive orbs (see shdr-31).
  float a = mask;
  fragColor = vec4(max(col, vec3(0.0)) * a, a);
}
`;

/*
 * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's
 * permission. Non-commercial use only, with attribution to XorDev; keep this
 * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.
 */
// shdr-06
const shdr06 = `#version 300 es
${helpers}
uniform float uP_speed;
uniform float uP_drift;
uniform float uP_radius;
uniform float uP_scale;
uniform float uP_bulge;
uniform float uP_depth;
uniform float uP_freq;
uniform float uP_glowSize;
uniform float uP_hueRate;
uniform float uP_exposure;
uniform float uP_contrast;
uniform float uP_saturation;
uniform float uP_light;
uniform float uP_rim;
uniform vec3 uC_tint;
uniform vec3 uC_sheen;

#define LAYERS 100
#define AA 1

/*
 * The listing's sin(r + f), minus the resolution. The components are a
 * quarter turn apart so the per-layer frequency pair walks a circle (see
 * the header) — the base value only sets where on that circle layer one
 * starts.
 */
const vec2 SEED = vec2(11.3, 12.87);

// Volume-reactive values, resolved once per fragment in main().
float moireDrift;
float moireGlow;
float moireHue;

vec3 moireRender(vec2 fragCoord) {
  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  float R = max(uP_radius, 0.001);

  // the dome: the front hemisphere of a unit ball, in screen space
  vec2 pl = uv / R;
  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));

  float t = uP_speed; // integrated clock

  /*
    The layer-zero projection: the plain stereographic wrap of the dome's
    surface. Every deeper layer is this divided by its own denominator, so
    the whole parallax below costs one ratio per layer.
  */
  float bulge = 1.0 + uP_bulge;
  float den0 = z + bulge;

  vec2 w = pl / den0 * uP_scale;

  vec3 acc = vec3(0.0);

  for (int li = 0; li < LAYERS; li++) {
    float f = float(li) + 1.0;
    float u = f / float(LAYERS);

    /*
      This layer's depth along the view ray, and the projection from the
      point the ray has reached there. At depth 0 the denominator is den0
      and the ratio is 1; deeper layers see the pattern from further
      inside the ball, which spreads them at the limb and not at all
      through the centre. That gradient is what shears the stack.
    */
    float d = u * uP_depth;
    float denu = z - d + bulge * sqrt(max(1.0 - 2.0 * d * z + d * d, 0.0));
    vec2 q = w * (den0 / max(denu, 0.05));

    /*
      One lattice. sin(q * k) vanishes on a rectangular grid of points and
      the reciprocal of its length lights every one; the floor on that
      length is the glow's radius, and without it the divide is by exactly
      zero at every lattice point.
    */
    vec2 k = sin(SEED + f) / max(uP_freq, 0.001);
    float g = max(length(sin(q * k)), moireGlow);

    // tint by layer index — depth through the stack reads as hue
    vec3 hue = cos(f * moireHue + vec3(0.0, 1.0, 3.0)) + 1.1;

    acc += hue / g;

    // the listing's walk between layers: the stack is a hundred grids
    // each shifted a little further along a wandering path
    w += moireDrift * sin(w.yx + t);
  }

  /*
    The listing's knee is tanh(o*o/4e4) over an unnormalized sum of a
    hundred layers. Dividing by the layer count first pulls the square's
    scale down by 100*100, so the same knee is exactly 4 here — a number
    that fits on a slider. The square is a contrast squarer, not a tone
    map: it crushes the field between the glows.
  */
  vec3 v = acc / float(LAYERS);
  vec3 col = tanh3(v * v / max(uP_exposure, 0.0001));
  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));

  // saturation about luminance, then the tint
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);
  col *= uC_tint;

  /*
    Dome shading, kept gentle: the layers are emission seen THROUGH the
    ball, so a hard lambert reads as a shadow thrown across the inside of
    a lamp rather than as a lit surface.
  */
  vec3 n = vec3(pl, z);
  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.72))), 0.0, 1.0);
  col *= 0.6 + uP_light * lambert;

  float fres = 1.0 - z;
  fres = fres * fres * fres;
  col += uC_sheen * uP_rim * fres;

  return col;
}

void main() {
  // Volume coupling: the user's voice widens the walk between layers, the
  // agent's opens the glows and runs the hue through the stack faster.
  moireDrift = uP_drift * (1.0 + 0.6 * uInput);
  moireGlow = max(uP_glowSize * (1.0 - 0.3 * uOutput), 0.002);
  moireHue = uP_hueRate * (1.0 + 0.35 * uOutput);

  vec2 uv = orbUV();
  float mask = smoothstep(0.012, -0.012, length(uv) - max(uP_radius, 0.001));

  // A hundred lattices per sample, none of them worth paying for outside
  // the silhouette.
  if (mask <= 0.0) {
    fragColor = vec4(0.0);
    return;
  }

  vec3 col = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 off = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;
      col += moireRender((vUv * uRes) + off);
    }
  }
  col /= float(AA * AA);
#else
  col = moireRender((vUv * uRes));
#endif

  // Surface orb bounded by a mask: alpha IS coverage, so premultiply — the
  // opposite convention from the emissive orbs (see shdr-31).
  float a = mask;
  fragColor = vec4(max(col, vec3(0.0)) * a, a);
}
`;

/*
 * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's
 * permission. Non-commercial use only, with attribution to XorDev; keep this
 * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.
 */
// shdr-07
const shdr07 = `#version 300 es
${helpers}
uniform float uP_speed;
uniform float uP_wave;
uniform float uP_twist;
uniform float uP_spin;
uniform float uP_tilt;
uniform float uP_camDist;
uniform float uP_focal;
uniform float uP_turb;
uniform float uP_column;
uniform float uP_stepScale;
uniform float uP_hueDepth;
uniform float uP_hueStep;
uniform float uP_envRadius;
uniform float uP_envCore;
uniform float uP_fill;
uniform float uP_stepClamp;
uniform float uP_scatter;
uniform float uP_exposure;
uniform float uP_contrast;
uniform float uP_saturation;
uniform float uP_alphaGain;
uniform float uP_edge;
uniform float uP_edgeFade;
uniform vec3 uC_tint;

#define STEPS 50
#define TURB 9
#define AA 1

// Volume-reactive values, resolved once per fragment in main().
float torsionTurb;
float torsionTwist;
float torsionExposure;

// GLSL ES 1.0 has no round() — it arrived in ES 3.0. The listing quantizes
// with it, so it ships here. Halves round up rather than to even, which is
// what a lattice quantizer wants anyway.
vec3 roundv(vec3 x) { return floor(x + 0.5); }

vec3 torsionRender(vec2 fragCoord) {
  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  vec3 ro = vec3(0.0, 0.0, uP_camDist);
  vec3 rd = normalize(vec3(uv, -uP_focal));

  float shimmer = uP_speed; // integrated clock: cell flicker
  float wave = uP_wave;     // integrated clock: the travelling twist
  float spin = uP_spin;     // integrated clock: roll about the axis

  // the axis lean and the roll, applied to the SAMPLE rather than to the
  // axis — see the header
  float ct = cos(uP_tilt);
  float st = sin(uP_tilt);
  float cs = cos(spin);
  float ss = sin(spin);

  // the twist axis, unit by construction, which is what makes the
  // Rodrigues rotation below exact
  vec3 axis = vec3(0.0, 1.0, 0.0);

  vec3 acc = vec3(0.0);

  // transmittance carried front-to-back — near shells veil far ones
  float T = 1.0;

  // march only the span the envelope can light, as in shdr-01
  float z = max(uP_camDist - uP_envRadius * 1.3, 0.0);
  float zEnd = uP_camDist + uP_envRadius * 1.3;

  for (int it = 0; it < STEPS; it++) {
    vec3 world = ro + rd * z;

    // into the axis frame: lean about X, then roll about Y
    vec3 p = vec3(world.x, world.y * ct + world.z * st, -world.y * st + world.z * ct);
    p = vec3(p.x * cs - p.z * ss, p.y, p.x * ss + p.z * cs);

    /*
      The travelling twist. h is the sample's radius (scaled by the twist
      knob) minus the wave clock, and the line below is an exact rotation
      about the axis by 90 degrees - h. Because h depends only on radius,
      the winding is constant on spheres: the ball's own shells are the
      structure, and raising uP_twist puts more turns between the core and
      the surface.
    */
    float h = length(p) * torsionTwist - wave;
    vec3 a = mix(dot(axis, p) * axis, p, sin(h)) + cos(h) * cross(axis, p);

    // cell-quantized turbulence: every lattice cell flickers on its own
    // phase, the same construction shdr-22 uses
    for (int j = 0; j < TURB; j++) {
      float dj = float(j) + 1.0;
      a += torsionTurb * sin(roundv(a * dj) - shimmer).zxy / dj;
    }

    /*
      The axial density. At uP_column 0 this is the listing's
      length(a.xz) — distance from the twist axis, so the step collapses
      along the pole and the axis burns as a column. At 1 it is the plain
      radial length and the column dissolves into shells.
    */
    float d = uP_stepScale * mix(length(a.xz), length(a), uP_column);
    d = max(d, uP_envRadius * 0.003);

    /*
      The march's own colour code, from the listing: red constant, green
      by DEPTH into the ball, blue by STEP INDEX — the opposite assignment
      from shdr-22, and the reason this orb runs cyan-blue where that
      one runs red-green. Blue gets twice the clamp headroom: its ramp
      runs to STEPS (50) where red is fixed at 3, and an equal clamp would
      crush the step gradient first.
    */
    vec3 w = vec3(3.0, (z - uP_camDist + uP_envRadius) * uP_hueDepth, float(it) * uP_hueStep) / d;
    w = min(w, vec3(uP_stepClamp) * vec3(1.0, 1.0, 2.0));

    /*
      Normalize the clamped weight back to family units, exactly as in
      shdr-22: without this line the clamp value leaks into total
      energy and Exposure, Body fill and Diffusion all change meaning
      whenever the clamp moves.
    */
    w *= 20.0 / max(uP_stepClamp, 1.0);

    // envelope: plateau through the ball, cut 12% past the radius so the
    // analytic silhouette in main() still has emission left to cut
    float env = smoothstep(uP_envRadius * 1.12, uP_envRadius * uP_envCore, length(world));
    w = (w + uP_fill) * env;

    acc += T * w;
    T *= exp(-dot(w, vec3(0.299, 0.587, 0.114)) * uP_scatter);

    z += d;
    if (T < 0.004 || z > zEnd) break;
  }

  return acc;
}

void main() {
  torsionTurb = uP_turb * (1.0 + 0.5 * uInput);
  torsionExposure = uP_exposure * (1.0 - 0.35 * uOutput);
  // the ball winds tighter while the agent speaks
  torsionTwist = uP_twist * (1.0 + 0.4 * uOutput);

  vec3 acc = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 offset = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;
      acc += torsionRender((vUv * uRes) + offset);
    }
  }
  acc /= float(AA * AA);
#else
  acc = torsionRender((vUv * uRes));
#endif

  // tanh tone map per channel — the envelope and transmittance change the
  // accumulator's scale, so the golfed /1e4 knee is a tunable here
  vec3 col = tanh3(acc / max(torsionExposure, 1.0));
  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));

  // saturation about luminance, then the tint
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);
  col *= uC_tint;

  // alpha from the brightest channel, not luminance — a deep blue tail
  // has low luminance but must not go transparent
  float peak = max(col.r, max(col.g, col.b));
  float a = clamp(peak * uP_alphaGain, 0.0, 1.0);

  // Analytic silhouette — identical construction to shdr-01: exact
  // ray-to-centre distance against the radius, colour AND alpha.
  vec3 mrd = normalize(vec3(orbUV(), -uP_focal));
  float closest = length(cross(vec3(0.0, 0.0, uP_camDist), mrd));
  float band = mix(0.35, 0.012, clamp(uP_edge, 0.0, 1.0));
  float mask = 1.0 - smoothstep(uP_envRadius * (1.0 - band), uP_envRadius * 1.005, closest);
  col *= mask;
  a *= mask;

  // safety taper at the frame boundary — colour as well as alpha
  float r2d = length(orbUV());
  float fade = 1.0 - smoothstep(uP_edgeFade, 1.0, r2d);
  col *= fade;
  a *= fade;

  // Emitted light, so rgb is already premultiplied — do NOT scale by alpha
  // again (see the same note in shdr-31).
  fragColor = vec4(col, a);
}
`;

/*
 * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's
 * permission. Non-commercial use only, with attribution to XorDev; keep this
 * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.
 */
// shdr-08
const shdr08 = `#version 300 es
${helpers}
uniform float uP_speed;
uniform float uP_flow;
uniform float uP_swirl;
uniform float uP_radius;
uniform float uP_scale;
uniform float uP_bulge;
uniform float uP_warp;
uniform float uP_beat;
uniform float uP_thick;
uniform float uP_split;
uniform float uP_iris;
uniform float uP_irisScale;
uniform float uP_view;
uniform float uP_floor;
uniform float uP_gain;
uniform float uP_contrast;
uniform float uP_light;
uniform float uP_rim;
uniform vec3 uC_deep;
uniform vec3 uC_low;
uniform vec3 uC_crest;
uniform vec3 uC_sheen;

#define OCTAVES 10
#define AA 2

const float TAU = 6.28318530718;

// The listing's +r, minus the resolution dependence (see the header).
const vec2 SEED = vec2(4.7, 2.3);

// Volume-reactive values, resolved once per fragment in main().
float nacreWarp;
float nacreThick;
float nacreGain;

/*
  The listing's entire tone map: o = tanh(.2 / tan(x)); o *= o.

  The square folds the sign, so abs() on the denominator is not an
  approximation here — it is exact, and it removes the branch.
*/
vec3 cotBands(vec3 x, float k) {
  vec3 b = tanh3(k * cos(x) / max(abs(sin(x)), vec3(1e-4)));
  return b * b;
}

vec3 nacreRender(vec2 fragCoord) {
  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  float R = max(uP_radius, 0.001);

  // the dome: the front hemisphere of a unit ball, in screen space
  vec2 pl = uv / R;
  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));
  vec3 n = vec3(pl, z);

  float t = uP_speed; // integrated clock: the boil

  /*
    Stereographic projection, on the UNROTATED dome. Equal steps in screen
    space map to ever-larger steps in pattern space toward the rim, which
    is the foreshortening that sells a flat field as wrapped geometry.
    uP_bulge softens the divisor — higher flattens the shell back toward a
    disc, lower crowds the layers into the limb.
  */
  vec2 p = n.xy / (n.z + 1.0 + uP_bulge) * uP_scale;

  // projection-safe 2D motion, in place of a dome spin: the plane turns,
  // and the bands travel across themselves
  float sw = uP_swirl; // integrated clock
  p = mat2(cos(sw), -sin(sw), sin(sw), cos(sw)) * p;
  p.y -= uP_flow;      // integrated clock

  /*
    The ten-octave feedback warp. q is fed back into itself with the
    components swapped, so each octave curls what the last one drew.
  */
  vec2 q = p;
  for (int j = 0; j < OCTAVES; j++) {
    float i = float(j) + 1.0;
    q += nacreWarp * sin(q.yx * i + i * i + t * i + SEED) / i;
  }

  // the bands, with the listing's uneven per-channel phase kept as a ratio
  // so one slider widens the whole split
  vec3 band = cotBands(vec3(q.y) + vec3(0.0, 1.0, 3.0) * uP_split, nacreThick);
  float lev = dot(band, vec3(1.0 / 3.0));

  /*
    A dark body colour under the bands, so the valleys read as the shell
    itself rather than as holes punched through the ball. The band term
    stays PER-CHANNEL through the palette multiply — that is what carries
    the colour fringing; collapsing it to lev first would throw away the
    only thing the vec4 phase was for.
  */
  vec3 col = uC_deep * uP_floor;
  col += band * mix(uC_low, uC_crest, smoothstep(0.1, 0.9, lev)) * nacreGain;

  /*
    Thin-film interference. The cosine palette is keyed to the band
    coordinate, so every layer carries its own hue — the inside of a shell
    — and uP_view rotates that hue with the viewing angle through 1 - z,
    which means the sphere's curvature is doing the colouring. Multiplied
    in rather than mixed to, so it bends hues without erasing the palette.
  */
  vec3 irid = 0.5 + 0.5 * cos(TAU * (q.y * uP_irisScale + (1.0 - z) * uP_view + t * 0.03 + vec3(0.0, 0.33, 0.67)));
  col = mix(col, col * (0.25 + 1.9 * irid), uP_iris);

  col = pow(max(col, vec3(0.0)), vec3(uP_contrast));

  // dome shading keeps the ball a ball under the pattern
  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.72))), 0.0, 1.0);
  col *= 0.35 + uP_light * lambert;

  // fresnel sheen: the wet gloss of a shell, and the thing that keeps the
  // limb reading as a surface where the bands have compressed to a blur
  float fres = 1.0 - z;
  fres = fres * fres * fres;
  col += uC_sheen * uP_rim * fres;

  return col;
}

void main() {
  /*
    The BEAT: warp driven between 0.6 and 1.8 on a slow, unbroken cycle —
    one full swing every second and a third — with nothing held at either
    end. Warp is the amplitude of the octave loop that folds the bands, so
    sweeping it three to one makes the whole field draw in and open again
    rather than change colour or brightness — a swell, not a flash.

    Absolute bounds, so the range is exactly the range; that is why the mix
    sits outside the volume term below. At beat zero nothing here applies
    and the dialled warp stands, so a state that does not ask for it is
    untouched.

    Well under 3Hz, which matters: above that a full-field oscillation is
    in the band photosensitivity guidance warns about, and this one covers
    the whole ball. The rate is the constant below — raising it much past
    18 walks back into that range.
  */
  float beat = 0.5 - 0.5 * cos(uAnim * 5.0);

  // Volume coupling: the user's voice churns the warp harder, the agent's
  // widens the crests and brightens them.
  nacreWarp = mix(uP_warp * (1.0 + 0.45 * uInput), mix(0.6, 1.8, beat), uP_beat);
  nacreThick = uP_thick * (1.0 + 0.6 * uOutput);
  nacreGain = uP_gain * (0.85 + 0.4 * uOutput);

  vec2 uv = orbUV();
  float mask = smoothstep(0.012, -0.012, length(uv) - max(uP_radius, 0.001));

  // Nothing outside the silhouette is ever visible, so skip AA * AA warps
  // for it rather than shading transparent sky.
  if (mask <= 0.0) {
    fragColor = vec4(0.0);
    return;
  }

  vec3 col = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 off = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;
      col += nacreRender((vUv * uRes) + off);
    }
  }
  col /= float(AA * AA);
#else
  col = nacreRender((vUv * uRes));
#endif

  // Surface orb bounded by a mask: alpha IS coverage, so premultiply — the
  // opposite convention from the emissive orbs (see shdr-31).
  float a = mask;
  fragColor = vec4(max(col, vec3(0.0)) * a, a);
}
`;

/*
 * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's
 * permission. Non-commercial use only, with attribution to XorDev; keep this
 * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.
 */
// shdr-09
const shdr09 = `#version 300 es
${helpers}
uniform float uP_speed;
uniform float uP_spin;
uniform float uP_tilt;
uniform float uP_radius;
uniform float uP_scale;
uniform float uP_warp;
uniform float uP_seed;
uniform float uP_glow;
uniform float uP_lineSoft;
uniform float uP_inner;
uniform float uP_fringe;
uniform float uP_fringeSoft;
uniform float uP_ringPhase;
uniform float uP_exposure;
uniform float uP_contrast;
uniform float uP_saturation;
uniform float uP_light;
uniform float uP_rim;
uniform vec3 uC_tint;
uniform vec3 uC_sheen;

#define RINGS 10
#define TURB 9
#define AA 2

// Volume-reactive values, resolved once per fragment in main().
float irisWarp;
float irisGlow;
float irisFringe;

vec3 irisRender(vec2 fragCoord) {
  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  float R = max(uP_radius, 0.001);

  // the dome: the front hemisphere of a unit ball, in screen space
  vec2 pl = uv / R;
  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));
  vec3 n = vec3(pl, z);

  float t = uP_speed; // integrated clock

  // tilt about X, then roll about Y on its own integrated clock
  float ct = cos(uP_tilt);
  float st = sin(uP_tilt);
  vec3 sp = vec3(n.x, n.y * ct - n.z * st, n.y * st + n.z * ct);
  float cr = cos(uP_spin);
  float sr = sin(uP_spin);
  sp = vec3(sp.x * cr - sp.z * sr, sp.y, sp.x * sr + sp.z * cr);

  /*
    Radius becomes the polar angle from the dome's axis (see the header),
    so ring i lands on the latitude at angle i / uP_scale and the rings
    crowd toward the limb the way a globe's latitudes do. acos is defined
    on the whole sphere, so the roll above can put the axis anywhere —
    including behind the visible face, which sweeps the outer rings into
    view over the limb.
  */
  float pol = acos(clamp(sp.z, -1.0, 1.0));
  vec2 dir = sp.xy / max(length(sp.xy), 1e-4);
  vec2 p = dir * pol * uP_scale;

  vec3 acc = vec3(0.0);

  for (int ri = 0; ri < RINGS; ri++) {
    float i = float(ri) + 1.0;

    /*
      Each ring re-warps the ORIGINAL point with its own seed, exactly as
      the listing does — this loop is why the rings tear differently
      instead of nesting like tree rings.
    */
    vec2 v = p;
    for (int j = 0; j < TURB; j++) {
      float f = float(j) + 1.0;
      v += irisWarp * sin(ceil(v * f + i * uP_seed) - t * 0.5) / f;
    }

    float l = length(v) - i;

    // the asymmetric absolute value, with the floor doubling as the line
    // width — a wider floor is a fatter, softer wavefront
    float side = max(max(l, -uP_inner * l), uP_lineSoft);

    /*
      The hue sweep, softened. l/(l*l+g) tracks 1/l off the ring and rolls
      over to a finite peak on it, so the rainbow compresses into a fringe
      of finite width instead of an aliased band.
    */
    float fr = irisFringe * l / (l * l + uP_fringeSoft);
    vec3 hue = cos(t - i * uP_ringPhase + fr + vec3(0.0, 1.0, 2.0)) + 1.1;

    acc += (irisGlow / side) * hue;
  }

  // the listing's tanh knee, with the divisor exposed
  vec3 col = tanh3(acc / max(uP_exposure, 0.001));
  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));

  // saturation about luminance, then the tint
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);
  col *= uC_tint;

  // dome shading keeps the ball a ball under the rings — gentler than the
  // sibling orbs use, because these rings are emission and a hard lambert
  // reads as a shadow thrown across a light source
  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.72))), 0.0, 1.0);
  col *= 0.55 + uP_light * lambert;

  float fres = 1.0 - z;
  fres = fres * fres * fres;
  col += uC_sheen * uP_rim * fres;

  return col;
}

void main() {
  // Volume coupling: the user's voice tears the rings harder, the agent's
  // brightens them and opens the rainbow fringe.
  irisWarp = uP_warp * (1.0 + 0.5 * uInput);
  irisGlow = uP_glow * (0.85 + 0.5 * uOutput);
  irisFringe = uP_fringe * (1.0 + 0.6 * uOutput);

  vec2 uv = orbUV();
  float mask = smoothstep(0.012, -0.012, length(uv) - max(uP_radius, 0.001));

  // Ninety sines per sample before supersampling — none of them worth
  // paying for outside the silhouette.
  if (mask <= 0.0) {
    fragColor = vec4(0.0);
    return;
  }

  vec3 col = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 off = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;
      col += irisRender((vUv * uRes) + off);
    }
  }
  col /= float(AA * AA);
#else
  col = irisRender((vUv * uRes));
#endif

  // Surface orb bounded by a mask: alpha IS coverage, so premultiply — the
  // opposite convention from the emissive orbs (see shdr-31).
  float a = mask;
  fragColor = vec4(max(col, vec3(0.0)) * a, a);
}
`;

/*
 * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's
 * permission. Non-commercial use only, with attribution to XorDev; keep this
 * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.
 */
// shdr-10
const shdr10 = `#version 300 es
${helpers}
uniform float uP_speed;
uniform float uP_scroll;
uniform float uP_camDist;
uniform float uP_focal;
uniform float uP_shellR;
uniform float uP_wrap;
uniform float uP_climb;
uniform float uP_turb;
uniform float uP_layer;
uniform float uP_cell;
uniform float uP_stepScale;
uniform float uP_hueStep;
uniform float uP_spread;
uniform float uP_envRadius;
uniform float uP_envCore;
uniform float uP_fill;
uniform float uP_stepClamp;
uniform float uP_scatter;
uniform float uP_exposure;
uniform float uP_contrast;
uniform float uP_saturation;
uniform float uP_alphaGain;
uniform float uP_edge;
uniform float uP_edgeFade;
uniform vec3 uC_tint;

#define STEPS 40
#define TURB 6
#define AA 1

// Volume-reactive values, resolved once per fragment in main().
float weaveTurb;
float weaveCell;
float weaveExposure;

vec3 weaveRender(vec2 fragCoord) {
  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  vec3 ro = vec3(0.0, 0.0, uP_camDist);
  vec3 rd = normalize(vec3(uv, -uP_focal));

  float animTime = uP_speed;  // integrated clock: the warp
  float scroll = uP_scroll;   // integrated clock: the skin climbs

  vec3 acc = vec3(0.0);

  // transmittance carried front-to-back — the near skin veils the far one
  float T = 1.0;

  // march only the span the envelope can light, as in shdr-01
  float z = max(uP_camDist - uP_envRadius * 1.3, 0.0);
  float zEnd = uP_camDist + uP_envRadius * 1.3;

  for (int it = 0; it < STEPS; it++) {
    float fi = float(it) + 1.0;
    vec3 world = ro + rd * z;

    /*
      The unwrap, with the listing's cylinder swapped for the ball: angle
      about the axis, height, and distance from the CENTRE less the shell
      radius. uP_wrap wants to stay a whole number — see the header.
    */
    float rl = length(world);
    vec3 p = vec3(
      atan(world.z, world.x) * uP_wrap,
      world.y * uP_climb + scroll,
      rl - uP_shellR
    );

    // six octaves of feedback warp, each march step on its own phase
    for (int j = 0; j < TURB; j++) {
      float dj = float(j) + 1.0;
      p += weaveTurb * sin(p.yzx * dj + animTime + uP_layer * fi) / dj;
    }

    /*
      The lattice. Small only where all three cosines sit at one and the
      sample is on the shell — so the cells of a 3D lattice in unwrapped
      space are cut by the ball's surface, and what is left is a knitted
      skin. uP_cell is the listing's .3: the amplitude of the cosine terms
      against the shell term, and therefore how much the lattice matters
      relative to simply being on the surface.
    */
    float d = uP_stepScale * length(vec4(weaveCell * cos(p) - weaveCell, p.z));
    d = max(d, uP_envRadius * 0.004);

    // colour by unwrapped height, with each step offset again
    vec3 w = cos(p.y + fi * uP_hueStep + vec3(6.0, 1.0, 2.0) * uP_spread) + 1.0;
    w /= d;
    w = min(w, vec3(uP_stepClamp));

    // envelope: plateau through the ball, cut 12% past the radius so the
    // analytic silhouette in main() still has emission left to cut
    float env = smoothstep(uP_envRadius * 1.12, uP_envRadius * uP_envCore, rl);
    w = (w + uP_fill) * env;

    acc += T * w;
    T *= exp(-dot(w, vec3(0.299, 0.587, 0.114)) * uP_scatter);

    z += d;
    if (T < 0.004 || z > zEnd) break;
  }

  return acc;
}

void main() {
  weaveTurb = uP_turb * (1.0 + 0.4 * uInput);
  weaveCell = uP_cell * (1.0 + 0.3 * uInput);
  weaveExposure = uP_exposure * (1.0 - 0.3 * uOutput);

  vec3 acc = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 offset = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;
      acc += weaveRender((vUv * uRes) + offset);
    }
  }
  acc /= float(AA * AA);
#else
  acc = weaveRender((vUv * uRes));
#endif

  /*
    The listing's knee is tanh(o*o/6e3) over an unnormalized sum of forty
    steps. Dividing by the step count first pulls the square's scale down
    by forty squared, so the same knee lands near four — a number that fits
    on a slider. The square is a contrast squarer, not a tone map.
  */
  vec3 v = acc / float(STEPS);
  vec3 col = tanh3(v * v / max(weaveExposure, 0.0001));
  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));

  // saturation about luminance, then the tint
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);
  col *= uC_tint;

  // alpha from the brightest channel, not luminance — a deep blue thread
  // has low luminance but must not go transparent
  float peak = max(col.r, max(col.g, col.b));
  float a = clamp(peak * uP_alphaGain, 0.0, 1.0);

  // Analytic silhouette — identical construction to shdr-01: exact
  // ray-to-centre distance against the radius, colour AND alpha.
  vec3 mrd = normalize(vec3(orbUV(), -uP_focal));
  float closest = length(cross(vec3(0.0, 0.0, uP_camDist), mrd));
  float band = mix(0.35, 0.012, clamp(uP_edge, 0.0, 1.0));
  float mask = 1.0 - smoothstep(uP_envRadius * (1.0 - band), uP_envRadius * 1.005, closest);
  col *= mask;
  a *= mask;

  // safety taper at the frame boundary — colour as well as alpha
  float r2d = length(orbUV());
  float fade = 1.0 - smoothstep(uP_edgeFade, 1.0, r2d);
  col *= fade;
  a *= fade;

  // Emitted light, so rgb is already premultiplied — do NOT scale by alpha
  // again (see the same note in shdr-31).
  fragColor = vec4(col, a);
}
`;

// Original Orbkit shader by zzzzshawn. MIT, see licenses/Orbkit.txt.
// shdr-11
const shdr11 = `#version 300 es
${helpers}
uniform float uP_speed;
uniform float uP_rotSpeed;
uniform float uP_radius;
uniform float uP_swell;
uniform float uP_posScale;
uniform float uP_flowSpeed;
uniform float uP_flowAmp;
uniform float uP_flowScale;
uniform float uP_precess;
uniform float uP_radialPow;
uniform float uP_radialDecay;
uniform float uP_probPow;
uniform float uP_probGain;
uniform float uP_waveFreq;
uniform float uP_chromaSpread;
uniform float uP_glow;
uniform float uP_metalDark;
uniform float uP_baseVis;

const float PI = 3.14159265359;
void main() {
  vec2 uv = orbUV();
  float r2d = length(uv);
  float R = uP_radius + uP_swell * uInput;
  float mask = smoothstep(0.012, -0.012, r2d - R);
  float nr = clamp(r2d / max(R, 0.001), 0.0, 1.0);
  float z = sqrt(max(1.0 - nr * nr, 0.0));

  // uP_speed and uP_flowSpeed arrive pre-integrated as clocks (see
  // OrbParamDef.integrate), so state transitions stay phase-continuous.
  // The state volumes reshape the orbital itself: the params set the base,
  // input/output excitement bends zoom, radial form, probability and chroma,
  // so each state settles into a different interference pattern.
  float posScale = uP_posScale * (0.8 + 0.45 * uOutput + 0.2 * uInput);
  float radialPow = uP_radialPow * (0.7 + 0.8 * uOutput);
  float radialDecay = uP_radialDecay * (1.25 - 0.5 * uOutput);
  float probPow = uP_probPow * (1.3 - 0.55 * uOutput);
  float probGain = uP_probGain * (0.7 + 0.6 * uOutput + 0.5 * uInput);
  float waveFreq = uP_waveFreq * (0.6 + 1.0 * uOutput);
  float chromaSpread = uP_chromaSpread * (0.6 + 0.9 * uOutput + 0.5 * uInput);

  // dome point rotated around Y — the fake 3D of the flat disc
  float animTime = uP_speed; // integrated clock
  float cosT = cos(animTime * uP_rotSpeed);
  float sinT = sin(animTime * uP_rotSpeed);
  vec3 sp = vec3(uv / max(R, 0.001), z) * posScale;
  vec3 pos = vec3(sp.x * cosT - sp.z * sinT, sp.y, sp.x * sinT + sp.z * cosT);

  // precession: the rotation axis itself drifts, so the pattern never
  // settles into a repeating spin
  float tilt = sin(animTime * 0.21 + 1.7) * uP_precess;
  float cx = cos(tilt), sx = sin(tilt);
  pos = vec3(pos.x, pos.y * cx - pos.z * sx, pos.y * sx + pos.z * cx);

  // liquid flow: drifting fbm warps the 3D domain, so the wave function
  // smears and migrates around the sphere instead of wobbling in place.
  // (sampled on pos components — continuous everywhere, no phi seam)
  float flowT = uP_flowSpeed; // integrated clock
  float fAmp = uP_flowAmp * (0.7 + 0.6 * uOutput + 0.4 * uInput);
  vec3 w;
  w.x = fbm(pos.yz * uP_flowScale + vec2(flowT * 0.70, -flowT * 0.40));
  w.y = fbm(pos.zx * uP_flowScale + vec2(-flowT * 0.55, flowT * 0.62) + 3.7);
  w.z = fbm(pos.xy * uP_flowScale + vec2(flowT * 0.50, flowT * 0.85) + 7.1);
  pos += (w - 0.5) * fAmp;

  float r = length(pos) + 0.001;
  float theta = acos(clamp(pos.y / r, -1.0, 1.0));
  float phi = atan(pos.z, pos.x);

  float a0 = 0.5;
  float rho = 2.0 * r / (5.0 * a0);
  float radial = pow(rho, radialPow) * exp(-rho / radialDecay);
  float angular = pow(sin(theta), 3.0) * cos(phi + animTime * 0.2); // single lobe

  float psi = radial * angular;
  float probability = psi * psi;

  // travelling spiral wave — the modulation moves across the surface instead
  // of pulsing in place. The azimuthal harmonic count must be a whole number,
  // else sin(phi * f) doesn't line up across the +/-PI wrap and leaves a
  // vertical meridian seam. Snap it to the nearest integer.
  float waveN = max(1.0, floor(waveFreq + 0.5));
  float wavePhase = phi * waveN + theta * 2.5 - animTime * 2.0;
  probability *= (0.85 + 0.15 * sin(wavePhase));

  // drifting bright patches, like convection cells wandering the surface
  float patches = fbm(pos.xy * 1.6 + vec2(flowT * 0.4, -flowT * 0.3));
  probability *= 0.65 + 0.7 * patches;

  probability = pow(probability, probPow) * probGain;
  probability = clamp(probability, 0.0, 1.0);

  float fresnel = pow(1.0 - z, 1.5);

  // rainbow chromatic aberration
  float chromaOffset = phi * 2.0 + theta * 1.5 + animTime * 0.3 + probability * 3.0;
  vec3 rainbow;
  rainbow.r = sin(chromaOffset) * 0.5 + 0.5;
  rainbow.g = sin(chromaOffset + chromaSpread) * 0.5 + 0.5;
  rainbow.b = sin(chromaOffset + chromaSpread * 2.0) * 0.5 + 0.5;
  rainbow = normalize(rainbow + 0.01) * length(rainbow);

  float bandFreq = chromaOffset * 3.0 + fresnel * 2.4;
  vec3 chromaticBands;
  chromaticBands.r = sin(bandFreq) * 0.5 + 0.5;
  chromaticBands.g = sin(bandFreq + 2.094) * 0.5 + 0.5;
  chromaticBands.b = sin(bandFreq + 4.189) * 0.5 + 0.5;

  vec3 glowColor = mix(rainbow, chromaticBands, 0.12);
  glowColor = pow(glowColor, vec3(0.8));

  vec3 darkMetal = vec3(uP_metalDark);
  vec3 lightMetal = mix(vec3(0.9, 0.92, 0.95), glowColor, 0.7);

  float metalGradient = smoothstep(0.0, 1.0, probability * 0.7 + fresnel * 0.3);
  vec3 metalColor = mix(darkMetal, lightMetal, metalGradient);

  float orbGlow = uP_glow + 0.6 * uOutput;
  float totalGlow = (0.25 + fresnel * 0.6 + probability * 0.8) * orbGlow;
  float glowAmount = clamp(pow(totalGlow, 0.7), 0.0, 1.0);

  vec3 surfaceColor = mix(metalColor, glowColor, glowAmount);

  vec3 normal = vec3(uv / max(R, 0.001), z);
  float specular = pow(max(dot(normal, normalize(vec3(1.0, 1.0, 2.0))), 0.0), 32.0);
  surfaceColor += mix(vec3(1.0), glowColor, 0.6) * specular * 0.4;

  float visibility = clamp(probability * 1.2 + fresnel * 0.3 + uP_baseVis + uInput * 0.15, 0.0, 1.0);

  float a = mask * visibility;
  fragColor = vec4(surfaceColor * a, a);
}
`;

// Original Orbkit shader by zzzzshawn. MIT, see licenses/Orbkit.txt.
// shdr-12
const shdr12 = `#version 300 es
${helpers}
uniform float uP_spin;
uniform float uP_tilt;
uniform float uP_rebuild;
uniform float uP_gap;
uniform float uP_studs;
uniform float uP_radius;
uniform float uP_patch;
uniform float uP_stud;
uniform float uP_seam;
uniform float uP_gloss;
uniform float uP_light;
uniform float uP_gain;
uniform float uP_contrast;
uniform vec3 uC_brickA;
uniform vec3 uC_brickB;
uniform vec3 uC_brickC;
uniform vec3 uC_brickD;
uniform vec3 uC_brickE;

#define STEPS 96

// Per-fragment constants, resolved once in main().
vec3 lgCell;  // cell sizes: (stud pitch, brick height, stud pitch)
float lgGap;

// Brick-lookup results (GLSL ES 1.0 has no out-struct ergonomics).
vec3 lgBid;     // unique id of the owning brick
float lgOff;    // long-axis stagger offset of its course, in studs
float lgOrient; // 0: long axis runs along x, 1: along z

mat2 lgRot(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

/*
  Which 2x4 brick owns this stud cell? Layers alternate their long axis
  and every (layer, row) course staggers by a hashed offset — brickwork
  bonding, so vertical seams never stack.
*/
void lgBrick(vec3 cellIdx) {
  lgOrient = mod(cellIdx.y, 2.0);
  float lc = lgOrient < 0.5 ? cellIdx.x : cellIdx.z;
  float sc = lgOrient < 0.5 ? cellIdx.z : cellIdx.x;
  float srow = floor(sc / 2.0);
  lgOff = floor(hash(vec2(cellIdx.y * 3.17, srow * 7.31)) * 4.0);
  lgBid = vec3(floor((lc + lgOff) / 4.0), cellIdx.y, srow + lgOrient * 913.0);
}

/*
  The world function: inside the ball, minus bricks currently blinked out
  of the outer two courses. Interior cells answer with a single length —
  the brick lookup only runs in the shell.
*/
float lgSolid(vec3 cc) {
  float r = length(cc);
  if (r >= 1.0) return 0.0;
  if (r > 1.0 - 2.2 * lgCell.y) {
    lgBrick(floor(cc / lgCell));
    float blink = fract(hash(lgBid.xy * 0.173 + lgBid.z * 0.089) + uP_rebuild * 0.03);
    if (blink < lgGap) return 0.0; // this brick is off the build right now
  }
  return 1.0;
}

void main() {
  // Volume coupling: agent output stokes the sheen and the gain; user
  // input brightens the key light.
  float glossNow = uP_gloss * (0.7 + 0.9 * uOutput);
  float gainNow = uP_gain * (0.92 + 0.25 * uOutput);
  float lightNow = uP_light * (1.0 + 0.3 * uInput);

  float pitch = 2.0 / clamp(uP_studs, 8.0, 48.0);
  lgCell = vec3(pitch, pitch * 1.2, pitch); // real brick proportion
  lgGap = clamp(uP_gap, 0.0, 0.9);

  float bound = 1.0 + length(lgCell) * 0.5 + 0.001;

  vec2 uv = orbUV() / uP_radius;
  vec3 ro = vec3(uv * bound, 2.6);
  vec3 rd = vec3(0.0, 0.0, -1.0);

  // rotate the RAY into object space (inverse tumble) — the lattice stays
  // axis-aligned and the studs stay up while the ball turns. Light and
  // view rotate along, keeping the sun fixed relative to the viewer.
  mat2 tiltM = lgRot(uP_tilt); // positive tilt looks DOWN at the studs
  mat2 spinM = lgRot(-uP_spin); // integrated clock
  ro.yz = tiltM * ro.yz;
  ro.xz = spinM * ro.xz;
  rd.yz = tiltM * rd.yz;
  rd.xz = spinM * rd.xz;
  vec3 Lo = normalize(vec3(-0.5, 0.7, 0.55));
  Lo.yz = tiltM * Lo.yz;
  Lo.xz = spinM * Lo.xz;
  vec3 Vo = vec3(0.0, 0.0, 1.0);
  Vo.yz = tiltM * Vo.yz;
  Vo.xz = spinM * Vo.xz;

  // DDA needs nonzero direction components — nudge, keep the sign
  vec3 sgn = vec3(
    rd.x >= 0.0 ? 1.0 : -1.0,
    rd.y >= 0.0 ? 1.0 : -1.0,
    rd.z >= 0.0 ? 1.0 : -1.0
  );
  rd = normalize(sgn * max(abs(rd), vec3(1.0e-4)));

  // analytic bounding sphere: empty pixels exit here
  float b = dot(rd, ro);
  float c = dot(ro, ro) - bound * bound;
  float disc = b * b - c;
  if (disc < 0.0) {
    fragColor = vec4(0.0);
    return;
  }
  float sq = sqrt(disc);
  vec3 p0 = ro + rd * (-b - sq + pitch * 0.001);
  float tSpan = 2.0 * sq;

  // Amanatides & Woo, anisotropic cells: per-axis sizes throughout
  vec3 vp = floor(p0 / lgCell);
  vec3 tDelta = lgCell / abs(rd);
  vec3 tMax = ((vp + step(vec3(0.0), rd)) * lgCell - p0) / rd;

  float hitF = 0.0;
  vec3 mask = vec3(0.0, 0.0, 1.0); // first-voxel fallback: face the viewer
  float tCur = 0.0;

  for (int i = 0; i < STEPS; i++) {
    if (lgSolid((vp + 0.5) * lgCell) > 0.5) {
      hitF = 1.0;
      break;
    }
    if (tMax.x < tMax.y && tMax.x < tMax.z) {
      tCur = tMax.x;
      tMax.x += tDelta.x;
      vp.x += sgn.x;
      mask = vec3(1.0, 0.0, 0.0);
    } else if (tMax.y < tMax.z) {
      tCur = tMax.y;
      tMax.y += tDelta.y;
      vp.y += sgn.y;
      mask = vec3(0.0, 1.0, 0.0);
    } else {
      tCur = tMax.z;
      tMax.z += tDelta.z;
      vp.z += sgn.z;
      mask = vec3(0.0, 0.0, 1.0);
    }
    if (tCur > tSpan) break; // left the bound: miss
  }

  if (hitF < 0.5) {
    fragColor = vec4(0.0);
    return;
  }

  // the hit cell, its brick, and the struck face
  vec3 cc = (vp + 0.5) * lgCell;
  float r = length(cc);
  vec3 dir = cc / max(r, 1.0e-4);
  lgBrick(vp);
  vec3 n = -mask * sgn;
  vec3 hp = p0 + rd * tCur;

  /*
    Brick colour: a per-brick hash picks one of the five plastic colours.
    The patch parameter slides the pick toward a smooth field over the
    sphere, so 0 is per-brick confetti and 1 is big moulded colour
    regions; the field is range-stretched so all five colours appear.
  */
  float cph = hash(lgBid.xy * 1.37 + lgBid.z * 0.91);
  float rn = noise(dir.xy * 2.6 + 7.0) * 0.5 + noise(dir.yz * 2.6 + 13.0) * 0.5;
  rn = clamp(0.5 + (rn - 0.5) * 2.2, 0.0, 0.999);
  float idx = floor(clamp(mix(cph, rn, clamp(uP_patch, 0.0, 1.0)), 0.0, 0.999) * 5.0);
  vec3 albedo = idx < 0.5 ? uC_brickA
    : (idx < 1.5 ? uC_brickB
    : (idx < 2.5 ? uC_brickC
    : (idx < 3.5 ? uC_brickD : uC_brickE)));
  albedo *= 0.93 + 0.14 * hash(lgBid.xy * 0.53 + lgBid.z * 1.7); // mold variance

  /*
    Seams: distance to the nearest BRICK boundary along each lattice axis,
    from the continuous within-brick coordinates. Only the two axes
    tangent to the struck face draw — stud grid lines never do.
  */
  vec3 sp = hp / lgCell;
  float lcC = lgOrient < 0.5 ? sp.x : sp.z;
  float scC = lgOrient < 0.5 ? sp.z : sp.x;
  float u4 = fract((lcC + lgOff) / 4.0);
  float v2 = fract(scC / 2.0);
  float wY = fract(sp.y);
  float dL = min(u4, 1.0 - u4) * 4.0 * pitch;
  float dS = min(v2, 1.0 - v2) * 2.0 * pitch;
  float dY = min(wY, 1.0 - wY) * lgCell.y;
  float seamD;
  if (mask.y > 0.5) seamD = min(dL, dS);
  else if (mask.x > 0.5) seamD = min(dY, lgOrient < 0.5 ? dS : dL);
  else seamD = min(dY, lgOrient < 0.5 ? dL : dS);
  float seam = (1.0 - smoothstep(0.0, 0.07 * pitch, seamD)) * clamp(uP_seam, 0.0, 1.0);

  /*
    Studs, embossed the way the real brick photographs: the normal tilts
    hard around the stud shoulder so the light wraps it like a cylinder
    edge, the cap lifts, a contact shadow falls on the side facing away
    from the light, and a faint ring engraved into the cap stands in for
    the moulded logo.
  */
  vec3 nEff = n;
  float studF = 0.0;
  float shadowF = 0.0;
  float engrave = 0.0;
  float studAmt = clamp(uP_stud, 0.0, 1.0);
  if (mask.y > 0.5 && n.y > 0.5) {
    vec2 cuv = fract(hp.xz / pitch) - 0.5;
    float sd = length(cuv);
    float rim = smoothstep(0.14, 0.29, sd) * (1.0 - smoothstep(0.29, 0.335, sd));
    vec3 tiltN = normalize(vec3(cuv.x, 0.42, cuv.y));
    nEff = normalize(mix(n, tiltN, rim * studAmt));
    studF = 1.0 - smoothstep(0.285, 0.33, sd);
    vec2 lxz = normalize(Lo.xz + vec2(1.0e-5));
    float away = clamp(dot(normalize(cuv + vec2(1.0e-5)), -lxz), 0.0, 1.0);
    shadowF = smoothstep(0.47, 0.335, sd) * (1.0 - studF) * (0.35 + 0.65 * away);
    engrave = smoothstep(0.11, 0.135, sd) * (1.0 - smoothstep(0.155, 0.18, sd)) * studF;
  }

  // plastic shading: lambert + wrap for roundness + white Blinn sheen,
  // dimmed toward the interior so revealed under-bricks read as inside
  float lam = clamp(dot(nEff, Lo), 0.0, 1.0);
  float wrap = clamp(dot(dir, Lo) * 0.5 + 0.5, 0.0, 1.0);
  float depthDim = mix(1.0, 0.55, clamp((1.0 - r) / (3.0 * lgCell.y), 0.0, 1.0));
  float shade = (0.34 + 0.42 * wrap * wrap + 0.8 * lam * lightNow) * depthDim;

  vec3 col = albedo * shade * (1.0 + 0.1 * studF);
  col *= 1.0 - shadowF * 0.38 * studAmt; // stud contact shadow
  col *= 1.0 - engrave * 0.14 * studAmt; // moulded logo ring

  // chamfered edge: a thin bright bevel line just inside the dark joint,
  // catching the light the way the real brick's edges do
  float bevel = smoothstep(0.05 * pitch, 0.085 * pitch, seamD)
    * (1.0 - smoothstep(0.085 * pitch, 0.16 * pitch, seamD));
  col += albedo * bevel * (0.18 + 0.5 * lam) * clamp(uP_seam, 0.0, 1.0);
  col *= 1.0 - seam * 0.8; // dark joints

  // two-lobe plastic sheen: a sharp hotspot over a broad soft gloss
  float ndh = clamp(dot(nEff, normalize(Lo + Vo)), 0.0, 1.0);
  float spec = pow(ndh, 48.0) + 0.22 * pow(ndh, 8.0);
  col += vec3(1.0) * spec * glossNow * (1.0 - seam) * depthDim;

  col *= gainNow;
  col = pow(max(col, 0.0), vec3(uP_contrast));

  // Surface-lit orb bounded by the hit test: alpha IS coverage, and a hit
  // is fully opaque — premultiplied output, trivially (see shdr-28).
  fragColor = vec4(col, 1.0);
}
`;

// Original Orbkit shader by zzzzshawn. MIT, see licenses/Orbkit.txt.
// shdr-13
const shdr13 = `#version 300 es
${helpers}
uniform float uP_speed;
uniform float uP_spin;
uniform float uP_camDist;
uniform float uP_focal;
uniform float uP_envRadius;
uniform float uP_swell;
uniform float uP_tilt;
uniform float uP_fils;
uniform float uP_writhe;
uniform float uP_writheFreq;
uniform float uP_sharp;
uniform float uP_soft;
uniform float uP_whiten;
uniform float uP_coreGain;
uniform float uP_tipGain;
uniform float uP_fill;
uniform float uP_stepClamp;
uniform float uP_scatter;
uniform float uP_exposure;
uniform float uP_contrast;
uniform float uP_saturation;
uniform float uP_alphaGain;
uniform float uP_edge;
uniform vec3 uC_inner;
uniform vec3 uC_arc;
uniform vec3 uC_tint;

#define STEPS 64

// Volume-reactive values, resolved once per fragment in main().
float ionSharp;
float ionWrithe;
float ionCore;
float ionExposure;
float ionRadius;

mat2 ionRot2(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

vec3 ionRender(vec2 fragCoord) {
  float t = uP_speed;      // integrated clock: filament crawl
  float spinAng = uP_spin; // integrated clock: array precession

  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  vec3 ro = vec3(0.0, 0.0, uP_camDist);
  vec3 rd = normalize(vec3(uv, -uP_focal));

  // exact ray/sphere chord — the march never leaves the globe, so no
  // envelope fade is needed and every step length is meaningful
  float proj = dot(-ro, rd);
  float b2 = dot(ro, ro) - proj * proj;
  float half_ = sqrt(max(ionRadius * ionRadius - b2, 0.0));
  float zNear = proj - half_;
  float stepLen = 2.0 * half_ / float(STEPS);
  // per-pixel jitter of the march start: a filament grazed at a shallow
  // angle is crossed periodically by the fixed step grid and renders as a
  // dotted chain — the jitter decorrelates neighbouring rays and melts the
  // dots into plasma grain
  zNear += (hash(fragCoord) - 0.5) * stepLen;

  vec3 acc = vec3(0.0);
  float T = 1.0;

  for (int i = 0; i < STEPS; i++) {
    vec3 p = ro + rd * (zNear + (float(i) + 0.5) * stepLen);

    // precess the whole filament array; a static tilt keeps the spin axis
    // off-vertical so the motion reads in 3D
    vec3 pr = p;
    pr.xz = ionRot2(spinAng) * pr.xz;
    pr.yz = ionRot2(uP_tilt) * pr.yz;

    float r = length(pr);
    vec3 dir = pr / max(r, 1e-4);
    float rr = r / max(ionRadius, 1e-3);

    // writhe: bend the sampling direction with radius and time, rooted at
    // the nucleus by the smoothstep so filaments stay attached
    float wr = ionWrithe * smoothstep(0.0, ionRadius * 0.35, r);
    vec3 q = dir * uP_fils;
    q += wr * vec3(
      sin(r * uP_writheFreq        - t * 1.2 + q.y * 1.8),
      sin(r * uP_writheFreq * 0.83 + t * 1.0 + q.z * 1.8),
      sin(r * uP_writheFreq * 1.19 - t * 0.7 + q.x * 1.8));

    // two independent fields over the direction sphere; their joint zero
    // set is the filament curves. Time enters as additive phase only.
    float f1 = sin(q.x + t * 0.70)
             + sin(q.y * 1.31 - t * 0.50)
             + sin(q.z * 1.13 + t * 0.90);
    float f2 = sin(q.y * 1.21 + t * 0.60 + 1.7)
             + sin(q.z * 1.43 - t * 0.80 + 3.1)
             + sin(q.x * 0.87 + t * 0.40 + 5.0);
    float d2 = f1 * f1 + f2 * f2;
    float g = 1.0 / (d2 * ionSharp + uP_soft);

    // flare where a streamer lands on the glass, and the hot nucleus
    g *= 1.0 + uP_tipGain * smoothstep(0.55, 0.95, rr);
    float core = ionCore / (r * r * 8.0 + 0.05);

    // pink near the nucleus, violet-blue at the glass, cores whitened by
    // their own intensity
    vec3 fCol = mix(uC_inner, uC_arc, smoothstep(0.1, 0.75, rr));
    vec3 w = (fCol + vec3(uP_whiten) * g) * g + uC_inner * core + vec3(uP_fill);
    w = min(w, vec3(uP_stepClamp));
    w *= stepLen; // length-fair: limb chords are short and dim correctly

    acc += T * w;
    T *= exp(-dot(w, vec3(0.299, 0.587, 0.114)) * uP_scatter);
    if (T < 0.004) break;
  }

  return acc;
}

void main() {
  // Louder agent output softens and thickens the arcs and quickens the
  // writhe; user input flares the nucleus — the globe answers being spoken
  // to the way the real toy answers a fingertip.
  ionSharp = uP_sharp * (1.0 - 0.25 * uOutput);
  ionWrithe = uP_writhe * (1.0 + 0.6 * uOutput);
  ionCore = uP_coreGain * (1.0 + 1.6 * uInput + 0.4 * uOutput);
  ionExposure = uP_exposure * (1.0 - 0.35 * uOutput);
  ionRadius = uP_envRadius + uP_swell * uInput;

  vec3 acc = ionRender((vUv * uRes));

  // tanh tone map with a tunable knee, then the usual finishing chain
  vec3 col = tanh3(acc / max(ionExposure, 0.01));
  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));

  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);
  col *= uC_tint;

  // alpha from the brightest channel — a saturated violet streamer has low
  // luminance but must not go transparent
  float peak = max(col.r, max(col.g, col.b));
  float a = clamp(peak * uP_alphaGain, 0.0, 1.0);

  // analytic silhouette, identical construction to shdr-01: exact
  // ray-to-centre distance against the radius, colour AND alpha
  vec3 mrd = normalize(vec3(orbUV(), -uP_focal));
  float closest = length(cross(vec3(0.0, 0.0, uP_camDist), mrd));
  float band = mix(0.35, 0.012, clamp(uP_edge, 0.0, 1.0));
  float mask = 1.0 - smoothstep(ionRadius * (1.0 - band), ionRadius * 1.005, closest);
  col *= mask;
  a *= mask;

  // Emitted light, so rgb is already premultiplied — do NOT scale by alpha
  // again (see the same note in shdr-31).
  fragColor = vec4(col, a);
}
`;

// Original Orbkit shader by zzzzshawn. MIT, see licenses/Orbkit.txt.
// shdr-14
const shdr14 = `#version 300 es
${helpers}
uniform float uP_speed;
uniform float uP_spin;
uniform float uP_radius;
uniform float uP_cells;
uniform float uP_levels;
uniform float uP_scale;
uniform float uP_plasma;
uniform float uP_light;
uniform float uP_rim;
uniform float uP_gain;
uniform float uP_contrast;
uniform vec3 uC_ink;
uniform vec3 uC_paper;

// 2x2 Bayer base: floor/fract only. (0,0)=0, (1,0)=.5, (0,1)=.75, (1,1)=.25
// — the 0,2,3,1 ordering over 4.
float bayer2(vec2 a) {
  a = floor(a);
  return fract(a.x / 2.0 + a.y * a.y * 0.75);
}

// 8x8 by recursion: M8 = M2(a/4)/16 + M2(a/2)/4 + M2(a). No arrays, no
// bitwise — neither exists in GLSL ES 1.0.
float bayer8(vec2 a) {
  return bayer2(a * 0.25) * 0.0625 + bayer2(a * 0.5) * 0.25 + bayer2(a);
}

void main() {
  // Volume coupling: user input deepens the waves, agent output brightens
  // the whole tone ladder — the dot field visibly blooms while it speaks.
  float plasmaAmt = uP_plasma * (1.0 + 0.4 * uInput);
  float gainNow = uP_gain * (0.85 + 0.5 * uOutput);

  /*
    Chunky pixel grid, RESOLUTION-RELATIVE: uP_cells is how many cells span
    the canvas, so a 190px gallery card and a 420px playground orb show the
    same composition — the same wave resolved by the same number of dots.
    Sized in device pixels instead, small canvases collapse to a few dozen
    blotches. All content below samples at the cell centre so every dot is
    one flat square.
  */
  float cellPx = max(min(uRes.x, uRes.y) / max(uP_cells, 8.0), 1.0);
  vec2 pix = floor((vUv * uRes) / cellPx);
  vec2 cellCentre = (pix + 0.5) * cellPx;

  vec2 suv = (2.0 * cellCentre - uRes) / min(uRes.x, uRes.y);
  vec2 uv = suv / uP_radius;
  float r2 = dot(uv, uv);

  // blocky silhouette — cut on the cell grid, deliberately not smoothed
  float mask = 1.0 - step(1.0, r2);

  float z = sqrt(max(1.0 - r2, 0.0));
  vec3 n = vec3(uv, z);

  /*
    The plasma is evaluated in a ROTATING frame: the dome point spins about
    Y on its own integrated clock, so the wavefronts roll around the ball
    instead of sliding across a flat disc. The light stays screen-fixed —
    the form shading holds still while the pattern travels over it.
  */
  float rot = uP_spin; // integrated clock
  float cr = cos(rot);
  float sr = sin(rot);
  vec3 sp = vec3(n.x * cr - n.z * sr, n.y, n.x * sr + n.z * cr);

  float t = uP_speed; // integrated clock

  // the classic demoscene plasma: three interfering sine waves, each on its
  // own direction and rate
  float f = uP_scale;
  float v = sin(sp.x * f * 3.1 + t)
    + sin((sp.y * 0.85 + sp.z * 0.4) * f * 3.6 - t * 1.3)
    + sin((sp.x + sp.y + sp.z) * f * 2.2 + t * 0.7);

  // a ripple source orbiting the dome — expanding rings pushed through the
  // interference; the clock enters only as additive phase
  vec2 src = 0.55 * vec2(cos(t * 0.5), sin(t * 0.5));
  v += sin(length(uv - src) * f * 5.0 - t * 2.2);
  v *= 0.25; // four unit waves back to -1..1

  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0, 1.0);
  float fres = pow(1.0 - z, 2.0);

  // waves modulated by the dome shading, so the ball stays a ball under
  // the rolling pattern; everything collapses into one luminance
  float lum = (0.5 + 0.5 * v * plasmaAmt) * (0.3 + uP_light * lambert)
    + uP_rim * fres;
  lum = pow(clamp(lum * gainNow, 0.0, 1.0), uP_contrast);

  // ordered dither onto the tone ladder — levels 2 is the classic 1-bit
  // look, higher values keep the grain but add mid-tones
  float steps = max(uP_levels - 1.0, 1.0);
  float q = clamp(floor(lum * steps + bayer8(pix)) / steps, 0.0, 1.0);

  vec3 col = mix(uC_ink, uC_paper, q);

  // Surface-lit orb bounded by a mask: alpha IS coverage, so premultiply —
  // the opposite convention from the emissive orbs (see shdr-31).
  float a = mask;
  fragColor = vec4(col * a, a);
}
`;

/*
 * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's
 * permission. Non-commercial use only, with attribution to XorDev; keep this
 * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.
 */
// shdr-15
const shdr15 = `#version 300 es
${helpers}
uniform float uP_speed;
uniform float uP_wander;
uniform float uP_camDist;
uniform float uP_focal;
uniform float uP_fieldScale;
uniform float uP_turb;
uniform float uP_stepScale;
uniform float uP_disperse;
uniform float uP_envRadius;
uniform float uP_envCore;
uniform float uP_fill;
uniform float uP_stepClamp;
uniform float uP_scatter;
uniform float uP_exposure;
uniform float uP_contrast;
uniform float uP_saturation;
uniform float uP_alphaGain;
uniform float uP_edge;
uniform float uP_edgeFade;
uniform vec3 uC_tint;

#define STEPS 10
#define TURB 8
#define AA 1

// Volume-reactive values, resolved once per fragment in main().
float muonsTurb;
float muonsExposure;

vec3 muonsRender(vec2 fragCoord) {
  float animTime = uP_speed; // integrated clock: weave + hue phase
  float wander = uP_wander;  // integrated clock: axis drift

  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  vec3 ro = vec3(0.0, 0.0, uP_camDist);
  vec3 rd = normalize(vec3(uv, -uP_focal));

  /*
    Anchor the micro-slab to the ball: intersect the ray with the shell
    analytically and start the ten steps AT the entry point, so the slab
    hugs the sphere's curve. Rays that miss fall back to their closest
    approach — the envelope and silhouette cut them anyway.
  */
  float proj = dot(-ro, rd);
  float b2 = dot(ro, ro) - proj * proj;
  float R = uP_envRadius * 0.96;
  float entry = proj - sqrt(max(R * R - b2, 0.0));

  vec3 acc = vec3(0.0);
  float T = 1.0;
  float z = entry;
  float s = 0.0;

  for (int it = 0; it < STEPS; it++) {
    vec3 p = ro + rd * z;

    // shell points scaled into field space — the original worked around
    // magnitude 9, and the ring density rides on that magnitude
    vec3 q = p * uP_fieldScale;

    // the per-layer axis, with the original's s feedback — each of the
    // ten layers takes a differently jittered axis
    vec3 axis = normalize(cos(vec3(7.0, 1.0, 0.0) + wander - s));

    // the minus-90-degree Rodrigues twin of shdr-22
    vec3 a = axis * dot(axis, q) - cross(axis, q);

    for (int j = 0; j < TURB; j++) {
      float dj = float(j) + 2.0;
      a += muonsTurb * sin(a * dj + animTime).yzx / dj;
    }

    // the shells: the march sticks where the field magnitude sits on a
    // multiple of pi, and 1/d blows up — that is the web
    s = length(a);
    float d = uP_stepScale * abs(sin(s));
    d = max(d, 1e-5);
    z += d;

    /*
      Layer-cycled palette, with the depth measured from the ENTRY point
      so the banding follows the ball's skin. Clamp then normalize to
      family units, as in shdr-22 — the raw spikes run to 1/1e-5.
    */
    vec3 w = (cos((z - entry) / max(uP_stepScale, 1e-3) + animTime + vec3(0.0, 2.0, 3.0) * uP_disperse) + 1.0)
      / d / max(s, 0.5);
    w = min(w, vec3(uP_stepClamp));
    w *= 20.0 / max(uP_stepClamp, 1.0);

    // envelope: plateau through the ball, cut 12% past the radius so the
    // analytic silhouette in main() still has emission left to cut
    float env = smoothstep(uP_envRadius * 1.12, uP_envRadius * uP_envCore, length(p));
    w = (w + uP_fill) * env;

    acc += T * w;
    T *= exp(-dot(w, vec3(0.299, 0.587, 0.114)) * uP_scatter);

    if (T < 0.004) break;
  }

  return acc;
}

void main() {
  muonsTurb = uP_turb * (1.0 + 0.5 * uInput);
  muonsExposure = uP_exposure * (1.0 - 0.35 * uOutput);

  vec3 acc = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 offset = vec2(float(mx), float(my)) / float(AA) - 0.5;
      acc += muonsRender((vUv * uRes) + offset);
    }
  }
  acc /= float(AA * AA);
#else
  acc = muonsRender((vUv * uRes));
#endif

  // tanh tone map per channel — the golfed /3e3 knee is a tunable here
  vec3 col = tanh3(acc / max(muonsExposure, 1.0));
  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));

  // saturation about luminance, then the tint
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);
  col *= uC_tint;

  // alpha from the brightest channel, not luminance — a saturated violet
  // thread has low luminance but must not go transparent
  float peak = max(col.r, max(col.g, col.b));
  float a = clamp(peak * uP_alphaGain, 0.0, 1.0);

  // Analytic silhouette — identical construction to shdr-01: exact
  // ray-to-centre distance against the radius, colour AND alpha.
  vec3 mrd = normalize(vec3(orbUV(), -uP_focal));
  float closest = length(cross(vec3(0.0, 0.0, uP_camDist), mrd));
  float band = mix(0.35, 0.012, clamp(uP_edge, 0.0, 1.0));
  float mask = 1.0 - smoothstep(uP_envRadius * (1.0 - band), uP_envRadius * 1.005, closest);
  col *= mask;
  a *= mask;

  // safety taper at the frame boundary — colour as well as alpha
  float r2d = length(orbUV());
  float fade = 1.0 - smoothstep(uP_edgeFade, 1.0, r2d);
  col *= fade;
  a *= fade;

  // Emitted light, so rgb is already premultiplied — do NOT scale by alpha
  // again (see the same note in shdr-31).
  fragColor = vec4(col, a);
}
`;

// Original Orbkit shader by zzzzshawn. MIT, see licenses/Orbkit.txt.
// shdr-16
const shdr16 = `#version 300 es
${helpers}
uniform float uP_flow;
uniform float uP_spin;
uniform float uP_swellRate;
uniform float uP_radius;
uniform float uP_scale;
uniform float uP_warp;
uniform float uP_edge;
uniform float uP_split;
uniform float uP_swell;
uniform float uP_gain;
uniform float uP_contrast;
uniform float uP_light;
uniform float uP_rim;
uniform vec3 uC_deep;
uniform vec3 uC_sun;
uniform vec3 uC_sheen;

// Volume- and surge-reactive values, resolved once per fragment in main().
float causticWarp;

/*
  The water. The plane is folded on its own sines three times, each octave
  at a literal frequency and on its own share of the clock, so the ripples
  refract the net rather than scroll it. Amplitude is the one control.
*/
vec2 fold(vec2 p, float t) {
  p += causticWarp        * sin(p.yx * 1.31 + vec2( t * 0.90, -t * 0.70));
  p += causticWarp * 0.60 * sin(p.yx * 2.17 + vec2(-t * 1.30,  t * 1.10));
  p += causticWarp * 0.35 * sin(p.yx * 3.73 + vec2( t * 1.90,  t * 1.60));
  return p;
}

/*
  The light. Two crossed families of crest lines, sharpened by the edge
  exponent — the base is 1 - abs(sin), always in [0, 1], so pow is defined —
  with their product added back so the crossings, where wavefronts focus,
  burn hotter than the lines between them.
*/
float net(vec2 p, float t) {
  vec2 q = fold(p, t);
  vec2 s = 1.0 - abs(sin(q));
  vec2 l = pow(s, vec2(uP_edge));
  // Normalised to [0, 1]: the sum peaks at four on a crossing, and left
  // unbounded it drove the tone knee into clipping all three channels,
  // which turns any sun colour white. Bounded, the sun colour survives
  // the knee at the foci and gain is a real brightness rather than a
  // race to white.
  return (l.x + l.y + 2.0 * l.x * l.y) * 0.25;
}

/*
  Triplanar: the plane field read on the three axis planes of the surface
  direction and blended by the fourth power of each component, so each
  plane only shows where it faces squarely. No pole and no seam — the ball
  can turn forever.
*/
float netOn(vec3 sp, float t) {
  vec3 w = sp * sp;
  w *= w;
  w /= (w.x + w.y + w.z);
  float k = uP_scale;
  return w.x * net(sp.yz * k, t) + w.y * net(sp.zx * k, t) + w.z * net(sp.xy * k, t);
}

void main() {
  vec2 uv = orbUV();
  float rd = length(uv);
  float R = uP_radius;
  float mask = smoothstep(0.012, -0.012, rd - R);
  if (mask <= 0.0) {
    fragColor = vec4(0.0);
    return;
  }

  vec2 pl = uv / R;
  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));
  vec3 n = vec3(pl, z);

  // the ball turns about Y on its own integrated clock
  float cr = cos(uP_spin);
  float sr = sin(uP_spin);
  vec3 sp = vec3(n.x * cr - n.z * sr, n.y, n.x * sr + n.z * cr);

  float t = uP_flow; // integrated clock: the water

  /*
    The surge: a round trip on an integrated clock through cos, so it eases
    through both ends and never wraps. It lifts the gain and deepens the
    ripple together — brighter as the water heaves — and uP_swell is how
    much of that a state takes.

    Volume coupling in the family language: the agent's voice brightens the
    light, the user's deepens the water.
  */
  float surge = 0.5 - 0.5 * cos(uP_swellRate);
  float gainNow = uP_gain * mix(1.0, 0.55 + 0.9 * surge, uP_swell) * (0.8 + 0.5 * uOutput);
  causticWarp = uP_warp * mix(1.0, 0.8 + 0.4 * surge, uP_swell) * (1.0 + 0.35 * uInput);

  /*
    Three moments of the fold, one per channel. The LIGHT is the net's
    luminance under the sun colour, so gold is gold at the foci; the
    per-channel disagreement is split off as a zero-mean residual and added
    back scaled by uP_split, so the rainbow is a fringe that rides on the
    edges where they move and vanishes where they hold — never a tint on
    the whole net. Read once with the offset baked in and once without
    would cost the same three evaluations, so the offset is constant and
    the split is a plain amplitude on the residual: safe to stage.
  */
  float ds = 0.09;
  vec3 c = vec3(netOn(sp, t + ds), netOn(sp, t), netOn(sp, t - ds));
  float cLum = dot(c, vec3(1.0 / 3.0));
  vec3 fringe = (c - cLum) * uP_split;

  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0, 1.0);
  float fres = pow(1.0 - z, 2.5);

  // the floor of the pool, then the light thrown on it — dimmer round the
  // limb, where the floor tilts away from the sun
  vec3 col = uC_deep * (0.35 + 0.65 * uP_light * lambert);
  col += (uC_sun * cLum + fringe) * gainNow * (0.55 + 0.45 * lambert);
  col += uC_sheen * uP_rim * fres;

  col = pow(max(col, vec3(0.0)), vec3(uP_contrast));
  col = tanh3(col);

  // Surface orb bounded by a mask: alpha IS coverage, so premultiply — the
  // opposite convention from the emissive orbs (see shdr-31).
  float a = mask;
  fragColor = vec4(max(col, vec3(0.0)) * a, a);
}
`;

// Original Orbkit shader by zzzzshawn. MIT, see licenses/Orbkit.txt.
// shdr-17
const shdr17 = `#version 300 es
${helpers}
uniform float uP_speed;
uniform float uP_spin;
uniform float uP_radius;
uniform float uP_scale;
uniform float uP_bands;
uniform float uP_shear;
uniform float uP_warp;
uniform float uP_churn;
uniform float uP_gain;
uniform float uP_contrast;
uniform float uP_grain;
uniform float uP_filmGrain;
uniform float uP_grainSize;
uniform float uP_rainbow;
uniform float uP_flashRate;
uniform float uP_flash;
uniform float uP_light;
uniform float uP_rim;
uniform vec3 uC_deep;
uniform vec3 uC_low;
uniform vec3 uC_mid;
uniform vec3 uC_hot;
uniform vec3 uC_flash;

const float PI = 3.14159265359;

// Animated white noise, one tap per grain cell per grain frame. The seed
// decorrelates the two taps so field grain and film grain never line up.
float grainNoise(vec2 gpix, float frame, float seed) {
  return hash(gpix + vec2(frame * 13.71 + seed, frame * 7.37 - seed));
}

void main() {
  // Volume coupling: user input churns the warp harder, agent output
  // brightens the field — the lightning gate opens separately below.
  float warpNow = uP_warp * (1.0 + 0.55 * uInput);
  float gainNow = uP_gain * (0.85 + 0.45 * uOutput);

  vec2 uv = orbUV();
  float rd = length(uv);
  float R = uP_radius;
  float mask = smoothstep(0.012, -0.012, rd - R);

  // The storm below costs five fbm evaluations per fragment — skip all of it
  // outside the silhouette instead of computing weather for transparent sky.
  if (mask <= 0.0) {
    fragColor = vec4(0.0);
    return;
  }

  vec2 pl = uv / R;
  float r2 = dot(pl, pl);
  float z = sqrt(max(1.0 - r2, 0.0));
  vec3 n = vec3(pl, z);

  // roll the dome about Y on its own integrated clock
  float cr = cos(uP_spin);
  float sr = sin(uP_spin);
  vec3 sp = vec3(n.x * cr - n.z * sr, n.y, n.x * sr + n.z * cr);

  float t = uP_speed; // integrated clock

  // stereographic wrap: the weather travels around the ball and compresses
  // toward the limb instead of sliding across a flat disc
  vec2 st = sp.xy / (1.3 + sp.z) * uP_scale;

  /*
    Jovian band flow: a uniform stream plus a BOUNDED traveling wave of
    shear, so latitude rings appear to slip past each other. The obvious
    construction — t * sin(latitude) — accumulates the differential forever
    and rakes the field into hairline streaks within seconds of the random
    mount phase; the wave form keeps the shear amplitude fixed while its
    phase travels. sp.y is untouched by the Y-roll, so the bands hold
    horizontal while the dome turns underneath them.
  */
  st.x -= t * 0.3;
  st.x += uP_shear * sin(sp.y * uP_bands - t * 0.45);

  // two-level domain warp, the storm-cloud construction: q says where to
  // look, w says where q said to look, the field reads there
  vec2 q = vec2(
    fbm(st + vec2(0.0, t * 0.35)),
    fbm(st + vec2(5.2, 1.3) - vec2(t * 0.28, 0.0))
  );
  vec2 w = vec2(
    fbm(st + warpNow * q + vec2(1.7, 9.2) + vec2(t * 0.12, 0.0)),
    fbm(st + warpNow * q + vec2(8.3, 2.8) - vec2(0.0, t * 0.1))
  );
  float f = fbm(st + uP_churn * w);

  /*
    Grain tap 1: speckle folded into the FIELD itself, before the gradient,
    so the colour stops below dither into grain instead of smooth bands.
    Refreshed on the ambient clock — the flicker rate stays constant across
    states on purpose (see the header note).
  */
  vec2 gpix = floor((vUv * uRes) / max(uP_grainSize, 1.0));
  float frame = floor(uTime * 48.0);
  float g1 = grainNoise(gpix, frame, 3.1);
  f += (g1 - 0.5) * uP_grain;

  f = pow(clamp(f * gainNow, 0.0, 1.0), uP_contrast);

  // four-stop palette climbing the storm field
  vec3 col = mix(uC_deep, uC_low, smoothstep(0.05, 0.35, f));
  col = mix(col, uC_mid, smoothstep(0.35, 0.62, f));
  col = mix(col, uC_hot, smoothstep(0.62, 0.88, f));

  // iridescent shimmer: a cosine rainbow keyed to the field AND to the warp
  // vector — q varies at storm-cell scale, so the rainbow lands as coherent
  // coloured weather cells instead of hue noise that optically averages to
  // grey — multiplied in so it bends hues without erasing the palette
  vec3 shimmer = 0.5 + 0.5 * cos(2.0 * PI * (f * 0.9 + q.x * 1.1 + t * 0.06 + vec3(0.0, 0.33, 0.67)));
  col = mix(col, col * (0.35 + 1.9 * shimmer), uP_rainbow);

  /*
    Lightning: one hashed gate per flash interval with an exponential decay,
    so most intervals stay dark and some strike. Agent output opens the gate
    — an idle orb flickers occasionally, a speaking one strobes. The strike
    lands hardest on the high-pressure cells of the field.
  */
  float ft = t * uP_flashRate;
  float gate = step(1.0 - (0.1 + 0.5 * uOutput), hash(vec2(floor(ft), 7.7)));
  float flashEnv = gate * exp(-fract(ft) * 6.0);
  // squared so the strike stays inside the storm cells — a linear weight
  // tints the whole ball and reads as the canvas strobing, not as weather
  float high = smoothstep(0.55, 0.95, f);
  col += uC_flash * (flashEnv * uP_flash) * (0.06 + 0.94 * high * high);

  // dome shading keeps the ball a ball under the weather
  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0, 1.0);
  col *= 0.35 + uP_light * lambert;
  float fres = pow(1.0 - z, 2.5);
  col += uC_flash * uP_rim * fres * (0.4 + 0.35 * flashEnv);

  // grain tap 2: plain film grain over the final colour
  float g2 = grainNoise(gpix, frame, 27.9);
  col *= 1.0 + (g2 - 0.5) * uP_filmGrain;

  // Surface orb bounded by a mask: alpha IS coverage, so premultiply — the
  // opposite convention from the emissive orbs (see shdr-31).
  float a = mask;
  fragColor = vec4(max(col, vec3(0.0)) * a, a);
}
`;

/*
 * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's
 * permission. Non-commercial use only, with attribution to XorDev; keep this
 * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.
 */
// shdr-18
const shdr18 = `#version 300 es
${helpers}
uniform float uP_wander;
uniform float uP_camDist;
uniform float uP_focal;
uniform float uP_fold;
uniform float uP_crease;
uniform float uP_freq;
uniform float uP_stepScale;
uniform float uP_hue;
uniform float uP_spread;
uniform float uP_envRadius;
uniform float uP_envCore;
uniform float uP_fill;
uniform float uP_stepClamp;
uniform float uP_scatter;
uniform float uP_exposure;
uniform float uP_contrast;
uniform float uP_saturation;
uniform float uP_alphaGain;
uniform float uP_edge;
uniform float uP_edgeFade;
uniform vec3 uC_tint;

#define STEPS 50
#define AA 1

// Volume-reactive values, resolved once per fragment in main().
float octantFold;
float octantFreq;
float octantExposure;

vec3 octantRender(vec2 fragCoord) {
  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  vec3 ro = vec3(0.0, 0.0, uP_camDist);
  vec3 rd = normalize(vec3(uv, -uP_focal));

  float wander = uP_wander; // integrated clock: the axis, and with it the
                            // mirror planes, tumble

  /*
    The wandering axis. Unit by construction, which is what makes the
    rotation below an exact one — and the three phases are far enough
    apart that the cosines can never null together, so the normalize is
    safe without a guard.
  */
  vec3 axis = normalize(cos(wander + vec3(0.0, 2.0, 4.0)));

  vec3 acc = vec3(0.0);

  // transmittance carried front-to-back — near cells veil far ones
  float T = 1.0;

  // march only the span the envelope can light, as in shdr-01
  float z = max(uP_camDist - uP_envRadius * 1.3, 0.0);
  float zEnd = uP_camDist + uP_envRadius * 1.3;

  for (int it = 0; it < STEPS; it++) {
    vec3 p = ro + rd * z;

    // the exact minus-90-degree rotation about the wandering axis
    vec3 a = dot(axis, p) * axis - cross(axis, p);

    /*
      The two folds, both blendable. uP_fold reflects the octants together
      and uP_crease creases the diagonals; at zero the crystal dissolves
      back into an ordinary periodic field, which is worth being able to
      see, because the symmetry is doing more work here than the field is.
    */
    a = mix(a, abs(a), octantFold);
    a = mix(a, max(a, a.yzx), uP_crease);

    // step and density in one quantity, as in the listing
    float d = uP_stepScale * length(cos(a * octantFreq));
    d = max(d, uP_envRadius * 0.004);

    /*
      Depth as hue, near as bright.

      The hue is keyed to depth measured from where the envelope BEGINS,
      not from the camera. The listing marches from the lens out to twenty
      units and cycles its ramp several times over that; bounded to the
      ball, the same .2 slope covers barely a quarter turn of the wheel —
      and the quarter it covers has both green and blue sitting at the
      bottom of their cosines, so the first build of this orb came out a
      flat dark red. Anchored to the ball, the ramp spans it, and moving
      the camera no longer repaints the crystal.

      No step-length weighting here, unlike orb-nova and against the
      README's usual rule — because 1/d IS this shader's density, not an
      artefact of sphere tracing. Multiply it by the step and the two
      cancel exactly, leaving a flat sum with every trace of the cell walls
      gone. The clamp does the job the step weight would have, which is
      also what shdr-22 does with the same construction.
    */
    float zRel = z - (uP_camDist - uP_envRadius);
    vec3 w = cos(uP_hue * zRel + vec3(0.0, 2.0, 3.0) * uP_spread) + 1.0;
    w /= d * max(z, 0.05);
    w = min(w, vec3(uP_stepClamp));

    // envelope: plateau through the ball, cut 12% past the radius so the
    // analytic silhouette in main() still has emission left to cut
    float env = smoothstep(uP_envRadius * 1.12, uP_envRadius * uP_envCore, length(p));
    w = (w + uP_fill) * env;

    acc += T * w;
    T *= exp(-dot(w, vec3(0.299, 0.587, 0.114)) * uP_scatter);

    z += d;
    if (T < 0.004 || z > zEnd) break;
  }

  return acc;
}

void main() {
  octantFold = clamp(uP_fold * (1.0 + 0.3 * uInput), 0.0, 1.0);
  octantFreq = uP_freq * (1.0 + 0.25 * uInput);
  octantExposure = uP_exposure * (1.0 - 0.35 * uOutput);

  vec3 acc = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 offset = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;
      acc += octantRender((vUv * uRes) + offset);
    }
  }
  acc /= float(AA * AA);
#else
  acc = octantRender((vUv * uRes));
#endif

  // tanh tone map per channel — the envelope and transmittance change the
  // accumulator's scale, so the golfed /1e2 knee is a tunable here
  vec3 col = tanh3(acc / max(octantExposure, 0.01));
  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));

  // saturation about luminance, then the tint
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);
  col *= uC_tint;

  // alpha from the brightest channel, not luminance — a deep blue cell
  // has low luminance but must not go transparent
  float peak = max(col.r, max(col.g, col.b));
  float a = clamp(peak * uP_alphaGain, 0.0, 1.0);

  // Analytic silhouette — identical construction to shdr-01: exact
  // ray-to-centre distance against the radius, colour AND alpha.
  vec3 mrd = normalize(vec3(orbUV(), -uP_focal));
  float closest = length(cross(vec3(0.0, 0.0, uP_camDist), mrd));
  float band = mix(0.35, 0.012, clamp(uP_edge, 0.0, 1.0));
  float mask = 1.0 - smoothstep(uP_envRadius * (1.0 - band), uP_envRadius * 1.005, closest);
  col *= mask;
  a *= mask;

  // safety taper at the frame boundary — colour as well as alpha
  float r2d = length(orbUV());
  float fade = 1.0 - smoothstep(uP_edgeFade, 1.0, r2d);
  col *= fade;
  a *= fade;

  // Emitted light, so rgb is already premultiplied — do NOT scale by alpha
  // again (see the same note in shdr-31).
  fragColor = vec4(col, a);
}
`;

/*
 * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's
 * permission. Non-commercial use only, with attribution to XorDev; keep this
 * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.
 */
// shdr-19
const shdr19 = `#version 300 es
${helpers}
uniform float uP_speed;
uniform float uP_swirl;
uniform float uP_slide;
uniform float uP_radius;
uniform float uP_scale;
uniform float uP_bulge;
uniform float uP_grow;
uniform float uP_vary;
uniform float uP_skew;
uniform float uP_jitter;
uniform float uP_edge;
uniform float uP_bead;
uniform float uP_gain;
uniform float uP_contrast;
uniform float uP_saturation;
uniform float uP_floorLevel;
uniform float uP_light;
uniform float uP_rim;
uniform vec3 uC_low;
uniform vec3 uC_high;
uniform vec3 uC_body;
uniform vec3 uC_sheen;

#define AA 2

// Volume-reactive values, resolved once per fragment in main().
float foamGrow;
float foamJitter;
float foamGain;

vec3 foamRender(vec2 fragCoord) {
  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  float R = max(uP_radius, 0.001);

  // the dome: the front hemisphere of a unit ball, in screen space
  vec2 pl = uv / R;
  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));

  float t = uP_speed; // integrated clock

  // stereographic wrap of the unrotated dome, as in shdr-08
  vec2 p = pl / (z + 1.0 + uP_bulge) * uP_scale;

  // projection-safe 2D motion: the packing turns and drifts
  float sw = uP_swirl; // integrated clock
  p = mat2(cos(sw), -sin(sw), sin(sw), cos(sw)) * p;
  p += vec2(uP_slide, uP_slide * 0.7); // integrated clock

  vec2 cell = ceil(p);
  vec2 f = p - cell; // in (-1, 0], the fragment's place in its own cell

  /*
    The 3x3 walk, keyed on the ABSOLUTE cell index so a bead is one bead —
    see the header. Tracking the winner as well as the max costs nothing
    and is what makes the shading below possible.
  */
  float cover = 0.0;
  float bestRel = 1e9;
  vec2 bestDelta = vec2(0.0);
  float bestRad = 1.0;
  vec2 bestId = vec2(0.0);

  for (int gy = -1; gy <= 1; gy++) {
    for (int gx = -1; gx <= 1; gx++) {
      vec2 g = vec2(float(gx), float(gy));
      vec2 id = cell + g;

      /*
        The listing's generator: a dot of a cosine against a detuned,
        swizzled sine of the cell index, both carrying the clock. Mind the
        range — a dot of two 2-vectors of unit-bounded components spans
        FOUR, not two, so the listing's /6 puts radii within a third of a
        cell of the mean. Read it as half that and the largest discs
        overlap their neighbours, which is what turns a dot screen into a
        litter of merged blobs.
      */
      float rad = dot(cos(id - t), sin(id.yx * uP_skew + t)) * uP_vary + foamGrow;
      /*
        Fragment to feature point, and the signs matter more than they
        look. The disc labelled id sits at id + jitter in absolute
        coordinates, so delta = p - (id + jitter) = f - g - jitter. Write
        it as f + g and the disc's IDENTITY and its POSITION end up using
        opposite offsets: every fragment then draws disc id in a different
        place, and the field comes out as clumps of half-agreeing circles
        rather than circles.
      */
      vec2 jit = cos(id.yx + t) * foamJitter;
      vec2 delta = f - g - jit;
      float dist = length(delta);

      /*
        The union is taken over COVERAGE, not over the signed distance the
        listing maxes. Those differ exactly where two discs overlap: max of
        (radius - distance) hands the whole overlap to whichever disc wins
        and bites a straight edge out of the other, so the field comes out
        a litter of crescents and pinwheels. Max of the clamped coverage
        keeps every disc whole and merely lets overlapping ones merge.

        The x50 ramp is the listing's, and it is an edge width rather than
        a brightness: a signed distance scaled that hard and clamped is a
        hard-edged disc with about a pixel of feather.
      */
      cover = max(cover, clamp((rad - dist) * uP_edge, 0.0, 1.0));

      /*
        The winner is tracked separately, by RELATIVE depth rather than
        absolute — which disc this fragment is furthest inside, in units of
        that disc's own radius. Only the optional bead shading reads it,
        and relative depth is what keeps a small disc from being shaded as
        though it were the large one beside it.
      */
      float rel = dist / max(rad, 1e-4);
      if (rel < bestRel) {
        bestRel = rel;
        bestDelta = delta;
        bestRad = rad;
        bestId = id;
      }
    }
  }

  /*
    The bead. The winning cell's own distance and radius give the height of
    a hemisphere over the disc, and that is a normal — so the flat decal
    becomes a lit piece of glass without a second field being evaluated.
  */
  float rr = max(bestRad, 1e-4);
  float dome = clamp(1.0 - dot(bestDelta, bestDelta) / (rr * rr), 0.0, 1.0);
  vec3 bn = normalize(vec3(bestDelta / rr, sqrt(dome) + 0.001));

  vec3 key = normalize(vec3(-0.45, 0.55, 0.72));
  float beadLam = clamp(dot(bn, key), 0.0, 1.0);

  // per-disc colour, hashed on the cell index — near-flat at the defaults,
  // which is what keeps the field reading as a dot screen
  vec3 beadCol = mix(uC_low, uC_high, hash(bestId + 0.5));

  // uP_bead at 0 leaves the listing's flat disc, which is the default
  float shade = mix(1.0, 0.45 + 0.85 * beadLam, uP_bead);
  vec3 col = beadCol * shade * foamGain * cover;

  // a dark body under the packing, so the gaps read as the ball rather
  // than as holes in it
  col += uC_body * uP_floorLevel;

  col = pow(max(col, vec3(0.0)), vec3(uP_contrast));

  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);

  // dome shading keeps the ball a ball under the packing
  vec3 n = vec3(pl, z);
  float lambert = clamp(dot(n, key), 0.0, 1.0);
  col *= 0.55 + uP_light * lambert;

  float fres = 1.0 - z;
  fres = fres * fres * fres;
  col += uC_sheen * uP_rim * fres;

  return col;
}

void main() {
  // Volume coupling: the user's voice shakes the beads off their centres,
  // the agent's swells them and brightens the packing.
  foamGrow = uP_grow * (1.0 + 0.35 * uOutput);
  foamJitter = uP_jitter * (1.0 + 0.5 * uInput);
  foamGain = uP_gain * (0.85 + 0.4 * uOutput);

  vec2 uv = orbUV();
  float mask = smoothstep(0.012, -0.012, length(uv) - max(uP_radius, 0.001));

  if (mask <= 0.0) {
    fragColor = vec4(0.0);
    return;
  }

  vec3 col = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 off = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;
      col += foamRender((vUv * uRes) + off);
    }
  }
  col /= float(AA * AA);
#else
  col = foamRender((vUv * uRes));
#endif

  // Surface orb bounded by a mask: alpha IS coverage, so premultiply — the
  // opposite convention from the emissive orbs (see shdr-31).
  float a = mask;
  fragColor = vec4(max(col, vec3(0.0)) * a, a);
}
`;

/*
 * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's
 * permission. Non-commercial use only, with attribution to XorDev; keep this
 * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.
 */
// shdr-20
const shdr20 = `#version 300 es
${helpers}
uniform float uP_speed;
uniform float uP_flow;
uniform float uP_camDist;
uniform float uP_focal;
uniform float uP_tilt;
uniform float uP_stretch;
uniform float uP_foam;
uniform float uP_wall;
uniform float uP_stepScale;
uniform float uP_hueScale;
uniform float uP_envRadius;
uniform float uP_envCore;
uniform float uP_fill;
uniform float uP_stepClamp;
uniform float uP_scatter;
uniform float uP_exposure;
uniform float uP_contrast;
uniform float uP_saturation;
uniform float uP_alphaGain;
uniform float uP_edge;
uniform float uP_edgeFade;
uniform vec3 uC_tint;

#define STEPS 50
#define TURB 5
#define AA 1

// Volume-reactive values, resolved once per fragment in main().
float fallsFoam;
float fallsExposure;

mat2 fallsRot(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

vec3 fallsRender(vec2 fragCoord) {
  float animTime = uP_speed; // integrated clock: ripple phase
  float flow = uP_flow;      // integrated clock: the 9t rush, tunable

  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  vec3 ro = vec3(0.0, 0.0, uP_camDist);
  vec3 rd = normalize(vec3(uv, -uP_focal));

  float rShell = uP_envRadius * 0.92;

  vec3 acc = vec3(0.0);

  // transmittance carried front-to-back — near foam veils far foam
  float T = 1.0;

  // march only the span the envelope can light, as in shdr-01
  float z = max(uP_camDist - uP_envRadius * 1.3, 0.0);
  float zEnd = uP_camDist + uP_envRadius * 1.3;

  for (int it = 0; it < STEPS; it++) {
    vec3 c = ro + rd * z;

    // a slight static tilt of the flow axis
    c.yz = fallsRot(uP_tilt) * c.yz;

    /*
      The fall grain: squash the vertical axis, then the five octaves with
      the rush phase on the first component — cos(p.yzx*f + ...) writes
      that component to x, so height and time drive the sideways waves,
      exactly the original's x*t construction.
    */
    vec3 p = c;
    p.y *= uP_stretch;
    for (int j = 0; j < TURB; j++) {
      float fj = float(j) + 1.3;
      p += cos(p.yzx * fj + float(it) + z + vec3(flow, 0.0, 0.0)) / fj;
    }

    // the foam blend — most of the displacement is thrown away, leaving a
    // film of detail over a coherent surface
    vec3 pm = mix(c, p, fallsFoam);

    /*
      The surface, swapped from the sigmoid cliff to the ball's own shell:
      distance to the sphere (sharpened by uP_wall) plus the original's
      traveling ripple. f can still reach zero exactly — the guard feeds
      both the division and the march step.
    */
    float f = uP_stepScale * (abs(length(pm) - rShell) * uP_wall
      + sin(pm.x - pm.z + animTime * 2.0) + 1.0);
    f = max(f, 1e-3);
    z += f;

    /*
      Vertical hue sheets from the listing, bright where the march grazes
      the film. The CLAMP is load-bearing, as in every accumulator here —
      one f-null step would own the whole 50-step sum.
    */
    vec3 w = (cos(pm.x * uP_hueScale + f + vec3(6.0, 1.0, 2.0)) + 2.0) / f / max(z, 1.0);
    w = min(w, vec3(uP_stepClamp));

    // envelope: plateau through the ball, cut 12% past the radius so the
    // analytic silhouette in main() still has emission left to cut
    float env = smoothstep(uP_envRadius * 1.12, uP_envRadius * uP_envCore, length(ro + rd * z));
    w = (w + uP_fill) * env;

    acc += T * w;
    T *= exp(-dot(w, vec3(0.299, 0.587, 0.114)) * uP_scatter);

    if (T < 0.004 || z > zEnd) break;
  }

  return acc;
}

void main() {
  fallsFoam = uP_foam * (1.0 + 0.5 * uInput);
  fallsExposure = uP_exposure * (1.0 - 0.35 * uOutput);

  vec3 acc = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 offset = vec2(float(mx), float(my)) / float(AA) - 0.5;
      acc += fallsRender((vUv * uRes) + offset);
    }
  }
  acc /= float(AA * AA);
#else
  acc = fallsRender((vUv * uRes));
#endif

  // tanh tone map per channel — the golfed /3e1 knee is a tunable here
  vec3 col = tanh3(acc / max(fallsExposure, 1.0));
  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));

  // saturation about luminance, then the tint
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);
  col *= uC_tint;

  // alpha from the brightest channel, not luminance — a deep blue sheet
  // has low luminance but must not go transparent
  float peak = max(col.r, max(col.g, col.b));
  float a = clamp(peak * uP_alphaGain, 0.0, 1.0);

  // Analytic silhouette — identical construction to shdr-01: exact
  // ray-to-centre distance against the radius, colour AND alpha.
  vec3 mrd = normalize(vec3(orbUV(), -uP_focal));
  float closest = length(cross(vec3(0.0, 0.0, uP_camDist), mrd));
  float band = mix(0.35, 0.012, clamp(uP_edge, 0.0, 1.0));
  float mask = 1.0 - smoothstep(uP_envRadius * (1.0 - band), uP_envRadius * 1.005, closest);
  col *= mask;
  a *= mask;

  // safety taper at the frame boundary — colour as well as alpha
  float r2d = length(orbUV());
  float fade = 1.0 - smoothstep(uP_edgeFade, 1.0, r2d);
  col *= fade;
  a *= fade;

  // Emitted light, so rgb is already premultiplied — do NOT scale by alpha
  // again (see the same note in shdr-31).
  fragColor = vec4(col, a);
}
`;

// Original Orbkit shader by zzzzshawn. MIT, see licenses/Orbkit.txt.
// shdr-21
const shdr21 = `#version 300 es
${helpers}
uniform float uP_speed;
uniform float uP_camDist;
uniform float uP_focal;
uniform float uP_radius;
uniform float uP_scale;
uniform float uP_churn;
uniform float uP_threshold;
uniform float uP_edgeSoft;
uniform float uP_density;
uniform float uP_absorb;
uniform float uP_shadowAbsorb;
uniform float uP_shadowLift;
uniform float uP_aniso;
uniform float uP_lightSpin;
uniform float uP_power;
uniform float uP_ambient;
uniform float uP_exposure;
uniform float uP_alphaGain;
uniform vec3 uC_light;
uniform vec3 uC_shadow;

#define STEPS 56
#define LIGHT_STEPS 4
#define DENSITY_OCT 4
#define AA 1

const float PI = 3.14159265359;

// Volume-reactive values, resolved once per fragment in main().
float nimbusPower;
float nimbusDensity;

/*
  Density inside the sphere.

  The radial term falls to zero at the boundary, which both bounds the volume
  and gives the soft edge for free. The cos-warp folds the sample point a few
  times — the same cheap turbulence the other orbs use — and the threshold
  carves that into clumps rather than an even fog.
*/
float density(vec3 p, float animTime) {
  float shell = 1.0 - length(p) / uP_radius;
  if (shell <= 0.0) return 0.0;

  vec3 q = p * uP_scale;
  float f = 1.0;
  for (int k = 0; k < DENSITY_OCT; k++) {
    q += cos(q.yzx * f + animTime * uP_churn) / f;
    f *= 1.8;
  }

  float n = (sin(q.x) + sin(q.y) + sin(q.z)) / 3.0 * 0.5 + 0.5;
  // smoothstep against the threshold is the clump control: high threshold
  // leaves sparse wisps, low fills the sphere with even fog
  float clump = smoothstep(uP_threshold, 1.0, n);
  return clump * pow(shell, uP_edgeSoft) * nimbusDensity;
}

/*
  Henyey-Greenstein: g > 0 biases scattering forward, which is what gives the
  bloom on the limb facing the light.

  The physical form carries a 1/(4*PI) normalisation. It is dropped here and
  folded into uP_power instead — kept in, the whole term sits around 0.02 and
  the orb renders black unless power is pushed into the hundreds, which makes
  the slider useless.
*/
float phaseHG(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * c, 0.0001), 1.5);
}

vec4 nimbusRender(vec2 fragCoord) {
  float animTime = uP_speed; // integrated clock

  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  vec3 ro = vec3(0.0, 0.0, -uP_camDist);
  vec3 rd = normalize(vec3(uv, uP_focal));

  /*
    Light direction, slowly orbiting so the shading is never static.

    The z term is kept POSITIVE — the camera looks along +z, so a light also
    pointing along +z sits behind the cloud. That is the back-lit case, where
    dot(rd, L) approaches 1 and the forward-scattering phase blooms. Put the
    light on the camera's side instead and every ray samples the phase function
    on its back-scatter tail, where it is roughly ten times smaller, and the orb
    goes muddy.
  */
  vec3 L = normalize(vec3(
    cos(animTime * uP_lightSpin) * 0.7,
    0.45,
    sin(animTime * uP_lightSpin) * 0.35 + 0.65
  ));

  float phase = phaseHG(dot(rd, L), uP_aniso);

  // Start the march at the sphere's front face instead of the camera — every
  // step before that contributes nothing, and at 56 steps they are expensive.
  float toCentre = uP_camDist;
  float tStart = max(toCentre - uP_radius, 0.0);
  float span = 2.0 * uP_radius;
  float dt = span / float(STEPS);

  float T = 1.0;
  vec3 scattered = vec3(0.0);

  for (int i = 0; i < STEPS; i++) {
    float t = tStart + (float(i) + 0.5) * dt;
    vec3 p = ro + rd * t;

    float dn = density(p, animTime);
    if (dn > 0.001) {
      // short march toward the light for self-shadowing
      float shadow = 1.0;
      float lstep = uP_radius / float(LIGHT_STEPS);
      for (int k = 1; k <= LIGHT_STEPS; k++) {
        vec3 lp = p + L * (float(k) - 0.5) * lstep;
        shadow *= exp(-density(lp, animTime) * lstep * uP_shadowAbsorb);
      }

      /*
        In-scattered light: warm where lit, cool where the volume shadows
        itself.

        The shadow term appears ONCE, inside the mix. Multiplying by it again
        as a factor — the obvious-looking thing to write — scales the shadowed
        end of the mix toward zero, so the cool colour is always multiplied
        away and the cloud comes out monochrome beige however it is tinted.
        uP_shadowLift is how much light still reaches the shadowed side.
      */
      vec3 lit = mix(uC_shadow * uP_shadowLift, uC_light, shadow);
      scattered += T * dn * dt * lit * phase * nimbusPower;

      T *= exp(-dn * dt * uP_absorb);
      if (T < 0.01) break;
    }
  }

  // a soft ambient body so the unlit side is not pure black
  float body = 1.0 - T;
  scattered += uC_shadow * body * uP_ambient;

  return vec4(scattered, body);
}

void main() {
  /*
    Agent output turns the light up; user input thickens the cloud. Both are
    AMPLITUDES. Churn is deliberately NOT volume-scaled: it multiplies the
    accumulated clock into a phase (animTime * churn), so scaling it by the
    live volume would turn every volume wobble into a phase jump the size of
    the whole clock — the cloud scrambles chaotically on each state change
    instead of gliding, and gets worse the longer the page is open.
  */
  nimbusPower = uP_power * (0.7 + 0.9 * uOutput);
  nimbusDensity = uP_density * (1.0 + 0.35 * uInput);

  vec4 acc = vec4(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 offset = vec2(float(mx), float(my)) / float(AA) - 0.5;
      acc += nimbusRender((vUv * uRes) + offset);
    }
  }
  acc /= float(AA * AA);
#else
  acc = nimbusRender((vUv * uRes));
#endif

  vec3 col = tanh3(acc.rgb * uP_exposure);
  float a = clamp(acc.a * uP_alphaGain, 0.0, 1.0);

  // Emitted/scattered light, so rgb is already premultiplied — do NOT multiply
  // by alpha again (see the same note in shdr-31).
  fragColor = vec4(col, a);
}
`;

/*
 * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's
 * permission. Non-commercial use only, with attribution to XorDev; keep this
 * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.
 */
// shdr-22
const shdr22 = `#version 300 es
${helpers}
uniform float uP_speed;
uniform float uP_wander;
uniform float uP_camDist;
uniform float uP_focal;
uniform float uP_hug;
uniform float uP_turb;
uniform float uP_stepScale;
uniform float uP_hueStep;
uniform float uP_hueDepth;
uniform float uP_glow;
uniform float uP_glowFew;
uniform float uP_envRadius;
uniform float uP_envCore;
uniform float uP_fill;
uniform float uP_stepClamp;
uniform float uP_scatter;
uniform float uP_exposure;
uniform float uP_contrast;
uniform float uP_saturation;
uniform float uP_alphaGain;
uniform float uP_edge;
uniform float uP_edgeFade;
uniform vec3 uC_tint;

#define STEPS 70
#define TURB 7
#define AA 1

// Volume-reactive values, resolved once per fragment in main().
float vectorsTurb;
float vectorsExposure;
float vectorsGlow;

vec3 vectorsRender(vec2 fragCoord) {
  float animTime = uP_speed; // integrated clock: cell flicker phase
  float wander = uP_wander;  // integrated clock: axis drift

  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  vec3 ro = vec3(0.0, 0.0, uP_camDist);
  vec3 rd = normalize(vec3(uv, -uP_focal));

  // the wandering rotation axis — unit by construction, which is what
  // makes the 90-degree Rodrigues below exact
  vec3 axis = normalize(sin(wander + vec3(0.0, 2.0, 4.0)));

  vec3 acc = vec3(0.0);

  // transmittance carried front-to-back — near streaks veil far ones
  float T = 1.0;

  // march only the span the envelope can light, as in shdr-01
  float z = max(uP_camDist - uP_envRadius * 1.3, 0.0);
  float zEnd = uP_camDist + uP_envRadius * 1.3;

  for (int it = 0; it < STEPS; it++) {
    vec3 p = ro + rd * z;

    /*
      THE ORB IS THE OBJECT — pull the sample toward the sphere's shell
      before the field ever sees it. At hug 0 this is the raw 3D tangle;
      at 1 the field is purely angular, painted on the ball's skin. The
      guard keeps normalize() defined through the centre.
    */
    float rl = max(length(p), 1e-3);
    vec3 q = mix(p, p / rl * uP_envRadius, uP_hug);

    // the exact 90-degree rotation about the wandering axis; v stays
    // clean, a takes the turbulence — the fork is the original's v=a=...
    vec3 v = dot(axis, q) * axis + cross(axis, q);
    vec3 a = v;

    // cell-quantized turbulence: every ceil() lattice cell flickers on
    // its own phase
    for (int j = 0; j < TURB; j++) {
      float dj = float(j) + 3.0;
      a += vectorsTurb * sin(ceil(a * dj) - animTime).yzx / dj;
    }

    // the density product — turbulent detail times clean streak surfaces
    float d = uP_stepScale * length(sin(a * a)) * sqrt(length(v * sin(v.yzx)));
    d = max(d, 1e-4);

    /*
      The march's own colour code, from the listing: red constant, green
      by step index, blue by depth into the ball — with the two ramps
      exposed. The CLAMP is load-bearing as everywhere: one grazing step
      would own the whole 70-step sum at some phases. Green gets twice the
      clamp headroom: its ramp runs to STEPS (70) where red is fixed at 9,
      and an equal clamp would crush the step gradient first.
    */
    vec3 w = vec3(9.0, float(it) * uP_hueStep, (z - uP_camDist + uP_envRadius) * uP_hueDepth) / d;
    w = min(w, vec3(uP_stepClamp) * vec3(1.0, 2.0, 1.0));

    /*
      Normalize the clamped weight back to family units (a ceiling of ~20,
      like the sibling orbs). This orb's raw weights run in the hundreds —
      the golfed knee was 6e4 — and without this one line the clamp value
      leaks into total energy, so Exposure, Body fill and Diffusion would
      all change meaning whenever the clamp moves. Normalized, stepClamp
      is a pure dynamic-range knob: low flattens the streaks, high lets
      the 1/d spikes whiten.
    */
    w *= 20.0 / max(uP_stepClamp, 1.0);

    /*
      A few vectors GLOW. Cells of the clean rotated frame are hashed, and
      each cell's hash cycles against the clock so only a small fraction
      (uP_glowFew of the cycle) are hot at any moment. Where a hot cell
      meets a streak null, the same 1/d spike is re-read on a far higher
      ceiling than the step clamp — deliberately bypassing it — and pushed
      as warm-white light. The two smoothsteps make a triangle window, so
      each glow blooms and fades instead of popping at the cycle wrap.
    */
    float few = max(uP_glowFew, 1e-3);
    vec3 vc = ceil(v * 2.0);
    float hcell = hash(vc.xy + vc.z * vec2(7.31, 3.17));
    float cyc = fract(hcell + animTime * 0.05);
    float sel = smoothstep(1.0 - few, 1.0 - 0.5 * few, cyc) * smoothstep(1.0, 1.0 - 0.5 * few, cyc);
    // QUADRATIC in 1/d, unlike the linear base weight — the glow hugs the
    // filament core and falls off fast, a hot wire rather than a lit sector
    w += vec3(1.0, 0.96, 0.88) * min(0.08 / (d * d), 500.0) * sel * vectorsGlow;

    // envelope: plateau through the ball, cut 12% past the radius so the
    // analytic silhouette in main() still has emission left to cut
    float env = smoothstep(uP_envRadius * 1.12, uP_envRadius * uP_envCore, length(p));
    w = (w + uP_fill) * env;

    acc += T * w;
    T *= exp(-dot(w, vec3(0.299, 0.587, 0.114)) * uP_scatter);

    z += d;
    if (T < 0.004 || z > zEnd) break;
  }

  return acc;
}

void main() {
  vectorsTurb = uP_turb * (1.0 + 0.5 * uInput);
  vectorsExposure = uP_exposure * (1.0 - 0.35 * uOutput);
  // the glows flare when the agent speaks
  vectorsGlow = uP_glow * (1.0 + 0.8 * uOutput);

  vec3 acc = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 offset = vec2(float(mx), float(my)) / float(AA) - 0.5;
      acc += vectorsRender((vUv * uRes) + offset);
    }
  }
  acc /= float(AA * AA);
#else
  acc = vectorsRender((vUv * uRes));
#endif

  // tanh tone map per channel — the envelope and transmittance change the
  // accumulator's scale, so the golfed /6e4 knee is a tunable here
  vec3 col = tanh3(acc / max(vectorsExposure, 1.0));
  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));

  // saturation about luminance, then the tint
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);
  col *= uC_tint;

  // alpha from the brightest channel, not luminance — a deep blue tail
  // has low luminance but must not go transparent
  float peak = max(col.r, max(col.g, col.b));
  float a = clamp(peak * uP_alphaGain, 0.0, 1.0);

  // Analytic silhouette — identical construction to shdr-01: exact
  // ray-to-centre distance against the radius, colour AND alpha.
  vec3 mrd = normalize(vec3(orbUV(), -uP_focal));
  float closest = length(cross(vec3(0.0, 0.0, uP_camDist), mrd));
  float band = mix(0.35, 0.012, clamp(uP_edge, 0.0, 1.0));
  float mask = 1.0 - smoothstep(uP_envRadius * (1.0 - band), uP_envRadius * 1.005, closest);
  col *= mask;
  a *= mask;

  // safety taper at the frame boundary — colour as well as alpha
  float r2d = length(orbUV());
  float fade = 1.0 - smoothstep(uP_edgeFade, 1.0, r2d);
  col *= fade;
  a *= fade;

  // Emitted light, so rgb is already premultiplied — do NOT scale by alpha
  // again (see the same note in shdr-31).
  fragColor = vec4(col, a);
}
`;

// Original Orbkit shader by zzzzshawn. MIT, see licenses/Orbkit.txt.
// shdr-23
const shdr23 = `#version 300 es
${helpers}
uniform float uP_drift;
uniform float uP_scroll;
uniform float uP_speed;
uniform float uP_pulse;
uniform float uP_spin;
uniform float uP_radius;
uniform float uP_cells;
uniform float uP_scale;
uniform float uP_density;
uniform float uP_dropout;
uniform float uP_light;
uniform float uP_rim;
uniform float uP_gain;
uniform float uP_contrast;
uniform vec3 uC_glow;
uniform vec3 uC_deep;

void main() {
  // Volume coupling: user input densifies the glyphs, agent output turns
  // the phosphor up — the matrix visibly burns brighter while it speaks.
  float densBias = uP_density + 0.2 * uInput;
  float gainNow = uP_gain * (0.85 + 0.5 * uOutput);

  // resolution-relative glyph grid — same character count at every size
  float cellPx = max(min(uRes.x, uRes.y) / max(uP_cells, 8.0), 4.0);
  vec2 cellIdx = floor((vUv * uRes) / cellPx);
  vec2 cellCentre = (cellIdx + 0.5) * cellPx;
  vec2 g = fract((vUv * uRes) / cellPx); // 0..1 inside the cell

  vec2 suv = (2.0 * cellCentre - uRes) / min(uRes.x, uRes.y);
  vec2 uv = suv / uP_radius;
  float r2 = dot(uv, uv);

  // blocky silhouette, cut on the cell grid like the rest of the matrix
  float mask = 1.0 - step(1.0, r2);

  float z = sqrt(max(1.0 - r2, 0.0));
  vec3 n = vec3(uv, z);

  // rotating dome, stereographic projection — the weave compresses toward
  // the rim and rolls around the ball as the dome turns
  float rot = uP_spin; // integrated clock
  float cr = cos(rot);
  float sr = sin(rot);
  vec3 sp = vec3(n.x * cr - n.z * sr, n.y, n.x * sr + n.z * cr);
  vec2 p2 = sp.xy / (abs(sp.z) + 1.2) * uP_scale * 3.0;

  /*
    Three motions, one per state, each on its OWN integrated clock so a
    state change morphs the movement instead of jumping it:

      DRIFT   diagonal lava-flow streaming        (idle)
      SCROLL  vertical paging, terminal-style     (thinking)
      PULSE   radial waves radiating from centre  (speaking)

    The clocks are rates in the presets — a rate gliding to zero freezes
    that motion in place, phase intact. The pulse's amplitude is a separate
    non-integrated param, so idle carries no static rings.
  */
  float driftT = uP_drift;   // integrated clock: diagonal stream
  float scrollT = uP_scroll; // integrated clock: vertical paging
  float t = uP_speed;        // integrated clock: pulse phase
  vec2 flow = vec2(driftT * 0.6, -driftT * 0.45 - scrollT);

  float field = fbm(p2 + flow);
  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0, 1.0);
  float dens = clamp((field - 0.5) * 1.8 + densBias + 0.4 * uP_light * lambert
    + uP_pulse * 0.35 * sin(length(uv) * 5.5 - t * 2.4), 0.0, 1.0);

  /*
    The glyph: four dash rows split by three stripe gaps. Rows light from
    the bottom as density rises — the step() against the row index IS the
    ASCII quantizer, so a cell is always a whole character.
  */
  float rowI = floor(g.y * 4.0);
  float bar = step(0.22, fract(g.y * 4.0)) * step(fract(g.y * 4.0), 0.9);
  float stripe = step(0.18, fract(g.x * 3.0));
  float lit = step(rowI + 0.5, dens * 4.0 * gainNow);
  float glyph = bar * stripe * lit;

  /*
    Blocky dropouts: the same field, resampled on a 2x2 super-grid and
    thresholded. Because whole super-cells fail together, the dark zones
    become hard rectangular holes instead of dim characters.
  */
  vec2 superCentre = (floor(cellIdx / 2.0) * 2.0 + 1.0) * cellPx;
  vec2 sSuv = (2.0 * superCentre - uRes) / min(uRes.x, uRes.y);
  vec2 sUv2 = sSuv / uP_radius;
  float sz = sqrt(max(1.0 - dot(sUv2, sUv2), 0.0));
  vec3 ssp = vec3(sUv2.x * cr - sz * sr, sUv2.y, sUv2.x * sr + sz * cr);
  float superField = fbm(ssp.xy / (abs(ssp.z) + 1.2) * uP_scale * 3.0 + flow);
  float keep = step(uP_dropout, superField + 0.15 * uOutput);
  glyph *= keep;

  // phosphor ramp: deep green floor to hot glow, whitening at the top end
  vec3 glyphCol = mix(uC_deep, uC_glow, dens);
  glyphCol += vec3(0.7, 1.0, 0.9) * pow(dens, 3.0) * 0.35;

  // a dark body under the matrix plus a glow-coloured fresnel rim, so the
  // orb reads as a solid ball and not loose characters
  float fres = pow(1.0 - z, 2.2);
  vec3 col = uC_deep * 0.22 + glyphCol * glyph + uC_glow * fres * uP_rim;

  col = pow(max(col, 0.0), vec3(uP_contrast));

  // Surface-lit orb bounded by a mask: alpha IS coverage, so premultiply —
  // the opposite convention from the emissive orbs (see shdr-31).
  float a = mask;
  fragColor = vec4(col * a, a);
}
`;

// Original Orbkit shader by zzzzshawn. MIT, see licenses/Orbkit.txt.
// shdr-24
const shdr24 = `#version 300 es
${helpers}
uniform float uP_spin;
uniform float uP_tilt;
uniform float uP_drift;
uniform float uP_season;
uniform float uP_shuffle;
uniform float uP_radius;
uniform float uP_blocks;
uniform float uP_rough;
uniform float uP_scale;
uniform float uP_sea;
uniform float uP_trees;
uniform float uP_cave;
uniform float uP_ore;
uniform float uP_glow;
uniform float uP_core;
uniform float uP_texture;
uniform float uP_light;
uniform float uP_gain;
uniform float uP_contrast;
uniform vec3 uC_grass;
uniform vec3 uC_dirt;
uniform vec3 uC_stone;
uniform vec3 uC_sand;
uniform vec3 uC_water;
uniform vec3 uC_leaf;
uniform vec3 uC_ore;
uniform vec3 uC_lava;

#define STEPS 160

// Per-fragment state, resolved once in main() before the march.
vec3 ckDrift;
float ckVs;
float ckMaxH;
float ckSeaN;
// Climate weights (lush, desert, ice, mesa) plus the cherry grove — a
// partition of unity driven by the integrated season clock — and the tree
// density they imply.
vec4 ckClim;
float ckCherry;
float ckTreeMul;

// Tree-cell lookup results (GLSL ES 1.0 has no out-struct ergonomics).
vec3 ckTreeDir;
float ckTreeH1;
float ckTreeH2;

mat2 ckRot(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

// Seam-free noise on the direction sphere: tri-planar sum of the prelude's
// 2D value noise, range-stretched (see the header) and clamped so the
// terrain bound stays a true bound.
float ckN3(vec3 p) {
  float v = (noise(p.xy) + noise(p.yz + 19.1) + noise(p.zx + 47.3)) / 3.0;
  return clamp(0.5 + (v - 0.5) * 1.9, 0.0, 1.0);
}

// The raw terrain field for a surface direction, 0..1. Two octaves only —
// the voxel grid quantizes away anything finer.
float ckField(vec3 dir) {
  vec3 q = dir * uP_scale + ckDrift;
  return ckN3(q) * 0.65 + ckN3(q * 2.6 + 31.7) * 0.35;
}

// Local terrain radius. Relief is strictly ADDITIVE above the unit sphere:
// oceans and plains sit exactly on it, mountains climb from the shoreline.
// Under the mesa climate the relief terraces into three-block steps —
// flat-topped buttes and benches, the badlands profile.
float ckTerrain(vec3 dir) {
  // the mesa amplifies its relief into big banded towers
  float h = 1.0 + uP_rough * max(ckField(dir) - ckSeaN, 0.0) * 1.2
    * (1.0 + ckClim.w * 0.8);
  float stepH = 3.0 * ckVs;
  float hq = 1.0 + floor((h - 1.0) / stepH) * stepH;
  return mix(h, hq, ckClim.w * 0.85);
}

// The continent-scale biome field: below 0.3 desert, above 0.58 forest,
// plains between. Drifts with the terrain so biomes move with their land.
float ckBiome(vec3 dir) {
  return ckN3(dir * 1.3 + ckDrift + 57.9);
}

/*
  Which tree cell does this direction fall in? The direction is projected
  onto its dominant cube face and quantized there — every voxel along a
  radial line lands in the same cell, which is what keeps a tree's trunk
  and canopy agreeing across grid levels. The anchor direction is rebuilt
  from the jittered cell centre.
*/
void ckTreeCell(vec3 dir) {
  vec3 ad = abs(dir);
  vec2 fuv;
  float face;
  if (ad.x >= ad.y && ad.x >= ad.z) {
    fuv = dir.yz / ad.x;
    face = dir.x > 0.0 ? 0.0 : 1.0;
  } else if (ad.y >= ad.z) {
    fuv = dir.xz / ad.y;
    face = dir.y > 0.0 ? 2.0 : 3.0;
  } else {
    fuv = dir.xy / ad.z;
    face = dir.z > 0.0 ? 4.0 : 5.0;
  }
  float grid = max(uP_blocks / 6.0, 2.0);
  vec2 cell = floor((fuv * 0.5 + 0.5) * grid);
  ckTreeH1 = hash(cell * 1.17 + face * 19.3);
  ckTreeH2 = hash(cell * 0.71 + face * 7.7 + 9.3);
  vec2 jit = vec2(hash(cell + 7.1 + face), hash(cell + 13.7 + face)) - 0.5;
  vec2 auv = ((cell + 0.5 + jit * 0.3) / grid) * 2.0 - 1.0;
  vec3 cp;
  if (face < 1.5) cp = vec3(face < 0.5 ? 1.0 : -1.0, auv.x, auv.y);
  else if (face < 3.5) cp = vec3(auv.x, face < 2.5 ? 1.0 : -1.0, auv.y);
  else cp = vec3(auv.x, auv.y, face < 4.5 ? 1.0 : -1.0);
  ckTreeDir = normalize(cp);
}

/*
  The world function: what fills this voxel?
    0 air   1 ground   2 trunk   3 leaves
  Ground is the terrain sphere; caves are carved ONLY where the ground has
  risen above the base sphere, so the smooth lowlands stay pristine. Water
  is not a voxel here — ocean surface blocks are painted as water in the
  material pass. Trees grow radially from dry anchors below the tree line,
  dense where the biome says forest.
*/
float ckVoxel(vec3 cc) {
  float r = length(cc);
  vec3 dir = cc / max(r, 1.0e-4);
  if (r < ckMaxH) {
    float h = ckTerrain(dir);
    if (r < h) {
      // carve caves into risen ground only — mountainsides get entrances,
      // the perfect lowland sphere keeps its silhouette
      if (h > 1.0 + 1.5 * ckVs) {
        float cv = ckN3(cc * (uP_scale * 1.9) + 71.3);
        float cw = uP_cave * 0.16 * smoothstep(ckMaxH, ckMaxH - 0.45, r);
        if (abs(cv - 0.5) < cw) return 0.0;
      }
      return 1.0;
    }
  }
  // trees live in a thin shell above the tallest terrain
  if (r < ckMaxH + 8.0 * ckVs && uP_trees > 0.001) {
    ckTreeCell(dir);
    float thrMax = clamp(uP_trees, 0.0, 1.0) * 0.8;
    if (ckTreeH1 > 1.0 - thrMax) {
      // forest density comes from the biome at the ANCHOR, so a whole
      // tree agrees with itself about existing
      float bioA = ckBiome(ckTreeDir);
      float dens = bioA > 0.58 ? 1.0 : (bioA > 0.3 ? 0.25 : 0.0);
      dens *= ckTreeMul; // forests thin out under desert, ice and mesa skies
      if (ckTreeH1 > 1.0 - thrMax * dens) {
        float fA = ckField(ckTreeDir);
        float ha = 1.0 + uP_rough * max(fA - ckSeaN, 0.0) * 1.2;
        // dry land only, below the stone tree line
        if (fA > ckSeaN + 0.015 && ha < 1.0 + uP_rough * 0.42) {
          float lat = length(cc - dot(cc, ckTreeDir) * ckTreeDir);
          if (ckClim.z > 0.5) {
            // ICE SPIKES: the lattice grows tapering packed-ice spires in
            // place of trees. Squaring the height hash makes many stubs
            // and a few tall spires, the ice-plains skyline.
            float spikeH = (2.0 + 6.0 * ckTreeH2 * ckTreeH2) * ckVs;
            float w = mix(1.15, 0.3, clamp((r - ha) / spikeH, 0.0, 1.0)) * ckVs;
            if (lat < w && r > ha - ckVs && r < ha + spikeH) return 3.0;
          } else if (ckClim.w > 0.5) {
            // CACTI: short green columns dotting the badlands flats
            float cacH = (1.5 + 2.0 * ckTreeH2) * ckVs;
            if (lat < 0.6 * ckVs && r > ha - ckVs && r < ha + cacH) return 3.0;
          } else if (ckCherry > 0.5) {
            // CHERRY GROVE: broad flat blossom puffs on short dark trunks —
            // the radial component of the canopy test is stretched, which
            // squashes the puff wide and flat like the cherry grove trees
            float trunkTop = ha + (2.0 + 1.5 * ckTreeH2) * ckVs;
            if (lat < 0.75 * ckVs && r > ha - ckVs && r < trunkTop) return 2.0;
            vec3 dd = cc - ckTreeDir * (trunkTop + 0.6 * ckVs);
            dd += ckTreeDir * dot(dd, ckTreeDir) * 0.8;
            vec3 lv = floor(cc / ckVs);
            float rag = hash(lv.xy * 0.61 + lv.z * 2.23);
            if (length(dd) < (2.2 + 0.5 * rag) * ckVs) return 3.0;
          } else {
            float trunkTop = ha + (2.5 + 2.0 * ckTreeH2) * ckVs;
            if (lat < 0.75 * ckVs && r > ha - ckVs && r < trunkTop) return 2.0;
            vec3 dd = cc - ckTreeDir * (trunkTop + 0.7 * ckVs);
            // canopy radius re-hashed per voxel — ragged blocky foliage
            vec3 lv = floor(cc / ckVs);
            float rag = hash(lv.xy * 0.61 + lv.z * 2.23);
            if (length(dd) < (1.7 + 0.5 * rag) * ckVs) return 3.0;
          }
        }
      }
    }
  }
  return 0.0;
}

void main() {
  // Volume coupling: agent output stokes the glow, the gain and the molten
  // core; user input brightens the key light.
  float glowNow = uP_glow * (0.7 + 1.0 * uOutput);
  float gainNow = uP_gain * (0.9 + 0.3 * uOutput);
  float lightNow = uP_light * (1.0 + 0.3 * uInput);

  // the terrain field drifts on its own integrated clock — in the thinking
  // state it streams, and blocks pop in and out like chunks loading
  ckDrift = vec3(uP_drift * 0.31, uP_drift * 0.17, -uP_drift * 0.23);

  /*
    CLIMATE: the integrated season clock carries the planet through four
    worlds — lush, desert, ice, mesa — on a cycle. The triangular weights
    overlap so exactly two adjacent climates crossfade at any moment, and
    because the clock integrates, changing the season rate never snaps the
    phase: the world just weathers faster or slower.
  */
  // five worlds in crossfade order: lush, cherry, ice, mesa, desert —
  // blossom thaws into snow, terracotta dries into sand
  float t5 = fract(uP_season * 0.05) * 5.0;
  ckClim = vec4(
    clamp(1.0 - min(abs(t5), abs(t5 - 5.0)), 0.0, 1.0), // lush (wraps)
    clamp(1.0 - abs(t5 - 4.0), 0.0, 1.0),               // desert
    clamp(1.0 - abs(t5 - 2.0), 0.0, 1.0),               // ice
    clamp(1.0 - abs(t5 - 3.0), 0.0, 1.0)                // mesa
  );
  ckCherry = clamp(1.0 - abs(t5 - 1.0), 0.0, 1.0);      // cherry grove
  // ice and cherry run HIGH (dense spikes / dense groves); mesa keeps cacti
  ckTreeMul = dot(ckClim, vec4(1.0, 0.15, 0.9, 0.3)) + ckCherry * 0.9;

  ckVs = 2.0 / clamp(uP_blocks, 8.0, 96.0);   // voxel size, planet radius 1
  // sea level in FIELD space: 0.5 puts about half the sphere under water
  ckSeaN = 0.25 + clamp(uP_sea, 0.0, 1.0) * 0.5;
  // tallest possible terrain — sized for the mesa's amplified towers so
  // the viewport holds steady while the seasons turn
  ckMaxH = 1.0 + uP_rough * (1.0 - ckSeaN) * 1.2 * 1.8 + 0.001;
  float bound = ckMaxH + 8.5 * ckVs;          // ...plus the tree shell

  vec2 uv = orbUV() / uP_radius;

  // orthographic camera, viewport sized to the bound so the treetops fit
  vec3 ro = vec3(uv * bound, 2.9);
  vec3 rd = vec3(0.0, 0.0, -1.0);

  // rotate the RAY into object space (inverse tumble) — the grid stays
  // axis-aligned, the planet appears to spin. The light rotates along,
  // keeping the sun fixed relative to the viewer.
  mat2 tiltM = ckRot(uP_tilt); // positive tilt looks DOWN at the north pole
  mat2 spinM = ckRot(-uP_spin); // integrated clock
  ro.yz = tiltM * ro.yz;
  ro.xz = spinM * ro.xz;
  rd.yz = tiltM * rd.yz;
  rd.xz = spinM * rd.xz;
  vec3 Lo = normalize(vec3(-0.5, 0.7, 0.55));
  Lo.yz = tiltM * Lo.yz;
  Lo.xz = spinM * Lo.xz;

  // DDA needs nonzero direction components — nudge, keep the sign
  vec3 sgn = vec3(
    rd.x >= 0.0 ? 1.0 : -1.0,
    rd.y >= 0.0 ? 1.0 : -1.0,
    rd.z >= 0.0 ? 1.0 : -1.0
  );
  rd = normalize(sgn * max(abs(rd), vec3(1.0e-4)));

  // analytic bounding sphere: empty pixels exit here, and the march below
  // only ever walks the chord inside the bound
  float b = dot(rd, ro);
  float c = dot(ro, ro) - bound * bound;
  float disc = b * b - c;
  if (disc < 0.0) {
    fragColor = vec4(0.0);
    return;
  }
  float sq = sqrt(disc);
  vec3 p0 = ro + rd * (-b - sq + ckVs * 0.001);
  float tSpan = 2.0 * sq;

  // Amanatides & Woo init: current voxel, per-axis distance to the next
  // grid plane, per-axis crossing stride
  vec3 vp = floor(p0 / ckVs);
  vec3 tDelta = ckVs / abs(rd);
  vec3 tMax = ((vp + step(vec3(0.0), rd)) * ckVs - p0) / rd;

  float mat = 0.0;
  vec3 mask = vec3(0.0, 0.0, 1.0); // first-voxel fallback: face the viewer
  float tCur = 0.0;

  for (int i = 0; i < STEPS; i++) {
    float m = ckVoxel((vp + 0.5) * ckVs);
    if (m > 0.5) {
      mat = m;
      break;
    }
    // step to the next voxel across the nearest grid plane
    if (tMax.x < tMax.y && tMax.x < tMax.z) {
      tCur = tMax.x;
      tMax.x += tDelta.x;
      vp.x += sgn.x;
      mask = vec3(1.0, 0.0, 0.0);
    } else if (tMax.y < tMax.z) {
      tCur = tMax.y;
      tMax.y += tDelta.y;
      vp.y += sgn.y;
      mask = vec3(0.0, 1.0, 0.0);
    } else {
      tCur = tMax.z;
      tMax.z += tDelta.z;
      vp.z += sgn.z;
      mask = vec3(0.0, 0.0, 1.0);
    }
    if (tCur > tSpan) break; // left the bound: miss
  }

  if (mat < 0.5) {
    fragColor = vec4(0.0);
    return;
  }

  // the hit voxel, its radial "up", and the face that was struck
  vec3 cc = (vp + 0.5) * ckVs;
  float r = length(cc);
  vec3 dir = cc / max(r, 1.0e-4);
  vec3 n = -mask * sgn;
  vec3 hp = p0 + rd * tCur;

  // per-voxel hashes: core phase and material variety
  vec2 vseed = vec2(dot(vp, vec3(1.0, 57.0, 113.0)), dot(vp, vec3(27.0, 7.0, 91.0)));
  float h1 = hash(vseed * 0.013);
  float h2 = hash(vseed * 0.029 + 5.7);

  // block-texture grain: a 4x4 hash grid on the struck face
  vec2 uvFace;
  if (mask.x > 0.5) uvFace = hp.yz;
  else if (mask.y > 0.5) uvFace = hp.xz;
  else uvFace = hp.xy;
  float grain = hash(floor(fract(uvFace / ckVs) * 4.0) * 0.37 + vseed * 0.11);
  float texMul = mix(1.0, 0.72 + 0.55 * grain, uP_texture);

  // flat face lambert + radial wrap for roundness + crevice AO
  float lam = clamp(dot(n, Lo), 0.0, 1.0);
  float wrap = clamp(dot(dir, Lo) * 0.5 + 0.5, 0.0, 1.0);
  float ao = 0.55 + 0.45 * clamp(dot(n, dir) * 0.5 + 0.5, 0.0, 1.0);
  float shade = (0.32 + 0.5 * wrap * wrap + 0.85 * lam * lightNow) * ao;

  vec3 col;
  if (mat < 1.5) {
    float f = ckField(dir);
    float h = 1.0 + uP_rough * max(f - ckSeaN, 0.0) * 1.2;
    float depth = h - r;
    float topF = step(depth, ckVs * 1.15);

    /*
      The climate palette. Every material the strata paint with is a
      blend over the four climate weights: snow caps the ice world, the
      mesa runs banded terracotta hashed per RADIAL LAYER (the same band
      wraps the whole planet, the badlands look), desert bleaches the
      land to sand, and lush keeps the tunable colours.
    */
    vec3 snow = vec3(0.92, 0.95, 1.0);
    /*
      Mesa strata: two-block-tall bands hashed per radial layer, weighted
      the way real badlands run — long terracotta stretches broken by
      thin red, white, yellow and dark-brown accent stripes. The same
      band circles the whole planet at its height.
    */
    float layer = hash(vec2(floor(r / (ckVs * 2.0)) * 0.371, 5.3));
    vec3 mesaBand = layer < 0.5 ? vec3(0.74, 0.42, 0.21)
      : (layer < 0.68 ? vec3(0.63, 0.26, 0.15)
      : (layer < 0.8 ? vec3(0.88, 0.79, 0.67)
      : (layer < 0.9 ? vec3(0.84, 0.65, 0.27) : vec3(0.4, 0.25, 0.18))));
    // mesa tops: red-sand flats low down, banded rock on the risen buttes
    vec3 mesaTop = mix(vec3(0.72, 0.38, 0.2), mesaBand, step(1.0 + uP_rough * 0.1, h));
    vec3 climGrass = uC_grass * ckClim.x + uC_sand * ckClim.y
      + snow * ckClim.z + mesaTop * ckClim.w
      + mix(uC_grass, vec3(0.62, 0.85, 0.3), 0.6) * ckCherry; // vivid meadow
    vec3 climDirt = uC_dirt * (ckClim.x + ckClim.y + ckCherry)
      + uC_dirt * vec3(0.75, 0.85, 1.05) * ckClim.z + mesaBand * ckClim.w;
    vec3 climSand = uC_sand * (ckClim.x + ckClim.y + ckCherry)
      + mix(uC_sand, snow, 0.9) * ckClim.z + vec3(0.72, 0.35, 0.2) * ckClim.w;
    vec3 climWater = uC_water * (ckClim.x + ckClim.y + ckCherry)
      + vec3(0.62, 0.82, 0.92) * ckClim.z
      + mix(uC_water, vec3(0.42, 0.3, 0.22), 0.4) * ckClim.w;

    if (topF > 0.5 && f < ckSeaN) {
      // OCEAN: the surface of the perfect sphere painted as water —
      // lighter over coastal shallows, deep blue mid-ocean, with a sun
      // glint and a shimmer on the flow clock. The ice world stills the
      // shimmer and pales the depths: a frozen sheet.
      float deep = clamp((ckSeaN - f) / 0.12, 0.0, 1.0) * (1.0 - 0.55 * ckClim.z);
      vec3 wc = climWater * mix(1.3, 0.55, deep);
      float shim = 0.85 + 0.25 * sin(uAnim * 2.5 + grain * 6.2831 + dir.x * 4.0);
      shim = mix(shim, 1.02, ckClim.z);
      col = wc * (0.45 + 0.55 * wrap) * shim + wc * lam * 0.35;
    } else {
      /*
        LAND. Strata by radial depth below the local surface — grass or
        desert sand on the outward faces of surface blocks, mud with
        hashed stone patches beneath, then ore-seamed stone. Elevation
        overrides the biome: rising ground bares brown hillsides, peaks
        stand as naked stone, and every shore gets a sand band.
      */
      float dirtF = step(depth, ckVs * 2.4);
      float up = clamp(dot(n, dir), 0.0, 1.0);

      vec3 albedo = mix(uC_stone, climDirt, dirtF);
      // stone patches in the exposed mud, below the grass line
      albedo = mix(albedo, uC_stone, dirtF * (1.0 - topF) * step(h2, 0.3));

      float bio = ckBiome(dir);
      float desertF = step(bio, 0.3);
      albedo = mix(albedo, climGrass, topF * step(0.45, up) * (1.0 - desertF));
      albedo = mix(albedo, climSand, desertF * dirtF); // desert sand runs deep
      // elevation bands: brown hillsides, then bare stone peaks — both
      // buried under snow when the ice climate holds (frozen peaks stay
      // white with only crevice shadow, not brown or gray)
      albedo = mix(albedo, climDirt,
        topF * step(1.0 + uP_rough * 0.28, h) * 0.85 * (1.0 - 0.9 * ckClim.z));
      albedo = mix(albedo, uC_stone,
        topF * step(1.0 + uP_rough * 0.45, h) * (1.0 - 0.85 * ckClim.z));
      // beach: a narrow field-space band above the shoreline turns to sand
      albedo = mix(albedo, climSand, topF * step(abs(f - ckSeaN - 0.017), 0.018));

      // the coarse cluster cells serve ore veins AND glacier patches
      vec3 oc = floor(cc / (2.5 * ckVs));
      vec2 oseed = vec2(dot(oc, vec3(1.0, 57.0, 113.0)), dot(oc, vec3(27.0, 7.0, 91.0)));
      float fleck = step(0.5, hash(floor(fract(uvFace / ckVs) * 4.0) * 0.53 + oseed * 0.19));

      // ICE climate: packed-ice blue patches cluster over the risen
      // ground — glacier faces streaking the snowy mountainsides
      float icePatch = ckClim.z * step(hash(oseed * 0.023 + 9.1), 0.5)
        * step(1.0 + uP_rough * 0.06, h);
      albedo = mix(albedo, vec3(0.55, 0.7, 0.92), icePatch * (0.45 + 0.4 * fleck));

      /*
        Ore veins: a coarse cell grid hashes veins into the deep stone, so
        ore comes in multi-block clusters like the cross-section dioramas.
        Each vein rolls a type — diamond (the tunable ore colour), lapis
        (a deep-blue remap of it), or coal (unlit) — and each ore block is
        stone FLECKED with the hue on its texture grain, the way the
        actual ore tile is drawn. Only the flecks glow.
      */
      float veinF = (1.0 - dirtF) * step(1.0 - uP_ore, hash(oseed * 0.017)) * step(h1, 0.8);
      float oreType = hash(oseed * 0.041 + 2.9);
      vec3 oreHue = oreType < 0.4
        ? uC_ore
        : (oreType < 0.75 ? uC_ore * vec3(0.25, 0.45, 1.2) : vec3(0.16));
      float oreLit = oreType < 0.75 ? 1.0 : 0.0;
      albedo = mix(albedo, oreHue, veinF * (0.2 + 0.65 * fleck));
      float twinkle = 0.55 + 0.45 * sin(uP_shuffle + hash(oseed * 0.013) * 37.0); // integrated clock

      // depth below the surface darkens: cave interiors and cleft walls
      // sink into shadow, which makes the glow read as underground
      float depthDim = mix(1.0, 0.62, clamp(depth / max(uP_rough * 0.9, 0.05), 0.0, 1.0));

      // the deeper the rock, the closer to the molten core
      float coreR = 1.0 - uP_rough * 0.6;
      float coreF = uP_core * smoothstep(coreR + 0.15, coreR - 0.05, r);

      vec3 emis = oreHue * veinF * fleck * oreLit * glowNow * twinkle
        + uC_lava * coreF * (0.9 + 0.4 * sin(uP_shuffle * 1.6 + h1 * 51.0))
          * (0.6 + 1.4 * uOutput);

      col = albedo * shade * depthDim + emis;
    }
  } else if (mat < 2.5) {
    // trunk: dark wood, derived from the mud so the palette stays small
    col = uC_dirt * 0.5 * shade;
  } else {
    // leaves: heavier grain reads as foliage clumps. Under the ice climate
    // this material IS the spikes, so it turns packed-ice blue and the
    // grain smooths toward faceted ice.
    vec3 climLeaf = uC_leaf * (ckClim.x + ckClim.y * 0.9)
      + vec3(0.62, 0.76, 0.95) * ckClim.z
      + mix(uC_leaf, vec3(0.45, 0.62, 0.25), 0.5) * ckClim.w // cactus green
      + vec3(0.93, 0.7, 0.82) * ckCherry; // blossom pink
    col = climLeaf * shade;
    float leafGrain = mix(0.5 + 0.9 * grain, 0.85 + 0.3 * grain, ckClim.z);
    texMul = mix(1.0, leafGrain, uP_texture);
  }

  col *= texMul * gainNow;
  col = pow(max(col, 0.0), vec3(uP_contrast));

  // Surface-lit orb bounded by the hit test: alpha IS coverage, and a hit
  // is fully opaque — premultiplied output, trivially (see shdr-28).
  fragColor = vec4(col, 1.0);
}
`;

/*
 * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's
 * permission. Non-commercial use only, with attribution to XorDev; keep this
 * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.
 */
// shdr-25
const shdr25 = `#version 300 es
${helpers}
uniform float uP_speed;
uniform float uP_drift;
uniform float uP_swirl;
uniform float uP_radius;
uniform float uP_scale;
uniform float uP_bulge;
uniform float uP_warp;
uniform float uP_zoom;
uniform float uP_ripple;
uniform float uP_edgeGain;
uniform float uP_blur;
uniform float uP_fringe;
uniform float uP_exposure;
uniform float uP_contrast;
uniform float uP_saturation;
uniform float uP_floorLevel;
uniform float uP_light;
uniform float uP_rim;
uniform vec3 uC_tint;
uniform vec3 uC_body;
uniform vec3 uC_sheen;

#define OCTAVES 8
#define AA 2

// Volume-reactive values, resolved once per fragment in main().
float creaseWarp;
float creaseGain;

// GLSL ES 1.0 has no scalar tanh; the prelude ships the vec3 form only.
float tanh1(float x) {
  x = clamp(x, -10.0, 10.0);
  float e = exp(2.0 * x);
  return (e - 1.0) / (e + 1.0);
}

/*
  The whole chain for one pixel centre: dome, stereographic wrap, then the
  eight-octave warp. Called three times per sample so the derivative below
  can be differenced — see the header for why fwidth is unavailable.
*/
vec2 creaseField(vec2 fragCoord, float t, float drift, float sw) {
  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  vec2 pl = uv / max(uP_radius, 0.001);
  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));

  vec2 p = pl / (z + 1.0 + uP_bulge) * uP_scale;
  p = mat2(cos(sw), -sin(sw), sin(sw), cos(sw)) * p;
  p += drift;

  /*
    The listing's matrix, decomposed. mat2(6,-8,8,6)/9 is exactly
    (10/9) * mat2(.6,-.8,.8,.6), and that second factor is a true rotation
    because 6-8-10 is a Pythagorean triple — so the octave transform is a
    rotation through the 3-4-5 angle times a clean zoom, with the zoom
    pulled out as a slider.
  */
  for (int i = 0; i < OCTAVES; i++) {
    float fi = float(i) + 1.0;
    p += sin(p + t + fi) * creaseWarp;
    p = uP_zoom * (mat2(0.6, -0.8, 0.8, 0.6) * p);
  }

  return p;
}

vec3 creaseRender(vec2 fragCoord) {
  float t = uP_speed;      // integrated clock: the boil
  float drift = uP_drift;  // integrated clock: the slow travel
  float sw = uP_swirl;     // integrated clock

  /*
    The three taps the difference needs. uP_blur is how far apart they sit:
    at one pixel this is fwidth exactly, and wider is a deliberate blur —
    the derivative of a folded field is a hairline, and a rim wants width.
  */
  vec2 p0 = creaseField(fragCoord, t, drift, sw);
  vec2 px = creaseField(fragCoord + vec2(uP_blur, 0.0), t, drift, sw);
  vec2 py = creaseField(fragCoord + vec2(0.0, uP_blur), t, drift, sw);

  /*
    fwidth, by hand and once per channel. The sum of the absolute
    differences on each axis is exactly what the built-in returns — but
    taking it three times at slightly offset ripple phases puts each
    channel's rim in a slightly different place, which is where the warm
    and cool fringes on the edges come from. One field evaluation still
    serves all three.
  */
  vec3 e;
  for (int c = 0; c < 3; c++) {
    float ph = float(c) * uP_fringe;
    vec2 v0 = sin(p0 * uP_ripple + ph);
    vec2 d = abs(sin(px * uP_ripple + ph) - v0)
           + abs(sin(py * uP_ripple + ph) - v0);
    float m = tanh1(length(d) * creaseGain / max(uP_exposure, 0.001));
    if (c == 0) e.r = m;
    else if (c == 1) e.g = m;
    else e.b = m;
  }

  e = pow(clamp(e, 0.0, 1.0), vec3(uP_contrast));

  vec3 col = uC_tint * e;

  // a dark body under the filigree, so the flat regions read as the ball
  col += uC_body * uP_floorLevel;

  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);

  // dome shading keeps the ball a ball under the folds
  vec2 pl = ((2.0 * fragCoord - uRes) / min(uRes.x, uRes.y)) / max(uP_radius, 0.001);
  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));
  vec3 n = vec3(pl, z);
  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.72))), 0.0, 1.0);
  col *= 0.62 + uP_light * lambert;

  float fres = 1.0 - z;
  fres = fres * fres * fres;
  col += uC_sheen * uP_rim * fres;

  return col;
}

void main() {
  // Volume coupling: the user's voice folds the field harder, the agent's
  // steepens what counts as a crease.
  creaseWarp = uP_warp * (1.0 + 0.4 * uInput);
  creaseGain = uP_edgeGain * (1.0 + 0.5 * uOutput);

  vec2 uv = orbUV();
  float mask = smoothstep(0.012, -0.012, length(uv) - max(uP_radius, 0.001));

  // Twenty-four warp steps per sample — none of them worth paying for
  // outside the silhouette.
  if (mask <= 0.0) {
    fragColor = vec4(0.0);
    return;
  }

  vec3 col = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 off = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;
      col += creaseRender((vUv * uRes) + off);
    }
  }
  col /= float(AA * AA);
#else
  col = creaseRender((vUv * uRes));
#endif

  // Surface orb bounded by a mask: alpha IS coverage, so premultiply — the
  // opposite convention from the emissive orbs (see shdr-31).
  float a = mask;
  fragColor = vec4(max(col, vec3(0.0)) * a, a);
}
`;

/*
 * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's
 * permission. Non-commercial use only, with attribution to XorDev; keep this
 * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.
 */
// shdr-26
const shdr26 = `#version 300 es
${helpers}
uniform float uP_speed;
uniform float uP_swirl;
uniform float uP_drift;
uniform float uP_radius;
uniform float uP_scale;
uniform float uP_bulge;
uniform float uP_warp;
uniform float uP_pole;
uniform float uP_poleSoft;
uniform float uP_pulse;
uniform float uP_sharp;
uniform float uP_split;
uniform float uP_core;
uniform float uP_floor;
uniform float uP_gain;
uniform float uP_contrast;
uniform float uP_light;
uniform float uP_rim;
uniform vec3 uC_deep;
uniform vec3 uC_line;
uniform vec3 uC_hot;
uniform vec3 uC_sheen;

#define OCTAVES 9
#define AA 3

const float TAU = 6.28318530718;

// Volume-reactive values, resolved once per fragment in main().
float latticePole;
float latticeSharp;
float latticeGain;

vec3 latticeRender(vec2 fragCoord) {
  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  float R = max(uP_radius, 0.001);

  // the dome: the front hemisphere of a unit ball, in screen space
  vec2 pl = uv / R;
  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));
  vec3 n = vec3(pl, z);

  float t = uP_speed; // integrated clock

  /*
    Stereographic projection of the UNROTATED dome.

    This orb was built on the abs(sp.z) form first — the one shdr-28
    and shdr-29 use, which survives a 3D roll because the divisor can
    only fall TO zero at the terminator, never through it. It renders, but
    every quarter turn it makes the visible hemisphere an EXACT mirror
    image about the view axis: at a roll of 90 degrees sp becomes
    (-n.z, n.y, n.x), so the projected coordinate depends on n.z and on
    abs(n.x), and both of those are even in screen x. A cellular grid
    hides that. A web of long threads does not — the ball turns into a
    Rorschach blot for a quarter of every revolution.

    So the dome stays put, as in shdr-08, and all the motion below is
    projection-safe 2D.
  */
  vec2 p = n.xy / (n.z + 1.0 + uP_bulge) * uP_scale;

  // the plane turns while the lattice drifts across it, so the crazing
  // migrates over the glaze instead of sitting welded to it
  float sw = uP_swirl; // integrated clock
  p = mat2(cos(sw), -sin(sw), sin(sw), cos(sw)) * p;
  p.x += uP_drift;     // integrated clock

  /*
    A fractional offset off the pattern origin. The listing carries the
    resolution here; it cancels out of the pole term exactly (see the
    header) but it does keep the lattice off centre, and without something
    in its place a cell corner sits pinned at the dead middle of the ball.
  */
  p += vec2(0.37, 0.21);

  // the cell the sample starts in, fixed before the warp — everything the
  // pole term does is relative to THIS corner, not to wherever c wanders
  vec2 cell = floor(p);

  /*
    Each cell knots on its own hashed phase, so the grid breathes instead
    of pulsing as one sheet. The rate is a constant, not a slider: this
    multiplies the integrated clock, and a slider there would jump the
    phase of every cell on a state change.
  */
  float breathe = 1.0 + uP_pulse * sin(TAU * hash(cell) + t * 0.35);

  vec2 c = p;
  for (int j = 0; j < OCTAVES; j++) {
    float i = float(j) + 1.0;

    /*
      The lattice pole, softened. d/(d*d+g) tracks 1/d away from the cell
      corner and rolls over to a finite peak at it, so the phase stays
      band-limited and the knot has a SIZE — uP_poleSoft is that size, and
      it is the difference between crisp cell knots and a corner full of
      aliased noise.
    */
    vec2 d = cell - c;
    vec2 pole = latticePole * breathe * d / (d * d + vec2(uP_poleSoft));

    c += uP_warp * cos(i * c.yx + pole + t) / i;
  }

  /*
    The listing's tone map: a thin ridge every PI with an exponential
    falloff. The per-channel offsets are kept as their original ratio
    (0, 2, 1) so one slider widens the whole split, and against a ridge
    this thin they separate the thread into three coloured filaments.
  */
  vec3 x = vec3(c.y) + vec3(0.0, 2.0, 1.0) * uP_split;
  vec3 thread = exp(-latticeSharp * abs(sin(x)));

  float lev = dot(thread, vec3(1.0 / 3.0));

  /*
    The exp() floor never reaches zero, so the shell is lit between the
    threads by construction — the body colour is added under it rather
    than filling a hole. The thread term stays PER-CHANNEL through the
    palette multiply; collapsing it to lev first would throw away the
    filament split, which is the only thing the vec4 phase was for.
  */
  vec3 col = uC_deep * uP_floor;
  /*
    The ramp between the two thread colours runs nearly the whole range of
    lev deliberately. Started at 0.35 it reached uC_hot — which is near-white in
    every state — across most of the visible web, and the state palettes,
    which ride on uC_line, never got to the eye at all.

    The other half of that fix is in the presets: the chromatic split makes
    the three channels independent, so at a wide split THREAD sets the hue
    and no palette can. It is staged with the rest — widest while
    searching, nearly closed while answering, which is when the warm
    palette has to carry.
  */
  col += thread * mix(uC_line, uC_hot, smoothstep(0.12, 1.0, lev)) * latticeGain;

  /*
    A tight second read of the same ridge, added on top: raising a value
    that is already exp(-k*|sin|) to a high power is the same ridge at a
    fraction of the width, which lands as a hot core inside each thread.
    Taken from lev — the MEAN of the three channels — deliberately, so the
    core is achromatic and lands only where all three filaments coincide.
    Read per-channel it would just be a fourth colour-separated ridge, and
    the web would stay a scatter of green and magenta flecks instead of
    resolving into white threads with coloured shoulders. Squared twice
    rather than pow() — pow is undefined for a negative base and this is
    cheaper anyway (see the README).
  */
  float core = lev * lev;
  core = core * core;
  col += uC_hot * core * uP_core;

  col = pow(max(col, vec3(0.0)), vec3(uP_contrast));

  // dome shading keeps the ball a ball under the web
  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.72))), 0.0, 1.0);
  col *= 0.35 + uP_light * lambert;

  // fresnel sheen: the glaze the threads are crazed into, and the thing
  // that keeps the limb reading as a surface where the cells have
  // compressed past resolving
  float fres = 1.0 - z;
  fres = fres * fres * fres;
  col += uC_sheen * uP_rim * fres;

  return col;
}

void main() {
  // Volume coupling: the user's voice tightens the knots, the agent's
  // thickens the threads and brightens them.
  latticePole = uP_pole * (1.0 + 0.8 * uInput);
  latticeSharp = uP_sharp * (1.0 - 0.25 * uOutput);
  latticeGain = uP_gain * (0.85 + 0.4 * uOutput);

  vec2 uv = orbUV();
  float mask = smoothstep(0.012, -0.012, length(uv) - max(uP_radius, 0.001));

  // Nothing outside the silhouette is ever visible, so skip AA * AA warps
  // for it rather than shading transparent sky.
  if (mask <= 0.0) {
    fragColor = vec4(0.0);
    return;
  }

  vec3 col = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 off = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;
      col += latticeRender((vUv * uRes) + off);
    }
  }
  col /= float(AA * AA);
#else
  col = latticeRender((vUv * uRes));
#endif

  // Surface orb bounded by a mask: alpha IS coverage, so premultiply — the
  // opposite convention from the emissive orbs (see shdr-31).
  float a = mask;
  fragColor = vec4(max(col, vec3(0.0)) * a, a);
}
`;

// Original Orbkit shader by zzzzshawn. MIT, see licenses/Orbkit.txt.
// shdr-27
const shdr27 = `#version 300 es
${helpers}
uniform float uP_speed;
uniform float uP_spin;
uniform float uP_radius;
uniform float uP_scale;
uniform float uP_cells;
uniform float uP_dot;
uniform float uP_swirl;
uniform float uP_vortex;
uniform float uP_freq;
uniform float uP_warp;
uniform float uP_lo;
uniform float uP_hi;
uniform float uP_curve;
uniform float uP_dither;
uniform float uP_sparse;
uniform float uP_density;
uniform float uP_twinkle;
uniform float uP_grain;
uniform float uP_light;
uniform float uP_rim;
uniform vec3 uC_paper;
uniform vec3 uC_c0;
uniform vec3 uC_c1;
uniform vec3 uC_c2;
uniform vec3 uC_c3;
uniform vec3 uC_c4;
uniform vec3 uC_c5;
uniform vec3 uC_c6;

#define VORTICES 6
#define FBM3_OCT 4

// Volume-reactive values, resolved once per fragment in main().
float radarLoNow;
float radarDensityNow;

/*
  3D value noise. The prelude's noise is 2D, and a 2D field wrapped onto
  the ball has to be projected — and every projection either distorts
  somewhere or seams somewhere, which is exactly what the roll dragged
  into view. Evaluating the field ON the sphere's own points needs
  nothing projected: the roll is just a rotation of the sample point.
*/
float hash3(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
}
float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash3(i);
  float n100 = hash3(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash3(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash3(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash3(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash3(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash3(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash3(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z
  );
}
float fbm3(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < FBM3_OCT; i++) {
    v += a * noise3(p);
    p = p * 2.03 + vec3(11.7, 7.3, 3.1);
    a *= 0.5;
  }
  return v;
}

// rotate v about the unit axis k by angle a (Rodrigues)
vec3 rotateAbout(vec3 v, vec3 k, float a) {
  float c = cos(a);
  float s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}

// the precipitation intensity, 0..1, at a point of the unit sphere
float intensity(vec3 sp, float t) {
  vec3 q = sp;
  /*
    The vortices: hashed points on the sphere, each twisting the space
    around itself — a rotation about the axis through it, by an angle
    that falls off with the angular distance, alternating in sense. The
    centres wander slowly so no spiral sits still.
  */
  for (int k = 0; k < VORTICES; k++) {
    float fk = float(k);
    vec3 c = normalize(vec3(
      hash(vec2(fk * 3.7, 1.1)) - 0.5,
      hash(vec2(fk * 5.9, 2.3)) - 0.5,
      hash(vec2(fk * 7.1, 4.9)) - 0.5
    ));
    c = rotateAbout(c, vec3(0.0, 1.0, 0.0), sin(t * 0.09 + fk * 1.7) * 0.25);
    float ang = acos(clamp(dot(q, c), -1.0, 1.0));
    float fall = exp(-ang * ang / (uP_vortex * uP_vortex));
    float a = uP_swirl * fall * (mod(fk, 2.0) < 0.5 ? 1.0 : -1.0);
    q = rotateAbout(q, c, a);
  }

  // bend, then drift the noise through the twisted space
  vec3 w = vec3(noise3(q * 1.3 + 2.1), noise3(q * 1.3 + 7.3), noise3(q * 1.3 + 4.4)) - 0.5;
  q += w * uP_warp;
  vec3 pq = q * uP_freq + vec3(t * 0.22, -t * 0.13, t * 0.07);

  /*
    Two scales multiplied, not added: a broad mask decides WHERE the storms
    are, a finer field gives each one a core and ragged edges. Adding them
    fills the whole sphere with mid-tones; multiplying leaves the calm
    between systems genuinely empty and puts the peaks inside the cells,
    which is what draws the concentric class rings.
  */
  float big = clamp((fbm3(pq) - 0.5) * 3.0 + 0.5, 0.0, 1.0);
  float fine = clamp((fbm3(pq * 2.6 + 4.7) - 0.5) * 2.4 + 0.5, 0.0, 1.0);
  float f = big * (0.55 + 0.45 * fine);

  f = clamp((f - radarLoNow) / max(uP_hi - radarLoNow, 0.01), 0.0, 1.0);
  // a response curve: the top classes are the rare peaks of a real map
  return pow(f, uP_curve);
}

void main() {
  // input lowers the window (more of the field reads as weather), output
  // fills the dots in
  radarLoNow = uP_lo - 0.08 * uInput;
  radarDensityNow = uP_density * (1.0 + 0.5 * uOutput);

  vec2 uv = orbUV();
  float rd = length(uv);
  float R = uP_radius;
  float mask = smoothstep(0.012, -0.012, rd - R);

  if (mask <= 0.0) {
    fragColor = vec4(0.0);
    return;
  }

  vec2 pl = uv / R;
  float r2 = dot(pl, pl);
  float z = sqrt(max(1.0 - r2, 0.0));
  vec3 n = vec3(pl, z);

  float t = uP_speed; // integrated clock: the weather drifts

  /*
    The pixel grid lives on the UNROLLED dome: a stereographic wrap of the
    front hemisphere as it faces the viewer, which compresses gently toward
    the limb and never changes. The picture rolls underneath it — the
    pixels are the screen, the weather is what is on it. Laying the grid on
    the rolled dome instead put the projection's blow-up (the far side of
    the ball) wherever the roll had turned it, and the cells smeared into
    streaks there.
  */
  vec2 st = n.xy / (1.3 + n.z) * uP_scale;
  vec2 g = st * uP_cells;
  vec2 cell = floor(g);
  vec2 fr = fract(g) - 0.5;

  // the cell centre, back on the dome: invert the wrap, then roll it and
  // read the field there — once per cell, so every dot is one flat colour
  vec2 v = (cell + 0.5) / uP_cells / uP_scale;
  float vv = dot(v, v);
  float A = vv + 1.0;
  float B = 2.6 * vv;
  float C = 1.69 * vv - 1.0;
  float zc = (-B + sqrt(max(B * B - 4.0 * A * C, 0.0))) / (2.0 * A);
  vec3 nc = vec3(v * (1.3 + zc), zc);
  float cr = cos(uP_spin);
  float sr = sin(uP_spin);
  vec3 spc = vec3(nc.x * cr - nc.z * sr, nc.y, nc.x * sr + nc.z * cr);

  float f = intensity(spc, t);

  // dither the class boundaries with a per-cell hash, then quantize into
  // the legend's seven classes. The bands are NOT even: red is broad and
  // green thin, as on the reference, and magenta is the rare peak.
  float h = hash(cell + 11.7);
  float fd = clamp(f + (h - 0.5) * uP_dither, 0.0, 1.0);
  float cls = 0.0;
  cls += step(0.10, fd);
  cls += step(0.26, fd);
  cls += step(0.38, fd);
  cls += step(0.46, fd);
  cls += step(0.78, fd);
  cls += step(0.94, fd);

  // dropout: density rises with the intensity; the hash re-rolls slowly
  float frame = floor(uTime * uP_twinkle);
  float roll = hash(cell + vec2(frame * 3.7, -frame * 1.3));
  float density = mix(uP_sparse, 1.0, smoothstep(0.0, 0.6, f)) * radarDensityNow;
  float keep = step(roll, density);

  // the dot: a square inset in its cell
  float dsq = max(abs(fr.x), abs(fr.y));
  float dotMask = 1.0 - smoothstep(uP_dot - 0.06, uP_dot + 0.06, dsq);

  // the class palette
  vec3 ink = uC_c0;
  ink = cls > 0.5 && cls < 1.5 ? uC_c1 : ink;
  ink = cls > 1.5 && cls < 2.5 ? uC_c2 : ink;
  ink = cls > 2.5 && cls < 3.5 ? uC_c3 : ink;
  ink = cls > 3.5 && cls < 4.5 ? uC_c4 : ink;
  ink = cls > 4.5 && cls < 5.5 ? uC_c5 : ink;
  ink = cls > 5.5 ? uC_c6 : ink;

  vec3 col = mix(uC_paper, ink, dotMask * keep);

  // paper grain, so the flats are not dead
  col *= 1.0 + (hash(floor((vUv * uRes) / 2.0) + frame) - 0.5) * uP_grain;

  // dome shading keeps the ball a ball under the mosaic
  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0, 1.0);
  col *= 1.0 - uP_light * (1.0 - lambert);
  float fres = pow(1.0 - z, 3.0);
  col = mix(col, uC_c0, fres * uP_rim);

  // Surface orb bounded by a mask: alpha IS coverage, so premultiply — the
  // opposite convention from the emissive orbs (see shdr-31).
  float a = mask;
  fragColor = vec4(max(col, vec3(0.0)) * a, a);
}
`;

/*
 * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's
 * permission. Non-commercial use only, with attribution to XorDev; keep this
 * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.
 */
// shdr-28
const shdr28 = `#version 300 es
${helpers}
uniform float uP_speed;
uniform float uP_spin;
uniform float uP_tilt;
uniform float uP_radius;
uniform float uP_gridScale;
uniform float uP_levels;
uniform float uP_lineW;
uniform float uP_shutter;
uniform float uP_gain;
uniform float uP_body;
uniform float uP_rim;
uniform float uP_rimPow;
uniform float uP_contrast;
uniform float uP_edge;
uniform float uP_edgeFade;
uniform vec3 uC_lineA;
uniform vec3 uC_lineB;
uniform vec3 uC_base;
uniform vec3 uC_rim;

#define LEVELS 20

// Volume-reactive values, resolved once per fragment in main().
float bitdumbGain;
float bitdumbBody;

mat2 bdRot(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

void main() {
  bitdumbGain = uP_gain * (1.0 + 0.6 * uInput);
  bitdumbBody = uP_body * (1.0 + 0.8 * uOutput);

  vec2 uv = orbUV() / uP_radius;
  float r2 = dot(uv, uv);

  // analytic disc silhouette — this orb is parameterised on the dome, so
  // the exact edge is just the unit circle, with the same tunable band as
  // the raymarched orbs
  float band = mix(0.35, 0.012, clamp(uP_edge, 0.0, 1.0));
  float mask = 1.0 - smoothstep(1.0 - band, 1.005, length(uv));

  // front dome point and its normal (view space)
  float zc = sqrt(max(1.0 - r2, 0.0));
  vec3 n = vec3(uv, zc);

  // tumble the sphere point with real rotations, then project. abs() on z
  // mirror-wraps the hemisphere the tumble turns away, avoiding the
  // stereographic pole blow-up.
  vec3 sp = n;
  sp.yz = bdRot(uP_tilt) * sp.yz;
  sp.xz = bdRot(uP_spin) * sp.xz; // integrated clock
  vec2 p = sp.xy / (abs(sp.z) + 1.0) * uP_gridScale;

  /*
    Analytic pixel footprint in grid space, in place of fwidth(): one
    screen pixel in uv units, through the radius scale, the dome stretch
    (grids compress toward the rim, so a pixel covers more of them there),
    and the grid scale. Doubled alongside p every level.
  */
  float px = (2.0 / min(uRes.x, uRes.y)) / uP_radius / max(zc, 0.2) * uP_gridScale;

  vec4 acc = vec4(0.0);
  float phase = uP_speed * 0.2; // integrated clock, additive phase

  for (int i = 0; i < LEVELS; i++) {
    float fi = float(i) + 1.0;
    if (fi > uP_levels) break;

    // the listing's engine, kept verbatim: binary zoom
    p += p;
    px += px;

    vec2 v = ceil(p);
    vec2 f = fract(p);

    // distance to the nearest cell line, against this level's footprint —
    // the extension-free fwidth. Deep levels saturate to solid planes,
    // exactly like the original's aliasing.
    vec2 e2 = 1.0 - smoothstep(vec2(0.0), vec2(px * uP_lineW), min(f, 1.0 - f));

    // x-lines and y-lines separately tintable — the original's .xyy
    vec3 edgeCol = uC_lineA * e2.x + uC_lineB * e2.y;

    // the per-cell shutter value, and the under-compositing that makes
    // level i occlude level i+1 — both straight from the listing
    float aBit = fract(length(v) / fi - phase) * uP_shutter;
    acc += vec4(edgeCol, aBit) * (1.0 - acc.a);

    if (acc.a > 0.996) break;
  }

  vec3 col = acc.rgb * bitdumbGain;

  // the ball body: a lambert-shaded base under the lattice, so the orb
  // reads as a solid object rather than lines floating on nothing
  vec3 L = normalize(vec3(-0.4, 0.5, 0.75));
  float shade = 0.25 + 0.75 * clamp(dot(n, L), 0.0, 1.0);
  col += uC_base * shade * bitdumbBody;

  // fresnel rim to sell the sphere
  col += uC_rim * pow(1.0 - zc, uP_rimPow) * uP_rim;

  col = pow(max(col, 0.0), vec3(uP_contrast));

  // coverage alpha; safety taper fades colour AND alpha, as always
  float fade = 1.0 - smoothstep(uP_edgeFade, 1.0, length(orbUV()));
  float a = mask * fade;

  // Surface-lit orb bounded by a mask: alpha IS coverage, so premultiply —
  // the opposite of the emissive orbs (see the note in shdr-31).
  fragColor = vec4(col * a, a);
}
`;

// Original Orbkit shader by zzzzshawn. MIT, see licenses/Orbkit.txt.
// shdr-29
const shdr29 = `#version 300 es
${helpers}
uniform float uP_drift;
uniform float uP_churn;
uniform float uP_swirl;
uniform float uP_shuffle;
uniform float uP_pulse;
uniform float uP_spin;
uniform float uP_radius;
uniform float uP_cells;
uniform float uP_scale;
uniform float uP_coverage;
uniform float uP_confetti;
uniform float uP_light;
uniform float uP_gain;
uniform float uP_contrast;
uniform vec3 uC_lit;
uniform vec3 uC_wall;

void main() {
  // Volume coupling: user input widens the lit coverage, agent output turns
  // the panel brightness up.
  float coverNow = uP_coverage + 0.07 * uInput;
  float gainNow = uP_gain * (0.85 + 0.5 * uOutput);

  // resolution-relative tile grid — same wall at every size
  float cellPx = max(min(uRes.x, uRes.y) / max(uP_cells, 8.0), 4.0);
  vec2 cellIdx = floor((vUv * uRes) / cellPx);
  vec2 cellCentre = (cellIdx + 0.5) * cellPx;
  vec2 g = fract((vUv * uRes) / cellPx); // 0..1 inside the tile

  vec2 suv = (2.0 * cellCentre - uRes) / min(uRes.x, uRes.y);
  vec2 uv = suv / uP_radius;
  float r2 = dot(uv, uv);

  // blocky silhouette, cut on the tile grid like the wall itself
  float mask = 1.0 - step(1.0, r2);

  float z = sqrt(max(1.0 - r2, 0.0));
  vec3 n = vec3(uv, z);

  // rotating dome, stereographic projection — the blobs roll around the
  // ball as the dome turns
  float rot = uP_spin; // integrated clock
  float cr = cos(rot);
  float sr = sin(rot);
  vec3 sp = vec3(n.x * cr - n.z * sr, n.y, n.x * sr + n.z * cr);
  vec2 p2 = sp.xy / (abs(sp.z) + 1.2) * uP_scale * 3.0;

  /*
    Per-state motion, each on its own integrated clock:
      DRIFT    the blob field streams across the wall     (idle flows)
      CHURN    the fluid warp evolves in place            (thinking boils)
      SHUFFLE  the confetti promotion cycles              (thinking races it)
      PULSE    rings radiate from the centre              (speaking)
    Rates glide; a rate at zero freezes that motion with its phase intact.
    The pulse depth is an amplitude, so idle carries no static rings.
  */
  float driftT = uP_drift;     // integrated clock: blob stream
  float churnT = uP_churn;     // integrated clock: warp evolution
  float shuffleT = uP_shuffle; // integrated clock: confetti reshuffle
  vec2 f1 = vec2(driftT * 0.5, -driftT * 0.35);
  vec2 f2 = vec2(-churnT * 0.4, churnT * 0.6);

  /*
    FLUID domain warp: two decorrelated fbm channels displace the sample
    point before the blob field reads it, and the displacement itself
    evolves on the churn clock. The blobs curl, stretch and merge like
    liquid instead of sliding across the wall as one rigid sheet.
  */
  vec2 warp = vec2(
    fbm(p2 * 0.9 + f2),
    fbm(p2 * 0.9 + f2.yx + 13.7)
  ) - 0.5;
  float field = fbm(p2 + f1 + warp * uP_swirl * 2.4);

  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0, 1.0);
  float lum = smoothstep(1.0 - coverNow, 1.14 - coverNow, field
    + 0.25 * uP_light * lambert
    + uP_pulse * 0.3 * sin(length(uv) * 5.0 - driftT * 3.2));
  lum *= gainNow;

  /*
    The tile: a bevelled square face inside a frame. The face is the lit
    part; the frame stays dark; an unlit tile keeps a faint presence so the
    wall reads as hardware even where nothing is lit.
  */
  vec2 d2 = abs(g - 0.5);
  float d = max(d2.x, d2.y);
  float face = 1.0 - smoothstep(0.26, 0.36, d);
  float tile = 1.0 - smoothstep(0.42, 0.48, d);
  // a soft centre hot-spot on the face, like an LED under a diffuser
  float hot = 1.0 - smoothstep(0.0, 0.34, length(d2));

  /*
    Confetti: a per-tile hash cycles against the shuffle clock, and the top
    uP_confetti slice of the cycle is promoted from warm white to a fully
    saturated hue drawn from a second hash. Which tiles are coloured
    therefore reshuffles continuously — slowly at rest, fast in thought.
  */
  float h1 = hash(cellIdx * 1.618 + 7.3);
  float h2 = hash(cellIdx * 2.113 + 41.7);
  float cyc = fract(h1 + shuffleT * 0.06);
  float promoted = step(1.0 - uP_confetti, cyc);
  vec3 confetti = 0.5 + 0.5 * cos(6.2831 * (h2 + vec3(0.0, 0.33, 0.67)));
  confetti = normalize(confetti + 0.05) * 1.2;
  vec3 litCol = mix(uC_lit, confetti, promoted);

  // lit face over the dark wall; frames and off-tiles stay faintly present
  vec3 offCol = uC_wall * tile;
  vec3 onCol = litCol * (face * 1.05 + hot * 0.5) * lum;
  vec3 col = offCol + onCol;

  col = pow(max(col, 0.0), vec3(uP_contrast));

  // Surface-lit orb bounded by a mask: alpha IS coverage, so premultiply —
  // the opposite convention from the emissive orbs (see shdr-31).
  float a = mask;
  fragColor = vec4(col * a, a);
}
`;

// Original Orbkit shader by zzzzshawn. MIT, see licenses/Orbkit.txt.
// shdr-30
const shdr30 = `#version 300 es
${helpers}
uniform float uP_fall;
uniform float uP_tilt;
uniform float uP_drift;
uniform float uP_radius;
uniform float uP_scale;
uniform float uP_bulge;
uniform float uP_ratio;
uniform float uP_horizon;
uniform float uP_cloudScale;
uniform float uP_cloudCover;
uniform float uP_streakFreq;
uniform float uP_streakRad;
uniform float uP_water;
uniform float uP_flowerScale;
uniform float uP_flowerDensity;
uniform float uP_flowerSize;
uniform float uP_frameShade;
uniform float uP_haze;
uniform float uP_hazeRange;
uniform float uP_gain;
uniform float uP_contrast;
uniform float uP_saturation;
uniform float uP_light;
uniform float uP_rim;
uniform vec3 uC_sky;
uniform vec3 uC_cloud;
uniform vec3 uC_canopy;
uniform vec3 uC_meadow;
uniform vec3 uC_water;
uniform vec3 uC_bloom;
uniform vec3 uC_sheen;

#define AA 2

// Volume-reactive values, resolved once per fragment in main().
float drosteHaze;
float drosteCloud;
float drosteBloom;

/*
  Arc length around the unit square, in [0,8), counter-clockwise from the
  bottom-right corner — two units per face. Continuous everywhere except
  its single wrap, which lands on a corner.
*/
float squareArc(vec2 q) {
  if (abs(q.x) >= abs(q.y)) {
    if (q.x > 0.0) return q.y + 1.0;
    return 5.0 - q.y;
  }
  if (q.y > 0.0) return 3.0 - q.x;
  return 7.0 + q.x;
}

/*
  Flower colour by hash: mostly white daisies, then the planted warm, then
  the cornflower blues — which reuse the SKY colour rather than adding a
  sixth stop, because that is what keeps them reading as part of the same
  picture instead of as confetti thrown over it.
*/
vec3 drosteFlower(float h) {
  vec3 c = uC_cloud;
  c = mix(c, uC_bloom, step(0.52, h));
  c = mix(c, uC_sky, step(0.86, h));
  return c;
}

vec3 drosteRender(vec2 fragCoord) {
  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  float R = max(uP_radius, 0.001);

  // the dome: the front hemisphere of a unit ball, in screen space
  vec2 pl = uv / R;
  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));

  float fall = uP_fall;   // integrated clock: the flight inward
  float drift = uP_drift; // integrated clock: weather

  /*
    The frame tilt is a STATIC angle, not an integrated clock like the roll
    every other orb here gets. Those clocks seed at a random phase per
    mount, which is exactly right for a field with no preferred direction
    and exactly wrong for a picture: it lands the sky down one side of the
    ball and the meadow up the other. This one has an up.
  */
  float sw = uP_tilt;

  // stereographic wrap — the tunnel is inside the ball, and compresses
  // toward the limb the way a texture on a sphere does
  vec2 p = pl / (z + 1.0 + uP_bulge) * uP_scale;
  p = mat2(cos(sw), -sin(sw), sin(sw), cos(sw)) * p;

  /*
    The Chebyshev norm makes the level sets SQUARES. The floor on it is
    what keeps the logarithm finite at the dead centre; the haze below
    covers that last pixel anyway.
  */
  float m = max(max(abs(p.x), abs(p.y)), 0.002);

  float K = max(uP_ratio, 1.05);
  float L = log2(m) / log2(K) + fall;

  vec2 q = p / m;                 // direction, on the unit square boundary
  float sm = pow(K, fract(L));    // this fragment's radius in base-frame units
  vec2 P = q * sm;                // where it lands in the base picture

  float Yn = P.y / K;             // picture height, about -1 at the bottom edge
  float arc = squareArc(q);       // distance around the frame

  // ---- sky -----------------------------------------------------------
  vec3 col = mix(uC_sky * 0.72, uC_sky, clamp(Yn * 1.3, 0.0, 1.0));

  /*
    Cloud and land are both read in BASE-PICTURE coordinates, so every
    frame carries the same weather at its own scale — which is the whole
    point of a picture that contains itself.
  */
  float skyMask = smoothstep(uP_horizon - 0.3, uP_horizon + 0.2, Yn);
  float cl = fbm(P * uP_cloudScale + vec2(drift, drift * 0.3));
  cl = smoothstep(drosteCloud, drosteCloud + 0.16, cl);
  col = mix(col, uC_cloud, cl * (0.2 + 0.8 * skyMask));

  // ---- land ----------------------------------------------------------
  /*
    The smear. Sampled on (distance around the frame, frame index) with a
    low frequency on the second axis, so features run LONG in the
    direction the recursion stretches them — the streaked walls of the
    reference, straight out of the geometry.
  */
  float streak = fbm(vec2(arc * uP_streakFreq, L * uP_streakRad));

  vec3 land = mix(uC_canopy, uC_meadow, smoothstep(0.02, -0.62, Yn));
  land *= 0.42 + 1.25 * streak;

  // water: the low ground holds it where the streak field pools
  float water = smoothstep(0.42, 0.16, streak) * smoothstep(0.05, -0.3, Yn);
  land = mix(land, uC_water, water * uP_water);

  /*
    Flowers, hashed one to a cell on the same (around, index) grid, jittered
    inside it. Densest low in the picture and gone by the horizon.
  */
  vec2 fg = vec2(arc * uP_flowerScale, L * uP_flowerScale * 0.3);
  vec2 fc = floor(fg);
  vec2 ff = fract(fg) - 0.5;
  vec2 dcv = ff - (vec2(hash(fc + 3.7), hash(fc + 19.1)) - 0.5) * 0.6;
  float petal = smoothstep(uP_flowerSize, uP_flowerSize * 0.35, length(dcv));
  float present = step(1.0 - drosteBloom, hash(fc + 51.3));
  float meadow = smoothstep(0.13, -0.38, Yn);
  land = mix(land, drosteFlower(hash(fc + 7.9)), petal * present * meadow);

  float landMask = 1.0 - smoothstep(uP_horizon - 0.12, uP_horizon + 0.16, Yn);
  col = mix(col, land, landMask);

  /*
    The picture's own edge. Darkening across the frame and resetting hard
    at its boundary is not an artefact to smooth away — it draws the
    nested borders the reference is built out of.
  */
  col *= mix(1.0, uP_frameShade, fract(L));

  /*
    Aerial perspective, from the SCREEN radius. Every frame has the same
    fractional part, so depth cannot come from inside a frame — it has to
    come from how far in the fragment sits. This is what makes the middle
    read as far away instead of merely small.
  */
  float deep = 1.0 - smoothstep(0.0, uP_hazeRange, m);
  col = mix(col, uC_sky, deep * drosteHaze);

  col = pow(max(col, vec3(0.0)), vec3(uP_contrast)) * uP_gain;

  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);

  // dome shading, kept light — this is a window, not a lit surface
  vec3 n = vec3(pl, z);
  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.72))), 0.0, 1.0);
  col *= 0.72 + uP_light * lambert;

  // the glass: a strong fresnel is what turns a picture into a sphere
  // with a world inside it
  float fres = 1.0 - z;
  fres = fres * fres * fres;
  col += uC_sheen * uP_rim * fres;

  return col;
}

void main() {
  // Volume coupling: the user's voice thickens the weather, the agent's
  // clears the haze and brings the meadow into flower.
  drosteCloud = clamp(uP_cloudCover - 0.12 * uInput, 0.02, 0.98);
  drosteHaze = uP_haze * (1.0 - 0.25 * uOutput);
  drosteBloom = clamp(uP_flowerDensity * (1.0 + 0.5 * uOutput), 0.0, 1.0);

  vec2 uv = orbUV();
  float mask = smoothstep(0.012, -0.012, length(uv) - max(uP_radius, 0.001));

  // Two fbm evaluations and a flower grid per sample — none of it worth
  // paying for outside the silhouette.
  if (mask <= 0.0) {
    fragColor = vec4(0.0);
    return;
  }

  vec3 col = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 off = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;
      col += drosteRender((vUv * uRes) + off);
    }
  }
  col /= float(AA * AA);
#else
  col = drosteRender((vUv * uRes));
#endif

  // Surface orb bounded by a mask: alpha IS coverage, so premultiply — the
  // opposite convention from the emissive orbs (see shdr-31).
  float a = mask;
  fragColor = vec4(max(col, vec3(0.0)) * a, a);
}
`;

/*
 * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's
 * permission. Non-commercial use only, with attribution to XorDev; keep this
 * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.
 */
// shdr-31
const shdr31 = `#version 300 es
${helpers}
uniform float uP_speed;
uniform float uP_sweepRate;
uniform float uP_radius;
uniform float uP_swell;
uniform float uP_warp;
uniform float uP_warpFreq;
uniform float uP_warpSwing;
uniform float uP_freqSwing;
uniform float uP_smoothSwing;
uniform float uP_smoothK;
uniform float uP_rayGain;
uniform float uP_rayFalloff;
uniform float uP_surfaceLit;
uniform float uP_ambient;
uniform float uP_alphaGain;
uniform float uP_edgeFade;
uniform float uP_camDist;
uniform float uP_fov;
uniform float uP_stepScale;
uniform float uP_maxDist;

#define AA 1
#define MAX_STEPS 256

mat3 transpose3(mat3 m) {
  return mat3(
    m[0][0], m[1][0], m[2][0],
    m[0][1], m[1][1], m[2][1],
    m[0][2], m[1][2], m[2][2]
  );
}

// An artistic tumble, not an orthonormal rotation — the axes shear against each
// other so the shell never repeats a clean spin.
mat3 coronaRot(float a) {
  return mat3(
    cos(a), sin(a / 2.0) * sin(a), sin(a) * cos(a / 2.0),
    0.0, cos(a / 2.0), -sin(a / 2.0),
    -sin(a), sin(a / 2.0) * cos(a), cos(a / 2.0) * cos(a)
  );
}

mat3 globalRot;
mat3 globalInvRot;

// Volume-reactive values, resolved once per fragment in main().
float shellRadius;
float warpAmount;
float rayGain;
float warpFreqNow;
float smoothKNow;

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float coronaSDF(vec3 p) {
  vec3 p1 = p;
  p1.zyx += sin(p.xzy * warpFreqNow) / max(warpAmount, 0.001);
  return -smin(length(p1) - shellRadius, shellRadius - length(p), smoothKNow);
}

vec3 shellColor(vec3 p) {
  float eps = 0.001;
  vec3 normal = globalInvRot * normalize(vec3(
    coronaSDF(p + vec3(eps, 0.0, 0.0)) - coronaSDF(p - vec3(eps, 0.0, 0.0)),
    coronaSDF(p + vec3(0.0, eps, 0.0)) - coronaSDF(p - vec3(0.0, eps, 0.0)),
    coronaSDF(p + vec3(0.0, 0.0, eps)) - coronaSDF(p - vec3(0.0, 0.0, eps))
  ));

  vec3 next = 1.0 - (normal * 0.5 + 0.5);
  next = vec3(dot(next, vec3(1.0)) / 3.0);
  return 1.025 - next * next;
}

vec4 coronaRender(vec2 fragCoord) {
  vec2 uv = (fragCoord * 2.0 - uRes) / min(uRes.x, uRes.y);

  vec3 ro = vec3(0.0, 0.0, -uP_camDist);
  vec3 rd = normalize(vec3(uv, uP_fov));

  ro = globalRot * ro;
  rd = globalRot * rd;

  vec3 p = ro;
  float d = 1.0;
  float t = 0.0;
  float godrays = 0.0;

  for (int i = 0; i < MAX_STEPS; i++) {
    if (d <= 0.005 || t >= uP_maxDist) break;
    p = ro + rd * t;
    d = coronaSDF(p) / max(uP_stepScale, 0.5);

    // Gate the accumulation on the shell so light bleeds out of the hollow
    // instead of glowing uniformly through empty space.
    float fog = length(p) > shellRadius
      ? smoothstep(0.0, 0.5, coronaSDF(normalize(p) * shellRadius))
      : 1.0;
    godrays += (rayGain / (1.0 + dot(p, p) * uP_rayFalloff)) * fog;

    t += d;
  }

  vec3 col = vec3(uP_ambient);
  if (t < uP_maxDist) col = shellColor(p) * uP_surfaceLit;
  col += godrays;

  return vec4(col, 1.0);
}

void main() {
  float animTime = uP_speed; // integrated clock
  globalRot = coronaRot(animTime);
  globalInvRot = transpose3(coronaRot(animTime));

  /*
    One shared BACK-AND-FORTH phase for the swept values. sin() of an
    integrated clock is a true round trip — it eases through both ends
    instead of snapping at a wrap, which fract() or mod() would do.

    Every swept value is resolved HERE, once per fragment, and never read
    straight from its uniform inside coronaSDF: the normal estimate calls
    that SDF six more times, and a value that moved between those calls
    would corrupt the finite difference and pit the shading.

    uP_sweepRate is its own integrated clock, so the breathing rate tunes
    without jumping the phase, and it only ever enters through sin() —
    safe for an unbounded clock. All three swings share the phase, so the
    shell breathes as one motion rather than three unrelated wobbles.
  */
  float sweepPhase = sin(uP_sweepRate);

  // Louder agent output pushes the godrays; user input roughens the shell and
  // swells it slightly, so the silhouette breathes with speech.
  shellRadius = uP_radius + uP_swell * uInput;
  warpAmount = (uP_warp + uP_warpSwing * sweepPhase) * (1.0 - 0.25 * uInput - 0.15 * uOutput);
  warpAmount = max(warpAmount, 0.05);
  rayGain = uP_rayGain * (0.7 + 0.8 * uOutput + 0.3 * uInput);

  warpFreqNow = max(uP_warpFreq + uP_freqSwing * sweepPhase, 0.05);

  /*
    smoothK reaches EXACTLY zero at the bottom of the speaking sweep
    (0.25 +/- 0.25), and smin() divides by it — an unguarded zero is a
    NaN across the whole SDF. The floor keeps the blend hard but finite.
  */
  smoothKNow = max(uP_smoothK + uP_smoothSwing * sweepPhase, 0.005);

  vec4 acc = vec4(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 offset = vec2(float(mx), float(my)) / float(AA) - 0.5;
      acc += coronaRender((vUv * uRes) + offset);
    }
  }
  acc /= float(AA * AA);
#else
  acc = coronaRender((vUv * uRes));
#endif

  // Luminance becomes alpha so the orb composites onto the page instead of
  // painting an opaque square.
  //
  // The colour is emitted light, so it is already premultiplied: rgb is what
  // the orb adds, alpha is only how much background it hides. Multiplying rgb
  // by alpha again (the usual move for a lit surface) would darken the glow
  // quadratically and wash the godrays out.
  vec3 col = clamp(acc.rgb, 0.0, 1.0);
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float a = clamp(lum * uP_alphaGain, 0.0, 1.0);

  // The godrays are volumetric, so they reach the frame boundary and would
  // otherwise show the canvas as a hard-edged glowing square. Taper radially to
  // let the halo fall off into the page instead — colour as well as alpha,
  // since premultiplied output would otherwise keep emitting at full brightness
  // right up to the cutoff and leave a visible rim.
  float fade = 1.0 - smoothstep(uP_edgeFade, 1.0, length(orbUV()));
  col *= fade;
  a *= fade;

  fragColor = vec4(col, a);
}
`;

// Original Orbkit shader by zzzzshawn. MIT, see licenses/Orbkit.txt.
// shdr-32
const shdr32 = `#version 300 es
${helpers}
uniform float uP_spin;
uniform float uP_churn;
uniform float uP_beat;
uniform float uP_twinkle;
uniform float uP_camDist;
uniform float uP_focal;
uniform float uP_envRadius;
uniform float uP_tilt;
uniform float uP_arms;
uniform float uP_wind;
uniform float uP_ragged;
uniform float uP_armSharp;
uniform float uP_falloff;
uniform float uP_thick;
uniform float uP_bulge;
uniform float uP_core;
uniform float uP_turbScale;
uniform float uP_threshold;
uniform float uP_density;
uniform float uP_absorb;
uniform float uP_stars;
uniform float uP_starDensity;
uniform float uP_starScale;
uniform float uP_hueReach;
uniform float uP_pulse;
uniform float uP_breathe;
uniform float uP_exposure;
uniform float uP_contrast;
uniform float uP_saturation;
uniform float uP_alphaGain;
uniform float uP_fill;
uniform float uP_rim;
uniform float uP_edge;
uniform float uP_edgeFade;
uniform vec3 uC_tint;
uniform vec3 uC_core;
uniform vec3 uC_inner;
uniform vec3 uC_outer;
uniform vec3 uC_deep;
uniform vec3 uC_rim;

#define STEPS 56
#define TURB_OCT 4

// Volume-reactive values, resolved once per fragment in main().
float galDensity;
float galCore;
float galFalloff;

/*
  The galactic density at a point in the galaxy's own frame: the disc lies
  in xz, the normal is y. Returns the density; writes the arm weight and the
  cylindrical radius for the colour.
*/
float galaxy(vec3 p, float t, out float arm, out float rho) {
  rho = length(p.xz);
  float h = p.y;
  // atan(0, 0) is undefined; the exact axis is all bulge anyway
  float phi = rho > 1e-4 ? atan(p.z, p.x) : 0.0;
  float lr = log(max(rho, 0.02));
  float armPhase = phi * uP_arms - uP_wind * lr;

  // feedback curl turbulence, shared phase
  vec3 q = p * uP_turbScale;
  float f = 1.0;
  for (int k = 0; k < TURB_OCT; k++) {
    q += cos(q.yzx * f + t) / f;
    f *= 1.9;
  }
  float n = (sin(q.x) + sin(q.y) + sin(q.z)) / 3.0 * 0.5 + 0.5;
  float clump = smoothstep(uP_threshold, 1.0, n);

  arm = 0.5 + 0.5 * cos(armPhase + (n - 0.5) * uP_ragged);
  arm = pow(arm, uP_armSharp);

  float scaleH = uP_thick * (0.12 + rho);
  float disc = exp(-rho * galFalloff) * exp(-abs(h) / scaleH);
  float bulge = exp(-dot(p, p) * uP_bulge);

  float dens = disc * (0.08 + 1.6 * arm) * (0.25 + 0.75 * clump) + bulge * galCore;
  return dens * galDensity;
}

/*
  One lattice of hashed stars. Each cell either carries a star or not, at a
  hashed position, with its own twinkle rate; the 3x3 neighbourhood is
  gathered so a star near a cell wall is not clipped.
*/
float starField(vec2 p, float density, float size, float twinkleT) {
  vec2 id = floor(p);
  vec2 f = fract(p);
  float acc = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 cid = id + o;
      float h = hash(cid);
      if (h > density) continue;
      vec2 sp = o + vec2(hash(cid + 1.3), hash(cid + 2.7));
      float dd = length(f - sp);
      float tw = 0.55 + 0.45 * sin(twinkleT * (1.5 + 5.0 * hash(cid + 5.1)) + h * 40.0);
      float sz = size * (0.5 + 1.2 * hash(cid + 8.9) * hash(cid + 8.9));
      acc += tw * exp(-dd * dd / (sz * sz)) * (0.4 + 0.6 * h / max(density, 0.001));
    }
  }
  return acc;
}

vec4 galaxyRender(vec2 fragCoord) {
  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  vec3 ro = vec3(0.0, 0.0, uP_camDist);
  vec3 rd = normalize(vec3(uv, -uP_focal));

  float t = uP_churn; // integrated clock: the turbulence boils
  float spin = uP_spin; // integrated clock: the disc turns

  // the galaxy frame: tip about x by the tilt, then turn about the disc's
  // own normal
  float ct = cos(uP_tilt);
  float st = sin(uP_tilt);
  float cs = cos(spin);
  float sn = sin(spin);

  vec3 acc = vec3(0.0);
  vec3 T = vec3(1.0);
  // extinction weighted to blue, so thick gas reddens what is behind it
  vec3 absorb = vec3(0.7, 1.0, 1.5) * uP_absorb;

  // march only the span the envelope can light
  float z = max(uP_camDist - uP_envRadius * 1.05, 0.0);
  float zEnd = uP_camDist + uP_envRadius * 1.05;
  float dt = (zEnd - z) / float(STEPS);
  // a hashed start offset per pixel hides the step banding
  z += dt * hash(fragCoord * 0.37);

  for (int i = 0; i < STEPS; i++) {
    vec3 p = ro + rd * z;

    // envelope: nothing outside the ball contributes
    float env = 1.0 - smoothstep(uP_envRadius * 0.92, uP_envRadius, length(p));
    if (env > 0.001) {
      // into the galaxy frame
      vec3 g = vec3(p.x, p.y * ct - p.z * st, p.y * st + p.z * ct);
      g = vec3(g.x * cs - g.z * sn, g.y, g.x * sn + g.z * cs);

      float arm = 0.0;
      float rho = 0.0;
      float d = galaxy(g / uP_envRadius, t, arm, rho) * env;

      // the colour ramp, keyed to radius from the core
      vec3 ramp = mix(uC_inner, uC_outer, smoothstep(0.12, uP_hueReach, rho));
      float coreW = exp(-rho * rho * uP_bulge * 0.6);
      vec3 emit = mix(ramp, uC_core, coreW) * (0.6 + 0.6 * arm);

      acc += T * d * emit * dt;
      T *= exp(-d * absorb * dt);
    }

    z += dt;
    if (T.g < 0.004 || z > zEnd) break;
  }

  return vec4(acc, 1.0 - T.g);
}

void main() {
  // The beat: one wave on the core-beat clock, shared by the core flare and
  // the disc's breathing. Both depths are amplitudes, so they stage cleanly.
  float wave = 0.5 + 0.5 * cos(uP_beat);
  galDensity = uP_density * (1.0 + 0.35 * uInput);
  galCore = uP_core * (1.0 + 0.7 * uOutput) * (1.0 + uP_pulse * wave);
  // breathing: the disc's falloff relaxes on the wave, so the whole disc
  // swells outward and draws back — a smooth exponential, safe to sweep
  galFalloff = uP_falloff / (1.0 + uP_breathe * wave);

  vec4 acc = galaxyRender((vUv * uRes));

  /*
    Stars, at the ray's exact hit with the galactic plane. The plane is the
    tilted xz-plane through the origin; its world normal is the tilted y.
    The lattice lives in the disc's own turning frame, so the stars turn
    with the gas, and the march's transmittance dims them through the dust.
  */
  {
    vec3 ro = vec3(0.0, 0.0, uP_camDist);
    vec3 rd = normalize(vec3(orbUV(), -uP_focal));
    float ct = cos(uP_tilt);
    float st = sin(uP_tilt);
    vec3 N = vec3(0.0, ct, st);
    float denom = dot(N, rd);
    if (abs(denom) > 1e-4) {
      float th = -dot(N, ro) / denom;
      vec3 q = ro + rd * th;
      if (th > 0.0 && dot(q, q) < uP_envRadius * uP_envRadius * 0.9) {
        vec3 g = vec3(q.x, q.y * ct - q.z * st, q.y * st + q.z * ct) / uP_envRadius;
        float cs = cos(uP_spin);
        float sn = sin(uP_spin);
        vec2 gp = vec2(g.x * cs - g.z * sn, g.x * sn + g.z * cs);
        float rho = length(gp);
        float phi = rho > 1e-4 ? atan(gp.y, gp.x) : 0.0;
        float armW = 0.5 + 0.5 * cos(phi * uP_arms - uP_wind * log(max(rho, 0.02)));
        float sf = starField(gp * uP_starScale, uP_starDensity * (0.3 + 0.7 * armW), 0.12, uP_twinkle);
        float veil = 1.0 - acc.a; // what the march let through
        acc.rgb += vec3(1.0, 0.97, 0.9) * sf * uP_stars * exp(-rho * 1.5) * (0.25 + 0.75 * veil);
      }
    }
  }

  // tanh tone map per channel, tunable knee
  vec3 col = tanh3(acc.rgb / max(uP_exposure, 0.01));
  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));

  // saturation about luminance, then the tint
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);
  col *= uC_tint;

  // alpha from the brightest channel — emitted light (see shdr-18)
  float peak = max(col.r, max(col.g, col.b));
  float a = clamp(peak * uP_alphaGain, 0.0, 1.0);

  // the night behind: a fill so the ball is a solid sphere, not a cut-out
  col += uC_deep * uP_fill;
  a = max(a, uP_fill);

  // Analytic silhouette — identical construction to shdr-01: exact
  // ray-to-centre distance against the radius, colour AND alpha.
  vec3 mrd = normalize(vec3(orbUV(), -uP_focal));
  float closest = length(cross(vec3(0.0, 0.0, uP_camDist), mrd));
  float band = mix(0.35, 0.012, clamp(uP_edge, 0.0, 1.0));
  float mask = 1.0 - smoothstep(uP_envRadius * (1.0 - band), uP_envRadius * 1.005, closest);
  col *= mask;
  a *= mask;

  // a fresnel rim on the glass, inside the mask
  float fres = smoothstep(uP_envRadius * 0.7, uP_envRadius, closest);
  col += uC_rim * uP_rim * fres * fres * mask;

  // safety taper at the frame boundary — colour as well as alpha
  float r2d = length(orbUV());
  float fade = 1.0 - smoothstep(uP_edgeFade, 1.0, r2d);
  col *= fade;
  a *= fade;

  // Emitted light, so rgb is already premultiplied — do NOT scale by alpha
  // again (see the same note in shdr-31).
  fragColor = vec4(col, a);
}
`;

// Original Orbkit shader by zzzzshawn. MIT, see licenses/Orbkit.txt.
// shdr-33
const shdr33 = `#version 300 es
${helpers}
uniform float uP_speed;
uniform float uP_spin;
uniform float uP_radius;
uniform float uP_scale;
uniform float uP_freq;
uniform float uP_warp;
uniform float uP_lo;
uniform float uP_hi;
uniform float uP_gain;
uniform float uP_jitter;
uniform float uP_bands;
uniform float uP_banding;
uniform float uP_contrast;
uniform float uP_dither;
uniform float uP_dots;
uniform float uP_dotGain;
uniform float uP_dotSoft;
uniform float uP_misregister;
uniform float uP_ink;
uniform float uP_printMix;
uniform float uP_grain;
uniform float uP_grainSize;
uniform float uP_light;
uniform float uP_rim;
uniform vec3 uC_cold;
uniform vec3 uC_cool;
uniform vec3 uC_warm;
uniform vec3 uC_hot;
uniform vec3 uC_core;
uniform vec3 uC_paper;

const float PI = 3.14159265359;

// Volume-reactive values, resolved once per fragment in main().
float heatGainNow;
float heatJitterNow;

float grainNoise(vec2 gpix, float frame, float seed) {
  return hash(gpix + vec2(frame * 13.71 + seed, frame * 7.37 - seed));
}

mat2 rot2(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

/*
  One ink screen. Square dots on a grid at angle a, offset o (the
  misregistration), sized by the coverage: coverage 0 is paper, coverage 1
  is a solid. Returns how much of this pixel the ink covers.

  The grid is laid in SCREEN space, not on the wrapped plane: a print is
  flat, and it is the picture that curves round the ball. A screen on the
  wrapped coordinates changes pitch toward the limb and beats against the
  other two into moire rings.
*/
float screen(vec2 uv, float a, vec2 o, float coverage, float soft) {
  vec2 cell = rot2(a) * uv * uP_dots + o;
  vec2 f = fract(cell) - 0.5;
  float d = length(f); // a round dot: reads as tone, not as a grid
  // dot half-size from coverage; sqrt so mid-tones read as mid-tones the
  // way a real screen's area does
  float size = 0.5 * sqrt(clamp(coverage * uP_dotGain, 0.0, 1.0));
  return 1.0 - smoothstep(size - soft, size + soft, d);
}

void main() {
  heatGainNow = uP_gain * (1.0 + 0.6 * uOutput);
  heatJitterNow = uP_jitter * (1.0 + 1.5 * uInput);

  vec2 uv = orbUV();
  float rd = length(uv);
  float R = uP_radius;
  float mask = smoothstep(0.012, -0.012, rd - R);

  if (mask <= 0.0) {
    fragColor = vec4(0.0);
    return;
  }

  vec2 pl = uv / R;
  float r2 = dot(pl, pl);
  float z = sqrt(max(1.0 - r2, 0.0));
  vec3 n = vec3(pl, z);

  // roll the dome about Y on its own integrated clock
  float cr = cos(uP_spin);
  float sr = sin(uP_spin);
  vec3 sp = vec3(n.x * cr - n.z * sr, n.y, n.x * sr + n.z * cr);

  float t = uP_speed; // integrated clock: the sources drift

  // stereographic wrap of the plane onto the ball
  vec2 st = sp.xy / (1.3 + sp.z) * uP_scale;

  /*
    The heat: a drifting, domain-warped noise field with a threshold window
    cut out of it. Two drifts at different rates so the pools travel and
    change shape rather than slide as one sheet; the input jitter is a fast
    wobble on top.
  */
  vec2 p = st * uP_freq + vec2(t * 0.11, -t * 0.07);
  vec2 wp = st * uP_freq * 0.55 + vec2(-t * 0.05, t * 0.08);
  vec2 warp = vec2(noise(wp + 3.1), noise(wp + 9.4)) - 0.5;
  p += warp * uP_warp;
  p += vec2(sin(t * 3.7), cos(t * 4.3)) * heatJitterNow;
  float field = noise(p) * 0.62 + noise(p * 2.1 + 5.3) * 0.26 + noise(p * 4.2 + 1.7) * 0.12;
  float heat = clamp((field - uP_lo) * heatGainNow / max(uP_hi - uP_lo, 0.01), 0.0, 1.0);

  // grain tap 1: dither the field before it is banded, so the contour
  // edges break up into speckle instead of clean steps
  vec2 gpix = floor((vUv * uRes) / max(uP_grainSize, 1.0));
  float frame = floor(uTime * 48.0);
  heat += (grainNoise(gpix, frame, 3.1) - 0.5) * uP_dither;

  // the contours: quantize into bands, blend back with the smooth field
  float banded = floor(heat * uP_bands + 0.5) / uP_bands;
  heat = clamp(mix(heat, banded, uP_banding), 0.0, 1.0);
  heat = pow(heat, uP_contrast);

  // the thermal ramp
  vec3 base = mix(uC_cold, uC_cool, smoothstep(0.0, 0.3, heat));
  base = mix(base, uC_warm, smoothstep(0.3, 0.55, heat));
  base = mix(base, uC_hot, smoothstep(0.55, 0.78, heat));
  base = mix(base, uC_core, smoothstep(0.78, 0.97, heat));

  /*
    The print. Separate the palette into CMY coverage and lay each ink down
    as its own screen; the paper shows through the gaps. The angles are the
    classic offsets, scaled by the misregistration, plus a per-ink shift.
  */
  float soft = uP_dotSoft;
  float mis = uP_misregister;
  float cC = screen(uv, 0.035 * mis, vec2(0.22, 0.12) * mis, 1.0 - base.r, soft);
  float cM = screen(uv, -0.03 * mis, vec2(-0.14, 0.2) * mis, 1.0 - base.g, soft);
  float cY = screen(uv, 0.0, vec2(0.0), 1.0 - base.b, soft);

  vec3 print = uC_paper;
  print *= mix(vec3(1.0), vec3(0.05, 0.62, 0.92), cC * uP_ink);
  print *= mix(vec3(1.0), vec3(0.92, 0.08, 0.48), cM * uP_ink);
  print *= mix(vec3(1.0), vec3(0.98, 0.86, 0.02), cY * uP_ink);

  // the unprinted palette is mixed back a little so the blacks stay black
  // and the screens never wash the whole ball to paper
  vec3 col = mix(base, print, uP_printMix);

  // grain tap 2: paper
  col *= 1.0 + (grainNoise(gpix, frame, 27.9) - 0.5) * uP_grain;

  // dome shading keeps the ball a ball under the print
  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0, 1.0);
  col *= 1.0 - uP_light * (1.0 - lambert);
  float fres = pow(1.0 - z, 2.5);
  col += uC_paper * uP_rim * fres * 0.5;

  // Surface orb bounded by a mask: alpha IS coverage, so premultiply — the
  // opposite convention from the emissive orbs (see shdr-31).
  float a = mask;
  fragColor = vec4(max(col, vec3(0.0)) * a, a);
}
`;

export const orbVariants = {
  "shdr-01": {
    fragment: shdr01,
    notice: "/*\n * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's\n * permission. Non-commercial use only, with attribution to XorDev; keep this\n * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.\n */\n",
    params: {
      speed: 0.5, spin: 0.25, camDist: 7, focal: 2.25,
      tilt: 0.5, turb: 0.3, sheets: 7, disperse: 1,
      stria: 1, envRadius: 2.6, envCore: 1, fill: 1.5,
      stepClamp: 20, scatter: 0.02, exposure: 60, contrast: 1,
      saturation: 1, alphaGain: 2, edge: 1, edgeFade: 0.98,
    },
    clocks: ["speed", "spin"],
    colors: {"tint": "#ffffff"},
  },
  "shdr-02": {
    fragment: shdr02,
    notice: "/*\n * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's\n * permission. Non-commercial use only, with attribution to XorDev; keep this\n * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.\n */\n",
    params: {
      speed: 0.5, swirl: 0.06, radius: 0.9, swell: 0.06,
      zoom: 4.4, bulge: 0.35, warpFreq: 1.5, hueShift: 0,
      coreClamp: 0.12, falloff: 1, gain: 0.55, rim: 0.12,
      rimPow: 2.2, alphaGain: 2.4, baseVis: 0.08,
    },
    clocks: ["speed"],
    colors: {},
  },
  "shdr-03": {
    fragment: shdr03,
    notice: "/*\n * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's\n * permission. Non-commercial use only, with attribution to XorDev; keep this\n * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.\n */\n",
    params: {
      speed: 0.6, wander: 0.3, feedback: 2, camDist: 5,
      focal: 1.05, shellR: 2, shellW: 0.085, plane: 0.085,
      turb: 1.54, width: 0.001, pulse: 0, surge: 0,
      hue: 39.8, spread: 0.94, envRadius: 3.3, envCore: 1.02,
      fill: 0.1, stepClamp: 1475, scatter: 0.0006, exposure: 1450,
      contrast: 1.2, saturation: 1.25, alphaGain: 2, edge: 1,
      edgeFade: 0.98,
    },
    clocks: ["speed", "wander"],
    colors: {"tint": "#ffffff"},
  },
  "shdr-04": {
    fragment: shdr04,
    notice: "/*\n * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's\n * permission. Non-commercial use only, with attribution to XorDev; keep this\n * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.\n */\n",
    params: {
      speed: 0.6, camDist: 9, focal: 1.35, shellR: 5,
      pitch: 0.3, turb: 0.45, slack: 0.1, width: 0.003,
      hueGain: 1, floorLevel: 0.8, envScale: 1.16, exposure: 3000,
      contrast: 1.3, saturation: 1.3, alphaGain: 2, edge: 1,
      edgeFade: 0.98,
    },
    clocks: ["speed"],
    colors: {"tint": "#ffffff"},
  },
  "shdr-05": {
    fragment: shdr05,
    notice: "/*\n * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's\n * permission. Non-commercial use only, with attribution to XorDev; keep this\n * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.\n */\n",
    params: {
      ring: 0.9, swirl: 0.195, slide: 0.26, radius: 0.9,
      scale: 5, bulge: 0, lens: 0.38, poleSoft: 0.012,
      freq: 1.05, spread: 0.7, gain: 1.1, contrast: 1,
      saturation: 1.14, floorLevel: 0.12, light: 0.66, rim: 0.45,
    },
    clocks: ["ring", "swirl", "slide"],
    colors: {"tint": "#ffffff", "body": "#141a30", "sheen": "#bcd8ff"},
  },
  "shdr-06": {
    fragment: shdr06,
    notice: "/*\n * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's\n * permission. Non-commercial use only, with attribution to XorDev; keep this\n * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.\n */\n",
    params: {
      speed: 0.5, drift: 0.02, radius: 0.9, scale: 4,
      bulge: 0.3, depth: 0.7, freq: 0.7, glowSize: 0.05,
      hueRate: 0.037, exposure: 4, contrast: 1.1, saturation: 1.2,
      light: 0.45, rim: 0.4,
    },
    clocks: ["speed"],
    colors: {"tint": "#ffffff", "sheen": "#bcd8ff"},
  },
  "shdr-07": {
    fragment: shdr07,
    notice: "/*\n * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's\n * permission. Non-commercial use only, with attribution to XorDev; keep this\n * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.\n */\n",
    params: {
      speed: 0.5, wave: 0.7, twist: 1, spin: 0.1,
      tilt: 0.3, camDist: 7, focal: 2.25, turb: 1,
      column: 0, stepScale: 0.1, hueDepth: 0.75, hueStep: 0.45,
      envRadius: 2.6, envCore: 0.88, fill: 0.15, stepClamp: 400,
      scatter: 0.01, exposure: 60, contrast: 1.3, saturation: 1.15,
      alphaGain: 2, edge: 1, edgeFade: 0.98,
    },
    clocks: ["speed", "wave", "spin"],
    colors: {"tint": "#ffffff"},
  },
  "shdr-08": {
    fragment: shdr08,
    notice: "/*\n * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's\n * permission. Non-commercial use only, with attribution to XorDev; keep this\n * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.\n */\n",
    params: {
      speed: 0.37, flow: 0.24, swirl: 0.06, radius: 0.9,
      scale: 5.5, bulge: 0.8, warp: 0.96, beat: 0,
      thick: 0.54, split: 0.1, iris: 1.02, irisScale: 0.315,
      view: 1.34, floor: 0.57, gain: 2.45, contrast: 1.65,
      light: 0.75, rim: 0.495,
    },
    clocks: ["speed", "flow", "swirl"],
    colors: {"deep": "#0d1430", "low": "#2fb8c6", "crest": "#fff1de", "sheen": "#bfe4ff"},
  },
  "shdr-09": {
    fragment: shdr09,
    notice: "/*\n * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's\n * permission. Non-commercial use only, with attribution to XorDev; keep this\n * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.\n */\n",
    params: {
      speed: 0.6, spin: 0.12, tilt: 0.4, radius: 0.9,
      scale: 3.5, warp: 0.45, seed: 0.9, glow: 0.05,
      lineSoft: 0.05, inner: 3, fringe: 0.1, fringeSoft: 0.003,
      ringPhase: 0.8, exposure: 1.1, contrast: 1.15, saturation: 1.2,
      light: 0.5, rim: 0.4,
    },
    clocks: ["speed", "spin"],
    colors: {"tint": "#ffffff", "sheen": "#b9d6ff"},
  },
  "shdr-10": {
    fragment: shdr10,
    notice: "/*\n * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's\n * permission. Non-commercial use only, with attribution to XorDev; keep this\n * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.\n */\n",
    params: {
      speed: 0.6, scroll: 1.2, camDist: 7, focal: 2,
      shellR: 2.6, wrap: 8, climb: 4, turb: 0.35,
      layer: 0.5, cell: 0.45, stepScale: 0.15, hueStep: 0.4,
      spread: 1, envRadius: 2.9, envCore: 0.92, fill: 0.1,
      stepClamp: 300, scatter: 0.004, exposure: 30, contrast: 1.15,
      saturation: 1.2, alphaGain: 2, edge: 1, edgeFade: 0.98,
    },
    clocks: ["speed", "scroll"],
    colors: {"tint": "#ffffff"},
  },
  "shdr-11": {
    fragment: shdr11,
    notice: "// Original Orbkit shader by zzzzshawn. MIT, see licenses/Orbkit.txt.\n",
    params: {
      speed: 0.9, rotSpeed: 0.5, radius: 0.9, swell: 0.07,
      posScale: 0.5, flowSpeed: 0.35, flowAmp: 0.45, flowScale: 0.3,
      precess: 0.3, radialPow: 0.5, radialDecay: 1, probPow: 0.4,
      probGain: 3, waveFreq: 4, chromaSpread: 0.18, glow: 0.9,
      metalDark: 0, baseVis: 0.12,
    },
    clocks: ["speed", "flowSpeed"],
    colors: {},
  },
  "shdr-12": {
    fragment: shdr12,
    notice: "// Original Orbkit shader by zzzzshawn. MIT, see licenses/Orbkit.txt.\n",
    params: {
      spin: 0.25, tilt: 0.55, rebuild: 0.4, gap: 0.07,
      studs: 18, radius: 0.95, patch: 0.35, stud: 0.85,
      seam: 0.6, gloss: 1, light: 1, gain: 1,
      contrast: 1,
    },
    clocks: ["spin", "rebuild"],
    colors: {"brickA": "#c4281c", "brickB": "#f2cd37", "brickC": "#1e5aa8", "brickD": "#00852b", "brickE": "#f4f4f4"},
  },
  "shdr-13": {
    fragment: shdr13,
    notice: "// Original Orbkit shader by zzzzshawn. MIT, see licenses/Orbkit.txt.\n",
    params: {
      speed: 1, spin: 0.2, camDist: 7, focal: 2.25,
      envRadius: 2.6, swell: 0.15, tilt: 0.4, fils: 6,
      writhe: 0.9, writheFreq: 1.6, sharp: 4, soft: 0.06,
      whiten: 0.008, coreGain: 1.6, tipGain: 1.8, fill: 0.02,
      stepClamp: 40, scatter: 0.012, exposure: 11, contrast: 1,
      saturation: 1.2, alphaGain: 2.5, edge: 1,
    },
    clocks: ["speed", "spin"],
    colors: {"inner": "#ff70d8", "arc": "#5a5cff", "tint": "#ffffff"},
  },
  "shdr-14": {
    fragment: shdr14,
    notice: "// Original Orbkit shader by zzzzshawn. MIT, see licenses/Orbkit.txt.\n",
    params: {
      speed: 0.5, spin: 0.15, radius: 0.9, cells: 140,
      levels: 3, scale: 1.5, plasma: 0.9, light: 0.9,
      rim: 0.35, gain: 1, contrast: 1.1,
    },
    clocks: ["speed", "spin"],
    colors: {"ink": "#101426", "paper": "#cfe6ff"},
  },
  "shdr-15": {
    fragment: shdr15,
    notice: "/*\n * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's\n * permission. Non-commercial use only, with attribution to XorDev; keep this\n * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.\n */\n",
    params: {
      speed: 0.4, wander: 0.12, camDist: 7, focal: 2.25,
      fieldScale: 2.4, turb: 0.75, stepScale: 0.015, disperse: 1,
      envRadius: 2.6, envCore: 1, fill: 0.3, stepClamp: 150,
      scatter: 0.01, exposure: 72, contrast: 1.35, saturation: 1.35,
      alphaGain: 2, edge: 1, edgeFade: 0.98,
    },
    clocks: ["speed", "wander"],
    colors: {"tint": "#ffffff"},
  },
  "shdr-16": {
    fragment: shdr16,
    notice: "// Original Orbkit shader by zzzzshawn. MIT, see licenses/Orbkit.txt.\n",
    params: {
      flow: 0.92, spin: 0.09, swellRate: 0.6, radius: 0.9,
      scale: 9, warp: 0.8, edge: 3, split: 0.6,
      swell: 0.15, gain: 6, contrast: 1.3, light: 0.9,
      rim: 0.6,
    },
    clocks: ["flow", "spin", "swellRate"],
    colors: {"deep": "#6f0b0b", "sun": "#7ff6ff", "sheen": "#bfe8ff"},
  },
  "shdr-17": {
    fragment: shdr17,
    notice: "// Original Orbkit shader by zzzzshawn. MIT, see licenses/Orbkit.txt.\n",
    params: {
      speed: 0.9, spin: 0.12, radius: 0.9, scale: 2.4,
      bands: 6, shear: 1.1, warp: 2.2, churn: 1.4,
      gain: 1.15, contrast: 1.35, grain: 0.4, filmGrain: 0.35,
      grainSize: 2, rainbow: 0.65, flashRate: 1.6, flash: 0.7,
      light: 0.85, rim: 0.5,
    },
    clocks: ["speed", "spin"],
    colors: {"deep": "#2a0f4e", "low": "#0fd0c3", "mid": "#ff5e9d", "hot": "#ffd166", "flash": "#eaf4ff"},
  },
  "shdr-18": {
    fragment: shdr18,
    notice: "/*\n * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's\n * permission. Non-commercial use only, with attribution to XorDev; keep this\n * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.\n */\n",
    params: {
      wander: 0.5, camDist: 4, focal: 1.5, fold: 1,
      crease: 1, freq: 5, stepScale: 0.3, hue: 1.5,
      spread: 1, envRadius: 2.1, envCore: 0.9, fill: 0.02,
      stepClamp: 40, scatter: 0.004, exposure: 18, contrast: 1.2,
      saturation: 1.25, alphaGain: 2, edge: 1, edgeFade: 0.98,
    },
    clocks: ["wander"],
    colors: {"tint": "#ffffff"},
  },
  "shdr-19": {
    fragment: shdr19,
    notice: "/*\n * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's\n * permission. Non-commercial use only, with attribution to XorDev; keep this\n * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.\n */\n",
    params: {
      speed: 0.52, swirl: 0.045, slide: 0.1, radius: 0.9,
      scale: 10, bulge: 0.08, grow: 0.12, vary: 0.19,
      skew: 0.63, jitter: 0.74, edge: 51, bead: 0,
      gain: 2.28, contrast: 2.6, saturation: 1.1, floorLevel: 0.06,
      light: 0.3, rim: 0.345,
    },
    clocks: ["speed", "swirl", "slide"],
    colors: {"low": "#ffffff", "high": "#eef5ff", "body": "#05070c", "sheen": "#9dbfe4"},
  },
  "shdr-20": {
    fragment: shdr20,
    notice: "/*\n * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's\n * permission. Non-commercial use only, with attribution to XorDev; keep this\n * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.\n */\n",
    params: {
      speed: 0.5, flow: 3, camDist: 7, focal: 2.25,
      tilt: 0.15, stretch: 0.3, foam: 0.3, wall: 3,
      stepScale: 0.2, hueScale: 0.85, envRadius: 2.6, envCore: 1,
      fill: 0.4, stepClamp: 20, scatter: 0.01, exposure: 22,
      contrast: 1.15, saturation: 1.55, alphaGain: 2, edge: 1,
      edgeFade: 0.98,
    },
    clocks: ["speed", "flow"],
    colors: {"tint": "#ffffff"},
  },
  "shdr-21": {
    fragment: shdr21,
    notice: "// Original Orbkit shader by zzzzshawn. MIT, see licenses/Orbkit.txt.\n",
    params: {
      speed: 10, camDist: 4.4, focal: 1.8, radius: 2,
      scale: 0.8, churn: 0.3, threshold: 0.075, edgeSoft: 0.8,
      density: 3.2, absorb: 1.4, shadowAbsorb: 2.4, shadowLift: 0.55,
      aniso: 0.45, lightSpin: 0.12, power: 1.9, ambient: 0.12,
      exposure: 1, alphaGain: 1.5,
    },
    clocks: ["speed"],
    colors: {"light": "#ffd7a3", "shadow": "#3a4a8c"},
  },
  "shdr-22": {
    fragment: shdr22,
    notice: "/*\n * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's\n * permission. Non-commercial use only, with attribution to XorDev; keep this\n * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.\n */\n",
    params: {
      speed: 0.4, wander: 0.1, camDist: 7, focal: 2.25,
      hug: 0.8, turb: 0.55, stepScale: 0.07, hueStep: 0.12,
      hueDepth: 1.4, glow: 1.3, glowFew: 0.12, envRadius: 2.6,
      envCore: 0.88, fill: 0.15, stepClamp: 800, scatter: 0.01,
      exposure: 260, contrast: 1.3, saturation: 1.15, alphaGain: 2,
      edge: 1, edgeFade: 0.98,
    },
    clocks: ["speed", "wander"],
    colors: {"tint": "#ffffff"},
  },
  "shdr-23": {
    fragment: shdr23,
    notice: "// Original Orbkit shader by zzzzshawn. MIT, see licenses/Orbkit.txt.\n",
    params: {
      drift: 0.55, scroll: 0.05, speed: 0.52, pulse: 0,
      spin: 0.12, radius: 0.9, cells: 68, scale: 5.1,
      density: 0.31, dropout: 0.24, light: 1.11, rim: 0.66,
      gain: 0.9, contrast: 1,
    },
    clocks: ["drift", "scroll", "speed", "spin"],
    colors: {"glow": "#6a57ff", "deep": "#0b3b2d"},
  },
  "shdr-24": {
    fragment: shdr24,
    notice: "// Original Orbkit shader by zzzzshawn. MIT, see licenses/Orbkit.txt.\n",
    params: {
      spin: 0.22, tilt: 0.45, drift: 0.12, season: 0.3,
      shuffle: 0.8, radius: 1.15, blocks: 64, rough: 0.45,
      scale: 2.4, sea: 0.5, trees: 0.75, cave: 0.4,
      ore: 0.12, glow: 0.9, core: 0.5, texture: 0.6,
      light: 1, gain: 1, contrast: 1,
    },
    clocks: ["spin", "drift", "season", "shuffle"],
    colors: {"grass": "#6abe30", "dirt": "#6f4a2f", "stone": "#8a8a90", "sand": "#dbcf9c", "water": "#2f66d0", "leaf": "#3e8f27", "ore": "#4de3ff", "lava": "#ff7b26"},
  },
  "shdr-25": {
    fragment: shdr25,
    notice: "/*\n * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's\n * permission. Non-commercial use only, with attribution to XorDev; keep this\n * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.\n */\n",
    params: {
      speed: 3, drift: 0.6, swirl: 0.05, radius: 0.9,
      scale: 7.5, bulge: 0.3, warp: 0.4, zoom: 1.07,
      ripple: 0.3, edgeGain: 12.5, blur: 2.5, fringe: 0.09,
      exposure: 0.8, contrast: 1.15, saturation: 1.5, floorLevel: 0.16,
      light: 0.35, rim: 0.45,
    },
    clocks: ["speed", "drift", "swirl"],
    colors: {"tint": "#dbe8f7", "body": "#0d1118", "sheen": "#a8c8f0"},
  },
  "shdr-26": {
    fragment: shdr26,
    notice: "/*\n * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's\n * permission. Non-commercial use only, with attribution to XorDev; keep this\n * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.\n */\n",
    params: {
      speed: 0.42, swirl: 0.075, drift: 0.18, radius: 0.9,
      scale: 9, bulge: 3.28, warp: 2, pole: 0.13,
      poleSoft: 0.001, pulse: 0.35, sharp: 4.5, split: 0.045,
      core: 2.235, floor: 0.26, gain: 1, contrast: 1.35,
      light: 0.705, rim: 0.45,
    },
    clocks: ["speed", "swirl", "drift"],
    colors: {"deep": "#111a2e", "line": "#3fd2ff", "hot": "#fff4d6", "sheen": "#a9d8ff"},
  },
  "shdr-27": {
    fragment: shdr27,
    notice: "// Original Orbkit shader by zzzzshawn. MIT, see licenses/Orbkit.txt.\n",
    params: {
      speed: 1, spin: 0.27, radius: 0.9, scale: 2.4,
      cells: 34, dot: 0.36, swirl: 1.5, vortex: 0.45,
      freq: 1.6, warp: 0.5, lo: 0.12, hi: 0.82,
      curve: 1.4, dither: 0.12, sparse: 0.16, density: 1,
      twinkle: 3, grain: 0.1, light: 0.18, rim: 0.35,
    },
    clocks: ["speed", "spin"],
    colors: {"paper": "#efe9dc", "c0": "#a9a9a6", "c1": "#2e5df0", "c2": "#38d9ec", "c3": "#22c35c", "c4": "#e8322a", "c5": "#f5d020", "c6": "#e030c0"},
  },
  "shdr-28": {
    fragment: shdr28,
    notice: "/*\n * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's\n * permission. Non-commercial use only, with attribution to XorDev; keep this\n * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.\n */\n",
    params: {
      speed: 1, spin: 0.1, tilt: 0.5, radius: 0.9,
      gridScale: 2, levels: 10, lineW: 2.5, shutter: 1.02,
      gain: 1, body: 0.9, rim: 0.6, rimPow: 5.2,
      contrast: 1.2, edge: 1, edgeFade: 0.98,
    },
    clocks: ["speed", "spin"],
    colors: {"lineA": "#ff1100", "lineB": "#ffffff", "base": "#000000", "rim": "#000000"},
  },
  "shdr-29": {
    fragment: shdr29,
    notice: "// Original Orbkit shader by zzzzshawn. MIT, see licenses/Orbkit.txt.\n",
    params: {
      drift: 0.45, churn: 0.5, swirl: 1.2, shuffle: 0.6,
      pulse: 0, spin: 0.1, radius: 0.9, cells: 48,
      scale: 1.3, coverage: 0.52, confetti: 0.22, light: 0.6,
      gain: 1, contrast: 1,
    },
    clocks: ["drift", "churn", "shuffle", "spin"],
    colors: {"lit": "#fff2dd", "wall": "#161616"},
  },
  "shdr-30": {
    fragment: shdr30,
    notice: "// Original Orbkit shader by zzzzshawn. MIT, see licenses/Orbkit.txt.\n",
    params: {
      fall: 0.12, tilt: 0, drift: 0.2, radius: 0.9,
      scale: 4.5, bulge: 0.2, ratio: 3.06, horizon: -0.11,
      cloudScale: 1.2, cloudCover: 0.42, streakFreq: 2.9, streakRad: 0.54,
      water: 0, flowerScale: 24, flowerDensity: 0.27, flowerSize: 0.43,
      frameShade: 0.62, haze: 0.8, hazeRange: 0.09, gain: 1.38,
      contrast: 1.05, saturation: 1.56, light: 0.345, rim: 0.555,
    },
    clocks: ["fall", "drift"],
    colors: {"sky": "#4a92e0", "cloud": "#f7fbff", "canopy": "#12401f", "meadow": "#5aa63a", "water": "#156f6a", "bloom": "#ff6a3a", "sheen": "#cfe6ff"},
  },
  "shdr-31": {
    fragment: shdr31,
    notice: "/*\n * Shader by XorDev (https://x.com/XorDev), ported for Orbkit with the author's\n * permission. Non-commercial use only, with attribution to XorDev; keep this\n * notice with the file. Orbkit's runtime (orbkit-core.tsx) is MIT-licensed.\n */\n",
    params: {
      speed: 1, sweepRate: 0.5, radius: 2.6, swell: 0.18,
      warp: 0.9, warpFreq: 5.25, warpSwing: 0, freqSwing: 0,
      smoothSwing: 0, smoothK: 0.42, rayGain: 0.8, rayFalloff: 10.5,
      surfaceLit: 0.105, ambient: 0, alphaGain: 3, edgeFade: 0.45,
      camDist: 12, fov: 3.5, stepScale: 9, maxDist: 22,
    },
    clocks: ["speed", "sweepRate"],
    colors: {},
  },
  "shdr-32": {
    fragment: shdr32,
    notice: "// Original Orbkit shader by zzzzshawn. MIT, see licenses/Orbkit.txt.\n",
    params: {
      spin: 0.06, churn: 0.25, beat: 0.8, twinkle: 1.2,
      camDist: 7, focal: 2.25, envRadius: 2.6, tilt: 0.85,
      arms: 2, wind: 3.4, ragged: 3, armSharp: 2.2,
      falloff: 1.7, thick: 0.035, bulge: 40, core: 5,
      turbScale: 9, threshold: 0.35, density: 14, absorb: 3.5,
      stars: 1.2, starDensity: 0.5, starScale: 48, hueReach: 0.6,
      pulse: 0.2, breathe: 0, exposure: 1.1, contrast: 1.15,
      saturation: 1.35, alphaGain: 2, fill: 0.85, rim: 0.35,
      edge: 1, edgeFade: 0.98,
    },
    clocks: ["spin", "churn", "beat", "twinkle"],
    colors: {"tint": "#ffffff", "core": "#fff3d6", "inner": "#7fb4ff", "outer": "#c46bff", "deep": "#04050f", "rim": "#8fb0ff"},
  },
  "shdr-33": {
    fragment: shdr33,
    notice: "// Original Orbkit shader by zzzzshawn. MIT, see licenses/Orbkit.txt.\n",
    params: {
      speed: 0.5, spin: 0.05, radius: 0.9, scale: 3,
      freq: 1.4, warp: 0.6, lo: 0.42, hi: 0.74,
      gain: 1, jitter: 0.015, bands: 7, banding: 0.85,
      contrast: 1, dither: 0.05, dots: 46, dotGain: 1,
      dotSoft: 0.12, misregister: 0.5, ink: 0.92, printMix: 0.28,
      grain: 0.35, grainSize: 2, light: 0.25, rim: 0.25,
    },
    clocks: ["speed", "spin"],
    colors: {"cold": "#0b0a1e", "cool": "#3b2a9a", "warm": "#f05a28", "hot": "#f6b53a", "core": "#fff1e6", "paper": "#f4ecdf"},
  },
};
