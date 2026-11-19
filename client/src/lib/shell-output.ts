export type AgentAvailability = Record<string, "ready" | "busy" | "offline">;

export type ParsedWorkspaceFile = { path: string; size: number };

/**
 * Parses the `printf '%s\t%s\n' <cli> <status>` output used by the agent
 * detection command. Splitting on a real newline/tab is essential: the
 * previous implementation split on the literal two-character string "\\n".
 */
export function parseAgentAvailability(stdout: string, target: AgentAvailability = {}): AgentAvailability {
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const cli = line.slice(0, tab).trim();
    const status = line.slice(tab + 1).trim();
    if (cli && status === "ok") target[cli] = "ready";
  }
  return target;
}

/**
 * Parses `find ... -printf '%s\t%p\n'` output. The path is everything after
 * the first tab, so file names containing tabs survive intact.
 */
export function parseWorkspaceFiles(stdout: string): ParsedWorkspaceFile[] {
  const files: ParsedWorkspaceFile[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line) continue;
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const size = Number(line.slice(0, tab));
    const path = line.slice(tab + 1).trim();
    if (!path || !Number.isFinite(size)) continue;
    files.push({ path, size });
  }
  return files;
}
