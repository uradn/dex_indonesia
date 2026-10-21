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
 * 3-tier news signal (all run in parallel, best score wins):
 *   1. Exa — neural link search, published articles (hours lag), keyword-scored
 *   2. Tavily — Bing-indexed Indonesian portals (Detik/Kompas/Tempo/Tribun), parallel coverage
 *   3. X (Twitter) API v2 — real-time street-level, minute-zero detection (optional premium)
 *
 * Blending: socialUnrestComponent = max(exaScore, tavilyScore, xScore × 0.85)
 * Tavily active when TAVILY_API_KEY set; X active when X_BEARER_TOKEN set.
 * Exa alone = minimum baseline; Tavily adds Indonesian news coverage breadth.
 *
 * PolEcon Payoff Matrix (Game Theory — Barro-Gordon / Kydland-Prescott):
 *   Game: Kemenkeu (HIKE BBM | HOLD SUBSIDI) × Masyarakat (ACCEPT | RESIST)
 *   pResist derived from blended unrest signal; holdEV Brent-adjusted.
 *   polEconAdj 0–8pts added to stressScore:
 *     TRAPPED (|hikeEV−holdEV|<5): +8 — no dominant strategy, both options negative
 *     FORCED_HOLD (pResist>0.60, hold dominates): +6 — fiscal bleeds while government paralyzed
 *     RISKY_HIKE (pResist>0.60, hike dominates): +5 — dominant but protest risk high
 *     STABLE: +0
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { upsertPoints, getLatestPoint } from './time-series-db.js';
import { alertFromScore, alertLabel } from './scoring.js';
import {
  fetchUnemploymentTe,
  searchNewsSentiment,
  searchNewsSentimentTavily,
  searchBreakingNewsSentiment,
  detectSeasonalContext,
  type SentimentResult,
} from './sources/political-risk.js';
import { fetchXSocialSentiment, type XSentimentResult } from './sources/x-social.js';
import { fetchPhkRelokasi, type PhkRelokasiData } from './sources/phk-relokasi.js';
import { fetchVetoPlayerFriction, type VetoPlayerData } from './sources/veto-player.js';
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

export type PolEconState = 'TRAPPED' | 'FORCED_HOLD' | 'RISKY_HIKE' | 'STABLE';

export interface PoliticalRiskOutput {
  date: string;
  stressScore: number;           // 0-100 (Silent Crisis Detector input)
  alert: AlertLevel;
  politicalRiskIndex: number;    // 0-100
  unemploymentRate: number | null;
  unemploymentComponent: number; // 0-25 sub-score
  foodPressureComponent: number; // 0-35 sub-score
  socialUnrestComponent: number; // 0-30 sub-score (Exa + Tavily + X blended)
  stabilityComponent: number;    // 0-25 sub-score (negative = international concern)
  // PolEcon game theory adjustment
  polEconState: PolEconState;    // dominant strategy equilibrium
  polEconAdj: number;            // 0-8pts score adjustment
  polEconPResist: number;        // P(masyarakat resist BBM hike)
  polEconHikeEV: number;         // Kemenkeu expected value of hiking
  polEconHoldEV: number;         // Kemenkeu expected value of holding
  xSocialResult: XSentimentResult | null;
  xSocialScore: number | null;   // raw X score before blending
  tavilyUnrestScore: number | null; // raw Tavily score before blending
  phkRelokasi: PhkRelokasiData | null;
  vetoPlayer: VetoPlayerData | null;      // Tsebelis veto player friction index
  sentimentResults: SentimentResult[];
  seasonalContext: string | null;
  topHeadlines: string[];
  unrestHeadlines: string[];   // social_unrest signal headlines (BBM langka, labor protests)
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

