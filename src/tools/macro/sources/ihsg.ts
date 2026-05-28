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

/**
 * Fetch EIDO ETF trailing P/E as Indonesia large-cap proxy.
 * ^JKSE never returns trailingPE via Yahoo Finance.
 * EIDO (iShares MSCI Indonesia) holds top ~85 stocks by market cap.
 * Historical EIDO P/E range: ~8-15x (lower than IHSG composite ~14-22x).
 * TE composite P/E data removed from their platform (returns "no data").
 */
async function fetchIhsgPeYahoo(): Promise<number | null> {
  try {
    const q = await yf.quote('EIDO');
    const pe = (q as Record<string, unknown>)['trailingPE'];
    if (typeof pe === 'number' && pe > 4 && pe < 60) return pe;
  } catch { /* ignore */ }
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
 * Fetch IHSG composite P/E ratio via EIDO ETF proxy.
 * TE removed IHSG composite P/E from their platform (returns "no data").
 * EIDO is only reliable free source. Label clearly — ~8-15x range, not 14-22x composite.
 */
export async function fetchIhsgPeRatio(): Promise<MacroDataPoint | null> {
  const yaPe = await fetchIhsgPeYahoo();
  if (yaPe !== null) {
    return {
      indicator: 'ihsg_pe_ratio', category: 'regime',
      date: TODAY(), value: parseFloat(yaPe.toFixed(2)), unit: 'ratio',
      source: 'yahoo_finance', fetchedAt: NOW(),
    };
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
