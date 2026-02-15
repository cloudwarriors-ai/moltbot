import type { ZoomCredentials } from "./types.js";
import type { ZoomMonitorLogger } from "./monitor-types.js";
import type { ZoomChatMessage } from "./api.js";
import { writeChannelTraining } from "./channel-memory.js";
import fs from "node:fs/promises";

const MAX_MESSAGES = 500;
const PAGE_SIZE = 50;
const PAGE_DELAY_MS = 200;
const QA_TIME_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get an access token from the Zoom Report S2S app (account_credentials grant).
 * Falls back gracefully if env vars are not set.
 */
async function getReportToken(): Promise<string | undefined> {
  const clientId = process.env.ZOOM_REPORT_CLIENT_ID;
  const clientSecret = process.env.ZOOM_REPORT_CLIENT_SECRET;
  const accountId = process.env.ZOOM_REPORT_ACCOUNT_ID || process.env.ZOOM_ACCOUNT_ID;
  if (!clientId || !clientSecret || !accountId) return undefined;

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`,
    { method: "POST", headers: { Authorization: `Basic ${basic}` } },
  );
  const data = (await res.json()) as { access_token?: string };
  return data.access_token;
}

type QAPair = { q: string; a: string; topic?: string };
type ParsedHistory = {
  pairs: QAPair[];
  messageCount: number;
  dateRange: { first: string; last: string };
};

/**
 * Main entry point — fetch channel history, extract Q&A patterns, write training file.
 * Designed to be called fire-and-forget.
 */
export async function fetchAndTrainFromHistory(
  channelJid: string,
  channelName: string | undefined,
  creds: ZoomCredentials,
  log: ZoomMonitorLogger,
): Promise<void> {
  const label = channelName ?? channelJid;
  log.info(`history ingest: starting for ${label}`);

  const messages = await fetchChannelHistory(channelJid, creds, log);
  if (messages.length === 0) {
    log.info(`history ingest: no messages found for ${label}`);
    return;
  }

  log.info(`history ingest: fetched ${messages.length} messages from ${label}`);

  const parsed = parseQAPairs(messages);
  if (parsed.pairs.length === 0) {
    log.info(`history ingest: no Q&A pairs extracted from ${label}`);
    return;
  }

  const training = buildTrainingPrompt(channelName ?? channelJid, parsed, []);

  const slug = (channelName ?? channelJid.split("@")[0])
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "unknown";

  await writeChannelTraining(slug, training, channelName, channelJid);
  log.info(`history ingest: wrote training.md for ${label} (${parsed.pairs.length} Q&A pairs)`);
}

/**
 * CSV-based ingest — parse a Zoom Chat History CSV export and build training.
 * Use when the API path is unavailable (Zoom granular scope bug).
 */
export async function trainFromCsvFile(
  csvPath: string,
  channelName: string,
  log: ZoomMonitorLogger,
): Promise<void> {
  log.info(`csv ingest: reading ${csvPath}`);
  const raw = await fs.readFile(csvPath, "utf-8");
  const rows = parseCsvRows(raw);
  log.info(`csv ingest: parsed ${rows.length} rows`);

  const messages = csvRowsToMessages(rows);
  log.info(`csv ingest: ${messages.length} usable messages (filtered)`);

  if (messages.length === 0) {
    log.info("csv ingest: no messages to process");
    return;
  }

  const parsed = parseQAPairs(messages);
  const actionExamples = detectActionExamples(messages);
  log.info(`csv ingest: ${parsed.pairs.length} Q&A pairs, ${actionExamples.length} action examples`);

  if (parsed.pairs.length === 0 && actionExamples.length === 0) {
    log.info("csv ingest: no patterns extracted");
    return;
  }

  const training = buildTrainingPrompt(channelName, parsed, actionExamples);

  const slug = channelName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "unknown";

  await writeChannelTraining(slug, training, channelName);
  log.info(`csv ingest: wrote training.md for ${channelName} (${parsed.pairs.length} Q&A pairs, ${actionExamples.length} actions)`);
}

// ---------------------------------------------------------------------------
// CSV Parsing (RFC 4180 — handles quoted multi-line fields)
// ---------------------------------------------------------------------------

const CSV_HEADERS = [
  "session_id", "sender", "receiver", "message_time", "message",
  "emoji", "file", "giphy", "edited_deleted", "edited_deleted_time",
  "message_id", "parent_message_id", "parent_message_time", "conversation_type",
] as const;

function parseCsvRows(content: string): Record<string, string>[] {
  // Strip BOM
  const text = content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content;
  const rows: Record<string, string>[] = [];
  let i = 0;
  const len = text.length;

  // Skip header row
  while (i < len && text[i] !== "\n") i++;
  i++; // past the newline

  while (i < len) {
    const fields: string[] = [];
    for (let col = 0; col < CSV_HEADERS.length && i < len; col++) {
      if (text[i] === '"') {
        // Quoted field — find matching close quote
        i++; // skip opening quote
        let val = "";
        while (i < len) {
          if (text[i] === '"') {
            if (i + 1 < len && text[i + 1] === '"') {
              val += '"'; // escaped quote
              i += 2;
            } else {
              i++; // closing quote
              break;
            }
          } else {
            val += text[i];
            i++;
          }
        }
        fields.push(val);
        // Skip comma or newline after quoted field
        if (i < len && text[i] === ",") i++;
      } else {
        // Unquoted field
        const nextComma = text.indexOf(",", i);
        const nextNewline = text.indexOf("\n", i);
        const isLast = col === CSV_HEADERS.length - 1;
        let end: number;
        if (isLast) {
          end = nextNewline === -1 ? len : nextNewline;
        } else {
          end = nextComma === -1 ? len : nextComma;
        }
        fields.push(text.slice(i, end).replace(/\r$/, ""));
        i = end + 1;
      }
    }
    // Skip any trailing content on this logical row
    if (fields.length > 0 && fields[0]) {
      const row: Record<string, string> = {};
      for (let c = 0; c < CSV_HEADERS.length; c++) {
        row[CSV_HEADERS[c]] = fields[c] ?? "";
      }
      rows.push(row);
    }
  }
  return rows;
}

function stripBraces(id: string): string {
  return id.replace(/^\{|\}$/g, "").trim();
}

function csvRowsToMessages(rows: Record<string, string>[]): ZoomChatMessage[] {
  const msgs: ZoomChatMessage[] = [];
  for (const row of rows) {
    const msg = row.message?.trim();
    if (!msg) continue;
    if (msg === "This message can not be seen due to permissions.") continue;
    if (row.edited_deleted === "Deleted") continue;

    const id = stripBraces(row.message_id);
    if (!id) continue;

    msgs.push({
      id,
      message: msg,
      sender: row.sender ?? "",
      date_time: row.message_time ?? "",
      timestamp: new Date(row.message_time?.replace(/:(\d{3})$/, ".$1") ?? 0).getTime(),
      reply_main_message_id: row.parent_message_id ? stripBraces(row.parent_message_id) : undefined,
    });
  }
  return msgs;
}

// ---------------------------------------------------------------------------
// Action/Tool-Call Pattern Detection
// ---------------------------------------------------------------------------

type ActionExample = {
  trigger: string;     // what the user said
  response: string;    // how the team responded
  toolCall: string;    // suggested tool-call
  category: string;
};

const ACTION_PATTERNS: { re: RegExp; category: string; toolCall: string }[] = [
  { re: /\bpso[- ]?\d{5,}/i, category: "order-lookup", toolCall: "zw2_search_orders" },
  { re: /\b(sow|statement of work)\b.*\b(generat|creat|draft|send|share|updat)/i, category: "sow-generation", toolCall: "zw2_generate_sow" },
  { re: /\b(generat|creat|draft|send)\b.*\b(sow|statement of work)\b/i, category: "sow-generation", toolCall: "zw2_generate_sow" },
  { re: /\bquot(e|ing)\b.*\b(tool|platform|zoomwarriors)\b/i, category: "quoting", toolCall: "zw2_create_order" },
  { re: /\b(add|change|update|modify)\b.*\b(licens|seat|user count)/i, category: "license-update", toolCall: "zw2_submit_zp_license" },
  { re: /\b(add|change|update)\b.*\b(contact center|zcc|agent)/i, category: "zcc-update", toolCall: "zw2_submit_zcc" },
  { re: /\bpric(e|ing)\b.*\b(breakdown|detail|cost|estimate)/i, category: "pricing", toolCall: "zw2_get_pricing" },
  { re: /\b(download|get|pull)\b.*\bsow\b/i, category: "sow-download", toolCall: "zw2_download_sow" },
  { re: /\b(scope|scoping)\b.*\b(call|review|meeting)/i, category: "scoping", toolCall: "zw2_create_order" },
  { re: /\b(order|quote)\b.*\b(status|update|where|progress)/i, category: "order-status", toolCall: "zw2_get_order" },
  { re: /\bminimum\b.*\b(pso|engagement|cost|price)/i, category: "pricing", toolCall: "zw2_get_pricing" },
  { re: /\b(zp|zoom phone|zoom cc|zcc)\b.*\b(config|setup|deploy)/i, category: "configuration", toolCall: "zw2_submit_zp_features" },
];

function detectActionExamples(messages: ZoomChatMessage[]): ActionExample[] {
  const sorted = [...messages].sort(
    (a, b) => new Date(a.date_time).getTime() - new Date(b.date_time).getTime(),
  );
  const byId = new Map<string, ZoomChatMessage>();
  for (const m of sorted) byId.set(m.id, m);

  const examples: ActionExample[] = [];
  const seenCategories = new Set<string>();

  // Check reply threads for action patterns
  for (const m of sorted) {
    if (!m.reply_main_message_id) continue;
    const parent = byId.get(m.reply_main_message_id);
    if (!parent) continue;

    const trigger = parent.message?.trim();
    const response = m.message?.trim();
    if (!trigger || !response) continue;

    for (const pat of ACTION_PATTERNS) {
      if (pat.re.test(trigger) && !seenCategories.has(pat.category)) {
        examples.push({
          trigger,
          response: response.slice(0, 300),
          toolCall: pat.toolCall,
          category: pat.category,
        });
        seenCategories.add(pat.category);
        break;
      }
    }
    if (seenCategories.size >= 8) break; // enough diversity
  }

  // Also check time-proximity pairs
  for (let i = 0; i < sorted.length - 1 && seenCategories.size < 10; i++) {
    const curr = sorted[i];
    const next = sorted[i + 1];
    if (curr.sender === next.sender) continue;
    const timeDiff = new Date(next.date_time).getTime() - new Date(curr.date_time).getTime();
    if (timeDiff > QA_TIME_WINDOW_MS) continue;

    const trigger = curr.message?.trim();
    const response = next.message?.trim();
    if (!trigger || !response) continue;

    for (const pat of ACTION_PATTERNS) {
      if (pat.re.test(trigger) && !seenCategories.has(pat.category)) {
        examples.push({
          trigger,
          response: response.slice(0, 300),
          toolCall: pat.toolCall,
          category: pat.category,
        });
        seenCategories.add(pat.category);
        break;
      }
    }
  }

  return examples;
}

/**
 * Paginate through Zoom chat message history for a channel.
 * Uses the Report S2S app (account_credentials) to fetch as an admin user.
 */
async function fetchChannelHistory(
  channelJid: string,
  _creds: ZoomCredentials,
  log: ZoomMonitorLogger,
): Promise<ZoomChatMessage[]> {
  const token = await getReportToken();
  if (!token) {
    log.warn("history ingest: ZOOM_REPORT_CLIENT_ID/SECRET not set, skipping");
    return [];
  }

  const reportUser = process.env.ZOOM_REPORT_USER;
  if (!reportUser) {
    log.warn("history ingest: ZOOM_REPORT_USER not set, skipping");
    return [];
  }

  const channelId = channelJid.split("@")[0];
  const allMessages: ZoomChatMessage[] = [];
  let nextPageToken: string | undefined;

  // Build date range — last 6 months or as far back as API allows
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);

  while (allMessages.length < MAX_MESSAGES) {
    const params = new URLSearchParams({
      to_channel: channelId,
      page_size: String(PAGE_SIZE),
      from,
      to,
    });
    if (nextPageToken) params.set("next_page_token", nextPageToken);

    const url = `https://api.zoom.us/v2/chat/users/${encodeURIComponent(reportUser)}/messages?${params}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      log.warn(`history ingest: API ${res.status}: ${errText.slice(0, 200)}`);
      break;
    }

    const data = (await res.json()) as { messages?: ZoomChatMessage[]; next_page_token?: string };
    const msgs = data.messages ?? [];
    if (msgs.length === 0) break;

    allMessages.push(...msgs);
    nextPageToken = data.next_page_token;

    if (!nextPageToken) break;

    // Rate limit courtesy delay
    await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
  }

  return allMessages;
}

