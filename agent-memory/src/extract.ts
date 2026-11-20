import type { MemoryDatabase } from "./db.ts";
import { getByName, upsertItem } from "./db.ts";
import { slugify } from "./paths.ts";
import { normalizeTags, type MemoryStore } from "./store.ts";
import {
  isMemoryScope,
  isMemorySource,
  type ExtractionRequest,
  type ExtractionSkip,
  type MemoryCandidate,
  type MemoryFile,
  type ModelAdapter,
  type RememberReport,
  type ValidMemoryCandidate,
} from "./types.ts";

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\b(?:password|passwd|heslo|api[_-]?key|secret)\s*[:=]\s*\S{6,}/i,
];

export function containsSecret(value: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

export type ValidationResult =
  | { ok: true; value: ValidMemoryCandidate }
  | { ok: false; reason: string };

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function validateCandidate(
  raw: MemoryCandidate,
  defaults: { projectId?: string; agentId?: string } = {},
): ValidationResult {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "not an object" };

  const name = cleanText(raw.name, 100);
  if (name.length < 2) return { ok: false, reason: "name is too short" };
  const description = cleanText(raw.description, 500);
  if (!description) return { ok: false, reason: "description is empty" };
  const body = typeof raw.body === "string" ? raw.body : "";
  if (body.length > 20_000) return { ok: false, reason: "body is too long" };

  let tags: string[];
  try {
    tags = normalizeTags(raw.tags);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "invalid tags" };
  }

  let scope: ValidMemoryCandidate["scope"];
  if (raw.scope === undefined) {
    scope = defaults.projectId ? "project" : "global";
  } else if (isMemoryScope(raw.scope)) {
    scope = raw.scope;
  } else {
    return { ok: false, reason: "unknown scope" };
  }
  if (scope === "project" && !defaults.projectId) scope = "global";
  if (scope === "agent" && !defaults.agentId) scope = "global";

  let source: ValidMemoryCandidate["source"];
  if (raw.source === undefined) source = "inferred";
  else if (isMemorySource(raw.source)) source = raw.source;
  else return { ok: false, reason: "unknown source" };

  const confidence =
    typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
      ? Math.min(1, Math.max(0, raw.confidence))
      : 0.5;

  const durability = raw.durability === "ephemeral" ? "ephemeral" : "durable";

  return {
    ok: true,
    value: { name, description, body, tags, scope, confidence, source, durability },
  };
}

export interface RememberOptions {
  adapter: ModelAdapter;
  store: MemoryStore;
  db: MemoryDatabase;
  projectId?: string;
  agentId?: string;
}

/**
 * The model proposes candidates; this function decides what is stored.
 * Model output is never trusted to write files directly.
 */
export async function remember(
  input: string,
  options: RememberOptions,
): Promise<RememberReport> {
  const text = input.trim();
  if (!text) return { saved: [], skipped: [] };

  const existingNames = (
    options.db.prepare("SELECT name FROM memory_items ORDER BY updated DESC LIMIT 200").all() as Array<{
      name: string;
    }>
  ).map((row) => row.name);

  const request: ExtractionRequest = {
    text,
    projectId: options.projectId,
    agentId: options.agentId,
    existingNames,
  };
  const candidates = await options.adapter.extract(request);
  if (!Array.isArray(candidates)) {
    return {
      saved: [],
      skipped: [{ name: "(adapter)", reason: "adapter did not return an array" }],
    };
  }

  const saved: MemoryFile[] = [];
  const skipped: ExtractionSkip[] = [];
  const batch = new Set<string>();

  for (const raw of candidates) {
    const validation = validateCandidate(raw, {
      projectId: options.projectId,
      agentId: options.agentId,
    });
    if (!validation.ok) {
      skipped.push({ name: cleanText(raw?.name, 60) || "(unnamed)", reason: validation.reason });
      continue;
    }
    const candidate = validation.value;

    if (candidate.durability === "ephemeral") {
      skipped.push({ name: candidate.name, reason: "ephemeral content" });
      continue;
    }

    const searchable = `${candidate.name}\n${candidate.description}\n${candidate.body}`;
    if (containsSecret(searchable)) {
      skipped.push({ name: candidate.name, reason: "possible secret" });
      continue;
    }

    const slug = slugify(candidate.name);
    if (batch.has(slug)) {
      skipped.push({ name: candidate.name, reason: "duplicate in batch" });
      continue;
    }
    batch.add(slug);

    const existing = getByName(options.db, candidate.name);
    if (existing) {
      const expectedOwner =
        candidate.scope === "project"
          ? (options.projectId ?? "")
          : candidate.scope === "agent"
            ? (options.agentId ?? "")
            : "";
      const sameLocation =
        existing.scope === candidate.scope && existing.scopeOwner === expectedOwner;
      const sameDescription =
        existing.description.trim().toLowerCase() ===
        candidate.description.trim().toLowerCase();
      if (sameLocation && sameDescription) {
        skipped.push({ name: candidate.name, reason: "duplicate" });
        continue;
      }
    }

    try {
      const { file } = await options.store.save({
        name: candidate.name,
        description: candidate.description,
        body: candidate.body,
        scope: candidate.scope,
        source: candidate.source,
        confidence: candidate.confidence,
        tags: candidate.tags,
      });
      upsertItem(options.db, file);
      saved.push(file);
    } catch (error) {
      skipped.push({
        name: candidate.name,
        reason: error instanceof Error ? error.message : "write failed",
      });
    }
  }

  return { saved, skipped };
}
