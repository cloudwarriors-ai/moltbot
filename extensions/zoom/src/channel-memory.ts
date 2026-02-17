import fs from "node:fs/promises";
import path from "node:path";

const WORKSPACE_DIR = process.env.OPENCLAW_HOME
  ? path.join(process.env.OPENCLAW_HOME, "workspace")
  : path.join(process.env.HOME ?? "/root", ".openclaw", "workspace");

const PROFILE_MARKER = "<!-- PROFILE_START -->";
const PROFILE_END_MARKER = "<!-- PROFILE_END -->";

function sanitizeChannelName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

// ---------------------------------------------------------------------------
// Customer directory helpers
// ---------------------------------------------------------------------------

function customerDir(slug: string): string {
  return path.join(WORKSPACE_DIR, "memory", "customers", slug);
}

function customerIndexPath(slug: string): string {
  return path.join(customerDir(slug), "index.md");
}

/**
 * Scaffold the customer project directory and write the initial index.md manifest.
 * No-ops if the directory already exists.
 */
export async function ensureCustomerDir(slug: string, channelName?: string, channelJid?: string): Promise<void> {
  const dir = customerDir(slug);
  const indexPath = customerIndexPath(slug);

  try {
    await fs.access(indexPath);
    return; // already exists
  } catch {
    // needs creation
  }

  await fs.mkdir(path.join(dir, "orders"), { recursive: true });
  await fs.mkdir(path.join(dir, "docs"), { recursive: true });

  const date = new Date().toISOString().slice(0, 10);
  const displayName = channelName ?? slug;
  const header = [
    `# ${displayName} — Customer Project`,
    "",
    `- **Created**: ${date}`,
    `- **Updated**: ${date}`,
    channelJid ? `- **Source Channel**: ${channelJid}` : null,
    "",
    "## Artifacts",
    "",
    "- [Channel Knowledge Base](channel.md)",
    "",
    "## Orders",
    "_No orders yet._",
    "",
    "## Documents",
    "_No documents yet._",
    "",
  ].filter((l) => l !== null).join("\n");

  await fs.writeFile(indexPath, header, "utf-8");
}

/**
 * Append an artifact entry to the appropriate section (Orders or Documents) in index.md.
 */
export async function registerArtifact(slug: string, type: "order" | "document", filename: string, label?: string): Promise<void> {
  const indexPath = customerIndexPath(slug);
  let content: string;
  try {
    content = await fs.readFile(indexPath, "utf-8");
  } catch {
    return; // index doesn't exist yet — skip
  }

  const sectionHeader = type === "order" ? "## Orders" : "## Documents";
  const idx = content.indexOf(sectionHeader);
  if (idx === -1) return;

  const displayLabel = label ?? filename;
  const relativePath = type === "order" ? `orders/${filename}` : `docs/${filename}`;
  const entry = `- [${displayLabel}](${relativePath})`;

  // Avoid duplicates
  if (content.includes(entry)) return;

  // Remove placeholder text if present
  const placeholder = "_No orders yet._";
  const docPlaceholder = "_No documents yet._";
  if (type === "order" && content.includes(placeholder)) {
    content = content.replace(placeholder, "");
  }
  if (type === "document" && content.includes(docPlaceholder)) {
    content = content.replace(docPlaceholder, "");
  }

  // Insert entry after the section header line
  const afterHeader = content.indexOf("\n", idx);
  if (afterHeader === -1) return;
  const insertPos = afterHeader + 1;
  content = content.slice(0, insertPos) + entry + "\n" + content.slice(insertPos);

  // Update the "Updated" date
  const dateToday = new Date().toISOString().slice(0, 10);
  content = content.replace(/\*\*Updated\*\*: \d{4}-\d{2}-\d{2}/, `**Updated**: ${dateToday}`);

  await fs.writeFile(indexPath, content, "utf-8");
}

/**
 * Copy an uploaded file into the customer docs directory and register it.
 */
export async function copyDocToCustomer(slug: string, sourcePath: string, filename: string): Promise<string> {
  const docsDir = path.join(customerDir(slug), "docs");
  await fs.mkdir(docsDir, { recursive: true });
  const destPath = path.join(docsDir, filename);
  await fs.copyFile(sourcePath, destPath);
  await registerArtifact(slug, "document", filename);
  return destPath;
}

/**
 * Write a training prompt file to the customer directory.
 * Called by history ingest after extracting Q&A pairs from channel history.
 */
