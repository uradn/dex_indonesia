import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { getLatestPoint, getLastN, upsertPoints } from './time-series-db.js';
import { alertFromScore, alertLabel } from './scoring.js';
import { fetchSbn10yTradingEconomics, fetchBiRateTradingEconomics } from './sources/sovereign-scraper.js';
import { fetchFoodInflationTe } from './sources/pihps.js';
import { computeCostRecovery, DOMESTIC_FUEL_PRICES } from './sources/pertamina.js';
import { fetchDubaiCrude } from './sources/dubai-crude.js';
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

// APBN 2026 key assumptions — UU No. 17 Tahun 2025 / Perpres No. 118 Tahun 2025
const APBN_ASSUMPTIONS = {
  usdIdr: 16_500,       // APBN USDIDR assumption IDR/USD
  oilPrice: 70,         // APBN ICP (Indonesian Crude Price) assumption USD/bbl
  gdpGrowth: 5.4,       // APBN GDP growth target %
  inflation: 2.5,       // APBN CPI target %
  biRate: 5.50,         // BI 7DRR as of Jun 9 2026 (raised +25bps from 5.25%, RDG June 2026)
};

// US CPI approximation — used for relative PPP misalignment cross-check only (R&R framework)
// Update if Fed publishes major CPI revision; directional signal does not require precision
const US_CPI_APPROX = 3.0;

