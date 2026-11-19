export type ProjectDirectory = {
  uri: string;
  displayName: string;
  termuxPath: string;
  readableByFileManager: boolean;
};

export async function pickProjectDirectory(): Promise<ProjectDirectory> {
  const native = (globalThis as typeof globalThis & {
    Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, { pickDirectory?: () => Promise<ProjectDirectory> }> };
  }).Capacitor;
  const plugin = native?.Plugins?.ProjectStorage;
  if (!native?.isNativePlatform?.() || !plugin?.pickDirectory) {
    throw new Error("Výběr projektové složky je dostupný až v Android APK.");
  }
  return plugin.pickDirectory();
}
