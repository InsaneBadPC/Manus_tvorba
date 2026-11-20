import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function makeRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "agent-memory-"));
}

export async function removeRoot(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}
