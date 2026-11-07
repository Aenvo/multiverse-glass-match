import assert from "node:assert/strict";
import test from "node:test";
import { canSwap, freshBoard, hasMove, indexAt, makeShape, matchGroups, refill, seedRandom, TYPE_COUNT } from "../src/board.js";
import { Game, PLANET_FUSION_TIME } from "../src/game.js";
import { layoutFor, makeTile } from "../src/motion.js";

const makePiece = (type, col, row) => ({ type, col, row });
const rectangle = (width, height) => ({ width, height, top: Array(width).fill(0), bottom: Array(width).fill(height) });
const pieces = (...rows) => rows.flatMap((row, y) => [...row].map((value, x) =>
  value === "." ? null : makePiece(Number(value), x, y)));

function fixture(seed = 10) {
  const random = seedRandom(seed);
  const shape = makeShape(random);
  return new Game(shape, random, layoutFor(1440, 900, shape.width, shape.height));
}

function point(game, index) {
  const { left, top, step } = game.layout;
  const { width } = game.shape;
  return [left + step * (index % width), top + step * Math.floor(index / width)];
}

function tick(game, seconds) {
  for (let frame = 0; frame < Math.ceil(seconds * 120); frame++) game.step(1 / 120);
}

test("random outlines stay connected, fill completely, and start with a legal move", () => {
  const outlines = new Set();
  for (let seed = 0; seed < 256; seed++) {
    const random = seedRandom(seed);
    const shape = makeShape(random);
    const cells = freshBoard(shape, random, makePiece);
    outlines.add(JSON.stringify(shape));
    let count = 0;
    for (let col = 0; col < shape.width; col++) {
      if (col > 0) {
        assert.ok(Math.max(shape.top[col], shape.top[col - 1]) < Math.min(shape.bottom[col], shape.bottom[col - 1]));
      }
      for (let row = 0; row < shape.height; row++) {
        const active = indexAt(shape, col, row) >= 0;
        assert.equal(Boolean(cells[row * shape.width + col]), active);
        count += Number(active);
      }
    }
    assert.ok(count >= 52 && count <= 66);
    assert.deepEqual(matchGroups(cells, shape), []);
    assert.ok(hasMove(cells, shape));
  }
  assert.ok(outlines.size > 20);
});

test("matching merges a crossing once and keeps disconnected groups separate", () => {
  const shape = rectangle(7, 5);
  const cells = pieces(".0.....", "000....", ".0..000", ".......", ".......");
  const groups = matchGroups(cells, shape).map(group => [...group].sort((a, b) => a - b));
  assert.deepEqual(groups, [[1, 7, 8, 9, 15], [18, 19, 20]]);
});

test("an unusable cell breaks a line and adjacent swaps are checked without changing the board", () => {
  const outline = { width: 4, height: 2, top: [0, 1, 0, 0], bottom: [2, 2, 2, 2] };
  assert.deepEqual(matchGroups(pieces("0.00", "1212"), outline), []);

  const shape = rectangle(3, 3);
  const cells = pieces("010", "202", "123");
  const original = [...cells];
  assert.ok(canSwap(cells, shape, 1, 4));
  assert.equal(canSwap(cells, shape, 0, 4), false);
  assert.equal(canSwap(cells, shape, 0, 1), false);
  assert.equal(canSwap(cells, shape, 2, 3), false);
  assert.deepEqual(cells, original);
});

test("compaction preserves the order of survivors and creates the exact vacancies per column", () => {
  const shape = { width: 3, height: 5, top: [0, 1, 0], bottom: [5, 5, 4] };
  const cells = pieces("1.2", "231", "000", "123", "23.");
  const groups = matchGroups(cells, shape);
  const next = refill(cells, shape, groups, () => 0.8, makePiece);
  assert.equal(next.cells[3], cells[0]);
  assert.equal(next.cells[6], cells[3]);
  assert.equal(next.cells[7], cells[4]);
  assert.equal(next.cells[8], cells[5]);
  assert.equal(next.cells[9], cells[9]);
  assert.equal(next.cells[14], null);
  assert.deepEqual(next.drops.filter(drop => drop.fromRow === null).map(({ col, row }) => [col, row]), [[0, 0], [1, 1], [2, 0]]);
});

