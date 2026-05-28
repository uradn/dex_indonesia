/**
 * Yahoo Finance macro data — FX rates, ETF proxies.
 * No API key needed. Built on the existing yahoo-finance2 dependency.
 */
import YahooFinance from 'yahoo-finance2';
import type { MacroDataPoint } from '../types.js';
import { fetchUsdIdrEodhd } from './eodhd.js';

const yf = new YahooFinance();

const NOW = () => new Date().toISOString();
const TODAY = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000);

// USDIDR spot + history
export async function fetchUsdIdrHistory(days = 365): Promise<MacroDataPoint[]> {
  const result = await yf.chart('IDR=X', {
    period1: daysAgo(days),
    period2: new Date(),
    interval: '1d',
  });
  const quotes = result.quotes ?? [];
  return quotes
    .filter((q) => q.close != null)
    .map((q) => ({
      indicator: 'usdidr_spot',
      category: 'fx' as const,
      date: new Date(q.date).toISOString().slice(0, 10),
      value: q.close!,
      unit: 'IDR/USD',
      source: 'yahoo_finance',
      fetchedAt: NOW(),
    }));
}

const STALE_THRESHOLD_MS = 5 * 60 * 60 * 1000; // 5 hours

// Fallback chain: open.er-api.com (hourly, free) → EODHD (if key set, EOD)
async function fetchUsdIdrOpenEr(): Promise<MacroDataPoint | null> {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!res.ok) return null;
    const data = (await res.json()) as { rates?: Record<string, number> };
    const idr = data?.rates?.IDR;
    if (!idr || idr < 10_000 || idr > 30_000) return null;
    return {
      indicator: 'usdidr_spot',
      category: 'fx',
      date: TODAY(),
      value: idr,
      unit: 'IDR/USD',
      source: 'open_er_api',
      fetchedAt: NOW(),
    };
  } catch {
    return null;
  }
}

export async function fetchUsdIdrSpot(): Promise<MacroDataPoint | null> {
  // Stress test override — set DEXTER_STRESS_FX env var to inject synthetic rate
  const stressOverride = process.env.DEXTER_STRESS_FX ? parseFloat(process.env.DEXTER_STRESS_FX) : null;
  if (stressOverride && stressOverride > 10_000 && stressOverride < 30_000) {
    return {
      indicator: 'usdidr_spot', category: 'fx',
      date: TODAY(), value: stressOverride,
      unit: 'IDR/USD', source: 'stress_override', fetchedAt: NOW(),
    };
  }

  try {
    const q = await yf.quote('IDR=X');
    if (!q.regularMarketPrice) return fetchUsdIdrOpenEr();

    // Check data age — Yahoo returns last-close price when market is quiet
    const marketTime = q.regularMarketTime ? new Date(q.regularMarketTime).getTime() : null;
    const ageMs = marketTime ? Date.now() - marketTime : null;

    if (ageMs !== null && ageMs > STALE_THRESHOLD_MS) {
      const fallback = await fetchUsdIdrOpenEr() ?? await fetchUsdIdrEodhd();
      if (fallback) return fallback;
      // all fallbacks failed — return Yahoo data (stale > nothing)
    }

    return {
      indicator: 'usdidr_spot',
      category: 'fx',
      date: TODAY(),
      value: q.regularMarketPrice,
      unit: 'IDR/USD',
      source: 'yahoo_finance',
      fetchedAt: NOW(),
    };
  } catch {
    return await fetchUsdIdrOpenEr() ?? fetchUsdIdrEodhd();
  }
}

// ASEAN FX spots vs USD
const FX_TICKERS: Record<string, { indicator: string; unit: string }> = {
  'MYR=X': { indicator: 'usdmyr_spot', unit: 'MYR/USD' },
  'SGD=X': { indicator: 'usdsgd_spot', unit: 'SGD/USD' },
  'THB=X': { indicator: 'usdthb_spot', unit: 'THB/USD' },
  'PHP=X': { indicator: 'usdphp_spot', unit: 'PHP/USD' },
};

export async function fetchAseanFxSpots(): Promise<MacroDataPoint[]> {
  const results: MacroDataPoint[] = [];
  await Promise.allSettled(
    Object.entries(FX_TICKERS).map(async ([ticker, meta]) => {
      try {
        const q = await yf.quote(ticker);
        if (q.regularMarketPrice) {
          results.push({
            indicator: meta.indicator,
            category: 'fx',
            date: TODAY(),
            value: q.regularMarketPrice,
            unit: meta.unit,
            source: 'yahoo_finance',
            fetchedAt: NOW(),
          });
        }
      } catch { /* skip */ }
    }),
  );
  return results;
}

// EIDO (iShares MSCI Indonesia ETF) as foreign equity flow proxy
export async function fetchEidoProxy(days = 90): Promise<MacroDataPoint[]> {
  try {
    const result = await yf.chart('EIDO', {
      period1: daysAgo(days),
      period2: new Date(),
      interval: '1d',
    });
    const quotes = result.quotes ?? [];
    return quotes
      .filter((q) => q.close != null)
      .map((q) => ({
        indicator: 'eido_price',
        category: 'flow' as const,
        date: new Date(q.date).toISOString().slice(0, 10),
        value: q.close!,
        unit: 'USD',
        source: 'yahoo_finance',
        fetchedAt: NOW(),
      }));
  } catch {
    return [];
  }
}

// US 10Y Treasury yield (^TNX) — for SBN-UST spread context
export async function fetchUst10y(): Promise<MacroDataPoint | null> {
  try {
    const q = await yf.quote('^TNX');
    const price = q.regularMarketPrice;
    if (!price || price < 0.5 || price > 20) return null;
    return {
      indicator: 'ust_10y_yield_pct',
      category: 'sovereign' as const,
      date: TODAY(),
      value: parseFloat(price.toFixed(3)),
      unit: '%',
      source: 'yahoo_finance',
      fetchedAt: NOW(),
    };
  } catch {
    return null;
  }
}

// Compute 30-day realized volatility from daily returns (annualized %)
export function computeRealizedVol(prices: number[], windowDays = 30): number | null {
  if (prices.length < windowDays + 1) return null;
  const slice = prices.slice(-windowDays - 1);
  const returns: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    returns.push(Math.log(slice[i] / slice[i - 1]));
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance * 252) * 100; // annualized %
}
