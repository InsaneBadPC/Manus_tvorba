import { runTermuxCommand } from "@/lib/termux";

export type MemorySnapshot = {
  memory: Array<{
    name: string;
    description: string;
    body: string;
    scope: string;
    scopeOwner: string;
    path: string;
    pinned: boolean;
    tags: string[];
    updated: string;
  }>;
  skills: Array<{
    name: string;
    description: string;
    triggers: string[];
    status: string;
    version: string;
    permissions: string[];
    stats: { uses: number; successes: number; failures: number; lastUsed?: string };
    path: string;
  }>;
  skillErrors: Array<{ relPath: string; message: string }>;
  approvals: {
    skills: Array<{ name: string; description: string; path: string; status: string }>;
    scripts: Array<{ skill: string; path: string; hash: string }>;
  };
  sessions: Array<{ id: string; model: string; updated: string }>;
  stats: { memory: number; episodes: number; lastConsolidation: string | null };
};

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\"'\"'")}'`;

function cliCommand(projectCwd: string, args: string[], projectId: string): string {
  const primary = `${projectCwd.replace(/\/+$/, "")}/agent-memory/src/cli.ts`;
  const candidates = [
    shellQuote(primary),
    '"$HOME/Manus_tvorba/agent-memory/src/cli.ts"',
    '"/storage/emulated/0/InsaneCode/Manus_tvorba/agent-memory/src/cli.ts"',
  ];
  const quoted = args.map(shellQuote).join(" ");
  const project = projectId ? ` --project ${shellQuote(projectId)}` : "";
  return `CLI=""; for candidate in ${candidates.join(" ")}; do if [ -f "$candidate" ]; then CLI="$candidate"; break; fi; done; if [ -z "$CLI" ]; then printf '%s\\n' 'agent-memory CLI nebylo nalezeno v projektu ani výchozí cestě.' >&2; exit 2; fi; node "$CLI" ${quoted}${project}`;
}

export async function readMemorySnapshot(
  projectId: string,
  projectCwd: string,
): Promise<MemorySnapshot> {
  const result = await runTermuxCommand(cliCommand(projectCwd, ["ui"], projectId), projectCwd);
  if (!result.ok) {
    throw new Error(result.stderr || result.reason || "Načtení paměti selhalo.");
  }
  return JSON.parse(result.stdout) as MemorySnapshot;
}

export async function memoryAction(
  action: "approve-skill" | "reject-skill" | "rebuild",
  value: string | undefined,
  projectId: string,
  projectCwd: string,
): Promise<string> {
  const args = action === "rebuild" ? [action] : [action, value ?? ""];
  const result = await runTermuxCommand(cliCommand(projectCwd, args, projectId), projectCwd);
  if (!result.ok) throw new Error(result.stderr || result.reason || `${action} selhalo.`);
  return result.stdout.trim();
}

export type MemorySaveInput = {
  path?: string;
  name: string;
  description: string;
  body: string;
  scope: string;
  scopeOwner: string;
  pinned: boolean;
  tags: string[];
};

function base64Json(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Saves an edited entry through the same validation layer as CLI/MCP. */
export async function saveMemory(
  input: MemorySaveInput,
  projectId: string,
  projectCwd: string,
): Promise<string> {
  const encoded = base64Json(input);
  const result = await runTermuxCommand(
    `printf '%s' ${shellQuote(encoded)} | base64 -d | ${cliCommand(projectCwd, ["memory-save"], projectId)}`,
    projectCwd,
  );
  if (!result.ok) throw new Error(result.stderr || result.reason || "Uložení paměti selhalo.");
  const parsed = JSON.parse(result.stdout) as { path?: string };
  return parsed.path ?? input.path ?? "";
}

export async function deleteMemory(
  relPath: string,
  projectId: string,
  projectCwd: string,
): Promise<string> {
  const result = await runTermuxCommand(
    cliCommand(projectCwd, ["memory-delete", relPath], projectId),
    projectCwd,
  );
  if (!result.ok) throw new Error(result.stderr || result.reason || "Smazání paměti selhalo.");
  return result.stdout.trim();
}

export async function approveSkillScript(
  skill: string,
  script: string,
  projectId: string,
  projectCwd: string,
): Promise<string> {
  const result = await runTermuxCommand(
    cliCommand(projectCwd, ["approve", skill, script], projectId),
    projectCwd,
  );
  if (!result.ok) throw new Error(result.stderr || result.reason || "Schválení skriptu selhalo.");
  return result.stdout.trim();
}

export async function scheduleMemoryMaintenance(): Promise<string> {
  const native = (globalThis as typeof globalThis & {
    Capacitor?: {
      isNativePlatform?: () => boolean;
      Plugins?: Record<string, { schedule?: () => Promise<{ scheduled?: boolean; reason?: string }> }>;
    };
  }).Capacitor;
  const plugin = native?.Plugins?.MemoryMaintenance;
  if (!native?.isNativePlatform?.() || !plugin?.schedule) {
    return "WorkManager je dostupný pouze v Android APK.";
  }
  const result = await plugin.schedule();
  return result.scheduled
    ? "Údržba je naplánovaná při nabíjení a idle."
    : result.reason || "Údržbu se nepodařilo naplánovat.";
}
