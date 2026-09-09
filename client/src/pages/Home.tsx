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
import { useI18n, useT } from "@/i18n/context";
import { detectLocale, SUPPORTED_LOCALES, type LocalePreference } from "@/i18n";
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
  const t = useT();
  const phaseProgress = getPhaseProgress(snapshot.lines);
  return (
    <section className="pause-summary" aria-labelledby="pause-summary-title">
      <div className="pause-summary-heading">
        <span id="pause-summary-title">
          <Pause size={12} /> {t("pause.summary")}
        </span>
        <b>{snapshot.paused ? t("pause.status.paused") : t("pause.status.running")}</b>
      </div>
      <div className="pause-summary-grid">
        <div className="pause-stat">
          <small>{t("pause.currentScore")}</small>
          <strong>{displayScore(snapshot.score)}</strong>
          <span>{t("pause.scoreCaption")}</span>
        </div>
        <div className="pause-stat">
          <small>{t("pause.elapsed")}</small>
          <strong>{formatSessionElapsed(snapshot.sessionElapsedMs)}</strong>
          <span>
            {snapshot.lines} {t("common.lines")} · {t("common.phase")} {String(snapshot.level).padStart(2, "0")}
          </span>
        </div>
      </div>
      <div className="pause-progress" aria-label={t("pause.phaseProgressAria", { n: phaseProgress })}>
        <span style={{ width: `${phaseProgress || 3}%` }} />
      </div>
      <small className="pause-progress-label">
        {t("pause.phaseProgress")} <b>{phaseProgress}%</b>
      </small>
    </section>
  );
}

