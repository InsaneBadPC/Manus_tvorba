import { agentRoot } from "./paths.ts";
import { MemoryStore } from "./store.ts";
import { openDatabase, syncIndex, type MemoryDatabase } from "./db.ts";
import { syncSkills } from "./skills.ts";

export interface MemoryContext {
  root: string;
  db: MemoryDatabase;
  store: MemoryStore;
  projectId?: string;
  agentId?: string;
}

export interface OpenContextOptions {
  root?: string;
  projectId?: string;
  agentId?: string;
  sync?: boolean;
}

export async function openContext(options: OpenContextOptions = {}): Promise<MemoryContext> {
  const root = options.root ?? agentRoot();
  const db = openDatabase(root);
  const store = new MemoryStore({
    root,
    projectId: options.projectId,
    agentId: options.agentId,
  });

  if (options.sync !== false) {
    await syncIndex(db, store);
    await syncSkills(db, root);
  }

  return { root, db, store, projectId: options.projectId, agentId: options.agentId };
}
