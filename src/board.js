import { orbTypes } from "./orb-types.js";

export const TYPE_COUNT = orbTypes.length;
const SIZE = 9;

// Each column is one interval. Adjacent columns overlap, so vertical
// drops can reach every cell while the outline remains one connected shape.
const outlines = [
  { top: [2, 1, 0, 0, 0, 2, 3, 3, 4], bottom: [6, 7, 7, 9, 9, 9, 9, 8, 8] },
  { top: [3, 2, 1, 0, 0, 0, 1, 3, 4], bottom: [7, 8, 8, 9, 9, 8, 7, 8, 8] },
  { top: [3, 2, 2, 1, 0, 0, 0, 2, 3], bottom: [7, 8, 9, 9, 9, 8, 8, 7, 7] },
];

const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function pick(random, count) {
  return Math.floor(random() * count);
}

export function seedRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let bits = Math.imul(state ^ (state >>> 15), state | 1);
    bits ^= bits + Math.imul(bits ^ (bits >>> 7), bits | 61);
    return ((bits ^ (bits >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeShape(random) {
  const outline = outlines[pick(random, outlines.length)];
  const top = [...outline.top];
  const bottom = [...outline.bottom];
  for (let count = 0; count < 3; count++) {
    const col = pick(random, SIZE);
    const edge = random() < 0.5 ? top : bottom;
    const value = edge[col] + (random() < 0.5 ? -1 : 1);
    const min = edge === top ? 0 : top[col] + 4;
    const max = edge === top ? bottom[col] - 4 : SIZE;
    if (value >= min && value <= max && top[col] !== 0 && bottom[col] !== SIZE) edge[col] = value;
  }
  if (random() < 0.5) {
    top.reverse();
    bottom.reverse();
  }
  return { width: SIZE, height: SIZE, top, bottom };
}

export function indexAt(shape, col, row) {
  if (col < 0 || col >= shape.width || row < shape.top[col] || row >= shape.bottom[col]) return -1;
  return row * shape.width + col;
}

function hasLineAt(cells, shape, index) {
  const tile = cells[index];
  if (!tile) return false;
  const col = index % shape.width;
  const row = Math.floor(index / shape.width);
  const span = (dx, dy) => {
    let length = 0;
    let x = col + dx;
    let y = row + dy;
    while (cells[indexAt(shape, x, y)]?.type === tile.type) {
      length++;
      x += dx;
      y += dy;
    }
    return length;
  };
  return span(1, 0) + span(-1, 0) >= 2 || span(0, 1) + span(0, -1) >= 2;
}

export function matchGroups(cells, shape) {
  const matched = new Set();
  for (let index = 0; index < cells.length; index++) {
    if (hasLineAt(cells, shape, index)) matched.add(index);
  }

  const groups = [];
  for (const seed of matched) {
    const group = [seed];
    matched.delete(seed);
    for (let cursor = 0; cursor < group.length; cursor++) {
      const index = group[cursor];
      const col = index % shape.width;
      const row = Math.floor(index / shape.width);
      for (const [dx, dy] of directions) {
        const neighbor = indexAt(shape, col + dx, row + dy);
        if (matched.has(neighbor) && cells[neighbor].type === cells[index].type) {
          matched.delete(neighbor);
          group.push(neighbor);
        }
      }
    }
    groups.push(group);
  }
  return groups;
}

export function canSwap(cells, shape, first, second) {
  const a = cells[first];
  const b = cells[second];
  if (!a || !b || a.type === b.type) return false;
  const distance = Math.abs(first % shape.width - second % shape.width)
    + Math.abs(Math.floor(first / shape.width) - Math.floor(second / shape.width));
  if (distance !== 1) return false;

  cells[first] = b;
  cells[second] = a;
  const valid = hasLineAt(cells, shape, first) || hasLineAt(cells, shape, second);
  cells[first] = a;
  cells[second] = b;
  return valid;
}

export function hasMove(cells, shape) {
  for (let index = 0; index < cells.length; index++) {
    if (!cells[index]) continue;
    const col = index % shape.width;
    const row = Math.floor(index / shape.width);
    if (canSwap(cells, shape, index, indexAt(shape, col + 1, row))
      || canSwap(cells, shape, index, indexAt(shape, col, row + 1))) return true;
  }
  return false;
}

export function freshBoard(shape, random, makeTile) {
  const cells = new Array(shape.width * shape.height).fill(null);
  const anchors = [];
  for (let row = 0; row < shape.height - 1; row++) {
    for (let col = 0; col < shape.width - 2; col++) {
      if (indexAt(shape, col, row) >= 0 && indexAt(shape, col, row + 1) >= 0
        && indexAt(shape, col + 1, row) >= 0 && indexAt(shape, col + 1, row + 1) >= 0
        && indexAt(shape, col + 2, row) >= 0 && indexAt(shape, col + 2, row + 1) >= 0) {
        anchors.push([col, row]);
      }
    }
  }

  // A B A / C A C gives one legal exchange. Filling the other cells
  // around the motif forbids pre-existing lines, even across the motif.
  const [anchorCol, anchorRow] = anchors[pick(random, anchors.length)];
  const a = pick(random, TYPE_COUNT);
  const b = (a + 1 + pick(random, TYPE_COUNT - 1)) % TYPE_COUNT;
  const c = (a + 1 + pick(random, TYPE_COUNT - 1)) % TYPE_COUNT;
  [a, b, a, c, a, c].forEach((type, offset) => {
    const col = anchorCol + offset % 3;
    const row = anchorRow + Math.floor(offset / 3);
    cells[indexAt(shape, col, row)] = { type };
  });
  for (let row = 0; row < shape.height; row++) {
    for (let col = 0; col < shape.width; col++) {
      const index = indexAt(shape, col, row);
      if (index < 0 || cells[index]) continue;
      const first = pick(random, TYPE_COUNT);
      const tile = { type: first };
      cells[index] = tile;
      while (hasLineAt(cells, shape, index)) tile.type = (tile.type + 1) % TYPE_COUNT;
    }
  }
  return cells.map((tile, index) => tile && makeTile(tile.type, index % shape.width, Math.floor(index / shape.width)));
}

export function refill(cells, shape, groups, random, makeTile) {
  const removed = new Set(groups.flat());
  const next = new Array(cells.length).fill(null);
  const drops = [];
  for (let col = 0; col < shape.width; col++) {
    let toRow = shape.bottom[col] - 1;
    for (let row = toRow; row >= shape.top[col]; row--) {
      const from = indexAt(shape, col, row);
      const tile = cells[from];
      if (!tile || removed.has(from)) continue;
      next[indexAt(shape, col, toRow)] = tile;
      if (row !== toRow) drops.push({ tile, col, row: toRow, fromRow: row, order: 0 });
      toRow--;
    }
    for (let order = 0; toRow >= shape.top[col]; toRow--, order++) {
      const tile = makeTile(pick(random, TYPE_COUNT), col, toRow);
      next[indexAt(shape, col, toRow)] = tile;
      drops.push({ tile, col, row: toRow, fromRow: null, order });
    }
  }
  return { cells: next, drops };
}

export function shuffleBoard(cells, shape, random, makeTile) {
  const indices = cells.flatMap((tile, index) => tile ? [index] : []);
  const next = [...cells];
  for (let attempt = 0; attempt < 96; attempt++) {
    for (let index = indices.length - 1; index > 0; index--) {
      const a = indices[index];
      const b = indices[pick(random, index + 1)];
      [next[a], next[b]] = [next[b], next[a]];
    }
    if (matchGroups(next, shape).length === 0 && hasMove(next, shape)) return next;
  }
  return freshBoard(shape, random, makeTile);
}