  // ── 2. Exa + Tavily + X social feed (all parallel) ───────────────────────
  const [
    foodResult, unrestResult, stabilityResult, geopoliticalResult,
    tavilyFoodResult, tavilyUnrestResult, tavilyStabilityResult, tavilyGeopoliticalResult,
    xResult, phkResult,
    breakingFoodResult, breakingUnrestResult,
    vetoResult,
  ] = await Promise.allSettled([
    searchNewsSentiment('food_pressure'),
    searchNewsSentiment('social_unrest'),
    searchNewsSentiment('political_stability'),
    searchNewsSentiment('geopolitical_risk'),
    searchNewsSentimentTavily('food_pressure'),
    searchNewsSentimentTavily('social_unrest'),
    searchNewsSentimentTavily('political_stability'),
    searchNewsSentimentTavily('geopolitical_risk'),
    fetchXSocialSentiment(),
    fetchPhkRelokasi(),
    searchBreakingNewsSentiment('food_pressure'),
    searchBreakingNewsSentiment('social_unrest'),
    fetchVetoPlayerFriction(),
  ]);

  const foodSentiment        = foodResult.status              === 'fulfilled' ? foodResult.value              : null;
  const unrestSentiment      = unrestResult.status            === 'fulfilled' ? unrestResult.value            : null;
  const stabilitySentiment   = stabilityResult.status         === 'fulfilled' ? stabilityResult.value         : null;
  const geopoliticalSentiment = geopoliticalResult.status     === 'fulfilled' ? geopoliticalResult.value      : null;
  const tavilyFood           = tavilyFoodResult.status        === 'fulfilled' ? tavilyFoodResult.value        : null;
  const tavilyUnrest         = tavilyUnrestResult.status      === 'fulfilled' ? tavilyUnrestResult.value      : null;
  const tavilyStability      = tavilyStabilityResult.status   === 'fulfilled' ? tavilyStabilityResult.value   : null;
  const tavilyGeopolitical   = tavilyGeopoliticalResult.status === 'fulfilled' ? tavilyGeopoliticalResult.value : null;
  const xSentiment           = xResult.status                 === 'fulfilled' ? xResult.value                 : null;
  const phkData              = phkResult.status               === 'fulfilled' ? phkResult.value               : null;
  const breakingFood         = breakingFoodResult.status      === 'fulfilled' ? breakingFoodResult.value      : null;
  const breakingUnrest       = breakingUnrestResult.status    === 'fulfilled' ? breakingUnrestResult.value    : null;
  const vetoData             = vetoResult.status              === 'fulfilled' ? vetoResult.value               : null;

  // Blended unrest score: best of Exa + Tavily + 48h breaking scan
  const blendedUnrestScore = Math.max(
    unrestSentiment?.stressScore ?? 0,
    tavilyUnrest?.stressScore ?? 0,
    breakingUnrest?.stressScore ?? 0,
  );
  const blendedFoodScore = Math.max(
    foodSentiment?.stressScore ?? 0,
    tavilyFood?.stressScore ?? 0,
    breakingFood?.stressScore ?? 0,
  );

  // Store sentiment scores in DB for trend tracking
  const sentimentPoints = [
    (blendedFoodScore > 0)
      ? { indicator: 'political_food_stress_score', category: 'pangan' as const, date: today, value: blendedFoodScore, unit: 'score_0_100', source: 'exa_tavily_blend', fetchedAt: new Date().toISOString() }
      : null,
    (blendedUnrestScore > 0)
      ? { indicator: 'political_social_unrest_score', category: 'pangan' as const, date: today, value: blendedUnrestScore, unit: 'score_0_100', source: 'exa_tavily_blend', fetchedAt: new Date().toISOString() }
      : null,
    (stabilitySentiment !== null || tavilyStability !== null)
      ? { indicator: 'political_stability_stress_score', category: 'pangan' as const, date: today, value: Math.max(stabilitySentiment?.stressScore ?? 0, tavilyStability?.stressScore ?? 0), unit: 'score_0_100', source: 'exa_tavily_blend', fetchedAt: new Date().toISOString() }
      : null,
    (geopoliticalSentiment !== null || tavilyGeopolitical !== null)
      ? { indicator: 'political_geopolitical_risk_score', category: 'pangan' as const, date: today, value: Math.max(geopoliticalSentiment?.stressScore ?? 0, tavilyGeopolitical?.stressScore ?? 0), unit: 'score_0_100', source: 'exa_tavily_blend', fetchedAt: new Date().toISOString() }
      : null,
    xSentiment
      ? { indicator: 'political_x_social_score', category: 'pangan' as const, date: today, value: xSentiment.stressScore, unit: 'score_0_100', source: 'x_api_v2', fetchedAt: new Date().toISOString() }
      : null,
    tavilyUnrest
      ? { indicator: 'political_tavily_social_score', category: 'pangan' as const, date: today, value: tavilyUnrest.stressScore, unit: 'score_0_100', source: 'tavily_search', fetchedAt: new Date().toISOString() }
      : null,
  ].filter((p): p is NonNullable<typeof p> => p !== null);
  if (sentimentPoints.length > 0) await upsertPoints(sentimentPoints);

