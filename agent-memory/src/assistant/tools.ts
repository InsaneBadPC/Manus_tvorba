import fs from "node:fs/promises";
import path from "node:path";
import { containsSecret } from "../extract.ts";
import { getByName, getByPath } from "../db.ts";
import { resolveInside, slugify } from "../paths.ts";
import { searchMemory } from "../retrieval.ts";
import { loadSkill, proposeSkill, syncSkills } from "../skills.ts";
import { runSkillScript } from "../script-runner.ts";
import { listSessions } from "./session.ts";
import type {
  ToolContext,
  ToolDefinition,
  ToolOutcome,
} from "./types.ts";

const MAX_READ_CHARS = 40_000;
const MAX_WRITE_CHARS = 100_000;
const MAX_COMMAND_CHARS = 8_000;
const MAX_LIST_ENTRIES = 400;

/** Commands must not inherit API keys and tokens from the assistant process. */
function commandEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const keep = new Set([
    "PATH",
    "HOME",
    "LANG",
    "LC_ALL",
    "TERM",
    "TMPDIR",
    "PREFIX",
    "SHELL",
    "USER",
    "LOGNAME",
    "NODE_PATH",
    "ANDROID_HOME",
    "JAVA_HOME",
    "GRADLE_USER_HOME",
  ]);
  for (const key of keep) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

function asString(args: Record<string, unknown>, key: string, fallback = ""): string {
  const value = args[key];
  return typeof value === "string" ? value : fallback;
}

function asNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asStringArray(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function failure(message: string): ToolOutcome {
  return { content: message, isError: true };
}

function outputContent(label: string, value: string, max = 80_000): ToolOutcome {
  if (containsSecret(value)) {
    return failure(`${label} contained a possible secret; output withheld from the model`);
  }
  return {
    content: value.length > max ? `${value.slice(0, max)}\n… output truncated` : value,
  };
}

function isSensitivePath(relative: string): boolean {
  const lower = relative.toLowerCase().replaceAll("\\", "/");
  if (/(^|\/)\.env(\.|$)/.test(lower) && !/\.env\.(example|sample|template)$/.test(lower)) {
    return true;
  }
  return (
    /(^|\/)\.ssh(\/|$)/.test(lower) ||
    /(^|\/)\.git\/config$/.test(lower) ||
    /(^|\/)(id_rsa|id_ed25519|id_ecdsa)(\.|$)/.test(lower) ||
    /\.(p12|pfx|keystore|jks|pem|key)$/.test(lower) ||
    /(^|\/)(secrets?|credentials?)(\/|\.|$)/.test(lower)
  );
}

/** Refuses file operations that escape the project through a symlink. */
async function assertRealPathInside(base: string, target: string): Promise<void> {
  const realBase = await fs.realpath(base);
  let current = target;
  for (let i = 0; i < 20; i += 1) {
    try {
      const real = await fs.realpath(current);
      if (real !== realBase && !real.startsWith(`${realBase}${path.sep}`)) {
        throw new Error(`path escapes project through a symlink: ${current}`);
      }
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) return;
      current = parent;
    }
  }
  throw new Error("path is too deeply nested");
}

async function listFiles(
  base: string,
  relative: string,
  depth: number,
): Promise<string[]> {
  const root = resolveInside(base, relative);
  await assertRealPathInside(base, root);
  const lines: string[] = [];
  const walk = async (dir: string, currentDepth: number): Promise<void> => {
    if (lines.length >= MAX_LIST_ENTRIES) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (lines.length >= MAX_LIST_ENTRIES) return;
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".agent") {
        continue;
      }
      const abs = path.join(dir, entry.name);
      const rel = path.relative(base, abs).split(path.sep).join("/");
      if (entry.isSymbolicLink()) {
        lines.push(`${rel} -> (symlink, skipped)`);
        continue;
      }
      if (entry.isDirectory()) {
        lines.push(`${rel}/`);
        if (currentDepth < depth) await walk(abs, currentDepth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = await fs.stat(abs).catch(() => null);
      lines.push(`${rel}\t${stat?.size ?? 0}`);
    }
  };
  await walk(root, 1);
  return lines;
}

function backupName(sessionId: string, relative: string): string {
  const safeSession = slugify(sessionId).slice(0, 40);
  const safeRelative = relative
    .split("/")
    .map((segment) => segment.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 60))
    .join("/");
  return path.join("backups", safeSession, `${Date.now()}-${safeRelative}`);
}

