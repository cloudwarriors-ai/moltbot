import type { OpenClawConfig, RuntimeEnv, GroupPolicy } from "openclaw/plugin-sdk";

import { persistApprovedQA, appendCustomerDetail } from "./channel-memory.js";
import type { ZoomConversationStore } from "./conversation-store.js";
import { formatUnknownError } from "./errors.js";
import type { ZoomMonitorLogger } from "./monitor-types.js";
import { getDynamicObservePolicy, enableObserveChannel, toggleObserveChannel, toggleSilentChannel, setReviewChannel } from "./observe-config.js";
import { getBlockedCallSet, getSessionBlockedTools, markToolsApproved, markSessionObserve, clearSessionObserve, formatToolParams } from "./observe-tool-gate.js";
import { getPendingApproval, peekPendingApproval, storePendingApproval } from "./pending-approvals.js";
import { getPendingShare } from "./pending-shares.js";
import { consumeTrainingSession, storeTrainingSession } from "./pending-training.js";
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
function parseObserveCommand(text: string): "observe" | "set-review-channel" | "silent" | null {
  const cleaned = text.replace(/@\S+/g, "").trim().toLowerCase();
  if (cleaned === "/observe" || cleaned === "observe") return "observe";
  if (cleaned === "/set-review-channel" || cleaned === "set-review-channel") return "set-review-channel";
  if (cleaned === "/silent" || cleaned === "silent") return "silent";
  return null;
}

const ADMIN_DOMAIN = process.env.ADMIN_DOMAIN?.toLowerCase().trim();

