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
 *   CDS 5Y (free)  — WorldGovernmentBonds.com sovereign-cds page (Playwright required, JS-rendered).
 *                    Parses table row "Indonesia  BBB  90.90" → bps value. Updates ~daily.
 *                    Bloomberg/Refinitiv override if configured.
 *                    Fallback: SBN term premium = SBN 10Y − BI Rate (Indonesia normal: 1.5–2.5%, stress >3%).
 *
 *   Trade data     — Trading Economics JS-rendered pages (Playwright required):
 *                    Balance of Trade, Exports, Imports (monthly, USD Billion).
 *
 * Plain scrapes (no JS): SBN 10Y yield, BI Rate.
 * Playwright scrapes: Trade Balance, Exports, Imports.
 * Lag: near-real-time intraday.
 */
import type { MacroDataPoint } from '../types.js';
import { fetchRenderedTextWithBrowser } from './playwright-browser.js';

const WGB_CDS_URL = 'https://www.worldgovernmentbonds.com/sovereign-cds/';

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

// ─── Trading Economics JS-rendered trade scrapers (Playwright required) ───────

interface TeScrapeResult {
  value: number;
  unit: string;
}

/**
 * Extract a numeric value from a rendered Trading Economics page body text.
 * Looks for the first large number near the indicator title.
 */