/**
 * Group messages into Q&A pairs based on time proximity and reply threads.
 */
function parseQAPairs(messages: ZoomChatMessage[]): ParsedHistory {
  // Sort chronologically
  const sorted = [...messages].sort(
    (a, b) => new Date(a.date_time).getTime() - new Date(b.date_time).getTime(),
  );

  const dateRange = {
    first: sorted[0].date_time,
    last: sorted[sorted.length - 1].date_time,
  };

  const pairs: QAPair[] = [];

  // Strategy 1: Reply threads — reply is the answer, parent is the question
  const byId = new Map<string, ZoomChatMessage>();
  for (const m of sorted) byId.set(m.id, m);

  const usedIds = new Set<string>();

  for (const m of sorted) {
    if (!m.reply_main_message_id) continue;
    const parent = byId.get(m.reply_main_message_id);
    if (!parent) continue;
    if (parent.sender === m.sender) continue; // skip self-replies
    if (usedIds.has(parent.id)) continue;

    const q = parent.message?.trim();
    const a = m.message?.trim();
    if (q && a && q.length > 5 && a.length > 5) {
      pairs.push({ q, a, topic: detectTopic(q + " " + a) });
      usedIds.add(parent.id);
      usedIds.add(m.id);
    }
  }

  // Strategy 2: Time-proximity pairs (question-like followed by a different sender's response)
  for (let i = 0; i < sorted.length - 1; i++) {
    const curr = sorted[i];
    const next = sorted[i + 1];
    if (usedIds.has(curr.id) || usedIds.has(next.id)) continue;
    if (curr.sender === next.sender) continue;

    const timeDiff = new Date(next.date_time).getTime() - new Date(curr.date_time).getTime();
    if (timeDiff > QA_TIME_WINDOW_MS) continue;

    const q = curr.message?.trim();
    const a = next.message?.trim();
    if (!q || !a || q.length < 5 || a.length < 5) continue;

    // Heuristic: first message looks like a question
    if (looksLikeQuestion(q)) {
      pairs.push({ q, a, topic: detectTopic(q + " " + a) });
      usedIds.add(curr.id);
      usedIds.add(next.id);
    }
  }

  return { pairs, messageCount: messages.length, dateRange };
}

