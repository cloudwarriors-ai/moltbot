import { describe, expect, it } from "vitest";
import { scrubCrossChannelAnswer } from "./answer-scrub.js";

describe("scrubCrossChannelAnswer", () => {
  it("returns original text when cross-channel disabled", async () => {
    const result = await scrubCrossChannelAnswer({
      answer: "Contact john@acme.com for details",
      sourceChannelSlug: "acme",
      redactionPolicy: "llm",
      crossChannelEnabled: false,
    });
    expect(result.text).toBe("Contact john@acme.com for details");
    expect(result.scrubbed).toBe(false);
  });

  it("returns original text when policy is off", async () => {
    const result = await scrubCrossChannelAnswer({
      answer: "Contact john@acme.com for details",
      sourceChannelSlug: "acme",
      redactionPolicy: "off",
      crossChannelEnabled: true,
    });
    expect(result.text).toBe("Contact john@acme.com for details");
    expect(result.scrubbed).toBe(false);
  });

  it("redacts email addresses", async () => {
    const result = await scrubCrossChannelAnswer({
      answer: "Contact john@acme.com for details",
      sourceChannelSlug: "acme",
      redactionPolicy: "llm",
      crossChannelEnabled: true,
    });
    expect(result.text).toBe("Contact [redacted-email] for details");
    expect(result.scrubbed).toBe(true);
  });

  it("redacts phone numbers", async () => {
    const result = await scrubCrossChannelAnswer({
      answer: "Call 555-123-4567 or (800) 555-0199",
      sourceChannelSlug: "test",
      redactionPolicy: "llm",
      crossChannelEnabled: true,
    });
    expect(result.text).not.toContain("555-123-4567");
    expect(result.text).not.toContain("555-0199");
    expect(result.scrubbed).toBe(true);
  });

  it("redacts IP addresses", async () => {
    const result = await scrubCrossChannelAnswer({
      answer: "Server is at 192.168.1.100",
      sourceChannelSlug: "test",
      redactionPolicy: "llm",
      crossChannelEnabled: true,
    });
    expect(result.text).toBe("Server is at [redacted-ip]");
    expect(result.scrubbed).toBe(true);
  });

  it("redacts customer-specific URL paths", async () => {
    const result = await scrubCrossChannelAnswer({
      answer: "See https://portal.example.com/customers/acme/dashboard",
      sourceChannelSlug: "test",
      redactionPolicy: "llm",
      crossChannelEnabled: true,
    });
    expect(result.text).toContain("[redacted-path]");
    expect(result.text).not.toContain("/customers/acme");
    expect(result.scrubbed).toBe(true);
  });

  it("does not scrub text without PII", async () => {
    const result = await scrubCrossChannelAnswer({
      answer: "The recommended setup uses Microsoft Teams with 500 users",
      sourceChannelSlug: "test",
      redactionPolicy: "llm",
      crossChannelEnabled: true,
    });
    expect(result.text).toBe("The recommended setup uses Microsoft Teams with 500 users");
    expect(result.scrubbed).toBe(false);
  });
});
