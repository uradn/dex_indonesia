import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { upsertPoints, getLatestPoint, getLastN, getHistory } from './time-series-db.js';
import { buildSnapshot, compositeScore, detectFlags, alertFromScore, alertLabel } from './scoring.js';
import { fetchIndonesiaCds5y, fetchSbn10yYield, fetchEmbiSpread, bloombergAvailable } from './sources/bloomberg.js';
import { fetchSbn10yRdp, fetchCds5yRdp, refinitivAvailable } from './sources/refinitiv.js';
import { fetchSbnForeignOwnership } from './sources/bi.js';
import { fetchSbn10yTradingEconomics, fetchBiRateTradingEconomics, fetchIndonesiaCdsAndRatingWgb, computeTermPremium } from './sources/sovereign-scraper.js';
import { fetchDebtGdpImf } from './sources/imf.js';
import { fetchUst10y } from './sources/yahoo-macro.js';
import type { AlertLevel, IndicatorSnapshot, ModuleScoreCard, MacroDataPoint } from './types.js';

export const SOVEREIGN_RISK_DESCRIPTION = `
MACRO INTELLIGENCE — Sovereign Risk Engine (Module 2)

Tracks Indonesia sovereign credit and funding stress. Detects:
- CDS acceleration (repricing before mainstream narrative)
- SBN yield spike and curve inversion
- EMBI spread widening vs peers
- Foreign SBN ownership cliff (exit = yield spiral)
- Debt maturity wall proximity
- Interest/revenue ratio deterioration
- Refinancing stress

## When to Use

- "Show Indonesia sovereign risk"
- "Is CDS widening?"
- "What is the SBN foreign ownership trend?"
- "Sovereign repricing risk"
- Any time CDS moves >10bps in a session or foreign SBN data released

## Scores

- Sovereign Risk Score (0-100)
- Fiscal Credibility Index (0-100)
- Refinancing Stress Score (0-100)

## Data Sources

Priority: Bloomberg → Refinitiv → web scraping fallback
`.trim();

interface CdsVelocity {
  bpsPerWeek: number;
  daysTo200: number | null;  // null if CDS falling, already ≥200, or insufficient data
  alertLevel: AlertLevel;
  dataPointsUsed: number;
  windowDays: number;
}

interface SovereignOutput {
  scoreCard: ModuleScoreCard;
  cds5y: IndicatorSnapshot | null;
  sbn10y: IndicatorSnapshot | null;
  embiSpread: IndicatorSnapshot | null;
  foreignSbnOwnership: IndicatorSnapshot | null;
  cdsVelocity: CdsVelocity | null;
  sovereignRiskScore: number;
  refinancingStressScore: number;
  fiscalCredibilityIndex: number;
  foreignExitRisk: AlertLevel;
  termPremium: ReturnType<typeof computeTermPremium> | null;
  sbnUstSpread: number | null;  // SBN 10Y − UST 10Y; narrowing = outflow risk
  ust10y: number | null;
  narrative: string;
}

const CDS_DOWNGRADE_WATCH = 200;  // bps — S&P/Moody's watch zone threshold

function cdsVelocityAlert(bpsPerWeek: number): AlertLevel {
  if (bpsPerWeek > 7)  return 'red';
  if (bpsPerWeek > 3)  return 'orange';
  if (bpsPerWeek > 0)  return 'yellow';
  return 'green';
}

async function computeCdsVelocity(currentBps: number): Promise<CdsVelocity | null> {
  const history = await getHistory('indonesia_cds_5y_bps', 21); // 3-week window
  if (history.length < 2) return null;

  const oldest = history[0];
  const latest  = history[history.length - 1];
  const daysDiff = Math.max(1,
    (new Date(latest.date).getTime() - new Date(oldest.date).getTime()) / 86_400_000,
  );
  const bpsPerWeek = parseFloat((((latest.value - oldest.value) / daysDiff) * 7).toFixed(2));
  const daysTo200 = (bpsPerWeek > 0 && currentBps < CDS_DOWNGRADE_WATCH)
    ? Math.ceil((CDS_DOWNGRADE_WATCH - currentBps) / (bpsPerWeek / 7))
    : null;

  return {
    bpsPerWeek,
    daysTo200,
    alertLevel: cdsVelocityAlert(bpsPerWeek),
    dataPointsUsed: history.length,
    windowDays: Math.round(daysDiff),
  };
}

