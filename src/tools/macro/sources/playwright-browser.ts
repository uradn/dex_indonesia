/**
 * Shared Playwright browser helper for sites that block plain HTTP clients.
 *
 * Solves Cloudflare "managed challenge" (JS fingerprint) for:
 *   - webapi.bps.go.id  — BPS trade/CPI data
 *   - www.bi.go.id       — BI SRBI / JISDOR data
 *   - www.djppr.kemenkeu.go.id — SBN foreign ownership
 *
 * Design:
 *   - Single lazy-init Chromium instance (shared across all callers)
 *   - Cookies persisted to .dexter/browser-state.json (survives process restart)
 *   - Cloudflare wait: polls until <title> is no longer "Just a moment..."
 *   - fetchJsonWithBrowser: intercepts response body before Cloudflare rewrites it
 */

import { chromium, type Browser, type BrowserContext } from 'playwright';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dexterPath } from '../../../utils/paths.js';

const COOKIE_STORE_PATH = dexterPath('browser-state.json');
const BROWSER_TIMEOUT_MS = 30_000;
const CF_WAIT_TIMEOUT_MS = 20_000;
const CF_POLL_MS = 500;

let browser: Browser | null = null;
let context: BrowserContext | null = null;

function loadCookieStore(): Record<string, unknown>[] {
  try {
    if (existsSync(COOKIE_STORE_PATH)) {
      return JSON.parse(readFileSync(COOKIE_STORE_PATH, 'utf-8')) as Record<string, unknown>[];
    }
  } catch { /* ignore */ }
  return [];
}

function saveCookieStore(cookies: Record<string, unknown>[]): void {
  try {
    const dir = COOKIE_STORE_PATH.slice(0, COOKIE_STORE_PATH.lastIndexOf('/'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(COOKIE_STORE_PATH, JSON.stringify(cookies, null, 2), 'utf-8');
  } catch { /* ignore */ }
}

async function getContext(): Promise<BrowserContext> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--disable-logging',
        '--log-level=3',
      ],
    });
    context = null;
  }
  if (!context) {
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'id-ID',
      timezoneId: 'Asia/Jakarta',
    });
    // Restore persisted cookies
    const saved = loadCookieStore();
    if (saved.length > 0) {
      await context.addCookies(saved as unknown as Parameters<BrowserContext['addCookies']>[0]);
    }
  }
  return context;
}

/** Wait until Cloudflare challenge clears (title no longer "Just a moment..."). */
async function waitForCloudflare(page: import('playwright').Page): Promise<void> {
  const deadline = Date.now() + CF_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const title = await page.title().catch(() => '');
    if (!title.includes('Just a moment') && !title.includes('Attention Required')) return;
    await page.waitForTimeout(CF_POLL_MS);
  }
  throw new Error('Cloudflare challenge did not resolve within timeout');
}

async function persistCookies(): Promise<void> {
  if (!context) return;
  try {
    const cookies = await context.cookies();
    saveCookieStore(cookies as unknown as Record<string, unknown>[]);
  } catch { /* ignore */ }
}

/**
 * Fetch page HTML after Cloudflare clears.
 * Uses networkidle so JS-rendered content is included.
 * Returns null on error.
 */
export async function fetchHtmlWithBrowser(url: string): Promise<string | null> {
  let page: import('playwright').Page | null = null;
  try {
    const ctx = await getContext();
    page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'load', timeout: BROWSER_TIMEOUT_MS });
    await waitForCloudflare(page);
    await page.waitForTimeout(2_000);
    const html = await page.content();
    await persistCookies();
    return html;
  } catch {
    return null;
  } finally {
    await page?.close().catch(() => undefined);
  }
}

/**
 * Fetch rendered inner text from a JS-rendered page (after Cloudflare + JS completes).
 * Useful for extracting values from dynamically rendered pages like Trading Economics.
 * Returns null on error.
 */
export async function fetchRenderedTextWithBrowser(url: string): Promise<string | null> {
  let page: import('playwright').Page | null = null;
  try {
    const ctx = await getContext();
    page = await ctx.newPage();
    // Use 'load' instead of 'networkidle' — TE keeps background XHR open indefinitely
    await page.goto(url, { waitUntil: 'load', timeout: BROWSER_TIMEOUT_MS });
    await waitForCloudflare(page);
    // Allow JS to finish rendering dynamic values
    await page.waitForTimeout(3_000);
    const text = await page.locator('body').innerText();
    await persistCookies();
    return text;
  } catch {
    return null;
  } finally {
    await page?.close().catch(() => undefined);
  }
}

/**
 * Fetch JSON from an API endpoint that is behind Cloudflare.
 * Uses response interception to capture the raw JSON before any page transforms.
 * Returns parsed object or null.
 */
export async function fetchJsonWithBrowser<T = unknown>(url: string): Promise<T | null> {
  let page: import('playwright').Page | null = null;
  try {
    const ctx = await getContext();
    page = await ctx.newPage();

    let captured: T | null = null;

    // Intercept the response body for the target URL
    page.on('response', async (response) => {
      try {
        if (response.url().startsWith(url.split('?')[0]!) && response.status() === 200) {
          const ct = response.headers()['content-type'] ?? '';
          if (ct.includes('json') || ct.includes('text')) {
            const text = await response.text().catch(() => '');
            if (text.startsWith('{') || text.startsWith('[')) {
              captured = JSON.parse(text) as T;
            }
          }
        }
      } catch { /* ignore */ }
    });

    await page.goto(url, { waitUntil: 'load', timeout: BROWSER_TIMEOUT_MS });
    await waitForCloudflare(page);
    await page.waitForTimeout(2_000);

    // If interception didn't capture it, try body text
    if (!captured) {
      const body = await page.locator('body').innerText().catch(() => '');
      if (body.trim().startsWith('{') || body.trim().startsWith('[')) {
        captured = JSON.parse(body.trim()) as T;
      }
    }

    await persistCookies();
    return captured;
  } catch {
    return null;
  } finally {
    await page?.close().catch(() => undefined);
  }
}

/**
 * Multi-step navigation helper: opens one page, hands it to callback, closes after.
 * Use when a scraper needs multiple goto/click/wait steps on the same page.
 */
export async function withBrowserPage<T>(
  fn: (page: import('playwright').Page) => Promise<T>,
): Promise<T | null> {
  let page: import('playwright').Page | null = null;
  try {
    const ctx = await getContext();
    page = await ctx.newPage();
    const result = await fn(page);
    await persistCookies();
    return result;
  } catch {
    return null;
  } finally {
    await page?.close().catch(() => undefined);
  }
}

/** Gracefully shut down browser (call on process exit if needed). */
export async function closeBrowser(): Promise<void> {
  await context?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  context = null;
  browser = null;
}
