// Tiny WebAudio synth: all sounds and music are generated, no audio files.

const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24]; // major pentatonic

export class Sound {
  constructor() {
    this.ctx = null;
    this.sfxOn = true;
    this.musicOn = true;
    this.musicTimer = null;
    this.tempo = 1;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.22;
      this.musicGain.connect(this.master);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  tone(freq, dur, { type = 'square', vol = 0.15, slide = 0, delay = 0, out } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out || this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  noise(dur, { vol = 0.3, freq = 1200, delay = 0 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
  }

  play(name, arg = 0) {
    if (!this.sfxOn || !this.ctx) return;
    const n = (semi) => 440 * 2 ** (semi / 12);
    switch (name) {
      case 'dot': {
        const s = SCALE[arg % SCALE.length] + 12 * Math.min(2, Math.floor(arg / 60));
        this.tone(n(s - 9), 0.06, { vol: 0.07 });
        break;
      }
      case 'coin': this.tone(n(12), 0.07, { vol: 0.1 }); this.tone(n(19), 0.12, { vol: 0.1, delay: 0.06 }); break;
      case 'gem': [0, 4, 7, 12, 16].forEach((s, i) => this.tone(n(s + 7), 0.1, { vol: 0.09, type: 'triangle', delay: i * 0.05 })); break;
      case 'power': this.tone(n(-5), 0.25, { vol: 0.14, slide: 4, type: 'sawtooth' }); break;
      case 'surge': this.tone(n(-12), 0.5, { vol: 0.16, slide: 3, type: 'sawtooth' }); this.tone(n(0), 0.4, { vol: 0.08, delay: 0.1 }); break;
      case 'eat': this.tone(n(arg * 2), 0.18, { vol: 0.14, slide: 2.5, type: 'triangle' }); break;
      case 'kill': this.tone(n(5), 0.12, { vol: 0.08, slide: 0.4 }); this.noise(0.1, { vol: 0.12, freq: 3000 }); break;
      case 'boom': this.noise(0.5, { vol: 0.45, freq: 900 }); this.tone(80, 0.4, { vol: 0.25, slide: 0.3, type: 'sine' }); break;
      case 'nova': this.noise(0.9, { vol: 0.4, freq: 2500 }); [0, 7, 12, 19, 24].forEach((s, i) => this.tone(n(s), 0.3, { vol: 0.1, type: 'sawtooth', delay: i * 0.06 })); break;
      case 'break': this.tone(n(-2), 0.2, { vol: 0.08, slide: 0.5, type: 'triangle' }); break;
      case 'die': this.tone(n(0), 0.8, { vol: 0.2, slide: 0.1, type: 'sawtooth' }); this.noise(0.6, { vol: 0.3, freq: 600 }); break;
      case 'click': this.tone(n(7), 0.04, { vol: 0.06 }); break;
      case 'count': this.tone(n(arg ? 12 : 0), 0.15, { vol: 0.12, type: 'triangle' }); break;
    }
  }

  // Simple generative bass + arp loop. Tempo follows the game's intensity.
  startMusic() {
    this.stopMusic();
    if (!this.musicOn || !this.ctx) return;
    const prog = [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [-5, -1, 2]]; // i - VI - VII - v (minor)
    let stepI = 0;
    let next = this.ctx.currentTime + 0.05;
    const n = (semi) => 220 * 2 ** (semi / 12);
    this.musicTimer = setInterval(() => {
      if (!this.ctx) return;
      const spb = 0.16 / this.tempo;
      while (next < this.ctx.currentTime + 0.25) {
        const chord = prog[Math.floor(stepI / 16) % prog.length];
        const s = stepI % 16;
        if (s % 4 === 0) this.tone(n(chord[0] - 12), spb * 3, { vol: 0.35, type: 'triangle', delay: next - this.ctx.currentTime, out: this.musicGain });
        if (s % 2 === 1 || s % 8 === 0) {
          const note = chord[(s >> 1) % 3] + (s >= 8 ? 12 : 0);
          this.tone(n(note + 12), spb * 0.9, { vol: 0.12, type: 'square', delay: next - this.ctx.currentTime, out: this.musicGain });
        }
        next += spb;
        stepI++;
      }
    }, 60);
  }

  stopMusic() {
    clearInterval(this.musicTimer);
    this.musicTimer = null;
  }
}
