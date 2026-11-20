import path from "node:path";
import { resolveInside } from "./paths.ts";
import { canRunScript } from "./skills.ts";
import type { MemoryDatabase } from "./db.ts";
import type { ProcessRunner } from "./assistant/types.ts";

export interface ScriptRunOptions {
  db: MemoryDatabase;
  root: string;
  skill: string;
  script: string;
  args?: string[];
  runner: ProcessRunner;
  timeoutMs?: number;
  maxOutputChars?: number;
}

export interface ScriptRunResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  interpreter: string;
  script: string;
}

const INTERPRETERS: Record<string, string> = {
  ".sh": "bash",
  ".bash": "bash",
  ".py": "python",
  ".js": "node",
  ".mjs": "node",
  ".cjs": "node",
};

function interpreterFor(scriptPath: string): string | undefined {
  return INTERPRETERS[path.extname(scriptPath).toLowerCase()];
}

/**
 * Runs a skill script only after the current file hash is approved. The
 * interpreter is chosen by extension and arguments are passed as an array, so
 * no shell is involved. The process gets a deliberately small environment.
 */
export async function runSkillScript(
  options: ScriptRunOptions,
): Promise<ScriptRunResult> {
  const permission = await canRunScript(
    options.db,
    options.root,
    options.skill,
    options.script,
  );
  if (!permission.allowed) {
    return {
      ok: false,
      code: -1,
      stdout: "",
      stderr: permission.reason,
      timedOut: false,
      interpreter: "",
      script: options.script,
    };
  }

  const scriptPath = path.posix.normalize(options.script);
  const interpreter = interpreterFor(scriptPath);
  if (!interpreter) {
    return {
      ok: false,
      code: -1,
      stdout: "",
      stderr: `unsupported script extension: ${path.extname(scriptPath) || "(none)"}`,
      timedOut: false,
      interpreter: "",
      script: scriptPath,
    };
  }
  if (options.script.includes("\0") || path.isAbsolute(options.script)) {
    return {
      ok: false,
      code: -1,
      stdout: "",
      stderr: "script must be a relative path inside the skill directory",
      timedOut: false,
      interpreter,
      script: options.script,
    };
  }

  const skillRow = options.db
    .prepare("SELECT path FROM skills WHERE name = ? COLLATE NOCASE")
    .get(options.skill) as { path: string } | undefined;
  if (!skillRow) {
    return {
      ok: false,
      code: -1,
      stdout: "",
      stderr: "skill not found",
      timedOut: false,
      interpreter,
      script: scriptPath,
    };
  }
  let realScript: string;
  try {
    realScript = resolveInside(
      path.dirname(resolveInside(options.root, skillRow.path)),
      scriptPath,
    );
  } catch (error) {
    return {
      ok: false,
      code: -1,
      stdout: "",
      stderr: error instanceof Error ? error.message : "unsafe script path",
      timedOut: false,
      interpreter,
      script: scriptPath,
    };
  }

  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "/data/data/com.termux/files/usr/bin:/usr/bin:/bin",
    HOME: process.env.HOME,
    LANG: process.env.LANG ?? "cs_CZ.UTF-8",
    TERM: "dumb",
    AGENT_SKILL: options.skill,
  };
  const args = options.args ?? [];
  if (!args.every((arg) => typeof arg === "string" && arg.length <= 2_000)) {
    return {
      ok: false,
      code: -1,
      stdout: "",
      stderr: "invalid script arguments",
      timedOut: false,
      interpreter,
      script: scriptPath,
    };
  }

  const result = await options.runner.run(interpreter, [realScript, ...args], {
    cwd: path.dirname(realScript),
    env,
    timeoutMs: Math.max(1_000, Math.min(300_000, options.timeoutMs ?? 120_000)),
    maxOutputChars: options.maxOutputChars ?? 100_000,
  });

  return {
    ok: result.code === 0 && !result.timedOut,
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: result.timedOut,
    interpreter,
    script: scriptPath,
  };
}