  // Food pressure: cap at 35. Apply 30% seasonal discount during Iduladha/Lebaran windows.
  // Tavily broadens Indonesian news coverage vs Exa — take best of both.
  const rawFoodScore = blendedFoodScore > 0 ? blendedFoodScore : 20;
  const seasonalDiscount = seasonal ? 0.70 : 1.0;
  const foodPressureComponent = Math.min(35, Math.round(rawFoodScore * seasonalDiscount));

  // Social unrest: cap at 30. Three-tier blend — best score wins.
  // Tier 1: Exa (neural link search, hours lag)
  // Tier 2: Tavily (Bing/Indonesian portals, parallel coverage)
  // Tier 3: X (real-time tweets, 15% noise discount)
  const exaUnrestScore     = unrestSentiment?.stressScore ?? 15;
  const tavilyUnrestScore  = tavilyUnrest?.stressScore ?? 0;
  const xUnrestScore       = xSentiment !== null ? Math.round(xSentiment.stressScore * 0.85) : 0;
  const breakingUnrestScore = breakingUnrest?.stressScore ?? 0;
  const socialUnrestComponent = Math.min(30, Math.max(exaUnrestScore, tavilyUnrestScore, xUnrestScore, breakingUnrestScore));

  // Political stability: cap at 25. Best of Exa + Tavily across both domestic + geopolitical signals.
  const blendedStabilityScore = Math.max(stabilitySentiment?.stressScore ?? 10, tavilyStability?.stressScore ?? 0);
  const blendedGeopoliticalScore = Math.max(geopoliticalSentiment?.stressScore ?? 0, tavilyGeopolitical?.stressScore ?? 0);
  // Geopolitical weighted at 60% — international concern signals are high-information
  const combinedStability = Math.round(blendedStabilityScore * 0.4 + blendedGeopoliticalScore * 0.6);
  const stabilityComponent = Math.min(25, Math.max(blendedStabilityScore, combinedStability));

  // ── 3. PolEcon Payoff Matrix (Barro-Gordon / Kydland-Prescott) ───────────────
  // Game: Kemenkeu (HIKE BBM | HOLD SUBSIDI) × Masyarakat (ACCEPT | RESIST)
  // pResist: probability masyarakat resists a BBM hike — derived from blended unrest score.
  //   Uses M12's own signals (not M12 score itself) to avoid circular dependency.
  const polEconPResist = blendedUnrestScore >= 70 ? 0.85 : blendedUnrestScore >= 45 ? 0.65 : 0.40;

  // Brent-adjusted holdEV: fiscal drag worsens as ICP rises above APBN $70/bbl assumption.
  // Brent >$100 = subsidi overrun >$5bn/yr → holdEV worsens to -28.
  const brentPt = await getLatestPoint('brent_price_usd');
  const brentUsd = brentPt?.value ?? 85;
  const polEconHoldEV = brentUsd > 100 ? -28 : brentUsd > 90 ? -22 : -18;

