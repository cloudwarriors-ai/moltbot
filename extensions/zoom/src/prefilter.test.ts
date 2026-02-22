import { describe, expect, it } from "vitest";

import { isPrefilterEnabled } from "./prefilter.js";

describe("isPrefilterEnabled", () => {
  it("defaults to enabled when unset", () => {
    expect(isPrefilterEnabled({})).toBe(true);
  });

  it("disables for false-ish values", () => {
    expect(isPrefilterEnabled({ ZOOM_PREFILTER_ENABLED: "false" })).toBe(false);
    expect(isPrefilterEnabled({ ZOOM_PREFILTER_ENABLED: "0" })).toBe(false);
    expect(isPrefilterEnabled({ ZOOM_PREFILTER_ENABLED: "off" })).toBe(false);
    expect(isPrefilterEnabled({ ZOOM_PREFILTER_ENABLED: "no" })).toBe(false);
    expect(isPrefilterEnabled({ ZOOM_PREFILTER_ENABLED: "disabled" })).toBe(false);
  });

  it("enables for true-ish values", () => {
    expect(isPrefilterEnabled({ ZOOM_PREFILTER_ENABLED: "true" })).toBe(true);
    expect(isPrefilterEnabled({ ZOOM_PREFILTER_ENABLED: "1" })).toBe(true);
    expect(isPrefilterEnabled({ ZOOM_PREFILTER_ENABLED: "on" })).toBe(true);
  });
});
