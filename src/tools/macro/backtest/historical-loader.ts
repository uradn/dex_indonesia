/**
 * Historical data loader for backtesting.
 * Fetches multi-year daily OHLCV from Yahoo Finance.
 * Caches aggressively — historical data doesn't change.
 */
import YahooFinance from 'yahoo-finance2';
import type { MacroDataPoint } from '../types.js';
import { readCache, writeCache } from '../../../utils/cache.js';

const yf = new YahooFinance();

// All indicators backtestable via Yahoo Finance
export const BACKTEST_INDICATORS: Array<{
  ticker: string;
  indicator: string;
  unit: string;
  category: MacroDataPoint['category'];
}> = [
  { ticker: 'IDR=X',   indicator: 'usdidr_spot',      unit: 'IDR/USD',  category: 'fx'        },
  { ticker: 'EIDO',    indicator: 'eido_price',        unit: 'USD',      category: 'flow'      },
  { ticker: '^JKSE',   indicator: 'ihsg_level',        unit: 'IDX',      category: 'flow'      },
  { ticker: 'BO=F',    indicator: 'cpo_price_myr',     unit: 'USc/lb',   category: 'commodity' }, // soybean oil as CPO proxy (FCPO.KL unavailable on Yahoo)
  { ticker: 'VALE',    indicator: 'nickel_price_usd',  unit: 'USD',      category: 'commodity' }, // Vale S.A. ADR as nickel proxy (NI=F unavailable)
  { ticker: 'HG=F',    indicator: 'copper_price_usd',  unit: 'USD/lb',   category: 'commodity' },
  { ticker: 'BZ=F',    indicator: 'brent_price_usd',   unit: 'USD/bbl',  category: 'commodity' },
  { ticker: 'GC=F',    indicator: 'gold_price_usd',    unit: 'USD/oz',   category: 'commodity' },
  { ticker: 'BTU',     indicator: 'coal_etf_usd',      unit: 'USD',      category: 'commodity' }, // Peabody Energy as coal price proxy (KOL delisted)
  { ticker: 'NG=F',    indicator: 'natgas_price_usd',  unit: 'USD/MMBtu',category: 'commodity' },
  { ticker: '^VIX',    indicator: 'vix_level',         unit: 'index',    category: 'regime'    },
  { ticker: 'DX-Y.NYB',indicator: 'dxy_index',         unit: 'index',    category: 'fx'        },
];

export interface DailyBar {
  date: string;     // ISO YYYY-MM-DD
  close: number;
}

/**
 * Fetch full daily history for a ticker.
 * Returns sorted ascending. Caches to .dexter/cache.
 */
export async function fetchFullHistory(
  ticker: string,
  startDate: string,
  endDate: string,
): Promise<DailyBar[]> {
  const cacheKey = `backtest/${ticker.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const cached = readCache(cacheKey, { from: startDate, to: endDate }, 24 * 60 * 60 * 1000 * 7); // 7d TTL
  if (cached?.data?.bars) {
    return cached.data.bars as DailyBar[];
  }

  try {
    const result = await yf.chart(ticker, {
      period1: new Date(startDate),
      period2: new Date(endDate),
      interval: '1d',
    });

    const bars: DailyBar[] = (result.quotes ?? [])
      .filter((q) => q.close != null && !isNaN(q.close))
      .map((q) => ({
        date: new Date(q.date).toISOString().slice(0, 10),
        close: q.close!,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    writeCache(cacheKey, { from: startDate, to: endDate }, { bars }, ticker);
    return bars;
  } catch {
    return [];
  }
}

/**
 * Load all backtest indicators for the given date range.
 * Returns a map: indicator → DailyBar[]
 */
export async function loadAllHistoricalData(
  startDate: string,
  endDate: string,
): Promise<Map<string, DailyBar[]>> {
  const result = new Map<string, DailyBar[]>();

  await Promise.allSettled(
    BACKTEST_INDICATORS.map(async (spec) => {
      const bars = await fetchFullHistory(spec.ticker, startDate, endDate);
      if (bars.length > 0) {
        result.set(spec.indicator, bars);
      }
    }),
  );

  return result;
}
