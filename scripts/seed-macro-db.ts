/**
 * Pre-seed the macro time-series DB with Yahoo Finance history.
 * Gives all engines real z-score data immediately without waiting for accumulation.
 *
 * Run: bun scripts/seed-macro-db.ts [days]
 * Default: 730 days (~2 years). Minimum useful: 120 days.
 */
import { fetchFullHistory, BACKTEST_INDICATORS } from '../src/tools/macro/backtest/historical-loader.js';
import { upsertPoints } from '../src/tools/macro/time-series-db.js';
import { fetchBiFxReservesWorldBank, fetchCpoPriceWorldBank } from '../src/tools/macro/sources/worldbank.js';
import type { MacroDataPoint } from '../src/tools/macro/types.js';

// ASEAN FX peers not in BACKTEST_INDICATORS
const ASEAN_FX: Array<{ ticker: string; indicator: string; unit: string }> = [
  { ticker: 'MYR=X',  indicator: 'usdmyr_spot',  unit: 'MYR/USD' },
  { ticker: 'SGD=X',  indicator: 'usdsgd_spot',  unit: 'SGD/USD' },
  { ticker: 'THB=X',  indicator: 'usdthb_spot',  unit: 'THB/USD' },
  { ticker: 'PHP=X',  indicator: 'usdphp_spot',  unit: 'PHP/USD' },
];

// Additional indicators used by commodity engine but not in backtest list
const COMMODITY_EXTRAS: Array<{ ticker: string; indicator: string; unit: string; category: MacroDataPoint['category'] }> = [
  { ticker: 'SI=F',   indicator: 'silver_price_usd',  unit: 'USD/oz',  category: 'commodity' },
  { ticker: 'SLX',    indicator: 'steel_etf_usd',     unit: 'USD',     category: 'commodity' },
  { ticker: 'ALI=F',  indicator: 'aluminum_price_usd', unit: 'USD/MT', category: 'commodity' },
];

const DAYS_BACK = parseInt(process.argv[2] ?? '730', 10);
const END_DATE  = new Date().toISOString().slice(0, 10);
const START_DATE = new Date(Date.now() - DAYS_BACK * 86400_000).toISOString().slice(0, 10);

const DIVIDER = '─'.repeat(60);

async function seedIndicator(
  ticker: string,
  indicator: string,
  unit: string,
  category: MacroDataPoint['category'],
): Promise<{ indicator: string; count: number; error?: string }> {
  try {
    const bars = await fetchFullHistory(ticker, START_DATE, END_DATE);
    if (bars.length === 0) {
      return { indicator, count: 0, error: 'no data returned' };
    }

    const fetchedAt = new Date().toISOString();
    const points: MacroDataPoint[] = bars.map((bar) => ({
      indicator,
      category,
      date: bar.date,
      value: bar.close,
      unit,
      source: 'yahoo_finance',
      fetchedAt,
    }));

    await upsertPoints(points);
    return { indicator, count: points.length };
  } catch (err) {
    return { indicator, count: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  console.log(`\n📦 MACRO DB SEEDER`);
  console.log(`Range: ${START_DATE} → ${END_DATE} (${DAYS_BACK} days)`);
  console.log(DIVIDER);

  const allSpecs: Array<{ ticker: string; indicator: string; unit: string; category: MacroDataPoint['category'] }> = [
    ...BACKTEST_INDICATORS.map((s) => ({ ticker: s.ticker, indicator: s.indicator, unit: s.unit, category: s.category })),
    ...ASEAN_FX.map((s) => ({ ...s, category: 'fx' as MacroDataPoint['category'] })),
    ...COMMODITY_EXTRAS,
  ];

  console.log(`Seeding ${allSpecs.length} indicators...`);

  // Batch in groups of 4 to avoid rate limits
  const BATCH = 4;
  let totalPoints = 0;
  let failed = 0;

  for (let i = 0; i < allSpecs.length; i += BATCH) {
    const batch = allSpecs.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map((s) => seedIndicator(s.ticker, s.indicator, s.unit, s.category)),
    );

    for (const r of results) {
      if (r.error) {
        console.log(`  ❌ ${r.indicator}: ${r.error}`);
        failed++;
      } else {
        console.log(`  ✅ ${r.indicator}: ${r.count} rows`);
        totalPoints += r.count;
      }
    }
  }

  // ── World Bank sources (CPO + FX Reserves) ──────────────────────────
  console.log('\nSeeding World Bank data...');

  // CPO price from Pink Sheet
  try {
    const cpoPoints = await fetchCpoPriceWorldBank(Math.ceil(DAYS_BACK / 30));
    if (cpoPoints.length > 0) {
      await upsertPoints(cpoPoints);
      console.log(`  ✅ cpo_price_myr (World Bank Pink Sheet): ${cpoPoints.length} monthly rows`);
      totalPoints += cpoPoints.length;
    } else {
      console.log(`  ❌ cpo_price_myr: no data from Pink Sheet`);
      failed++;
    }
  } catch (err) {
    console.log(`  ❌ cpo_price_myr: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }

  // FX reserves from World Bank GEM API
  try {
    const reservePoints = await fetchBiFxReservesWorldBank(Math.ceil(DAYS_BACK / 30));
    if (reservePoints.length > 0) {
      await upsertPoints(reservePoints);
      console.log(`  ✅ bi_fx_reserves_bn (World Bank GEM): ${reservePoints.length} monthly rows`);
      totalPoints += reservePoints.length;
    } else {
      console.log(`  ❌ bi_fx_reserves_bn: no data`);
      failed++;
    }
  } catch (err) {
    console.log(`  ❌ bi_fx_reserves_bn: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }

  console.log(DIVIDER);
  console.log(`Done. ${totalPoints} points seeded, ${failed} failed.`);
  console.log(`DB path: ~/.dexter/macro/macro.db`);
  console.log(`\nRun engines now — all z-scores will use real historical data.`);
  console.log(DIVIDER);
}

main().catch(console.error);
