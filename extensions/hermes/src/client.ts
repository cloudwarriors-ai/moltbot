/**
 * Hermes HTTP Client
 *
 * Thin wrapper around fetch with:
 * - Base URL prepend
 * - Auth headers (X-API-Key, X-Organization-Id)
 * - AbortController timeout on every request
 * - Retry with exponential backoff on transient errors
 * - Structured error classes for meaningful agent feedback
 * - Secret scrubbing in error messages
 */

import type { HermesPluginConfig } from "./types.js";

// ============================================================================
// Error Classes
// ============================================================================

export class HermesApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "HermesApiError";
  }
}

export class HermesConnectionError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "HermesConnectionError";
  }
}

export class HermesNotFoundError extends HermesApiError {
  constructor(message: string, body?: unknown) {
    super(message, 404, body);
    this.name = "HermesNotFoundError";
  }
}

export class HermesAuthError extends HermesApiError {
  constructor(message: string, body?: unknown) {
    super(message, 401, body);
    this.name = "HermesAuthError";
  }
}

// ============================================================================
// Client
// ============================================================================

type RequestOptions = {
  timeoutMs?: number;
  retryOnPost?: boolean;
};

const RETRY_COUNT = 3;
const RETRY_DELAYS = [500, 1000, 2000];
const IDEMPOTENT_METHODS = new Set(["GET", "DELETE"]);

function scrubSecrets(text: string, apiKey?: string): string {
  if (!apiKey) return text;
  return text.replaceAll(apiKey, "[REDACTED]");
}

function isTransientError(status: number): boolean {
  return status >= 500 || status === 429;
}

export class HermesClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly organizationId?: string;
  private readonly defaultTimeoutMs: number;

  constructor(config: HermesPluginConfig) {
    // Strip trailing slash
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.organizationId = config.organizationId;
    this.defaultTimeoutMs = config.timeoutMs;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["X-API-Key"] = this.apiKey;
    }
    if (this.organizationId) {
      headers["X-Organization-Id"] = this.organizationId;
    }
    return headers;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts?: RequestOptions,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const timeoutMs = opts?.timeoutMs ?? this.defaultTimeoutMs;
    const canRetry = IDEMPOTENT_METHODS.has(method) || (method === "POST" && opts?.retryOnPost);
    const maxAttempts = canRetry ? RETRY_COUNT + 1 : 1;

    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        const delay = RETRY_DELAYS[attempt - 1] ?? 2000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          method,
          headers: this.buildHeaders(),
          body: body != null ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (response.ok) {
          const text = await response.text();
          return text ? (JSON.parse(text) as T) : ({} as T);
        }

        // Parse error body
        let errorBody: unknown;
        try {
          errorBody = await response.json();
        } catch {
          errorBody = await response.text().catch(() => undefined);
        }

        const errorMessage =
          errorBody && typeof errorBody === "object" && "error" in errorBody
            ? String((errorBody as Record<string, unknown>).error)
            : `HTTP ${response.status}`;

        // Non-retryable errors — throw immediately
        if (response.status === 401 || response.status === 403) {
          throw new HermesAuthError(
            scrubSecrets(`Hermes auth failed: ${errorMessage}`, this.apiKey),
            errorBody,
          );
        }
        if (response.status === 404) {
          throw new HermesNotFoundError(scrubSecrets(`Not found: ${path}`, this.apiKey), errorBody);
        }

        // Retryable?
        if (isTransientError(response.status) && attempt < maxAttempts - 1) {
          lastError = new HermesApiError(
            scrubSecrets(`Hermes API error: ${errorMessage}`, this.apiKey),
            response.status,
            errorBody,
          );
          continue;
        }

        throw new HermesApiError(
          scrubSecrets(`Hermes API error: ${errorMessage}`, this.apiKey),
          response.status,
          errorBody,
        );
      } catch (error) {
        clearTimeout(timer);

        // Already one of our error types — rethrow unless retryable
        if (error instanceof HermesNotFoundError || error instanceof HermesAuthError) {
          throw error;
        }
        if (error instanceof HermesApiError) {
          if (isTransientError(error.status) && attempt < maxAttempts - 1) {
            lastError = error;
            continue;
          }
          throw error;
        }

        // Network / timeout errors
        const isAbort = error instanceof DOMException && error.name === "AbortError";
        const message = isAbort
          ? `Request timed out after ${timeoutMs}ms: ${method} ${path}`
          : `Connection failed: ${method} ${path}`;

        if (attempt < maxAttempts - 1) {
          lastError = new HermesConnectionError(scrubSecrets(message, this.apiKey), error);
          continue;
        }

        throw new HermesConnectionError(scrubSecrets(message, this.apiKey), error);
      }
    }

    // Should not reach here, but just in case
    throw lastError ?? new HermesConnectionError(`Request failed: ${method} ${path}`);
  }

  async get<T>(path: string, opts?: RequestOptions): Promise<T> {
    return this.request<T>("GET", path, undefined, opts);
  }

  async post<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return this.request<T>("POST", path, body, opts);
  }

  async del<T>(path: string, opts?: RequestOptions): Promise<T> {
    return this.request<T>("DELETE", path, undefined, opts);
  }
}
