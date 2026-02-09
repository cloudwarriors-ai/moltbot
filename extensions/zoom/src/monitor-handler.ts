import type { OpenClawConfig, RuntimeEnv, GroupPolicy } from "openclaw/plugin-sdk";

import type { ZoomConversationStore } from "./conversation-store.js";
import { formatUnknownError } from "./errors.js";
import type { ZoomMonitorLogger } from "./monitor-types.js";
import { getDynamicObservePolicy, toggleObserveChannel, setReviewChannel } from "./observe-config.js";
import { getPendingApproval, storePendingApproval } from "./pending-approvals.js";
import { getPendingShare } from "./pending-shares.js";
import { createUploadToken } from "./upload-tokens.js";
import { isZoomGroupAllowed, resolveZoomAllowlistMatch, resolveZoomObservePolicy, resolveZoomReplyPolicy, resolveZoomRouteConfig } from "./policy.js";
import type { ZoomConfig, ZoomCredentials, ZoomWebhookEvent } from "./types.js";
import { getZoomRuntime } from "./runtime.js";

export type ZoomMessageHandlerDeps = {
  cfg: OpenClawConfig;
  runtime: RuntimeEnv;
  creds: ZoomCredentials;
  textLimit: number;
  conversationStore: ZoomConversationStore;
  log: ZoomMonitorLogger;
};

/**
 * Extract mention of the bot from message text.
 * Zoom mentions format: @<display_name> or uses robot_jid in payload
 */
function extractBotMention(params: {
  text: string;
  botJid: string;
  robotJidInPayload?: string;
}): { mentioned: boolean; cleanText: string } {
  const { text, botJid, robotJidInPayload } = params;

  // Check if robot_jid in payload matches our bot
  if (robotJidInPayload && robotJidInPayload === botJid) {
    return { mentioned: true, cleanText: text.trim() };
  }

  // Clean up any @mention patterns (Zoom uses @DisplayName format)
  // The bot might be mentioned as @BotName - we'll preserve the text as-is
  // since the mention check already passed via robot_jid
  return { mentioned: false, cleanText: text.trim() };
}

/** Strip @mentions and extract a bare command name (e.g. "/observe" or "set-review-channel"). */
function parseObserveCommand(text: string): "observe" | "set-review-channel" | null {
  const cleaned = text.replace(/@\S+/g, "").trim().toLowerCase();
  if (cleaned === "/observe" || cleaned === "observe") return "observe";
  if (cleaned === "/set-review-channel" || cleaned === "set-review-channel") return "set-review-channel";
  return null;
}

