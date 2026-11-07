const planet = (field, name, shader, texture, uniforms = {}) => ({
  field, name, shader, kind: "planet", texture, uniforms, extent: 0.46, phase: 0.6,
  source: field === "earth" ? "earth" : field === "procedural" ? "procedural" : "planet",
});

export const planetCatalog = [
  planet("earth", "Earth", "PLANET-01", null, {
    uAtmosphereColor: [0.05, 0.3, 0.9], uAtmosphereDensity: 0.3,
  }),
  planet("moon", "Moon", "PLANET-02", "2k_moon.jpeg", {
    uAtmosphereColor: [1, 1, 1], uAtmosphereDensity: 0.015,
  }),
  planet("mercury", "Mercury", "PLANET-03", "2k_mercury.jpg", {
    uAtmosphereColor: [1, 1, 1], uAtmosphereDensity: 0.015,
  }),
  planet("venus", "Venus", "PLANET-04", "2k_venus.jpg", {
    uAtmosphereColor: [0.9, 0.3, 0], uAtmosphereDensity: 0.1, uBumpStrength: 0.005,
  }),
  planet("mars", "Mars", "PLANET-05", "2k_mars.jpg", {
    uAtmosphereColor: [0.9, 0.15, 0], uAtmosphereDensity: 0.2,
  }),
  planet("jupiter", "Jupiter", "PLANET-06", "2k_jupiter.jpg", {
    uAtmosphereColor: [0.36, 0.92, 0.95], uAtmosphereDensity: 0.05, uBumpStrength: 0.003,
  }),
];

export const otherworldPlanet = planet("procedural", "Azure world", "WORLD-01", null, {
  uAtmosphereColor: [0.18, 0.4, 0.8], uAtmosphereDensity: 0.2,
});

export const defaultPlanets = ["earth", "mars", "jupiter", "moon"].map(field =>
  planetCatalog.find(type => type.field === field));

export const earthTextures = {
  uEarthColor: "2k_earth_color.jpeg",
  uEarthNight: "2k_earth_night.jpeg",
  uEarthClouds: "2k_earth_clouds.jpeg",
  uEarthSpecular: "2k_earth_specular.jpeg",
  uEarthBump: "2k_earth_bump.jpg",
};

export function texturesFor(type) {
  if (type.field === "earth") return earthTextures;
  return type.texture ? { uPlanetColor: type.texture } : {};
}
