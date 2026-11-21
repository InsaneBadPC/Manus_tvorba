import { createHash, randomBytes } from "node:crypto";
import { backupExisting } from "./backups.ts";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  allocatePath,
  memoryRoot,
  relativeTo,
  resolveInside,
  scopeDirectory,
  slugify,
  toPosix,
} from "./paths.ts";
import {
  parseFrontmatter,
  serializeFrontmatter,
  stringArrayField,
  stringField,
} from "./frontmatter.ts";
import {
  isMemoryScope,
  isMemorySource,
  type MemoryFile,
  type MemoryInput,
  type MemoryScope,
} from "./types.ts";

export class MemoryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryValidationError";
  }
}

export interface ScanError {
  relPath: string;
  message: string;
}

export interface ScanResult {
  files: MemoryFile[];
  errors: ScanError[];
}

export interface StoreOptions {
  root: string;
  projectId?: string;
  agentId?: string;
  now?: () => Date;
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function limit(value: string, max: number, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new MemoryValidationError(`${label} exceeds ${max} characters`);
  }
  return trimmed;
}

export function normalizeTags(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new MemoryValidationError("tags must be an array");
  const tags: string[] = [];
  for (const tag of value) {
    if (typeof tag !== "string") throw new MemoryValidationError("tag must be a string");
    const clean = limit(tag, 40, "tag").replace(/\s+/g, "-");
    if (clean && !tags.includes(clean)) tags.push(clean);
    if (tags.length > 12) throw new MemoryValidationError("at most 12 tags are allowed");
  }
  return tags;
}

export function validateMemoryInput(
  input: MemoryInput,
  defaultOwner = "",
): {
  name: string;
  description: string;
  body: string;
  scope: MemoryScope;
  scopeOwner: string;
  source: "stated" | "inferred" | "imported";
  confidence: number;
  pinned: boolean;
  tags: string[];
  created?: string;
  updated?: string;
} {
  if (!input || typeof input !== "object") {
    throw new MemoryValidationError("memory input must be an object");
  }
  const name = limit(typeof input.name === "string" ? input.name : "", 100, "name");
  if (name.length < 2) throw new MemoryValidationError("name is too short");
  const description = limit(
    typeof input.description === "string" ? input.description : "",
    500,
    "description",
  );
  const body = typeof input.body === "string" ? input.body : "";
  if (body.length > 20_000) throw new MemoryValidationError("body exceeds 20000 characters");

  const scope = input.scope ?? "global";
  if (!isMemoryScope(scope)) throw new MemoryValidationError(`unknown scope '${String(scope)}'`);
  const owner =
    scope === "global" ? "" : input.scopeOwner?.trim() || defaultOwner;
  if (scope !== "global" && !owner) {
    throw new MemoryValidationError(`scope '${scope}' requires an owner id`);
  }

  const source = input.source ?? "inferred";
  if (!isMemorySource(source)) {
    throw new MemoryValidationError(`unknown source '${String(source)}'`);
  }

  const rawConfidence = input.confidence ?? 0.5;
  if (typeof rawConfidence !== "number" || Number.isNaN(rawConfidence)) {
    throw new MemoryValidationError("confidence must be a number");
  }
  const confidence = Math.min(1, Math.max(0, rawConfidence));

  return {
    name,
    description,
    body,
    scope,
    scopeOwner: owner,
    source,
    confidence,
    pinned: input.pinned === true,
    tags: normalizeTags(input.tags),
    created: input.created,
    updated: input.updated,
  };
}

export class MemoryStore {
  readonly root: string;
  readonly projectId?: string;
  readonly agentId?: string;
  private readonly now: () => Date;

  constructor(options: StoreOptions) {
    this.root = path.resolve(options.root);
    this.projectId = options.projectId;
    this.agentId = options.agentId;
    this.now = options.now ?? (() => new Date());
  }

  private defaultOwner(scope: MemoryScope): string {
    if (scope === "project") return this.projectId ?? "";
    if (scope === "agent") return this.agentId ?? "";
    return "";
  }

  private directoryFor(scope: MemoryScope, owner?: string): string {
    return scopeDirectory(this.root, scope, owner || this.defaultOwner(scope));
  }

  async read(relPath: string): Promise<MemoryFile> {
    const absPath = resolveInside(this.root, relPath);
    return this.readAbsolute(absPath);
  }

  async readAbsolute(absPath: string): Promise<MemoryFile> {
    const raw = await fs.readFile(absPath, "utf8");
    return this.parseFile(absPath, raw);
  }

