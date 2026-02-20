const PP_URL = () => process.env.PROJECT_PULSE_URL ?? "https://projectpulse.pscx.ai";
const PP_EMAIL = () => process.env.PROJECT_PULSE_EMAIL ?? "";
const PP_PASSWORD = () => process.env.PROJECT_PULSE_PASSWORD ?? "";

let cachedCookie: string | null = null;
let cookieExpiry = 0;

const COOKIE_TTL_MS = 25 * 60 * 1000; // 25 min (session lasts ~30 min)

export async function ppLogin(): Promise<string> {
  const baseUrl = PP_URL();

  // Step 1: Get CSRF token
  const csrfResp = await fetch(`${baseUrl}/api/auth/csrf`);
  if (!csrfResp.ok) throw new Error(`CSRF fetch failed: HTTP ${csrfResp.status}`);
  const csrfData = (await csrfResp.json()) as { csrfToken: string };
  const csrfToken = csrfData.csrfToken;

  // Collect set-cookie from CSRF response
  const csrfCookies = extractSetCookies(csrfResp);

  // Step 2: POST credentials
  const loginResp = await fetch(`${baseUrl}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: csrfCookies,
    },
    body: new URLSearchParams({
      csrfToken,
      email: PP_EMAIL(),
      password: PP_PASSWORD(),
      json: "true",
    }).toString(),
    redirect: "manual",
  });

  // Collect all cookies from the login response
  const loginCookies = extractSetCookies(loginResp);
  const allCookies = mergeCookies(csrfCookies, loginCookies);

  // Step 3: Verify session
  const sessionResp = await fetch(`${baseUrl}/api/auth/session`, {
    headers: { Cookie: allCookies },
  });

  if (!sessionResp.ok) throw new Error(`Session check failed: HTTP ${sessionResp.status}`);
  const session = (await sessionResp.json()) as Record<string, unknown>;
  if (!session.user) throw new Error("Login failed: no user in session response");

  // Merge any new cookies from session response
  const sessionCookies = extractSetCookies(sessionResp);
  const finalCookies = mergeCookies(allCookies, sessionCookies);

  cachedCookie = finalCookies;
  cookieExpiry = Date.now() + COOKIE_TTL_MS;
  return finalCookies;
}

export async function ppGetSession(): Promise<string> {
  if (cachedCookie && Date.now() < cookieExpiry) return cachedCookie;
  return ppLogin();
}

export function ppClearSession() {
  cachedCookie = null;
  cookieExpiry = 0;
}

function extractSetCookies(resp: Response): string {
  const cookies: string[] = [];
  // getSetCookie() returns array of set-cookie values
  const setCookieHeaders = (resp.headers as any).getSetCookie?.() ?? [];
  for (const sc of setCookieHeaders) {
    const nameVal = sc.split(";")[0];
    if (nameVal) cookies.push(nameVal.trim());
  }
  // Fallback: raw get
  if (cookies.length === 0) {
    const raw = resp.headers.get("set-cookie");
    if (raw) {
      for (const part of raw.split(/,(?=\s*\w+=)/)) {
        const nameVal = part.split(";")[0];
        if (nameVal) cookies.push(nameVal.trim());
      }
    }
  }
  return cookies.join("; ");
}

function mergeCookies(existing: string, incoming: string): string {
  if (!incoming) return existing;
  if (!existing) return incoming;
  const map = new Map<string, string>();
  for (const pair of existing.split("; ")) {
    const [name] = pair.split("=", 1);
    if (name) map.set(name, pair);
  }
  for (const pair of incoming.split("; ")) {
    const [name] = pair.split("=", 1);
    if (name) map.set(name, pair);
  }
  return [...map.values()].join("; ");
}
