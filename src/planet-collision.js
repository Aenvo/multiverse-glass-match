// Keep the black hole on the longest connected glass branch. Horizontal ties
// are deterministic, including crosses and L/T groups with equal-length arms.
export function collisionGeometry({ points, radius }) {
  const step = radius / 0.3;
  let longest = [];
  let axis = [1, 0];
  for (const along of ["x", "y"]) {
    const across = along === "x" ? "y" : "x";
    const ordered = [...points].sort((a, b) => a[across] - b[across] || a[along] - b[along]);
    let run = [];
    let previous = null;
    for (const point of ordered) {
      if (!previous || point[across] !== previous[across]
        || Math.abs(point[along] - previous[along] - step) > step * 0.001) run = [];
      run.push(point);
      if (run.length > longest.length) {
        longest = [...run];
        axis = along === "x" ? [1, 0] : [0, 1];
      }
      previous = point;
    }
  }
  const first = longest[0];
  const last = longest.at(-1);
  const center = [(first.x + last.x) * 0.5, (first.y + last.y) * 0.5];
  const reach = (Math.hypot(last.x - first.x, last.y - first.y) * 0.5 + radius * 0.9) * 0.68;
  const padding = radius * 1.8;
  return {
    center, axis, reach,
    bounds: [
      Math.min(...points.map(point => point.x)) - padding,
      Math.min(...points.map(point => point.y)) - padding,
      Math.max(...points.map(point => point.x)) + padding,
      Math.max(...points.map(point => point.y)) + padding,
    ],
  };
}
