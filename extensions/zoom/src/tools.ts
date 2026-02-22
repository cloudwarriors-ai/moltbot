import fs from "node:fs";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

import { storePendingShare } from "./pending-shares.js";
import { PREFILTER_CONFIG_PATH, DEFAULT_SYSTEM_PROMPT, DEFAULT_MODEL, readPrefilterConfig } from "./prefilter.js";
import type { ZoomBodyItem, ZoomConfig } from "./types.js";
import { createUploadToken } from "./upload-tokens.js";
import { resolveZoomUploadDir } from "./upload-path.js";
import { getRememberedZoomSessionReplyRoot } from "./thread-state.js";

function resolveUploadReplyMainMessageId(sessionKey?: string): string | undefined {
  const rememberedReplyRoot = getRememberedZoomSessionReplyRoot(sessionKey);
  if (rememberedReplyRoot) return rememberedReplyRoot;

  const normalized = sessionKey?.trim();
  if (!normalized) return undefined;
  const match = normalized.match(/^agent:[^:]+:zoom:channel:(.+)$/);
  const peerId = match?.[1]?.trim();
  if (!peerId) return undefined;
  // Channel-scope sessions look like "<channel>@conference.xmpp.zoom.us".
  // Thread-scope sessions use the parent message id we can reply under.
  if (peerId.includes("@conference.")) return undefined;
  return peerId;
}

