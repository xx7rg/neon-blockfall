export type TouchAction = "left" | "right" | "rotate" | "drop" | "hold" | null;

/**
 * Toque curto = girar. Deslize horizontal = mover. Deslize para baixo = encaixe
 * instantâneo (hard drop). Deslize para cima = reservar peça (hold).
 */
export function resolveTouchAction(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  threshold = 24
): TouchAction {
  const dx = endX - startX;
  const dy = endY - startY;
  const distance = Math.max(Math.abs(dx), Math.abs(dy));
  if (distance < threshold) return "rotate";
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "drop" : "hold";
}
