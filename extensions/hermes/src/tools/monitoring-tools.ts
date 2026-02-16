import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import type { HermesClient } from "../client.js";

export function registerMonitoringTools(api: OpenClawPluginApi, client: HermesClient): void {
  // ========================================================================
  // System Status (Combined: health + logs summary + stalls)
  // ========================================================================
  api.registerTool(
    {
      name: "hermes_system_status",
      label: "System Status",
      description:
        "Get comprehensive Hermes system status including health, active workflows, and stall detection. Use this to check if Hermes is running and healthy before starting work.",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params) {
        try {
          const [healthResult, summaryResult, stallsResult] = await Promise.allSettled([
            client.get<{ status: string; uptime: number }>("/health"),
            client.get<unknown>("/api/logs/summary"),
            client.get<unknown>("/api/logs/stalls"),
          ]);

          const parts: string[] = [];

          // Health
          if (healthResult.status === "fulfilled") {
            const health = healthResult.value;
            parts.push(`Status: ${health.status || "unknown"}`);
            if (health.uptime != null) {
              parts.push(`Uptime: ${Math.floor(health.uptime / 1000)}s`);
            }
          } else {
            parts.push("Status: ERROR - Health check failed");
          }

          // Logs summary
          if (summaryResult.status === "fulfilled") {
            const summary = summaryResult.value as Record<string, unknown>;
            if (summary.workflows) {
              parts.push(`\nWorkflows: ${JSON.stringify(summary.workflows)}`);
            }
            if (summary.events) {
              parts.push(`Events: ${JSON.stringify(summary.events)}`);
            }
          } else {
            parts.push("\nLogs summary: unavailable");
          }

          // Stalls
          if (stallsResult.status === "fulfilled") {
            const stalls = stallsResult.value as Record<string, unknown>;
            const stallCount = Array.isArray(stalls) ? stalls.length : stalls.count || 0;
            parts.push(`\nStalled workflows: ${stallCount}`);
            if (Array.isArray(stalls) && stalls.length > 0) {
              parts.push(`Stalls: ${JSON.stringify(stalls)}`);
            }
          } else {
            parts.push("\nStall detection: unavailable");
          }

          const text = parts.join("\n");
          return {
            content: [{ type: "text", text }],
            details: {
              health: healthResult.status === "fulfilled" ? healthResult.value : null,
              summary: summaryResult.status === "fulfilled" ? summaryResult.value : null,
              stalls: stallsResult.status === "fulfilled" ? stallsResult.value : null,
            },
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Error: ${errorMessage}` }],
            details: { error: errorMessage },
          };
        }
      },
    },
    { name: "hermes_system_status" },
  );

  // ========================================================================
  // Query Logs
  // ========================================================================
  api.registerTool(
    {
      name: "hermes_query_logs",
      label: "Query Logs",
      description:
        "Search Hermes logs with optional filters. Use to investigate errors or monitor workflow progress.",
      parameters: Type.Object({
        workflowId: Type.Optional(Type.String({ description: "Filter by workflow ID" })),
        level: Type.Optional(
          Type.Array(Type.String(), {
            description: 'Log levels to include, e.g. ["error", "warn"]',
          }),
        ),
        limit: Type.Optional(
          Type.Number({ description: "Maximum number of log entries to return", default: 20 }),
        ),
      }),
      async execute(_toolCallId, params) {
        try {
          const body: Record<string, unknown> = {};
          if (params.workflowId) body.workflowId = params.workflowId;
          if (params.level) body.level = params.level;
          if (params.limit != null) body.limit = params.limit;

          const result = await client.post<unknown>("/api/logs/query", body);

          const logs = Array.isArray(result) ? result : (result as Record<string, unknown>).logs;

          if (Array.isArray(logs) && logs.length === 0) {
            return {
              content: [{ type: "text", text: "No logs found matching filters." }],
              details: { count: 0 },
            };
          }

          const count = Array.isArray(logs) ? logs.length : 0;
          const text = `Found ${count} log entries:\n\n${JSON.stringify(logs, null, 2)}`;

          return {
            content: [{ type: "text", text }],
            details: { count, logs },
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Error querying logs: ${errorMessage}` }],
            details: { error: errorMessage },
          };
        }
      },
    },
    { name: "hermes_query_logs" },
  );

  // ========================================================================
  // Workflow Logs (Detailed)
  // ========================================================================
  api.registerTool(
    {
      name: "hermes_workflow_logs",
      label: "Workflow Logs",
      description: "Get detailed logs for a specific workflow including phase-by-phase breakdown.",
      parameters: Type.Object({
        workflowId: Type.String({ description: "Workflow ID to fetch logs for" }),
      }),
      async execute(_toolCallId, params) {
        try {
          const result = await client.get<unknown>(`/api/logs/workflow/${params.workflowId}`);

          const workflow = result as Record<string, unknown>;
          const phases = workflow.phases ? (workflow.phases as Array<Record<string, unknown>>) : [];

          const parts: string[] = [];
          parts.push(`Workflow: ${workflow.id || params.workflowId}`);
          if (workflow.status) parts.push(`Status: ${workflow.status}`);
          if (workflow.prompt) parts.push(`Prompt: ${workflow.prompt}`);
          parts.push(`\nPhases: ${phases.length}`);

          if (phases.length > 0) {
            parts.push("");
            for (const phase of phases) {
              parts.push(`- ${phase.name}: ${phase.status}`);
              if (phase.error) parts.push(`  Error: ${phase.error}`);
            }
          }

          const text = parts.join("\n");
          return {
            content: [{ type: "text", text }],
            details: workflow,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: "text",
                text: `Error fetching workflow logs: ${errorMessage}`,
              },
            ],
            details: { error: errorMessage },
          };
        }
      },
    },
    { name: "hermes_workflow_logs" },
  );
}
