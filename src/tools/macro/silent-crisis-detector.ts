/**
 * Big Short Mode — Silent Crisis Probability Detector.
 *
 * Aggregates all 8 module scores into a unified Silent Crisis Probability.
 * Uses Bayesian-inspired weighted combination with non-linear amplification
 * when multiple modules signal stress simultaneously.
 *
 * Core insight: A single module at RED may be noise.
 * Two modules at ORANGE = structural deterioration.
 * Three+ modules at ORANGE/RED = systemic fragility emerging.
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { alertFromScore, alertLabel } from './scoring.js';
import { runFxDefenseEngine } from './fx-defense-engine.js';
import { runBoPEngine } from './bop-engine.js';
import { runSovereignRiskEngine } from './sovereign-risk-engine.js';
import { runForeignFlowEngine } from './foreign-flow-engine.js';
import { runCommodityEngine } from './commodity-engine.js';
import { runRegimeEngine } from './regime-engine.js';
import { runNarrativeDivergenceEngine } from './narrative-divergence-engine.js';
import { runBankingStressEngine } from './banking-stress-engine.js';
import { runMarketStressEngine } from './market-stress-engine.js';
import { runFiscalEngine } from './fiscal-engine.js';
import { runDomesticPressureEngine } from './domestic-pressure-engine.js';
import { runPoliticalRiskEngine } from './political-risk-engine.js';
import type { AlertLevel } from './types.js';

export const SILENT_CRISIS_DESCRIPTION = `
MACRO INTELLIGENCE — Big Short Mode / Silent Crisis Detector

Aggregates all 10 macro module scores into a unified Silent Crisis Probability for Indonesia.

Detects:
- Delayed repricing: fundamentals deteriorating but markets not yet repriced
- Fake stability: surface calm hiding structural fragility
- Sovereign fragility: multiple stress signals converging
- Balance sheet mismatch: reserves insufficient vs external liabilities
- Funding dependency: reliance on hot money to fund deficits
- Convexity risk: non-linear deterioration acceleration

Scores:
- Silent Crisis Probability (0-100%)
- Synthetic Stability Score (0-100; 0=genuine stability, 100=fake stability)
- Overall alert level: GREEN / YELLOW / ORANGE / RED

Key principle: signals that confirm each other across unrelated markets are the most dangerous.

## When to Use

- "Run the big short analysis"
- "Show overall Indonesia macro risk"
- "Silent crisis check"
- "Full sovereign stress report"
`.trim();

interface ModuleScore {
  module: string;
  score: number;
  alertLevel: AlertLevel;
  available: boolean;
}

interface SilentCrisisOutput {
  date: string;
  silentCrisisProbability: number;
  syntheticStabilityScore: number;
  alertLevel: AlertLevel;
  moduleScores: ModuleScore[];
  crossConfirmationCount: number;
  keyFlags: string[];
  stressVectors: string[];
  narrative: string;
}

// Alert level → numeric stress weight
const ALERT_WEIGHTS: Record<AlertLevel, number> = {
  green: 0, yellow: 25, orange: 60, red: 100,
};

// Module importance weights (normalised in composite calculation)
const MODULE_WEIGHTS: Record<string, number> = {
  fx_defense:          0.18,
  bop:                 0.18,
  sovereign_risk:      0.14,
  foreign_flow:        0.14,
  banking:             0.10,  // NPL/LDR/CAR/JIBOR + IHPR + sector NPL
  commodity:           0.09,
  fiscal:              0.08,  // APBN realisasi vs target — revenue shortfall + deficit risk
  market:              0.07,  // IHSG P/E + breadth — valuation disconnect signal
  domestic_pressure:   0.08,  // food CPI early warning — upstream feed for CPI/BI rate chain
  political_risk:      0.06,  // unemployment + social unrest + governance stability
  regime:              0.03,
  narrative:           0.02,
};

async function getModuleScores(): Promise<ModuleScore[]> {
  const scores: ModuleScore[] = [];

  const runners: Array<{ module: string; run: () => Promise<{ score: number; alertLevel: AlertLevel }> }> = [
    { module: 'fx_defense', run: async () => { const r = await runFxDefenseEngine(); return { score: r.scoreCard.score, alertLevel: r.scoreCard.alertLevel }; } },
    { module: 'bop',        run: async () => { const r = await runBoPEngine();       return { score: r.scoreCard.score, alertLevel: r.scoreCard.alertLevel }; } },
    { module: 'sovereign_risk', run: async () => { const r = await runSovereignRiskEngine(); return { score: r.sovereignRiskScore, alertLevel: r.scoreCard.alertLevel }; } },
    { module: 'foreign_flow',   run: async () => { const r = await runForeignFlowEngine();  return { score: r.scoreCard.score, alertLevel: r.scoreCard.alertLevel }; } },
    { module: 'commodity',  run: async () => { const r = await runCommodityEngine();  return { score: r.scoreCard.score, alertLevel: r.scoreCard.alertLevel }; } },
    { module: 'regime',     run: async () => { const r = await runRegimeEngine();     const s = r.currentRegime === 'Q3' ? 80 : r.currentRegime === 'Q4' ? 55 : r.currentRegime === 'Q2' ? 30 : 10; return { score: s, alertLevel: r.alertLevel }; } },
    { module: 'narrative',  run: async () => { const r = await runNarrativeDivergenceEngine(); return { score: 100 - r.narrativeCredibilityScore, alertLevel: r.alertLevel }; } },
    { module: 'banking',            run: async () => { const r = await runBankingStressEngine(); return { score: r.stressScore, alertLevel: r.alert }; } },
    { module: 'market',             run: async () => { const r = await runMarketStressEngine(); return { score: r.stressScore, alertLevel: r.alert }; } },
    { module: 'fiscal',             run: async () => { const r = await runFiscalEngine(); return { score: r.stressScore, alertLevel: r.alert }; } },
    { module: 'domestic_pressure',  run: async () => { const r = await runDomesticPressureEngine(); return { score: r.stressScore, alertLevel: r.alert }; } },
    { module: 'political_risk',     run: async () => { const r = await runPoliticalRiskEngine();   return { score: r.stressScore, alertLevel: r.alert }; } },
  ];

  await Promise.allSettled(
    runners.map(async ({ module, run }) => {
      try {
        const result = await run();
        scores.push({ module, score: result.score, alertLevel: result.alertLevel, available: true });
      } catch {
        scores.push({ module, score: 0, alertLevel: 'green', available: false });
      }
    }),
  );

  // Ensure consistent ordering
  const order = ['fx_defense', 'bop', 'sovereign_risk', 'foreign_flow', 'banking', 'commodity', 'fiscal', 'market', 'domestic_pressure', 'political_risk', 'regime', 'narrative'];
  scores.sort((a, b) => order.indexOf(a.module) - order.indexOf(b.module));

  return scores;
}

async function runSilentCrisisDetector(): Promise<SilentCrisisOutput> {
  const moduleScores = await getModuleScores();

  // Weighted composite score
  let weightedSum = 0;
  let totalWeight = 0;
  for (const ms of moduleScores) {
    if (!ms.available) continue;
    const weight = MODULE_WEIGHTS[ms.module] ?? 0.05;
    weightedSum += ms.score * weight;
    totalWeight += weight;
  }
  const baseScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Cross-confirmation amplifier: non-linear boost when multiple modules stressed
  const stressedCount = moduleScores.filter((m) => m.alertLevel === 'orange' || m.alertLevel === 'red').length;
  const crossConfirmationMultiplier = stressedCount >= 5 ? 1.4 : stressedCount >= 4 ? 1.3 : stressedCount >= 3 ? 1.2 : stressedCount >= 2 ? 1.1 : 1.0;
  const silentCrisisProbability = Math.min(100, Math.round(baseScore * crossConfirmationMultiplier));

  // Synthetic Stability Score: surface calm contradicting underlying stress
  // Two triggers:
  //   A) Traditional: official narrative spin (narrative>50) + financial stress underneath
  //   B) NEW: political/social stress (political_risk>50) while financial markets calm
  //      — political leads financial by 2-3 quarters historically
  const narrativeModule = moduleScores.find((m) => m.module === 'narrative');
  const fxModule = moduleScores.find((m) => m.module === 'fx_defense');
  const politicalModule = moduleScores.find((m) => m.module === 'political_risk');

  const FINANCIAL_MODULE_SET = new Set(['fx_defense', 'bop', 'sovereign_risk', 'foreign_flow', 'banking', 'commodity', 'fiscal', 'market']);
  const financialScores = moduleScores.filter((m) => FINANCIAL_MODULE_SET.has(m.module) && m.available);
  const financialAvg = financialScores.length > 0
    ? financialScores.reduce((s, m) => s + m.score, 0) / financialScores.length
    : 50;

  const politicalScore = politicalModule?.score ?? 0;
  const politicalLeadingFinancial = politicalScore > 50 && financialAvg < 35;
  const highNarrativeScore = (narrativeModule?.score ?? 0) > 50;
  const stressUnderneath = (fxModule?.score ?? 0) > 40 || stressedCount >= 2;
  const traditionalSynthetic = highNarrativeScore && stressUnderneath;

  const syntheticStabilityScore = (politicalLeadingFinancial || traditionalSynthetic)
    ? Math.min(100, Math.round(silentCrisisProbability * 1.3 + politicalScore * 0.25))
    : Math.round(silentCrisisProbability * 0.5);

  const alertLevel = alertFromScore(silentCrisisProbability);

  // Stress vectors — which modules are driving
  const stressVectors = moduleScores
    .filter((m) => m.available && (m.alertLevel === 'orange' || m.alertLevel === 'red'))
    .sort((a, b) => b.score - a.score)
    .map((m) => `${m.module.replace('_', ' ')} [${m.alertLevel.toUpperCase()} ${m.score}/100]`);

  const keyFlags: string[] = [];
  if (stressedCount >= 3) keyFlags.push(`CROSS-CONFIRMATION: ${stressedCount}/12 modules signaling stress simultaneously — non-linear risk elevated`);
  if (politicalLeadingFinancial) keyFlags.push(`POLITICAL-FINANCIAL DIVERGENCE: political risk ${politicalScore}/100 ORANGE while financial modules avg ${Math.round(financialAvg)}/100 — social contract stress not yet priced by markets (typically leads financial repricing by 2-3 quarters)`);
  if (syntheticStabilityScore > 40) keyFlags.push(`SYNTHETIC STABILITY (${syntheticStabilityScore}/100): surface calm contradicts structural stress — watch for political → financial transmission`);
  if (silentCrisisProbability > 70) keyFlags.push('SYSTEMIC FRAGILITY: silent crisis probability critical — institutional positioning review warranted');

  const narrative = buildNarrative({ silentCrisisProbability, syntheticStabilityScore, stressedCount, stressVectors, alertLevel });

  return {
    date: new Date().toISOString().slice(0, 10),
    silentCrisisProbability,
    syntheticStabilityScore,
    alertLevel,
    moduleScores,
    crossConfirmationCount: stressedCount,
    keyFlags,
    stressVectors,
    narrative,
  };
}

function buildNarrative(ctx: {
  silentCrisisProbability: number;
  syntheticStabilityScore: number;
  stressedCount: number;
  stressVectors: string[];
  alertLevel: AlertLevel;
}): string {
  const parts: string[] = [];
  parts.push(`Silent Crisis Probability: ${ctx.silentCrisisProbability}% (${ctx.alertLevel.toUpperCase()}).`);
  if (ctx.stressedCount > 0) {
    parts.push(`${ctx.stressedCount} module(s) in stress zone: ${ctx.stressVectors.slice(0, 3).join(', ')}.`);
  } else {
    parts.push('No modules currently in stress zone — macro environment stable.');
  }
  if (ctx.syntheticStabilityScore > 40) {
    parts.push(`Synthetic Stability Score ${ctx.syntheticStabilityScore}/100 — surface calm may be deceptive; political stress not yet transmitted to financial markets.`);
  }
  return parts.join(' ');
}

function formatOutput(output: SilentCrisisOutput): string {
  return [
    `# Big Short Mode — Indonesia Silent Crisis Detector`,
    `**Date:** ${output.date}`,
    `**Alert:** ${alertLabel(output.alertLevel)}`,
    ``,
    `## Crisis Probability Matrix`,
    `| Metric | Score |`,
    `|--------|-------|`,
    `| **Silent Crisis Probability** | **${output.silentCrisisProbability}%** |`,
    `| Synthetic Stability Score | ${output.syntheticStabilityScore}/100 |`,
    `| Cross-Confirmed Stress Modules | ${output.crossConfirmationCount}/12 |`,
    ``,
    `## Module Scorecard`,
    `| Module | Score | Alert | Available |`,
    `|--------|-------|-------|-----------|`,
    ...output.moduleScores.map((m) =>
      `| ${m.module.replace(/_/g, ' ')} | ${m.score}/100 | ${m.alertLevel.toUpperCase()} | ${m.available ? '✓' : '✗'} |`,
    ),
    ``,
    output.stressVectors.length > 0 ? `## Active Stress Vectors\n${output.stressVectors.map((v) => `- ${v}`).join('\n')}` : '',
    ``,
    output.keyFlags.length > 0 ? `## Critical Flags\n${output.keyFlags.map((f) => `- 🚨 ${f}`).join('\n')}` : '',
    ``,
    `## Summary`,
    output.narrative,
    ``,
    `---`,
    `_Non-linear amplification active: 2 stressed modules = 1.1x, 3 = 1.25x, 4+ = 1.4x multiplier on base score._`,
    `_For full accuracy, configure Bloomberg (CDS, EMBI, SBN yield) and BPS API (trade data)._`,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

export const silentCrisisDetector = new DynamicStructuredTool({
  name: 'silent_crisis_detector',
  description:
    'Big Short Mode: aggregates all 8 macro module scores into a unified Silent Crisis Probability for Indonesia. Detects fake stability, cross-confirmed stress, and non-linear deterioration acceleration. Outputs institutional sovereign stress report.',
  schema: z.object({
    query: z.string().describe('e.g. "Run big short analysis" or "Full sovereign stress report" or "Silent crisis check"'),
  }),
  func: async (_input) => {
    try {
      const output = await runSilentCrisisDetector();
      return formatToolResult(
        { analysis: formatOutput(output), raw: output },
        [],
      );
    } catch (error) {
      return formatToolResult({ error: error instanceof Error ? error.message : String(error) });
    }
  },
});
