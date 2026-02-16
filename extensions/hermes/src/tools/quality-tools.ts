import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import type { HermesClient } from "../client.js";

export function registerQualityTools(api: OpenClawPluginApi, client: HermesClient): void {
  // ========================================================================
  // Quality Report (Combined: quality + score + tests + security)
  // ========================================================================
  api.registerTool(
    {
      name: "hermes_quality_report",
      label: "Quality Report",
      description:
        "Get a comprehensive quality report for a workflow — quality gates, test results, security scans, and overall score. One-stop shop for understanding workflow quality.",
      parameters: Type.Object({
        workflowId: Type.String({
          description: "Workflow ID to fetch quality report for",
        }),
      }),
      async execute(_toolCallId, params) {
        try {
          const [qualityResult, scoreResult, testResult, securityResult] = await Promise.allSettled(
            [
              client.get<unknown>(`/api/prompt/workflows/${params.workflowId}/quality`),
              client.get<unknown>(`/api/prompt/workflows/${params.workflowId}/score`),
              client.get<unknown>(`/api/prompt/workflows/${params.workflowId}/test-results`),
              client.get<unknown>(`/api/prompt/workflows/${params.workflowId}/security-scans`),
            ],
          );

          const parts: string[] = [];
          parts.push(`Quality Report for Workflow: ${params.workflowId}`);

          // Quality gates
          if (qualityResult.status === "fulfilled") {
            const quality = qualityResult.value as Record<string, unknown>;
            parts.push("\n=== Quality Gates ===");
            if (quality.passed != null) parts.push(`Passed: ${quality.passed}`);
            if (quality.gates) {
              parts.push(`Gates: ${JSON.stringify(quality.gates)}`);
            }
          } else {
            parts.push("\n=== Quality Gates ===");
            parts.push("Unavailable");
          }

          // Score
          if (scoreResult.status === "fulfilled") {
            const score = scoreResult.value as Record<string, unknown>;
            parts.push("\n=== Overall Score ===");
            if (score.score != null) parts.push(`Score: ${score.score}`);
            if (score.grade) parts.push(`Grade: ${score.grade}`);
          } else {
            parts.push("\n=== Overall Score ===");
            parts.push("Unavailable");
          }

          // Test results
          if (testResult.status === "fulfilled") {
            const tests = testResult.value as Record<string, unknown>;
            parts.push("\n=== Test Results ===");
            if (tests.total != null) parts.push(`Total tests: ${tests.total}`);
            if (tests.passed != null) parts.push(`Passed: ${tests.passed}`);
            if (tests.failed != null) parts.push(`Failed: ${tests.failed}`);
            if (tests.coverage) parts.push(`Coverage: ${JSON.stringify(tests.coverage)}`);
          } else {
            parts.push("\n=== Test Results ===");
            parts.push("Unavailable");
          }

          // Security scans
          if (securityResult.status === "fulfilled") {
            const security = securityResult.value as Record<string, unknown>;
            parts.push("\n=== Security Scans ===");
            if (security.scansRun) parts.push(`Scans run: ${JSON.stringify(security.scansRun)}`);
            if (security.vulnerabilities != null)
              parts.push(`Vulnerabilities: ${security.vulnerabilities}`);
            if (security.passed != null) parts.push(`Passed: ${security.passed}`);
          } else {
            parts.push("\n=== Security Scans ===");
            parts.push("Unavailable");
          }

          const text = parts.join("\n");
          return {
            content: [{ type: "text", text }],
            details: {
              quality: qualityResult.status === "fulfilled" ? qualityResult.value : null,
              score: scoreResult.status === "fulfilled" ? scoreResult.value : null,
              tests: testResult.status === "fulfilled" ? testResult.value : null,
              security: securityResult.status === "fulfilled" ? securityResult.value : null,
            },
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: "text",
                text: `Error fetching quality report: ${errorMessage}`,
              },
            ],
            details: { error: errorMessage },
          };
        }
      },
    },
    { name: "hermes_quality_report" },
  );

  // ========================================================================
  // Workflow Rating (LLM-as-Judge)
  // ========================================================================
  api.registerTool(
    {
      name: "hermes_workflow_rating",
      label: "Workflow Rating",
      description:
        "Get LLM-as-judge ratings for a workflow — per-phase scores for correctness and quality, overall grade (A-F), and improvement feedback.",
      parameters: Type.Object({
        workflowId: Type.String({
          description: "Workflow ID to fetch ratings for",
        }),
      }),
      async execute(_toolCallId, params) {
        try {
          const result = await client.get<unknown>(`/api/ratings/workflows/${params.workflowId}`);
          const rating = result as Record<string, unknown>;

          const parts: string[] = [];
          parts.push(`Workflow Rating: ${params.workflowId}`);

          if (rating.grade) parts.push(`Overall Grade: ${rating.grade}`);
          if (rating.averageScore != null) parts.push(`Average Score: ${rating.averageScore}/100`);

          const phases = rating.phases ? (rating.phases as Array<Record<string, unknown>>) : [];

          if (phases.length > 0) {
            parts.push("\n=== Phase Ratings ===");
            for (const phase of phases) {
              parts.push(`\n${phase.phaseName || "Unknown"}:`);
              if (phase.overall != null) parts.push(`  Overall: ${phase.overall}/100`);
              if (phase.correctness != null) parts.push(`  Correctness: ${phase.correctness}/100`);
              if (phase.quality != null) parts.push(`  Quality: ${phase.quality}/100`);
              if (Array.isArray(phase.feedback) && phase.feedback.length > 0) {
                parts.push(`  Feedback: ${phase.feedback.join("; ")}`);
              }
            }
          }

          if (Array.isArray(rating.weakPhases) && rating.weakPhases.length > 0) {
            parts.push(`\nWeak phases: ${rating.weakPhases.join(", ")}`);
          }
          if (Array.isArray(rating.strongPhases) && rating.strongPhases.length > 0) {
            parts.push(`Strong phases: ${rating.strongPhases.join(", ")}`);
          }

          const text = parts.join("\n");
          return {
            content: [{ type: "text", text }],
            details: rating,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: "text",
                text: `Error fetching workflow rating: ${errorMessage}`,
              },
            ],
            details: { error: errorMessage },
          };
        }
      },
    },
    { name: "hermes_workflow_rating" },
  );
}
