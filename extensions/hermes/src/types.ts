/**
 * Hermes API response types.
 *
 * These model the JSON shapes returned by the Hermes orchestration server.
 * Only fields consumed by our tools are declared — extra fields are silently ignored.
 */

// ============================================================================
// Health
// ============================================================================

export type HealthStatus = {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  uptime: number;
  version: string;
  checks: Record<string, { status: "pass" | "fail" | "warn"; latency?: number; message?: string }>;
};

// ============================================================================
// Servers
// ============================================================================

export type HermesServer = {
  id: string;
  hostname: string;
  port: number;
  projectDir: string;
  provider?: string;
  model?: string;
  status: "online" | "offline" | "error" | "starting";
  createdAt: string;
};

// ============================================================================
// Workflows
// ============================================================================

export type WorkflowStatus =
  | "pending"
  | "planning"
  | "building"
  | "testing"
  | "validating"
  | "complete"
  | "failed"
  | "paused"
  | "cancelled";

export type HermesWorkflow = {
  id: string;
  prompt: string;
  status: WorkflowStatus;
  flowType: "greenfield" | "refactor";
  serverId?: string;
  organizationId?: string;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
};

export type HermesPhase = {
  id: string;
  workflowId: string;
  name: string;
  status: string;
  input?: string;
  output?: string;
  startedAt?: string;
  completedAt?: string;
  tokens?: number;
  cost?: number;
  rating?: number;
};

// ============================================================================
// Logs
// ============================================================================

export type LogEntry = {
  id: string;
  level: string;
  message: string;
  source?: string;
  workflowId?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
};

export type SystemSummary = {
  health: Record<string, unknown>;
  recentWorkflows: unknown[];
  bufferStats?: Record<string, unknown>;
};

export type StallReport = {
  stalls: Array<{
    workflowId: string;
    phaseId?: string;
    diagnosis: string;
    duration: number;
  }>;
};

// ============================================================================
// Council
// ============================================================================

export type CouncilDeliberation = {
  id: string;
  task: string;
  status: string;
  decision?: string;
  consensus?: number;
  turns: number;
  createdAt: string;
};

export type CouncilStatus = {
  enabled: boolean;
  activeDeliberations: number;
  config?: Record<string, unknown>;
};

// ============================================================================
// Quality & Ratings
// ============================================================================

export type QualitySummary = {
  quality?: Record<string, unknown>;
  score?: Record<string, unknown>;
  testResults?: Record<string, unknown>;
  securityScans?: Record<string, unknown>;
};

export type WorkflowRating = {
  phases: Array<{
    phaseName: string;
    phaseId: string;
    overall: number;
    correctness: number;
    quality: number;
    feedback: string[];
  }>;
  averageScore: number;
  grade: "A" | "B" | "C" | "D" | "F";
  summary: string;
  weakPhases: string[];
  strongPhases: string[];
};

// ============================================================================
// Config
// ============================================================================

export type HermesPluginConfig = {
  baseUrl: string;
  apiKey?: string;
  organizationId?: string;
  timeoutMs: number;
};
