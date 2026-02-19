import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { zw2Fetch as zw2FetchRaw, getZw2Base } from "./zw2-auth.js";

const ZW2_BASE = getZw2Base();

async function zw2Fetch<T = unknown>(endpoint: string, options?: RequestInit): Promise<T> {
  const result = await zw2FetchRaw(endpoint, options);
  if (!result.ok) throw new Error(`ZW2 API error ${result.status}: ${JSON.stringify(result.data)}`);
  return result.data as T;
}

// --- Company name cache (moltbot-side search enrichment) ---

interface OrderCacheEntry {
  id: number;
  order_name: string | null;
  company_name: string | null;
  order_type: string | null;
  status: string | null;
  user_email: string | null;
  updated_at: string | null;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let orderCache: OrderCacheEntry[] = [];
let cacheUpdatedAt = 0;
let cacheRefreshing = false;

async function refreshOrderCache(): Promise<void> {
  if (cacheRefreshing) return;
  cacheRefreshing = true;
  try {
    // Fetch all orders from list endpoint (paginated)
    const allOrders: Record<string, unknown>[] = [];
    let url = `/api/v1/orders/?ordering=-updated_at&page_size=100`;
    while (url) {
      const page = await zw2Fetch<{ results?: Record<string, unknown>[]; next?: string | null }>(url);
      const results = page.results ?? (Array.isArray(page) ? page : []);
      allOrders.push(...results);
      // next is a full URL — extract the path+query
      if (page.next) {
        try {
          const nextUrl = new URL(page.next);
          url = nextUrl.pathname + nextUrl.search;
        } catch {
          url = "";
        }
      } else {
        url = "";
      }
    }

    // For each order, fetch detail to get company_name from customer_info
    const entries: OrderCacheEntry[] = [];
    for (const order of allOrders) {
      const id = order.id as number;
      try {
        const detail = await zw2Fetch<Record<string, unknown>>(`/api/v1/orders/${id}/`);
        const ci = detail.customer_info as Record<string, unknown> | null;
        entries.push({
          id,
          order_name: (order.order_name as string) ?? null,
          company_name: ci?.company_name as string ?? null,
          order_type: (order.order_type as string) ?? null,
          status: (order.status as string) ?? null,
          user_email: (order.user_email as string) ?? null,
          updated_at: (order.updated_at as string) ?? null,
        });
      } catch {
        // Skip orders we can't fetch detail for
        entries.push({
          id,
          order_name: (order.order_name as string) ?? null,
          company_name: null,
          order_type: (order.order_type as string) ?? null,
          status: (order.status as string) ?? null,
          user_email: (order.user_email as string) ?? null,
          updated_at: (order.updated_at as string) ?? null,
        });
      }
    }

    orderCache = entries;
    cacheUpdatedAt = Date.now();
  } finally {
    cacheRefreshing = false;
  }
}

async function ensureCache(): Promise<void> {
  if (Date.now() - cacheUpdatedAt > CACHE_TTL_MS) {
    await refreshOrderCache();
  }
}

function searchCacheByCompanyName(query: string): OrderCacheEntry[] {
  const q = query.toLowerCase();
  return orderCache.filter(
    (e) => e.company_name && e.company_name.toLowerCase().includes(q),
  );
}

// --- Helpers ---

function absoluteUrl(path: string): string {
  if (path.startsWith("/")) return `${ZW2_BASE}${path}`;
  return path;
}

function processDict(data: any): any {
  if (typeof data !== "object" || data === null) return data;
  const result: any = Array.isArray(data) ? [] : {};
  for (const key in data) {
    let val = data[key];
    if (typeof val === "string" && (key.endsWith("_url") || key === "url")) {
      val = absoluteUrl(val);
    } else if (typeof val === "object") {
      val = processDict(val);
    }
    result[key] = val;
  }
  return result;
}

function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(processDict(data)) }] };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: message }) }] };
}

// --- Plugin ---

