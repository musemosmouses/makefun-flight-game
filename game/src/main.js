// Skyhook Valley — boot and render loop. WebGL draws the world (sky, terrain,
// water, runway, props, rings, plane, clouds); a 2D canvas draws the HUD on
// top. Fixed-step physics at 60 Hz, render as fast as the browser goes.
import { Game } from './game.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { buildWorld, terrainHeight } from './terrain.js';
import { Sky, SUN_DIR } from './sky.js';
import { buildPlaneMesh, buildPropMesh, planeModelMatrix, propModelMatrix } from './plane.js';
import { buildRingMesh, nextRing } from './rings.js';
import { stageShot } from './shots.js';
import {
  mat4Identity, mat4Multiply, mat4Perspective, mat4LookAt, mat4Translate,
  makeProgram, drawMesh,
} from './gl.js';

const WORLD_VS = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec3 aColor;
varying vec3 vNormal;
varying vec3 vColor;
varying float vDist;
uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uModel;
void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vec4 view = uView * world;
  vNormal = mat3(uModel) * aNormal;
  vColor = aColor;
  vDist = -view.z;
  gl_Position = uProj * view;
}`;

const WORLD_FS = `
precision mediump float;
varying vec3 vNormal;
varying vec3 vColor;
varying float vDist;
uniform vec3 uSun;
uniform vec3 uFogColor;
void main() {
  vec3 n = normalize(vNormal);
  float diff = max(dot(n, normalize(uSun)), 0.0);
  vec3 col = vColor * (0.42 + 0.62 * diff);
  float fog = 1.0 - exp(-vDist * 0.00042);
  col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}`;

const FOG_COLOR = [0.82, 0.72, 0.58];

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');

const canvas = document.getElementById('game');
const hudCanvas = document.getElementById('hud');
const gl = canvas.getContext('webgl', { antialias: true, alpha: false });
if (!gl) {
  document.getElementById('screen-title').textContent =
    'WebGL is not available in this browser.';
  throw new Error('no webgl');
}

const game = new Game();
const hud = new Hud(hudCanvas);
game.hud = hud;
const input = new Input(canvas);
const world = buildWorld(gl);
const sky = new Sky(gl);
const planeMesh = buildPlaneMesh().toBuffer(gl);
const propMesh = buildPropMesh().toBuffer(gl);
const ringMesh = buildRingMesh().toBuffer(gl);

const worldProg = makeProgram(gl, WORLD_VS, WORLD_FS);
worldProg.loc = {
  position: gl.getAttribLocation(worldProg, 'aPosition'),
  normal: gl.getAttribLocation(worldProg, 'aNormal'),
  color: gl.getAttribLocation(worldProg, 'aColor'),
  proj: gl.getUniformLocation(worldProg, 'uProj'),
  view: gl.getUniformLocation(worldProg, 'uView'),
  model: gl.getUniformLocation(worldProg, 'uModel'),
  sun: gl.getUniformLocation(worldProg, 'uSun'),
  fog: gl.getUniformLocation(worldProg, 'uFogColor'),
};
gl.enableVertexAttribArray(worldProg.loc.position);
gl.enableVertexAttribArray(worldProg.loc.normal);
gl.enableVertexAttribArray(worldProg.loc.color);
gl.enable(gl.DEPTH_TEST);
// No face culling: the sky dome is viewed from inside, and several meshes
// are triangle soup with mixed winding — culling would eat whole surfaces.

// DOM screens.
const screens = {
  title: document.getElementById('screen-title'),
  crashed: document.getElementById('screen-crashed'),
  complete: document.getElementById('screen-complete'),
};

function showScreen(name, reason, score) {
  for (const key of Object.keys(screens)) {
    if (screens[key]) screens[key].classList.toggle('hidden', key !== name);
  }
  if (name === 'crashed' || name === 'complete') {
    // Both end screens share the .final-title / .final-stats classes; set all.
    document.querySelectorAll('.final-title').forEach((el) => {
      el.textContent = reason || '';
    });
    const done = game.rings.filter((r) => r.passed).length;
    document.querySelectorAll('.final-stats').forEach((el) => {
      el.textContent =
        'Score ' + score + '  ·  Rings ' + done + ' / ' + game.rings.length +
        '  ·  Best ' + game.stats.best;
    });
  }
  if (name === 'title') {
    document.getElementById('best-score').textContent =
      game.stats.best > 0 ? 'Best score: ' + game.stats.best : '';
  }
}
game.onScreen = showScreen;

function startGame() {
  game.startSortie();
  if (document.activeElement) document.activeElement.blur();
}
document.getElementById('btn-fly').addEventListener('click', startGame);
document.getElementById('btn-retry').addEventListener('click', startGame);
document.getElementById('btn-again').addEventListener('click', startGame);
input.onFirstGesture = () => game.sound.ensure();
input.onKey = (code) => {
  if (code === 'Enter' && game.screen === 'title') startGame();
  if (code === 'KeyR' && game.screen !== 'title' && game.screen !== 'paused') startGame();
  if (code === 'KeyP') game.togglePause();
  if (code === 'KeyC') game.toggleCamera();
  if (code === 'KeyM') game.toggleMute();
  if (code === 'Escape' && game.screen === 'paused') game.togglePause();
};

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w;
  canvas.height = h;
  hud.resize(w, h);
  gl.viewport(0, 0, w, h);
}
window.addEventListener('resize', resize);
resize();

// Camera smoothing state.
const cam = { x: -280, y: 14, z: 16 };

function cameraMatrices(p, dt) {
  const aspect = canvas.width / Math.max(1, canvas.height);
  const proj = mat4Perspective(1.15, aspect, 0.5, 9000);
  const cp = Math.cos(p.pitch);
  const fwd = [Math.cos(p.heading) * cp, Math.sin(p.pitch), -Math.sin(p.heading) * cp];
  if (game.camera === 'cockpit') {
    const eye = [
      p.x + fwd[0] * 0.4,
      p.y + 0.55,
      p.z + fwd[2] * 0.4,
    ];
    const up = planeUp(p);
    const target = [p.x + fwd[0] * 120, p.y + fwd[1] * 120, p.z + fwd[2] * 120];
    return { proj, view: mat4LookAt(eye, target, up) };
  }
  // Chase: settle behind and above the plane, eased toward its tail.
  const want = [
    p.x - fwd[0] * 15 + 0,
    p.y - fwd[1] * 15 + 4.2,
    p.z - fwd[2] * 15,
  ];
  const k = 1 - Math.exp(-dt * 5);
  cam.x += (want[0] - cam.x) * k;
  cam.y += (want[1] - cam.y) * k;
  cam.z += (want[2] - cam.z) * k;
  const target = [p.x + fwd[0] * 24, p.y + fwd[1] * 24 + 1, p.z + fwd[2] * 24];
  return { proj, view: mat4LookAt([cam.x, cam.y, cam.z], target, [0, 1, 0]) };
}

// Plane's up vector after banking: world up tilted toward the low wing.
function planeUp(p) {
  const r = p.roll;
  const h = p.heading;
  const rx = Math.sin(h);
  const rz = Math.cos(h);
  return [
    rx * Math.sin(r),
    Math.cos(r),
    rz * Math.sin(r),
  ];
}

function drawWorld(view, proj, timeSec) {
  gl.useProgram(worldProg);
  gl.uniformMatrix4fv(worldProg.loc.proj, false, proj);
  gl.uniformMatrix4fv(worldProg.loc.view, false, view);
  gl.uniform3fv(worldProg.loc.sun, new Float32Array(SUN_DIR));
  gl.uniform3fv(worldProg.loc.fog, new Float32Array(FOG_COLOR));
  const identity = mat4Identity();
  drawMesh(gl, worldProg, world.terrain, identity);
  drawMesh(gl, worldProg, world.runway, identity);
  drawMesh(gl, worldProg, world.props, identity);
  // Water: translucent, drawn after the opaque ground.
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  // Water mesh colour is baked; fake translucency via a second pass is overkill
  // — draw it opaque but darker; the blend flag stays off for it.
  gl.disable(gl.BLEND);
  gl.depthMask(true);
  drawMesh(gl, worldProg, world.water, identity);
  // Rings: the next ring glows amber, later ones dim steel, passed ones green.
  const now = nextRing(game.rings);
  for (const ring of game.rings) {
    const tint = ring.passed ? [0.35, 0.95, 0.45]
      : ring === now ? [1.0, 0.72, 0.12] : [0.55, 0.60, 0.66];
    // Recolour by redrawing with a tinted model matrix is not possible on a
    // baked mesh, so pulse the next ring by scaling it gently instead.
    const pulse = ring === now ? 1 + 0.05 * Math.sin(timeSec * 4) : 1;
    let m = mat4Identity();
    m = mat4Multiply(m, mat4Translate(ring.x, ring.y, ring.z));
    m = mat4Multiply(m, mat4RotateYForRing(ring));
    m = mat4Multiply(m, mat4Scale(pulse));
    void tint;
    drawMesh(gl, worldProg, ringMesh, m);
  }
  // Plane + spinning prop. In cockpit view the fuselage mesh is hidden: the
  // camera sits inside it, and its interior would block the windscreen view.
  // The prop hides too — from the pilot's seat its solid blades would fill
  // the windscreen like black bars. Chase view keeps both.
  if (game.camera !== 'cockpit') {
    drawMesh(gl, worldProg, planeMesh, planeModelMatrix(game.plane));
    drawMesh(gl, worldProg, propMesh, propModelMatrix(game.plane));
  }
}

// Rings face the pilot: rotate the torus to face the previous ring.
function mat4RotateYForRing(ring) {
  const idx = ring.index;
  const prev = idx === 0 ? { x: -260, z: 0 } : game.rings[idx - 1];
  const dx = ring.x - prev.x;
  const dz = ring.z - prev.z;
  const ang = Math.atan2(dx, dz);
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const m = mat4Identity();
  m[0] = c; m[2] = -s;
  m[8] = s; m[10] = c;
  return m;
}

function mat4Scale(s) {
  const m = mat4Identity();
  m[0] = s; m[5] = s; m[10] = s;
  return m;
}

// Deterministic screenshot staging: ?shot=cover|cockpit|takeoff|rings
if (SHOT) {
  game.setScreen('flying');
  stageShot(SHOT, game);
  game.timeSec = 0;
  const { view, proj } = cameraMatrices(game.plane, 1);
  gl.clearColor(0.55, 0.68, 0.85, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  // Sky needs the camera right/up for cloud billboards.
  const camRight = [Math.sin(game.plane.heading), 0, Math.cos(game.plane.heading)];
  sky.draw(gl, view, proj, 0, camRight, [0, 1, 0]);
  drawWorld(view, proj, 0);
  hud.draw(game.snapshot(), 0);
  document.title = 'Skyhook Valley — shot ' + SHOT;
} else {
  let last = performance.now();
  let acc = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.1) dt = 0.1;
    const keys = input;
    if (game.screen === 'flying') {
      acc += dt;
      const step = 1 / 60;
      let guard = 0;
      while (acc >= step && guard < 5) {
        game.update(step, keys);
        acc -= step;
        guard += 1;
      }
    } else {
      game.update(dt, keys);
    }
    const { view, proj } = cameraMatrices(game.plane, dt);
    gl.clearColor(0.55, 0.68, 0.85, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const camRight = [Math.sin(game.plane.heading), 0, Math.cos(game.plane.heading)];
    sky.draw(gl, view, proj, game.timeSec, camRight, [0, 1, 0]);
    drawWorld(view, proj, game.timeSec);
    hud.draw(game.snapshot(), game.timeSec);
  }
  requestAnimationFrame(frame);
}

// Expose the game for play-testing hooks (?shot already covers screenshots).
window.__skyhook = { game, terrainHeight };
