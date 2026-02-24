import { describe, expect, it, vi } from "vitest";
import { CatfishError } from "./errors.js";
import { createCatfishSendTool } from "./tool.js";

describe("createCatfishSendTool", () => {
  it("returns success JSON when send succeeds", async () => {
    const send = vi.fn(async () => ({
      ok: true,
      status: 200,
      senderUserId: "User-123",
      targetType: "dm" as const,
      targetId: "friend-id",
      messageId: "msg-123",
    }));

    const tool = createCatfishSendTool({
      send,
      setStateDir: () => undefined,
      getAuditLogPath: () => "/tmp/catfish-audit.jsonl",
    });

    const result = await tool.execute("tool-1", {
      jid: "user-123@xmpp.zoom.us",
      target: "friend-id",
      message: "hello",
      target_type: "dm",
    });

    const payload = JSON.parse(String(result.content[0]?.text)) as {
      ok?: boolean;
      targetType?: string;
    };
    expect(payload.ok).toBe(true);
    expect(payload.targetType).toBe("dm");
  });

  it("returns structured error JSON when send fails", async () => {
    const send = vi.fn(async () => {
      throw new CatfishError({
        code: "CATFISH_PERMISSION_DENIED",
        message: "permission denied",
        statusCode: 403,
      });
    });

    const tool = createCatfishSendTool({
      send,
      setStateDir: () => undefined,
      getAuditLogPath: () => "/tmp/catfish-audit.jsonl",
    });

    const result = await tool.execute("tool-1", {
      jid: "user-123@xmpp.zoom.us",
      target: "friend-id",
      message: "hello",
    });

    const payload = JSON.parse(String(result.content[0]?.text)) as {
      ok?: boolean;
      code?: string;
      status?: number;
    };
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe("CATFISH_PERMISSION_DENIED");
    expect(payload.status).toBe(403);
  });
});
