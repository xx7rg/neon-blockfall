import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.rgsantos.neonblockfall",
  appName: "Neon Blockfall",
  webDir: "dist",
  backgroundColor: "#050914",
  android: {
    backgroundColor: "#050914",
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: "#050914",
      showSpinner: false,
    },
  },
};

export default config;
