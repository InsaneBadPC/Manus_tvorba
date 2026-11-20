import fs from "node:fs/promises";
import { databasePath, syncIndex } from "./db.ts";
import { openContext } from "./context.ts";
import { remember } from "./extract.ts";
import { buildContext, searchMemory } from "./retrieval.ts";
import {
  approveScript,
  routeSkill,
  scanSkills,
  syncSkills,
} from "./skills.ts";
import { createAdapterFromEnv } from "./adapters/gemini.ts";
import { FakeAdapter } from "./adapters/fake.ts";
import { runMcpServer } from "./mcp.ts";

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
  context <dotaz>           sestaví kontext do tahu (--limit)
  remember <text>           vytáhne a uloží trvalé záznamy (Gemini)
  skills                    vypíše nainstalované skilly
  route <dotaz>             vybere skill pro zprávu
  approve <skill> <skript>  schválí konkrétní hash skriptu
  rebuild                   smaže a znovu postaví index
  mcp                       spustí MCP server na stdio

Společné volby:
  --root <cesta>            kořen agenta (výchozí ~/.agent)
  --project <id>            aktuální projekt
  --agent <id>              aktuální agent
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
        const hits = searchMemory(ctx.db, query, {
          projectId: ctx.projectId,
          agentId: ctx.agentId,
          allScopes: parsed.flags.all === "true",
          limit: numberFlag(parsed.flags, "limit"),
        });
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
        const result = buildContext(ctx.db, query, {
          projectId: ctx.projectId,
          agentId: ctx.agentId,
          ...(limit ? { budget: { maxRecords: limit } } : {}),
        });
        process.stdout.write(result.text);
        process.stderr.write(
          `chars=${result.chars} tokens~${result.estimatedTokens} ms=${result.elapsedMs.toFixed(1)}\n`,
        );
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
            path: skill.relPath,
          })),
          errors: scan.errors,
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
