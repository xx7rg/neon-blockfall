// Modos de partida além do Endless e do Desafio do Dia.
// Sprint: corrida até N linhas (menor tempo vence).
// Ultra: ataque de pontos com tempo fixo.

export type RunMode = "endless" | "sprint" | "ultra";

export const SPRINT_LINES = 100;
export const ULTRA_MS = 120_000;

export type ModeRecords = {
  sprintBestMs: number | null;
  ultraBestScore: number | null;
};

const RECORDS_KEY = "neon-blockfall-mode-records";
const EMPTY: ModeRecords = { sprintBestMs: null, ultraBestScore: null };

function read(): ModeRecords {
  if (typeof window === "undefined") return { ...EMPTY };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECORDS_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object") return { ...EMPTY };
    return {
      sprintBestMs: typeof parsed.sprintBestMs === "number" ? parsed.sprintBestMs : null,
      ultraBestScore: typeof parsed.ultraBestScore === "number" ? parsed.ultraBestScore : null,
    };
  } catch {
    return { ...EMPTY };
  }
}

function write(records: ModeRecords) {
  try {
    window.localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
  } catch {
    /* armazenamento indisponível */
  }
}

export function loadModeRecords(): ModeRecords {
  return read();
}

/** Registra um tempo de Sprint (ms). Guarda só o menor. Retorna {records, improved}. */
export function recordSprint(ms: number): { records: ModeRecords; improved: boolean } {
  const current = read();
  const improved = current.sprintBestMs === null || ms < current.sprintBestMs;
  const records: ModeRecords = { ...current, sprintBestMs: improved ? ms : current.sprintBestMs };
  if (improved) write(records);
  return { records, improved };
}

/** Registra uma pontuação de Ultra. Guarda só a maior. Retorna {records, improved}. */
export function recordUltra(score: number): { records: ModeRecords; improved: boolean } {
  const current = read();
  const improved = current.ultraBestScore === null || score > current.ultraBestScore;
  const records: ModeRecords = { ...current, ultraBestScore: improved ? score : current.ultraBestScore };
  if (improved) write(records);
  return { records, improved };
}

/** m:ss.d — relógio curto para tempos de Sprint e contagem do Ultra. */
export function formatClock(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalTenths = Math.floor(clamped / 100);
  const minutes = Math.floor(totalTenths / 600);
  const seconds = Math.floor((totalTenths % 600) / 10);
  const tenths = totalTenths % 10;
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${tenths}`;
}
