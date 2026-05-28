/**
 * EODHD (End of Day Historical Data) — fallback source.
 * Used when primary sources (Yahoo Finance, open.er-api) are unavailable or stale.
 *
 * Active endpoints with free/basic plan:
 *   IDR.FOREX  → USDIDR spot (tertiary fallback)
 *   JKSE.INDX  → IHSG composite price
 *
 * Requires EODHD_API_KEY in .env.
 */
import type { MacroDataPoint } from '../types.js';

const BASE = 'https://eodhd.com/api/real-time';
const NOW = () => new Date().toISOString();
const TODAY = () => new Date().toISOString().slice(0, 10);

interface EodhdQuote {
  code: string;
  timestamp: number | 'NA';
  close: number | 'NA';
  open: number | 'NA';
  high: number | 'NA';
  low: number | 'NA';
  previousClose: number | 'NA';
  change: number | 'NA';
  change_p: number | 'NA';
}

async function fetchQuote(ticker: string): Promise<EodhdQuote | null> {
  const key = process.env.EODHD_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${BASE}/${ticker}?api_token=${key}&fmt=json`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as EodhdQuote;
    if (!data || data.close === 'NA') return null;
    return data;
  } catch {
    return null;
  }
}

export async function fetchUsdIdrEodhd(): Promise<MacroDataPoint | null> {
  const q = await fetchQuote('IDR.FOREX');
  if (!q || typeof q.close !== 'number') return null;
  if (q.close < 10_000 || q.close > 30_000) return null;
  return {
    indicator: 'usdidr_spot',
    category: 'fx',
    date: typeof q.timestamp === 'number'
      ? new Date(q.timestamp * 1000).toISOString().slice(0, 10)
      : TODAY(),
    value: q.close,
    unit: 'IDR/USD',
    source: 'eodhd',
    fetchedAt: NOW(),
  };
}

export async function fetchIhsgPriceEodhd(): Promise<MacroDataPoint | null> {
  const q = await fetchQuote('JKSE.INDX');
  if (!q || typeof q.close !== 'number') return null;
  if (q.close < 1_000 || q.close > 20_000) return null;
  return {
    indicator: 'ihsg_composite',
    category: 'regime',
    date: typeof q.timestamp === 'number'
      ? new Date(q.timestamp * 1000).toISOString().slice(0, 10)
      : TODAY(),
    value: parseFloat(q.close.toFixed(2)),
    unit: 'index',
    source: 'eodhd',
    fetchedAt: NOW(),
  };
}