function looksLikeQuestion(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("?") ||
    /^(how|what|when|where|why|who|can|could|is|are|do|does|has|have|will|would|should)\b/.test(t) ||
    /^(hey|hi|hello)[\s,]/.test(t)
  );
}

const TOPIC_PATTERNS: [RegExp, string][] = [
  [/phone|call|dial|ring|voicemail/i, "phone-system"],
  [/zoom\s*(room|meeting|webinar)/i, "zoom-meetings"],
  [/license|licens|plan|subscription/i, "licensing"],
  [/user|account|provision|onboard/i, "user-management"],
  [/network|firewall|bandwidth|qos/i, "network"],
  [/sso|saml|auth|login|password/i, "authentication"],
  [/integrat|api|webhook|crm/i, "integrations"],
  [/migrate|port|transfer|switch/i, "migration"],
  [/contact\s*center|queue|ivr|attendant/i, "contact-center"],
  [/recording|compliance/i, "recording"],
  [/mobile|app|softphone/i, "mobile"],
  [/config|setting|admin|dashboard/i, "configuration"],
];

function detectTopic(text: string): string | undefined {
  for (const [re, label] of TOPIC_PATTERNS) {
    if (re.test(text)) return label;
  }
  return undefined;
}

/**
 * Build a markdown training document from extracted Q&A pairs and action examples.
 */
