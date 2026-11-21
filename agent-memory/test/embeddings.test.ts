import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openContext } from "../src/context.ts";
import { syncIndex } from "../src/db.ts";
import {
  ensureEmbeddings,
  embeddingStatus,
  semanticSearch,
  type EmbeddingAdapter,
} from "../src/embeddings.ts";

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "am-embedding-"));
  roots.push(root);
  return root;
}

class ToyAdapter implements EmbeddingAdapter {
  readonly name = "toy@2";
  readonly dimensions = 2;
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => (/gradle/i.test(text) ? [1, 0] : [0, 1]));
  }
}

afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

describe("embeddings", () => {
  it("embeds missing rows and finds a paraphrased entry", async () => {
    const ctx = await openContext({ root: await makeRoot(), projectId: "p1" });
    await ctx.store.save({
      name: "Gradle build",
      description: "Projekt používá Gradle",
      body: "gradle build",
      scope: "project",
    });
    await ctx.store.save({
      name: "Python testy",
      description: "Projekt používá pytest",
      body: "pytest -q",
      scope: "project",
    });
    await syncIndex(ctx.db, ctx.store);
    const adapter = new ToyAdapter();

    const report = await ensureEmbeddings(ctx.db, adapter);
    expect(report.embedded).toBe(2);
    expect(await embeddingStatus(ctx.db, adapter)).toEqual({ ready: 2, stale: 0, total: 2 });

    const hits = semanticSearch(ctx.db, Float32Array.from([1, 0]), adapter.name, {
      projectId: "p1",
    });
    expect(hits[0]?.item.name).toBe("Gradle build");
    ctx.db.close();
  });

  it("re-embeds an item after its body changes", async () => {
    const ctx = await openContext({ root: await makeRoot(), projectId: "p1" });
    const first = await ctx.store.save({
      name: "Poznámka",
      description: "Popis",
      body: "gradle",
      scope: "project",
    });
    await syncIndex(ctx.db, ctx.store);
    const adapter = new ToyAdapter();
    await ensureEmbeddings(ctx.db, adapter);
    await ctx.store.save(
      { ...first.file.data, body: "pytest", tags: [] },
      { path: first.file.relPath },
    );
    await syncIndex(ctx.db, ctx.store);
    const report = await ensureEmbeddings(ctx.db, adapter);
    expect(report.embedded).toBe(1);
    expect(await embeddingStatus(ctx.db, adapter)).toEqual({ ready: 1, stale: 0, total: 1 });
    ctx.db.close();
  });
});
