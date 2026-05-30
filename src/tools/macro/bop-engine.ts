import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { upsertPoints, getLatestPoint, getLastN } from './time-series-db.js';
import { buildSnapshot, compositeScore, detectFlags, alertFromScore, alertLabel, rateOfChange } from './scoring.js';
import { fetchBiFxReserves } from './sources/bi.js';
import { fetchTradeBalance, fetchImports, fetchExports, bpsAvailable } from './sources/bps.js';
import { fetchTradeBalanceTe, fetchExportsTe, fetchImportsTe } from './sources/sovereign-scraper.js';
import { fetchCurrentAccount, fetchFxReservesMonths, fetchCurrentAccountBn } from './sources/imf.js';
import { fetchBbgFxReserves, bloombergAvailable } from './sources/bloomberg.js';
import type { BoPEngineOutput, IndicatorSnapshot } from './types.js';

export const BOP_DESCRIPTION = `
MACRO INTELLIGENCE — Balance of Payments Engine (Module 1)

Tracks Indonesia's BoP position and external sector vulnerability. Detects:
- Trade balance deterioration and import surge
- Current account deficit widening
- FX reserve erosion relative to import cover
- External debt rollover pressure
- Synthetic CAD risk (trade surplus but falling reserves = hidden capital outflow)

## When to Use

- "What is Indonesia's trade balance?"
- "Is the current account deteriorating?"
- "Show BoP stress indicators"
- "Indonesia external vulnerability check"
- Any time monthly BPS trade data or BI reserves data is released

## Output

- BoP Stress Score (0-100)
- FX Fragility Score (0-100)
- External Funding Dependency ratio
- Synthetic CAD risk flag
- GREEN/YELLOW/ORANGE/RED alert level

## Data Sources

- Trade balance/exports/imports: Trading Economics scraper (Playwright, free, monthly current)
- Current account: IMF Data API (annual/quarterly, free, ~1 quarter lag)
- FX reserves: BI website (monthly) → Bloomberg if configured
`.trim();

