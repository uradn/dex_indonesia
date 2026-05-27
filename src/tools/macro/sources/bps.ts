/**
 * BPS (Badan Pusat Statistik) — Indonesia's national statistics agency.
 *
 * Uses BPS WebAPI v1: https://webapi.bps.go.id/v1/api/
 * Requires BPS_API_KEY env var (free registration at webapi.bps.go.id).
 *
 * Trade vars (domain 0000, var 200/201/202) confirmed broken — BPS WebAPI domain 0000
 * does not expose trade data at these var IDs. BPS website is hard Cloudflare (Playwright
 * can't bypass). BoP engine falls back to Trading Economics scraper automatically.
 * Do not attempt to fix by guessing other var IDs — audited exhaustively.
 *
 * Working: CPI/Inflation — domain 0000, var 3
 */
import type { MacroDataPoint } from '../types.js';
import { fetchJsonWithBrowser } from './playwright-browser.js';

const BPS_BASE = 'https://webapi.bps.go.id/v1/api';

// BPS dataset variable IDs
// Trade vars (200/201/202) are confirmed dead in domain 0000 — TE fallback always fires.
const BPS_VAR = {
  CPI_INDEX: '3',
};

export function bpsAvailable(): boolean {
  return !!process.env.BPS_API_KEY;
}

async function bpsFetch(path: string): Promise<unknown> {
  const key = process.env.BPS_API_KEY;
  if (!key) throw new Error('BPS_API_KEY not set');
  const url = `${BPS_BASE}/${path}?key=${key}&lang=ind&type=json`;

  // Plain fetch first — works if Cloudflare challenge is already solved (cookie cached)
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return res.json();
  } catch { /* fall through to browser */ }

  // Cloudflare blocked — use Playwright
  const data = await fetchJsonWithBrowser(url);
  if (!data) throw new Error(`BPS API unreachable (Cloudflare): ${path}`);
  return data;
}

// Trade functions stub out — BPS API var IDs 200/201/202 don't exist in domain 0000.
// BoP engine falls back to Trading Economics scraper when these return [].
export async function fetchTradeBalance(_months = 24): Promise<MacroDataPoint[]> { return []; }
export async function fetchImports(_months = 24): Promise<MacroDataPoint[]> { return []; }
export async function fetchExports(_months = 24): Promise<MacroDataPoint[]> { return []; }
