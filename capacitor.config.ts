import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "ai.insane.agentvr",
  appName: "Insane AI Agent",
  webDir: "dist/public",
  server: {
    // Production APK uses bundled assets. Keep this disabled for release builds.
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