export async function runBoPEngine(): Promise<BoPEngineOutput> {
  // 1. Fetch trade data — BPS (Playwright, bypasses Cloudflare) → TE scrape fallback
  const [tradeSeries, importSeries, exportSeries] = await Promise.all([
    fetchTradeBalance(24),
    fetchImports(24),
    fetchExports(24),
  ]);
  if (tradeSeries.length > 0) await upsertPoints(tradeSeries);
  if (importSeries.length > 0) await upsertPoints(importSeries);
  if (exportSeries.length > 0) await upsertPoints(exportSeries);

  // TE Playwright fallback: seed current month if BPS returned nothing
  if (tradeSeries.length === 0) {
    const [tbTe, expTe, impTe] = await Promise.allSettled([
      fetchTradeBalanceTe(),
      fetchExportsTe(),
      fetchImportsTe(),
    ]);
    const tePoints = [tbTe, expTe, impTe]
      .filter((r): r is PromiseFulfilledResult<NonNullable<Awaited<ReturnType<typeof fetchTradeBalanceTe>>>> =>
        r.status === 'fulfilled' && r.value !== null)
      .map((r) => r.value);
    if (tePoints.length > 0) await upsertPoints(tePoints);
  }

  // 2. FX reserves
  const reservePoint = bloombergAvailable()
    ? await fetchBbgFxReserves()
    : await fetchBiFxReserves();
  if (reservePoint) await upsertPoints([reservePoint]);

  // 3. IMF current account data
  const [caData, caMonths, caBn] = await Promise.all([
    fetchCurrentAccount(),
    fetchFxReservesMonths(),
    fetchCurrentAccountBn(),
  ]);
  if (caData.length > 0) await upsertPoints(caData);
  if (caMonths.length > 0) await upsertPoints(caMonths);
  if (caBn.length > 0) await upsertPoints(caBn);

  // Retrieve stored latest values
  const currentTrade = await getLatestPoint('trade_balance_bn');
  const tradeLast12 = await getLastN('trade_balance_bn', 12);
  const prevTrade = tradeLast12.length > 1 ? tradeLast12[tradeLast12.length - 2] : null;

  const currentImports = await getLatestPoint('imports_bn');
  const importLast12 = await getLastN('imports_bn', 13);
  const importYearAgo = importLast12.length >= 13 ? importLast12[0] : null;

  const currentReserve = await getLatestPoint('bi_fx_reserves_bn');
  const reserveLast6 = await getLastN('bi_fx_reserves_bn', 6);
  const prevReserve = reserveLast6.length > 1 ? reserveLast6[reserveLast6.length - 2] : null;

  const currentCa = await getLatestPoint('current_account_pct_gdp');
  const prevCa = (await getLastN('current_account_pct_gdp', 3)).slice(-2)[0] ?? null;

  const currentCaBn = await getLatestPoint('current_account_bn');

  // Snapshots
  const tradeSnapshot = currentTrade
    ? await buildSnapshot('trade_balance_bn', currentTrade, prevTrade)
    : null;

  // Import YoY growth
  const importGrowthValue = currentImports && importYearAgo
    ? rateOfChange(currentImports.value, importYearAgo.value)
    : 0;
  const importGrowthPoint = currentImports
    ? {
        indicator: 'import_growth_yoy',
        category: 'bop' as const,
        date: currentImports.date,
        value: importGrowthValue,
        unit: '%_yoy',
        source: currentImports.source,
        fetchedAt: new Date().toISOString(),
      }
    : null;
  if (importGrowthPoint) await upsertPoints([importGrowthPoint]);
  const importGrowthLatest = await getLatestPoint('import_growth_yoy');
  const importGrowthPrev = (await getLastN('import_growth_yoy', 3)).slice(-2)[0] ?? null;
  const importGrowthSnapshot = importGrowthLatest
    ? await buildSnapshot('import_growth_yoy', importGrowthLatest, importGrowthPrev)
    : null;

  const reserveSnapshot = currentReserve
    ? await buildSnapshot('bi_fx_reserves_bn', currentReserve, prevReserve)
    : null;

  const caSnapshot = currentCa
    ? await buildSnapshot('current_account_pct_gdp', currentCa, prevCa)
    : null;

  // Synthetic CAD detection:
  // Trade surplus but reserves falling = capital account outflow masking deficit
  const tradePositive = (currentTrade?.value ?? 0) > 0;
  const reservesFalling = (reserveSnapshot?.roc ?? 0) < -2;
  const syntheticCadRisk = tradePositive && reservesFalling;

  // FX Fragility Score: weighted combination
  // Low reserves → high fragility; High import growth → high fragility
  const reserveMonths = (await getLatestPoint('fx_reserves_months_import'))?.value ?? null;
  const reserveScore = reserveMonths !== null
    ? reserveMonths < 3 ? 100 : reserveMonths < 6 ? 70 : reserveMonths < 9 ? 40 : 10
    : 50;

  // BoP Stress Score: composite of all indicators
  const validSnapshots = [tradeSnapshot, importGrowthSnapshot, reserveSnapshot, caSnapshot].filter(
    (s): s is IndicatorSnapshot => s !== null,
  );
  const bopStressScore = compositeScore(validSnapshots);
  const fxFragilityScore = Math.round((bopStressScore + reserveScore) / 2);

  // External Funding Dependency: prefer Greenspan-Guidotti ratio written by uln-engine.
  // Fallback: CA deficit / reserves proxy (used before Module 13 populates DB).
  const ggPoint = await getLatestPoint('greenspan_guidotti');
  const greenspanGuidotti = ggPoint?.value ?? null;
  const externalFundingDependency =
    currentCaBn && currentReserve && currentReserve.value > 0
      ? Math.abs(Math.min(currentCaBn.value, 0)) / currentReserve.value
      : 0;

  const alertLevel = alertFromScore(bopStressScore);
  const flags = detectFlags(validSnapshots);
  if (syntheticCadRisk) {
    flags.push('SYNTHETIC CAD RISK: Trade surplus but reserves falling — capital outflow suspected');
  }
  if (importGrowthValue > 20) {
    flags.push(`Import surge ${importGrowthValue.toFixed(1)}% YoY — current account risk rising`);
  }
  if (reserveMonths !== null && reserveMonths < 6) {
    flags.push(`FX reserve cover critically low: ${reserveMonths.toFixed(1)} months of imports`);
  }

  const narrative = buildNarrative({
    tradeSnapshot, importGrowthSnapshot, reserveSnapshot, caSnapshot,
    reserveMonths, syntheticCadRisk, bopStressScore, alertLevel,
  });

  return {
    scoreCard: {
      module: 'bop',
      scoreDate: new Date().toISOString().slice(0, 10),
      score: bopStressScore,
      alertLevel,
      indicators: validSnapshots,
      narrative,
      flags,
    },
    tradeBalance: tradeSnapshot ?? placeholderSnapshot('trade_balance_bn', 'bn_USD'),
    fxReserves: reserveSnapshot ?? placeholderSnapshot('bi_fx_reserves_bn', 'bn_USD'),
    importGrowth: importGrowthSnapshot ?? placeholderSnapshot('import_growth_yoy', '%_yoy'),
    currentAccount: caSnapshot,
    externalDebt: null,
    bopStressScore,
    fxFragilityScore,
    externalFundingDependency,
    greenspanGuidotti,
    syntheticCadRisk,
  };
}

