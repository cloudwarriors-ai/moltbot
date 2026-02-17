import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import { stringEnum } from "openclaw/plugin-sdk";
import type { HermesClient } from "../client.js";

type ProviderStatus = {
  authenticated: boolean;
  method?: string;
};

type AuthStatus = Record<string, ProviderStatus>;

type ConnectResult = {
  started?: boolean;
  success?: boolean;
  authUrl?: string;
  state?: string;
  requiresCodePaste?: boolean;
  message?: string;
};

export function registerConnectionTools(api: OpenClawPluginApi, client: HermesClient): void {
  // 1. Connection status
  api.registerTool(
    {
      name: "hermes_connection_status",
      label: "Connection Status",
      description:
        "Check which LLM providers (anthropic, openai, openrouter) are connected to Hermes and their auth method. Always call this FIRST before starting workflows — workflows will fail if the required provider is not connected. Providers authenticate via OAuth (anthropic, openai) or API key (openrouter).",
      parameters: Type.Object({}),
      async execute() {
        try {
          const status = await client.get<AuthStatus>("/api/auth/status");
          const entries = Object.entries(status);

          if (entries.length === 0) {
            return {
              content: [{ type: "text", text: "No providers configured." }],
              details: { providers: {} },
            };
          }

          const lines = entries.map(([name, info]) => {
            const state = info.authenticated
              ? `connected (${info.method || "unknown"})`
              : "not connected";
            return `  ${name}: ${state}`;
          });

          const connected = entries.filter(([, info]) => info.authenticated).length;

          return {
            content: [
              {
                type: "text",
                text: `Provider connections (${connected}/${entries.length} connected):\n${lines.join("\n")}`,
              },
            ],
            details: { providers: status },
          };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Failed to get connection status: ${msg}` }],
            details: { error: msg },
          };
        }
      },
    },
    { name: "hermes_connection_status" },
  );

  // 2. Connect provider
  api.registerTool(
    {
      name: "hermes_connect_provider",
      label: "Connect Provider",
      description:
        "Start the OAuth connection flow for an LLM provider. For anthropic and openai, returns a browser URL the user must open to authorize. Anthropic uses a code-paste flow (user copies code from callback page → submit via hermes_complete_oauth). OpenAI completes automatically after browser authorization. For openrouter, use hermes_set_api_key instead (API key auth, not OAuth). Save the 'state' value from the response — it's needed for hermes_complete_oauth.",
      parameters: Type.Object({
        provider: stringEnum(["anthropic", "openai", "openrouter"], {
          description: "The LLM provider to connect",
        }),
      }),
      async execute(_toolCallId, params) {
        try {
          const { provider } = params as { provider: string };

          const result = await client.post<ConnectResult>(
            `/api/auth/opencode/connect/${provider}`,
            {},
          );

          if (result.authUrl) {
            const parts = [
              `OAuth flow started for ${provider}.`,
              `\nOpen this URL in your browser:\n${result.authUrl}`,
            ];

            if (result.requiresCodePaste) {
              parts.push(
                "\nAfter authorizing, you'll see a code on the callback page. Use hermes_complete_oauth to submit it.",
              );
            } else {
              parts.push(
                "\nAfter authorizing in the browser, the connection will complete automatically.",
              );
            }

            return {
              content: [{ type: "text", text: parts.join("") }],
              details: result,
            };
          }

          return {
            content: [
              {
                type: "text",
                text: result.message || `Connection initiated for ${provider}.`,
              },
            ],
            details: result,
          };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: "text",
                text: `Failed to connect ${(params as { provider: string }).provider}: ${msg}`,
              },
            ],
            details: { error: msg },
          };
        }
      },
    },
    { name: "hermes_connect_provider" },
  );

  // 3. Complete OAuth (for Anthropic code-paste flow)
  api.registerTool(
    {
      name: "hermes_complete_oauth",
      label: "Complete OAuth",
      description:
        "Complete an Anthropic OAuth flow by submitting the authorization code. After the user opens the authUrl from hermes_connect_provider and authorizes in their browser, they see a code on the callback page. Submit that code here along with the state value from the original connect response. Only needed for Anthropic (OpenAI completes automatically).",
      parameters: Type.Object({
        code: Type.String({ description: "The authorization code from the OAuth callback page" }),
        state: Type.Optional(
          Type.String({
            description:
              "The state parameter from the original connect response (for verification)",
          }),
        ),
      }),
      async execute(_toolCallId, params) {
        try {
          const { code, state } = params as { code: string; state?: string };

          const body: Record<string, unknown> = { code };
          if (state) body.state = state;

          const result = await client.post<{ success: boolean; error?: string }>(
            "/api/auth/anthropic/complete",
            body,
          );

          if (result.success) {
            return {
              content: [
                {
                  type: "text",
                  text: "Anthropic OAuth completed successfully. Provider is now connected.",
                },
              ],
              details: result,
            };
          }

          return {
            content: [
              { type: "text", text: `OAuth completion failed: ${result.error || "unknown error"}` },
            ],
            details: result,
          };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Failed to complete OAuth: ${msg}` }],
            details: { error: msg },
          };
        }
      },
    },
    { name: "hermes_complete_oauth" },
  );

  // 4. Disconnect provider
  api.registerTool(
    {
      name: "hermes_disconnect_provider",
      label: "Disconnect Provider",
      description:
        "Disconnect an LLM provider from Hermes. Revokes the OAuth token or removes the API key.",
      parameters: Type.Object({
        provider: stringEnum(["anthropic", "openai", "openrouter"], {
          description: "The LLM provider to disconnect",
        }),
      }),
      async execute(_toolCallId, params) {
        try {
          const { provider } = params as { provider: string };

          const result = await client.post<{ success: boolean; message?: string }>(
            `/api/auth/opencode/disconnect/${provider}`,
            {},
          );

          return {
            content: [
              {
                type: "text",
                text: result.message || `Successfully disconnected ${provider}.`,
              },
            ],
            details: result,
          };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: "text",
                text: `Failed to disconnect ${(params as { provider: string }).provider}: ${msg}`,
              },
            ],
            details: { error: msg },
          };
        }
      },
    },
    { name: "hermes_disconnect_provider" },
  );

  // 5. Set API key (OpenRouter)
  api.registerTool(
    {
      name: "hermes_set_api_key",
      label: "Set API Key",
      description:
        "Set an API key for a provider (currently only OpenRouter supports API key auth). For OAuth-based providers like Anthropic and OpenAI, use hermes_connect_provider instead.",
      parameters: Type.Object({
        provider: stringEnum(["openrouter"], {
          description: "The provider to set the API key for",
        }),
        apiKey: Type.String({ description: "The API key to set" }),
      }),
      async execute(_toolCallId, params) {
        try {
          const { provider, apiKey } = params as { provider: string; apiKey: string };

          const result = await client.post<{ success: boolean; error?: string }>(
            "/api/auth/apikey",
            {
              provider,
              apiKey,
            },
          );

          if (result.success) {
            return {
              content: [
                { type: "text", text: `API key set for ${provider}. Provider is now connected.` },
              ],
              details: { success: true, provider },
            };
          }

          return {
            content: [
              { type: "text", text: `Failed to set API key: ${result.error || "unknown error"}` },
            ],
            details: result,
          };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Failed to set API key: ${msg}` }],
            details: { error: msg },
          };
        }
      },
    },
    { name: "hermes_set_api_key" },
  );
}
