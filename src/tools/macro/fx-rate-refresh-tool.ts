import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { upsertPoints, getLatestUsdIdr } from './time-series-db.js';
import { fetchUsdIdrSpot, fetchAseanFxSpots } from './sources/yahoo-macro.js';
import { fetchBiOfficialRate } from './sources/bi.js';

export const FX_RATE_REFRESH_DESCRIPTION = `
MACRO UTILITY — FX Rate Refresh

Fetches and persists the latest IDR/USD and ASEAN FX spot rates into the macro time-series DB.
Lightweight: spot-only, no history pull, no engine scoring.

## When to Use

- Before any analysis that quotes IDR/USD thresholds (e.g. stock analysis, macro commentary)
- Silent background refresh — always returns DEXTER_OK safe to suppress
- Called by daily cron at 08:00 WIB to keep DB fresh

## Output

- Current USDIDR rate (Yahoo Finance + BI official cross-check)
- ASEAN FX spots: MYR, SGD, THB, PHP
- DB write confirmation + staleness of prior stored rate
`.trim();

async function runFxRateRefresh(): Promise<{
  usdidr: number | null;
  usdidrBi: number | null;
  aseanFx: Record<string, number>;
  storedDate: string | null;
  priorStaleDays: number | null;
}> {
  const prior = await getLatestUsdIdr();

  const [spot, biRate, aseanFx] = await Promise.all([
    fetchUsdIdrSpot(),
    fetchBiOfficialRate(),
    fetchAseanFxSpots(),
  ]);

  const toStore = [...(spot ? [spot] : []), ...(biRate ? [biRate] : []), ...aseanFx];
  if (toStore.length > 0) await upsertPoints(toStore);

  const aseanMap: Record<string, number> = {};
  for (const p of aseanFx) {
    aseanMap[p.indicator] = p.value;
  }

  return {
    usdidr: spot?.value ?? null,
    usdidrBi: biRate?.value ?? null,
    aseanFx: aseanMap,
    storedDate: spot?.date ?? null,
    priorStaleDays: prior?.staleDays ?? null,
  };
}

export const fxRateRefreshTool = new DynamicStructuredTool({
  name: 'fx_rate_refresh',
  description:
    'Fetch and persist latest IDR/USD and ASEAN FX spot rates into macro DB. Call before any analysis quoting IDR/USD thresholds. Lightweight — spot only, no scoring.',
  schema: z.object({}),
  func: async () => {
    try {
      const result = await runFxRateRefresh();
      const lines = [
        `USDIDR: ${result.usdidr?.toLocaleString('id-ID') ?? 'unavailable'} (Yahoo)`,
        result.usdidrBi ? `USDIDR BI official: ${result.usdidrBi.toLocaleString('id-ID')}` : null,
        Object.keys(result.aseanFx).length > 0
          ? `ASEAN FX stored: ${Object.entries(result.aseanFx).map(([k, v]) => `${k}=${v.toFixed(4)}`).join(', ')}`
          : null,
        result.priorStaleDays !== null
          ? `Prior DB rate was ${result.priorStaleDays}d old — refreshed`
          : 'No prior rate in DB — first write',
      ].filter(Boolean);
      return formatToolResult({ summary: lines.join('\n'), raw: result });
    } catch (error) {
      return formatToolResult({ error: error instanceof Error ? error.message : String(error) });
    }
  },
});
