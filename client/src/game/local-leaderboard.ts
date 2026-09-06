export const LOCAL_LEADERBOARD_KEY = "neon-blockfall-local-leaderboard";
export const LOCAL_LEADERBOARD_LIMIT = 10;
export const LOCAL_LEADERBOARD_FILTER_KEY = "neon-blockfall-local-leaderboard-filter";

export type LocalLeaderboardFilter = "all" | string;

export type LocalLeaderboardEntry = {
  id: string;
  score: number;
  lines: number;
  durationMs: number;
  scenarioId: string;
  createdAt: string;
};

function isEntry(value: unknown): value is LocalLeaderboardEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<LocalLeaderboardEntry>;
  return typeof entry.id === "string" && typeof entry.score === "number" && Number.isFinite(entry.score) && entry.score >= 0
    && typeof entry.lines === "number" && Number.isFinite(entry.lines) && entry.lines >= 0
    && typeof entry.durationMs === "number" && Number.isFinite(entry.durationMs) && entry.durationMs >= 0
    && typeof entry.scenarioId === "string" && typeof entry.createdAt === "string";
}

function normalize(entries: unknown): LocalLeaderboardEntry[] {
  if (!Array.isArray(entries)) return [];
  return entries.filter(isEntry).map((entry) => ({
    ...entry,
    score: Math.floor(entry.score),
    lines: Math.floor(entry.lines),
    durationMs: Math.floor(entry.durationMs),
  })).sort((a, b) => b.score - a.score || b.lines - a.lines || a.createdAt.localeCompare(b.createdAt)).slice(0, LOCAL_LEADERBOARD_LIMIT);
}

export function loadLocalLeaderboard(storage: Storage | null = typeof window !== "undefined" ? window.localStorage : null): LocalLeaderboardEntry[] {
  if (!storage) return [];
  try { return normalize(JSON.parse(storage.getItem(LOCAL_LEADERBOARD_KEY) ?? "[]")); } catch { return []; }
}

export function recordLocalScore(entry: Omit<LocalLeaderboardEntry, "id" | "createdAt">, storage: Storage | null = typeof window !== "undefined" ? window.localStorage : null): LocalLeaderboardEntry[] {
  const next: LocalLeaderboardEntry = { ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date().toISOString() };
  const entries = normalize([...loadLocalLeaderboard(storage), next]);
  try { storage?.setItem(LOCAL_LEADERBOARD_KEY, JSON.stringify(entries)); } catch { /* armazenamento indisponível */ }
  return entries;
}

export function filterLocalLeaderboard(entries: LocalLeaderboardEntry[], scenarioId: LocalLeaderboardFilter): LocalLeaderboardEntry[] {
  return scenarioId === "all" ? entries : entries.filter((entry) => entry.scenarioId === scenarioId);
}

export function clearLocalLeaderboard(storage: Storage | null = typeof window !== "undefined" ? window.localStorage : null): void {
  try { storage?.removeItem(LOCAL_LEADERBOARD_KEY); } catch { /* armazenamento indisponível */ }
}
