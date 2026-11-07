import { orbCatalog, orbTypes, pickOrbTypes } from "./orb-types.js";
import { defaultPlanets, otherworldPlanet, planetCatalog } from "./planet-types.js";

export const APPEARANCE_KEY = "liquid-glass-appearance";
export const catalogs = { orbs: [...orbCatalog, otherworldPlanet], planets: planetCatalog };

export function readAppearance(saved) {
  let data;
  try { data = JSON.parse(saved); } catch {}
  const selections = { orbs: orbTypes, planets: defaultPlanets };
  for (const [mode, catalog] of Object.entries(catalogs)) {
    const fields = data?.selections?.[mode];
    if (!Array.isArray(fields) || fields.length !== 4 || new Set(fields).size !== 4) continue;
    // Older sessions could select the fictional planet in Planet Mode.
    // Replace that slot while keeping the remaining familiar planets in order.
    const replacement = defaultPlanets.find(type => !fields.includes(type.field));
    const types = fields.map(field => mode === "planets" && field === "procedural"
      ? replacement : catalog.find(type => type.field === field));
    if (types.every(Boolean)) selections[mode] = types;
  }
  return { mode: data?.mode === "planets" ? "planets" : "orbs", selections };
}

export function serializeAppearance(appearance) {
  return JSON.stringify({
    mode: appearance.mode,
    selections: Object.fromEntries(Object.entries(appearance.selections).map(([mode, types]) =>
      [mode, types.map(type => type.field)])),
  });
}

export function randomTypes(mode, random = Math.random) {
  if (mode === "orbs") return pickOrbTypes(random, catalogs.orbs);
  // Keep the two grey rocky bodies out of the same random quartet.
  const rocky = random() < 0.5 ? "moon" : "mercury";
  const pool = planetCatalog.filter(type => !["moon", "mercury"].includes(type.field) || type.field === rocky);
  return pickOrbTypes(random, pool);
}
