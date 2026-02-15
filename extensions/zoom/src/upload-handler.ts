import fs from "node:fs";
import path from "node:path";
import type { Request, Response } from "express";

import type { ZoomMessageHandlerDeps } from "./monitor-handler.js";
import { routeMessageToAgent } from "./monitor-handler.js";
import { copyDocToCustomer, ensureCustomerDir } from "./channel-memory.js";
import { getUploadErrorHtml, getUploadPageHtml } from "./upload-page.js";
import { consumeUploadToken, peekUploadToken } from "./upload-tokens.js";

const UPLOAD_DIR = path.resolve(".data/zoom-uploads");

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function createUploadRoutes(deps: ZoomMessageHandlerDeps) {
  const { cfg, log } = deps;

  function handleGet(req: Request, res: Response): void {
    const token = req.query.token as string | undefined;
    if (!token || !peekUploadToken(token)) {
      res.status(400).type("html").send(getUploadErrorHtml("This upload link is invalid or has expired."));
      return;
    }
    res.type("html").send(getUploadPageHtml(token));
  }

  async function handlePost(req: Request, res: Response): Promise<void> {
    try {
      const { token, filename, mimeType, size, data } = req.body ?? {};

      if (!token || !filename || !data) {
        res.status(400).json({ ok: false, error: "Missing required fields." });
        return;
      }

      const ctx = consumeUploadToken(token as string);
      if (!ctx) {
        res.status(401).json({ ok: false, error: "Invalid or expired upload token." });
        return;
      }

      const tokenDir = path.join(UPLOAD_DIR, token as string);
      ensureDir(tokenDir);

      // Build descriptive filename: {label}_{date}_{original} or {date}_{original}
      const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const origName = String(filename).replace(/[^a-zA-Z0-9._-]/g, "_");
      const ext = path.extname(origName);
      const base = path.basename(origName, ext);
      const labelSlug = ctx.label ? ctx.label.replace(/[^a-zA-Z0-9_-]/g, "_") : "";
      const safeName = labelSlug
        ? `${labelSlug}_${date}_${base}${ext}`
        : `${date}_${base}${ext}`;
      const filePath = path.join(tokenDir, safeName);

      const base64Match = String(data).match(/^data:[^;]*;base64,(.*)$/);
      const fileBuffer = base64Match
        ? Buffer.from(base64Match[1], "base64")
        : Buffer.from(String(data), "base64");
      fs.writeFileSync(filePath, fileBuffer);

      const sizeKB = Math.round((size as number) / 1024);
      const mime = String(mimeType || "application/octet-stream");

      let agentText: string;
      if (mime.startsWith("image/")) {
        // Reference file path only — do NOT inline base64 (causes memory blowup)
        agentText = `[FILE_UPLOAD image] ${safeName} (${mime}, ${sizeKB}KB) saved to ${filePath}`;
      } else if (
        mime.startsWith("text/") ||
        mime === "application/json" ||
        mime === "application/xml" ||
        /\.(txt|csv|json|xml|html|md|log|yaml|yml|toml)$/i.test(safeName)
      ) {
        const textContent = fileBuffer.toString("utf-8");
        agentText = `[FILE_UPLOAD document] ${safeName}\n\n${textContent}`;
      } else {
        agentText = `[FILE_UPLOAD] ${safeName} (${mime}, ${sizeKB}KB) saved to ${filePath}`;
      }

      // Copy uploaded file to the customer directory if we have a channel context
      if (ctx.channelName) {
        const slug = ctx.channelName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
        try {
          await ensureCustomerDir(slug, ctx.channelName, ctx.channelJid);
          await copyDocToCustomer(slug, filePath, safeName);
        } catch (copyErr) {
          log.error("failed to copy upload to customer dir", { error: String(copyErr) });
        }
      }

      // For DMs, reply to userJid (the actual Zoom JID).
      // ctx.conversationId may be an internal session ID the LLM passed, not a JID.
      const replyTo = ctx.isDirect ? ctx.userJid : (ctx.channelJid ?? ctx.userJid);

      await routeMessageToAgent({
        deps,
        conversationId: replyTo,
        senderId: ctx.userJid,
        senderName: ctx.userName,
        senderEmail: ctx.userEmail,
        text: agentText,
        isDirect: ctx.isDirect,
        channelJid: ctx.channelJid,
        channelName: ctx.channelName,
      });

      res.json({ ok: true });
    } catch (err) {
      log.error("upload handler error", { error: String(err) });
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: "Internal server error." });
      }
    }
  }

  return { handleGet, handlePost };
}
