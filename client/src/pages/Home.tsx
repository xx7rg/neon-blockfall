import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Award,
  Flame,
  Pause,
  RotateCcw,
  Settings2,
  Trash2,
  Trophy,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import GameCanvas from "@/components/GameCanvas";
import {
  getAudioSettings,
  playPauseClose,
  playPauseOpen,
  setAudioMuted,
  setAudioVolume,
} from "@/game/sfx";
import { getMusicSettings, setMusicMuted, setMusicVolume, startMusic, stopMusic } from "@/game/music";
import {
  CONTROL_ACTIONS,
  findControlConflict,
  getControlBindings,
  getPrimaryControlKey,
  normalizeControlKey,
  resetControlBindings,
  setControlBinding,
  type ControlAction,
} from "@/game/controls";
import type { GameSnapshot } from "@/game/types";
import { ARENA_SCENARIOS, loadArenaScenario, saveArenaScenario, type ArenaScenarioId } from "@/game/scenarios";
import { formatSessionElapsed, getPhaseProgress } from "@/game/session-summary";
import { canStartPauseClose, getPauseOverlayClass, PAUSE_TRANSITION_MS, type PauseMenuTransition } from "@/game/pause-transition";
import {
  clearLocalLeaderboard,
  filterLocalLeaderboard,
  loadLocalLeaderboard,
  LOCAL_LEADERBOARD_FILTER_KEY,
  recordLocalScore,
  type LocalLeaderboardEntry,
  type LocalLeaderboardFilter,
} from "@/game/local-leaderboard";
import { onGameOverAd } from "@/mobile/native";
import { refreshStreakReminder } from "@/mobile/notifications";
import { loadStreak, recordPlaySession, type StreakRecord } from "@/game/streaks";
import { ACHIEVEMENTS, loadUnlockedAchievements, recordGameForAchievements } from "@/game/achievements";

