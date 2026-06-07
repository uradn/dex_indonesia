import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { upsertPoints, getLatestPoint, getLastN } from './time-series-db.js';
import { buildSnapshot, detectFlags, alertFromScore, alertLabel } from './scoring.js';
import { fetchUsdIdrHistory, fetchUsdIdrSpot, computeRealizedVol } from './sources/yahoo-macro.js';
import { fetchBiFxReserves, fetchSrbiOutstanding } from './sources/bi.js';
import { fetchBbgFxReserves, bloombergAvailable } from './sources/bloomberg.js';
import { fetchUsdIdrRdp, refinitivAvailable } from './sources/refinitiv.js';
import type { FxDefenseEngineOutput, ShadowRateData, IndicatorSnapshot, AlertLevel } from './types.js';

export const FX_DEFENSE_DESCRIPTION = `
MACRO INTELLIGENCE — FX Defense Engine (Module 3)

Tracks Indonesia's foreign exchange defense posture. Detects:
- Reserve depletion trajectory and burn rate
- IDR volatility clustering and depreciation acceleration
- BI intervention signals (SRBI issuance, reserve changes)
- Pseudo-stability (IDR stable on surface but reserves depleting underneath)
- Intervention sustainability

## When to Use

- "Is BI defending the rupiah?"
- "How sustainable is IDR stability?"
- "Are FX reserves falling?"
- "Show IDR stress indicators"
- "FX defense analysis Indonesia"
- Any time USDIDR moves >1.5% in a session or reserves data is released

## Output

Institutional hedge-fund style FX memo with:
- FX Fragility Score (0-100)
- Reserve Burn Rate (months remaining)
- USDIDR realized volatility (30d annualized)
- BI Intervention Proxy
- GREEN/YELLOW/ORANGE/RED alert
- Specific anomaly flags

## Data Sources

- USDIDR spot + history: Yahoo Finance (real-time, always available)
- FX Reserves: BI website (monthly) → Bloomberg if configured
- SRBI outstanding: BI website (monthly, proxy for sterilization pressure)
- Premium data: Bloomberg (BLOOMBERG_API_URL) or Refinitiv (REFINITIV_APP_KEY) if configured
`.trim();