function parseTeDomValue(text: string, titleKeyword: string): TeScrapeResult | null {
  const idx = text.toLowerCase().indexOf(titleKeyword.toLowerCase());
  if (idx < 0) return null;
  const section = text.slice(idx, idx + 400);
  // Target "to USD/US XX.XX billion" — skips leading YoY % figures
  const usdMatch = section.match(/to\s+US[D]?\s+([\d.]+)\s+billion/i);
  if (usdMatch) {
    const value = parseFloat(usdMatch[1]);
    if (!isNaN(value)) return { value, unit: 'bn_USD' };
  }
  // Fallback: first number in section (trade balance uses "surplus/deficit of USD X.XX")
  const match = section.match(/([-\d]+\.?\d*)\s*(?:USD Billion|USD Million|Million USD|Billion|%)?/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  if (isNaN(value)) return null;
  const unit = /billion/i.test(section.slice(0, 200)) ? 'bn_USD' : 'mn_USD';
  return { value, unit };
}

/**
 * Fetch Indonesia trade balance from Trading Economics (Playwright).
 * Returns monthly figure in bn USD.
 */
export async function fetchTradeBalanceTe(): Promise<MacroDataPoint | null> {
  const text = await fetchRenderedTextWithBrowser('https://tradingeconomics.com/indonesia/balance-of-trade');
  if (!text) return null;
  const result = parseTeDomValue(text, 'Balance of Trade');
  if (!result) return null;
  // TE reports trade balance in USD Billion
  const value = result.unit === 'mn_USD' ? result.value / 1000 : result.value;
  if (Math.abs(value) > 30) return null; // sanity: Indonesia trade balance typically ±$10B
  return {
    indicator: 'trade_balance_bn',
    category: 'bop',
    date: TODAY(),
    value,
    unit: 'bn_USD',
    source: 'trading_economics_scrape',
    fetchedAt: NOW(),
  };
}

/**
 * Fetch Indonesia exports from Trading Economics (Playwright).
 * Returns monthly figure in bn USD.
 */
export async function fetchExportsTe(): Promise<MacroDataPoint | null> {
  const text = await fetchRenderedTextWithBrowser('https://tradingeconomics.com/indonesia/exports');
  if (!text) return null;
  const result = parseTeDomValue(text, 'Exports');
  if (!result) return null;
  const value = result.unit === 'mn_USD' ? result.value / 1000 : result.value;
  if (value < 5 || value > 100) return null;
  return {
    indicator: 'exports_bn',
    category: 'bop',
    date: TODAY(),
    value,
    unit: 'bn_USD',
    source: 'trading_economics_scrape',
    fetchedAt: NOW(),
  };
}

/**
 * Fetch Indonesia imports from Trading Economics (Playwright).
 * Returns monthly figure in bn USD.
 */
export async function fetchImportsTe(): Promise<MacroDataPoint | null> {
  const text = await fetchRenderedTextWithBrowser('https://tradingeconomics.com/indonesia/imports');
  if (!text) return null;
  const result = parseTeDomValue(text, 'Imports');
  if (!result) return null;
  const value = result.unit === 'mn_USD' ? result.value / 1000 : result.value;
  if (value < 5 || value > 100) return null;
  return {
    indicator: 'imports_bn',
    category: 'bop',
    date: TODAY(),
    value,
    unit: 'bn_USD',
    source: 'trading_economics_scrape',
    fetchedAt: NOW(),
  };
}

// S&P/Fitch rating → numeric score (0–100). BBB = 73.
export function ratingToScore(rating: string): number {
  const SCALE: Record<string, number> = {
    'AAA': 100, 'AA+': 97, 'AA': 93, 'AA-': 90,
    'A+': 87,   'A': 83,   'A-': 80,
    'BBB+': 77, 'BBB': 73, 'BBB-': 70,
    'BB+': 60,  'BB': 53,  'BB-': 47,
    'B+': 40,   'B': 33,   'B-': 27,
    'CCC+': 20, 'CCC': 13, 'CCC-': 7,
    'CC': 4,    'C': 2,    'D': 0,
  };
  return SCALE[rating.trim().toUpperCase()] ?? 50;
}

/**
 * Fetch Indonesia 5Y CDS + S&P credit rating from WorldGovernmentBonds.com.
 * Single Playwright render → parses "Indonesia  BBB  90.90" table row.
 * Returns [cdsPoint, ratingScorePoint] — either may be null independently.
 */
export async function fetchIndonesiaCdsAndRatingWgb(): Promise<[MacroDataPoint | null, MacroDataPoint | null]> {
  const text = await fetchRenderedTextWithBrowser(WGB_CDS_URL);
  if (!text) return [null, null];

  // Table row: "Indonesia  <RATING>  <CDS_BPS>  ..."
  const m = text.match(/Indonesia\s+([A-Z][A-Z+\-]*)\s+([\d.]+)/);
  if (!m) return [null, null];

  const rating = m[1]!.trim();
  const cdsValue = parseFloat(m[2]!);
  const fetchedAt = NOW();
  const today = TODAY();

  const cdsPoint: MacroDataPoint | null = (!isNaN(cdsValue) && cdsValue >= 20 && cdsValue <= 1_000)
    ? { indicator: 'indonesia_cds_5y_bps', category: 'sovereign', date: today, value: cdsValue, unit: 'bps', source: 'worldgovernmentbonds_scrape', fetchedAt }
    : null;

  const score = ratingToScore(rating);
  const ratingPoint: MacroDataPoint = {
    indicator: 'indonesia_credit_rating_score',
    category: 'sovereign',
    date: today,
    value: score,
    unit: 'score_0_100',
    source: 'worldgovernmentbonds_scrape',
    fetchedAt,
  };

  return [cdsPoint, ratingPoint];
}

/** Backward-compat — CDS only. */
export async function fetchIndonesiaCds5yWgb(): Promise<MacroDataPoint | null> {
  const [cds] = await fetchIndonesiaCdsAndRatingWgb();
  return cds;
}

/**
 * Fetch Indonesia 10Y government bond yield historical time series from WorldGovernmentBonds.com.
 *
 * Same interception pattern as fetchIndonesiaCdsHistoricalWgb — waitForResponse promise
 * created before page.goto to eliminate the race condition.
 *
 * Returns daily bars with yield in % per annum (e.g. 6.71 = 6.71%).
 * Validation: 3–25% covers Indonesia 10Y historical range (peaked ~20% in 1998; recent ~6-8%).
 */
export async function fetchSbn10yHistoricalWgb(): Promise<Array<{ date: string; close: number }>> {
  const { withBrowserPage } = await import('./playwright-browser.js');

  const WGB_YIELD_URL = 'https://www.worldgovernmentbonds.com/bond-historical-data/indonesia/10-years/';
  const API_ENDPOINT  = 'https://www.worldgovernmentbonds.com/wp-json/common/v1/historical';

  type WgbQuoteEntry = { CLOSE_VAL: number; DATA_VAL: string };
  type WgbResponse   = { success: boolean; result: { num: number; quote: Record<string, WgbQuoteEntry> } };

  const bars = await withBrowserPage<Array<{ date: string; close: number }>>(async (page) => {
    const responsePromise = page.waitForResponse(
      (res) => res.url().startsWith(API_ENDPOINT) && res.request().method() === 'POST',
      { timeout: 40_000 },
    );
    await page.goto(WGB_YIELD_URL, { waitUntil: 'load', timeout: 35_000 });
    const wgbRes = await responsePromise;
    const data = await wgbRes.json() as WgbResponse;
    if (!data?.success || !data.result?.quote) return [];
    const result: Array<{ date: string; close: number }> = [];
    for (const entry of Object.values(data.result.quote)) {
      const yld = Number(entry.CLOSE_VAL);
      if (!entry.DATA_VAL || isNaN(yld) || yld < 3 || yld > 25) continue;
      result.push({ date: entry.DATA_VAL.slice(0, 10), close: yld });
    }
    return result.sort((a, b) => a.date.localeCompare(b.date));
  });

  return bars ?? [];
}

/**
 * Fetch Indonesia 5Y CDS full historical time series from WorldGovernmentBonds.com.
 *
 * WGB serves data via a WordPress REST API (POST) that enforces CORS — plain fetch
 * returns 403 "invalid origin". Playwright navigates the page so the browser's
 * cookies and Origin header satisfy the check; we intercept the JSON response
 * in-flight rather than parsing the DOM.
 *
 * Returns daily bars from ~Sep 2018 to present. Covers: 2018 EM contagion,
 * 2020 COVID, 2022 Fed tightening, 2023 USD surge. Pre-2018 dates return null.
 *
 * Response format: { success: true, result: { num: N, quote: { "1": { CLOSE_VAL, DATA_VAL }, ... } } }
 */
export async function fetchIndonesiaCdsHistoricalWgb(): Promise<Array<{ date: string; close: number }>> {
  const { withBrowserPage } = await import('./playwright-browser.js');

  const WGB_HISTORICAL_URL = 'https://www.worldgovernmentbonds.com/cds-historical-data/indonesia/5-years/';
  const API_ENDPOINT       = 'https://www.worldgovernmentbonds.com/wp-json/common/v1/historical';

  type WgbQuoteEntry = { CLOSE_VAL: number; DATA_VAL: string };
  type WgbResponse   = { success: boolean; result: { num: number; quote: Record<string, WgbQuoteEntry> } };

  const bars = await withBrowserPage<Array<{ date: string; close: number }>>(async (page) => {
    // waitForResponse promise must be created BEFORE goto — Playwright queues the
    // listener immediately and will never miss the response regardless of timing.
    // This fixes the race condition in the old page.on('response') + waitForTimeout pattern.
    const responsePromise = page.waitForResponse(
      (res) => res.url().startsWith(API_ENDPOINT) && res.request().method() === 'POST',
      { timeout: 40_000 },
    );

    // 'load' is sufficient — page JS fires the historical POST on DOMContentLoaded.
    // 'networkidle' was wrong: WGB keeps a keep-alive connection that prevents settlement.
    await page.goto(WGB_HISTORICAL_URL, { waitUntil: 'load', timeout: 35_000 });

    const wgbRes = await responsePromise;
    const data = await wgbRes.json() as WgbResponse;

    if (!data?.success || !data.result?.quote) return [];

    const result: Array<{ date: string; close: number }> = [];
    for (const entry of Object.values(data.result.quote)) {
      const cds = Number(entry.CLOSE_VAL);
      if (!entry.DATA_VAL || isNaN(cds) || cds < 20 || cds > 2_000) continue;
      result.push({ date: entry.DATA_VAL.slice(0, 10), close: cds });
    }
    return result.sort((a, b) => a.date.localeCompare(b.date));
  });

  return bars ?? [];
}

/**
 * Fetch Indonesia IndONIA (Indonesia Overnight Index Average) compounded rate from TE.
 * BI discontinued JIBOR in Dec 2023; TE now reports IndONIA on the same interbank-rate URL.
 * Pattern: "Interbank Rate in Indonesia ... X.XX percent"
 * Typical healthy spread vs BI Rate: 0.1–0.5%. Crisis: >1.5%.
 */
export async function fetchIndoniaRateTe(): Promise<MacroDataPoint | null> {
  const text = await fetchRenderedTextWithBrowser('https://tradingeconomics.com/indonesia/interbank-rate');
  if (!text) return null;

  // Primary: parse from the summary table row "Interbank Rate  5.46  5.46  percent  Dec 2025"
  const tableMatch = text.match(/Interbank Rate\s+([\d.]+)\s+[\d.]+\s+percent\s+(\w{3})\s+(\d{4})/i);
  if (tableMatch) {
    const val = parseFloat(tableMatch[1]!);
    const mon = tableMatch[2]!;
    const yr = tableMatch[3]!;
    const monthMap: Record<string, string> = {
      Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
      Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
    };
    const mm = monthMap[mon] ?? '12';
    const lastDay = new Date(parseInt(yr), parseInt(mm), 0).getDate();
    return {
      indicator: 'indonia_3m_pct', category: 'banking', date: `${yr}-${mm}-${lastDay}`,
      value: val, unit: '%', source: 'trading_economics_scrape', fetchedAt: NOW(),
    };
  }

  // Fallback: prose match
  const m = text.match(/Interbank Rate in Indonesia (?:increased to|decreased to|remained unchanged at|averaged)\s+([\d.]+)\s+percent/i);
  if (!m) return null;
  return {
    indicator: 'indonia_3m_pct', category: 'banking', date: TODAY(),
    value: parseFloat(m[1]!), unit: '%', source: 'trading_economics_scrape', fetchedAt: NOW(),
  };
}

/** @deprecated Use fetchIndoniaRateTe — JIBOR discontinued Dec 2023 */
export const fetchJiborTe = fetchIndoniaRateTe;

/**
 * Fetch Indonesia gross external debt from Trading Economics.
 * Source data: Bank Indonesia (quarterly, USD Million).
 * Returns total in bn USD.
 */
export async function fetchExternalDebtTe(): Promise<MacroDataPoint | null> {
  const text = await fetchRenderedTextWithBrowser('https://tradingeconomics.com/indonesia/external-debt');
  if (!text) return null;

  // Pattern: "External Debt in Indonesia increased to 433379.45 USD Million in the first quarter of 2026"
  const m = text.match(/External Debt in Indonesia (?:increased|decreased|remained unchanged) (?:to|at)\s+([\d,]+\.?\d*)\s+USD Million\s+in\s+(?:the\s+)?(\w+)\s+quarter of\s+(\d{4})/i);
  if (!m) return null;

  const val = parseFloat(m[1]!.replace(/,/g, '')) / 1000; // convert to bn USD
  const quarterWord = m[2]!.toLowerCase();
  const year = m[3]!;
  const quarterMonthEnd: Record<string, string> = {
    first: `${year}-03-31`, second: `${year}-06-30`,
    third: `${year}-09-30`, fourth: `${year}-12-31`,
  };
  const date = quarterMonthEnd[quarterWord] ?? `${year}-03-31`;

  return {
    indicator: 'indonesia_external_debt_bn', category: 'banking',
    date, value: parseFloat(val.toFixed(2)), unit: 'bn_USD',
    source: 'trading_economics_scrape', fetchedAt: NOW(),
  };
}

/**
 * Fetch Indonesia Residential Property Price Index (IHPR/SHPR) from Trading Economics.
 * Source: Bank Indonesia SHPR (Survei Harga Properti Residensial), quarterly.
 * YoY % change in primary residential property prices.
 * Signals: falling IHPR + high NPL → collateral deflation risk for mortgage (KPR) portfolio.
 */
/** Extract IHPR value from page text using multiple patterns. */
function parseIhprFromText(text: string, source: string): MacroDataPoint | null {
  const monthMap: Record<string, string> = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
  };

  // Pattern 1: table "House Price Index  1.96  1.54  percent  Q4/25" or "... Dec 2025"
  const tableMatch = text.match(/House Price Index\s+([\d.-]+)\s+[\d.-]+\s+percent\s+(?:Q\d[\/\s]\d{2,4}|(\w{3})\s+(\d{4}))/i);
  if (tableMatch) {
    const val = parseFloat(tableMatch[1]!);
    const mon = tableMatch[2]; const yr = tableMatch[3];
    if (!isNaN(val) && Math.abs(val) < 50) {
      let dateStr = TODAY();
      if (mon && yr) {
        const mm = monthMap[mon] ?? '12';
        const lastDay = new Date(parseInt(yr), parseInt(mm), 0).getDate();
        dateStr = `${yr}-${mm}-${String(lastDay).padStart(2, '0')}`;
      }
      return { indicator: 'indonesia_ihpr_yoy_pct', category: 'banking', date: dateStr, value: parseFloat(val.toFixed(2)), unit: '%_yoy', source, fetchedAt: NOW() };
    }
  }

  // Pattern 2: prose "House Price Index in Indonesia ... 1.96 percent"
  const prose = text.match(/House Price Index in Indonesia[^0-9+-]*([-\d.]+)\s*percent/i);
  if (prose) {
    const val = parseFloat(prose[1]!);
    if (!isNaN(val) && Math.abs(val) < 50) return { indicator: 'indonesia_ihpr_yoy_pct', category: 'banking', date: TODAY(), value: parseFloat(val.toFixed(2)), unit: '%_yoy', source, fetchedAt: NOW() };
  }

  // Pattern 3: any number 0-10 near "House Price" / "IHPR" / "SHPR" / "properti residensial"
  for (const re of [
    /House Price[^0-9-]{0,30}([-\d]{1,2}\.\d{1,2})/i,
    /\bIHPR\b[^0-9-]{0,20}([-\d]{1,2}\.\d{1,2})/i,
    /\bSHPR\b[^0-9-]{0,20}([-\d]{1,2}\.\d{1,2})/i,
    /(?:Harga Properti|Residensial)[^0-9-]{0,30}([-\d]{1,2}\.\d{1,2})/i,
  ]) {
    const m = text.match(re);
    if (m) {
      const val = parseFloat(m[1]!);
      if (!isNaN(val) && Math.abs(val) < 20) return { indicator: 'indonesia_ihpr_yoy_pct', category: 'banking', date: TODAY(), value: parseFloat(val.toFixed(2)), unit: '%_yoy', source, fetchedAt: NOW() };
    }
  }

  return null;
}

