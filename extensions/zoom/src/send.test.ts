import { describe, expect, it } from "vitest";

import type { ZoomConversationStoreEntry } from "./conversation-store.js";
import {
  formatZoomSpeakerHeading,
  resolveDmRecipientFromKnownConversations,
} from "./send.js";

describe("formatZoomSpeakerHeading", () => {
  it("uses default heading when speaker is missing", () => {
    expect(formatZoomSpeakerHeading()).toBe("cwbot says:");
    expect(formatZoomSpeakerHeading("   ")).toBe("cwbot says:");
  });

  it("formats agent-specific heading", () => {
    expect(formatZoomSpeakerHeading("PulseBot")).toBe("PulseBot says:");
  });
});

describe("resolveDmRecipientFromKnownConversations", () => {
  const entries: ZoomConversationStoreEntry[] = [
    {
      conversationId: "vbcwailxsqwtwxcaato6-g@xmpp.zoom.us",
      reference: {
        userJid: "vbcwailxsqwtwxcaato6-g@xmpp.zoom.us",
        userName: "Tyler Pratt",
        conversationType: "direct",
      },
    },
    {
      conversationId: "mb4vcq4yquaqkjjoy4vntq@xmpp.zoom.us",
      reference: {
        userJid: "mb4vcq4yquaqkjjoy4vntq@xmpp.zoom.us",
        userName: "Chad Simon",
        conversationType: "direct",
      },
    },
  ];

  it("returns xmpp jid unchanged", () => {
    expect(
      resolveDmRecipientFromKnownConversations("vbcwailxsqwtwxcaato6-g@xmpp.zoom.us", entries),
    ).toBe("vbcwailxsqwtwxcaato6-g@xmpp.zoom.us");
  });

  it("resolves email-like input from known display name", () => {
    expect(
      resolveDmRecipientFromKnownConversations("tyler.pratt@cloudwarriors.ai", entries),
    ).toBe("vbcwailxsqwtwxcaato6-g@xmpp.zoom.us");
  });

  it("returns null when no known match exists", () => {
    expect(
      resolveDmRecipientFromKnownConversations("nobody@cloudwarriors.ai", entries),
    ).toBeNull();
  });
});
