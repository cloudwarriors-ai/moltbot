/**
 * In-memory TTL store for pending share summaries.
 * Workaround for Zoom's button value length limits - we store the full
 * summary text here and pass only a short reference ID in the button value.
 */

const SHARE_TTL_MS = 60 * 60 * 1000; // 1 hour

type PendingShare = {
  channelJid: string;
  summary: string;
  expiresAt: number;
};

const store = new Map<string, PendingShare>();

let nextId = 1;

function generateRefId(): string {
  return `share_${Date.now()}_${nextId++}`;
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

/** Store a pending share and return its reference ID. */
export function storePendingShare(channelJid: string, summary: string): string {
  pruneExpired();
  const refId = generateRefId();
  store.set(refId, {
    channelJid,
    summary,
    expiresAt: Date.now() + SHARE_TTL_MS,
  });
  return refId;
}

/** Retrieve and consume a pending share (one-time use). */
export function getPendingShare(
  refId: string,
): { channelJid: string; summary: string } | undefined {
  const entry = store.get(refId);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    store.delete(refId);
    return undefined;
  }
  store.delete(refId);
  return { channelJid: entry.channelJid, summary: entry.summary };
}
