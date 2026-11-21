import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import { backupExisting, listMemoryBackups, restoreMemoryBackup } from "./backups.ts";
import { databasePath, getByPath, removeItemByPath, syncIndex, upsertItem } from "./db.ts";
import { openContext } from "./context.ts";
import { remember } from "./extract.ts";
import { buildContext, buildContextSemantic, searchMemory, searchMemorySemantic, type ContextResult } from "./retrieval.ts";
import type { MemoryHit } from "./types.ts";
import { embeddingStatus, ensureEmbeddings } from "./embeddings.ts";
import {
  approveDraftSkill,
  approveScript,
  getSkillStats,
  listReviewQueue,
  recordSkillOutcome,
  rejectDraftSkill,
  routeSkill,
  scanSkills,
  syncSkills,
} from "./skills.ts";
import { detectSkills } from "./detector.ts";
import { approveMerge, listMergeProposals, proposeMerges, rejectMerge } from "./merges.ts";
import { listEpisodes, logEpisode } from "./episodes.ts";
import { consolidate } from "./consolidation.ts";
import { createAdapterFromEnv } from "./adapters/gemini.ts";
import { createChatAdapterFromEnv } from "./adapters/gemini-chat.ts";
import { createEmbeddingAdapterFromEnv } from "./adapters/gemini-embedding.ts";
import { FakeAdapter } from "./adapters/fake.ts";
import { runMcpServer } from "./mcp.ts";
import { runAssistant } from "./assistant/loop.ts";
import {
  AutoApprovalGate,
  CliApprovalGate,
  DenyApprovalGate,
} from "./assistant/approval.ts";
import { listSessions } from "./assistant/session.ts";
import { NodeProcessRunner } from "./assistant/process.ts";

interface ParsedArgs {
  positional: string[];
  flags: Record<string, string>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = "true";
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function numberFlag(flags: Record<string, string>, key: string): number | undefined {
  const raw = flags[key];
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const HELP = `agent-memory — trvalá paměť a skilly pro agenta

Použití:
  node agent-memory/src/cli.ts <příkaz> [volby]

Příkazy:
  sync                      přeindexuje markdown paměť a skilly
  search <dotaz>            najde záznamy (--limit, --all)
  context <dotaz>           sestaví kontext do tahu (--limit, --semantic)
  embed                     doplní vektorové embeddingy (--force)
  remember <text>           vytáhne a uloží trvalé záznamy (Gemini)
  memory-save               uloží záznam z JSONu na stdin (--path pro editaci)
  memory-delete <cesta>     smaže záznam paměti podle relativní cesty
  memory-history [cesta]    vypíše zálohy paměti
  memory-restore <záloha>   obnoví zálohu (--path cíl)
  skills                    vypíše nainstalované skilly
  route <dotaz>             vybere skill pro zprávu
  approve <skill> <skript>  schválí konkrétní hash skriptu
  approvals                 vypíše drafty, skripty a návrhy sloučení
  propose-merges            kurátor navrhne sloučení podobných záznamů
  merges                    vypíše návrhy sloučení
  approve-merge <id>        schválí a provede sloučení
  reject-merge <id>         zamítne návrh sloučení
  approve-skill <skill>     povýší draft na probation
  reject-skill <skill>      vypne draft
  episode <text>            zapíše epizodu (--kind, --session, --tools)
  episodes                  vypíše poslední epizody
  detect                    navrhne draft skilly z opakovaných postupů
  outcome <skill>           zapíše úspěch/neúspěch (--failure)
  consolidate               údržba jen s --idle --charging
  chat <zpráva>             asistentská smyčka s nástroji (Gemini)
  sessions                  vypíše relace asistenta
  ui                        stav paměti, skillů a fronty pro Android UI
  rebuild                   smaže a znovu postaví index
  mcp                       spustí MCP server na stdio

Společné volby:
  --root <cesta>            kořen agenta (výchozí ~/.agent)
  --project <id>            aktuální projekt
  --agent <id>              aktuální agent
  --cwd <cesta>             pracovní složka pro nástroje (výchozí PWD)
  --session <id>            relace asistenta (výchozí cli)
  --yes                     automaticky schválit rizikové akce
  --json                    vypsat strojový výsledek tahu
`;

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  const command = parsed.positional[0] ?? "help";
  const rest = parsed.positional.slice(1);
  const root = parsed.flags.root;

  if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return 0;
  }