export async function runFxDefenseEngine(forceRefresh = false): Promise<FxDefenseEngineOutput> {
  // 1. Fetch USDIDR history and persist
  const idrHistory = await fetchUsdIdrHistory(365);
  if (idrHistory.length > 0) await upsertPoints(idrHistory);

  // 2. Current USDIDR — prefer Refinitiv > Yahoo
  let spotPoint = refinitivAvailable() ? await fetchUsdIdrRdp() : null;
  spotPoint ??= await fetchUsdIdrSpot();
  if (spotPoint) await upsertPoints([spotPoint]);

  // 3. FX Reserves — prefer Bloomberg > BI website
  let reservePoint = bloombergAvailable() ? await fetchBbgFxReserves() : null;
  reservePoint ??= await fetchBiFxReserves();
  if (reservePoint) await upsertPoints([reservePoint]);

  // 4. SRBI outstanding
  const srbiPoint = await fetchSrbiOutstanding();
  if (srbiPoint) await upsertPoints([srbiPoint]);

  // Retrieve stored data
  const currentSpot = await getLatestPoint('usdidr_spot');
  const history = await getLastN('usdidr_spot', 252);   // ~1 year daily
  const spotHistory30 = history.slice(-31);

  const prevSpot = history.length > 1 ? history[history.length - 2] : null;
  const spot3MoAgo = history.length > 65 ? history[history.length - 66] : null;
  const spot12MoAgo = history.length > 253 ? history[history.length - 254] : null;

  const currentReserve = await getLatestPoint('bi_fx_reserves_bn');
  const prevReserve = (await getLastN('bi_fx_reserves_bn', 3)).slice(-2)[0] ?? null;

  const currentSrbi = await getLatestPoint('srbi_outstanding_trn_idr');
  const prevSrbi = (await getLastN('srbi_outstanding_trn_idr', 3)).slice(-2)[0] ?? null;

  // Realized volatility (30-day annualized)
  const prices = history.map((p) => p.value);
  const vol30d = computeRealizedVol(prices, 30);

  // Snapshots
  const spotSnapshot = currentSpot
    ? await buildSnapshot('usdidr_spot', currentSpot, prevSpot)
    : null;

  const volDataPoint = vol30d !== null && currentSpot
    ? {
        indicator: 'usdidr_vol_30d',
        category: 'fx' as const,
        date: currentSpot.date,
        value: vol30d,
        unit: '%_annualized',
        source: 'computed',
        fetchedAt: new Date().toISOString(),
      }
    : null;
  if (volDataPoint) await upsertPoints([volDataPoint]);
  const volLatest = await getLatestPoint('usdidr_vol_30d');
  const volPrev = (await getLastN('usdidr_vol_30d', 5)).slice(-2)[0] ?? null;
  const volSnapshot = volLatest ? await buildSnapshot('usdidr_vol_30d', volLatest, volPrev) : null;

  const reserveSnapshot = currentReserve
    ? await buildSnapshot('bi_fx_reserves_bn', currentReserve, prevReserve)
    : null;

  const srbiSnapshot = currentSrbi
    ? await buildSnapshot('srbi_outstanding_trn_idr', currentSrbi, prevSrbi)
    : null;

  // Reserve burn rate (months of reserve adequacy at current trajectory)
  let reserveBurnRate: number | null = null;
  if (currentReserve && prevReserve && prevReserve.value > 0) {
    const monthlyBurn = prevReserve.value - currentReserve.value;
    if (monthlyBurn > 0) {
      reserveBurnRate = currentReserve.value / monthlyBurn;
    }
  }

  // BI intervention proxy
  // If reserves falling while SRBI issuance rising → active sterilized intervention
  const reserveFalling = reserveSnapshot && reserveSnapshot.roc < -1;
  const srbiRising = srbiSnapshot && srbiSnapshot.roc > 5;
  const biInterventionProxy = reserveFalling && srbiRising
    ? 'active_sterilized'
    : reserveFalling
    ? 'active_direct'
    : 'passive_unknown';

  // SRBI sterilization capacity ratio
  // SRBI outstanding (IDR trn) / equivalent IDR value of FX reserves
  // >35% = elevated burden; >50% = BI balance sheet stretched, limited future sterilization room
  const reservesInIdrTrn = currentReserve && currentSpot
    ? (currentReserve.value * currentSpot.value) / 1_000  // bn_USD * IDR/USD / 1000 = trn IDR
    : null;
  const srbiSterilizationRatio = currentSrbi && reservesInIdrTrn && reservesInIdrTrn > 0
    ? currentSrbi.value / reservesInIdrTrn
    : null;

  // Pseudo-stability: IDR volatility low but reserves depleting fast
  const pseudoStabilityFlag =
    (volSnapshot?.current ?? 10) < 8 &&
    (reserveSnapshot?.roc ?? 0) < -3;

  // Depreciation metrics
  const dep3m = spot3MoAgo
    ? ((currentSpot?.value ?? 0) - spot3MoAgo.value) / spot3MoAgo.value * 100
    : null;
  const dep12m = spot12MoAgo
    ? ((currentSpot?.value ?? 0) - spot12MoAgo.value) / spot12MoAgo.value * 100
    : null;

  // Shadow rate + months-to-attack (R&R Ch.12 — Krugman 1979, Flood-Garber 1984)
  // 1st-gen crisis: peg collapses when reserves hit the GG floor (can't cover short-term ULN rollover)
  // OR when SRBI capacity exhausted (BI sterilization cost > profit ceiling)
  // "Attack" = the point when rational speculators front-run the inevitable peg collapse
  const [ulnTotalDb, ulnStDb] = await Promise.all([
    getLatestPoint('indonesia_external_debt_bn'),
    getLatestPoint('uln_shortterm_pct'),
  ]);
  const ulnTotal = ulnTotalDb?.value ?? null;
  const ulnStPct = ulnStDb?.value ?? null;
  const shortTermUlnBn = ulnTotal !== null && ulnStPct !== null
    ? parseFloat((ulnTotal * (ulnStPct / 100)).toFixed(1))
    : null;

  let monthsToGgBreach: number | null = null;
  if (currentReserve && reserveBurnRate !== null && reserveBurnRate > 0 && shortTermUlnBn !== null) {
    const monthlyBurn = currentReserve.value / reserveBurnRate;
    if (monthlyBurn > 0) {
      const bufferAboveFloor = currentReserve.value - shortTermUlnBn;
      monthsToGgBreach = bufferAboveFloor > 0
        ? parseFloat((bufferAboveFloor / monthlyBurn).toFixed(1))
        : 0;
    }
  }

  const SRBI_CEILING_TRN = 1_500; // IDR trn — above this BI interest cost > seigniorage revenue
  let monthsToSrbiCeiling: number | null = null;
  if (currentSrbi && srbiSnapshot && srbiSnapshot.roc > 0) {
    const monthlyGrowthTrn = currentSrbi.value * (srbiSnapshot.roc / 100);
    if (monthlyGrowthTrn > 0) {
      const headroom = SRBI_CEILING_TRN - currentSrbi.value;
      monthsToSrbiCeiling = headroom > 0
        ? parseFloat((headroom / monthlyGrowthTrn).toFixed(1))
        : 0;
    }
  }

  const monthsToAttack: number | null = monthsToGgBreach !== null && monthsToSrbiCeiling !== null
    ? parseFloat(Math.min(monthsToGgBreach, monthsToSrbiCeiling).toFixed(1))
    : monthsToGgBreach ?? monthsToSrbiCeiling ?? null;

  let impliedUsdidr: number | null = null;
  let depreciationAtAttack: number | null = null;
  if (currentSpot && monthsToAttack !== null && dep3m !== null && dep3m > 0) {
    const monthlyDep = dep3m / 3;
    const totalDep = monthlyDep * monthsToAttack;
    impliedUsdidr = Math.round(currentSpot.value * (1 + totalDep / 100));
    depreciationAtAttack = parseFloat(totalDep.toFixed(1));
  }

  const shadowRate: ShadowRateData | null = (monthsToAttack !== null || impliedUsdidr !== null)
    ? { impliedUsdidr, monthsToGgBreach, monthsToSrbiCeiling, monthsToAttack, depreciationAtAttack }
    : null;

  // Composite score — FX-specific weighted scoring.
  // Spot dominates (60%): continuous z-score so 18k vs 19k vs 21k all score differently.
  // Vol (25%) + reserves (15%) add confirmation signal without diluting extreme spot moves.
  const validSnapshots = [spotSnapshot, volSnapshot, reserveSnapshot].filter(
    (s): s is IndicatorSnapshot => s !== null,
  );

  function zToRawScore(s: IndicatorSnapshot): number {
    const z = Math.abs(s.zScore30d ?? s.zScore90d ?? 0);
    // Continuous: z=1.5→37, z=2.5→62, z=4.0→100
    return Math.min(100, Math.round(z * 25));
  }

  const spotScore     = spotSnapshot    ? zToRawScore(spotSnapshot)    : 0;
  const volScore      = volSnapshot     ? zToRawScore(volSnapshot)     : 0;
  const reserveScore  = reserveSnapshot ? zToRawScore(reserveSnapshot) : 0;

  const score = Math.round(spotScore * 0.60 + volScore * 0.25 + reserveScore * 0.15);
  const alertLevel = alertFromScore(score);
  const flags = detectFlags(validSnapshots);

  if (pseudoStabilityFlag) flags.push('PSEUDO-STABILITY: Low vol but reserves depleting — surface calm may be deceptive');
  if (biInterventionProxy === 'active_sterilized') flags.push('BI active sterilized intervention detected (reserves↓ + SRBI↑)');
  if (reserveBurnRate !== null && reserveBurnRate < 6) flags.push(`Reserve runway <6 months at current burn rate: ${reserveBurnRate.toFixed(1)} months`);

  // Cross-feed from ULN Engine (Module 13): unhedged corporate USD exposure
  const hedgingPoint = await getLatestPoint('uln_hedging_compliance_pct');
  const hedgingCompliance = hedgingPoint?.value ?? null;
  if (hedgingCompliance !== null && hedgingCompliance < 70) {
    flags.push(`UNHEDGED EXPOSURE WARNING (ULN M13): corporate hedging compliance ${hedgingCompliance.toFixed(0)}% — forced USD buying risk if IDR weakens (1997 transmission mechanism)`);
  } else if (hedgingCompliance !== null && hedgingCompliance < 85) {
    flags.push(`Hedging sub-optimal (ULN M13): ${hedgingCompliance.toFixed(0)}% compliance — IDR shock amplification risk`);
  }
  const ggPoint = await getLatestPoint('greenspan_guidotti');
  const ggRatio = ggPoint?.value ?? null;
  if (ggRatio !== null && ggRatio < 1.5) {
    flags.push(`GG RATIO (ULN M13): ${ggRatio.toFixed(2)} — FX reserve buffer vs short-term ULN thinning${ggRatio < 1.0 ? ' — CRITICAL BREACH' : ''}`);
  }
  if (srbiSterilizationRatio !== null && srbiSterilizationRatio > 0.50) flags.push(`SRBI sterilization burden critical: ${(srbiSterilizationRatio * 100).toFixed(1)}% of FX reserves — BI balance sheet stretched`);
  else if (srbiSterilizationRatio !== null && srbiSterilizationRatio > 0.35) flags.push(`SRBI sterilization burden elevated: ${(srbiSterilizationRatio * 100).toFixed(1)}% of FX reserves — watch for capacity constraint`);

  // Shadow rate flags (R&R 1st-gen crisis)
  if (shadowRate?.monthsToAttack !== null && shadowRate?.monthsToAttack !== undefined) {
    if (shadowRate.monthsToAttack < 6) {
      flags.push(`SHADOW RATE CRITICAL: defense capacity exhaustion in ${shadowRate.monthsToAttack} months — implied USDIDR ${shadowRate.impliedUsdidr?.toLocaleString() ?? 'n/a'} at collapse point [R&R 1st-gen crisis Ch.12]`);
    } else if (shadowRate.monthsToAttack < 12) {
      flags.push(`Shadow rate watch: ${shadowRate.monthsToAttack} months to defense capacity floor — implied USDIDR ${shadowRate.impliedUsdidr?.toLocaleString() ?? 'n/a'} [R&R Ch.12]`);
    }
  }

  const interventionSustainability: AlertLevel =
    reserveBurnRate !== null
      ? reserveBurnRate < 3 ? 'red' : reserveBurnRate < 6 ? 'orange' : reserveBurnRate < 12 ? 'yellow' : 'green'
      : 'green';

  const narrative = buildNarrative({
    spotSnapshot,
    volSnapshot,
    reserveSnapshot,
    dep3m,
    dep12m,
    reserveBurnRate,
    biInterventionProxy,
    pseudoStabilityFlag,
    alertLevel,
  });

  return {
    scoreCard: {
      module: 'fx_defense',
      scoreDate: new Date().toISOString().slice(0, 10),
      score,
      alertLevel,
      indicators: validSnapshots,
      narrative,
      flags,
    },
    usdIdr: spotSnapshot ?? placeholderSnapshot('usdidr_spot', 'IDR/USD'),
    usdIdrVol30d: volSnapshot ?? placeholderSnapshot('usdidr_vol_30d', '%_annualized'),
    fxReserves: reserveSnapshot ?? placeholderSnapshot('bi_fx_reserves_bn', 'bn_USD'),
    reserveBurnRate,
    srbiOutstanding: srbiSnapshot,
    srbiSterilizationRatio,
    biInterventionProxy,
    pseudoStabilityFlag,
    interventionSustainability,
    shadowRate,
  };
}

