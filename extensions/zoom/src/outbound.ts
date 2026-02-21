import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk";

import { getZoomRuntime } from "./runtime.js";
import { sendZoomTextMessage } from "./send.js";

/** Channel JIDs use the @conference. subdomain in Zoom XMPP */
const isChannelJid = (jid: string) => jid.includes("@conference.");

export const zoomOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: (text, limit) => getZoomRuntime().channel.text.chunkMarkdownText(text, limit),
  chunkerMode: "markdown",
  textChunkLimit: 4000,

  sendText: async ({ cfg, to, text, replyToId, identity, deps }) => {
    const isChannel = isChannelJid(to);
    const send =
      deps?.sendZoom ??
      ((target: string, body: string) =>
        sendZoomTextMessage({
          cfg,
          to: target,
          text: body,
          isChannel,
          replyToMessageId: replyToId ?? undefined,
          speakerName: identity?.name,
        }));
    const result = await send(to, text);
    return { channel: "zoom", ...result };
  },

  sendMedia: async ({ cfg, to, text, mediaUrl, replyToId, identity }) => {
    const isChannel = isChannelJid(to);
    const mediaText = mediaUrl ? `${text ? `${text}\n\n` : ""}${mediaUrl}` : text;
    const result = await sendZoomTextMessage({
      cfg,
      to,
      text: mediaText,
      isChannel,
      replyToMessageId: replyToId ?? undefined,
      speakerName: identity?.name,
    });
    return { channel: "zoom", ...result };
  },
};
