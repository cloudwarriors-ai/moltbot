import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk";

import type { ZoomMonitorLogger } from "./monitor-types.js";
import type {
  ResolvedZoomThreadingConfig,
  ZoomInboundThreadContext,
} from "./threading.js";

const warnedLegacyBindings = new Set<string>();

type ResolveZoomRouteParams = {
  runtime: PluginRuntime;
  cfg: OpenClawConfig;
  senderId: string;
  conversationId: string;
  channelJid?: string;
  isDirect: boolean;
  threading?: ResolvedZoomThreadingConfig;
  threadContext?: ZoomInboundThreadContext;
  log?: ZoomMonitorLogger;
};

type LegacyBindingMatch = {
  agentId: string;
  accountId?: string;
};

function normalizeToken(value: string | undefined | null): string {
  return (value ?? "").trim().toLowerCase();
}

function normalizeId(value: string | undefined | null): string {
  return (value ?? "").trim();
}

function findLegacyZoomChannelBinding(cfg: OpenClawConfig, channelJid: string): LegacyBindingMatch | null {
  const bindings = Array.isArray(cfg.bindings) ? cfg.bindings : [];
  const normalizedJid = normalizeToken(channelJid);
  if (!normalizedJid) {
    return null;
  }

  for (const binding of bindings) {
    if (!binding || typeof binding !== "object") {
      continue;
    }

    const bindingRecord = binding as Record<string, unknown>;
    const agentId = typeof bindingRecord.agentId === "string" ? bindingRecord.agentId.trim() : "";
    if (!agentId) {
      continue;
    }

    const matchValue = bindingRecord.match;
    if (!matchValue || typeof matchValue !== "object") {
      continue;
    }

    const match = matchValue as Record<string, unknown>;
    if (match.peer && typeof match.peer === "object") {
      continue;
    }

    const channel = typeof match.channel === "string" ? normalizeToken(match.channel) : "";
    if (!channel || channel !== normalizedJid) {
      continue;
    }

    const rawAccountId = typeof match.accountId === "string" ? normalizeToken(match.accountId) : "";
    if (rawAccountId && rawAccountId !== "*" && rawAccountId !== "default") {
      continue;
    }

    return {
      agentId,
      accountId: rawAccountId && rawAccountId !== "*" ? rawAccountId : undefined,
    };
  }

  return null;
}

function injectCompatPeerBinding(params: {
  cfg: OpenClawConfig;
  channelJid: string;
  routePeerId: string;
  legacy: LegacyBindingMatch;
}): OpenClawConfig {
  const existingBindings = Array.isArray(params.cfg.bindings) ? params.cfg.bindings : [];

  const baseCompatMatch: {
    channel: string;
    peer: { kind: "channel"; id: string };
    accountId?: string;
  } = {
    channel: "zoom",
    peer: { kind: "channel", id: params.channelJid },
  };
  if (params.legacy.accountId) {
    baseCompatMatch.accountId = params.legacy.accountId;
  }

  const compatBindings: Array<{
    agentId: string;
    match: {
      channel: string;
      peer: { kind: "channel"; id: string };
      accountId?: string;
    };
  }> = [];

  if (params.routePeerId && params.routePeerId !== params.channelJid) {
    compatBindings.push({
      agentId: params.legacy.agentId,
      match: {
        ...baseCompatMatch,
        peer: { kind: "channel", id: params.routePeerId },
      },
    });
  }

  compatBindings.push({
    agentId: params.legacy.agentId,
    match: baseCompatMatch,
  });

  return {
    ...params.cfg,
    bindings: [
      ...compatBindings,
      ...existingBindings,
    ],
  };
}

/**
 * Resolves a Zoom inbound route using canonical peer-based matching.
 * Includes a temporary compatibility path for legacy Zoom configs that used
 * `bindings[].match.channel=<channel-jid>` instead of provider + peer binding.
 */
export function resolveZoomAgentRoute(params: ResolveZoomRouteParams) {
  const channelPeerId = normalizeId(params.channelJid) || normalizeId(params.conversationId) || "unknown";
  const shouldUseThreadScope = Boolean(
    !params.isDirect &&
      params.threading?.enabled &&
      params.threading.sessionScope === "thread" &&
      params.threadContext?.threadId,
  );
  const threadPeerId = normalizeId(params.threadContext?.threadId);
  const channelPeer = {
    kind: "channel" as const,
    id: channelPeerId,
  };
  const routePeer = params.isDirect
    ? {
        kind: "direct" as const,
        id: normalizeId(params.senderId) || normalizeId(params.conversationId) || "unknown",
      }
    : shouldUseThreadScope && threadPeerId
    ? {
        kind: "channel" as const,
        id: threadPeerId,
      }
    : channelPeer;
  const parentPeer =
    !params.isDirect &&
    shouldUseThreadScope &&
    params.threading?.inheritParent !== false &&
    routePeer.id !== channelPeer.id
      ? channelPeer
      : undefined;

  const peer = routePeer;

  const route = params.runtime.channel.routing.resolveAgentRoute({
    cfg: params.cfg,
    channel: "zoom",
    peer,
    parentPeer,
  });

  if (params.isDirect || route.matchedBy !== "default") {
    return route;
  }

  const legacy = findLegacyZoomChannelBinding(params.cfg, channelPeer.id);
  if (!legacy) {
    return route;
  }

  const compatCfg = injectCompatPeerBinding({
    cfg: params.cfg,
    channelJid: channelPeer.id,
    routePeerId: peer.id,
    legacy,
  });
  const compatRoute = params.runtime.channel.routing.resolveAgentRoute({
    cfg: compatCfg,
    channel: "zoom",
    peer,
    parentPeer,
  });

  if (compatRoute.agentId === legacy.agentId && !warnedLegacyBindings.has(channelPeer.id)) {
    warnedLegacyBindings.add(channelPeer.id);
    params.log?.warn("zoom routing used legacy room binding compatibility", {
      channelJid: channelPeer.id,
      agentId: legacy.agentId,
      expectedBinding: {
        channel: "zoom",
        peer: { kind: "channel", id: channelPeer.id },
      },
    });
  }

  return compatRoute;
}
