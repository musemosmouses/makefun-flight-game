// Game state for Skyhook Valley: title, flying, paused, crashed, landed and
// mission-complete, plus fuel, hull, timer, score and the wind. The rules that
// make a sortie a decision: fuel burns with throttle, rings pay time, and the
// only way home is a real landing on the runway.
import { clamp, lerp } from './rng.js';
import { newPlaneState, stepPlane, PLANE } from './plane.js';
import { buildCourse, nextRing, checkRingCross, RING_COUNT } from './rings.js';
import { terrainHeight, RUNWAY } from './terrain.js';
import { SoundEngine } from './audio.js';

export const SORTIE_SECONDS = 240;
export const FUEL_START = 100;
export const HULL_START = 100;
export const RING_POINTS = 100;
export const RING_TIME_BONUS = 6;
export const LANDING_POINTS = 250;
// Fuel burn: a full tank flies the whole 12-ring course (~130 s at cruise)
// with about a fifth to spare, so fuel punishes wasteful full-throttle
// flying and missed rings, but never makes the course itself impossible.
export const FUEL_BURN_FULL = 0.7; // units per second at full throttle
export const FUEL_BURN_IDLE = 0.12;

export class Game {
  constructor() {
    this.plane = newPlaneState();
    this.rings = buildCourse();
    this.screen = 'title'; // title | flying | paused | crashed | landed | complete
    this.camera = 'chase'; // chase | cockpit
    this.score = 0;
    this.fuel = FUEL_START;
    this.hull = HULL_START;
    this.timeLeft = SORTIE_SECONDS;
    this.throttle = 0;
    this.stalled = false;
    this.wind = [0, 0];
    this.windBase = 4.5; // m/s from the west, gusts on top
    this.timeSec = 0;
    this.sound = new SoundEngine();
    this.hud = null; // set by main.js (Hud instance) for banners
    this.stats = { rings: 0, landings: 0, crashes: 0, best: 0 };
    this.onScreen = null; // callback(screen) for DOM overlays
    this.landedOnRunway = false;
    this.ringFlashAt = -10;
  }

  setScreen(next) {
    this.screen = next;
    if (this.onScreen) this.onScreen(next);
  }

  startSortie() {
    this.plane = newPlaneState();
    this.rings = buildCourse();
    this.score = 0;
    this.fuel = FUEL_START;
    this.hull = HULL_START;
    this.timeLeft = SORTIE_SECONDS;
    this.throttle = 0;
    this.stalled = false;
    this.landedOnRunway = false;
    this.airborneOnce = false; // a landing only counts after a real takeoff
    this.setScreen('flying');
    this.sound.ensure();
    this.sound.click();
    if (this.hud) this.hud.showMessage('TAKE OFF — full throttle, rotate at 50 kt', 4, this.timeSec);
  }

  togglePause() {
    if (this.screen === 'flying') this.setScreen('paused');
    else if (this.screen === 'paused') this.setScreen('flying');
  }

  toggleCamera() {
    this.camera = this.camera === 'chase' ? 'cockpit' : 'chase';
  }

  toggleMute() {
    this.sound.setMuted(!this.sound.muted);
  }

  // Seeded wind: a steady westerly plus slow gusts, a function of time only.
  windAt(t) {
    const gust = Math.sin(t * 0.11) * 2.2 + Math.sin(t * 0.031 + 1.7) * 1.6;
    const speed = this.windBase + gust;
    const dir = Math.sin(t * 0.05) * 0.5; // wanders a little around west
    return [speed * Math.cos(dir), speed * Math.sin(dir)];
  }

  // Is the plane over the runway strip, low and slow enough to count as landed?
  overRunway(p) {
    return Math.abs(p.x - RUNWAY.x) < RUNWAY.length / 2
      && Math.abs(p.z - RUNWAY.z) < RUNWAY.width / 2 + 6;
  }

