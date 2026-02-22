/**
 * Lightweight LLM pre-filter for observe-mode messages.
 * Classifies a message as actionable (RESPOND) or casual (SKIP)
 * before the comfort ack is sent, avoiding awkward replies to small talk.
 *
 * Fail-open: returns true on any error so real questions are never dropped.
 *
 * The system prompt and model can be changed at runtime by editing the config
 * file at PREFILTER_CONFIG_PATH — no restart needed.
 *
 * Few-shot training: when a reviewer clicks "Allow" or "Dismiss" on a filtered
 * message, the example is saved to PREFILTER_EXAMPLES_PATH. These examples are
 * included in the prompt as few-shot demonstrations so the classifier learns
 * from reviewer feedback over time.
 */

import fs from "node:fs";

console.log("[prefilter] module loaded");

export const PREFILTER_CONFIG_PATH = "/root/.openclaw/prefilter-config.json";
export const PREFILTER_EXAMPLES_PATH = "/root/.openclaw/prefilter-examples.json";
const MAX_EXAMPLES = 50;
const EXAMPLES_IN_PROMPT = 20;

export const DEFAULT_SYSTEM_PROMPT = `You are a message classifier for a business support chatbot monitoring a customer channel.
Classify the user message as either RESPOND or SKIP.

RESPOND: questions, requests, problems, complaints, technical issues, customer context (user counts, platforms, licensing), or anything that needs a substantive answer.
SKIP: casual chat, greetings, acknowledgments, thanks, small talk, emojis, "ok", "sounds good", "lol", etc.

Reply with exactly one word: RESPOND or SKIP`;

export const DEFAULT_MODEL = "anthropic/claude-haiku-4.5";

export interface PrefilterConfig {
  systemPrompt: string;
  model?: string;
}

/** Feature flag: disable prefilter classifier entirely when set false-ish. */
export function isPrefilterEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.ZOOM_PREFILTER_ENABLED?.trim().toLowerCase();
  if (!raw) return true;
  return !["0", "false", "off", "no", "disabled"].includes(raw);
}

export type PrefilterExample = {
  text: string;
  label: "RESPOND" | "SKIP";
  addedAt: string;
  channel?: string;
};

/** Read the config file, falling back to defaults if missing or invalid. */
export function readPrefilterConfig(): PrefilterConfig {
  try {
    const raw = fs.readFileSync(PREFILTER_CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      systemPrompt: typeof parsed.systemPrompt === "string" ? parsed.systemPrompt : DEFAULT_SYSTEM_PROMPT,
      model: typeof parsed.model === "string" ? parsed.model : undefined,
    };
  } catch {
    return { systemPrompt: DEFAULT_SYSTEM_PROMPT };
  }
}

/** Read saved few-shot examples. */
function readExamples(): PrefilterExample[] {
  try {
    const raw = fs.readFileSync(PREFILTER_EXAMPLES_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Save a reviewer feedback example (Allow → RESPOND, Dismiss → SKIP). */
export function savePrefilterExample(text: string, label: "RESPOND" | "SKIP", channel?: string): void {
  const examples = readExamples();
  // Dedupe: don't add if an identical text already exists
  const normalized = text.trim().toLowerCase();
  if (examples.some((e) => e.text.trim().toLowerCase() === normalized)) {
    console.log(`[prefilter] example already exists, skipping: ${label} "${text.slice(0, 60)}"`);
    return;
  }
  examples.push({ text: text.trim(), label, addedAt: new Date().toISOString(), channel });
  // Keep only the most recent MAX_EXAMPLES
  const trimmed = examples.slice(-MAX_EXAMPLES);
  try {
    fs.writeFileSync(PREFILTER_EXAMPLES_PATH, JSON.stringify(trimmed, null, 2));
    console.log(`[prefilter] saved ${label} example: "${text.slice(0, 60)}"`);
  } catch (err) {
    console.log("[prefilter] failed to save example:", err);
  }
}

/** Build few-shot messages from saved examples. */
function buildFewShotMessages(): Array<{ role: "user" | "assistant"; content: string }> {
  const examples = readExamples();
  // Take the most recent EXAMPLES_IN_PROMPT
  const recent = examples.slice(-EXAMPLES_IN_PROMPT);
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const ex of recent) {
    messages.push({ role: "user", content: ex.text });
    messages.push({ role: "assistant", content: ex.label });
  }
  return messages;
}

export async function shouldRespond(
  text: string,
  opts?: { apiKey?: string; model?: string },
): Promise<boolean> {
  console.log("[prefilter] shouldRespond called:", text.slice(0, 80));

  const apiKey = opts?.apiKey || process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.log("[prefilter] no API key, fail-open");
    return true;
  }

  const config = readPrefilterConfig();
  const model = opts?.model || config.model || process.env.ZOOM_PREFILTER_MODEL || DEFAULT_MODEL;
  const systemPrompt = config.systemPrompt;
  const fewShot = buildFewShotMessages();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 3,
        temperature: 0,
        messages: [
          { role: "system", content: systemPrompt },
          ...fewShot,
          { role: "user", content: text },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.log("[prefilter] API error:", res.status, res.statusText);
      return true; // fail-open
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const answer = data.choices?.[0]?.message?.content?.trim().toUpperCase() ?? "";
    const result = answer !== "SKIP";
    console.log(`[prefilter] result: ${answer} → ${result ? "RESPOND" : "SKIP"} (${fewShot.length / 2} examples)`);
    return result;
  } catch (err) {
    console.log("[prefilter] error:", err);
    return true; // fail-open on timeout or network error
  } finally {
    clearTimeout(timeout);
  }
}
