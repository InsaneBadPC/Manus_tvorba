import { countEpisodes, pruneEpisodes } from "./episodes.ts";
import { syncIndex } from "./db.ts";
import { listReviewQueue, syncSkills } from "./skills.ts";
import { curateOldEpisodes, type CuratorResult } from "./curator.ts";
import type { MemoryContext } from "./context.ts";
import type { ModelAdapter } from "./types.ts";

export class ConsolidationBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConsolidationBlockedError";
  }
}

export interface ConsolidationOptions {
  idle: boolean;
  charging: boolean;
  retentionDays?: number;
  now?: Date;
  curator?: ModelAdapter;
}

export interface ConsolidationReport {
  startedAt: string;
  finishedAt: string;
  memory: { indexed: number; errors: number };
  skills: { indexed: number; errors: number };
  episodes: { before: number; removed: number; after: number; retentionDays: number };
  curated: CuratorResult;
  duplicates: Array<{ name: string; count: number }>;
  review: { draftSkills: number; scripts: number };
  integrity: string;
}

/**
 * Background maintenance is allowed only while the device is idle and
 * charging. The Android layer must pass real values; callers cannot opt out.
 */
export function assertBackgroundWindow(options: {
  idle?: boolean;
  charging?: boolean;
}): void {
  if (!options.idle || !options.charging) {
    throw new ConsolidationBlockedError(
      "consolidation is allowed only while the device is idle and charging",
    );
  }
}

export async function consolidate(
  ctx: MemoryContext,
  options: ConsolidationOptions,
): Promise<ConsolidationReport> {
  assertBackgroundWindow(options);
  const startedAt = new Date().toISOString();
  const retentionDays = Math.max(1, Math.floor(options.retentionDays ?? 30));
  const now = options.now ?? new Date();

  const memory = await syncIndex(ctx.db, ctx.store);
  const skills = await syncSkills(ctx.db, ctx.root);
  const before = countEpisodes(ctx.db);
  const curated: CuratorResult = options.curator
    ? await curateOldEpisodes(ctx, {
        adapter: options.curator,
        retentionDays,
        now,
      })
    : { attempted: false, saved: [], skipped: 0 };
  // Keep raw episodes when the curator was asked to summarize them but failed.
  const removed = curated.error ? 0 : pruneEpisodes(ctx.db, retentionDays, () => now);
  const after = countEpisodes(ctx.db);

  const duplicates = ctx.db
    .prepare(
      `SELECT name, COUNT(*) AS n FROM memory_items
       GROUP BY name COLLATE NOCASE
       HAVING n > 1
       ORDER BY n DESC
       LIMIT 20`,
    )
    .all() as Array<{ name: string; n: number }>;

  const review = await listReviewQueue(ctx.db, ctx.root);
  const integrityRow = ctx.db.prepare("PRAGMA integrity_check").get() as
    | { integrity_check?: string }
    | undefined;
  const finishedAt = new Date().toISOString();
  const report: ConsolidationReport = {
    startedAt,
    finishedAt,
    memory: {
      indexed: memory.added + memory.updated + memory.unchanged,
      errors: memory.errors.length,
    },
    skills: { indexed: skills.added + skills.updated, errors: skills.errors.length },
    episodes: { before, removed, after, retentionDays },
    curated,
    duplicates: duplicates.map((row) => ({ name: row.name, count: Number(row.n) })),
    review: { draftSkills: review.skills.length, scripts: review.scripts.length },
    integrity: integrityRow?.integrity_check ?? "unknown",
  };

  ctx.db
    .prepare(
      `INSERT INTO meta(key, value) VALUES ('last_consolidation', ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    )
    .run(finishedAt);
  return report;
}
