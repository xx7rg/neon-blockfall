export type ArenaScenarioId = "megacity" | "orbit" | "reactor" | "datacenter";

export type ArenaScenario = {
  id: ArenaScenarioId;
  label: string;
  detail: string;
  accent: string;
  /** CSS background value (gradients only — no external assets). */
  background: string;
};

export const ARENA_SCENARIOS: readonly ArenaScenario[] = [
  {
    id: "megacity",
    label: "MEGA CITY",
    detail: "CHUVA · HOLOGRAMAS",
    accent: "#65f3ff",
    background:
      "radial-gradient(120% 80% at 50% 0%, rgba(101,243,255,0.18), transparent 60%), linear-gradient(180deg, #050b18 0%, #071426 55%, #030711 100%)",
  },
  {
    id: "orbit",
    label: "ORBITAL RING",
    detail: "ÓRBITA · VÁCUO",
    accent: "#a78bfa",
    background:
      "radial-gradient(90% 70% at 70% 20%, rgba(167,139,250,0.22), transparent 55%), linear-gradient(180deg, #070516 0%, #0c0a24 50%, #04030d 100%)",
  },
  {
    id: "reactor",
    label: "QUANTUM CORE",
    detail: "REATOR · ENERGIA",
    accent: "#f5b94c",
    background:
      "radial-gradient(100% 75% at 50% 100%, rgba(245,185,76,0.2), transparent 60%), linear-gradient(180deg, #100a05 0%, #1c1206 50%, #070502 100%)",
  },
  {
    id: "datacenter",
    label: "DATA VAULT",
    detail: "SERVIDORES · SINAL",
    accent: "#ff2ea6",
    background:
      "radial-gradient(110% 80% at 30% 10%, rgba(255,46,166,0.18), transparent 55%), linear-gradient(180deg, #0a0512 0%, #170a1e 50%, #05020a 100%)",
  },
];

const STORAGE_KEY = "neon-blockfall-arena-scenario";

export function getArenaScenario(id: string | null | undefined): ArenaScenario {
  return ARENA_SCENARIOS.find((scenario) => scenario.id === id) ?? ARENA_SCENARIOS[0];
}

export function loadArenaScenario(): ArenaScenarioId {
  if (typeof window === "undefined") return ARENA_SCENARIOS[0].id;
  return getArenaScenario(window.localStorage.getItem(STORAGE_KEY)).id;
}

export function saveArenaScenario(id: string): ArenaScenarioId {
  const scenario = getArenaScenario(id);
  if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, scenario.id);
  return scenario.id;
}

export function getArenaScenarioBackground(id: string | null | undefined) {
  return getArenaScenario(id).background;
}

export function getArenaScenarioIds() {
  return ARENA_SCENARIOS.map((scenario) => scenario.id);
}
