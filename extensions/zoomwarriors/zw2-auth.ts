/**
 * Shared ZW2 authentication module.
 * Uses a global singleton so both zoomwarriors and zoomwarriors-write
 * plugins share the same access/refresh tokens.
 */

const ZW2_BASE = process.env.ZW2_URL ?? "http://zoomwarriors2-backend:8000";

interface Zw2AuthState {
  accessToken: string | null;
  refreshToken: string | null;
}

// Global singleton — survives across plugin boundaries
const GLOBAL_KEY = "__zw2_auth_state__";
const g = globalThis as Record<string, unknown>;
if (!g[GLOBAL_KEY]) {
  g[GLOBAL_KEY] = { accessToken: null, refreshToken: null };
}
const state = g[GLOBAL_KEY] as Zw2AuthState;

export async function zw2Login(): Promise<void> {
  const username = process.env.ZW2_USERNAME;
  const password = process.env.ZW2_PASSWORD;
  if (!username || !password) throw new Error("ZW2_USERNAME and ZW2_PASSWORD env vars required");

  const resp = await fetch(`${ZW2_BASE}/api/v1/auth/login/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, terms_accepted: true }),
  });

  if (!resp.ok) throw new Error(`ZW2 login failed: ${resp.status}`);
  const data = (await resp.json()) as Record<string, unknown>;
  state.accessToken = data.access_token as string;
  state.refreshToken = data.refresh_token as string;
}

export async function zw2RefreshToken(): Promise<void> {
  if (!state.refreshToken) return zw2Login();

  const resp = await fetch(`${ZW2_BASE}/api/v1/auth/token/refresh/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: state.refreshToken }),
  });

  if (!resp.ok) return zw2Login();
  const data = (await resp.json()) as Record<string, unknown>;
  state.accessToken = data.access_token as string;
  state.refreshToken = data.refresh_token as string;
}

export async function zw2Fetch(
  endpoint: string,
  options?: RequestInit,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  if (!state.accessToken) await zw2Login();

  const doFetch = async (): Promise<Response> =>
    fetch(`${ZW2_BASE}${endpoint}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
        Authorization: `Bearer ${state.accessToken}`,
      },
    });

  let resp = await doFetch();
  if (resp.status === 401) {
    await zw2RefreshToken();
    resp = await doFetch();
  }

  const data = resp.headers.get("content-type")?.includes("application/json")
    ? await resp.json()
    : await resp.text();

  return { ok: resp.ok, status: resp.status, data };
}

export async function zw2ForceReauth(): Promise<{ success: boolean; error?: string }> {
  state.accessToken = null;
  state.refreshToken = null;
  try {
    await zw2Login();
    const check = await zw2Fetch("/api/v1/orders/?limit=1");
    if (!check.ok) return { success: false, error: `Token test failed: HTTP ${check.status}` };
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export function getZw2Base(): string {
  return ZW2_BASE;
}
