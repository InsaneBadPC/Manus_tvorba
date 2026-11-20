import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  parseFrontmatter,
  serializeFrontmatter,
  stringArrayField,
  stringField,
} from "./frontmatter.ts";
import { relativeTo, resolveInside, skillsRoot, slugify } from "./paths.ts";
import { tokenize } from "./retrieval.ts";
import type { MemoryDatabase } from "./db.ts";
import type { SkillFile, SkillHit, SkillManifest } from "./types.ts";

export class SkillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillError";
  }
}

export interface SkillScanError {
  relPath: string;
  message: string;
}

export interface SkillScanResult {
  skills: SkillFile[];
  errors: SkillScanError[];
}

const STATUSES = new Set(["active", "probation", "disabled"]);

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function parseSkill(raw: string, absPath: string, root: string): SkillFile {
  const parsed = parseFrontmatter(raw);
  const data = parsed.data;
  const name = stringField(data, "name").trim();
  const description = stringField(data, "description").trim();
  if (!name) throw new SkillError(`${absPath}: missing name`);
  if (!description) throw new SkillError(`${absPath}: missing description`);

  const statusValue = stringField(data, "status", "active");
  if (!STATUSES.has(statusValue)) {
    throw new SkillError(`${absPath}: unknown status '${statusValue}'`);
  }

  const manifest: SkillManifest = {
    name,
    description,
    triggers: stringArrayField(data, "triggers"),
    allowedTools: [
      ...stringArrayField(data, "allowed-tools"),
      ...stringArrayField(data, "allowed_tools"),
    ],
    permissions: stringArrayField(data, "permissions"),
    version: stringField(data, "version", "1.0.0"),
    status: statusValue as SkillManifest["status"],
  };

  return {
    absPath,
    relPath: relativeTo(root, absPath),
    dir: path.dirname(absPath),
    hash: hash(raw),
    skillHash: hash(`${JSON.stringify(manifest)}\n${parsed.body}`),
    manifest,
    body: parsed.body,
  };
}

