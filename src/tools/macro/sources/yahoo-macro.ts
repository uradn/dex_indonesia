/**
 * Yahoo Finance macro data — FX rates, ETF proxies.
 * No API key needed. Built on the existing yahoo-finance2 dependency.
 */
import YahooFinance from 'yahoo-finance2';
import type { MacroDataPoint } from '../types.js';

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

export async function fetchUsdIdrSpot(): Promise<MacroDataPoint | null> {
  try {
    const q = await yf.quote('IDR=X');
    if (!q.regularMarketPrice) return null;
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
    return null;
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