/** Check if a sender (email or identifier) is from the admin domain. */
function isAdminSender(...identifiers: (string | undefined)[]): boolean {
  if (!ADMIN_DOMAIN) return true; // no domain configured = no restriction
  return identifiers.some((id) => id?.toLowerCase().includes(`@${ADMIN_DOMAIN}`));
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

    // Handle bot added to a channel — auto-enable observe mode
    if (eventType === "team_chat.app_conversation_opened" || eventType === "team_chat.app_invited") {
      await handleAppConversationOpened(event);
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

      // Handle observe mode slash commands (admin-only)
      const botNotifCmd = parseObserveCommand(messageText);
      if (botNotifCmd && !isAdminSender(userName, userEmail, userJid)) {
        const { sendZoomTextMessage } = await import("./send.js");
        await sendZoomTextMessage({ cfg, to: toJid ?? userJid, text: "Sorry, this command is restricted to admins.", isChannel: isChannelMessage });
        return;
      }
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

      if (botNotifCmd === "silent") {
        const result = await toggleSilentChannel(toJid);
        const { sendZoomTextMessage } = await import("./send.js");
        if (!result.found) {
          await sendZoomTextMessage({
            cfg,
            to: toJid,
            text: `This channel is not in observe mode. Enable observe mode first with \`/observe\`.`,
            isChannel: true,
          });
        } else {
          await sendZoomTextMessage({
            cfg,
            to: toJid,
            text: result.silent
              ? `Silent mode **enabled**. I'll observe and process questions, but won't post any messages to this channel. Approval cards still go to the review channel.`
              : `Silent mode **disabled**. I'll now respond directly in this channel after approval.`,
            isChannel: true,
          });
        }
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
      // Check training session FIRST — training feedback bypasses DM allowlist
      // (the user already proved authorization by clicking Train in the review channel)
      const training = consumeTrainingSession(userJid);
      if (training) {
        await handleTrainingFeedback({ userJid, userName, feedback: messageText, training });
        return;
      }

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
    const reviewChannelJid = payload.toJid; // channel where the button was clicked (review channel)
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

      // Immediate feedback in review channel
      if (reviewChannelJid) {
        await sendZoomTextMessage({
          cfg,
          to: reviewChannelJid,
          text: `Approved — posting answer to ${pending.originalChannelName} now.`,
          isChannel: true,
        });
      }

      // Post the approved answer to the original channel (skip in silent mode)
      if (!pending.silent) {
        const firstName = pending.originalSenderName.split(/[@\s.]/)[0];
        const displayName = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
        await sendZoomTextMessage({
          cfg,
          to: pending.originalChannelJid,
          text: `@${displayName} ${pending.proposedAnswer}`,
          isChannel: true,
        });
      }

      // Persist Q&A + customer context to channel memory
      try {
        await persistApprovedQA({
          channelName: pending.originalChannelName,
          channelJid: pending.originalChannelJid,
          senderName: pending.originalSenderName,
          question: pending.originalQuestion,
          answer: pending.proposedAnswer,
        });
        // Extract customer environment details and add to profile
        const details = extractCustomerDetails(pending.originalQuestion, pending.proposedAnswer);
        for (const detail of details) {
          await appendCustomerDetail({
            channelName: pending.originalChannelName,
            channelJid: pending.originalChannelJid,
            detail,
          });
        }
      } catch (err) {
        log.error("failed to persist approved Q&A to memory", { err });
      }

      // Confirm to reviewer via DM
      const postedNote = pending.silent ? " (silent mode — not posted to channel)" : "";
      await sendZoomTextMessage({
        cfg,
        to: userJid,
        text: `Answer approved${postedNote}. Saved to ${pending.originalChannelName} training.`,
        isChannel: false,
      });
      return;
    }

    // Handle approve tool from observe mode — re-run agent with all blocked tools whitelisted
    if (value.startsWith("approve_tool:")) {
      const refId = value.slice("approve_tool:".length);
      const blockedSet = getBlockedCallSet(refId);
      const { sendZoomTextMessage } = await import("./send.js");
      if (!blockedSet) {
        log.debug("blocked tool set not found or expired", { refId });
        await sendZoomTextMessage({
          cfg,
          to: userJid,
          text: "This tool approval has expired. The original request will need to be submitted again.",
          isChannel: false,
        });
        return;
      }

      const toolNames = blockedSet.tools.map((t) => t.toolName);

      // Immediate feedback in review channel
      if (reviewChannelJid) {
        await sendZoomTextMessage({
          cfg,
          to: reviewChannelJid,
          text: `Approved — executing ${toolNames.join(", ")} for ${blockedSet.channelName} now...`,
          isChannel: true,
        });
      }

      try {
        const core = getZoomRuntime();
        const route = core.channel.routing.resolveAgentRoute({
          cfg,
          channel: "zoom",
          chatType: "channel",
          from: blockedSet.senderName,
          to: blockedSet.channelJid,
          groupId: blockedSet.channelJid,
        });

        // Pre-approve ALL tools so the hook lets them through
        markToolsApproved(route.sessionKey, toolNames);

        // Register as observe mode again (for the re-dispatch)
        markSessionObserve(route.sessionKey, {
          channelJid: blockedSet.channelJid,
          channelName: blockedSet.channelName,
          reviewChannelJid: blockedSet.reviewChannelJid,
          senderName: blockedSet.senderName,
          senderJid: blockedSet.senderJid,
          question: blockedSet.question,
        });

        const toolDescriptions = blockedSet.tools.map((t) => {
          const paramStr = formatToolParams(t.params);
          return `- ${t.toolName}${paramStr ? `: ${paramStr}` : ""}`;
        });

        const execBody = [
          "[APPROVED ACTION — EXECUTE NOW]",
          `A reviewer approved the following action. Execute it immediately.`,
          "",
          `Original request from ${blockedSet.senderName}: ${blockedSet.question}`,
          "",
          `Approved tools:`,
          ...toolDescriptions,
          "",
          "Execute the request using these tools. After execution, report the result concisely (2-3 sentences).",
          "Include the key data that changed (e.g., new totals, updated counts, confirmation IDs).",
        ].join("\n");

        const ctxPayload = core.channel.reply.finalizeInboundContext({
          Body: execBody,
          RawBody: blockedSet.question,
          CommandBody: execBody,
          From: `zoom:channel:${blockedSet.channelJid}`,
          To: blockedSet.channelJid,
          SessionKey: route.sessionKey,
          AccountId: route.accountId,
          ChatType: "channel",
          ConversationLabel: blockedSet.senderName,
          SenderName: blockedSet.senderName,
          SenderId: blockedSet.senderName,
          GroupSubject: blockedSet.channelName,
          GroupChannel: blockedSet.channelJid,
          Provider: "zoom" as const,
          Surface: "zoom" as const,
          CommandAuthorized: true,
          CommandSource: "text" as const,
          OriginatingChannel: "zoom" as const,
          OriginatingTo: blockedSet.channelJid,
        });

        const collectedParts: string[] = [];
        const { dispatcher, replyOptions, markDispatchIdle } =
          core.channel.reply.createReplyDispatcherWithTyping({
            humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, route.agentId),
            deliver: async (payload) => {
              if (payload.text) collectedParts.push(payload.text);
            },
            onError: (err, info) => {
              const errMsg = err instanceof Error ? err.message : String(err);
              log.error(`zoom tool execute ${info.kind} reply failed: ${errMsg}`);
            },
          });

        await core.channel.reply.dispatchReplyFromConfig({
          ctx: ctxPayload,
          cfg,
          dispatcher,
          replyOptions,
        });

        markDispatchIdle();
        clearSessionObserve(route.sessionKey);

        const execResult = collectedParts.join("\n").trim();

        if (execResult && !execResult.includes("[NO_RESPONSE]")) {
          if (!blockedSet.silent) {
            const toolFirstName = blockedSet.senderName.split(/[@\s.]/)[0];
            const toolDisplayName = toolFirstName.charAt(0).toUpperCase() + toolFirstName.slice(1).toLowerCase();
            await sendZoomTextMessage({
              cfg,
              to: blockedSet.channelJid,
              text: `@${toolDisplayName} ${execResult}`,
              isChannel: true,
            });
          }

          try {
            await persistApprovedQA({
              channelName: blockedSet.channelName,
              channelJid: blockedSet.channelJid,
              senderName: blockedSet.senderName,
              question: blockedSet.question,
              answer: execResult,
            });
          } catch (err) {
            log.error("failed to persist tool action Q&A to memory", { err });
          }

          const toolPostedNote = blockedSet.silent ? " (silent — not posted)" : "";
          await sendZoomTextMessage({
            cfg,
            to: userJid,
            text: `Action executed${toolPostedNote}. Result saved to ${blockedSet.channelName} training.`,
            isChannel: false,
          });
        } else {
          await sendZoomTextMessage({
            cfg,
            to: userJid,
            text: `Action executed but no result returned. Check ${blockedSet.channelName} for status.`,
            isChannel: false,
          });
        }
      } catch (err) {
        log.error("failed to execute approved tools", { error: formatUnknownError(err) });
        await sendZoomTextMessage({
          cfg,
          to: userJid,
          text: `Tool execution failed: ${formatUnknownError(err)}`,
          isChannel: false,
        });
      }
      return;
    }

    // Handle reject tool from observe mode
    if (value.startsWith("reject_tool:")) {
      const refId = value.slice("reject_tool:".length);
      const blockedSet = getBlockedCallSet(refId);
      const { sendZoomTextMessage } = await import("./send.js");
      if (!blockedSet) {
        await sendZoomTextMessage({
          cfg,
          to: userJid,
          text: "This tool approval has already expired or been handled.",
          isChannel: false,
        });
        return;
      }

      const toolNames = blockedSet.tools.map((t) => t.toolName).join(", ");
      await sendZoomTextMessage({
        cfg,
        to: userJid,
        text: `Action rejected (${toolNames}).`,
        isChannel: false,
      });
      return;
    }

    // Handle approve action from observe mode — execute the proposed write/mutation
    if (value.startsWith("approve_action:")) {
      const refId = value.slice("approve_action:".length);
      const pending = getPendingApproval(refId);
      const { sendZoomTextMessage } = await import("./send.js");
      if (!pending) {
        log.debug("pending action approval not found or expired", { refId });
        await sendZoomTextMessage({
          cfg,
          to: userJid,
          text: "This action approval has expired. The original request will need to be submitted again.",
          isChannel: false,
        });
        return;
      }

      // Immediate feedback in review channel
      if (reviewChannelJid) {
        await sendZoomTextMessage({
          cfg,
          to: reviewChannelJid,
          text: `Approved — executing action for ${pending.originalChannelName} now...`,
          isChannel: true,
        });
      }

      await sendZoomTextMessage({
        cfg,
        to: userJid,
        text: `Executing approved action for ${pending.originalChannelName}...`,
        isChannel: false,
      });

      try {
        const core = getZoomRuntime();

        // Resolve agent route for the original channel
        const route = core.channel.routing.resolveAgentRoute({
          cfg,
          channel: "zoom",
          chatType: "channel",
          from: pending.originalSenderName,
          to: pending.originalChannelJid,
          groupId: pending.originalChannelJid,
        });

        // Build execution prompt — agent now has full tool access
        const execBody = [
          "[APPROVED ACTION — EXECUTE NOW]",
          `The following action was approved by a reviewer. Execute it immediately using the appropriate tools.`,
          "",
          `Original request from ${pending.originalSenderName}: ${pending.originalQuestion}`,
          "",
          `Approved action: ${pending.proposedAnswer}`,
          "",
          "Execute the action now. After execution, report the result concisely (2-3 sentences).",
          "Include the key data that changed (e.g., new totals, updated counts, confirmation IDs).",
          "Do NOT use [PROPOSED_ACTION] — execute directly.",
        ].join("\n");

        const ctxPayload = core.channel.reply.finalizeInboundContext({
          Body: execBody,
          RawBody: pending.originalQuestion,
          CommandBody: execBody,
          From: `zoom:channel:${pending.originalChannelJid}`,
          To: pending.originalChannelJid,
          SessionKey: route.sessionKey,
          AccountId: route.accountId,
          ChatType: "channel",
          ConversationLabel: pending.originalSenderName,
          SenderName: pending.originalSenderName,
          SenderId: pending.originalSenderName,
          GroupSubject: pending.originalChannelName,
          GroupChannel: pending.originalChannelJid,
          Provider: "zoom" as const,
          Surface: "zoom" as const,
          CommandAuthorized: true,
          CommandSource: "text" as const,
          OriginatingChannel: "zoom" as const,
          OriginatingTo: pending.originalChannelJid,
        });

        // Collect the execution result
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
              log.error(`zoom action execute ${info.kind} reply failed: ${errMsg}`);
            },
          });

        await core.channel.reply.dispatchReplyFromConfig({
          ctx: ctxPayload,
          cfg,
          dispatcher,
          replyOptions,
        });

        markDispatchIdle();

        const execResult = collectedParts.join("\n").trim();

        if (execResult && !execResult.includes("[NO_RESPONSE]")) {
          // Post the execution result to the original channel (skip in silent mode)
          if (!pending.silent) {
            const actionFirstName = pending.originalSenderName.split(/[@\s.]/)[0];
            const actionDisplayName = actionFirstName.charAt(0).toUpperCase() + actionFirstName.slice(1).toLowerCase();
            await sendZoomTextMessage({
              cfg,
              to: pending.originalChannelJid,
              text: `@${actionDisplayName} ${execResult}`,
              isChannel: true,
            });
          }

          // Persist the Q&A for training
          try {
            await persistApprovedQA({
              channelName: pending.originalChannelName,
              channelJid: pending.originalChannelJid,
              senderName: pending.originalSenderName,
              question: pending.originalQuestion,
              answer: execResult,
            });
          } catch (err) {
            log.error("failed to persist action Q&A to memory", { err });
          }

          // Confirm to reviewer
          const actionPostedNote = pending.silent ? " (silent — not posted)" : "";
          await sendZoomTextMessage({
            cfg,
            to: userJid,
            text: `Action executed${actionPostedNote}. Result saved to ${pending.originalChannelName} training.`,
            isChannel: false,
          });
        } else {
          await sendZoomTextMessage({
            cfg,
            to: userJid,
            text: `Action executed but no result was returned. Check ${pending.originalChannelName} for status.`,
            isChannel: false,
          });
        }
      } catch (err) {
        log.error("failed to execute approved action", { error: formatUnknownError(err) });
        await sendZoomTextMessage({
          cfg,
          to: userJid,
          text: `Action execution failed: ${formatUnknownError(err)}`,
          isChannel: false,
        });
      }
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

    // Handle train answer from observe mode — ask reviewer for feedback
    if (value.startsWith("train_answer:")) {
      const refId = value.slice("train_answer:".length);
      const pending = peekPendingApproval(refId);
      const { sendZoomTextMessage } = await import("./send.js");
      if (!pending) {
        log.debug("pending approval not found or expired for training", { refId });
        await sendZoomTextMessage({
          cfg,
          to: userJid,
          text: "This approval has expired. The original question will need to be asked again.",
          isChannel: false,
        });
        return;
      }

      // Look up the review channel for this observed channel
      const routeConfig = resolveZoomRouteConfig({ cfg: zoomCfg, channelJid: pending.originalChannelJid, channelName: pending.originalChannelName });
      const staticObserve = resolveZoomObservePolicy({ channelConfig: routeConfig.channelConfig });
      const dynamicObserve = await getDynamicObservePolicy(pending.originalChannelJid);
      const reviewChannelJid = staticObserve.reviewChannelJid ?? dynamicObserve.reviewChannelJid ?? "";

      storeTrainingSession(userJid, {
        approvalRefId: refId,
        originalChannelJid: pending.originalChannelJid,
        originalChannelName: pending.originalChannelName,
        originalSenderName: pending.originalSenderName,
        originalQuestion: pending.originalQuestion,
        previousAnswer: pending.proposedAnswer,
        reviewChannelJid,
      });

      await sendZoomTextMessage({
        cfg,
        to: userJid,
        text: `**Training mode** — What should change about this answer?\n\n**Question:** ${pending.originalQuestion}\n**Current answer:** ${pending.proposedAnswer}\n\nReply with your feedback and I'll regenerate the answer.`,
        isChannel: false,
      });
      log.info("training session started", { refId, userJid });
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
      ? ((eventPayload.operator_id as string) || (eventPayload.operator_member_id as string) || (eventPayload.operator as string) || undefined)
      : (message?.sender ?? message?.sender_member_id);
    const senderName = isTeamChatEvent
      ? ((eventPayload.operator as string) || undefined)
      : message?.sender_display_name;
    const robotJidInPayload = isTeamChatEvent ? undefined : (message?.robot_jid ?? payload.robot_jid);
    const messageText = isTeamChatEvent
      ? String((payload as Record<string, unknown>).message ?? "")
      : (message?.message ?? "");
    const messageId = isTeamChatEvent
      ? (payload as Record<string, unknown>).message_id as string | undefined
      : message?.id;
    const replyMainMessageId = isTeamChatEvent
      ? (payload as Record<string, unknown>).reply_main_message_id as string | undefined
      : message?.reply_main_message_id;

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

    // Handle observe mode slash commands (admin-only, before group policy)
    const channelCmd = parseObserveCommand(messageText);
    if (channelCmd && !isAdminSender(senderName, senderId)) {
      const { sendZoomTextMessage } = await import("./send.js");
      await sendZoomTextMessage({ cfg, to: channelJid, text: "Sorry, this command is restricted to admins.", isChannel: true });
      return;
    }
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

    if (channelCmd === "silent") {
      const result = await toggleSilentChannel(channelJid);
      const { sendZoomTextMessage } = await import("./send.js");
      if (!result.found) {
        await sendZoomTextMessage({
          cfg,
          to: channelJid,
          text: `This channel is not in observe mode. Enable observe mode first with \`/observe\`.`,
          isChannel: true,
        });
      } else {
        await sendZoomTextMessage({
          cfg,
          to: channelJid,
          text: result.silent
            ? `Silent mode **enabled**. I'll observe and process questions, but won't post any messages to this channel. Approval cards still go to the review channel.`
            : `Silent mode **disabled**. I'll now respond directly in this channel after approval.`,
          isChannel: true,
        });
      }
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
    const observeSilent = dynamicObservePolicy.silent === true;

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
        isThreadReply: Boolean(replyMainMessageId),
        silent: observeSilent,
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

  async function handleAppConversationOpened(event: ZoomWebhookEvent) {
    const payload = event.payload?.object ?? event.payload;
    log.info(`app_invited/conversation_opened payload: ${JSON.stringify(event.payload)}`);

    if (!payload) return;

    const p = payload as Record<string, unknown>;
    // Extract channel info — try multiple field names across event types
    const rawChannelId = p.channel_id ?? p.toJid ?? p.to_jid;
    const channelName = (p.channel_name ?? p.name) as string | undefined;

    if (!rawChannelId) {
      log.debug("app_conversation_opened: no channel_id in payload, skipping");
      return;
    }

    const channelJid = String(rawChannelId).includes("@")
      ? String(rawChannelId)
      : `${rawChannelId}@conference.xmpp.zoom.us`;

    // Only enable observe mode for group channels, NOT DMs.
    // Channel JIDs: ...@conference.xmpp.zoom.us  |  DM JIDs: ...@xmpp.zoom.us
    if (!channelJid.includes("@conference.")) {
      log.debug(`app_conversation_opened: skipping DM JID ${channelJid} (not a channel)`);
      return;
    }

    // Auto-enable observe mode for this channel
    await enableObserveChannel(channelJid, channelName);
    log.info(`auto-enabled observe mode for channel: ${channelName ?? channelJid}`);

    // Fire-and-forget: pull history and build training prompt
    const { fetchAndTrainFromHistory } = await import("./history.js");
    fetchAndTrainFromHistory(channelJid, channelName, creds, log).catch((err) =>
      log.error(`history ingest failed for ${channelName ?? channelJid}: ${err}`),
    );
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
    // For DMs, add context prefix so the agent knows this is NOT a customer support conversation
    if (params.isDirect) {
      params.text = [
        "[ADMIN DM] This is a direct message from an authorized team member, NOT a customer support conversation.",
        "Do NOT use memory_search for customer training data. Respond as a general-purpose assistant.",
        `Message: ${params.text}`,
      ].join("\n");
    }
    await routeMessageToAgent({ deps, ...params });
  }

  async function handleTrainingFeedback(params: {
    userJid: string;
    userName?: string;
    feedback: string;
    training: import("./pending-training.js").TrainingSession;
  }) {
    const { userJid, feedback, training } = params;
    const { sendZoomTextMessage } = await import("./send.js");

    try {
      log.info("processing training feedback", { userJid, approvalRefId: training.approvalRefId });

      await sendZoomTextMessage({
        cfg,
        to: userJid,
        text: "Got it — regenerating the answer with your feedback...",
        isChannel: false,
      });

      // Build a prompt that includes the original question, previous answer, and reviewer feedback
      const trainingPrompt = [
        "[CHANNEL OBSERVE — TRAINING] A reviewer wants you to improve your previous answer.",
        "",
        `**Original question:** ${training.originalQuestion}`,
        `**Your previous answer:** ${training.previousAnswer}`,
        `**Reviewer's correction:** ${feedback}`,
        "",
        "IMPORTANT: The reviewer's correction IS the correct answer. Use their exact wording as-is.",
        "Only adjust for grammar or add minor formatting. Do NOT rewrite, add disclaimers, or change the meaning.",
        "Keep it to 1-3 sentences, conversational tone, no markdown formatting.",
      ].join("\n");

      const route = core.channel.routing.resolveAgentRoute({
        cfg,
        channel: "zoom",
        chatType: "channel",
        from: training.originalSenderName,
        to: training.originalChannelJid,
        groupId: training.originalChannelJid,
      });

      const ctxPayload = core.channel.reply.finalizeInboundContext({
        Body: trainingPrompt,
        RawBody: feedback,
        CommandBody: trainingPrompt,
        From: `zoom:channel:${training.originalChannelJid}`,
        To: training.originalChannelJid,
        SessionKey: route.sessionKey,
        AccountId: route.accountId,
        ChatType: "channel",
        ConversationLabel: training.originalSenderName,
        SenderName: training.originalSenderName,
        SenderId: training.originalSenderName,
        GroupSubject: training.originalChannelName,
        GroupChannel: training.originalChannelJid,
        Provider: "zoom" as const,
        Surface: "zoom" as const,
        CommandAuthorized: true,
        CommandSource: "text" as const,
        OriginatingChannel: "zoom" as const,
        OriginatingTo: training.originalChannelJid,
      });

      const collectedParts: string[] = [];
      const { dispatcher, replyOptions, markDispatchIdle } =
        core.channel.reply.createReplyDispatcherWithTyping({
          humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, route.agentId),
          deliver: async (payload) => {
            if (payload.text) collectedParts.push(payload.text);
          },
          onError: (err, info) => {
            const errMsg = err instanceof Error ? err.message : String(err);
            log.error(`zoom training ${info.kind} reply failed: ${errMsg}`);
          },
        });

      await core.channel.reply.dispatchReplyFromConfig({
        ctx: ctxPayload,
        cfg,
        dispatcher,
        replyOptions,
      });

      markDispatchIdle();

      const newAnswer = collectedParts.join("\n").trim();
      if (!newAnswer) {
        await sendZoomTextMessage({
          cfg,
          to: userJid,
          text: "Could not generate a new answer. Please try again or reject the original.",
          isChannel: false,
        });
        return;
      }

      // Store new pending approval and send updated review card
      const newRefId = storePendingApproval({
        originalChannelJid: training.originalChannelJid,
        originalChannelName: training.originalChannelName,
        originalSenderName: training.originalSenderName,
        originalQuestion: training.originalQuestion,
        proposedAnswer: newAnswer,
      });

      const { sendZoomActionMessage } = await import("./send.js");
      await sendZoomActionMessage({
        cfg,
        to: training.reviewChannelJid,
        headText: "Revised Answer Review",
        body: [
          {
            type: "message",
            text: `**Channel:** ${training.originalChannelName}\n**From:** ${training.originalSenderName}\n**Question:** ${training.originalQuestion}\n\n**Previous Answer:**\n${training.previousAnswer}\n\n**Feedback:** ${feedback}\n\n**Revised Answer:**\n${newAnswer}`,
          },
          {
            type: "actions",
            items: [
              { text: "Approve", value: `approve_answer:${newRefId}`, style: "Primary" },
              { text: "Train", value: `train_answer:${newRefId}`, style: "Default" },
              { text: "Reject", value: `reject_answer:${newRefId}`, style: "Danger" },
            ],
          },
        ],
        isChannel: true,
      });

      await sendZoomTextMessage({
        cfg,
        to: userJid,
        text: "Revised answer sent to review channel for approval.",
        isChannel: false,
      });

      log.info("training feedback processed, new review card sent", { newRefId, reviewChannelJid: training.reviewChannelJid });
    } catch (err) {
      log.error("failed to process training feedback", { error: formatUnknownError(err) });
      await sendZoomTextMessage({
        cfg,
        to: userJid,
        text: "Something went wrong while regenerating the answer. Please try again.",
        isChannel: false,
      }).catch(() => {});
    }
  }

  async function routeToAgentWithObserve(params: {
    conversationId: string;
    senderId: string;
    senderName?: string;
    text: string;
    channelJid: string;
    channelName?: string;
    reviewChannelJid: string;
    isThreadReply?: boolean;
    silent?: boolean;
  }) {
    const { conversationId, senderId, senderName, text, channelJid, channelName, reviewChannelJid, isThreadReply, silent } = params;

    try {
      log.debug("routing to agent with observe mode", { conversationId, channelJid, isThreadReply, silent });

      // Immediate ack — skip in silent mode (no messages to observed channel)
      if (!silent) {
        const { sendZoomTextMessage } = await import("./send.js");
        const displayName = senderName?.split("@")[0]?.split(" ")[0] ?? "there";
        await sendZoomTextMessage({
          cfg,
          to: channelJid,
          text: `Hey ${displayName}, I'm working on that for you. My response will need to be reviewed first, so hang tight!`,
          isChannel: true,
        }).catch((err) => log.warn("observe ack failed", { err: String(err) }));
      }

      const route = core.channel.routing.resolveAgentRoute({
        cfg,
        channel: "zoom",
        chatType: "channel",
        from: senderId,
        to: conversationId,
        groupId: channelJid,
      });

      // Register this session as observe-mode so the tool gate hook can block writes
      markSessionObserve(route.sessionKey, {
        channelJid,
        channelName: channelName ?? channelJid,
        reviewChannelJid,
        senderName: senderName ?? senderId,
        senderJid: senderId,
        question: text,
        silent,
      });

      // Channel context hint for memory_search — tells agent which customer dir to search
      const customerSlug = (channelName ?? channelJid.split("@")[0])
        .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const memoryHint = `IMPORTANT: BEFORE answering, call memory_search with the user's question to find trained answers and customer context in memory/customers/${customerSlug}/. Trained answers from reviewers are highest priority — use them over your own knowledge.`;

      // Thread replies are follow-ups to the bot's clarifying question — don't filter them.
      // New top-level messages get the observe wrapper to triage questions vs casual chat.
      const body = isThreadReply
        ? [
            "[CHANNEL OBSERVE — FOLLOW-UP] The user replied to your clarifying question.",
            memoryHint,
            "Also call the relevant ZW2 tools to fetch fresh data when the question involves orders, pricing, or SOW.",
            "If a write tool is blocked, do NOT retry it and do NOT mention 'pending approval' in your response. Just respond with [NO_RESPONSE].",
            "Give a short, direct answer with the actual data. No filler, no preamble like 'let me look that up'. Just the facts in 2-4 sentences, conversational tone.",
            `User reply: ${text}`,
          ].join("\n")
        : [
            "[CHANNEL OBSERVE MODE] A user posted a message in a channel you are monitoring.",
            memoryHint,
            "Also call the relevant ZW2 tools to fetch fresh data when the question involves orders, pricing, or SOW.",
            "If a write tool is blocked, do NOT retry it and do NOT mention 'pending approval' in your response. Just respond with [NO_RESPONSE].",
            "Give the actual data in your response. No filler, no preamble like 'let me look that up' or 'I have data from earlier'. Just the facts.",
            "If the message shares factual details about the customer's environment (user count, platform, features, licensing, setup, infrastructure, etc.), respond with [CUSTOMER_CONTEXT] followed by each fact on its own line. Example:",
            "  [CUSTOMER_CONTEXT]",
            "  500 users",
            "  Using Microsoft Teams currently",
            "If this is NOT a question AND NOT customer context (casual chat, greeting, acknowledgment, small talk), respond with exactly [NO_RESPONSE] and nothing else.",
            "If it IS a new question with no matching memory_search results, respond with ONE short clarifying question (1 sentence) to narrow down what they need.",
            `User message: ${text}`,
          ].join("\n");

      const ctxPayload = core.channel.reply.finalizeInboundContext({
        Body: body,
        RawBody: text,
        CommandBody: body,
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

      // Check if any write tools were blocked during this dispatch
      const blockedTools = getSessionBlockedTools(route.sessionKey);
      clearSessionObserve(route.sessionKey);

      // If tools were blocked, send ONE consolidated approval card (not per-tool)
      if (blockedTools) {
        const toolLines = blockedTools.tools.map((t) => {
          const paramStr = formatToolParams(t.params);
          return `• \`${t.toolName}\`${paramStr ? ` — ${paramStr}` : ""}`;
        });

        const { sendZoomActionMessage } = await import("./send.js");
        await sendZoomActionMessage({
          cfg,
          to: reviewChannelJid,
          headText: "Action Approval Required",
          body: [
            {
              type: "message",
              text: [
                `**Channel:** ${channelName ?? channelJid}`,
                `**From:** ${senderName ?? senderId}`,
                `**Request:** ${text}`,
                "",
                `**Tools to execute:**`,
                ...toolLines,
              ].join("\n"),
            },
            {
              type: "actions",
              items: [
                { text: "Approve & Execute", value: `approve_tool:${blockedTools.refId}`, style: "Primary" },
                { text: "Reject", value: `reject_tool:${blockedTools.refId}`, style: "Danger" },
              ],
            },
          ],
          isChannel: true,
        });

        log.info("observe mode: sent consolidated tool approval card", { refId: blockedTools.refId, toolCount: blockedTools.tools.length });
        return;
      }

      const fullReply = collectedParts.join("\n").trim();

      // If no reply or agent signals not a question, silently drop
      if (!fullReply || fullReply.includes("[NO_RESPONSE]")) {
        log.debug("observe mode: not a question, dropping silently", { channelJid });
        return;
      }

      // If the agent detected customer context/environment details, persist them
      if (fullReply.includes("[CUSTOMER_CONTEXT]")) {
        const lines = fullReply
          .split("[CUSTOMER_CONTEXT]")[1]
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length > 0);

        const persisted: string[] = [];
        for (const detail of lines) {
          try {
            await appendCustomerDetail({
              channelName,
              channelJid,
              detail,
            });
            persisted.push(detail);
          } catch (err) {
            log.error("failed to persist customer detail", { err, detail });
          }
        }

        if (persisted.length > 0) {
          const { sendZoomTextMessage } = await import("./send.js");
          await sendZoomTextMessage({
            cfg,
            to: reviewChannelJid,
            text: `**Customer Context Captured** — ${channelName ?? channelJid}\nFrom: ${senderName ?? senderId}\n\n${persisted.map((d) => `• ${d}`).join("\n")}`,
            isChannel: true,
          });
          log.info("observe mode: persisted customer context", { channelJid, count: persisted.length });
        }
        return;
      }

      // Strip any stale tags the agent might emit
      const cleanReply = fullReply
        .replace(/\[TOOLS_USED\]\s*.*/i, "")
        .replace(/\[PROPOSED_ACTION\][\s\S]*/i, "")
        .trim();
      if (!cleanReply) return;

      // Store pending approval and send review card (text-only responses)
      const refId = storePendingApproval({
        originalChannelJid: channelJid,
        originalChannelName: channelName ?? channelJid,
        originalSenderName: senderName ?? senderId,
        originalSenderJid: senderId,
        originalQuestion: text,
        proposedAnswer: cleanReply,
        silent,
      });

      const { sendZoomActionMessage } = await import("./send.js");
      await sendZoomActionMessage({
        cfg,
        to: reviewChannelJid,
        headText: "Pending Answer Review",
        body: [
          {
            type: "message",
            text: `**Channel:** ${channelName ?? channelJid}\n**From:** ${senderName ?? senderId}\n**Question:** ${text}\n\n**Proposed Answer:**\n${cleanReply}`,
          },
          {
            type: "actions",
            items: [
              { text: "Approve", value: `approve_answer:${refId}`, style: "Primary" },
              { text: "Train", value: `train_answer:${refId}`, style: "Default" },
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

/**
 * Extract customer environment details from Q&A text.
 * Returns short factual statements suitable for a customer profile.
 */
function extractCustomerDetails(question: string, answer: string): string[] {
  const combined = `${question} ${answer}`;
  const details: string[] = [];

  // Platform / competitor mentions
  const platformMatch = combined.match(/(?:using|running|on|from|migrating from|switching from)\s+(Microsoft Teams|Cisco|RingCentral|8x8|Avaya|Vonage|Mitel|Genesys|Five9|Dialpad)/i);
  if (platformMatch) details.push(`Current/previous platform: ${platformMatch[1]}`);

  // User count
  const userCountMatch = combined.match(/(\d[\d,]*)\s*(?:users?|seats?|employees?|extensions?|agents?|lines?)/i);
  if (userCountMatch) details.push(`Approximate size: ${userCountMatch[1]} ${userCountMatch[0].replace(userCountMatch[1], "").trim()}`);

  // License type
  const licenseMatch = combined.match(/(?:on|have|using)\s+(?:the\s+)?(Pro|Business|Enterprise|Zoom\s+(?:One|Workplace|Phone)(?:\s+\w+)?)\s+(?:plan|license|tier)/i);
  if (licenseMatch) details.push(`License/plan: ${licenseMatch[1]}`);

  // Key features they care about
  const featurePatterns: [RegExp, string][] = [
    [/executive[- ]?assistant|delegation/i, "Needs executive-assistant delegation"],
    [/call\s*queue|hunt\s*group/i, "Uses call queues / hunt groups"],
    [/auto[- ]?attendant|ivr/i, "Uses auto-attendant / IVR"],
    [/common\s*area\s*phone|lobby\s*phone/i, "Has common area phones"],
    [/contact\s*center|call\s*center/i, "Has contact center needs"],
    [/international|global|multi[- ]?country|multiple\s*countries/i, "Multi-country / international deployment"],
    [/analog|ata\b|fax\s*machine/i, "Has analog/fax devices"],
    [/hot[- ]?desk/i, "Uses hot desking"],
    [/salesforce|hubspot|crm/i, "CRM integration required"],
    [/sso|saml|okta|azure\s*ad/i, "Uses SSO / identity provider"],
    [/recording|compliance/i, "Call recording / compliance needs"],
    [/e911|emergency\s*(?:calling|services)/i, "E911 requirements"],
  ];

  for (const [re, label] of featurePatterns) {
    if (re.test(combined)) details.push(label);
  }

  return details;
}
