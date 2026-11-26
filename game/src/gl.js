// Minimal WebGL helpers for Skyhook Valley: 4x4 matrices (column-major, like
// OpenGL), shader programs, and a triangle-soup mesh builder. No library, no
// network: everything the renderer needs lives in this file.
export function mat4Identity() {
  const m = new Float32Array(16);
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
  return m;
}

export function mat4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      let s = 0;
      for (let k = 0; k < 4; k += 1) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

export function mat4Perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

// Camera looking from `eye` toward `target`, world-up +Y.
export function mat4LookAt(eye, target, up) {
  let zx = eye[0] - target[0];
  let zy = eye[1] - target[1];
  let zz = eye[2] - target[2];
  let len = Math.hypot(zx, zy, zz) || 1;
  zx /= len; zy /= len; zz /= len;
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz) || 1;
  xx /= len; xy /= len; xz /= len;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  const m = new Float32Array(16);
  m[0] = xx; m[1] = yx; m[2] = zx; m[3] = 0;
  m[4] = xy; m[5] = yy; m[6] = zy; m[7] = 0;
  m[8] = xz; m[9] = yz; m[10] = zz; m[11] = 0;
  m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  m[15] = 1;
  return m;
}

export function mat4Translate(x, y, z) {
  const m = mat4Identity();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

export function mat4RotateY(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const m = mat4Identity();
  m[0] = c; m[2] = -s;
  m[8] = s; m[10] = c;
  return m;
}

export function mat4RotateX(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const m = mat4Identity();
  m[5] = c; m[6] = s;
  m[9] = -s; m[10] = c;
  return m;
}

export function mat4RotateZ(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const m = mat4Identity();
  m[0] = c; m[1] = s;
  m[4] = -s; m[5] = c;
  return m;
}

// Compile one shader; throws with the info log on failure.
export function compileShader(gl, type, source) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('shader: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}

// Link a vertex + fragment shader into a program with named attributes/uniforms.
export function makeProgram(gl, vsSource, fsSource) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER, vsSource));
  gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, fsSource));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error('program: ' + gl.getProgramInfoLog(prog));
  }
  return prog;
}

// Triangle soup: push triangles with a flat normal and a flat colour.
// Vertex layout is position(3), normal(3), colour(3) — 9 floats per vertex.
export class MeshBuilder {
  constructor() {
    this.data = [];
  }

  tri(a, b, c, colour) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (const p of [a, b, c]) {
      this.data.push(p[0], p[1], p[2], nx, ny, nz, colour[0], colour[1], colour[2]);
    }
    return this;
  }

  quad(a, b, c, d, colour) {
    return this.tri(a, b, c, colour).tri(a, c, d, colour);
  }

  // Axis-aligned box centred at `centre` with half-sizes `half`.
  box(centre, half, colour) {
    const x = centre[0];
    const y = centre[1];
    const z = centre[2];
    const hx = half[0];
    const hy = half[1];
    const hz = half[2];
    const c000 = [x - hx, y - hy, z - hz];
    const c100 = [x + hx, y - hy, z - hz];
    const c110 = [x + hx, y + hy, z - hz];
    const c010 = [x - hx, y + hy, z - hz];
    const c001 = [x - hx, y - hy, z + hz];
    const c101 = [x + hx, y - hy, z + hz];
    const c111 = [x + hx, y + hy, z + hz];
    const c011 = [x - hx, y + hy, z + hz];
    this.quad(c001, c101, c111, c011, colour); // front
    this.quad(c100, c000, c010, c110, colour); // back
    this.quad(c000, c001, c011, c010, colour); // left
    this.quad(c101, c100, c110, c111, colour); // right
    this.quad(c011, c111, c110, c010, colour); // top
    this.quad(c000, c100, c101, c001, colour); // bottom
    return this;
  }

  // A 4-sided pyramid (cone) with base centre `base`, height `h`, radius `r`.
  cone(base, h, r, colour) {
    const pts = [];
    for (let i = 0; i < 4; i += 1) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      pts.push([base[0] + Math.cos(a) * r, base[1], base[2] + Math.sin(a) * r]);
    }
    const tip = [base[0], base[1] + h, base[2]];
    for (let i = 0; i < 4; i += 1) {
      // Wound (next, current, tip) so the side normals point outward.
      this.tri(pts[(i + 1) % 4], pts[i], tip, colour);
    }
    return this;
  }

  toBuffer(gl) {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.data), gl.STATIC_DRAW);
    return { buffer: buf, count: this.data.length / 9 };
  }
}

// Upload a mesh and draw it with the world program (aPosition/aNormal/aColor).
// The attribute arrays are enabled here, every draw: other programs (sky,
// clouds) share the same attribute locations and disable them after use,
// so a mesh drawn after them would otherwise read no positions at all.
export function drawMesh(gl, prog, mesh, modelMatrix) {
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
  gl.enableVertexAttribArray(prog.loc.position);
  gl.enableVertexAttribArray(prog.loc.normal);
  gl.enableVertexAttribArray(prog.loc.color);
  gl.vertexAttribPointer(prog.loc.position, 3, gl.FLOAT, false, 36, 0);
  gl.vertexAttribPointer(prog.loc.normal, 3, gl.FLOAT, false, 36, 12);
  gl.vertexAttribPointer(prog.loc.color, 3, gl.FLOAT, false, 36, 24);
  gl.uniformMatrix4fv(prog.loc.model, false, modelMatrix);
  gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
}
