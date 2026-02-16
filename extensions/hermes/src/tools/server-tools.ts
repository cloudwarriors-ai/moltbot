import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import { stringEnum } from "openclaw/plugin-sdk";
import type { HermesClient } from "../client.js";

export function registerServerTools(api: OpenClawPluginApi, client: HermesClient): void {
  // 1. List servers
  api.registerTool(
    {
      name: "hermes_list_servers",
      label: "List Servers",
      description: "List all Hermes OpenCode server instances and their status.",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params) {
        try {
          const result = await client.get("/api/servers");
          const servers = Array.isArray(result) ? result : [];

          if (servers.length === 0) {
            return {
              content: [{ type: "text", text: "No servers found." }],
              details: { servers: [] },
            };
          }

          const summary = servers
            .map(
              (s: Record<string, unknown>, i: number) =>
                `${i + 1}. ${s.id} - ${s.status}\n   Port: ${s.port || "N/A"}\n   Project: ${s.projectDir || "N/A"}\n   Provider: ${s.provider || "N/A"} / ${s.model || "N/A"}`,
            )
            .join("\n");

          return {
            content: [{ type: "text", text: `Found ${servers.length} servers:\n${summary}` }],
            details: { servers },
          };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Failed to list servers: ${msg}` }],
            details: { error: msg },
          };
        }
      },
    },
    { name: "hermes_list_servers" },
  );

  // 2. Create server
  api.registerTool(
    {
      name: "hermes_create_server",
      label: "Create Server",
      description:
        "Create and auto-start a new OpenCode server instance. The server will be available for workflows after creation.",
      parameters: Type.Object({
        projectDir: Type.String({ description: "Project directory path for the OpenCode server" }),
        port: Type.Optional(
          Type.Number({ description: "Port for the server (auto-assigned if omitted)" }),
        ),
        provider: Type.Optional(
          Type.String({ description: "LLM provider (e.g., 'anthropic', 'openai')" }),
        ),
        model: Type.Optional(
          Type.String({ description: "LLM model name (e.g., 'claude-3-opus-20240229')" }),
        ),
      }),
      async execute(_toolCallId, params) {
        try {
          const { projectDir, port, provider, model } = params as {
            projectDir: string;
            port?: number;
            provider?: string;
            model?: string;
          };

          const body: Record<string, unknown> = { projectDir };
          if (port) body.port = port;
          if (provider) body.provider = provider;
          if (model) body.model = model;

          const result = await client.post("/api/servers", body);

          return {
            content: [
              {
                type: "text",
                text: `Created server ${result.id}:\nStatus: ${result.status}\nPort: ${result.port || "N/A"}\nProject: ${projectDir}\nProvider: ${provider || "default"} / ${model || "default"}`,
              },
            ],
            details: result,
          };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Failed to create server: ${msg}` }],
            details: { error: msg },
          };
        }
      },
    },
    { name: "hermes_create_server" },
  );

  // 3. Control server
  api.registerTool(
    {
      name: "hermes_server_control",
      label: "Control Server",
      description: "Start or stop an existing OpenCode server instance.",
      parameters: Type.Object({
        serverId: Type.String({ description: "The server ID to control" }),
        action: stringEnum(["start", "stop"], {
          description: "Action to perform on the server",
        }),
      }),
      async execute(_toolCallId, params) {
        try {
          const { serverId, action } = params as { serverId: string; action: string };

          const result = await client.post(`/api/servers/${serverId}/${action}`, {});

          return {
            content: [{ type: "text", text: `Successfully ${action}ed server ${serverId}` }],
            details: result,
          };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Failed to control server: ${msg}` }],
            details: { error: msg },
          };
        }
      },
    },
    { name: "hermes_server_control" },
  );
}
