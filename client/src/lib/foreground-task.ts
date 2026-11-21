export type ForegroundTaskStatus = {
  taskId: string;
  running: boolean;
  startedAt: number;
  finishedAt: number;
  exitCode: number;
  error?: string;
  output: string;
};

type AssistantTaskPlugin = {
  start?: (args: { command: string; cwd: string; label: string }) => Promise<{ started: boolean; taskId: string }>;
  status?: () => Promise<ForegroundTaskStatus>;
  read?: (args: { taskId: string }) => Promise<{ taskId: string; output: string }>;
  stop?: () => Promise<{ stopped: boolean }>;
};

function plugin(): AssistantTaskPlugin | undefined {
  const native = (globalThis as typeof globalThis & {
    Capacitor?: {
      isNativePlatform?: () => boolean;
      Plugins?: Record<string, AssistantTaskPlugin>;
    };
  }).Capacitor;
  if (!native?.isNativePlatform?.()) return undefined;
  return native.Plugins?.AssistantTask;
}

export async function startForegroundTask(
  command: string,
  cwd = "~",
  label = "Úloha agenta",
): Promise<{ started: boolean; taskId: string }> {
  const api = plugin();
  if (!api?.start) throw new Error("AssistantTask plugin není v tomto APK dostupný.");
  return api.start({ command, cwd, label });
}

export async function readForegroundTaskStatus(): Promise<ForegroundTaskStatus | null> {
  const api = plugin();
  if (!api?.status) return null;
  return api.status();
}

export async function readForegroundTaskOutput(taskId: string): Promise<string> {
  const api = plugin();
  if (!api?.read) return "";
  const result = await api.read({ taskId });
  return result.output;
}

export async function stopForegroundTask(): Promise<boolean> {
  const api = plugin();
  if (!api?.stop) return false;
  return (await api.stop()).stopped;
}