function buildNarrative(ctx: {
  spotSnapshot: IndicatorSnapshot | null;
  volSnapshot: IndicatorSnapshot | null;
  reserveSnapshot: IndicatorSnapshot | null;
  dep3m: number | null;
  dep12m: number | null;
  reserveBurnRate: number | null;
  biInterventionProxy: string;
  pseudoStabilityFlag: boolean;
  alertLevel: AlertLevel;
}): string {
  const parts: string[] = [];
  if (ctx.spotSnapshot) {
    const dir = ctx.spotSnapshot.roc >= 0 ? 'depreciated' : 'appreciated';
    parts.push(
      `IDR ${dir} ${Math.abs(ctx.spotSnapshot.roc).toFixed(1)}% MoM to ${ctx.spotSnapshot.current.toLocaleString()} IDR/USD.`,
    );
  }
  if (ctx.dep3m !== null) {
    parts.push(`3M depreciation: ${ctx.dep3m >= 0 ? '+' : ''}${ctx.dep3m.toFixed(1)}%.`);
  }
  if (ctx.reserveSnapshot) {
    parts.push(
      `FX reserves ${ctx.reserveSnapshot.current.toFixed(1)} bn USD (${ctx.reserveSnapshot.roc >= 0 ? '+' : ''}${ctx.reserveSnapshot.roc.toFixed(1)}% MoM).`,
    );
  }
  if (ctx.reserveBurnRate !== null) {
    parts.push(`Reserve runway: ${ctx.reserveBurnRate.toFixed(1)} months at current pace.`);
  }
  if (ctx.pseudoStabilityFlag) {
    parts.push('Warning: pseudo-stability regime — surface calm obscures reserve depletion.');
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

function formatOutput(output: FxDefenseEngineOutput): string {
  const { scoreCard, reserveBurnRate, biInterventionProxy, pseudoStabilityFlag, interventionSustainability, srbiSterilizationRatio } = output;
  const srbiRatioStr = srbiSterilizationRatio !== null
    ? `${(srbiSterilizationRatio * 100).toFixed(1)}% ${srbiSterilizationRatio > 0.50 ? '⚠️ CRITICAL' : srbiSterilizationRatio > 0.35 ? '— elevated' : '— normal'}`
    : 'n/a';
  return [
    `# FX Defense Engine — Indonesia`,
    `**Date:** ${scoreCard.scoreDate}`,
    `**Alert:** ${alertLabel(scoreCard.alertLevel)} | **Score:** ${scoreCard.score}/100`,
    ``,
    `## Summary`,
    scoreCard.narrative,
    ``,
    `## Indicators`,
    `| Indicator | Current | MoM Δ | 30d Z-Score | Alert |`,
    `|-----------|---------|--------|-------------|-------|`,
    ...scoreCard.indicators.map((s) =>
      `| ${s.indicator} | ${s.current.toFixed(2)} ${s.unit} | ${s.roc >= 0 ? '+' : ''}${s.roc.toFixed(2)}% | ${s.zScore30d?.toFixed(2) ?? 'n/a'} | ${s.alertLevel.toUpperCase()} |`,
    ),
    ``,
    `## FX Defense Metrics`,
    `- **BI Intervention Proxy:** ${biInterventionProxy}`,
    `- **Intervention Sustainability:** ${interventionSustainability.toUpperCase()}`,
    `- **Reserve Burn Rate:** ${reserveBurnRate !== null ? `${reserveBurnRate.toFixed(1)} months` : 'n/a'}`,
    `- **SRBI/Reserve Ratio:** ${srbiRatioStr}`,
    `- **Pseudo-Stability Flag:** ${pseudoStabilityFlag ? '⚠️ YES — covert reserve depletion detected' : 'No'}`,
    ``,
    scoreCard.flags.length > 0 ? `## Flags\n${scoreCard.flags.map((f) => `- ⚠️ ${f}`).join('\n')}` : '',
    ``,
    output.shadowRate !== null ? [
      `## Shadow Rate Analysis (R&R Ch.12 — Krugman 1979)`,
      `_1st-gen crisis: when reserves hit GG floor (reserves < short-term ULN), speculative attack becomes rational._`,
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Months to GG floor breach | ${output.shadowRate.monthsToGgBreach !== null ? output.shadowRate.monthsToGgBreach.toFixed(1) + ' mo' : 'n/a (run uln_engine first)'} |`,
      `| Months to SRBI ceiling (1,500T) | ${output.shadowRate.monthsToSrbiCeiling !== null ? output.shadowRate.monthsToSrbiCeiling.toFixed(1) + ' mo' : 'n/a (SRBI not growing)'} |`,
      `| **Months to attack (binding)** | **${output.shadowRate.monthsToAttack !== null ? output.shadowRate.monthsToAttack.toFixed(1) + ' months' : 'n/a'}** |`,
      `| Implied USDIDR at collapse | ${output.shadowRate.impliedUsdidr !== null ? output.shadowRate.impliedUsdidr.toLocaleString() : 'n/a (requires depreciation trend)'} |`,
      `| IDR depreciation at attack | ${output.shadowRate.depreciationAtAttack !== null ? '+' + output.shadowRate.depreciationAtAttack.toFixed(1) + '%' : 'n/a'} |`,
      ``,
    ].join('\n') : '',
    `## Data Quality`,
    `- USDIDR: Yahoo Finance (real-time)`,
    `- Reserves: ${bloombergAvailable() ? 'Bloomberg' : 'BI website (monthly, ~4wk lag)'}`,
    `- SRBI: BI website (monthly)`,
    bloombergAvailable() ? '- Bloomberg: CONNECTED' : '- Bloomberg: not configured (set BLOOMBERG_API_URL + BLOOMBERG_API_KEY)',
    refinitivAvailable() ? '- Refinitiv: CONNECTED' : '- Refinitiv: not configured (set REFINITIV_APP_KEY + credentials)',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

export const fxDefenseEngine = new DynamicStructuredTool({
  name: 'fx_defense_engine',
  description:
    'FX Defense Engine: tracks IDR stress, FX reserves trajectory, BI intervention signals, and reserve sustainability. Detects pseudo-stability (stable IDR with depleting reserves). Outputs institutional-grade FX stress memo.',
  schema: z.object({
    query: z.string().describe('Analysis request, e.g. "Show FX defense status" or "Is BI intervening?"'),
    forceRefresh: z.boolean().optional().describe('Force re-fetch all data even if cached. Default false.'),
  }),
  func: async (input) => {
    try {
      const output = await runFxDefenseEngine(input.forceRefresh);
      return formatToolResult(
        { analysis: formatOutput(output), raw: output },
        ['https://www.bi.go.id', 'https://finance.yahoo.com'],
      );
    } catch (error) {
      return formatToolResult({
        error: error instanceof Error ? error.message : String(error),
        hint: 'Check network connectivity and env vars: BLOOMBERG_API_URL, REFINITIV_APP_KEY',
      });
    }
  },
});