export async function fetchIhprTe(): Promise<MacroDataPoint | null> {
  // Try Trading Economics first
  const teText = await fetchRenderedTextWithBrowser('https://tradingeconomics.com/indonesia/house-price-index');
  if (teText) {
    const result = parseIhprFromText(teText, 'trading_economics_scrape');
    if (result) return result;
  }

  // Fallback: BI SHPR page (Survei Harga Properti Residensial)
  // BI page is ASP.NET, may need cookies — try plain fetch first
  try {
    const res = await fetch('https://www.bi.go.id/id/statistik/ekonomi-keuangan/indeks-harga-properti-residensial/Default.aspx', {
      headers: { 'User-Agent': TE_HEADERS['User-Agent'], Accept: 'text/html' },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const html = await res.text();
      const result = parseIhprFromText(html, 'bi_shpr_scrape');
      if (result) return result;
    }
  } catch { /* ignore */ }

  return null;
}

/**
 * Fetch Indonesia Manufacturing PMI from Trading Economics.
 * Source: S&P Global (monthly). PMI > 50 = expansion, < 50 = contraction.
 * Pattern: "Manufacturing PMI  51.2  51.2  points  Apr 2026"
 */
export async function fetchPmiManufacturingTe(): Promise<MacroDataPoint | null> {
  const text = await fetchRenderedTextWithBrowser('https://tradingeconomics.com/indonesia/manufacturing-pmi');
  if (!text) return null;

  const monthMap: Record<string, string> = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
  };

  const monthMap2: Record<string, string> = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
  };

  // Primary: table row "Manufacturing PMI  51.20  51.20  points  Apr 2026"
  const tableMatch = text.match(/Manufacturing PMI\s+([\d.]+)\s+[\d.]+\s+points?\s+(\w{3})\s+(\d{4})/i);
  if (tableMatch) {
    const val = parseFloat(tableMatch[1]!);
    const mon = tableMatch[2]!;
    const yr = tableMatch[3]!;
    const mm = monthMap2[mon] ?? '01';
    const lastDay = new Date(parseInt(yr), parseInt(mm), 0).getDate();
    if (val >= 30 && val <= 70) {
      return {
        indicator: 'indonesia_pmi_manufacturing', category: 'regime',
        date: `${yr}-${mm}-${String(lastDay).padStart(2, '0')}`,
        value: val, unit: 'index', source: 'trading_economics_scrape', fetchedAt: NOW(),
      };
    }
  }

  // Fallback 1: prose "Manufacturing PMI in Indonesia ... to XX.XX points"
  const proseMatch = text.match(/Manufacturing PMI in Indonesia (?:increased|decreased|rose|fell|remained)[^0-9]*([\d.]+)\s+points/i);
  if (proseMatch) {
    const val = parseFloat(proseMatch[1]!);
    if (val >= 30 && val <= 70) {
      return {
        indicator: 'indonesia_pmi_manufacturing', category: 'regime',
        date: TODAY(), value: val, unit: 'index',
        source: 'trading_economics_scrape', fetchedAt: NOW(),
      };
    }
  }

  // Fallback 2: any "PMI" followed by a number 40-60
  const genericMatch = text.match(/\bPMI\b[^\d]{0,30}(4[0-9]\.\d+|5[0-9]\.\d+|[45][0-9])/);
  if (genericMatch) {
    const val = parseFloat(genericMatch[1]!);
    if (val >= 40 && val <= 65) {
      return {
        indicator: 'indonesia_pmi_manufacturing', category: 'regime',
        date: TODAY(), value: val, unit: 'index',
        source: 'trading_economics_scrape', fetchedAt: NOW(),
      };
    }
  }

  return null;
}

