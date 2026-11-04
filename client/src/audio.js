// Tiny synthesized sound effects (Web Audio), so there are no audio files to load.
let ctx = null;
let master = null;
let muted = false;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Browsers only allow audio after a user gesture.
export function unlockAudio() {
  ac();
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.5;
}

export function isMuted() {
  return muted;
}

function tone(freq, dur, { type = 'sine', vol = 0.25, delay = 0, slide = null, attack = 0.005 } = {}) {
  const a = ac();
  if (!a || muted) return;
  const t = a.currentTime + delay;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function noiseBurst(dur, { vol = 0.2, delay = 0, freq = 1200, q = 1, sweep = null } = {}) {
  const a = ac();
  if (!a || muted) return;
  const t = a.currentTime + delay;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(freq, t);
  if (sweep) filter.frequency.exponentialRampToValueAtTime(sweep, t + dur);
  filter.Q.value = q;
  const gain = a.createGain();
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(gain).connect(master);
  src.start(t);
}

const LAMP_NOTES = { red: 392, green: 494, blue: 587, yellow: 698 };

export const sfx = {
  bell() {
    tone(1568, 1.2, { vol: 0.18 });
    tone(2350, 0.8, { vol: 0.08 });
  },
  lamp(color) {
    tone(LAMP_NOTES[color] || 440, 0.45, { type: 'triangle', vol: 0.2 });
  },
  press(color) {
    tone((LAMP_NOTES[color] || 440) / 2, 0.15, { type: 'square', vol: 0.08 });
    noiseBurst(0.05, { vol: 0.15, freq: 3000 });
  },
  buzz() {
    tone(110, 0.5, { type: 'sawtooth', vol: 0.18 });
    tone(116, 0.5, { type: 'sawtooth', vol: 0.18 });
  },
  success() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.35, { type: 'triangle', vol: 0.16, delay: i * 0.09 }));
  },
  rumble() {
    noiseBurst(1.4, { vol: 0.35, freq: 120, q: 0.7 });
  },
  click() {
    noiseBurst(0.04, { vol: 0.3, freq: 2500, q: 4 });
    tone(900, 0.04, { type: 'square', vol: 0.05 });
  },
  locked() {
    tone(90, 0.18, { type: 'square', vol: 0.12 });
    noiseBurst(0.1, { vol: 0.2, freq: 400 });
  },
  safeOpen() {
    noiseBurst(0.25, { vol: 0.3, freq: 300 });
    tone(220, 0.9, { type: 'sawtooth', vol: 0.05, slide: 140, delay: 0.1 });
    sfx.success();
  },
  pickup() {
    tone(660, 0.12, { type: 'triangle', vol: 0.15 });
    tone(990, 0.15, { type: 'triangle', vol: 0.12, delay: 0.07 });
  },
  whoosh() {
    noiseBurst(1.0, { vol: 0.35, freq: 400, sweep: 3000, q: 1.5 });
  },
  arrive() {
    tone(300, 0.2, { type: 'sine', vol: 0.3, slide: 600 });
    noiseBurst(0.08, { vol: 0.2, freq: 1500, delay: 0.15 });
  },
  clunk() {
    tone(70, 0.4, { type: 'square', vol: 0.15, slide: 50 });
    noiseBurst(0.2, { vol: 0.3, freq: 600 });
  },
  tick() {
    noiseBurst(0.03, { vol: 0.3, freq: 4000, q: 6 });
  },
  chime() {
    [0, 1.1, 2.2].forEach((d) => {
      tone(196, 2.5, { vol: 0.2, delay: d });
      tone(392, 2.0, { vol: 0.1, delay: d });
      tone(587, 1.5, { vol: 0.05, delay: d });
    });
  },
  lever() {
    noiseBurst(0.15, { vol: 0.35, freq: 700 });
    tone(140, 0.25, { type: 'square', vol: 0.1 });
  },
  spring() {
    tone(300, 0.35, { type: 'sine', vol: 0.18, slide: 900 });
  },
  win() {
    const notes = [523, 659, 784, 1047, 784, 1047, 1319];
    notes.forEach((f, i) => tone(f, 0.5, { type: 'triangle', vol: 0.18, delay: i * 0.13 }));
    noiseBurst(2.5, { vol: 0.25, freq: 150, q: 0.5, delay: 0.2 });
  },
};
