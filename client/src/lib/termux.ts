export type TermuxResult = { ok: boolean; stdout: string; stderr?: string; code?: number; reason?: string };
export type TermuxShell = "bash" | "sh";

/**
 * Native integration boundary.
 * Android build registers a Capacitor plugin named TermuxBridge that sends
 * RUN_COMMAND to com.termux.app with a sandboxed executable and working dir.
 * Required Android permission: com.termux.permission.RUN_COMMAND.
 * Termux must have allow-external-apps=true in ~/.termux/termux.properties.
 *
 * The native boundary enforces command length, a 120s timeout and bounded
 * stdout/stderr. Commands are not prefix-allowlisted because the product runs
 * user-installed CLI agents; treat any WebView content as trusted code.
 */
export async function runTermuxCommand(command: string, cwd = "~", shell: TermuxShell = "bash"): Promise<TermuxResult> {
  const native = (globalThis as typeof globalThis & { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, { runCommand?: (args: { command: string; cwd: string; shell: TermuxShell }) => Promise<TermuxResult> }> } }).Capacitor;
  const plugin = native?.Plugins?.TermuxBridge;
  if (native?.isNativePlatform?.() && plugin?.runCommand) {
    return plugin.runCommand({ command, cwd, shell });
  }
  return { ok: false, stdout: "", stderr: "Termux bridge není v tomto webovém preview dostupný.", reason: "native_bridge_missing" };
}

export function isTermuxBridgeAvailable() {
  const native = (globalThis as typeof globalThis & { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> } }).Capacitor;
  return Boolean(native?.isNativePlatform?.() && native?.Plugins?.TermuxBridge);
}