// ─── OJK Banking KPI fallbacks from Trading Economics ────────────────────────

const TE_MONTH_MAP: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

/**
 * Generic TE percent-indicator scraper.
 * Handles both table-row format ("Indicator  X.XX  X.XX  percent  Mon YYYY")
 * and prose format ("Indicator in Indonesia ... to X.XX percent").
 */
async function fetchTePercent(
  url: string,
  indicator: string,
  category: 'banking' | 'sovereign' | 'regime',
  titleKeyword: string,
  proseKeyword: string,
  minVal: number,
  maxVal: number,
): Promise<MacroDataPoint | null> {
  const text = await fetchRenderedTextWithBrowser(url);
  if (!text) return null;

  // Primary: table row "Keyword  X.XX  X.XX  percent  Mon YYYY"
  const tableRe = new RegExp(
    titleKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
    '\\s+([\\d.]+)\\s+[\\d.]+\\s+percent\\s+(\\w{3})\\s+(\\d{4})',
    'i',
  );
  const tableMatch = text.match(tableRe);
  if (tableMatch) {
    const val = parseFloat(tableMatch[1]!);
    const mm = TE_MONTH_MAP[tableMatch[2]!] ?? '12';
    const yr = tableMatch[3]!;
    const lastDay = new Date(parseInt(yr), parseInt(mm), 0).getDate();
    if (val >= minVal && val <= maxVal) {
      return {
        indicator, category, date: `${yr}-${mm}-${String(lastDay).padStart(2, '0')}`,
        value: parseFloat(val.toFixed(2)), unit: '%',
        source: 'trading_economics_scrape', fetchedAt: NOW(),
      };
    }
  }

  // Fallback: prose match
  const proseRe = new RegExp(
    proseKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
    '[^0-9]+(\\d{1,3}\\.\\d{1,2})',
    'i',
  );
  const proseMatch = text.match(proseRe);
  if (proseMatch) {
    const val = parseFloat(proseMatch[1]!);
    if (val >= minVal && val <= maxVal) {
      return {
        indicator, category, date: TODAY(),
        value: parseFloat(val.toFixed(2)), unit: '%',
        source: 'trading_economics_scrape', fetchedAt: NOW(),
      };
    }
  }

  return null;
}

