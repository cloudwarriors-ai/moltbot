import { describe, expect, it } from "vitest";

import {
  getRecentlySentZoomMessageText,
  isRecentlySentZoomMessageId,
  rememberZoomSentMessageId,
  rememberZoomSentMessageText,
  resetZoomSentMessageIdsForTest,
} from "./sent-message-ids.js";

describe("sent message id tracking", () => {
  it("matches recent ids and normalizes braces/case", () => {
    resetZoomSentMessageIdsForTest();
    rememberZoomSentMessageId("{AbC-123}");

    expect(isRecentlySentZoomMessageId("abc-123")).toBe(true);
    expect(isRecentlySentZoomMessageId("{ABC-123}")).toBe(true);
    expect(isRecentlySentZoomMessageId("def-456")).toBe(false);
  });

  it("expires ids after ttl", async () => {
    resetZoomSentMessageIdsForTest();
    rememberZoomSentMessageId("ttl-test", 1000);

    expect(isRecentlySentZoomMessageId("ttl-test")).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(isRecentlySentZoomMessageId("ttl-test")).toBe(false);
  });

  it("stores and reads recently sent message text", async () => {
    resetZoomSentMessageIdsForTest();
    rememberZoomSentMessageText("{Msg-123}", "Can you confirm the deal is registered?", 1000);

    expect(getRecentlySentZoomMessageText("msg-123")).toBe(
      "Can you confirm the deal is registered?",
    );
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(getRecentlySentZoomMessageText("msg-123")).toBeUndefined();
  });
});
