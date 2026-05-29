import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { upsertPoints, getLatestPoint, getLastN } from './time-series-db.js';
import { buildSnapshot, compositeScore, alertFromScore, alertLabel } from './scoring.js';
import { fetchEidoProxy } from './sources/yahoo-macro.js';
import { fetchSbnForeignOwnership } from './sources/bi.js';
import { fetchIdxForeignNetFlow } from './sources/idx.js';
import type { AlertLevel, IndicatorSnapshot, ModuleScoreCard } from './types.js';

export const FOREIGN_FLOW_DESCRIPTION = `
MACRO INTELLIGENCE — Foreign Flow Engine (Module 5)

Detects silent foreign capital exit from Indonesia before it shows in headline data.

Tracks:
- Foreign equity flows: EIDO ETF (iShares MSCI Indonesia) as proxy — daily, real-time signal
- Foreign SBN ownership: DJPPR (% of total SBN held by foreigners)
- IHSG vs IDR divergence: IHSG stable but IDR depreciating = domestic absorption masking foreign exit
- ETF premium/discount to NAV: foreign demand signal

Detects:
- Silent foreign exit: foreigners selling SBN + EIDO declining while IHSG stable
- Domestic absorption masking: BI/domestic banks buying what foreigners sell (hides stress)
- MSCI/FTSE passive rebalancing risk

## When to Use

- "Are foreigners leaving Indonesia?"
- "Show capital flow risk"
- "IHSG stable but IDR weak — explain"
- Any time EIDO drops >3% in a session or USDIDR moves without IHSG explanation
`.trim();

interface ForeignFlowOutput {
  scoreCard: ModuleScoreCard;
  eidoSnapshot: IndicatorSnapshot | null;
  sbnForeignOwnership: IndicatorSnapshot | null;
  idxFlowSnapshot: IndicatorSnapshot | null;
  idxDailyFlow: number | null;    // IDR bn, positive = net buy, negative = net sell
  divergenceFlag: boolean;
  domesticAbsorptionFlag: boolean;
  silentExitProbability: number;
  narrative: string;
}

