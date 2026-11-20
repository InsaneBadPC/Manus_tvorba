import os from "node:os";
import path from "node:path";
import { MEMORY_SCOPES, type MemoryScope } from "./types.ts";

export class PathSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathSafetyError";
  }
}

export function agentRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.AGENT_HOME?.trim() || path.join(os.homedir(), ".agent"));
}

export function memoryRoot(root: string): string {
  return path.join(root, "memory");
}

export function skillsRoot(root: string): string {
  return path.join(root, "skills");
}

export function safeSegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new PathSafetyError(`${label} must not be empty`);
  if (trimmed === "." || trimmed === ".." || /[\\/\0]/.test(trimmed)) {
    throw new PathSafetyError(`${label} contains an unsafe path segment`);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    throw new PathSafetyError(`${label} may contain only letters, digits, dot, dash and underscore`);
  }
  return trimmed;
}

export function slugify(value: string): string {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "memory";
}

/** Absolute directory for a scope. Project/agent scopes require an owner. */
export function scopeDirectory(root: string, scope: MemoryScope, owner = ""): string {
  const base = memoryRoot(root);
  if (!(MEMORY_SCOPES as readonly string[]).includes(scope)) {
    throw new PathSafetyError(`unknown memory scope '${scope}'`);
  }
  if (scope === "global") return path.join(base, "global");
  const segment = safeSegment(owner, `${scope} id`);
  return path.join(base, scope === "project" ? "projects" : "agents", segment);
}

/** Resolves `target` and refuses anything outside `base`. */
export function resolveInside(base: string, target: string): string {
  const resolvedBase = path.resolve(base);
  const resolved = path.resolve(resolvedBase, target);
  if (resolved !== resolvedBase && !resolved.startsWith(`${resolvedBase}${path.sep}`)) {
    throw new PathSafetyError(`path escapes ${resolvedBase}`);
  }
  return resolved;
}

export function toPosix(relPath: string): string {
  return relPath.split(path.sep).join("/");
}

export function relativeTo(root: string, absPath: string): string {
  return toPosix(path.relative(root, absPath));
}

/** Finds a free `<slug>.md`, `<slug>-2.md`, ... path in `dir`. */
export function allocatePath(dir: string, slug: string, exists: (p: string) => boolean): string {
  let candidate = path.join(dir, `${slug}.md`);
  let suffix = 2;
  while (exists(candidate)) {
    candidate = path.join(dir, `${slug}-${suffix}.md`);
    suffix += 1;
  }
  return candidate;
}
