import fs from "node:fs/promises";
import path from "node:path";
import { resolveInside, toPosix } from "./paths.ts";

export interface MemoryBackup {
  backup: string;
  path: string;
  createdAt: string;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/** Copies an existing memory file before an overwrite. Returns null for a new file. */
export async function backupExisting(root: string, relPath: string): Promise<string | null> {
  const source = resolveInside(root, relPath);
  try {
    await fs.access(source);
  } catch {
    return null;
  }
  const backup = path.join("backups", "memory", timestamp(), relPath);
  const destination = resolveInside(root, backup);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
  return toPosix(backup);
}

/** Lists newest first. A relative memory path filters one entry's history. */
export async function listMemoryBackups(
  root: string,
  relPath?: string,
): Promise<MemoryBackup[]> {
  const base = path.join(root, "backups", "memory");
  const entries: MemoryBackup[] = [];
  for (const stamp of await safeReaddir(base)) {
    if (!stamp.isDirectory()) continue;
    const directory = path.join(base, stamp.name);
    for (const file of await walk(directory)) {
      const backup = toPosix(path.relative(root, file));
      const target = path.relative(directory, file);
      const targetPath = toPosix(target);
      if (relPath && targetPath !== toPosix(relPath)) continue;
      entries.push({
        backup,
        path: targetPath,
        createdAt: stamp.name,
      });
    }
  }
  return entries.sort((a, b) => b.backup.localeCompare(a.backup));
}

export function targetFromBackup(backupRel: string): string | undefined {
  const parts = toPosix(backupRel).split("/");
  if (parts.length < 4 || parts[0] !== "backups" || parts[1] !== "memory") return undefined;
  return parts.slice(3).join("/");
}

/** Restores a backup atomically enough for the markdown source of truth. */
export async function restoreMemoryBackup(
  root: string,
  backupRel: string,
  targetRel?: string,
): Promise<string> {
  const target = targetRel?.trim() || targetFromBackup(backupRel);
  if (!target) throw new Error("cannot derive target path from backup");
  const source = resolveInside(root, backupRel);
  const destination = resolveInside(root, target);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temp = `${destination}.restore-${process.pid}-${Date.now()}`;
  await fs.copyFile(source, temp);
  await fs.rename(temp, destination);
  return toPosix(target);
}

async function safeReaddir(directory: string): Promise<import("node:fs").Dirent[]> {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function walk(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await safeReaddir(directory)) {
    const abs = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await walk(abs)));
    else if (entry.isFile() && entry.name.endsWith(".md")) result.push(abs);
  }
  return result;
}