  parseFile(absPath: string, raw: string): MemoryFile {
    const parsed = parseFrontmatter(raw);
    const data = parsed.data;
    const name = stringField(data, "name").trim();
    const description = stringField(data, "description").trim();
    const scopeValue = stringField(data, "scope", "global");
    if (!isMemoryScope(scopeValue)) {
      throw new MemoryValidationError(`${absPath}: unknown scope '${scopeValue}'`);
    }
    const scopeOwner = stringField(data, "scope_owner");
    if (scopeValue !== "global" && !scopeOwner) {
      throw new MemoryValidationError(`${absPath}: missing scope_owner`);
    }
    const sourceValue = stringField(data, "source", "inferred");
    if (!isMemorySource(sourceValue)) {
      throw new MemoryValidationError(`${absPath}: unknown source '${sourceValue}'`);
    }
    const confidenceRaw = data["confidence"];
    const confidence =
      typeof confidenceRaw === "number" && Number.isFinite(confidenceRaw)
        ? Math.min(1, Math.max(0, confidenceRaw))
        : 0.5;
    const pinned = data["pinned"] === true;
    const created = stringField(data, "created") || new Date(0).toISOString();
    const updated = stringField(data, "updated") || created;

    if (!name) throw new MemoryValidationError(`${absPath}: missing name`);

    return {
      absPath,
      relPath: relativeTo(this.root, absPath),
      hash: hashContent(raw),
      body: parsed.body,
      data: {
        name,
        description,
        scope: scopeValue,
        scopeOwner,
        source: sourceValue,
        confidence,
        pinned,
        tags: stringArrayField(data, "tags"),
        created,
        updated,
      },
    };
  }

  /** Walks global, projects/* and agents/* memory directories. */
  async scan(): Promise<ScanResult> {
    const files: MemoryFile[] = [];
    const errors: ScanError[] = [];
    const base = memoryRoot(this.root);
    const directories: string[] = [path.join(base, "global")];
    for (const kind of ["projects", "agents"] as const) {
      const parent = path.join(base, kind);
      const entries = await safeReaddir(parent);
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith(".")) {
          directories.push(path.join(parent, entry.name));
        }
      }
    }

    for (const directory of directories) {
      const entries = await safeReaddir(directory);
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        const absPath = path.join(directory, entry.name);
        try {
          const raw = await fs.readFile(absPath, "utf8");
          files.push(this.parseFile(absPath, raw));
        } catch (error) {
          errors.push({
            relPath: toPosix(path.relative(this.root, absPath)),
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    files.sort((a, b) => a.relPath.localeCompare(b.relPath));
    return { files, errors };
  }

  async list(): Promise<MemoryFile[]> {
    return (await this.scan()).files;
  }

  async save(
    input: MemoryInput,
    options: { path?: string } = {},
  ): Promise<{ file: MemoryFile; created: boolean }> {
    const value = validateMemoryInput(input, this.defaultOwner(input.scope ?? "global"));
    const directory = this.directoryFor(value.scope, value.scopeOwner);
    await fs.mkdir(directory, { recursive: true });

    let target: string | undefined;
    if (options.path) {
      target = resolveInside(this.root, options.path);
    } else {
      const existing = await this.findByName(directory, value.name);
      if (existing) target = existing;
    }

    let created = true;
    let createdAt = value.created ?? this.now().toISOString();
    if (target) {
      try {
        const previous = await this.readAbsolute(target);
        created = false;
        createdAt = previous.data.created || createdAt;
      } catch {
        // A missing or invalid target is treated as a new file.
      }
    } else {
      target = allocatePath(directory, slugify(value.name), (candidate) =>
        fsSync.existsSync(candidate),
      );
    }

    const updatedAt = this.now().toISOString();
    const data = {
      name: value.name,
      description: value.description,
      scope: value.scope,
      scope_owner: value.scopeOwner,
      source: value.source,
      confidence: value.confidence,
      pinned: value.pinned,
      tags: value.tags,
      created: createdAt,
      updated: updatedAt,
    };
    const content = serializeFrontmatter(data, value.body);
    await backupExisting(this.root, relativeTo(this.root, target));
    await atomicWrite(target, content);
    const file = await this.readAbsolute(target);
    return { file, created };
  }

  private async findByName(directory: string, name: string): Promise<string | undefined> {
    const wanted = name.trim().toLowerCase();
    const entries = await safeReaddir(directory);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const candidate = path.join(directory, entry.name);
      try {
        const raw = await fs.readFile(candidate, "utf8");
        const parsed = parseFrontmatter(raw);
        if (stringField(parsed.data, "name").trim().toLowerCase() === wanted) {
          return candidate;
        }
      } catch {
        // Ignore broken files; they are reported by scan().
      }
    }
    return undefined;
  }

  async delete(relPath: string): Promise<void> {
    const absPath = resolveInside(this.root, relPath);
    if (!absPath.endsWith(".md")) throw new MemoryValidationError("only .md files can be deleted");
    await fs.unlink(absPath);
  }
}

async function safeReaddir(directory: string): Promise<import("node:fs").Dirent[]> {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function atomicWrite(target: string, content: string): Promise<void> {
  const temp = `${target}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  await fs.writeFile(temp, content, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temp, target);
}
