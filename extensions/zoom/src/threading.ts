import type { ZoomMonitorLogger } from "./monitor-types.js";
import type {
  ZoomConfig,
  ZoomThreadReplyMode,
  ZoomThreadSessionScope,
  ZoomThreadingConfig,
} from "./types.js";

export type ResolvedZoomThreadingConfig = {
  enabled: boolean;
  replyToMode: ZoomThreadReplyMode;
  sessionScope: ZoomThreadSessionScope;
  inheritParent: boolean;
};

export type ZoomInboundThreadContext = {
  incomingMessageId?: string;
  parentMessageId?: string;
  isThreadReply: boolean;
  threadId?: string;
};

const DEFAULT_THREADING: ResolvedZoomThreadingConfig = {
  enabled: false,
  replyToMode: "incoming",
  sessionScope: "parent",
  inheritParent: true,
};

const warnedDisabledConfigs = new Set<string>();

function normalizeString(value: string | undefined | null): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function normalizeReplyToMode(value: string | undefined): ZoomThreadReplyMode {
  if (value === "off" || value === "incoming" || value === "all") {
    return value;
  }
  return DEFAULT_THREADING.replyToMode;
}

function normalizeSessionScope(value: string | undefined): ZoomThreadSessionScope {
  if (value === "parent" || value === "thread") {
    return value;
  }
  return DEFAULT_THREADING.sessionScope;
}

function hasDisabledSubkeys(threading: ZoomThreadingConfig | undefined): boolean {
  if (!threading) return false;
  return (
    typeof threading.replyToMode !== "undefined" ||
    typeof threading.sessionScope !== "undefined" ||
    typeof threading.inheritParent !== "undefined"
  );
}

export function resolveZoomThreadingConfig(
  cfg: ZoomConfig | undefined,
  log?: ZoomMonitorLogger,
): ResolvedZoomThreadingConfig {
  const threading = cfg?.threading;
  const enabled = threading?.enabled === true;
  const resolved: ResolvedZoomThreadingConfig = {
    enabled,
    replyToMode: normalizeReplyToMode(threading?.replyToMode),
    sessionScope: normalizeSessionScope(threading?.sessionScope),
    inheritParent:
      typeof threading?.inheritParent === "boolean"
        ? threading.inheritParent
        : DEFAULT_THREADING.inheritParent,
  };

  if (!enabled && hasDisabledSubkeys(threading)) {
    const warningKey = JSON.stringify({
      replyToMode: threading?.replyToMode,
      sessionScope: threading?.sessionScope,
      inheritParent: threading?.inheritParent,
    });
    if (!warnedDisabledConfigs.has(warningKey)) {
      warnedDisabledConfigs.add(warningKey);
      log?.debug("zoom threading subkeys are ignored while threading.enabled=false", {
        threading,
      });
    }
  }

  return resolved;
}

export function parseZoomInboundThreadContext(params: {
  messageId?: string | null;
  replyMainMessageId?: string | null;
}): ZoomInboundThreadContext {
  const incomingMessageId = normalizeString(params.messageId);
  const parentMessageId = normalizeString(params.replyMainMessageId);
  const isThreadReply = Boolean(parentMessageId);

  return {
    incomingMessageId,
    parentMessageId,
    isThreadReply,
    threadId: isThreadReply ? parentMessageId : undefined,
  };
}

export function resolveZoomReplyMainMessageId(params: {
  threading: ResolvedZoomThreadingConfig;
  threadContext?: ZoomInboundThreadContext;
  explicitReplyMainMessageId?: string | null;
}): string | undefined {
  const explicit = normalizeString(params.explicitReplyMainMessageId);
  if (explicit) {
    return explicit;
  }

  if (!params.threading.enabled) {
    return undefined;
  }
  if (params.threading.replyToMode === "off") {
    return undefined;
  }

  const context = params.threadContext;
  if (!context) {
    return undefined;
  }

  if (params.threading.replyToMode === "incoming") {
    if (!context.isThreadReply) {
      return undefined;
    }
    return context.parentMessageId;
  }

  if (context.isThreadReply) {
    return context.parentMessageId;
  }
  return context.incomingMessageId;
}

export function resolveZoomOutboundReplyMessageId(params: {
  threadContext?: ZoomInboundThreadContext;
  resolvedReplyMainMessageId?: string;
  payloadReplyToId?: string;
  payloadReplyToCurrent?: boolean;
}): string | undefined {
  const normalizedPayloadReplyToId = normalizeString(params.payloadReplyToId);
  const normalizedResolved = normalizeString(params.resolvedReplyMainMessageId);
  const context = params.threadContext;

  // In an existing thread, keep replies anchored to the thread parent so
  // follow-up turns stay in the same visible thread chain in Zoom clients.
  if (context?.isThreadReply && normalizedResolved) {
    return normalizedResolved;
  }

  if (normalizedPayloadReplyToId) {
    return normalizedPayloadReplyToId;
  }

  if (params.payloadReplyToCurrent === true) {
    return context?.incomingMessageId ?? normalizedResolved;
  }

  return normalizedResolved;
}
