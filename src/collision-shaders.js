import { MAX_TILES, mergeFields, orbSampling } from "./shaders.js";

export const paletteFragment = `#version 300 es
precision highp float;
precision highp int;
${orbSampling}
uniform int uType;
in vec2 vUv;
out vec4 fragColor;

float colorScore(vec3 color) {
  float peak = max(color.r, max(color.g, color.b));
  float low = min(color.r, min(color.g, color.b));
  float saturation = (peak - low) / max(peak, 0.001);
  return peak * (0.15 + saturation * 2.0);
}

void main() {
  vec3 fallback = vec3(0.8);
  float fallbackScore = 0.0;
  // A sparse global scan supplies color for transparent sectors of an orb.
  for (int y = 0; y < 5; y++) {
    for (int x = 0; x < 5; x++) {
      vec2 point = (vec2(float(x), float(y)) - 2.0) * 0.32;
      vec3 color = sampleOrb(uType, point).rgb;
      float score = colorScore(color);
      if (score > fallbackScore) {
        fallbackScore = score;
        fallback = color;
      }
    }
  }
  float angle = vUv.x * 6.2831853;
  vec2 direction = vec2(cos(angle), sin(angle));
  vec3 selected = fallback;
  float selectedScore = fallbackScore * 0.20;
  for (int sampleIndex = 0; sampleIndex < 7; sampleIndex++) {
    float radius = 0.12 + float(sampleIndex) * 0.12;
    vec3 color = sampleOrb(uType, direction * radius).rgb;
    float score = colorScore(color);
    if (score > selectedScore) {
      selectedScore = score;
      selected = color;
    }
  }
  // Peak normalization preserves hue for both surface and emissive shaders.
  float peak = max(selected.r, max(selected.g, selected.b));
  vec3 color = selected / max(peak, 0.001);
  fragColor = vec4(color * (0.65 + 0.35 * sqrt(clamp(peak, 0.0, 1.0))), 1.0);
}
`;

const collisionUniforms = `
uniform vec2 uViewport;
uniform vec2 uCenter;
uniform vec2 uAxis;
uniform float uRadius;
uniform float uReach;
uniform float uProgress;
uniform bool uReducedMotion;

mat2 rotate(float angle) {
  float c = cos(angle), s = sin(angle);
  return mat2(c, s, -s, c);
}
`;

// Use the glass's exact connected field for every interior pass.
const interiorMask = `${mergeFields}
float matterMask(vec2 point) {
  float distance = mergedShellDistance(point) + uMerge.x * 0.065;
  float aa = max(0.45, fwidth(distance));
  return 1.0 - smoothstep(-aa, aa, distance);
}
`;

export const collisionVertex = `#version 300 es
precision highp float;
uniform vec4 uBounds;
uniform vec2 uViewport;
out vec2 vPoint;
void main() {
  vec2 uv = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vPoint = mix(uBounds.xy, uBounds.zw, uv);
  gl_Position = vec4(vPoint / uViewport * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
}
`;

