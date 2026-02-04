/**
 * Browser-based GitHub 2FA Authentication
 *
 * Uses Playwright to trigger GitHub's native login flow, which sends
 * a push notification to GitHub Mobile. User just taps to approve.
 *
 * Flow:
 * 1. Open browser to GitHub login
 * 2. Enter stored credentials
 * 3. GitHub sends 2FA push to mobile (shows 2-digit code)
 * 4. User taps approve on phone
 * 5. Detect successful login
 * 6. Return success
 */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

export type BrowserAuthConfig = {
  username: string;
  password: string;
  headless?: boolean;
  timeout?: number; // ms to wait for 2FA approval
};

export type BrowserAuthResult =
  | { success: true; username: string }
  | { success: false; error: string };

const GITHUB_LOGIN_URL = "https://github.com/login";
const DEFAULT_TIMEOUT = 120_000; // 2 minutes for user to approve

/**
 * Trigger GitHub login flow and wait for 2FA approval.
 */
export async function triggerGitHub2FA(config: BrowserAuthConfig): Promise<BrowserAuthResult> {
  const { username, password, headless = true, timeout = DEFAULT_TIMEOUT } = config;

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    // Launch browser
    browser = await chromium.launch({
      headless,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    const page = await context.newPage();

    // Navigate to GitHub login
    await page.goto(GITHUB_LOGIN_URL, { waitUntil: "networkidle" });

    // Check if already logged in (redirected to dashboard)
    if (page.url().includes("github.com") && !page.url().includes("/login")) {
      // Already logged in, try to trigger sudo mode
      return await triggerSudoMode(page, timeout);
    }

    // Fill login form
    await page.fill('input[name="login"]', username);
    await page.fill('input[name="password"]', password);

    // Click sign in
    await page.click('input[type="submit"][value="Sign in"]');

    // Wait for either:
    // 1. 2FA page (success - waiting for mobile approval)
    // 2. Error message (wrong credentials)
    // 3. Dashboard (already approved / no 2FA)

    const result = await Promise.race([
      waitFor2FAPage(page),
      waitForLoginError(page),
      waitForDashboard(page),
    ]);

    if (result.type === "error") {
      return { success: false, error: result.message };
    }

    if (result.type === "dashboard") {
      // No 2FA required or already approved
      return { success: true, username };
    }

    // On 2FA page - wait for user to approve on mobile
    console.log("[browser-auth] Waiting for GitHub Mobile 2FA approval...");

    const approved = await waitForApproval(page, timeout);

    if (approved) {
      return { success: true, username };
    } else {
      return { success: false, error: "2FA approval timed out or was denied" };
    }
  } catch (err) {
    return { success: false, error: `Browser auth failed: ${String(err)}` };
  } finally {
    await context?.close();
    await browser?.close();
  }
}

async function waitFor2FAPage(page: Page): Promise<{ type: "2fa" }> {
  // GitHub's 2FA page has various indicators
  await Promise.race([
    page.waitForSelector('text="Two-factor authentication"', { timeout: 10_000 }),
    page.waitForSelector('text="Verify with GitHub Mobile"', { timeout: 10_000 }),
    page.waitForSelector('[data-target="two-factor-code"]', { timeout: 10_000 }),
    page.waitForURL(/.*\/sessions\/two-factor.*/, { timeout: 10_000 }),
  ]);
  return { type: "2fa" };
}

async function waitForLoginError(page: Page): Promise<{ type: "error"; message: string }> {
  const errorEl = await page.waitForSelector(".flash-error", { timeout: 10_000 });
  const message = (await errorEl?.textContent()) ?? "Login failed";
  return { type: "error", message: message.trim() };
}

async function waitForDashboard(page: Page): Promise<{ type: "dashboard" }> {
  // Dashboard URL patterns
  await page.waitForURL(/github\.com\/(dashboard|$)/, { timeout: 10_000 });
  return { type: "dashboard" };
}

async function waitForApproval(page: Page, timeout: number): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    // Check if we've moved past the 2FA page
    const url = page.url();

    // Success indicators
    if (
      url.includes("github.com") &&
      !url.includes("/login") &&
      !url.includes("/sessions/two-factor")
    ) {
      return true;
    }

    // Check for denial/error
    const errorVisible = await page.$(".flash-error");
    if (errorVisible) {
      return false;
    }

    // Poll every 500ms
    await new Promise((r) => setTimeout(r, 500));
  }

  return false;
}

async function triggerSudoMode(page: Page, timeout: number): Promise<BrowserAuthResult> {
  // Navigate to a page that requires sudo mode (re-authentication)
  await page.goto("https://github.com/settings/security", { waitUntil: "networkidle" });

  // Check if sudo mode was triggered
  const url = page.url();
  if (url.includes("/sessions/sudo")) {
    // Wait for 2FA approval
    const approved = await waitForApproval(page, timeout);
    if (approved) {
      return { success: true, username: "authenticated" };
    }
    return { success: false, error: "Sudo mode 2FA approval timed out" };
  }

  // Already in sudo mode or no re-auth required
  return { success: true, username: "authenticated" };
}
