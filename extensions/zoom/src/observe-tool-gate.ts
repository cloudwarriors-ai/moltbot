/**
 * Tool gating for observe-mode sessions.
 *
 * When the agent runs in observe mode (monitoring a customer channel),
 * write/mutation tools are blocked and require reviewer approval before execution.
 * Read-only tools are allowed through without gating.
 *
 * Flow:
 * 1. Observe dispatch registers session as observe-mode via markSessionObserve()
 * 2. before_tool_call hook blocks write tools silently (no card sent from hook)
 * 3. After dispatch, monitor handler calls getSessionBlockedTools() to get all blocked calls
 * 4. One consolidated approval card is sent to the review channel
 * 5. Reviewer clicks "Approve & Execute" → markToolsApproved() whitelists all tools
 * 6. Re-dispatch → agent calls tools again → hook allows them through
 * 7. After dispatch completes → clearSessionObserve() cleans up
 */

/** Tools that require approval in observe mode */
const WRITE_TOOLS = new Set([
  "zw2_submit_zp_license",
  "zw2_refresh_pricing",
  "edit",
  "write",
  "Write",
  "Edit",
  "exec",
  "Bash",
]);

type ObserveSession = {
  channelJid: string;
  channelName: string;
  reviewChannelJid: string;
  senderName: string;
  senderJid?: string;
  question: string;
  silent?: boolean;
};

/** Active observe-mode sessions keyed by sessionKey */
const observeSessions = new Map<string, ObserveSession>();

/** Approved tool names keyed by sessionKey (allows ALL listed tools on re-dispatch) */
const approvedTools = new Map<string, Set<string>>();

/** Blocked tool calls collected during a single dispatch, keyed by sessionKey */
type BlockedToolEntry = { toolName: string; params: Record<string, unknown> };
const sessionBlockedTools = new Map<string, BlockedToolEntry[]>();

/** Stored blocked call sets for approval cards, keyed by refId */
type StoredBlockedCallSet = {
  sessionKey: string;
  tools: BlockedToolEntry[];
  channelJid: string;
  channelName: string;
  reviewChannelJid: string;
  senderName: string;
  senderJid?: string;
  question: string;
  silent?: boolean;
  expiresAt: number;
};
const blockedCallSets = new Map<string, StoredBlockedCallSet>();
let nextBlockId = 1;

const APPROVAL_TTL_MS = 30 * 60 * 1000; // 30 minutes

/** Mark a session as running in observe mode */
export function markSessionObserve(sessionKey: string, info: ObserveSession): void {
  observeSessions.set(sessionKey, info);
  sessionBlockedTools.delete(sessionKey); // clear any stale blocked tools
}

/** Clear observe-mode flag for a session */
export function clearSessionObserve(sessionKey: string): void {
  observeSessions.delete(sessionKey);
  approvedTools.delete(sessionKey);
  sessionBlockedTools.delete(sessionKey);
}

/** Check if a session is in observe mode */
export function isSessionObserve(sessionKey: string): ObserveSession | undefined {
  return observeSessions.get(sessionKey);
}

/** Approve all tools for a session (allows them through on re-dispatch) */
export function markToolsApproved(sessionKey: string, toolNames: string[]): void {
  approvedTools.set(sessionKey, new Set(toolNames));
}

/** Check if a tool is approved (does NOT consume — stays approved for the whole re-dispatch) */
function isApproved(sessionKey: string, toolName: string): boolean {
  const approved = approvedTools.get(sessionKey);
  return approved?.has(toolName) ?? false;
}

/** Get all blocked tool calls from a session's dispatch (and store them for the approval card) */
export function getSessionBlockedTools(sessionKey: string): { refId: string; tools: BlockedToolEntry[] } | undefined {
  const tools = sessionBlockedTools.get(sessionKey);
  if (!tools || tools.length === 0) return undefined;

  const session = observeSessions.get(sessionKey);
  if (!session) return undefined;

  const refId = `toolgate_${Date.now()}_${nextBlockId++}`;
  blockedCallSets.set(refId, {
    sessionKey,
    tools: [...tools],
    channelJid: session.channelJid,
    channelName: session.channelName,
    reviewChannelJid: session.reviewChannelJid,
    senderName: session.senderName,
    question: session.question,
    silent: session.silent,
    expiresAt: Date.now() + APPROVAL_TTL_MS,
  });

  return { refId, tools };
}

/** Retrieve a stored blocked call set (consumed on read) */
export function getBlockedCallSet(refId: string): StoredBlockedCallSet | undefined {
  const entry = blockedCallSets.get(refId);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    blockedCallSets.delete(refId);
    return undefined;
  }
  blockedCallSets.delete(refId);
  return entry;
}

/** Check if a write tool should be blocked in observe mode. If blocked, records it. */
export function shouldBlockTool(sessionKey: string | undefined, toolName: string, params: Record<string, unknown>): { block: false } | { block: true; session: ObserveSession } {
  if (!sessionKey) return { block: false };

  const session = observeSessions.get(sessionKey);
  if (!session) return { block: false };

  if (!WRITE_TOOLS.has(toolName)) return { block: false };

  // Check if this tool was pre-approved
  if (isApproved(sessionKey, toolName)) return { block: false };

  // Record the blocked call for the consolidated approval card
  const blocked = sessionBlockedTools.get(sessionKey) ?? [];
  // Deduplicate — don't record the same tool twice
  if (!blocked.some((b) => b.toolName === toolName)) {
    blocked.push({ toolName, params: { ...params } });
    sessionBlockedTools.set(sessionKey, blocked);
  }

  return { block: true, session };
}

/** Format tool params for display in approval card */
export function formatToolParams(params: Record<string, unknown>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(", ");
}
