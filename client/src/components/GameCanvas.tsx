import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CalendarClock,
  ChevronsDown,
  Flag,
  Infinity as InfinityIcon,
  Layers,
  Pause,
  Play,
  RotateCcw,
  Share2,
  Sparkles,
  Timer,
  Trophy,
} from "lucide-react";
import { createGameRenderer, type GameHandle } from "@/game/renderer";
import { adsEnabled, showRewardedForContinue } from "@/mobile/native";
import { useI18n, useT } from "@/i18n/context";
import { getCells, NON_ROTATING, PIECE_COLORS } from "@/game/pieces";
import { LINES_PER_PHASE, type GameSnapshot, type PieceKind, type SavedRun } from "@/game/types";
import { PHASE_MODIFIERS, type ModifierId } from "@/game/modifiers";
import {
  formatClock,
  loadModeRecords,
  recordSprint,
  recordUltra,
  SPRINT_LINES,
  ULTRA_MS,
  type ModeRecords,
  type RunMode,
} from "@/game/modes";
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
// "Continuar" pós-fim de jogo (estilo fliperama): quantas vezes por partida e
// quantos segundos o jogador tem para decidir antes de encerrar de vez.
const MAX_REVIVES = 1;
const REVIVE_COUNTDOWN_S = 6;
// Retomada é para recuperar de uma interrupção real (fechou a aba, trocou de app),
// não para transformar todo F5 na mesma partida. Passou disso, começa nova e aleatória.
const RESUME_MAX_AGE_MS = 30 * 60 * 1000;

