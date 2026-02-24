import { createZoomConversationStoreFs } from "./conversation-store-fs.js";
import type { ZoomConversationStoreEntry } from "./conversation-store.js";
import { rememberZoomSentMessageId } from "./sent-message-ids.js";

type ZoomReportToken = {
  accessToken: string;
  expiresAt: number;
};

type ZoomAccountUser = {
  id?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  display_name?: string;
};

type ZoomUserAtItem = {
  at_type: 1 | 2;
  at_contact?: string;
  start_position: number;
  end_position: number;
};

export type ZoomUserDirectoryHit = {
  source: "conversation_store" | "zoom_users_api";
  score: number;
  query: string;
  zoomUserId?: string;
  userJid?: string;
  email?: string;
  displayName?: string;
};

const REPORT_TOKEN_EXPIRY_BUFFER_MS = 60_000;
const XMPP_USER_JID_RE = /@xmpp\.zoom\.us$/i;
let cachedReportToken: ZoomReportToken | null = null;

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeMaybeEmailLocalPart(value: string): string {
  const lower = value.toLowerCase();
  const local = lower.includes("@") ? lower.split("@")[0] : lower;
  return normalizeToken(local);
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function cleanDisplayName(user: ZoomAccountUser): string {
  return (
    user.display_name?.trim() ||
    [user.first_name?.trim(), user.last_name?.trim()].filter(Boolean).join(" ")
  );
}

function deriveZoomJidFromUserId(userId?: string): string | undefined {
  const normalized = userId?.trim();
  if (!normalized) return undefined;
  if (normalized.includes("@")) {
    return normalized.toLowerCase();
  }
  return `${normalized.toLowerCase()}@xmpp.zoom.us`;
}

function scoreStoreMatch(query: string, entry: ZoomConversationStoreEntry): number {
  const q = query.trim();
  if (!q) return 0;
  const qLower = q.toLowerCase();
  const qNorm = normalizeToken(q);
  const qLocalNorm = normalizeMaybeEmailLocalPart(q);

  const userJid = entry.reference.userJid?.trim() ?? "";
  const userName = entry.reference.userName?.trim() ?? "";
  const jidLower = userJid.toLowerCase();
  const nameNorm = normalizeToken(userName);

  if (!userJid) return 0;
  if (jidLower === qLower) return 120;
  if (XMPP_USER_JID_RE.test(q) && jidLower === qLower) return 120;

  if (nameNorm && qNorm && nameNorm === qNorm) return 100;
  if (nameNorm && qLocalNorm && nameNorm === qLocalNorm) return 95;
  if (userName && userName.toLowerCase().includes(qLower)) return 80;

  if (looksLikeEmail(q)) {
    const jidLocalNorm = normalizeMaybeEmailLocalPart(userJid);
    if (jidLocalNorm && jidLocalNorm === qLocalNorm) return 75;
  }

  return 0;
}

function scoreApiUserMatch(query: string, user: ZoomAccountUser): number {
  const q = query.trim();
  if (!q) return 0;
  const qLower = q.toLowerCase();
  const qNorm = normalizeToken(q);
  const qLocalNorm = normalizeMaybeEmailLocalPart(q);

  const email = user.email?.trim().toLowerCase() ?? "";
  const displayName = cleanDisplayName(user);
  const displayNorm = normalizeToken(displayName);
  const userId = user.id?.trim().toLowerCase() ?? "";

  if (email && email === qLower) return 120;
  if (userId && userId === qLower) return 110;
  if (displayNorm && qNorm && displayNorm === qNorm) return 100;
  if (displayNorm && qLocalNorm && displayNorm === qLocalNorm) return 95;
  if (email && looksLikeEmail(q) && normalizeMaybeEmailLocalPart(email) === qLocalNorm) return 90;
  if (displayName && displayName.toLowerCase().includes(qLower)) return 80;
  if (email && email.includes(qLower)) return 70;

  return 0;
}

async function getZoomReportToken(): Promise<string | null> {
  if (cachedReportToken && Date.now() < cachedReportToken.expiresAt - REPORT_TOKEN_EXPIRY_BUFFER_MS) {
    return cachedReportToken.accessToken;
  }

  const clientId = process.env.ZOOM_REPORT_CLIENT_ID?.trim();
  const clientSecret = process.env.ZOOM_REPORT_CLIENT_SECRET?.trim();
  const accountId = process.env.ZOOM_REPORT_ACCOUNT_ID?.trim() || process.env.ZOOM_ACCOUNT_ID?.trim();
  if (!clientId || !clientSecret || !accountId) return null;

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`,
    { method: "POST", headers: { Authorization: `Basic ${basic}` } },
  );
  if (!response.ok) return null;

  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token || !data.expires_in) return null;

  cachedReportToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedReportToken.accessToken;
}

async function listZoomAccountUsers(token: string): Promise<ZoomAccountUser[]> {
  const users: ZoomAccountUser[] = [];
  let nextPageToken: string | undefined;

  for (let page = 0; page < 5; page += 1) {
    const params = new URLSearchParams({
      status: "active",
      page_size: "300",
    });
    if (nextPageToken) params.set("next_page_token", nextPageToken);

    const response = await fetch(`https://api.zoom.us/v2/users?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) break;
    const data = (await response.json()) as { users?: ZoomAccountUser[]; next_page_token?: string };
    users.push(...(data.users ?? []));
    nextPageToken = data.next_page_token;
    if (!nextPageToken) break;
  }
  return users;
}

