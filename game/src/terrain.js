// The valley of Skyhook Valley: a seeded heightmap, a lake, a dirt runway with
// hangars, and a pine forest — all baked into static WebGL buffers at load time.
// The runway sits on the valley floor at the origin, pointing east (+X).
import { fbm, mulberry32, range, smoothstep } from './rng.js';
import { MeshBuilder } from './gl.js';

export const WORLD_HALF = 2000; // terrain spans -2000..2000 m on both axes
export const RUNWAY = { x: 0, z: 0, length: 620, width: 26, heading: 0 };
export const LAKE = { x: -1150, z: 850, radius: 330, level: 0.4 };
export const SEED = 20261126;

const GRID = 129; // vertices per side of the terrain mesh

// Valley shape: flat floor along the centre line (z ~ 0), walls rising with |z|
// and toward both ends of the valley, plus rolling fbm detail everywhere.
export function terrainHeight(x, z) {
  const wall = smoothstep(420, 1650, Math.abs(z));
  const ends = smoothstep(900, 1900, Math.abs(x));
  const rise = Math.max(wall, ends * 0.85);
  let h = fbm(x * 0.0011 + 7.3, z * 0.0011 + 2.9, SEED, 4) * 46 * (0.25 + rise);
  h += rise * rise * 430;
  h += fbm(x * 0.004 + 1.7, z * 0.004 + 8.4, SEED + 55, 3) * 14 * (0.3 + rise);
  // Carve the lake bowl.
  const lakeD = Math.hypot(x - LAKE.x, z - LAKE.z) / LAKE.radius;
  if (lakeD < 1.25) h = h * smoothstep(0.55, 1.25, lakeD) - 6 * (1 - smoothstep(0.4, 1.1, lakeD));
  // Flatten the runway strip so takeoffs and landings are fair.
  const rx = Math.abs(x - RUNWAY.x);
  const rz = Math.abs(z - RUNWAY.z);
  if (rx < RUNWAY.length / 2 + 40 && rz < RUNWAY.width / 2 + 40) {
    const t = smoothstep(0, 1, Math.max(
      (rx - RUNWAY.length / 2) / 40,
      (rz - RUNWAY.width / 2) / 40,
    ));
    h = h * t + 0.6 * (1 - t);
  }
  return h;
}

// Colour by height and slope: sand at the waterline, grass on the floor,
// dark rock on steep ground, snow on the high peaks.
function groundColour(x, z, h, slope) {
  if (h < 1.6) return [0.76, 0.68, 0.45]; // sandy shore
  if (slope > 0.55) return [0.42, 0.38, 0.36]; // bare rock
  if (h > 250) return [0.92, 0.93, 0.95]; // snow caps
  if (h > 120) return [0.48, 0.42, 0.30]; // high scrub
  const patch = fbm(x * 0.01 + 3.1, z * 0.01 + 5.7, SEED + 91, 2);
  const g = 0.42 + patch * 0.16;
  return [0.30 + patch * 0.10, g, 0.20 + patch * 0.06]; // valley grass
}

function buildTerrainMesh() {
  const mb = new MeshBuilder();
  const step = (WORLD_HALF * 2) / (GRID - 1);
  const heights = [];
  for (let j = 0; j < GRID; j += 1) {
    for (let i = 0; i < GRID; i += 1) {
      const x = -WORLD_HALF + i * step;
      const z = -WORLD_HALF + j * step;
      heights.push(terrainHeight(x, z));
    }
  }
  const at = (i, j) => heights[j * GRID + i];
  for (let j = 0; j < GRID - 1; j += 1) {
    for (let i = 0; i < GRID - 1; i += 1) {
      const x0 = -WORLD_HALF + i * step;
      const z0 = -WORLD_HALF + j * step;
      const p00 = [x0, at(i, j), z0];
      const p10 = [x0 + step, at(i + 1, j), z0];
      const p01 = [x0, at(i, j + 1), z0 + step];
      const p11 = [x0 + step, at(i + 1, j + 1), z0 + step];
      const midH = (p00[1] + p10[1] + p01[1] + p11[1]) / 4;
      const slope = Math.max(
        Math.abs(p10[1] - p00[1]), Math.abs(p01[1] - p00[1]),
      ) / step;
      const col = groundColour(x0 + step / 2, z0 + step / 2, midH, slope);
      // Winding: (p00, p11, p10) and (p00, p01, p11) put the normal up (+Y),
      // so the ground is lit from above and never backface-culled.
      mb.tri(p00, p11, p10, col).tri(p00, p01, p11, col);
    }
  }
  return mb;
}