test("a held shell stretches as its round core lags, then settles after cancellation", () => {
  const game = fixture();
  const original = [...game.cells];
  const tile = game.cells[13];
  assert.ok(game.press(...point(game, 13)));
  game.move(...point(game, 14));
  tick(game, 0.067);
  assert.ok(tile.shell[0] > 0.025);
  assert.ok(tile.core[0] < -0.02);
  const view = game.view().tiles.at(-1);
  assert.equal(view.orbRadius, game.layout.step * 0.3);
  assert.ok(view.orbX < view.x);
  assert.equal(game.release(false), false);
  tick(game, 0.65);
  assert.deepEqual(game.cells, original);
  assert.ok(Math.abs(tile.position[0] - tile.col) < 0.001);
  assert.ok(Math.abs(tile.shell[0]) < 0.003);
});

test("even a quick invalid exchange visibly trades positions before returning", () => {
  const game = fixture();
  const original = [...game.cells];
  const tile = game.cells[3];
  assert.equal(canSwap(game.cells, game.shape, 3, 4), false);
  assert.ok(game.press(...point(game, 3)));
  game.move(...point(game, 4));
  assert.equal(game.release(true), false);
  assert.equal(game.phase.kind, "reject");
  tick(game, 0.15);
  assert.ok(tile.position[0] > 3.85);
  assert.deepEqual(game.cells, original);
  tick(game, 0.55);
  assert.equal(game.phase, null);
  assert.ok(Math.abs(tile.position[0] - tile.col) < 0.001);
  assert.deepEqual(game.cells, original);
});

test("short, diagonal, and slightly retracted legal drags keep their intended cell", () => {
  const gestures = [
    [[0.19, 0.04]],
    [[0.46, 0.06], [0.39, 0.44]],
    [[0.35, 0], [0.14, 0.02]],
  ];
  for (const gesture of gestures) {
    const game = fixture();
    const [x, y] = point(game, 13);
    const { step } = game.layout;
    const tile = game.cells[13];
    assert.ok(game.press(x, y));
    for (const [dx, dy] of gesture) game.move(x + step * dx, y + step * dy);
    assert.equal(game.drag.target, 14);
    assert.ok(game.release(true));
    assert.equal(game.cells[14], tile);
  }
});

test("a clear change of target or return to the origin overrides drag assist", () => {
  const game = fixture();
  const tile = game.cells[13];
  const [x, y] = point(game, 13);
  const { step } = game.layout;
  assert.ok(game.press(x, y));
  game.move(x + step * 0.44, y);
  game.move(x + step * 0.035, y + step * 0.95);
  assert.equal(game.drag.target, 22);
  game.move(x + step * 0.02, y);
  assert.equal(game.drag.armed, false);
  assert.equal(game.release(true), false);
  assert.equal(game.phase, null);
  assert.equal(game.cells[13], tile);
});

test("dropping across a cell edge swaps and clears every tile in larger matches", () => {
  const moves = [
    { seed: 1, from: 39, to: 48, matched: [38, 39, 40, 41] },
    { seed: 1, from: 60, to: 61, matched: [43, 52, 61, 70] },
    { seed: 7, from: 40, to: 49, matched: [38, 39, 40, 41, 42] },
    { seed: 13, from: 57, to: 58, matched: [40, 49, 58, 67, 76] },
    { seed: 9, from: 56, to: 57, matched: [39, 48, 57, 58, 59, 66] },
  ];
  for (const { seed, from, to, matched } of moves) {
    const game = fixture(seed);
    const [x, y] = point(game, from);
    const [nextX, nextY] = point(game, to);
    const pointAlong = amount => [x + (nextX - x) * amount, y + (nextY - y) * amount];
    const tile = game.cells[from];
    assert.ok(game.press(...pointAlong(0.458)));
    game.move(...pointAlong(0.542));
    assert.ok(game.release(true));
    assert.equal(game.cells[to], tile);
    tick(game, 0.23);
    assert.equal(game.phase.kind, "fuse");
    assert.deepEqual([...game.phase.matched].sort((a, b) => a - b), matched);
    assert.equal(game.view().fusions[0].points.length, matched.length);
  }
});

