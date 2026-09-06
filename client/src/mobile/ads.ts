// Integração de anúncios (AdMob) para o build nativo via Capacitor.
// No build web todas as funções são no-op — nada é importado do plugin nativo.
import { Capacitor } from "@capacitor/core";

// AdMob — conta real (Android). App ID: ca-app-pub-2635930849231174~7000204339
// (o App ID vai no AndroidManifest via scripts/android-postsync.mjs).
// iOS não é usado no momento: mantém os IDs de teste oficiais do Google.
const AD_UNITS = {
  banner: {
    android: "ca-app-pub-2635930849231174/2567959130",
    ios: "ca-app-pub-3940256099942544/2435281174",
  },
  interstitial: {
    android: "ca-app-pub-2635930849231174/4072612497",
    ios: "ca-app-pub-3940256099942544/4411468910",
  },
};

// Anúncios REAIS só quando o build de produção passa VITE_ADS_TESTING=false.
// Qualquer outro build (dev, preview, APK de teste do CI) usa anúncios de teste
// — clicar no próprio anúncio real = banimento da conta AdMob.
const IS_TESTING = import.meta.env.VITE_ADS_TESTING !== "false";

/** A cada N game overs mostra um intersticial (respeita a política do AdMob). */
const INTERSTITIAL_EVERY = 3;

let adsReady = false;
let interstitialLoaded = false;
let gameOverCount = 0;

export function adsEnabled() {
  return Capacitor.isNativePlatform();
}

function platform(): "android" | "ios" {
  return Capacitor.getPlatform() === "ios" ? "ios" : "android";
}

export async function initAds() {
  if (!adsEnabled() || adsReady) return;
  try {
    const { AdMob, AdmobConsentStatus } = await import("@capacitor-community/admob");
    await AdMob.initialize({ initializeForTesting: IS_TESTING });
    try {
      const info = await AdMob.requestConsentInfo();
      if (info.isConsentFormAvailable && info.status === AdmobConsentStatus.REQUIRED) {
        await AdMob.showConsentForm();
      }
    } catch {
      /* fora da UE / consentimento indisponível */
    }
    adsReady = true;
    await showBanner();
    void preloadInterstitial();
  } catch (error) {
    console.warn("[ads] init falhou", error);
  }
}

async function showBanner() {
  if (!adsReady) return;
  try {
    const { AdMob, BannerAdPosition, BannerAdSize } = await import("@capacitor-community/admob");
    await AdMob.showBanner({
      adId: AD_UNITS.banner[platform()],
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: BannerAdPosition.BOTTOM_CENTER,
      margin: 0,
      isTesting: IS_TESTING,
    });
    document.body.classList.add("has-ad-banner");
  } catch (error) {
    console.warn("[ads] banner falhou", error);
  }
}

async function preloadInterstitial() {
  if (!adsReady) return;
  try {
    const { AdMob } = await import("@capacitor-community/admob");
    await AdMob.prepareInterstitial({
      adId: AD_UNITS.interstitial[platform()],
      isTesting: IS_TESTING,
    });
    interstitialLoaded = true;
  } catch {
    interstitialLoaded = false;
  }
}

/** Chamar no fim da partida. Mostra intersticial no máximo 1 a cada INTERSTITIAL_EVERY. */
export async function onGameOverAd() {
  if (!adsReady) return;
  gameOverCount += 1;
  if (gameOverCount % INTERSTITIAL_EVERY !== 0 || !interstitialLoaded) return;
  try {
    const { AdMob } = await import("@capacitor-community/admob");
    await AdMob.showInterstitial();
  } catch (error) {
    console.warn("[ads] intersticial falhou", error);
  } finally {
    interstitialLoaded = false;
    void preloadInterstitial();
  }
}
