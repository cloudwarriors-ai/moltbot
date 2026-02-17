/**
 * Hermes CLI Commands
 *
 * Registered under the `hermes` command group:
 *   hermes status        — Server health + active workflows + stalls
 *   hermes workflows     — List workflows (table format)
 *   hermes workflow <id> — Detailed workflow + phases
 *   hermes logs <id>     — Recent logs (supports --level, --limit)
 *   hermes connections   — LLM provider connection status
 */

import type { OpenClawPluginCliRegistrar } from "openclaw/plugin-sdk";
import type { HealthStatus, HermesWorkflow, HermesPhase } from "../types.js";
import { HermesClient } from "../client.js";

export function createHermesCli(client: HermesClient): OpenClawPluginCliRegistrar {
  return ({ program }) => {
    const hermes = program.command("hermes").description("Hermes orchestration server commands");

    hermes
      .command("status")
      .description("Server health, active workflows, and stall detection")
      .action(async () => {
        try {
          const [health, summary, stalls] = await Promise.allSettled([
            client.get<HealthStatus>("/health"),
            client.get<{ health: unknown; recentWorkflows: unknown[] }>("/api/logs/summary"),
            client.get<{ stalls: Array<{ workflowId: string; diagnosis: string }> }>(
              "/api/logs/stalls",
            ),
          ]);

          console.log("=== Hermes Status ===\n");

          if (health.status === "fulfilled") {
            const h = health.value;
            console.log(
              `Health: ${h.status} (v${h.version}, uptime ${Math.round(h.uptime / 1000)}s)`,
            );
            for (const [name, check] of Object.entries(h.checks)) {
              console.log(
                `  ${name}: ${check.status}${check.message ? ` — ${check.message}` : ""}`,
              );
            }
          } else {
            console.log(`Health: UNREACHABLE — ${health.reason}`);
          }

          if (summary.status === "fulfilled") {
            const workflows = summary.value.recentWorkflows ?? [];
            console.log(`\nActive workflows: ${workflows.length}`);
          }

          if (stalls.status === "fulfilled" && stalls.value.stalls?.length > 0) {
            console.log("\nStalls detected:");
            for (const stall of stalls.value.stalls) {
              console.log(`  - ${stall.workflowId}: ${stall.diagnosis}`);
            }
          }
        } catch (error) {
          console.error(`Failed to get status: ${error}`);
          process.exitCode = 1;
        }
      });

    hermes
      .command("workflows")
      .description("List recent workflows")
      .option("--limit <n>", "Max results", "20")
      .option("--status <status>", "Filter by status")
      .action(async (opts) => {
        try {
          let path = `/api/prompt/workflows?limit=${opts.limit}`;
          if (opts.status) path += `&status=${opts.status}`;

          const workflows = await client.get<HermesWorkflow[]>(path);

          if (!workflows.length) {
            console.log("No workflows found.");
            return;
          }

          console.log("ID                          | Status     | Flow       | Prompt");
          console.log("---                         | ---        | ---        | ---");
          for (const wf of workflows) {
            const prompt = wf.prompt.slice(0, 50) + (wf.prompt.length > 50 ? "..." : "");
            console.log(
              `${wf.id.slice(0, 27).padEnd(28)}| ${wf.status.padEnd(11)}| ${wf.flowType.padEnd(11)}| ${prompt}`,
            );
          }
        } catch (error) {
          console.error(`Failed to list workflows: ${error}`);
          process.exitCode = 1;
        }
      });

    hermes
      .command("workflow")
      .description("Detailed workflow info with phases")
      .argument("<id>", "Workflow ID")
      .action(async (id) => {
        try {
          const result = await client.get<{ workflow: HermesWorkflow; phases: HermesPhase[] }>(
            `/api/prompt/workflows/${id}`,
          );
          const workflow = result.workflow;
          const phases = result.phases ?? [];

          console.log(`=== Workflow: ${workflow.id} ===`);
          console.log(`Status: ${workflow.status}`);
          console.log(`Flow: ${workflow.flowType}`);
          console.log(`Prompt: ${workflow.prompt}`);
          console.log(`Created: ${workflow.createdAt}`);

          if (phases.length) {
            console.log(`\nPhases (${phases.length}):`);
            for (const phase of phases) {
              const rating = phase.rating != null ? ` [${phase.rating}/100]` : "";
              console.log(`  ${phase.name.padEnd(15)} ${phase.status.padEnd(12)}${rating}`);
            }
          }
        } catch (error) {
          console.error(`Failed to get workflow: ${error}`);
          process.exitCode = 1;
        }
      });

    hermes
      .command("connections")
      .description("LLM provider connection status")
      .action(async () => {
        try {
          const status = await client.get<
            Record<string, { authenticated: boolean; method?: string }>
          >("/api/auth/status");
          const entries = Object.entries(status);

          if (entries.length === 0) {
            console.log("No providers configured.");
            return;
          }

          console.log("=== Provider Connections ===\n");
          for (const [name, info] of entries) {
            const icon = info.authenticated ? "\u2713" : "\u2717";
            const method = info.method ? ` (${info.method})` : "";
            console.log(
              `  ${icon} ${name.padEnd(15)} ${info.authenticated ? "connected" : "not connected"}${method}`,
            );
          }
        } catch (error) {
          console.error(`Failed to get connection status: ${error}`);
          process.exitCode = 1;
        }
      });

    hermes
      .command("logs")
      .description("Query workflow logs")
      .argument("<workflowId>", "Workflow ID")
      .option("--level <levels>", "Comma-separated log levels (error,warn,info,debug)")
      .option("--limit <n>", "Max results", "20")
      .action(async (workflowId, opts) => {
        try {
          const body: Record<string, unknown> = {
            workflowId,
            limit: parseInt(opts.limit),
          };
          if (opts.level) {
            body.level = opts.level.split(",").map((l: string) => l.trim());
          }

          const result = await client.post<{
            logs: Array<{ level: string; message: string; timestamp: string }>;
          }>("/api/logs/query", body, { retryOnPost: true });

          const logs = result.logs ?? [];
          if (!logs.length) {
            console.log("No logs found.");
            return;
          }

          for (const log of logs) {
            const ts = new Date(log.timestamp).toLocaleTimeString();
            console.log(`[${ts}] ${log.level.toUpperCase().padEnd(5)} ${log.message}`);
          }
        } catch (error) {
          console.error(`Failed to query logs: ${error}`);
          process.exitCode = 1;
        }
      });
  };
}