test("a refill can start a straight seven-tile cascade and fuse the entire line", () => {
  const shape = rectangle(7, 3);
  const game = new Game(shape, seedRandom(1), layoutFor(1440, 900, shape.width, shape.height));
  game.cells = pieces("0123012", "2222222", "3010231").map(({ type, col, row }) => makeTile(type, col, row));
  game.random = () => 0;
  game.settle();
  assert.equal(game.phase.matched.size, 7);
  tick(game, 0.65);
  assert.equal(game.phase.kind, "fall");
  const { duration } = game.phase;
  tick(game, duration + 0.19);
  assert.equal(game.phase.kind, "fuse");
  assert.deepEqual([...game.phase.matched], [0, 1, 2, 3, 4, 5, 6]);
});

test("a legal drag completes a two-step cascade with new tiles starting above the viewport", () => {
  const game = fixture();
  const initialCount = game.cells.filter(Boolean).length;
  assert.ok(game.press(...point(game, 13)));
  game.move(...point(game, 14));
  assert.ok(game.release(true));
  assert.equal(game.press(...point(game, 14)), false);
  const phases = [];
  let lastPhase;
  for (let frame = 0; frame < 720 && game.phase; frame++) {
    game.step(1 / 120);
    const phase = game.phase;
    if (phase === lastPhase || !phase) continue;
    lastPhase = phase;
    phases.push(phase.kind);
    if (phase.kind === "fall") {
      const incoming = [...phase.motions].filter(([, drop]) => drop.fromRow === null);
      assert.ok(incoming.length >= 3);
      for (const [tile] of incoming) {
        const center = game.layout.top + tile.position[1] * game.layout.step;
        assert.ok(center + game.layout.step * 0.459 < 0);
      }
    }
  }
  assert.deepEqual(phases, ["swap", "fuse", "fall", "fuse", "fall"]);
  assert.equal(game.phase, null);
  assert.equal(game.cells.filter(Boolean).length, initialCount);
  assert.deepEqual(matchGroups(game.cells, game.shape), []);
  assert.ok(hasMove(game.cells, game.shape));
});

test("a dead board quietly reshuffles inside the same outline", () => {
  const game = fixture();
  const outline = game.shape;
  const mask = game.cells.map(Boolean);
  game.cells = game.cells.map(tile => tile && makeTile((tile.col + 2 * tile.row) % TYPE_COUNT, tile.col, tile.row));
  assert.equal(hasMove(game.cells, outline), false);
  game.settle();
  assert.equal(game.phase.kind, "shuffle");
  tick(game, 0.52);
  assert.equal(game.phase, null);
  assert.equal(game.shape, outline);
  assert.deepEqual(game.cells.map(Boolean), mask);
  assert.deepEqual(matchGroups(game.cells, outline), []);
  assert.ok(hasMove(game.cells, outline));
});

test("planet fusion keeps one duration and identity through the view and drop boundary", () => {
  const game = fixture();
  game.fusionDuration = PLANET_FUSION_TIME;
  game.press(...point(game, 13));
  game.move(...point(game, 14));
  assert.ok(game.release(true));
  tick(game, 0.23);
  const phase = game.phase;
  assert.equal(phase.kind, "fuse");
  assert.equal(phase.duration, PLANET_FUSION_TIME);
  const key = game.view().fusions[0].key;
  // A future appearance setting cannot shorten a collision already in flight.
  game.fusionDuration = 0.64;
  phase.elapsed = PLANET_FUSION_TIME * 0.75;
  assert.equal(game.view().fusions[0].progress, 0.75);
  assert.equal(game.view().fusions[0].key, key);
  game.step(0.001);
  assert.equal(game.phase, phase);
  phase.elapsed = PLANET_FUSION_TIME - 0.001;
  game.step(0.002);
  assert.equal(game.phase.kind, "fall");
  assert.deepEqual(game.view().fusions, []);
  tick(game, game.phase.duration + 0.19);
  assert.equal(game.phase.kind, "fuse");
  assert.notEqual(game.view().fusions[0].key, key);
  assert.equal(game.phase.duration, 0.64);
});