export async function runForeignFlowEngine(): Promise<ForeignFlowOutput> {
  // 1. EIDO ETF history — proxy for foreign equity demand
  // 2. Foreign SBN ownership
  // 3. IDX daily foreign net flow (direct equity flow signal)
  const [eidoHistory, sbnOwnership, idxFlowPoint] = await Promise.all([
    fetchEidoProxy(180),
    fetchSbnForeignOwnership(),
    fetchIdxForeignNetFlow(),
  ]);
  if (eidoHistory.length > 0) await upsertPoints(eidoHistory);
  if (sbnOwnership) await upsertPoints([sbnOwnership]);
  if (idxFlowPoint) await upsertPoints([idxFlowPoint]);

  // Retrieve data
  const currentEido = await getLatestPoint('eido_price');
  const eidoHistory30 = await getLastN('eido_price', 30);
  const prevEido = eidoHistory30.length > 1 ? eidoHistory30[eidoHistory30.length - 2] : null;

  const currentSbn = await getLatestPoint('sbn_foreign_ownership_pct');
  const prevSbn = (await getLastN('sbn_foreign_ownership_pct', 6)).slice(-2)[0] ?? null;

  const currentIdxFlow = await getLatestPoint('idx_foreign_net_buy_idr_bn');
  const prevIdxFlow = (await getLastN('idx_foreign_net_buy_idr_bn', 5)).slice(-2)[0] ?? null;

  const eidoSnap = currentEido ? await buildSnapshot('eido_price', currentEido, prevEido) : null;
  const sbnSnap = currentSbn ? await buildSnapshot('sbn_foreign_ownership_pct', currentSbn, prevSbn) : null;
  const idxFlowSnap = currentIdxFlow ? await buildSnapshot('idx_foreign_net_buy_idr_bn', currentIdxFlow, prevIdxFlow) : null;

  // IHSG vs IDR divergence detection
  // Divergence: EIDO falling (foreign equity exit) while SBN ownership also falling
  // Also trigger on z-score: EIDO z < -1.5 signals structural foreign equity exit
  const eidoRocFalling = (eidoSnap?.roc ?? 0) < -5;
  const eidoZFalling = (eidoSnap?.zScore30d ?? 0) < -1.5;
  const eidoFalling = eidoRocFalling || eidoZFalling;
  const sbnFalling = (sbnSnap?.roc ?? 0) < -3;
  const divergenceFlag = eidoFalling && sbnFalling;

  // Domestic absorption: SBN foreign ownership falls but SBN yields NOT rising sharply
  // Proxy: if foreign SBN falling but no yield spike signal → domestic banks absorbing
  const sbnYield = await getLatestPoint('sbn_10y_yield_pct');
  const prevSbnYield = (await getLastN('sbn_10y_yield_pct', 10)).slice(-2)[0] ?? null;
  const yieldNotSpike = sbnYield && prevSbnYield
    ? Math.abs(sbnYield.value - prevSbnYield.value) < 0.3
    : true;
  const domesticAbsorptionFlag = sbnFalling && yieldNotSpike;

  // IDX daily foreign flow signal
  // Net sell today AND negative trend = active exit
  const idxNetSelling = (currentIdxFlow?.value ?? 0) < -500;       // >500 IDR bn net sell = significant
  const idxNetSellingHeavy = (currentIdxFlow?.value ?? 0) < -2000; // >2T IDR bn = heavy exit

  // Silent exit probability — use worst-case z across 30d (tactical) and 90d (structural)
  const eidoZ30 = eidoSnap?.zScore30d ?? 0;
  const eidoZ90 = eidoSnap?.zScore90d ?? 0;
  // 90d z < -2 = structural 3-month trend; more weight than single 30d spike
  const eidoZ = Math.abs(eidoZ30) >= Math.abs(eidoZ90) ? eidoZ30 : eidoZ90;
  const eidoStructuralTrend = eidoZ90 < -2.0;
  let silentExitProbability = 0.1;
  if (eidoRocFalling) silentExitProbability += 0.20;           // price dropping fast (MoM)
  if (eidoZ < -2.0) silentExitProbability += 0.25;             // 2-sigma z = structural exit
  else if (eidoZ < -1.5) silentExitProbability += 0.15;        // 1.5-sigma = elevated signal
  if (eidoStructuralTrend && !eidoRocFalling) silentExitProbability += 0.05; // 90d drift bonus
  if (sbnFalling) silentExitProbability += 0.25;
  if (idxNetSellingHeavy) silentExitProbability += 0.20;        // direct IDX flow signal
  else if (idxNetSelling) silentExitProbability += 0.10;
  if (domesticAbsorptionFlag) silentExitProbability += 0.10;
  if (divergenceFlag) silentExitProbability += 0.10;
  silentExitProbability = Math.min(0.95, silentExitProbability);

  const validSnapshots = [eidoSnap, sbnSnap, idxFlowSnap].filter((s): s is IndicatorSnapshot => s !== null);
  const score = compositeScore(validSnapshots);
  const alertLevel = alertFromScore(score);
  const flags: string[] = [];
  if (eidoStructuralTrend) flags.push(`EIDO 90d z-score ${eidoZ90.toFixed(2)} — 3-month structural foreign equity selling trend`);
  if (divergenceFlag) flags.push('Dual exit signal: EIDO falling + SBN foreign ownership falling simultaneously');
  if (domesticAbsorptionFlag) flags.push('Domestic absorption suspected: SBN foreign exit not reflected in yields — hidden stress');
  if (idxNetSellingHeavy) flags.push(`IDX heavy foreign net sell: ${currentIdxFlow?.value.toFixed(0)} IDR bn — direct outflow signal`);
  else if (idxNetSelling) flags.push(`IDX foreign net sell: ${currentIdxFlow?.value.toFixed(0)} IDR bn`);
  if (silentExitProbability > 0.6) flags.push(`Silent exit probability elevated: ${(silentExitProbability * 100).toFixed(0)}%`);

  // Sudden stop absolute level threshold (structural, independent of z-score)
  // Historical: SBN foreign ownership peaked ~25% (2019), dropped to ~15% post-COVID.
  // <12% = structural underpinning eroded; <10% = sudden stop risk elevated
  if (currentSbn) {
    const lvl = currentSbn.value;
    if (lvl < 8) {
      flags.push(`SBN foreign ownership CRITICAL: ${lvl.toFixed(1)}% — sudden stop territory (historical post-GFC floor ~10%)`);
      silentExitProbability = Math.min(0.95, silentExitProbability + 0.20);
    } else if (lvl < 10) {
      flags.push(`SBN foreign ownership ${lvl.toFixed(1)}% — sudden stop risk elevated (threshold: 10%; 2019 peak: ~25%)`);
      silentExitProbability = Math.min(0.95, silentExitProbability + 0.12);
    } else if (lvl < 12) {
      flags.push(`SBN foreign ownership ${lvl.toFixed(1)}% — structural exit from historical base; watch for further decline`);
      silentExitProbability = Math.min(0.95, silentExitProbability + 0.05);
    }
  }

  const narrative = buildNarrative({ eidoSnap, sbnSnap, divergenceFlag, domesticAbsorptionFlag, silentExitProbability });

  return {
    scoreCard: {
      module: 'foreign_flow',
      scoreDate: new Date().toISOString().slice(0, 10),
      score,
      alertLevel,
      indicators: validSnapshots,
      narrative,
      flags,
    },
    eidoSnapshot: eidoSnap,
    sbnForeignOwnership: sbnSnap,
    idxFlowSnapshot: idxFlowSnap,
    idxDailyFlow: currentIdxFlow?.value ?? null,
    divergenceFlag,
    domesticAbsorptionFlag,
    silentExitProbability,
    narrative,
  };
}

