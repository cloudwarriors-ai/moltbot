/**
 * OpenClaw Hermes Plugin
 *
 * Gives AI agents full access to the Hermes orchestration server:
 * - 16 tools for workflows, servers, monitoring, council, quality
 * - CLI commands for quick status checks
 * - Service health check on startup
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { HermesPluginConfig } from "./src/types.js";
import { createHermesCli } from "./src/cli/hermes-cli.js";
import { HermesClient } from "./src/client.js";
import { createHermesService } from "./src/service/health-check.js";
import { registerCouncilTools } from "./src/tools/council-tools.js";
import { registerMonitoringTools } from "./src/tools/monitoring-tools.js";
import { registerQualityTools } from "./src/tools/quality-tools.js";
import { registerServerTools } from "./src/tools/server-tools.js";
import { registerWorkflowTools } from "./src/tools/workflow-tools.js";

// ============================================================================
// Config Parsing
// ============================================================================

function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, envVar) => {
    const envValue = process.env[envVar];
    if (!envValue) {
      throw new Error(`Environment variable ${envVar} is not set`);
    }
    return envValue;
  });
}

function resolveStringField(raw: unknown, envVar?: string): string | undefined {
  if (typeof raw === "string" && raw.length > 0) {
    return resolveEnvVars(raw);
  }
  if (envVar) {
    return process.env[envVar];
  }
  return undefined;
}

function parseConfig(pluginConfig?: Record<string, unknown>): HermesPluginConfig {
  const cfg = pluginConfig ?? {};

  const baseUrl = resolveStringField(cfg.baseUrl, "HERMES_BASE_URL") ?? "http://localhost:3345";
  const apiKey = resolveStringField(cfg.apiKey, "HERMES_API_KEY");
  const organizationId = resolveStringField(cfg.organizationId, "HERMES_ORG_ID");
  const timeoutMs = typeof cfg.timeoutMs === "number" ? cfg.timeoutMs : 30000;

  return { baseUrl, apiKey, organizationId, timeoutMs };
}

// ============================================================================
// Plugin Definition
// ============================================================================

const hermesPlugin = {
  id: "hermes",
  name: "Hermes Orchestrator",
  description:
    "Full access to the Hermes orchestration server — workflows, monitoring, council, quality, and servers",

  register(api: OpenClawPluginApi) {
    const config = parseConfig(api.pluginConfig);
    const client = new HermesClient(config);

    api.logger.info(
      `hermes: registered (baseUrl: ${config.baseUrl}, auth: ${config.apiKey ? "yes" : "no"})`,
    );

    // Register all 16 tools
    registerWorkflowTools(api, client); // 6 tools
    registerServerTools(api, client); // 3 tools
    registerMonitoringTools(api, client); // 3 tools
    registerCouncilTools(api, client); // 2 tools
    registerQualityTools(api, client); // 2 tools

    // Service: connectivity check on startup
    api.registerService(createHermesService(api, client));

    // CLI commands
    api.registerCli(createHermesCli(client), { commands: ["hermes"] });
  },
};

export default hermesPlugin;
