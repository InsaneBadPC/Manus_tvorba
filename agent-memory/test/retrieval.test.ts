import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, syncIndex } from "../src/db.ts";
import { MemoryStore } from "../src/store.ts";
import { buildContext, buildFtsQuery, searchMemory } from "../src/retrieval.ts";
import { makeRoot, removeRoot } from "./helpers.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(removeRoot));
});

async function setup() {
  const root = await makeRoot();
  roots.push(root);
  const store = new MemoryStore({ root, projectId: "alpha", agentId: "coder" });
  await store.save({
    name: "Global Gradle",
    description: "Gradle je globální konvence",
    scope: "global",
  });
  await store.save({
    name: "Alpha Gradle",
    description: "Alpha používá Gradle build",
    scope: "project",
  });
  await store.save({
    name: "Beta Gradle",
    description: "Beta používá Gradle release",
    scope: "project",
    scopeOwner: "beta",
  });
  await store.save({
    name: "Agent Gradle",
    description: "Agent spouští Gradle",
    scope: "agent",
  });
  const db = openDatabase(root);
  await syncIndex(db, store);
  return { db, store };
}

describe("retrieval", () => {
  it("builds a safe prefix query and ignores stopwords", () => {
    expect(buildFtsQuery("Jak se používá Gradle?")).toBe('"používá"* OR "gradle"*');
    expect(buildFtsQuery("a v na")).toBe("");
    expect(buildFtsQuery('gradle" OR *')).toBe('"gradle"*');
  });

  it("sees global plus only the current project and agent", async () => {
    const { db } = await setup();
    const hits = searchMemory(db, "gradle", { projectId: "alpha", agentId: "coder", limit: 10 });
    const names = hits.map((hit) => hit.item.name);
    expect(names).toContain("Global Gradle");
    expect(names).toContain("Alpha Gradle");
    expect(names).toContain("Agent Gradle");
    expect(names).not.toContain("Beta Gradle");
  });

  it("ranks pinned entries above unpinned ones", async () => {
    const { db, store } = await setup();
    await store.save({
      name: "Pinned Gradle",
      description: "Důležité pravidlo pro Gradle",
      scope: "global",
      pinned: true,
    });
    await syncIndex(db, store);
    const hits = searchMemory(db, "gradle", { projectId: "alpha", limit: 10 });
    expect(hits[0]?.item.name).toBe("Pinned Gradle");
  });

  it("respects the max records and character budget", async () => {
    const { db } = await setup();
    const result = buildContext(db, "gradle", {
      projectId: "alpha",
      agentId: "coder",
      budget: { maxRecords: 2, maxChars: 220, coreMaxChars: 120 },
    });
    expect(result.items.length).toBeLessThanOrEqual(2);
    expect(result.chars).toBeLessThanOrEqual(240);
    expect(result.text).toContain("## Paměť");
  });
});
