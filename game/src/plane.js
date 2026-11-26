// The Kestrel STOL bush plane: geometry built from shaded prisms, plus the
// arcade flight model — lift, drag, stall, ground roll and landing flare.
// Forward is -Z in plane-local space; heading 0 points east (+X) on the map.
import { clamp, lerp } from './rng.js';
import { MeshBuilder, mat4Identity, mat4Multiply, mat4RotateX, mat4RotateY, mat4RotateZ, mat4Translate } from './gl.js';
import { terrainHeight } from './terrain.js';

export const PLANE = {
  maxSpeed: 78,      // m/s at full throttle, level
  cruiseSpeed: 52,
  stallSpeed: 24,    // below this the wing stops flying
  rotateSpeed: 26,   // m/s where the nose can lift on takeoff
  maxClimb: 9,       // m/s climb at full power
  rollRate: 1.9,     // rad/s at full aileron
  pitchRate: 1.1,
  turnAuthority: 0.55,
};

const ORANGE = [0.92, 0.42, 0.10];
const CREAM = [0.94, 0.88, 0.74];
const DARK = [0.16, 0.17, 0.19];
const GLASS = [0.35, 0.62, 0.72];
const RED = [0.85, 0.12, 0.10];
const GREEN = [0.10, 0.65, 0.25];
const TYRE = [0.10, 0.10, 0.11];

// Fuselage is a tapered box: build it from 8 corner points.
function taperedFuselage(mb, colour) {
  const n = [-2.6, 0, 0]; // nose tip (local -Z is forward, so nose at -Z)
  const sections = [
    { z: -2.4, w: 0.42, h: 0.42 },
    { z: -0.6, w: 0.62, h: 0.62 },
    { z: 1.4, w: 0.55, h: 0.55 },
    { z: 3.2, w: 0.22, h: 0.30 },
  ];
  // Nose cone.
  const s0 = sections[0];
  const ring0 = [
    [-s0.w, -s0.h, s0.z], [s0.w, -s0.h, s0.z],
    [s0.w, s0.h, s0.z], [-s0.w, s0.h, s0.z],
  ];
  mb.tri(n, ring0[1], ring0[0], colour);
  mb.tri(n, ring0[2], ring0[1], colour);
  mb.tri(n, ring0[3], ring0[2], colour);
  mb.tri(n, ring0[0], ring0[3], colour);
  // Body segments.
  for (let s = 0; s < sections.length - 1; s += 1) {
    const a = sections[s];
    const b = sections[s + 1];
    const ra = [
      [-a.w, -a.h, a.z], [a.w, -a.h, a.z], [a.w, a.h, a.z], [-a.w, a.h, a.z],
    ];
    const rb = [
      [-b.w, -b.h, b.z], [b.w, -b.h, b.z], [b.w, b.h, b.z], [-b.w, b.h, b.z],
    ];
    for (let k = 0; k < 4; k += 1) {
      const k2 = (k + 1) % 4;
      mb.quad(ra[k], ra[k2], rb[k2], rb[k], colour);
    }
  }
  // Tail cap.
  const last = sections[sections.length - 1];
  mb.quad(
    [-last.w, -last.h, last.z], [last.w, -last.h, last.z],
    [last.w, last.h, last.z], [-last.w, last.h, last.z], colour,
  );
}

