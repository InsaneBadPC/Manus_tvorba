import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "ai.insane.orin",
  appName: "Orin",
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
