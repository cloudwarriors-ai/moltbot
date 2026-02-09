/**
 * In-memory TTL store for pending approval answers.
 * Stores proposed answers awaiting review before being posted to channels.
 * Follows the same pattern as pending-shares.ts.
 */

const APPROVAL_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

type PendingApproval = {
  originalChannelJid: string;
  originalChannelName: string;
  originalSenderName: string;
  originalQuestion: string;
  proposedAnswer: string;
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

/** Store a pending approval and return its reference ID. */
export function storePendingApproval(data: {
  originalChannelJid: string;
  originalChannelName: string;
  originalSenderName: string;
  originalQuestion: string;
  proposedAnswer: string;
}): string {
  pruneExpired();
  const refId = generateRefId();
  store.set(refId, {
    ...data,
    expiresAt: Date.now() + APPROVAL_TTL_MS,
  });
  return refId;
}

/** Retrieve and consume a pending approval (one-time use). */
export function getPendingApproval(
  refId: string,
): {
  originalChannelJid: string;
  originalChannelName: string;
  originalSenderName: string;
  originalQuestion: string;
  proposedAnswer: string;
} | undefined {
  const entry = store.get(refId);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    store.delete(refId);
    return undefined;
  }
  store.delete(refId);
  return {
    originalChannelJid: entry.originalChannelJid,
    originalChannelName: entry.originalChannelName,
    originalSenderName: entry.originalSenderName,
    originalQuestion: entry.originalQuestion,
    proposedAnswer: entry.proposedAnswer,
  };
}
