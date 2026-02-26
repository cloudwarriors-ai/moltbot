import { describe, expect, it, vi } from "vitest";
import {
  createZoomUserLookupResolver,
  extractZoomUserIdFromJid,
  normalizeZoomLookupId,
} from "./zoom-user-lookup.js";

describe("zoom-user-lookup", () => {
  it("extracts a user id from an xmpp JID", () => {
    expect(extractZoomUserIdFromJid("User-123@xmpp.zoom.us")).toBe("User-123");
    expect(extractZoomUserIdFromJid("channel@conference.xmpp.zoom.us")).toBeUndefined();
    expect(extractZoomUserIdFromJid("not-a-jid")).toBeUndefined();
  });

  it("normalizes JIDs for lookup IDs", () => {
    expect(normalizeZoomLookupId("user-123@xmpp.zoom.us")).toBe("user-123");
    expect(normalizeZoomLookupId("plain-id")).toBe("plain-id");
    expect(normalizeZoomLookupId("trent@example.com")).toBeUndefined();
  });

  it("prefers direct /users/{id} lookup when available", async () => {
    const apiFetch = vi.fn(async (endpoint: string) => {
      if (endpoint === "/users/user-123") {
        return {
          ok: true,
          status: 200,
          data: {
            id: "User-123",
            email: "trent.charlton@cloudwarriors.ai",
          },
        };
      }
      return { ok: false, status: 404, error: "not found" };
    });

    const resolver = createZoomUserLookupResolver({ apiFetch });
    const identity = await resolver.resolveIdentity(["user-123@xmpp.zoom.us"]);

    expect(identity.source).toBe("direct");
    expect(identity.userId).toBe("User-123");
    expect(identity.email).toBe("trent.charlton@cloudwarriors.ai");
  });

  it("falls back to users list and matches case-insensitively", async () => {
    const apiFetch = vi.fn(async (endpoint: string) => {
      if (endpoint.startsWith("/users/user-123")) {
        return { ok: false, status: 404, error: "not found" };
      }
      if (endpoint.startsWith("/users?")) {
        return {
          ok: true,
          status: 200,
          data: {
            users: [
              { id: "MCzsBUKYQle4uyqBHCew3Q", email: "trent.charlton@cloudwarriors.ai" },
              { id: "someone-else", email: "someone@example.com" },
            ],
          },
        };
      }
      return { ok: false, status: 404, error: "not found" };
    });

    const resolver = createZoomUserLookupResolver({ apiFetch });
    const identity = await resolver.resolveIdentity(["mczsbukyqle4uyqbhcew3q@xmpp.zoom.us"]);

    expect(identity.source).toBe("users_list");
    expect(identity.userId).toBe("MCzsBUKYQle4uyqBHCew3Q");
    expect(identity.email).toBe("trent.charlton@cloudwarriors.ai");
  });
});
