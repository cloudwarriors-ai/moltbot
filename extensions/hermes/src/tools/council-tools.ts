import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import type { HermesClient } from "../client.js";

export function registerCouncilTools(api: OpenClawPluginApi, client: HermesClient): void {
  // ========================================================================
  // Council Deliberate (Multi-LLM Decision)
  // ========================================================================
  api.registerTool(
    {
      name: "hermes_council_deliberate",
      label: "Council Deliberate",
      description:
        "Start a multi-LLM council deliberation on an architectural decision. Multiple AI models (GPT, Gemini, Claude) discuss and reach consensus. WARNING: This can take 2-5 minutes to complete.",
      parameters: Type.Object({
        task: Type.String({
          description: "The architectural decision or problem to deliberate on",
        }),
        workflowId: Type.Optional(
          Type.String({ description: "Optional workflow ID to associate with" }),
        ),
      }),
      async execute(_toolCallId, params) {
        try {
          const body: Record<string, unknown> = { task: params.task };
          if (params.workflowId) body.workflowId = params.workflowId;

          // Council can take 2-5 minutes, override timeout to 5 minutes
          const result = await client.post<unknown>("/api/council/deliberate", body, {
            timeoutMs: 300000,
          });

          const deliberation = result as Record<string, unknown>;

          const parts: string[] = [];
          parts.push("Council Deliberation Complete");
          if (deliberation.id) parts.push(`ID: ${deliberation.id}`);
          if (deliberation.decision) parts.push(`\nDecision:\n${deliberation.decision}`);
          if (deliberation.consensus != null) parts.push(`\nConsensus: ${deliberation.consensus}%`);
          if (deliberation.turns) parts.push(`Discussion turns: ${deliberation.turns}`);

          const text = parts.join("\n");
          return {
            content: [{ type: "text", text }],
            details: deliberation,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: "text",
                text: `Error starting council deliberation: ${errorMessage}`,
              },
            ],
            details: { error: errorMessage },
          };
        }
      },
    },
    { name: "hermes_council_deliberate" },
  );

  // ========================================================================
  // Council Status
  // ========================================================================
  api.registerTool(
    {
      name: "hermes_council_status",
      label: "Council Status",
      description:
        "Check the status of the multi-LLM council system — whether it's enabled, active deliberations count, and configuration.",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params) {
        try {
          const result = await client.get<unknown>("/api/council/status");
          const status = result as Record<string, unknown>;

          const parts: string[] = [];
          parts.push("Council System Status");
          if (status.enabled != null) parts.push(`Enabled: ${status.enabled}`);
          if (status.active != null) parts.push(`Active deliberations: ${status.active}`);
          if (status.models) parts.push(`Models: ${JSON.stringify(status.models)}`);
          if (status.config) parts.push(`Config: ${JSON.stringify(status.config)}`);

          const text = parts.join("\n");
          return {
            content: [{ type: "text", text }],
            details: status,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: "text",
                text: `Error fetching council status: ${errorMessage}`,
              },
            ],
            details: { error: errorMessage },
          };
        }
      },
    },
    { name: "hermes_council_status" },
  );
}