function loadSavedRun(): SavedRun | null {
  try {
    const raw = window.localStorage.getItem(RUN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedRun;
    if (!Array.isArray(parsed.board) || !parsed.active || !Array.isArray(parsed.queue) || parsed.queue.length === 0) {
      return null;
    }
    if (typeof parsed.savedAt !== "number" || Date.now() - parsed.savedAt > RESUME_MAX_AGE_MS) {
      clearSavedRun();
      return null;
    }
    // Sem progresso real (F5 logo após iniciar) não vira retomada — começa nova e aleatória.
    const hasProgress = parsed.score > 0 || parsed.lines > 0 || parsed.sessionElapsedMs > 15000;
    if (!hasProgress) {
      clearSavedRun();
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
  onGameOver?: (result: { score: number; lines: number; level: number; durationMs: number }) => void;
  onSnapshot?: (snapshot: GameSnapshot) => void;
  settingsOpen?: boolean;
  onPauseMenuRequest?: () => void;
  onDockRequest?: () => void;
  onScenarioSelect?: (scenarioId: ArenaScenarioId) => void;
  controlBindings?: Record<string, ControlAction>;
  listeningForControl?: boolean;
  scenarioId?: ArenaScenarioId;
};

function formatScore(value: number) {
  return value.toString().padStart(6, "0");
}

function formatBindingKey(key: string) {
  const labels: Record<string, string> = { " ": "SPACE", arrowleft: "←", arrowright: "→", arrowup: "↑", arrowdown: "↓" };
  return labels[key] ?? key.toUpperCase();
}

function Preview({ kind, size = "md" }: { kind: PieceKind | null; size?: "sm" | "md" }) {
  const t = useT();
  const cells = kind ? getCells(kind, 0) : [];
  const color = kind ? PIECE_COLORS[kind] : null;
  return (
    <div
      className={size === "sm" ? "preview-grid is-sm" : "preview-grid"}
      aria-label={kind ? `${t("hud.next")} ${kind}` : t("hud.emptyAria")}
    >
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
  onDockRequest,
  onScenarioSelect,
  controlBindings,
  listeningForControl = false,
  scenarioId = "megacity",
}: GameCanvasProps) {
  const { t, locale } = useI18n();
  const nf = (n: number) => n.toLocaleString(locale);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const touchLayerRef = useRef<HTMLDivElement>(null);
  const onGameOverRef = useRef(onGameOver);
  const onSnapshotRef = useRef(onSnapshot);
  const gameOverNotifiedRef = useRef(false);
  const runStartedAtRef = useRef(Date.now());
  const revivesUsedRef = useRef(0);
  const pendingGameOverRef = useRef<GameSnapshot | null>(null);
  const finalizeGameOverRef = useRef<(snapshot: GameSnapshot) => void>(() => {});
  const [reviveOpen, setReviveOpen] = useState(false);
  const [reviveBusy, setReviveBusy] = useState(false);
  const [reviveCountdown, setReviveCountdown] = useState(REVIVE_COUNTDOWN_S);
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
  const [runMode, setRunMode] = useState<RunMode>("endless");
  const runModeRef = useRef<RunMode>("endless");
  runModeRef.current = runMode;
  const [modeRecords, setModeRecords] = useState<ModeRecords>(() => loadModeRecords());
  const endTriggeredRef = useRef(false);
  const modeOutcomeRef = useRef<{ completed: boolean; elapsedMs: number } | null>(null);
  const [modeOutcome, setModeOutcome] = useState<{ completed: boolean; elapsedMs: number } | null>(null);
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
          const finalizeGameOver = (over: GameSnapshot) => {
            clearSavedRun();
            if (dailyModeRef.current) {
              const record: DailyRecord = {
                score: over.score,
                lines: over.lines,
                level: over.level,
              };
              const previous = loadDailyRecord();
              const best = saveDailyRecord(record);
              setDailyBest(best);
              setDailyResult({ record, best, improved: !previous || record.score > previous.score });
              setDailyShared(false);
            }
            const mode = runModeRef.current;
            const outcome = modeOutcomeRef.current ?? { completed: false, elapsedMs: over.sessionElapsedMs };
            if (mode === "sprint") {
              if (outcome.completed) setModeRecords(recordSprint(outcome.elapsedMs).records);
              setModeOutcome(outcome);
            } else if (mode === "ultra") {
              setModeRecords(recordUltra(over.score).records);
              setModeOutcome({ completed: true, elapsedMs: outcome.elapsedMs });
            } else {
              setModeOutcome(null);
            }
            onGameOverRef.current?.({
              score: over.score,
              lines: over.lines,
              level: over.level,
              durationMs: Date.now() - runStartedAtRef.current,
            });
          };
          finalizeGameOverRef.current = finalizeGameOver;

          // Fim automático dos modos com meta (antes de tratar o game over natural).
          if (
            !nextSnapshot.gameOver &&
            !preStartRef.current &&
            !endTriggeredRef.current &&
            runModeRef.current !== "endless"
          ) {
            if (runModeRef.current === "sprint" && nextSnapshot.lines >= SPRINT_LINES) {
              endTriggeredRef.current = true;
              modeOutcomeRef.current = { completed: true, elapsedMs: nextSnapshot.sessionElapsedMs };
              gameRef.current?.world.finish();
              return;
            }
            if (runModeRef.current === "ultra" && nextSnapshot.sessionElapsedMs >= ULTRA_MS) {
              endTriggeredRef.current = true;
              modeOutcomeRef.current = { completed: true, elapsedMs: nextSnapshot.sessionElapsedMs };
              gameRef.current?.world.finish();
              return;
            }
          }
          if (nextSnapshot.gameOver && runModeRef.current !== "endless" && !modeOutcomeRef.current) {
            // topou antes da meta
            modeOutcomeRef.current = { completed: false, elapsedMs: nextSnapshot.sessionElapsedMs };
          }

          if (nextSnapshot.gameOver && !gameOverNotifiedRef.current) {
            gameOverNotifiedRef.current = true;
            playGameOver();
            vibrate("gameOver");
            const canRevive =
              runModeRef.current === "endless" &&
              !dailyModeRef.current &&
              revivesUsedRef.current < MAX_REVIVES &&
              nextSnapshot.lines >= 1;
            if (canRevive) {
              pendingGameOverRef.current = nextSnapshot;
              setReviveCountdown(REVIVE_COUNTDOWN_S);
              setReviveOpen(true);
            } else {
              finalizeGameOver(nextSnapshot);
            }
          } else if (!nextSnapshot.gameOver) {
            gameOverNotifiedRef.current = false;
            pendingGameOverRef.current = null;
            setReviveOpen(false);
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
            setGestureFeedback({ label: "feedback.overload", id: Date.now() });
            if (gestureTimerRef.current) window.clearTimeout(gestureTimerRef.current);
            gestureTimerRef.current = window.setTimeout(() => setGestureFeedback(null), 700);
            return;
          }
          if (event.type === "checkpoint") {
            playCheckpoint(event.ok);
            vibrate(event.ok ? "phase" : "medium");
            setGestureFeedback({ label: event.ok ? "feedback.checkpointOk" : "feedback.checkpointFail", id: Date.now() });
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
          ? "feedback.rotate"
          : action === "drop"
            ? "feedback.hardDrop"
            : action === "hold"
              ? "feedback.hold"
              : action === "left"
                ? "feedback.moveLeft"
                : "feedback.moveRight";
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
      if (preStartRef.current || listeningForControlRef.current || settingsOpenRef.current) return;
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
      if (s.gameOver || preStartRef.current || dailyModeRef.current || runModeRef.current !== "endless") return;
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

  // "Continuar" pós-fim de jogo: encerra de vez (finaliza o game over pendente).
  const declineRevive = () => {
    setReviveOpen(false);
    setReviveBusy(false);
    const over = pendingGameOverRef.current;
    pendingGameOverRef.current = null;
    if (over) finalizeGameOverRef.current(over);
  };

  // "Continuar": no nativo assiste o vídeo premiado; no web segue direto (teste).
  const acceptRevive = async () => {
    if (reviveBusy) return;
    setReviveBusy(true);
    const rewarded = adsEnabled() ? await showRewardedForContinue() : true;
    if (!rewarded) {
      declineRevive();
      return;
    }
    revivesUsedRef.current += 1;
    pendingGameOverRef.current = null;
    gameOverNotifiedRef.current = false;
    setReviveBusy(false);
    setReviveOpen(false);
    const world = gameRef.current?.world;
    world?.revive();
    if (world && !settingsOpenRef.current) world.setPaused(false);
  };

  const returnToMainMenu = () => {
    if (!gameRef.current?.world.snapshot.gameOver) return;
    // Keep the finalized world and notification guard until Start creates a new run.
    // Opening the menu must neither restart gameplay nor record the result again.
    preStartRef.current = true;
    if (launchTimerRef.current !== undefined) window.clearTimeout(launchTimerRef.current);
    launchTimerRef.current = undefined;
    if (resetTimerRef.current !== undefined) window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = undefined;
    if (gestureTimerRef.current !== undefined) window.clearTimeout(gestureTimerRef.current);
    gestureTimerRef.current = undefined;
    endPhaseTransition();
    pendingGameOverRef.current = null;
    setReviveOpen(false);
    setReviveBusy(false);
    setReviveCountdown(REVIVE_COUNTDOWN_S);
    setLaunching(false);
    setJustResumed(false);
    setResetArmed(false);
    setGestureFeedback(null);
    setBurst(null);
    setDailyResult(null);
    setDailyShared(false);
    setIsNewRecord(false);
    setModeOutcome(null);
    setPreStartOpen(true);
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
      revivesUsedRef.current = 0;
      pendingGameOverRef.current = null;
      setReviveOpen(false);
      endTriggeredRef.current = false;
      modeOutcomeRef.current = null;
      setModeOutcome(null);
      gameOverNotifiedRef.current = false;
      runStartedAtRef.current = Date.now();
      const world = gameRef.current?.world;
      if (world) {
        // Toda run começa limpa: cronômetro/linhas zerados e sequência certa
        // (com seed no Desafio do Dia, aleatória nos demais).
        world.reseed(dailyMode ? dailySeed() : undefined);
        clearSavedRun();
        if (!settingsOpenRef.current) world.setPaused(false);
      }
    }, 560);
  };

  const onAction = (action: Action) => {
    if (preStartRef.current) return;
    if (action === "restart") {
      clearSavedRun();
      setIsNewRecord(false);
      setPreStartOpen(false);
      setJustResumed(false);
      setDailyResult(null);
      setDailyShared(false);
      preStartRef.current = false;
      revivesUsedRef.current = 0;
      pendingGameOverRef.current = null;
      setReviveOpen(false);
      endTriggeredRef.current = false;
      modeOutcomeRef.current = null;
      setModeOutcome(null);
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
    if (preStartRef.current) return;
    if (resetTimerRef.current !== undefined) window.clearTimeout(resetTimerRef.current);
    if (resetArmed) {
      setResetArmed(false);
      onAction("restart");
      return;
    }
    setResetArmed(true);
    setGestureFeedback({ label: "feedback.restartArmed", id: Date.now() });
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

  // Contagem regressiva do "Continuar?": zerou sem decisão → encerra a partida.
  useEffect(() => {
    if (!reviveOpen || reviveBusy) return;
    const id = window.setInterval(() => {
      setReviveCountdown((n) => {
        if (n <= 1) {
          window.clearInterval(id);
          declineRevive();
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
    // declineRevive só lê refs/setters — seguro fora das deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviveOpen, reviveBusy]);

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
              <p className="eyebrow">{t("topbar.eyebrow")}</p>
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
              aria-label={snapshot.paused ? t("topbar.resumeAria") : t("topbar.pauseAria")}
            >
              {snapshot.paused ? <Play size={12} /> : <Pause size={12} />}
              {snapshot.paused ? t("topbar.resume") : t("topbar.pause")}
            </button>
            {snapshot.combo > 0 && <span className="combo-chip">COMBO ×{snapshot.combo}</span>}
            {snapshot.modifier !== "none" && (
              <span className="modifier-chip" style={{ "--mod-accent": PHASE_MODIFIERS[snapshot.modifier].accent } as React.CSSProperties}>
                {t(`modifier.${snapshot.modifier}.label`)}
              </span>
            )}
            {runMode === "sprint" ? (
              <span className="mode-readout">
                <Flag size={11} /> <strong>{snapshot.lines}</strong>/{SPRINT_LINES} · {formatClock(snapshot.sessionElapsedMs)}
              </span>
            ) : runMode === "ultra" ? (
              <span className="mode-readout">
                <Timer size={11} /> <strong>{formatClock(Math.max(0, ULTRA_MS - snapshot.sessionElapsedMs))}</strong>
              </span>
            ) : (
              <>
                <span className="status-dot" /> {t("common.phase")}{" "}
                <strong>{snapshot.level.toString().padStart(2, "0")}</strong>
                <span className="topbar-lines">
                  {t("common.lines")} <strong>{snapshot.lines.toString().padStart(3, "0")}</strong>
                </span>
              </>
            )}
          </div>
          <div className="topbar-actions">
            {onDockRequest && (
              <button
                type="button"
                className="topbar-icon-btn"
                onClick={onDockRequest}
                aria-label={t("topbar.openDock")}
              >
                <Trophy size={16} />
              </button>
            )}
            <button
              type="button"
              className="topbar-icon-btn"
              onClick={snapshot.paused ? () => onAction("pause") : pauseIntoSettings}
              aria-label={snapshot.paused ? t("topbar.resume") : t("topbar.pause")}
            >
              {snapshot.paused ? <Play size={16} /> : <Pause size={16} />}
            </button>
            <button
              type="button"
              className={resetArmed ? "topbar-icon-btn is-armed" : "topbar-icon-btn"}
              onClick={handleResetTap}
              aria-label={resetArmed ? t("topbar.restartArmed") : t("topbar.restart")}
            >
              <RotateCcw size={16} />
            </button>
          </div>
        </header>

        <main className="game-stage">
          <section className="arena-column" aria-label={t("hud.arenaAria")}>
            <div className="arena-caption">
              <span>
                {snapshot.modifier === "none"
                  ? t("hud.grid")
                  : t("phase.mod", { name: t(`modifier.${snapshot.modifier}.label`) })}
              </span>
              <span className="caption-line" />
              <span>
                {t("common.phase")} {snapshot.level.toString().padStart(2, "0")} ·{" "}
                {Math.round(1000 / snapshot.dropInterval)}/s
              </span>
            </div>
            <div className="arena-viewport">
              <div ref={touchLayerRef} className="touch-layer" aria-hidden="true" />
              {snapshot.checkpoint && (
                <div className={snapshot.checkpoint.secondsLeft <= 5 ? "checkpoint-strip is-urgent" : "checkpoint-strip"}>
                  <span>{t("checkpoint.title")}</span>
                  <strong>
                    {snapshot.checkpoint.linesLeft}{" "}
                    {snapshot.checkpoint.linesLeft === 1 ? t("checkpoint.linesOne") : t("checkpoint.linesOther")}
                  </strong>
                  <b>{snapshot.checkpoint.secondsLeft}s</b>
                </div>
              )}
              {burst && (
                <div className={burst.perfect ? "line-burst is-perfect" : "line-burst"} key={burst.id}>
                  <span className="burst-ring ring-one" />
                  <span className="burst-ring ring-two" />
                  <strong>
                    {burst.count} {burst.count === 1 ? t("common.line") : t("common.lines")}
                  </strong>
                  <small>
                    {burst.perfect
                      ? t("burst.perfect")
                      : burst.combo > 0
                        ? `COMBO ×${burst.combo}`
                        : t("burst.clear")}
                  </small>
                </div>
              )}
              {gestureFeedback && (
                <div className="gesture-feedback" key={gestureFeedback.id} role="status" aria-live="polite">
                  <Sparkles size={14} /> {t(gestureFeedback.label)}
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
              <span className="footer-hint">{t("hud.drop")}</span>
              <span className="touch-hint">{t("controls.tagline")}</span>
            </div>
          </section>

          <aside className="hud-rail" aria-label={t("hud.statusAria")}>
            <section className="hud-card score-card">
              <div className="card-label">
                <span>{t("hud.points")}</span>
                <span>{t("common.pts")}</span>
              </div>
              <div className="score-value">{formatScore(snapshot.score)}</div>
              <div className="score-rule" />
              <div className="record-row">
                <span>{t("common.record")}</span>
                <strong>{formatScore(highScore)}</strong>
              </div>
              {isNewRecord && <div className="record-badge">{t("hud.newRecord")}</div>}
            </section>

            <section className="hud-card queue-card">
              <div className="card-label">
                <span>{t("hud.queue")}</span>
                <span>{t("hud.holdNext")}</span>
              </div>
              <div className="queue-grid">
                <button
                  type="button"
                  className={snapshot.holdLocked ? "queue-hold is-locked" : "queue-hold"}
                  onClick={() => onAction("hold")}
                  aria-label={t("hud.holdAria")}
                >
                  <small>{t("hud.hold")}</small>
                  <Preview kind={snapshot.hold} size="sm" />
                  {!snapshot.hold && <span className="queue-hold-hint">{t("hud.holdHint")}</span>}
                </button>
                <div className="queue-next-wrap">
                  <small className="queue-slot-label">{t("hud.next")}</small>
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
                <span>{t("common.phase")}</span>
                <strong>{snapshot.level.toString().padStart(2, "0")}</strong>
              </div>
              <div className="metric-row">
                <span>{t("common.lines")}</span>
                <strong>{snapshot.lines.toString().padStart(3, "0")}</strong>
              </div>
              <div
                className="phase-progress"
                aria-label={t("hud.nextPhase", {
                  n: snapshot.linesToNextPhase,
                  unit: snapshot.linesToNextPhase === 1 ? t("common.line") : t("common.lines"),
                })}
              >
                <span style={{ width: `${Math.max(4, phaseFill)}%` }} />
              </div>
              <small className="phase-progress-label">
                {t("hud.nextPhase", {
                  n: snapshot.linesToNextPhase,
                  unit: snapshot.linesToNextPhase === 1 ? t("common.line") : t("common.lines"),
                })}
              </small>
            </section>

            <section className="hud-card command-card">
              <div className="card-label">
                <span>{t("hud.commands")}</span>
                <span>{t("hud.keys")}</span>
              </div>
              <div className="key-guide">
                <span>
                  <b>{formatBindingKey(getPrimaryControlKey("left", visibleBindings))}</b>
                  <b>{formatBindingKey(getPrimaryControlKey("right", visibleBindings))}</b> {t("hud.move")}
                </span>
                <span>
                  <b>{formatBindingKey(getPrimaryControlKey("rotate", visibleBindings))}</b> {t("hud.rotate")}
                </span>
                <span>
                  <b>{formatBindingKey(getPrimaryControlKey("drop", visibleBindings))}</b> {t("hud.drop")}
                </span>
                <span>
                  <b>{formatBindingKey(getPrimaryControlKey("hold", visibleBindings))}</b> {t("hud.hold")}
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
                {snapshot.paused ? t("topbar.resume") : t("topbar.pause")}
              </button>
              <button
                type="button"
                className={resetArmed ? "icon-action is-armed" : "icon-action"}
                aria-label={resetArmed ? t("topbar.restartArmed") : t("topbar.restart")}
                onClick={handleResetTap}
              >
                <RotateCcw size={18} />
              </button>
            </div>
          </aside>
        </main>

        <footer className="control-deck">
          <div className="control-group">
            <span className="deck-label">{t("controls.tactile")}</span>
            <div className="control-row">
              <ControlButton label={t("controls.leftAria")} caption={t("controls.left")} action="left" onAction={onAction}>
                <ArrowLeft size={18} />
              </ControlButton>
              <ControlButton label={t("controls.downAria")} caption={t("controls.down")} action="down" onAction={onAction}>
                <ArrowDown size={18} />
              </ControlButton>
              <ControlButton label={t("controls.rightAria")} caption={t("controls.right")} action="right" onAction={onAction}>
                <ArrowRight size={18} />
              </ControlButton>
              <ControlButton label={t("controls.rotateAria")} caption={t("controls.rotateBtn")} action="rotate" onAction={onAction}>
                <ArrowUp size={18} />
              </ControlButton>
              <ControlButton label={t("controls.holdAria")} caption={t("controls.holdBtn")} action="hold" onAction={onAction}>
                <Layers size={18} />
              </ControlButton>
              <ControlButton label={t("controls.dropAria")} caption={t("controls.dropBtn")} action="drop" onAction={onAction}>
                <ChevronsDown size={18} />
              </ControlButton>
            </div>
          </div>
          <div className="deck-message">
            <Sparkles size={15} /> {t("controls.tagline")}
          </div>
          <div className="version-label">
            x7rG ENTERPRISE™ · NB v{__APP_VERSION__}
            {import.meta.env.MODE === "androidrelease" ? "" : " · TESTE"}
          </div>
        </footer>
      </div>

      {phaseTransition && (
        <button
          type="button"
          className={`phase-transition mod-${phaseTransition.modifier}`}
          onClick={endPhaseTransition}
          aria-label={t("common.continue")}
        >
          <span className="phase-transition-kicker">
            {phaseTransition.modifier === "none"
              ? t("phase.stable")
              : t("phase.mod", { name: t(`modifier.${phaseTransition.modifier}.label`) })}
          </span>
          <strong>{t("phase.label", { n: phaseTransition.level.toString().padStart(2, "0") })}</strong>
          <small>{t(`modifier.${phaseTransition.modifier}.rule`)}</small>
          <em>{t("phase.tapContinue")}</em>
        </button>
      )}

      {(preStartOpen || launching) && !settingsOpen && (
        <div className={launching ? "prestart-overlay is-launching" : "prestart-overlay"}>
          <span className="state-kicker">
            {launching ? t("prestart.kickerLoading") : t("prestart.kickerReady")}
          </span>
          <strong>{launching ? t("prestart.titleLoading") : t("prestart.titleReady")}</strong>
          <small>{launching ? t("prestart.subLoading") : t("prestart.subReady")}</small>
          {!launching &&
            (() => {
              const activeKey = dailyMode ? "daily" : runMode;
              const pick = (key: "endless" | "daily" | "sprint" | "ultra") => {
                if (key === "daily") {
                  setDailyMode(true);
                  setRunMode("endless");
                } else {
                  setDailyMode(false);
                  setRunMode(key);
                }
              };
              const items: Array<{
                key: "endless" | "daily" | "sprint" | "ultra";
                icon: React.ReactNode;
                title: string;
                sub: string;
              }> = [
                {
                  key: "endless",
                  icon: <InfinityIcon size={14} />,
                  title: t("mode.endless.title"),
                  sub: t("mode.endless.sub"),
                },
                {
                  key: "daily",
                  icon: <CalendarClock size={14} />,
                  title: t("mode.daily.title"),
                  sub: dailyBest
                    ? t("mode.daily.subRecord", { date: todayKey(), score: nf(dailyBest.score) })
                    : t("mode.daily.sub", { date: todayKey() }),
                },
                {
                  key: "sprint",
                  icon: <Flag size={14} />,
                  title: t("mode.sprint.title", { lines: SPRINT_LINES }),
                  sub:
                    modeRecords.sprintBestMs != null
                      ? t("mode.sprint.subRecord", { lines: SPRINT_LINES, time: formatClock(modeRecords.sprintBestMs) })
                      : t("mode.sprint.sub", { lines: SPRINT_LINES }),
                },
                {
                  key: "ultra",
                  icon: <Timer size={14} />,
                  title: t("mode.ultra.title"),
                  sub:
                    modeRecords.ultraBestScore != null
                      ? t("mode.ultra.subRecord", { score: nf(modeRecords.ultraBestScore) })
                      : t("mode.ultra.sub"),
                },
              ];
              return (
                <div className="prestart-modes" role="radiogroup" aria-label={t("prestart.modeAria")}>
                  {items.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      role="radio"
                      aria-checked={activeKey === item.key}
                      className={activeKey === item.key ? "prestart-mode is-active" : "prestart-mode"}
                      onClick={() => pick(item.key)}
                    >
                      <span className="prestart-mode-head">
                        {item.icon} {item.title}
                      </span>
                      <small>{item.sub}</small>
                    </button>
                  ))}
                </div>
              );
            })()}
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
                  <span>{t(`scenario.${scenario.id}.label`)}</span>
                  {scenarioId === scenario.id && <b>{t("common.active")}</b>}
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
            <Play size={16} /> <span>{launching ? t("prestart.starting") : t("prestart.start")}</span>
          </button>
          <span className="prestart-credit">{t("prestart.credit")}</span>
        </div>
      )}

      {reviveOpen && !settingsOpen && (
        <div className="state-overlay revive-overlay">
          <span className="state-kicker">{t("revive.kicker")}</span>
          <strong>{t("revive.title")}</strong>
          <p className="revive-score">{formatScore(snapshot.score)} {t("common.pts")}</p>
          <div
            className="revive-ring"
            aria-hidden="true"
            data-busy={reviveBusy ? "1" : undefined}
          >
            <span>{reviveBusy ? "…" : reviveCountdown}</span>
          </div>
          <button
            type="button"
            className="action-button revive-go"
            onClick={acceptRevive}
            disabled={reviveBusy}
          >
            <Play size={16} />{" "}
            {reviveBusy ? t("revive.loading") : adsEnabled() ? t("revive.watch") : t("revive.free")}
          </button>
          <button
            type="button"
            className="state-ghost-button"
            onClick={declineRevive}
            disabled={reviveBusy}
          >
            {t("revive.decline")}
          </button>
        </div>
      )}

      {(snapshot.paused || snapshot.gameOver) && !reviveOpen && !preStartOpen && !settingsOpen && !phaseTransition && (
        <div className="state-overlay">
          <span className="state-kicker">
            {snapshot.gameOver
              ? runMode === "sprint"
                ? modeOutcome?.completed
                  ? t("state.kicker.sprintDone", { lines: SPRINT_LINES })
                  : t("state.kicker.sprintStopped")
                : runMode === "ultra"
                  ? t("state.kicker.ultraTimeUp")
                  : dailyMode
                    ? t("state.kicker.dailyEnded")
                    : t("state.kicker.signalEnded")
              : justResumed
                ? t("state.kicker.resumed")
                : t("state.kicker.paused")}
          </span>
          <strong>
            {snapshot.gameOver
              ? runMode === "sprint" && modeOutcome?.completed
                ? t("state.title.sprintDone")
                : runMode === "ultra"
                  ? t("state.title.ultra")
                  : t("state.title.gameOver")
              : justResumed
                ? t("state.title.resume")
                : t("state.title.paused")}
          </strong>
          {snapshot.gameOver && runMode === "sprint" && modeOutcome && (
            <div className="daily-result mode-result">
              <p>
                {modeOutcome.completed
                  ? t("state.sprintResultLines", { n: SPRINT_LINES })
                  : t("state.sprintResultPartial", { done: snapshot.lines, total: SPRINT_LINES })}
              </p>
              <strong>{formatClock(modeOutcome.elapsedMs)}</strong>
              <small>
                {modeRecords.sprintBestMs != null
                  ? t("state.sprintBestTime", { time: formatClock(modeRecords.sprintBestMs) })
                  : t("state.noRecordYet")}
              </small>
            </div>
          )}
          {snapshot.gameOver && runMode === "ultra" && (
            <div className="daily-result mode-result">
              <p>2:00</p>
              <strong>
                {nf(snapshot.score)} {t("common.pts")}
              </strong>
              <small>
                {modeRecords.ultraBestScore != null
                  ? t("state.ultraBest", { score: nf(modeRecords.ultraBestScore) })
                  : t("state.noRecordYet")}
              </small>
            </div>
          )}
          {snapshot.gameOver && dailyMode && dailyResult && (
            <div className="daily-result">
              <p>{todayKey()}</p>
              <strong>
                {nf(dailyResult.record.score)} {t("common.pts")}
              </strong>
              <small>
                {dailyResult.improved
                  ? t("daily.newRecord")
                  : t("daily.bestToday", {
                      best: nf(dailyResult.best.score),
                      gap: nf(dailyResult.best.score - dailyResult.record.score),
                    })}
              </small>
              <button type="button" className="action-button daily-share" onClick={handleShareDaily}>
                <Share2 size={14} /> {dailyShared ? t("daily.shared") : t("daily.share")}
              </button>
            </div>
          )}
          {snapshot.gameOver && !dailyMode && runMode !== "sprint" && (
            <p className={isNewRecord ? "near-miss is-record" : "near-miss"}>
              {isNewRecord
                ? t("state.newPersonalRecord")
                : highScore > snapshot.score
                  ? t("state.missedRecord", { n: nf(highScore - snapshot.score) })
                  : null}
            </p>
          )}
          <div className={snapshot.gameOver ? "state-actions" : undefined}>
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
                  <RotateCcw size={16} /> {dailyMode ? t("state.restartDaily") : t("state.restartRun")}
                </>
              ) : (
                <>
                  <Play size={16} /> {justResumed ? t("common.continue") : t("common.resume")}
                </>
              )}
            </button>
            {snapshot.gameOver && (
              <button type="button" className="action-button" onClick={returnToMainMenu}>
                {t("state.mainMenu")}
              </button>
            )}
          </div>
          {snapshot.gameOver && dailyMode && (
            <button type="button" className="state-ghost-button" onClick={exitDaily}>
              {t("state.exitDaily")}
            </button>
          )}
        </div>
      )}

      {isDebug && (
        <pre className="debug-hud" aria-hidden="true">
          {`vp ${typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : "?"} · mode ${runMode}
drop ${snapshot.dropInterval}ms${snapshot.pulseActive ? " ·PULSE" : ""}
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