function buildTrainingPrompt(channelName: string, parsed: ParsedHistory, actionExamples: ActionExample[]): string {
  const { pairs, messageCount, dateRange } = parsed;
  const date = new Date().toISOString().slice(0, 10);

  // Detect response style from answers
  const avgLen = pairs.length > 0
    ? pairs.reduce((sum, p) => sum + p.a.length, 0) / pairs.length
    : 0;
  const styleLabel = avgLen < 80 ? "short" : avgLen < 250 ? "medium" : "long";

  // Collect topics
  const topicCounts = new Map<string, number>();
  for (const p of pairs) {
    if (p.topic) topicCounts.set(p.topic, (topicCounts.get(p.topic) ?? 0) + 1);
  }
  const topTopics = [...topicCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([t]) => t);

  const lines: string[] = [
    `# Channel Training — ${channelName}`,
    "",
    `**Ingested**: ${date} | **Messages**: ${messageCount} | **Date Range**: ${dateRange.first.slice(0, 10)} → ${dateRange.last.slice(0, 10)}`,
    "",
    "## Channel Context",
    `This channel discusses: ${topTopics.length > 0 ? topTopics.join(", ") : "general topics"}`,
    `Response style: ${styleLabel} | Avg answer length: ~${Math.round(avgLen)} chars`,
    "",
    "## Q&A Patterns",
    "",
  ];

  // Cap at 50 representative pairs
  const shown = pairs.slice(0, 50);
  for (const p of shown) {
    lines.push(`**Q**: ${p.q}`);
    lines.push(`**A**: ${p.a}`);
    if (p.topic) lines.push(`_Topic: ${p.topic}_`);
    lines.push("");
  }

  if (pairs.length > 50) {
    lines.push(`_(${pairs.length - 50} additional pairs omitted)_`);
    lines.push("");
  }

  // Tool-call action patterns — teach the bot when to invoke tools
  if (actionExamples.length > 0) {
    lines.push("## Tool Actions");
    lines.push("");
    lines.push("When a user request matches these patterns, invoke the corresponding tool:");
    lines.push("");

    for (const ex of actionExamples) {
      lines.push(`### ${ex.category}`);
      lines.push(`**User**: ${ex.trigger.slice(0, 200)}`);
      lines.push(`**Action**: \`tool-call: ${ex.toolCall}\``);
      lines.push(`**Context**: ${ex.response.slice(0, 200)}`);
      lines.push("");
    }

    // Always include the full tool reference
    lines.push("### Tool Reference");
    lines.push("");
    lines.push("| Request Pattern | Tool | Description |");
    lines.push("|---|---|---|");
    lines.push("| Look up order/PSO number | `zw2_search_orders` | Search by name, company, or PSO ID |");
    lines.push("| Get order details | `zw2_get_order` | Full order config and customer info |");
    lines.push("| Check pricing | `zw2_get_pricing` | Itemized pricing breakdown |");
    lines.push("| Create new order | `zw2_create_order` | Start a new ZW2 order |");
    lines.push("| Update customer info | `zw2_submit_customer_info` | Section 1: company, contacts |");
    lines.push("| Update phone licenses | `zw2_submit_zp_license` | Section 2: ZP license counts |");
    lines.push("| Update locations | `zw2_submit_zp_location` | Section 3: sites, e911, ports |");
    lines.push("| Update phone features | `zw2_submit_zp_features` | Section 4: queues, ATAs, paging |");
    lines.push("| Update hardware | `zw2_submit_zp_hardware` | Section 5: physical phones |");
    lines.push("| Update SBC/PBX config | `zw2_submit_zp_sbc_pbx` | Section 6: BYOC, SBC |");
    lines.push("| Update contact center | `zw2_submit_zcc` | Section 7: agents, channels |");
    lines.push("| Update WFO | `zw2_submit_wfo` | Section 8: workforce optimization |");
    lines.push("| Update integrations | `zw2_submit_additions` | Section 9: SSO, apps, CTI |");
    lines.push("| Update wrapup | `zw2_submit_wrapup` | Section 10: go-live, training |");
    lines.push("| Generate SOW | `zw2_generate_sow` | Build the Statement of Work |");
    lines.push("| Download SOW | `zw2_download_sow` | Get the SOW PDF |");
    lines.push("");
  }

  lines.push("## Response Guidelines");
  lines.push(`- Keep answers ${styleLabel} (avg ~${Math.round(avgLen)} chars)`);
  lines.push("- Match the conversational tone used in this channel");
  lines.push("- When a request involves creating or modifying an order/SOW, invoke the appropriate ZW2 tool");
  lines.push("- For PSO references (PSO-XXXXX), search orders first to find the matching ZW2 order");
  if (topTopics.length > 0) {
    lines.push(`- Most common topics: ${topTopics.join(", ")}`);
  }
  lines.push("");

  return lines.join("\n");
}
