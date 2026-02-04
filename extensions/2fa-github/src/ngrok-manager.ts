/**
 * Ngrok Process Manager
 *
 * Automatically starts/stops ngrok tunnel for OAuth callbacks.
 * Only runs during the OAuth flow, killed after successful auth.
 */

import { spawn, type ChildProcess } from "node:child_process";

let ngrokProcess: ChildProcess | null = null;
let ngrokReady = false;
let shutdownTimer: ReturnType<typeof setTimeout> | null = null;

export type NgrokConfig = {
  authToken: string;
  domain: string;
  port: number;
};

/**
 * Start ngrok tunnel if not already running.
 * Returns the public URL when ready.
 */
export async function startNgrok(
  config: NgrokConfig,
): Promise<{ url: string } | { error: string }> {
  // Already running
  if (ngrokProcess && ngrokReady) {
    cancelShutdown();
    return { url: `https://${config.domain}` };
  }

  // Kill any existing process first
  await stopNgrok();

  return new Promise((resolve) => {
    // First, set the auth token
    const authProcess = spawn("ngrok", ["config", "add-authtoken", config.authToken], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    authProcess.on("close", (code) => {
      if (code !== 0) {
        resolve({ error: `Failed to set ngrok auth token (exit code ${code})` });
        return;
      }

      // Now start the tunnel
      ngrokProcess = spawn("ngrok", ["http", config.port.toString(), `--domain=${config.domain}`], {
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      });

      let output = "";
      let errorOutput = "";

      ngrokProcess.stdout?.on("data", (data) => {
        output += data.toString();
      });

      ngrokProcess.stderr?.on("data", (data) => {
        errorOutput += data.toString();
      });

      ngrokProcess.on("error", (err) => {
        ngrokProcess = null;
        ngrokReady = false;
        resolve({ error: `Failed to start ngrok: ${err.message}` });
      });

      ngrokProcess.on("close", (code) => {
        ngrokProcess = null;
        ngrokReady = false;
        if (code !== 0 && code !== null) {
          console.error(`ngrok exited with code ${code}: ${errorOutput}`);
        }
      });

      // ngrok with a custom domain connects quickly, give it a moment
      setTimeout(() => {
        if (ngrokProcess) {
          ngrokReady = true;
          resolve({ url: `https://${config.domain}` });
        } else {
          resolve({ error: `ngrok failed to start: ${errorOutput || output || "unknown error"}` });
        }
      }, 2000);
    });

    authProcess.on("error", (err) => {
      resolve({ error: `ngrok not installed or not in PATH: ${err.message}` });
    });
  });
}

/**
 * Stop ngrok tunnel immediately.
 */
export async function stopNgrok(): Promise<void> {
  cancelShutdown();

  if (ngrokProcess) {
    ngrokProcess.kill("SIGTERM");
    ngrokProcess = null;
    ngrokReady = false;
    // Give it a moment to clean up
    await new Promise((r) => setTimeout(r, 500));
  }
}

/**
 * Schedule ngrok shutdown after a delay.
 * Useful to keep tunnel open briefly after OAuth in case of retries.
 */
export function scheduleShutdown(delayMs: number = 30000): void {
  cancelShutdown();
  shutdownTimer = setTimeout(() => {
    stopNgrok();
  }, delayMs);
}

/**
 * Cancel any scheduled shutdown.
 */
export function cancelShutdown(): void {
  if (shutdownTimer) {
    clearTimeout(shutdownTimer);
    shutdownTimer = null;
  }
}

/**
 * Check if ngrok is currently running and ready.
 */
export function isNgrokRunning(): boolean {
  return ngrokProcess !== null && ngrokReady;
}
