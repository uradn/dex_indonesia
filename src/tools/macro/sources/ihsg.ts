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

/**
 * Try IDX JSON API for advance/decline data.
 */
async function fetchIdxAdApi(): Promise<{ advance: number; decline: number } | null> {
  const endpoints = [
    'https://www.idx.co.id/primary/StockData/GetMarketSummary',
    'https://www.idx.co.id/primary/StockData/GetMarketActivity',
    'https://www.idx.co.id/umbraco/Surface/StockData/GetMarketSummary',
    'https://www.idx.co.id/primary/TradingData/GetMarketSummary',
  ];
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Referer': 'https://www.idx.co.id/',
  };
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(8_000) });
      if (!res.ok) continue;
      const data = await res.json() as unknown;
      if (data && typeof data === 'object') {
        const obj = data as Record<string, unknown>;
        // Try common field names
        const adv = obj['StockAdvance'] ?? obj['advance'] ?? obj['Advance'] ?? obj['stockAdvance'];
        const dec = obj['StockDecline'] ?? obj['decline'] ?? obj['Decline'] ?? obj['stockDecline'];
        if (typeof adv === 'number' && typeof dec === 'number' && adv > 0 && dec > 0) {
          return { advance: adv, decline: dec };
        }
        // Nested: data.Result or data.data
        for (const key of ['Result', 'result', 'data', 'Data']) {
          const nested = obj[key];
          if (nested && typeof nested === 'object') {
            const n = nested as Record<string, unknown>;
            const na = n['StockAdvance'] ?? n['advance'] ?? n['Advance'];
            const nd = n['StockDecline'] ?? n['decline'] ?? n['Decline'];
            if (typeof na === 'number' && typeof nd === 'number' && na > 0 && nd > 0) {
              return { advance: na, decline: nd };
            }
          }
        }
      }
    } catch { /* try next */ }
  }
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
  if (apiData && apiData.advance + apiData.decline < 1500) {
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
