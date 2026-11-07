export const orbCatalog = [
  { field: "shdr-01", name: "Dispersion", shader: "SHDR-01", extent: 0.45, phase: 2.73 },
  { field: "shdr-02", name: "Rocaille", shader: "SHDR-02", extent: 0.45, phase: 5.46 },
  { field: "shdr-03", name: "Ecliptic", shader: "SHDR-03", extent: 0.461, phase: 8.19 },
  { field: "shdr-04", name: "Geode", shader: "SHDR-04", extent: 0.49, phase: 10.92 },
  { field: "shdr-05", name: "Caustic", shader: "SHDR-05", extent: 0.45, phase: 13.65 },
  { field: "shdr-06", name: "Moire", shader: "SHDR-06", extent: 0.45, phase: 16.38 },
  { field: "shdr-07", name: "Torsion", shader: "SHDR-07", extent: 0.45, phase: 2.11 },
  { field: "shdr-08", name: "Nacre", shader: "SHDR-08", extent: 0.45, phase: 4.84 },
  { field: "shdr-09", name: "Iris", shader: "SHDR-09", extent: 0.45, phase: 7.57 },
  { field: "shdr-10", name: "Weave", shader: "SHDR-10", extent: 0.455, phase: 14.7 },
  { field: "shdr-11", name: "Hydrogen", shader: "SHDR-11", extent: 0.45, phase: 7.1 },
  { field: "shdr-12", name: "Brick", shader: "SHDR-12", extent: 0.475, phase: 15.76 },
  { field: "shdr-13", name: "Ion", shader: "SHDR-13", extent: 0.45, phase: 1.49 },
  { field: "shdr-14", name: "Dither", shader: "SHDR-14", extent: 0.45, phase: 4.22 },
  { field: "shdr-15", name: "Muons", shader: "SHDR-15", extent: 0.45, phase: 6.95 },
  { field: "shdr-16", name: "Caustic", shader: "SHDR-16", extent: 0.45, phase: 9.68 },
  { field: "shdr-17", name: "Tempest", shader: "SHDR-17", extent: 0.45, phase: 12.41 },
  { field: "shdr-18", name: "Octant", shader: "SHDR-18", extent: 0.463, phase: 2.4 },
  { field: "shdr-19", name: "Foam", shader: "SHDR-19", extent: 0.45, phase: 0.87 },
  { field: "shdr-20", name: "Falls", shader: "SHDR-20", extent: 0.45, phase: 3.6 },
  { field: "shdr-21", name: "Nimbus", shader: "SHDR-21", extent: 0.459, phase: 7.9 },
  { field: "shdr-22", name: "Vectors", shader: "SHDR-22", extent: 0.45, phase: 9.06 },
  { field: "shdr-23", name: "Phosphor", shader: "SHDR-23", extent: 0.45, phase: 11.79 },
  { field: "shdr-24", name: "Chunk", shader: "SHDR-24", extent: 0.49, phase: 14.52 },
  { field: "shdr-25", name: "Crease", shader: "SHDR-25", extent: 0.45, phase: 0.25 },
  { field: "shdr-26", name: "Lattice", shader: "SHDR-26", extent: 0.45, phase: 2.98 },
  { field: "shdr-27", name: "Radar", shader: "SHDR-27", extent: 0.45, phase: 5.71 },
  { field: "shdr-28", name: "Bitdumb", shader: "SHDR-28", extent: 0.45, phase: 8.44 },
  { field: "shdr-29", name: "Mosaic", shader: "SHDR-29", extent: 0.45, phase: 11.17 },
  { field: "shdr-30", name: "Droste", shader: "SHDR-30", extent: 0.45, phase: 13.9 },
  { field: "shdr-31", name: "Corona", shader: "SHDR-31", extent: 0.48, phase: 16.63 },
  { field: "shdr-32", name: "Galaxy", shader: "SHDR-32", extent: 0.45, phase: 2.36 },
  { field: "shdr-33", name: "Heat", shader: "SHDR-33", extent: 0.45, phase: 5.09 },
];

export function pickOrbTypes(random = Math.random, catalog = orbCatalog) {
  const pool = [...catalog];
  for (let index = pool.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [pool[index], pool[other]] = [pool[other], pool[index]];
  }
  return pool.slice(0, 4);
}

export const orbTypes = pickOrbTypes();