export async function writeChannelTraining(
  slug: string,
  trainingMarkdown: string,
  channelName?: string,
  channelJid?: string,
): Promise<void> {
  await ensureCustomerDir(slug, channelName, channelJid);
  const dir = customerDir(slug);
  const trainingPath = path.join(dir, "training.md");
  await fs.writeFile(trainingPath, trainingMarkdown, "utf-8");
  await registerArtifact(slug, "document", "training.md", "Channel Training (auto-ingested)");
}

/**
 * Load channel context for the agent: combines training.md (auto-ingested history)
 * with channel.md (approved Q&A and customer profile from reviewer training).
 * Channel.md is prioritized (appended last) so trained answers override history.
 * Total output is capped at ~12KB to avoid overwhelming the agent context.
 */
export async function loadChannelTraining(
  channelName?: string,
  channelJid?: string,
): Promise<string | undefined> {
  const slug = sanitizeChannelName(channelName ?? channelJid?.split("@")[0] ?? "");
  if (!slug) return undefined;

  const dir = customerDir(slug);
  const parts: string[] = [];

  // 1. Load training.md (auto-ingested history Q&A patterns)
  try {
    const training = await fs.readFile(path.join(dir, "training.md"), "utf-8");
    // Cap history training at ~6KB — keep header + first N pairs
    if (training.length > 6000) {
      parts.push(training.slice(0, 6000) + "\n\n_(training history truncated)_");
    } else {
      parts.push(training);
    }
  } catch {
    // no training.md — that's ok
  }

  // 2. Load channel.md (reviewer-approved Q&A + customer profile — higher priority)
  try {
    const channel = await fs.readFile(path.join(dir, "channel.md"), "utf-8");
    if (channel.length > 6000) {
      // Keep the profile section + most recent Q&A entries (end of file)
      const profileEnd = channel.indexOf("## Q&A History");
      const profileSection = profileEnd > 0 ? channel.slice(0, profileEnd) : "";
      const qaSection = profileEnd > 0 ? channel.slice(profileEnd) : channel;
      // Take the last ~5KB of Q&A (most recent entries)
      const qaKeep = qaSection.length > 5000 ? qaSection.slice(-5000) : qaSection;
      parts.push(
        "\n## Reviewer-Trained Answers (HIGHEST PRIORITY — use these over history patterns)\n",
        profileSection,
        qaKeep,
      );
    } else {
      parts.push(
        "\n## Reviewer-Trained Answers (HIGHEST PRIORITY — use these over history patterns)\n",
        channel,
      );
    }
  } catch {
    // no channel.md — that's ok
  }

  if (parts.length === 0) return undefined;
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Channel path resolution (migrated to customer dir)
// ---------------------------------------------------------------------------

const OLD_CHANNELS_DIR = path.join(WORKSPACE_DIR, "memory", "channels");

function resolveChannelPath(channelName: string | undefined, channelJid: string) {
  const fileName = sanitizeChannelName(channelName ?? channelJid.split("@")[0]);
  const newPath = path.join(customerDir(fileName), "channel.md");
  const oldPath = path.join(OLD_CHANNELS_DIR, `${fileName}.md`);
  return { fileName, filePath: newPath, oldPath };
}

/**
 * If the old-style channel file exists, migrate it to the new customer directory.
 */
async function migrateIfNeeded(slug: string, oldPath: string, newPath: string, channelName?: string, channelJid?: string): Promise<void> {
  try {
    await fs.access(oldPath);
  } catch {
    return; // no old file to migrate
  }

  // Ensure customer dir scaffold exists
  await ensureCustomerDir(slug, channelName, channelJid);

  // Move the file
  await fs.mkdir(path.dirname(newPath), { recursive: true });
  await fs.rename(oldPath, newPath);
}

async function ensureChannelFile(filePath: string, channelName: string | undefined, fileName: string, channelJid?: string): Promise<void> {
  // Ensure customer directory is scaffolded first
  await ensureCustomerDir(fileName, channelName, channelJid);

  try {
    await fs.access(filePath);
  } catch {
    const header = [
      `# ${channelName ?? fileName} — Customer Knowledge Base`,
      "",
      PROFILE_MARKER,
      "## Customer Profile",
      "",
      "_No details captured yet. Profile builds automatically from approved Q&A._",
      "",
      PROFILE_END_MARKER,
      "",
      "---",
      "",
      "## Q&A History",
      "",
    ].join("\n");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, header, "utf-8");
  }
}

