import { describe, expect, it } from "vitest";
import {
  FrontmatterError,
  parseFrontmatter,
  serializeFrontmatter,
} from "../src/frontmatter.ts";

describe("frontmatter", () => {
  it("round-trips Czech text, arrays and booleans", () => {
    const raw = serializeFrontmatter(
      {
        name: "Příliš žluťoučký kůň",
        description: "Poznámka: používáme pytest",
        tags: ["testování", "česky"],
        pinned: true,
        confidence: 0.9,
        scope: "global",
      },
      "Tělo záznamu.\n",
    );
    const parsed = parseFrontmatter(raw);
    expect(parsed.data.name).toBe("Příliš žluťoučký kůň");
    expect(parsed.data.description).toBe("Poznámka: používáme pytest");
    expect(parsed.data.tags).toEqual(["testování", "česky"]);
    expect(parsed.data.pinned).toBe(true);
    expect(parsed.data.confidence).toBe(0.9);
    expect(parsed.body).toBe("Tělo záznamu.");
  });

  it("accepts an unquoted array from a hand-written SKILL.md", () => {
    const parsed = parseFrontmatter("---\nname: test\ntriggers: [pytest, gradle]\n---\nbody\n");
    expect(parsed.data.triggers).toEqual(["pytest", "gradle"]);
  });

  it("rejects nested YAML and a missing closing marker", () => {
    expect(() => parseFrontmatter("---\nname: x\nnested:\n  key: y\n---\n")).toThrow(
      FrontmatterError,
    );
    expect(() => parseFrontmatter("---\nname: x\n")).toThrow(FrontmatterError);
  });
});