  const projectId = parsed.flags.project ?? process.env.AGENT_PROJECT_ID;
  const agentId = parsed.flags.agent ?? process.env.AGENT_AGENT_ID;
  const ctx = await openContext({
    root,
    projectId,
    agentId,
    sync: command !== "sync" && command !== "rebuild",
  });

  try {
    switch (command) {
      case "sync": {
        const memory = await syncIndex(ctx.db, ctx.store);
        const skills = await syncSkills(ctx.db, ctx.root);
        print({ memory, skills });
        return 0;
      }

      case "search": {
        const query = rest.join(" ").trim();
        if (!query) throw new Error("search requires a query");
        const options = {
          projectId: ctx.projectId,
          agentId: ctx.agentId,
          allScopes: parsed.flags.all === "true",
          limit: numberFlag(parsed.flags, "limit"),
        };
        let hits: MemoryHit[];
        if (parsed.flags.semantic === "true") {
          const embeddings = createEmbeddingAdapterFromEnv();
          if (!embeddings) throw new Error("search --semantic requires GEMINI_API_KEY");
          hits = await searchMemorySemantic(ctx.db, query, embeddings, options);
        } else {
          hits = searchMemory(ctx.db, query, options);
        }
        print(
          hits.map((hit) => ({
            name: hit.item.name,
            description: hit.item.description,
            scope: hit.item.scope,
            path: hit.item.relPath,
            pinned: hit.item.pinned,
            score: Number(hit.score.toFixed(3)),
          })),
        );
        return 0;
      }

      case "context": {
        const query = rest.join(" ").trim();
        if (!query) throw new Error("context requires a query");
        const limit = numberFlag(parsed.flags, "limit");
        const options = {
          projectId: ctx.projectId,
          agentId: ctx.agentId,
          ...(limit ? { budget: { maxRecords: limit } } : {}),
        };
        let result: ContextResult;
        if (parsed.flags.semantic === "true") {
          const embeddings = createEmbeddingAdapterFromEnv();
          if (!embeddings) throw new Error("context --semantic requires GEMINI_API_KEY");
          result = await buildContextSemantic(ctx.db, query, embeddings, options);
        } else {
          result = buildContext(ctx.db, query, options);
        }
        process.stdout.write(result.text);
        process.stderr.write(
          `chars=${result.chars} tokens~${result.estimatedTokens} ms=${result.elapsedMs.toFixed(1)}\n`,
        );
        return 0;
      }

      case "embed": {
        const adapter = createEmbeddingAdapterFromEnv();
        if (!adapter) throw new Error("embed requires GEMINI_API_KEY");
        const report = await ensureEmbeddings(ctx.db, adapter, {
          force: parsed.flags.force === "true",
        });
        print({ ...report, status: await embeddingStatus(ctx.db, adapter) });
        return 0;
      }

      case "remember": {
        const text = rest.join(" ").trim();
        if (!text) throw new Error("remember requires text");
        const adapter = createAdapterFromEnv();
        if (!adapter) {
          const fallback = new FakeAdapter();
          const report = await remember(text, { ...ctx, adapter: fallback });
          print({
            saved: report.saved.map((file) => file.relPath),
            skipped: report.skipped,
            warning: "GEMINI_API_KEY is not set; nothing was extracted",
          });
          return 0;
        }
        const report = await remember(text, { ...ctx, adapter });
        print({
          saved: report.saved.map((file) => file.relPath),
          skipped: report.skipped,
        });
        return 0;
      }

      case "memory-save": {
        const raw = readFileSync(0, "utf8");
        let payload: Record<string, unknown>;
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("JSON object expected");
          }
          payload = parsed as Record<string, unknown>;
        } catch (error) {
          throw new Error(
            `memory-save: invalid JSON on stdin (${error instanceof Error ? error.message : String(error)})`,
          );
        }
        const relPath = typeof payload.path === "string" ? payload.path.trim() : "";
        const existing = relPath ? getByPath(ctx.db, relPath) : undefined;
        if (relPath && !existing) throw new Error(`memory entry '${relPath}' not found`);
        const text = (key: string, fallback: string): string =>
          typeof payload[key] === "string" ? (payload[key] as string) : fallback;
        const tags = Array.isArray(payload.tags)
          ? payload.tags.filter((tag): tag is string => typeof tag === "string")
          : existing?.tags ?? [];
        const { file } = await ctx.store.save(
          {
            name: text("name", existing?.name ?? ""),
            description: text("description", existing?.description ?? ""),
            body: text("body", existing?.body ?? ""),
            scope: (text("scope", existing?.scope ?? (projectId ? "project" : "global")) as
              | "global"
              | "project"
              | "agent"),
            scopeOwner: text("scopeOwner", existing?.scopeOwner ?? projectId ?? ""),
            source: (text("source", existing?.source ?? "stated") as
              | "stated"
              | "inferred"
              | "imported"),
            confidence:
              typeof payload.confidence === "number" ? payload.confidence : existing?.confidence ?? 0.8,
            pinned: typeof payload.pinned === "boolean" ? payload.pinned : existing?.pinned ?? false,
            tags,
          },
          relPath ? { path: relPath } : {},
        );
        upsertItem(ctx.db, file);
        print({ saved: true, path: file.relPath, name: file.data.name });
        return 0;
      }

