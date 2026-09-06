let context: AudioContext | null = null;
let timer: number | undefined;
let step = 0;
let volume = 0.22;
let muted = false;
/** 0..1 — sobe com a fase e a altura da pilha; adiciona camadas à trilha. */
let intensity = 0;

export function setMusicIntensity(value: number) {
  intensity = Math.max(0, Math.min(1, value));
}

try {
  volume = Number(window.localStorage.getItem("neon-blockfall-music-volume") ?? 0.22);
  muted = window.localStorage.getItem("neon-blockfall-music-muted") === "true";
} catch { /* usar padrão */ }

export function getMusicSettings() { return { volume, muted }; }
export function setMusicVolume(value: number) {
  volume = Math.max(0, Math.min(1, value));
  try { window.localStorage.setItem("neon-blockfall-music-volume", String(volume)); } catch { /* ignorar */ }
}
export function setMusicMuted(value: boolean) {
  muted = value;
  if (muted) stopMusic();
  try { window.localStorage.setItem("neon-blockfall-music-muted", String(muted)); } catch { /* ignorar */ }
}

function getContext() {
  if (typeof window === "undefined") return null;
  const AudioContextCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;
  context ??= new AudioContextCtor();
  if (context.state === "suspended") void context.resume();
  return context;
}

function note(ctx: AudioContext, frequency: number, duration: number, offset: number, waveform: OscillatorType, gainValue: number) {
  const start = ctx.currentTime + offset;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = waveform;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, gainValue * volume), start + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.04);
}

function scheduleBar(ctx: AudioContext) {
  if (muted) return;
  const bass = [55, 55, 73.42, 65.41, 55, 82.41, 73.42, 65.41];
  const arp = [220, 261.63, 329.63, 392, 329.63, 261.63, 196, 261.63];
  const lead = [523.25, 659.25, 783.99, 659.25, 587.33, 493.88, 523.25, 659.25];
  for (let index = 0; index < 8; index += 1) {
    note(ctx, bass[(step + index) % bass.length] ?? 55, 0.28, index * 0.22, "triangle", 0.17 + intensity * 0.05);
    note(ctx, arp[(step * 2 + index) % arp.length] ?? 220, 0.1, index * 0.22 + 0.03, "square", 0.045 + intensity * 0.02);
    // camada de lead entra com a intensidade
    if (intensity > 0.35 && (index % 2 === 0 || intensity > 0.7)) {
      note(ctx, lead[(step + index) % lead.length] ?? 523.25, 0.09, index * 0.22 + 0.11, "sawtooth", 0.02 + intensity * 0.03);
    }
  }
  note(ctx, 110, 1.65, 0, "sine", 0.035);
  if (intensity > 0.55) note(ctx, 55, 1.65, 0, "square", 0.02 + intensity * 0.02);
  step = (step + 1) % 16;
}

export function startMusic() {
  const ctx = getContext();
  if (!ctx || timer !== undefined) return;
  scheduleBar(ctx);
  timer = window.setInterval(() => { if (context) scheduleBar(context); }, 1760);
}

export function stopMusic() {
  if (timer !== undefined) window.clearInterval(timer);
  timer = undefined;
}
