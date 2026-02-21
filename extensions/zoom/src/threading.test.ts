import { describe, expect, it, vi } from "vitest";

import {
  parseZoomInboundThreadContext,
  resolveZoomOutboundReplyMessageId,
  resolveZoomReplyMainMessageId,
  resolveZoomThreadingConfig,
} from "./threading.js";

describe("resolveZoomThreadingConfig", () => {
  it("returns defaults when config is missing", () => {
    expect(resolveZoomThreadingConfig(undefined)).toEqual({
      enabled: false,
      replyToMode: "incoming",
      sessionScope: "parent",
      inheritParent: true,
    });
  });

  it("resolves explicit threading config", () => {
    expect(
      resolveZoomThreadingConfig({
        threading: {
          enabled: true,
          replyToMode: "all",
          sessionScope: "thread",
          inheritParent: false,
        },
      }),
    ).toEqual({
      enabled: true,
      replyToMode: "all",
      sessionScope: "thread",
      inheritParent: false,
    });
  });

  it("logs once when subkeys are set while disabled", () => {
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    resolveZoomThreadingConfig(
      {
        threading: {
          enabled: false,
          replyToMode: "all",
        },
      },
      log,
    );

    resolveZoomThreadingConfig(
      {
        threading: {
          enabled: false,
          replyToMode: "all",
        },
      },
      log,
    );

    expect(log.debug).toHaveBeenCalledTimes(1);
  });
});

describe("parseZoomInboundThreadContext", () => {
  it("parses top-level channel message", () => {
    expect(
      parseZoomInboundThreadContext({
        messageId: "msg_123",
      }),
    ).toEqual({
      incomingMessageId: "msg_123",
      parentMessageId: undefined,
      isThreadReply: false,
      threadId: undefined,
    });
  });

  it("parses thread reply", () => {
    expect(
      parseZoomInboundThreadContext({
        messageId: "msg_456",
        replyMainMessageId: "parent_123",
      }),
    ).toEqual({
      incomingMessageId: "msg_456",
      parentMessageId: "parent_123",
      isThreadReply: true,
      threadId: "parent_123",
    });
  });
});

describe("resolveZoomReplyMainMessageId", () => {
  const threadContext = {
    incomingMessageId: "msg_child",
    parentMessageId: "msg_parent",
    isThreadReply: true,
    threadId: "msg_parent",
  };

  it("prefers explicit override", () => {
    expect(
      resolveZoomReplyMainMessageId({
        threading: {
          enabled: false,
          replyToMode: "off",
          sessionScope: "parent",
          inheritParent: true,
        },
        threadContext,
        explicitReplyMainMessageId: "manual_target",
      }),
    ).toBe("manual_target");
  });

  it("returns undefined when threading is disabled", () => {
    expect(
      resolveZoomReplyMainMessageId({
        threading: {
          enabled: false,
          replyToMode: "all",
          sessionScope: "thread",
          inheritParent: true,
        },
        threadContext,
      }),
    ).toBeUndefined();
  });

  it("returns undefined when reply mode is off", () => {
    expect(
      resolveZoomReplyMainMessageId({
        threading: {
          enabled: true,
          replyToMode: "off",
          sessionScope: "parent",
          inheritParent: true,
        },
        threadContext,
      }),
    ).toBeUndefined();
  });

  it("anchors only replies in incoming mode", () => {
    expect(
      resolveZoomReplyMainMessageId({
        threading: {
          enabled: true,
          replyToMode: "incoming",
          sessionScope: "parent",
          inheritParent: true,
        },
        threadContext,
      }),
    ).toBe("msg_parent");

    expect(
      resolveZoomReplyMainMessageId({
        threading: {
          enabled: true,
          replyToMode: "incoming",
          sessionScope: "parent",
          inheritParent: true,
        },
        threadContext: {
          incomingMessageId: "msg_top",
          parentMessageId: undefined,
          isThreadReply: false,
          threadId: undefined,
        },
      }),
    ).toBeUndefined();
  });

  it("anchors all messages in all mode", () => {
    expect(
      resolveZoomReplyMainMessageId({
        threading: {
          enabled: true,
          replyToMode: "all",
          sessionScope: "thread",
          inheritParent: true,
        },
        threadContext,
      }),
    ).toBe("msg_parent");

    expect(
      resolveZoomReplyMainMessageId({
        threading: {
          enabled: true,
          replyToMode: "all",
          sessionScope: "thread",
          inheritParent: true,
        },
        threadContext: {
          incomingMessageId: "msg_top",
          parentMessageId: undefined,
          isThreadReply: false,
          threadId: undefined,
        },
      }),
    ).toBe("msg_top");
  });
});

describe("resolveZoomOutboundReplyMessageId", () => {
  it("pins replies in existing threads to the thread parent", () => {
    expect(
      resolveZoomOutboundReplyMessageId({
        threadContext: {
          incomingMessageId: "child_msg",
          parentMessageId: "parent_msg",
          isThreadReply: true,
          threadId: "parent_msg",
        },
        resolvedReplyMainMessageId: "parent_msg",
        payloadReplyToId: "child_msg",
        payloadReplyToCurrent: true,
      }),
    ).toBe("parent_msg");
  });

  it("uses explicit payload reply id for top-level messages", () => {
    expect(
      resolveZoomOutboundReplyMessageId({
        threadContext: {
          incomingMessageId: "top_msg",
          parentMessageId: undefined,
          isThreadReply: false,
          threadId: undefined,
        },
        resolvedReplyMainMessageId: "top_msg",
        payloadReplyToId: "manual_target",
        payloadReplyToCurrent: true,
      }),
    ).toBe("manual_target");
  });
});
