import type { OpenClawConfig } from "openclaw/plugin-sdk";

import { sendZoomMessage } from "./api.js";
import { createZoomConversationStoreFs } from "./conversation-store-fs.js";
import type { ZoomConversationStoreEntry } from "./conversation-store.js";
import {
  classifyZoomSendError,
  formatZoomSendErrorHint,
  formatUnknownError,
} from "./errors.js";
import { getZoomRuntime } from "./runtime.js";
import { rememberZoomSentMessageId, rememberZoomSentMessageText } from "./sent-message-ids.js";
import { resolveZoomCredentials } from "./token.js";
import type { ZoomAtItem, ZoomBodyItem, ZoomConfig } from "./types.js";
import { resolveZoomUserJid } from "./user-directory.js";

export type SendZoomMessageParams = {
  /** Full config (for credentials) */
  cfg: OpenClawConfig;
  /** Conversation ID (user JID or channel JID) to send to */
  to: string;
  /** Message text */
  text: string;
  /** Whether this is a channel message */
  isChannel?: boolean;
  /** Optional: reply to a specific message */
  replyToMessageId?: string;
  /** Optional speaker label used in card heading (e.g., "PulseBot says:"). */
  speakerName?: string;
};

export type SendZoomMessageResult = {
  messageId: string;
  conversationId: string;
};

/** Zoom Team Chat message limit */
const ZOOM_TEXT_CHUNK_LIMIT = 4000;
const XMPP_USER_JID_RE = /@xmpp\.zoom\.us$/i;

function normalizeLookupToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function resolveDmRecipientFromKnownConversations(
  recipient: string,
  entries: ZoomConversationStoreEntry[],
): string | null {
  const target = recipient.trim();
  if (!target) return null;
  if (XMPP_USER_JID_RE.test(target)) return target;

  const lower = target.toLowerCase();
  const normalized = normalizeLookupToken(target);
  const emailLocal = lower.includes("@") ? lower.split("@")[0] : lower;
  const normalizedEmailLocal = normalizeLookupToken(emailLocal);

  const candidates = new Set<string>();
  for (const entry of entries) {
    const userJid = entry.reference.userJid?.trim();
    if (!userJid || !XMPP_USER_JID_RE.test(userJid)) continue;

    const userEmail = entry.reference.userEmail?.trim().toLowerCase();
    const userName = entry.reference.userName?.trim() ?? "";
    const normalizedUserName = normalizeLookupToken(userName);

    if (userJid.toLowerCase() === lower) candidates.add(userJid);
    if (userEmail && userEmail === lower) candidates.add(userJid);
    if (normalizedUserName && normalizedUserName === normalized) candidates.add(userJid);
    if (normalizedUserName && normalizedEmailLocal && normalizedUserName === normalizedEmailLocal) {
      candidates.add(userJid);
    }
  }

  if (candidates.size === 1) {
    return [...candidates][0];
  }
  return null;
}

function normalizeSpeakerName(name?: string): string | undefined {
  const normalized = name?.trim();
  return normalized || undefined;
}

function resolveAgentName(cfg: OpenClawConfig, agentId?: string): string | undefined {
  const normalizedAgentId = agentId?.trim();
  if (!normalizedAgentId) return undefined;
  const list = Array.isArray(cfg.agents?.list) ? cfg.agents.list : [];
  const entry = list.find((candidate) => candidate?.id?.trim() === normalizedAgentId);
  return normalizeSpeakerName(entry?.name);
}

function resolveSpeakerNameForSend(params: {
  cfg: OpenClawConfig;
  to: string;
  isChannel: boolean;
  speakerName?: string;
}): string | undefined {
  const explicit = normalizeSpeakerName(params.speakerName);
  if (explicit) return explicit;
  if (!params.isChannel) return undefined;

  try {
    const core = getZoomRuntime();
    const route = core.channel.routing.resolveAgentRoute({
      cfg: params.cfg,
      channel: "zoom",
      peer: { kind: "channel", id: params.to },
    });
    return resolveAgentName(params.cfg, route.agentId);
  } catch {
    return undefined;
  }
}

export function formatZoomSpeakerHeading(speakerName?: string): string {
  const normalized = normalizeSpeakerName(speakerName);
  if (!normalized) return "cwbot says:";
  return `${normalized} says:`;
}

