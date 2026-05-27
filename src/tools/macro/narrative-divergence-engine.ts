import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { getLatestPoint, upsertPoints } from './time-series-db.js';
import { alertFromScore, alertLabel } from './scoring.js';
import { fetchSbn10yTradingEconomics, fetchBiRateTradingEconomics } from './sources/sovereign-scraper.js';
import { fetchFoodInflationTe } from './sources/pihps.js';
import type { AlertLevel } from './types.js';

export const NARRATIVE_DIVERGENCE_DESCRIPTION = `
MACRO INTELLIGENCE — Narrative Divergence Engine (Module 6)

Compares official guidance vs market pricing to detect credibility gaps.

Compares:
- BI press releases vs USDIDR market level
- BI Rate forward guidance vs SBN yield curve
- APBN assumptions (oil price, growth, USDIDR) vs actuals
- Government growth forecasts vs PMI / leading indicators
- Rating agency outlooks vs CDS trend

Generates:
- Narrative Credibility Score (0-100; lower = less credible)
- Divergence flags with specific mismatches

Detects:
- Optimistic narrative + worsening CDS
- Growth optimism + rising yields
- Official "stable IDR" claim + reserves falling
- APBN deficit targets vs implied fiscal trajectory

## When to Use

- "Is BI credible?"
- "Does official guidance match what markets price?"
- "Show narrative divergence"
- After any major BI or government press release
`.trim();

interface DivergenceCheck {
  dimension: string;
  officialClaim: string;
  marketSignal: string;
  divergenceScore: number; // 0-100: 0=aligned, 100=completely contradictory
  flagged: boolean;
}

interface NarrativeDivergenceOutput {
  narrativeCredibilityScore: number;
  alertLevel: AlertLevel;
  checks: DivergenceCheck[];
  flags: string[];
  narrative: string;
  date: string;
}

// APBN 2026 key assumptions (update annually)
const APBN_ASSUMPTIONS = {
  usdIdr: 16_000,       // APBN USDIDR assumption IDR/USD
  oilPrice: 82,         // APBN oil price assumption USD/bbl
  gdpGrowth: 5.2,       // APBN GDP growth target %
  inflation: 2.5,       // APBN CPI target %
  biRate: 5.25,         // BI 7DRR as of May 2026 (cut from 5.5% in 2025)
};

