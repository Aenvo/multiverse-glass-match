import assert from "node:assert/strict";
import test from "node:test";
import { collisionGeometry } from "../src/planet-collision.js";
import { GlassRenderer } from "../src/renderer.js";

const fusion = coordinates => ({
  points: coordinates.map(([x, y]) => ({ x: x * 75, y: y * 75 })),
  radius: 22.5, type: 0, key: "1-21",
});

test("collision axes stay deterministic for lines, branches and symmetric crossings", () => {
  const horizontal = [[0, 0], [1, 0], [2, 0]];
  const vertical = [[0, 0], [0, 1], [0, 2]];
  const cross = [[0, 1], [1, 1], [2, 1], [1, 0], [1, 2]];
  assert.deepEqual(collisionGeometry(fusion(horizontal)).axis, [1, 0]);
  assert.ok(Math.abs(collisionGeometry(fusion(vertical)).axis[1] - 1) < 1e-10);
  assert.deepEqual(collisionGeometry(fusion(cross)).axis, [1, 0]);
  const elbow = fusion([[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]]);
  assert.deepEqual(collisionGeometry(elbow).axis, [1, 0]);
  assert.deepEqual(collisionGeometry(elbow).center, [75, 150]);
  for (const coordinates of [horizontal, vertical, cross, [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]]]) {
    const group = fusion(coordinates);
    const a = collisionGeometry(group);
    const b = collisionGeometry({ ...group, points: [...group.points].reverse(), progress: 0.99 });
    assert.deepEqual(a, b);
    assert.ok(a.reach > group.radius);
    for (const point of group.points) {
      assert.ok(point.x > a.bounds[0] && point.x < a.bounds[2]);
      assert.ok(point.y > a.bounds[1] && point.y < a.bounds[3]);
    }
  }
});

test("the black-hole ring leaves room at each end of short and long glass branches", () => {
  for (const count of [3, 4, 5, 7]) {
    const group = fusion(Array.from({ length: count }, (_, index) => [index, 0]));
    const geometry = collisionGeometry(group);
    const glassReach = (count - 1) * 75 * 0.5 + 75 * 0.459;
    const ringReach = geometry.reach * 1.3;
    assert.ok(glassReach - ringReach > group.radius);
  }
});

test("the connected glass contains the full black-hole stage before the final collapse", () => {
  const group = { ...fusion([[0, 0], [1, 0], [2, 0]]), half: 75 * 0.459 };
  const renderer = { presets: [{ kind: "planet" }], reducedMotion: false };
  const merge = progress => GlassRenderer.prototype.mergeUniforms.call(renderer, { ...group, progress });
  assert.equal(merge(0.40).inner[1], 1);
  for (const progress of [0.50, 0.70, 0.81]) {
    const material = merge(progress);
    assert.equal(material.shape[0], group.half);
    assert.equal(material.shape[1], 1);
    assert.equal(material.shape[3], 1);
    assert.deepEqual(Array.from(material.coordinates.filter((_, index) => index % 4 < 2)),
      group.points.flatMap(point => [point.x, point.y]));
  }
  assert.ok(merge(0.94).shape[0] < group.half);
  assert.equal(merge(1).shape[1], 0);
  renderer.reducedMotion = true;
  assert.equal(merge(0.70).shape[0], group.half);
  assert.equal(merge(0.70).shape[3], 1);
});

test("ordinary-orb palette capture survives a layout change and clears after fusion", () => {
  const group = fusion([[0, 0], [1, 0], [2, 0]]);
  const renderer = {
    gl: {}, presets: [{ field: "shdr-01" }], collisionGroups: new Map(), collisionSource: {},
    width: 800, height: 600, sceneWidth: 800, sceneHeight: 600,
    collisionWidth: 800, collisionHeight: 600,
  };
  const prepare = groups => GlassRenderer.prototype.prepareCollisions.call(renderer, groups);
  prepare([group]);
  const captured = renderer.collisionGroups.get(group.key);
  assert.equal(captured.captureColor, true);
  captured.captureColor = false;
  renderer.width = 900;
  prepare([{ ...group, points: group.points.map(point => ({ ...point, x: point.x + 50 })) }]);
  const resized = renderer.collisionGroups.get(group.key);
  assert.equal(resized.captureColor, false);
  assert.equal(resized.paletteRow, captured.paletteRow);
  assert.equal(resized.geometry.center[0], captured.geometry.center[0] + 50);
  prepare([]);
  assert.equal(renderer.collisionGroups.size, 0);
  renderer.presets = [{ kind: "planet", source: "procedural" }];
  prepare([group]);
  assert.equal(renderer.collisionGroups.get(group.key).captureColor, true);
  prepare([]);
  renderer.presets = [{ kind: "planet", source: "earth" }];
  prepare([group]);
  assert.equal(renderer.collisionGroups.get(group.key).captureColor, false);
});
