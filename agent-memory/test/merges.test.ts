import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openContext } from "../src/context.ts";
import { syncIndex } from "../src/db.ts";
import { approveMerge, findSimilarGroups, listMergeProposals, proposeMerges, rejectMerge } from "../src/merges.ts";

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "am-merge-"));
  roots.push(root);
  return root;
}

async function seed(ctx: Awaited<ReturnType<typeof openContext>>) {
  await ctx.store.save(
    { name: "Nasazení", description: "Jak nasazovat", body: "používej Gradle", scope: "project", tags: ["deploy"] },
    { path: "memory/projects/p1/nasazeni-a.md" },
  );
  await ctx.store.save(
    { name: "Nasazení", description: "Jak nasazovat", body: "používej Gradle a CI", scope: "project", tags: ["ci"] },
    { path: "memory/projects/p1/nasazeni-b.md" },
  );
  await syncIndex(ctx.db, ctx.store);
}

afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

describe("merge proposals", () => {
  it("finds similar same-name entries and writes only after approval", async () => {
    const ctx = await openContext({ root: await makeRoot(), projectId: "p1" });
    await seed(ctx);
    expect(findSimilarGroups(ctx)).toHaveLength(1);

    const proposals = await proposeMerges(ctx, {
      name: "fake-merge",
      async proposeMerge() {
        return {
          name: "Nasazení",
          description: "Jak nasazovat projekt",
          body: "používej Gradle a CI",
          tags: ["deploy", "ci"],
          reason: "stejné téma",
        };
      },
    });
    expect(proposals).toHaveLength(1);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM memory_items").get()).toEqual({ n: 2 });

    const approved = await approveMerge(ctx, proposals[0]!.id);
    expect(approved.status).toBe("approved");
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM memory_items").get()).toEqual({ n: 1 });
    expect(listMergeProposals(ctx.db)).toHaveLength(1);
    ctx.db.close();
  });

  it("rejects a proposal without touching memory", async () => {
    const ctx = await openContext({ root: await makeRoot(), projectId: "p1" });
    await seed(ctx);
    const proposals = await proposeMerges(ctx, {
      name: "fake-merge",
      async proposeMerge() {
        return { name: "Nasazení", description: "Sjednoceno", body: "Gradle + CI", tags: [] };
      },
    });
    const rejected = rejectMerge(ctx.db, proposals[0]!.id);
    expect(rejected.status).toBe("rejected");
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM memory_items").get()).toEqual({ n: 2 });
    ctx.db.close();
  });
});
