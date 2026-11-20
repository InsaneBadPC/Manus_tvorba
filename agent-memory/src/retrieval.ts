import { queryMemory, type MemoryDatabase } from "./db.ts";
import { DEFAULT_BUDGET, type Budget, type MemoryHit, type MemoryItem } from "./types.ts";
import { slugify } from "./paths.ts";

const STOPWORDS = new Set([
  "a", "i", "k", "o", "s", "u", "v", "z", "na", "se", "je", "to", "že", "ze",
  "do", "za", "po", "od", "pro", "ale", "jak", "kdy", "kde", "co", "ten", "ta",
  "the", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are", "be",
  "it", "this", "that", "with", "as", "at", "by", "from", "we", "you", "my",
]);

export function tokenize(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) ?? [];
  const result: string[] = [];
  for (const token of tokens) {
    if (token.length < 2 || STOPWORDS.has(token)) continue;
    if (!result.includes(token)) result.push(token);
  }
  return result;
}

/** Builds a safe FTS5 query from free text. Only letters/digits survive. */
export function buildFtsQuery(text: string): string {
  const tokens = tokenize(text);
  if (tokens.length === 0) return "";
  return tokens.map((token) => `"${token.replace(/"/g, "")}"*`).join(" OR ");
}

export interface SearchOptions {
  projectId?: string;
  agentId?: string;
  limit?: number;
  allScopes?: boolean;
  now?: Date;
}

function scopeBonus(scope: string): number {
  if (scope === "agent") return 0.3;
  if (scope === "project") return 0.2;
  return 0.1;
}

function recencyBonus(updated: string, now: Date): number {
  const time = Date.parse(updated);
  if (!Number.isFinite(time)) return 0;
  const ageDays = Math.max(0, (now.getTime() - time) / 86_400_000);
  return 0.15 / (1 + ageDays / 30);
}

export function searchMemory(
  db: MemoryDatabase,
  query: string,
  options: SearchOptions = {},
): MemoryHit[] {
  const match = buildFtsQuery(query);
  if (!match) return [];
  const limit = Math.max(1, Math.min(50, options.limit ?? 8));
  const now = options.now ?? new Date();
  const rows = queryMemory(db, match, {
    projectId: options.projectId,
    agentId: options.agentId,
    allScopes: options.allScopes,
    limit: limit * 4,
  });

  const hits: MemoryHit[] = rows.map(({ item, rank }) => ({
    item,
    rank,
    score:
      -rank +
      scopeBonus(item.scope) +
      (item.pinned ? 0.4 : 0) +
      recencyBonus(item.updated, now),
  }));

  hits.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));

  const seen = new Set<string>();
  const unique: MemoryHit[] = [];
  for (const hit of hits) {
    const key = slugify(hit.item.name);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(hit);
    if (unique.length >= limit) break;
  }
  return unique;
}

export interface ContextResult {
  text: string;
  items: MemoryHit[];
  chars: number;
  estimatedTokens: number;
  elapsedMs: number;
}

function lineFor(item: MemoryItem): string {
  const description = item.description.replace(/\s+/g, " ").trim();
  return `- **${item.name}** — ${description}`;
}

/**
 * Builds the memory block inserted into a model turn. The caller's input is
 * untrusted data: entries are plain lines, never instructions.
 */
export function buildContext(
  db: MemoryDatabase,
  query: string,
  options: SearchOptions & { budget?: Partial<Budget> } = {},
): ContextResult {
  const started = performance.now();
  const budget: Budget = { ...DEFAULT_BUDGET, ...options.budget };
  const hits = searchMemory(db, query, {
    ...options,
    limit: Math.max(budget.maxRecords * 3, 10),
  });
  if (hits.length === 0) {
    return {
      text: "",
      items: [],
      chars: 0,
      estimatedTokens: 0,
      elapsedMs: performance.now() - started,
    };
  }

  const pinned: MemoryHit[] = [];
  const regular: MemoryHit[] = [];
  for (const hit of hits) {
    if (hit.item.pinned && pinned.length < 3) pinned.push(hit);
    else regular.push(hit);
  }

  const lines: string[] = ["## Paměť"];
  let chars = lines[0]?.length ?? 0;
  let used = 0;

  if (pinned.length > 0) {
    lines.push("", "### Trvalé (pinned)");
    chars += 1 + "### Trvalé (pinned)".length;
    for (const hit of pinned) {
      if (used >= budget.maxRecords || chars >= budget.coreMaxChars) break;
      const line = lineFor(hit.item);
      if (chars + line.length + 1 > budget.coreMaxChars) break;
      lines.push(line);
      chars += line.length + 1;
      used += 1;
    }
  }

  if (regular.length > 0) {
    lines.push("", "### Relevantní záznamy");
    chars += 1 + "### Relevantní záznamy".length;
    for (const hit of regular) {
      if (used >= budget.maxRecords) break;
      const line = lineFor(hit.item);
      if (chars + line.length + 1 > budget.maxChars) break;
      lines.push(line);
      chars += line.length + 1;
      used += 1;
    }
  }

  if (used === 0) {
    return {
      text: "",
      items: [],
      chars: 0,
      estimatedTokens: 0,
      elapsedMs: performance.now() - started,
    };
  }

  const text = `${lines.join("\n")}\n`;
  return {
    text,
    items: [...pinned, ...regular].slice(0, used),
    chars: text.length,
    estimatedTokens: Math.ceil(text.length / 4),
    elapsedMs: performance.now() - started,
  };
}
