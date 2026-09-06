import { describe, expect, it } from "vitest";
import { GameWorld } from "./game-world";
import { BOARD_HEIGHT, BOARD_WIDTH, LINES_PER_PHASE } from "./types";
import { getBounds, getCells, NON_ROTATING, PIECE_KINDS, rotationCount } from "./pieces";
import { checkpointTarget, GARBAGE_INTERVAL_MS, modifierForPhase } from "./modifiers";
import { dailySeed, todayKey } from "./daily";
import { mulberry32 } from "./rng";

const CLEAR_TABLE_SINGLE = 60;

type MutableWorld = {
  board: (string | null)[][];
  active: { kind: string; rotation: number; x: number; y: number };
  queue: string[];
  hold: string | null;
  lines: number;
  level: number;
  backToBack: boolean;
  garbageTimer: number;
  sessionElapsedMs: number;
};

/** Fills the bottom row except for a single-column gap so one BEAM clears it. */
function primeBottomRow(world: GameWorld, gapColumn: number) {
  const mutable = world as unknown as MutableWorld;
  mutable.board = Array.from({ length: BOARD_HEIGHT }, (_, y) =>
    Array.from({ length: BOARD_WIDTH }, (_unused, x) => (y === BOARD_HEIGHT - 1 && x !== gapColumn ? "BEAM" : null))
  );
  mutable.active = { kind: "BEAM", rotation: 1, x: gapColumn, y: 0 };
}

describe("board contract", () => {
  it("uses the 12x18 arena", () => {
    expect(BOARD_WIDTH).toBe(12);
    expect(BOARD_HEIGHT).toBe(18);
  });

  it("starts with an empty board, a valid piece and a 3-deep preview", () => {
    const world = new GameWorld(() => 0);
    const snap = world.snapshot;
    expect(snap.board).toHaveLength(BOARD_HEIGHT);
    expect(snap.board.flat().some(Boolean)).toBe(false);
    expect(PIECE_KINDS).toContain(snap.active.kind);
    expect(snap.nextQueue).toHaveLength(3);
    expect(snap.hold).toBeNull();
    expect(snap.linesToNextPhase).toBe(LINES_PER_PHASE);
  });
});

describe("piece set", () => {
  it("every piece fits inside a 4x4 preview and has 3-5 cells", () => {
    for (const kind of PIECE_KINDS) {
      for (let rotation = 0; rotation < rotationCount(kind); rotation += 1) {
        const cells = getCells(kind, rotation);
        expect(cells.length).toBeGreaterThanOrEqual(3);
        expect(cells.length).toBeLessThanOrEqual(5);
        const { width, height } = getBounds(kind, rotation);
        expect(width).toBeLessThanOrEqual(4);
        expect(height).toBeLessThanOrEqual(4);
      }
    }
  });

  it("keeps the cell count stable across rotations", () => {
    for (const kind of PIECE_KINDS) {
      const base = getCells(kind, 0).length;
      for (let rotation = 1; rotation < rotationCount(kind); rotation += 1) {
        expect(getCells(kind, rotation).length).toBe(base);
      }
    }
  });

  it("does not rotate symmetric blocks", () => {
    expect(NON_ROTATING.has("SLAB")).toBe(true);
    const world = new GameWorld(() => 0);
    (world as unknown as MutableWorld).active = { kind: "SLAB", rotation: 0, x: 4, y: 0 };
    world.rotate(1);
    expect(world.snapshot.active.rotation).toBe(0);
  });
});

describe("hold", () => {
  it("stashes the current piece and blocks a second hold until it locks", () => {
    const world = new GameWorld(() => 0);
    const first = world.snapshot.active.kind;
    world.hold();
    expect(world.snapshot.hold).toBe(first);
    expect(world.snapshot.holdLocked).toBe(true);
    const afterHold = world.snapshot.active.kind;
    world.hold(); // ignored while locked
    expect(world.snapshot.active.kind).toBe(afterHold);
  });

  it("swaps the held piece back in", () => {
    const world = new GameWorld(() => 0);
    const a = world.snapshot.active.kind;
    world.hold();
    world.hardDrop(); // locks -> unlocks hold
    const b = world.snapshot.active.kind;
    world.hold();
    expect(world.snapshot.active.kind).toBe(a);
    expect(world.snapshot.hold).toBe(b);
  });
});

