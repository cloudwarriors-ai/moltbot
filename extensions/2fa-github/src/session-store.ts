/**
 * Session Store
 *
 * File-based storage for 2FA trust and pending verifications.
 * Trust is persistent (no expiry) until explicitly revoked.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { PendingVerification, SessionStore, TrustedSession } from "./types.js";

const STORE_FILENAME = "2fa-sessions.json";

function getStorePath(): string {
  return path.join(os.homedir(), ".openclaw", STORE_FILENAME);
}

function loadStore(): SessionStore {
  const storePath = getStorePath();

  if (!fs.existsSync(storePath)) {
    return { version: 2, pending: {}, trusted: {} };
  }

  try {
    const data = JSON.parse(fs.readFileSync(storePath, "utf-8"));
    // Migrate from v1 format if needed
    if (data.version === 1) {
      return {
        version: 2,
        pending: data.pending ?? {},
        trusted: data.trustedChannels ?? {},
      };
    }
    return {
      version: 2,
      pending: data.pending ?? {},
      trusted: data.trusted ?? {},
    };
  } catch {
    // Corrupted file, start fresh
    return { version: 2, pending: {}, trusted: {} };
  }
}

function saveStore(store: SessionStore): void {
  const storePath = getStorePath();
  const dir = path.dirname(storePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
}

/**
 * Prune expired pending verifications.
 */
function pruneExpired(store: SessionStore): void {
  const now = new Date();

  for (const [key, pending] of Object.entries(store.pending)) {
    if (new Date(pending.expiresAt) < now) {
      delete store.pending[key];
    }
  }
}

/**
 * Get a pending verification for the given key.
 * Returns undefined if no valid pending verification exists.
 */
export function getPending(sessionKey: string): PendingVerification | undefined {
  const store = loadStore();
  const pending = store.pending[sessionKey];

  if (!pending) return undefined;

  // Check if expired
  if (new Date(pending.expiresAt) < new Date()) {
    delete store.pending[sessionKey];
    saveStore(store);
    return undefined;
  }

  return pending;
}

/**
 * Set a pending verification for the given key.
 */
export function setPending(sessionKey: string, pending: PendingVerification): void {
  const store = loadStore();
  store.pending[sessionKey] = pending;
  pruneExpired(store);
  saveStore(store);
}

/**
 * Clear a pending verification for the given key.
 */
export function clearPending(sessionKey: string): void {
  const store = loadStore();

  if (store.pending[sessionKey]) {
    delete store.pending[sessionKey];
    saveStore(store);
  }
}

// ============================================================================
// Trust Management (unified for all sessions)
// ============================================================================

/**
 * Check if a session has trust enabled.
 * Trust is persistent (no expiry) until explicitly revoked.
 */
export function isTrusted(sessionKey: string): TrustedSession | undefined {
  const store = loadStore();
  return store.trusted?.[sessionKey];
}

/**
 * Enable trust for a session.
 * Called after successful 2FA verification.
 */
export function enableTrust(sessionKey: string, params: { githubLogin: string }): void {
  const store = loadStore();
  if (!store.trusted) {
    store.trusted = {};
  }

  store.trusted[sessionKey] = {
    sessionKey,
    githubLogin: params.githubLogin,
    enabledAt: new Date().toISOString(),
  };

  // Clear any pending verification
  delete store.pending[sessionKey];

  saveStore(store);
}

/**
 * Revoke trust for a session.
 * Called when user says "disable trust".
 */
export function revokeTrust(sessionKey: string): boolean {
  const store = loadStore();
  if (!store.trusted?.[sessionKey]) {
    return false; // Nothing to revoke
  }

  delete store.trusted[sessionKey];
  saveStore(store);
  return true;
}

/**
 * Revoke all trust (useful for security reset).
 */
export function revokeAllTrust(): number {
  const store = loadStore();
  const count = Object.keys(store.trusted ?? {}).length;
  store.trusted = {};
  saveStore(store);
  return count;
}

/**
 * List all trusted sessions.
 */
export function listTrustedSessions(): TrustedSession[] {
  const store = loadStore();
  return Object.values(store.trusted ?? {});
}

/**
 * Clear all data (for testing).
 */
export function clearAll(): void {
  const store: SessionStore = { version: 2, pending: {}, trusted: {} };
  saveStore(store);
}

// Browser auth pending state (in-memory only, not persisted)
const browserAuthPending = new Map<string, { startedAt: number }>();

export function setBrowserAuthPending(sessionKey: string): void {
  browserAuthPending.set(sessionKey, { startedAt: Date.now() });
}

export function getBrowserAuthPending(sessionKey: string): { startedAt: number } | undefined {
  return browserAuthPending.get(sessionKey);
}

export function clearBrowserAuthPending(sessionKey: string): void {
  browserAuthPending.delete(sessionKey);
}

/**
 * Get statistics about the store.
 */
export function getStats(): { pendingCount: number; trustedCount: number } {
  const store = loadStore();
  pruneExpired(store);

  return {
    pendingCount: Object.keys(store.pending).length,
    trustedCount: Object.keys(store.trusted ?? {}).length,
  };
}
