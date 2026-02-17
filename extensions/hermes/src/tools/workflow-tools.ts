import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import { stringEnum } from "openclaw/plugin-sdk";
import type { HermesClient } from "../client.js";

export function registerWorkflowTools(api: OpenClawPluginApi, client: HermesClient): void {
  // 1. Start workflow
  api.registerTool(
    {
      name: "hermes_start_workflow",
      label: "Start Workflow",
      description:
        "Start a new Hermes workflow. Sends a prompt to the orchestrator which runs it through plan→design→build→test→validate phases. Use flowType 'refactor' for modifying existing code. If serverId is omitted, auto-selects the first online server.",
      parameters: Type.Object({
        prompt: Type.String({ description: "The development task to execute" }),
        flowType: Type.Optional(
          stringEnum(["greenfield", "refactor"], {
            description:
              "Type of workflow: greenfield for new code, refactor for modifying existing",
            default: "greenfield",
          }),
        ),
        serverId: Type.Optional(
          Type.String({
            description: "ID of the OpenCode server to use (auto-selects if omitted)",
          }),
        ),
        projectDir: Type.Optional(Type.String({ description: "Project directory path" })),
        skippedPhases: Type.Optional(
          Type.Array(Type.String(), { description: "Array of phase names to skip" }),
        ),
      }),
      async execute(_toolCallId, params) {
        try {
          const {
            prompt,
            flowType = "greenfield",
            serverId,
            projectDir,
            skippedPhases,
          } = params as {
            prompt: string;
            flowType?: string;
            serverId?: string;
            projectDir?: string;
            skippedPhases?: string[];
          };

          const body: Record<string, unknown> = { prompt, flowType };
          if (serverId) body.serverId = serverId;
          if (projectDir) body.projectDir = projectDir;
          if (skippedPhases) body.skippedPhases = skippedPhases;

          const result = await client.post<{ workflowId: string; status: string }>(
            "/api/prompt/send",
            body,
          );

          return {
            content: [
              {
                type: "text",
                text: `Started ${flowType} workflow:\nID: ${result.workflowId}\nStatus: ${result.status}\nPrompt: ${prompt.substring(0, 100)}${prompt.length > 100 ? "..." : ""}`,
              },
            ],
            details: result,
          };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Failed to start workflow: ${msg}` }],
            details: { error: msg },
          };
        }
      },
    },
    { name: "hermes_start_workflow" },
  );

  // 2. List workflows
  api.registerTool(
    {
      name: "hermes_list_workflows",
      label: "List Workflows",
      description: "List recent Hermes workflows with their status and metadata.",
      parameters: Type.Object({
        limit: Type.Optional(
          Type.Number({ description: "Maximum number of workflows to return", default: 20 }),
        ),
        status: Type.Optional(Type.String({ description: "Filter by workflow status" })),
      }),
      async execute(_toolCallId, params) {
        try {
          const { limit = 20, status } = params as { limit?: number; status?: string };
          const queryParams = new URLSearchParams();
          if (limit) queryParams.set("limit", String(limit));
          if (status) queryParams.set("status", status);

          const result = await client.get(`/api/prompt/workflows?${queryParams.toString()}`);
          const workflows = Array.isArray(result) ? result : [];

          if (workflows.length === 0) {
            return {
              content: [{ type: "text", text: "No workflows found." }],
              details: { workflows: [] },
            };
          }

          const summary = workflows
            .map(
              (w: Record<string, unknown>, i: number) =>
                `${i + 1}. ${w.id} - ${w.status} - ${w.flowType}\n   Prompt: ${String(w.prompt || "").substring(0, 80)}...`,
            )
            .join("\n");

          return {
            content: [{ type: "text", text: `Found ${workflows.length} workflows:\n${summary}` }],
            details: { workflows },
          };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Failed to list workflows: ${msg}` }],
            details: { error: msg },
          };
        }
      },
    },
    { name: "hermes_list_workflows" },
  );

  // 3. Get workflow details
  api.registerTool(
    {
      name: "hermes_get_workflow",
      label: "Get Workflow",
      description: "Get detailed workflow information including all phases and their status.",
      parameters: Type.Object({
        workflowId: Type.String({ description: "The workflow ID to retrieve" }),
      }),
      async execute(_toolCallId, params) {
        try {
          const { workflowId } = params as { workflowId: string };

          const result = await client.get<{
            workflow: Record<string, unknown>;
            phases?: Record<string, unknown>[];
          }>(`/api/prompt/workflows/${workflowId}`);
          const workflow = result.workflow;
          const phaseList = result.phases ?? [];
          const phaseSummary = phaseList
            .map(
              (p) => `  - ${p.name}: ${p.status}${p.tokensUsed ? ` (${p.tokensUsed} tokens)` : ""}`,
            )
            .join("\n");

          return {
            content: [
              {
                type: "text",
                text: `Workflow ${workflowId}:\nStatus: ${workflow.status}\nFlow Type: ${workflow.flowType}\nPrompt: ${workflow.prompt}\n\nPhases:\n${phaseSummary || "  No phases yet"}`,
              },
            ],
            details: { workflow, phases: phaseList },
          };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Failed to get workflow: ${msg}` }],
            details: { error: msg },
          };
        }
      },
    },
    { name: "hermes_get_workflow" },
  );

  // 4. Control workflow
  api.registerTool(
    {
      name: "hermes_control_workflow",
      label: "Control Workflow",
      description: "Control a running workflow — stop, pause, resume, or cancel it.",
      parameters: Type.Object({
        workflowId: Type.String({ description: "The workflow ID to control" }),
        action: stringEnum(["stop", "pause", "resume", "cancel"], {
          description: "Action to perform on the workflow",
        }),
      }),
      async execute(_toolCallId, params) {
        try {
          const { workflowId, action } = params as { workflowId: string; action: string };

          const result = await client.post(`/api/prompt/workflows/${workflowId}/${action}`, {});

          return {
            content: [{ type: "text", text: `Successfully ${action}ed workflow ${workflowId}` }],
            details: result,
          };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Failed to control workflow: ${msg}` }],
            details: { error: msg },
          };
        }
      },
    },
    { name: "hermes_control_workflow" },
  );

  // 5. Delete workflow
  api.registerTool(
    {
      name: "hermes_delete_workflow",
      label: "Delete Workflow",
      description: "Delete a workflow and all its associated data. This is permanent.",
      parameters: Type.Object({
        workflowId: Type.String({ description: "The workflow ID to delete" }),
      }),
      async execute(_toolCallId, params) {
        try {
          const { workflowId } = params as { workflowId: string };

          const result = await client.del(`/api/prompt/workflows/${workflowId}`);

          return {
            content: [{ type: "text", text: `Successfully deleted workflow ${workflowId}` }],
            details: result,
          };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Failed to delete workflow: ${msg}` }],
            details: { error: msg },
          };
        }
      },
    },
    { name: "hermes_delete_workflow" },
  );

  // 6. Phase control
  api.registerTool(
    {
      name: "hermes_phase_control",
      label: "Control Phase",
      description: "Control a specific phase — advance to next, retry a failed phase, or skip it.",
      parameters: Type.Object({
        workflowId: Type.String({ description: "The workflow ID" }),
        phaseId: Type.String({ description: "The phase ID to control" }),
        action: stringEnum(["advance", "retry", "skip"], {
          description: "Action to perform on the phase",
        }),
      }),
      async execute(_toolCallId, params) {
        try {
          const { workflowId, phaseId, action } = params as {
            workflowId: string;
            phaseId: string;
            action: string;
          };

          const result = await client.post(
            `/api/prompt/workflows/${workflowId}/phases/${phaseId}/${action}`,
            {},
          );

          return {
            content: [
              {
                type: "text",
                text: `Successfully ${action}ed phase ${phaseId} in workflow ${workflowId}`,
              },
            ],
            details: result,
          };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Failed to control phase: ${msg}` }],
            details: { error: msg },
          };
        }
      },
    },
    { name: "hermes_phase_control" },
  );
}