      case "memory-delete": {
        const relPath = rest.join(" ").trim();
        if (!relPath) throw new Error("memory-delete requires a relative path");
        const item = getByPath(ctx.db, relPath);
        if (!item) throw new Error(`memory entry '${relPath}' not found`);
        const backup = await backupExisting(ctx.root, relPath);
        await ctx.store.delete(relPath);
        removeItemByPath(ctx.db, relPath);
        print({ deleted: true, path: relPath, backup });
        return 0;
      }

      case "memory-history": {
        const relPath = rest.join(" ").trim() || undefined;
        print({ backups: await listMemoryBackups(ctx.root, relPath) });
        return 0;
      }

      case "memory-restore": {
        const backup = rest.join(" ").trim();
        if (!backup) throw new Error("memory-restore requires a backup path");
        const target = await restoreMemoryBackup(
          ctx.root,
          backup,
          parsed.flags.path,
        );
        upsertItem(ctx.db, await ctx.store.read(target));
        print({ restored: true, path: target, backup });
        return 0;
      }

      case "skills": {
        const scan = await scanSkills(ctx.root);
        print({
          skills: scan.skills.map((skill) => ({
            name: skill.manifest.name,
            description: skill.manifest.description,
            triggers: skill.manifest.triggers,
            status: skill.manifest.status,
            version: skill.manifest.version,
            permissions: skill.manifest.permissions,
            stats: getSkillStats(ctx.db, skill.manifest.name),
            path: skill.relPath,
          })),
          errors: scan.errors,
        });
        return 0;
      }

      case "episode": {
        const text = rest.join(" ").trim();
        if (!text) throw new Error("episode requires text");
        const kind = parsed.flags.kind as "step" | "error" | "result" | "note" | undefined;
        const tools = parsed.flags.tools
          ? parsed.flags.tools.split(",").map((tool) => tool.trim()).filter(Boolean)
          : [];
        const episode = logEpisode(ctx.db, {
          text,
          kind,
          projectId: ctx.projectId,
          agentId: ctx.agentId,
          session: parsed.flags.session,
          success: parsed.flags.failure === "true" ? false : parsed.flags.success !== "false",
          tools,
        });
        print(episode);
        return 0;
      }

      case "episodes": {
        print(
          listEpisodes(ctx.db, {
            projectId: ctx.projectId,
            agentId: ctx.agentId,
            limit: numberFlag(parsed.flags, "limit"),
          }),
        );
        return 0;
      }

      case "detect": {
        const detected = await detectSkills(ctx.db, ctx.root, {
          projectId: ctx.projectId,
          agentId: ctx.agentId,
          minSteps: numberFlag(parsed.flags, "min-steps"),
          minRepeats: numberFlag(parsed.flags, "min-repeats"),
          dryRun: parsed.flags["dry-run"] === "true",
        });
        print({ detected });
        return 0;
      }

