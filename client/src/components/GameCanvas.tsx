import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CalendarClock,
  ChevronsDown,
  Infinity as InfinityIcon,
  Layers,
  Pause,
  Play,
  RotateCcw,
  Share2,
  Sparkles,
} from "lucide-react";
import { createGameRenderer, type GameHandle } from "@/game/renderer";
import { getCells, NON_ROTATING, PIECE_COLORS } from "@/game/pieces";
import { LINES_PER_PHASE, type GameSnapshot, type PieceKind, type SavedRun } from "@/game/types";
import { PHASE_MODIFIERS, type ModifierId } from "@/game/modifiers";
import {
  dailySeed,
  dailyShareText,
  loadDailyRecord,
  saveDailyRecord,
  todayKey,
  type DailyRecord,
} from "@/game/daily";
import {
  playBlocked,
  playCheckpoint,
  playCombo,
  playDanger,
  playGameOver,
  playGarbage,
  playHardDrop,
  playHold,
  playLineClear,
  playLock,
  playMove,
  playPerfect,
  playPhaseUp,
  playRotate,
} from "@/game/sfx";
import { setMusicIntensity } from "@/game/music";
import { vibrate } from "@/game/haptics";
import { getControlBindings, getPrimaryControlKey, type ControlAction } from "@/game/controls";
import { ARENA_SCENARIOS, getArenaScenario, type ArenaScenarioId } from "@/game/scenarios";
import { resolveTouchAction } from "@/game/touch-controls";

const RUN_KEY = "neon-blockfall-run";

