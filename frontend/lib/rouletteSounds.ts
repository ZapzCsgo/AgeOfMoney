/**
 * Roulette sound effects — synthesized via Web Audio API.
 * No external files needed.
 */

let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function gainNode(ac: AudioContext, value: number, attack = 0.01, decay = 0): GainNode {
  const g = ac.createGain();
  g.gain.setValueAtTime(0, ac.currentTime);
  g.gain.linearRampToValueAtTime(value, ac.currentTime + attack);
  if (decay > 0) g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + attack + decay);
  g.connect(ac.destination);
  return g;
}

// Cache audio elements
let wololoAudio: HTMLAudioElement | null = null;

/** WOLOLO — uses /public/sounds/wololo.mp3 if available, fallback to synthesis */
export function playWololo(volume = 0.5) {
  // Try real sound file first
  try {
    if (!wololoAudio) {
      wololoAudio = new Audio('/sounds/Wololo Sound Effect.mp3');
    }
    wololoAudio.currentTime = 0;
    wololoAudio.volume = volume;
    wololoAudio.play().catch(() => {
      // File not found or blocked → fallback synthesis
      wololoSynth(volume * 0.5);
    });
    return;
  } catch { /* fallback */ }
  wololoSynth(volume * 0.5);
}

/** Synthesized fallback WOLOLO */
function wololoSynth(volume = 0.25) {
  try {
    const ac = getCtx();
    const t = ac.currentTime;
    const osc1 = ac.createOscillator(); const g1 = ac.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(220, t);
    osc1.frequency.linearRampToValueAtTime(200, t + 0.18);
    g1.gain.setValueAtTime(0, t); g1.gain.linearRampToValueAtTime(volume, t + 0.03);
    g1.gain.setValueAtTime(volume, t + 0.13); g1.gain.linearRampToValueAtTime(0, t + 0.22);
    osc1.connect(g1); g1.connect(ac.destination); osc1.start(t); osc1.stop(t + 0.22);

    const osc2 = ac.createOscillator(); const g2 = ac.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(260, t + 0.22); osc2.frequency.linearRampToValueAtTime(190, t + 0.50);
    g2.gain.setValueAtTime(0, t + 0.22); g2.gain.linearRampToValueAtTime(volume * 0.9, t + 0.26);
    g2.gain.setValueAtTime(volume * 0.9, t + 0.38); g2.gain.linearRampToValueAtTime(0, t + 0.54);
    osc2.connect(g2); g2.connect(ac.destination); osc2.start(t + 0.22); osc2.stop(t + 0.54);

    const osc3 = ac.createOscillator(); const g3 = ac.createGain();
    osc3.type = 'sine';
    osc3.frequency.setValueAtTime(200, t + 0.54); osc3.frequency.linearRampToValueAtTime(160, t + 0.85);
    g3.gain.setValueAtTime(0, t + 0.54); g3.gain.linearRampToValueAtTime(volume * 0.6, t + 0.57);
    g3.gain.linearRampToValueAtTime(0, t + 0.88);
    osc3.connect(g3); g3.connect(ac.destination); osc3.start(t + 0.54); osc3.stop(t + 0.88);

    const vib = ac.createOscillator(); const vibG = ac.createGain();
    vib.frequency.value = 5.5; vibG.gain.value = 4;
    vib.connect(vibG); vibG.connect(osc1.frequency); vibG.connect(osc2.frequency); vibG.connect(osc3.frequency);
    vib.start(t); vib.stop(t + 0.9);
  } catch { /* */ }
}

/** Tick sound — played rapidly as wheel flies past each slot.
 *  `progress` (0..1) lowers the pitch and bumps the gain near the end —
 *  so the last few ticks before landing feel fat and dramatic. */
export function playTick(progress = 0) {
  try {
    const ac = getCtx();
    const t = ac.currentTime;
    // White-noise click with a sharper envelope at the end
    const buf = ac.createBuffer(1, ac.sampleRate * 0.05, ac.sampleRate);
    const data = buf.getChannelData(0);
    const decay = 0.15 + progress * 0.25; // longer body near the end
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (data.length * decay));
    }
    const src = ac.createBufferSource();
    src.buffer = buf;
    // Lowpass that opens up at the start, closes at the end → "pop → thunk"
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 8000 - progress * 6500; // 8000Hz → 1500Hz
    const g = ac.createGain();
    g.gain.setValueAtTime(0.12 + progress * 0.18, t); // 0.12 → 0.30
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(lp); lp.connect(g); g.connect(ac.destination);
    src.start(t);
  } catch { /* */ }
}

/** WIN — triumphant ascending arpeggio */
export function playWin() {
  try {
    const ac = getCtx();
    const t = ac.currentTime;
    const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
    notes.forEach((freq, i) => {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const start = t + i * 0.09;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.28, start + 0.04);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.45);
      osc.connect(g); g.connect(ac.destination);
      osc.start(start); osc.stop(start + 0.5);
    });
    // Big final chord
    [523, 659, 784].forEach(freq => {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = t + 0.38;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.2, start + 0.06);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.9);
      osc.connect(g); g.connect(ac.destination);
      osc.start(start); osc.stop(start + 1.0);
    });
  } catch { /* */ }
}

/** LOSE — descending minor chord, short */
export function playLose() {
  try {
    const ac = getCtx();
    const t = ac.currentTime;
    const notes = [392, 349, 311]; // G4 F4 Eb4 descending
    notes.forEach((freq, i) => {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      osc.frequency.linearRampToValueAtTime(freq * 0.97, t + i * 0.12 + 0.3);
      const start = t + i * 0.11;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.2, start + 0.04);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.45);
      osc.connect(g); g.connect(ac.destination);
      osc.start(start); osc.stop(start + 0.5);
    });
  } catch { /* */ }
}

/** EMPEROR WIN — extra dramatic, deep gong + fanfare */
export function playEmperorWin() {
  try {
    const ac = getCtx();
    const t = ac.currentTime;
    // Deep gong
    const gong = ac.createOscillator();
    const gongG = ac.createGain();
    gong.type = 'sine';
    gong.frequency.setValueAtTime(80, t);
    gong.frequency.exponentialRampToValueAtTime(60, t + 1.2);
    gongG.gain.setValueAtTime(0, t);
    gongG.gain.linearRampToValueAtTime(0.4, t + 0.02);
    gongG.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
    gong.connect(gongG); gongG.connect(ac.destination);
    gong.start(t); gong.stop(t + 2);
    // Fanfare on top
    setTimeout(() => playWin(), 150);
  } catch { /* */ }
}
