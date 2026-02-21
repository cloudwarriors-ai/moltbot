import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import { resolveZoomAgentRoute } from "./agent-route.js";
import type { ZoomMonitorLogger } from "./monitor-types.js";

type ResolveRouteInput = Parameters<PluginRuntime["channel"]["routing"]["resolveAgentRoute"]>[0];
type ResolveRouteOutput = ReturnType<PluginRuntime["channel"]["routing"]["resolveAgentRoute"]>;

function makeRoute(agentId: string, matchedBy: ResolveRouteOutput["matchedBy"]): ResolveRouteOutput {
  return {
    agentId,
    channel: "zoom",
    accountId: "default",
    sessionKey: `agent:${agentId}:main`,
    mainSessionKey: `agent:${agentId}:main`,
    matchedBy,
  };
}

function createResolver() {
  return vi.fn((input: ResolveRouteInput): ResolveRouteOutput => {
    const peerId = input.peer?.id;
    const hasModernPeerBinding = (Array.isArray(input.cfg.bindings) ? input.cfg.bindings : []).some(
      (binding) => {
        if (!binding || typeof binding !== "object") return false;
        const bindingRecord = binding as Record<string, unknown>;
        if (bindingRecord.agentId !== "pulsebot") return false;
        const match = bindingRecord.match;
        if (!match || typeof match !== "object") return false;
        const matchRecord = match as Record<string, unknown>;
        if (matchRecord.channel !== "zoom") return false;
        const peer = matchRecord.peer;
        if (!peer || typeof peer !== "object") return false;
        const peerRecord = peer as Record<string, unknown>;
        return peerRecord.kind === "channel" && peerRecord.id === peerId;
      },
    );

    return hasModernPeerBinding ? makeRoute("pulsebot", "binding.peer") : makeRoute("main", "default");
  });
}

function createRuntime(resolveAgentRoute: PluginRuntime["channel"]["routing"]["resolveAgentRoute"]) {
  return {
    channel: {
      routing: {
        resolveAgentRoute,
      },
    },
  } as unknown as PluginRuntime;
}

