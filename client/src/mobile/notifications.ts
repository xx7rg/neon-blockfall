// Lembrete local de sequência (Capacitor Local Notifications). No web é no-op.
import { Capacitor } from "@capacitor/core";

const STREAK_NOTIFICATION_ID = 4270;
const REMINDER_DELAY_MS = 4 * 60 * 60 * 1000;
const LATEST_HOUR = 23;

/** Reagenda (ou cancela) o lembrete de streak. Chame após cada partida concluída. */
export async function refreshStreakReminder(currentStreak: number): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.cancel({ notifications: [{ id: STREAK_NOTIFICATION_ID }] });
    if (currentStreak <= 0) return;

    let permission = await LocalNotifications.checkPermissions();
    if (permission.display !== "granted") {
      permission = await LocalNotifications.requestPermissions();
    }
    if (permission.display !== "granted") return;

    const now = new Date();
    const fireAt = new Date(now.getTime() + REMINDER_DELAY_MS);
    if (fireAt.getHours() >= LATEST_HOUR || fireAt.getDate() !== now.getDate()) return;

    await LocalNotifications.schedule({
      notifications: [
        {
          id: STREAK_NOTIFICATION_ID,
          title: "Sua sequência está esperando",
          body: `${currentStreak} ${currentStreak === 1 ? "dia seguido" : "dias seguidos"} no Neon Blockfall. Jogue hoje para não perder a sequência!`,
          schedule: { at: fireAt },
        },
      ],
    });
  } catch {
    /* plugin de notificações ausente ou plataforma sem suporte */
  }
}
