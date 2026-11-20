import { removeItemByPath } from "./db.ts";
import type { MemoryContext } from "./context.ts";
import type { MemoryItem } from "./types.ts";

interface Row {
  id: number;
  path: string;
  name: string;
  description: string;
  body: string;
  scope: MemoryItem["scope"];
  scope_owner: string;
  updated: string;
}

export interface DuplicateGroup {
  name: string;
  paths: string[];
}

export interface DedupeResult {
  groups: DuplicateGroup[];
  removed: number;
  kept: number;
  errors: string[];
}

function key(row: Row): string {
  return [
    row.scope,
    row.scope_owner,
    row.name.trim().toLowerCase(),
    row.description.trim(),
    row.body.trim(),
  ].join("\u0000");
}

/**
 * Finds only byte-equivalent entries in the same scope. Similar memories with
 * different bodies are deliberately left alone; merging those needs a human or
 * a curator, not a destructive guess.
 */
export function findExactDuplicateGroups(ctx: MemoryContext): DuplicateGroup[] {
  const rows = ctx.db
    .prepare(
      `SELECT id, path, name, description, body, scope, scope_owner, updated
       FROM memory_items
       ORDER BY pinned DESC, updated DESC, id DESC`,
    )
    .all() as unknown as Row[];
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const bucket = groups.get(key(row));
    if (bucket) bucket.push(row);
    else groups.set(key(row), [row]);
  }
  return [...groups.values()]
    .filter((bucket) => bucket.length > 1)
    .map((bucket) => ({
      name: bucket[0]?.name ?? "",
      paths: bucket.map((row) => row.path),
    }));
}

/**
 * Deletes exact duplicate files, keeping the newest/pinned entry. Every delete
 * is a markdown file removal, so the source of truth is not silently rewritten.
 */
export async function mergeExactDuplicates(
  ctx: MemoryContext,
  options: { dryRun?: boolean } = {},
): Promise<DedupeResult> {
  const groups = findExactDuplicateGroups(ctx);
  const errors: string[] = [];
  let removed = 0;
  let kept = 0;

  for (const group of groups) {
    const keep = group.paths[0];
    if (!keep) continue;
    kept += 1;
    for (const relPath of group.paths.slice(1)) {
      if (options.dryRun) {
        removed += 1;
        continue;
      }
      try {
        await ctx.store.delete(relPath);
        removeItemByPath(ctx.db, relPath);
        removed += 1;
      } catch (error) {
        errors.push(
          `${relPath}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  return { groups, removed, kept, errors };
}