/**
 * Fetch Indonesia M2 money supply from Trading Economics.
 * Source: Bank Indonesia (monthly, IDR Billion).
 * KLR critical indicator: M2/FX reserves ratio (>5x = elevated capital flight risk).
 */
export async function fetchM2MoneySupplyTe(): Promise<MacroDataPoint | null> {
  const text = await fetchRenderedTextWithBrowser('https://tradingeconomics.com/indonesia/money-supply-m2');
  if (!text) return null;

  // Table row: "Money Supply M2  9100123.45  9050000.00  IDR Million  Mon YYYY"
  const tableMatch = text.match(/Money Supply M2\s+([\d,]+\.?\d*)\s+[\d,]+\.?\d*\s+IDR Million\s+(\w{3})\s+(\d{4})/i);
  if (tableMatch) {
    const valMillion = parseFloat(tableMatch[1]!.replace(/,/g, ''));
    const mm = TE_MONTH_MAP[tableMatch[2]!] ?? '12';
    const yr = tableMatch[3]!;
    const lastDay = new Date(parseInt(yr), parseInt(mm), 0).getDate();
    if (!isNaN(valMillion) && valMillion > 1_000_000) {
      return {
        indicator: 'm2_money_supply_idr_bn', category: 'banking',
        date: `${yr}-${mm}-${String(lastDay).padStart(2, '0')}`,
        value: parseFloat((valMillion / 1000).toFixed(2)), unit: 'bn_IDR',
        source: 'trading_economics_scrape', fetchedAt: NOW(),
      };
    }
  }

  // Fallback prose: "Money Supply M2 in Indonesia increased to X IDR Million"
  const prose = text.match(/Money Supply M2 in Indonesia[^0-9]*([\d,]+)\s+IDR Million/i);
  if (prose) {
    const valMillion = parseFloat(prose[1]!.replace(/,/g, ''));
    if (!isNaN(valMillion) && valMillion > 1_000_000) {
      return {
        indicator: 'm2_money_supply_idr_bn', category: 'banking',
        date: TODAY(), value: parseFloat((valMillion / 1000).toFixed(2)), unit: 'bn_IDR',
        source: 'trading_economics_scrape', fetchedAt: NOW(),
      };
    }
  }

  return null;
}

