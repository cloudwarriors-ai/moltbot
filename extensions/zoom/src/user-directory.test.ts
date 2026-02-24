import { describe, expect, it } from "vitest";

import type { ZoomConversationStoreEntry } from "./conversation-store.js";
import {
  lookupZoomUsersFromEntries,
  parseZoomUserMentionMarkup,
  pickZoomSenderIdentifierFromHits,
  resolveZoomSendFromUser,
} from "./user-directory.js";

describe("lookupZoomUsersFromEntries", () => {
  const entries: ZoomConversationStoreEntry[] = [
    {
      conversationId: "mb4vcq4yquaqkjjoy4vntq@xmpp.zoom.us",
      reference: {
        userJid: "mb4vcq4yquaqkjjoy4vntq@xmpp.zoom.us",
        userName: "Chad Simon",
        conversationType: "direct",
      },
    },
    {
      conversationId: "vbcwailxsqwtwxcaato6-g@xmpp.zoom.us",
      reference: {
        userJid: "vbcwailxsqwtwxcaato6-g@xmpp.zoom.us",
        userName: "Tyler Pratt",
        conversationType: "direct",
      },
    },
  ];

  it("matches full display name", () => {
    const hits = lookupZoomUsersFromEntries("Chad Simon", entries);
    expect(hits[0]?.userJid).toBe("mb4vcq4yquaqkjjoy4vntq@xmpp.zoom.us");
  });

  it("matches email-local-part to display name", () => {
    const hits = lookupZoomUsersFromEntries("chad.simon@cloudwarriors.ai", entries);
    expect(hits[0]?.userJid).toBe("mb4vcq4yquaqkjjoy4vntq@xmpp.zoom.us");
  });

  it("returns empty when no match exists", () => {
    const hits = lookupZoomUsersFromEntries("not.a.person@cloudwarriors.ai", entries);
    expect(hits).toHaveLength(0);
  });
});

describe("parseZoomUserMentionMarkup", () => {
  it("parses user mentions and @all into at_items", async () => {
    const parsed = await parseZoomUserMentionMarkup(
      "Heads up <@chad.simon@cloudwarriors.ai> and @all please review",
      async (raw) => {
        if (raw === "chad.simon@cloudwarriors.ai") {
          return { atContact: "chad.simon@cloudwarriors.ai", display: "Chad" };
        }
        return null;
      },
    );

    expect(parsed.text).toBe("Heads up @Chad and @all please review");
    expect(parsed.atItems).toHaveLength(2);
    expect(parsed.atItems[0]).toEqual({
      at_type: 1,
      at_contact: "chad.simon@cloudwarriors.ai",
      start_position: 9,
      end_position: 14,
    });
    expect(parsed.atItems[1]).toEqual({
      at_type: 2,
      start_position: 19,
      end_position: 23,
    });
  });
});

describe("resolveZoomSendFromUser", () => {
  it("uses explicit from user when provided", () => {
    const from = resolveZoomSendFromUser({
      explicitFromUser: "operator@cloudwarriors.ai",
      hasMentions: true,
      env: { MENTION_PROXY: "proxy@cloudwarriors.ai", ZOOM_REPORT_USER: "report@cloudwarriors.ai" } as NodeJS.ProcessEnv,
    });
    expect(from).toBe("operator@cloudwarriors.ai");
  });

  it("uses MENTION_PROXY when mention exists and from is omitted", () => {
    const from = resolveZoomSendFromUser({
      hasMentions: true,
      env: { MENTION_PROXY: "proxy@cloudwarriors.ai", ZOOM_REPORT_USER: "report@cloudwarriors.ai" } as NodeJS.ProcessEnv,
    });
    expect(from).toBe("proxy@cloudwarriors.ai");
  });

  it("falls back to ZOOM_REPORT_USER when no mentions", () => {
    const from = resolveZoomSendFromUser({
      hasMentions: false,
      env: { MENTION_PROXY: "proxy@cloudwarriors.ai", ZOOM_REPORT_USER: "report@cloudwarriors.ai" } as NodeJS.ProcessEnv,
    });
    expect(from).toBe("report@cloudwarriors.ai");
  });
});

describe("pickZoomSenderIdentifierFromHits", () => {
  it("prefers email over zoom user id", () => {
    const picked = pickZoomSenderIdentifierFromHits(
      [
        {
          source: "zoom_users_api",
          score: 120,
          query: "Doug Ruby",
          email: "doug.ruby@cloudwarriors.ai",
          zoomUserId: "j8uogi_1QiKnVQ_n0-zopg",
        },
      ],
      "Doug Ruby",
    );
    expect(picked).toBe("doug.ruby@cloudwarriors.ai");
  });

  it("falls back to provided value when no hit", () => {
    const picked = pickZoomSenderIdentifierFromHits([], "Doug Ruby");
    expect(picked).toBe("Doug Ruby");
  });

  it("prefers richer top-score hit even if first lacks email", () => {
    const picked = pickZoomSenderIdentifierFromHits(
      [
        {
          source: "conversation_store",
          score: 100,
          query: "Doug Ruby",
          userJid: "j8uogi_1qiknvq_n0-zopg@xmpp.zoom.us",
          displayName: "Doug Ruby",
        },
        {
          source: "zoom_users_api",
          score: 100,
          query: "Doug Ruby",
          email: "doug.ruby@cloudwarriors.ai",
          zoomUserId: "j8uogi_1QIKNVQ_N0-zOPg",
          userJid: "j8uogi_1qiknvq_n0-zopg@xmpp.zoom.us",
          displayName: "Doug Ruby",
        },
      ],
      "Doug Ruby",
    );
    expect(picked).toBe("doug.ruby@cloudwarriors.ai");
  });
});