function loadSavedRun(): SavedRun | null {
  try {
    const raw = window.localStorage.getItem(RUN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedRun;
    if (!Array.isArray(parsed.board) || !parsed.active || !Array.isArray(parsed.queue) || parsed.queue.length === 0) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function clearSavedRun() {
  try {
    window.localStorage.removeItem(RUN_KEY);
  } catch {
    /* armazenamento indisponível */
  }
}

const initialSnapshot: GameSnapshot = {
  board: Array.from({ length: 18 }, () => Array<PieceKind | null>(12).fill(null)),
  active: { kind: "FORK", rotation: 0, x: 4, y: 0 },
  next: "BEAM",
  nextQueue: ["BEAM", "SLAB", "HOOK"],
  hold: null,
  holdLocked: false,
  score: 0,
  lines: 0,
  level: 1,
  linesToNextPhase: LINES_PER_PHASE,
  combo: -1,
  backToBack: false,
  dropInterval: 720,
  lockProgress: 0,
  modifier: "none",
  pulseActive: false,
  checkpoint: null,
  paused: false,
  gameOver: false,
  lastClearCount: 0,
  tick: 0,
  sessionElapsedMs: 0,
};

type Action = "left" | "right" | "down" | "rotate" | "rotateBack" | "drop" | "hold" | "pause" | "restart";
type DasDir = "left" | "right" | "down";

type GameCanvasProps = {
  onGameOver?: (result: { score: number; lines: number; durationMs: number }) => void;
  onSnapshot?: (snapshot: GameSnapshot) => void;
  settingsOpen?: boolean;
  onPauseMenuRequest?: () => void;
  onScenarioSelect?: (scenarioId: ArenaScenarioId) => void;
  controlBindings?: Record<string, ControlAction>;
  listeningForControl?: boolean;
  scenarioId?: ArenaScenarioId;
};

function formatScore(value: number) {
  return value.toString().padStart(6, "0");
}

function formatBindingKey(key: string) {
  const labels: Record<string, string> = { " ": "ESPAÇO", arrowleft: "←", arrowright: "→", arrowup: "↑", arrowdown: "↓" };
  return labels[key] ?? key.toUpperCase();
}

function Preview({ kind, size = "md" }: { kind: PieceKind | null; size?: "sm" | "md" }) {
  const cells = kind ? getCells(kind, 0) : [];
  const color = kind ? PIECE_COLORS[kind] : null;
  return (
    <div className={size === "sm" ? "preview-grid is-sm" : "preview-grid"} aria-label={kind ? `Peça ${kind}` : "Espaço vazio"}>
      {Array.from({ length: 16 }, (_, index) => {
        const x = index % 4;
        const y = Math.floor(index / 4);
        const filled = cells.some((cell) => cell.x === x && cell.y === y);
        return (
          <span
            key={`${x}-${y}`}
            className={filled ? "preview-cell is-filled" : "preview-cell"}
            style={
              filled && color
                ? { background: color.fill, borderColor: color.edge, boxShadow: `0 0 12px ${color.glow}` }
                : undefined
            }
          />
        );
      })}
    </div>
  );
}

function ControlButton({
  label,
  caption,
  action,
  children,
  onAction,
}: {
  label: string;
  caption: string;
  action: Action;
  children: React.ReactNode;
  onAction: (action: Action) => void;
}) {
  const holdRepeats = action === "left" || action === "right" || action === "down";
  const timers = useRef<{ delay?: number; repeat?: number }>({});
  const pressed = useRef(false);
  const startedAt = useRef(0);

  // `stop` num ref para os listeners globais sempre chamarem a versão atual.
  const stopRef = useRef(() => {});
  stopRef.current = () => {
    pressed.current = false;
    if (timers.current.delay) window.clearTimeout(timers.current.delay);
    if (timers.current.repeat) window.clearInterval(timers.current.repeat);
    timers.current = {};
  };
  const stop = () => stopRef.current();

  // Rede de segurança tripla: o Safari do iOS às vezes engole o pointerup do
  // botão (toque virou seleção de texto / gesto), e o auto-repeat ficava preso
  // fazendo a peça despencar sozinha. Qualquer sinal de "soltou" mata o repeat.
  useEffect(() => {
    const kill = () => stopRef.current();
    const evs = ["pointerup", "pointercancel", "touchend", "touchcancel", "blur"] as const;
    evs.forEach((e) => window.addEventListener(e, kill, true));
    document.addEventListener("visibilitychange", kill);
    return () => {
      stopRef.current();
      evs.forEach((e) => window.removeEventListener(e, kill, true));
      document.removeEventListener("visibilitychange", kill);
    };
  }, []);

  const start = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* navegador sem suporte */
    }
    onAction(action);
    if (!holdRepeats) return;
    stopRef.current();
    pressed.current = true;
    startedAt.current = Date.now();
    timers.current.delay = window.setTimeout(() => {
      timers.current.repeat = window.setInterval(() => {
        // guarda-costas: para se o "soltou" foi perdido OU se passou tempo demais.
        if (!pressed.current || Date.now() - startedAt.current > 2600) {
          stopRef.current();
          return;
        }
        onAction(action);
      }, action === "down" ? 45 : 32);
    }, 130);
  };

  return (
    <button
      type="button"
      className="control-button"
      aria-label={label}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onContextMenu={(event) => event.preventDefault()}
    >
      {children}
      <span className="control-caption">{caption}</span>
    </button>
  );
}

export default function GameCanvas({
  onGameOver,
  onSnapshot,
  settingsOpen = false,
  onPauseMenuRequest,
  onScenarioSelect,
  controlBindings,
  listeningForControl = false,
  scenarioId = "megacity",
}: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const touchLayerRef = useRef<HTMLDivElement>(null);
  const onGameOverRef = useRef(onGameOver);
  const onSnapshotRef = useRef(onSnapshot);
  const gameOverNotifiedRef = useRef(false);
  const runStartedAtRef = useRef(Date.now());
  onGameOverRef.current = onGameOver;
  onSnapshotRef.current = onSnapshot;
  const startedRef = useRef(false);
  const gameRef = useRef<GameHandle | null>(null);
  const isDebug = useRef(
    typeof window !== "undefined" && new URLSearchParams(window.location.search).has("debug")
  ).current;
  const dbgRef = useRef({ t: 0, score: 0, y: 0 });
  const [dbg, setDbg] = useState({ ptsPerSec: 0, stepsPerSec: 0 });
  const [hasSavedRun] = useState(() => loadSavedRun() != null);
  const [snapshot, setSnapshot] = useState<GameSnapshot>(initialSnapshot);
  const [preStartOpen, setPreStartOpen] = useState(!hasSavedRun);
  const [launching, setLaunching] = useState(false);
  const [justResumed, setJustResumed] = useState(hasSavedRun);
  const preStartRef = useRef(!hasSavedRun);
  const launchTimerRef = useRef<number | undefined>(undefined);
  const [gestureFeedback, setGestureFeedback] = useState<{ label: string; id: number } | null>(null);
  const gestureTimerRef = useRef<number | undefined>(undefined);
  const [highScore, setHighScore] = useState(() => Number(window.localStorage.getItem("neon-blockfall-high-score") ?? 0));
  const [isNewRecord, setIsNewRecord] = useState(false);
  const [resetArmed, setResetArmed] = useState(false);
  const resetTimerRef = useRef<number | undefined>(undefined);
  const [burst, setBurst] = useState<{ count: number; combo: number; perfect: boolean; id: number } | null>(null);
  const [dailyMode, setDailyMode] = useState(false);
  const dailyModeRef = useRef(false);
  dailyModeRef.current = dailyMode;
  const [dailyBest, setDailyBest] = useState<DailyRecord | null>(() => loadDailyRecord());
  const [dailyResult, setDailyResult] = useState<{ record: DailyRecord; best: DailyRecord; improved: boolean } | null>(null);
  const [dailyShared, setDailyShared] = useState(false);
  const [phaseTransition, setPhaseTransition] = useState<{ level: number; modifier: ModifierId } | null>(null);
  const phasePauseRef = useRef(false);
  const phaseTimerRef = useRef<number | undefined>(undefined);
  const pausedBySettingsRef = useRef(false);
  const settingsOpenRef = useRef(settingsOpen);
  const listeningForControlRef = useRef(listeningForControl);
  const visibleBindings = controlBindings ?? getControlBindings();
  settingsOpenRef.current = settingsOpen;
  listeningForControlRef.current = listeningForControl;

  useEffect(() => {
    const world = gameRef.current?.world;
    if (!world) return;
    if (settingsOpen) {
      if (!world.snapshot.paused && !world.snapshot.gameOver) {
        world.setPaused(true);
        pausedBySettingsRef.current = true;
      }
      return;
    }
    if (pausedBySettingsRef.current && !preStartRef.current) {
      world.setPaused(false);
      pausedBySettingsRef.current = false;
    }
  }, [settingsOpen]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || startedRef.current) return;
    startedRef.current = true;
    let burstTimer: number | undefined;
    const controlBindingsRef = { current: getControlBindings() };
    const savedRun = loadSavedRun();

    // Trilha reativa + alerta de topo: sobe a intensidade da música com a fase
    // e a altura da pilha; dispara o "bipe de perigo" quando o topo é atingido.
    let lastIntensityAt = 0;
    const updateReactiveAudio = (s: GameSnapshot) => {
      if (s.paused || s.gameOver) {
        setMusicIntensity(0);
        return;
      }
      let topFilled = s.board.length;
      for (let y = 0; y < s.board.length; y += 1) {
        if (s.board[y].some(Boolean)) {
          topFilled = y;
          break;
        }
      }
      const stackRatio = 1 - topFilled / s.board.length;
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (now - lastIntensityAt > 400) {
        lastIntensityAt = now;
        const levelPart = Math.min(0.5, (s.level - 1) * 0.05);
        setMusicIntensity(Math.min(1, levelPart + stackRatio * 0.7));
      }
      if (topFilled <= 3) playDanger();
    };

    const handle = createGameRenderer(
      canvas,
      {
        onSnapshot: (nextSnapshot) => {
          setSnapshot(nextSnapshot);
          onSnapshotRef.current?.(nextSnapshot);
          updateReactiveAudio(nextSnapshot);
          if (isDebug) {
            const d = dbgRef.current;
            const now = typeof performance !== "undefined" ? performance.now() : Date.now();
            if (now - d.t >= 500) {
              if (d.t > 0) {
                const dt = (now - d.t) / 1000;
                setDbg({
                  ptsPerSec: Math.round((nextSnapshot.score - d.score) / dt),
                  stepsPerSec: Math.round((nextSnapshot.active.y - d.y) / dt),
                });
              }
              d.t = now;
              d.score = nextSnapshot.score;
              d.y = nextSnapshot.active.y;
            }
          }
          if (nextSnapshot.gameOver && !gameOverNotifiedRef.current) {
            gameOverNotifiedRef.current = true;
            clearSavedRun();
            playGameOver();
            vibrate("gameOver");
            if (dailyModeRef.current) {
              const record: DailyRecord = {
                score: nextSnapshot.score,
                lines: nextSnapshot.lines,
                level: nextSnapshot.level,
              };
              const previous = loadDailyRecord();
              const best = saveDailyRecord(record);
              setDailyBest(best);
              setDailyResult({ record, best, improved: !previous || record.score > previous.score });
              setDailyShared(false);
            }
            onGameOverRef.current?.({
              score: nextSnapshot.score,
              lines: nextSnapshot.lines,
              durationMs: Date.now() - runStartedAtRef.current,
            });
          } else if (!nextSnapshot.gameOver) {
            gameOverNotifiedRef.current = false;
          }
          setHighScore((current) => {
            if (nextSnapshot.score <= current) return current;
            window.localStorage.setItem("neon-blockfall-high-score", String(nextSnapshot.score));
            setIsNewRecord(true);
            return nextSnapshot.score;
          });
        },
        onEvent: (event) => {
          if (event.type === "lock") {
            playLock();
            vibrate("light");
            return;
          }
          if (event.type === "hold") {
            playHold();
            vibrate("light");
            return;
          }
          if (event.type === "phase") {
            playPhaseUp();
            vibrate("phase");
            startPhaseTransition(event.level, event.modifier);
            return;
          }
          if (event.type === "garbage") {
            playGarbage();
            vibrate("medium");
            setGestureFeedback({ label: "SOBRECARGA", id: Date.now() });
            if (gestureTimerRef.current) window.clearTimeout(gestureTimerRef.current);
            gestureTimerRef.current = window.setTimeout(() => setGestureFeedback(null), 700);
            return;
          }
          if (event.type === "checkpoint") {
            playCheckpoint(event.ok);
            vibrate(event.ok ? "phase" : "medium");
            setGestureFeedback({ label: event.ok ? "CHECKPOINT OK · +BÔNUS" : "CHECKPOINT FALHOU", id: Date.now() });
            if (gestureTimerRef.current) window.clearTimeout(gestureTimerRef.current);
            gestureTimerRef.current = window.setTimeout(() => setGestureFeedback(null), 1100);
            return;
          }
          if (event.type !== "lineClear") return;
          playLineClear(event.count);
          if (event.perfectClear) playPerfect();
          if (event.combo > 0) playCombo(event.combo);
          vibrate(event.perfectClear || event.count >= 4 ? "phase" : "clear");
          setBurst({ count: event.count, combo: event.combo, perfect: event.perfectClear, id: Date.now() });
          if (burstTimer) window.clearTimeout(burstTimer);
          burstTimer = window.setTimeout(() => setBurst(null), 1200);
        },
      },
      { savedRun }
    );

    gameRef.current = handle;
    if (!handle.world.snapshot.gameOver && (settingsOpenRef.current || preStartRef.current || savedRun)) {
      handle.world.setPaused(true);
      pausedBySettingsRef.current = settingsOpenRef.current;
    }

    const onControlsChanged = () => {
      controlBindingsRef.current = getControlBindings();
    };

    // --- DAS / ARR (auto-shift) ---
    const das: { dir: DasDir | null; delay: number | undefined; repeat: number | undefined } = {
      dir: null,
      delay: undefined,
      repeat: undefined,
    };
    const stopDas = (dir?: DasDir) => {
      if (dir && das.dir !== dir) return;
      if (das.delay) window.clearTimeout(das.delay);
      if (das.repeat) window.clearInterval(das.repeat);
      das.delay = undefined;
      das.repeat = undefined;
      das.dir = null;
    };
    const startDas = (dir: DasDir) => {
      stopDas();
      das.dir = dir;
      das.delay = window.setTimeout(() => {
        das.repeat = window.setInterval(
          () => {
            const world = gameRef.current?.world;
            if (world && !world.snapshot.paused && !world.snapshot.gameOver) runAction(world, dir);
          },
          dir === "down" ? 45 : 30
        );
      }, 130);
    };

    // --- touch (camada dedicada sobre a arena, senão a UI intercepta) ---
    const touchLayer = touchLayerRef.current;
    let touchStart: { x: number; y: number; pointerId: number } | null = null;
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse") return;
      touchStart = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
      touchLayer?.setPointerCapture?.(event.pointerId);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!touchStart || event.pointerId !== touchStart.pointerId) return;
      const action = resolveTouchAction(touchStart.x, touchStart.y, event.clientX, event.clientY);
      touchStart = null;
      const world = gameRef.current?.world;
      if (!world || preStartRef.current || world.snapshot.paused || world.snapshot.gameOver || !action) return;
      runAction(world, action);
      // Sons de movimento/rotação/encaixe são disparados por runAction e pelos eventos.
      const label =
        action === "rotate"
          ? "ROTAÇÃO"
          : action === "drop"
            ? "ENCAIXE INSTANTÂNEO"
            : action === "hold"
              ? "PEÇA RESERVADA"
              : `MOVIMENTO ${action === "left" ? "←" : "→"}`;
      setGestureFeedback({ label, id: Date.now() });
      if (gestureTimerRef.current) window.clearTimeout(gestureTimerRef.current);
      gestureTimerRef.current = window.setTimeout(() => setGestureFeedback(null), 520);
    };
    const onPointerCancel = () => {
      touchStart = null;
    };
    touchLayer?.addEventListener("pointerdown", onPointerDown);
    touchLayer?.addEventListener("pointerup", onPointerUp);
    touchLayer?.addEventListener("pointercancel", onPointerCancel);

    // --- keyboard ---
    const onKeyDown = (event: KeyboardEvent) => {
      if (listeningForControlRef.current || settingsOpenRef.current) return;
      const world = gameRef.current?.world;
      if (!world) return;
      const key = event.key === " " ? " " : event.key.toLowerCase();
      const action = controlBindingsRef.current[key] as Action | undefined;
      if (!action) return;
      event.preventDefault();
      if (event.repeat) return;
      runAction(world, action);
      if (action === "left" || action === "right" || action === "down") startDas(action);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key === " " ? " " : event.key.toLowerCase();
      const action = controlBindingsRef.current[key] as Action | undefined;
      if (action === "left" || action === "right" || action === "down") stopDas(action);
    };
    const onBlur = () => stopDas();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("neon-blockfall-controls-reset", onControlsChanged);
    window.addEventListener("neon-blockfall-controls-changed", onControlsChanged);

    // --- run persistence ---
    const saveNow = () => {
      const world = gameRef.current?.world;
      if (!world) return;
      const s = world.snapshot;
      if (s.gameOver || preStartRef.current || dailyModeRef.current) return;
      try {
        window.localStorage.setItem(RUN_KEY, JSON.stringify(world.serialize()));
      } catch {
        /* armazenamento indisponível */
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") saveNow();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", saveNow);
    const saveInterval = window.setInterval(saveNow, 5000);

    return () => {
      stopDas();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      touchLayer?.removeEventListener("pointerdown", onPointerDown);
      touchLayer?.removeEventListener("pointerup", onPointerUp);
      touchLayer?.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("neon-blockfall-controls-reset", onControlsChanged);
      window.removeEventListener("neon-blockfall-controls-changed", onControlsChanged);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", saveNow);
      window.clearInterval(saveInterval);
      if (burstTimer) window.clearTimeout(burstTimer);
      if (gestureTimerRef.current) window.clearTimeout(gestureTimerRef.current);
      if (launchTimerRef.current) window.clearTimeout(launchTimerRef.current);
      if (phaseTimerRef.current !== undefined) window.clearTimeout(phaseTimerRef.current);
      gameRef.current?.dispose();
      gameRef.current = null;
      startedRef.current = false;
    };
  }, []);

  const endPhaseTransition = () => {
    if (phaseTimerRef.current !== undefined) {
      window.clearTimeout(phaseTimerRef.current);
      phaseTimerRef.current = undefined;
    }
    setPhaseTransition(null);
    if (phasePauseRef.current && !settingsOpenRef.current && !preStartRef.current) {
      gameRef.current?.world.setPaused(false);
    }
    phasePauseRef.current = false;
  };

  const startPhaseTransition = (level: number, modifier: ModifierId) => {
    const world = gameRef.current?.world;
    if (world && !world.snapshot.paused) {
      world.setPaused(true);
      phasePauseRef.current = true;
    }
    setPhaseTransition({ level, modifier });
    if (phaseTimerRef.current !== undefined) window.clearTimeout(phaseTimerRef.current);
    phaseTimerRef.current = window.setTimeout(endPhaseTransition, 1400);
  };

  const startRun = () => {
    if (launching) return;
    setLaunching(true);
    launchTimerRef.current = window.setTimeout(() => {
      preStartRef.current = false;
      setPreStartOpen(false);
      setLaunching(false);
      setDailyResult(null);
      setIsNewRecord(false);
      runStartedAtRef.current = Date.now();
      const world = gameRef.current?.world;
      if (world) {
        if (dailyMode) {
          world.reseed(dailySeed());
          clearSavedRun();
        }
        if (!settingsOpenRef.current) world.setPaused(false);
      }
    }, 560);
  };

  const onAction = (action: Action) => {
    if (action === "restart") {
      clearSavedRun();
      setIsNewRecord(false);
      setPreStartOpen(false);
      setJustResumed(false);
      setDailyResult(null);
      setDailyShared(false);
      preStartRef.current = false;
      runStartedAtRef.current = Date.now();
    }
    if (action === "pause") setJustResumed(false);
    if (gameRef.current) runAction(gameRef.current.world, action);
  };

  // Sai do Desafio do Dia e volta ao modo livre sem recarregar a página.
  const exitDaily = () => {
    setDailyMode(false);
    dailyModeRef.current = false;
    setDailyResult(null);
    setDailyShared(false);
    setIsNewRecord(false);
    runStartedAtRef.current = Date.now();
    gameRef.current?.world.reseed(undefined);
  };

  const handleShareDaily = async () => {
    if (!dailyResult) return;
    const text = dailyShareText(todayKey(), dailyResult.record);
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setDailyShared(true);
    } catch {
      /* compartilhamento cancelado pelo usuário */
    }
  };

  const pauseIntoSettings = () => {
    const world = gameRef.current?.world;
    if (!world || world.snapshot.gameOver) return;
    world.setPaused(true);
    pausedBySettingsRef.current = true;
    onPauseMenuRequest?.();
  };

  // Reiniciar exige toque duplo (evita reset acidental durante a partida).
  const handleResetTap = () => {
    if (resetTimerRef.current !== undefined) window.clearTimeout(resetTimerRef.current);
    if (resetArmed) {
      setResetArmed(false);
      onAction("restart");
      return;
    }
    setResetArmed(true);
    setGestureFeedback({ label: "TOQUE DE NOVO PARA REINICIAR", id: Date.now() });
    if (gestureTimerRef.current) window.clearTimeout(gestureTimerRef.current);
    gestureTimerRef.current = window.setTimeout(() => setGestureFeedback(null), 2500);
    resetTimerRef.current = window.setTimeout(() => setResetArmed(false), 2500);
  };

  useEffect(
    () => () => {
      if (resetTimerRef.current !== undefined) window.clearTimeout(resetTimerRef.current);
    },
    []
  );

  const phaseFill = Math.round(((LINES_PER_PHASE - snapshot.linesToNextPhase) / LINES_PER_PHASE) * 100);

  return (
    <div
      className={`${snapshot.paused || snapshot.gameOver ? "game-shell is-paused" : "game-shell"}${
        preStartOpen || launching ? " is-prestart" : ""
      }${launching ? " is-launching" : ""} scenario-${scenarioId}`}
      data-scenario={scenarioId}
    >
      <div className="scenario-backdrop" aria-hidden="true" style={{ background: getArenaScenario(scenarioId).background }} />
      <canvas ref={canvasRef} className="game-canvas" style={{ touchAction: "none" }} />
      <div className="game-ui">
        <header className="topbar">
          <div className="brand-lockup">
            <div className="brand-mark-wrap">
              <img src="/icon.svg" alt="" className="brand-mark" width={28} height={28} />
            </div>
            <div>
              <p className="eyebrow">SISTEMA ARCADE / 07</p>
              <h1>
                NEON <span>BLOCKFALL</span>
              </h1>
            </div>
          </div>
          <div className="topbar-readout">
            <button
              type="button"
              className="topbar-pause"
              onClick={snapshot.paused ? () => onAction("pause") : pauseIntoSettings}
              aria-label={snapshot.paused ? "Retomar partida" : "Pausar partida e abrir configurações"}
            >
              {snapshot.paused ? <Play size={12} /> : <Pause size={12} />}
              {snapshot.paused ? "RETOMAR" : "PAUSAR"}
            </button>
            {snapshot.combo > 0 && <span className="combo-chip">COMBO ×{snapshot.combo}</span>}
            {snapshot.modifier !== "none" && (
              <span className="modifier-chip" style={{ "--mod-accent": PHASE_MODIFIERS[snapshot.modifier].accent } as React.CSSProperties}>
                {PHASE_MODIFIERS[snapshot.modifier].label}
              </span>
            )}
            <span className="status-dot" /> FASE <strong>{snapshot.level.toString().padStart(2, "0")}</strong>
            <span className="topbar-lines">
              LINHAS <strong>{snapshot.lines.toString().padStart(3, "0")}</strong>
            </span>
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className="topbar-icon-btn"
              onClick={snapshot.paused ? () => onAction("pause") : pauseIntoSettings}
              aria-label={snapshot.paused ? "Retomar" : "Pausar"}
            >
              {snapshot.paused ? <Play size={16} /> : <Pause size={16} />}
            </button>
            <button
              type="button"
              className={resetArmed ? "topbar-icon-btn is-armed" : "topbar-icon-btn"}
              onClick={handleResetTap}
              aria-label={resetArmed ? "Toque de novo para reiniciar" : "Reiniciar partida"}
            >
              <RotateCcw size={16} />
            </button>
          </div>
        </header>

        <main className="game-stage">
          <section className="arena-column" aria-label="Arena de jogo">
            <div className="arena-caption">
              <span>
                {snapshot.modifier === "none"
                  ? "GRADE / 12 × 18"
                  : `MOD · ${PHASE_MODIFIERS[snapshot.modifier].label}`}
              </span>
              <span className="caption-line" />
              <span>
                FASE {snapshot.level.toString().padStart(2, "0")} · {Math.round(1000 / snapshot.dropInterval)} QUEDAS/s
              </span>
            </div>
            <div className="arena-viewport">
              <div ref={touchLayerRef} className="touch-layer" aria-hidden="true" />
              {snapshot.checkpoint && (
                <div className={snapshot.checkpoint.secondsLeft <= 5 ? "checkpoint-strip is-urgent" : "checkpoint-strip"}>
                  <span>CHECKPOINT</span>
                  <strong>
                    {snapshot.checkpoint.linesLeft} {snapshot.checkpoint.linesLeft === 1 ? "LINHA" : "LINHAS"}
                  </strong>
                  <b>{snapshot.checkpoint.secondsLeft}s</b>
                </div>
              )}
              {burst && (
                <div className={burst.perfect ? "line-burst is-perfect" : "line-burst"} key={burst.id}>
                  <span className="burst-ring ring-one" />
                  <span className="burst-ring ring-two" />
                  <strong>
                    {burst.count} {burst.count === 1 ? "LINHA" : "LINHAS"}
                  </strong>
                  <small>
                    {burst.perfect
                      ? "PERFEITO · CIRCUITO ZERADO"
                      : burst.combo > 0
                        ? `COMBO ×${burst.combo}`
                        : "CIRCUITO LIMPO"}
                  </small>
                </div>
              )}
              {gestureFeedback && (
                <div className="gesture-feedback" key={gestureFeedback.id} role="status" aria-live="polite">
                  <Sparkles size={14} /> {gestureFeedback.label}
                </div>
              )}
            </div>
            <div className="arena-footer">
              <span>
                <i className="legend-dot dot-cyan" />
                PEÇA ATIVA
              </span>
              <span>
                <i className="legend-dot dot-magenta" />
                LINHA LIMPA
              </span>
              <span className="footer-hint">ESPAÇO / ENCAIXE</span>
              <span className="touch-hint">TOQUE GIRA · DESLIZE ←→ MOVE · ↓ ENCAIXA · ↑ RESERVA</span>
            </div>
          </section>

          <aside className="hud-rail" aria-label="Status da partida">
            <section className="hud-card score-card">
              <div className="card-label">
                <span>01 / PONTOS</span>
                <span>PTS</span>
              </div>
              <div className="score-value">{formatScore(snapshot.score)}</div>
              <div className="score-rule" />
              <div className="record-row">
                <span>RECORDE</span>
                <strong>{formatScore(highScore)}</strong>
              </div>
              {isNewRecord && <div className="record-badge">NOVO RECORDE</div>}
            </section>

            <section className="hud-card queue-card">
              <div className="card-label">
                <span>02 / FILA</span>
                <span>RESERVA · PRÓXIMAS</span>
              </div>
              <div className="queue-grid">
                <button
                  type="button"
                  className={snapshot.holdLocked ? "queue-hold is-locked" : "queue-hold"}
                  onClick={() => onAction("hold")}
                  aria-label="Guardar a peça atual na reserva"
                >
                  <small>RESERVA</small>
                  <Preview kind={snapshot.hold} size="sm" />
                  {!snapshot.hold && <span className="queue-hold-hint">toque para guardar</span>}
                </button>
                <div className="queue-next-wrap">
                  <small className="queue-slot-label">PRÓXIMAS</small>
                  <div className="queue-next">
                    {snapshot.nextQueue.map((kind, index) => (
                      <Preview key={`${kind}-${index}`} kind={kind} size="sm" />
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="hud-card metrics-card">
              <div className="metric-row">
                <span>FASE</span>
                <strong>{snapshot.level.toString().padStart(2, "0")}</strong>
              </div>
              <div className="metric-row">
                <span>LINHAS</span>
                <strong>{snapshot.lines.toString().padStart(3, "0")}</strong>
              </div>
              <div className="phase-progress" aria-label={`${snapshot.linesToNextPhase} linhas para a próxima fase`}>
                <span style={{ width: `${Math.max(4, phaseFill)}%` }} />
              </div>
              <small className="phase-progress-label">
                PRÓXIMA FASE EM <b>{snapshot.linesToNextPhase}</b> {snapshot.linesToNextPhase === 1 ? "LINHA" : "LINHAS"}
              </small>
            </section>

            <section className="hud-card command-card">
              <div className="card-label">
                <span>03 / COMANDOS</span>
                <span>TECLAS</span>
              </div>
              <div className="key-guide">
                <span>
                  <b>{formatBindingKey(getPrimaryControlKey("left", visibleBindings))}</b>
                  <b>{formatBindingKey(getPrimaryControlKey("right", visibleBindings))}</b> MOVER
                </span>
                <span>
                  <b>{formatBindingKey(getPrimaryControlKey("rotate", visibleBindings))}</b> GIRAR
                </span>
                <span>
                  <b>{formatBindingKey(getPrimaryControlKey("drop", visibleBindings))}</b> ENCAIXE
                </span>
                <span>
                  <b>{formatBindingKey(getPrimaryControlKey("hold", visibleBindings))}</b> RESERVA
                </span>
              </div>
            </section>

            <div className="rail-actions">
              <button
                type="button"
                className="action-button primary"
                onClick={snapshot.paused ? () => onAction("pause") : pauseIntoSettings}
              >
                {snapshot.paused ? <Play size={16} /> : <Pause size={16} />}
                {snapshot.paused ? "RETOMAR" : "PAUSAR"}
              </button>
              <button
                type="button"
                className={resetArmed ? "icon-action is-armed" : "icon-action"}
                aria-label={resetArmed ? "Toque de novo para reiniciar" : "Reiniciar partida"}
                onClick={handleResetTap}
              >
                <RotateCcw size={18} />
              </button>
            </div>
          </aside>
        </main>

        <footer className="control-deck">
          <div className="control-group">
            <span className="deck-label">CONTROLE TÁTIL</span>
            <div className="control-row">
              <ControlButton label="Mover para esquerda" caption="ESQ." action="left" onAction={onAction}>
                <ArrowLeft size={18} />
              </ControlButton>
              <ControlButton label="Acelerar queda" caption="DESCER" action="down" onAction={onAction}>
                <ArrowDown size={18} />
              </ControlButton>
              <ControlButton label="Mover para direita" caption="DIR." action="right" onAction={onAction}>
                <ArrowRight size={18} />
              </ControlButton>
              <ControlButton label="Girar peça" caption="GIRAR" action="rotate" onAction={onAction}>
                <ArrowUp size={18} />
              </ControlButton>
              <ControlButton label="Guardar peça na reserva" caption="RESERVA" action="hold" onAction={onAction}>
                <Layers size={18} />
              </ControlButton>
              <ControlButton label="Encaixe instantâneo" caption="ENCAIXE" action="drop" onAction={onAction}>
                <ChevronsDown size={18} />
              </ControlButton>
            </div>
          </div>
          <div className="deck-message">
            <Sparkles size={15} /> COMPLETE A LINHA. ACENDA O CIRCUITO.
          </div>
          <div className="version-label">x7rG ENTERPRISE™ · NB v1.2.0</div>
        </footer>
      </div>

      {phaseTransition && (
        <button
          type="button"
          className={`phase-transition mod-${phaseTransition.modifier}`}
          onClick={endPhaseTransition}
          aria-label="Continuar"
        >
          <span className="phase-transition-kicker">
            {phaseTransition.modifier === "none" ? "CIRCUITO ESTÁVEL" : `MOD · ${PHASE_MODIFIERS[phaseTransition.modifier].label}`}
          </span>
          <strong>FASE {phaseTransition.level.toString().padStart(2, "0")}</strong>
          <small>{PHASE_MODIFIERS[phaseTransition.modifier].rule}</small>
          <em>TOQUE PARA CONTINUAR</em>
        </button>
      )}

      {(preStartOpen || launching) && !settingsOpen && (
        <div className={launching ? "prestart-overlay is-launching" : "prestart-overlay"}>
          <span className="state-kicker">{launching ? "CONEXÃO / SINCRONIZANDO" : "AMBIENTE / PRONTO"}</span>
          <strong>{launching ? "INICIANDO PARTIDA" : "ESCOLHA SEU CENÁRIO"}</strong>
          <small>
            {launching
              ? "Sincronizando ambiente, ritmo e HUD."
              : "Defina o ambiente da run. A física permanece a mesma."}
          </small>
          {!launching && (
            <div className="prestart-modes" role="radiogroup" aria-label="Modo de jogo">
              <button
                type="button"
                role="radio"
                aria-checked={!dailyMode}
                className={!dailyMode ? "prestart-mode is-active" : "prestart-mode"}
                onClick={() => setDailyMode(false)}
              >
                <span className="prestart-mode-head">
                  <InfinityIcon size={14} /> PARTIDA LIVRE
                </span>
                <small>Sequência aleatória, sem fim.</small>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={dailyMode}
                className={dailyMode ? "prestart-mode is-active" : "prestart-mode"}
                onClick={() => setDailyMode(true)}
              >
                <span className="prestart-mode-head">
                  <CalendarClock size={14} /> DESAFIO DO DIA
                </span>
                <small>
                  {todayKey()} · mesma sequência para todos
                  {dailyBest ? ` · recorde ${dailyBest.score.toLocaleString("pt-BR")}` : ""}
                </small>
              </button>
            </div>
          )}
          {!launching && (
            <div className="prestart-scenarios">
              {ARENA_SCENARIOS.map((scenario) => (
                <button
                  type="button"
                  key={scenario.id}
                  className={scenarioId === scenario.id ? "prestart-scenario is-active" : "prestart-scenario"}
                  onClick={() => onScenarioSelect?.(scenario.id)}
                  style={{ "--scenario-accent": scenario.accent, background: scenario.background } as React.CSSProperties}
                >
                  <span>{scenario.label}</span>
                  {scenarioId === scenario.id && <b>ATIVO</b>}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="action-button primary prestart-button"
            onClick={startRun}
            disabled={launching}
          >
            <Play size={16} /> <span>{launching ? "SINCRONIZANDO..." : "INICIAR PARTIDA"}</span>
          </button>
          <span className="prestart-credit">x7rG ENTERPRISE™</span>
        </div>
      )}

      {(snapshot.paused || snapshot.gameOver) && !preStartOpen && !settingsOpen && !phaseTransition && (
        <div className="state-overlay">
          <span className="state-kicker">
            {snapshot.gameOver
              ? dailyMode
                ? "DESAFIO DO DIA · ENCERRADO"
                : "SINAL ENCERRADO"
              : justResumed
                ? "PARTIDA RETOMADA"
                : "SISTEMA EM PAUSA"}
          </span>
          <strong>{snapshot.gameOver ? "FIM DE JOGO" : justResumed ? "CONTINUAR?" : "EM PAUSA"}</strong>
          {snapshot.gameOver && dailyMode && dailyResult && (
            <div className="daily-result">
              <p>{todayKey()}</p>
              <strong>{dailyResult.record.score.toLocaleString("pt-BR")} PTS</strong>
              <small>
                {dailyResult.improved
                  ? "NOVO RECORDE DO DIA"
                  : `MELHOR HOJE · ${dailyResult.best.score.toLocaleString("pt-BR")} PTS`}
              </small>
              <button type="button" className="action-button daily-share" onClick={handleShareDaily}>
                <Share2 size={14} /> {dailyShared ? "COPIADO" : "COMPARTILHAR"}
              </button>
            </div>
          )}
          <button
            type="button"
            className="action-button"
            onClick={() => {
              setJustResumed(false);
              onAction(snapshot.gameOver ? "restart" : "pause");
            }}
          >
            {snapshot.gameOver ? (
              <>
                <RotateCcw size={16} /> {dailyMode ? "REPETIR DESAFIO" : "REINICIAR RUN"}
              </>
            ) : (
              <>
                <Play size={16} /> {justResumed ? "CONTINUAR" : "RETOMAR"}
              </>
            )}
          </button>
          {snapshot.gameOver && dailyMode && (
            <button type="button" className="state-ghost-button" onClick={exitDaily}>
              VOLTAR À PARTIDA LIVRE
            </button>
          )}
        </div>
      )}

      {isDebug && (
        <pre className="debug-hud" aria-hidden="true">
          {`drop ${snapshot.dropInterval}ms${snapshot.pulseActive ? " ·PULSE" : ""}
mod ${snapshot.modifier} · fase ${snapshot.level}
pts/s ${dbg.ptsPerSec} · steps/s ${dbg.stepsPerSec}
score ${snapshot.score} · y ${snapshot.active.y} · tick ${snapshot.tick}
paused ${String(snapshot.paused)} · over ${String(snapshot.gameOver)}`}
        </pre>
      )}
    </div>
  );
}

function runAction(world: GameHandle["world"], action: Action) {
  if ((world.snapshot.paused || world.snapshot.gameOver) && action !== "pause" && action !== "restart") return { collided: false };
  const before = world.snapshot.active;
  if (action === "left") world.move(-1);
  if (action === "right") world.move(1);
  if (action === "down") world.softDrop();
  if (action === "rotate") world.rotate(1);
  if (action === "rotateBack") world.rotate(-1);
  if (action === "drop") world.hardDrop();
  if (action === "hold") world.hold();
  if (action === "pause") world.togglePause();
  if (action === "restart") world.restart();
  const after = world.snapshot.active;

  if (action === "left" || action === "right") {
    if (before.x !== after.x) playMove();
    else playBlocked();
  } else if (action === "rotate" || action === "rotateBack") {
    if (before.rotation !== after.rotation || before.x !== after.x) playRotate();
    else if (!NON_ROTATING.has(before.kind)) playBlocked();
  } else if (action === "drop") {
    playHardDrop();
  }

  const isBlockedMovement =
    (action === "left" || action === "right") &&
    before.x === after.x &&
    before.y === after.y &&
    before.rotation === after.rotation;
  const isBlockedRotation =
    (action === "rotate" || action === "rotateBack") &&
    before.x === after.x &&
    before.y === after.y &&
    before.rotation === after.rotation &&
    !NON_ROTATING.has(before.kind);
  return { collided: !world.snapshot.paused && !world.snapshot.gameOver && (isBlockedMovement || isBlockedRotation) };
}