export default function Home() {
  const { t, preference: localePreference, setPreference: setLocalePreference } = useI18n();
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
        setSettingsMessage("settings.remapCancelled");
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
      setSettingsMessage(`${t(`control.${listeningAction}.label`)} · ${formatControlKey(event.key)}`);
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

  const tutorialSteps = ([1, 2, 3, 4] as const).map((i) => ({
    kicker: t(`tutorial.s${i}.kicker`),
    title: t(`tutorial.s${i}.title`),
    body: t(`tutorial.s${i}.body`),
    stat: t(`tutorial.s${i}.stat`),
  }));

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
    setSettingsMessage("settings.defaultsRestored");
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
        toast(t("toast.achievementUnlocked"), { description: t(`achievement.${achievement.id}.title`) });
      });
    }
    if (isFirstToday && streakRecord.currentStreak > 1) {
      toast(t("toast.streakTitle", { n: streakRecord.currentStreak }), {
        description: t("toast.streakBody"),
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
      <section className={dockOpen ? "world-dock is-open" : "world-dock"} aria-label={t("dock.aria")}>
        <button type="button" className="dock-close" onClick={() => setDockOpen(false)} aria-label={t("dock.close")}>
          <X size={14} />
        </button>
        <div className="world-dock-header">
          <span>
            <Trophy size={13} /> NEON BLOCKFALL
            {streak.currentStreak > 0 && (
              <span className="streak-badge" aria-label={t("dock.streakAria", { n: streak.currentStreak })}>
                <Flame size={11} /> {streak.currentStreak}
              </span>
            )}
          </span>
          <button type="button" className="world-toggle" onClick={openSettings} aria-label={t("dock.openSettings")}>
            <Settings2 size={14} />
          </button>
        </div>

        <div className="sound-panel" aria-label={t("dock.audioAria")}>
          <div className="sound-panel-heading">
            <span>
              <Settings2 size={11} /> {t("dock.audioSystem")}
            </span>
            <button type="button" className="settings-open" onClick={openSettings} aria-label={t("dock.openSettings")}>
              <Settings2 size={12} />
            </button>
          </div>
          <div className="sound-row">
            <span>
              <Volume2 size={11} /> {t("dock.sfxShort")}
            </span>
            <button
              type="button"
              className="audio-mute"
              aria-label={audioMuted ? t("dock.sfxOn") : t("dock.sfxOff")}
              onClick={() => {
                const next = !audioMuted;
                setAudioMutedState(next);
                setAudioMuted(next);
              }}
            >
              {audioMuted ? <VolumeX size={12} /> : <Volume2 size={12} />}
            </button>
            <input
              aria-label={t("dock.sfxVolume")}
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
              <Volume2 size={11} /> {t("dock.musicShort")}
            </span>
            <button
              type="button"
              className="audio-mute"
              aria-label={musicMuted ? t("dock.musicOn") : t("dock.musicOff")}
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
              aria-label={t("dock.musicVolume")}
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
              ? {t("dock.howToPlay")}
            </button>
            <button type="button" className="tutorial-launch" onClick={openSettings}>
              {t("settings.title")}
            </button>
          </div>
        </div>

        <div className="local-leaderboard-panel">
          <div className="profile-title">
            <span>
              <Trophy size={13} /> {t("dock.topLocal")}
            </span>
            <small>
              {t("dock.thisDevice")} · {localLeaderboard.length}/10
            </small>
          </div>
          <div className="local-leaderboard-tools">
            <label>
              <span>{t("dock.filterScenario")}</span>
              <select
                aria-label={t("dock.filterScenarioAria")}
                value={localLeaderboardFilter}
                onChange={(event) => updateLocalLeaderboardFilter(event.target.value)}
              >
                <option value="all">{t("dock.allScenarios")}</option>
                {ARENA_SCENARIOS.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {t(`scenario.${scenario.id}.label`)}
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
              <Trash2 size={11} /> {t("dock.clearBtn")}
            </button>
          </div>
          {localLeaderboard.length === 0 ? (
            <div className="leaderboard-empty">{t("dock.firstRecord")}</div>
          ) : visibleLocalLeaderboard.length === 0 ? (
            <div className="leaderboard-empty">{t("dock.noRecordScenario")}</div>
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
              <Award size={13} /> {t("dock.achievements")}
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
                    <strong>{t(`achievement.${achievement.id}.title`)}</strong>
                    <small>{t(`achievement.${achievement.id}.description`)}</small>
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
              <span id="local-clear-title">{t("dock.clearTop")}</span>
            </div>
            <p id="local-clear-description">{t("dock.clearBody")}</p>
            <div className="local-clear-actions">
              <button type="button" className="local-clear-cancel" onClick={() => setClearLocalOpen(false)}>
                {t("dock.clearCancel")}
              </button>
              <button type="button" className="local-clear-confirm" onClick={confirmClearLocalLeaderboard}>
                <Trash2 size={12} /> {t("dock.clearConfirm")}
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
                <span className="settings-kicker">{t("settings.eyebrow")}</span>
                <h2 id="settings-title">{t("settings.title")}</h2>
              </div>
              <button type="button" className="settings-close" onClick={closeSettings} aria-label={t("settings.close")}>
                <X size={16} />
              </button>
            </div>
            <p className="settings-copy">{t("settings.copy")}</p>
            <SessionSummary snapshot={sessionSnapshot} />

            <div className="settings-section">
              <div className="settings-label">
                <span>{t("settings.section.sfx")}</span>
                <b>{audioMuted ? t("settings.mute") : `${Math.round(audioVolume * 100)}%`}</b>
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
                  aria-label={audioMuted ? t("settings.sfxOn") : t("settings.sfxOff")}
                >
                  {audioMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                </button>
                <input
                  aria-label={t("settings.sfxVolume")}
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
                <span>{t("settings.section.music")}</span>
                <b>{musicMuted ? t("settings.mute") : `${Math.round(musicVolume * 100)}%`}</b>
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
                  aria-label={musicMuted ? t("settings.musicOn") : t("settings.musicOff")}
                >
                  {musicMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                </button>
                <input
                  aria-label={t("settings.musicVolume")}
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
                <span>{t("settings.section.scenario")}</span>
                <b>{t(`scenario.${arenaScenario}.label`)}</b>
              </div>
              <p className="settings-hint">{t("settings.scenarioHint")}</p>
              <div className="scenario-picker" role="list" aria-label={t("settings.scenarioAria")}>
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
                      <strong>{t(`scenario.${scenario.id}.label`)}</strong>
                      <small>{t(`scenario.${scenario.id}.detail`)}</small>
                    </span>
                    {arenaScenario === scenario.id && <b>{t("common.active")}</b>}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-section controls-section">
              <div className="settings-label">
                <span>{t("settings.section.controls")}</span>
                <b>{listeningAction ? t("settings.controlsListening") : t("settings.controlsKeyboard")}</b>
              </div>
              <p className="settings-hint">{t("settings.controlsHint")}</p>
              {conflictAlert && (
                <div className="control-conflict-alert" role="alert" aria-live="assertive">
                  <AlertTriangle size={15} />
                  <span>
                    <strong>{t("settings.conflict")}</strong>
                    <small>
                      {t("settings.conflictBody", {
                        key: formatControlKey(conflictAlert.key),
                        action: t(`control.${conflictAlert.existingAction}.label`),
                      })}
                    </small>
                  </span>
                  <button type="button" onClick={() => setConflictAlert(null)} aria-label={t("settings.conflictClose")}>
                    {t("settings.conflictOk")}
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
                        <strong>{t(`control.${item.action}.label`)}</strong>
                        <small>{t(`control.${item.action}.description`)}</small>
                      </span>
                      <div className="control-binding-actions">
                        <button
                          type="button"
                          className={
                            listening ? "key-binding is-listening" : hasConflict ? "key-binding has-conflict" : "key-binding"
                          }
                          onClick={() => setListeningAction(item.action)}
                          aria-label={t("settings.remapAria", { label: t(`control.${item.action}.label`) })}
                        >
                          {listening ? t("common.pressKey") : formatControlKey(key)}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <button type="button" className="reset-controls" onClick={resetControls}>
                <RotateCcw size={13} /> {t("settings.restoreDefaults")}
              </button>
            </div>

            <div className="settings-section">
              <div className="settings-label">
                <span>{t("settings.section.language")}</span>
              </div>
              <select
                className="language-select"
                aria-label={t("settings.section.language")}
                value={localePreference}
                onChange={(event) => setLocalePreference(event.target.value as LocalePreference)}
              >
                <option value="auto">{t("settings.language.auto")}</option>
                {SUPPORTED_LOCALES.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc === "pt-BR"
                      ? t("settings.language.ptBR")
                      : loc === "en-US"
                        ? t("settings.language.enUS")
                        : t("settings.language.esES")}
                  </option>
                ))}
              </select>
              <p className="settings-hint">{t("settings.language.autoHint", { detected: detectLocale() })}</p>
            </div>

            <div className="settings-legal">
              <a href="/privacy.html" target="_blank" rel="noopener noreferrer">
                {t("settings.privacy")}
              </a>
              <span>{t("settings.credit")}</span>
            </div>
            {settingsMessage && <div className="sync-note">{t(settingsMessage)}</div>}
            <button type="button" className="action-button primary settings-done" onClick={closeSettings}>
              {t("settings.save")}
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
                {t("tutorial.skip")}
              </button>
              {tutorialStep < tutorialSteps.length - 1 ? (
                <button
                  type="button"
                  className="action-button primary"
                  onClick={() => setTutorialStep((step) => step + 1)}
                >
                  {t("tutorial.next")}
                </button>
              ) : (
                <button type="button" className="action-button primary" onClick={closeTutorial}>
                  {t("tutorial.start")}
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
