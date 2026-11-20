import readline from "node:readline";
import { getByName, getByPath, upsertItem } from "./db.ts";
import { containsSecret, validateCandidate } from "./extract.ts";
import { searchMemory } from "./retrieval.ts";
import {
  getSkillStats,
  loadSkill,
  proposeSkill,
  routeSkill,
  scanSkills,
  syncSkills,
} from "./skills.ts";
import type { MemoryContext } from "./context.ts";

type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class RpcError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = "RpcError";
    this.code = code;
  }
}

const TOOLS = [
  {
    name: "memory_search",
    description: "Search durable memory for the current project/agent.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for" },
        limit: { type: "number", description: "Maximum results (default 8)" },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_read",
    description: "Read one full memory entry by name or path.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        path: { type: "string" },
      },
    },
  },
  {
    name: "memory_write",
    description:
      "Store one durable fact. Secrets and ephemeral notes are rejected. Same name updates the entry.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        body: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        scope: { type: "string", enum: ["global", "project", "agent"] },
        confidence: { type: "number" },
        pinned: { type: "boolean" },
      },
      required: ["name", "description"],
    },
  },
  {
    name: "skill_list",
    description: "List installed skills and their status.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "skill_load",
    description: "Load the full instructions of one skill.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
  {
    name: "skill_propose",
    description: "Propose a new skill draft for later user approval.",
    inputSchema: {
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
  },
] as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new RpcError(-32602, `${key} must be a non-empty string`);
  }
  return value.trim();
}

function textResult(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function toolError(message: string): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return { content: [{ type: "text", text: message }], isError: true };
}

async function callTool(
  name: string,
  rawArgs: unknown,
  ctx: MemoryContext,
): Promise<unknown> {
  const args = asRecord(rawArgs);

  switch (name) {
    case "memory_search": {
      const query = requiredString(args, "query");
      const limit =
        typeof args.limit === "number" && Number.isFinite(args.limit)
          ? Math.max(1, Math.min(20, Math.trunc(args.limit)))
          : 8;
      const hits = searchMemory(ctx.db, query, {
        projectId: ctx.projectId,
        agentId: ctx.agentId,
        limit,
      });
      return textResult(
        hits.map((hit) => ({
          name: hit.item.name,
          description: hit.item.description,
          scope: hit.item.scope,
          path: hit.item.relPath,
          pinned: hit.item.pinned,
          score: Number(hit.score.toFixed(3)),
        })),
      );
    }

    case "memory_read": {
      const byName = typeof args.name === "string" ? args.name.trim() : "";
      const byPath = typeof args.path === "string" ? args.path.trim() : "";
      const item = byPath ? getByPath(ctx.db, byPath) : byName ? getByName(ctx.db, byName) : undefined;
      if (!item) return toolError("memory entry not found");
      return textResult(item);
    }

    case "memory_write": {
      const validation = validateCandidate(
        {
          name: args.name,
          description: args.description,
          body: args.body,
          tags: args.tags,
          scope: args.scope,
          confidence: args.confidence,
          source: args.source ?? "stated",
        },
        { projectId: ctx.projectId, agentId: ctx.agentId },
      );
      if (!validation.ok) return toolError(validation.reason);
      const candidate = validation.value;
      if (containsSecret(`${candidate.name}\n${candidate.description}\n${candidate.body}`)) {
        return toolError("possible secret: write rejected");
      }
      const { file } = await ctx.store.save({
        name: candidate.name,
        description: candidate.description,
        body: candidate.body,
        scope: candidate.scope,
        source: candidate.source,
        confidence: candidate.confidence,
        pinned: args.pinned === true,
        tags: candidate.tags,
      });
      upsertItem(ctx.db, file);
      return textResult({ saved: true, path: file.relPath, name: file.data.name });
    }

    case "skill_list": {
      const scan = await scanSkills(ctx.root);
      return textResult(
        scan.skills.map((skill) => ({
          name: skill.manifest.name,
          description: skill.manifest.description,
          triggers: skill.manifest.triggers,
          status: skill.manifest.status,
          version: skill.manifest.version,
          permissions: skill.manifest.permissions,
          stats: getSkillStats(ctx.db, skill.manifest.name),
          path: skill.relPath,
        })),
      );
    }

    case "skill_load": {
      const name = requiredString(args, "name");
      const skill = loadSkill(ctx.db, name);
      if (!skill) return toolError(`skill '${name}' not found`);
      return textResult({
        name: skill.manifest.name,
        description: skill.manifest.description,
        status: skill.manifest.status,
        triggers: skill.manifest.triggers,
        allowedTools: skill.manifest.allowedTools,
        permissions: skill.manifest.permissions,
        instructions: skill.body,
      });
    }

    case "skill_propose": {
      const name = requiredString(args, "name");
      const description = requiredString(args, "description");
      const body = requiredString(args, "body");
      if (containsSecret(body)) return toolError("possible secret: proposal rejected");
      const proposal = await proposeSkill(ctx.root, {
        name,
        description,
        body,
        triggers: Array.isArray(args.triggers)
          ? args.triggers.filter((entry): entry is string => typeof entry === "string")
          : [],
        permissions: Array.isArray(args.permissions)
          ? args.permissions.filter((entry): entry is string => typeof entry === "string")
          : [],
        status: "draft",
      });
      await syncSkills(ctx.db, ctx.root);
      return textResult({
        proposed: true,
        path: proposal.relPath,
        status: "draft",
        note: "a draft needs user approval before it can be routed",
      });
    }

    default:
      throw new RpcError(-32602, `unknown tool '${name}'`);
  }
}

export async function handleRequest(
  request: JsonRpcRequest,
  ctx: MemoryContext,
): Promise<JsonRpcResponse | null> {
  const id = request.id ?? null;
  const isNotification = request.id === undefined;

  try {
    if (!request || typeof request !== "object" || typeof request.method !== "string") {
      throw new RpcError(-32600, "invalid JSON-RPC request");
    }

    switch (request.method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "insane-agent-memory", version: "0.1.0" },
          },
        };

      case "notifications/initialized":
      case "notifications/cancelled":
        return null;

      case "ping":
        return { jsonrpc: "2.0", id, result: {} };

      case "tools/list":
        return { jsonrpc: "2.0", id, result: { tools: TOOLS } };

      case "tools/call": {
        const params = asRecord(request.params);
        const name = typeof params.name === "string" ? params.name : "";
        if (!name) throw new RpcError(-32602, "tool name is required");
        const result = await callTool(name, params.arguments, ctx);
        return { jsonrpc: "2.0", id, result };
      }

      default:
        throw new RpcError(-32601, `method '${request.method}' not found`);
    }
  } catch (error) {
    if (isNotification) return null;
    if (error instanceof RpcError) {
      return { jsonrpc: "2.0", id, error: { code: error.code, message: error.message } };
    }
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : "internal error",
      },
    };
  }
}

export async function runMcpServer(ctx: MemoryContext): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
    terminal: false,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let request: JsonRpcRequest;
    try {
      request = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "parse error" },
        })}\n`,
      );
      continue;
    }
    const response = await handleRequest(request, ctx);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}
