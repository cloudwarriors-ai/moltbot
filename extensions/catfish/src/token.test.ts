import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCatfishTokenCache, getCatfishAccessToken } from "./token.js";

describe("getCatfishAccessToken", () => {
  const creds = {
    clientId: "cid",
    clientSecret: "csecret",
    accountId: "acct",
  };

  beforeEach(() => {
    clearCatfishTokenCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("accepts alternate admin scope and returns a token", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          access_token: "token-1",
          expires_in: 3600,
          scope: "team_chat:write:user_message:admin",
        }),
        { status: 200 },
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await getCatfishAccessToken({
      creds,
      oauthBaseUrl: "https://zoom.us",
      requiredScopes: ["teamchat:admin:write", "team_chat:write:user_message:admin"],
    });

    expect(result.accessToken).toBe("token-1");
    expect(result.scopeSet.has("team_chat:write:user_message:admin")).toBe(true);
  });

  it("throws when required scope is missing", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          access_token: "token-1",
          expires_in: 3600,
          scope: "report:read:admin",
        }),
        { status: 200 },
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getCatfishAccessToken({
        creds,
        oauthBaseUrl: "https://zoom.us",
        requiredScopes: ["teamchat:admin:write"],
      }),
    ).rejects.toThrow(/required scope missing/i);
  });

  it("reuses a cached token when still valid", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          access_token: "token-1",
          expires_in: 3600,
          scope: "teamchat:admin:write",
        }),
        { status: 200 },
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    const first = await getCatfishAccessToken({
      creds,
      oauthBaseUrl: "https://zoom.us",
      requiredScopes: ["teamchat:admin:write"],
    });

    const second = await getCatfishAccessToken({
      creds,
      oauthBaseUrl: "https://zoom.us",
      requiredScopes: ["teamchat:admin:write"],
    });

    expect(first.accessToken).toBe("token-1");
    expect(second.accessToken).toBe("token-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
