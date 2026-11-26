// The ring course: 12 glowing rings strung across the valley in one fixed,
// seeded order — low over the lake, through the canyon gap, around the peak,
// and home over the runway. Flying through the lit ring scores and lights the next.
import { mulberry32, range, clamp } from './rng.js';
import { terrainHeight } from './terrain.js';
import { MeshBuilder } from './gl.js';

export const RING_COUNT = 12;
export const RING_RADIUS = 14;

// Hand-placed waypoints (x, z, altitude above ground) chosen to show the whole
// valley: runway, lake, canyon, peak, and back home. Seeded jitter keeps the
// exact heights honest to the terrain underneath.
const WAYPOINTS = [
  [420, -260, 55],
  [950, -520, 90],
  [1350, -150, 120],
  [900, 420, 80],
  [150, 780, 70],
  [-700, 900, 60],   // low over the lake
  [-1350, 500, 110],
  [-1500, -250, 160], // canyon gap
  [-900, -800, 200],
  [-250, -1050, 260], // around the peak
  [350, -750, 150],
  [250, -120, 45],   // final: over the runway threshold
];

export function buildCourse() {
  const rand = mulberry32(777);
  const rings = WAYPOINTS.map(([x, z, alt], i) => {
    const ground = terrainHeight(x, z);
    const y = Math.max(ground + alt, ground + 40) + range(rand, -4, 4);
    return {
      index: i,
      x, y, z,
      radius: RING_RADIUS,
      passed: false,
    };
  });
  return rings;
}

// A torus made of a ring of small boxes, so the ring reads from every angle.
export function buildRingMesh() {
  const mb = new MeshBuilder();
  const segs = 28;
  const tube = 0.9;
  const col = [1.0, 0.75, 0.15];
  for (let i = 0; i < segs; i += 1) {
    const a = (i / segs) * Math.PI * 2;
    const x = Math.cos(a) * RING_RADIUS;
    const y = Math.sin(a) * RING_RADIUS;
    mb.box([x, y, 0], [tube, tube, tube], col);
  }
  return mb;
}

// Next unpassed ring, or null when the course is done.
export function nextRing(rings) {
  for (const r of rings) if (!r.passed) return r;
  return null;
}

// Distance from the plane to the ring's centre plane crossing: true when the
// plane passed through the disc this step (segment from prev to pos crosses
// the ring plane within the radius).
export function checkRingCross(ring, prev, pos) {
  // Ring faces the incoming flight path: its plane is vertical, facing the
  // previous ring (approximated by facing the valley centre line here).
  // We use a simpler robust test: distance to centre < radius while the
  // plane is within 6 m of the ring's z/x crossing line. To keep it honest
  // and simple, treat the ring as a sphere of its radius: crossing the sphere
  // counts as flying through the ring.
  const dx = pos.x - ring.x;
  const dy = pos.y - ring.y;
  const dz = pos.z - ring.z;
  const d = Math.hypot(dx, dy, dz);
  const prevD = Math.hypot(prev.x - ring.x, prev.y - ring.y, prev.z - ring.z);
  // Entered the sphere this step.
  return prevD > ring.radius && d <= ring.radius;
}

// Heading (radians, 0 = east) from the plane toward a point.
export function headingTo(px, pz, tx, tz) {
  return Math.atan2(-(tz - pz), tx - px);
}