// Core and halo layers follow the LensFlare composition model.
// The elongated event horizon, accretion flow and lifecycle are game-specific.
// Source and MIT notice in licenses/shader-effects.md and shader-effects.txt.
export const collisionFragment = `#version 300 es
precision highp float;
${collisionUniforms}
${interiorMask}
uniform sampler2D uScene;
uniform sampler2D uPalette;
uniform float uPaletteRow;
uniform bool uSampledColor;
uniform vec4 uBounds;
uniform float uNight;
uniform int uLayer;
in vec2 vPoint;
out vec4 fragColor;

float square(float x) { return x * x; }

vec3 paletteColor(float phase) {
  return texture(uPalette, vec2(fract(phase), (uPaletteRow + 0.5) / ${MAX_TILES}.0)).rgb;
}

void main() {
  float p = uProgress;
  vec2 boundary = min(vPoint - uBounds.xy, uBounds.zw - vPoint);
  float edgeFade = smoothstep(0.0, uRadius * 0.85, min(boundary.x, boundary.y)) * matterMask(vPoint);
  vec2 normal = vec2(-uAxis.y, uAxis.x);
  vec2 delta = vPoint - uCenter;
  vec2 q = vec2(dot(delta, uAxis), dot(delta, normal));
  float born = smoothstep(0.24, 0.44, p);
  float collapse = smoothstep(0.76, 0.97, p);
  float fade = 1.0 - smoothstep(0.94, 1.0, p);
  float reach = mix(uReach, uRadius * 0.14, collapse);
  float width = uRadius * 0.20 * born * (1.0 - collapse) + 0.45;
  vec2 ellipse = q / vec2(reach, width);
  float horizon = length(ellipse);
  float radial = length(q / vec2(uReach * 0.95, uRadius * 2.1));
  if (uReducedMotion) {
    if (uLayer == 0) discard;
    float glow = exp(-radial * radial * 2.5) * sin(p * 3.14159265) * 0.12;
    vec3 tint = uSampledColor ? paletteColor(p * 0.2) : vec3(1.0, 0.72, 0.40);
    fragColor = vec4(tint * glow, glow) * edgeFade;
    return;
  }

  if (uLayer == 0) {
    float influence = exp(-square(length(q / vec2(reach * 1.12, uRadius * 1.65))));
    influence *= born * fade * edgeFade * 0.92;
    if (influence < 0.002) discard;
    vec2 bent = rotate(influence * 0.16) * delta;
    bent += normal * (q.y / max(length(q), 1.0)) * uRadius * influence * 0.36;
    vec2 uv = (uCenter + bent) / uViewport;
    uv.y = 1.0 - uv.y;
    vec4 scene = texture(uScene, clamp(uv, vec2(0.0), vec2(1.0)));
    fragColor = scene * influence;
    return;
  }

  float aa = max(0.015, fwidth(horizon));
  float core = (1.0 - smoothstep(1.0 - aa, 1.0 + aa, horizon)) * born * fade;
  float angle = atan(ellipse.y, ellipse.x);
  float flow = 0.63 + 0.24 * sin(angle * 3.0 - p * 34.0 + horizon * 2.5)
    + 0.13 * sin(angle * 7.0 + p * 23.0);
  float ring = exp(-square((horizon - 1.13) * 8.0)) * born * fade;
  float hotRing = exp(-square((horizon - 1.07) * 23.0)) * born * fade;
  float veil = exp(-square((horizon - 1.2) * 1.8)) * born * fade * 0.25;
  // A wider orbiting band lends depth to the very narrow event horizon.
  vec2 disk = q / vec2(reach * 1.12, uRadius * (0.42 - collapse * 0.34));
  float diskRadius = length(disk);
  float diskAngle = atan(disk.y, disk.x);
  float spiral = 0.55 + 0.45 * sin(diskAngle * 2.0 - p * 28.0 + diskRadius * 12.0);
  float band = exp(-square((diskRadius - 1.0) * 9.0)) * born * fade * spiral;
  vec3 accent = uSampledColor ? paletteColor(angle / 6.2831853 - p * 0.35)
    : mix(vec3(1.0, 0.26, 0.035), vec3(1.0, 0.68, 0.24), flow);
  vec3 highlight = uSampledColor ? mix(accent, vec3(1.0), 0.22) : vec3(1.0, 0.91, 0.67);
  vec3 glow = accent * (ring * (0.70 + flow) + veil + band * 0.54);
  glow += highlight * hotRing * 0.85;
  float finalGlint = exp(-square((p - 0.94) / 0.025))
    * exp(-square(q.x / (uRadius * 0.6)) - square(q.y / (uRadius * 0.025 + 0.4))) * 0.3;
  glow += (uSampledColor ? mix(paletteColor(p * 0.2), vec3(1.0), 0.25)
    : vec3(1.0, 0.96, 0.82)) * finalGlint;
  glow *= 1.0 - core;
  // Premultiplied source-over keeps warm glare visible against both themes.
  float lightAlpha = clamp(max(glow.r, max(glow.g, glow.b)) * mix(0.78, 0.45, uNight), 0.0, 0.96);
  vec3 color = vec3(0.002, 0.001, 0.006) * core + glow;
  float alpha = core + lightAlpha * (1.0 - core);
  if (alpha < 0.001) discard;
  fragColor = vec4(color, alpha) * edgeFade;
}
`;
