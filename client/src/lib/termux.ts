export type TermuxResult = { ok: boolean; stdout: string; stderr?: string; code?: number; reason?: string };

/**
 * Native integration boundary.
 * Android build must register a Capacitor plugin named TermuxBridge that sends
 * RUN_COMMAND to com.termux.app with a sandboxed executable and working dir.
 * Required Android permission: com.termux.permission.RUN_COMMAND.
 * Termux must have allow-external-apps=true in ~/.termux/termux.properties.
 */
export async function runTermuxCommand(command: string, cwd = "~"): Promise<TermuxResult> {
  const native = (globalThis as typeof globalThis & { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, { runCommand?: (args: unknown) => Promise<TermuxResult> }> } }).Capacitor;
  const plugin = native?.Plugins?.TermuxBridge;
  if (native?.isNativePlatform?.() && plugin?.runCommand) {
    // INTEGRATION TERMUX: native plugin must validate an allowlist, pass command
    // through RUN_COMMAND, capture stdout/stderr and return a bounded result.
    return plugin.runCommand({ command, cwd });
  }
  return { ok: false, stdout: "", stderr: "Termux bridge není v tomto webovém preview dostupný.", reason: "native_bridge_missing" };
}

export function isTermuxBridgeAvailable() {
  const native = (globalThis as typeof globalThis & { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> } }).Capacitor;
  return Boolean(native?.isNativePlatform?.() && native?.Plugins?.TermuxBridge);
}
