import { buildFtsQuery } from "./retrieval.ts";
import type { MemoryDatabase } from "./db.ts";
import type { Episode, EpisodeInput, EpisodeKind } from "./types.ts";
import { EPISODE_KINDS } from "./types.ts";

interface EpisodeRow {
  id: number;
  project: string;
  agent: string;
  kind: string;
  text: string;
  session: string;
  success: number;
  tools: string;
  meta: string;
  created: string;
}

function toEpisode(row: EpisodeRow): Episode {
  let meta: Record<string, unknown> = {};
  if (row.meta) {
    try {
      const parsed = JSON.parse(row.meta) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        meta = parsed as Record<string, unknown>;
      }
    } catch {
      // A malformed metadata blob must not make the episode unreadable.
    }
  }
  return {
    id: Number(row.id),
    project: row.project,
    agent: row.agent,
    kind: (EPISODE_KINDS as readonly string[]).includes(row.kind)
      ? (row.kind as EpisodeKind)
      : "note",
    text: row.text,
    session: row.session,
    success: Number(row.success) === 1,
    tools: row.tools ? row.tools.split("\n").filter(Boolean) : [],
    meta,
    created: row.created,
  };
}

function cleanTools(tools: unknown): string[] {
  if (!Array.isArray(tools)) return [];
  const result: string[] = [];
  for (const tool of tools) {
    if (typeof tool !== "string") continue;
    const clean = tool.trim().slice(0, 64).replace(/\s+/g, "-");
    if (clean && !result.includes(clean)) result.push(clean);
    if (result.length >= 20) break;
  }
  return result;
}

/** Logs one deterministic episode. No model decides whether it is stored. */
export function logEpisode(
  db: MemoryDatabase,
  input: EpisodeInput,
  now: () => Date = () => new Date(),
): Episode {
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text) throw new Error("episode text is required");
  if (text.length > 4_000) throw new Error("episode text exceeds 4000 characters");
  const kind: EpisodeKind = input.kind ?? "note";
  if (!(EPISODE_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`unknown episode kind '${String(kind)}'`);
  }
  const tools = cleanTools(input.tools);
  const created = input.created?.trim() || now().toISOString();
  if (Number.isNaN(Date.parse(created))) throw new Error("episode created is not a date");
  const meta = input.meta && typeof input.meta === "object" ? input.meta : {};
  const metaJson = JSON.stringify(meta);
  if (metaJson.length > 4_000) throw new Error("episode metadata is too large");

  const row = db
    .prepare(
      `INSERT INTO episodes
        (project, agent, kind, text, session, success, tools, meta, created)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    )
    .get(
      input.projectId?.trim() ?? "",
      input.agentId?.trim() ?? "",
      kind,
      text,
      input.session?.trim().slice(0, 200) ?? "",
      (input.success ?? (kind !== "error")) ? 1 : 0,
      tools.join("\n"),
      metaJson,
      created,
    ) as { id: number };

  const id = Number(row.id);
  db.prepare("INSERT INTO episodes_fts(rowid, text) VALUES (?, ?)").run(id, text);
  const saved = db.prepare("SELECT * FROM episodes WHERE id = ?").get(id) as
    | EpisodeRow
    | undefined;
  if (!saved) throw new Error("episode was not stored");
  return toEpisode(saved);
}

export interface EpisodeQuery {
  projectId?: string;
  agentId?: string;
  session?: string;
  limit?: number;
  since?: string;
}

function scopeFilter(
  options: EpisodeQuery,
  params: Array<string | number>,
): string {
  const filters: string[] = [];
  if (options.projectId !== undefined) {
    filters.push("project = ?");
    params.push(options.projectId);
  }
  if (options.agentId !== undefined) {
    filters.push("agent = ?");
    params.push(options.agentId);
  }
  if (options.session !== undefined) {
    filters.push("session = ?");
    params.push(options.session);
  }
  if (options.since) {
    filters.push("created >= ?");
    params.push(options.since);
  }
  return filters.length ? `WHERE ${filters.join(" AND ")}` : "";
}

export function listEpisodes(
  db: MemoryDatabase,
  options: EpisodeQuery = {},
): Episode[] {
  const limit = Math.max(1, Math.min(500, options.limit ?? 100));
  const params: Array<string | number> = [];
  const where = scopeFilter(options, params);
  params.push(limit);
  const rows = db
    .prepare(`SELECT * FROM episodes ${where} ORDER BY created DESC, id DESC LIMIT ?`)
    .all(...params) as unknown as EpisodeRow[];
  return rows.map(toEpisode);
}

export function searchEpisodes(
  db: MemoryDatabase,
  query: string,
  options: EpisodeQuery = {},
): Episode[] {
  const match = buildFtsQuery(query);
  if (!match) return [];
  const limit = Math.max(1, Math.min(100, options.limit ?? 20));
  const params: Array<string | number> = [match];
  const filters: string[] = [];
  if (options.projectId !== undefined) {
    filters.push("e.project = ?");
    params.push(options.projectId);
  }
  if (options.agentId !== undefined) {
    filters.push("e.agent = ?");
    params.push(options.agentId);
  }
  if (options.session !== undefined) {
    filters.push("e.session = ?");
    params.push(options.session);
  }
  if (options.since) {
    filters.push("e.created >= ?");
    params.push(options.since);
  }
  params.push(limit);
  const rows = db
    .prepare(
      `SELECT e.*
       FROM episodes_fts
       JOIN episodes e ON e.id = episodes_fts.rowid
       WHERE episodes_fts MATCH ?
       ${filters.length ? `AND ${filters.join(" AND ")}` : ""}
       ORDER BY bm25(episodes_fts), e.created DESC
       LIMIT ?`,
    )
    .all(...params) as unknown as EpisodeRow[];
  return rows.map(toEpisode);
}

export function countEpisodes(db: MemoryDatabase): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM episodes").get() as { n: number };
  return Number(row.n);
}

/** Deletes raw episodes older than the retention window (used by consolidation). */
export function pruneEpisodes(
  db: MemoryDatabase,
  retentionDays = 30,
  now: () => Date = () => new Date(),
): number {
  const days = Math.max(1, Math.floor(retentionDays));
  const cutoff = new Date(now().getTime() - days * 86_400_000).toISOString();
  const ids = db
    .prepare("SELECT id FROM episodes WHERE created < ?")
    .all(cutoff) as Array<{ id: number }>;
  if (ids.length === 0) return 0;
  db.exec("BEGIN");
  try {
    for (const row of ids) {
      db.prepare("DELETE FROM episodes_fts WHERE rowid = ?").run(Number(row.id));
    }
    db.prepare("DELETE FROM episodes WHERE created < ?").run(cutoff);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return ids.length;
}