export function buildPlaneMesh() {
  const mb = new MeshBuilder();
  taperedFuselage(mb, ORANGE);
  // High wing with a slight dihedral, cream on top.
  mb.box([0, 0.72, -0.2], [4.6, 0.09, 0.95], CREAM);
  mb.box([0, 0.66, -0.2], [4.6, 0.06, 0.98], ORANGE);
  // Wing struts.
  mb.box([-1.9, 0.28, -0.2], [0.06, 0.5, 0.06], DARK);
  mb.box([1.9, 0.28, -0.2], [0.06, 0.5, 0.06], DARK);
  // Tailplane + fin.
  mb.box([0, 0.25, 3.0], [1.9, 0.07, 0.6], CREAM);
  mb.box([0, 0.75, 3.0], [0.07, 0.9, 0.7], ORANGE);
  // Windscreen + side windows.
  mb.box([0, 0.45, -1.15], [0.5, 0.35, 0.3], GLASS);
  mb.box([-0.5, 0.35, -0.9], [0.06, 0.28, 0.5], GLASS);
  mb.box([0.5, 0.35, -0.9], [0.06, 0.28, 0.5], GLASS);
  // Tundra tyres on spring legs.
  for (const sx of [-1, 1]) {
    mb.box([sx * 0.85, -0.55, -0.6], [0.08, 0.7, 0.08], DARK);
    mb.box([sx * 0.85, -1.05, -0.6], [0.32, 0.32, 0.32], TYRE);
  }
  mb.box([0, -0.6, 2.9], [0.06, 0.55, 0.06], DARK);
  mb.box([0, -1.0, 2.9], [0.18, 0.18, 0.18], TYRE);
  // Nav lights: red left, green right, white tail.
  mb.box([-4.6, 0.72, -0.2], [0.08, 0.08, 0.08], RED);
  mb.box([4.6, 0.72, -0.2], [0.08, 0.08, 0.08], GREEN);
  mb.box([0, 0.3, 3.35], [0.08, 0.08, 0.08], [0.95, 0.95, 0.9]);
  return mb;
}

// Propeller: two blades in a separate mesh so it can spin.
export function buildPropMesh() {
  const mb = new MeshBuilder();
  mb.box([0, 0, 0], [0.09, 1.15, 0.05], DARK);
  mb.box([0, 0, 0], [1.15, 0.09, 0.05], DARK);
  mb.box([0, 0, 0], [0.16, 0.16, 0.22], [0.5, 0.5, 0.52]);
  return mb;
}

export function newPlaneState() {
  return {
    x: -260, y: 0, z: 0,          // parked at the west threshold, on the runway
    heading: 0,                   // 0 = east (+X), radians, clockwise from above
    pitch: 0,
    roll: 0,
    speed: 0,
    throttle: 0,
    onGround: true,
    verticalSpeed: 0,
    propAngle: 0,
    flaps: 0,
  };
}

