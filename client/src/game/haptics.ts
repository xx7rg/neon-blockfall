// Vibração leve via Web Vibration API (funciona em Android/Chrome e no WebView do
// Capacitor). No-op onde não houver suporte. Respeita prefers-reduced-motion.
type Pattern = "light" | "medium" | "heavy" | "clear" | "phase" | "gameOver";

const PATTERNS: Record<Pattern, number | number[]> = {
  light: 10,
  medium: 20,
  heavy: 35,
  clear: [0, 18, 30, 24],
  phase: [0, 25, 40, 25, 40, 40],
  gameOver: [0, 60, 50, 90],
};

let enabled = true;
try {
  enabled = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
} catch {
  /* matchMedia indisponível */
}

export function vibrate(pattern: Pattern) {
  if (!enabled) return;
  try {
    navigator.vibrate?.(PATTERNS[pattern]);
  } catch {
    /* vibração indisponível */
  }
}