/**
 * Fetch Indonesia total bank deposits (DPK - Dana Pihak Ketiga) from Trading Economics.
 * Source: OJK / Bank Indonesia (monthly, IDR Billion).
 * KLR indicator: DPK growth decline signals early bank run risk.
 */
export async function fetchDpkDepositsTe(): Promise<MacroDataPoint | null> {
  const text = await fetchRenderedTextWithBrowser('https://tradingeconomics.com/indonesia/deposits');
  if (!text) return null;

  // Table row: "Deposits  8500000.00  8400000.00  IDR Million  Mon YYYY"
  const tableMatch = text.match(/Deposits\s+([\d,]+\.?\d*)\s+[\d,]+\.?\d*\s+IDR Million\s+(\w{3})\s+(\d{4})/i);
  if (tableMatch) {
    const valMillion = parseFloat(tableMatch[1]!.replace(/,/g, ''));
    const mm = TE_MONTH_MAP[tableMatch[2]!] ?? '12';
    const yr = tableMatch[3]!;
    const lastDay = new Date(parseInt(yr), parseInt(mm), 0).getDate();
    if (!isNaN(valMillion) && valMillion > 500_000) {
      return {
        indicator: 'bank_dpk_idr_bn', category: 'banking',
        date: `${yr}-${mm}-${String(lastDay).padStart(2, '0')}`,
        value: parseFloat((valMillion / 1000).toFixed(2)), unit: 'bn_IDR',
        source: 'trading_economics_scrape', fetchedAt: NOW(),
      };
    }
  }

  // Fallback prose
  const prose = text.match(/Deposits in Indonesia[^0-9]*([\d,]+)\s+IDR Million/i);
  if (prose) {
    const valMillion = parseFloat(prose[1]!.replace(/,/g, ''));
    if (!isNaN(valMillion) && valMillion > 500_000) {
      return {
        indicator: 'bank_dpk_idr_bn', category: 'banking',
        date: TODAY(), value: parseFloat((valMillion / 1000).toFixed(2)), unit: 'bn_IDR',
        source: 'trading_economics_scrape', fetchedAt: NOW(),
      };
    }
  }

  return null;
}

