/**
 * Historical data loader for backtesting.
 * Fetches multi-year daily OHLCV from Yahoo Finance.
 * Caches aggressively — historical data doesn't change.
 */
import YahooFinance from 'yahoo-finance2';
import type { MacroDataPoint } from '../types.js';
import { readCache, writeCache } from '../../../utils/cache.js';
import {
  fetchIndonesiaCdsHistoricalWgb,
  fetchSbn10yHistoricalWgb,
} from '../sources/sovereign-scraper.js';

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
  // CPO excluded from backtest — World Bank data is monthly only, not compatible with daily replay
  // cpo_price_myr is available in live engines via World Bank Pink Sheet (worldbank.ts)
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

  await Promise.allSettled([
    ...BACKTEST_INDICATORS.map(async (spec) => {
      const bars = await fetchFullHistory(spec.ticker, startDate, endDate);
      if (bars.length > 0) {
        result.set(spec.indicator, bars);
      }
    }),
    loadCdsSovereign(startDate, endDate, result),
    loadSbn10yYield(startDate, endDate, result),
  ]);

  return result;
}

async function loadSbn10yYield(
  startDate: string,
  endDate: string,
  result: Map<string, DailyBar[]>,
): Promise<void> {
  const cacheKey = 'backtest/indonesia_sbn10y_pct';
  const cached = readCache(cacheKey, { from: startDate, to: endDate }, 24 * 60 * 60 * 1000 * 3);
  let bars: DailyBar[];
  let fromCache = false;

  if (cached?.data?.bars) {
    bars = cached.data.bars as DailyBar[];
    fromCache = true;
  } else {
    // WGB Playwright — daily precision. Coverage from ~Sep 2016 to present.
    // Pre-2016 gap: no free API covers Indonesia 10Y historical (not OECD member).
    // Crises affected: 2013 Taper Tantrum + 2015 China Devaluation pre-crisis window
    // use neutral 30 sovereign baseline; still caught via FX/commodity/flow modules.
    let raw: Array<{ date: string; close: number }> = [];
    try {
      process.stderr.write('Fetching WGB SBN 10Y yield historical data (Playwright)...\n');
      raw = await fetchSbn10yHistoricalWgb();
    } catch (err) {
      process.stderr.write(`WGB SBN 10Y fetch failed: ${err instanceof Error ? err.message : String(err)}\n`);
    }

    bars = raw
      .filter((b) => b.date >= startDate && b.date <= endDate)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (bars.length > 0) {
      writeCache(cacheKey, { from: startDate, to: endDate }, { bars }, 'SBN10Y');
    }
  }

  if (bars.length > 0) {
    process.stderr.write(
      `SBN 10Y yield: ${bars.length} bars loaded${fromCache ? ' (cached)' : ''} [${bars[0]!.date} → ${bars[bars.length - 1]!.date}]\n`,
    );
    result.set('indonesia_sbn10y_pct', bars);
  } else {
    process.stderr.write('SBN 10Y: no data — sovereign module uses CDS only\n');
  }
}

async function loadCdsSovereign(
  startDate: string,
  endDate: string,
  result: Map<string, DailyBar[]>,
): Promise<void> {
  const cacheKey = 'backtest/indonesia_cds_5y_bps_wgb';
  const cached = readCache(cacheKey, { from: startDate, to: endDate }, 24 * 60 * 60 * 1000 * 3); // 3d TTL
  let bars: DailyBar[];
  let fromCache = false;

  if (cached?.data?.bars) {
    bars = cached.data.bars as DailyBar[];
    fromCache = true;
  } else {
    try {
      process.stderr.write('Fetching WGB CDS historical data (Playwright)...\n');
      const raw = await fetchIndonesiaCdsHistoricalWgb();
      bars = raw
        .filter((b) => b.date >= startDate && b.date <= endDate)
        .sort((a, b) => a.date.localeCompare(b.date));
      if (bars.length > 0) {
        writeCache(cacheKey, { from: startDate, to: endDate }, { bars }, 'WGB_CDS');
      }
    } catch (err) {
      process.stderr.write(`WGB CDS fetch failed: ${err instanceof Error ? err.message : String(err)}\n`);
      bars = [];
    }
  }

  if (bars.length > 0) {
    process.stderr.write(`WGB CDS: ${bars.length} bars loaded${fromCache ? ' (cached)' : ''} [${bars[0]!.date} → ${bars[bars.length - 1]!.date}]\n`);
    result.set('indonesia_cds_5y_bps', bars);
  } else {
    process.stderr.write('WGB CDS: no data — using neutral sovereign baseline in replay\n');
  }
}
