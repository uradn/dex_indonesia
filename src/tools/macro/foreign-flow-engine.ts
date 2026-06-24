import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { upsertPoints, getLatestPoint, getLastN } from './time-series-db.js';
import { buildSnapshot, compositeScore, alertFromScore, alertLabel } from './scoring.js';
import { fetchEidoProxy } from './sources/yahoo-macro.js';
import { fetchSbnForeignOwnership } from './sources/bi.js';
import { fetchIdxForeignNetFlow } from './sources/idx.js';
import { fetchMsciClassification } from './sources/msci-classification.js';
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

interface SsviComponents {
  sbnOwnership: number;   // 0-100 sub-score
  eidoTrend: number;      // 0-100 sub-score
  uipCarry: number;       // 0-100 sub-score
  reserveAdequacy: number; // 0-100 sub-score
}

interface SuddenStopVulnerability {
  index: number;
  phase: 'low' | 'watch' | 'elevated' | 'imminent';
  components: SsviComponents;
  realCarryPct: number | null;   // informational
  ggRatio: number | null;        // informational
}

interface ForeignFlowOutput {
  scoreCard: ModuleScoreCard;
  eidoSnapshot: IndicatorSnapshot | null;
  sbnForeignOwnership: IndicatorSnapshot | null;
  idxFlowSnapshot: IndicatorSnapshot | null;
  idxDailyFlow: number | null;    // IDR bn, positive = net buy, negative = net sell
  divergenceFlag: boolean;
  domesticAbsorptionFlag: boolean;
  silentExitProbability: number;
  suddenStop: SuddenStopVulnerability | null;
  msciClassificationRisk: 'confirmed' | 'under_review' | 'downgrade_risk';
  narrative: string;
}

// ─── SSVI sub-scorers (R&R Ch.15 — Sudden Stop, Calvo 1998) ──────────────────

function scoreSbnOwnership(lvl: number | null): number {
  if (lvl === null) return 40; // unknown → conservative
  if (lvl > 15) return 0;
  if (lvl > 12) return 25;
  if (lvl > 10) return 50;
  if (lvl > 8)  return 75;
  return 100;
}

function scoreEidoTrend(z90: number): number {
  if (z90 > -1.0) return 0;
  if (z90 > -1.5) return 20;
  if (z90 > -2.0) return 50;
  if (z90 > -3.0) return 75;
  return 100;
}

function scoreUipCarry(realCarry: number | null): number {
  if (realCarry === null) return 30; // unknown → slightly elevated (carry risk always latent)
  if (realCarry > 3.0)  return 0;
  if (realCarry > 1.0)  return 20;
  if (realCarry > 0.0)  return 50;
  if (realCarry > -2.0) return 75;
  return 100;
}

function scoreGg(gg: number | null): number {
  if (gg === null) return 30; // unknown → conservative
  if (gg >= 2.0)  return 0;
  if (gg >= 1.5)  return 25;
  if (gg >= 1.0)  return 60;
  return 100;
}

function computeSsvi(components: SsviComponents): { index: number; phase: SuddenStopVulnerability['phase'] } {
  const index = Math.round(
    components.sbnOwnership  * 0.30 +
    components.uipCarry      * 0.25 +
    components.eidoTrend     * 0.25 +
    components.reserveAdequacy * 0.20,
  );
  const phase: SuddenStopVulnerability['phase'] =
    index >= 75 ? 'imminent' :
    index >= 50 ? 'elevated' :
    index >= 25 ? 'watch'    : 'low';
  return { index, phase };
}

