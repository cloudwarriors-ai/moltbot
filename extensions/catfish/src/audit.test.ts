import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendCatfishAuditRecord } from "./audit.js";

describe("appendCatfishAuditRecord", () => {
  it("writes JSONL entries with full message content", async () => {
    const dir = await mkdtemp(join(tmpdir(), "catfish-audit-"));
    const filePath = join(dir, "catfish-audit.jsonl");

    await appendCatfishAuditRecord({
      filePath,
      record: {
        timestamp: new Date("2026-02-24T00:00:00.000Z").toISOString(),
        senderJid: "user-123@xmpp.zoom.us",
        senderResolvedUserId: "User-123",
        senderResolvedEmail: "trent.charlton@cloudwarriors.ai",
        senderLookupSource: "direct",
        targetRaw: "channel-1@conference.xmpp.zoom.us",
        targetType: "channel",
        targetResolved: "channel-1",
        payloadField: "to_channel",
        message: "full message body",
        ok: true,
        status: 200,
      },
    });

    const content = await readFile(filePath, "utf8");
    const parsed = JSON.parse(content.trim()) as { message?: string; ok?: boolean };

    expect(parsed.message).toBe("full message body");
    expect(parsed.ok).toBe(true);
  });
});
