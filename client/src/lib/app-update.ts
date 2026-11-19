export type UpdateInfo = {
  available: boolean;
  build: string;
  run?: string;
  apk: string;
  sha256?: string;
  release?: string;
  reason?: string;
};

export type UpdateManifest = {
  build?: string;
  run?: string;
  apk?: string;
  sha256?: string;
  release?: string;
};

const UPDATE_MANIFEST_URL = "https://github.com/InsaneBadPC/Manus_tvorba/releases/download/latest/latest.json";
const CURRENT_BUILD = import.meta.env.VITE_BUILD_SHA ?? "dev";

type AppUpdatePlugin = {
  fetchManifest?: (args: { url: string }) => Promise<UpdateManifest>;
  downloadAndInstall?: (args: { url: string; sha256?: string }) => Promise<unknown>;
};

type NativeBridge = {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, AppUpdatePlugin>;
};

function bridge(): { native: NativeBridge | undefined; plugin: AppUpdatePlugin | undefined } {
  const native = (globalThis as typeof globalThis & { Capacitor?: NativeBridge }).Capacitor;
  return { native, plugin: native?.Plugins?.AppUpdateBridge };
}

async function readManifest(): Promise<UpdateManifest> {
  const { native, plugin } = bridge();
  // GitHub release assets do not send CORS headers, so a WebView fetch from
  // https://localhost always fails. The native side can read the same URL.
  if (native?.isNativePlatform?.() && plugin?.fetchManifest) {
    return plugin.fetchManifest({ url: UPDATE_MANIFEST_URL });
  }
  const response = await fetch(`${UPDATE_MANIFEST_URL}?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json() as UpdateManifest;
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  try {
    const manifest = await readManifest();
    if (!manifest.build || !manifest.apk) throw new Error("Neplatný update manifest");
    return {
      available: CURRENT_BUILD !== "dev" && manifest.build !== CURRENT_BUILD,
      build: manifest.build,
      run: manifest.run,
      apk: manifest.apk,
      sha256: manifest.sha256,
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

export async function installUpdate(apkUrl: string, sha256?: string): Promise<{ ok: boolean; reason?: string }> {
  const { native, plugin } = bridge();
  if (native?.isNativePlatform?.() && plugin?.downloadAndInstall) {
    const result = await plugin.downloadAndInstall({ url: apkUrl, sha256 });
    const payload = result as { ok?: boolean; reason?: string } | undefined;
    return payload?.ok === false ? { ok: false, reason: payload.reason } : { ok: true };
  }
  window.open(apkUrl, "_blank", "noopener,noreferrer");
  return { ok: false, reason: "V náhledu se APK otevírá v prohlížeči" };
}

export { CURRENT_BUILD, UPDATE_MANIFEST_URL };
