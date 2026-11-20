import { randomUUID } from "node:crypto";
import type { MemoryDatabase } from "../db.ts";
import type { ChatMessage, ChatToolCall } from "./types.ts";

export interface AssistantSession {
  id: string;
  project: string;
  agent: string;
  model: string;
  created: string;
  updated: string;
}

interface SessionRow {
  id: string;
  project: string;
  agent: string;
  model: string;
  created: string;
  updated: string;
}

interface MessageRow {
  id: number;
  role: string;
  content: string;
  tool_calls: string;
  tool_call_id: string | null;
  name: string | null;
  created: string;
}

function toSession(row: SessionRow): AssistantSession {
  return { ...row };
}

function parseCalls(raw: string): ChatToolCall[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const calls: ChatToolCall[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const value = entry as Record<string, unknown>;
      if (typeof value.id !== "string" || typeof value.name !== "string") continue;
      const args = value.arguments;
      calls.push({
        id: value.id,
        name: value.name,
        arguments: args && typeof args === "object" && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : {},
      });
    }
    return calls;
  } catch {
    return [];
  }
}

function toMessage(row: MessageRow): ChatMessage {
  const role = row.role === "assistant" || row.role === "tool" ? row.role : "user";
  return {
    role,
    content: row.content,
    ...(role === "assistant" && parseCalls(row.tool_calls).length > 0
      ? { toolCalls: parseCalls(row.tool_calls) }
      : {}),
    ...(row.tool_call_id ? { toolCallId: row.tool_call_id } : {}),
    ...(row.name ? { name: row.name } : {}),
    created: row.created,
  };
}

export function ensureSession(
  db: MemoryDatabase,
  options: {
    id?: string;
    projectId?: string;
    agentId?: string;
    model?: string;
  } = {},
): AssistantSession {
  const id = options.id?.trim().slice(0, 120) || randomUUID();
  const now = new Date().toISOString();
  const existing = db
    .prepare("SELECT * FROM assistant_sessions WHERE id = ?")
    .get(id) as SessionRow | undefined;
  if (existing) {
    db.prepare("UPDATE assistant_sessions SET updated = ?, model = ? WHERE id = ?").run(
      now,
      options.model ?? existing.model,
      id,
    );
    return { ...toSession(existing), updated: now, model: options.model ?? existing.model };
  }
  db.prepare(
    `INSERT INTO assistant_sessions(id, project, agent, model, created, updated)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    options.projectId?.trim() ?? "",
    options.agentId?.trim() ?? "",
    options.model?.trim() ?? "",
    now,
    now,
  );
  return {
    id,
    project: options.projectId?.trim() ?? "",
    agent: options.agentId?.trim() ?? "",
    model: options.model?.trim() ?? "",
    created: now,
    updated: now,
  };
}

export function appendMessage(
  db: MemoryDatabase,
  sessionId: string,
  message: ChatMessage,
): void {
  const content = message.content.slice(0, 100_000);
  const calls = message.toolCalls?.length ? JSON.stringify(message.toolCalls) : "[]";
  db.prepare(
    `INSERT INTO assistant_messages
      (session_id, role, content, tool_calls, tool_call_id, name, created)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    message.role,
    content,
    calls,
    message.toolCallId ?? null,
    message.name ?? null,
    message.created ?? new Date().toISOString(),
  );
  db.prepare("UPDATE assistant_sessions SET updated = ? WHERE id = ?").run(
    new Date().toISOString(),
    sessionId,
  );
}

export function loadMessages(
  db: MemoryDatabase,
  sessionId: string,
  options: { limit?: number; maxChars?: number } = {},
): ChatMessage[] {
  const limit = Math.max(1, Math.min(500, options.limit ?? 60));
  const maxChars = Math.max(1_000, options.maxChars ?? 60_000);
  const rows = db
    .prepare(
      `SELECT * FROM assistant_messages WHERE session_id = ?
       ORDER BY id DESC LIMIT ?`,
    )
    .all(sessionId, limit) as unknown as MessageRow[];
  const messages = rows.reverse().map(toMessage);
  const kept: ChatMessage[] = [];
  let chars = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as ChatMessage;
    const size = message.content.length + JSON.stringify(message.toolCalls ?? []).length;
    if (kept.length > 0 && chars + size > maxChars) break;
    kept.unshift(message);
    chars += size;
  }
  return kept;
}

export function getSession(
  db: MemoryDatabase,
  sessionId: string,
): AssistantSession | undefined {
  const row = db
    .prepare("SELECT * FROM assistant_sessions WHERE id = ?")
    .get(sessionId) as SessionRow | undefined;
  return row ? toSession(row) : undefined;
}

export function listSessions(
  db: MemoryDatabase,
  options: { projectId?: string; agentId?: string; limit?: number } = {},
): AssistantSession[] {
  const limit = Math.max(1, Math.min(100, options.limit ?? 20));
  const filters: string[] = [];
  const params: Array<string | number> = [];
  if (options.projectId !== undefined) {
    filters.push("project = ?");
    params.push(options.projectId);
  }
  if (options.agentId !== undefined) {
    filters.push("agent = ?");
    params.push(options.agentId);
  }
  params.push(limit);
  const rows = db
    .prepare(
      `SELECT * FROM assistant_sessions
       ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
       ORDER BY updated DESC LIMIT ?`,
    )
    .all(...params) as unknown as SessionRow[];
  return rows.map(toSession);
}
