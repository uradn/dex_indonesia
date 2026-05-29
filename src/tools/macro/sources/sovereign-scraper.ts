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