  // Kemenkeu payoffs (fiscal_benefit − political_cost):
  //   HIKE + ACCEPT: +35 fiscal relief − 20 political cost = +15
  //   HIKE + RESIST: +35 fiscal relief − 60 political cost = −25
  //   HOLD (any):    holdEV (fiscal drag, partial political buffer)
  const HIKE_ACCEPT_EV = 15;
  const HIKE_RESIST_EV = -25;
  const polEconHikeEV = parseFloat(((1 - polEconPResist) * HIKE_ACCEPT_EV + polEconPResist * HIKE_RESIST_EV).toFixed(1));

  const evSpread = polEconHikeEV - polEconHoldEV;
  const polEconState: PolEconState =
    Math.abs(evSpread) < 5                          ? 'TRAPPED'      :  // no dominant strategy
    evSpread < -5 && polEconPResist > 0.60          ? 'FORCED_HOLD'  :  // hold dominates but fiscal bleeds
    evSpread > 5  && polEconPResist > 0.60          ? 'RISKY_HIKE'   :  // hike dominates but protest risk high
                                                       'STABLE';

  const polEconAdj = polEconState === 'TRAPPED'     ? 8 :
                     polEconState === 'FORCED_HOLD'  ? 6 :
                     polEconState === 'RISKY_HIKE'   ? 5 : 0;

  // ── 4. Political Risk Index ────────────────────────────────────────────────
  // Base 10 + component sum + PolEcon adjustment + Tsebelis VPI (cap at 100)
  const vetoAdj = vetoData?.scoreAdj ?? 0;
  const politicalRiskIndex = Math.min(100, 10 + unemploymentComponent + foodPressureComponent + socialUnrestComponent + stabilityComponent + polEconAdj + vetoAdj);
  const stressScore = politicalRiskIndex;
  const alert = alertFromScore(stressScore);

  // ── 5. Flags ───────────────────────────────────────────────────────────────
  if (polEconState === 'TRAPPED') {
    flags.push(
      `POLECON TRAPPED: hikeEV ${polEconHikeEV.toFixed(1)} ≈ holdEV ${polEconHoldEV.toFixed(1)} — no dominant strategy; ` +
      `fiscal drag (Brent $${brentUsd.toFixed(0)}/bbl) AND protest risk (P(resist)=${(polEconPResist * 100).toFixed(0)}%) bind simultaneously. ` +
      `[Barro-Gordon: commitment vs discretion dilemma active — +8 score adj]`,
    );
  } else if (polEconState === 'FORCED_HOLD') {
    flags.push(
      `POLECON FORCED HOLD: hold dominates (hikeEV ${polEconHikeEV.toFixed(1)} < holdEV ${polEconHoldEV.toFixed(1)}) BUT ` +
      `P(resist)=${(polEconPResist * 100).toFixed(0)}% — government paralyzed; fiscal bleeds at Brent $${brentUsd.toFixed(0)}/bbl. ` +
      `Credibility cost compounds without reform. [Kydland-Prescott time-inconsistency — +6 score adj]`,
    );
  } else if (polEconState === 'RISKY_HIKE') {
    flags.push(
      `POLECON RISKY HIKE: hike dominates (hikeEV ${polEconHikeEV.toFixed(1)} > holdEV ${polEconHoldEV.toFixed(1)}) BUT ` +
      `P(resist)=${(polEconPResist * 100).toFixed(0)}% — dominant strategy exists but protest probability high. ` +
      `Social contract stress if government acts. [+5 score adj]`,
    );
  }

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

  if (xSentiment && xSentiment.stressScore > exaUnrestScore) {
    flags.push(`X social feed elevated (score ${xSentiment.stressScore}/100) above Exa news (${exaUnrestScore}/100) — minute-zero unrest signal active`);
  }

  if (phkData && phkData.workersAtRisk30d >= 5000) {
    const url = phkData.topUrl ? ` (${phkData.topUrl})` : '';
    flags.push(`PHK MASSAL/RELOKASI EVENT (30d): ${phkData.workersAtRisk30d.toLocaleString('id')} workers at risk across ${phkData.eventCount30d} reported event(s) — FDI exit + industrial-region stress concentration. Top: ${phkData.topHeadline}${url}`);
  } else if (phkData && phkData.workersAtRisk30d >= 1000) {
    flags.push(`PHK watch (30d): ${phkData.workersAtRisk30d.toLocaleString('id')} workers at risk across ${phkData.eventCount30d} event(s) — single-event scale below 5k threshold but trend signal`);
  }

