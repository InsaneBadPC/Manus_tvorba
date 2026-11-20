import { afterEach, describe, expect, it } from "vitest";
import { MemoryStore } from "../src/store.ts";
import { PathSafetyError } from "../src/paths.ts";
import { makeRoot, removeRoot } from "./helpers.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(removeRoot));
});

async function store(projectId?: string) {
  const root = await makeRoot();
  roots.push(root);
  return { root, store: new MemoryStore({ root, projectId }) };
}

describe("MemoryStore", () => {
  it("writes a global memory and updates it by name", async () => {
    const { store: memory } = await store();
    const first = await memory.save({
      name: "Pytest convention",
      description: "Používáme pytest",
      body: "Spouštěj pytest -q.",
      scope: "global",
      source: "stated",
    });
    expect(first.created).toBe(true);
    expect(first.file.relPath).toBe("memory/global/pytest-convention.md");

    const second = await memory.save({
      name: "Pytest convention",
      description: "Používáme pytest a coverage",
      scope: "global",
    });
    expect(second.created).toBe(false);
    expect(second.file.relPath).toBe(first.file.relPath);
    expect(second.file.data.created).toBe(first.file.data.created);
    expect(await memory.list()).toHaveLength(1);
  });

  it("assigns project scope and owner", async () => {
    const { root, store: memory } = await store("alpha");
    const { file } = await memory.save({
      name: "Build command",
      description: "Gradle assembleRelease",
      scope: "project",
    });
    expect(file.relPath).toBe("memory/projects/alpha/build-command.md");
    expect(file.data.scopeOwner).toBe("alpha");
    expect(file.absPath.startsWith(root)).toBe(true);
  });

  it("refuses traversal and unknown scopes", async () => {
    const { store: memory } = await store("alpha");
    await expect(memory.read("../../etc/passwd")).rejects.toBeInstanceOf(PathSafetyError);
    await expect(
      memory.save({ name: "Bad", description: "x", scope: "project", scopeOwner: "../x" }),
    ).rejects.toBeInstanceOf(PathSafetyError);
  });
});