export async function runSovereignRiskEngine(): Promise<SovereignOutput> {
  // 1. CDS + rating — Bloomberg → Refinitiv → WorldGovernmentBonds.com (free, Playwright, ~daily)
  let cdsPoint = bloombergAvailable() ? await fetchIndonesiaCds5y() : null;
  cdsPoint ??= refinitivAvailable() ? await fetchCds5yRdp() : null;
  let ratingPoint: MacroDataPoint | null = null;
  if (!cdsPoint) {
    const [wgbCds, wgbRating] = await fetchIndonesiaCdsAndRatingWgb();
    cdsPoint = wgbCds;
    ratingPoint = wgbRating;
  }
  if (cdsPoint) await upsertPoints([cdsPoint]);
  if (ratingPoint) await upsertPoints([ratingPoint]);

  // 1b. Government debt/GDP from IMF WEO (annual, ~1yr lag; used for FCI)
  const debtGdpPoint = await fetchDebtGdpImf();
  if (debtGdpPoint) await upsertPoints([debtGdpPoint]);

  // 2. SBN 10Y yield — Bloomberg → Refinitiv → Trading Economics scrape (free)
  let sbnPoint = bloombergAvailable() ? await fetchSbn10yYield() : null;
  sbnPoint ??= refinitivAvailable() ? await fetchSbn10yRdp() : null;
  sbnPoint ??= await fetchSbn10yTradingEconomics();
  if (sbnPoint) await upsertPoints([sbnPoint]);

  // 2b. BI Rate — Trading Economics scrape (free); stored for term premium computation
  const biRatePoint = await fetchBiRateTradingEconomics();
  if (biRatePoint) await upsertPoints([biRatePoint]);

  // 2c. UST 10Y — Yahoo Finance ^TNX; used for SBN-UST spread (carry/flow context)
  const ust10yPoint = await fetchUst10y();
  if (ust10yPoint) await upsertPoints([ust10yPoint]);

  // 3. EMBI spread
  const embiPoint = bloombergAvailable() ? await fetchEmbiSpread() : null;
  if (embiPoint) await upsertPoints([embiPoint]);

  // 4. Foreign SBN ownership
  const foreignPoint = await fetchSbnForeignOwnership();
  if (foreignPoint) await upsertPoints([foreignPoint]);

  // Retrieve history
  const currentCds = await getLatestPoint('indonesia_cds_5y_bps');
  const prevCds = (await getLastN('indonesia_cds_5y_bps', 30)).slice(-2)[0] ?? null;

  const currentSbn = await getLatestPoint('sbn_10y_yield_pct');
  const prevSbn = (await getLastN('sbn_10y_yield_pct', 30)).slice(-2)[0] ?? null;

  const currentEmbi = await getLatestPoint('embi_indonesia_spread_bps');
  const prevEmbi = (await getLastN('embi_indonesia_spread_bps', 30)).slice(-2)[0] ?? null;

  const currentForeign = await getLatestPoint('sbn_foreign_ownership_pct');
  const prevForeign = (await getLastN('sbn_foreign_ownership_pct', 6)).slice(-2)[0] ?? null;

  const currentBiRate = await getLatestPoint('bi_rate_pct');
  const currentRating = await getLatestPoint('indonesia_credit_rating_score');
  const currentDebtGdp = await getLatestPoint('indonesia_debt_gdp_pct');

  // CDS velocity — bps/week over 3-week window; days-to-200bps countdown
  const cdsVelocity = currentCds ? await computeCdsVelocity(currentCds.value) : null;
  if (cdsVelocity !== null) {
    await upsertPoints([{
      indicator: 'cds_velocity_bps_week',
      category: 'sovereign',
      date: new Date().toISOString().slice(0, 10),
      value: cdsVelocity.bpsPerWeek,
      unit: 'bps/week',
      source: 'computed_m2',
      fetchedAt: new Date().toISOString(),
    }]);
  }

  // Build snapshots
  const cdsSnapshot = currentCds ? await buildSnapshot('indonesia_cds_5y_bps', currentCds, prevCds) : null;
  const sbnSnapshot = currentSbn ? await buildSnapshot('sbn_10y_yield_pct', currentSbn, prevSbn) : null;
  const embiSnapshot = currentEmbi ? await buildSnapshot('embi_indonesia_spread_bps', currentEmbi, prevEmbi) : null;
  const foreignSnapshot = currentForeign ? await buildSnapshot('sbn_foreign_ownership_pct', currentForeign, prevForeign) : null;

  // Term premium: SBN 10Y − BI Rate (free CDS proxy; stress if >3%)
  const termPremium = (currentSbn && currentBiRate)
    ? computeTermPremium(currentSbn.value, currentBiRate.value)
    : null;

  // SBN-UST spread: SBN 10Y − UST 10Y in basis points — carry trade attractiveness / outflow risk
  const currentUst10y = await getLatestPoint('ust_10y_yield_pct');
  const sbnUstSpread = (currentSbn && currentUst10y)
    ? Math.round((currentSbn.value - currentUst10y.value) * 100)  // % → bps
    : null;

  const validSnapshots = [cdsSnapshot, sbnSnapshot, embiSnapshot, foreignSnapshot].filter(
    (s): s is IndicatorSnapshot => s !== null,
  );

  // Foreign exit risk: ownership falling + CDS rising = exit confirmed
  const foreignFalling = (foreignSnapshot?.roc ?? 0) < -5;
  const cdaRising = (cdsSnapshot?.roc ?? 0) > 10;
  // Also flag if term premium is elevated (>3%) as a sovereign stress proxy
  const termPremiumStress = termPremium?.stressSignal ?? false;
  const foreignExitRisk: AlertLevel =
    foreignFalling && cdaRising ? 'red' :
    foreignFalling ? 'orange' :
    cdaRising ? 'yellow' : 'green';

  // Scores — when no Bloomberg/Refinitiv, use term premium as stress proxy
  let sovereignRiskScore = compositeScore(validSnapshots);
  if (validSnapshots.length === 0 && termPremium) {
    // Term premium >3% = 50 score (ORANGE), >3.5% = 75 (RED), <3% = low score
    sovereignRiskScore = termPremium.termPremium > 3.5 ? 75
      : termPremium.termPremium > 3.0 ? 50
      : termPremium.termPremium > 2.5 ? 25
      : 10;
  }

  // Refinancing stress: proxy using SBN yield level vs historical
  const sbnYieldZ = sbnSnapshot?.zScore30d ?? sbnSnapshot?.zScore90d ?? 0;
  const refinancingStressScore = Math.min(100, Math.round(Math.abs(sbnYieldZ) * 40));

  // Fiscal Credibility Index — composite of three independent sources:
  //   Rating  (50%): S&P/Fitch via WorldGovernmentBonds. BBB=73, AAA=100, D=0.
  //   CDS     (30%): market risk premium. score = max(0, 100 - cds_bps * 0.20). 90bps→82, 200bps→60.
  //   Debt/GDP(20%): IMF WEO. score = max(0, 100 - debt_pct * 1.25). 40%→50, 60%→25.
  // Falls back gracefully if any component missing (redistributes weights).
  const cdsLevel = currentCds?.value ?? 0;

  // Absolute level floor — z-score captures deviation from recent history but misses
  // structural risk embedded in absolute levels. Indonesia pre-COVID normal: CDS ~70bps.
  // CDS 91bps and term premium 1.46% are not crisis levels but not zero risk either.
  const cdsLevelFloor = cdsLevel > 60
    ? Math.min(30, Math.round((cdsLevel - 60) * 0.4))  // 91bps → 12; 150bps → 30 (cap)
    : 0;
  const termPremiumFloor = termPremium
    ? termPremium.termPremium > 3.0 ? 25
      : termPremium.termPremium > 2.0 ? 15
      : termPremium.termPremium > 1.5 ? 8
      : termPremium.termPremium > 1.0 ? 4
      : 0
    : 0;
  // SBN-UST below 200bps = carry trade unwind territory → structural risk
  const spreadCompressionFloor = sbnUstSpread !== null && sbnUstSpread < 200 ? 10 : 0;
  const absoluteFloor = cdsLevelFloor + termPremiumFloor + spreadCompressionFloor;
  sovereignRiskScore = Math.max(sovereignRiskScore, absoluteFloor);
  const ratingScore = currentRating?.value ?? null;
  const debtGdp = currentDebtGdp?.value ?? null;

  const cdsScore = cdsLevel > 0 ? Math.max(0, 100 - cdsLevel * 0.20) : null;
  const debtScore = debtGdp !== null ? Math.max(0, 100 - debtGdp * 1.25) : null;

  let fiscalCredibilityIndex: number;
  if (ratingScore !== null && cdsScore !== null && debtScore !== null) {
    // Full composite: rating 50% + CDS 30% + debt/GDP 20%
    fiscalCredibilityIndex = Math.round(ratingScore * 0.50 + cdsScore * 0.30 + debtScore * 0.20);
  } else if (ratingScore !== null && cdsScore !== null) {
    // No debt/GDP: rating 60% + CDS 40%
    fiscalCredibilityIndex = Math.round(ratingScore * 0.60 + cdsScore * 0.40);
  } else if (ratingScore !== null) {
    // Rating only
    fiscalCredibilityIndex = Math.round(ratingScore);
  } else if (cdsScore !== null) {
    // CDS only (old behaviour)
    fiscalCredibilityIndex = Math.round(cdsScore);
  } else if (termPremium) {
    // Last resort: term premium proxy
    fiscalCredibilityIndex = Math.max(0, Math.round(100 - termPremium.termPremium * 15));
  } else {
    fiscalCredibilityIndex = 50;
  }

  const alertLevel = alertFromScore(sovereignRiskScore);
  const flags = detectFlags(validSnapshots);
  if (foreignExitRisk === 'red') flags.push('CRITICAL: Foreign SBN exit + CDS widening simultaneously — repricing cycle risk');
  if (foreignExitRisk === 'orange') flags.push('Foreign SBN ownership declining — monitor for acceleration');
  if (cdsLevel > 200) flags.push(`CDS 5Y at ${cdsLevel}bps — above 200bps stress threshold`);
  if (cdsVelocity && cdsVelocity.bpsPerWeek > 3) {
    const countdown = cdsVelocity.daysTo200 !== null
      ? ` — 200bps watch zone in ~${cdsVelocity.daysTo200} days at current pace`
      : '';
    flags.push(`CDS velocity ${cdsVelocity.bpsPerWeek > 0 ? '+' : ''}${cdsVelocity.bpsPerWeek.toFixed(1)}bps/week [${cdsVelocity.alertLevel.toUpperCase()}]${countdown}`);
  }
  if (fiscalCredibilityIndex < 30) flags.push('Fiscal credibility severely impaired — market pricing systemic risk');
  if (termPremiumStress) flags.push(`⚠️ Term premium elevated: SBN 10Y−BI Rate = ${termPremium!.termPremium.toFixed(2)}% — ${termPremium!.label}`);
  // SBN-UST spread compression warning: <200bps = carry trade unwind risk
  if (sbnUstSpread !== null && sbnUstSpread < 200) flags.push(`SBN-UST spread ${sbnUstSpread}bps — <200bps threshold; carry trade attractiveness declining`);
  else if (sbnUstSpread !== null && sbnUstSpread > 300) flags.push(`SBN-UST spread ${sbnUstSpread}bps — >300bps; attractive carry but implies high risk premium`);

  const narrative = buildNarrative({ cdsSnapshot, sbnSnapshot, embiSnapshot, foreignSnapshot, foreignExitRisk, alertLevel, termPremium });

  return {
    scoreCard: {
      module: 'sovereign_risk',
      scoreDate: new Date().toISOString().slice(0, 10),
      score: sovereignRiskScore,
      alertLevel,
      indicators: validSnapshots,
      narrative,
      flags,
    },
    cds5y: cdsSnapshot,
    sbn10y: sbnSnapshot,
    embiSpread: embiSnapshot,
    foreignSbnOwnership: foreignSnapshot,
    cdsVelocity,
    sovereignRiskScore,
    refinancingStressScore,
    fiscalCredibilityIndex,
    foreignExitRisk,
    termPremium,
    sbnUstSpread,
    ust10y: currentUst10y?.value ?? null,
    narrative,
  };
}

