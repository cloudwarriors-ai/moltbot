/**
 * In-memory TTL store for file-upload session tokens.
 * Each token carries enough context to route the uploaded file back to the
 * correct agent conversation.
 */

import crypto from "node:crypto";

const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

export type UploadToken = {
  conversationId: string;
  userJid: string;
  userName?: string;
  userEmail?: string;
  isDirect: boolean;
  channelJid?: string;
  channelName?: string;
  /** Context label for naming uploaded files, e.g. "PROJ-1234" */
  label?: string;
  expiresAt: number;
};

const store = new Map<string, UploadToken>();

/** Prune expired entries. */
function pruneExpired(): void {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) {
      store.delete(key);
    }
  }
}

/** Create and store a new upload token. Returns the hex token string. */
export function createUploadToken(
  ctx: Omit<UploadToken, "expiresAt">,
): string {
  pruneExpired();
  const token = crypto.randomBytes(16).toString("hex");
  store.set(token, { ...ctx, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

/** Consume a token (one-time use). Returns the context or undefined. */
export function consumeUploadToken(token: string): UploadToken | undefined {
  const entry = store.get(token);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    store.delete(token);
    return undefined;
  }
  store.delete(token);
  return entry;
}

/** Peek at a token without consuming it (for GET validation). */
export function peekUploadToken(token: string): UploadToken | undefined {
  const entry = store.get(token);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    store.delete(token);
    return undefined;
  }
  return entry;
}
