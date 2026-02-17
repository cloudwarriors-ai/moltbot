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

  sendText: async ({ cfg, to, text, deps }) => {
    const isChannel = isChannelJid(to);
    const send =
      deps?.sendZoom ??
      ((to: string, text: string) => sendZoomTextMessage({ cfg, to, text, isChannel }));
    const result = await send(to, text);
    return { channel: "zoom", ...result };
  },

  sendMedia: async ({ cfg, to, text, mediaUrl }) => {
    const isChannel = isChannelJid(to);
    const mediaText = mediaUrl ? `${text ? `${text}\n\n` : ""}${mediaUrl}` : text;
    const result = await sendZoomTextMessage({ cfg, to, text: mediaText, isChannel });
    return { channel: "zoom", ...result };
  },
};
