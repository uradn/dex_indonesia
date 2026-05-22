/**
 * Big Short Mode — Silent Crisis Probability Detector.
 *
 * Aggregates all 7 module scores into a unified Silent Crisis Probability.
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
import type { AlertLevel } from './types.js';

export const SILENT_CRISIS_DESCRIPTION = `
MACRO INTELLIGENCE — Big Short Mode / Silent Crisis Detector

Aggregates all macro module scores into a unified Silent Crisis Probability for Indonesia.

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

// Module importance weights (sum to 1.0)
const MODULE_WEIGHTS: Record<string, number> = {
  fx_defense:         0.25,
  bop:                0.20,
  sovereign_risk:     0.20,
  foreign_flow:       0.15,
  commodity:          0.10,
  regime:             0.05,
  narrative:          0.05,
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
  const order = ['fx_defense', 'bop', 'sovereign_risk', 'foreign_flow', 'commodity', 'regime', 'narrative'];
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
  const crossConfirmationMultiplier = stressedCount >= 4 ? 1.4 : stressedCount >= 3 ? 1.25 : stressedCount >= 2 ? 1.1 : 1.0;
  const silentCrisisProbability = Math.min(100, Math.round(baseScore * crossConfirmationMultiplier));

  // Synthetic Stability Score: how much surface calm contradicts underlying stress
  // High score = official narrative stable but market signals deteriorating
  const narrativeModule = moduleScores.find((m) => m.module === 'narrative');
  const fxModule = moduleScores.find((m) => m.module === 'fx_defense');
  const highNarrativeScore = (narrativeModule?.score ?? 0) > 50;
  const stressUnderneath = (fxModule?.score ?? 0) > 40 || stressedCount >= 2;
  const syntheticStabilityScore = highNarrativeScore && stressUnderneath
    ? Math.min(100, Math.round(silentCrisisProbability * 1.2))
    : Math.round(silentCrisisProbability * 0.5);

  const alertLevel = alertFromScore(silentCrisisProbability);

  // Stress vectors — which modules are driving
  const stressVectors = moduleScores
    .filter((m) => m.available && (m.alertLevel === 'orange' || m.alertLevel === 'red'))
    .sort((a, b) => b.score - a.score)
    .map((m) => `${m.module.replace('_', ' ')} [${m.alertLevel.toUpperCase()} ${m.score}/100]`);

  const keyFlags: string[] = [];
  if (stressedCount >= 3) keyFlags.push(`CROSS-CONFIRMATION: ${stressedCount} modules signaling stress simultaneously — non-linear risk elevated`);
  if (syntheticStabilityScore > 60) keyFlags.push('SYNTHETIC STABILITY: surface indicators calm while structural deterioration accelerates underneath');
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
  if (ctx.syntheticStabilityScore > 50) {
    parts.push(`Synthetic Stability Score elevated (${ctx.syntheticStabilityScore}) — surface calm may be deceptive.`);
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
    `| Cross-Confirmed Stress Modules | ${output.crossConfirmationCount}/7 |`,
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
    'Big Short Mode: aggregates all 7 macro module scores into a unified Silent Crisis Probability for Indonesia. Detects fake stability, cross-confirmed stress, and non-linear deterioration acceleration. Outputs institutional sovereign stress report.',
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
