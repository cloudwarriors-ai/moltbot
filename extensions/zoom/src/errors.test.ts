import { describe, expect, it } from "vitest";

import { classifyZoomSendError, formatZoomSendErrorHint } from "./errors.js";

describe("formatZoomSendErrorHint", () => {
  it("returns to_jid-specific hint for unknown user/channel 403", () => {
    const classification = classifyZoomSendError({
      statusCode: 403,
      message:
        "{\"code\":7004,\"message\":\"No channel or user can be found with the given to_jid.\",\"result\":false}",
    });
    expect(formatZoomSendErrorHint(classification)).toBe(
      "invalid recipient JID: use the Zoom user's ...@xmpp.zoom.us JID (not email)",
    );
  });

  it("returns deactivated-user hint for 403", () => {
    const classification = classifyZoomSendError({
      statusCode: 403,
      message:
        "{\"code\":7004,\"message\":\"Message sent from or to deactivated user\",\"result\":false}",
    });
    expect(formatZoomSendErrorHint(classification)).toBe(
      "recipient or sender account is deactivated in Zoom",
    );
  });
});