export async function runForeignFlowEngine(): Promise<ForeignFlowOutput> {
  // MSCI classification risk — auto-detected via Exa/Tavily after Jun 23 result date.
  // Falls back to env var MSCI_CLASSIFICATION_STATUS if search unavailable.
  // 'confirmed': EM status secure | 'under_review': evaluation ongoing | 'downgrade_risk': downgrade likely
  // MSCI_MAY2026_REBALANCING_OUTFLOW_USD_BN: passive outflow from May 29 rebalancing (19 cos removed)
  const msciResult = await fetchMsciClassification();
  const msciStatus = msciResult.status;
  const msciRebalancingOutflowUsd = process.env.MSCI_MAY2026_REBALANCING_OUTFLOW_USD_BN
    ? parseFloat(process.env.MSCI_MAY2026_REBALANCING_OUTFLOW_USD_BN)
    : null;

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

  // SSVI additional DB reads — no new fetches, all cross-fed from other engines
  const [ust10yFromDb, ggFromDb, idrHistory90] = await Promise.all([
    getLatestPoint('ust_10y_yield_pct'),
    getLatestPoint('greenspan_guidotti'),
    getLastN('usdidr_spot', 90),
  ]);
  const idrCurrent = await getLatestPoint('usdidr_spot');

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

  // ── SSVI (Sudden Stop Vulnerability Index) ────────────────────────
  // R&R Ch.15 Calvo sudden stop: abrupt cessation of capital inflows when
  // carry unwinds + SBN ownership cliff + reserve buffer thin simultaneously
  const sbn10yVal = sbnYield?.value ?? null;
  const ust10yVal = ust10yFromDb?.value ?? null;
  const carrySpread = sbn10yVal !== null && ust10yVal !== null ? sbn10yVal - ust10yVal : null;

  let realCarryPct: number | null = null;
  if (idrCurrent && idrHistory90.length >= 10) {
    const oldest = idrHistory90[0]!;
    const daysBetween = (Date.parse(idrCurrent.date) - Date.parse(oldest.date)) / 86_400_000;
    if (daysBetween >= 14) {
      const idr3mAnnualized = ((idrCurrent.value - oldest.value) / oldest.value) * (365 / daysBetween) * 100;
      realCarryPct = carrySpread !== null ? parseFloat((carrySpread - idr3mAnnualized).toFixed(2)) : null;
    }
  }

  const ggRatio = ggFromDb?.value ?? null;
  const sbnLvl = currentSbn?.value ?? null;

  const ssviComponents: SsviComponents = {
    sbnOwnership:    scoreSbnOwnership(sbnLvl),
    eidoTrend:       scoreEidoTrend(eidoZ90),
    uipCarry:        scoreUipCarry(realCarryPct),
    reserveAdequacy: scoreGg(ggRatio),
  };
  const { index: ssviIndex, phase: ssviPhase } = computeSsvi(ssviComponents);
  const suddenStop: SuddenStopVulnerability = { index: ssviIndex, phase: ssviPhase, components: ssviComponents, realCarryPct, ggRatio };

  // SSVI → silent exit probability bump + alert floor
  if (ssviIndex >= 75) silentExitProbability = Math.min(0.95, silentExitProbability + 0.15);
  else if (ssviIndex >= 50) silentExitProbability = Math.min(0.95, silentExitProbability + 0.08);
  silentExitProbability = Math.min(0.95, silentExitProbability);

  const validSnapshots = [eidoSnap, sbnSnap, idxFlowSnap].filter((s): s is IndicatorSnapshot => s !== null);
  const baseScore = compositeScore(validSnapshots);
  // MSCI classification risk score bump.
  //   downgrade_risk: +20 (forced-sell tail).
  //   under_review: +8 (passive fund uncertainty paralysis).
  //   confirmed: +3 if Nov 2026 re-assessment <60d away (overhang re-emerges) else 0.
  // Indonesia EM status maintained Jun 23 2026 but MSCI extended review to Nov 2026
  // — reforms must demonstrate progress (free-float, transparency, anti-coordinated trading).
  const NEXT_MSCI_REVIEW = new Date('2026-11-12');
  const daysToNextMsciReview = Math.round((NEXT_MSCI_REVIEW.getTime() - Date.now()) / 86_400_000);
  let msciScoreBump = 0;
  if (msciStatus === 'downgrade_risk') msciScoreBump = 20;
  else if (msciStatus === 'under_review') msciScoreBump = 8;
  else if (msciStatus === 'confirmed' && daysToNextMsciReview > 0 && daysToNextMsciReview < 60) msciScoreBump = 3;
  // SSVI alert floor: imminent (≥75) → orange min; critical (≥90) → red min
  const ALERT_ORDER: AlertLevel[] = ['green', 'yellow', 'orange', 'red'];
  const ssviFloorAlert: AlertLevel = ssviIndex >= 90 ? 'red' : ssviIndex >= 75 ? 'orange' : ssviIndex >= 50 ? 'yellow' : 'green';
  const score = Math.min(100, (ssviIndex >= 75 ? Math.max(baseScore, 50) : baseScore) + msciScoreBump);
  const alertLevel = ALERT_ORDER[Math.max(ALERT_ORDER.indexOf(alertFromScore(score)), ALERT_ORDER.indexOf(ssviFloorAlert))]!;
  const flags: string[] = [];
  if (eidoStructuralTrend) flags.push(`EIDO 90d z-score ${eidoZ90.toFixed(2)} — 3-month structural foreign equity selling trend`);
  if (divergenceFlag) flags.push('Dual exit signal: EIDO falling + SBN foreign ownership falling simultaneously');
  if (domesticAbsorptionFlag) flags.push('Domestic absorption suspected: SBN foreign exit not reflected in yields — hidden stress');
  if (idxNetSellingHeavy) flags.push(`IDX heavy foreign net sell: ${currentIdxFlow?.value.toFixed(0)} IDR bn — direct outflow signal`);
  else if (idxNetSelling) flags.push(`IDX foreign net sell: ${currentIdxFlow?.value.toFixed(0)} IDR bn`);
  if (silentExitProbability > 0.6) flags.push(`Silent exit probability elevated: ${(silentExitProbability * 100).toFixed(0)}%`);

  if (ssviPhase === 'imminent') {
    flags.push(`SUDDEN STOP IMMINENT (SSVI ${ssviIndex}/100): SBN cliff + carry unwind + reserve thin simultaneously — Calvo sudden stop conditions met [R&R Ch.15]`);
  } else if (ssviPhase === 'elevated') {
    flags.push(`Sudden stop vulnerability ELEVATED (SSVI ${ssviIndex}/100): ${ssviComponents.uipCarry >= 50 ? 'carry thinning ' : ''}${ssviComponents.sbnOwnership >= 50 ? 'SBN ownership at risk ' : ''}${ssviComponents.eidoTrend >= 50 ? 'EIDO structural exit' : ''}`);
  }

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

  // MSCI classification flags
  if (msciStatus === 'under_review') {
    flags.push(`MSCI classification under review: passive fund uncertainty elevated (+8 score)`);
    if (idxNetSellingHeavy) flags.push('MSCI uncertainty amplifying foreign equity exit — EIDO weakness = sentiment + passive repositioning (dual cause)');
  } else if (msciStatus === 'downgrade_risk') {
    flags.push('CRITICAL: MSCI Frontier downgrade risk — systematic EM fund forced-sell would dwarf May 2026 rebalancing (+20 score)');
  } else if (msciStatus === 'confirmed' && daysToNextMsciReview > 0) {
    const bumpNote = msciScoreBump > 0 ? ` (+${msciScoreBump} score, <60d window)` : '';
    flags.push(`MSCI Nov 2026 overhang: EM maintained Jun 23 but review extended ${daysToNextMsciReview}d ahead — reforms tracked: free-float compliance, shareholding transparency, anti-coordinated trading${bumpNote}`);
  }
  if (msciRebalancingOutflowUsd !== null) {
    flags.push(`MSCI May 29 rebalancing: ~$${msciRebalancingOutflowUsd}bn passive outflow (19 companies removed) — explains part of EIDO weakness; classification result Jun 23 (watch: frontier downgrade = forced-sell > May rebalancing magnitude)`);
  }

  const narrative = buildNarrative({ eidoSnap, sbnSnap, divergenceFlag, domesticAbsorptionFlag, silentExitProbability, ssviIndex, ssviPhase });

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
    suddenStop,
    msciClassificationRisk: msciStatus,
    narrative,
  };
}