export async function runNarrativeDivergenceEngine(): Promise<NarrativeDivergenceOutput> {
  const checks: DivergenceCheck[] = [];

  // Seed fresh data (parallel)
  const [sbnFresh, biRateFresh, foodInflFresh, dubaiResult] = await Promise.allSettled([
    fetchSbn10yTradingEconomics(),
    fetchBiRateTradingEconomics(),
    fetchFoodInflationTe(),
    fetchDubaiCrude(),
  ]);
  const dubaiData = dubaiResult.status === 'fulfilled' ? dubaiResult.value : null;
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
    const divergenceScore = Math.round(Math.min(100, Math.max(0, Math.abs(marketVsApbn) * 5)));
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
    const divergenceScore = Math.round(Math.min(100, Math.max(0, Math.abs(marketVsApbn) * 2)));
    checks.push({
      dimension: 'Oil Price (ICP) vs APBN Assumption',
      officialClaim: `APBN baseline ICP: $${APBN_ASSUMPTIONS.oilPrice}/bbl`,
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
    const divergenceScore = Math.round(Math.min(100, Math.max(0, Math.abs(foodDev) * 10)));
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

  // 8. PPP Misalignment (R&R Ch.4-5: Relative PPP)
  // Relative PPP: %ΔUSDIDR ≈ π_Indonesia − π_USA. Persistent deviation = structural misalignment.
  // Positive misalignment (IDR weaker than PPP predicts) → Dornbusch overshoot → may correct
  // Negative (IDR stronger than PPP) → potential future depreciation pressure
  const idrLongHistory = await getLastN('usdidr_spot', 250);
  if (usdIdrSpot && idrLongHistory.length >= 30) {
    const oldest = idrLongHistory[0]!;
    const daysApart = (Date.parse(usdIdrSpot.date) - Date.parse(oldest.date)) / 86_400_000;
    if (daysApart >= 180) {
      const actualChange = ((usdIdrSpot.value - oldest.value) / oldest.value) * 100;
      const annualizedChange = parseFloat((actualChange * (365 / daysApart)).toFixed(2));
      const pppImplied = parseFloat((APBN_ASSUMPTIONS.inflation - US_CPI_APPROX).toFixed(2));
      const misalignment = parseFloat((annualizedChange - pppImplied).toFixed(2));
      const absMis = Math.abs(misalignment);
      checks.push({
        dimension: 'USDIDR vs Relative PPP Fair Value (R&R)',
        officialClaim: `PPP-implied annual IDR change: ${pppImplied >= 0 ? '+' : ''}${pppImplied.toFixed(1)}% (ID CPI ${APBN_ASSUMPTIONS.inflation}% − US CPI ~${US_CPI_APPROX}%)`,
        marketSignal: `IDR actual ${Math.round(daysApart)}d annualized: ${annualizedChange >= 0 ? '+' : ''}${annualizedChange.toFixed(1)}% — misalignment: ${misalignment >= 0 ? '+' : ''}${misalignment.toFixed(1)}pp${absMis > 10 ? (misalignment > 0 ? ' (IDR overshooting PPP — Dornbusch: expect partial reversion)' : ' (IDR outperforming PPP — latent pressure building)') : ' (broadly within PPP range)'}`,
        divergenceScore: Math.min(100, Math.round(absMis * 5)),
        flagged: absMis > 10,
      });
    }
  }

  // 9. BBM domestic price vs cost recovery — "harga BBM terjangkau" narrative
  // Uses brentSpot + usdIdrSpot already fetched above; reads Pertalite price from DB
  const pertalitePoint = await getLatestPoint('pertalite_price_idr_liter');
  if (brentSpot && usdIdrSpot && pertalitePoint) {
    const costRecovery = computeCostRecovery(brentSpot.value, usdIdrSpot.value);
    const gap = costRecovery - pertalitePoint.value;
    const divergenceScore = gap > 7_000 ? 90 : gap > 4_000 ? 65 : gap > 2_000 ? 35 : 10;
    checks.push({
      dimension: 'BBM Price vs Cost Recovery (Subsidi Gap)',
      officialClaim: `Pertamina maintains Pertalite at IDR ${pertalitePoint.value.toLocaleString('id-ID')}/liter ("harga BBM terjangkau")`,
      marketSignal: `Cost recovery: IDR ${costRecovery.toLocaleString('id-ID')}/liter → gap IDR ${gap.toLocaleString('id-ID')}/liter${gap > 4_000 ? ' — BBM hike pressure HIGH; fiscal subsidi burden' : gap > 2_000 ? ' — subsidi burden building' : ' — manageable at current oil+IDR'}`,
      divergenceScore,
      flagged: gap > 2_000,
    });
  }

  // 10. Pertamax non-subsidi single-step hike magnitude vs "stable non-subsidi pricing" narrative
  // A >20% single-step hike on non-subsidi BBM = political price suppression released in one shot,
  // contradicting BI's "pre-emptive, gradual" framing and implying pent-up inflationary pressure.
  const pertamaxPoint = await getLatestPoint('pertamax_price_idr_liter');
  const PERTAMAX_PRE_HORMUZ_BASELINE = 12_300; // last stable price before Hormuz crisis (Sep 2022–Jun 2026)
  if (pertamaxPoint) {
    const stepChangePct = ((pertamaxPoint.value - PERTAMAX_PRE_HORMUZ_BASELINE) / PERTAMAX_PRE_HORMUZ_BASELINE) * 100;
    const divergenceScore = stepChangePct > 30 ? 75 : stepChangePct > 20 ? 50 : stepChangePct > 10 ? 25 : 5;
    const flagged = stepChangePct > 20;
    checks.push({
      dimension: 'Pertamax Non-Subsidi Hike Magnitude vs Stable Energy Narrative',
      officialClaim: `Non-subsidi BBM harga mengikuti formula keekonomian secara berkala (Kepmen ESDM)`,
      marketSignal: `Pertamax IDR ${pertamaxPoint.value.toLocaleString('id-ID')}/liter — +${stepChangePct.toFixed(1)}% single-step dari baseline pre-Hormuz IDR ${PERTAMAX_PRE_HORMUZ_BASELINE.toLocaleString('id-ID')}${flagged ? ' — catch-up hike setelah 18+ bulan suppressed; implied CPI transportasi overshoot' : ''}`,
      divergenceScore,
      flagged,
    });
  }

  // 11. Dubai physical crude vs APBN ICP + Brent-Dubai spread (Haye framework)
  // ICP formula is Brent-linked (for royalty/revenue calculation).
  // Pertamina's actual physical crude procurement = Dubai/Oman spot + freight + risk premium.
  // During Hormuz disruption: Brent (paper) spikes on fear; Dubai (physical) discounts
  // on delivery risk → Brent-Dubai spread widens to $10-27/bbl (vs normal $1-3/bbl).
  // Signal: Dubai still +30% above APBN $70 even when deeply discounted vs Brent.
  if (dubaiData !== null) {
    const dubaiVsApbn = ((dubaiData.dubaiPriceUsd - APBN_ASSUMPTIONS.oilPrice) / APBN_ASSUMPTIONS.oilPrice) * 100;
    const spread = dubaiData.brentDubaiSpreadUsd;
    const spreadStr = spread !== null
      ? (() => {
          if (spread > 10) return `Brent-Dubai spread: +$${spread.toFixed(1)}/bbl — EXTREME: paper spike vs physical discount (Hormuz delivery risk)`;
          if (spread > 5)  return `Brent-Dubai spread: +$${spread.toFixed(1)}/bbl — elevated: paper/physical market disconnection`;
          if (spread < -2) return `Brent-Dubai spread: $${spread.toFixed(1)}/bbl — INVERTED: physical Dubai premium above Brent (supply crunch)`;
          return `Brent-Dubai spread: +$${spread.toFixed(1)}/bbl (normal range)`;
        })()
      : '';
    const sourceNote = dubaiData.source === 'brent_proxy' ? ' [estimated via Brent−$1.50]' : dubaiData.source === 'worldbank_pinksheet' ? ' [WB Pink Sheet, ~1mo lag]' : '';
    const divergenceScore = Math.min(100,
      Math.abs(dubaiVsApbn) * 1.5 +                                                         // cost overrun
      (dubaiData.brentDubaiSpreadUsd !== null && dubaiData.hormuzFlag ? Math.min(30, dubaiData.brentDubaiSpreadUsd * 2) : 0), // spread penalty
    );
    checks.push({
      dimension: 'Dubai Physical Crude vs APBN ICP + Brent-Dubai Spread (Haye)',
      officialClaim: `APBN ICP basis: $${APBN_ASSUMPTIONS.oilPrice}/bbl (Brent-linked royalty formula). Pertamina buys physical at Dubai spot + freight.`,
      marketSignal: `Dubai: $${dubaiData.dubaiPriceUsd.toFixed(1)}/bbl (${dubaiVsApbn >= 0 ? '+' : ''}${dubaiVsApbn.toFixed(1)}% vs APBN)${sourceNote}. ${spreadStr}`.trim(),
      divergenceScore: Math.round(divergenceScore),
      flagged: Math.abs(dubaiVsApbn) > 10 || dubaiData.hormuzFlag,
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
    `_APBN 2026 assumptions: UU No. 17 Tahun 2025 / Perpres No. 118 Tahun 2025 (Revenue 3,154T | Spending 3,843T | Deficit 2.68% GDP; post-efisiensi spending ~3,534T). APBN macro: USDIDR 16,500 | ICP $70/bbl | GDP 5.4% | CPI 2.5% | SBN10Y 6.9%._`,
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
