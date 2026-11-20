export class FrontmatterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrontmatterError";
  }
}

export interface ParsedFrontmatter {
  data: Record<string, unknown>;
  body: string;
}

const KEY_RE = /^([A-Za-z_][A-Za-z0-9_-]*):(?:\s+(.*))?$/;

/**
 * Parses a deliberately small YAML subset: flat keys, scalars, arrays.
 * Nested mappings, block scalars and anchors are rejected instead of guessed.
 */
export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    throw new FrontmatterError("frontmatter must start with '---' on the first line");
  }

  const lines = normalized.split("\n");
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) {
    throw new FrontmatterError("frontmatter is missing the closing '---' line");
  }

  const data: Record<string, unknown> = {};
  for (let i = 1; i < end; i += 1) {
    const line = lines[i] ?? "";
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (/^\s/.test(line)) {
      throw new FrontmatterError(`nested YAML is not supported on line ${i + 1}`);
    }
    const match = KEY_RE.exec(line);
    if (!match) {
      throw new FrontmatterError(`invalid frontmatter line ${i + 1}: ${line}`);
    }
    const key = match[1] as string;
    if (Object.hasOwn(data, key)) {
      throw new FrontmatterError(`duplicate frontmatter key '${key}'`);
    }
    data[key] = parseValue(match[2] ?? "", key);
  }

  const body = lines
    .slice(end + 1)
    .join("\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
  return { data, body };
}

function parseValue(raw: string, key: string): unknown {
  const value = raw.trim();
  if (value === "") return "";
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      throw new FrontmatterError(`invalid quoted value for '${key}'`);
    }
  }
  if (value.startsWith("[")) {
    try {
      return JSON.parse(value);
    } catch {
      // Allow a hand-written list such as [pytest, gradle].
      if (!value.endsWith("]")) {
        throw new FrontmatterError(`invalid array for '${key}'`);
      }
      const inner = value.slice(1, -1).trim();
      if (inner === "") return [];
      return inner.split(",").map((part) => unquote(part.trim()));
    }
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return unquote(value);
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function serializeFrontmatter(
  data: Record<string, unknown>,
  body: string,
): string {
  const lines: string[] = ["---"];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    lines.push(`${key}: ${serializeValue(value, key)}`);
  }
  lines.push("---", "");
  return `${lines.join("\n")}${body.replace(/\s+$/, "")}\n`;
}

function serializeValue(value: unknown, key: string): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (!value.every((entry) => typeof entry === "string")) {
      throw new FrontmatterError(`array '${key}' may contain only strings`);
    }
    return JSON.stringify(value);
  }
  if (value === null) return "null";
  throw new FrontmatterError(`unsupported frontmatter value for '${key}'`);
}

export function stringField(
  data: Record<string, unknown>,
  key: string,
  fallback = "",
): string {
  const value = data[key];
  return typeof value === "string" ? value : fallback;
}

export function stringArrayField(data: Record<string, unknown>, key: string): string[] {
  const value = data[key];
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  if (typeof value === "string" && value.trim() !== "") return [value.trim()];
  return [];
}
