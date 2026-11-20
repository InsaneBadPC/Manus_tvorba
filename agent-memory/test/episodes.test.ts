import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.ts";
import { countEpisodes, listEpisodes, logEpisode, pruneEpisodes, searchEpisodes } from "../src/episodes.ts";
import { makeRoot, removeRoot } from "./helpers.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(removeRoot));
});

describe("episodes", () => {
  it("logs, filters and searches episodes", async () => {
    const root = await makeRoot();
    roots.push(root);
    const db = openDatabase(root);
    logEpisode(db, {
      text: "Spustil jsem pytest a prošel.",
      kind: "result",
      projectId: "alpha",
      agentId: "coder",
      session: "s1",
      tools: ["terminal", "test"],
    });
    logEpisode(db, {
      text: "Build selhal na chybějící závislosti.",
      kind: "error",
      projectId: "alpha",
      agentId: "coder",
      session: "s2",
      success: false,
      tools: ["terminal"],
    });
    logEpisode(db, {
      text: "Jiný projekt.",
      projectId: "beta",
      agentId: "coder",
      session: "s3",
    });

    expect(countEpisodes(db)).toBe(3);
    expect(listEpisodes(db, { projectId: "alpha" })).toHaveLength(2);
    expect(listEpisodes(db, { projectId: "alpha", session: "s2" })[0]?.success).toBe(false);
    expect(searchEpisodes(db, "pytest", { projectId: "alpha" })).toHaveLength(1);
    expect(searchEpisodes(db, "pytest", { projectId: "beta" })).toHaveLength(0);
    db.close();
  });

  it("prunes only episodes outside the retention window", async () => {
    const root = await makeRoot();
    roots.push(root);
    const db = openDatabase(root);
    logEpisode(db, {
      text: "stará epizoda",
      created: "2020-01-01T00:00:00.000Z",
    });
    logEpisode(db, { text: "nová epizoda" });
    const removed = pruneEpisodes(db, 30, () => new Date("2026-11-20T00:00:00.000Z"));
    expect(removed).toBe(1);
    expect(countEpisodes(db)).toBe(1);
    expect(listEpisodes(db)[0]?.text).toBe("nová epizoda");
    db.close();
  });
});