export async function persistApprovedQA(params: {
  channelName?: string;
  channelJid: string;
  senderName?: string;
  question: string;
  answer: string;
}): Promise<void> {
  const { channelName, channelJid, senderName, question, answer } = params;
  const { fileName, filePath, oldPath } = resolveChannelPath(channelName, channelJid);

  // Migrate old-style file if it exists
  await migrateIfNeeded(fileName, oldPath, filePath, channelName, channelJid);

  await ensureChannelFile(filePath, channelName, fileName, channelJid);

  const date = new Date().toISOString().slice(0, 16).replace("T", " ");
  const entry = [
    `### ${date} — ${senderName ?? "Unknown"}`,
    "",
    `**Q:** ${question}`,
    "",
    `**A:** ${answer}`,
    "",
    `**Insight:** ${deriveInsight(question, answer)}`,
    "",
    "---",
    "",
  ].join("\n");

  await fs.appendFile(filePath, entry, "utf-8");
}

/**
 * Append a detail to the Customer Profile section of the channel memory file.
 * Each detail is a short fact about the customer's environment.
 */
export async function appendCustomerDetail(params: {
  channelName?: string;
  channelJid: string;
  detail: string;
}): Promise<void> {
  const { channelName, channelJid, detail } = params;
  const { fileName, filePath, oldPath } = resolveChannelPath(channelName, channelJid);

  // Migrate old-style file if it exists
  await migrateIfNeeded(fileName, oldPath, filePath, channelName, channelJid);

  await ensureChannelFile(filePath, channelName, fileName, channelJid);

  const content = await fs.readFile(filePath, "utf-8");
  const endIdx = content.indexOf(PROFILE_END_MARKER);
  if (endIdx === -1) return; // malformed file, skip

  // Avoid duplicate details
  const profileSection = content.slice(0, endIdx);
  if (profileSection.includes(detail)) return;

  const date = new Date().toISOString().slice(0, 10);
  const newDetail = `- ${detail} _(${date})_\n`;
  const updated = content.slice(0, endIdx) + newDetail + content.slice(endIdx);
  await fs.writeFile(filePath, updated, "utf-8");
}

/**
 * Derive a short insight from the Q&A that captures what this reveals about
 * the customer's needs or environment. Simple keyword extraction — not an LLM call.
 */
function deriveInsight(question: string, answer: string): string {
  const combined = `${question} ${answer}`.toLowerCase();
  const topics: string[] = [];

  const patterns: [RegExp, string][] = [
    [/execut\w*[- ]?assist\w*|delegat/i, "executive-assistant delegation"],
    [/shared\s*line|shared\s*appearance/i, "shared line / SLA"],
    [/call\s*queue|hunt\s*group/i, "call queues / hunt groups"],
    [/auto[- ]?attendant|ivr/i, "auto-attendant / IVR"],
    [/voicemail|vm\b/i, "voicemail"],
    [/recording|compliance\s*record/i, "call recording"],
    [/e911|emergency/i, "E911 / emergency services"],
    [/sso|saml|single\s*sign/i, "SSO / SAML"],
    [/provisioning|scim/i, "user provisioning"],
    [/analog|ata\b|fax/i, "analog devices / ATA / fax"],
    [/common\s*area|lobby\s*phone/i, "common area phones"],
    [/hot[- ]?desk/i, "hot desking"],
    [/international|global|multi[- ]?country/i, "international / multi-country"],
    [/port\w*|number\s*transfer/i, "number porting"],
    [/licens\w*|plan\b|pro\b|business\b|enterprise/i, "licensing / plan type"],
    [/integrat\w*|crm|salesforce|hubspot/i, "CRM / integrations"],
    [/migrat\w*|transition|switch\w* from/i, "migration / transition"],
    [/teams|microsoft|cisco|ringcentral|8x8|avaya/i, "competitor / existing platform"],
    [/user\s*count|how\s*many\s*(user|seat|employee)/i, "user count / sizing"],
    [/mobile|softphone|app/i, "mobile / softphone"],
    [/contact\s*center|cc\b|zoom\s*cc/i, "contact center"],
  ];

  for (const [re, label] of patterns) {
    if (re.test(combined)) topics.push(label);
  }

  return topics.length > 0
    ? `Customer interested in: ${topics.join(", ")}`
    : "General inquiry";
}
