import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { loadAllHistoricalData, BACKTEST_INDICATORS } from './backtest/historical-loader.js';
import { computeSignals } from './backtest/replay-engine.js';
import { validateCrisis, buildBacktestResult, formatBacktestReport } from './backtest/signal-validator.js';
import { INDONESIA_CRISIS_CALENDAR } from './backtest/crisis-calendar.js';

export const BACKTEST_DESCRIPTION = `
Run walk-forward backtesting engine validating Indonesia macro signals against 6 historical crisis events (2013–2023).

Tests whether the composite stress scoring system would have issued advance warnings before:
- 2013 Taper Tantrum (IDR -21%)
- 2015 China Devaluation + Commodity Shock (IDR -15%)
- 2018 EM Contagion Turkey/Argentina (IDR -10%)
- 2020 COVID Crash (IDR -15%)
- 2022 Fed Aggressive Tightening (IDR -9%)
- 2023 USD Surge / Higher-for-Longer (IDR -6%)

Outputs: hit rate, average lead time (days before crisis), false positive rate, per-crisis signal timeline.
Indicators: Yahoo Finance (FX/ETF/futures) + Indonesia 5Y CDS from WorldGovernmentBonds.com (Playwright, from Sep 2018).
Composite weights: FX 0.30, Commodity 0.25, Foreign Flow 0.15, Sovereign CDS 0.10, VIX 0.10, DXY 0.10.
No lookahead bias: z-scores computed using only data available at each point in time.
`.trim();

export const backtestEngine = new DynamicStructuredTool({
  name: 'backtest_engine',
  description: BACKTEST_DESCRIPTION,
  schema: z.object({
    startDate: z.string().optional().describe('Start date ISO YYYY-MM-DD (default: 2012-01-01)'),
    endDate: z.string().optional().describe('End date ISO YYYY-MM-DD (default: today)'),
    crisisIds: z.array(z.string()).optional().describe('Filter to specific crisis IDs (default: all 6)'),
  }),
  func: async ({ startDate, endDate, crisisIds }) => {
    const start = startDate ?? '2012-01-01';
    const end = endDate ?? new Date().toISOString().slice(0, 10);

    const crises = crisisIds && crisisIds.length > 0
      ? INDONESIA_CRISIS_CALENDAR.filter((c) => crisisIds.includes(c.id))
      : INDONESIA_CRISIS_CALENDAR;

    if (crises.length === 0) {
      return `No crises matched. Valid IDs: ${INDONESIA_CRISIS_CALENDAR.map((c) => c.id).join(', ')}`;
    }

    const historicalData = await loadAllHistoricalData(start, end);

    if (historicalData.size === 0) {
      return 'Failed to load historical data. Check network connection.';
    }

    // Union of all dates across all indicators
    const dateSet = new Set<string>();
    for (const bars of historicalData.values()) {
      for (const bar of bars) dateSet.add(bar.date);
    }
    const dates = [...dateSet].sort();

    const signals = computeSignals(historicalData, dates);

    const validations = crises.map((crisis) => validateCrisis(crisis, signals));

    const indicatorsBacktested = [
      ...BACKTEST_INDICATORS
        .filter((spec) => historicalData.has(spec.indicator))
        .map((spec) => spec.indicator),
      ...(historicalData.has('indonesia_cds_5y_bps') ? ['indonesia_cds_5y_bps (WGB)'] : []),
    ];

    const result = buildBacktestResult(validations, signals, { start, end }, indicatorsBacktested);

    return formatBacktestReport(result);
  },
});
