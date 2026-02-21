import type { OpenClawConfig } from "openclaw/plugin-sdk";

import { sendZoomMessage } from "./api.js";
import { createZoomConversationStoreFs } from "./conversation-store-fs.js";
import {
  classifyZoomSendError,
  formatZoomSendErrorHint,
  formatUnknownError,
} from "./errors.js";
import { getZoomRuntime } from "./runtime.js";
import { resolveZoomCredentials } from "./token.js";
import type { ZoomAtItem, ZoomBodyItem, ZoomConfig } from "./types.js";

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

function normalizeSpeakerName(name?: string): string | undefined {
  const normalized = name?.trim();
  return normalized || undefined;
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
  const { cfg, to, isChannel, replyToMessageId, speakerName } = params;
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
  const storedRef = await conversationStore.get(to);
  const accountId = storedRef?.accountId ?? creds.accountId;

  log.debug(
    `sending message to=${to} channel=${Boolean(isChannel)} textLength=${text.length} replyToMessageId=${replyToMessageId ?? "none"}`,
  );

  const { cleanText, atItems } = parseMentions(text);

  // Build message content using Zoom's format
  // Zoom requires both head (title) and body (message content)
  const content = {
    head: {
      text: formatZoomSpeakerHeading(speakerName),
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
  body: ZoomBodyItem[];
  isChannel?: boolean;
}): Promise<SendZoomMessageResult> {
  const { cfg, to, headText, body, isChannel } = params;
  const zoomCfg = cfg.channels?.zoom as ZoomConfig | undefined;
  const creds = resolveZoomCredentials(zoomCfg);

  if (!creds) {
    throw new Error("Zoom credentials not configured");
  }

  const core = getZoomRuntime();
  const log = core.logging.getChildLogger({ name: "zoom" });

  const conversationStore = createZoomConversationStoreFs();
  const storedRef = await conversationStore.get(to);
  const accountId = storedRef?.accountId ?? creds.accountId;

  log.debug("sending action message", { to, isChannel, bodyItems: body.length });

  const content = {
    head: { text: headText ?? "cwbot" },
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
