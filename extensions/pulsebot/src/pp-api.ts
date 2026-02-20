import { ppGetSession, ppClearSession } from "./pp-auth.js";

const PP_URL = () => process.env.PROJECT_PULSE_URL ?? "https://projectpulse.pscx.ai";

export interface PpFetchResult {
  ok: boolean;
  status: number;
  data: unknown;
}

export async function ppFetch(
  path: string,
  opts?: RequestInit & { retried?: boolean },
): Promise<PpFetchResult> {
  const cookie = await ppGetSession();
  const url = `${PP_URL()}${path}`;

  const resp = await fetch(url, {
    ...opts,
    headers: {
      ...opts?.headers,
      Cookie: cookie,
      ...(opts?.body ? { "Content-Type": "application/json" } : {}),
    },
  });

  // If 401, refresh session and retry once
  if (resp.status === 401 && !opts?.retried) {
    ppClearSession();
    return ppFetch(path, { ...opts, retried: true });
  }

  const data = resp.headers.get("content-type")?.includes("application/json")
    ? await resp.json()
    : await resp.text();

  return { ok: resp.ok, status: resp.status, data };
}

export function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

export function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: message }) }] };
}
