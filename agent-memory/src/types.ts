export const MEMORY_SCOPES = ["global", "project", "agent"] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export const MEMORY_SOURCES = ["stated", "inferred", "imported"] as const;
export type MemorySource = (typeof MEMORY_SOURCES)[number];

export const DURABILITIES = ["durable", "ephemeral"] as const;
export type Durability = (typeof DURABILITIES)[number];

export function isMemoryScope(value: unknown): value is MemoryScope {
  return typeof value === "string" && (MEMORY_SCOPES as readonly string[]).includes(value);
}

export function isMemorySource(value: unknown): value is MemorySource {
  return typeof value === "string" && (MEMORY_SOURCES as readonly string[]).includes(value);
}

/** Logical content of one memory markdown file (without storage metadata). */
export interface MemoryData {
  name: string;
  description: string;
  scope: MemoryScope;
  scopeOwner: string;
  source: MemorySource;
  confidence: number;
  pinned: boolean;
  tags: string[];
  created: string;
  updated: string;
}

/** A parsed memory file on disk. `relPath` is relative to the agent root. */
export interface MemoryFile {
  absPath: string;
  relPath: string;
  hash: string;
  data: MemoryData;
  body: string;
}

/** A memory row returned from SQLite. */
export interface MemoryItem extends MemoryData {
  id: number;
  relPath: string;
  hash: string;
  body: string;
}

export interface MemoryHit {
  item: MemoryItem;
  score: number;
  rank: number;
}

export interface MemoryInput {
  name: string;
  description: string;
  body?: string;
  scope?: MemoryScope;
  scopeOwner?: string;
  source?: MemorySource;
  confidence?: number;
  pinned?: boolean;
  tags?: string[];
  created?: string;
  updated?: string;
}

/** One candidate produced by a model adapter. Everything is untrusted. */
export interface MemoryCandidate {
  name?: unknown;
  description?: unknown;
  body?: unknown;
  tags?: unknown;
  scope?: unknown;
  confidence?: unknown;
  source?: unknown;
  durability?: unknown;
}

export interface ValidMemoryCandidate {
  name: string;
  description: string;
  body: string;
  tags: string[];
  scope: MemoryScope;
  confidence: number;
  source: MemorySource;
  durability: Durability;
}

export interface ExtractionRequest {
  text: string;
  projectId?: string;
  agentId?: string;
  existingNames?: string[];
}

export interface ModelAdapter {
  readonly name: string;
  extract(request: ExtractionRequest): Promise<MemoryCandidate[]>;
}

export interface ExtractionSkip {
  name: string;
  reason: string;
}

export interface RememberReport {
  saved: MemoryFile[];
  skipped: ExtractionSkip[];
}

export const SKILL_STATUSES = ["draft", "probation", "active", "disabled"] as const;
export type SkillStatus = (typeof SKILL_STATUSES)[number];

export interface SkillManifest {
  name: string;
  description: string;
  triggers: string[];
  allowedTools: string[];
  permissions: string[];
  version: string;
  status: SkillStatus;
}

export interface SkillStats {
  uses: number;
  successes: number;
  failures: number;
  lastUsed?: string;
}

export interface SkillFile {
  absPath: string;
  relPath: string;
  dir: string;
  hash: string;
  skillHash: string;
  manifest: SkillManifest;
  body: string;
}

export interface SkillHit {
  skill: SkillFile;
  score: number;
}

export interface Budget {
  maxRecords: number;
  maxChars: number;
  coreMaxChars: number;
}

export const EPISODE_KINDS = ["step", "error", "result", "note"] as const;
export type EpisodeKind = (typeof EPISODE_KINDS)[number];

export interface EpisodeInput {
  text: string;
  kind?: EpisodeKind;
  projectId?: string;
  agentId?: string;
  session?: string;
  success?: boolean;
  tools?: string[];
  meta?: Record<string, unknown>;
  created?: string;
}

export interface Episode {
  id: number;
  project: string;
  agent: string;
  kind: EpisodeKind;
  text: string;
  session: string;
  success: boolean;
  tools: string[];
  meta: Record<string, unknown>;
  created: string;
}

export const DEFAULT_BUDGET: Budget = {
  maxRecords: 5,
  maxChars: 3600,
  coreMaxChars: 1200,
};
