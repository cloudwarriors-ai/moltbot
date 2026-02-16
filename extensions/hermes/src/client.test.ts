import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  HermesClient,
  HermesConnectionError,
  HermesNotFoundError,
  HermesAuthError,
  HermesApiError,
} from "./client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("HermesClient", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  function createClient(overrides?: Record<string, unknown>) {
    return new HermesClient({
      baseUrl: "http://localhost:3345",
      apiKey: "test-secret-key",
      organizationId: "org-123",
      timeoutMs: 5000,
      ...overrides,
    });
  }

  describe("headers", () => {
    it("sends API key and org ID headers", async () => {
      let capturedHeaders: Record<string, string> = {};
      globalThis.fetch = vi.fn(async (_, init) => {
        const h = init?.headers as Record<string, string>;
        capturedHeaders = { ...h };
        return jsonResponse({ ok: true });
      }) as unknown as typeof fetch;

      const client = createClient();
      await client.get("/health");

      expect(capturedHeaders["X-API-Key"]).toBe("test-secret-key");
      expect(capturedHeaders["X-Organization-Id"]).toBe("org-123");
      expect(capturedHeaders["Content-Type"]).toBe("application/json");
    });

    it("omits API key header when not configured", async () => {
      let capturedHeaders: Record<string, string> = {};
      globalThis.fetch = vi.fn(async (_, init) => {
        const h = init?.headers as Record<string, string>;
        capturedHeaders = { ...h };
        return jsonResponse({ ok: true });
      }) as unknown as typeof fetch;

      const client = createClient({ apiKey: undefined });
      await client.get("/health");

      expect(capturedHeaders["X-API-Key"]).toBeUndefined();
    });
  });

  describe("successful requests", () => {
    it("GET parses JSON response", async () => {
      globalThis.fetch = vi.fn(async () =>
        jsonResponse({ status: "healthy" }),
      ) as unknown as typeof fetch;

      const client = createClient();
      const result = await client.get<{ status: string }>("/health");
      expect(result.status).toBe("healthy");
    });

    it("POST sends body", async () => {
      let capturedBody: string | undefined;
      globalThis.fetch = vi.fn(async (_, init) => {
        capturedBody = init?.body as string;
        return jsonResponse({ id: "wf-1" });
      }) as unknown as typeof fetch;

      const client = createClient();
      await client.post("/api/prompt/send", { prompt: "test" });
      expect(JSON.parse(capturedBody!)).toEqual({ prompt: "test" });
    });

    it("DELETE works", async () => {
      globalThis.fetch = vi.fn(async () =>
        jsonResponse({ deleted: true }),
      ) as unknown as typeof fetch;

      const client = createClient();
      const result = await client.del<{ deleted: boolean }>("/api/workflows/123");
      expect(result.deleted).toBe(true);
    });
  });

  describe("error mapping", () => {
    it("throws HermesNotFoundError on 404", async () => {
      globalThis.fetch = vi.fn(async () =>
        errorResponse("Workflow not found", 404),
      ) as unknown as typeof fetch;

      const client = createClient();
      await expect(client.get("/api/workflows/missing")).rejects.toThrow(HermesNotFoundError);
    });

    it("throws HermesAuthError on 401", async () => {
      globalThis.fetch = vi.fn(async () =>
        errorResponse("Unauthorized", 401),
      ) as unknown as typeof fetch;

      const client = createClient();
      await expect(client.get("/api/workflows")).rejects.toThrow(HermesAuthError);
    });

    it("throws HermesApiError on 400", async () => {
      globalThis.fetch = vi.fn(async () =>
        errorResponse("Bad request", 400),
      ) as unknown as typeof fetch;

      const client = createClient();
      await expect(client.post("/api/prompt/send", {})).rejects.toThrow(HermesApiError);
    });
  });

  describe("retry logic", () => {
    it("retries GET on 500 and succeeds", async () => {
      let calls = 0;
      globalThis.fetch = vi.fn(async () => {
        calls++;
        if (calls < 3) return errorResponse("Internal error", 500);
        return jsonResponse({ ok: true });
      }) as unknown as typeof fetch;

      const client = createClient();
      const result = await client.get<{ ok: boolean }>("/health");

      expect(result.ok).toBe(true);
      expect(calls).toBe(3);
    });

    it("does NOT retry POST by default", async () => {
      let calls = 0;
      globalThis.fetch = vi.fn(async () => {
        calls++;
        return errorResponse("Internal error", 500);
      }) as unknown as typeof fetch;

      const client = createClient();
      await expect(client.post("/api/prompt/send", {})).rejects.toThrow(HermesApiError);
      expect(calls).toBe(1);
    });

    it("retries POST when retryOnPost is set", async () => {
      let calls = 0;
      globalThis.fetch = vi.fn(async () => {
        calls++;
        if (calls < 2) return errorResponse("Internal error", 500);
        return jsonResponse({ ok: true });
      }) as unknown as typeof fetch;

      const client = createClient();
      const result = await client.post<{ ok: boolean }>("/test", {}, { retryOnPost: true });

      expect(result.ok).toBe(true);
      expect(calls).toBe(2);
    });

    it("does NOT retry 404 errors", async () => {
      let calls = 0;
      globalThis.fetch = vi.fn(async () => {
        calls++;
        return errorResponse("Not found", 404);
      }) as unknown as typeof fetch;

      const client = createClient();
      await expect(client.get("/missing")).rejects.toThrow(HermesNotFoundError);
      expect(calls).toBe(1);
    });
  });

  describe("timeout", () => {
    it("throws HermesConnectionError on timeout", async () => {
      globalThis.fetch = vi.fn(async (_, init) => {
        // Wait for abort signal
        return new Promise<Response>((_, reject) => {
          (init?.signal as AbortSignal)?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }) as unknown as typeof fetch;

      const client = createClient({ timeoutMs: 100 });
      await expect(client.get("/slow")).rejects.toThrow(HermesConnectionError);
    });
  });

  describe("secret scrubbing", () => {
    it("redacts API key in error messages", async () => {
      globalThis.fetch = vi.fn(async () =>
        errorResponse("Invalid key: test-secret-key", 400),
      ) as unknown as typeof fetch;

      const client = createClient();
      try {
        await client.get("/test");
        expect.fail("Should have thrown");
      } catch (e) {
        const msg = (e as Error).message;
        expect(msg).not.toContain("test-secret-key");
        expect(msg).toContain("[REDACTED]");
      }
    });
  });

  describe("URL construction", () => {
    it("strips trailing slash from baseUrl", async () => {
      let capturedUrl = "";
      globalThis.fetch = vi.fn(async (url) => {
        capturedUrl = url as string;
        return jsonResponse({ ok: true });
      }) as unknown as typeof fetch;

      const client = createClient({ baseUrl: "http://localhost:3345/" });
      await client.get("/health");
      expect(capturedUrl).toBe("http://localhost:3345/health");
    });
  });
});
