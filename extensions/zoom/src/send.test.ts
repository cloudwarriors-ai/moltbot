import { describe, expect, it } from "vitest";

import { formatZoomSpeakerHeading } from "./send.js";

describe("formatZoomSpeakerHeading", () => {
  it("uses default heading when speaker is missing", () => {
    expect(formatZoomSpeakerHeading()).toBe("cwbot says:");
    expect(formatZoomSpeakerHeading("   ")).toBe("cwbot says:");
  });

  it("formats agent-specific heading", () => {
    expect(formatZoomSpeakerHeading("PulseBot")).toBe("PulseBot says:");
  });
});
