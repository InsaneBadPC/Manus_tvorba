import { backupExisting } from "./backups.ts";
import { getByPath, removeItemByPath, upsertItem, type MemoryDatabase } from "./db.ts";
import type { MemoryContext } from "./context.ts";
import { containsSecret } from "./extract.ts";
import { validateMemoryInput } from "./store.ts";
import type { MemoryItem, MergeAdapter, MergeCandidate } from "./types.ts";

export interface SimilarGroup {
  name: string;
  scope: MemoryItem["scope"];
  scopeOwner: string;
  items: MemoryItem[];
}

export interface MergeProposal {
  id: number;
  name: string;
  paths: string[];
  keepPath: string;
  mergedName: string;
  mergedDescription: string;
  mergedBody: string;
  mergedTags: string[];
  reason: string;
  status: "pending" | "approved" | "rejected";
  created: string;
  reviewed?: string;
}

interface ProposalRow {
  id: number;
  name: string;
  paths: string;
  keep_path: string;
  merged_name: string;
  merged_description: string;
  merged_body: string;
  merged_tags: string;
  reason: string;
  status: MergeProposal["status"];
  created: string;
  reviewed: string | null;
}

function toProposal(row: ProposalRow): MergeProposal {
  return {
    id: Number(row.id),
    name: row.name,
    paths: JSON.parse(row.paths) as string[],
    keepPath: row.keep_path,
    mergedName: row.merged_name,
    mergedDescription: row.merged_description,
    mergedBody: row.merged_body,
    mergedTags: row.merged_tags ? row.merged_tags.split(" ").filter(Boolean) : [],
    reason: row.reason,
    status: row.status,
    created: row.created,
    ...(row.reviewed ? { reviewed: row.reviewed } : {}),
  };
}

