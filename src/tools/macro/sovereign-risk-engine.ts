import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { upsertPoints, getLatestPoint, getLastN } from './time-series-db.js';
import { buildSnapshot, compositeScore, detectFlags, alertFromScore, alertLabel } from './scoring.js';
import { fetchIndonesiaCds5y, fetchSbn10yYield, fetchEmbiSpread, bloombergAvailable } from './sources/bloomberg.js';
import { fetchSbn10yRdp, fetchCds5yRdp, refinitivAvailable } from './sources/refinitiv.js';
import { fetchSbnForeignOwnership } from './sources/bi.js';
import { fetchSbn10yTradingEconomics, fetchBiRateTradingEconomics, computeTermPremium } from './sources/sovereign-scraper.js';
import type { AlertLevel, IndicatorSnapshot, ModuleScoreCard } from './types.js';

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

interface SovereignOutput {
  scoreCard: ModuleScoreCard;
  cds5y: IndicatorSnapshot | null;
  sbn10y: IndicatorSnapshot | null;
  embiSpread: IndicatorSnapshot | null;
  foreignSbnOwnership: IndicatorSnapshot | null;
  sovereignRiskScore: number;
  refinancingStressScore: number;
  fiscalCredibilityIndex: number;
  foreignExitRisk: AlertLevel;
  termPremium: ReturnType<typeof computeTermPremium> | null;
  narrative: string;
}

export async function runSovereignRiskEngine(): Promise<SovereignOutput> {
  // 1. CDS data — Bloomberg preferred, Refinitiv fallback (no free source available)
  let cdsPoint = bloombergAvailable() ? await fetchIndonesiaCds5y() : null;
  cdsPoint ??= refinitivAvailable() ? await fetchCds5yRdp() : null;
  if (cdsPoint) await upsertPoints([cdsPoint]);

  // 2. SBN 10Y yield — Bloomberg → Refinitiv → Trading Economics scrape (free)
  let sbnPoint = bloombergAvailable() ? await fetchSbn10yYield() : null;
  sbnPoint ??= refinitivAvailable() ? await fetchSbn10yRdp() : null;
  sbnPoint ??= await fetchSbn10yTradingEconomics();
  if (sbnPoint) await upsertPoints([sbnPoint]);

  // 2b. BI Rate — Trading Economics scrape (free); stored for term premium computation
  const biRatePoint = await fetchBiRateTradingEconomics();
  if (biRatePoint) await upsertPoints([biRatePoint]);

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

  // Build snapshots
  const cdsSnapshot = currentCds ? await buildSnapshot('indonesia_cds_5y_bps', currentCds, prevCds) : null;
  const sbnSnapshot = currentSbn ? await buildSnapshot('sbn_10y_yield_pct', currentSbn, prevSbn) : null;
  const embiSnapshot = currentEmbi ? await buildSnapshot('embi_indonesia_spread_bps', currentEmbi, prevEmbi) : null;
  const foreignSnapshot = currentForeign ? await buildSnapshot('sbn_foreign_ownership_pct', currentForeign, prevForeign) : null;

  // Term premium: SBN 10Y − BI Rate (free CDS proxy; stress if >3%)
  const termPremium = (currentSbn && currentBiRate)
    ? computeTermPremium(currentSbn.value, currentBiRate.value)
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

  // Fiscal credibility: inverse of divergence between official guidance and market pricing
  const cdsLevel = currentCds?.value ?? 0;
  const fiscalCredibilityIndex = cdsLevel > 0
    ? Math.max(0, Math.round(100 - (cdsLevel / 5)))
    : termPremium ? Math.max(0, Math.round(100 - termPremium.termPremium * 15)) : 100;

  const alertLevel = alertFromScore(sovereignRiskScore);
  const flags = detectFlags(validSnapshots);
  if (foreignExitRisk === 'red') flags.push('CRITICAL: Foreign SBN exit + CDS widening simultaneously — repricing cycle risk');
  if (foreignExitRisk === 'orange') flags.push('Foreign SBN ownership declining — monitor for acceleration');
  if (cdsLevel > 200) flags.push(`CDS 5Y at ${cdsLevel}bps — above 200bps stress threshold`);
  if (fiscalCredibilityIndex < 30) flags.push('Fiscal credibility severely impaired — market pricing systemic risk');
  if (termPremiumStress) flags.push(`⚠️ Term premium elevated: SBN 10Y−BI Rate = ${termPremium!.termPremium.toFixed(2)}% — ${termPremium!.label}`);

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
    sovereignRiskScore,
    refinancingStressScore,
    fiscalCredibilityIndex,
    foreignExitRisk,
    termPremium,
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
    output.termPremium ? `| Term Premium (CDS proxy) | ${output.termPremium.termPremium.toFixed(2)}% — ${output.termPremium.label} |` : '',
    ``,
    output.scoreCard.flags.length > 0 ? `## Flags\n${output.scoreCard.flags.map((f) => `- ⚠️ ${f}`).join('\n')}` : '',
    ``,
    `## Data Quality`,
    bloombergAvailable() ? '- Bloomberg: CONNECTED (CDS, SBN yield, EMBI)' : '- Bloomberg: not configured — CDS/EMBI unavailable',
    refinitivAvailable() ? '- Refinitiv: CONNECTED (CDS, SBN yield)' : '- Refinitiv: not configured',
    '- SBN 10Y yield: Trading Economics scrape (free, near real-time)',
    '- BI Rate: Trading Economics scrape (free, daily)',
    '- Foreign SBN ownership: DJPPR website (currently unreachable — site blocks curl)',
    '- CDS 5Y: No free source available without JS engine — using term premium as proxy',
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
