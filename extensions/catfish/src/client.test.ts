import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCatfishClient } from "./client.js";
import { isCatfishError } from "./errors.js";
import { clearCatfishTokenCache } from "./token.js";

function tokenResponse(scope = "teamchat:admin:write") {
  return new Response(
    JSON.stringify({
      access_token: "token-1",
      expires_in: 3600,
      scope,
    }),
    { status: 200 },
  );
}

function toUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) {
    return input;
  }
  if (typeof input === "string") {
    return new URL(input);
  }
  return new URL(input.url);
}

function parseJsonBody(init?: RequestInit): Record<string, unknown> {
  if (!init || typeof init.body !== "string") {
    throw new Error("expected string request body");
  }
  return JSON.parse(init.body) as Record<string, unknown>;
}

describe("createCatfishClient", () => {
  let tempStateDir = "";

  beforeEach(async () => {
    clearCatfishTokenCache();
    tempStateDir = await mkdtemp(join(tmpdir(), "catfish-client-test-"));
  });

  afterEach(async () => {
    await rm(tempStateDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends DM payloads with to_contact", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = toUrl(input);
      if (url.pathname === "/oauth/token") {
        return tokenResponse();
      }
      if (url.pathname === "/v2/users/user-123") {
        return new Response(
          JSON.stringify({ id: "User-123", email: "trent.charlton@cloudwarriors.ai" }),
          { status: 200 },
        );
      }
      if (url.pathname === "/v2/chat/users/User-123/messages") {
        const body = parseJsonBody(init);
        expect(body.message).toBe("hello world");
        expect(body.to_contact).toBe("friend-id");
        expect(body.to_channel).toBeUndefined();
        return new Response(JSON.stringify({ message_id: "msg-1" }), { status: 201 });
      }

      return new Response("not found", { status: 404 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = createCatfishClient({
      config: {
        clientId: "cid",
        clientSecret: "secret",
        accountId: "acct",
        requiredScopes: ["teamchat:admin:write", "team_chat:write:user_message:admin"],
        oauthBaseUrl: "https://zoom.us",
        apiBaseUrl: "https://api.zoom.us/v2",
        usersListPageSize: 300,
        usersListMaxPages: 10,
        cacheTtlMs: 60_000,
      },
      stateDir: tempStateDir,
    });

    const result = await client.send("user-123@xmpp.zoom.us", "friend-id", "hello world");

    expect(result.ok).toBe(true);
    expect(result.targetType).toBe("dm");
    expect(result.targetId).toBe("friend-id");
    expect(result.senderUserId).toBe("User-123");
    expect(result.messageId).toBe("msg-1");
  });

  it("sends channel payloads with to_channel and strips conference JID", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = toUrl(input);
      if (url.pathname === "/oauth/token") {
        return tokenResponse();
      }
      if (url.pathname === "/v2/users/user-123") {
        return new Response(JSON.stringify({ id: "User-123" }), { status: 200 });
      }
      if (url.pathname === "/v2/chat/users/User-123/messages") {
        const body = parseJsonBody(init);
        expect(body.to_channel).toBe("channel-abc");
        expect(body.to_contact).toBeUndefined();
        return new Response(JSON.stringify({ message_id: "msg-2" }), { status: 200 });
      }

      return new Response("not found", { status: 404 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = createCatfishClient({
      config: {
        clientId: "cid",
        clientSecret: "secret",
        accountId: "acct",
        requiredScopes: ["teamchat:admin:write"],
        oauthBaseUrl: "https://zoom.us",
        apiBaseUrl: "https://api.zoom.us/v2",
        usersListPageSize: 300,
        usersListMaxPages: 10,
        cacheTtlMs: 60_000,
      },
      stateDir: tempStateDir,
    });

    const result = await client.send(
      "user-123@xmpp.zoom.us",
      "channel-abc@conference.xmpp.zoom.us",
      "channel hello",
      { targetType: "channel" },
    );

    expect(result.ok).toBe(true);
    expect(result.targetType).toBe("channel");
    expect(result.targetId).toBe("channel-abc");
  });

  it("falls back to sender JID local-part when user lookup fails", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = toUrl(input);
      if (url.pathname === "/oauth/token") {
        return tokenResponse();
      }
      if (url.pathname === "/v2/users/user-lower") {
        return new Response("not found", { status: 404 });
      }
      if (url.pathname === "/v2/users") {
        return new Response(JSON.stringify({ users: [] }), { status: 200 });
      }
      if (url.pathname === "/v2/chat/users/user-lower/messages") {
        const body = parseJsonBody(init);
        expect(body.to_contact).toBe("friend-id");
        return new Response(JSON.stringify({ message_id: "msg-3" }), { status: 200 });
      }

      return new Response("not found", { status: 404 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = createCatfishClient({
      config: {
        clientId: "cid",
        clientSecret: "secret",
        accountId: "acct",
        requiredScopes: ["teamchat:admin:write"],
        oauthBaseUrl: "https://zoom.us",
        apiBaseUrl: "https://api.zoom.us/v2",
        usersListPageSize: 300,
        usersListMaxPages: 10,
        cacheTtlMs: 60_000,
      },
      stateDir: tempStateDir,
    });

    const result = await client.send("user-lower@xmpp.zoom.us", "friend-id", "hi");
    expect(result.senderUserId).toBe("user-lower");
  });

  it("maps 403 responses to CATFISH_PERMISSION_DENIED", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = toUrl(input);
      if (url.pathname === "/oauth/token") {
        return tokenResponse();
      }
      if (url.pathname === "/v2/users/user-123") {
        return new Response(JSON.stringify({ id: "User-123" }), { status: 200 });
      }
      if (url.pathname === "/v2/chat/users/User-123/messages") {
        return new Response("forbidden", { status: 403 });
      }

      return new Response("not found", { status: 404 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = createCatfishClient({
      config: {
        clientId: "cid",
        clientSecret: "secret",
        accountId: "acct",
        requiredScopes: ["teamchat:admin:write"],
        oauthBaseUrl: "https://zoom.us",
        apiBaseUrl: "https://api.zoom.us/v2",
        usersListPageSize: 300,
        usersListMaxPages: 10,
        cacheTtlMs: 60_000,
      },
      stateDir: tempStateDir,
    });

    await expect(client.send("user-123@xmpp.zoom.us", "friend-id", "hi")).rejects.toMatchObject({
      code: "CATFISH_PERMISSION_DENIED",
      statusCode: 403,
    });
  });

  it("maps 429 responses to CATFISH_RATE_LIMITED", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = toUrl(input);
      if (url.pathname === "/oauth/token") {
        return tokenResponse();
      }
      if (url.pathname === "/v2/users/user-123") {
        return new Response(JSON.stringify({ id: "User-123" }), { status: 200 });
      }
      if (url.pathname === "/v2/chat/users/User-123/messages") {
        return new Response("too many", { status: 429 });
      }

      return new Response("not found", { status: 404 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = createCatfishClient({
      config: {
        clientId: "cid",
        clientSecret: "secret",
        accountId: "acct",
        requiredScopes: ["teamchat:admin:write"],
        oauthBaseUrl: "https://zoom.us",
        apiBaseUrl: "https://api.zoom.us/v2",
        usersListPageSize: 300,
        usersListMaxPages: 10,
        cacheTtlMs: 60_000,
      },
      stateDir: tempStateDir,
    });

    try {
      await client.send("user-123@xmpp.zoom.us", "friend-id", "hi");
      throw new Error("expected send failure");
    } catch (err) {
      expect(isCatfishError(err)).toBe(true);
      expect((err as { code?: string }).code).toBe("CATFISH_RATE_LIMITED");
    }
  });

  it("throws CATFISH_SCOPE_MISSING when token scopes do not match", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = toUrl(input);
      if (url.pathname === "/oauth/token") {
        return tokenResponse("report:read:admin");
      }

      return new Response("not found", { status: 404 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = createCatfishClient({
      config: {
        clientId: "cid",
        clientSecret: "secret",
        accountId: "acct",
        requiredScopes: ["teamchat:admin:write"],
        oauthBaseUrl: "https://zoom.us",
        apiBaseUrl: "https://api.zoom.us/v2",
        usersListPageSize: 300,
        usersListMaxPages: 10,
        cacheTtlMs: 60_000,
      },
      stateDir: tempStateDir,
    });

    await expect(client.send("user-123@xmpp.zoom.us", "friend-id", "hi")).rejects.toMatchObject({
      code: "CATFISH_SCOPE_MISSING",
    });
  });

  it("writes an audit row for invalid JID failures before API calls", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = createCatfishClient({ stateDir: tempStateDir });

    await expect(client.send("not-a-zoom-jid", "friend-id", "hello")).rejects.toMatchObject({
      code: "CATFISH_INVALID_JID",
    });
    expect(fetchMock).not.toHaveBeenCalled();

    const auditLogPath = client.getAuditLogPath();
    const lines = (await readFile(auditLogPath, "utf8"))
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const last = JSON.parse(lines.at(-1) ?? "{}") as {
      ok?: boolean;
      errorCode?: string;
      message?: string;
    };
    expect(last.ok).toBe(false);
    expect(last.errorCode).toBe("CATFISH_INVALID_JID");
    expect(last.message).toBe("hello");
  });
});
