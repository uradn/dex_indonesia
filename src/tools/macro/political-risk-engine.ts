/**
 * Module 12 — Political Risk Engine
 *
 * Tracks Indonesia's domestic political and social stability via:
 *   1. BPS unemployment rate (quarterly, TE scrape)
 *   2. Exa news sentiment — 3 signals: food_pressure, social_unrest, political_stability
 *
 * Political risk in Indonesia operates through two channels:
 *   A) Social contract stress: sembako unaffordable + unemployment → Prabowo approval
 *      erosion → policy unpredictability → sovereign risk premium widening
 *   B) Structural governance: authoritarian drift, investor confidence, rule of law
 *      → directly priced into CDS and IDR risk premium
 *
 * Feeds into Silent Crisis Detector (weight: 0.06).
 * Complements Module 11 (Domestic Pressure) which tracks price levels;
 * Module 12 tracks political RESPONSE and systemic risk from those prices.
 *
 * Source reliability:
 *   - Unemployment (TE): high reliability, quarterly lag ~2 months
 *   - Exa news: keyword-based, no LLM inference — signal is directional not precise
 *   - No Twitter/X (API $100/month) — Exa news is the viable free-tier substitute
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { upsertPoints, getLatestPoint } from './time-series-db.js';
import { alertFromScore, alertLabel } from './scoring.js';
import {
  fetchUnemploymentTe,
  searchNewsSentiment,
  detectSeasonalContext,
  type SentimentResult,
} from './sources/political-risk.js';
import type { AlertLevel } from './types.js';

export const POLITICAL_RISK_DESCRIPTION = `
MACRO INTELLIGENCE — Political Risk Engine (Module 12)

Tracks Indonesia's domestic political and social stability signals.
Complements Module 11 (Domestic Pressure): Module 11 tracks food PRICES;
Module 12 tracks political RESPONSE and systemic governance risk from those prices.

Monitors:
- BPS unemployment rate (quarterly, via Trading Economics)
- Exa news sentiment: 3 signals (food pressure, social unrest, political stability)
- Seasonal context (Iduladha, Lebaran, Natal food spike windows)

Political risk channels:
A) Social contract: sembako unaffordable + unemployment → approval erosion → policy risk
B) Governance: authoritarian drift, investor confidence → CDS + IDR risk premium

## When to Use

- "Show political risk"
- "Prabowo approval pressure?"
- "Social stability risk for investors?"
- "Is domestic unrest pricing into sovereign risk?"
- After major labor protests, food price spikes, or political news events
`.trim();

// Indonesia political risk baseline parameters
const UNEMPLOYMENT_NORMAL = 4.8;    // % — BPS historical average
const UNEMPLOYMENT_STRESS = 6.5;    // % — elevated political risk threshold

export interface PoliticalRiskOutput {
  date: string;
  stressScore: number;           // 0-100 (Silent Crisis Detector input)
  alert: AlertLevel;
  politicalRiskIndex: number;    // 0-100
  unemploymentRate: number | null;
  unemploymentComponent: number; // 0-25 sub-score
  foodPressureComponent: number; // 0-35 sub-score
  socialUnrestComponent: number; // 0-30 sub-score
  stabilityComponent: number;    // 0-25 sub-score (negative = international concern)
  sentimentResults: SentimentResult[];
  seasonalContext: string | null;
  topHeadlines: string[];
  narrative: string;
  flags: string[];
}

export async function runPoliticalRiskEngine(): Promise<PoliticalRiskOutput> {
  const today = new Date().toISOString().slice(0, 10);
  const flags: string[] = [];
  const seasonal = detectSeasonalContext();

  // ── 1. Unemployment (BPS quarterly via TE) ────────────────────────────────
  const freshUnemployment = await fetchUnemploymentTe();
  if (freshUnemployment) await upsertPoints([freshUnemployment]);

  const unemploymentPoint = await getLatestPoint('unemployment_rate_pct');
  const unemploymentRate = unemploymentPoint?.value ?? null;

  // Score: 0 at or below normal, rises linearly to 25 at UNEMPLOYMENT_STRESS
  const unemploymentComponent = unemploymentRate !== null
    ? Math.min(25, Math.max(0, Math.round(
        ((unemploymentRate - UNEMPLOYMENT_NORMAL) / (UNEMPLOYMENT_STRESS - UNEMPLOYMENT_NORMAL)) * 25,
      )))
    : 8; // unknown → conservative mid assumption

  // ── 2. Exa news sentiment (3 signals, parallel) ───────────────────────────
  const [foodResult, unrestResult, stabilityResult] = await Promise.allSettled([
    searchNewsSentiment('food_pressure'),
    searchNewsSentiment('social_unrest'),
    searchNewsSentiment('political_stability'),
  ]);

  const foodSentiment = foodResult.status === 'fulfilled' ? foodResult.value : null;
  const unrestSentiment = unrestResult.status === 'fulfilled' ? unrestResult.value : null;
  const stabilitySentiment = stabilityResult.status === 'fulfilled' ? stabilityResult.value : null;

  // Store sentiment scores in DB for trend tracking
  const sentimentPoints = [
    foodSentiment
      ? { indicator: 'political_food_stress_score', category: 'pangan' as const, date: today, value: foodSentiment.stressScore, unit: 'score_0_100', source: 'exa_sentiment', fetchedAt: new Date().toISOString() }
      : null,
    unrestSentiment
      ? { indicator: 'political_social_unrest_score', category: 'pangan' as const, date: today, value: unrestSentiment.stressScore, unit: 'score_0_100', source: 'exa_sentiment', fetchedAt: new Date().toISOString() }
      : null,
    stabilitySentiment
      ? { indicator: 'political_stability_stress_score', category: 'pangan' as const, date: today, value: stabilitySentiment.stressScore, unit: 'score_0_100', source: 'exa_sentiment', fetchedAt: new Date().toISOString() }
      : null,
  ].filter((p): p is NonNullable<typeof p> => p !== null);
  if (sentimentPoints.length > 0) await upsertPoints(sentimentPoints);

  // Food pressure: cap at 35. Apply 30% seasonal discount during Iduladha/Lebaran windows
  const rawFoodScore = foodSentiment?.stressScore ?? 20;
  const seasonalDiscount = seasonal ? 0.70 : 1.0;
  const foodPressureComponent = Math.min(35, Math.round(rawFoodScore * seasonalDiscount));

  // Social unrest: cap at 30. Labor protests are direct political risk.
  const socialUnrestComponent = Math.min(30, unrestSentiment?.stressScore ?? 15);

  // Political stability: cap at 25. International concern signals are structural.
  const stabilityComponent = Math.min(25, stabilitySentiment?.stressScore ?? 10);

  // ── 3. Political Risk Index ────────────────────────────────────────────────
  // Base 10 + component sum (normalised — components can sum to 115 max → cap at 100)
  const politicalRiskIndex = Math.min(100, 10 + unemploymentComponent + foodPressureComponent + socialUnrestComponent + stabilityComponent);
  const stressScore = politicalRiskIndex;
  const alert = alertFromScore(stressScore);

  // ── 4. Flags ───────────────────────────────────────────────────────────────
  if (unemploymentRate !== null && unemploymentRate > UNEMPLOYMENT_STRESS) {
    flags.push(`Unemployment ${unemploymentRate.toFixed(1)}% — above ${UNEMPLOYMENT_STRESS}% stress threshold; labor market breakdown risk`);
  }

  if (foodSentiment && foodSentiment.highSeverityCount > 0) {
    flags.push(`Food pressure: ${foodSentiment.highSeverityCount} high-severity signal(s) — ${foodSentiment.headlines[0] ?? ''}`);
  }

  if (unrestSentiment && unrestSentiment.stressScore >= 40) {
    flags.push(`Social unrest elevated (score ${unrestSentiment.stressScore}/100) — labor protests and PHK signals active`);
  }

  if (stabilitySentiment && stabilitySentiment.highSeverityCount > 0) {
    flags.push(`Political stability concern: ${stabilitySentiment.highSeverityCount} international/structural signal(s) — ${stabilitySentiment.headlines[0] ?? ''}`);
  }

  if (seasonal) {
    flags.push(`Seasonal context: ${seasonal} period — food price spikes partially expected; social contract stress remains`);
  }

  if (!process.env.EXASEARCH_API_KEY) {
    flags.push('EXASEARCH_API_KEY not set — news sentiment unavailable; unemployment-only scoring active');
  }

  // ── 5. Top headlines ──────────────────────────────────────────────────────
  const sentimentResults = [foodSentiment, unrestSentiment, stabilitySentiment].filter(
    (r): r is SentimentResult => r !== null,
  );

  // Merge headlines across 3 signals, de-duplicate by title, keep date label
  const seenTitles = new Set<string>();
  const topHeadlines: string[] = [];
  for (const r of sentimentResults) {
    for (let i = 0; i < r.headlines.length && topHeadlines.length < 6; i++) {
      const title = r.headlines[i];
      if (!title || seenTitles.has(title)) continue;
      seenTitles.add(title);
      const date = r.publishedDates?.[i];
      topHeadlines.push(date ? `[${date}] ${title}` : title);
    }
  }

  const narrative = buildNarrative({
    politicalRiskIndex, alert, unemploymentRate, foodPressureComponent,
    socialUnrestComponent, stabilityComponent, seasonal, hasExa: !!process.env.EXASEARCH_API_KEY,
  });

  return {
    date: today,
    stressScore,
    alert,
    politicalRiskIndex,
    unemploymentRate,
    unemploymentComponent,
    foodPressureComponent,
    socialUnrestComponent,
    stabilityComponent,
    sentimentResults,
    seasonalContext: seasonal,
    topHeadlines,
    narrative,
    flags,
  };
}

function buildNarrative(ctx: {
  politicalRiskIndex: number;
  alert: AlertLevel;
  unemploymentRate: number | null;
  foodPressureComponent: number;
  socialUnrestComponent: number;
  stabilityComponent: number;
  seasonal: string | null;
  hasExa: boolean;
}): string {
  const parts: string[] = [];
  parts.push(`Political Risk Index: ${ctx.politicalRiskIndex}/100 (${ctx.alert.toUpperCase()}).`);

  if (ctx.unemploymentRate !== null) {
    parts.push(`Unemployment ${ctx.unemploymentRate.toFixed(1)}% (${ctx.unemploymentRate <= UNEMPLOYMENT_NORMAL ? 'within' : 'above'} ${UNEMPLOYMENT_NORMAL}% norm).`);
  }

  if (ctx.hasExa) {
    const dominant = [
      { label: 'food price pressure', score: ctx.foodPressureComponent, max: 35 },
      { label: 'social unrest', score: ctx.socialUnrestComponent, max: 30 },
      { label: 'stability concerns', score: ctx.stabilityComponent, max: 25 },
    ]
      .filter((c) => c.score > c.max * 0.5)
      .map((c) => c.label);
    if (dominant.length > 0) {
      parts.push(`Active stress vectors: ${dominant.join(', ')}.`);
    }
    if (ctx.seasonal) {
      parts.push(`${ctx.seasonal} seasonal context: food price spike partially expected — structural risk assessment still applies.`);
    }
  } else {
    parts.push('Exa news sentiment unavailable — scoring based on unemployment data only.');
  }
  return parts.join(' ');
}

function formatOutput(output: PoliticalRiskOutput): string {
  const hasExa = output.sentimentResults.length > 0;

  return [
    `# Political Risk Engine — Indonesia`,
    `**Date:** ${output.date}`,
    `**Alert:** ${alertLabel(output.alert)} | **Political Risk Index:** ${output.politicalRiskIndex}/100`,
    output.seasonalContext ? `**Seasonal:** ${output.seasonalContext} period — food price spikes partially expected` : '',
    ``,
    `## Summary`,
    output.narrative,
    ``,
    `## Risk Component Breakdown`,
    `| Component | Score | Max |`,
    `|-----------|-------|-----|`,
    `| Unemployment (BPS quarterly) | ${output.unemploymentComponent} | 25 |`,
    `| Food Price Political Pressure | ${output.foodPressureComponent} | 35 |`,
    `| Social Unrest (labor protests, PHK) | ${output.socialUnrestComponent} | 30 |`,
    `| Political/Governance Stability | ${output.stabilityComponent} | 25 |`,
    `| **Total (+ base 10)** | **${output.politicalRiskIndex}** | **100** |`,
    ``,
    `## Economic Indicators`,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Unemployment Rate | ${output.unemploymentRate !== null ? `${output.unemploymentRate.toFixed(2)}%` : 'n/a'} |`,
    `| Normal Range | ${UNEMPLOYMENT_NORMAL}% (BPS historical avg) |`,
    `| Stress Threshold | ${UNEMPLOYMENT_STRESS}% |`,
    ``,
    hasExa ? [
      `## News Sentiment Signals`,
      ...output.sentimentResults.map((r) =>
        `**${r.signal.replace('_', ' ')} (score ${r.stressScore}/100):** ${r.negativeCount} negative, ${r.positiveCount} positive, ${r.highSeverityCount} high-severity`,
      ),
    ].join('\n') : '_Exa API not configured — news sentiment unavailable. Set EXASEARCH_API_KEY._',
    ``,
    output.topHeadlines.length > 0 ? [
      `## Top Headlines (recent 60 days)`,
      ...output.topHeadlines.map((h) => `- ${h}`),
    ].join('\n') : '',
    ``,
    output.flags.length > 0 ? `## Active Flags\n${output.flags.map((f) => `- ⚠️ ${f}`).join('\n')}` : '## No Critical Flags',
    ``,
    `_Transmission: political risk → policy unpredictability → sovereign risk premium → IDR/SBN repricing._`,
    `_Unemployment source: BPS (quarterly, ~2 month lag). News: Exa search, keyword-scored, directional signal only._`,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

export const politicalRiskEngine = new DynamicStructuredTool({
  name: 'political_risk_engine',
  description:
    'Political Risk Engine: tracks Indonesia political and social stability via BPS unemployment + Exa news sentiment (food pressure, labor protests, governance stability). Computes Political Risk Index 0-100. Detects approval erosion and social contract stress before it reprices into sovereign spreads.',
  schema: z.object({
    query: z.string().describe('e.g. "Show political risk" or "Prabowo approval pressure?" or "Social unrest risk for investors?"'),
  }),
  func: async (_input) => {
    try {
      const output = await runPoliticalRiskEngine();
      return formatToolResult({ analysis: formatOutput(output), raw: output });
    } catch (error) {
      return formatToolResult({ error: error instanceof Error ? error.message : String(error) });
    }
  },
});