function buildNarrative(ctx: {
  cdsSnapshot: IndicatorSnapshot | null;
  sbnSnapshot: IndicatorSnapshot | null;
  embiSnapshot: IndicatorSnapshot | null;
  foreignSnapshot: IndicatorSnapshot | null;
  foreignExitRisk: AlertLevel;
  alertLevel: AlertLevel;
  termPremium: ReturnType<typeof computeTermPremium> | null;
}): string {
  const parts: string[] = [];
  if (ctx.cdsSnapshot) parts.push(`Indonesia CDS 5Y: ${ctx.cdsSnapshot.current.toFixed(0)}bps (${ctx.cdsSnapshot.roc >= 0 ? '+' : ''}${ctx.cdsSnapshot.roc.toFixed(1)}% MoM).`);
  if (ctx.sbnSnapshot) parts.push(`SBN 10Y yield: ${ctx.sbnSnapshot.current.toFixed(2)}% (${ctx.sbnSnapshot.roc >= 0 ? '+' : ''}${ctx.sbnSnapshot.roc.toFixed(2)}% MoM).`);
  if (ctx.termPremium) parts.push(`Term premium (SBN10Y−BI Rate): ${ctx.termPremium.termPremium.toFixed(2)}% — ${ctx.termPremium.label}.`);
  if (ctx.embiSnapshot) parts.push(`EMBI spread: ${ctx.embiSnapshot.current.toFixed(0)}bps.`);
  if (ctx.foreignSnapshot) parts.push(`Foreign SBN ownership: ${ctx.foreignSnapshot.current.toFixed(1)}% (${ctx.foreignSnapshot.roc >= 0 ? '+' : ''}${ctx.foreignSnapshot.roc.toFixed(1)}% MoM).`);
  if (ctx.foreignExitRisk === 'red') parts.push('Combined CDS + foreign exit signal: sovereign repricing cycle likely.');
  return parts.join(' ') || 'Limited data — configure Bloomberg or Refinitiv for CDS/EMBI. SBN 10Y + BI Rate sourced from Trading Economics.';
}

