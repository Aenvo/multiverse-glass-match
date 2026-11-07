import { canSwap, freshBoard, hasMove, indexAt, matchGroups, refill, shuffleBoard } from "./board.js";
import { flex, guide, land, makeTile, tileView } from "./motion.js";

const SWAP_TIME = 0.22;
const REJECT_TIME = 0.16;
const FUSION_TIME = 0.64;
export const PLANET_FUSION_TIME = 0.90;
const LAND_TIME = 0.18;
const ARM_DISTANCE = 0.18;
const HOME_DISTANCE = 0.085;
const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export class Game {
  constructor(shape, random, layout) {
    this.shape = shape;
    this.random = random;
    this.layout = layout;
    this.cells = freshBoard(shape, random, makeTile);
    this.drag = null;
    this.cursor = null;
    this.phase = null;
    this.fusionDuration = FUSION_TIME;
    this.fusionId = 0;
  }

  hit(x, y) {
    const { left, top, step } = this.layout;
    const px = (x - left) / step;
    const py = (y - top) / step;
    const col = Math.round(px);
    const row = Math.round(py);
    if (Math.abs(px - col) > 0.49 || Math.abs(py - row) > 0.49) return -1;
    return indexAt(this.shape, col, row);
  }

  press(x, y) {
    if (this.phase || this.drag) return false;
    const index = this.hit(x, y);
    const tile = this.cells[index];
    if (!tile) return false;
    const { col, row } = tile;
    const neighbors = DIRECTIONS.map(([dx, dy]) => indexAt(this.shape, col + dx, row + dy));
    const validTargets = new Set(neighbors.filter(target => canSwap(this.cells, this.shape, index, target)));
    this.drag = {
      index, tile, x, y, neighbors, validTargets,
      dx: 0, dy: 0, pull: 0, direction: -1, target: -1, armed: false, previewX: 0, previewY: 0,
    };
    return true;
  }

  aim(x, y, dx, dy) {
    const { neighbors, validTargets, direction: previous, armed } = this.drag;
    const hit = this.hit(x, y);
    const direct = hit < 0 ? -1 : neighbors.indexOf(hit);
    if (direct >= 0) {
      if (validTargets.has(hit)) return { direction: direct, direct: true };
      const { left, top, step } = this.layout;
      const { col, row } = this.cells[hit];
      if (Math.abs((x - left) / step - col) < 0.40 && Math.abs((y - top) / step - row) < 0.40) {
        return { direction: direct, direct: true };
      }
    }

    const horizontal = dx < 0 ? 1 : 0;
    const vertical = dy < 0 ? 3 : 2;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    let direction = ax >= ay ? horizontal : vertical;
    if (Math.min(ax, ay) >= 0.12 && Math.abs(ax - ay) < 0.075) {
      const horizontalWorks = validTargets.has(neighbors[horizontal]);
      const verticalWorks = validTargets.has(neighbors[vertical]);
      if (horizontalWorks !== verticalWorks) direction = horizontalWorks ? horizontal : vertical;
    }

    if (armed && previous >= 0 && direction !== previous) {
      const [px, py] = DIRECTIONS[previous];
      const [nx, ny] = DIRECTIONS[direction];
      const held = dx * px + dy * py;
      const next = dx * nx + dy * ny;
      const heldWorks = validTargets.has(neighbors[previous]);
      const nextWorks = validTargets.has(neighbors[direction]);
      if (held >= HOME_DISTANCE && (heldWorks || !nextWorks) && next - held < 0.16) direction = previous;
    }
    return { direction, direct: false };
  }

  move(x, y) {
    this.cursor = [x, y];
    if (!this.drag) return;
    const drag = this.drag;
    const { left, top, step } = this.layout;
    const dx = (x - drag.x) / step;
    const dy = (y - drag.y) / step;
    const { direction, direct } = this.aim(x, y, dx, dy);
    if (!direct && Math.hypot(dx, dy) < HOME_DISTANCE) {
      Object.assign(drag, { dx, dy, pull: 0, direction: -1, target: -1, armed: false, previewX: 0, previewY: 0 });
      return;
    }

    const [colDir, rowDir] = DIRECTIONS[direction];
    const pull = Math.max(0, dx * colDir + dy * rowDir);
    const neighbor = drag.neighbors[direction];
    const held = drag.armed && direction === drag.direction && pull >= HOME_DISTANCE;
    drag.armed = neighbor >= 0 && (direct || held || pull >= ARM_DISTANCE);
    drag.direction = direction;
    drag.target = neighbor;

    const cursorCol = (x - left) / step - drag.tile.col;
    const cursorRow = (y - top) / step - drag.tile.row;
    const reach = direct ? Math.max(pull, cursorCol * colDir + cursorRow * rowDir) : pull;
    drag.pull = reach;
    const assist = drag.armed && drag.validTargets.has(neighbor) ? 0.12 * clamp(pull / 0.62, 0, 1) : 0;
    const travel = neighbor >= 0 ? Math.min(1, reach + assist) : Math.tanh(pull / 0.32) * 0.32;
    drag.dx = colDir ? colDir * travel : clamp(dx, -0.19, 0.19) * 0.60;
    drag.dy = rowDir ? rowDir * travel : clamp(dy, -0.19, 0.19) * 0.60;
    const shift = Math.max(0, travel - 0.11) * 0.57;
    drag.previewX = -colDir * shift + rowDir * shift * 0.24;
    drag.previewY = -rowDir * shift - colDir * shift * 0.24;
  }

  release(commit) {
    if (!this.drag) return false;
    const { tile, index, target, armed, validTargets } = this.drag;
    this.drag = null;
    const other = this.cells[target];
    if (!commit || !armed || !other) {
      const displaced = Math.hypot(tile.position[0] - tile.col, tile.position[1] - tile.row) > HOME_DISTANCE;
      if (displaced) this.phase = { kind: "return", elapsed: 0, front: tile };
      return false;
    }

    if (!validTargets.has(target)) {
      this.phase = { kind: "reject", elapsed: 0, front: tile, other };
      return false;
    }

    this.cells[index] = other;
    this.cells[target] = tile;
    [tile.col, other.col] = [other.col, tile.col];
    [tile.row, other.row] = [other.row, tile.row];
    this.phase = { kind: "swap", elapsed: 0, front: tile, moved: [tile, other] };
    return true;
  }

  get pointer() {
    if (this.drag) return "dragging";
    if (!this.phase && this.cursor && this.cells[this.hit(...this.cursor)]) return "ready";
    return "";
  }

  step(dt) {
    const phase = this.phase;
    if (phase) phase.elapsed += dt;
    if (phase?.kind === "fall") {
      this.advanceDrops(phase, dt);
      if (phase.elapsed >= phase.duration + LAND_TIME) this.settle();
      return;
    }
    if (phase?.kind === "shuffle") {
      this.advanceShuffle(phase, dt);
      return;
    }

    this.guideTiles(dt);
    if (phase?.kind === "return" && phase.elapsed >= SWAP_TIME) this.phase = null;
    if (phase?.kind === "reject" && phase.elapsed >= REJECT_TIME) {
      this.phase = { kind: "return", elapsed: 0, front: phase.front };
    }
    if (phase?.kind === "swap" && phase.elapsed >= SWAP_TIME) {
      for (const tile of phase.moved) tile.position = [tile.col, tile.row, 0, 0];
      this.settle();
    }
    if (phase?.kind === "fuse" && phase.elapsed >= phase.duration) this.beginDrops(phase.groups);
  }

  guideTiles(dt) {
    const drag = this.drag;
    const preview = drag?.pull >= 0.12 ? this.cells[drag.target] : null;
    const hovered = !this.phase && !drag && this.cursor ? this.cells[this.hit(...this.cursor)] : null;
    const reject = this.phase?.kind === "reject" ? this.phase : null;
    this.cells.forEach((tile, index) => {
      if (!tile) return;
      const highlighted = tile === hovered || drag?.validTargets.has(index);
      if (tile === drag?.tile) {
        guide(tile, tile.col + drag.dx, tile.row + drag.dy, dt, true);
      } else if (tile === preview) {
        guide(tile, tile.col + drag.previewX, tile.row + drag.previewY, dt, false, highlighted);
      } else if (reject && (tile === reject.front || tile === reject.other)) {
        const destination = tile === reject.front ? reject.other : reject.front;
        guide(tile, destination.col, destination.row, dt);
      } else {
        guide(tile, tile.col, tile.row, dt, false, highlighted);
      }
    });
  }

  settle() {
    const groups = matchGroups(this.cells, this.shape);
    if (groups.length > 0) {
      this.phase = {
        kind: "fuse", elapsed: 0, groups, matched: new Set(groups.flat()),
        duration: this.fusionDuration, id: ++this.fusionId,
      };
    } else if (!hasMove(this.cells, this.shape)) {
      this.phase = { kind: "shuffle", elapsed: 0, rearranged: false };
    } else {
      this.phase = null;
    }
  }

  spawnRow(order) {
    return -this.layout.top / this.layout.step - 0.90 - order * 1.03;
  }

  beginDrops(groups) {
    const { cells, drops } = refill(this.cells, this.shape, groups, this.random, makeTile);
    this.cells = cells;
    const motions = new Map();
    const slideTime = 0.34;
    let longest = slideTime;
    for (const drop of drops) {
      const { tile, col, row, fromRow, order } = drop;
      tile.col = col;
      tile.row = row;
      const incoming = fromRow === null;
      const startRow = incoming ? this.spawnRow(order) : fromRow;
      const delay = incoming ? 0.035 + col * 0.006 + order * 0.032 : 0;
      const duration = incoming ? 0.41 + 0.025 * (row - startRow) + order * 0.021 : slideTime;
      tile.position = [col, startRow, 0, 0];
      motions.set(tile, { fromRow, order, delay, duration, landed: false });
      longest = Math.max(longest, duration + delay);
    }
    this.phase = { kind: "fall", elapsed: 0, motions, duration: longest };
  }

  advanceDrops(phase, dt) {
    for (const tile of this.cells) {
      if (!tile) continue;
      const drop = phase.motions.get(tile);
      if (!drop || drop.landed) {
        guide(tile, tile.col, tile.row, dt);
        continue;
      }
      const fromRow = drop.fromRow ?? this.spawnRow(drop.order);
      const t = clamp((phase.elapsed - drop.delay) / drop.duration, 0, 1);
      const progress = t * t * (1.24 - 0.24 * t);
      tile.position[1] = fromRow + (tile.row - fromRow) * progress;
      const speed = t >= 1 ? 0 : (tile.row - fromRow) * t * (2.48 - 0.72 * t) / drop.duration;
      if (t === 1) {
        tile.position[1] = tile.row;
        drop.landed = true;
        land(tile);
      }
      flex(tile, 0, speed, dt);
    }
  }

  advanceShuffle(phase, dt) {
    if (!phase.rearranged && phase.elapsed >= 0.24) {
      this.cells = shuffleBoard(this.cells, this.shape, this.random, makeTile);
      this.cells.forEach((tile, index) => {
        if (!tile) return;
        tile.col = index % this.shape.width;
        tile.row = Math.floor(index / this.shape.width);
        tile.position = [tile.col, tile.row, 0, 0];
      });
      phase.rearranged = true;
    }
    this.guideTiles(dt);
    if (phase.elapsed >= 0.48) this.phase = null;
  }

  view() {
    const phase = this.phase;
    const front = this.drag?.tile ?? phase?.front;
    const tiles = [];
    const fusions = [];
    const shuffle = phase?.kind === "shuffle" ? Math.min(1, Math.abs(phase.elapsed - 0.24) / 0.24) : 1;
    const opacity = shuffle * shuffle * (3 - 2 * shuffle);
    const scale = 0.74 + 0.26 * opacity;
    this.cells.forEach((tile, index) => {
      if (tile && tile !== front && !phase?.matched?.has(index)) {
        const view = tileView(tile, this.layout, scale, opacity);
        if (view.y >= -this.layout.step) tiles.push(view);
      }
    });
    if (front) tiles.push(tileView(front, this.layout, scale, opacity));

    if (phase?.kind === "fuse") {
      for (const group of phase.groups) {
        const { left, top, step } = this.layout;
        const members = new Set(group);
        fusions.push({
          key: `${phase.id}-${group[0]}`,
          points: group.map(index => {
            const { col, row } = this.cells[index];
            return {
              x: left + step * col,
              y: top + step * row,
              right: Number(members.has(indexAt(this.shape, col + 1, row))),
              down: Number(members.has(indexAt(this.shape, col, row + 1))),
            };
          }),
          half: step * 0.459, radius: step * 0.300, type: this.cells[group[0]].type,
          progress: Math.min(1, phase.elapsed / phase.duration),
        });
      }
    }
    return { tiles, fusions };
  }
}
