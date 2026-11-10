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
 *
 * Trade path: fetchTradeFromBpsExa() — Exa/Tavily search for BPS siaran pers
 * (same pattern as neraca-pembayaran.ts for NPI quarterly CAD). Returns all three
 * trade indicators with the correct BPS reporting period date (not TODAY()).
 */
import type { MacroDataPoint } from '../types.js';
import { fetchJsonWithBrowser } from './playwright-browser.js';
import { getLatestPoint } from '../time-series-db.js';

const BPS_BASE = 'https://webapi.bps.go.id/v1/api';

// BPS dataset variable IDs
// Trade vars (200/201/202) are confirmed dead in domain 0000 — TE fallback always fires.
const BPS_VAR = {
  CPI_INDEX: '3',
};

export function bpsAvailable(): boolean {
  return !!process.env.BPS_API_KEY;
}

function exaAvailable(): boolean { return !!process.env.EXASEARCH_API_KEY; }
function tavilyAvailable(): boolean { return !!process.env.TAVILY_API_KEY; }

const NOW = () => new Date().toISOString();

// 15-day freshness: BPS publishes monthly trade ~7-15th of following month
const BPS_TRADE_FRESHNESS_DAYS = 15;

const MONTH_MAP: Record<string, number> = {
  januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6,
  juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12,
  january: 1, february: 2, march: 3, may: 5, june: 6, july: 7,
  august: 8, october: 10, december: 12,
};

