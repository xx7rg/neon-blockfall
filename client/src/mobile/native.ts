// Bootstrap do shell nativo (Capacitor). No web é no-op.
import { Capacitor } from "@capacitor/core";
import { initAds } from "./ads";

export async function initNativeShell() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: "#050914" });
  } catch {
    /* plugin de status bar ausente */
  }
  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide();
  } catch {
    /* plugin de splash ausente */
  }
  void initAds();
}

export { onGameOverAd } from "./ads";