/** Strip markdown bold markers (**) that wrap or adjoin URLs */
function cleanMarkdownUrls(text: string): string {
  // Remove ** immediately before or after URLs so links stay clickable
  return text.replace(/\*\*(https?:\/\/[^\s*]+)\*\*/g, "$1");
}

/** Parse mentions and generate at_items */
function parseMentions(text: string): { cleanText: string; atItems: ZoomAtItem[] } {
  const atItems: ZoomAtItem[] = [];
  let cleanText = "";
  let lastIndex = 0;

  // Pattern: <@jid> or @all
  const mentionRegex = /<@([^>]+)>|(@all)\b/g;
  let match;

  while ((match = mentionRegex.exec(text)) !== null) {
    // Append preceding text
    cleanText += text.slice(lastIndex, match.index);

    const startIndex = cleanText.length;
    let displayText = "";

    if (match[1]) {
      // Individual mention <@jid>
      const atContact = match[1];
      displayText = "@Member";
      cleanText += displayText;
      atItems.push({
        at_type: 1,
        start_index: startIndex,
        end_index: startIndex + displayText.length,
        at_contact: atContact,
      });
    } else if (match[2]) {
      // Mention all @all
      displayText = "@all";
      cleanText += displayText;
      atItems.push({
        at_type: 2,
        start_index: startIndex,
        end_index: startIndex + displayText.length,
      });
    }

    lastIndex = mentionRegex.lastIndex;
  }

  // Append remaining text
  cleanText += text.slice(lastIndex);

  return { cleanText, atItems };
}

/**
 * Send a text message to a Zoom Team Chat conversation.
 */
export async function sendZoomTextMessage(
  params: SendZoomMessageParams,
): Promise<SendZoomMessageResult> {
  const { cfg, isChannel, replyToMessageId, speakerName } = params;
  const text = cleanMarkdownUrls(params.text);
  const zoomCfg = cfg.channels?.zoom as ZoomConfig | undefined;
  const creds = resolveZoomCredentials(zoomCfg);

  if (!creds) {
    throw new Error("Zoom credentials not configured");
  }

  const core = getZoomRuntime();
  const log = core.logging.getChildLogger({ name: "zoom" });

  // Get conversation reference for account_id if needed
  const conversationStore = createZoomConversationStoreFs();
  let to = params.to;
  if (!isChannel) {
    const resolved = resolveDmRecipientFromKnownConversations(
      to,
      await conversationStore.list(),
    );
    if (resolved) {
      to = resolved;
    } else {
      const resolvedFromDirectory = await resolveZoomUserJid(to);
      if (resolvedFromDirectory) to = resolvedFromDirectory;
    }
  }
  const storedRef = await conversationStore.get(to);
  const accountId = storedRef?.accountId ?? creds.accountId;

  log.debug(
    `sending message to=${to} channel=${Boolean(isChannel)} textLength=${text.length} replyToMessageId=${replyToMessageId ?? "none"}`,
  );

  const { cleanText, atItems } = parseMentions(text);
  const resolvedSpeakerName = resolveSpeakerNameForSend({
    cfg,
    to,
    isChannel: Boolean(isChannel),
    speakerName,
  });

  // Build message content using Zoom's format
  // Zoom requires both head (title) and body (message content)
  const content = {
    head: {
      text: formatZoomSpeakerHeading(resolvedSpeakerName),
    },
    body: [
      {
        type: "message" as const,
        text: cleanText.slice(0, ZOOM_TEXT_CHUNK_LIMIT),
        at_items: atItems.length > 0 ? atItems : undefined,
      },
    ],
  };

  try {
    const result = await sendZoomMessage(creds, {
      robotJid: creds.botJid,
      toJid: to,
      accountId,
      content,
      isChannel,
      replyMainMessageId: replyToMessageId,
    });

    if (!result.ok) {
      const err = { statusCode: result.status, message: result.error };
      const classification = classifyZoomSendError(err);
      const hint = formatZoomSendErrorHint(classification);
      const status = classification.statusCode ? ` (HTTP ${classification.statusCode})` : "";
      throw new Error(
        `zoom send failed${status}: ${result.error ?? "unknown error"}${hint ? ` (${hint})` : ""}`,
      );
    }

    const messageId = result.data?.message_id ?? "unknown";
    rememberZoomSentMessageId(messageId);
    rememberZoomSentMessageText(messageId, cleanText.slice(0, ZOOM_TEXT_CHUNK_LIMIT));

    log.info("sent message", { to, messageId });

    return {
      messageId,
      conversationId: to,
    };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("zoom send failed")) {
      throw err;
    }
    const classification = classifyZoomSendError(err);
    const hint = formatZoomSendErrorHint(classification);
    const status = classification.statusCode ? ` (HTTP ${classification.statusCode})` : "";
    throw new Error(
      `zoom send failed${status}: ${formatUnknownError(err)}${hint ? ` (${hint})` : ""}`,
    );
  }
}