      case "approvals": {
        print({
          ...(await listReviewQueue(ctx.db, ctx.root)),
          merges: listMergeProposals(ctx.db, { status: "pending" }),
        });
        return 0;
      }

      case "propose-merges": {
        const adapter = createAdapterFromEnv();
        if (!adapter) throw new Error("propose-merges requires GEMINI_API_KEY");
        const proposals = await proposeMerges(ctx, adapter, {
          limit: numberFlag(parsed.flags, "limit"),
        });
        print({ proposed: proposals.length, proposals });
        return 0;
      }

      case "merges": {
        print({ proposals: listMergeProposals(ctx.db, { limit: numberFlag(parsed.flags, "limit") }) });
        return 0;
      }

      case "approve-merge": {
        const id = Number(rest[0]);
        if (!Number.isInteger(id)) throw new Error("approve-merge requires a numeric proposal id");
        print(await approveMerge(ctx, id));
        return 0;
      }

      case "reject-merge": {
        const id = Number(rest[0]);
        if (!Number.isInteger(id)) throw new Error("reject-merge requires a numeric proposal id");
        print(rejectMerge(ctx.db, id));
        return 0;
      }

      case "approve-skill": {
        const name = rest.join(" ").trim();
        if (!name) throw new Error("approve-skill requires a skill name");
        const skill = await approveDraftSkill(ctx.db, ctx.root, name);
        print({ approved: true, skill: skill.manifest.name, status: skill.manifest.status });
        return 0;
      }

      case "reject-skill": {
        const name = rest.join(" ").trim();
        if (!name) throw new Error("reject-skill requires a skill name");
        const skill = await rejectDraftSkill(ctx.db, ctx.root, name);
        print({ rejected: true, skill: skill.manifest.name, status: skill.manifest.status });
        return 0;
      }

      case "outcome": {
        const name = rest.join(" ").trim();
        if (!name) throw new Error("outcome requires a skill name");
        const result = await recordSkillOutcome(
          ctx.db,
          ctx.root,
          name,
          parsed.flags.failure !== "true",
        );
        print({ skill: name, ...result });
        return 0;
      }

      case "consolidate": {
        const curator =
          parsed.flags.curator === "true" ? createAdapterFromEnv() : undefined;
        if (parsed.flags.curator === "true" && !curator) {
          throw new Error("consolidate --curator requires GEMINI_API_KEY");
        }
        const report = await consolidate(ctx, {
          idle: parsed.flags.idle === "true",
          charging: parsed.flags.charging === "true",
          retentionDays: numberFlag(parsed.flags, "retention-days"),
          mergeDuplicates: parsed.flags["merge-duplicates"] === "true",
          ...(curator ? { curator } : {}),
          ...(parsed.flags["propose-merges"] === "true" && curator
            ? { mergeAdapter: curator }
            : {}),
        });
        print(report);
        return 0;
      }

      case "chat": {
        const text = rest.join(" ").trim();
        if (!text) throw new Error("chat requires a message");
        const chatAdapter = createChatAdapterFromEnv();
        if (!chatAdapter) {
          throw new Error(
            "GEMINI_API_KEY is not set; chat needs a model adapter",
          );
        }
        const cwd = parsed.flags.cwd ?? process.cwd();
        const gate =
          parsed.flags.yes === "true"
            ? new AutoApprovalGate()
            : process.stdin.isTTY
              ? new CliApprovalGate()
              : new DenyApprovalGate();
        try {
          const result = await runAssistant({
            message: text,
            ctx,
            adapter: chatAdapter,
            approval: gate,
            projectCwd: cwd,
            sessionId: parsed.flags.session ?? "cli",
            agentId,
            maxSteps: numberFlag(parsed.flags, "max-steps"),
            processRunner: new NodeProcessRunner(),
            extractor: createAdapterFromEnv(),
            embeddingAdapter: createEmbeddingAdapterFromEnv(),
            onEvent(event) {
              if (parsed.flags.json === "true") return;
              if (event.type === "tool") {
                process.stderr.write(
                  `[nástroj ${event.call.name}] ${event.outcome.isError ? "chyba" : "ok"}\n`,
                );
              } else if (event.type === "approval" && event.decision === "deny") {
                process.stderr.write("[schválení] zamítnuto\n");
              }
            },
          });
          if (parsed.flags.json === "true") print(result);
          else {
            process.stdout.write(`${result.text}\n`);
            if (result.remembered.length) {
              process.stderr.write(`[paměť] uloženo: ${result.remembered.join(", ")}\n`);
            }
          }
          return 0;
        } finally {
          if (gate instanceof CliApprovalGate) gate.close();
        }
      }

