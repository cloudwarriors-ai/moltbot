/**
 * In-memory TTL store for pending approval answers.
 * Stores proposed answers awaiting review before being posted to channels.
 * Follows the same pattern as pending-shares.ts.
 */

import type { ZoomInboundThreadContext } from "./threading.js";
import type { ZoomThreadSessionScope } from "./types.js";

const APPROVAL_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

type PendingApproval = {
  originalChannelJid: string;
  originalChannelName: string;
  originalSenderName: string;
  originalSenderJid?: string;
  agentId?: string;
  originalQuestion: string;
  proposedAnswer: string;
  threadContext?: ZoomInboundThreadContext;
  replyMainMessageId?: string;
  sessionScopeAtCapture?: ZoomThreadSessionScope;
  silent?: boolean;
  expiresAt: number;
};

const store = new Map<string, PendingApproval>();

let nextId = 1;

function generateRefId(): string {
  return `approval_${Date.now()}_${nextId++}`;
}

/** Prune expired entries (called on each write to keep the map tidy). */
function pruneExpired(): void {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) {
      store.delete(key);
    }
  }
}

type PendingApprovalData = {
  originalChannelJid: string;
  originalChannelName: string;
  originalSenderName: string;
  originalSenderJid?: string;
  agentId?: string;
  originalQuestion: string;
  proposedAnswer: string;
  threadContext?: ZoomInboundThreadContext;
  replyMainMessageId?: string;
  sessionScopeAtCapture?: ZoomThreadSessionScope;
  silent?: boolean;
};

/** Store a pending approval and return its reference ID. */
export function storePendingApproval(data: PendingApprovalData): string {
  pruneExpired();
  const refId = generateRefId();
  store.set(refId, {
    ...data,
    expiresAt: Date.now() + APPROVAL_TTL_MS,
  });
  return refId;
}

/** Retrieve and consume a pending approval (one-time use). */
export function getPendingApproval(refId: string): PendingApprovalData | undefined {
  const entry = store.get(refId);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    store.delete(refId);
    return undefined;
  }
  store.delete(refId);
  const { expiresAt: _, ...data } = entry;
  return data;
}

/** Read a pending approval without consuming it. */
export function peekPendingApproval(refId: string): PendingApprovalData | undefined {
  const entry = store.get(refId);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    store.delete(refId);
    return undefined;
  }
  const { expiresAt: _, ...data } = entry;
  return data;
}
