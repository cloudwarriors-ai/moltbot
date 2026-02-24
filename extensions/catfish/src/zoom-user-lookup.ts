export type ZoomApiResult<T> = {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
};

export type ZoomUserLookupApiFetch = <T>(
  endpoint: string,
  options?: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    body?: unknown;
  },
) => Promise<ZoomApiResult<T>>;

export type ZoomResolvedIdentity = {
  userId?: string;
  email?: string;
  source: "cache" | "direct" | "users_list" | "none";
};

export type ZoomUserLookupResolver = {
  resolveIdentity: (lookupIds: Array<string | undefined>) => Promise<ZoomResolvedIdentity>;
};

type ZoomUserRecord = {
  id?: string;
  email?: string;
};

type ZoomUsersListResponse = {
  users?: ZoomUserRecord[];
  next_page_token?: string;
};

type CacheEntry = {
  expiresAt: number;
  resolved: boolean;
  userId?: string;
  email?: string;
};

type CatfishLookupLogger = {
  debug?: (message: string) => void;
};

const DEFAULT_USERS_LIST_PAGE_SIZE = 300;
const DEFAULT_USERS_LIST_MAX_PAGES = 10;
const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isEmailLike(value: string | undefined): value is string {
  if (!value) {
    return false;
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function extractZoomUserIdFromJid(value: string | undefined): string | undefined {
  const trimmed = asOptionalString(value);
  if (!trimmed) {
    return undefined;
  }
  const lower = trimmed.toLowerCase();
  const suffix = "@xmpp.zoom.us";
  if (!lower.endsWith(suffix)) {
    return undefined;
  }
  const atIndex = trimmed.indexOf("@");
  if (atIndex <= 0) {
    return undefined;
  }
  return trimmed.slice(0, atIndex);
}

export function normalizeZoomLookupId(value: unknown): string | undefined {
  const trimmed = asOptionalString(value);
  if (!trimmed) {
    return undefined;
  }
  const fromJid = extractZoomUserIdFromJid(trimmed);
  if (fromJid) {
    return fromJid;
  }
  if (isEmailLike(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function toUniqueIds(values: Array<string | undefined>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value) {
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function getCacheLookupKeys(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }
  const lower = trimmed.toLowerCase();
  if (lower === trimmed) {
    return [trimmed];
  }
  return [trimmed, lower];
}

export function createZoomUserLookupResolver(params: {
  apiFetch: ZoomUserLookupApiFetch;
  usersListPageSize?: number;
  usersListMaxPages?: number;
  cacheTtlMs?: number;
  logger?: CatfishLookupLogger;
}): ZoomUserLookupResolver {
  const cache = new Map<string, CacheEntry>();
  const usersListPageSize = params.usersListPageSize ?? DEFAULT_USERS_LIST_PAGE_SIZE;
  const usersListMaxPages = params.usersListMaxPages ?? DEFAULT_USERS_LIST_MAX_PAGES;
  const cacheTtlMs = params.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;

  function writeCache(
    lookupId: string,
    resolved: { userId?: string; email?: string } | undefined,
  ): void {
    const entry: CacheEntry = {
      expiresAt: Date.now() + cacheTtlMs,
      resolved: Boolean(resolved?.userId || resolved?.email),
      userId: resolved?.userId,
      email: resolved?.email,
    };

    for (const key of getCacheLookupKeys(lookupId)) {
      cache.set(key, entry);
    }

    if (resolved?.userId) {
      for (const key of getCacheLookupKeys(resolved.userId)) {
        cache.set(key, entry);
      }
    }
  }

  function readCache(lookupId: string): { hit: boolean; entry?: CacheEntry } {
    for (const key of getCacheLookupKeys(lookupId)) {
      const entry = cache.get(key);
      if (!entry) {
        continue;
      }
      if (entry.expiresAt <= Date.now()) {
        cache.delete(key);
        continue;
      }
      return { hit: true, entry };
    }

    return { hit: false };
  }

  async function resolveViaUsersList(
    pendingLookupIdsLower: Set<string>,
  ): Promise<ZoomResolvedIdentity | undefined> {
    let nextPageToken: string | undefined;

    for (let page = 0; page < usersListMaxPages; page += 1) {
      const query = new URLSearchParams({
        status: "active",
        page_size: String(usersListPageSize),
      });
      if (nextPageToken) {
        query.set("next_page_token", nextPageToken);
      }

      const response = await params.apiFetch<ZoomUsersListResponse>(`/users?${query}`);
      if (!response.ok) {
        params.logger?.debug?.(
          `catfish users-list lookup failed status=${response.status} error=${response.error ?? ""}`,
        );
        return undefined;
      }

      const users = Array.isArray(response.data?.users) ? response.data.users : [];
      for (const user of users) {
        const userId = asOptionalString(user.id);
        const userEmail = asOptionalString(user.email);
        if (!userId) {
          continue;
        }

        writeCache(userId, { userId, email: userEmail });

        if (!pendingLookupIdsLower.has(userId.toLowerCase())) {
          continue;
        }

        return {
          userId,
          email: userEmail,
          source: "users_list",
        };
      }

      nextPageToken = asOptionalString(response.data?.next_page_token);
      if (!nextPageToken) {
        break;
      }
    }

    return undefined;
  }

  return {
    async resolveIdentity(lookupIds: Array<string | undefined>): Promise<ZoomResolvedIdentity> {
      const normalizedLookupIds = toUniqueIds(
        lookupIds.map((value) => normalizeZoomLookupId(value)),
      );
      if (normalizedLookupIds.length === 0) {
        return { source: "none" };
      }

      const pendingLookupIds: string[] = [];
      for (const lookupId of normalizedLookupIds) {
        const cached = readCache(lookupId);
        if (!cached.hit) {
          pendingLookupIds.push(lookupId);
          continue;
        }

        const entry = cached.entry;
        if (entry?.resolved) {
          return {
            userId: entry.userId,
            email: entry.email,
            source: "cache",
          };
        }
      }

      if (pendingLookupIds.length === 0) {
        return { source: "none" };
      }

      for (const lookupId of pendingLookupIds) {
        const response = await params.apiFetch<ZoomUserRecord>(
          `/users/${encodeURIComponent(lookupId)}`,
        );
        if (!response.ok) {
          continue;
        }

        const userId = asOptionalString(response.data?.id) ?? lookupId;
        const email = asOptionalString(response.data?.email);
        writeCache(lookupId, { userId, email });
        return {
          userId,
          email,
          source: "direct",
        };
      }

      const pendingLookupIdsLower = new Set(pendingLookupIds.map((value) => value.toLowerCase()));
      const listResolved = await resolveViaUsersList(pendingLookupIdsLower);
      if (listResolved) {
        for (const lookupId of pendingLookupIds) {
          writeCache(lookupId, {
            userId: listResolved.userId,
            email: listResolved.email,
          });
        }
        return listResolved;
      }

      for (const lookupId of pendingLookupIds) {
        writeCache(lookupId, undefined);
      }

      return { source: "none" };
    },
  };
}
