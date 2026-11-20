import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.ts";
import {
  approveScript,
  canRunScript,
  routeSkill,
  scanSkills,
  syncSkills,
} from "../src/skills.ts";
import { makeRoot, removeRoot } from "./helpers.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(removeRoot));
});

async function writeSkill(
  root: string,
  dir: string,
  frontmatter: string,
  body = "Postup.",
): Promise<void> {
  const target = path.join(root, "skills", dir);
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, "SKILL.md"), `---\n${frontmatter}\n---\n${body}\n`);
}

async function setup() {
  const root = await makeRoot();
  roots.push(root);
  await writeSkill(
    root,
    "testing",
    'name: testing\ndescription: Spouští testy projektu\ntriggers: [testy, pytest]\npermissions: [run-scripts]',
  );
  await writeSkill(
    root,
    "deploy",
    'name: deploy\ndescription: Nasadí aplikaci\ntriggers: [deploy, nasazení]',
  );
  const db = openDatabase(root);
  await syncSkills(db, root);
  return { root, db };
}

describe("skills", () => {
  it("scans valid skills and routes by trigger", async () => {
    const { root, db } = await setup();
    expect((await scanSkills(root)).skills).toHaveLength(2);
    const hits = routeSkill(db, "spusť pytest na projektu");
    expect(hits[0]?.skill.manifest.name).toBe("testing");
    expect(routeSkill(db, "jak je počasí")).toHaveLength(0);
  });

  it("requires approval bound to the exact script hash", async () => {
    const { root, db } = await setup();
    const script = path.join(root, "skills", "testing", "run.sh");
    await fs.writeFile(script, "#!/bin/sh\npytest -q\n");

    const before = await canRunScript(db, root, "testing", "run.sh");
    expect(before.allowed).toBe(false);

    await approveScript(db, root, "testing", "run.sh");
    expect((await canRunScript(db, root, "testing", "run.sh")).allowed).toBe(true);

    await fs.writeFile(script, "#!/bin/sh\npytest --cov\n");
    const afterChange = await canRunScript(db, root, "testing", "run.sh");
    expect(afterChange.allowed).toBe(false);
    expect(afterChange.reason).toContain("not approved");
  });

  it("refuses scripts when the manifest grants no execution", async () => {
    const { root, db } = await setup();
    await fs.writeFile(path.join(root, "skills", "deploy", "run.sh"), "echo deploy\n");
    const result = await canRunScript(db, root, "deploy", "run.sh");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("does not request");
  });
});