export async function scanSkills(root: string): Promise<SkillScanResult> {
  const base = skillsRoot(root);
  const skills: SkillFile[] = [];
  const errors: SkillScanError[] = [];
  let entries;
  try {
    entries = await fs.readdir(base, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { skills, errors };
    throw error;
  }

  const names = new Set<string>();
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const absPath = path.join(base, entry.name, "SKILL.md");
    let raw: string;
    try {
      raw = await fs.readFile(absPath, "utf8");
    } catch {
      continue;
    }
    try {
      const skill = parseSkill(raw, absPath, root);
      const key = skill.manifest.name.toLowerCase();
      if (names.has(key)) throw new SkillError("duplicate skill name");
      names.add(key);
      skills.push(skill);
    } catch (error) {
      errors.push({
        relPath: relativeTo(root, absPath),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  skills.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  return { skills, errors };
}

export interface SkillSyncReport {
  added: number;
  updated: number;
  removed: number;
  errors: SkillScanError[];
}

export async function syncSkills(
  db: MemoryDatabase,
  root: string,
): Promise<SkillSyncReport> {
  const scan = await scanSkills(root);
  const files = new Map(scan.skills.map((skill) => [skill.relPath, skill]));
  const existing = new Map<string, { id: number; hash: string }>();
  for (const row of db.prepare("SELECT id, path, hash FROM skills").all() as Array<{
    id: number;
    path: string;
    hash: string;
  }>) {
    existing.set(row.path, { id: Number(row.id), hash: row.hash });
  }

  const report: SkillSyncReport = {
    added: 0,
    updated: 0,
    removed: 0,
    errors: scan.errors,
  };

  db.exec("BEGIN");
  try {
    for (const [relPath] of existing) {
      if (!files.has(relPath)) {
        const row = existing.get(relPath);
        if (row) {
          db.prepare("DELETE FROM skills_fts WHERE rowid = ?").run(row.id);
          db.prepare("DELETE FROM skills WHERE id = ?").run(row.id);
        }
        report.removed += 1;
      }
    }

    for (const [relPath, skill] of files) {
      const previous = existing.get(relPath);
      if (previous && previous.hash === skill.hash) continue;
      try {
        const row = db
          .prepare(
            `INSERT INTO skills
              (path, hash, name, description, triggers, allowed_tools, permissions, version, status, body)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(path) DO UPDATE SET
               hash=excluded.hash, name=excluded.name, description=excluded.description,
               triggers=excluded.triggers, allowed_tools=excluded.allowed_tools,
               permissions=excluded.permissions, version=excluded.version,
               status=excluded.status, body=excluded.body
             RETURNING id`,
          )
          .get(
            skill.relPath,
            skill.hash,
            skill.manifest.name,
            skill.manifest.description,
            skill.manifest.triggers.join("\n"),
            skill.manifest.allowedTools.join(" "),
            skill.manifest.permissions.join(" "),
            skill.manifest.version,
            skill.manifest.status,
            skill.body,
          ) as { id: number };
        const id = Number(row.id);
        db.prepare("DELETE FROM skills_fts WHERE rowid = ?").run(id);
        db.prepare(
          "INSERT INTO skills_fts(rowid, name, description, triggers) VALUES (?, ?, ?, ?)",
        ).run(id, skill.manifest.name, skill.manifest.description, skill.manifest.triggers.join(" "));
        if (previous) report.updated += 1;
        else report.added += 1;
      } catch (error) {
        report.errors.push({
          relPath,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return report;
}

interface SkillRow {
  id: number;
  path: string;
  hash: string;
  name: string;
  description: string;
  triggers: string;
  allowed_tools: string;
  permissions: string;
  version: string;
  status: string;
  body: string;
}

function rowToSkill(row: SkillRow): SkillFile {
  return {
    absPath: "",
    relPath: row.path,
    dir: "",
    hash: row.hash,
    skillHash: row.hash,
    manifest: {
      name: row.name,
      description: row.description,
      triggers: row.triggers ? row.triggers.split(/\n|\s{2,}/).filter(Boolean) : [],
      allowedTools: row.allowed_tools ? row.allowed_tools.split(" ").filter(Boolean) : [],
      permissions: row.permissions ? row.permissions.split(" ").filter(Boolean) : [],
      version: row.version,
      status: row.status as SkillManifest["status"],
    },
    body: row.body,
  };
}

function tokenMatch(query: string[], trigger: string): boolean {
  const triggerTokens = tokenize(trigger);
  return triggerTokens.some((token) =>
    query.some(
      (word) =>
        word === token ||
        (token.length >= 4 && word.startsWith(token)) ||
        (word.length >= 4 && token.startsWith(word)),
    ),
  );
}

export function routeSkill(
  db: MemoryDatabase,
  query: string,
  options: { limit?: number } = {},
): SkillHit[] {
  const words = tokenize(query);
  if (words.length === 0) return [];
  const lower = query.toLowerCase();
  const rows = db
    .prepare("SELECT * FROM skills WHERE status != 'disabled'")
    .all() as unknown as SkillRow[];

  const hits: SkillHit[] = [];
  for (const row of rows) {
    const skill = rowToSkill(row);
    let score = 0;
    for (const trigger of skill.manifest.triggers) {
      if (trigger && lower.includes(trigger.toLowerCase())) score += 3;
      else if (tokenMatch(words, trigger)) score += 1.5;
    }
    for (const word of words) {
      if (skill.manifest.name.toLowerCase().includes(word) && word.length >= 4) score += 1;
      if (skill.manifest.description.toLowerCase().includes(word) && word.length >= 5) score += 0.3;
    }
    if (score >= 1.5) hits.push({ skill, score });
  }

  hits.sort((a, b) => b.score - a.score || a.skill.manifest.name.localeCompare(b.skill.manifest.name));
  return hits.slice(0, Math.max(1, options.limit ?? 1));
}

export function loadSkill(db: MemoryDatabase, name: string): SkillFile | undefined {
  const row = db
    .prepare("SELECT * FROM skills WHERE name = ? COLLATE NOCASE")
    .get(name) as SkillRow | undefined;
  return row ? rowToSkill(row) : undefined;
}

export function recordSkillUse(
  db: MemoryDatabase,
  name: string,
  success: boolean,
): void {
  const row = db
    .prepare("SELECT id FROM skills WHERE name = ? COLLATE NOCASE")
    .get(name) as { id: number } | undefined;
  if (!row) return;
  const id = Number(row.id);
  db.prepare(
    `INSERT INTO skill_stats(skill_id, uses, successes, failures, last_used)
     VALUES (?, 1, ?, ?, ?)
     ON CONFLICT(skill_id) DO UPDATE SET
       uses=uses+1, successes=successes+excluded.successes,
       failures=failures+excluded.failures, last_used=excluded.last_used`,
  ).run(id, success ? 1 : 0, success ? 0 : 1, new Date().toISOString());
}

export interface ScriptPermission {
  allowed: boolean;
  reason: string;
  hash?: string;
}

/**
 * A skill script is runnable only when the manifest grants script execution
 * and the exact current file hash has been explicitly approved.
 */
export async function canRunScript(
  db: MemoryDatabase,
  root: string,
  name: string,
  scriptPath: string,
): Promise<ScriptPermission> {
  const row = db
    .prepare("SELECT * FROM skills WHERE name = ? COLLATE NOCASE")
    .get(name) as SkillRow | undefined;
  if (!row) return { allowed: false, reason: "skill not found" };
  if (row.status === "disabled") return { allowed: false, reason: "skill is disabled" };
  const permissions = row.permissions.split(" ").filter(Boolean);
  if (!permissions.includes("run-scripts") && !permissions.includes("execute")) {
    return { allowed: false, reason: "skill does not request script execution" };
  }

  let absScript: string;
  try {
    const skillDir = path.dirname(resolveInside(root, row.path));
    absScript = resolveInside(skillDir, scriptPath);
  } catch {
    return { allowed: false, reason: "script path is outside the skill directory" };
  }

  let content: string;
  try {
    content = await fs.readFile(absScript, "utf8");
  } catch {
    return { allowed: false, reason: "script file is missing" };
  }
  const scriptHash = hash(content);
  const approval = db
    .prepare("SELECT 1 AS ok FROM skill_approvals WHERE skill_id = ? AND script_hash = ?")
    .get(Number(row.id), scriptHash) as { ok: number } | undefined;
  if (!approval) {
    return { allowed: false, reason: "script hash is not approved", hash: scriptHash };
  }
  return { allowed: true, reason: "approved", hash: scriptHash };
}

export async function approveScript(
  db: MemoryDatabase,
  root: string,
  name: string,
  scriptPath: string,
): Promise<{ hash: string }> {
  const row = db
    .prepare("SELECT * FROM skills WHERE name = ? COLLATE NOCASE")
    .get(name) as SkillRow | undefined;
  if (!row) throw new SkillError(`skill '${name}' not found`);

  const skillDir = path.dirname(resolveInside(root, row.path));
  const absScript = resolveInside(skillDir, scriptPath);
  const content = await fs.readFile(absScript, "utf8");
  const scriptHash = hash(content);
  db.prepare(
    `INSERT INTO skill_approvals(skill_id, script_hash, approved_at)
     VALUES (?, ?, ?)
     ON CONFLICT(skill_id, script_hash) DO UPDATE SET approved_at=excluded.approved_at`,
  ).run(Number(row.id), scriptHash, new Date().toISOString());
  return { hash: scriptHash };
}

export interface SkillProposal {
  name: string;
  description: string;
  triggers?: string[];
  body: string;
  permissions?: string[];
}

export async function proposeSkill(
  root: string,
  proposal: SkillProposal,
): Promise<{ absPath: string; relPath: string }> {
  const name = proposal.name.trim();
  const description = proposal.description.trim();
  if (name.length < 2 || name.length > 60) throw new SkillError("invalid skill name");
  if (!description) throw new SkillError("skill description is required");

  const dir = path.join(skillsRoot(root), slugify(name));
  await fs.mkdir(dir, { recursive: true });
  const absPath = path.join(dir, "SKILL.md");
  const content = serializeFrontmatter(
    {
      name,
      description,
      triggers: proposal.triggers ?? [],
      permissions: proposal.permissions ?? [],
      version: "0.1.0",
      status: "probation",
    },
    proposal.body,
  );
  await fs.writeFile(absPath, content, { encoding: "utf8", mode: 0o600 });
  return { absPath, relPath: relativeTo(root, absPath) };
}
