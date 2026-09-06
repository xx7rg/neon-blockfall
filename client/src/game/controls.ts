export type ControlAction =
  | "left"
  | "right"
  | "down"
  | "rotate"
  | "rotateBack"
  | "drop"
  | "hold"
  | "pause"
  | "restart";

export const DEFAULT_CONTROLS: Record<string, ControlAction> = {
  arrowleft: "left",
  a: "left",
  arrowright: "right",
  d: "right",
  arrowdown: "down",
  s: "down",
  arrowup: "rotate",
  x: "rotate",
  z: "rotateBack",
  " ": "drop",
  c: "hold",
  shift: "hold",
  p: "pause",
  r: "restart",
};

export const CONTROL_ACTIONS: Array<{
  action: ControlAction;
  label: string;
  description: string;
  defaultKey: string;
}> = [
  { action: "left", label: "MOVER À ESQUERDA", description: "Desloca a peça para a esquerda", defaultKey: "arrowleft" },
  { action: "right", label: "MOVER À DIREITA", description: "Desloca a peça para a direita", defaultKey: "arrowright" },
  { action: "down", label: "QUEDA SUAVE", description: "Acelera a descida sem pontuar", defaultKey: "arrowdown" },
  { action: "rotate", label: "GIRAR", description: "Gira a peça no sentido horário", defaultKey: "arrowup" },
  { action: "rotateBack", label: "GIRAR AO CONTRÁRIO", description: "Gira a peça no sentido anti-horário", defaultKey: "z" },
  { action: "drop", label: "QUEDA INSTANTÂNEA", description: "Encaixa a peça imediatamente", defaultKey: " " },
  { action: "hold", label: "RESERVAR PEÇA", description: "Guarda a peça atual e troca (uma vez por peça)", defaultKey: "c" },
  { action: "pause", label: "PAUSAR / RETOMAR", description: "Abre o sistema de pausa", defaultKey: "p" },
  { action: "restart", label: "REINICIAR RUN", description: "Começa uma nova partida", defaultKey: "r" },
];

const STORAGE_KEY = "neon-blockfall-controls";
const STORAGE_VERSION = 2;

type StoredControls = { version: number; bindings: Record<string, ControlAction> };

export function normalizeControlKey(key: string) {
  return key.toLowerCase() === "spacebar" ? " " : key.toLowerCase();
}

export function getControlBindings(): Record<string, ControlAction> {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as
      | StoredControls
      | Record<string, ControlAction>
      | null;
    if (!stored || typeof stored !== "object") return { ...DEFAULT_CONTROLS };
    if (
      "version" in stored &&
      stored.version === STORAGE_VERSION &&
      "bindings" in stored &&
      stored.bindings &&
      typeof stored.bindings === "object"
    )
      return { ...stored.bindings };
    const legacy = stored as Record<string, ControlAction>;
    return { ...DEFAULT_CONTROLS, ...legacy };
  } catch {
    return { ...DEFAULT_CONTROLS };
  }
}

export function getPrimaryControlKey(action: ControlAction, bindings = getControlBindings()) {
  const preferred = CONTROL_ACTIONS.find((item) => item.action === action)?.defaultKey;
  if (preferred && bindings[preferred] === action) return preferred;
  return Object.entries(bindings).find(([, value]) => value === action)?.[0] ?? preferred ?? "?";
}

export function findControlConflict(action: ControlAction, key: string, bindings = getControlBindings()) {
  const normalized = normalizeControlKey(key);
  const existingAction = bindings[normalized];
  return existingAction && existingAction !== action ? { key: normalized, existingAction } : null;
}

export function setControlBinding(action: ControlAction, key: string) {
  const normalized = normalizeControlKey(key);
  if (!normalized) return getControlBindings();
  const next = getControlBindings();
  const conflictedAction = next[normalized] && next[normalized] !== action ? next[normalized] : undefined;
  Object.entries(next).forEach(([boundKey, boundAction]) => {
    if (boundAction === action || boundKey === normalized) delete next[boundKey];
  });
  if (conflictedAction) {
    const fallback = Object.entries(DEFAULT_CONTROLS).find(
      ([boundKey, boundAction]) => boundAction === conflictedAction && boundKey !== normalized
    )?.[0];
    if (fallback) next[fallback] = conflictedAction;
  }
  next[normalized] = action;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: STORAGE_VERSION, bindings: next } satisfies StoredControls)
    );
  } catch {
    /* armazenamento indisponível */
  }
  return next;
}

export function resetControlBindings() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* armazenamento indisponível */
  }
}