function dedupeHits(hits: ZoomUserDirectoryHit[]): ZoomUserDirectoryHit[] {
  const richness = (hit: ZoomUserDirectoryHit): number => {
    let score = 0;
    if (hit.email) score += 2;
    if (hit.zoomUserId) score += 1;
    if (hit.displayName) score += 1;
    return score;
  };

  const byKey = new Map<string, ZoomUserDirectoryHit>();
  for (const hit of hits) {
    const key = (hit.userJid || hit.email || hit.zoomUserId || hit.displayName || "").toLowerCase();
    if (!key) continue;
    const current = byKey.get(key);
    if (
      !current ||
      hit.score > current.score ||
      (hit.score === current.score && richness(hit) > richness(current))
    ) {
      byKey.set(key, hit);
    }
  }
  return [...byKey.values()].sort((a, b) => b.score - a.score);
}

export function lookupZoomUsersFromEntries(
  query: string,
  entries: ZoomConversationStoreEntry[],
): ZoomUserDirectoryHit[] {
  const hits: ZoomUserDirectoryHit[] = [];
  for (const entry of entries) {
    const score = scoreStoreMatch(query, entry);
    if (score <= 0) continue;
    hits.push({
      source: "conversation_store",
      score,
      query,
      userJid: entry.reference.userJid,
      displayName: entry.reference.userName,
      email: entry.reference.userEmail,
    });
  }
  return dedupeHits(hits);
}

export async function lookupZoomUsers(query: string): Promise<ZoomUserDirectoryHit[]> {
  const normalized = query.trim();
  if (!normalized) return [];

  const store = (() => {
    try {
      return createZoomConversationStoreFs();
    } catch {
      const fallbackStateDir = process.env.OPENCLAW_STATE_DIR?.trim() || "/root/.openclaw";
      return createZoomConversationStoreFs({ stateDir: fallbackStateDir });
    }
  })();
  const storeEntries = await store.list();
  const hits: ZoomUserDirectoryHit[] = lookupZoomUsersFromEntries(normalized, storeEntries);

  const reportToken = await getZoomReportToken();
  if (!reportToken) return dedupeHits(hits);

  const users = await listZoomAccountUsers(reportToken);
  for (const user of users) {
    const score = scoreApiUserMatch(normalized, user);
    if (score <= 0) continue;
    hits.push({
      source: "zoom_users_api",
      score,
      query: normalized,
      zoomUserId: user.id,
      userJid: deriveZoomJidFromUserId(user.id),
      email: user.email,
      displayName: cleanDisplayName(user),
    });
  }

  return dedupeHits(hits);
}

export async function resolveZoomUserJid(query: string): Promise<string | null> {
  const hits = await lookupZoomUsers(query);
  const jidHits = hits.filter((hit) => Boolean(hit.userJid));
  if (jidHits.length === 0) return null;

  const topScore = jidHits[0].score;
  const top = jidHits.filter((hit) => hit.score === topScore);
  const unique = new Set(top.map((hit) => hit.userJid as string));
  if (unique.size === 1) return [...unique][0];

  return null;
}

