import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface ConnectSessionOptions {
  loginUrl: string;
  username: string;
  password: string;
  sessionPath: string;
  /** Show browser so user can complete 2FA or captcha if needed */
  headed?: boolean;
}

export interface ConnectSessionResult {
  success: boolean;
  error?: string;
  sessionPath?: string;
}

export async function connectAndSaveSession(
  options: ConnectSessionOptions
): Promise<ConnectSessionResult> {
  const headed = options.headed ?? true;
  let browser;

  try {
    await mkdir(dirname(options.sessionPath), { recursive: true });
    browser = await chromium.launch({ headless: !headed, slowMo: headed ? 50 : 0 });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    await page.goto(options.loginUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

    const userSelectors = [
      'input[type="email"]',
      'input[name="username"]',
      'input[name="email"]',
      'input[id="username"]',
      'input[autocomplete="username"]',
      'input[type="text"]',
    ];
    const passSelectors = ['input[type="password"]', 'input[autocomplete="current-password"]'];

    let filled = false;
    for (const sel of userSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        await el.fill(options.username);
        filled = true;
        break;
      }
    }

    for (const sel of passSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        await el.fill(options.password);
        break;
      }
    }

    if (filled) {
      const submit = page.locator('button[type="submit"], input[type="submit"]').first();
      if (await submit.isVisible({ timeout: 3000 }).catch(() => false)) {
        await submit.click();
      }
    }

    if (headed) {
      // Give user time to complete 2FA / captcha manually
      await page.waitForTimeout(15000);
    } else {
      await page.waitForTimeout(4000);
    }

    await context.storageState({ path: options.sessionPath });
    await browser.close();
    browser = null;

    return { success: true, sessionPath: options.sessionPath };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
