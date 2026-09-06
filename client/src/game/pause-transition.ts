export const PAUSE_TRANSITION_MS = 180;

export type PauseMenuTransition = "open" | "closing";

export function getPauseOverlayClass(transition: PauseMenuTransition) {
  return transition === "closing" ? "tutorial-backdrop is-closing" : "tutorial-backdrop";
}

export function canStartPauseClose(settingsOpen: boolean, transition: PauseMenuTransition | null) {
  return settingsOpen && transition !== "closing";
}
