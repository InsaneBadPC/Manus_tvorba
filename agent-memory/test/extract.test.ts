import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, countMemory } from "../src/db.ts";
import { MemoryStore } from "../src/store.ts";
import { containsSecret, remember } from "../src/extract.ts";
import { FakeAdapter } from "../src/adapters/fake.ts";
import { makeRoot, removeRoot } from "./helpers.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(removeRoot));
});

async function setup() {
  const root = await makeRoot();
  roots.push(root);
  const db = openDatabase(root);
  const store = new MemoryStore({ root, projectId: "alpha" });
  return { root, db, store };
}

const base = {
  name: "Pytest convention",
  description: "Projekt používá pytest",
  body: "Spouštěj pytest -q.",
  tags: ["testing"],
  confidence: 0.95,
  source: "stated" as const,
};

describe("remember", () => {
  it("writes valid candidates and skips a duplicate", async () => {
    const { db, store } = await setup();
    const adapter = new FakeAdapter([base]);
    const first = await remember("používáme pytest", { adapter, db, store, projectId: "alpha" });
    expect(first.saved).toHaveLength(1);
    expect(first.saved[0]?.relPath).toBe("memory/projects/alpha/pytest-convention.md");
    expect(countMemory(db)).toBe(1);

    const second = await remember("používáme pytest", { adapter, db, store, projectId: "alpha" });
    expect(second.saved).toHaveLength(0);
    expect(second.skipped[0]?.reason).toBe("duplicate");
  });

  it("rejects invalid, ephemeral and secret candidates", async () => {
    const { db, store } = await setup();
    const adapter = new FakeAdapter([
      { name: "x", description: "short" },
      { ...base, name: "Today note", durability: "ephemeral" },
      { ...base, name: "Key", description: "api_key = sk-abcdefghijklmnopqrstuvwxyz123456" },
    ]);
    const report = await remember("text", { adapter, db, store, projectId: "alpha" });
    expect(report.saved).toHaveLength(0);
    expect(report.skipped.map((entry) => entry.reason)).toEqual([
      "name is too short",
      "ephemeral content",
      "possible secret",
    ]);
    expect(countMemory(db)).toBe(0);
  });

  it("detects private keys and GitHub tokens", () => {
    expect(containsSecret("-----BEGIN OPENSSH PRIVATE KEY-----")).toBe(true);
    expect(containsSecret("token ghp_abcdefghijklmnopqrstuvwxyz123456")).toBe(true);
    expect(containsSecret("používáme pytest a gradle")).toBe(false);
  });
});
