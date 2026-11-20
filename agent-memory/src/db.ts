import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { DatabaseSync as SqliteDatabase } from "node:sqlite";
import type { MemoryFile, MemoryItem, MemoryScope } from "./types.ts";

// Vitest 2 still ships a Vite version that does not know the `node:sqlite`
// builtin. Loading it through require keeps the native module external while
// behaving the same in plain Node.
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
import type { MemoryStore } from "./store.ts";

export type MemoryDatabase = SqliteDatabase;

const SCHEMA_VERSION = 3;

export function databasePath(root: string): string {
  return path.join(root, "index.db");
}

export function openDatabase(root: string): MemoryDatabase {
  fs.mkdirSync(root, { recursive: true });
  const db = new DatabaseSync(databasePath(root));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

export function migrate(db: MemoryDatabase): void {
  const version = Number(
    (db.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined)
      ?.user_version ?? 0,
  );
  if (version >= SCHEMA_VERSION) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_items (
      id INTEGER PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      hash TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL,
      scope_owner TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'inferred',
      confidence REAL NOT NULL DEFAULT 0.5,
      pinned INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '',
      created TEXT NOT NULL,
      updated TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS memory_items_scope ON memory_items(scope, scope_owner);
    CREATE INDEX IF NOT EXISTS memory_items_name ON memory_items(name COLLATE NOCASE);
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      name, description, body, tags,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    CREATE TABLE IF NOT EXISTS episodes (
      id INTEGER PRIMARY KEY,
      project TEXT NOT NULL DEFAULT '',
      agent TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'note',
      text TEXT NOT NULL,
      session TEXT NOT NULL DEFAULT '',
      success INTEGER NOT NULL DEFAULT 1,
      tools TEXT NOT NULL DEFAULT '',
      meta TEXT NOT NULL DEFAULT '{}',
      created TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS episodes_scope ON episodes(project, agent, created);
    CREATE INDEX IF NOT EXISTS episodes_session ON episodes(session, created);
    CREATE VIRTUAL TABLE IF NOT EXISTS episodes_fts USING fts5(
      text, tokenize = 'unicode61 remove_diacritics 2'
    );

    CREATE TABLE IF NOT EXISTS skills (
      id INTEGER PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      hash TEXT NOT NULL,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      triggers TEXT NOT NULL DEFAULT '',
      allowed_tools TEXT NOT NULL DEFAULT '',
      permissions TEXT NOT NULL DEFAULT '',
      version TEXT NOT NULL DEFAULT '1.0.0',
      status TEXT NOT NULL DEFAULT 'active',
      body TEXT NOT NULL DEFAULT ''
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5(
      name, description, triggers,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    CREATE TABLE IF NOT EXISTS skill_stats (
      skill_id INTEGER PRIMARY KEY REFERENCES skills(id) ON DELETE CASCADE,
      uses INTEGER NOT NULL DEFAULT 0,
      successes INTEGER NOT NULL DEFAULT 0,
      failures INTEGER NOT NULL DEFAULT 0,
      last_used TEXT
    );

    CREATE TABLE IF NOT EXISTS skill_approvals (
      skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      script_hash TEXT NOT NULL,
      approved_at TEXT NOT NULL,
      PRIMARY KEY (skill_id, script_hash)
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assistant_sessions (
      id TEXT PRIMARY KEY,
      project TEXT NOT NULL DEFAULT '',
      agent TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      created TEXT NOT NULL,
      updated TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS assistant_sessions_scope
      ON assistant_sessions(project, agent, updated);

    CREATE TABLE IF NOT EXISTS assistant_messages (
      id INTEGER PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES assistant_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      tool_calls TEXT NOT NULL DEFAULT '[]',
      tool_call_id TEXT,
      name TEXT,
      created TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS assistant_messages_session
      ON assistant_messages(session_id, id);
  `);
  // Databases created before schema v2 lack episode metadata columns.
  const columns = new Set(
    (db.prepare("PRAGMA table_info(episodes)").all() as Array<{ name: string }>).map(
      (row) => row.name,
    ),
  );
  const missing: Array<[string, string]> = [
    ["session", "TEXT NOT NULL DEFAULT ''"],
    ["success", "INTEGER NOT NULL DEFAULT 1"],
    ["tools", "TEXT NOT NULL DEFAULT ''"],
    ["meta", "TEXT NOT NULL DEFAULT '{}'"],
  ];
  for (const [name, definition] of missing) {
    if (!columns.has(name)) db.exec(`ALTER TABLE episodes ADD COLUMN ${name} ${definition}`);
  }
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

export interface SyncReport {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
  errors: { relPath: string; message: string }[];
}

interface Row {
  id: number;
  path: string;
  hash: string;
  name: string;
  description: string;
  body: string;
  scope: string;
  scope_owner: string;
  source: string;
  confidence: number;
  pinned: number;
  tags: string;
  created: string;
  updated: string;
}

function toItem(row: Row): MemoryItem {
  return {
    id: Number(row.id),
    relPath: row.path,
    hash: row.hash,
    name: row.name,
    description: row.description,
    body: row.body,
    scope: row.scope as MemoryScope,
    scopeOwner: row.scope_owner,
    source: row.source as MemoryItem["source"],
    confidence: Number(row.confidence),
    pinned: Number(row.pinned) === 1,
    tags: row.tags ? row.tags.split(" ").filter(Boolean) : [],
    created: row.created,
    updated: row.updated,
  };
}

export function upsertItem(db: MemoryDatabase, file: MemoryFile): number {
  const data = file.data;
  const tags = data.tags.join(" ");
  const row = db
    .prepare(
      `INSERT INTO memory_items
        (path, hash, name, description, body, scope, scope_owner, source,
         confidence, pinned, tags, created, updated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         hash=excluded.hash, name=excluded.name, description=excluded.description,
         body=excluded.body, scope=excluded.scope, scope_owner=excluded.scope_owner,
         source=excluded.source, confidence=excluded.confidence, pinned=excluded.pinned,
         tags=excluded.tags, created=excluded.created, updated=excluded.updated
       RETURNING id`,
    )
    .get(
      file.relPath,
      file.hash,
      data.name,
      data.description,
      file.body,
      data.scope,
      data.scopeOwner,
      data.source,
      data.confidence,
      data.pinned ? 1 : 0,
      tags,
      data.created,
      data.updated,
    ) as { id: number };

  const id = Number(row.id);
  db.prepare("DELETE FROM memory_fts WHERE rowid = ?").run(id);
  db.prepare(
    "INSERT INTO memory_fts(rowid, name, description, body, tags) VALUES (?, ?, ?, ?, ?)",
  ).run(id, data.name, data.description, file.body, tags);
  return id;
}

export function removeItemByPath(db: MemoryDatabase, relPath: string): void {
  const row = db.prepare("SELECT id FROM memory_items WHERE path = ?").get(relPath) as
    | { id: number }
    | undefined;
  if (!row) return;
  db.prepare("DELETE FROM memory_fts WHERE rowid = ?").run(Number(row.id));
  db.prepare("DELETE FROM memory_items WHERE id = ?").run(Number(row.id));
}

export async function syncIndex(
  db: MemoryDatabase,
  store: MemoryStore,
): Promise<SyncReport> {
  const scan = await store.scan();
  const files = new Map(scan.files.map((file) => [file.relPath, file]));
  const existing = new Map<string, { id: number; hash: string }>();
  for (const row of db.prepare("SELECT id, path, hash FROM memory_items").all() as Array<{
    id: number;
    path: string;
    hash: string;
  }>) {
    existing.set(row.path, { id: Number(row.id), hash: row.hash });
  }

  const report: SyncReport = {
    added: 0,
    updated: 0,
    removed: 0,
    unchanged: 0,
    errors: scan.errors.map((error) => ({
      relPath: error.relPath,
      message: error.message,
    })),
  };

  db.exec("BEGIN");
  try {
    for (const [relPath] of existing) {
      if (!files.has(relPath)) {
        removeItemByPath(db, relPath);
        report.removed += 1;
      }
    }
    for (const [relPath, file] of files) {
      const previous = existing.get(relPath);
      if (previous && previous.hash === file.hash) {
        report.unchanged += 1;
        continue;
      }
      upsertItem(db, file);
      if (previous) report.updated += 1;
      else report.added += 1;
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return report;
}

export function getByPath(db: MemoryDatabase, relPath: string): MemoryItem | undefined {
  const row = db.prepare("SELECT * FROM memory_items WHERE path = ?").get(relPath) as
    | Row
    | undefined;
  return row ? toItem(row) : undefined;
}

export function getByName(db: MemoryDatabase, name: string): MemoryItem | undefined {
  const row = db
    .prepare("SELECT * FROM memory_items WHERE name = ? COLLATE NOCASE ORDER BY pinned DESC, updated DESC LIMIT 1")
    .get(name) as Row | undefined;
  return row ? toItem(row) : undefined;
}

export interface QueryOptions {
  projectId?: string;
  agentId?: string;
  limit?: number;
  allScopes?: boolean;
}

export interface RankedItem {
  item: MemoryItem;
  rank: number;
}

/**
 * Runs an FTS5 MATCH query and applies the scope visibility rule:
 * global memories are always visible, project/agent ones only for the current owner.
 */
export function queryMemory(
  db: MemoryDatabase,
  match: string,
  options: QueryOptions = {},
): RankedItem[] {
  if (!match.trim()) return [];
  const limit = Math.max(1, Math.min(100, options.limit ?? 20));
  const filters: string[] = [];
  const params: Array<string | number> = [match];

  if (!options.allScopes) {
    const visible: string[] = ["m.scope = 'global'"];
    if (options.projectId) {
      visible.push("(m.scope = 'project' AND m.scope_owner = ?)");
      params.push(options.projectId);
    }
    if (options.agentId) {
      visible.push("(m.scope = 'agent' AND m.scope_owner = ?)");
      params.push(options.agentId);
    }
    filters.push(`(${visible.join(" OR ")})`);
  }
  params.push(limit);

  const sql = `
    SELECT m.*, bm25(memory_fts, 2.0, 1.5, 1.0, 0.5) AS rank
    FROM memory_fts
    JOIN memory_items m ON m.id = memory_fts.rowid
    WHERE memory_fts MATCH ?
    ${filters.length ? `AND ${filters.join(" AND ")}` : ""}
    ORDER BY rank
    LIMIT ?
  `;
  const rows = db.prepare(sql).all(...params) as unknown as Array<Row & { rank: number }>;
  return rows.map((row) => ({ item: toItem(row), rank: Number(row.rank) }));
}

export function countMemory(db: MemoryDatabase): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM memory_items").get() as { n: number };
  return Number(row.n);
}

export function rebuildIndex(db: MemoryDatabase): void {
  db.exec("DELETE FROM memory_fts");
  db.exec("DELETE FROM memory_items");
}
