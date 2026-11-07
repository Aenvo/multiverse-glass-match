import assert from "node:assert/strict";
import test from "node:test";
import { catalogs, randomTypes, readAppearance, serializeAppearance } from "../src/appearance.js";
import { seedRandom } from "../src/board.js";

test("appearance settings recover from absent or malformed session data", () => {
  for (const saved of [undefined, "", "null", "{broken", "[]", '{"mode":"unknown"}']) {
    const appearance = readAppearance(saved);
    assert.equal(appearance.mode, "orbs");
    assert.equal(appearance.selections.orbs.length, 4);
    assert.deepEqual(appearance.selections.planets.map(type => type.field), ["earth", "mars", "jupiter", "moon"]);
  }
});

test("each mode restores four distinct valid slots in their saved order", () => {
  const appearance = readAppearance(JSON.stringify({ mode: "planets", selections: {
    orbs: ["procedural", "shdr-01", "shdr-02", "shdr-03"],
    planets: ["jupiter", "mercury", "venus", "earth"],
  } }));
  const restored = readAppearance(serializeAppearance(appearance));
  assert.equal(restored.mode, "planets");
  assert.deepEqual(restored.selections, appearance.selections);
});

test("a legacy fictional planet slot migrates while familiar planets keep their order", () => {
  const appearance = readAppearance(JSON.stringify({ mode: "planets", selections: {
    planets: ["procedural", "mercury", "venus", "earth"],
  } }));
  assert.deepEqual(appearance.selections.planets.map(type => type.field), ["mars", "mercury", "venus", "earth"]);
  assert.equal(catalogs.orbs.find(type => type.field === "procedural").name, "Azure world");
  assert.equal(catalogs.planets.some(type => type.field === "procedural"), false);
});

test("stale or duplicate saved slots fall back independently for each mode", () => {
  for (const invalid of [["earth"], ["earth", "earth", "moon", "mars"], ["earth", "moon", "mars", "gone"]]) {
    const appearance = readAppearance(JSON.stringify({ mode: "planets", selections: {
      orbs: ["shdr-04", "shdr-03", "shdr-02", "shdr-01"], planets: invalid,
    } }));
    assert.deepEqual(appearance.selections.orbs.map(type => type.field), ["shdr-04", "shdr-03", "shdr-02", "shdr-01"]);
    assert.deepEqual(appearance.selections.planets.map(type => type.field), ["earth", "mars", "jupiter", "moon"]);
  }
});

test("random combinations have four unique catalog entries and separate the grey rocky bodies", () => {
  for (const mode of ["orbs", "planets"]) {
    for (let seed = 0; seed < 128; seed++) {
      const types = randomTypes(mode, seedRandom(seed));
      assert.equal(new Set(types.map(type => type.field)).size, 4);
      assert.ok(types.every(type => catalogs[mode].includes(type)));
      if (mode === "planets") {
        assert.ok(!(types.some(type => type.field === "moon") && types.some(type => type.field === "mercury")));
      }
    }
  }
});