function displayScore(score: string | number | null | undefined) {
  return String(score ?? 0).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function formatControlKey(key: string) {
  const normalized = normalizeControlKey(key);
  const labels: Record<string, string> = { " ": "SPACE", arrowleft: "←", arrowright: "→", arrowup: "↑", arrowdown: "↓" };
  return labels[normalized] ?? normalized.toUpperCase();
}

function controlLabel(action: ControlAction) {
  return CONTROL_ACTIONS.find((item) => item.action === action)?.label ?? action.toUpperCase();
}

type SessionSummarySnapshot = Pick<GameSnapshot, "score" | "lines" | "level" | "sessionElapsedMs" | "paused">;

function SessionSummary({ snapshot }: { snapshot: SessionSummarySnapshot }) {
  const phaseProgress = getPhaseProgress(snapshot.lines);
  return (
    <section className="pause-summary" aria-labelledby="pause-summary-title">
      <div className="pause-summary-heading">
        <span id="pause-summary-title">
          <Pause size={12} /> RESUMO DA SESSÃO
        </span>
        <b>{snapshot.paused ? "PAUSADO" : "EM ANDAMENTO"}</b>
      </div>
      <div className="pause-summary-grid">
        <div className="pause-stat">
          <small>PONTUAÇÃO ATUAL</small>
          <strong>{displayScore(snapshot.score)}</strong>
          <span>PTS · LINHAS VÁLIDAS</span>
        </div>
        <div className="pause-stat">
          <small>TEMPO DECORRIDO</small>
          <strong>{formatSessionElapsed(snapshot.sessionElapsedMs)}</strong>
          <span>
            {snapshot.lines} LINHAS · FASE {String(snapshot.level).padStart(2, "0")}
          </span>
        </div>
      </div>
      <div className="pause-progress" aria-label={`${phaseProgress}% para a próxima fase`}>
        <span style={{ width: `${phaseProgress || 3}%` }} />
      </div>
      <small className="pause-progress-label">
        PROGRESSO DA FASE <b>{phaseProgress}%</b>
      </small>
    </section>
  );
}

export default function Home() {
  const [audioVolume, setAudioVolumeState] = useState(() => getAudioSettings().volume);
  const [audioMuted, setAudioMutedState] = useState(() => getAudioSettings().muted);
  const [musicVolume, setMusicVolumeState] = useState(() => getMusicSettings().volume);
  const [musicMuted, setMusicMutedState] = useState(() => getMusicSettings().muted);
  const [arenaScenario, setArenaScenario] = useState<ArenaScenarioId>(() => loadArenaScenario());
  const [tutorialOpen, setTutorialOpen] = useState(
    () =>
      window.localStorage.getItem("neon-blockfall-tutorial-seen") !== "true" &&
      new URLSearchParams(window.location.search).get("settings") !== "1" &&
      new URLSearchParams(window.location.search).get("skipTutorial") !== "1"
  );
  const [tutorialStep, setTutorialStep] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(
    () => new URLSearchParams(window.location.search).get("settings") === "1"
  );
  const [settingsClosing, setSettingsClosing] = useState(false);
  const pauseTransition: PauseMenuTransition | null = settingsClosing ? "closing" : settingsOpen ? "open" : null;
  const settingsCloseTimerRef = useRef<number | undefined>(undefined);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [bindings, setBindings] = useState<Record<string, ControlAction>>(() => getControlBindings());
  const [listeningAction, setListeningAction] = useState<ControlAction | null>(null);
  const [conflictAlert, setConflictAlert] = useState<{ key: string; action: ControlAction; existingAction: ControlAction } | null>(
    null
  );
  const [sessionSnapshot, setSessionSnapshot] = useState<SessionSummarySnapshot>({
    score: 0,
    lines: 0,
    level: 1,
    sessionElapsedMs: 0,
    paused: false,
  });
  const [localLeaderboard, setLocalLeaderboard] = useState<LocalLeaderboardEntry[]>(() => loadLocalLeaderboard());
  const [localLeaderboardFilter, setLocalLeaderboardFilter] = useState<LocalLeaderboardFilter>(
    () => window.localStorage.getItem(LOCAL_LEADERBOARD_FILTER_KEY) ?? "all"
  );
  const [clearLocalOpen, setClearLocalOpen] = useState(false);
  const [streak, setStreak] = useState<StreakRecord>(() => loadStreak());
  const [unlockedAchievements, setUnlockedAchievements] = useState<string[]>(() => loadUnlockedAchievements());
  const [dockOpen, setDockOpen] = useState(false);

  useEffect(() => {
    if (!settingsOpen || !listeningAction) return;
    const onBindingKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setListeningAction(null);
        setSettingsMessage("REMAPEAMENTO CANCELADO");
        return;
      }
      if (event.key === "Tab") return;
      event.preventDefault();
      const conflict = findControlConflict(listeningAction, event.key, bindings);
      if (conflict) {
        setConflictAlert({ key: conflict.key, action: listeningAction, existingAction: conflict.existingAction });
        window.setTimeout(() => setConflictAlert(null), 4200);
      } else {
        setConflictAlert(null);
      }
      const next = setControlBinding(listeningAction, event.key);
      setBindings(next);
      window.dispatchEvent(new CustomEvent("neon-blockfall-controls-changed"));
      setListeningAction(null);
      setSettingsMessage(
        `${CONTROL_ACTIONS.find((item) => item.action === listeningAction)?.label ?? "CONTROLE"} · ${formatControlKey(event.key)}`
      );
    };
    window.addEventListener("keydown", onBindingKeyDown);
    return () => window.removeEventListener("keydown", onBindingKeyDown);
  }, [settingsOpen, listeningAction, bindings]);

  useEffect(() => {
    const unlockMusic = () => {
      startMusic();
      window.removeEventListener("pointerdown", unlockMusic);
      window.removeEventListener("keydown", unlockMusic);
    };
    window.addEventListener("pointerdown", unlockMusic, { once: true });
    window.addEventListener("keydown", unlockMusic, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlockMusic);
      window.removeEventListener("keydown", unlockMusic);
      stopMusic();
    };
  }, []);

  useEffect(
    () => () => {
      if (settingsCloseTimerRef.current !== undefined) window.clearTimeout(settingsCloseTimerRef.current);
    },
    []
  );

  const tutorialSteps = [
    {
      kicker: "01 / PONTUAÇÃO",
      title: "LINHAS, NÃO QUEDAS",
      body: "Você só pontua quando uma linha horizontal fica completa e é eliminada. Soft drop e hard drop servem para jogar melhor, mas não concedem pontos.",
      stat: "60 / 160 / 320 / 560 × FASE",
    },
    {
      kicker: "02 / PROGRESSÃO",
      title: "O CIRCUITO ACELERA",
      body: "A cada oito linhas eliminadas você avança uma fase. O intervalo de encaixe diminui progressivamente, então a leitura e a decisão precisam acompanhar o ritmo.",
      stat: "FASE 01 → 820ms · FASE 10 → ~275ms",
    },
    {
      kicker: "03 / CONTROLE",
      title: "DOMINE A GRADE",
      body: "Deslize para mover, toque para girar, deslize para baixo para acelerar e para cima para encaixar. No teclado use as setas e SPACE.",
      stat: "DESLIZE MOVE · TOQUE GIRA · ESPAÇO ENCAIXA",
    },
    {
      kicker: "04 / IMERSÃO",
      title: "SINTONIZE O SISTEMA",
      body: "O menu de configurações controla separadamente os efeitos e a trilha. As preferências ficam salvas neste dispositivo.",
      stat: "EFEITOS + TRILHA · VOLUME INDEPENDENTE",
    },
  ];

  const openSettings = () => {
    if (settingsCloseTimerRef.current !== undefined) window.clearTimeout(settingsCloseTimerRef.current);
    setSettingsClosing(false);
    setSettingsOpen(true);
    playPauseOpen();
  };
  const closeSettings = () => {
    if (!canStartPauseClose(settingsOpen, pauseTransition)) return;
    setSettingsClosing(true);
    playPauseClose();
    settingsCloseTimerRef.current = window.setTimeout(() => {
      setSettingsOpen(false);
      setSettingsClosing(false);
    }, PAUSE_TRANSITION_MS);
  };
  const closeTutorial = () => {
    window.localStorage.setItem("neon-blockfall-tutorial-seen", "true");
    setTutorialOpen(false);
    setTutorialStep(0);
  };
  const resetControls = () => {
    resetControlBindings();
    setBindings(getControlBindings());
    setListeningAction(null);
    setConflictAlert(null);
    window.dispatchEvent(new CustomEvent("neon-blockfall-controls-reset"));
    setSettingsMessage("CONTROLES PADRÃO RESTAURADOS");
    window.setTimeout(() => setSettingsMessage(""), 2200);
  };
  const visibleLocalLeaderboard = useMemo(
    () => filterLocalLeaderboard(localLeaderboard, localLeaderboardFilter),
    [localLeaderboard, localLeaderboardFilter]
  );
  const updateLocalLeaderboardFilter = (value: string) => {
    setLocalLeaderboardFilter(value);
    try {
      window.localStorage.setItem(LOCAL_LEADERBOARD_FILTER_KEY, value);
    } catch {
      /* armazenamento indisponível */
    }
  };
  const confirmClearLocalLeaderboard = () => {
    clearLocalLeaderboard();
    setLocalLeaderboard([]);
    setClearLocalOpen(false);
  };
  const handleGameOver = (result: { score: number; lines: number; level: number; durationMs: number }) => {
    setLocalLeaderboard(
      recordLocalScore({
        score: result.score,
        lines: result.lines,
        durationMs: result.durationMs,
        scenarioId: arenaScenario,
      })
    );

    const { record: streakRecord, isFirstToday } = recordPlaySession();
    setStreak(streakRecord);

    const { newlyUnlocked } = recordGameForAchievements({ score: result.score, lines: result.lines }, streakRecord.currentStreak);
    if (newlyUnlocked.length > 0) {
      setUnlockedAchievements(loadUnlockedAchievements());
      newlyUnlocked.forEach((achievement) => {
        toast("CONQUISTA DESBLOQUEADA", { description: achievement.title });
      });
    }
    if (isFirstToday && streakRecord.currentStreak > 1) {
      toast(`SEQUÊNCIA DE ${streakRecord.currentStreak} DIAS`, {
        description: "Continue jogando todo dia para manter o ritmo.",
      });
    }
    void refreshStreakReminder(streakRecord.currentStreak);
    void onGameOverAd();
  };

  return (
    <div className="home-root">
      <GameCanvas
        scenarioId={arenaScenario}
        onScenarioSelect={(nextScenario) => setArenaScenario(saveArenaScenario(nextScenario))}
        onGameOver={handleGameOver}
        onSnapshot={setSessionSnapshot}
        settingsOpen={settingsOpen}
        onPauseMenuRequest={openSettings}
        onDockRequest={() => setDockOpen(true)}
        controlBindings={bindings}
        listeningForControl={listeningAction !== null}
      />

      {dockOpen && <div className="dock-backdrop" onClick={() => setDockOpen(false)} aria-hidden="true" />}
      <section className={dockOpen ? "world-dock is-open" : "world-dock"} aria-label="Placar local e sistema de áudio">
        <button type="button" className="dock-close" onClick={() => setDockOpen(false)} aria-label="Fechar painel">
          <X size={14} />
        </button>
        <div className="world-dock-header">
          <span>
            <Trophy size={13} /> NEON BLOCKFALL
            {streak.currentStreak > 0 && (
              <span className="streak-badge" aria-label={`Sequência de ${streak.currentStreak} dias`}>
                <Flame size={11} /> {streak.currentStreak}
              </span>
            )}
          </span>
          <button type="button" className="world-toggle" onClick={openSettings} aria-label="Abrir configurações">
            <Settings2 size={14} />
          </button>
        </div>

        <div className="sound-panel" aria-label="Controles de áudio">
          <div className="sound-panel-heading">
            <span>
              <Settings2 size={11} /> SISTEMA DE ÁUDIO
            </span>
            <button type="button" className="settings-open" onClick={openSettings} aria-label="Abrir configurações">
              <Settings2 size={12} />
            </button>
          </div>
          <div className="sound-row">
            <span>
              <Volume2 size={11} /> EFEITOS
            </span>
            <button
              type="button"
              className="audio-mute"
              aria-label={audioMuted ? "Ativar efeitos sonoros" : "Silenciar efeitos sonoros"}
              onClick={() => {
                const next = !audioMuted;
                setAudioMutedState(next);
                setAudioMuted(next);
              }}
            >
              {audioMuted ? <VolumeX size={12} /> : <Volume2 size={12} />}
            </button>
            <input
              aria-label="Volume dos efeitos sonoros"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={audioVolume}
              onChange={(event) => {
                const next = Number(event.target.value);
                setAudioVolumeState(next);
                setAudioVolume(next);
              }}
            />
          </div>
          <div className="sound-row">
            <span>
              <Volume2 size={11} /> TRILHA
            </span>
            <button
              type="button"
              className="audio-mute"
              aria-label={musicMuted ? "Ativar trilha sonora" : "Silenciar trilha sonora"}
              onClick={() => {
                const next = !musicMuted;
                setMusicMutedState(next);
                setMusicMuted(next);
                if (!next) startMusic();
              }}
            >
              {musicMuted ? <VolumeX size={12} /> : <Volume2 size={12} />}
            </button>
            <input
              aria-label="Volume da trilha sonora"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={musicVolume}
              onChange={(event) => {
                const next = Number(event.target.value);
                setMusicVolumeState(next);
                setMusicVolume(next);
                if (next > 0 && musicMuted) {
                  setMusicMutedState(false);
                  setMusicMuted(false);
                  startMusic();
                }
              }}
            />
          </div>
          <div className="sound-actions">
            <button
              type="button"
              className="tutorial-launch"
              onClick={() => {
                setTutorialStep(0);
                setTutorialOpen(true);
              }}
            >
              ? COMO JOGAR
            </button>
            <button type="button" className="tutorial-launch" onClick={openSettings}>
              CONFIGURAÇÕES
            </button>
          </div>
        </div>

        <div className="local-leaderboard-panel">
          <div className="profile-title">
            <span>
              <Trophy size={13} /> TOP LOCAL
            </span>
            <small>ESTE DISPOSITIVO · {localLeaderboard.length}/10</small>
          </div>
          <div className="local-leaderboard-tools">
            <label>
              <span>FILTRAR CENÁRIO</span>
              <select
                aria-label="Filtrar ranking local por cenário"
                value={localLeaderboardFilter}
                onChange={(event) => updateLocalLeaderboardFilter(event.target.value)}
              >
                <option value="all">TODOS OS CENÁRIOS</option>
                {ARENA_SCENARIOS.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="local-clear-button"
              onClick={() => setClearLocalOpen(true)}
              disabled={localLeaderboard.length === 0}
            >
              <Trash2 size={11} /> LIMPAR
            </button>
          </div>
          {localLeaderboard.length === 0 ? (
            <div className="leaderboard-empty">TERMINE UMA PARTIDA PARA GRAVAR SEU PRIMEIRO RECORDE</div>
          ) : visibleLocalLeaderboard.length === 0 ? (
            <div className="leaderboard-empty">NENHUM RECORDE NESTE CENÁRIO</div>
          ) : (
            <div className="leaderboard-list">
              {visibleLocalLeaderboard.map((entry, index) => (
                <div className="leaderboard-row" key={entry.id}>
                  <b>{String(index + 1).padStart(2, "0")}</b>
                  <span>
                    <strong>{displayScore(entry.score)} PTS</strong>
                    <small>
                      {entry.scenarioId.toUpperCase()} · {entry.lines} LINHAS ·{" "}
                      {new Date(entry.createdAt).toLocaleDateString("pt-BR")}
                    </small>
                  </span>
                  <em>{Math.round(entry.durationMs / 1000)}s</em>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="achievements-panel">
          <div className="profile-title">
            <span>
              <Award size={13} /> CONQUISTAS
            </span>
            <small>
              {unlockedAchievements.length}/{ACHIEVEMENTS.length}
            </small>
          </div>
          <div className="achievement-grid">
            {ACHIEVEMENTS.map((achievement) => {
              const unlocked = unlockedAchievements.includes(achievement.id);
              return (
                <div key={achievement.id} className={unlocked ? "achievement-card unlocked" : "achievement-card"}>
                  <b aria-hidden="true">{unlocked ? <Trophy size={12} /> : <Award size={12} />}</b>
                  <span>
                    <strong>{achievement.title}</strong>
                    <small>{achievement.description}</small>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {clearLocalOpen && (
        <div className="local-clear-backdrop" role="presentation">
          <section
            className="local-clear-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="local-clear-title"
            aria-describedby="local-clear-description"
          >
            <div className="local-clear-heading">
              <Trash2 size={16} />
              <span id="local-clear-title">LIMPAR TOP LOCAL?</span>
            </div>
            <p id="local-clear-description">
              Esta ação remove as pontuações salvas neste navegador e não pode ser desfeita.
            </p>
            <div className="local-clear-actions">
              <button type="button" className="local-clear-cancel" onClick={() => setClearLocalOpen(false)}>
                CANCELAR
              </button>
              <button type="button" className="local-clear-confirm" onClick={confirmClearLocalLeaderboard}>
                <Trash2 size={12} /> APAGAR HISTÓRICO
              </button>
            </div>
          </section>
        </div>
      )}

      {settingsOpen && (
        <div className={getPauseOverlayClass(pauseTransition === "closing" ? "closing" : "open")} role="presentation">
          <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div className="settings-heading">
              <div>
                <span className="settings-kicker">SYSTEM / SETTINGS</span>
                <h2 id="settings-title">CONFIGURAÇÕES</h2>
              </div>
              <button type="button" className="settings-close" onClick={closeSettings} aria-label="Fechar configurações">
                <X size={16} />
              </button>
            </div>
            <p className="settings-copy">
              Ajuste a paisagem sonora e restaure os comandos da arena sem perder seu progresso.
            </p>
            <SessionSummary snapshot={sessionSnapshot} />

            <div className="settings-section">
              <div className="settings-label">
                <span>EFEITOS SONOROS</span>
                <b>{audioMuted ? "MUDO" : `${Math.round(audioVolume * 100)}%`}</b>
              </div>
              <div className="settings-control">
                <button
                  type="button"
                  className="audio-mute"
                  onClick={() => {
                    const next = !audioMuted;
                    setAudioMutedState(next);
                    setAudioMuted(next);
                  }}
                  aria-label={audioMuted ? "Ativar efeitos sonoros" : "Silenciar efeitos sonoros"}
                >
                  {audioMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                </button>
                <input
                  aria-label="Volume dos efeitos sonoros nas configurações"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={audioVolume}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setAudioVolumeState(next);
                    setAudioVolume(next);
                  }}
                />
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-label">
                <span>TRILHA CYBERPUNK</span>
                <b>{musicMuted ? "MUDO" : `${Math.round(musicVolume * 100)}%`}</b>
              </div>
              <div className="settings-control">
                <button
                  type="button"
                  className="audio-mute"
                  onClick={() => {
                    const next = !musicMuted;
                    setMusicMutedState(next);
                    setMusicMuted(next);
                    if (!next) startMusic();
                  }}
                  aria-label={musicMuted ? "Ativar trilha sonora" : "Silenciar trilha sonora"}
                >
                  {musicMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                </button>
                <input
                  aria-label="Volume da trilha sonora nas configurações"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={musicVolume}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setMusicVolumeState(next);
                    setMusicVolume(next);
                  }}
                />
              </div>
            </div>

            <div className="settings-section scenario-settings-section">
              <div className="settings-label">
                <span>CENÁRIO TECNOLÓGICO</span>
                <b>{ARENA_SCENARIOS.find((item) => item.id === arenaScenario)?.label}</b>
              </div>
              <p className="settings-hint">
                Escolha o ambiente visual da arena. A troca não altera sua partida nem suas pontuações.
              </p>
              <div className="scenario-picker" role="list" aria-label="Cenários tecnológicos da arena">
                {ARENA_SCENARIOS.map((scenario) => (
                  <button
                    type="button"
                    role="listitem"
                    key={scenario.id}
                    className={arenaScenario === scenario.id ? "scenario-option is-active" : "scenario-option"}
                    onClick={() => {
                      const next = saveArenaScenario(scenario.id);
                      setArenaScenario(next);
                    }}
                    style={{ "--scenario-accent": scenario.accent, background: scenario.background } as React.CSSProperties}
                  >
                    <span>
                      <strong>{scenario.label}</strong>
                      <small>{scenario.detail}</small>
                    </span>
                    {arenaScenario === scenario.id && <b>ATIVO</b>}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-section controls-section">
              <div className="settings-label">
                <span>CONTROLES DA ARENA</span>
                <b>{listeningAction ? "OUVINDO TECLA" : "TECLADO"}</b>
              </div>
              <p className="settings-hint">
                Clique em uma tecla e pressione o comando desejado. ESC cancela a escuta. No celular, o jogo usa gestos de
                toque.
              </p>
              {conflictAlert && (
                <div className="control-conflict-alert" role="alert" aria-live="assertive">
                  <AlertTriangle size={15} />
                  <span>
                    <strong>CONFLITO DETECTADO</strong>
                    <small>
                      {formatControlKey(conflictAlert.key)} já estava em <b>{controlLabel(conflictAlert.existingAction)}</b>.
                      A ação anterior recebeu um fallback para continuar funcional.
                    </small>
                  </span>
                  <button type="button" onClick={() => setConflictAlert(null)} aria-label="Fechar alerta de conflito">
                    OK
                  </button>
                </div>
              )}
              <div className="control-remap-list">
                {CONTROL_ACTIONS.map((item) => {
                  const key = getPrimaryControlKey(item.action, bindings);
                  const listening = listeningAction === item.action;
                  const hasConflict =
                    conflictAlert?.action === item.action && normalizeControlKey(key) === conflictAlert.key;
                  return (
                    <div className={hasConflict ? "control-remap-row has-conflict" : "control-remap-row"} key={item.action}>
                      <span>
                        <strong>{item.label}</strong>
                        <small>{item.description}</small>
                      </span>
                      <div className="control-binding-actions">
                        <button
                          type="button"
                          className={
                            listening ? "key-binding is-listening" : hasConflict ? "key-binding has-conflict" : "key-binding"
                          }
                          onClick={() => setListeningAction(item.action)}
                          aria-label={`Remapear teclado de ${item.label}`}
                        >
                          {listening ? "PRESSIONE…" : formatControlKey(key)}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <button type="button" className="reset-controls" onClick={resetControls}>
                <RotateCcw size={13} /> RESTAURAR PADRÕES
              </button>
            </div>

            <div className="settings-legal">
              <a href="/privacy.html" target="_blank" rel="noopener noreferrer">
                POLÍTICA DE PRIVACIDADE
              </a>
              <span>© 2026 x7rG ENTERPRISE™</span>
            </div>
            {settingsMessage && <div className="sync-note">{settingsMessage}</div>}
            <button type="button" className="action-button primary settings-done" onClick={closeSettings}>
              SALVAR E VOLTAR
            </button>
          </section>
        </div>
      )}

      {tutorialOpen && (
        <div className="tutorial-backdrop" role="presentation">
          <section className="tutorial-modal" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
            <div className="tutorial-progress">
              <span>{tutorialSteps[tutorialStep]?.kicker}</span>
              <b>
                {String(tutorialStep + 1).padStart(2, "0")} / {String(tutorialSteps.length).padStart(2, "0")}
              </b>
            </div>
            <div className="tutorial-orbit" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <h2 id="tutorial-title">{tutorialSteps[tutorialStep]?.title}</h2>
            <p>{tutorialSteps[tutorialStep]?.body}</p>
            <strong className="tutorial-stat">{tutorialSteps[tutorialStep]?.stat}</strong>
            <div className="tutorial-dots">
              {tutorialSteps.map((_, index) => (
                <span key={index} className={index === tutorialStep ? "is-active" : ""} />
              ))}
            </div>
            <div className="tutorial-actions">
              <button type="button" className="tutorial-skip" onClick={closeTutorial}>
                PULAR TUTORIAL
              </button>
              {tutorialStep < tutorialSteps.length - 1 ? (
                <button
                  type="button"
                  className="action-button primary"
                  onClick={() => setTutorialStep((step) => step + 1)}
                >
                  PRÓXIMO
                </button>
              ) : (
                <button type="button" className="action-button primary" onClick={closeTutorial}>
                  ENTRAR NA ARENA
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
