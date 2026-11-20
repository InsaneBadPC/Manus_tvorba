import { afterEach, describe, expect, it } from "vitest";
import { consolidate, ConsolidationBlockedError } from "../src/consolidation.ts";
import { openContext } from "../src/context.ts";
import { countEpisodes, logEpisode } from "../src/episodes.ts";
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
    expect(report.review).toEqual({ draftSkills: 0, scripts: 0 });
    ctx.db.close();
  });
});