describe("lock delay", () => {
  it("does not lock the instant a piece can no longer fall", () => {
    const world = new GameWorld(() => 0);
    const m = world as unknown as MutableWorld;
    m.board = Array.from({ length: BOARD_HEIGHT }, (_, y) =>
      Array.from({ length: BOARD_WIDTH }, () => (y === BOARD_HEIGHT - 1 ? "SLAB" : null))
    );
    m.active = { kind: "SLAB", rotation: 0, x: 4, y: BOARD_HEIGHT - 3 };
    world.update(16); // resting, but < 500ms
    expect(world.snapshot.gameOver).toBe(false);
    expect(world.snapshot.board[BOARD_HEIGHT - 2][4]).toBeNull();
    world.update(600); // past the lock delay
    expect(world.snapshot.board[BOARD_HEIGHT - 2][4]).toBe("SLAB");
  });
});

describe("scoring and phases", () => {
  it("hard drop awards travel points but no line bonus on an empty board", () => {
    const world = new GameWorld(() => 0);
    world.hardDrop();
    expect(world.snapshot.lines).toBe(0);
    expect(world.snapshot.score).toBeGreaterThan(0);
    expect(world.snapshot.score).toBeLessThan(CLEAR_TABLE_SINGLE);
  });

  it("clears a full row and awards at least the line bonus", () => {
    const world = new GameWorld(() => 0);
    primeBottomRow(world, 4);
    world.hardDrop();
    expect(world.snapshot.lines).toBe(1);
    expect(world.snapshot.score).toBeGreaterThanOrEqual(60);
  });

  it("gives a back-to-back bonus for consecutive 3+ line clears", () => {
    const world = new GameWorld(() => 0);
    (world as unknown as MutableWorld).backToBack = true;
    const m = world as unknown as MutableWorld;
    m.board = Array.from({ length: BOARD_HEIGHT }, (_, y) =>
      Array.from({ length: BOARD_WIDTH }, (_u, x) => (y >= BOARD_HEIGHT - 3 && x !== 4 ? "SLAB" : null))
    );
    m.active = { kind: "BEAM", rotation: 1, x: 4, y: 0 };
    world.hardDrop();
    expect(world.snapshot.lines).toBe(3);
    // base 320, x1.5 for b2b = 480, x level 1 => >= 480
    expect(world.snapshot.score).toBeGreaterThanOrEqual(480);
  });

  it("moves to phase 2 after eight cleared lines", () => {
    const world = new GameWorld(() => 0);
    (world as unknown as MutableWorld).lines = 7;
    primeBottomRow(world, 4);
    world.hardDrop();
    expect(world.snapshot.lines).toBe(8);
    expect(world.snapshot.level).toBe(2);
    expect(world.snapshot.linesToNextPhase).toBe(LINES_PER_PHASE);
  });

  it("speeds up the drop interval as phases increase", () => {
    const world = new GameWorld(() => 0);
    const phase1 = world.snapshot.dropInterval;
    (world as unknown as MutableWorld).level = 6;
    expect(world.snapshot.dropInterval).toBeLessThan(phase1);
    expect(world.snapshot.dropInterval).toBeGreaterThanOrEqual(100);
  });
});

