import fs from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { countMemory, databasePath, getByName, openDatabase, syncIndex } from "../src/db.ts";
import { MemoryStore } from "../src/store.ts";
import { makeRoot, removeRoot } from "./helpers.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(removeRoot));
});

async function setup() {
  const root = await makeRoot();
  roots.push(root);
  const store = new MemoryStore({ root });
  const db = openDatabase(root);
  return { root, store, db };
}

describe("SQLite index", () => {
  it("indexes, updates and removes markdown files by hash", async () => {
    const { store, db } = await setup();
    const { file } = await store.save({
      name: "Pytest convention",
      description: "Používáme pytest",
      body: "pytest -q",
    });

    const first = await syncIndex(db, store);
    expect(first.added).toBe(1);
    expect(countMemory(db)).toBe(1);
    expect(getByName(db, "pytest convention")?.body).toBe("pytest -q");

    await store.save({
      name: "Pytest convention",
      description: "Používáme pytest a coverage",
      body: "pytest --cov",
    });
    const second = await syncIndex(db, store);
    expect(second.updated).toBe(1);
    expect(getByName(db, "Pytest convention")?.description).toContain("coverage");

    await fs.unlink(file.absPath);
    const third = await syncIndex(db, store);
    expect(third.removed).toBe(1);
    expect(countMemory(db)).toBe(0);
  });

  it("rebuilds the same index after the database file is lost", async () => {
    const { root, store, db } = await setup();
    await store.save({ name: "Alpha", description: "First memory", body: "alpha body" });
    await store.save({ name: "Beta", description: "Second memory", body: "beta body" });
    await syncIndex(db, store);
    expect(countMemory(db)).toBe(2);
    db.close();
    await fs.rm(databasePath(root), { force: true });
    await fs.rm(`${databasePath(root)}-wal`, { force: true });
    await fs.rm(`${databasePath(root)}-shm`, { force: true });

    const fresh = openDatabase(root);
    const report = await syncIndex(fresh, store);
    expect(report.added).toBe(2);
    expect(countMemory(fresh)).toBe(2);
    fresh.close();
  });
});
