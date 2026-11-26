// Sky for Skyhook Valley: a gradient dome with a low sun, and drifting
// billboard clouds textured from a canvas the game paints itself at load time
// (no image files, no network).
import { mulberry32, range } from './rng.js';
import { mat4Identity, mat4Multiply, mat4Translate, compileShader, makeProgram } from './gl.js';

export const SUN_DIR = [0.55, 0.42, -0.72]; // low afternoon sun, west-southwest

const SKY_VS = `
attribute vec3 aPosition;
varying vec3 vDir;
uniform mat4 uView;
uniform mat4 uProj;
void main() {
  vDir = aPosition;
  vec4 p = uProj * uView * vec4(aPosition, 1.0);
  gl_Position = p.xyww;
  gl_Position.z = gl_Position.w * 0.99999;
}`;

const SKY_FS = `
precision mediump float;
varying vec3 vDir;
uniform vec3 uSun;
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.12, 1.0);
  vec3 zenith = vec3(0.20, 0.42, 0.72);
  vec3 horizon = vec3(0.98, 0.78, 0.55);
  vec3 col = mix(horizon, zenith, pow(max(h, 0.0), 0.62));
  float sun = max(dot(d, uSun), 0.0);
  col += vec3(1.0, 0.75, 0.45) * pow(sun, 220.0) * 1.4;   // sun disc
  col += vec3(1.0, 0.60, 0.30) * pow(sun, 7.0) * 0.28;    // warm haze
  if (d.y < 0.0) col = mix(col, vec3(0.55, 0.50, 0.42), clamp(-d.y * 6.0, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}`;

const CLOUD_VS = `
attribute vec3 aPosition;
attribute vec2 aUv;
varying vec2 vUv;
uniform mat4 uView;
uniform mat4 uProj;
uniform vec3 uCentre;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uSize;
void main() {
  vec3 world = uCentre + uRight * aPosition.x * uSize + uUp * aPosition.y * uSize;
  vUv = aUv;
  gl_Position = uProj * uView * vec4(world, 1.0);
}`;

const CLOUD_FS = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
void main() {
  vec4 tex = texture2D(uTex, vUv);
  if (tex.a < 0.04) discard;
  gl_FragColor = vec4(vec3(1.0, 0.98, 0.94) * tex.rgb, tex.a * 0.92);
}`;

// Soft puffy blob texture, painted once on an offscreen canvas.
function makeCloudTexture(gl) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 128);
  const rand = mulberry32(4242);
  for (let i = 0; i < 46; i += 1) {
    const x = 28 + rand() * 200;
    const y = 44 + rand() * 44;
    const r = 14 + rand() * 30;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function makeDome(gl) {
  // Icosahedron-ish dome: latitude/longitude sphere, top hemisphere only.
  const positions = [];
  const rings = 10;
  const segs = 24;
  for (let j = 0; j < rings; j += 1) {
    const phi0 = (j / rings) * Math.PI * 0.52;
    const phi1 = ((j + 1) / rings) * Math.PI * 0.52;
    for (let i = 0; i < segs; i += 1) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      const p = (phi, a) => [
        Math.sin(phi) * Math.cos(a), Math.cos(phi), Math.sin(phi) * Math.sin(a),
      ];
      positions.push(...p(phi0, a0), ...p(phi0, a1), ...p(phi1, a1));
      positions.push(...p(phi0, a0), ...p(phi1, a1), ...p(phi1, a0));
    }
  }
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
  return { buffer: buf, count: positions.length / 3 };
}

export class Sky {
  constructor(gl) {
    this.prog = makeProgram(gl, SKY_VS, SKY_FS);
    this.loc = {
      position: gl.getAttribLocation(this.prog, 'aPosition'),
      view: gl.getUniformLocation(this.prog, 'uView'),
      proj: gl.getUniformLocation(this.prog, 'uProj'),
      sun: gl.getUniformLocation(this.prog, 'uSun'),
    };
    this.dome = makeDome(gl);
    // Clouds.
    this.cloudProg = makeProgram(gl, CLOUD_VS, CLOUD_FS);
    this.cloudLoc = {
      position: gl.getAttribLocation(this.cloudProg, 'aPosition'),
      uv: gl.getAttribLocation(this.cloudProg, 'aUv'),
      view: gl.getUniformLocation(this.cloudProg, 'uView'),
      proj: gl.getUniformLocation(this.cloudProg, 'uProj'),
      centre: gl.getUniformLocation(this.cloudProg, 'uCentre'),
      right: gl.getUniformLocation(this.cloudProg, 'uRight'),
      up: gl.getUniformLocation(this.cloudProg, 'uUp'),
      size: gl.getUniformLocation(this.cloudProg, 'uSize'),
    };
    const quad = new Float32Array([
      -1, -0.5, 0, 0, 1, -1, 0.5, 0, 0, 0,
      1, -0.5, 0, 1, 1, 1, 0.5, 0, 1, 0,
      -1, 0.5, 0, 0, 0, 1, 0.5, 0, 1, 0,
    ]);
    this.quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    this.texture = makeCloudTexture(gl);
    const rand = mulberry32(99);
    this.clouds = [];
    for (let i = 0; i < 16; i += 1) {
      this.clouds.push({
        x: range(rand, -2600, 2600),
        y: range(rand, 320, 620),
        z: range(rand, -2600, 2600),
        size: range(rand, 130, 320),
        drift: range(rand, 1.5, 4.0),
      });
    }
  }

  draw(gl, view, proj, timeSec, camRight, camUp) {
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.prog);
    // The dome is a unit sphere around the origin: strip the view matrix's
    // translation so it stays centred on the camera wherever it flies.
    const viewNoTrans = new Float32Array(view);
    viewNoTrans[12] = 0;
    viewNoTrans[13] = 0;
    viewNoTrans[14] = 0;
    gl.uniformMatrix4fv(this.loc.view, false, viewNoTrans);
    gl.uniformMatrix4fv(this.loc.proj, false, proj);
    gl.uniform3fv(this.loc.sun, new Float32Array(SUN_DIR));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dome.buffer);
    gl.enableVertexAttribArray(this.loc.position);
    gl.vertexAttribPointer(this.loc.position, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, this.dome.count);
    gl.disableVertexAttribArray(this.loc.position);
    // Clouds drift slowly east; wrap around the world edge.
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.cloudProg);
    gl.uniformMatrix4fv(this.cloudLoc.view, false, view);
    gl.uniformMatrix4fv(this.cloudLoc.proj, false, proj);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.enableVertexAttribArray(this.cloudLoc.position);
    gl.enableVertexAttribArray(this.cloudLoc.uv);
    gl.vertexAttribPointer(this.cloudLoc.position, 3, gl.FLOAT, false, 20, 0);
    gl.vertexAttribPointer(this.cloudLoc.uv, 2, gl.FLOAT, false, 20, 12);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(gl.getUniformLocation(this.cloudProg, 'uTex'), 0);
    gl.uniform3fv(this.cloudLoc.right, new Float32Array(camRight));
    gl.uniform3fv(this.cloudLoc.up, new Float32Array(camUp));
    for (const c of this.clouds) {
      let x = c.x + timeSec * c.drift;
      if (x > 2800) x -= 5600;
      gl.uniform3fv(this.cloudLoc.centre, new Float32Array([x, c.y, c.z]));
      gl.uniform1f(this.cloudLoc.size, c.size);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.disableVertexAttribArray(this.cloudLoc.position);
    gl.disableVertexAttribArray(this.cloudLoc.uv);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }
}
