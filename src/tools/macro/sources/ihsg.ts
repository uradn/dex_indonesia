/**
 * IHSG market valuation and IDX breadth scrapers.
 *
 * Indicators:
 *   ihsg_pe_ratio            — IHSG composite P/E ratio (historical avg ~14-16x)
 *   idx_advance_decline_ratio — advancing/declining stocks ratio (>1 = net breadth positive)
 *
 * Sources:
 *   P/E: 1) Yahoo Finance ^JKSE trailingPE  2) EIDO ETF trailingPE (proxy)
 *        3) Trading Economics Playwright  4) IDX JSON API
 *   Breadth: 1) IDX JSON API  2) IDX market summary Playwright (EN + ID)
 */
import YahooFinance from 'yahoo-finance2';
import type { MacroDataPoint } from '../types.js';
import { fetchRenderedTextWithBrowser } from './playwright-browser.js';

const yf = new YahooFinance();

const NOW = () => new Date().toISOString();
const TODAY = () => new Date().toISOString().slice(0, 10);

const MONTH_MAP: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

/**
 * Try Yahoo Finance for IHSG P/E via ^JKSE or EIDO ETF proxy.
 * ^JKSE rarely returns trailingPE; EIDO (holds Indonesian stocks) more likely to.
 */
async function fetchIhsgPeYahoo(): Promise<number | null> {
  for (const ticker of ['^JKSE', 'EIDO']) {
    try {
      const q = await yf.quote(ticker);
      const pe = (q as Record<string, unknown>)['trailingPE'];
      if (typeof pe === 'number' && pe > 5 && pe < 100) return pe;
    } catch { /* try next */ }
  }
  return null;
}

interface IdxStockRow {
  Previous: number;
  Close: number;
  Change?: number;
}

interface IdxStockSummaryResponse {
  recordsTotal: number;
  data: IdxStockRow[];
}

/**
 * Fetch IDX advance/decline from TradingSummary/GetStockSummary.
 * Computes A/D by comparing Close vs Previous for each listed stock.
 * Note: old StockData/TradingData prefixes return 503 — TradingSummary is current.
 */
async function fetchIdxAdApi(): Promise<{ advance: number; decline: number } | null> {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://www.idx.co.id/',
  };

  try {
    const res = await fetch(
      'https://www.idx.co.id/primary/TradingSummary/GetStockSummary?length=9999&start=0',
      { headers, signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) return null;
    const json = await res.json() as IdxStockSummaryResponse;
    if (!Array.isArray(json?.data) || json.data.length < 50) return null;

    let advance = 0, decline = 0;
    for (const s of json.data) {
      if (!s.Previous || !s.Close) continue;
      if (s.Close > s.Previous) advance++;
      else if (s.Close < s.Previous) decline++;
    }
    if (advance > 0 && decline > 0) return { advance, decline };
  } catch { /* fall through to Playwright */ }

  return null;
}

/**
 * Fetch IHSG composite P/E ratio.
 * Priority: Yahoo Finance → TE Playwright → generic number extraction.
 * Historical context: IHSG P/E range 10-25x. Stress = divergence from fundamentals.
 */
export async function fetchIhsgPeRatio(): Promise<MacroDataPoint | null> {
  // 1. Yahoo Finance (fast, no Playwright needed)
  const yaPe = await fetchIhsgPeYahoo();
  if (yaPe !== null) {
    return {
      indicator: 'ihsg_pe_ratio', category: 'regime',
      date: TODAY(), value: parseFloat(yaPe.toFixed(2)), unit: 'ratio',
      source: 'yahoo_finance', fetchedAt: NOW(),
    };
  }

  const text = await fetchRenderedTextWithBrowser('https://tradingeconomics.com/indonesia/stock-market-p-e-ratio');
  if (!text) return null;

  // Primary: table row "Stock Market P/E Ratio  22.27  22.27  ratio  Apr 2026"
  const tableMatch = text.match(
    /(?:Stock Market )?P\/E Ratio\s+([\d.]+)\s+[\d.]+\s+(?:ratio|times?|x|-)\s+(\w{3})\s+(\d{4})/i,
  );
  if (tableMatch) {
    const val = parseFloat(tableMatch[1]!);
    const mon = tableMatch[2]!;
    const yr = tableMatch[3]!;
    const mm = MONTH_MAP[mon] ?? '01';
    const lastDay = new Date(parseInt(yr), parseInt(mm), 0).getDate();
    if (val > 5 && val < 100) {
      return {
        indicator: 'ihsg_pe_ratio', category: 'regime',
        date: `${yr}-${mm}-${String(lastDay).padStart(2, '0')}`,
        value: parseFloat(val.toFixed(2)), unit: 'ratio',
        source: 'trading_economics_scrape', fetchedAt: NOW(),
      };
    }
  }

  // Fallback 1: prose "P/E Ratio in Indonesia ... to XX.XX"
  const proseMatch = text.match(/P\/E Ratio in Indonesia[^0-9]+([\d.]+)/i);
  if (proseMatch) {
    const val = parseFloat(proseMatch[1]!);
    if (val > 5 && val < 100) {
      return {
        indicator: 'ihsg_pe_ratio', category: 'regime',
        date: TODAY(), value: parseFloat(val.toFixed(2)), unit: 'ratio',
        source: 'trading_economics_scrape', fetchedAt: NOW(),
      };
    }
  }

  // Fallback 2: any P/E or PER near a reasonable equity multiple (8-50x)
  const genericMatch = text.match(/\b(?:P\/E|PER)\b[^\d]{0,20}(\d{1,2}\.\d{1,2})/i);
  if (genericMatch) {
    const val = parseFloat(genericMatch[1]!);
    if (val > 8 && val < 60) {
      return {
        indicator: 'ihsg_pe_ratio', category: 'regime',
        date: TODAY(), value: parseFloat(val.toFixed(2)), unit: 'ratio',
        source: 'trading_economics_scrape', fetchedAt: NOW(),
      };
    }
  }

  return null;
}