const plugin = {
  id: "zoomwarriors",
  name: "ZoomWarriors2",
  description: "ZoomWarriors2 presales quoting platform - search orders, get project details, pricing, and SOW status",
  configSchema: emptyPluginConfigSchema(),

  register(api: OpenClawPluginApi) {
    // Tool 0: Force-refresh auth token
    api.registerTool(() => ({
      name: "zw2_refresh_auth",
      description:
        "Force-refresh the ZW2 API authentication token and verify it works. " +
        "Use this if ZW2 tool calls are failing with auth errors.",
      parameters: Type.Object({}),
      async execute() {
        try {
          const { zw2ForceReauth } = await import("./zw2-auth.js");
          const result = await zw2ForceReauth();
          return result.success
            ? { content: [{ type: "text" as const, text: "ZW2 auth token refreshed and verified successfully." }] }
            : { content: [{ type: "text" as const, text: `ZW2 auth refresh failed: ${result.error}` }] };
        } catch (err) {
          return errorResult(err);
        }
      },
    }));

    // Tool 1: Search orders (API search + local company_name cache)
    api.registerTool(() => ({
      name: "zw2_search_orders",
      description:
        "Search ZoomWarriors2 orders by order name, company/customer name, or order ID. " +
        "Use the channel or customer name as the search query to find their active orders.",
      parameters: Type.Object({
        query: Type.String({ description: "Search term: customer name, company name, or order ID" }),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        try {
          const query = params.query as string;

          // 1. API search (handles order_name + id)
          const encoded = encodeURIComponent(query);
          const apiData = await zw2Fetch<{ results?: Record<string, unknown>[]; [k: string]: unknown }>(
            `/api/v1/orders/?search=${encoded}&ordering=-updated_at`,
          );
          const apiResults = Array.isArray(apiData) ? apiData : (apiData.results ?? []) as Record<string, unknown>[];
          const apiIds = new Set(apiResults.map((r) => r.id as number));

          // 2. Local cache search for company_name matches
          await ensureCache();
          const companyMatches = searchCacheByCompanyName(query).filter((e) => !apiIds.has(e.id));

          // 3. Merge: API results first, then company_name-only matches
          const merged = [
            ...apiResults.map((r) => {
              const cached = orderCache.find((c) => c.id === (r.id as number));
              return { ...r, company_name: cached?.company_name ?? null };
            }),
            ...companyMatches,
          ];

          return jsonResult({ ok: true, count: merged.length, orders: merged });
        } catch (err) {
          return errorResult(err);
        }
      },
    }));

    // Tool 2: Get order details
    api.registerTool(() => ({
      name: "zw2_get_order",
      description:
        "Get full details for a ZoomWarriors2 order including customer info, Zoom Phone configuration, " +
        "Contact Center configuration, and integrations.",
      parameters: Type.Object({
        order_id: Type.Number({ description: "The order ID to retrieve" }),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        try {
          const orderId = params.order_id as number;
          const data = await zw2Fetch<Record<string, unknown>>(`/api/v1/orders/${orderId}/`);
          // Replace raw sow_document media path with proper download endpoint
          if (data.sow_document) {
            data.sow_document = `${ZW2_BASE}/api/v1/orders/${orderId}/sow-download/`;
          }
          return jsonResult({ ok: true, order: data });
        } catch (err) {
          return errorResult(err);
        }
      },
    }));

    // Tool 3: Get pricing breakdown
    api.registerTool(() => ({
      name: "zw2_get_pricing",
      description:
        "Get the pricing breakdown for a ZoomWarriors2 order with itemized line items, quantities, and totals.",
      parameters: Type.Object({
        order_id: Type.Number({ description: "The order ID to get pricing for" }),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        try {
          const data = await zw2Fetch(`/api/v1/pricing/orders/${params.order_id}/breakdown/`);
          return jsonResult({ ok: true, pricing: data });
        } catch (err) {
          return errorResult(err);
        }
      },
    }));

    // Tool 4: Get SOW status/link
    api.registerTool(() => ({
      name: "zw2_get_sow_link",
      description: "Get the SOW document status and download link for a ZoomWarriors2 order.",
      parameters: Type.Object({
        order_id: Type.Number({ description: "The order ID to get SOW status for" }),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        try {
          const data = await zw2Fetch(`/api/v1/orders/${params.order_id}/sow-status/`);
          return jsonResult({ ok: true, sow: data });
        } catch (err) {
          return errorResult(err);
        }
      },
    }));
  },
};

export default plugin;
