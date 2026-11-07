import { texturesFor } from "./planet-types.js";
import { planetShader } from "./planet-shaders.js";

const images = new Map();

async function responseFor(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load planet asset (${response.status})`);
  return response;
}

function cached(cache, key, load) {
  if (!cache.has(key)) {
    const promise = load().catch(error => {
      cache.delete(key);
      throw error;
    });
    cache.set(key, promise);
  }
  return cache.get(key);
}

export async function loadPlanetAssets(types) {
  const planets = types.filter(type => type.kind === "planet");
  const sourceNames = [...new Set(planets.map(type => type.source))];
  const textureNames = [...new Set(planets.flatMap(type => Object.values(texturesFor(type))))];
  const loaded = await Promise.all(textureNames.map(async name => [name, await cached(images, name, async () => {
    const response = await responseFor(new URL(`../assets/planets/${name}`, import.meta.url));
    return createImageBitmap(await response.blob(), {
      resizeWidth: 512, resizeHeight: 256, imageOrientation: "flipY",
    });
  })]));
  return {
    sources: new Map(sourceNames.map(name => [name, planetShader(name)])),
    images: new Map(loaded),
  };
}
