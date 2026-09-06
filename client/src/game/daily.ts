// Desafio do Dia: mesma sequência de peças para todo mundo no mesmo dia.
// Tentativas ilimitadas, mas só a melhor pontuação do dia conta.
import { hashSeed } from "./rng";

export function todayKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function dailySeed(key = todayKey()): number {
  return hashSeed(`neon-blockfall::${key}`);
}

export type DailyRecord = { score: number; lines: number; level: number };

const STORE_PREFIX = "neon-blockfall-daily-";

export function loadDailyRecord(key = todayKey()): DailyRecord | null {
  try {
    const raw = window.localStorage.getItem(STORE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DailyRecord;
    if (typeof parsed.score !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Grava se for melhor que o registro atual. Retorna o registro vigente. */
export function saveDailyRecord(record: DailyRecord, key = todayKey()): DailyRecord {
  const current = loadDailyRecord(key);
  if (current && current.score >= record.score) return current;
  try {
    window.localStorage.setItem(STORE_PREFIX + key, JSON.stringify(record));
  } catch {
    /* armazenamento indisponível */
  }
  return record;
}

export function dailyShareText(key: string, record: DailyRecord): string {
  return `Neon Blockfall — Desafio ${key}\n${record.score.toLocaleString("pt-BR")} pts · fase ${record.level} · ${record.lines} linhas`;
}