function createLogger(): ZoomMonitorLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("resolveZoomAgentRoute", () => {
  it("uses canonical direct peer for DMs", () => {
    const resolveAgentRoute = createResolver();
    const runtime = createRuntime(resolveAgentRoute);

    resolveZoomAgentRoute({
      runtime,
      cfg: {},
      senderId: "doug.ruby@cloudwarriors.ai",
      conversationId: "dm-conversation",
      isDirect: true,
    });

    expect(resolveAgentRoute).toHaveBeenCalledTimes(1);
    expect(resolveAgentRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "zoom",
        peer: { kind: "direct", id: "doug.ruby@cloudwarriors.ai" },
      }),
    );
  });

  it("routes channel messages via peer binding when config is modern", () => {
    const resolveAgentRoute = createResolver();
    const runtime = createRuntime(resolveAgentRoute);
    const cfg: OpenClawConfig = {
      bindings: [
        {
          agentId: "pulsebot",
          match: {
            channel: "zoom",
            peer: { kind: "channel", id: "room@conference.xmpp.zoom.us" },
          },
        },
      ],
    };

    const route = resolveZoomAgentRoute({
      runtime,
      cfg,
      senderId: "doug.ruby@cloudwarriors.ai",
      conversationId: "room@conference.xmpp.zoom.us",
      channelJid: "room@conference.xmpp.zoom.us",
      isDirect: false,
    });

    expect(route.agentId).toBe("pulsebot");
    expect(route.matchedBy).toBe("binding.peer");
    expect(resolveAgentRoute).toHaveBeenCalledTimes(1);
  });

  it("supports legacy room-JID channel bindings via compatibility fallback", () => {
    const resolveAgentRoute = createResolver();
    const runtime = createRuntime(resolveAgentRoute);
    const log = createLogger();
    const cfg: OpenClawConfig = {
      bindings: [
        {
          agentId: "pulsebot",
          match: {
            channel: "room@conference.xmpp.zoom.us",
          },
        },
      ],
    };

    const route = resolveZoomAgentRoute({
      runtime,
      cfg,
      senderId: "doug.ruby@cloudwarriors.ai",
      conversationId: "room@conference.xmpp.zoom.us",
      channelJid: "room@conference.xmpp.zoom.us",
      isDirect: false,
      log,
    });

    expect(route.agentId).toBe("pulsebot");
    expect(route.matchedBy).toBe("binding.peer");
    expect(resolveAgentRoute).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it("supports legacy room-JID bindings when thread scope is enabled", () => {
    const resolveAgentRoute = createResolver();
    const runtime = createRuntime(resolveAgentRoute);
    const cfg: OpenClawConfig = {
      bindings: [
        {
          agentId: "pulsebot",
          match: {
            channel: "room@conference.xmpp.zoom.us",
          },
        },
      ],
    };

    const route = resolveZoomAgentRoute({
      runtime,
      cfg,
      senderId: "doug.ruby@cloudwarriors.ai",
      conversationId: "room@conference.xmpp.zoom.us",
      channelJid: "room@conference.xmpp.zoom.us",
      isDirect: false,
      threading: {
        enabled: true,
        replyToMode: "all",
        sessionScope: "thread",
        inheritParent: true,
      },
      threadContext: {
        incomingMessageId: "child-msg",
        parentMessageId: "parent-msg",
        isThreadReply: true,
        threadId: "parent-msg",
      },
    });

    expect(route.agentId).toBe("pulsebot");
    expect(route.matchedBy).toBe("binding.peer");
    expect(resolveAgentRoute).toHaveBeenCalledTimes(2);
  });

  it("uses thread peer and parent peer when thread scope is enabled", () => {
    const resolveAgentRoute = vi.fn(() => makeRoute("pulsebot", "binding.peer"));
    const runtime = createRuntime(resolveAgentRoute);

    resolveZoomAgentRoute({
      runtime,
      cfg: {},
      senderId: "doug.ruby@cloudwarriors.ai",
      conversationId: "room@conference.xmpp.zoom.us",
      channelJid: "room@conference.xmpp.zoom.us",
      isDirect: false,
      threading: {
        enabled: true,
        replyToMode: "incoming",
        sessionScope: "thread",
        inheritParent: true,
      },
      threadContext: {
        incomingMessageId: "child-msg",
        parentMessageId: "parent-msg",
        isThreadReply: true,
        threadId: "parent-msg",
      },
    });

    expect(resolveAgentRoute).toHaveBeenCalledTimes(1);
    expect(resolveAgentRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "zoom",
        peer: { kind: "channel", id: "parent-msg" },
        parentPeer: { kind: "channel", id: "room@conference.xmpp.zoom.us" },
      }),
    );
  });

  it("keeps channel peer when session scope is parent", () => {
    const resolveAgentRoute = vi.fn(() => makeRoute("pulsebot", "binding.peer"));
    const runtime = createRuntime(resolveAgentRoute);

    resolveZoomAgentRoute({
      runtime,
      cfg: {},
      senderId: "doug.ruby@cloudwarriors.ai",
      conversationId: "room@conference.xmpp.zoom.us",
      channelJid: "room@conference.xmpp.zoom.us",
      isDirect: false,
      threading: {
        enabled: true,
        replyToMode: "incoming",
        sessionScope: "parent",
        inheritParent: true,
      },
      threadContext: {
        incomingMessageId: "child-msg",
        parentMessageId: "parent-msg",
        isThreadReply: true,
        threadId: "parent-msg",
      },
    });

    expect(resolveAgentRoute).toHaveBeenCalledTimes(1);
    expect(resolveAgentRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "zoom",
        peer: { kind: "channel", id: "room@conference.xmpp.zoom.us" },
        parentPeer: undefined,
      }),
    );
  });
});