function buildNarrative(ctx: {
  eidoSnap: IndicatorSnapshot | null;
  sbnSnap: IndicatorSnapshot | null;
  divergenceFlag: boolean;
  domesticAbsorptionFlag: boolean;
  silentExitProbability: number;
  ssviIndex: number;
  ssviPhase: SuddenStopVulnerability['phase'];
}): string {
  const parts: string[] = [];
  if (ctx.eidoSnap) parts.push(`EIDO ETF (foreign equity proxy): $${ctx.eidoSnap.current.toFixed(2)} (${ctx.eidoSnap.roc >= 0 ? '+' : ''}${ctx.eidoSnap.roc.toFixed(1)}% MoM).`);
  if (ctx.sbnSnap) parts.push(`Foreign SBN ownership: ${ctx.sbnSnap.current.toFixed(1)}% (${ctx.sbnSnap.roc >= 0 ? '+' : ''}${ctx.sbnSnap.roc.toFixed(1)}% MoM).`);
  parts.push(`Silent exit probability: ${(ctx.silentExitProbability * 100).toFixed(0)}%.`);
  parts.push(`Sudden Stop Vulnerability: ${ctx.ssviIndex}/100 [${ctx.ssviPhase.toUpperCase()}].`);
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
    `| MSCI EM classification status | ${output.msciClassificationRisk === 'downgrade_risk' ? '🔴 DOWNGRADE RISK' : output.msciClassificationRisk === 'under_review' ? '⚠️ UNDER REVIEW' : '✅ CONFIRMED'} |`,
    ``,
    output.scoreCard.flags.length > 0 ? `## Flags\n${output.scoreCard.flags.map((f) => `- ⚠️ ${f}`).join('\n')}` : '',
    ``,
    output.suddenStop !== null ? [
      `## Sudden Stop Vulnerability Index (R&R Ch.15 — Calvo)`,
      `**SSVI: ${output.suddenStop.index}/100 — Phase: ${output.suddenStop.phase.toUpperCase()}**`,
      `| Component | Sub-score | Value |`,
      `|-----------|-----------|-------|`,
      `| SBN foreign ownership cliff | ${output.suddenStop.components.sbnOwnership}/100 | ${output.sbnForeignOwnership?.current.toFixed(1) ?? 'n/a'}% |`,
      `| UIP real carry | ${output.suddenStop.components.uipCarry}/100 | ${output.suddenStop.realCarryPct !== null ? (output.suddenStop.realCarryPct >= 0 ? '+' : '') + output.suddenStop.realCarryPct.toFixed(2) + 'pp' : 'n/a'} |`,
      `| EIDO 90d structural trend | ${output.suddenStop.components.eidoTrend}/100 | z90d via EIDO snapshot |`,
      `| Reserve adequacy (GG ratio) | ${output.suddenStop.components.reserveAdequacy}/100 | ${output.suddenStop.ggRatio?.toFixed(2) ?? 'n/a (run uln_engine)'} |`,
      `_Sudden stop (Calvo 1998): abrupt capital inflow reversal when carry unwinds + SBN cliff + thin reserves simultaneously. Weights: SBN 0.30 | Carry 0.25 | EIDO 0.25 | GG 0.20. Alert floor: SSVI ≥75 = ORANGE, ≥90 = RED._`,
      ``,
    ].join('\n') : '',
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
