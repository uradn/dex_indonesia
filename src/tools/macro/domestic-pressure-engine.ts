/**
 * Module 11 — Domestic Inflation Pressure Engine
 *
 * Indonesia's food basket = ~30% of CPI. Food price spikes are the primary
 * transmission channel from commodity/FX shocks to headline inflation → BI rate
 * pressure → SBN yield rise → sovereign risk amplification.
 *
 * This module is an upstream early-warning feed for:
 *   - Regime Engine (replaces IMF annual CPI with monthly food CPI proxy)
 *   - Narrative Divergence Engine (food CPI vs APBN 2.5% assumption)
 *   - Silent Crisis Detector (weight: 0.08)
 *
 * Data sources:
 *   Primary: hargapangan.id PIHPS — 10 strategic commodities, daily IDR prices
 *   Fallback: Trading Economics food inflation YoY % (monthly aggregate)
 *
 * DOMESTIC PRESSURE ALERT: fired when ≥2 commodities z-score > 1.5 simultaneously.
 * Signals supply shock or IDR pass-through before it shows in official CPI.
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { upsertPoints, getLatestPoint, getLastN } from './time-series-db.js';
import { alertFromScore, alertLabel, rollingZScore } from './scoring.js';
import { fetchPihpsCommodities, fetchFoodInflationTe, PIHPS_COMMODITIES } from './sources/pihps.js';
import { computeCostRecovery, bbmHikeAlert, icpHikeAlert, getFuelPricePoints, DOMESTIC_FUEL_PRICES, ICP_SAFETY_THRESHOLD, HORMUZ_WATCH_THRESHOLD } from './sources/pertamina.js';
import type { AlertLevel } from './types.js';

export const DOMESTIC_PRESSURE_DESCRIPTION = `
MACRO INTELLIGENCE — Domestic Inflation Pressure Engine (Module 11)

Tracks Indonesia's 10 PIHPS strategic food commodities and aggregate food CPI.
Food prices = ~30% of CPI weight — leading indicator for headline inflation and BI rate pressure.

Monitors:
- 10 PIHPS commodities: beras, cabai merah/rawit, bawang merah/putih, daging sapi/ayam, telur, minyak goreng, gula pasir
- Food Stress Index (0-100): 90-day z-score composite across commodities
- Food inflation YoY % vs APBN 2.5% general CPI assumption
- DOMESTIC PRESSURE ALERT: ≥2 commodities simultaneously z > 1.5

Transmission chain:
Food price spike → CPI above APBN target → BI forced to hold/hike → SBN yield rise → foreign outflow risk

## When to Use

- "Show food price stress"
- "Domestic inflation risk?"
- "Sembako alert?"
- "Is food CPI threatening BI rate path?"
- After drought, La Niña, or Rupiah depreciation episodes (IDR → import cost pass-through)
`.trim();

interface CommodityStressEntry {
  indicator: string;
  label: string;
  price: number | null;
  unit: string;
  zScore90d: number | null;
  alertLevel: AlertLevel;
  spiked: boolean;
}

export interface DomesticPressureOutput {
  date: string;
  stressScore: number;       // 0-100 — used by Silent Crisis Detector
  alert: AlertLevel;
  foodStressIndex: number;   // 0-100 composite
  foodInflationYoy: number | null;
  foodInflationDeviation: number | null;  // vs APBN implied food CPI (3.75%)
  spikedCommodities: string[];
  domesticPressureAlert: boolean;         // ≥2 commodities z > 1.5 simultaneously
  commodityScores: CommodityStressEntry[];
  bbmPertalitePrice: number;
  bbmCostRecovery: number;
  bbmSubsidyGap: number;     // cost recovery - Pertalite price; positive = government subsidizing
  bbmHikeRisk: AlertLevel;
  bbmIcpRisk: AlertLevel;    // ICP vs $100/bbl government commitment threshold
  bbmIcpMargin: number;      // USD/bbl remaining to $100 threshold
  narrative: string;
  flags: string[];
}

// APBN 2026 food CPI benchmark
// APBN targets 2.5% general CPI — food historically 1.5x headline → ~3.75% implied food CPI
const APBN_IMPLIED_FOOD_CPI = 3.75;
const APBN_FOOD_SPIKE_THRESHOLD = 6.0;   // >6% = subsidi pangan bengkak risk
const APBN_FOOD_DEFLATION_THRESHOLD = 0; // <0% = unexpected deflation / farmer income stress

export async function runDomesticPressureEngine(): Promise<DomesticPressureOutput> {
  const today = new Date().toISOString().slice(0, 10);
  const flags: string[] = [];

  // ── 1. Fetch and store commodity prices ────────────────────────────────────
  const [freshCommodities, foodInflationPoint] = await Promise.allSettled([
    fetchPihpsCommodities(),
    fetchFoodInflationTe(),
  ]);

  if (freshCommodities.status === 'fulfilled' && freshCommodities.value.length > 0) {
    await upsertPoints(freshCommodities.value);
  }

  if (foodInflationPoint.status === 'fulfilled' && foodInflationPoint.value) {
    await upsertPoints([foodInflationPoint.value]);
  }

  // ── 2. Compute per-commodity z-scores ──────────────────────────────────────
  // Stress override: DEXTER_STRESS_FOOD = JSON map of indicator → price multiplier
  // Used by stress-test-food.ts — never set in production.
  let stressFoodOverrides: Record<string, number> = {};
  try {
    const raw = process.env.DEXTER_STRESS_FOOD;
    if (raw) stressFoodOverrides = JSON.parse(raw) as Record<string, number>;
  } catch { /* invalid JSON — ignore */ }

  const commodityScores: CommodityStressEntry[] = [];

  for (const spec of PIHPS_COMMODITIES) {
    const raw = await getLatestPoint(spec.indicator);
    const stressMultiplier = stressFoodOverrides[spec.indicator];
    const current = raw && stressMultiplier
      ? { ...raw, value: parseFloat((raw.value * stressMultiplier).toFixed(0)) }
      : raw;
    if (!current) {
      commodityScores.push({
        indicator: spec.indicator,
        label: spec.label,
        price: null,
        unit: spec.unit,
        zScore90d: null,
        alertLevel: 'green',
        spiked: false,
      });
      continue;
    }

    const history = await getLastN(spec.indicator, 90);
    const values = history.map((p) => p.value);
    const zScore90d = values.length >= 10
      ? rollingZScore(values.slice(0, -1), current.value)
      : null;

    const alertLevel: AlertLevel =
      zScore90d === null ? 'green'
        : Math.abs(zScore90d) >= 2.5 ? 'red'
        : Math.abs(zScore90d) >= 2.0 ? 'orange'
        : Math.abs(zScore90d) >= 1.5 ? 'yellow'
        : 'green';

    const spiked = zScore90d !== null && zScore90d > 1.5;

    commodityScores.push({
      indicator: spec.indicator,
      label: spec.label,
      price: current.value,
      unit: spec.unit,
      zScore90d,
      alertLevel,
      spiked,
    });
  }

  // ── 3. Food Stress Index (0-100) ───────────────────────────────────────────
  // Based on proportion of commodities stressed + intensity of top z-scores
  const spikedCommodities = commodityScores.filter((c) => c.spiked).map((c) => c.label);
  const domesticPressureAlert = spikedCommodities.length >= 2;

  const availableScores = commodityScores.filter((c) => c.zScore90d !== null);
  let foodStressIndex: number;

  if (availableScores.length >= 3) {
    // Composite: average z-score mapped to 0-100 scale (z=3 → 100)
    const avgZ = availableScores.reduce((s, c) => s + Math.max(0, c.zScore90d!), 0) / availableScores.length;
    const spikeBonus = spikedCommodities.length * 8;
    foodStressIndex = Math.min(100, Math.round((avgZ / 3) * 70 + spikeBonus));
  } else {
    // Fallback: use food inflation deviation from APBN implied food CPI
    const foodInflation = await getLatestPoint('food_inflation_yoy_pct');
    if (foodInflation) {
      const deviation = Math.abs(foodInflation.value - APBN_IMPLIED_FOOD_CPI);
      foodStressIndex = Math.min(100, Math.round(deviation * 8));
    } else {
      foodStressIndex = 0; // no data
    }
  }

  const stressScore = foodStressIndex;
  const alert = alertFromScore(stressScore);

  // ── 4. Food inflation vs APBN benchmark ───────────────────────────────────
  const currentFoodInflation = await getLatestPoint('food_inflation_yoy_pct');
  const foodInflationYoy = currentFoodInflation?.value ?? null;
  const foodInflationDeviation = foodInflationYoy !== null
    ? parseFloat((foodInflationYoy - APBN_IMPLIED_FOOD_CPI).toFixed(2))
    : null;

  if (domesticPressureAlert) {
    flags.push(`DOMESTIC PRESSURE ALERT: ${spikedCommodities.length} commodities spiked — ${spikedCommodities.join(', ')}`);
  }

  if (foodInflationYoy !== null) {
    if (foodInflationYoy > APBN_FOOD_SPIKE_THRESHOLD) {
      flags.push(`Food CPI ${foodInflationYoy.toFixed(1)}% YoY — above ${APBN_FOOD_SPIKE_THRESHOLD}% threshold; Bulog/subsidi pangan cost overrun risk`);
    } else if (foodInflationYoy < APBN_FOOD_DEFLATION_THRESHOLD) {
      flags.push(`Food CPI ${foodInflationYoy.toFixed(1)}% YoY — deflation; farmer income stress, rural purchasing power erosion`);
    } else if (foodInflationYoy > APBN_IMPLIED_FOOD_CPI + 2) {
      flags.push(`Food CPI ${foodInflationYoy.toFixed(1)}% YoY — ${(foodInflationYoy - APBN_IMPLIED_FOOD_CPI).toFixed(1)}pp above APBN implied food CPI; headline CPI upside risk`);
    }
  }

  const topSpiked = commodityScores
    .filter((c) => c.spiked && c.zScore90d !== null)
    .sort((a, b) => (b.zScore90d ?? 0) - (a.zScore90d ?? 0))
    .slice(0, 3);
  if (topSpiked.length > 0 && !domesticPressureAlert) {
    flags.push(`Commodity spike watch: ${topSpiked.map((c) => `${c.label} (z=${c.zScore90d?.toFixed(1)})`).join(', ')}`);
  }

  // ── 5. BBM subsidy gap ─────────────────────────────────────────────────────
  // Seed Pertalite/Solar prices if not in DB (hardcoded Kepmen ESDM values)
  const pertalitePoint = await getLatestPoint('pertalite_price_idr_liter');
  if (!pertalitePoint) await upsertPoints(getFuelPricePoints());

  const [brentPoint, usdIdrPoint] = await Promise.all([
    getLatestPoint('brent_price_usd'),
    getLatestPoint('usdidr_spot'),
  ]);

  const bbmPertalitePrice = pertalitePoint?.value ?? DOMESTIC_FUEL_PRICES.pertalite_price_idr_liter;
  const brentUsd = brentPoint?.value ?? 70;
  const usdIdr = usdIdrPoint?.value ?? 16_500;

  const bbmCostRecovery = computeCostRecovery(brentUsd, usdIdr);
  const bbmSubsidyGap = bbmCostRecovery - bbmPertalitePrice;
  const bbmHikeRisk = bbmHikeAlert(Math.max(0, bbmSubsidyGap));
  const bbmIcpRisk = icpHikeAlert(brentUsd);
  const bbmIcpMargin = parseFloat((ICP_SAFETY_THRESHOLD - brentUsd).toFixed(1));

  await upsertPoints([
    { indicator: 'bbm_cost_recovery_idr_liter', category: 'pangan', date: today, value: bbmCostRecovery, unit: 'IDR/liter', source: 'computed_brent_usdidr', fetchedAt: new Date().toISOString() },
    { indicator: 'bbm_subsidy_gap_idr_liter', category: 'pangan', date: today, value: bbmSubsidyGap, unit: 'IDR/liter', source: 'computed', fetchedAt: new Date().toISOString() },
  ]);

  if (bbmHikeRisk !== 'green') {
    flags.push(
      `BBM subsidy gap IDR ${bbmSubsidyGap.toLocaleString('id-ID')}/liter — cost recovery IDR ${bbmCostRecovery.toLocaleString('id-ID')} vs Pertalite IDR ${bbmPertalitePrice.toLocaleString('id-ID')}; hike risk ${bbmHikeRisk.toUpperCase()} (Brent $${brentUsd.toFixed(1)} + USDIDR ${usdIdr.toLocaleString('id-ID')})`,
    );
  }

  // ICP threshold watch — government commitment holds below $100/bbl (Bahlil, Apr 2026)
  const icpRisk = icpHikeAlert(brentUsd);
  if (icpRisk !== 'green') {
    const margin = ICP_SAFETY_THRESHOLD - brentUsd;
    flags.push(
      `ICP watch: Brent $${brentUsd.toFixed(1)}/bbl — ${icpRisk.toUpperCase()} (margin to $${ICP_SAFETY_THRESHOLD} govt commitment: $${margin.toFixed(1)}/bbl)` +
      (brentUsd > HORMUZ_WATCH_THRESHOLD ? ` — Hormuz crisis escalation zone; Bahlil commitment at risk` : ''),
    );
  }

  if (process.env.PERTALITE_PRICE_IDR) {
    flags.push(`Pertalite price ENV OVERRIDE active: IDR ${DOMESTIC_FUEL_PRICES.pertalite_price_idr_liter.toLocaleString('id-ID')}/liter (PERTALITE_PRICE_IDR set)`);
  }

  const narrative = buildNarrative({ foodStressIndex, alert, foodInflationYoy, foodInflationDeviation, spikedCommodities, domesticPressureAlert, availableCount: availableScores.length });

  return {
    date: today,
    stressScore,
    alert,
    foodStressIndex,
    foodInflationYoy,
    foodInflationDeviation,
    spikedCommodities,
    domesticPressureAlert,
    commodityScores,
    bbmPertalitePrice,
    bbmCostRecovery,
    bbmSubsidyGap,
    bbmHikeRisk,
    bbmIcpRisk,
    bbmIcpMargin,
    narrative,
    flags,
  };
}

