// Conjunto de peças da Neon Blockfall: 6 formas de até 4 células + 1 pentamino
// (CREST). Grade 12×18, nomes/cores próprios — não é o conjunto do Tetris.
import type { PieceKind, Point } from "./types";

export const PIECE_KINDS: PieceKind[] = ["SPARK", "BEAM", "SLAB", "FORK", "COIL", "HOOK", "CREST"];

export const PIECE_COLORS: Record<PieceKind, { edge: string; fill: string; glow: string }> = {
  SPARK: { edge: "#ffd45a", fill: "#b3781d", glow: "#ffd66e" },
  BEAM: { edge: "#61f3ff", fill: "#168baf", glow: "#42ecff" },
  SLAB: { edge: "#c9a0ff", fill: "#6a3fb0", glow: "#b98cff" },
  FORK: { edge: "#9aff8a", fill: "#267c4c", glow: "#78ff97" },
  COIL: { edge: "#ff8fb2", fill: "#b03a5e", glow: "#ff5f8a" },
  HOOK: { edge: "#7fb0ff", fill: "#2f57a8", glow: "#6f9bff" },
  CREST: { edge: "#ff6fc4", fill: "#a52a7a", glow: "#ff2ea6" },
};

const SHAPES: Record<PieceKind, Point[][]> = {
  // Fragmento em L de 3 células.
  SPARK: [
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
    [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
    [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
  ],
  // Barra de 4 células.
  BEAM: [
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }],
    [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 0, y: 3 }],
  ],
  // Bloco 2x2.
  SLAB: [[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]],
  // "T": barra de 3 com um dente central.
  FORK: [
    [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
    [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }],
    [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }],
    [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }],
  ],
  // "S": escada de 4.
  COIL: [
    [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
    [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }],
  ],
  // "L": gancho de 4.
  HOOK: [
    [{ x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
    [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }],
    [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 0, y: 2 }],
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }],
  ],
  // Pentamino "P": bloco 2x2 com um dente — a peça especial.
  CREST: [
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 2 }],
    [{ x: 2, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 0 }],
    [{ x: 1, y: 2 }, { x: 0, y: 2 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 0 }],
    [{ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 2, y: 1 }],
  ],
};

/** Peças que não giram (bloco simétrico). */
export const NON_ROTATING: ReadonlySet<PieceKind> = new Set<PieceKind>(["SLAB"]);

export function rotationCount(kind: PieceKind) {
  return SHAPES[kind].length;
}

export function getCells(kind: PieceKind, rotation: number): Point[] {
  const rotations = SHAPES[kind];
  return rotations[((rotation % rotations.length) + rotations.length) % rotations.length];
}

export function getBounds(kind: PieceKind, rotation: number) {
  const cells = getCells(kind, rotation);
  return {
    width: Math.max(...cells.map((cell) => cell.x)) + 1,
    height: Math.max(...cells.map((cell) => cell.y)) + 1,
  };
}

export function createBag(random: () => number = Math.random): PieceKind[] {
  const bag = [...PIECE_KINDS];
  for (let index = bag.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [bag[index], bag[swapIndex]] = [bag[swapIndex], bag[index]];
  }
  return bag;
}
