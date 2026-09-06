export const LINES_PER_PHASE = 8;

export function formatSessionElapsed(milliseconds: number) {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function getPhaseProgress(lines: number) {
  const withinPhase = Math.floor(Math.max(0, lines)) % LINES_PER_PHASE;
  return Math.min(100, Math.max(0, Math.round((withinPhase / LINES_PER_PHASE) * 100)));
}