/**
 * Send an interactive message with action buttons to a Zoom Team Chat conversation.
 */
export async function sendZoomActionMessage(params: {
  cfg: OpenClawConfig;
  to: string;
  headText?: string;
  speakerName?: string;
  body: ZoomBodyItem[];
  isChannel?: boolean;
}): Promise<SendZoomMessageResult> {
  const { cfg, headText, body, isChannel } = params;
  const zoomCfg = cfg.channels?.zoom as ZoomConfig | undefined;
  const creds = resolveZoomCredentials(zoomCfg);

  if (!creds) {
    throw new Error("Zoom credentials not configured");
  }

  const core = getZoomRuntime();
  const log = core.logging.getChildLogger({ name: "zoom" });

  const conversationStore = createZoomConversationStoreFs();
  let to = params.to;
  if (!isChannel) {
    const resolved = resolveDmRecipientFromKnownConversations(
      to,
      await conversationStore.list(),
    );
    if (resolved) {
      to = resolved;
    } else {
      const resolvedFromDirectory = await resolveZoomUserJid(to);
      if (resolvedFromDirectory) to = resolvedFromDirectory;
    }
  }
  const storedRef = await conversationStore.get(to);
  const accountId = storedRef?.accountId ?? creds.accountId;
  const resolvedSpeakerName = resolveSpeakerNameForSend({
    cfg,
    to,
    isChannel: Boolean(isChannel),
    speakerName: params.speakerName,
  });

  log.debug("sending action message", { to, isChannel, bodyItems: body.length });

  const content = {
    head: { text: headText ?? resolvedSpeakerName ?? "cwbot" },
    body: body.map((item) => {
      if (item.type === "actions") {
        return {
          type: "actions" as const,
          items: item.items.map((btn) => ({
            text: btn.text,
            value: btn.value,
            style: btn.style ?? "Default",
          })),
        };
      }
      
      const { cleanText, atItems } = parseMentions(item.text);
      return { 
        type: "message" as const, 
        text: cleanText,
        at_items: atItems.length > 0 ? atItems : undefined,
      };
    }),
  };

  try {
    const result = await sendZoomMessage(creds, {
      robotJid: creds.botJid,
      toJid: to,
      accountId,
      content,
      isChannel,
    });

    if (!result.ok) {
      const err = { statusCode: result.status, message: result.error };
      const classification = classifyZoomSendError(err);
      const hint = formatZoomSendErrorHint(classification);
      const status = classification.statusCode ? ` (HTTP ${classification.statusCode})` : "";
      throw new Error(
        `zoom send failed${status}: ${result.error ?? "unknown error"}${hint ? ` (${hint})` : ""}`,
      );
    }

    const messageId = result.data?.message_id ?? "unknown";
    rememberZoomSentMessageId(messageId);
    log.info("sent action message", { to, messageId });
    return { messageId, conversationId: to };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("zoom send failed")) {
      throw err;
    }
    const classification = classifyZoomSendError(err);
    const hint = formatZoomSendErrorHint(classification);
    const status = classification.statusCode ? ` (HTTP ${classification.statusCode})` : "";
    throw new Error(
      `zoom send failed${status}: ${formatUnknownError(err)}${hint ? ` (${hint})` : ""}`,
    );
  }
}

/**
 * List all known conversation references (for debugging/CLI).
 */
export async function listZoomConversations(): Promise<
  Array<{
    conversationId: string;
    userName?: string;
    conversationType?: string;
  }>
> {
  const store = createZoomConversationStoreFs();
  const all = await store.list();
  return all.map(({ conversationId, reference }) => ({
    conversationId,
    userName: reference.userName,
    conversationType: reference.conversationType,
  }));
}