/**
 * Fetch Indonesia NPL gross % from World Bank API.
 * Source: World Bank FSI (FB.AST.NPER.ZS = Bank NPL to total gross loans %).
 * Annual data, 2-3 year lag. No auth required. Use as structural baseline.
 * 2023 value: ~1.96% (Indonesia banking system is low-NPL historically).
 */
export async function fetchNplWorldBank(): Promise<MacroDataPoint | null> {
  try {
    const res = await fetch(
      'https://api.worldbank.org/v2/country/IDN/indicator/FB.AST.NPER.ZS?format=json&mrv=1',
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return null;
    type WBResponse = [unknown, Array<{ date: string; value: number | null }>];
    const json = await res.json() as WBResponse;
    const record = json?.[1]?.[0];
    if (!record || record.value === null || record.value === undefined) return null;
    const val = record.value;
    if (isNaN(val) || val < 0 || val > 30) return null;
    const year = record.date;
    return {
      indicator: 'bank_npl_gross_pct', category: 'banking',
      date: `${year}-12-31`,
      value: parseFloat(val.toFixed(2)), unit: '%',
      source: 'world_bank_api', fetchedAt: NOW(),
    };
  } catch {
    return null;
  }
}

/**
 * Fetch Indonesia NPL gross % from Trading Economics.
 * Source: OJK (Otoritas Jasa Keuangan), monthly. Normal <5%, stress >5%.
 * Used as fallback when OJK SPI Excel scraper is unavailable.
 */
export async function fetchNplTe(): Promise<MacroDataPoint | null> {
  return fetchTePercent(
    'https://tradingeconomics.com/indonesia/non-performing-loans',
    'bank_npl_gross_pct', 'banking',
    'Non Performing Loans', 'Non Performing Loans in Indonesia',
    0.5, 20,
  );
}

/**
 * Fetch Indonesia loan-to-deposit ratio (LDR) from Trading Economics.
 * Source: OJK, monthly. Normal 70-90%, stress >100%.
 */
export async function fetchLdrTe(): Promise<MacroDataPoint | null> {
  return fetchTePercent(
    'https://tradingeconomics.com/indonesia/loans-to-deposits',
    'bank_ldr_pct', 'banking',
    'Loans To Deposits', 'Loan To Deposit',
    40, 130,
  );
}

/**
 * Fetch Indonesia capital adequacy ratio (CAR) from Trading Economics.
 * Source: OJK, monthly. Minimum regulatory 8%. Stress <15%.
 */
export async function fetchCarTe(): Promise<MacroDataPoint | null> {
  return fetchTePercent(
    'https://tradingeconomics.com/indonesia/capital-adequacy-ratio',
    'bank_car_pct', 'banking',
    'Capital Adequacy Ratio', 'Capital Adequacy Ratio in Indonesia',
    8, 35,
  );
}

/**
 * Fetch Indonesia M2 broad money from World Bank API.
 * Source: World Bank FM.LBL.BMNY.CN (broad money, current LCU = IDR).
 * Annual data, 1 year lag. No auth required.
 * 2024 value: IDR ~9,247T; 2023: ~8,827T.
 */
export async function fetchM2WorldBank(): Promise<MacroDataPoint | null> {
  try {
    const res = await fetch(
      'https://api.worldbank.org/v2/country/IDN/indicator/FM.LBL.BMNY.CN?format=json&mrv=1',
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return null;
    type WBResponse = [unknown, Array<{ date: string; value: number | null }>];
    const json = await res.json() as WBResponse;
    const record = json?.[1]?.[0];
    if (!record || record.value === null || record.value === undefined) return null;
    const val = record.value;
    // raw IDR units → convert to bn IDR (÷ 1e9)
    const bnIdr = parseFloat((val / 1_000_000_000).toFixed(0));
    if (isNaN(bnIdr) || bnIdr < 1_000_000 || bnIdr > 50_000_000) return null; // sanity: 1,000–50,000 trillion IDR
    return {
      indicator: 'm2_money_supply_idr_bn', category: 'banking',
      date: `${record.date}-12-31`,
      value: bnIdr, unit: 'bn_IDR',
      source: 'world_bank_api', fetchedAt: NOW(),
    };
  } catch {
    return null;
  }
}

/**
 * Fetch Indonesia total debt service ratio (DSR) from World Bank API.
 * Indicator: DT.TDS.DECT.EX.ZS — total debt service as % of exports + primary income.
 * Annual, 2-3yr lag. IMF stress threshold: 25%. Indonesia historical: 22-32%.
 */
export async function fetchUlnDsrWorldBank(): Promise<MacroDataPoint | null> {
  try {
    const res = await fetch(
      'https://api.worldbank.org/v2/country/IDN/indicator/DT.TDS.DECT.EX.ZS?format=json&mrv=1',
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return null;
    type WBResponse = [unknown, Array<{ date: string; value: number | null }>];
    const json = await res.json() as WBResponse;
    const record = json?.[1]?.[0];
    if (!record || record.value === null || record.value === undefined) return null;
    const val = parseFloat(record.value.toFixed(2));
    if (isNaN(val) || val < 0 || val > 100) return null;
    return {
      indicator: 'uln_dsr_pct', category: 'uln',
      date: `${record.date}-12-31`,
      value: val, unit: '%',
      source: 'world_bank_api', fetchedAt: NOW(),
    };
  } catch {
    return null;
  }
}

/**
 * Fetch Indonesia short-term external debt as % of total from World Bank API.
 * Indicator: DT.DOD.DSTC.ZS — short-term debt stocks (% of total external debt).
 * Annual, 2-3yr lag. Key input for Greenspan-Guidotti ratio. Indonesia historical: 10-20%.
 */
export async function fetchUlnShorttermPctWorldBank(): Promise<MacroDataPoint | null> {
  try {
    const res = await fetch(
      'https://api.worldbank.org/v2/country/IDN/indicator/DT.DOD.DSTC.ZS?format=json&mrv=1',
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return null;
    type WBResponse = [unknown, Array<{ date: string; value: number | null }>];
    const json = await res.json() as WBResponse;
    const record = json?.[1]?.[0];
    if (!record || record.value === null || record.value === undefined) return null;
    const val = parseFloat(record.value.toFixed(2));
    if (isNaN(val) || val < 0 || val > 100) return null;
    return {
      indicator: 'uln_shortterm_pct', category: 'uln',
      date: `${record.date}-12-31`,
      value: val, unit: '%',
      source: 'world_bank_api', fetchedAt: NOW(),
    };
  } catch {
    return null;
  }
}
