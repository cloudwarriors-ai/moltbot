/**
 * Hermes Service — Startup Connectivity Check
 *
 * Pings Hermes on start, logs status. Non-blocking — doesn't fail if Hermes is down.
 */

import type { OpenClawPluginApi, OpenClawPluginService } from "openclaw/plugin-sdk";
import type { HealthStatus } from "../types.js";
import { HermesClient, HermesConnectionError } from "../client.js";

export function createHermesService(
  api: OpenClawPluginApi,
  client: HermesClient,
): OpenClawPluginService {
  return {
    id: "hermes",
    async start() {
      try {
        const health = await client.get<HealthStatus>("/health", { timeoutMs: 5000 });
        if (health.status === "healthy") {
          api.logger.info(
            `hermes: connected (${health.version}, uptime ${Math.round(health.uptime / 1000)}s)`,
          );
        } else {
          api.logger.warn(
            `hermes: connected but ${health.status} — ${JSON.stringify(health.checks)}`,
          );
        }
      } catch (error) {
        if (error instanceof HermesConnectionError) {
          api.logger.warn("hermes: not reachable — tools will fail until server is available");
        } else {
          api.logger.warn(`hermes: health check failed — ${String(error)}`);
        }
      }
    },
    stop() {
      api.logger.info("hermes: stopped");
    },
  };
}