function buildNarrative(ctx: {
  tradeSnapshot: IndicatorSnapshot | null;
  importGrowthSnapshot: IndicatorSnapshot | null;
  reserveSnapshot: IndicatorSnapshot | null;
  caSnapshot: IndicatorSnapshot | null;
  reserveMonths: number | null;
  syntheticCadRisk: boolean;
  bopStressScore: number;
  alertLevel: import('./types.js').AlertLevel;
}): string {
  const parts: string[] = [];
  if (ctx.tradeSnapshot) {
    const dir = ctx.tradeSnapshot.current >= 0 ? 'surplus' : 'deficit';
    parts.push(
      `Trade ${dir} ${Math.abs(ctx.tradeSnapshot.current).toFixed(2)} bn USD (MoM: ${ctx.tradeSnapshot.roc >= 0 ? '+' : ''}${ctx.tradeSnapshot.roc.toFixed(1)}%).`,
    );
  }
  if (ctx.importGrowthSnapshot && ctx.importGrowthSnapshot.current !== 0) {
    parts.push(`Import growth: ${ctx.importGrowthSnapshot.current >= 0 ? '+' : ''}${ctx.importGrowthSnapshot.current.toFixed(1)}% YoY.`);
  }
  if (ctx.reserveSnapshot) {
    parts.push(
      `Reserves: ${ctx.reserveSnapshot.current.toFixed(1)} bn USD (${ctx.reserveSnapshot.roc >= 0 ? '+' : ''}${ctx.reserveSnapshot.roc.toFixed(1)}% MoM).`,
    );
  }
  if (ctx.reserveMonths !== null) {
    parts.push(`Reserve cover: ${ctx.reserveMonths.toFixed(1)} months imports.`);
  }
  if (ctx.caSnapshot) {
    parts.push(`CA: ${ctx.caSnapshot.current.toFixed(2)}% GDP (IMF est.).`);
  }
  if (ctx.syntheticCadRisk) {
    parts.push('Synthetic CAD risk: surplus on surface but reserves declining — capital outflow likely.');
  }
  return parts.join(' ') || 'Insufficient data for narrative.';
}

function placeholderSnapshot(indicator: string, unit: string): IndicatorSnapshot {
  return {
    indicator,
    current: 0,
    prev: 0,
    unit,
    source: 'unavailable',
    date: new Date().toISOString().slice(0, 10),
    roc: 0,
    alertLevel: 'green',
  };
}

function formatOutput(output: BoPEngineOutput): string {
  const { scoreCard, bopStressScore, fxFragilityScore, externalFundingDependency, greenspanGuidotti, syntheticCadRisk } = output;
  return [
    `# Balance of Payments Engine — Indonesia`,
    `**Date:** ${scoreCard.scoreDate}`,
    `**Alert:** ${alertLabel(scoreCard.alertLevel)} | **BoP Stress Score:** ${bopStressScore}/100 | **FX Fragility Score:** ${fxFragilityScore}/100`,
    ``,
    `## Summary`,
    scoreCard.narrative,
    ``,
    `## Indicators`,
    `| Indicator | Current | MoM Δ | YoY Z-Score | Alert |`,
    `|-----------|---------|--------|-------------|-------|`,
    ...scoreCard.indicators.map((s) =>
      `| ${s.indicator} | ${s.current.toFixed(3)} ${s.unit} | ${s.roc >= 0 ? '+' : ''}${s.roc.toFixed(2)}% | ${s.zScore30d?.toFixed(2) ?? 'n/a'} | ${s.alertLevel.toUpperCase()} |`,
    ),
    ``,
    `## BoP Risk Metrics`,
    `- **BoP Stress Score:** ${bopStressScore}/100`,
    `- **FX Fragility Score:** ${fxFragilityScore}/100`,
    `- **External Funding Dependency:** ${(externalFundingDependency * 100).toFixed(1)}%`,
    greenspanGuidotti !== null ? `- **Greenspan-Guidotti Ratio:** ${greenspanGuidotti.toFixed(2)} (from ULN Engine — FX reserves / short-term ULN; <1.0 = CRITICAL)` : '',
    `- **Synthetic CAD Risk:** ${syntheticCadRisk ? '⚠️ YES' : 'No'}`,
    ``,
    scoreCard.flags.length > 0 ? `## Flags\n${scoreCard.flags.map((f) => `- ⚠️ ${f}`).join('\n')}` : '',
    ``,
    `## Data Quality`,
    '- Trade data: Trading Economics Playwright scrape (BPS var IDs 200/201/202 confirmed unavailable in domain 0000)',
    `- Current account: IMF Data API (annual, ~1-2Q lag)`,
    `- Reserves: ${bloombergAvailable() ? 'Bloomberg' : 'BI website (monthly, ~4wk lag)'}`,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

export const bopEngine = new DynamicStructuredTool({
  name: 'bop_engine',
  description:
    'Balance of Payments Engine: tracks Indonesia trade balance, current account, FX reserves, import growth, and external funding dependency. Detects synthetic CAD risk (trade surplus masking capital outflow). Outputs institutional BoP stress memo.',
  schema: z.object({
    query: z.string().describe('Analysis request, e.g. "Show BoP status" or "Is current account deteriorating?"'),
  }),
  func: async (input) => {
    try {
      const output = await runBoPEngine();
      return formatToolResult(
        { analysis: formatOutput(output), raw: output },
        ['https://webapi.bps.go.id', 'https://www.bi.go.id', 'https://www.imf.org'],
      );
    } catch (error) {
      return formatToolResult({
        error: error instanceof Error ? error.message : String(error),
        hint: 'Check BPS_API_KEY, BLOOMBERG_API_URL env vars. IMF API is free and key-free.',
      });
    }
  },
});
