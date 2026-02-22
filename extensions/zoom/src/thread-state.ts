import type { ZoomInboundThreadContext } from "./threading.js";

type SessionReplyRootEntry = {
  replyMainMessageId: string;
  expiresAt: number;
};

const REPLY_ROOT_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_REPLY_ROOTS = 4000;
const sessionReplyRoots = new Map<string, SessionReplyRootEntry>();

function normalizeSessionKey(sessionKey?: string): string | undefined {
  const normalized = sessionKey?.trim().toLowerCase();
  return normalized || undefined;
}

function normalizeMessageId(value: string | undefined | null): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function pruneReplyRoots(now = Date.now()): void {
  for (const [key, entry] of sessionReplyRoots) {
    if (entry.expiresAt <= now) {
      sessionReplyRoots.delete(key);
    }
  }
  while (sessionReplyRoots.size > MAX_REPLY_ROOTS) {
    const oldestKey = sessionReplyRoots.keys().next().value;
    if (!oldestKey) break;
    sessionReplyRoots.delete(oldestKey);
  }
}

export function rememberZoomSessionReplyRoot(params: {
  sessionKey?: string;
  threadContext?: ZoomInboundThreadContext;
  explicitReplyMainMessageId?: string;
}): void {
  const key = normalizeSessionKey(params.sessionKey);
  if (!key) return;

  const replyMainMessageId =
    normalizeMessageId(params.explicitReplyMainMessageId) ||
    normalizeMessageId(params.threadContext?.parentMessageId) ||
    normalizeMessageId(params.threadContext?.incomingMessageId);
  if (!replyMainMessageId) return;

  const now = Date.now();
  pruneReplyRoots(now);
  sessionReplyRoots.set(key, {
    replyMainMessageId,
    expiresAt: now + REPLY_ROOT_TTL_MS,
  });
}

export function getRememberedZoomSessionReplyRoot(sessionKey?: string): string | undefined {
  const key = normalizeSessionKey(sessionKey);
  if (!key) return undefined;

  const now = Date.now();
  pruneReplyRoots(now);

  const entry = sessionReplyRoots.get(key);
  if (!entry) return undefined;
  return entry.replyMainMessageId;
}

export function clearZoomSessionReplyRootsForTest(): void {
  sessionReplyRoots.clear();
}
