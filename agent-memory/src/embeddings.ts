import type { MemoryDatabase } from "./db.ts";
import { getByPath } from "./db.ts";
import type { MemoryHit, MemoryItem } from "./types.ts";

export interface EmbeddingAdapter {
  readonly name: string;
  readonly dimensions?: number;
  embed(texts: string[]): Promise<number[][]>;
}

export interface EmbeddingReport {
  attempted: number;
  embedded: number;
  skipped: number;
  model: string;
  dimensions: number;
  errors: string[];
}

export interface SemanticHit extends MemoryHit {
  cosine: number;
}

interface EmbeddingRow {
  id: number;
  path: string;
  hash: string;
  name: string;
  description: string;
  body: string;
  tags: string;
  updated: string;
  scope: string;
  scope_owner: string;
  pinned: number;
  embedding_hash: string | null;
  model: string | null;
  dim: number | null;
  vector: Uint8Array | null;
}

function normalize(vector: number[]): Float32Array {
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm);
  const out = new Float32Array(vector.length);
  if (!norm) return out;
  for (let index = 0; index < vector.length; index += 1) {
    out[index] = vector[index]! / norm;
  }
  return out;
}

function encode(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

function decode(value: Uint8Array): Float32Array {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return new Float32Array(copy.buffer);
}

function textFor(row: { name: string; description: string; body: string; tags: string }): string {
  return `${row.name}\n${row.description}\n${row.body}\n${row.tags}`.slice(0, 30_000);
}

function scopeBonus(scope: string): number {
  if (scope === "agent") return 0.3;
  if (scope === "project") return 0.2;
  return 0.1;
}

function recencyBonus(updated: string, now: Date): number {
  const time = Date.parse(updated);
  if (!Number.isFinite(time)) return 0;
  const ageDays = Math.max(0, (now.getTime() - time) / 86_400_000);
  return 0.15 / (1 + ageDays / 30);
}

/** Embeds only new/changed memory rows; existing vectors are reused. */
export async function ensureEmbeddings(
  db: MemoryDatabase,
  adapter: EmbeddingAdapter,
  options: { force?: boolean; batchSize?: number } = {},
): Promise<EmbeddingReport> {
  const rows = db
    .prepare(
      `SELECT m.id, m.path, m.hash, m.name, m.description, m.body, m.tags,
              m.updated, m.scope, m.scope_owner, m.pinned,
              e.hash AS embedding_hash, e.model, e.dim, e.vector
       FROM memory_items m
       LEFT JOIN memory_embeddings e ON e.item_id = m.id`,
    )
    .all() as unknown as EmbeddingRow[];
  const pending = rows.filter(
    (row) =>
      options.force ||
      !row.embedding_hash ||
      row.embedding_hash !== row.hash ||
      row.model !== adapter.name ||
      (adapter.dimensions !== undefined && row.dim !== adapter.dimensions),
  );
  const report: EmbeddingReport = {
    attempted: pending.length,
    embedded: 0,
    skipped: rows.length - pending.length,
    model: adapter.name,
    dimensions: adapter.dimensions ?? 0,
    errors: [],
  };
  const batchSize = Math.max(1, Math.min(32, options.batchSize ?? 16));
  const insert = db.prepare(
    `INSERT INTO memory_embeddings(item_id, hash, model, dim, vector, updated)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET
       hash=excluded.hash, model=excluded.model, dim=excluded.dim,
       vector=excluded.vector, updated=excluded.updated`,
  );

  for (let start = 0; start < pending.length; start += batchSize) {
    const batch = pending.slice(start, start + batchSize);
    let vectors: number[][];
    try {
      vectors = await adapter.embed(batch.map(textFor));
    } catch (error) {
      report.errors.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    if (vectors.length !== batch.length) {
      report.errors.push(`adapter returned ${vectors.length} vectors for ${batch.length} rows`);
      continue;
    }
    db.exec("BEGIN");
    try {
      for (let index = 0; index < batch.length; index += 1) {
        const row = batch[index]!;
        const vector = vectors[index];
        if (!Array.isArray(vector) || vector.length === 0) {
          report.errors.push(`empty vector for ${row.path}`);
          continue;
        }
        if (adapter.dimensions !== undefined && vector.length !== adapter.dimensions) {
          report.errors.push(
            `vector for ${row.path} has ${vector.length} dimensions, expected ${adapter.dimensions}`,
          );
          continue;
        }
        const normalized = normalize(vector);
        insert.run(
          row.id,
          row.hash,
          adapter.name,
          normalized.length,
          encode(normalized),
          new Date().toISOString(),
        );
        report.embedded += 1;
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      report.errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return report;
}

export async function embeddingStatus(
  db: MemoryDatabase,
  adapter: EmbeddingAdapter,
): Promise<{ ready: number; stale: number; total: number }> {
  const rows = db
    .prepare(
      `SELECT m.hash, e.hash AS embedding_hash, e.model
       FROM memory_items m LEFT JOIN memory_embeddings e ON e.item_id = m.id`,
    )
    .all() as Array<{ hash: string; embedding_hash: string | null; model: string | null }>;
  const ready = rows.filter(
    (row) => row.embedding_hash === row.hash && row.model === adapter.name,
  ).length;
  return { ready, stale: rows.length - ready, total: rows.length };
}

export async function embedQuery(
  adapter: EmbeddingAdapter,
  query: string,
): Promise<Float32Array> {
  const vectors = await adapter.embed([query.slice(0, 8_000)]);
  if (!vectors[0]?.length) throw new Error("embedding adapter returned no query vector");
  return normalize(vectors[0]);
}

export interface SemanticOptions {
  projectId?: string;
  agentId?: string;
  limit?: number;
  allScopes?: boolean;
  minCosine?: number;
  now?: Date;
}

/** Cosine search over the local vector table; scope visibility matches FTS. */
export function semanticSearch(
  db: MemoryDatabase,
  query: Float32Array,
  model: string,
  options: SemanticOptions = {},
): SemanticHit[] {
  const filters: string[] = ["e.model = ?", "e.hash = m.hash", "e.dim = ?"];
  const params: Array<string | number> = [model, query.length];
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
  const rows = db
    .prepare(
      `SELECT m.id, m.path, m.hash, m.name, m.description, m.body, m.tags,
              m.updated, m.scope, m.scope_owner, m.pinned,
              e.hash AS embedding_hash, e.model, e.dim, e.vector
       FROM memory_embeddings e JOIN memory_items m ON m.id = e.item_id
       WHERE ${filters.join(" AND ")}`,
    )
    .all(...params) as unknown as EmbeddingRow[];
  const now = options.now ?? new Date();
  const minCosine = options.minCosine ?? 0.2;
  const hits: SemanticHit[] = [];
  for (const row of rows) {
    if (!row.vector) continue;
    const vector = decode(row.vector);
    if (vector.length !== query.length) continue;
    let cosine = 0;
    for (let index = 0; index < vector.length; index += 1) {
      cosine += vector[index]! * query[index]!;
    }
    if (cosine < minCosine) continue;
    const item = getByPath(db, row.path);
    if (!item) continue;
    hits.push({
      item,
      cosine,
      rank: -cosine,
      score:
        cosine * 2 +
        scopeBonus(item.scope) +
        (item.pinned ? 0.4 : 0) +
        recencyBonus(item.updated, now),
    });
  }
  hits.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
  const limit = Math.max(1, Math.min(50, options.limit ?? 8));
  const seen = new Set<string>();
  const unique: SemanticHit[] = [];
  for (const hit of hits) {
    const key = hit.item.relPath;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(hit);
    if (unique.length >= limit) break;
  }
  return unique;
}

export type { MemoryItem };