// The lake surface: one flat disc, drawn translucent blue over the bowl.
function buildWaterMesh() {
  const mb = new MeshBuilder();
  const cx = LAKE.x;
  const cz = LAKE.z;
  const y = LAKE.level;
  const col = [0.25, 0.52, 0.68];
  const n = 24;
  for (let i = 0; i < n; i += 1) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    // Wound centre -> a1 -> a0 so the normal points up.
    mb.tri(
      [cx, y, cz],
      [cx + Math.cos(a1) * LAKE.radius, y, cz + Math.sin(a1) * LAKE.radius],
      [cx + Math.cos(a0) * LAKE.radius, y, cz + Math.sin(a0) * LAKE.radius],
      col,
    );
  }
  return mb;
}

// A flat quad on the ground, wound so its normal points up (+Y).
function flatQuad(mb, x0, z0, x1, z1, y, colour) {
  mb.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], colour);
}

// Runway strip, threshold bars, centreline dashes and a taxiway to the hangars.
function buildRunwayMesh() {
  const mb = new MeshBuilder();
  const y = 0.85;
  const half = RUNWAY.length / 2;
  const w = RUNWAY.width / 2;
  const asphalt = [0.16, 0.16, 0.18];
  const white = [0.92, 0.92, 0.88];
  const dirt = [0.55, 0.46, 0.33];
  // Dirt apron under the asphalt.
  flatQuad(mb, -half - 30, -w - 22, half + 30, w + 22, 0.7, dirt);
  // Asphalt strip.
  flatQuad(mb, -half, -w, half, w, y, asphalt);
  // Threshold bars at both ends.
  for (const sx of [-1, 1]) {
    for (let k = -2; k <= 2; k += 1) {
      const bx = sx * (half - 14);
      flatQuad(mb, bx - 5, k * 4 - 1.2, bx + 5, k * 4 + 1.2, y + 0.05, white);
    }
  }
  // Centreline dashes.
  for (let x = -half + 40; x < half - 40; x += 44) {
    flatQuad(mb, x, -1, x + 22, 1, y + 0.05, white);
  }
  // Taxiway south to the hangar row.
  flatQuad(mb, -8, w, 8, w + 70, y, asphalt);
  return mb;
}

// Three hangars, a windsock pole, and a pine forest baked into one mesh.
// Trees keep clear of the runway, the taxiway and the lake.
function buildPropsMesh() {
  const mb = new MeshBuilder();
  const rand = mulberry32(SEED + 7);
  const hangarWall = [0.62, 0.58, 0.52];
  const hangarRoof = [0.35, 0.42, 0.48];
  const door = [0.20, 0.24, 0.28];
  for (let k = 0; k < 3; k += 1) {
    const hx = -90 + k * 55;
    const hz = 108;
    mb.box([hx, 7, hz], [20, 7, 14], hangarWall);
    mb.box([hx, 15.2, hz], [21, 1.6, 15], hangarRoof);
    mb.box([hx, 5, hz - 14.2], [12, 5, 0.6], door);
  }
  // Windsock pole beside the runway threshold.
  const pole = [0.45, 0.45, 0.45];
  mb.box([RUNWAY.length / 2 + 18, 6, -RUNWAY.width / 2 - 14], [0.35, 6, 0.35], pole);
  mb.cone(
    [RUNWAY.length / 2 + 18, 11.4, -RUNWAY.width / 2 - 14], 1.2, 1.1,
    [0.95, 0.45, 0.15],
  );
  // Pine forest.
  const trunk = [0.32, 0.22, 0.14];
  const pine = [0.16, 0.38, 0.18];
  const pineLight = [0.22, 0.46, 0.22];
  let placed = 0;
  let guard = 0;
  while (placed < 620 && guard < 9000) {
    guard += 1;
    const x = range(rand, -1950, 1950);
    const z = range(rand, -1950, 1950);
    const h = terrainHeight(x, z);
    if (h < 2 || h > 150) continue;
    if (Math.abs(x) < RUNWAY.length / 2 + 70 && Math.abs(z) < 130) continue;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.radius + 30) continue;
    const s = range(rand, 0.7, 1.5);
    mb.box([x, h + 2 * s, z], [0.7 * s, 2 * s, 0.7 * s], trunk);
    mb.cone([x, h + 3.5 * s, z], 9 * s, 4.2 * s, placed % 3 ? pine : pineLight);
    placed += 1;
  }
  // Boulders on the high ground.
  const rock = [0.45, 0.43, 0.40];
  for (let k = 0; k < 90; k += 1) {
    const x = range(rand, -1950, 1950);
    const z = range(rand, -1950, 1950);
    const h = terrainHeight(x, z);
    if (h < 60) continue;
    const s = range(rand, 2, 7);
    mb.box([x, h + s * 0.4, z], [s, s * 0.6, s * 0.8], rock);
  }
  return mb;
}

export function buildWorld(gl) {
  return {
    terrain: buildTerrainMesh().toBuffer(gl),
    water: buildWaterMesh().toBuffer(gl),
    runway: buildRunwayMesh().toBuffer(gl),
    props: buildPropsMesh().toBuffer(gl),
  };
}
