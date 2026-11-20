import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openContext, type MemoryContext } from "../src/context.ts";
import { runAssistant } from "../src/assistant/loop.ts";
import { FakeChatAdapter } from "../src/adapters/fake-chat.ts";
import { FakeAdapter } from "../src/adapters/fake.ts";
import { AutoApprovalGate, DenyApprovalGate } from "../src/assistant/approval.ts";
import { NodeProcessRunner } from "../src/assistant/process.ts";
import { listSessions, loadMessages } from "../src/assistant/session.ts";
import { syncSkills } from "../src/skills.ts";
import { runSkillScript } from "../src/script-runner.ts";

const roots: string[] = [];

async function setup(): Promise<{ root: string; project: string; ctx: MemoryContext }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "am-assistant-"));
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "am-project-"));
  roots.push(root, project);
  const ctx = await openContext({ root, projectId: "p1", agentId: "a1" });
  return { root, project, ctx };
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

function call(name: string, args: Record<string, unknown>) {
  return { id: `call-${name}`, name, arguments: args };
}

describe("assistant loop", () => {
  it("stores the turn, persists the session and extracts durable memory", async () => {
    const { ctx, project } = await setup();
    const chat = new FakeChatAdapter([
      { text: "Rozumím, používám pytest.", toolCalls: [], model: "fake" },
    ]);
    const extractor = new FakeAdapter([
      {
        name: "Používání pytestu",
        description: "Uživatel používá pytest.",
        body: "Spouštěj testy přes pytest.",
        durability: "durable",
        source: "stated",
        confidence: 0.9,
      },
    ]);

    const result = await runAssistant({
      message: "Pamatuj si, že používám pytest.",
      ctx,
      adapter: chat,
      approval: new DenyApprovalGate(),
      projectCwd: project,
      sessionId: "s1",
      processRunner: new NodeProcessRunner(),
      extractor,
    });

    expect(result.text).toContain("pytest");
    expect(result.sessionId).toBe("s1");
    expect(result.remembered).toHaveLength(1);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM assistant_messages").get()).toEqual({
      n: 2,
    });
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM memory_items").get()).toEqual({ n: 1 });
    const sessions = listSessions(ctx.db, { projectId: "p1" });
    expect(sessions[0]?.id).toBe("s1");
  });

  it("executes a read-only tool and sends its data back to the model", async () => {
    const { ctx, project } = await setup();
    await fs.writeFile(path.join(project, "README.md"), "# Projekt\n");
    const chat = new FakeChatAdapter([
      {
        text: "",
        toolCalls: [call("read_file", { path: "README.md" })],
        model: "fake",
      },
      { text: "Soubor obsahuje nadpis Projekt.", toolCalls: [], model: "fake" },
    ]);

    const result = await runAssistant({
      message: "Co je v README?",
      ctx,
      adapter: chat,
      approval: new DenyApprovalGate(),
      projectCwd: project,
      sessionId: "s2",
      processRunner: new NodeProcessRunner(),
    });

    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]?.outcome.isError).toBeFalsy();
    expect(result.tools[0]?.outcome.content).toContain("# Projekt");
    expect(result.text).toContain("Projekt");
    const messages = loadMessages(ctx.db, "s2");
    expect(messages.some((message) => message.role === "tool")).toBe(true);
    const secondRequest = chat.requests[1];
    expect(
      secondRequest?.messages.some((message) =>
        message.content.includes("nedůvěryhodná data"),
      ),
    ).toBe(true);
  });

  it("denies a risky command and never executes it", async () => {
    const { ctx, project } = await setup();
    const marker = path.join(project, "denied.txt");
    const chat = new FakeChatAdapter([
      {
        text: "",
        toolCalls: [call("run_command", { command: `touch ${marker}` })],
        model: "fake",
      },
      { text: "Akce byla zamítnuta.", toolCalls: [], model: "fake" },
    ]);

    const result = await runAssistant({
      message: "Vytvoř soubor",
      ctx,
      adapter: chat,
      approval: new DenyApprovalGate(),
      projectCwd: project,
      sessionId: "s3",
      processRunner: new NodeProcessRunner(),
    });

    expect(result.tools[0]?.outcome.isError).toBe(true);
    await expect(fs.stat(marker)).rejects.toThrow();
  });

  it("runs a risky command only after approval", async () => {
    const { ctx, project } = await setup();
    const chat = new FakeChatAdapter([
      {
        text: "",
        toolCalls: [call("run_command", { command: "printf hello" })],
        model: "fake",
      },
      { text: "Příkaz prošel.", toolCalls: [], model: "fake" },
    ]);

    const result = await runAssistant({
      message: "Spusť příkaz",
      ctx,
      adapter: chat,
      approval: new AutoApprovalGate(),
      projectCwd: project,
      sessionId: "s4",
      processRunner: new NodeProcessRunner(),
    });

    expect(result.tools[0]?.outcome.isError).toBe(false);
    expect(result.tools[0]?.outcome.content).toContain("hello");
  });

  it("writes a file and keeps a backup of the previous content", async () => {
    const { ctx, project } = await setup();
    await fs.writeFile(path.join(project, "note.txt"), "stary");
    const chat = new FakeChatAdapter([
      {
        text: "",
        toolCalls: [call("write_file", { path: "note.txt", content: "novy" })],
        model: "fake",
      },
      { text: "Soubor je upravený.", toolCalls: [], model: "fake" },
    ]);

    const result = await runAssistant({
      message: "Uprav note.txt",
      ctx,
      adapter: chat,
      approval: new DenyApprovalGate(),
      projectCwd: project,
      sessionId: "s5",
      processRunner: new NodeProcessRunner(),
    });

    expect(result.tools[0]?.outcome.isError).toBeFalsy();
    expect(await fs.readFile(path.join(project, "note.txt"), "utf8")).toBe("novy");
    const backups = await fs.readdir(path.join(ctx.root, "backups", "s5"));
    expect(backups).toHaveLength(1);
    const backup = await fs.readFile(
      path.join(ctx.root, "backups", "s5", backups[0] as string),
      "utf8",
    );
    expect(backup).toBe("stary");
  });

  it("loads the previous messages when the same session continues", async () => {
    const { ctx, project } = await setup();
    const first = new FakeChatAdapter([
      { text: "První odpověď.", toolCalls: [], model: "fake" },
    ]);
    await runAssistant({
      message: "První zpráva",
      ctx,
      adapter: first,
      approval: new DenyApprovalGate(),
      projectCwd: project,
      sessionId: "s6",
      processRunner: new NodeProcessRunner(),
    });

    const second = new FakeChatAdapter([
      { text: "Druhá odpověď.", toolCalls: [], model: "fake" },
    ]);
    await runAssistant({
      message: "Druhá zpráva",
      ctx,
      adapter: second,
      approval: new DenyApprovalGate(),
      projectCwd: project,
      sessionId: "s6",
      processRunner: new NodeProcessRunner(),
    });

    const request = second.requests[0];
    expect(request?.messages.some((message) => message.content === "První zpráva")).toBe(
      true,
    );
    expect(
      request?.messages.some((message) => message.content === "První odpověď."),
    ).toBe(true);
  });
});

