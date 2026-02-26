export type CatfishErrorCode =
  | "CATFISH_INVALID_JID"
  | "CATFISH_INVALID_TARGET"
  | "CATFISH_SCOPE_MISSING"
  | "CATFISH_AUTH_FAILED"
  | "CATFISH_PERMISSION_DENIED"
  | "CATFISH_RATE_LIMITED"
  | "CATFISH_API_ERROR";

export class CatfishError extends Error {
  code: CatfishErrorCode;
  statusCode?: number;

  constructor(params: {
    code: CatfishErrorCode;
    message: string;
    statusCode?: number;
    cause?: unknown;
  }) {
    super(params.message, params.cause ? { cause: params.cause } : undefined);
    this.name = "CatfishError";
    this.code = params.code;
    this.statusCode = params.statusCode;
  }
}

export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  try {
    return JSON.stringify(err) ?? "unknown error";
  } catch {
    return "unknown error";
  }
}

export function isCatfishError(err: unknown): err is CatfishError {
  return err instanceof CatfishError;
}

export function invalidJidError(jid: string): CatfishError {
  return new CatfishError({
    code: "CATFISH_INVALID_JID",
    message: `invalid Zoom JID: ${jid}`,
  });
}

export function invalidTargetError(target: string): CatfishError {
  return new CatfishError({
    code: "CATFISH_INVALID_TARGET",
    message: `invalid target: ${target}`,
  });
}

export function scopeMissingError(requiredScopes: string[], scopeText?: string): CatfishError {
  const details = scopeText ? ` token scopes: ${scopeText}` : "";
  return new CatfishError({
    code: "CATFISH_SCOPE_MISSING",
    message: `required scope missing (${requiredScopes.join(", ")}).${details}`,
  });
}

export function authFailedError(
  message: string,
  statusCode?: number,
  cause?: unknown,
): CatfishError {
  return new CatfishError({
    code: "CATFISH_AUTH_FAILED",
    message,
    statusCode,
    cause,
  });
}

export function mapApiError(statusCode: number, bodyText: string): CatfishError {
  const normalized = bodyText.toLowerCase();
  const scopedMessage = bodyText.trim() || `HTTP ${statusCode}`;

  if (statusCode === 403 && normalized.includes("scope")) {
    return new CatfishError({
      code: "CATFISH_SCOPE_MISSING",
      message: `Zoom API rejected scope: ${scopedMessage}`,
      statusCode,
    });
  }

  if (statusCode === 401) {
    return new CatfishError({
      code: "CATFISH_AUTH_FAILED",
      message: `Zoom API auth failure: ${scopedMessage}`,
      statusCode,
    });
  }

  if (statusCode === 403) {
    return new CatfishError({
      code: "CATFISH_PERMISSION_DENIED",
      message: `Zoom API permission denied: ${scopedMessage}`,
      statusCode,
    });
  }

  if (statusCode === 429) {
    return new CatfishError({
      code: "CATFISH_RATE_LIMITED",
      message: `Zoom API rate limited request: ${scopedMessage}`,
      statusCode,
    });
  }

  return new CatfishError({
    code: "CATFISH_API_ERROR",
    message: `Zoom API error (${statusCode}): ${scopedMessage}`,
    statusCode,
  });
}
