let audioContext: AudioContext | null = null;
let masterVolume = 0.68;
let muted = false;

try {
  masterVolume = Number(window.localStorage.getItem("neon-blockfall-volume") ?? 0.68);
  muted = window.localStorage.getItem("neon-blockfall-muted") === "true";
} catch { /* storage indisponível: usar preferências padrão */ }

export function getAudioSettings() { return { volume: masterVolume, muted }; }
export function setAudioVolume(value: number) {
  masterVolume = Math.max(0, Math.min(1, value));
  try { window.localStorage.setItem("neon-blockfall-volume", String(masterVolume)); } catch { /* ignorar */ }
}
export function setAudioMuted(value: boolean) {
  muted = value;
  try { window.localStorage.setItem("neon-blockfall-muted", String(muted)); } catch { /* ignorar */ }
}

function getContext() {
  if (typeof window === "undefined") return null;
  const AudioContextCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;
  audioContext ??= new AudioContextCtor();
  if (audioContext.state === "suspended") void audioContext.resume();
  return audioContext;
}

function tone(ctx: AudioContext, frequency: number, duration: number, offset: number, type: OscillatorType, gainValue: number) {
  const start = ctx.currentTime + offset;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, frequency * 0.58), start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  const outputGain = muted ? 0 : gainValue * masterVolume;
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, outputGain), start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

export function playLineClear(lines: number) {
  const ctx = getContext(); if (!ctx) return;
  const notes = lines >= 4 ? [196, 293.66, 392, 587.33] : [220, 329.63, 440];
  notes.forEach((frequency, index) => tone(ctx, frequency, 0.24 + index * 0.03, index * 0.055, index % 2 ? "square" : "sawtooth", 0.045));
  tone(ctx, 880, 0.18, 0.22, "triangle", 0.035);
}

export function playGameOver() {
  const ctx = getContext(); if (!ctx) return;
  [220, 174.61, 130.81].forEach((frequency, index) => tone(ctx, frequency, 0.42, index * 0.18, "sawtooth", 0.055));
}

export function playPauseOpen() {
  const ctx = getContext(); if (!ctx) return;
  tone(ctx, 261.63, 0.12, 0, "triangle", 0.028);
  tone(ctx, 523.25, 0.16, 0.065, "square", 0.022);
}

export function playPauseClose() {
  const ctx = getContext(); if (!ctx) return;
  tone(ctx, 523.25, 0.12, 0, "square", 0.022);
  tone(ctx, 261.63, 0.18, 0.06, "triangle", 0.028);
}

export function playGestureAccepted(action: "move" | "rotate") {
  const ctx = getContext(); if (!ctx) return;
  if (action === "rotate") {
    tone(ctx, 660, 0.09, 0, "triangle", 0.035);
    tone(ctx, 990, 0.11, 0.045, "square", 0.022);
    return;
  }
  tone(ctx, 330, 0.08, 0, "square", 0.026);
  tone(ctx, 495, 0.1, 0.04, "triangle", 0.018);
}

export function playPhaseUp() {
  const ctx = getContext(); if (!ctx) return;
  [392, 523.25, 659.25, 783.99].forEach((frequency, index) => tone(ctx, frequency, 0.2, index * 0.07, index % 2 ? "square" : "sawtooth", 0.05));
  tone(ctx, 1046.5, 0.32, 0.28, "triangle", 0.04);
}

export function playHold() {
  const ctx = getContext(); if (!ctx) return;
  tone(ctx, 587.33, 0.07, 0, "triangle", 0.03);
  tone(ctx, 440, 0.09, 0.04, "square", 0.02);
}

export function playCombo(step: number) {
  const ctx = getContext(); if (!ctx) return;
  const base = 440 * Math.pow(2, Math.min(step, 8) / 12);
  tone(ctx, base, 0.1, 0, "square", 0.03);
  tone(ctx, base * 1.5, 0.12, 0.05, "triangle", 0.022);
}

export function playGarbage() {
  const ctx = getContext(); if (!ctx) return;
  tone(ctx, 110, 0.16, 0, "sawtooth", 0.05);
  tone(ctx, 82, 0.22, 0.05, "sine", 0.04);
}

export function playCheckpoint(ok: boolean) {
  const ctx = getContext(); if (!ctx) return;
  if (ok) {
    [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => tone(ctx, frequency, 0.24, index * 0.08, index % 2 ? "square" : "triangle", 0.05));
  } else {
    [349.23, 293.66, 220].forEach((frequency, index) => tone(ctx, frequency, 0.3, index * 0.12, "sawtooth", 0.045));
  }
}

// --- Feedback de posição da peça (frequência constante = "tique" seco) ---

function blip(ctx: AudioContext, frequency: number, duration: number, offset: number, type: OscillatorType, gainValue: number) {
  const start = ctx.currentTime + offset;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  const outputGain = muted ? 0 : gainValue * masterVolume;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(Math.max(0.0001, outputGain), start + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

let lastMoveAt = 0;
let lastBlockedAt = 0;

export function playMove() {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (now - lastMoveAt < 55) return;
  lastMoveAt = now;
  const ctx = getContext(); if (!ctx) return;
  blip(ctx, 200, 0.028, 0, "square", 0.02);
}

export function playRotate() {
  const ctx = getContext(); if (!ctx) return;
  blip(ctx, 520, 0.035, 0, "triangle", 0.026);
  blip(ctx, 780, 0.045, 0.022, "square", 0.016);
}

export function playBlocked() {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (now - lastBlockedAt < 130) return;
  lastBlockedAt = now;
  const ctx = getContext(); if (!ctx) return;
  blip(ctx, 116, 0.06, 0, "sawtooth", 0.028);
}

export function playLock() {
  const ctx = getContext(); if (!ctx) return;
  blip(ctx, 160, 0.05, 0, "square", 0.03);
  blip(ctx, 90, 0.09, 0.018, "sine", 0.028);
}

export function playHardDrop() {
  const ctx = getContext(); if (!ctx) return;
  tone(ctx, 440, 0.11, 0, "sawtooth", 0.03);
  blip(ctx, 120, 0.06, 0.085, "square", 0.03);
}

let lastDangerAt = 0;
export function playDanger() {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (now - lastDangerAt < 900) return;
  lastDangerAt = now;
  const ctx = getContext(); if (!ctx) return;
  blip(ctx, 98, 0.14, 0, "sawtooth", 0.03);
  blip(ctx, 65, 0.18, 0.06, "sine", 0.028);
}

export function playPerfect() {
  const ctx = getContext(); if (!ctx) return;
  [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) =>
    tone(ctx, f, 0.3, i * 0.06, i % 2 ? "square" : "triangle", 0.055)
  );
  tone(ctx, 1567.98, 0.5, 0.34, "sawtooth", 0.035);
}
