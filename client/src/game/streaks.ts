// Sequência de dias jogados: mede o hábito diário, não a performance da partida.
import { todayKey } from "./daily";

export type StreakRecord = {
  currentStreak: number;
  longestStreak: number;
  lastPlayedDay: string;
};

const STREAK_KEY = "neon-blockfall-streak";

const EMPTY_STREAK: StreakRecord = { currentStreak: 0, longestStreak: 0, lastPlayedDay: "" };

function isStreakRecord(value: unknown): value is StreakRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<StreakRecord>;
  return (
    typeof record.currentStreak === "number" &&
    typeof record.longestStreak === "number" &&
    typeof record.lastPlayedDay === "string"
  );
}

export function loadStreak(
  storage: Storage | null = typeof window !== "undefined" ? window.localStorage : null
): StreakRecord {
  if (!storage) return { ...EMPTY_STREAK };
  try {
    const parsed = JSON.parse(storage.getItem(STREAK_KEY) ?? "null");
    return isStreakRecord(parsed) ? parsed : { ...EMPTY_STREAK };
  } catch {
    return { ...EMPTY_STREAK };
  }
}

function yesterdayKey(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  return todayKey(new Date(y, m - 1, d - 1));
}

/**
 * Chame uma vez por partida concluída. Só altera a sequência na primeira
 * partida do dia — tentativas extras no mesmo dia não inflam o streak.
 */
export function recordPlaySession(
  storage: Storage | null = typeof window !== "undefined" ? window.localStorage : null,
  today = todayKey()
): { record: StreakRecord; isFirstToday: boolean } {
  const previous = loadStreak(storage);
  if (previous.lastPlayedDay === today) {
    return { record: previous, isFirstToday: false };
  }
  const continued = previous.lastPlayedDay === yesterdayKey(today);
  const currentStreak = continued ? previous.currentStreak + 1 : 1;
  const record: StreakRecord = {
    currentStreak,
    longestStreak: Math.max(previous.longestStreak, currentStreak),
    lastPlayedDay: today,
  };
  try {
    storage?.setItem(STREAK_KEY, JSON.stringify(record));
  } catch {
    /* armazenamento indisponível */
  }
  return { record, isFirstToday: true };
}