      case "sessions": {
        print(
          listSessions(ctx.db, {
            projectId: ctx.projectId,
            agentId: ctx.agentId,
            limit: numberFlag(parsed.flags, "limit"),
          }),
        );
        return 0;
      }

      case "ui": {
        const memory = ctx.db
          .prepare(
            `SELECT name, description, body, scope, scope_owner AS scopeOwner,
                    path, pinned, tags, updated
             FROM memory_items ORDER BY pinned DESC, updated DESC LIMIT 200`,
          )
          .all() as Array<Record<string, unknown>>;
        const skills = await scanSkills(ctx.root);
        const approvals = await listReviewQueue(ctx.db, ctx.root);
        const sessions = listSessions(ctx.db, {
          projectId: ctx.projectId,
          agentId: ctx.agentId,
          limit: 10,
        });
        const meta = Object.fromEntries(
          (ctx.db.prepare("SELECT key, value FROM meta").all() as Array<{
            key: string;
            value: string;
          }>).map((row) => [row.key, row.value]),
        );
        const episodeCount = Number(
          (ctx.db.prepare("SELECT COUNT(*) AS n FROM episodes").get() as { n: number }).n,
        );
        print({
          memory: memory.map((row) => ({
            ...row,
            tags: typeof row.tags === "string" ? row.tags.split(" ").filter(Boolean) : [],
            pinned: row.pinned === 1,
          })),
          skills: skills.skills.map((skill) => ({
            name: skill.manifest.name,
            description: skill.manifest.description,
            triggers: skill.manifest.triggers,
            status: skill.manifest.status,
            version: skill.manifest.version,
            permissions: skill.manifest.permissions,
            stats: getSkillStats(ctx.db, skill.manifest.name),
            path: skill.relPath,
          })),
          skillErrors: skills.errors,
          approvals: { ...approvals, merges: listMergeProposals(ctx.db, { status: "pending" }) },
          sessions,
          stats: {
            memory: memory.length,
            episodes: episodeCount,
            lastConsolidation: meta.last_consolidation ?? null,
          },
        });
        return 0;
      }

      case "route": {
        const query = rest.join(" ").trim();
        if (!query) throw new Error("route requires a query");
        print(
          routeSkill(ctx.db, query, { limit: 3 }).map((hit) => ({
            name: hit.skill.manifest.name,
            score: Number(hit.score.toFixed(2)),
            status: hit.skill.manifest.status,
          })),
        );
        return 0;
      }

      case "approve": {
        const [name, script] = rest;
        if (!name || !script) throw new Error("approve requires a skill name and a script path");
        const result = await approveScript(ctx.db, ctx.root, name, script);
        print({ approved: true, skill: name, script, hash: result.hash });
        return 0;
      }

      case "rebuild": {
        ctx.db.close();
        const file = databasePath(ctx.root);
        for (const suffix of ["", "-wal", "-shm"]) {
          await fs.rm(`${file}${suffix}`, { force: true });
        }
        const fresh = await openContext({
          root: ctx.root,
          projectId: ctx.projectId,
          agentId: ctx.agentId,
          sync: false,
        });
        try {
          print({
            memory: await syncIndex(fresh.db, fresh.store),
            skills: await syncSkills(fresh.db, fresh.root),
          });
        } finally {
          fresh.db.close();
        }
        return 0;
      }

      case "mcp": {
        await runMcpServer(ctx);
        return 0;
      }

      default:
        process.stderr.write(`Neznámý příkaz: ${command}\n\n${HELP}`);
        return 1;
    }
  } finally {
    try {
      ctx.db.close();
    } catch {
      // The rebuild command closes it explicitly.
    }
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
