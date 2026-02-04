/**
 * GitHub 2FA Extension Configuration
 */

export type AuthMode = "device" | "browser" | "oauth";

export type TwoFactorConfig = {
  /**
   * Auth mode:
   * - "device": GitHub device flow (shows code to enter manually)
   * - "browser": Playwright-based login (triggers GitHub Mobile push)
   * - "oauth": OAuth callback flow (tap link, already logged in = instant)
   */
  authMode?: AuthMode;
  /** GitHub OAuth App Client ID */
  clientId?: string;
  /** GitHub OAuth App Client Secret (for oauth mode) */
  clientSecret?: string;
  /** Base URL for OAuth callbacks (e.g., https://moltbot-doug.ngrok.app) */
  baseUrl?: string;
  /** ngrok auth token for auto-starting tunnel (oauth mode) */
  ngrokAuthToken?: string;
  /** ngrok domain (e.g., moltbot-doug.ngrok.app) */
  ngrokDomain?: string;
  /** GitHub username (for browser flow) - can also use GITHUB_USERNAME env var */
  githubUsername?: string;
  /** GitHub password (for browser flow) - can also use GITHUB_PASSWORD env var */
  githubPassword?: string;
  /** Run browser in headless mode (default: true) */
  headless?: boolean;
  tokenTtlMinutes?: number;
  sensitiveTools?: string[];
  gateAllTools?: boolean;
  /**
   * Channels eligible for persistent trust mode.
   * Format: "channel:identifier" e.g., "whatsapp:self", "whatsapp:+18134158812"
   * "whatsapp:self" matches self-chat mode (sender === bot phone number)
   */
  trustedChannels?: string[];
  /**
   * File paths that ALWAYS require fresh 2FA, even with trust enabled.
   * Protects against circumvention by preventing code modification.
   * Default: ["src/", "extensions/", "dist/"]
   */
  protectedPaths?: string[];
  /**
   * Paths allowed for read operations without 2FA.
   * Supports glob-like patterns with * wildcards.
   * If set, any read outside these paths requires 2FA.
   * If not set, read is ungated (legacy behavior).
   */
  allowedReadPaths?: string[];
};

const DEFAULT_SENSITIVE_TOOLS = ["exec", "Bash", "Write", "Edit", "NotebookEdit"];
const DEFAULT_TTL_MINUTES = 30;
const DEFAULT_PROTECTED_PATHS = ["src/", "extensions/", "dist/", ".openclaw/"];

export function parseConfig(value: unknown): TwoFactorConfig {
  if (!value || typeof value !== "object") return {};
  const cfg = value as Record<string, unknown>;

  let authMode: AuthMode = "device";
  if (cfg.authMode === "browser") authMode = "browser";
  if (cfg.authMode === "oauth") authMode = "oauth";

  return {
    authMode,
    clientId: typeof cfg.clientId === "string" ? cfg.clientId : undefined,
    clientSecret: typeof cfg.clientSecret === "string" ? cfg.clientSecret : undefined,
    baseUrl: typeof cfg.baseUrl === "string" ? cfg.baseUrl : undefined,
    ngrokAuthToken: typeof cfg.ngrokAuthToken === "string" ? cfg.ngrokAuthToken : undefined,
    ngrokDomain: typeof cfg.ngrokDomain === "string" ? cfg.ngrokDomain : undefined,
    githubUsername: typeof cfg.githubUsername === "string" ? cfg.githubUsername : undefined,
    githubPassword: typeof cfg.githubPassword === "string" ? cfg.githubPassword : undefined,
    headless: typeof cfg.headless === "boolean" ? cfg.headless : true,
    tokenTtlMinutes:
      typeof cfg.tokenTtlMinutes === "number" ? cfg.tokenTtlMinutes : DEFAULT_TTL_MINUTES,
    sensitiveTools: Array.isArray(cfg.sensitiveTools)
      ? cfg.sensitiveTools.filter((t): t is string => typeof t === "string")
      : DEFAULT_SENSITIVE_TOOLS,
    gateAllTools: typeof cfg.gateAllTools === "boolean" ? cfg.gateAllTools : false,
    trustedChannels: Array.isArray(cfg.trustedChannels)
      ? cfg.trustedChannels.filter((c): c is string => typeof c === "string")
      : undefined,
    protectedPaths: Array.isArray(cfg.protectedPaths)
      ? cfg.protectedPaths.filter((p): p is string => typeof p === "string")
      : DEFAULT_PROTECTED_PATHS,
    allowedReadPaths: Array.isArray(cfg.allowedReadPaths)
      ? cfg.allowedReadPaths.filter((p): p is string => typeof p === "string")
      : undefined,
  };
}

export const twoFactorConfigSchema = {
  parse: parseConfig,
  uiHints: {
    clientId: {
      label: "GitHub OAuth App Client ID",
      placeholder: "Iv1.xxxxxxxxxxxxxxxx",
      help: "Create at GitHub Settings > Developer Settings > OAuth Apps (enable Device Flow)",
    },
    tokenTtlMinutes: {
      label: "Session TTL (minutes)",
      placeholder: "30",
      help: "How long before re-authentication is required (for non-trusted channels)",
    },
    sensitiveTools: {
      label: "Sensitive Tools",
      help: "Tool names requiring 2FA (default: Bash, Write, Edit, NotebookEdit)",
    },
    gateAllTools: {
      label: "Gate All Tools",
      help: "Require 2FA for all tools, not just sensitive ones",
    },
    trustedChannels: {
      label: "Trusted Channels",
      help: "Channels eligible for persistent trust (e.g., 'whatsapp:self'). Requires initial 2FA to enable.",
    },
    protectedPaths: {
      label: "Protected Paths",
      help: "File paths that ALWAYS require fresh 2FA, even with trust. Prevents circumvention.",
    },
    allowedReadPaths: {
      label: "Allowed Read Paths",
      help: "Paths whitelisted for read without 2FA. Supports * wildcards. If set, reads outside require approval.",
    },
  },
};

/**
 * Check if a file path is protected (always requires fresh 2FA).
 */
export function isProtectedPath(filePath: string, protectedPaths: string[]): boolean {
  const normalizedPath = filePath.replace(/\\/g, "/");
  return protectedPaths.some((protected_) => {
    const normalizedProtected = protected_.replace(/\\/g, "/");
    return normalizedPath.includes(normalizedProtected);
  });
}

/**
 * Check if a file path matches any of the allowed patterns.
 * Supports simple glob patterns with * for any characters.
 */
export function isAllowedReadPath(filePath: string, allowedPaths: string[]): boolean {
  const normalizedPath = filePath.replace(/\\/g, "/");

  return allowedPaths.some((pattern) => {
    const normalizedPattern = pattern.replace(/\\/g, "/");

    // Convert glob pattern to regex
    // Escape special regex chars except *, then convert * to .*
    const regexStr = normalizedPattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");

    const regex = new RegExp(`^${regexStr}$|${regexStr}`);
    return regex.test(normalizedPath);
  });
}
