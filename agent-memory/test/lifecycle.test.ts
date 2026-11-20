import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.ts";
import {
  approveDraftSkill,
  approveScript,
  canRunScript,
  getSkillStats,
  listReviewQueue,
  recordSkillOutcome,
  rejectDraftSkill,
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
    'name: testing\ndescription: Spouští testy\ntriggers: [testy]\npermissions: [run-scripts]\nstatus: probation',
  );
  await writeSkill(
    root,
    "drafting",
    'name: drafting\ndescription: Navržený postup\ntriggers: [draft]\npermissions: [run-scripts]\nstatus: draft',
  );
  const db = openDatabase(root);
  await syncSkills(db, root);
  return { root, db };
}

describe("skill lifecycle", () => {
  it("promotes a probation skill after three successful uses", async () => {
    const { root, db } = await setup();
    for (let i = 0; i < 2; i += 1) {
      expect((await recordSkillOutcome(db, root, "testing", true)).status).toBe("probation");
    }
    const third = await recordSkillOutcome(db, root, "testing", true);
    expect(third.changed).toBe(true);
    expect(third.status).toBe("active");
    expect(third.stats.successes).toBe(3);
    expect(getSkillStats(db, "testing").uses).toBe(3);

    const scan = await scanSkills(root);
    expect(scan.skills.find((skill) => skill.manifest.name === "testing")?.manifest.status).toBe(
      "active",
    );
    db.close();
  });

  it("disables a probation skill after repeated failures", async () => {
    const { root, db } = await setup();
    for (let i = 0; i < 3; i += 1) {
      await recordSkillOutcome(db, root, "testing", false);
    }
    const row = (await scanSkills(root)).skills.find(
      (skill) => skill.manifest.name === "testing",
    );
    expect(row?.manifest.status).toBe("disabled");
    expect(routeSkill(db, "spusť testy")).toHaveLength(0);
    db.close();
  });

  it("keeps drafts out of routing and requires explicit approval", async () => {
    const { root, db } = await setup();
    await fs.writeFile(path.join(root, "skills", "drafting", "run.sh"), "echo draft\n");
    expect(routeSkill(db, "draft")).toHaveLength(0);

    const before = await canRunScript(db, root, "drafting", "run.sh");
    expect(before.allowed).toBe(false);
    expect(before.reason).toContain("not approved");

    const queue = await listReviewQueue(db, root);
    expect(queue.skills.map((skill) => skill.name)).toContain("drafting");
    expect(queue.scripts).toHaveLength(1);

    const approved = await approveDraftSkill(db, root, "drafting");
    expect(approved.manifest.status).toBe("probation");
    expect(routeSkill(db, "draft")).toHaveLength(1);

    const script = await canRunScript(db, root, "drafting", "run.sh");
    expect(script.allowed).toBe(false);
    expect(script.hash).toBeTruthy();
    const pending = await listReviewQueue(db, root);
    expect(pending.scripts).toHaveLength(1);

    await approveScript(db, root, "drafting", "run.sh");
    expect((await listReviewQueue(db, root)).scripts).toHaveLength(0);
    expect((await canRunScript(db, root, "drafting", "run.sh")).allowed).toBe(true);
    db.close();
  });

  it("rejects a draft without activating it", async () => {
    const { root, db } = await setup();
    const rejected = await rejectDraftSkill(db, root, "drafting");
    expect(rejected.manifest.status).toBe("disabled");
    expect(routeSkill(db, "draft")).toHaveLength(0);
    db.close();
  });
});
