// Contratos de dados da arena; a lógica visual permanece fora do React.
import type { ModifierId } from "./modifiers";

export const BOARD_WIDTH = 12;
export const BOARD_HEIGHT = 18;
export const LINES_PER_PHASE = 8;

/** Conjunto de peças próprio (3, 4 e 5 células) — não são os tetraminós clássicos. */
export type PieceKind = "SPARK" | "BEAM" | "SLAB" | "FORK" | "COIL" | "HOOK" | "CREST";
export type CellValue = PieceKind | "GARBAGE" | null;

export type Point = { x: number; y: number };

export type ActivePiece = {
  kind: PieceKind;
  rotation: number;
  x: number;
  y: number;
};

export type CheckpointState = {
  linesLeft: number;
  secondsLeft: number;
  target: number;
};

export type GameSnapshot = {
  board: CellValue[][];
  active: ActivePiece;
  next: PieceKind;
  /** Próximas peças (até 3), incluindo `next` na posição 0. */
  nextQueue: PieceKind[];
  /** Peça reservada (hold), ou null. */
  hold: PieceKind | null;
  /** Se o hold já foi usado nesta peça. */
  holdLocked: boolean;
  score: number;
  lines: number;
  level: number;
  /** Linhas que faltam para a próxima fase. */
  linesToNextPhase: number;
  /** Combos consecutivos (-1 = sem combo, 0 = primeiro clear). */
  combo: number;
  backToBack: boolean;
  dropInterval: number;
  /** Progresso do lock delay, 0..1 (1 = prestes a travar). */
  lockProgress: number;
  /** Modificador de fase ativo. */
  modifier: ModifierId;
  /** Se a rajada de gravidade do PULSO está ativa neste instante. */
  pulseActive: boolean;
  /** Checkpoint em andamento (fases múltiplas de 5), ou null. */
  checkpoint: CheckpointState | null;
  paused: boolean;
  gameOver: boolean;
  lastClearCount: number;
  tick: number;
  sessionElapsedMs: number;
};

export type GameEvent =
  | { type: "lineClear"; rows: number[]; count: number; combo: number; backToBack: boolean; perfectClear: boolean }
  | { type: "lock" }
  | { type: "hold" }
  | { type: "phase"; level: number; modifier: ModifierId }
  | { type: "garbage" }
  | { type: "checkpoint"; ok: boolean }
  | { type: "revive" };

export type SnapshotListener = (snapshot: GameSnapshot) => void;
export type EventListener = (event: GameEvent) => void;

/** Estado serializável para retomar uma partida em andamento. */
export type SavedRun = {
  board: CellValue[][];
  active: ActivePiece;
  queue: PieceKind[];
  hold: PieceKind | null;
  score: number;
  lines: number;
  level: number;
  sessionElapsedMs: number;
  combo: number;
  backToBack: boolean;
  /** Epoch ms de quando a partida foi salva; usado para expirar retomadas antigas. */
  savedAt?: number;
};