function buildNarrative(ctx: {
  foodStressIndex: number;
  alert: AlertLevel;
  foodInflationYoy: number | null;
  foodInflationDeviation: number | null;
  spikedCommodities: string[];
  domesticPressureAlert: boolean;
  availableCount: number;
}): string {
  const parts: string[] = [];
  parts.push(`Food Stress Index: ${ctx.foodStressIndex}/100 (${ctx.alert.toUpperCase()}).`);

  if (ctx.foodInflationYoy !== null) {
    const dir = ctx.foodInflationDeviation !== null && ctx.foodInflationDeviation >= 0 ? 'above' : 'below';
    const abs = Math.abs(ctx.foodInflationDeviation ?? 0);
    parts.push(`Food CPI: ${ctx.foodInflationYoy.toFixed(1)}% YoY — ${abs.toFixed(1)}pp ${dir} APBN implied food CPI (${APBN_IMPLIED_FOOD_CPI}%).`);
  }

  if (ctx.domesticPressureAlert) {
    parts.push(`DOMESTIC PRESSURE ALERT: ${ctx.spikedCommodities.length} commodities simultaneously above 90d trend — ${ctx.spikedCommodities.join(', ')}.`);
  } else if (ctx.spikedCommodities.length > 0) {
    parts.push(`Watch: ${ctx.spikedCommodities.join(', ')} trending above 90d norm.`);
  } else if (ctx.availableCount < 3) {
    parts.push('PIHPS individual prices unavailable (hargapangan.id offline). TE food inflation aggregate used as proxy.');
  } else {
    parts.push('Pangan prices within normal 90d range — no supply shock signal.');
  }
  return parts.join(' ');
}

