// Synthesised sound for Skyhook Valley: engine drone, wind, ring chime, stall
// horn, touchdown thump and crash thud — all WebAudio oscillators and filtered
// noise, no audio files, no network. Starts on the first user gesture.
export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.engineOsc = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.windSource = null;
    this.windGain = null;
    this.windFilter = null;
  }

  // Call from a click / keydown: browsers only allow audio after a gesture.
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    // Engine: two detuned saws through a lowpass, pitch follows RPM.
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 55;
    const osc2 = this.ctx.createOscillator();
    osc2.type = 'sawtooth';
    osc2.frequency.value = 55.7;
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 420;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineFilter);
    osc2.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.ctx.destination);
    this.engineOsc.start();
    osc2.start();
    this.engineOsc2 = osc2;
    // Wind: looped noise buffer through a bandpass, gain follows airspeed.
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    this.windSource = this.ctx.createBufferSource();
    this.windSource.buffer = buf;
    this.windSource.loop = true;
    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 700;
    this.windFilter.Q.value = 0.6;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0;
    this.windSource.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.ctx.destination);
    this.windSource.start();
  }

  // Per-frame update: throttle 0..1, speed m/s, airborne flag.
  update(throttle, speed, airborne) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const rpm = 42 + throttle * 58 + speed * 0.12;
    this.engineOsc.frequency.setTargetAtTime(rpm, t, 0.08);
    this.engineOsc2.frequency.setTargetAtTime(rpm * 1.012, t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(320 + throttle * 900, t, 0.1);
    this.engineGain.gain.setTargetAtTime(airborne ? 0.05 + throttle * 0.05 : throttle * 0.05, t, 0.1);
    this.windGain.gain.setTargetAtTime(Math.min(0.16, speed * 0.0022), t, 0.15);
    this.windFilter.frequency.setTargetAtTime(420 + speed * 9, t, 0.15);
  }

  setMuted(m) {
    this.muted = m;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (this.engineGain) this.engineGain.gain.setTargetAtTime(m ? 0 : 0.06, t, 0.05);
    if (this.windGain) this.windGain.gain.setTargetAtTime(m ? 0 : 0.02, t, 0.05);
  }

  // Short one-shot blip: sine with a fast decay envelope.
  blip(freq, dur, vol, type) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  ringChime() {
    this.blip(880, 0.5, 0.22);
    setTimeout(() => this.blip(1318, 0.6, 0.18), 70);
  }

  stallHorn() {
    this.blip(220, 0.4, 0.16, 'square');
  }

  touchdown() {
    this.blip(90, 0.18, 0.3, 'triangle');
  }

  crash() {
    this.blip(55, 0.7, 0.4, 'sawtooth');
    this.blip(38, 0.9, 0.35, 'triangle');
  }

  click() {
    this.blip(660, 0.07, 0.12);
  }
}
