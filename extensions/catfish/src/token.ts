import type { CatfishCredentials } from "./config.js";
import { authFailedError, scopeMissingError, toErrorMessage } from "./errors.js";

const TOKEN_EXPIRY_BUFFER_MS = 60_000;

type TokenState = {
  accessToken: string;
  expiresAt: number;
  scopeText?: string;
  scopeSet: Set<string>;
};

type TokenCacheEntry = {
  token?: TokenState;
  inFlight?: Promise<TokenState>;
};

const tokenCache = new Map<string, TokenCacheEntry>();

function buildCacheKey(params: { creds: CatfishCredentials; oauthBaseUrl: string }): string {
  const { creds, oauthBaseUrl } = params;
  return `${oauthBaseUrl}|${creds.clientId}|${creds.accountId}`;
}

function splitScopes(scopeText: string | undefined): Set<string> {
  if (!scopeText) {
    return new Set();
  }
  return new Set(
    scopeText
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function hasRequiredScope(requiredScopes: string[], actualScopes: Set<string>): boolean {
  if (requiredScopes.length === 0) {
    return true;
  }
  for (const required of requiredScopes) {
    if (actualScopes.has(required)) {
      return true;
    }
  }
  return false;
}

async function fetchToken(params: {
  creds: CatfishCredentials;
  oauthBaseUrl: string;
  requiredScopes: string[];
}): Promise<TokenState> {
  const authHeader = Buffer.from(`${params.creds.clientId}:${params.creds.clientSecret}`).toString(
    "base64",
  );

  const tokenUrl =
    `${params.oauthBaseUrl}/oauth/token?grant_type=account_credentials` +
    `&account_id=${encodeURIComponent(params.creds.accountId)}`;

  let response: Response;
  try {
    response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authHeader}`,
      },
    });
  } catch (err) {
    throw authFailedError("Zoom token request failed", undefined, err);
  }

  const bodyText = await response.text().catch(() => "");
  if (!response.ok) {
    throw authFailedError(
      `Zoom token request failed (${response.status}): ${bodyText || "unknown error"}`,
      response.status,
    );
  }

  let parsed: {
    access_token?: string;
    expires_in?: number;
    scope?: string;
  };
  try {
    parsed = JSON.parse(bodyText) as {
      access_token?: string;
      expires_in?: number;
      scope?: string;
    };
  } catch (err) {
    throw authFailedError("Zoom token response was not JSON", response.status, err);
  }

  if (!parsed.access_token || typeof parsed.access_token !== "string") {
    throw authFailedError("Zoom token response missing access_token", response.status);
  }

  const scopeText = typeof parsed.scope === "string" ? parsed.scope.trim() : undefined;
  const scopeSet = splitScopes(scopeText);
  if (scopeText && !hasRequiredScope(params.requiredScopes, scopeSet)) {
    throw scopeMissingError(params.requiredScopes, scopeText);
  }

  const expiresInSeconds =
    typeof parsed.expires_in === "number" && Number.isFinite(parsed.expires_in)
      ? Math.max(1, parsed.expires_in)
      : 3600;

  return {
    accessToken: parsed.access_token,
    expiresAt: Date.now() + expiresInSeconds * 1000,
    scopeText,
    scopeSet,
  };
}

export async function getCatfishAccessToken(params: {
  creds: CatfishCredentials;
  oauthBaseUrl: string;
  requiredScopes: string[];
  forceRefresh?: boolean;
}): Promise<TokenState> {
  const cacheKey = buildCacheKey({ creds: params.creds, oauthBaseUrl: params.oauthBaseUrl });
  const cached = tokenCache.get(cacheKey) ?? {};

  if (!params.forceRefresh && cached.token) {
    if (Date.now() < cached.token.expiresAt - TOKEN_EXPIRY_BUFFER_MS) {
      return cached.token;
    }
  }

  if (!params.forceRefresh && cached.inFlight) {
    return await cached.inFlight;
  }

  const inFlight = fetchToken({
    creds: params.creds,
    oauthBaseUrl: params.oauthBaseUrl,
    requiredScopes: params.requiredScopes,
  })
    .then((token) => {
      tokenCache.set(cacheKey, { token });
      return token;
    })
    .catch((err) => {
      tokenCache.delete(cacheKey);
      if (err instanceof Error) {
        throw err;
      }
      throw authFailedError(toErrorMessage(err));
    });

  tokenCache.set(cacheKey, {
    ...cached,
    inFlight,
  });

  return await inFlight;
}

export function clearCatfishTokenCache(): void {
  tokenCache.clear();
}