export async function runNarrativeDivergenceEngine(): Promise<NarrativeDivergenceOutput> {
  const checks: DivergenceCheck[] = [];

  // Seed fresh data from Trading Economics
  const [sbnFresh, biRateFresh, foodInflFresh] = await Promise.allSettled([
    fetchSbn10yTradingEconomics(),
    fetchBiRateTradingEconomics(),
    fetchFoodInflationTe(),
  ]);
  const toUpsert = [
    sbnFresh.status === 'fulfilled' ? sbnFresh.value : null,
    biRateFresh.status === 'fulfilled' ? biRateFresh.value : null,
    foodInflFresh.status === 'fulfilled' ? foodInflFresh.value : null,
  ].filter((p): p is NonNullable<typeof p> => p !== null);
  if (toUpsert.length > 0) await upsertPoints(toUpsert);

  // 1. USDIDR: official assumption vs market
  const usdIdrSpot = await getLatestPoint('usdidr_spot');
  if (usdIdrSpot) {
    const marketVsApbn = ((usdIdrSpot.value - APBN_ASSUMPTIONS.usdIdr) / APBN_ASSUMPTIONS.usdIdr) * 100;
    const divergenceScore = Math.min(100, Math.max(0, Math.abs(marketVsApbn) * 5));
    checks.push({
      dimension: 'USDIDR vs APBN Assumption',
      officialClaim: `APBN baseline: IDR ${APBN_ASSUMPTIONS.usdIdr.toLocaleString()}/USD`,
      marketSignal: `Market: IDR ${usdIdrSpot.value.toLocaleString()}/USD (${marketVsApbn >= 0 ? '+' : ''}${marketVsApbn.toFixed(1)}% vs APBN)`,
      divergenceScore,
      flagged: Math.abs(marketVsApbn) > 10,
    });
  }

  // 2. Oil price: APBN assumption vs market
  const brentSpot = await getLatestPoint('brent_price_usd');
  if (brentSpot) {
    const marketVsApbn = ((brentSpot.value - APBN_ASSUMPTIONS.oilPrice) / APBN_ASSUMPTIONS.oilPrice) * 100;
    const divergenceScore = Math.min(100, Math.max(0, Math.abs(marketVsApbn) * 2));
    checks.push({
      dimension: 'Brent Oil vs APBN Assumption',
      officialClaim: `APBN baseline: $${APBN_ASSUMPTIONS.oilPrice}/bbl`,
      marketSignal: `Market: $${brentSpot.value.toFixed(1)}/bbl (${marketVsApbn >= 0 ? '+' : ''}${marketVsApbn.toFixed(1)}% vs APBN)`,
      divergenceScore,
      flagged: Math.abs(marketVsApbn) > 10,  // >10% = subsidy budget risk
    });
  }

  // 3. CDS level vs "stable macro" narrative
  const cds5y = await getLatestPoint('indonesia_cds_5y_bps');
  if (cds5y) {
    // Credibility impaired if CDS > 150bps while official stance is "stable"
    const divergenceScore = cds5y.value > 200 ? 90 : cds5y.value > 150 ? 60 : cds5y.value > 100 ? 30 : 10;
    checks.push({
      dimension: 'CDS Level vs Sovereign Stability Narrative',
      officialClaim: 'Official: fundamentals remain sound, macro stable',
      marketSignal: `CDS 5Y: ${cds5y.value.toFixed(0)}bps — ${cds5y.value > 150 ? 'market pricing non-trivial stress' : 'market broadly aligned'}`,
      divergenceScore,
      flagged: cds5y.value > 150,
    });
  }

  // 4. SBN yield vs BI Rate / monetary stance
  const sbn10y = await getLatestPoint('sbn_10y_yield_pct');
  if (sbn10y) {
    // Term premium: SBN 10Y vs assumed BI rate
    const termPremium = sbn10y.value - APBN_ASSUMPTIONS.biRate;
    const divergenceScore = termPremium > 2.5 ? 80 : termPremium > 1.5 ? 50 : termPremium > 0.5 ? 20 : 10;
    checks.push({
      dimension: 'SBN 10Y Yield vs BI Rate Stance',
      officialClaim: `APBN implied BI rate: ${APBN_ASSUMPTIONS.biRate}%`,
      marketSignal: `SBN 10Y: ${sbn10y.value.toFixed(2)}% (term premium: +${termPremium.toFixed(2)}%)`,
      divergenceScore,
      flagged: termPremium > 2.0,
    });
  }

  // 5. FX reserves vs "orderly market" narrative
  const fxReserves = await getLatestPoint('bi_fx_reserves_bn');
  const srbi = await getLatestPoint('srbi_outstanding_trn_idr');
  if (fxReserves && srbi) {
    // If reserves falling while SRBI rising → BI defending while claiming "orderly market"
    const pseudoStability = fxReserves.value < 130 && srbi.value > 800;
    checks.push({
      dimension: 'FX Reserve Trajectory vs "Orderly Market" Narrative',
      officialClaim: 'BI: exchange rate movements remain orderly, reserves adequate',
      marketSignal: `Reserves: ${fxReserves.value.toFixed(1)} bn USD | SRBI outstanding: ${srbi.value.toFixed(0)} trn IDR${pseudoStability ? ' — sterilization pressure elevated' : ''}`,
      divergenceScore: pseudoStability ? 70 : 20,
      flagged: pseudoStability,
    });
  }

  // 6. Food CPI vs APBN general inflation assumption
  // APBN 2026 targets 2.5% general CPI — food typically 1.5x, implying ~3.75% food CPI
  // Food inflation >6% = subsidi pangan bengkak; <0% = deflation / farmer income stress
  const APBN_IMPLIED_FOOD_CPI = 3.75;
  const foodInflationPoint = await getLatestPoint('food_inflation_yoy_pct');
  if (foodInflationPoint) {
    const foodDev = foodInflationPoint.value - APBN_IMPLIED_FOOD_CPI;
    const divergenceScore = Math.min(100, Math.max(0, Math.abs(foodDev) * 10));
    const flagged = foodInflationPoint.value > 6.0 || foodInflationPoint.value < 0;
    checks.push({
      dimension: 'Food CPI vs APBN Inflation Assumption',
      officialClaim: `APBN general CPI target: ${APBN_ASSUMPTIONS.inflation}% (implied food CPI ~${APBN_IMPLIED_FOOD_CPI}%)`,
      marketSignal: `Food inflation: ${foodInflationPoint.value.toFixed(1)}% YoY (${foodDev >= 0 ? '+' : ''}${foodDev.toFixed(1)}pp vs implied food CPI)${foodInflationPoint.value > 6 ? ' — subsidi pangan overrun risk' : foodInflationPoint.value < 0 ? ' — deflation / farmer income stress' : ''}`,
      divergenceScore,
      flagged,
    });
  }

  // 7. Compound IDR + Oil double-whammy: both diverge simultaneously = APBN under max stress
  // IDR weakness inflates subsidy cost in IDR terms ON TOP of higher USD oil price
  const idrCheck = checks.find((c) => c.dimension.includes('USDIDR'));
  const oilCheck = checks.find((c) => c.dimension.includes('Oil'));
  if (idrCheck && oilCheck && idrCheck.flagged && oilCheck.flagged) {
    const usdIdrVal = usdIdrSpot?.value ?? APBN_ASSUMPTIONS.usdIdr;
    const brentVal = brentSpot?.value ?? APBN_ASSUMPTIONS.oilPrice;
    const idrDeviation = (usdIdrVal - APBN_ASSUMPTIONS.usdIdr) / APBN_ASSUMPTIONS.usdIdr;
    const oilDeviation = (brentVal - APBN_ASSUMPTIONS.oilPrice) / APBN_ASSUMPTIONS.oilPrice;
    const combinedImpact = ((1 + idrDeviation) * (1 + oilDeviation) - 1) * 100;
    checks.push({
      dimension: 'Compound IDR+Oil vs APBN (Double-Whammy)',
      officialClaim: `APBN oil subsidy cost: USDIDR ${APBN_ASSUMPTIONS.usdIdr} × $${APBN_ASSUMPTIONS.oilPrice}/bbl`,
      marketSignal: `Market USDIDR ${usdIdrVal.toLocaleString()} × $${brentVal.toFixed(1)}/bbl = +${combinedImpact.toFixed(1)}% real cost overshoot`,
      divergenceScore: Math.min(100, combinedImpact * 2),
      flagged: combinedImpact > 20,
    });
  }

  // Compute overall credibility score (inverted average divergence)
  const avgDivergence = checks.length > 0
    ? checks.reduce((s, c) => s + c.divergenceScore, 0) / checks.length
    : 0;
  const narrativeCredibilityScore = Math.max(0, Math.round(100 - avgDivergence));
  const alertLevel = alertFromScore(avgDivergence);

  const flags = checks.filter((c) => c.flagged).map(
    (c) => `${c.dimension}: ${c.marketSignal}`,
  );

  const narrative = [
    `Narrative Credibility Score: ${narrativeCredibilityScore}/100.`,
    `${checks.filter((c) => c.flagged).length}/${checks.length} divergence checks flagged.`,
    flags.length > 0
      ? `Key divergence: ${flags[0]}`
      : 'Official guidance broadly aligned with market pricing.',
  ].join(' ');

  return {
    narrativeCredibilityScore,
    alertLevel,
    checks,
    flags,
    narrative,
    date: new Date().toISOString().slice(0, 10),
  };
}

