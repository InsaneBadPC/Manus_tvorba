export type UpdateInfo = {
  available: boolean;
  build: string;
  run?: string;
  apk: string;
  release?: string;
  reason?: string;
};

const UPDATE_MANIFEST_URL = "https://github.com/InsaneBadPC/Manus_tvorba/releases/download/latest/latest.json";
const CURRENT_BUILD = import.meta.env.VITE_BUILD_SHA ?? "dev";

export async function checkForUpdate(): Promise<UpdateInfo> {
  try {
    const response = await fetch(`${UPDATE_MANIFEST_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const manifest = await response.json() as { build?: string; run?: string; apk?: string; release?: string };
    if (!manifest.build || !manifest.apk) throw new Error("Neplatný update manifest");
    return {
      available: CURRENT_BUILD !== "dev" && manifest.build !== CURRENT_BUILD,
      build: manifest.build,
      run: manifest.run,
      apk: manifest.apk,
      release: manifest.release,
    };
  } catch (error) {
    return {
      available: false,
      build: "",
      apk: "",
      reason: error instanceof Error ? error.message : "Update manifest není dostupný",
    };
  }
}

export async function installUpdate(apkUrl: string): Promise<{ ok: boolean; reason?: string }> {
  const native = (globalThis as typeof globalThis & { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, { downloadAndInstall?: (args: { url: string }) => Promise<unknown> }> } }).Capacitor;
  const plugin = native?.Plugins?.AppUpdateBridge;
  if (native?.isNativePlatform?.() && plugin?.downloadAndInstall) {
    await plugin.downloadAndInstall({ url: apkUrl });
    return { ok: true };
  }
  window.open(apkUrl, "_blank", "noopener,noreferrer");
  return { ok: false, reason: "V náhledu se APK otevírá v prohlížeči" };
}

export { CURRENT_BUILD, UPDATE_MANIFEST_URL };
