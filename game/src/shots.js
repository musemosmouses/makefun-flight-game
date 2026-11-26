// Deterministic screenshot staging for Skyhook Valley. Each named shot plays
// the real game forward from a fresh world for a fixed number of steps, steered
// by a simple autopilot (full throttle, climb toward the next ring, bank into
// the turn), so the frame is what a real sortie looks like and the same seed
// always gives the same frame. No clock, no unseeded randomness.
import { stepPlane } from './plane.js';
import { nextRing, checkRingCross, headingTo } from './rings.js';

const STEP = 1 / 60;

// Steer toward the next ring: bank into the heading error, pitch for its height.
export function autopilot(game) {
  const p = game.plane;
  const ring = nextRing(game.rings);
  if (!ring) return { pitch: 0, roll: 0, throttle: 0.4, flaps: false, brake: false };
  const wantHeading = headingTo(p.x, p.z, ring.x, ring.z);
  let dh = wantHeading - p.heading;
  while (dh > Math.PI) dh -= Math.PI * 2;
  while (dh < -Math.PI) dh += Math.PI * 2;
  // Bank is an angle the physics integrates from the stick, so drive it with
  // a proportional loop: ask for the bank the heading error needs, then push
  // the stick toward that bank. A raw heading-error stick oscillates.
  // Bank left (negative roll) to turn toward a larger heading: heading grows
  // when the plane banks left, because forward is (cos h, -sin h).
  const wantBank = Math.max(-0.6, Math.min(0.6, -dh * 1.4));
  const roll = Math.max(-1, Math.min(1, (wantBank - p.roll) * 3));
  // Hold the ring's altitude exactly: the ring's sphere is only 14 m, so
  // levelling 10 m above it would miss every time.
  const pitch = Math.max(-0.8, Math.min(0.8, (ring.y - p.y) * 0.03));
  return { pitch, roll, throttle: 0.85, flaps: false, brake: false };
}

// Play the real physics forward `seconds`, marking rings as the plane flies
// through them. Stops early on a crash or a full stop on the ground.
export function runSteps(game, seconds) {
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n; i += 1) {
    const ctl = autopilot(game);
    const prev = { x: game.plane.x, y: game.plane.y, z: game.plane.z };
    const event = stepPlane(game.plane, ctl, STEP, game.windAt(game.timeSec));
    game.timeSec += STEP;
    game.wind = game.windAt(game.timeSec);
    game.throttle = ctl.throttle;
    const ring = nextRing(game.rings);
    if (ring && checkRingCross(ring, prev, game.plane)) {
      ring.passed = true;
      game.score += 100;
      game.timeLeft = Math.min(240, game.timeLeft + 6);
    }
    if (event === 'crash') break;
    if (game.plane.onGround && game.plane.speed < 1 && i > 120) break;
  }
}

// Stage one named shot on a fresh game and return its camera.
//   cover   — mid-flight, banking toward ring 3, runway and lake behind
//   cockpit — cockpit view, ring ahead through the windscreen
//   takeoff — just after rotation, low over the runway
//   rings   — threading the canyon ring, walls close on both sides
export function stageShot(name, game) {
  const shots = {
    cover: { seconds: 18, camera: 'chase' },
    cockpit: { seconds: 26, camera: 'cockpit' },
    takeoff: { seconds: 6, camera: 'chase' },
    rings: { seconds: 100, camera: 'chase' },
  };
  const shot = shots[name] || shots.cover;
  game.setScreen('flying');
  runSteps(game, shot.seconds);
  game.camera = shot.camera;
  return shot.camera;
}
