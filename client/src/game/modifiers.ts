// Modificadores de fase: a partir da 3ª fase, fases pares recebem uma regra
// própria; as ímpares ficam calmas (respiro). Determinístico a partir do nível.
export type ModifierId = "none" | "overload" | "pulse" | "blackout";

export type PhaseModifier = {
  id: ModifierId;
  label: string;
  rule: string;
  accent: string;
};

export const PHASE_MODIFIERS: Record<ModifierId, PhaseModifier> = {
  none: { id: "none", label: "ESTÁVEL", rule: "Sem interferência no circuito.", accent: "#65f3ff" },
  overload: {
    id: "overload",
    label: "SOBRECARGA",
    rule: "Uma linha-lixo sobe pela base a cada 27 s.",
    accent: "#ff2ea6",
  },
  pulse: {
    id: "pulse",
    label: "PULSO",
    rule: "A gravidade acelera em rajadas curtas.",
    accent: "#f5b94c",
  },
  blackout: {
    id: "blackout",
    label: "BLACKOUT",
    rule: "As três linhas de baixo ficam no escuro.",
    accent: "#a78bfa",
  },
};

// Fase calma entre cada modificador — menos punitivo.
const CYCLE: ModifierId[] = ["none", "overload", "none", "pulse", "none", "blackout"];

export function modifierForPhase(level: number): ModifierId {
  if (level < 3) return "none";
  return CYCLE[(level - 3) % CYCLE.length];
}

export const GARBAGE_INTERVAL_MS = 27_000;
export const PULSE_CYCLE_MS = 12_000;
export const PULSE_ACTIVE_MS = 3_200;
export const PULSE_SPEEDUP = 0.55;
export const BLACKOUT_ROWS = 3;

/** Fases múltiplas de 5 abrem um checkpoint com meta de linhas por tempo. */
export const CHECKPOINT_EVERY = 5;
export const CHECKPOINT_WINDOW_MS = 34_000;

export function checkpointTarget(level: number) {
  return 2 + Math.floor(level / CHECKPOINT_EVERY);
}
