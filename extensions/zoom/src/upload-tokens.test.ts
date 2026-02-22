import { describe, expect, it } from "vitest";

import { consumeUploadToken, createUploadToken, peekUploadToken } from "./upload-tokens.js";

describe("upload-tokens", () => {
  it("preserves routing/session context across create -> consume", () => {
    const token = createUploadToken({
      conversationId: "channel-1",
      userJid: "user@example.com",
      isDirect: false,
      channelJid: "channel-1@conference.xmpp.zoom.us",
      sessionKey: "agent:pulsebot:zoom:channel:thread-123",
      agentId: "pulsebot",
      accountId: "default",
      replyMainMessageId: "thread-123",
      label: "PROJ-123",
    });

    const peeked = peekUploadToken(token);
    expect(peeked?.sessionKey).toBe("agent:pulsebot:zoom:channel:thread-123");
    expect(peeked?.agentId).toBe("pulsebot");
    expect(peeked?.accountId).toBe("default");
    expect(peeked?.replyMainMessageId).toBe("thread-123");

    const consumed = consumeUploadToken(token);
    expect(consumed?.sessionKey).toBe("agent:pulsebot:zoom:channel:thread-123");
    expect(consumed?.agentId).toBe("pulsebot");
    expect(consumed?.accountId).toBe("default");
    expect(consumed?.replyMainMessageId).toBe("thread-123");
    expect(consumeUploadToken(token)).toBeUndefined();
  });
});
