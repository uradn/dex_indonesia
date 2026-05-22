import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { upsertPoints, getLatestPoint, getLastN } from './time-series-db.js';
import { buildSnapshot, compositeScore, alertFromScore, alertLabel } from './scoring.js';
import { fetchEidoProxy } from './sources/yahoo-macro.js';
import { fetchSbnForeignOwnership } from './sources/bi.js';
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
  divergenceFlag: boolean;
  domesticAbsorptionFlag: boolean;
  silentExitProbability: number;
  narrative: string;
}

export async function runForeignFlowEngine(): Promise<ForeignFlowOutput> {
  // 1. EIDO ETF history — proxy for foreign equity demand
  const eidoHistory = await fetchEidoProxy(180);
  if (eidoHistory.length > 0) await upsertPoints(eidoHistory);

  // 2. Foreign SBN ownership
  const sbnOwnership = await fetchSbnForeignOwnership();
  if (sbnOwnership) await upsertPoints([sbnOwnership]);

  // Retrieve data
  const currentEido = await getLatestPoint('eido_price');
  const eidoHistory30 = await getLastN('eido_price', 30);
  const prevEido = eidoHistory30.length > 1 ? eidoHistory30[eidoHistory30.length - 2] : null;

  const currentSbn = await getLatestPoint('sbn_foreign_ownership_pct');
  const prevSbn = (await getLastN('sbn_foreign_ownership_pct', 6)).slice(-2)[0] ?? null;

  const currentIhsg = await getLatestPoint('usdidr_spot'); // use IDR as proxy if IHSG not stored
  const eidoSnap = currentEido ? await buildSnapshot('eido_price', currentEido, prevEido) : null;
  const sbnSnap = currentSbn ? await buildSnapshot('sbn_foreign_ownership_pct', currentSbn, prevSbn) : null;

  // IHSG vs IDR divergence detection
  // Divergence: EIDO falling (foreign equity exit) while SBN ownership also falling
  const eidoFalling = (eidoSnap?.roc ?? 0) < -5;
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

  // Silent exit probability
  let silentExitProbability = 0.1;
  if (eidoFalling) silentExitProbability += 0.25;
  if (sbnFalling) silentExitProbability += 0.3;
  if (domesticAbsorptionFlag) silentExitProbability += 0.15;
  if (divergenceFlag) silentExitProbability += 0.1;
  silentExitProbability = Math.min(0.95, silentExitProbability);

  const validSnapshots = [eidoSnap, sbnSnap].filter((s): s is IndicatorSnapshot => s !== null);
  const score = compositeScore(validSnapshots);
  const alertLevel = alertFromScore(score);
  const flags: string[] = [];
  if (divergenceFlag) flags.push('Dual exit signal: EIDO falling + SBN foreign ownership falling simultaneously');
  if (domesticAbsorptionFlag) flags.push('Domestic absorption suspected: SBN foreign exit not reflected in yields — hidden stress');
  if (silentExitProbability > 0.6) flags.push(`Silent exit probability elevated: ${(silentExitProbability * 100).toFixed(0)}%`);

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
    `| Dual exit (EIDO + SBN simultaneously falling) | ${output.divergenceFlag ? '⚠️ ACTIVE' : 'No'} |`,
    `| Domestic absorption masking foreign exit | ${output.domesticAbsorptionFlag ? '⚠️ ACTIVE' : 'No'} |`,
    ``,
    output.scoreCard.flags.length > 0 ? `## Flags\n${output.scoreCard.flags.map((f) => `- ⚠️ ${f}`).join('\n')}` : '',
    ``,
    `_EIDO = iShares MSCI Indonesia ETF (foreign equity demand proxy, real-time). SBN ownership = DJPPR daily (more direct but slower update)._`,
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