export function createZoomMessageHandler(deps: ZoomMessageHandlerDeps) {
  const { cfg, runtime, creds, textLimit, conversationStore, log } = deps;
  const zoomCfg = cfg.channels?.zoom as ZoomConfig | undefined;
  const core = getZoomRuntime();

  return async (event: ZoomWebhookEvent) => {
    const eventType = event.event;

    log.info(`webhook event received: ${eventType}`, { event: eventType, payload: JSON.stringify(event.payload).slice(0, 500) });

    // Handle bot notification (slash commands / direct messages to bot)
    if (eventType === "bot_notification") {
      await handleBotNotification(event);
      return;
    }

    // Handle interactive message actions (button clicks on action cards)
    if (eventType === "interactive_message_actions" || eventType === "interactive_message_select") {
      await handleBotNotification(event);
      return;
    }

    // Handle channel mentions (when bot is @mentioned in a channel)
    if (eventType === "chat_message.posted" || eventType === "team_chat.app_mention" || eventType === "team_chat.channel_message_posted") {
      if (eventType === "team_chat.channel_message_posted") {
        log.info(`team_chat payload: ${JSON.stringify(event.payload)}`);
      }
      await handleChannelMessage(event);
      return;
    }

    log.info(`ignoring unhandled event type: ${eventType}`);
  };

  async function handleBotNotification(event: ZoomWebhookEvent) {
    // Debug: log full event structure
    log.info(`bot_notification event: ${JSON.stringify(event)}`);

    const payload = event.payload?.object ?? event.payload;
    if (!payload) {
      log.debug("bot_notification missing payload object");
      return;
    }

    // Handle button/action click events before text processing
    const actionItem = payload.actionItem;
    if (actionItem) {
      await handleButtonAction(payload, actionItem);
      return;
    }

    const userJid = payload.userJid ?? payload.operator;
    const userName = payload.userName ?? payload.user_name ?? payload.operator;
    const userEmail = payload.user_email;
    const toJid = payload.toJid;
    const channelName = payload.channelName;
    // For bot notifications, text comes from payload.text or payload.cmd
    const messageText = payload.text ?? payload.cmd ?? "";

    if (!userJid || !messageText) {
      log.debug("bot_notification missing required fields", { userJid, hasMessage: Boolean(messageText) });
      return;
    }

    // Detect if this is a channel message (toJid contains @conference.)
    const isChannelMessage = toJid?.includes("@conference.") ?? false;
    const conversationId = isChannelMessage ? toJid : userJid;

    log.debug("processing bot notification", {
      userJid,
      userName,
      toJid,
      isChannelMessage,
      textLength: messageText.length,
    });

    if (isChannelMessage) {
      // Channel message - check group policy
      const groupPolicy: GroupPolicy = zoomCfg?.groupPolicy ?? "open";

      if (groupPolicy === "disabled") {
        log.debug("group policy disabled, ignoring channel message");
        return;
      }

      // Handle observe mode slash commands
      const botNotifCmd = parseObserveCommand(messageText);
      if (botNotifCmd === "observe") {
        const result = await toggleObserveChannel(toJid, channelName);
        const { sendZoomTextMessage } = await import("./send.js");
        await sendZoomTextMessage({
          cfg,
          to: toJid,
          text: result.enabled
            ? `Observe mode **enabled** for this channel. I'll silently watch for questions and route proposed answers through the review channel for approval.`
            : `Observe mode **disabled** for this channel. Returning to normal behavior.`,
          isChannel: true,
        });
        return;
      }

      if (botNotifCmd === "set-review-channel") {
        await setReviewChannel(toJid, channelName);
        const { sendZoomTextMessage } = await import("./send.js");
        await sendZoomTextMessage({
          cfg,
          to: toJid,
          text: `This channel is now set as the **review channel**. Proposed answers from observed channels will appear here with Approve/Reject buttons.`,
          isChannel: true,
        });
        return;
      }

      // Store channel conversation reference
      await conversationStore.upsert(toJid, {
        channelJid: toJid,
        channelName,
        robotJid: creds.botJid,
        accountId: creds.accountId,
        conversationType: "channel",
      });

      // Route to agent with channel context
      await routeToAgent({
        conversationId: toJid,
        senderId: userJid,
        senderName: userName,
        senderEmail: userEmail,
        text: messageText,
        isDirect: false,
        channelJid: toJid,
        channelName,
      });
    } else {
      // Direct message - check DM policy
      const dmPolicy = zoomCfg?.dmPolicy ?? "pairing";
      const allowFrom = zoomCfg?.allowFrom ?? [];

      if (dmPolicy === "disabled") {
        log.debug("dm policy disabled, ignoring message");
        return;
      }

      if (dmPolicy !== "open") {
        const match = resolveZoomAllowlistMatch({
          allowFrom,
          senderId: userJid,
          senderName: userName,
          senderEmail: userEmail,
        });

        if (!match.allowed) {
          log.debug("sender not in allowlist", { userJid, userName });
          return;
        }
      }

      // Store DM conversation reference
      await conversationStore.upsert(userJid, {
        userJid,
        userName,
        userEmail,
        robotJid: creds.botJid,
        accountId: creds.accountId,
        conversationType: "direct",
      });

      // Route to agent
      await routeToAgent({
        conversationId: userJid,
        senderId: userJid,
        senderName: userName,
        senderEmail: userEmail,
        text: messageText,
        isDirect: true,
      });
    }
  }

  async function handleButtonAction(
    payload: NonNullable<ZoomWebhookEvent["payload"]["object"]>,
    actionItem: { text?: string; value?: string },
  ) {
    const userJid = payload.userJid ?? payload.operator;
    const userName = payload.userName ?? payload.user_name ?? payload.operator;
    const userEmail = payload.user_email;
    const value = actionItem.value ?? "";

    if (!userJid) {
      log.debug("button action missing userJid");
      return;
    }

    log.info("handling button action", { userJid, value: value.slice(0, 80) });

    // Handle share-to-channel directly (no LLM round-trip)
    if (value.startsWith("share_to_channel:")) {
      const refId = value.slice("share_to_channel:".length);
      const pending = getPendingShare(refId);
      if (!pending) {
        log.debug("pending share not found or expired", { refId });
        // Notify user the share expired
        const { sendZoomTextMessage } = await import("./send.js");
        await sendZoomTextMessage({
          cfg,
          to: userJid,
          text: "This share link has expired. Please ask the agent to generate a new summary.",
          isChannel: false,
        });
        return;
      }

      const { sendZoomTextMessage } = await import("./send.js");
      // Post summary to the channel
      await sendZoomTextMessage({
        cfg,
        to: pending.channelJid,
        text: pending.summary,
        isChannel: true,
      });
      // Confirm to user in DM
      await sendZoomTextMessage({
        cfg,
        to: userJid,
        text: "Summary shared to channel.",
        isChannel: false,
      });
      return;
    }

    // Handle approve answer from observe mode
    if (value.startsWith("approve_answer:")) {
      const refId = value.slice("approve_answer:".length);
      const pending = getPendingApproval(refId);
      const { sendZoomTextMessage } = await import("./send.js");
      if (!pending) {
        log.debug("pending approval not found or expired", { refId });
        await sendZoomTextMessage({
          cfg,
          to: userJid,
          text: "This approval has expired. The original question will need to be asked again.",
          isChannel: false,
        });
        return;
      }

      // Post the approved answer to the original channel
      await sendZoomTextMessage({
        cfg,
        to: pending.originalChannelJid,
        text: pending.proposedAnswer,
        isChannel: true,
      });
      // Confirm to reviewer via DM
      await sendZoomTextMessage({
        cfg,
        to: userJid,
        text: `Answer approved and posted to ${pending.originalChannelName}.`,
        isChannel: false,
      });
      return;
    }

    // Handle reject answer from observe mode
    if (value.startsWith("reject_answer:")) {
      const refId = value.slice("reject_answer:".length);
      const pending = getPendingApproval(refId);
      const { sendZoomTextMessage } = await import("./send.js");
      if (!pending) {
        log.debug("pending approval not found or expired", { refId });
        await sendZoomTextMessage({
          cfg,
          to: userJid,
          text: "This approval has already expired or been handled.",
          isChannel: false,
        });
        return;
      }

      // Confirm rejection via DM
      await sendZoomTextMessage({
        cfg,
        to: userJid,
        text: "Answer rejected and discarded.",
        isChannel: false,
      });
      return;
    }

    // Handle file-upload button clicks — generate token and send URL directly
    if (/upload|file/i.test(value)) {
      const token = createUploadToken({
        conversationId: userJid,
        userJid,
        userName,
        userEmail,
        isDirect: true,
      });
      const zoomCfg = cfg.channels?.zoom as ZoomConfig | undefined;
      const baseUrl = zoomCfg?.publicUrl ?? "https://molty-dev.cloudwarriors.ai";
      const uploadUrl = `${baseUrl}/zoom/file?token=${token}`;
      const { sendZoomTextMessage } = await import("./send.js");
      await sendZoomTextMessage({
        cfg,
        to: userJid,
        text: `Here's your upload link:\n${uploadUrl}`,
        isChannel: false,
      });
      return;
    }

    // Route other button clicks to agent as synthetic message
    await routeToAgent({
      conversationId: userJid,
      senderId: userJid,
      senderName: userName,
      senderEmail: userEmail,
      text: `[BUTTON_CLICK] ${value}`,
      isDirect: true,
    });
  }

  async function handleChannelMessage(event: ZoomWebhookEvent) {
    const payload = event.payload?.object ?? event.payload;
    if (!payload) {
      log.debug("channel message missing payload object");
      return;
    }

    // Support both chat_message.posted and team_chat.channel_message_posted formats
    const isTeamChatEvent = event.event === "team_chat.channel_message_posted";
    const rawChannelId = payload.channel_jid ?? (payload as Record<string, unknown>).channel_id;
    const channelJid = rawChannelId
      ? String(rawChannelId).includes("@") ? String(rawChannelId) : `${rawChannelId}@conference.xmpp.zoom.us`
      : undefined;
    const channelName = payload.channel_name;

    // team_chat format: message is a string directly on object, sender is in event.payload
    const eventPayload = event.payload as Record<string, unknown>;
    const message = isTeamChatEvent ? undefined : payload.message;
    const senderId = isTeamChatEvent
      ? (eventPayload.operator_id ?? eventPayload.operator_member_id ?? eventPayload.operator) as string | undefined
      : (message?.sender ?? message?.sender_member_id);
    const senderName = isTeamChatEvent
      ? (eventPayload.operator as string | undefined)
      : message?.sender_display_name;
    const robotJidInPayload = isTeamChatEvent ? undefined : (message?.robot_jid ?? payload.robot_jid);
    const messageText = isTeamChatEvent
      ? String((payload as Record<string, unknown>).message ?? "")
      : (message?.message ?? "");
    const messageId = isTeamChatEvent
      ? (payload as Record<string, unknown>).message_id as string | undefined
      : message?.id;

    if (!channelJid || !senderId || !messageText) {
      log.debug("channel message missing required fields", {
        hasChannel: Boolean(channelJid),
        hasSender: Boolean(senderId),
        hasMessage: Boolean(messageText),
      });
      return;
    }

    log.debug("processing channel message", {
      channelJid,
      channelName,
      senderId,
      textLength: messageText.length,
    });

    // Handle observe mode slash commands (before group policy — commands always work)
    const channelCmd = parseObserveCommand(messageText);
    if (channelCmd === "observe") {
      const result = await toggleObserveChannel(channelJid, channelName);
      const { sendZoomTextMessage } = await import("./send.js");
      await sendZoomTextMessage({
        cfg,
        to: channelJid,
        text: result.enabled
          ? `Observe mode **enabled** for this channel. I'll silently watch for questions and route proposed answers through the review channel for approval.`
          : `Observe mode **disabled** for this channel. Returning to normal behavior.`,
        isChannel: true,
      });
      return;
    }

    if (channelCmd === "set-review-channel") {
      await setReviewChannel(channelJid, channelName);
      const { sendZoomTextMessage } = await import("./send.js");
      await sendZoomTextMessage({
        cfg,
        to: channelJid,
        text: `This channel is now set as the **review channel**. Proposed answers from observed channels will appear here with Approve/Reject buttons.`,
        isChannel: true,
      });
      return;
    }

    // Resolve per-channel config and check observe mode before group policy
    // (observe mode allows all senders — it watches the whole channel)
    const routeConfig = resolveZoomRouteConfig({ cfg: zoomCfg, channelJid, channelName });
    const { channelConfig } = routeConfig;

    // Check observe mode — static config first, then dynamic config
    const staticObservePolicy = resolveZoomObservePolicy({ channelConfig });
    const dynamicObservePolicy = await getDynamicObservePolicy(channelJid);
    const observeMode = staticObservePolicy.observeMode || dynamicObservePolicy.observeMode;
    const reviewChannelJid = staticObservePolicy.reviewChannelJid ?? dynamicObservePolicy.reviewChannelJid;

    if (observeMode && reviewChannelJid) {
      // Store conversation reference
      await conversationStore.upsert(channelJid, {
        channelJid,
        channelName,
        robotJid: creds.botJid,
        accountId: creds.accountId,
        conversationType: "channel",
        lastMessageId: messageId,
      });

      await routeToAgentWithObserve({
        conversationId: channelJid,
        senderId,
        senderName,
        text: messageText.trim(),
        channelJid,
        channelName,
        reviewChannelJid,
      });
      return;
    }

    // Check group policy (only for non-observed channels)
    const groupPolicy: GroupPolicy = zoomCfg?.groupPolicy ?? "allowlist";
    const groupAllowFrom = zoomCfg?.groupAllowFrom ?? [];

    if (!isZoomGroupAllowed({
      groupPolicy,
      allowFrom: groupAllowFrom,
      senderId,
      senderName,
    })) {
      log.debug("sender not allowed in group", { senderId, senderName, groupPolicy });
      return;
    }

    // Check mention requirement
    const replyPolicy = resolveZoomReplyPolicy({
      isDirectMessage: false,
      globalConfig: zoomCfg,
      channelConfig,
    });

    const { mentioned, cleanText } = extractBotMention({
      text: messageText,
      botJid: creds.botJid,
      robotJidInPayload,
    });

    if (replyPolicy.requireMention && !mentioned) {
      log.debug("message does not mention bot, ignoring", { channelJid });
      return;
    }

    // Store conversation reference
    await conversationStore.upsert(channelJid, {
      channelJid,
      channelName,
      robotJid: creds.botJid,
      accountId: creds.accountId,
      conversationType: "channel",
      lastMessageId: messageId,
    });

    // Route to OpenClaw agent
    await routeToAgent({
      conversationId: channelJid,
      senderId,
      senderName,
      text: cleanText,
      isDirect: false,
      channelJid,
      channelName,
      replyToMessageId: messageId,
    });
  }

  async function routeToAgent(params: {
    conversationId: string;
    senderId: string;
    senderName?: string;
    senderEmail?: string;
    text: string;
    isDirect: boolean;
    channelJid?: string;
    channelName?: string;
    replyToMessageId?: string;
  }) {
    await routeMessageToAgent({ deps, ...params });
  }

  async function routeToAgentWithObserve(params: {
    conversationId: string;
    senderId: string;
    senderName?: string;
    text: string;
    channelJid: string;
    channelName?: string;
    reviewChannelJid: string;
  }) {
    const { conversationId, senderId, senderName, text, channelJid, channelName, reviewChannelJid } = params;

    try {
      log.debug("routing to agent with observe mode", { conversationId, channelJid });

      const route = core.channel.routing.resolveAgentRoute({
        cfg,
        channel: "zoom",
        chatType: "channel",
        from: senderId,
        to: conversationId,
        groupId: channelJid,
      });

      const ctxPayload = core.channel.reply.finalizeInboundContext({
        Body: text,
        RawBody: text,
        CommandBody: text,
        From: `zoom:channel:${channelJid}`,
        To: conversationId,
        SessionKey: route.sessionKey,
        AccountId: route.accountId,
        ChatType: "channel",
        ConversationLabel: senderName ?? senderId,
        SenderName: senderName,
        SenderId: senderId,
        GroupSubject: channelName,
        GroupChannel: channelJid,
        Provider: "zoom" as const,
        Surface: "zoom" as const,
        CommandAuthorized: true,
        CommandSource: "text" as const,
        OriginatingChannel: "zoom" as const,
        OriginatingTo: conversationId,
      });

      // Collect reply text instead of sending it directly
      const collectedParts: string[] = [];

      const { dispatcher, replyOptions, markDispatchIdle } =
        core.channel.reply.createReplyDispatcherWithTyping({
          humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, route.agentId),
          deliver: async (payload) => {
            if (payload.text) {
              collectedParts.push(payload.text);
            }
          },
          onError: (err, info) => {
            const errMsg = err instanceof Error ? err.message : String(err);
            log.error(`zoom observe ${info.kind} reply failed: ${errMsg}`);
          },
        });

      await core.channel.reply.dispatchReplyFromConfig({
        ctx: ctxPayload,
        cfg,
        dispatcher,
        replyOptions,
      });

      markDispatchIdle();

      const fullReply = collectedParts.join("\n").trim();

      // If no reply or agent signals not a question, silently drop
      if (!fullReply || fullReply.includes("[NO_RESPONSE]")) {
        log.debug("observe mode: not a question, dropping silently", { channelJid });
        return;
      }

      // Store pending approval and send review card
      const refId = storePendingApproval({
        originalChannelJid: channelJid,
        originalChannelName: channelName ?? channelJid,
        originalSenderName: senderName ?? senderId,
        originalQuestion: text,
        proposedAnswer: fullReply,
      });

      const { sendZoomActionMessage } = await import("./send.js");
      await sendZoomActionMessage({
        cfg,
        to: reviewChannelJid,
        headText: "Pending Answer Review",
        body: [
          {
            type: "message",
            text: `**Channel:** ${channelName ?? channelJid}\n**From:** ${senderName ?? senderId}\n**Question:** ${text}\n\n**Proposed Answer:**\n${fullReply}`,
          },
          {
            type: "actions",
            items: [
              { text: "Approve", value: `approve_answer:${refId}`, style: "Primary" },
              { text: "Reject", value: `reject_answer:${refId}`, style: "Danger" },
            ],
          },
        ],
        isChannel: true,
      });

      log.info("observe mode: sent approval card to review channel", { refId, reviewChannelJid });
    } catch (err) {
      log.error("failed to route with observe mode", { error: formatUnknownError(err) });
    }
  }
}