describe("skill scripts", () => {
  it("runs only a hash-approved script and invalidates approval after a change", async () => {
    const { root, ctx } = await setup();
    const skillDir = path.join(root, "skills", "test-skill");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      `---\nname: "test-skill"\ndescription: "Testovací skript"\npermissions: ["run-scripts"]\nstatus: "active"\n---\n\nSpusť skript.\n`,
    );
    await fs.writeFile(path.join(skillDir, "run.sh"), "printf '%s' \"$1\"\n", {
      mode: 0o600,
    });
    await syncSkills(ctx.db, root);

    const denied = await runSkillScript({
      db: ctx.db,
      root,
      skill: "test-skill",
      script: "run.sh",
      args: ["ahoj"],
      runner: new NodeProcessRunner(),
    });
    expect(denied.ok).toBe(false);
    expect(denied.stderr).toContain("not approved");

    const { approveScript } = await import("../src/skills.ts");
    await approveScript(ctx.db, root, "test-skill", "run.sh");
    const approved = await runSkillScript({
      db: ctx.db,
      root,
      skill: "test-skill",
      script: "run.sh",
      args: ["ahoj"],
      runner: new NodeProcessRunner(),
    });
    expect(approved.ok).toBe(true);
    expect(approved.stdout).toBe("ahoj");

    await fs.writeFile(path.join(skillDir, "run.sh"), "printf 'zmeneno'\n");
    const changed = await runSkillScript({
      db: ctx.db,
      root,
      skill: "test-skill",
      script: "run.sh",
      runner: new NodeProcessRunner(),
    });
    expect(changed.ok).toBe(false);
    expect(changed.stderr).toContain("not approved");
  });
});
