import { afterEach, describe, expect, it } from "vitest";
import { consolidate, ConsolidationBlockedError } from "../src/consolidation.ts";
import { openContext } from "../src/context.ts";
import { countEpisodes, logEpisode } from "../src/episodes.ts";
import { FakeAdapter } from "../src/adapters/fake.ts";
import { makeRoot, removeRoot } from "./helpers.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(removeRoot));
});

describe("consolidation", () => {
  it("refuses to run without an idle charging window", async () => {
    const root = await makeRoot();
    roots.push(root);
    const ctx = await openContext({ root });
    await expect(consolidate(ctx, { idle: false, charging: true })).rejects.toBeInstanceOf(
      ConsolidationBlockedError,
    );
    await expect(consolidate(ctx, { idle: true, charging: false })).rejects.toBeInstanceOf(
      ConsolidationBlockedError,
    );
    ctx.db.close();
  });

  it("runs maintenance and prunes only old raw episodes", async () => {
    const root = await makeRoot();
    roots.push(root);
    const ctx = await openContext({ root });
    logEpisode(ctx.db, {
      text: "stará epizoda",
      created: "2020-01-01T00:00:00.000Z",
    });
    logEpisode(ctx.db, { text: "nová epizoda" });

    const report = await consolidate(ctx, {
      idle: true,
      charging: true,
      retentionDays: 30,
      now: new Date("2026-11-20T00:00:00.000Z"),
    });

    expect(report.integrity).toBe("ok");
    expect(report.episodes.before).toBe(2);
    expect(report.episodes.removed).toBe(1);
    expect(countEpisodes(ctx.db)).toBe(1);
    expect(report.review).toEqual({ draftSkills: 0, scripts: 0, mergeProposals: 0 });
    ctx.db.close();
  });

  it("uses the curator to keep durable facts before pruning old episodes", async () => {
    const root = await makeRoot();
    roots.push(root);
    const ctx = await openContext({ root });
    logEpisode(ctx.db, {
      text: "rozhodli jsme se používat pytest",
      kind: "result",
      created: "2020-01-01T00:00:00.000Z",
    });

    const report = await consolidate(ctx, {
      idle: true,
      charging: true,
      retentionDays: 30,
      now: new Date("2026-11-20T00:00:00.000Z"),
      curator: new FakeAdapter([
        {
          name: "Testy pytestem",
          description: "Projekt používá pytest.",
          durability: "durable",
          source: "inferred",
          confidence: 0.8,
        },
      ]),
    });

    expect(report.curated.attempted).toBe(true);
    expect(report.curated.saved).toHaveLength(1);
    expect(report.episodes.removed).toBe(1);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM memory_items").get()).toEqual({ n: 1 });
    ctx.db.close();
  });

  it("merges only exact duplicate memory files when asked", async () => {
    const root = await makeRoot();
    roots.push(root);
    const ctx = await openContext({ root });
    const input = {
      name: "Stejný záznam",
      description: "Stejný popis",
      body: "stejné tělo",
      scope: "global" as const,
    };
    await ctx.store.save(input, { path: "memory/global/dup-a.md" });
    await ctx.store.save(input, { path: "memory/global/dup-b.md" });

    const report = await consolidate(ctx, {
      idle: true,
      charging: true,
      mergeDuplicates: true,
    });

    expect(report.dedupe.removed).toBe(1);
    expect(report.dedupe.groups).toHaveLength(1);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM memory_items").get()).toEqual({ n: 1 });
    ctx.db.close();
  });

  it("keeps raw episodes when the curator fails", async () => {
    const root = await makeRoot();
    roots.push(root);
    const ctx = await openContext({ root });
    logEpisode(ctx.db, {
      text: "důležitá stará epizoda",
      created: "2020-01-01T00:00:00.000Z",
    });

    const report = await consolidate(ctx, {
      idle: true,
      charging: true,
      retentionDays: 30,
      now: new Date("2026-11-20T00:00:00.000Z"),
      curator: {
        name: "broken-curator",
        async extract() {
          throw new Error("curator offline");
        },
      },
    });

    expect(report.curated.error).toContain("offline");
    expect(report.episodes.removed).toBe(0);
    expect(countEpisodes(ctx.db)).toBe(1);
    ctx.db.close();
  });
});
