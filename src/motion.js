export function layoutFor(width, height, columns, rows) {
  const step = Math.max(1, Math.min(96, (width - 40) / columns, height * 0.75 / rows));
  return {
    step,
    left: (width - (columns - 1) * step) * 0.5,
    top: (height - (rows - 1) * step) * 0.5 + height * 0.036,
  };
}

export function makeTile(type, col, row) {
  return {
    type, col, row,
    position: [col, row, 0, 0],
    shell: [0, 0, 0, 0],
    core: [0, 0, 0, 0],
    phase: (col * 1.81 + row * 2.33 + type * 0.74) % (2 * Math.PI),
    focus: 0,
    lift: 0,
  };
}

function spring(state, x, y, frequency, damping, dt) {
  if (Math.abs(state[0] - x) + Math.abs(state[1] - y)
    + 0.06 * (Math.abs(state[2]) + Math.abs(state[3])) < 0.00012) {
    state[0] = x;
    state[1] = y;
    state[2] = 0;
    state[3] = 0;
    return;
  }

  const decay = frequency * damping;
  const oscillation = frequency * Math.sqrt(1 - damping * damping);
  const envelope = Math.exp(-decay * dt);
  const cosine = Math.cos(oscillation * dt);
  const sine = Math.sin(oscillation * dt);
  for (let axis = 0; axis < 2; axis++) {
    const target = axis === 0 ? x : y;
    const error = state[axis] - target;
    const velocity = state[axis + 2];
    const wave = (velocity + decay * error) / oscillation;
    const displacement = error * cosine + wave * sine;
    state[axis] = target + envelope * displacement;
    state[axis + 2] = envelope * ((wave * cosine - error * sine) * oscillation - decay * displacement);
  }
}

export function flex(tile, vx, vy, dt, grabbed = false, hovered = false) {
  const speedSquared = vx * vx + vy * vy;
  const speed = Math.sqrt(speedSquared);
  const axisX = (vx * vx - vy * vy) / Math.max(0.00001, speedSquared);
  const axisY = 2 * vx * vy / Math.max(0.00001, speedSquared);
  const shellPull = Math.min(0.144, speed * (grabbed ? 0.038 : 0.024));
  const lag = Math.min(0.11, speed * 0.028) / Math.max(0.001, speed);
  spring(tile.shell, axisX * shellPull, axisY * shellPull, 25, 0.56, dt);
  spring(tile.core, -vx * lag, -vy * lag, 17, 0.47, dt);
  const release = 1 - Math.exp(-dt * 14);
  tile.lift += ((grabbed ? 1 : 0) - tile.lift) * release;
  tile.focus += ((grabbed || hovered ? 1 : 0) - tile.focus) * release;
}

export function guide(tile, x, y, dt, grabbed = false, hovered = false) {
  spring(tile.position, x, y, grabbed ? 35 : 26, grabbed ? 0.76 : 0.71, dt);
  flex(tile, tile.position[2], tile.position[3], dt, grabbed, hovered);
}

export function land(tile) {
  tile.shell[2] += 2.65;
  tile.core[3] += 1.35;
}

export function tileView(tile, { left, top, step }, scale = 1, opacity = 1) {
  const [col, row] = tile.position;
  const [strainX, strainY] = tile.shell;
  const [lagX, lagY] = tile.core;
  const x = left + col * step;
  const y = top + row * step;
  const offset = Math.min(1, 0.108 / Math.max(0.001, Math.hypot(lagX, lagY)));
  return {
    x, y, half: step * 0.459 * scale * (1 + tile.lift * 0.038), opacity,
    strainX, strainY, tugX: 0.81 * lagX, tugY: 0.81 * lagY,
    orbX: x + lagX * offset * step,
    orbY: y + lagY * offset * step + 0.55,
    orbRadius: step * 0.300 * scale, type: tile.type,
    phase: tile.phase, focus: tile.focus, lift: tile.lift,
  };
}
