/**
 * Optional reply redaction for cross-channel answers.
 * When cross-channel training is enabled and redactionPolicy is "llm",
 * this module scrubs customer-identifying information from answers
 * that may reference data from other customer channels.
 */

import type { RedactionPolicy } from "./observe-config.js";

export type ScrubContext = {
  answer: string;
  sourceChannelSlug: string;
  redactionPolicy: RedactionPolicy;
  crossChannelEnabled: boolean;
};

export type ScrubResult = {
  text: string;
  scrubbed: boolean;
  error?: string;
};

/**
 * Scrub cross-channel customer identifiers from an answer.
 * Only runs when:
 * - cross-channel is enabled
 * - redactionPolicy is "llm"
 *
 * Fail-open: returns original text on error with a warning flag.
 */
export async function scrubCrossChannelAnswer(ctx: ScrubContext): Promise<ScrubResult> {
  if (!ctx.crossChannelEnabled || ctx.redactionPolicy !== "llm") {
    return { text: ctx.answer, scrubbed: false };
  }

  try {
    // Pattern-based scrubbing: remove common customer identifiers
    let scrubbed = ctx.answer;

    // Remove email addresses
    scrubbed = scrubbed.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, "[redacted-email]");

    // Remove phone numbers (various formats)
    scrubbed = scrubbed.replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, "[redacted-phone]");

    // Remove IP addresses
    scrubbed = scrubbed.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "[redacted-ip]");

    // Remove URLs with customer-specific paths
    scrubbed = scrubbed.replace(/https?:\/\/[^\s]+/g, (url) => {
      try {
        const parsed = new URL(url);
        // Keep the domain but redact path if it looks customer-specific
        if (parsed.pathname.length > 1 && parsed.pathname !== "/") {
          return `${parsed.protocol}//${parsed.hostname}/[redacted-path]`;
        }
        return url;
      } catch {
        return url;
      }
    });

    const didScrub = scrubbed !== ctx.answer;
    return { text: scrubbed, scrubbed: didScrub };
  } catch (err) {
    // Fail-open: return original text with error flag
    const message = err instanceof Error ? err.message : String(err);
    return { text: ctx.answer, scrubbed: false, error: `scrub failed (fail-open): ${message}` };
  }
}