function displayNameFromContact(contact: string): string {
  const local = contact.split("@")[0] ?? contact;
  const clean = local.replace(/[^a-z0-9._-]/gi, " ").trim();
  if (!clean) return "Member";
  const first = clean.split(/[._\s-]+/).filter(Boolean)[0];
  if (!first) return "Member";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

export async function parseZoomUserMentionMarkup(
  message: string,
  resolveMention: (raw: string) => Promise<{ atContact?: string; display?: string } | null>,
): Promise<{ text: string; atItems: ZoomUserAtItem[] }> {
  const atItems: ZoomUserAtItem[] = [];
  let text = "";
  let lastIndex = 0;
  const mentionRegex = /<@([^>]+)>|(@all)\b/gi;
  let match: RegExpExecArray | null;

  while ((match = mentionRegex.exec(message)) !== null) {
    text += message.slice(lastIndex, match.index);
    const start = text.length;

    if (match[2]) {
      const label = "@all";
      text += label;
      atItems.push({
        at_type: 2,
        start_position: start,
        end_position: start + label.length,
      });
    } else if (match[1]) {
      const raw = match[1].trim();
      const resolved = await resolveMention(raw);
      const mentionLabel = `@${resolved?.display?.trim() || displayNameFromContact(raw)}`;
      text += mentionLabel;
      if (resolved?.atContact) {
        atItems.push({
          at_type: 1,
          at_contact: resolved.atContact,
          start_position: start,
          end_position: start + mentionLabel.length,
        });
      }
    }

    lastIndex = mentionRegex.lastIndex;
  }

  text += message.slice(lastIndex);
  return { text, atItems };
}

export function resolveZoomSendFromUser(params: {
  explicitFromUser?: string;
  hasMentions: boolean;
  env?: NodeJS.ProcessEnv;
}): string | undefined {
  const env = params.env ?? process.env;
  const explicit = params.explicitFromUser?.trim();
  if (explicit) return explicit;

  if (params.hasMentions) {
    const mentionProxy = env.MENTION_PROXY?.trim();
    if (mentionProxy) return mentionProxy;
  }

  return env.ZOOM_REPORT_USER?.trim() || undefined;
}

export function pickZoomSenderIdentifierFromHits(
  hits: ZoomUserDirectoryHit[],
  fallback: string,
): string {
  if (hits.length === 0) return fallback;
  const topScore = hits[0].score;
  const top = hits.filter((hit) => hit.score === topScore);
  const withEmail = top.find((hit) => hit.email)?.email;
  if (withEmail) return withEmail;
  const withUserId = top.find((hit) => hit.zoomUserId)?.zoomUserId;
  if (withUserId) return withUserId;
  return fallback;
}

async function resolveZoomSenderIdentifier(candidate: string): Promise<string> {
  const trimmed = candidate.trim();
  if (!trimmed) return trimmed;
  if (looksLikeEmail(trimmed)) return trimmed;

  const hits = await lookupZoomUsers(trimmed);
  return pickZoomSenderIdentifierFromHits(hits, trimmed);
}

export async function sendZoomMessageAsUser(params: {
  fromUser?: string;
  toContact?: string;
  toChannel?: string;
  message: string;
  replyMainMessageId?: string;
  atItems?: Array<{
    at_type: 1 | 2;
    at_contact?: string;
    start_position: number;
    end_position: number;
  }>;
}): Promise<Record<string, unknown>> {
  const token = await getZoomReportToken();
  if (!token) {
    throw new Error(
      "Zoom report credentials not configured. Set ZOOM_REPORT_CLIENT_ID/ZOOM_REPORT_CLIENT_SECRET/ZOOM_REPORT_ACCOUNT_ID.",
    );
  }

  const toContact = params.toContact?.trim();
  const toChannelRaw = params.toChannel?.trim();
  const toChannel = toChannelRaw?.replace(/@conference\.xmpp\.zoom\.us$/i, "");

  if (!toContact && !toChannel) {
    throw new Error("Provide either to_contact or to_channel.");
  }
  if (toContact && toChannel) {
    throw new Error("Provide only one destination: to_contact or to_channel.");
  }

  const resolveMention = async (raw: string): Promise<{ atContact?: string; display?: string } | null> => {
    const candidate = raw.trim();
    if (!candidate) return null;
    if (looksLikeEmail(candidate)) {
      return { atContact: candidate, display: displayNameFromContact(candidate) };
    }

    const hits = await lookupZoomUsers(candidate);
    const best = hits.find((hit) => hit.email) ?? hits[0];
    if (!best) return null;
    if (best.email) {
      return {
        atContact: best.email,
        display: best.displayName?.split(/\s+/)[0] || displayNameFromContact(best.email),
      };
    }
    return best.displayName ? { display: best.displayName.split(/\s+/)[0] } : null;
  };

  const parsed = await parseZoomUserMentionMarkup(params.message, resolveMention);
  const mergedAtItems = [...parsed.atItems, ...(params.atItems ?? [])];
  const fromUser = resolveZoomSendFromUser({
    explicitFromUser: params.fromUser,
    hasMentions: mergedAtItems.length > 0,
  });
  if (!fromUser) {
    throw new Error("Missing from user. Provide from_user, or set MENTION_PROXY/ZOOM_REPORT_USER.");
  }
  const resolvedFromUser = await resolveZoomSenderIdentifier(fromUser);

  const body: Record<string, unknown> = { message: parsed.text };
  if (toContact) body.to_contact = toContact;
  if (toChannel) body.to_channel = toChannel;
  const replyMainMessageId = params.replyMainMessageId?.trim();
  if (replyMainMessageId) {
    body.reply_main_message_id = replyMainMessageId;
    body.reply_to = replyMainMessageId;
  }
  if (mergedAtItems.length > 0) body.at_items = mergedAtItems;

  const response = await fetch(
    `https://api.zoom.us/v2/chat/users/${encodeURIComponent(resolvedFromUser)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const text = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`zoom user-send failed (HTTP ${response.status}): ${text || "request failed"}`);
  }

  if (!text) return { ok: true };
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const responseMessageId = typeof parsed.id === "string"
      ? parsed.id
      : (typeof parsed.message_id === "string" ? parsed.message_id : undefined);
    rememberZoomSentMessageId(responseMessageId);
    return parsed;
  } catch {
    return { ok: true, raw: text };
  }
}