export function registerZoomTools(api: OpenClawPluginApi) {
  // zoom_send_action_card - send interactive message with buttons
  api.registerTool((ctx) => {
    if (ctx.messageChannel !== "zoom") return null;
    return {
      name: "zoom_send_action_card",
      description:
        "Send an interactive Zoom message with action buttons. " +
        "Use this to present choices, confirmations, or links to the user.",
      parameters: Type.Object({
        to: Type.String({ description: "Recipient JID (user or channel)" }),
        heading: Type.Optional(Type.String({ description: "Card heading text" })),
        message: Type.Optional(Type.String({ description: "Body text above the buttons" })),
        buttons: Type.Array(
          Type.Object({
            text: Type.String({ description: "Button label" }),
            value: Type.String({ description: "Value sent back on click" }),
            style: Type.Optional(
              Type.Unsafe<"Primary" | "Danger" | "Default">({
                type: "string",
                enum: ["Primary", "Danger", "Default"],
                description: "Button style (default: Default)",
              }),
            ),
          }),
          { description: "Action buttons to display" },
        ),
        is_channel: Type.Optional(
          Type.Boolean({ description: "Whether the recipient is a channel (default: false)" }),
        ),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const { sendZoomActionMessage } = await import("./send.js");
        const to = params.to as string;
        const heading = (params.heading as string) ?? undefined;
        const message = (params.message as string) ?? undefined;
        const buttons = params.buttons as Array<{
          text: string;
          value: string;
          style?: string;
        }>;
        const isChannel = (params.is_channel as boolean) ?? false;

        const body: ZoomBodyItem[] = [];
        if (message) {
          body.push({ type: "message", text: message });
        }
        body.push({
          type: "actions",
          items: buttons.map((b) => ({
            text: b.text,
            value: b.value,
            style: (b.style as "Primary" | "Danger" | "Default") ?? "Default",
          })),
        });

        const result = await sendZoomActionMessage({
          cfg: api.config,
          to,
          headText: heading,
          body,
          isChannel,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                ok: true,
                messageId: result.messageId,
                to: result.conversationId,
              }),
            },
          ],
        };
      },
    };
  });

  // zoom_send_dm - send a DM to a user
  api.registerTool((ctx) => {
    if (ctx.messageChannel !== "zoom") return null;
    return {
      name: "zoom_send_dm",
      description:
        "Send a direct message to a Zoom user by their JID. " +
        "Use this to redirect a conversation from a channel to a private DM.",
      parameters: Type.Object({
        user_jid: Type.String({ description: "The user's JID to DM" }),
        message: Type.String({ description: "Message text to send" }),
        heading: Type.Optional(Type.String({ description: "Message heading (default: OpenClaw)" })),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const { sendZoomTextMessage } = await import("./send.js");
        const userJid = params.user_jid as string;
        const message = params.message as string;
        const heading = (params.heading as string) ?? undefined;

        // For DMs with a custom heading, use action message; otherwise plain text
        if (heading) {
          const { sendZoomActionMessage } = await import("./send.js");
          const result = await sendZoomActionMessage({
            cfg: api.config,
            to: userJid,
            headText: heading,
            body: [{ type: "message", text: message }],
            isChannel: false,
          });
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  ok: true,
                  messageId: result.messageId,
                  to: result.conversationId,
                }),
              },
            ],
          };
        }

        const result = await sendZoomTextMessage({
          cfg: api.config,
          to: userJid,
          text: message,
          isChannel: false,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                ok: true,
                messageId: result.messageId,
                to: result.conversationId,
              }),
            },
          ],
        };
      },
    };
  });

  // zoom_send_to_channel - post a message to a channel
  api.registerTool((ctx) => {
    if (ctx.messageChannel !== "zoom") return null;
    return {
      name: "zoom_send_to_channel",
      description:
        "Post a message to a Zoom channel. Optionally include a 'Share summary' " +
        "button that lets the user share a summary back to the channel from a DM.",
      parameters: Type.Object({
        channel_jid: Type.String({ description: "The channel JID to post to" }),
        message: Type.String({ description: "Message text to post" }),
        heading: Type.Optional(
          Type.String({ description: "Message heading (default: OpenClaw)" }),
        ),
        share_button: Type.Optional(
          Type.Boolean({
            description:
              "If true, the message is stored and a 'Share summary to channel' button " +
              "is sent to the user's DM instead of posting directly. Requires user_jid.",
          }),
        ),
        user_jid: Type.Optional(
          Type.String({
            description: "User JID for the share button DM (required when share_button is true)",
          }),
        ),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const channelJid = params.channel_jid as string;
        const message = params.message as string;
        const heading = (params.heading as string) ?? undefined;
        const shareButton = (params.share_button as boolean) ?? false;
        const userJid = params.user_jid as string | undefined;

        if (shareButton) {
          if (!userJid) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({ ok: false, error: "user_jid required when share_button is true" }),
                },
              ],
            };
          }

          // Store summary and send button to user's DM
          const refId = storePendingShare(channelJid, message);
          const { sendZoomActionMessage } = await import("./send.js");
          const result = await sendZoomActionMessage({
            cfg: api.config,
            to: userJid,
            headText: heading ?? "Share Summary",
            body: [
              { type: "message", text: "Click below to share this summary to the channel:" },
              {
                type: "actions",
                items: [
                  {
                    text: "Share to Channel",
                    value: `share_to_channel:${refId}`,
                    style: "Primary",
                  },
                ],
              },
            ],
            isChannel: false,
          });

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  ok: true,
                  messageId: result.messageId,
                  to: result.conversationId,
                  shareRefId: refId,
                }),
              },
            ],
          };
        }

        // Direct post to channel
        const { sendZoomTextMessage } = await import("./send.js");
        const result = await sendZoomTextMessage({
          cfg: api.config,
          to: channelJid,
          text: message,
          isChannel: true,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                ok: true,
                messageId: result.messageId,
                to: result.conversationId,
              }),
            },
          ],
        };
      },
    };
  });

  // zoom_request_file_upload - generate a tokenized upload URL
  api.registerTool((ctx) => {
    if (ctx.messageChannel !== "zoom") return null;
    return {
      name: "zoom_request_file_upload",
      description:
        "Generate a file upload URL for a Zoom user. " +
        "Returns a URL the user can open to upload a file (image, document, etc). " +
        "Send the URL to the user in your reply. Use when the user needs to provide a file.",
      parameters: Type.Object({
        user_jid: Type.String({ description: "The user's JID" }),
        conversation_id: Type.String({ description: "Current conversation ID for routing the response" }),
        label: Type.Optional(Type.String({ description: "Context label for the file name, e.g. issue number like 'PROJ-1234'" })),
        is_direct: Type.Optional(Type.Boolean({ description: "Whether this is a DM conversation (default: true)" })),
        channel_jid: Type.Optional(Type.String({ description: "Channel JID if in a channel conversation" })),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const userJid = params.user_jid as string;
        const conversationId = params.conversation_id as string;
        const label = (params.label as string) ?? undefined;
        const isDirect = (params.is_direct as boolean) ?? true;
        const channelJid = (params.channel_jid as string) ?? undefined;

        const token = createUploadToken({
          conversationId,
          userJid,
          isDirect,
          channelJid,
          sessionKey: ctx.sessionKey,
          agentId: ctx.agentId,
          accountId: ctx.agentAccountId,
          replyMainMessageId: resolveUploadReplyMainMessageId(ctx.sessionKey),
          label,
        });

        const zoomCfg = api.config.channels?.zoom as ZoomConfig | undefined;
        const baseUrl = zoomCfg?.publicUrl ?? "https://molty-dev.cloudwarriors.ai";
        const uploadUrl = `${baseUrl}/zoom/file?token=${token}`;

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ ok: true, uploadUrl, token, hint: "Send the link as plain text or [Upload File](url) — do NOT wrap in bold **. Zoom breaks URLs inside **bold**." }),
            },
          ],
        };
      },
    };
  });

  // zoom_get_prefilter_config - read the current prefilter classification prompt
  api.registerTool(() => ({
    name: "zoom_get_prefilter_config",
    description:
      "Get the current prefilter config that controls how the bot classifies channel messages " +
      "as RESPOND or SKIP in observe mode. Returns the system prompt and model. " +
      "Changes to this config take effect immediately without restarting.",
    parameters: Type.Object({}),
    async execute() {
      const config = readPrefilterConfig();
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            ok: true,
            configPath: PREFILTER_CONFIG_PATH,
            systemPrompt: config.systemPrompt,
            model: config.model ?? process.env.ZOOM_PREFILTER_MODEL ?? DEFAULT_MODEL,
            isDefault: config.systemPrompt === DEFAULT_SYSTEM_PROMPT,
          }),
        }],
      };
    },
  }));

  // zoom_set_prefilter_config - update the prefilter classification prompt
  api.registerTool(() => ({
    name: "zoom_set_prefilter_config",
    description:
      "Update the prefilter config that controls how the bot classifies channel messages " +
      "in observe mode. Changes take effect immediately on the next message — no restart needed. " +
      "The prompt should instruct the classifier to reply with exactly RESPOND or SKIP.",
    parameters: Type.Object({
      system_prompt: Type.String({ description: "The new system prompt for message classification" }),
      model: Type.Optional(Type.String({ description: "Override the LLM model (default: anthropic/claude-haiku-4.5)" })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      try {
        const config: Record<string, unknown> = {
          systemPrompt: params.system_prompt as string,
        };
        if (params.model) config.model = params.model as string;

        fs.writeFileSync(PREFILTER_CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ ok: true, message: "Prefilter config updated. Changes take effect on the next message." }),
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: message }) }],
        };
      }
    },
  }));

  // docx_read - read paragraphs from a DOCX file
  api.registerTool((ctx) => {
    if (ctx.messageChannel !== "zoom") return null;
    return {
      name: "docx_read",
      description:
        "Read the text content of a DOCX file that was uploaded via Zoom. " +
        "Returns an array of paragraphs with their index, text, and style.",
      parameters: Type.Object({
        file_path: Type.String({ description: "Absolute path to the .docx file" }),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const filePath = params.file_path as string;
        if (!fs.existsSync(filePath)) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: "File not found" }) }] };
        }
        const { readDocxParagraphs } = await import("./docx-tools.js");
        const paragraphs = await readDocxParagraphs(filePath);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ ok: true, paragraphs }) }],
        };
      },
    };
  });

  // docx_replace - find and replace text in a DOCX file
  api.registerTool((ctx) => {
    if (ctx.messageChannel !== "zoom") return null;
    return {
      name: "docx_replace",
      description:
        "Find and replace text in a DOCX file while preserving formatting. " +
        "Creates a modified copy. Use docx_get_download to get a download link for the result.",
      parameters: Type.Object({
        file_path: Type.String({ description: "Path to the source .docx file" }),
        replacements: Type.Array(
          Type.Object({
            find: Type.String({ description: "Text to find" }),
            replace: Type.String({ description: "Replacement text" }),
          }),
          { description: "Array of find/replace pairs" },
        ),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const filePath = params.file_path as string;
        if (!fs.existsSync(filePath)) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: "File not found" }) }] };
        }
        const replacements = params.replacements as Array<{ find: string; replace: string }>;
        const ext = path.extname(filePath);
        const base = path.basename(filePath, ext);
        const dir = path.dirname(filePath);
        const destPath = path.join(dir, `${base}_modified${ext}`);

        const { replaceInDocx } = await import("./docx-tools.js");
        const result = await replaceInDocx(filePath, destPath, replacements);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ ok: true, output_path: destPath, applied: result.applied, skipped: result.skipped }),
          }],
        };
      },
    };
  });

  // docx_get_download - get a download URL for a file in zoom-uploads
  api.registerTool((ctx) => {
    if (ctx.messageChannel !== "zoom") return null;
    return {
      name: "docx_get_download",
      description:
        "Get a public download URL for a file in the zoom-uploads directory. " +
        "Use this after docx_replace to give the user a link to the modified file.",
      parameters: Type.Object({
        file_path: Type.String({ description: "Absolute path to the file" }),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const filePath = params.file_path as string;
        const uploadDir = resolveZoomUploadDir();
        if (!filePath.startsWith(uploadDir) || !fs.existsSync(filePath)) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: "File not found or outside uploads directory" }) }],
          };
        }
        const relative = path.relative(uploadDir, filePath);
        const zoomCfg = api.config.channels?.zoom as ZoomConfig | undefined;
        const publicUrl = zoomCfg?.publicUrl ?? "https://molty-dev.cloudwarriors.ai";
        const downloadUrl = `${publicUrl}/zoom/uploads/${relative}`;
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ ok: true, download_url: downloadUrl }) }],
        };
      },
    };
  });
}
