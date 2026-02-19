import { beforeEach, describe, expect, it, vi } from "vitest";

let searchCalledWith: Record<string, unknown> | undefined;

const stubManager = {
  search: vi.fn(async (_query: string, opts?: Record<string, unknown>) => {
    searchCalledWith = opts;
    return [
      {
        path: "memory/customers/acme/notes.md",
        startLine: 1,
        endLine: 3,
        score: 0.85,
        snippet: "Acme uses 500 users on Teams",
        source: "memory" as const,
      },
    ];
  }),
  readFile: vi.fn(),
  status: () => ({
    backend: "builtin" as const,
    provider: "builtin",
    model: "builtin",
    requestedProvider: "builtin",
    files: 1,
    chunks: 1,
    dirty: false,
    workspaceDir: "/workspace",
    dbPath: "/workspace/.memory/index.sqlite",
    sources: ["memory" as const],
    sourceCounts: [{ source: "memory" as const, files: 1, chunks: 1 }],
  }),
  sync: vi.fn(),
  probeVectorAvailability: vi.fn(async () => true),
  close: vi.fn(),
};

vi.mock("../../memory/index.js", () => ({
  getMemorySearchManager: async () => ({ manager: stubManager }),
}));

import { createMemorySearchTool } from "./memory-tool.js";

const baseCfg = { memory: { citations: "off" }, agents: { list: [{ id: "main", default: true }] } };

beforeEach(() => {
  vi.clearAllMocks();
  searchCalledWith = undefined;
});

describe("memory_search scope policy", () => {
  it("defaults to global scope when no options", async () => {
    const tool = createMemorySearchTool({ config: baseCfg });
    expect(tool).toBeTruthy();
    const result = await tool!.execute("call1", { query: "test" });
    const details = result.details as Record<string, unknown>;
    expect(details.effectiveScope).toBe("global");
    expect(details.scopeDenied).toBe(false);
  });

  it("uses channel scope when isSupport with channelSlug", async () => {
    const tool = createMemorySearchTool({
      config: baseCfg,
      isSupport: true,
      channelSlug: "acme-corp",
      defaultScope: "channel",
    });
    const result = await tool!.execute("call2", { query: "test" });
    const details = result.details as Record<string, unknown>;
    expect(details.effectiveScope).toBe("channel");
    expect(details.scopeDenied).toBe(false);
    expect(searchCalledWith?.scope).toBe("channel");
    expect(searchCalledWith?.channelSlug).toBe("acme-corp");
  });

  it("returns scopeDenied when channel scope has no slug", async () => {
    const tool = createMemorySearchTool({
      config: baseCfg,
      isSupport: true,
      defaultScope: "channel",
      // no channelSlug
    });
    const result = await tool!.execute("call3", { query: "test" });
    const details = result.details as Record<string, unknown>;
    expect(details.scopeDenied).toBe(true);
    expect(details.results).toEqual([]);
    // Manager should NOT have been called
    expect(stubManager.search).not.toHaveBeenCalled();
  });

  it("downgrades all-customers to channel when not allowed", async () => {
    const tool = createMemorySearchTool({
      config: baseCfg,
      isSupport: true,
      channelSlug: "acme-corp",
      defaultScope: "channel",
      allowAllCustomers: false,
    });
    const result = await tool!.execute("call4", { query: "test", scope: "all-customers" });
    const details = result.details as Record<string, unknown>;
    expect(details.effectiveScope).toBe("channel");
    expect(details.requestedScope).toBe("all-customers");
  });

  it("allows all-customers when explicitly allowed", async () => {
    const tool = createMemorySearchTool({
      config: baseCfg,
      isSupport: true,
      channelSlug: "acme-corp",
      defaultScope: "channel",
      allowAllCustomers: true,
    });
    const result = await tool!.execute("call5", { query: "test", scope: "all-customers" });
    const details = result.details as Record<string, unknown>;
    expect(details.effectiveScope).toBe("all-customers");
    expect(searchCalledWith?.scope).toBe("all-customers");
  });

  it("forces global for non-support sessions requesting channel", async () => {
    const tool = createMemorySearchTool({
      config: baseCfg,
      isSupport: false,
      channelSlug: "acme-corp",
    });
    const result = await tool!.execute("call6", { query: "test", scope: "channel" });
    const details = result.details as Record<string, unknown>;
    expect(details.effectiveScope).toBe("global");
  });

  it("forces global for non-support sessions requesting all-customers", async () => {
    const tool = createMemorySearchTool({
      config: baseCfg,
      isSupport: false,
    });
    const result = await tool!.execute("call7", { query: "test", scope: "all-customers" });
    const details = result.details as Record<string, unknown>;
    expect(details.effectiveScope).toBe("global");
  });

  it("ignores invalid scope values", async () => {
    const tool = createMemorySearchTool({
      config: baseCfg,
      isSupport: true,
      channelSlug: "acme-corp",
      defaultScope: "channel",
    });
    const result = await tool!.execute("call8", { query: "test", scope: "bogus" });
    const details = result.details as Record<string, unknown>;
    // Falls back to defaultScope
    expect(details.effectiveScope).toBe("channel");
  });
});