// One physics step. `ctl` carries -1..1 pitch/roll inputs, throttle 0..1,
// brake flag. Returns an event string: 'stall' | 'touchdown' | 'crash' | null.
export function stepPlane(p, ctl, dt, wind) {
  p.throttle = clamp(ctl.throttle, 0, 1);
  p.flaps = lerp(p.flaps, ctl.flaps ? 1 : 0, dt * 2);
  // Roll and pitch respond to the stick; on the ground the wings stay level
  // (a bush plane does not bank on its takeoff roll).
  if (p.onGround) {
    p.roll = lerp(p.roll, 0, dt * 6);
  } else {
    p.roll += ctl.roll * PLANE.rollRate * dt;
    p.roll = clamp(p.roll, -1.25, 1.25);
    if (Math.abs(ctl.roll) < 0.05) p.roll = lerp(p.roll, 0, dt * 0.35);
  }
  const pitchTarget = clamp(ctl.pitch * 0.55, -0.45, 0.55);
  p.pitch = lerp(p.pitch, pitchTarget, dt * 2.2);
  // Heading follows bank, more at speed.
  const speedFactor = clamp(p.speed / PLANE.cruiseSpeed, 0, 1.4);
  p.heading += -Math.sin(p.roll) * PLANE.turnAuthority * speedFactor * dt * 2.4;
  // Speed: throttle pushes toward its target, drag pulls back, flaps add drag.
  // Drag is light at idle so a power-off dive really accelerates (and a
  // power-off glide really glides); at power it answers the throttle.
  const targetSpeed = p.throttle * PLANE.maxSpeed;
  const drag = p.flaps ? 0.55 : 0.10 + 0.22 * p.throttle;
  p.speed += (targetSpeed - p.speed) * drag * dt;
  if (ctl.brake && p.onGround) p.speed = Math.max(0, p.speed - 26 * dt);
  // Gravity along the flight path: a dive trades height for speed and a
  // climb bleeds it — pulling up hard can stall the wing, and a dive into
  // the valley floor arrives fast enough to crash.
  if (!p.onGround) p.speed += -Math.sin(p.pitch) * 9.8 * dt;
  if (p.speed < 0) p.speed = 0;
  // Climb: pitch converts speed to vertical speed; below stall speed the wing
  // gives up and the nose drops.
  const stalled = p.speed < PLANE.stallSpeed && !p.onGround;
  let climb = Math.sin(p.pitch) * p.speed;
  if (stalled) climb = -7;
  if (p.onGround) {
    climb = 0;
    if (p.speed > PLANE.rotateSpeed && p.pitch > 0.06) {
      p.onGround = false;
      climb = Math.sin(p.pitch) * p.speed;
    }
  }
  p.verticalSpeed = climb;
  // Wind gusts push the plane sideways a touch; forward is (cos h, -sin h)
  // with heading 0 = east, so the nose tracks the compass the HUD shows.
  const fwdX = Math.cos(p.heading);
  const fwdZ = -Math.sin(p.heading);
  p.x += (fwdX * p.speed + wind[0]) * dt;
  p.z += (fwdZ * p.speed + wind[1]) * dt;
  p.y += climb * dt;
  p.propAngle += (4 + p.throttle * 46) * dt;
  // Ground contact. Impact is the velocity driven INTO the terrain surface,
  // measured against the slope's upward normal — so flying level into a
  // rising hillside crashes just like dropping hard onto flat ground, while
  // a gentle descent onto the flat runway is a landing.
  const g = terrainHeight(p.x, p.z) + 1.1;
  if (p.y <= g) {
    p.y = g;
    const e = 2;
    const slopeX = (terrainHeight(p.x + e, p.z) - terrainHeight(p.x - e, p.z)) / (2 * e);
    const slopeZ = (terrainHeight(p.x, p.z + e) - terrainHeight(p.x, p.z - e)) / (2 * e);
    let nx = -slopeX;
    let ny = 1;
    let nz = -slopeZ;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    const vx = fwdX * p.speed + wind[0];
    const vz = fwdZ * p.speed + wind[1];
    const impact = -(vx * nx + climb * ny + vz * nz);
    if (!p.onGround) {
      p.onGround = true;
      p.pitch = 0;
      p.roll = lerp(p.roll, 0, 0.8);
      if (impact > 9) return 'crash';
      if (impact > 2.5) return 'touchdown';
    }
    if (p.speed < 4 && p.throttle < 0.05) p.speed = 0;
  }
  if (p.y > 900) p.y = 900;
  if (Math.abs(p.x) > 2400 || Math.abs(p.z) > 2400) {
    // Soft world edge: turn the nose back toward the valley.
    p.heading += dt * 0.6 * (p.z > 0 ? 1 : -1) * (p.x > 0 ? -1 : 1);
  }
  // Stalled only counts as a stall event while properly airborne, clear of
  // the ground — a slow taxi is not a stall.
  const groundNow = terrainHeight(p.x, p.z) + 1.1;
  return stalled && p.y > groundNow + 2 ? 'stall' : null;
}

// Model matrix for the plane mesh from its state. Local forward is -Z, so a
// heading of h needs RotateY(h - PI/2); roll is banked right-wing-down, which
// is a negative rotation about the local Z axis.
export function planeModelMatrix(p) {
  let m = mat4Identity();
  m = mat4Multiply(m, mat4Translate(p.x, p.y, p.z));
  m = mat4Multiply(m, mat4RotateY(p.heading - Math.PI / 2));
  m = mat4Multiply(m, mat4RotateZ(-p.roll));
  m = mat4Multiply(m, mat4RotateX(p.pitch));
  return m;
}

// Propeller sits at the nose: nose is local -Z, so offset forward.
export function propModelMatrix(p) {
  let m = planeModelMatrix(p);
  m = mat4Multiply(m, mat4Translate(0, 0, -2.65));
  m = mat4Multiply(m, mat4RotateZ(p.propAngle));
  return m;
}