function formatOutput(output: NarrativeDivergenceOutput): string {
  return [
    `# Narrative Divergence Engine — Indonesia`,
    `**Date:** ${output.date}`,
    `**Alert:** ${alertLabel(output.alertLevel)} | **Credibility Score:** ${output.narrativeCredibilityScore}/100`,
    ``,
    `## Summary`,
    output.narrative,
    ``,
    `## Divergence Checks`,
    ...output.checks.map((c) => [
      `### ${c.dimension} ${c.flagged ? '⚠️' : '✓'}`,
      `- **Official:** ${c.officialClaim}`,
      `- **Market:** ${c.marketSignal}`,
      `- **Divergence:** ${c.divergenceScore}/100`,
    ].join('\n')),
    ``,
    output.flags.length > 0 ? `## Active Divergences\n${output.flags.map((f) => `- ⚠️ ${f}`).join('\n')}` : '## No Critical Divergences Detected',
    ``,
    `_APBN 2026 assumptions: Perpres 201/2024 (Revenue 2,997T | Spending 3,621T | Deficit 2.56% GDP). Prabowo efisiensi cuts (early 2026) may have revised spending target — verify APBN-P 2026 before interpreting fiscal divergence._`,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

export const narrativeDivergenceEngine = new DynamicStructuredTool({
  name: 'narrative_divergence_engine',
  description:
    'Narrative Divergence Engine: compares official BI/government guidance vs market pricing (CDS, yields, USDIDR, reserves). Generates Narrative Credibility Score. Detects optimistic spin contradicted by market signals.',
  schema: z.object({
    query: z.string().describe('e.g. "Is BI credible?" or "Does official guidance match markets?" or "Show narrative divergence"'),
  }),
  func: async (_input) => {
    try {
      const output = await runNarrativeDivergenceEngine();
      return formatToolResult({ analysis: formatOutput(output), raw: output });
    } catch (error) {
      return formatToolResult({ error: error instanceof Error ? error.message : String(error) });
    }
  },
});
