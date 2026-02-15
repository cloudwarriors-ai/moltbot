import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";

const plugin = {
  id: "bighead",
  name: "Bighead",
  description: "Bighead AI avatar integration - send Rebecca to join Zoom meetings",
  configSchema: emptyPluginConfigSchema(),

  register(api: OpenClawPluginApi) {
    // bighead_join_meeting - globally available, works from any channel
    api.registerTool(() => ({
      name: "bighead_join_meeting",
      description:
        "Tell Rebecca (Bighead AI avatar) to join a Zoom meeting. " +
        "Use this when a user asks to have the AI join a meeting or provides a Zoom meeting link.",
      parameters: Type.Object({
        meeting_url: Type.String({
          description: "The Zoom meeting URL (e.g., https://zoom.us/j/123456?pwd=abc)",
        }),
        display_name: Type.Optional(
          Type.String({ description: "Display name for the avatar in the meeting (default: Rebecca)" }),
        ),
        announcement: Type.Optional(
          Type.String({
            description: "Message for Rebecca to announce when she joins the meeting",
          }),
        ),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const meetingUrl = params.meeting_url as string;
        const displayName = (params.display_name as string) ?? undefined;
        const announcement = (params.announcement as string) ?? undefined;

        const bigheadUrl = process.env.BIGHEAD_API_URL ?? "http://host.docker.internal:8015";

        try {
          const resp = await fetch(`${bigheadUrl}/api/meeting/join-auto`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url: meetingUrl,
              name: displayName,
              announcement,
            }),
          });

          const data = (await resp.json()) as Record<string, unknown>;

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  ok: resp.ok,
                  meeting_id: data.meeting_id ?? null,
                  status: data.status ?? (resp.ok ? "joining" : "failed"),
                  error: data.error ?? null,
                }),
              },
            ],
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ ok: false, error: message }),
              },
            ],
          };
        }
      },
    }));

    // bighead_analyze_transcript - send transcript text for structured extraction
    api.registerTool(() => ({
      name: "bighead_analyze_transcript",
      description:
        "Send a meeting transcript to Rebecca (Bighead AI) for structured order data extraction. " +
        "Returns extracted fields organized by ZW2 API sections with confidence notes for unclear fields.",
      parameters: Type.Object({
        transcript_text: Type.String({
          description: "The full VTT/text transcript content to analyze",
        }),
        system_prompt: Type.Optional(
          Type.String({ description: "Optional override for the extraction system prompt" }),
        ),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const bigheadUrl = process.env.BIGHEAD_API_URL ?? "http://bighead:8000";

        try {
          const resp = await fetch(`${bigheadUrl}/api/analyze/transcript`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: params.transcript_text as string,
              system_prompt: (params.system_prompt as string) ?? undefined,
            }),
          });

          const data = (await resp.json()) as Record<string, unknown>;

          if (!resp.ok) {
            return {
              content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: data.error ?? `HTTP ${resp.status}` }) }],
            };
          }

          return {
            content: [{ type: "text" as const, text: JSON.stringify({ ok: true, ...data }) }],
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: message }) }],
          };
        }
      },
    }));

    // bighead_followup - multi-turn follow-up on a transcript analysis
    api.registerTool(() => ({
      name: "bighead_followup",
      description:
        "Follow up on a previous transcript analysis to ask about missing or unclear fields. " +
        "Uses the conversation_id from a prior bighead_analyze_transcript call to maintain context.",
      parameters: Type.Object({
        conversation_id: Type.String({
          description: "The conversation_id from a previous analyze_transcript response",
        }),
        message: Type.String({
          description: "The follow-up question or clarification request for Rebecca",
        }),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const bigheadUrl = process.env.BIGHEAD_API_URL ?? "http://bighead:8000";

        try {
          const resp = await fetch(`${bigheadUrl}/api/analyze/followup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              conversation_id: params.conversation_id as string,
              message: params.message as string,
            }),
          });

          const data = (await resp.json()) as Record<string, unknown>;

          if (!resp.ok) {
            return {
              content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: data.error ?? `HTTP ${resp.status}` }) }],
            };
          }

          return {
            content: [{ type: "text" as const, text: JSON.stringify({ ok: true, ...data }) }],
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: message }) }],
          };
        }
      },
    }));

    // bighead_leave_meeting - tell Rebecca to leave the current meeting
    api.registerTool(() => ({
      name: "bighead_leave_meeting",
      description:
        "Tell Rebecca (Bighead AI avatar) to leave the current Zoom meeting. " +
        "Use this when a user asks Rebecca to leave, hang up, or disconnect from the meeting.",
      parameters: Type.Object({}),
      async execute(_id: string) {
        const bigheadUrl = process.env.BIGHEAD_API_URL ?? "http://bighead:8000";

        try {
          const resp = await fetch(`${bigheadUrl}/api/meeting/leave`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          });

          const data = (await resp.json()) as Record<string, unknown>;

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  ok: resp.ok,
                  message: data.message ?? (resp.ok ? "Left meeting" : "Failed to leave"),
                }),
              },
            ],
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ ok: false, error: message }),
              },
            ],
          };
        }
      },
    }));
  },
};

export default plugin;