function formatOutput(output: DomesticPressureOutput): string {
  const available = output.commodityScores.filter((c) => c.price !== null);
  const unavailable = output.commodityScores.filter((c) => c.price === null);

  return [
    `# Domestic Inflation Pressure Engine — Indonesia`,
    `**Date:** ${output.date}`,
    `**Alert:** ${alertLabel(output.alert)} | **Food Stress Index:** ${output.foodStressIndex}/100`,
    output.domesticPressureAlert ? `**⚠️ DOMESTIC PRESSURE ALERT:** ${output.spikedCommodities.length} commodities spiked simultaneously` : '',
    ``,
    `## Summary`,
    output.narrative,
    ``,
    `## Food CPI vs APBN Benchmark`,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Food Inflation YoY | ${output.foodInflationYoy !== null ? `${output.foodInflationYoy.toFixed(1)}%` : 'n/a'} |`,
    `| APBN Implied Food CPI | ~${APBN_IMPLIED_FOOD_CPI}% (1.5× headline 2.5%) |`,
    `| Deviation | ${output.foodInflationDeviation !== null ? `${output.foodInflationDeviation >= 0 ? '+' : ''}${output.foodInflationDeviation.toFixed(1)}pp` : 'n/a'} |`,
    ``,
    available.length > 0 ? [
      `## PIHPS Commodity Prices (90d Z-Score)`,
      `| Commodity | Price | Unit | Z-Score | Alert |`,
      `|-----------|-------|------|---------|-------|`,
      ...available
        .sort((a, b) => (b.zScore90d ?? 0) - (a.zScore90d ?? 0))
        .map((c) =>
          `| ${c.label} | ${c.price!.toLocaleString('id-ID')} | ${c.unit} | ${c.zScore90d?.toFixed(2) ?? 'n/a'} | ${c.alertLevel.toUpperCase()}${c.spiked ? ' ⚠️' : ''} |`,
        ),
    ].join('\n') : `_PIHPS individual prices unavailable (hargapangan.id offline)._`,
    ``,
    unavailable.length > 0 && available.length > 0
      ? `_No data: ${unavailable.map((c) => c.label).join(', ')}_`
      : '',
    ``,
    `## BBM Subsidy Gap`,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Pertalite pump price | IDR ${output.bbmPertalitePrice.toLocaleString('id-ID')}/liter (Kepmen ESDM 245/2022) |`,
    `| Cost recovery (Brent×USDIDR×1.40) | IDR ${output.bbmCostRecovery.toLocaleString('id-ID')}/liter |`,
    `| Subsidy gap | IDR ${output.bbmSubsidyGap.toLocaleString('id-ID')}/liter |`,
    `| Gap hike risk | ${output.bbmHikeRisk.toUpperCase()} |`,
    `| ICP vs $${ICP_SAFETY_THRESHOLD}/bbl govt threshold | ${output.bbmIcpRisk.toUpperCase()} — $${output.bbmIcpMargin}/bbl margin (Bahlil commitment) |`,
    ``,
    output.flags.length > 0 ? `## Active Flags\n${output.flags.map((f) => `- ⚠️ ${f}`).join('\n')}` : '## No Stress Flags',
    ``,
    `_Food CPI source: Trading Economics / BPS. PIHPS prices: hargapangan.id. APBN 2026 baseline: general CPI 2.5% (Perpres 201/2024)._`,
    `_Transmission chain: Food + BBM spike → headline CPI overshoot → BI forced hike → SBN yield → foreign outflow risk._`,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

export const domesticPressureEngine = new DynamicStructuredTool({
  name: 'domestic_pressure_engine',
  description:
    'Domestic Inflation Pressure Engine: tracks 10 PIHPS strategic food commodity prices (beras, cabai, bawang, daging, telur, minyak goreng, gula). Computes Food Stress Index, fires DOMESTIC PRESSURE ALERT when ≥2 commodities spike simultaneously. Leading indicator for CPI/BI rate pressure.',
  schema: z.object({
    query: z.string().describe('e.g. "Show food price stress" or "Sembako alert?" or "Is food CPI threatening BI rate path?"'),
  }),
  func: async (_input) => {
    try {
      const output = await runDomesticPressureEngine();
      return formatToolResult({ analysis: formatOutput(output), raw: output });
    } catch (error) {
      return formatToolResult({ error: error instanceof Error ? error.message : String(error) });
    }
  },
});