  if (xSentiment && xSentiment.highSeverityCount > 0) {
    flags.push(`X social: ${xSentiment.highSeverityCount} high-severity tweet(s) — structural/riot signals on X`);
  }

  if (!process.env.EXASEARCH_API_KEY) {
    flags.push('EXASEARCH_API_KEY not set — news sentiment unavailable; unemployment-only scoring active');
  }

  // Tsebelis veto player friction flags
  if (vetoData) {
    if (vetoData.frictionTier === 'high') {
      flags.push(
        `VETO PLAYER FRICTION HIGH (VPI ${vetoData.frictionIndex}/100): institutional gridlock risk elevated. ` +
        `${vetoData.approvalPct !== null ? `Presidential approval ${vetoData.approvalPct.toFixed(0)}%.` : ''} ` +
        `Coalition: ${vetoData.coalitionFragmentation.toUpperCase()}. Opposition activism: ${vetoData.oppositionActivism.toUpperCase()}. ` +
        `[Tsebelis 2002: veto players block reform even when incentives exist — +${vetoData.scoreAdj} score]`
      );
    } else if (vetoData.frictionTier === 'moderate') {
      flags.push(
        `Veto player friction MODERATE (VPI ${vetoData.frictionIndex}/100): some institutional resistance. ` +
        `${vetoData.approvalPct !== null ? `Approval ${vetoData.approvalPct.toFixed(0)}%. ` : ''}` +
        `Coalition ${vetoData.coalitionFragmentation}, opposition ${vetoData.oppositionActivism}. (+${vetoData.scoreAdj} score)`
      );
    }
  }

  if (!process.env.X_BEARER_TOKEN) {
    flags.push('X_BEARER_TOKEN not set — real-time Twitter/demo feed unavailable; using Exa+Tavily news baseline');
  }
  if (!process.env.TAVILY_API_KEY) {
    flags.push('TAVILY_API_KEY not set — Indonesian portal coverage (Detik/Kompas/Tempo) unavailable; Exa only');
  }

  // ── 5. Top headlines ──────────────────────────────────────────────────────
  // Merge Exa + Tavily headlines across signals, de-duplicate by title
  const allSentimentResults = [
    foodSentiment, unrestSentiment, stabilitySentiment,
    tavilyFood, tavilyUnrest, tavilyStability,
  ].filter((r): r is SentimentResult => r !== null);

  const sentimentResults = [foodSentiment, unrestSentiment, stabilitySentiment, geopoliticalSentiment].filter(
    (r): r is SentimentResult => r !== null,
  );

  const seenTitles = new Set<string>();
  const topHeadlines: string[] = [];
  for (const r of allSentimentResults) {
    for (let i = 0; i < r.headlines.length && topHeadlines.length < 8; i++) {
      const title = r.headlines[i];
      if (!title || seenTitles.has(title)) continue;
      seenTitles.add(title);
      const date = r.publishedDates?.[i];
      topHeadlines.push(date ? `[${date}] ${title}` : title);
    }
  }

  // Deduplicated unrest headlines (Exa social_unrest + Tavily unrest) — explicit BBM/labor feed
  const unrestHeadlines: string[] = [];
  const seenUnrest = new Set<string>();
  for (const r of [unrestSentiment, tavilyUnrest].filter((x): x is SentimentResult => x !== null)) {
    for (let i = 0; i < r.headlines.length && unrestHeadlines.length < 4; i++) {
      const title = r.headlines[i];
      if (!title || seenUnrest.has(title)) continue;
      seenUnrest.add(title);
      const date = r.publishedDates?.[i];
      unrestHeadlines.push(date ? `[${date}] ${title}` : title);
    }
  }

