import { describe, expect, it } from "vitest";
import { parseExtractionJson } from "../src/adapters/gemini.ts";

describe("Gemini response parsing", () => {
  it("accepts plain and fenced JSON arrays", () => {
    const plain = parseExtractionJson('[{"name":"A","description":"B"}]');
    expect(plain).toHaveLength(1);
    const fenced = parseExtractionJson('```json\n[{"name":"A"}]\n```');
    expect(fenced[0]?.name).toBe("A");
  });

  it("returns an empty array instead of throwing on garbage", () => {
    expect(parseExtractionJson("not json")).toEqual([]);
    expect(parseExtractionJson('{"name":"A"}')).toEqual([]);
    expect(parseExtractionJson("")).toEqual([]);
  });
});