/**
 * Route a message to the agent. Extracted so upload-handler can reuse it.
 */
export async function routeMessageToAgent(params: {
  deps: ZoomMessageHandlerDeps;
  conversationId: string;
  senderId: string;
  senderName?: string;
  senderEmail?: string;
  text: string;
  isDirect: boolean;
  channelJid?: string;
  channelName?: string;
}): Promise<void> {
  const { deps, conversationId, senderId, senderName, text, isDirect, channelJid, channelName } = params;
  const { cfg, log } = deps;
  const core = getZoomRuntime();

  try {
    log.debug("routing to agent", {
      conversationId,
      senderId,
      isDirect,
      textLength: text.length,
    });

    const route = core.channel.routing.resolveAgentRoute({
      cfg,
      channel: "zoom",
      chatType: isDirect ? "direct" : "channel",
      from: senderId,
      to: conversationId,
      groupId: channelJid,
    });

    const ctxPayload = core.channel.reply.finalizeInboundContext({
      Body: text,
      RawBody: text,
      CommandBody: text,
      From: isDirect ? `zoom:${senderId}` : `zoom:channel:${channelJid}`,
      To: conversationId,
      SessionKey: route.sessionKey,
      AccountId: route.accountId,
      ChatType: isDirect ? "direct" : "channel",
      ConversationLabel: senderName ?? senderId,
      SenderName: senderName,
      SenderId: senderId,
      GroupSubject: isDirect ? undefined : channelName,
      GroupChannel: isDirect ? undefined : channelJid,
      Provider: "zoom" as const,
      Surface: "zoom" as const,
      CommandAuthorized: true,
      CommandSource: "text" as const,
      OriginatingChannel: "zoom" as const,
      OriginatingTo: conversationId,
    });

    const { dispatcher, replyOptions, markDispatchIdle } =
      core.channel.reply.createReplyDispatcherWithTyping({
        humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, route.agentId),
        deliver: async (payload) => {
          const { sendZoomTextMessage } = await import("./send.js");
          if (payload.text) {
            await sendZoomTextMessage({
              cfg,
              to: conversationId,
              text: payload.text,
              isChannel: !isDirect,
            });
          }
        },
        onError: (err, info) => {
          const errMsg = err instanceof Error ? err.message : String(err);
          log.error(`zoom ${info.kind} reply failed: ${errMsg}`);
        },
      });

    const { queuedFinal, counts } = await core.channel.reply.dispatchReplyFromConfig({
      ctx: ctxPayload,
      cfg,
      dispatcher,
      replyOptions,
    });

    markDispatchIdle();

    if (queuedFinal) {
      const finalCount = counts.final;
      log.info(`delivered ${finalCount} reply${finalCount === 1 ? "" : "ies"} to ${conversationId}`);
    }
  } catch (err) {
    log.error("failed to route to agent", { error: formatUnknownError(err) });
  }
}