  update(dt, input) {
    this.timeSec += dt;
    this.wind = this.windAt(this.timeSec);
    if (!this.plane.onGround) this.airborneOnce = true;
    if (this.screen === 'title' || this.screen === 'paused') {
      this.sound.update(0, 0, false);
      return;
    }
    if (this.screen !== 'flying') {
      // Crashed / landed / complete: let the plane sit, keep the sound low.
      this.sound.update(0, 0, false);
      return;
    }
    // Keys: throttle is a held value, stick inputs are read fresh each step.
    this.throttle = clamp(this.throttle + input.throttleDelta(dt), 0, 1);
    const ctl = {
      pitch: input.pitchInput(),
      roll: input.rollInput(),
      throttle: this.throttle,
      flaps: input.down('KeyF'),
      brake: input.down('KeyB'),
    };
    const prev = { x: this.plane.x, y: this.plane.y, z: this.plane.z };
    const event = stepPlane(this.plane, ctl, dt, this.wind);
    this.stalled = event === 'stall';
    if (event === 'stall' && this.hud) {
      // Horn sparingly: only when it starts.
      if (!this._stallHorned) { this.sound.stallHorn(); this._stallHorned = true; }
    } else {
      this._stallHorned = false;
    }
    // Fuel burns with throttle; empty tanks mean the engine quits.
    const burn = FUEL_BURN_IDLE + (FUEL_BURN_FULL - FUEL_BURN_IDLE) * this.throttle;
    this.fuel = Math.max(0, this.fuel - burn * dt);
    if (this.fuel <= 0 && this.throttle > 0) {
      this.throttle = 0;
      if (this.hud) this.hud.showMessage('FUEL EMPTY — glide home to the runway', 3, this.timeSec);
    }
    // Sortie clock.
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.endSortie(false, 'TIME UP — the valley keeps its rings');
      return;
    }
    // Rings.
    const ring = nextRing(this.rings);
    if (ring && checkRingCross(ring, prev, this.plane)) {
      ring.passed = true;
      this.stats.rings += 1;
      this.score += RING_POINTS;
      this.timeLeft = Math.min(SORTIE_SECONDS, this.timeLeft + RING_TIME_BONUS);
      this.sound.ringChime();
      if (this.hud) {
        this.hud.showFlash('RING ' + (ring.index + 1) + ' / ' + RING_COUNT + '  +100  +' + RING_TIME_BONUS + 's', 2, this.timeSec);
      }
      if (!nextRing(this.rings) && this.hud) {
        this.hud.showMessage('ALL RINGS! Land on the runway to finish', 4, this.timeSec);
      }
    }
    // Touchdowns and crashes.
    if (event === 'touchdown') {
      this.sound.touchdown();
      this.hull = Math.max(0, this.hull - 6);
      if (this.hud) this.hud.showFlash('HARD LANDING — hull ' + Math.round(this.hull) + '%', 2, this.timeSec);
    }
    if (event === 'crash') {
      this.hull = 0;
      this.sound.crash();
      this.stats.crashes += 1;
      this.endSortie(false, 'CRASHED — the Kestrel is a write-off');
      return;
    }
    if (this.plane.onGround && this.plane.speed < 12 && this.airborneOnce) {
      if (this.overRunway(this.plane)) {
        if (!this.landedOnRunway) {
          this.landedOnRunway = true;
          this.stats.landings += 1;
          const allRings = !nextRing(this.rings);
          this.score += LANDING_POINTS;
          this.sound.touchdown();
          if (allRings) {
            const timeBonus = Math.round(this.timeLeft) * 2;
            const fuelBonus = Math.round(this.fuel) * 1;
            this.score += timeBonus + fuelBonus;
            this.endSortie(true, 'MISSION COMPLETE — +' + timeBonus + ' time, +' + fuelBonus + ' fuel');
          } else if (this.hud) {
            this.hud.showMessage('LANDED — refuelled, +' + LANDING_POINTS + ' pts. Take off again!', 4, this.timeSec);
            this.fuel = FUEL_START;
            this.hull = Math.min(HULL_START, this.hull + 20);
          }
        }
      } else {
        this.landedOnRunway = false;
      }
    } else if (!this.plane.onGround) {
      this.landedOnRunway = false;
    }
    // Hull damage from terrain scrape is handled by crash; fuel out over rough
    // ground with no runway nearby ends the sortie when the plane stops.
    if (this.fuel <= 0 && this.plane.onGround && this.plane.speed < 1 && !this.overRunway(this.plane)) {
      this.endSortie(false, 'OUT OF FUEL, DOWN IN THE BUSH');
      return;
    }
    this.sound.update(this.throttle, this.plane.speed, !this.plane.onGround);
  }

  endSortie(won, reason) {
    this.stats.best = Math.max(this.stats.best, this.score);
    // setScreen fires onScreen once with the reason and score.
    this.setScreen(won ? 'complete' : 'crashed');
  }

  // Snapshot the HUD reads (plain data, no methods).
  snapshot() {
    return {
      screen: this.screen,
      camera: this.camera,
      plane: this.plane,
      rings: this.rings,
      score: this.score,
      fuel: this.fuel,
      hull: this.hull,
      timeLeft: this.timeLeft,
      stalled: this.stalled,
      wind: this.wind,
    };
  }
}
