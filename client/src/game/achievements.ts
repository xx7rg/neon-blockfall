// Conquistas: progresso cumulativo do jogador, persistido neste dispositivo.
export type Achievement = {
  id: string;
  title: string;
  description: string;
};

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first_drop", title: "PRIMEIRA QUEDA", description: "Termine sua primeira partida" },
  { id: "score_1k", title: "NEON INICIANTE", description: "Alcance 1.000 pontos em uma partida" },
  { id: "score_5k", title: "PILOTO DE ELITE", description: "Alcance 5.000 pontos em uma partida" },
  { id: "score_10k", title: "LENDA NEON", description: "Alcance 10.000 pontos em uma partida" },
  { id: "marathon_10", title: "MARATONISTA", description: "Complete 10 partidas" },
  { id: "marathon_50", title: "VETERANO", description: "Complete 50 partidas" },
  { id: "lines_100", title: "DEMOLIDOR", description: "Elimine 100 linhas no total" },
  { id: "streak_3", title: "RITMO CONSTANTE", description: "Jogue 3 dias seguidos" },
  { id: "streak_7", title: "SEMANA CHEIA", description: "Jogue 7 dias seguidos" },
];

export type PlayerStats = {
  gamesPlayed: number;
  totalLines: number;
  bestScore: number;
};

const STATS_KEY = "neon-blockfall-player-stats";
const UNLOCKED_KEY = "neon-blockfall-achievements";

const EMPTY_STATS: PlayerStats = { gamesPlayed: 0, totalLines: 0, bestScore: 0 };

function isStats(value: unknown): value is PlayerStats {
  if (!value || typeof value !== "object") return false;
  const stats = value as Partial<PlayerStats>;
  return (
    typeof stats.gamesPlayed === "number" &&
    typeof stats.totalLines === "number" &&
    typeof stats.bestScore === "number"
  );
}

export function loadPlayerStats(
  storage: Storage | null = typeof window !== "undefined" ? window.localStorage : null
): PlayerStats {
  if (!storage) return { ...EMPTY_STATS };
  try {
    const parsed = JSON.parse(storage.getItem(STATS_KEY) ?? "null");
    return isStats(parsed) ? parsed : { ...EMPTY_STATS };
  } catch {
    return { ...EMPTY_STATS };
  }
}

export function loadUnlockedAchievements(
  storage: Storage | null = typeof window !== "undefined" ? window.localStorage : null
): string[] {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(UNLOCKED_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function isUnlocked(id: string, stats: PlayerStats, streak: number): boolean {
  switch (id) {
    case "first_drop":
      return stats.gamesPlayed >= 1;
    case "score_1k":
      return stats.bestScore >= 1000;
    case "score_5k":
      return stats.bestScore >= 5000;
    case "score_10k":
      return stats.bestScore >= 10000;
    case "marathon_10":
      return stats.gamesPlayed >= 10;
    case "marathon_50":
      return stats.gamesPlayed >= 50;
    case "lines_100":
      return stats.totalLines >= 100;
    case "streak_3":
      return streak >= 3;
    case "streak_7":
      return streak >= 7;
    default:
      return false;
  }
}

/** Chame uma vez por partida concluída. Retorna as conquistas recém-desbloqueadas nesta partida. */
export function recordGameForAchievements(
  result: { score: number; lines: number },
  currentStreak: number,
  storage: Storage | null = typeof window !== "undefined" ? window.localStorage : null
): { stats: PlayerStats; unlocked: string[]; newlyUnlocked: Achievement[] } {
  const previous = loadPlayerStats(storage);
  const stats: PlayerStats = {
    gamesPlayed: previous.gamesPlayed + 1,
    totalLines: previous.totalLines + Math.max(0, Math.floor(result.lines)),
    bestScore: Math.max(previous.bestScore, Math.max(0, Math.floor(result.score))),
  };
  try {
    storage?.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    /* armazenamento indisponível */
  }

  const previouslyUnlocked = new Set(loadUnlockedAchievements(storage));
  const unlocked = ACHIEVEMENTS.filter(
    (achievement) => previouslyUnlocked.has(achievement.id) || isUnlocked(achievement.id, stats, currentStreak)
  ).map((achievement) => achievement.id);
  const newlyUnlocked = ACHIEVEMENTS.filter(
    (achievement) => !previouslyUnlocked.has(achievement.id) && unlocked.includes(achievement.id)
  );
  try {
    storage?.setItem(UNLOCKED_KEY, JSON.stringify(unlocked));
  } catch {
    /* armazenamento indisponível */
  }

  return { stats, unlocked, newlyUnlocked };
}
