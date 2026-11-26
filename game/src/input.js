// Keyboard + mouse input for Skyhook Valley. Keys are the primary controls;
// dragging the mouse steers too (pointer lock is optional and never required).
// All keys are read per frame, so holding W really holds the throttle open.
export class Input {
  constructor(canvas) {
    this.keys = {};
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.dragging = false;
    this.lastX = 0;
    this.lastY = 0;
    this.anyGesture = false;
    this.onFirstGesture = null;
    this.onKey = null;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys[e.code] = true;
      this.noteGesture();
      if (this.onKey) this.onKey(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
    window.addEventListener('blur', () => {
      this.keys = {};
      this.dragging = false;
    });
    canvas.addEventListener('mousedown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.noteGesture();
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.dragging) return;
      this.mouseDX += e.clientX - this.lastX;
      this.mouseDY += e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    window.addEventListener('mouseup', () => {
      this.dragging = false;
    });
    canvas.addEventListener('touchstart', (e) => {
      this.noteGesture();
      e.preventDefault();
    }, { passive: false });
  }

  noteGesture() {
    if (!this.anyGesture) {
      this.anyGesture = true;
      if (this.onFirstGesture) this.onFirstGesture();
    }
  }

  down(code) {
    return !!this.keys[code];
  }

  // -1..1 pitch stick: ArrowUp / KeyW pulls up? No: ArrowUp = nose down in
  // real sticks, but arcade players expect Up = climb. We use Up = climb.
  pitchInput() {
    let v = 0;
    if (this.down('ArrowUp') || this.down('KeyI')) v += 1;
    if (this.down('ArrowDown') || this.down('KeyK')) v -= 1;
    v += this.consumeMouseDY();
    return Math.max(-1, Math.min(1, v));
  }

  rollInput() {
    let v = 0;
    if (this.down('ArrowLeft') || this.down('KeyA')) v -= 1;
    if (this.down('ArrowRight') || this.down('KeyD')) v += 1;
    v += this.consumeMouseDX();
    return Math.max(-1, Math.min(1, v));
  }

  // Mouse drag steers gently: 120 px of drag = full stick, then it decays.
  consumeMouseDX() {
    const v = this.mouseDX / 120;
    this.mouseDX *= 0.6;
    if (Math.abs(this.mouseDX) < 0.5) this.mouseDX = 0;
    return Math.max(-1, Math.min(1, v));
  }

  consumeMouseDY() {
    const v = -this.mouseDY / 140;
    this.mouseDY *= 0.6;
    if (Math.abs(this.mouseDY) < 0.5) this.mouseDY = 0;
    return Math.max(-1, Math.min(1, v));
  }

  // Throttle is a held value: W / Shift raises, S / Ctrl lowers.
  throttleDelta(dt) {
    let d = 0;
    if (this.down('KeyW') || this.down('ShiftLeft')) d += 0.55 * dt;
    if (this.down('KeyS') || this.down('ControlLeft')) d -= 0.55 * dt;
    return d;
  }
}
