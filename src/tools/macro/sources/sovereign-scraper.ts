/**
 * Free sovereign data scrapers for Indonesia.
 *
 * Sources:
 *   SBN 10Y yield  — Trading Economics HTML scrape (no auth, no JS required)
 *                    Pattern: JSON blob {"last":X.XX,"symbol":"GIDN10YR:GOV"...} in page HTML
 *
 *   BI Rate        — Trading Economics meta description scrape
 *                    Pattern: "last recorded at X.XX percent" in <meta name="description">
 *
 *   CDS proxy      — No free CDS source accessible without JS/auth (Investing.com = Cloudflare,
 *                    WorldGovernmentBonds = JS-rendered, TE CDS = no embedded data).
 *                    Instead: SBN term premium = SBN 10Y − BI Rate.
 *                    Indonesia normal range: 1.5–2.5%. Above 3% = stress signal.
 *
 * These are fallbacks when Bloomberg/Refinitiv not configured.
 * Lag: near-real-time (Trading Economics updates intraday for bond yield, daily for rate).
 */
import type { MacroDataPoint } from '../types.js';

const NOW = () => new Date().toISOString();
const TODAY = () => new Date().toISOString().slice(0, 10);

const TE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
};

async function fetchHtml(url: string, timeoutMs = 12_000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: TE_HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Fetch Indonesia 10Y government bond yield from Trading Economics.
 * Scrapes the embedded JSON blob {"last":X.XX,"symbol":"GIDN10YR:GOV",...} from page HTML.
 * Returns MacroDataPoint or null if unavailable.
 */
export async function fetchSbn10yTradingEconomics(): Promise<MacroDataPoint | null> {
  const html = await fetchHtml('https://tradingeconomics.com/indonesia/government-bond-yield');
  if (!html) return null;

  // Match JSON blob containing the bond yield data
  const match = html.match(/"last"\s*:\s*([\d.]+)[^}]*"symbol"\s*:\s*"GIDN10YR/);
  if (!match) {
    // Fallback: find any "last" value near GIDN10YR symbol
    const alt = html.match(/"symbol"\s*:\s*"GIDN10YR[^"]*"[^}]*"last"\s*:\s*([\d.]+)/);
    if (!alt) return null;
    const value = parseFloat(alt[1]);
    if (!value || value < 3 || value > 20) return null;
    return {
      indicator: 'sbn_10y_yield_pct',
      category: 'sovereign',
      date: TODAY(),
      value,
      unit: '%',
      source: 'trading_economics_scrape',
      fetchedAt: NOW(),
    };
  }

  const value = parseFloat(match[1]);
  if (!value || value < 3 || value > 20) return null;

  return {
    indicator: 'sbn_10y_yield_pct',
    category: 'sovereign',
    date: TODAY(),
    value,
    unit: '%',
    source: 'trading_economics_scrape',
    fetchedAt: NOW(),
  };
}

/**
 * Fetch Bank Indonesia 7-Day Reverse Repo Rate from Trading Economics.
 * Scrapes meta description: "last recorded at X.XX percent".
 */
export async function fetchBiRateTradingEconomics(): Promise<MacroDataPoint | null> {
  const html = await fetchHtml('https://tradingeconomics.com/indonesia/interest-rate');
  if (!html) return null;

  // Meta description: "was last recorded at 5.25 percent"
  const match = html.match(/last recorded at\s+([\d.]+)\s+percent/i);
  if (!match) return null;

  const value = parseFloat(match[1]);
  if (!value || value < 1 || value > 15) return null;

  return {
    indicator: 'bi_rate_pct',
    category: 'sovereign',
    date: TODAY(),
    value,
    unit: '%',
    source: 'trading_economics_scrape',
    fetchedAt: NOW(),
  };
}

/**
 * Compute SBN term premium as CDS proxy.
 * term_premium = SBN_10Y − BI_Rate
 * Indonesia historical range: 1.5–2.5% normal, >3% = stress.
 */
export function computeTermPremium(sbn10y: number, biRate: number): {
  termPremium: number;
  stressSignal: boolean;
  label: string;
} {
  const termPremium = sbn10y - biRate;
  const stressSignal = termPremium > 3.0;
  const label = termPremium > 3.5
    ? 'elevated — fiscal stress signal'
    : termPremium > 2.5
      ? 'above normal — watch'
      : 'normal range';
  return { termPremium, stressSignal, label };
}