  const narrative = buildNarrative({
    politicalRiskIndex, alert, unemploymentRate, foodPressureComponent,
    socialUnrestComponent, stabilityComponent, seasonal,
    hasExa: !!process.env.EXASEARCH_API_KEY,
    hasTavily: tavilyUnrest !== null,
    hasX: xSentiment !== null,
    xLeadingExa: xSentiment !== null && xSentiment.stressScore > Math.max(exaUnrestScore, tavilyUnrestScore),
    tavilyLeadingExa: tavilyUnrestScore > exaUnrestScore,
    polEconState, polEconAdj, polEconPResist,
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
    polEconState,
    polEconAdj,
    polEconPResist,
    polEconHikeEV,
    polEconHoldEV,
    xSocialResult: xSentiment,
    xSocialScore: xSentiment?.stressScore ?? null,
    tavilyUnrestScore: tavilyUnrest?.stressScore ?? null,
    phkRelokasi: phkData,
    vetoPlayer: vetoData,
    sentimentResults,
    seasonalContext: seasonal,
    topHeadlines,
    unrestHeadlines,
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
  hasTavily: boolean;
  hasX: boolean;
  xLeadingExa: boolean;
  tavilyLeadingExa: boolean;
  polEconState: PolEconState;
  polEconAdj: number;
  polEconPResist: number;
}): string {
  const parts: string[] = [];
  parts.push(`Political Risk Index: ${ctx.politicalRiskIndex}/100 (${ctx.alert.toUpperCase()}).`);

  if (ctx.unemploymentRate !== null) {
    parts.push(`Unemployment ${ctx.unemploymentRate.toFixed(1)}% (${ctx.unemploymentRate <= UNEMPLOYMENT_NORMAL ? 'within' : 'above'} ${UNEMPLOYMENT_NORMAL}% norm).`);
  }

  if (ctx.hasExa || ctx.hasTavily || ctx.hasX) {
    const sourceParts = [ctx.hasExa ? 'Exa' : '', ctx.hasTavily ? 'Tavily' : '', ctx.hasX ? 'X' : ''].filter(Boolean);
    parts.push(`Sources active: ${sourceParts.join(' + ')}.`);

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
    if (ctx.xLeadingExa) {
      parts.push('X social feed leading Exa+Tavily news — real-time unrest signal active before media coverage.');
    } else if (ctx.tavilyLeadingExa) {
      parts.push('Tavily (Indonesian portals) returning higher unrest signal than Exa — Indonesian-language coverage gap closed.');
    }
    if (ctx.seasonal) {
      parts.push(`${ctx.seasonal} seasonal context: food price spike partially expected — structural risk assessment still applies.`);
    }
  } else {
    parts.push('No news sources active — scoring based on unemployment data only. Set EXASEARCH_API_KEY or TAVILY_API_KEY.');
  }
  if (ctx.polEconAdj > 0) {
    const stateDesc = ctx.polEconState === 'TRAPPED'
      ? `no dominant strategy — fiscal drag and protest risk bind simultaneously (+${ctx.polEconAdj}pts)`
      : ctx.polEconState === 'FORCED_HOLD'
        ? `government forced to hold subsidi while fiscal bleeds — credibility erodes (+${ctx.polEconAdj}pts)`
        : `hike dominates but P(resist)=${(ctx.polEconPResist*100).toFixed(0)}% — social contract stress if acted upon (+${ctx.polEconAdj}pts)`;
    parts.push(`PolEcon [${ctx.polEconState}]: ${stateDesc}.`);
  }
  return parts.join(' ');
}

function formatOutput(output: PoliticalRiskOutput): string {
  const hasExa = output.sentimentResults.length > 0;
  const hasX = output.xSocialResult !== null;
  const x = output.xSocialResult;

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
    `| Social Unrest (Exa + Tavily + X) | ${output.socialUnrestComponent} | 30 |`,
    `| Political/Governance Stability | ${output.stabilityComponent} | 25 |`,
    `| PolEcon Adj (${output.polEconState}) | +${output.polEconAdj} | 8 |`,
    `| **Total (+ base 10)** | **${output.politicalRiskIndex}** | **100** |`,
    ``,
    `## PolEcon Payoff Matrix — BBM Hike Game`,
    `_Kemenkeu (HIKE|HOLD) × Masyarakat (ACCEPT|RESIST) [Barro-Gordon / Kydland-Prescott]_`,
    `| | ACCEPT | RESIST |`,
    `|---|---|---|`,
    `| **HIKE** | +15 | −25 |`,
    `| **HOLD** | ${output.polEconHoldEV} | ${output.polEconHoldEV} |`,
    ``,
    `P(resist) = **${(output.polEconPResist * 100).toFixed(0)}%** · hikeEV = **${output.polEconHikeEV.toFixed(1)}** · holdEV = **${output.polEconHoldEV}** · Equilibrium: **${output.polEconState}**`,
    ``,
    `## Economic Indicators`,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Unemployment Rate | ${output.unemploymentRate !== null ? `${output.unemploymentRate.toFixed(2)}%` : 'n/a'} |`,
    `| Normal Range | ${UNEMPLOYMENT_NORMAL}% (BPS historical avg) |`,
    `| Stress Threshold | ${UNEMPLOYMENT_STRESS}% |`,
    ``,
    hasExa ? [
      `## News Sentiment Signals (Exa)`,
      ...output.sentimentResults.map((r) =>
        `**${r.signal.replace('_', ' ')} (score ${r.stressScore}/100):** ${r.negativeCount} negative, ${r.positiveCount} positive, ${r.highSeverityCount} high-severity`,
      ),
    ].join('\n') : '_Exa API not configured — Set EXASEARCH_API_KEY._',
    ``,
    output.tavilyUnrestScore !== null
      ? `## Tavily News (Indonesian Portals)\n**Social unrest score:** ${output.tavilyUnrestScore}/100 — Detik/Kompas/Tempo/Tribun coverage`
      : '_Tavily not configured — Set TAVILY_API_KEY for Indonesian portal coverage (Detik/Kompas/Tempo)._',
    ``,
    hasX && x ? [
      `## X Social Feed (real-time)`,
      `**Score:** ${x.stressScore}/100 | **Tweets:** ${x.tweetCount} | ${x.negativeCount} negative, ${x.positiveCount} positive, ${x.highSeverityCount} high-severity`,
      x.topTweets.length > 0 ? x.topTweets.map((t) => `- "${t}"`).join('\n') : '',
    ].filter(Boolean).join('\n') : '_X social feed unavailable. Set X_BEARER_TOKEN for real-time minute-zero detection._',
    ``,
    output.topHeadlines.length > 0 ? [
      `## Top Headlines — Food/Stability (recent 7 days)`,
      ...output.topHeadlines.map((h) => `- ${h}`),
    ].join('\n') : '',
    ``,
    output.unrestHeadlines.length > 0 ? [
      `## Unrest/BBM Headlines — Social Unrest Signal (recent 7 days)`,
      ...output.unrestHeadlines.map((h) => `- ${h}`),
    ].join('\n') : '',
    ``,
    output.flags.length > 0 ? `## Active Flags\n${output.flags.map((f) => `- ⚠️ ${f}`).join('\n')}` : '## No Critical Flags',
    ``,
    `_Transmission: political risk → policy unpredictability → sovereign risk premium → IDR/SBN repricing._`,
    `_Sources: BPS unemployment (quarterly, ~2mo lag) · Exa news (7d, keyword-scored) · Tavily (Indonesian portals, 7d) · X API v2 (real-time, 15% noise discount)._`,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

export const politicalRiskEngine = new DynamicStructuredTool({
  name: 'political_risk_engine',
  description:
    'Political Risk Engine: tracks Indonesia political and social stability via BPS unemployment + 3-tier news signal (Exa neural search + Tavily Indonesian portals + X real-time feed). Blends max(exaScore, tavilyScore, xScore×0.85). Computes Political Risk Index 0-100. Detects approval erosion and social contract stress before it reprices into sovereign spreads.',
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
