import { orbTypes } from "./orb-types.js";

export const MAX_TILES = 81;

export const atlasVertex = `#version 300 es
out vec2 vUv;

void main() {
  vUv = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  gl_Position = vec4(vUv * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const tileVertex = `#version 300 es
layout(location = 0) in vec4 aShape;
layout(location = 1) in vec4 aBend;
layout(location = 2) in vec4 aCore;
layout(location = 3) in vec4 aLight;

uniform vec2 uViewport;
uniform int uMergeCount;
uniform vec4 uBounds;

out vec2 vPoint;
flat out vec4 vShape;
flat out vec4 vBend;
flat out vec4 vCore;
flat out vec4 vLight;

void main() {
  vec2 uv = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  if (uMergeCount > 0) {
    vPoint = mix(uBounds.xy, uBounds.zw, uv);
  } else {
    float padding = aShape.z * 0.62 + 4.0;
    vPoint = aShape.xy + (uv * 2.0 - 1.0) * (aShape.z + padding);
  }
  gl_Position = vec4(vPoint / uViewport * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
  vShape = aShape;
  vBend = aBend;
  vCore = aCore;
  vLight = aLight;
}
`;

export const mergeFields = `
uniform int uMergeCount;
uniform vec4 uParts[${MAX_TILES}]; // center, connection to the right, connection below
uniform float uSpacing;
uniform vec4 uMerge; // shell half-size, opacity, orb preset, shell join

float roundBox(vec2 point, vec2 halfSize, float radius) {
  vec2 q = abs(point) - halfSize + radius;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

float smoothUnion(float a, float b, float amount) {
  float blend = max(amount - abs(a - b), 0.0) / amount;
  return min(a, b) - blend * blend * amount * 0.25;
}

float mergedShellDistance(vec2 worldPoint) {
  float distance = 1e5;
  float halfSize = uMerge.x;
  float blend = max(0.01, halfSize * 0.91 * uMerge.w);
  float bridge = halfSize * 0.88 * smoothstep(0.36, 0.91, uMerge.w);
  float reach = uSpacing * 0.5;
  for (int i = 0; i < ${MAX_TILES}; ++i) {
    if (i >= uMergeCount) break;
    vec4 part = uParts[i];
    vec2 point = worldPoint - part.xy;
    distance = smoothUnion(distance, roundBox(point, vec2(halfSize), halfSize * 0.43), blend);
    if (bridge > 0.001) {
      float radius = min(bridge, halfSize * 0.24);
      if (part.z > 0.5) {
        float link = roundBox(point - vec2(reach, 0.0), vec2(reach + radius, bridge), radius);
        distance = smoothUnion(distance, link, blend * 0.61);
      }
      if (part.w > 0.5) {
        float link = roundBox(point - vec2(0.0, reach), vec2(bridge, reach + radius), radius);
        distance = smoothUnion(distance, link, blend * 0.61);
      }
    }
  }
  return distance;
}
`;

const tileFields = `
precision highp float;
precision highp int;

in vec2 vPoint;
flat in vec4 vShape;
flat in vec4 vBend;
flat in vec4 vCore;
flat in vec4 vLight;
out vec4 fragColor;

uniform vec2 uViewport;
uniform float uTime;
uniform float uNight;
uniform vec2 uCentroid;
uniform vec2 uInner; // core radius, core join
${mergeFields}

vec2 inverseStrain(vec2 point, vec2 strain) {
  return point - vec2(
    strain.x * point.x + strain.y * point.y,
    strain.y * point.x - strain.x * point.y
  );
}

vec2 shellPoint() {
  vec2 point = (vPoint - vShape.xy) / vShape.z;
  float influence = 1.0 - smoothstep(0.0, 1.65, length(point - 1.6 * vBend.zw));
  return inverseStrain(point - vBend.zw * influence, vBend.xy) * vShape.z;
}

float shellDistance() {
  if (uMergeCount == 0) return roundBox(shellPoint(), vec2(vShape.z), vShape.z * 0.43);
  return mergedShellDistance(vPoint);
}

float coverage(float distance) {
  float aa = max(0.42, 0.52 * fwidth(distance));
  return 1.0 - smoothstep(-aa, aa, distance);
}

float square(float value) {
  return value * value;
}
`;

export const sceneFragment = `#version 300 es
${tileFields}

void main() {
  bool merge = uMergeCount > 0;
  float halfSize = merge ? uMerge.x : vShape.z;
  float opacity = merge ? uMerge.y : vShape.w;
  float lift = merge ? 0.0 : vLight.y;
  float distance = shellDistance();
  float shell = coverage(distance);
  vec2 gradient = vec2(dFdx(distance), -dFdy(distance));
  vec2 normal = gradient / max(length(gradient), 0.0001);
  float spread = halfSize * (0.20 + 0.15 * lift);
  float under = max(0.0, distance - halfSize * 0.10 * normal.y);
  float shadow = exp2(-under / max(1.0, spread) * 2.95) * (0.043 + 0.147 * max(normal.y, 0.0));
  shadow *= 1.0 - smoothstep(halfSize * 0.39, halfSize * 0.59 + 2.0, max(distance, 0.0));
  shadow *= (1.0 - 0.89 * shell) * opacity;
  vec3 shadowColor = mix(vec3(0.20, 0.23, 0.26), vec3(0.10, 0.11, 0.13), uNight);
  fragColor = vec4(shadowColor * shadow, shadow);
}
`;

export const orbSampling = `
uniform sampler2D uAtlas;
uniform float uExtents[${orbTypes.length}];

vec4 boostOrbChroma(vec4 orb) {
  // Push away from neutral without shifting hue, changing alpha, or clipping highlights.
  float luma = dot(orb.rgb, vec3(0.299, 0.587, 0.114));
  float peak = max(orb.r, max(orb.g, orb.b));
  float floorValue = min(orb.r, min(orb.g, orb.b));
  float ceiling = max(orb.a, peak);
  float headroom = (ceiling - peak) / max(0.00001, peak - luma);
  float footroom = floorValue / max(0.00001, luma - floorValue);
  float boost = min(0.22, min(headroom, footroom));
  return vec4(orb.rgb + (orb.rgb - vec3(luma)) * boost, orb.a);
}

vec4 sampleOrb(int type, vec2 point) {
  point /= max(1.0, length(point) / 0.996);
  // Keep the shader's own axes and motion when viewing it through the glass.
  vec2 uv = 0.5 + point * vec2(1.0, -1.0) * uExtents[type];
  return boostOrbChroma(texture(uAtlas, vec2((uv.x + float(type)) / ${orbTypes.length}.0, uv.y)));
}

`;

const coreFields = `${orbSampling}
uniform bool uCollision;
uniform sampler2D uCollisionTexture;
uniform float uFusionPull;

vec4 sampleCollision(vec2 point) {
  vec2 uv = vec2(point.x, uViewport.y - point.y) / uViewport;
  return texture(uCollisionTexture, clamp(uv, vec2(0.0), vec2(1.0)));
}

float coreField(vec2 point, out vec2 mapped) {
  if (uMergeCount == 0) {
    mapped = (point - vCore.xy) / vCore.z;
    return (length(mapped) - 1.0) * vCore.z;
  }

  float radius = uInner.x;
  float join = uInner.y;
  float nearest = 1e5;
  float distance = 1e5;
  float weights = 0.0;
  vec2 weighted = vec2(0.0);
  vec2 nearestPoint = vec2(0.0);
  float blend = max(0.01, radius * 2.0 * join * (1.0 + uFusionPull * 2.0));
  for (int i = 0; i < ${MAX_TILES}; ++i) {
    if (i >= uMergeCount) break;
    vec2 center = mix(uParts[i].xy, uCentroid, 0.19 * join + uFusionPull);
    vec2 local = (point - center) / radius;
    float lengthSquared = dot(local, local);
    float weight = max(0.0, 1.0 - lengthSquared * 0.16);
    weight *= weight;
    weights += weight;
    weighted += local * weight;
    if (lengthSquared < nearest) {
      nearest = lengthSquared;
      nearestPoint = local;
    }
    distance = smoothUnion(distance, (sqrt(lengthSquared) - 1.0) * radius, blend);
  }
  mapped = mix(nearestPoint, weighted / max(0.0001, weights), join);
  return distance;
}
`;

export const coreFragment = `#version 300 es
${tileFields}
${coreFields}

void main() {
  bool merge = uMergeCount > 0;
  if (merge && uCollision) {
    fragColor = sampleCollision(vPoint) * coverage(shellDistance()) * uMerge.y;
    return;
  }
  float opacity = merge ? uMerge.y : vShape.w;
  int type = int(merge ? uMerge.z : vCore.w);
  vec2 mapped;
  float distance = coreField(vPoint, mapped);
  float core = coverage(distance);
  if (core <= 0.0) discard;
  fragColor = sampleOrb(type, mapped) * core * opacity;
}
`;

// The original continuous sphere field, held until the black hole has formed.
export const fusionFragment = `#version 300 es
${tileFields}
${coreFields}
uniform float uProgress;

void main() {
  vec2 mapped;
  float distance = coreField(vPoint, mapped);
  float core = coverage(distance);
  float fade = 1.0 - smoothstep(0.40, 0.64, uProgress);
  if (core <= 0.0 || fade <= 0.0) discard;
  fragColor = sampleOrb(int(uMerge.z), mapped) * core * fade * coverage(shellDistance());
}
`;

// Source-texture refraction adapted from liquidGL (NaughtyDuk).
// Bevel height field and dual-surface offset adapted from ybouane/liquidglass.
// https://github.com/naughtyduk/liquidGL/blob/88f681ab7035fd55b04f63edff1841e32c4199e9/package/liquidGL.js
// https://github.com/ybouane/liquidglass/blob/59af227103795f06421a96e2c7d3dceb081decd2/src/shaders.ts
// MIT notices: licenses/liquidGL.txt and licenses/liquidglass.txt.
export const glassFragment = `#version 300 es
${tileFields}
${coreFields}
uniform sampler2D uScene;
uniform sampler2D uBackdrop;

vec3 sampleScene(vec2 point) {
  vec2 uv = vec2(point.x, uViewport.y - point.y) / uViewport;
  return texture(uScene, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
}

// The light theme retains the pre-refraction material, with an uncoloured
// backdrop and direct atlas sampling for a clean, polished bevel.
vec3 sampleBackdrop(vec2 point) {
  return texture(uBackdrop, vec2(point.x, uViewport.y - point.y) / uViewport).rgb;
}

vec4 lightGlass() {
  bool merge = uMergeCount > 0;
  float halfSize = merge ? uMerge.x : vShape.z;
  float opacity = merge ? uMerge.y : vShape.w;
  float focus = merge ? uMerge.w * 0.6 : vLight.z;
  int type = int(merge ? uMerge.z : vCore.w);
  float distance = shellDistance();
  float mask = coverage(distance);
  vec2 gradient = vec2(dFdx(distance), -dFdy(distance));
  vec2 normal = gradient / max(length(gradient), 0.0001);

  float depth = max(0.0, -distance);
  float edge = 1.0 - smoothstep(0.0, 0.39 * halfSize, depth);
  float offsetAmount = (edge * 0.075 + pow(edge, 10.0) * 0.112) * halfSize * 2.0;
  vec2 offset = -normal * offsetAmount;
  vec2 local = merge
    ? (vPoint - uCentroid) / max(halfSize * 2.7, 1.0)
    : shellPoint() / halfSize;

  vec2 orbPoint;
  float orbDistance = coreField(vPoint, orbPoint);
  float soft = max(0.32, 0.52 * fwidth(orbDistance));
  float core = merge && uCollision ? 0.0 : 1.0 - smoothstep(-soft, soft, orbDistance);
  if (mask <= 0.0) discard;

  // The environment contains neutral contact shadows. The sphere is viewed
  // through the face, with its own local reflection evaluated at the bevel.
  vec3 glassTint = vec3(0.941, 0.952, 0.968);
  vec3 color = mix(sampleBackdrop(vPoint + offset), glassTint, 0.30);
  if (merge && uCollision) {
    vec4 matter = sampleCollision(vPoint + offset * 0.35);
    color = matter.rgb + color * (1.0 - matter.a);
  }

  vec2 topLight = normalize(vec2(-0.49, -0.87));
  float upper = 0.5 + 0.5 * dot(normal, topLight);
  float phase = merge ? 0.0 : vLight.x;
  vec2 tug = merge ? vec2(0.0) : vBend.zw;
  float angle = atan(local.y, local.x + 0.00001);
  float orbit = uTime * 1.03 + phase * 0.29;
  float wave = sin(3.0 * angle - orbit * 1.31);
  float sweep = pow(0.5 + 0.5 * cos(angle - orbit), 10.0);
  float flicker = pow(0.5 + 0.5 * cos(angle + orbit * 0.82 + 2.4), 15.0);
  float travellingLight = sweep + 0.57 * flicker;
  vec2 tangent = vec2(-normal.y, normal.x);
  float bandDepth = halfSize * (0.106 + 0.018 * wave);
  float bandWidth = halfSize * 0.040 + 0.36;
  float reflectionBand = exp(-square((depth - bandDepth) / bandWidth));
  if (reflectionBand > 0.014) {
    vec2 reflectedPoint;
    float refractionReach = 0.365 + 0.073 * wave;
    vec2 innerRay = vPoint + offset - normal * halfSize * refractionReach;
    innerRay += tangent * halfSize * (0.16 * sin(2.0 * angle + orbit) + dot(tug, tangent) * 1.5);
    float reflectedDistance = coreField(innerRay, reflectedPoint);
    float reflected = 1.0 - smoothstep(-1.2, 2.1, reflectedDistance);
    if (reflected > 0.001) {
      vec4 orbReflection = sampleOrb(type, reflectedPoint);
      vec3 reflectedColor = orbReflection.rgb + color * (1.0 - orbReflection.a);
      float coating = reflectionBand * reflected * (0.08 + 0.31 * travellingLight + 0.16 * (1.0 - upper));
      vec3 bevelLight = vec3(0.99);
      color = mix(color, mix(reflectedColor, bevelLight, 0.27 * orbReflection.a),
        min(0.84, coating));
    }
  }

  float lip = exp2(-depth / max(0.48, 0.024 * halfSize));
  float polishedEdge = exp(-square((depth - 0.053 * halfSize) / (0.025 * halfSize + 0.33)));
  float bevelFace = exp(-square((depth - 0.184 * halfSize) / (0.092 * halfSize + 0.38)));
  float backEdge = exp(-square((depth - 0.239 * halfSize) / (0.027 * halfSize + 0.33)));
  float cutEdge = lip * (0.075 + 0.28 * square(1.0 - upper));
  float darkFace = bevelFace * (0.024 + 0.105 * square(1.0 - upper));
  float highlight = polishedEdge * (0.14 + 0.56 * pow(upper, 1.8) + 0.28 * travellingLight);
  float innerHighlight = backEdge * (0.025 + 0.29 * pow(1.0 - upper, 2.20));
  vec2 lp1 = vec2(sin(uTime * 0.2), cos(uTime * 0.3)) * 0.22 + vec2(-0.42, -0.67);
  vec2 lp2 = vec2(sin(uTime * -0.4 + 1.5), cos(uTime * 0.25 - 0.5)) * 0.19 + vec2(0.52, 0.61);
  float studio = exp(-square((local.y + local.x * 0.36 + 0.58 + 0.18 * sin(orbit) - tug.y) * 10.5))
    * exp(-square((local.x + 0.19 * cos(orbit)) * 1.22));
  float bounce = (1.0 - smoothstep(0.0, 0.85, length(local - lp1))) * 0.032
    + (1.0 - smoothstep(0.0, 0.80, length(local - lp2))) * 0.018;

  vec3 rimShade = vec3(0.29, 0.34, 0.39);
  vec3 rimLight = vec3(0.99, 1.0, 1.0);
  float studioStrength = 0.075 + 0.053 * focus;
  color = mix(color, rimShade, cutEdge + darkFace);
  color = mix(color, rimLight, min(0.97, highlight + innerHighlight + bounce + studio * studioStrength));
  if (core > 0.001) {
    // Keep Orbkit's alpha compositing after shading the glass.
    vec4 orb = sampleOrb(type, orbPoint);
    color = orb.rgb * core + color * (1.0 - orb.a * core);
  }
  float alpha = mask * opacity;
  return vec4(color * alpha, alpha);
}

float bevelHeight(float depth, float radius) {
  float d = clamp(depth, 0.0, radius);
  return sqrt(max(0.0, d * (2.0 * radius - d))) * 0.32;
}

void main() {
  bool merge = uMergeCount > 0;
  float halfSize = merge ? uMerge.x : vShape.z;
  float opacity = merge ? uMerge.y : vShape.w;
  float focus = merge ? uMerge.w * 0.6 : vLight.z;
  float distance = shellDistance();
  float mask = coverage(distance);
  float depth = max(0.0, -distance);

  // A shallow curved face transitions into a flat centre. Derivatives are
  // converted back to CSS pixels so the optics agree across device scales.
  float bevelRadius = max(1.0, halfSize * 0.46);
  float height = bevelHeight(depth, bevelRadius);
  vec2 pixelSize = max(abs(vec2(dFdx(vPoint.x), dFdy(vPoint.y))), vec2(0.0001));
  vec2 heightGradient = vec2(dFdx(height), -dFdy(height)) / pixelSize;
  vec3 normal = normalize(vec3(-heightGradient, 1.0));
  vec2 edgeGradient = vec2(dFdx(distance), -dFdy(distance));
  vec2 edgeNormal = edgeGradient / max(length(edgeGradient), 0.0001);
  if (mask <= 0.0) discard;

  // Both the sphere and its backdrop are already in uScene. Every visible
  // part of the sphere therefore goes through the same glass sampling.
  float thickness = 1.0 + height / (bevelRadius * 0.32);
  float refractionPower = 1.0 - 1.0 / 1.48;
  float refractionStrength = mix(0.08, 0.18, uNight);
  vec2 offset = heightGradient * refractionPower * (2.0 + 0.25 * thickness) * halfSize * refractionStrength;
  float maxOffset = halfSize * 0.10;
  offset /= max(1.0, length(offset) / maxOffset);
  vec2 centre = merge ? uCentroid : vShape.xy;
  offset -= (vPoint - centre) * 0.018;
  vec2 dispersion = offset * 0.012;
  vec3 color = vec3(
    sampleScene(vPoint + offset + dispersion).r,
    sampleScene(vPoint + offset).g,
    sampleScene(vPoint + offset - dispersion).b
  );
  // The steep bevel sees an oblique, compressed image of the interior.
  // Keep this secondary image in a narrow band instead of stretching the face.
  float bevelBand = exp(-square((depth - halfSize * 0.085) / (halfSize * 0.024 + 0.25)));
  vec2 bevelRay = vPoint + offset - edgeNormal * halfSize * 0.43;
  color = mix(color, sampleScene(bevelRay), bevelBand * mix(0.18, 0.48, uNight));
  vec3 tint = mix(vec3(0.97, 0.98, 0.99), vec3(0.012, 0.018, 0.026), uNight);
  color = mix(color, tint, 0.025);

  float phase = merge ? 0.0 : vLight.x;
  float orbit = uTime * 0.22 + phase;
  vec3 light = normalize(vec3(-0.52 + 0.05 * sin(orbit), -0.78, 1.0));
  vec3 halfLight = normalize(light + vec3(0.0, 0.0, 1.0));
  vec3 bounceLight = normalize(vec3(0.55, 0.75, 1.2));
  float specular = pow(max(dot(normal, halfLight), 0.0), 100.0);
  float bounce = pow(max(dot(normal, bounceLight), 0.0), 140.0) * 0.24;
  float fresnel = pow(1.0 - normal.z, 5.0);
  float upper = max(0.0, dot(edgeNormal, normalize(vec2(-0.52, -0.78))));
  float lip = exp(-square((depth - 0.65) / max(0.55, halfSize * 0.018)));
  float glint = lip * (0.09 + 0.40 * pow(upper, 3.0));
  float reflection = (specular + bounce) * (0.16 + focus * 0.05)
    + fresnel * 0.055 + glint;
  float innerCut = exp(-square((depth - halfSize * 0.035) / (halfSize * 0.012 + 0.22)));
  color *= 1.0 - innerCut * (0.025 + 0.065 * (1.0 - upper));
  color = mix(color, vec3(0.90, 0.95, 1.0), min(0.58, reflection));

  float alpha = mask * opacity;
  vec4 darkGlass = vec4(color * alpha, alpha);
  fragColor = darkGlass;
  if (uNight < 1.0) fragColor = mix(lightGlass(), darkGlass, uNight);
}
`;