function formatOutput(output: SovereignOutput & { termPremium: ReturnType<typeof computeTermPremium> | null }): string {
  return [
    `# Sovereign Risk Engine — Indonesia`,
    `**Date:** ${output.scoreCard.scoreDate}`,
    `**Alert:** ${alertLabel(output.scoreCard.alertLevel)} | **Sovereign Risk Score:** ${output.sovereignRiskScore}/100`,
    ``,
    `## Summary`,
    output.narrative,
    ``,
    `## Indicators`,
    `| Indicator | Current | MoM Δ | 30d Z-Score | Alert |`,
    `|-----------|---------|--------|-------------|-------|`,
    ...(output.scoreCard.indicators.map((s) =>
      `| ${s.indicator} | ${s.current.toFixed(2)} ${s.unit} | ${s.roc >= 0 ? '+' : ''}${s.roc.toFixed(2)}% | ${s.zScore30d?.toFixed(2) ?? 'n/a'} | ${s.alertLevel.toUpperCase()} |`,
    )),
    output.termPremium
      ? `| term_premium_pct | ${output.termPremium.termPremium.toFixed(2)} % | n/a | n/a | ${output.termPremium.stressSignal ? 'ORANGE' : 'GREEN'} |`
      : '',
    ``,
    `## Sovereign Scores`,
    `| Score | Value |`,
    `|-------|-------|`,
    `| Sovereign Risk Score | ${output.sovereignRiskScore}/100 |`,
    `| Refinancing Stress Score | ${output.refinancingStressScore}/100 |`,
    `| Fiscal Credibility Index | ${output.fiscalCredibilityIndex}/100 |`,
    `| Foreign SBN Exit Risk | ${output.foreignExitRisk.toUpperCase()} |`,
    output.termPremium ? `| Term Premium (SBN−BI Rate) | ${output.termPremium.termPremium.toFixed(2)}% — ${output.termPremium.label} |` : '',
    output.sbnUstSpread !== null && output.ust10y !== null
      ? `| SBN−UST 10Y Spread | ${output.sbnUstSpread}bps (SBN ${(output.ust10y + output.sbnUstSpread / 100).toFixed(2)}% − UST ${output.ust10y.toFixed(2)}%) |`
      : `| SBN−UST 10Y Spread | n/a |`,
    output.cdsVelocity
      ? `| CDS Velocity | ${output.cdsVelocity.bpsPerWeek >= 0 ? '+' : ''}${output.cdsVelocity.bpsPerWeek.toFixed(1)} bps/week [${output.cdsVelocity.alertLevel.toUpperCase()}]${output.cdsVelocity.daysTo200 !== null ? ` — 200bps in ~${output.cdsVelocity.daysTo200}d` : ''} |`
      : `| CDS Velocity | insufficient history |`,
    ``,
    output.scoreCard.flags.length > 0 ? `## Flags\n${output.scoreCard.flags.map((f) => `- ⚠️ ${f}`).join('\n')}` : '',
    ``,
    `## Data Quality`,
    bloombergAvailable() ? '- Bloomberg: CONNECTED (CDS, SBN yield, EMBI)' : '- Bloomberg: not configured — CDS/EMBI unavailable',
    refinitivAvailable() ? '- Refinitiv: CONNECTED (CDS, SBN yield)' : '- Refinitiv: not configured',
    '- SBN 10Y yield: Trading Economics scrape (free, near real-time)',
    '- BI Rate: Trading Economics scrape (free, daily)',
    '- Foreign SBN ownership: DJPPR PDF (Playwright + pdf-parse) ✅',
    '- CDS 5Y: WorldGovernmentBonds.com scrape (free, Playwright) ✅ | Bloomberg/Refinitiv override if configured',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

export const sovereignRiskEngine = new DynamicStructuredTool({
  name: 'sovereign_risk_engine',
  description:
    'Sovereign Risk Engine: tracks Indonesia CDS 5Y, SBN 10Y yield, EMBI spread, foreign SBN ownership. Detects repricing cycles, foreign exit risk, fiscal credibility breakdown. Requires Bloomberg or Refinitiv for full coverage.',
  schema: z.object({
    query: z.string().describe('e.g. "Show sovereign risk" or "Is CDS widening?" or "Foreign SBN exit risk"'),
  }),
  func: async (_input) => {
    try {
      const output = await runSovereignRiskEngine();
      return formatToolResult(
        { analysis: formatOutput(output), raw: output },
        ['https://www.djppr.kemenkeu.go.id'],
      );
    } catch (error) {
      return formatToolResult({ error: error instanceof Error ? error.message : String(error) });
    }
  },
});
