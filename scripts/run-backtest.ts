/**
 * Standalone backtest runner.
 * Usage: bun scripts/run-backtest.ts [startDate] [endDate] [crisisId,...]
 * Example: bun scripts/run-backtest.ts 2012-01-01 2024-12-31
 */
import 'dotenv/config';
import { loadAllHistoricalData, BACKTEST_INDICATORS } from '../src/tools/macro/backtest/historical-loader.js';
import { computeSignals } from '../src/tools/macro/backtest/replay-engine.js';
import { validateCrisis, buildBacktestResult, formatBacktestReport } from '../src/tools/macro/backtest/signal-validator.js';
import { INDONESIA_CRISIS_CALENDAR } from '../src/tools/macro/backtest/crisis-calendar.js';

const [,, startArg, endArg, crisisArg] = process.argv;
const start = startArg ?? '2012-01-01';
const end   = endArg   ?? new Date().toISOString().slice(0, 10);
const crisisFilter = crisisArg ? crisisArg.split(',') : null;

const crises = crisisFilter
  ? INDONESIA_CRISIS_CALENDAR.filter((c) => crisisFilter.includes(c.id))
  : INDONESIA_CRISIS_CALENDAR;

console.log(`Backtest: ${start} → ${end}`);
console.log(`Crises: ${crises.map((c) => c.id).join(', ')}`);
console.log(`Indicators: ${BACKTEST_INDICATORS.map((s) => s.ticker).join(', ')}, indonesia_cds_5y_bps (WGB)\n`);
console.log('Loading historical data from Yahoo Finance...');

const historicalData = await loadAllHistoricalData(start, end);

if (historicalData.size === 0) {
  console.error('ERROR: No historical data loaded. Check network.');
  process.exit(1);
}

console.log(`Loaded ${historicalData.size} indicator series.`);
console.log('Running walk-forward replay...\n');

const dateSet = new Set<string>();
for (const bars of historicalData.values()) {
  for (const bar of bars) dateSet.add(bar.date);
}
const dates = [...dateSet].sort();

const signals = computeSignals(historicalData, dates);
const validations = crises.map((crisis) => validateCrisis(crisis, signals));

const indicatorsBacktested = BACKTEST_INDICATORS
  .filter((spec) => historicalData.has(spec.indicator))
  .map((spec) => spec.indicator);

const result = buildBacktestResult(validations, signals, { start, end }, indicatorsBacktested);

console.log(formatBacktestReport(result));
