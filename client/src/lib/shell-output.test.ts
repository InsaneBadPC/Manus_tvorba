import { describe, expect, it } from "vitest";
import { parseAgentAvailability, parseWorkspaceFiles } from "./shell-output";

describe("parseAgentAvailability", () => {
  it("parses real newline and tab separated output", () => {
    const output = "kilo\tok\nantigravity\toffline\nfreebuff\tok\n";
    expect(parseAgentAvailability(output)).toEqual({ kilo: "ready", freebuff: "ready" });
  });

  it("does not treat the escaped literal \\n as a separator", () => {
    expect(parseAgentAvailability("kilo\\tok\\nantigravity\\toffline\\n")).toEqual({});
  });

  it("ignores malformed and empty lines", () => {
    expect(parseAgentAvailability("\nnot-a-status\n\nfoo\tok\n")).toEqual({ foo: "ready" });
  });

  it("handles CRLF output", () => {
    expect(parseAgentAvailability("kilo\tok\r\n")).toEqual({ kilo: "ready" });
  });
});

describe("parseWorkspaceFiles", () => {
  it("parses size and path pairs", () => {
    expect(parseWorkspaceFiles("120\tsrc/a.ts\n42\tsrc/b.ts\n")).toEqual([
      { path: "src/a.ts", size: 120 },
      { path: "src/b.ts", size: 42 },
    ]);
  });

  it("keeps tabs inside the path", () => {
    expect(parseWorkspaceFiles("7\tdir/odd\tname.txt\n")).toEqual([
      { path: "dir/odd\tname.txt", size: 7 },
    ]);
  });

  it("skips lines without a tab or with a non-numeric size", () => {
    expect(parseWorkspaceFiles("junk\nnope\tsrc/x.ts\n5\tsrc/y.ts\n")).toEqual([
      { path: "src/y.ts", size: 5 },
    ]);
  });
});