describe("phase modifiers", () => {
  it("assigns a deterministic modifier per phase with a calm phase between each", () => {
    expect(modifierForPhase(1)).toBe("none");
    expect(modifierForPhase(2)).toBe("none");
    expect(modifierForPhase(3)).toBe("none");
    expect(modifierForPhase(4)).toBe("overload");
    expect(modifierForPhase(5)).toBe("none");
    expect(modifierForPhase(6)).toBe("pulse");
    expect(modifierForPhase(7)).toBe("none");
    expect(modifierForPhase(8)).toBe("blackout");
    expect(modifierForPhase(10)).toBe("overload");
  });

  it("OVERLOAD raises a garbage row from the base", () => {
    const world = new GameWorld(() => 0);
    const m = world as unknown as MutableWorld;
    m.level = 4;
    m.garbageTimer = GARBAGE_INTERVAL_MS - 5;
    world.update(10);
    const bottom = world.snapshot.board[BOARD_HEIGHT - 1];
    expect(world.snapshot.modifier).toBe("overload");
    expect(bottom.includes("GARBAGE")).toBe(true);
    expect(bottom.filter(Boolean).length).toBe(BOARD_WIDTH - 1);
  });

  it("PULSE shortens the drop interval during the burst window", () => {
    const world = new GameWorld(() => 0);
    const m = world as unknown as MutableWorld;
    m.level = 6;
    const calm = world.snapshot.dropInterval;
    m.garbageTimer = 0;
    // push pulseTimer near the end of the cycle where the burst is active
    (world as unknown as { pulseTimer: number }).pulseTimer = 11_000;
    expect(world.snapshot.pulseActive).toBe(true);
    expect(world.snapshot.dropInterval).toBeLessThan(calm);
  });
});

describe("checkpoints", () => {
  it("opens a checkpoint on reaching phase 5 and pays a bonus on completion", () => {
    const world = new GameWorld(() => 0);
    (world as unknown as MutableWorld).lines = 31;
    primeBottomRow(world, 4);
    world.hardDrop(); // lines 32 -> phase 5
    expect(world.snapshot.level).toBe(5);
    const cp = world.snapshot.checkpoint;
    expect(cp).not.toBeNull();
    expect(cp?.target).toBe(checkpointTarget(5));

    const before = world.snapshot.score;
    for (let i = 0; i < (cp?.target ?? 0); i += 1) {
      primeBottomRow(world, 4);
      world.hardDrop();
    }
    expect(world.snapshot.checkpoint).toBeNull();
    expect(world.snapshot.score).toBeGreaterThan(before + 1000);
  });
});

describe("daily challenge seed", () => {
  it("mulberry32 is deterministic for a given seed", () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = Array.from({ length: 8 }, () => a());
    const seqB = Array.from({ length: 8 }, () => b());
    expect(seqA).toEqual(seqB);
    expect(new Set(seqA).size).toBeGreaterThan(1);
    expect(Math.max(...seqA)).toBeLessThan(1);
    expect(Math.min(...seqA)).toBeGreaterThanOrEqual(0);
  });

  it("todayKey formats as YYYY-MM-DD and dailySeed is stable per key", () => {
    expect(todayKey(new Date(2026, 8, 6))).toBe("2026-09-06");
    expect(dailySeed("2026-09-06")).toBe(dailySeed("2026-09-06"));
    expect(dailySeed("2026-09-06")).not.toBe(dailySeed("2026-09-07"));
  });

  it("reseed makes two worlds play an identical opening sequence", () => {
    const seed = dailySeed("2026-09-06");
    const opening = (world: GameWorld) => {
      const kinds: string[] = [world.snapshot.active.kind];
      for (let i = 0; i < 10; i += 1) {
        world.hardDrop();
        kinds.push(world.snapshot.active.kind);
      }
      return kinds;
    };
    const fromCtor = opening(new GameWorld(Math.random, seed));
    const reseeded = new GameWorld(() => 0.5);
    reseeded.reseed(seed);
    expect(opening(reseeded)).toEqual(fromCtor);
  });
});

describe("save / restore", () => {
  it("round-trips an in-progress run", () => {
    const world = new GameWorld(() => 0.42);
    (world as unknown as MutableWorld).lines = 5;
    (world as unknown as MutableWorld).level = 2;
    world.hardDrop();
    const saved = world.serialize();
    const restored = GameWorld.fromSaved(saved, () => 0.42);
    const s = restored.snapshot;
    expect(s.lines).toBe(saved.lines);
    expect(s.level).toBe(saved.level);
    expect(s.score).toBe(saved.score);
    expect(s.active.kind).toBe(saved.active.kind);
  });
});