/**
 * Fetch IDX advance/decline breadth.
 * Priority: IDX JSON API → Playwright EN page → Playwright ID page.
 * >1.5 = broad rally. <0.67 = broad selling. <0.5 = panic breadth.
 */
export async function fetchIdxAdvanceDecline(): Promise<MacroDataPoint | null> {
  // 1. Try JSON API (fast, no Playwright)
  const apiData = await fetchIdxAdApi();
  if (apiData && apiData.advance + apiData.decline > 10) {
    return {
      indicator: 'idx_advance_decline_ratio', category: 'regime',
      date: TODAY(), value: parseFloat((apiData.advance / apiData.decline).toFixed(3)), unit: 'ratio',
      source: 'idx_api', fetchedAt: NOW(),
    };
  }

  // 2. Playwright fallback on IDX pages
  for (const url of [
    'https://www.idx.co.id/en/market-data/market-summary/',
    'https://www.idx.co.id/id/data-pasar/ringkasan-perdagangan/',
  ]) {
    const text = await fetchRenderedTextWithBrowser(url);
    if (!text) continue;

    // Pattern: "Advance  350  Unchanged  120  Decline  230"
    // Or: "Naik  350  Tetap  120  Turun  230"
    const adMatch =
      text.match(/(?:Advance|Naik)\D{0,5}([\d,]+)\D{0,50}(?:Decline|Turun)\D{0,5}([\d,]+)/i);
    if (adMatch) {
      const adv = parseInt(adMatch[1]!.replace(/,/g, ''));
      const dec = parseInt(adMatch[2]!.replace(/,/g, ''));
      if (adv > 0 && dec > 0 && adv + dec < 1500) {
        return {
          indicator: 'idx_advance_decline_ratio', category: 'regime',
          date: TODAY(), value: parseFloat((adv / dec).toFixed(3)), unit: 'ratio',
          source: 'idx_scrape', fetchedAt: NOW(),
        };
      }
    }

    // Alternative: look for numeric pattern near advance/naik keyword
    const advIdx = text.toLowerCase().indexOf('advance');
    const naikIdx = text.toLowerCase().indexOf('naik');
    const startIdx = advIdx >= 0 ? advIdx : naikIdx;
    if (startIdx >= 0) {
      const section = text.slice(startIdx, startIdx + 300);
      const nums = [...section.matchAll(/\b(\d{1,3})\b/g)].map(m => parseInt(m[1]!)).filter(n => n > 10 && n < 800);
      if (nums.length >= 2 && nums[1]! > 0) {
        const ratio = nums[0]! / nums[1]!;
        if (ratio > 0.1 && ratio < 20) {
          return {
            indicator: 'idx_advance_decline_ratio', category: 'regime',
            date: TODAY(), value: parseFloat(ratio.toFixed(3)), unit: 'ratio',
            source: 'idx_scrape', fetchedAt: NOW(),
          };
        }
      }
    }
  }

  return null;
}

export interface IhsgMarketSnapshot {
  peRatio: MacroDataPoint | null;
  advanceDecline: MacroDataPoint | null;
}

export async function fetchIhsgMarketData(): Promise<IhsgMarketSnapshot> {
  const [peRatio, advanceDecline] = await Promise.all([
    fetchIhsgPeRatio(),
    fetchIdxAdvanceDecline(),
  ]);
  return { peRatio, advanceDecline };
}