function buildNarrative(ctx: {
  eidoSnap: IndicatorSnapshot | null;
  sbnSnap: IndicatorSnapshot | null;
  divergenceFlag: boolean;
  domesticAbsorptionFlag: boolean;
  silentExitProbability: number;
}): string {
  const parts: string[] = [];
  if (ctx.eidoSnap) parts.push(`EIDO ETF (foreign equity proxy): $${ctx.eidoSnap.current.toFixed(2)} (${ctx.eidoSnap.roc >= 0 ? '+' : ''}${ctx.eidoSnap.roc.toFixed(1)}% MoM).`);
  if (ctx.sbnSnap) parts.push(`Foreign SBN ownership: ${ctx.sbnSnap.current.toFixed(1)}% (${ctx.sbnSnap.roc >= 0 ? '+' : ''}${ctx.sbnSnap.roc.toFixed(1)}% MoM).`);
  parts.push(`Silent exit probability: ${(ctx.silentExitProbability * 100).toFixed(0)}%.`);
  if (ctx.domesticAbsorptionFlag) parts.push('Domestic absorption masking foreign SBN exit — surface stability may be misleading.');
  return parts.join(' ');
}

function formatOutput(output: ForeignFlowOutput): string {
  return [
    `# Foreign Flow Engine — Indonesia`,
    `**Date:** ${output.scoreCard.scoreDate}`,
    `**Alert:** ${alertLabel(output.scoreCard.alertLevel)} | **Silent Exit Probability:** ${(output.silentExitProbability * 100).toFixed(0)}%`,
    ``,
    `## Summary`,
    output.narrative,
    ``,
    `## Flow Indicators`,
    `| Indicator | Current | MoM Δ | 30d Z-Score | Alert |`,
    `|-----------|---------|--------|-------------|-------|`,
    ...output.scoreCard.indicators.map((s) =>
      `| ${s.indicator} | ${s.current.toFixed(2)} ${s.unit} | ${s.roc >= 0 ? '+' : ''}${s.roc.toFixed(2)}% | ${s.zScore30d?.toFixed(2) ?? 'n/a'} | ${s.alertLevel.toUpperCase()} |`,
    ),
    ``,
    `## Detection Flags`,
    `| Signal | Status |`,
    `|--------|--------|`,
    `| IDX daily foreign net flow | ${output.idxDailyFlow !== null ? `${output.idxDailyFlow >= 0 ? '+' : ''}${output.idxDailyFlow.toFixed(0)} IDR bn` : 'n/a (IDX API unavailable)'} |`,
    `| Dual exit (EIDO + SBN simultaneously falling) | ${output.divergenceFlag ? '⚠️ ACTIVE' : 'No'} |`,
    `| Domestic absorption masking foreign exit | ${output.domesticAbsorptionFlag ? '⚠️ ACTIVE' : 'No'} |`,
    ``,
    output.scoreCard.flags.length > 0 ? `## Flags\n${output.scoreCard.flags.map((f) => `- ⚠️ ${f}`).join('\n')}` : '',
    ``,
    `_EIDO = iShares MSCI Indonesia ETF (equity demand proxy). IDX flow = daily foreign net buy/sell on IDX equity. SBN ownership = DJPPR._`,
    `_For institutional flow data, configure Bloomberg (BLOOMBERG_API_URL) for actual SBN/equity flow figures._`,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

export const foreignFlowEngine = new DynamicStructuredTool({
  name: 'foreign_flow_engine',
  description:
    'Foreign Flow Engine: detects silent foreign capital exit from Indonesia via EIDO ETF (equity proxy) and SBN foreign ownership. Identifies domestic absorption masking and divergence signals.',
  schema: z.object({
    query: z.string().describe('e.g. "Are foreigners leaving?" or "Show capital flow risk" or "Explain IHSG stable + IDR weak"'),
  }),
  func: async (_input) => {
    try {
      const output = await runForeignFlowEngine();
      return formatToolResult(
        { analysis: formatOutput(output), raw: output },
        ['https://finance.yahoo.com', 'https://www.djppr.kemenkeu.go.id'],
      );
    } catch (error) {
      return formatToolResult({ error: error instanceof Error ? error.message : String(error) });
    }
  },
});
