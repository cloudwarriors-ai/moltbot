const DEVTOOLS_BASE = process.env.DEVTOOLS_API_URL ?? "https://devtools-api.cloudwarriors.ai";
const DEVTOOLS_TOKEN = process.env.DEV_TOOLS_API ?? "";

export async function devtoolsFetch(
  endpoint: string,
  options?: RequestInit,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  if (!DEVTOOLS_TOKEN) {
    return { ok: false, status: 0, data: { error: "DEV_TOOLS_API env var not set" } };
  }

  const resp = await fetch(`${DEVTOOLS_BASE}${endpoint}`, {
    ...options,
    headers: {
      ...options?.headers,
      Authorization: `Bearer ${DEVTOOLS_TOKEN}`,
    },
  });

  const data = resp.headers.get("content-type")?.includes("application/json")
    ? await resp.json()
    : await resp.text();

  return { ok: resp.ok, status: resp.status, data };
}