/** Groups same-name entries with different bodies; exact duplicates are handled first. */
export function findSimilarGroups(ctx: MemoryContext): SimilarGroup[] {
  const rows = ctx.db
    .prepare(
      `SELECT path, name, scope, scope_owner
       FROM memory_items
       ORDER BY pinned DESC, updated DESC, id DESC`,
    )
    .all() as Array<{ path: string; name: string; scope: string; scope_owner: string }>;
  const buckets = new Map<string, Array<{ path: string; name: string; scope: string; scope_owner: string }>>();
  for (const row of rows) {
    const key = `${row.scope}\u0000${row.scope_owner}\u0000${row.name.trim().toLowerCase()}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }
  const groups: SimilarGroup[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    const items = bucket
      .map((row) => getByPath(ctx.db, row.path))
      .filter((item): item is MemoryItem => Boolean(item));
    if (items.length < 2) continue;
    const bodies = new Set(items.map((item) => item.body.trim()));
    if (bodies.size < 2) continue;
    groups.push({
      name: items[0]!.name,
      scope: items[0]!.scope,
      scopeOwner: items[0]!.scopeOwner,
      items,
    });
  }
  return groups;
}

function cleanCandidate(raw: MergeCandidate): MergeCandidate | null {
  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 100) : "";
  const description = typeof raw.description === "string" ? raw.description.trim().slice(0, 500) : "";
  if (name.length < 2 || !description) return null;
  const body = typeof raw.body === "string" ? raw.body.slice(0, 20_000) : "";
  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 12)
    : [];
  if (containsSecret(`${name}\n${description}\n${body}`)) return null;
  return {
    name,
    description,
    body,
    tags,
    ...(typeof raw.reason === "string" ? { reason: raw.reason.slice(0, 500) } : {}),
  };
}

/**
 * Asks the curator only for proposals. No memory file changes here; approval is
 * a separate explicit action in the UI or `approve-merge`.
 */
export async function proposeMerges(
  ctx: MemoryContext,
  adapter: MergeAdapter,
  options: { limit?: number } = {},
): Promise<MergeProposal[]> {
  const pendingPaths = new Set(
    (ctx.db
      .prepare("SELECT paths FROM memory_merge_proposals WHERE status = 'pending'")
      .all() as Array<{ paths: string }>).flatMap((row) =>
      (JSON.parse(row.paths) as string[]).sort().join("\u0000"),
    ),
  );
  const groups = findSimilarGroups(ctx).slice(0, Math.max(1, Math.min(20, options.limit ?? 8)));
  const created: MergeProposal[] = [];
  for (const group of groups) {
    const paths = group.items.map((item) => item.relPath);
    if (pendingPaths.has([...paths].sort().join("\u0000"))) continue;
    let candidate: MergeCandidate | null;
    try {
      candidate = await adapter.proposeMerge({
        name: group.name,
        entries: group.items.map((item) => ({
          path: item.relPath,
          name: item.name,
          description: item.description,
          body: item.body,
          tags: item.tags,
        })),
      });
    } catch {
      continue;
    }
    if (!candidate) continue;
    const clean = cleanCandidate(candidate);
    if (!clean) continue;
    try {
      validateMemoryInput({
        ...clean,
        scope: group.scope,
        scopeOwner: group.scopeOwner,
        source: "inferred",
        confidence: 0.8,
      });
    } catch {
      continue;
    }
    const keep = group.items[0]!;
    const row = ctx.db
      .prepare(
        `INSERT INTO memory_merge_proposals
          (name, paths, keep_path, merged_name, merged_description, merged_body,
           merged_tags, reason, status, created)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
         RETURNING *`,
      )
      .get(
        group.name,
        JSON.stringify(paths),
        keep.relPath,
        clean.name,
        clean.description,
        clean.body,
        clean.tags.join(" "),
        clean.reason ?? "",
        new Date().toISOString(),
      ) as unknown as ProposalRow;
    created.push(toProposal(row));
  }
  return created;
}

export function listMergeProposals(
  db: MemoryDatabase,
  options: { status?: MergeProposal["status"]; limit?: number } = {},
): MergeProposal[] {
  const rows = options.status
    ? (db
        .prepare(
          `SELECT * FROM memory_merge_proposals WHERE status = ? ORDER BY created DESC LIMIT ?`,
        )
        .all(options.status, options.limit ?? 50) as unknown as ProposalRow[])
    : (db
        .prepare(`SELECT * FROM memory_merge_proposals ORDER BY created DESC LIMIT ?`)
        .all(options.limit ?? 50) as unknown as ProposalRow[]);
  return rows.map(toProposal);
}

/** Writes the approved merge, then removes the redundant files (with backups). */
export async function approveMerge(ctx: MemoryContext, id: number): Promise<MergeProposal> {
  const row = ctx.db
    .prepare("SELECT * FROM memory_merge_proposals WHERE id = ? AND status = 'pending'")
    .get(id) as ProposalRow | undefined;
  if (!row) throw new Error(`pending merge proposal ${id} not found`);
  const proposal = toProposal(row);
  const items = proposal.paths
    .map((relPath) => getByPath(ctx.db, relPath))
    .filter((item): item is MemoryItem => Boolean(item));
  if (items.length === 0) throw new Error("no memory files from this proposal still exist");
  const keep = items.find((item) => item.relPath === proposal.keepPath) ?? items[0]!;
  const saved = await ctx.store.save(
    {
      name: proposal.mergedName,
      description: proposal.mergedDescription,
      body: proposal.mergedBody,
      tags: proposal.mergedTags,
      scope: keep.scope,
      scopeOwner: keep.scopeOwner,
      source: keep.source,
      confidence: keep.confidence,
      pinned: items.some((item) => item.pinned),
    },
    { path: keep.relPath },
  );
  upsertItem(ctx.db, saved.file);
  for (const item of items) {
    if (item.relPath === keep.relPath) continue;
    await backupExisting(ctx.root, item.relPath);
    await ctx.store.delete(item.relPath);
    removeItemByPath(ctx.db, item.relPath);
  }
  ctx.db
    .prepare("UPDATE memory_merge_proposals SET status = 'approved', reviewed = ? WHERE id = ?")
    .run(new Date().toISOString(), id);
  const updated = ctx.db
    .prepare("SELECT * FROM memory_merge_proposals WHERE id = ?")
    .get(id) as unknown as ProposalRow;
  return toProposal(updated);
}

export function rejectMerge(ctx: MemoryDatabase, id: number): MergeProposal {
  const result = ctx
    .prepare(
      "UPDATE memory_merge_proposals SET status = 'rejected', reviewed = ? WHERE id = ? AND status = 'pending'",
    )
    .run(new Date().toISOString(), id);
  if (Number(result.changes) === 0) throw new Error(`pending merge proposal ${id} not found`);
  return toProposal(
    ctx.prepare("SELECT * FROM memory_merge_proposals WHERE id = ?").get(id) as unknown as ProposalRow,
  );
}
