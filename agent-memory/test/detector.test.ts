import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.ts";
import { detectSkills } from "../src/detector.ts";
import { logEpisode } from "../src/episodes.ts";
import { routeSkill, scanSkills, syncSkills } from "../src/skills.ts";
import { makeRoot, removeRoot } from "./helpers.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(removeRoot));
});

async function setup() {
  const root = await makeRoot();
  roots.push(root);
  const db = openDatabase(root);
  await syncSkills(db, root);
  return { root, db };
}

describe("skill detector", () => {
  it("proposes a draft from a repeated sequence and does not route it", async () => {
    const { root, db } = await setup();
    for (const session of ["s1", "s2", "s3"]) {
      for (const [index, step] of ["terminal", "edit", "test"].entries()) {
        logEpisode(db, {
          text: `krok ${index + 1}`,
          kind: "step",
          session,
          tools: [step],
          success: true,
        });
      }
    }

    const detected = await detectSkills(db, root, { minRepeats: 3 });
    expect(detected).toHaveLength(1);
    expect(detected[0]?.reason).toBe("repeated-sequence");
    expect(detected[0]?.evidence.sessions).toBe(3);

    const scan = await scanSkills(root);
    expect(scan.skills[0]?.manifest.status).toBe("draft");
    expect(routeSkill(db, "terminal edit test")).toHaveLength(0);
    db.close();
  });

  it("does not duplicate an existing draft", async () => {
    const { root, db } = await setup();
    for (const session of ["s1", "s2", "s3"]) {
      logEpisode(db, {
        text: session,
        session,
        tools: ["terminal", "edit"],
      });
    }
    const first = await detectSkills(db, root, { minRepeats: 3 });
    expect(first).toHaveLength(1);
    const second = await detectSkills(db, root, { minRepeats: 3 });
    expect(second).toHaveLength(0);
    expect((await scanSkills(root)).skills).toHaveLength(1);
    db.close();
  });

  it("supports dry-run without writing a file", async () => {
    const { root, db } = await setup();
    for (const session of ["s1", "s2", "s3"]) {
      logEpisode(db, { text: session, session, tools: ["terminal", "test"] });
    }
    const detected = await detectSkills(db, root, { minRepeats: 3, dryRun: true });
    expect(detected).toHaveLength(1);
    await expect(fs.access(path.join(root, "skills"))).rejects.toThrow();
    db.close();
  });
});
