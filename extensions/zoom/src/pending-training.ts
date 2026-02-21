/**
 * In-memory store for active training sessions.
 * When a reviewer clicks "Train", we store their session here so we can
 * intercept their next DM as feedback for regenerating the answer.
 */

import type { ZoomInboundThreadContext } from "./threading.js";
import type { ZoomThreadSessionScope } from "./types.js";

const TRAINING_TTL_MS = 30 * 60 * 1000; // 30 minutes

export type TrainingSession = {
  approvalRefId: string;
  originalChannelJid: string;
  originalChannelName: string;
  originalSenderName: string;
  originalQuestion: string;
  previousAnswer: string;
  agentId?: string;
  threadContext?: ZoomInboundThreadContext;
  replyMainMessageId?: string;
  sessionScopeAtCapture?: ZoomThreadSessionScope;
  reviewChannelJid: string;
  expiresAt: number;
};

const store = new Map<string, TrainingSession>();

/** Store a training session keyed by the reviewer's userJid. */
export function storeTrainingSession(userJid: string, data: Omit<TrainingSession, "expiresAt">): void {
  store.set(userJid, { ...data, expiresAt: Date.now() + TRAINING_TTL_MS });
}

/** Retrieve and consume a training session for this user (one-time use). */
export function consumeTrainingSession(userJid: string): TrainingSession | undefined {
  const entry = store.get(userJid);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    store.delete(userJid);
    return undefined;
  }
  store.delete(userJid);
  return entry;
}