export const ASSISTANT_TOOLS: ToolDefinition[] = [
  {
    name: "memory_search",
    description: "Search durable memory visible to this project and agent.",
    risk: 0,
    reversible: true,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
    async execute(args, ctx) {
      const query = asString(args, "query").trim();
      if (!query) return failure("query is required");
      const hits = searchMemory(ctx.db, query, {
        projectId: ctx.projectId,
        agentId: ctx.agentId,
        limit: Math.max(1, Math.min(20, asNumber(args, "limit") ?? 8)),
      });
      return {
        content: JSON.stringify(
          hits.map((hit) => ({
            name: hit.item.name,
            description: hit.item.description,
            body: hit.item.body.slice(0, 2_000),
            scope: hit.item.scope,
            path: hit.item.relPath,
          })),
          null,
          2,
        ),
      };
    },
  },
  {
    name: "memory_read",
    description: "Read one memory entry by name or path.",
    risk: 0,
    reversible: true,
    parameters: {
      type: "object",
      properties: { name: { type: "string" }, path: { type: "string" } },
    },
    async execute(args, ctx) {
      const name = asString(args, "name").trim();
      const relPath = asString(args, "path").trim();
      const item = relPath
        ? getByPath(ctx.db, relPath)
        : name
          ? getByName(ctx.db, name)
          : undefined;
      if (!item) return failure("memory entry not found");
      return { content: JSON.stringify(item, null, 2) };
    },
  },
  {
    name: "skill_load",
    description: "Load the instructions of one active or probation skill.",
    risk: 0,
    reversible: true,
    parameters: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
    async execute(args, ctx) {
      const skill = loadSkill(ctx.db, asString(args, "name").trim());
      if (!skill) return failure("skill not found");
      if (skill.manifest.status === "draft" || skill.manifest.status === "disabled") {
        return failure(`skill is ${skill.manifest.status} and cannot be used`);
      }
      return {
        content: JSON.stringify(
          {
            name: skill.manifest.name,
            description: skill.manifest.description,
            allowedTools: skill.manifest.allowedTools,
            permissions: skill.manifest.permissions,
            instructions: skill.body,
          },
          null,
          2,
        ),
      };
    },
  },
  {
    name: "skill_propose",
    description: "Propose a new skill draft. It needs user approval before routing.",
    risk: 1,
    reversible: true,
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        triggers: { type: "array", items: { type: "string" } },
        body: { type: "string" },
        permissions: { type: "array", items: { type: "string" } },
      },
      required: ["name", "description", "body"],
    },
    async execute(args, ctx) {
      const body = asString(args, "body");
      if (!body.trim()) return failure("body is required");
      if (containsSecret(body)) return failure("possible secret in proposal");
      const proposal = await proposeSkill(ctx.root, {
        name: asString(args, "name"),
        description: asString(args, "description"),
        body,
        triggers: asStringArray(args, "triggers"),
        permissions: asStringArray(args, "permissions"),
        status: "draft",
      });
      await syncSkills(ctx.db, ctx.root);
      return {
        content: JSON.stringify({
          proposed: true,
          path: proposal.relPath,
          status: "draft",
        }),
      };
    },
  },
  {
    name: "list_files",
    description: "List files in the project. Reads only; no shell involved.",
    risk: 0,
    reversible: true,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative directory, default ." },
        depth: { type: "number" },
      },
    },
    async execute(args, ctx) {
      const relative = asString(args, "path", ".").trim() || ".";
      const depth = Math.max(1, Math.min(6, asNumber(args, "depth") ?? 3));
      if (isSensitivePath(relative)) return failure("sensitive path");
      const lines = await listFiles(ctx.projectCwd, relative, depth);
      return {
        content: lines.join("\n") || "(empty directory)",
      };
    },
  },
  {
    name: "read_file",
    description: "Read a UTF-8 project file. Secret-bearing paths are rejected.",
    risk: 0,
    reversible: true,
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    async execute(args, ctx) {
      const relative = asString(args, "path").trim();
      if (!relative) return failure("path is required");
      if (isSensitivePath(relative)) return failure("sensitive path is not readable");
      const abs = resolveInside(ctx.projectCwd, relative);
      await assertRealPathInside(ctx.projectCwd, abs);
      const stat = await fs.stat(abs);
      if (!stat.isFile()) return failure("not a regular file");
      if (stat.size > 2_000_000) return failure("file is too large");
      const raw = await fs.readFile(abs, "utf8");
      if (raw.includes("\0")) return failure("binary file");
      return outputContent("file", raw.slice(0, MAX_READ_CHARS));
    },
  },
  {
    name: "write_file",
    description:
      "Create or replace a project file. Existing files are backed up first. Secrets are rejected.",
    risk: 1,
    reversible: true,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
    async execute(args, ctx) {
      const relative = asString(args, "path").trim();
      const content = asString(args, "content");
      if (!relative) return failure("path is required");
      if (content.length > MAX_WRITE_CHARS) return failure("content is too large");
      if (isSensitivePath(relative)) return failure("sensitive path is not writable");
      if (containsSecret(content)) return failure("possible secret in content");
      const abs = resolveInside(ctx.projectCwd, relative);
      await assertRealPathInside(ctx.projectCwd, abs);
      const rel = path.relative(ctx.projectCwd, abs).split(path.sep).join("/");
      let backup: string | undefined;
      const previous = await fs.readFile(abs, "utf8").catch(() => undefined);
      if (previous !== undefined) {
        backup = backupName(ctx.sessionId, rel);
        const backupAbs = resolveInside(ctx.root, backup);
        await fs.mkdir(path.dirname(backupAbs), { recursive: true });
        await fs.writeFile(backupAbs, previous, { encoding: "utf8", mode: 0o600 });
      }
      await fs.mkdir(path.dirname(abs), { recursive: true });
      const temp = `${abs}.tmp-${process.pid}-${Date.now()}`;
      await fs.writeFile(temp, content, { encoding: "utf8", mode: 0o600 });
      await fs.rename(temp, abs);
      return {
        content: JSON.stringify({ written: true, path: rel, backup }),
        changed: true,
      };
    },
  },
  {
    name: "run_command",
    description:
      "Run a bash command in the project directory. Requires explicit user approval. Output is bounded.",
    risk: 2,
    reversible: false,
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeout_ms: { type: "number" },
      },
      required: ["command"],
    },
    async execute(args, ctx) {
      const command = asString(args, "command").trim();
      if (!command) return failure("command is required");
      if (command.length > MAX_COMMAND_CHARS) return failure("command is too long");
      const timeout = Math.max(1_000, Math.min(300_000, asNumber(args, "timeout_ms") ?? 120_000));
      const result = await ctx.processRunner.run("bash", ["-lc", command], {
        cwd: ctx.projectCwd,
        env: commandEnv(),
        timeoutMs: timeout,
        maxOutputChars: 100_000,
      });
      const text = [
        `exitCode: ${result.code}${result.timedOut ? " (timed out)" : ""}`,
        result.stdout ? `stdout:\n${result.stdout}` : "",
        result.stderr ? `stderr:\n${result.stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const output = outputContent("command output", text);
      if (output.isError) return output;
      return {
        ...output,
        isError: result.code !== 0 || result.timedOut,
        changed: result.code === 0,
      };
    },
  },
  {
    name: "run_skill_script",
    description:
      "Run a script from an approved skill. The exact script hash must already be approved.",
    risk: 2,
    reversible: false,
    parameters: {
      type: "object",
      properties: {
        skill: { type: "string" },
        script: { type: "string", description: "Relative path inside the skill" },
        args: { type: "array", items: { type: "string" } },
      },
      required: ["skill", "script"],
    },
    async execute(args, ctx) {
      const result = await runSkillScript({
        db: ctx.db,
        root: ctx.root,
        skill: asString(args, "skill"),
        script: asString(args, "script"),
        args: asStringArray(args, "args"),
        runner: ctx.processRunner,
      });
      const text = [
        `script: ${result.script}`,
        `exitCode: ${result.code}${result.timedOut ? " (timed out)" : ""}`,
        result.stdout ? `stdout:\n${result.stdout}` : "",
        result.stderr ? `stderr:\n${result.stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const output = outputContent("script output", text);
      if (output.isError) return output;
      return {
        ...output,
        isError: !result.ok,
        changed: result.ok,
      };
    },
  },
  {
    name: "list_sessions",
    description: "List recent assistant sessions for this project.",
    risk: 0,
    reversible: true,
    parameters: { type: "object", properties: { limit: { type: "number" } } },
    async execute(args, ctx) {
      return {
        content: JSON.stringify(
          listSessions(ctx.db, {
            projectId: ctx.projectId,
            agentId: ctx.agentId,
            limit: Math.max(1, Math.min(50, asNumber(args, "limit") ?? 10)),
          }),
          null,
          2,
        ),
      };
    },
  },
];

export function toolsByName(): Map<string, ToolDefinition> {
  return new Map(ASSISTANT_TOOLS.map((tool) => [tool.name, tool]));
}

export function toolSchemas(tools: ToolDefinition[] = ASSISTANT_TOOLS) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}
