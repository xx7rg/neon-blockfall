// Regras puras do jogo, sem dependência de React ou do renderizador.
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  LINES_PER_PHASE,
  type ActivePiece,
  type CellValue,
  type CheckpointState,
  type EventListener,
  type GameSnapshot,
  type PieceKind,
  type Point,
  type SavedRun,
  type SnapshotListener,
} from "./types";
import { createBag, getCells, NON_ROTATING } from "./pieces";
import { mulberry32 } from "./rng";
import {
  CHECKPOINT_EVERY,
  CHECKPOINT_WINDOW_MS,
  checkpointTarget,
  GARBAGE_INTERVAL_MS,
  modifierForPhase,
  PULSE_ACTIVE_MS,
  PULSE_CYCLE_MS,
  PULSE_SPEEDUP,
} from "./modifiers";

const LOCK_DELAY_MS = 500;
const LOCK_RESET_CAP = 15;
const QUEUE_MIN = 5;
const CLEAR_TABLE = [0, 60, 160, 320, 560, 900];

function emptyBoard(): CellValue[][] {
  return Array.from({ length: BOARD_HEIGHT }, () => Array<CellValue>(BOARD_WIDTH).fill(null));
}

function cloneBoard(board: CellValue[][]) {
  return board.map((row) => [...row]);
}

type Checkpoint = { startLines: number; deadline: number; target: number };

export class GameWorld {
  private board = emptyBoard();
  private active!: ActivePiece;
  private queue: PieceKind[] = [];
  private heldKind: PieceKind | null = null;
  private holdLocked = false;
  private bag: PieceKind[] = [];
  private random: () => number;
  private seed: number | undefined;
  private elapsed = 0;
  private sessionElapsedMs = 0;
  private score = 0;
  private lines = 0;
  private level = 1;
  private combo = -1;
  private backToBack = false;
  private lockTimer = 0;
  private lockResets = 0;
  private garbageTimer = 0;
  private pulseTimer = 0;
  private checkpoint: Checkpoint | null = null;
  private paused = false;
  private gameOver = false;
  private lastClearCount = 0;
  private tickCount = 0;
  private listeners = new Set<SnapshotListener>();
  private eventListeners = new Set<EventListener>();

  constructor(random: () => number = Math.random, seed?: number) {
    this.seed = seed;
    this.random = seed !== undefined ? mulberry32(seed) : random;
    this.refillQueue();
    this.active = this.spawnPiece(this.queue.shift() as PieceKind);
    this.refillQueue();
    this.emit();
  }

  static fromSaved(saved: SavedRun, random: () => number = Math.random): GameWorld {
    const world = new GameWorld(random);
    world.board = saved.board.map((row) => [...row]);
    world.active = { ...saved.active };
    world.queue = [...saved.queue];
    world.heldKind = saved.hold;
    world.holdLocked = false;
    world.score = saved.score;
    world.lines = saved.lines;
    world.level = saved.level;
    world.sessionElapsedMs = saved.sessionElapsedMs;
    world.combo = saved.combo;
    world.backToBack = saved.backToBack;
    world.elapsed = 0;
    world.lockTimer = 0;
    world.lockResets = 0;
    world.garbageTimer = 0;
    world.pulseTimer = 0;
    world.checkpoint = null;
    world.paused = false;
    world.gameOver = false;
    world.refillQueue();
    world.emit();
    return world;
  }

  get modifier() {
    return modifierForPhase(this.level);
  }

  get pulseActive() {
    return this.modifier === "pulse" && this.pulseTimer % PULSE_CYCLE_MS >= PULSE_CYCLE_MS - PULSE_ACTIVE_MS;
  }

  get snapshot(): GameSnapshot {
    const resting = this.isResting();
    return {
      board: cloneBoard(this.board),
      active: { ...this.active },
      next: this.queue[0],
      nextQueue: this.queue.slice(0, 3),
      hold: this.heldKind,
      holdLocked: this.holdLocked,
      score: this.score,
      lines: this.lines,
      level: this.level,
      linesToNextPhase: LINES_PER_PHASE - (this.lines % LINES_PER_PHASE),
      combo: this.combo,
      backToBack: this.backToBack,
      dropInterval: this.dropInterval,
      lockProgress: resting ? Math.min(1, this.lockTimer / LOCK_DELAY_MS) : 0,
      modifier: this.modifier,
      pulseActive: this.pulseActive,
      checkpoint: this.checkpointState(),
      paused: this.paused,
      gameOver: this.gameOver,
      lastClearCount: this.lastClearCount,
      tick: this.tickCount,
      sessionElapsedMs: this.sessionElapsedMs,
    };
  }

