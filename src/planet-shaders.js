// Planet materials written for Multiverse Glass Match.
// Sphere projection, texture coordinates and lighting are evaluated in this atlas.
// The procedural material uses arithmetic noise generated entirely in the shader.
const planetMaterial = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform float uTime;
uniform float uRotationOffset;
uniform float uAmbientLight;
uniform float uSunIntensity;
uniform vec3 uSunDirection;
uniform vec3 uAtmosphereColor;
uniform float uAtmosphereDensity;
uniform float uBumpStrength;
uniform sampler2D uPlanetColor;
uniform sampler2D uEarthColor;
uniform sampler2D uEarthNight;
uniform sampler2D uEarthClouds;
uniform sampler2D uEarthSpecular;
uniform sampler2D uEarthBump;

const float PI = 3.14159265359;
const float RADIUS = 0.40;

#ifdef PROCEDURAL_WORLD
float lattice(vec3 cell) {
  uvec3 bits = uvec3(ivec3(cell));
  uint value = bits.x * 1597334677u + bits.y * 3812015801u + bits.z * 2798796415u;
  value = (value ^ (value >> 16u)) * 2246822519u;
  value = (value ^ (value >> 13u)) * 3266489917u;
  return float(value ^ (value >> 16u)) / 4294967295.;
}

float noiseAt(vec3 point) {
  vec3 cell = floor(point);
  vec3 weight = fract(point);
  weight = weight * weight * (3. - 2. * weight);
  float lower = mix(mix(lattice(cell), lattice(cell + vec3(1, 0, 0)), weight.x),
    mix(lattice(cell + vec3(0, 1, 0)), lattice(cell + vec3(1, 1, 0)), weight.x), weight.y);
  float upper = mix(mix(lattice(cell + vec3(0, 0, 1)), lattice(cell + vec3(1, 0, 1)), weight.x),
    mix(lattice(cell + vec3(0, 1, 1)), lattice(cell + vec3(1, 1, 1)), weight.x), weight.y);
  return mix(lower, upper, weight.z);
}

float terrain(vec3 point) {
  float height = 0.;
  float weight = 0.5;
  for (int octave = 0; octave < 5; octave++) {
    height += noiseAt(point) * weight;
    point = point * 2.1 + vec3(7, 13, 19);
    weight *= 0.5;
  }
  return height;
}
#endif

void main() {
  vec2 position = (vUv - 0.5) / RADIUS;
  float radial = length(position);
  float edge = max(fwidth(radial), 0.003);
  float coverage = 1. - smoothstep(1. - edge, 1. + edge, radial);
  vec3 normal = vec3(position, sqrt(max(0., 1. - dot(position, position))));
  normal = normalize(normal);
  vec3 sun = normalize(uSunDirection);
  float longitude = atan(normal.x, normal.z) + uRotationOffset + uTime * 0.035;
  float latitude = asin(clamp(normal.y, -1., 1.));
  vec2 coordinate = vec2(longitude / (2. * PI) + 0.5, latitude / PI + 0.5);
  vec3 surface;
  float clouds = 0.;
  float water = 0.;

#ifdef EARTH_WORLD
  surface = texture(uEarthColor, coordinate).rgb;
  clouds = texture(uEarthClouds, coordinate + vec2(uTime * 0.002, 0.)).r;
  water = texture(uEarthSpecular, coordinate).r;
  vec2 texel = 1. / vec2(textureSize(uEarthBump, 0));
  float bump = texture(uEarthBump, coordinate + vec2(texel.x, 0)).r
    - texture(uEarthBump, coordinate - vec2(texel.x, 0)).r;
  normal = normalize(normal + vec3(bump * 0.16, 0, 0));
#elif defined(PROCEDURAL_WORLD)
  vec3 globe = vec3(cos(latitude) * sin(longitude), sin(latitude), cos(latitude) * cos(longitude));
  float height = terrain(globe * 3.6);
  float land = smoothstep(0.48, 0.57, height);
  surface = mix(vec3(0.025, 0.12, 0.38), vec3(0.16, 0.36, 0.24), land);
  surface = mix(surface, vec3(0.69, 0.75, 0.62), smoothstep(0.68, 0.8, height));
  clouds = smoothstep(0.52, 0.7, terrain(globe * 7. + vec3(uTime * 0.015, 0, 0)));
  water = 1. - land;
#else
  surface = texture(uPlanetColor, coordinate).rgb;
  vec2 texel = 1. / vec2(textureSize(uPlanetColor, 0));
  float bump = dot(texture(uPlanetColor, coordinate + vec2(texel.x, 0)).rgb
    - texture(uPlanetColor, coordinate - vec2(texel.x, 0)).rgb, vec3(0.333));
  normal = normalize(normal + vec3(bump * uBumpStrength * 12., 0, 0));
#endif

  float light = max(0., dot(normal, sun));
  vec3 color = surface * (uAmbientLight * 0.6 + light * uSunIntensity * 0.44);
  color = mix(color, vec3(0.93, 0.96, 1.) * (0.16 + light * 0.9), clouds * 0.78);
  vec3 reflection = normalize(sun + vec3(0, 0, 1));
  color += vec3(0.65, 0.78, 1.) * pow(max(0., dot(normal, reflection)), 48.) * water * 0.28;
#ifdef EARTH_WORLD
  color += texture(uEarthNight, coordinate).rgb * (1. - smoothstep(0., 0.32, light)) * 0.9;
#endif
  float rim = pow(1. - max(normal.z, 0.), 3.);
  color += uAtmosphereColor * rim * uAtmosphereDensity * 1.8;
  float halo = exp(-max(radial - 1., 0.) * 42.) * uAtmosphereDensity * 0.42;
  float alpha = max(coverage, halo * (1. - coverage));
  vec3 result = clamp(color, 0., 1.) * coverage
    + uAtmosphereColor * halo * (1. - coverage);
  fragColor = vec4(result, alpha);
}
`;

export function planetShader(source) {
  const define = source === "earth" ? "#define EARTH_WORLD\n"
    : source === "procedural" ? "#define PROCEDURAL_WORLD\n" : "";
  return planetMaterial.replace("#version 300 es\n", "#version 300 es\n" + define);
}
