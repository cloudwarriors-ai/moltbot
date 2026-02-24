const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_TRACKED_IDS = 4000;

const trackedMessageIds = new Map<string, number>();
const trackedMessageTexts = new Map<string, { text: string; expiresAt: number }>();

function normalizeMessageId(messageId: string): string {
  return messageId.trim().replace(/[{}]/g, "").toLowerCase();
}

function pruneExpired(now = Date.now()): void {
  for (const [id, expiresAt] of trackedMessageIds) {
    if (expiresAt <= now) {
      trackedMessageIds.delete(id);
    }
  }
  for (const [id, entry] of trackedMessageTexts) {
    if (entry.expiresAt <= now) {
      trackedMessageTexts.delete(id);
    }
  }
}

function enforceSizeLimit(): void {
  while (trackedMessageIds.size > MAX_TRACKED_IDS) {
    const firstKey = trackedMessageIds.keys().next().value as string | undefined;
    if (!firstKey) break;
    trackedMessageIds.delete(firstKey);
  }
  while (trackedMessageTexts.size > MAX_TRACKED_IDS) {
    const firstKey = trackedMessageTexts.keys().next().value as string | undefined;
    if (!firstKey) break;
    trackedMessageTexts.delete(firstKey);
  }
}

export function rememberZoomSentMessageId(messageId: string | null | undefined, ttlMs = DEFAULT_TTL_MS): void {
  const normalized = typeof messageId === "string" ? normalizeMessageId(messageId) : "";
  if (!normalized) return;
  const now = Date.now();
  pruneExpired(now);
  trackedMessageIds.set(normalized, now + Math.max(1_000, ttlMs));
  enforceSizeLimit();
}

export function rememberZoomSentMessageText(
  messageId: string | null | undefined,
  text: string | null | undefined,
  ttlMs = DEFAULT_TTL_MS,
): void {
  const normalized = typeof messageId === "string" ? normalizeMessageId(messageId) : "";
  const normalizedText = typeof text === "string" ? text.trim() : "";
  if (!normalized || !normalizedText) return;
  const now = Date.now();
  pruneExpired(now);
  trackedMessageTexts.set(normalized, {
    text: normalizedText.slice(0, 4000),
    expiresAt: now + Math.max(1_000, ttlMs),
  });
  enforceSizeLimit();
}

export function isRecentlySentZoomMessageId(messageId: string | null | undefined): boolean {
  const normalized = typeof messageId === "string" ? normalizeMessageId(messageId) : "";
  if (!normalized) return false;
  const now = Date.now();
  pruneExpired(now);
  const expiresAt = trackedMessageIds.get(normalized);
  return typeof expiresAt === "number" && expiresAt > now;
}

export function getRecentlySentZoomMessageText(messageId: string | null | undefined): string | undefined {
  const normalized = typeof messageId === "string" ? normalizeMessageId(messageId) : "";
  if (!normalized) return undefined;
  const now = Date.now();
  pruneExpired(now);
  return trackedMessageTexts.get(normalized)?.text;
}

export function resetZoomSentMessageIdsForTest(): void {
  trackedMessageIds.clear();
  trackedMessageTexts.clear();
}