  serialize(): SavedRun {
    return {
      board: cloneBoard(this.board),
      active: { ...this.active },
      queue: [...this.queue],
      hold: this.heldKind,
      score: this.score,
      lines: this.lines,
      level: this.level,
      sessionElapsedMs: this.sessionElapsedMs,
      combo: this.combo,
      backToBack: this.backToBack,
      savedAt: Date.now(),
    };
  }

  get dropInterval() {
    // Rampa mais suave: cai devagar e leva ~20 fases para chegar ao piso.
    const base = Math.max(90, Math.round(820 * Math.pow(0.885, this.level - 1)));
    return this.pulseActive ? Math.max(70, Math.round(base * PULSE_SPEEDUP)) : base;
  }

  subscribe(listener: SnapshotListener) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  onEvent(listener: EventListener) {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  update(deltaMs: number) {
    if (this.paused || this.gameOver) return;
    this.elapsed += deltaMs;
    this.sessionElapsedMs += Math.max(0, deltaMs);
    this.lastClearCount = 0;
    let changed = false;

    // --- Modificador de fase ---
    if (this.modifier === "overload") {
      this.garbageTimer += deltaMs;
      if (this.garbageTimer >= GARBAGE_INTERVAL_MS) {
        this.garbageTimer -= GARBAGE_INTERVAL_MS;
        this.riseGarbage();
        changed = true;
      }
    } else if (this.modifier === "pulse") {
      this.pulseTimer += deltaMs;
    }

    // --- Checkpoint por tempo ---
    if (this.checkpoint && this.sessionElapsedMs > this.checkpoint.deadline) {
      this.checkpoint = null;
      this.emitEvent({ type: "checkpoint", ok: false });
      changed = true;
    }

    while (this.elapsed >= this.dropInterval) {
      this.elapsed -= this.dropInterval;
      if (this.stepDown()) {
        changed = true;
        this.lockTimer = 0;
      } else {
        break;
      }
    }

    if (!this.gameOver && this.isResting()) {
      this.lockTimer += deltaMs;
      if (this.lockTimer >= LOCK_DELAY_MS || this.lockResets >= LOCK_RESET_CAP) {
        this.lockPiece();
        changed = true;
      }
    } else {
      this.lockTimer = 0;
    }

    this.tickCount += 1;
    if (changed) this.emit();
  }

  move(direction: -1 | 1) {
    if (this.paused || this.gameOver) return;
    const candidate = { ...this.active, x: this.active.x + direction };
    if (!this.collides(candidate)) {
      this.active = candidate;
      this.touchLockReset();
      this.emit();
    }
  }

  rotate(direction: 1 | -1 = 1) {
    if (this.paused || this.gameOver || NON_ROTATING.has(this.active.kind)) return;
    const nextRotation = this.active.rotation + direction;
    const kicks = [0, -1, 1, -2, 2];
    for (const offset of kicks) {
      const candidate = { ...this.active, rotation: nextRotation, x: this.active.x + offset };
      if (!this.collides(candidate)) {
        this.active = candidate;
        this.touchLockReset();
        this.emit();
        return;
      }
    }
  }

  softDrop() {
    if (this.paused || this.gameOver) return;
    if (this.stepDown()) {
      this.score += 1;
      this.elapsed = 0;
      this.lockTimer = 0;
    }
    this.emit();
  }

  hardDrop() {
    if (this.paused || this.gameOver) return;
    let cells = 0;
    while (this.stepDown()) cells += 1;
    this.score += cells * 2;
    this.lockPiece();
    this.emit();
  }

  hold() {
    if (this.paused || this.gameOver || this.holdLocked) return;
    const current = this.active.kind;
    if (this.heldKind === null) {
      this.heldKind = current;
      this.active = this.spawnPiece(this.queue.shift() as PieceKind);
      this.refillQueue();
    } else {
      const swap = this.heldKind;
      this.heldKind = current;
      this.active = this.spawnPiece(swap);
    }
    this.holdLocked = true;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.emitEvent({ type: "hold" });
    if (this.collides(this.active)) this.gameOver = true;
    this.emit();
  }

  /** Salta direto para uma fase (usado por QA e por um futuro "começar na fase X"). */
  jumpToPhase(level: number, announce = false) {
    if (this.gameOver) return;
    this.level = Math.max(1, Math.floor(level));
    this.lines = (this.level - 1) * LINES_PER_PHASE;
    this.garbageTimer = 0;
    this.pulseTimer = 0;
    this.checkpoint =
      this.level % CHECKPOINT_EVERY === 0
        ? { startLines: this.lines, deadline: this.sessionElapsedMs + CHECKPOINT_WINDOW_MS, target: checkpointTarget(this.level) }
        : null;
    this.emit();
    if (announce && this.level > 1) {
      this.emitEvent({ type: "phase", level: this.level, modifier: modifierForPhase(this.level) });
    }
  }

  setPaused(paused: boolean) {
    if (this.gameOver || this.paused === paused) return;
    this.paused = paused;
    this.emit();
  }

  togglePause() {
    this.setPaused(!this.paused);
  }

  primeDemoClear(preserveProgress = false) {
    this.board = emptyBoard();
    for (let x = 0; x < BOARD_WIDTH; x += 1) {
      if (x < 4 || x > 7) this.board[BOARD_HEIGHT - 1][x] = "COIL";
    }
    this.active = { kind: "BEAM", rotation: 0, x: 4, y: 0 };
    this.queue = [];
    this.refillQueue();
    this.heldKind = null;
    this.holdLocked = false;
    this.elapsed = 0;
    this.sessionElapsedMs = 0;
    if (!preserveProgress) {
      this.score = 0;
      this.lines = 0;
      this.level = 1;
    }
    this.combo = -1;
    this.backToBack = false;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.garbageTimer = 0;
    this.pulseTimer = 0;
    this.checkpoint = null;
    this.paused = false;
    this.gameOver = false;
    this.lastClearCount = 0;
    this.tickCount = 0;
    this.emit();
  }

  /** Troca a fonte de aleatoriedade e reinicia: `seed` fixa a sequência (Desafio do Dia); `undefined` volta ao aleatório. */
  reseed(seed?: number) {
    this.seed = seed;
    this.random = seed !== undefined ? mulberry32(seed) : Math.random;
    this.restart();
  }

  restart() {
    this.board = emptyBoard();
    if (this.seed !== undefined) this.random = mulberry32(this.seed);
    this.bag = [];
    this.queue = [];
    this.refillQueue();
    this.active = this.spawnPiece(this.queue.shift() as PieceKind);
    this.refillQueue();
    this.heldKind = null;
    this.holdLocked = false;
    this.elapsed = 0;
    this.sessionElapsedMs = 0;
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.combo = -1;
    this.backToBack = false;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.garbageTimer = 0;
    this.pulseTimer = 0;
    this.checkpoint = null;
    this.paused = false;
    this.gameOver = false;
    this.lastClearCount = 0;
    this.tickCount = 0;
    this.emit();
  }

  private checkpointState(): CheckpointState | null {
    if (!this.checkpoint) return null;
    return {
      target: this.checkpoint.target,
      linesLeft: Math.max(0, this.checkpoint.target - (this.lines - this.checkpoint.startLines)),
      secondsLeft: Math.max(0, Math.ceil((this.checkpoint.deadline - this.sessionElapsedMs) / 1000)),
    };
  }

  private garbageRow(): CellValue[] {
    const gap = Math.floor(this.random() * BOARD_WIDTH);
    return Array.from({ length: BOARD_WIDTH }, (_, x) => (x === gap ? null : "GARBAGE"));
  }

  private riseGarbage() {
    if (this.board[0].some(Boolean)) {
      this.gameOver = true;
      return;
    }
    this.board.shift();
    this.board.push(this.garbageRow());
    const lifted = { ...this.active, y: this.active.y - 1 };
    if (!this.collides(lifted)) this.active = lifted;
    if (this.collides(this.active)) this.gameOver = true;
    this.emitEvent({ type: "garbage" });
  }

  private touchLockReset() {
    if (this.isResting() && this.lockResets < LOCK_RESET_CAP) {
      this.lockTimer = 0;
      this.lockResets += 1;
    }
  }

  private refillQueue() {
    while (this.queue.length < QUEUE_MIN) this.queue.push(this.draw());
  }

  private draw(): PieceKind {
    if (this.bag.length === 0) this.bag = createBag(this.random);
    return this.bag.pop() as PieceKind;
  }

  private spawnPiece(kind: PieceKind): ActivePiece {
    return { kind, rotation: 0, x: Math.floor(BOARD_WIDTH / 2) - 2, y: 0 };
  }

  private cellsFor(piece: ActivePiece): Point[] {
    return getCells(piece.kind, piece.rotation).map((cell) => ({ x: piece.x + cell.x, y: piece.y + cell.y }));
  }

  private collides(piece: ActivePiece = this.active) {
    return this.cellsFor(piece).some(
      ({ x, y }) => x < 0 || x >= BOARD_WIDTH || y >= BOARD_HEIGHT || (y >= 0 && this.board[y][x])
    );
  }

  private isResting() {
    return this.collides({ ...this.active, y: this.active.y + 1 });
  }

  private stepDown() {
    const candidate = { ...this.active, y: this.active.y + 1 };
    if (!this.collides(candidate)) {
      this.active = candidate;
      return true;
    }
    return false;
  }

  private lockPiece() {
    for (const { x, y } of this.cellsFor(this.active)) {
      if (y >= 0 && y < BOARD_HEIGHT) this.board[y][x] = this.active.kind;
    }
    this.emitEvent({ type: "lock" });

    const clearedRows: number[] = [];
    this.board.forEach((row, index) => {
      if (row.every(Boolean)) clearedRows.push(index);
    });

    if (clearedRows.length > 0) {
      this.board = this.board.filter((_, index) => !clearedRows.includes(index));
      while (this.board.length < BOARD_HEIGHT) this.board.unshift(Array<CellValue>(BOARD_WIDTH).fill(null));
      this.lines += clearedRows.length;
      this.combo += 1;

      const special = clearedRows.length >= 3;
      let base = CLEAR_TABLE[clearedRows.length] ?? 900;
      if (special && this.backToBack) base = Math.round(base * 1.5);
      let gain = base * this.level;
      if (this.combo > 0) gain += 50 * this.combo * this.level;

      const perfectClear = this.board.every((row) => row.every((cell) => !cell));
      if (perfectClear) gain += 2000 * this.level;

      this.score += gain;
      this.backToBack = special;

      const previousLevel = this.level;
      this.level = Math.floor(this.lines / LINES_PER_PHASE) + 1;
      this.lastClearCount = clearedRows.length;

      this.emitEvent({
        type: "lineClear",
        rows: clearedRows,
        count: clearedRows.length,
        combo: this.combo,
        backToBack: this.backToBack,
        perfectClear,
      });

      // Checkpoint: alvo alcançado?
      if (this.checkpoint && this.lines - this.checkpoint.startLines >= this.checkpoint.target) {
        this.score += 1000 * this.level;
        this.checkpoint = null;
        this.emitEvent({ type: "checkpoint", ok: true });
      }

      if (this.level > previousLevel) {
        this.garbageTimer = 0;
        this.pulseTimer = 0;
        if (this.level % CHECKPOINT_EVERY === 0) {
          this.checkpoint = {
            startLines: this.lines,
            deadline: this.sessionElapsedMs + CHECKPOINT_WINDOW_MS,
            target: checkpointTarget(this.level),
          };
        }
        this.emitEvent({ type: "phase", level: this.level, modifier: modifierForPhase(this.level) });
      }
    } else {
      this.combo = -1;
    }

    this.active = this.spawnPiece(this.queue.shift() as PieceKind);
    this.refillQueue();
    this.holdLocked = false;
    this.lockTimer = 0;
    this.lockResets = 0;
    if (this.collides(this.active)) this.gameOver = true;
  }

  private emitEvent(event: Parameters<EventListener>[0]) {
    this.eventListeners.forEach((listener) => listener(event));
  }

  private emit() {
    const snapshot = this.snapshot;
    this.listeners.forEach((listener) => listener(snapshot));
  }
}
