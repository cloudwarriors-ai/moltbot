import { afterEach, describe, expect, it } from "vitest";

import {
  clearZoomSessionReplyRootsForTest,
  getRememberedZoomSessionReplyRoot,
  rememberZoomSessionReplyRoot,
} from "./thread-state.js";

describe("thread-state", () => {
  afterEach(() => {
    clearZoomSessionReplyRootsForTest();
  });

  it("stores parent thread id when available", () => {
    rememberZoomSessionReplyRoot({
      sessionKey: "agent:pulsebot:zoom:channel:abc",
      threadContext: {
        incomingMessageId: "MSG-2",
        parentMessageId: "ROOT-1",
        isThreadReply: true,
        threadId: "ROOT-1",
      },
    });

    expect(getRememberedZoomSessionReplyRoot("agent:pulsebot:zoom:channel:abc")).toBe("ROOT-1");
  });

  it("falls back to incoming message id for top-level channel messages", () => {
    rememberZoomSessionReplyRoot({
      sessionKey: "agent:pulsebot:zoom:channel:b6a0428@conference.xmpp.zoom.us",
      threadContext: {
        incomingMessageId: "FRESH-MSG-123",
        isThreadReply: false,
      },
    });

    expect(
      getRememberedZoomSessionReplyRoot(
        "agent:pulsebot:zoom:channel:b6a0428@conference.xmpp.zoom.us",
      ),
    ).toBe("FRESH-MSG-123");
  });

  it("prefers explicit reply main message id", () => {
    rememberZoomSessionReplyRoot({
      sessionKey: "agent:pulsebot:zoom:channel:session-1",
      threadContext: {
        incomingMessageId: "MSG-2",
        parentMessageId: "ROOT-1",
        isThreadReply: true,
      },
      explicitReplyMainMessageId: "EXPLICIT-ROOT",
    });

    expect(getRememberedZoomSessionReplyRoot("agent:pulsebot:zoom:channel:session-1")).toBe(
      "EXPLICIT-ROOT",
    );
  });

  it("normalizes session key casing", () => {
    rememberZoomSessionReplyRoot({
      sessionKey: "Agent:PulseBot:Zoom:Channel:Session-2",
      explicitReplyMainMessageId: "ROOT-CASE",
    });

    expect(getRememberedZoomSessionReplyRoot("agent:pulsebot:zoom:channel:session-2")).toBe(
      "ROOT-CASE",
    );
  });
});
