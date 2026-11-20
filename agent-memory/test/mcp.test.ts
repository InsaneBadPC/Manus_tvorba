import { afterEach, describe, expect, it } from "vitest";
import { openContext } from "../src/context.ts";
import { handleRequest, type JsonRpcResponse } from "../src/mcp.ts";
import { makeRoot, removeRoot } from "./helpers.ts";

const roots: string[] = [];
const contexts: Array<Awaited<ReturnType<typeof openContext>>> = [];

afterEach(async () => {
  for (const ctx of contexts.splice(0)) ctx.db.close();
  await Promise.all(roots.splice(0).map(removeRoot));
});

async function setup() {
  const root = await makeRoot();
  roots.push(root);
  const ctx = await openContext({ root, projectId: "alpha" });
  contexts.push(ctx);
  return ctx;
}

function result(response: JsonRpcResponse | null): Record<string, unknown> {
  expect(response).not.toBeNull();
  return (response as JsonRpcResponse).result as Record<string, unknown>;
}

function toolText(response: JsonRpcResponse | null): unknown {
  const payload = result(response) as {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  return JSON.parse(payload.content[0]?.text ?? "null") as unknown;
}

describe("MCP server", () => {
  it("answers initialize and tools/list", async () => {
    const ctx = await setup();
    const init = await handleRequest(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      ctx,
    );
    expect(result(init).protocolVersion).toBe("2024-11-05");

    const list = await handleRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" }, ctx);
    const tools = (result(list) as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((tool) => tool.name)).toContain("memory_write");
    expect(tools.map((tool) => tool.name)).toContain("skill_load");
  });

  it("writes, reads and searches memory; rejects secrets", async () => {
    const ctx = await setup();

    const denied = await handleRequest(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "memory_write",
          arguments: {
            name: "API key",
            description: "api_key = sk-abcdefghijklmnopqrstuvwxyz123456",
          },
        },
      },
      ctx,
    );
    expect((result(denied) as { isError?: boolean }).isError).toBe(true);

    const written = await handleRequest(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "memory_write",
          arguments: {
            name: "Pytest convention",
            description: "Projekt používá pytest",
            body: "pytest -q",
            tags: ["testing"],
          },
        },
      },
      ctx,
    );
    const saved = toolText(written) as { saved: boolean; path: string };
    expect(saved.saved).toBe(true);
    expect(saved.path).toBe("memory/projects/alpha/pytest-convention.md");

    const read = await handleRequest(
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "memory_read", arguments: { name: "Pytest convention" } },
      },
      ctx,
    );
    expect((toolText(read) as { body: string }).body).toBe("pytest -q");

    const search = await handleRequest(
      {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "memory_search", arguments: { query: "pytest" } },
      },
      ctx,
    );
    const hits = toolText(search) as Array<{ name: string }>;
    expect(hits[0]?.name).toBe("Pytest convention");
  });

  it("returns a JSON-RPC error for an unknown method", async () => {
    const ctx = await setup();
    const response = await handleRequest(
      { jsonrpc: "2.0", id: 7, method: "unknown/method" },
      ctx,
    );
    expect((response as JsonRpcResponse).error?.code).toBe(-32601);
  });
});
