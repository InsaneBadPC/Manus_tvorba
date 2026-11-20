import { containsSecret } from "./extract.ts";
import { listEpisodes } from "./episodes.ts";
import { slugify } from "./paths.ts";
import { proposeSkill, scanSkills, syncSkills, type SkillProposal } from "./skills.ts";
import type { MemoryDatabase } from "./db.ts";
import type { Episode } from "./types.ts";

export interface DetectOptions {
  projectId?: string;
  agentId?: string;
  minSteps?: number;
  minRepeats?: number;
  limit?: number;
  dryRun?: boolean;
}

export interface DetectedSkill {
  name: string;
  description: string;
  triggers: string[];
  path?: string;
  reason: "repeated-sequence" | "successful-session";
  evidence: { steps: number; sessions: number };
  body: string;
}

interface SignatureGroup {
  signature: string;
  tools: string[];
  steps: number;
  sessions: Set<string>;
  stepsBySession: Map<string, number>;
}

function sessionKey(episode: Episode): string {
  // Without an explicit session, a single episode is its own session so
  // unrelated notes never become a fake "long successful session".
  return episode.session || `episode:${episode.id}`;
}

function buildProposal(group: SignatureGroup): SkillProposal {
  const name = `postup-${slugify(group.signature)}`.slice(0, 60).replace(/-+$/, "");
  const sequence = group.tools
    .map((tool, index) => `${index + 1}. \`${tool}\``)
    .join("\n");
  const body = [
    "# Automaticky navržený postup",
    "",
    "Tento draft vznikl z opakované sekvence nástrojů, ne z textu uživatele.",
    "Před schválením zkontroluj, že kroky odpovídají skutečnému pracovnímu postupu.",
    "",
    "## Sekvence",
    sequence,
    "",
    "## Evidence",
    `- kroků: ${group.steps}`,
    `- různých relací: ${group.sessions.size}`,
  ].join("\n");

  return {
    name,
    description: `Opakovaný postup: ${group.tools.join(" → ")}`.slice(0, 500),
    triggers: [...new Set(group.tools)].slice(0, 8),
    body,
    status: "draft",
  };
}

/**
 * Finds successful repeated tool sequences or long successful sessions and
 * writes bounded draft skills. Episodes are grouped by session and their tool
 * order is preserved. Free-form episode text is never copied into a skill, so
 * untrusted logs cannot inject instructions.
 */
export async function detectSkills(
  db: MemoryDatabase,
  root: string,
  options: DetectOptions = {},
): Promise<DetectedSkill[]> {
  const minSteps = Math.max(2, Math.floor(options.minSteps ?? 3));
  const minRepeats = Math.max(2, Math.floor(options.minRepeats ?? 3));
  const limit = Math.max(1, Math.min(20, Math.floor(options.limit ?? 5)));
  const episodes = listEpisodes(db, {
    projectId: options.projectId,
    agentId: options.agentId,
    limit: 500,
  });

  const bySession = new Map<string, Episode[]>();
  for (const episode of episodes) {
    if (!episode.success || episode.tools.length === 0) continue;
    const key = sessionKey(episode);
    const list = bySession.get(key) ?? [];
    list.push(episode);
    bySession.set(key, list);
  }

  const groups = new Map<string, SignatureGroup>();
  for (const [session, steps] of bySession) {
    steps.sort((a, b) => a.created.localeCompare(b.created) || a.id - b.id);
    const tools = steps.flatMap((episode) => episode.tools);
    if (tools.length < 2) continue;
    const signature = tools.join(" > ");
    if (containsSecret(signature)) continue;
    const group = groups.get(signature) ?? {
      signature,
      tools,
      steps: 0,
      sessions: new Set<string>(),
      stepsBySession: new Map<string, number>(),
    };
    group.steps += tools.length;
    group.sessions.add(session);
    group.stepsBySession.set(session, tools.length);
    groups.set(signature, group);
  }

  const existing = new Set(
    (await scanSkills(root)).skills.map((skill) => skill.manifest.name.toLowerCase()),
  );
  const detected: DetectedSkill[] = [];
  const detectedNames = new Set<string>();

  for (const group of groups.values()) {
    if (detected.length >= limit) break;
    const repeated = group.sessions.size >= minRepeats;
    const longSession = [...group.stepsBySession.values()].some(
      (steps) => steps >= minSteps,
    );
    if (!repeated && !longSession) continue;

    const proposal = buildProposal(group);
    const key = proposal.name.toLowerCase();
    if (existing.has(key) || detectedNames.has(key)) continue;
    if (containsSecret(`${proposal.name}\n${proposal.description}\n${proposal.body}`)) continue;

    const result: DetectedSkill = {
      name: proposal.name,
      description: proposal.description,
      triggers: proposal.triggers ?? [],
      body: proposal.body,
      reason: repeated ? "repeated-sequence" : "successful-session",
      evidence: { steps: group.steps, sessions: group.sessions.size },
    };

    if (!options.dryRun) {
      try {
        const written = await proposeSkill(root, proposal);
        result.path = written.relPath;
      } catch {
        // A slug collision with an unrelated existing skill must not abort
        // the other candidates.
        continue;
      }
    }
    detectedNames.add(key);
    detected.push(result);
  }

  if (!options.dryRun && detected.length > 0) await syncSkills(db, root);
  return detected;
}