function lastDayOfMonth(year: number, month: number): string {
  const d = new Date(year, month, 0); // day 0 = last day of previous month
  return `${year}-${String(month).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface BpsTradeResult {
  exports_bn: number | null;
  imports_bn: number | null;
  trade_balance_bn: number | null;
  period: string | null; // ISO date = last day of reported month, e.g. "2026-09-30"
}

function parseBpsTradeText(text: string): BpsTradeResult {
  const lower = text.toLowerCase();

  // Period detection: look for Indonesian month name + 4-digit year
  let period: string | null = null;
  for (const [name, num] of Object.entries(MONTH_MAP)) {
    const yearMatch = lower.match(new RegExp(`${name}\\s+(202[0-9])`));
    if (yearMatch) {
      const year = parseInt(yearMatch[1]);
      period = lastDayOfMonth(year, num);
      break;
    }
  }

  // Parse USD billion figures from text
  // BPS patterns: "US$11,87 miliar", "USD 11.87 miliar", "11,87 miliar dolar AS",
  //               "sebesar 11,87 miliar", "mencapai USD 11,87 miliar"
  function extractUsdBn(section: string): number | null {
    const patterns = [
      /US\$\s*([\d,]+(?:\.\d+)?)\s*[Mm]iliar/,
      /USD?\s*([\d,]+(?:\.\d+)?)\s*[Mm]iliar/,
      /([\d,]+(?:\.\d+)?)\s*[Mm]iliar\s*(?:dolar|USD)/i,
      /(?:mencapai|sebesar|senilai)\s+([\d,]+(?:\.\d+)?)\s*[Mm]iliar/i,
      /USD?\s*([\d.]+)\s*[Bb]illion/,
    ];
    for (const pat of patterns) {
      const m = section.match(pat);
      if (m) {
        // Indonesian notation: comma as decimal separator (11,87 → 11.87)
        const raw = m[1].replace(',', '.');
        const v = parseFloat(raw);
        if (!isNaN(v) && v > 1 && v < 60) return v;
      }
    }
    return null;
  }

  // Find exports figure: search in vicinity of "ekspor" keyword
  let exports_bn: number | null = null;
  const expIdx = lower.indexOf('ekspor');
  if (expIdx >= 0) {
    exports_bn = extractUsdBn(text.slice(expIdx, expIdx + 400));
  }

  // Find imports figure: search in vicinity of "impor" keyword
  let imports_bn: number | null = null;
  const impIdx = lower.indexOf('impor');
  if (impIdx >= 0) {
    imports_bn = extractUsdBn(text.slice(impIdx, impIdx + 400));
  }

  // Trade balance: look for surplus/defisit pattern
  let trade_balance_bn: number | null = null;
  const tbMatch = text.match(/(?:surplus|defisit)[^0-9]{0,30}USD?\s*([\d,]+(?:\.\d+)?)\s*[Mm]iliar/i);
  if (tbMatch) {
    const raw = tbMatch[1].replace(',', '.');
    const v = parseFloat(raw);
    if (!isNaN(v) && v < 20) {
      const ctxStart = Math.max(0, (tbMatch.index ?? 0) - 15);
      const ctx = lower.slice(ctxStart, (tbMatch.index ?? 0) + 10);
      trade_balance_bn = ctx.includes('defisit') ? -v : v;
    }
  }

  // Derive trade balance if not explicitly found but both sides parsed
  if (trade_balance_bn === null && exports_bn !== null && imports_bn !== null) {
    trade_balance_bn = +(exports_bn - imports_bn).toFixed(2);
  }

  return { exports_bn, imports_bn, trade_balance_bn, period };
}

async function searchBpsTrade(useExa: boolean): Promise<string> {
  const year = new Date().getFullYear();
  const query = `BPS Indonesia ekspor impor siaran pers miliar dolar ${year} neraca perdagangan`;
  if (useExa) {
    const resp = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'x-api-key': process.env.EXASEARCH_API_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        numResults: 5,
        includeDomains: ['bps.go.id', 'cnbcindonesia.com', 'bisnis.com', 'kontan.co.id', 'detik.com'],
        contents: { text: { maxCharacters: 1200 } },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) throw new Error(`Exa ${resp.status}`);
    const data = await resp.json() as { results?: Array<{ text?: string; title?: string }> };
    return (data.results ?? []).map(r => `${r.title ?? ''}: ${r.text ?? ''}`).join('\n');
  } else {
    const resp = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        max_results: 5,
        search_depth: 'basic',
        include_domains: ['bps.go.id', 'cnbcindonesia.com', 'bisnis.com', 'kontan.co.id', 'detik.com'],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) throw new Error(`Tavily ${resp.status}`);
    const data = await resp.json() as { results?: Array<{ content?: string; title?: string }> };
    return (data.results ?? []).map(r => `${r.title ?? ''}: ${r.content ?? ''}`).join('\n');
  }
}

/**
 * Fetch Indonesia monthly trade (exports/imports/balance) from BPS siaran pers
 * via Exa/Tavily search. Returns figures with the correct BPS reporting period date
 * (not TODAY()), matching the NPI quarterly pattern in neraca-pembayaran.ts.
 *
 * Freshness gate: 15 days — BPS releases monthly data ~7-15th of following month.
 * Re-fetches only when cached data is older than 15 days.
 */
export async function fetchTradeFromBpsExa(): Promise<MacroDataPoint[] | null> {
  if (!exaAvailable() && !tavilyAvailable()) return null;

  // Freshness gate: skip if recently fetched from Exa/Tavily/BPS authoritative sources
  const cached = await getLatestPoint('trade_balance_bn');
  const freshSources = ['exa', 'tavily', 'bps_nov', 'bps_sep', 'bps_aug', 'bps_corrected', 'bps_exa', 'bps_tavily', 'katadata', 'bps_'];
  if (cached?.source && freshSources.some(s => cached.source!.includes(s))) {
    const ageMs = Date.now() - new Date(cached.fetchedAt ?? cached.date).getTime();
    if (ageMs < BPS_TRADE_FRESHNESS_DAYS * 86_400_000) return null; // already fresh
  }

  let rawText = '';
  let source: 'bps_exa_search' | 'bps_tavily_search' = 'bps_exa_search';

  try {
    if (exaAvailable()) {
      rawText = await searchBpsTrade(true);
      source = 'bps_exa_search';
    } else {
      rawText = await searchBpsTrade(false);
      source = 'bps_tavily_search';
    }
  } catch {
    if (tavilyAvailable() && exaAvailable()) {
      try {
        rawText = await searchBpsTrade(false);
        source = 'bps_tavily_search';
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }

  if (!rawText) return null;

  const { exports_bn, imports_bn, trade_balance_bn, period } = parseBpsTradeText(rawText);

  // Need at least trade_balance or both sides to be useful
  if (trade_balance_bn === null && (exports_bn === null || imports_bn === null)) return null;

  // Use actual reporting period date, or fall back to TODAY() if not parseable
  const date = period ?? new Date().toISOString().slice(0, 10);

  const points: MacroDataPoint[] = [];
  if (trade_balance_bn !== null) {
    points.push({ indicator: 'trade_balance_bn', category: 'bop', date, value: trade_balance_bn, unit: 'bn_USD', source, fetchedAt: NOW() });
  }
  if (exports_bn !== null) {
    points.push({ indicator: 'exports_bn', category: 'bop', date, value: exports_bn, unit: 'bn_USD', source, fetchedAt: NOW() });
  }
  if (imports_bn !== null) {
    points.push({ indicator: 'imports_bn', category: 'bop', date, value: imports_bn, unit: 'bn_USD', source, fetchedAt: NOW() });
  }

  return points.length > 0 ? points : null;
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
// BoP engine falls back to fetchTradeFromBpsExa() → Trading Economics scraper.
export async function fetchTradeBalance(_months = 24): Promise<MacroDataPoint[]> { return []; }
export async function fetchImports(_months = 24): Promise<MacroDataPoint[]> { return []; }
export async function fetchExports(_months = 24): Promise<MacroDataPoint[]> { return []; }
