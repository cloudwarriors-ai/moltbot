import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditLogger } from "./audit.js";
import { registerGhTools } from "./gh-tools.js";

const { execSyncMock } = vi.hoisted(() => ({ execSyncMock: vi.fn() }));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    execSync: execSyncMock,
  };
});

type TextToolResult = {
  content: Array<{ type: "text"; text: string }>;
};

type RegisteredTool = {
  name: string;
  execute: (id: string, params: Record<string, unknown>) => Promise<TextToolResult>;
};

function createMockApi() {
  const tools: RegisteredTool[] = [];
  const api = {
    registerTool(factory: () => RegisteredTool) {
      tools.push(factory());
    },
  };
  return { api, tools };
}

function parseToolJson(result: TextToolResult) {
  const raw = result.content[0]?.text ?? "{}";
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("pulsebot gh tools", () => {
  const logger: AuditLogger = vi.fn();

  beforeEach(() => {
    execSyncMock.mockReset();
  });

  it("returns issue data when gh is available", async () => {
    const { api, tools } = createMockApi();
    registerGhTools(api as never, logger, { ppRepos: ["cloudwarriors-ai/project-pulse"] });

    execSyncMock.mockReturnValue(
      JSON.stringify([{ number: 42, title: "OAuth login fails", state: "open" }]),
    );

    const tool = tools.find((entry) => entry.name === "gh_list_issues");
    expect(tool).toBeDefined();

    const result = await tool!.execute("call1", { state: "open", limit: 1 });
    const payload = parseToolJson(result);

    expect(payload.ok).toBe(true);
    expect(Array.isArray(payload.data)).toBe(true);
    expect((payload.data as Array<Record<string, unknown>>)[0]?.number).toBe(42);
    expect(execSyncMock).toHaveBeenCalledOnce();
    expect(String(execSyncMock.mock.calls[0]?.[0])).toContain("gh issue list");
  });

  it("surfaces gh-not-found errors without throwing", async () => {
    const { api, tools } = createMockApi();
    registerGhTools(api as never, logger, { ppRepos: ["cloudwarriors-ai/project-pulse"] });

    execSyncMock.mockImplementation(() => {
      throw new Error("/bin/sh: 1: gh: not found");
    });

    const tool = tools.find((entry) => entry.name === "gh_search_issues");
    expect(tool).toBeDefined();

    const result = await tool!.execute("call2", { query: "oauth timeout" });
    const payload = parseToolJson(result);

    expect(payload.ok).toBe(false);
    expect(String(payload.error)).toContain("gh: not found");
    expect(execSyncMock).toHaveBeenCalledOnce();
  });

  it("blocks repositories outside the allowlist", async () => {
    const { api, tools } = createMockApi();
    registerGhTools(api as never, logger, { ppRepos: ["cloudwarriors-ai/project-pulse"] });

    const tool = tools.find((entry) => entry.name === "gh_list_issues");
    expect(tool).toBeDefined();

    const result = await tool!.execute("call3", { repo: "other-org/other-repo" });
    const payload = parseToolJson(result);

    expect(payload.ok).toBe(false);
    expect(String(payload.error)).toContain("not in allowed list");
    expect(execSyncMock).not.toHaveBeenCalled();
  });
});
