/**
 * Fiscal Stress Engine — Module 10
 *
 * Tracks APBN (Indonesia State Budget) realization vs annual targets.
 * Detects revenue shortfall, spending overrun, and deficit trajectory divergence
 * from UU No. 17 Tahun 2025 / Perpres No. 118 Tahun 2025 (APBN 2026) targets.
 *
 * APBN 2026 targets (hardcoded — verify if revised mid-year):
 *   Pendapatan Negara (Revenue): IDR 3,153.58 trillion
 *   Belanja Negara (Spending):   IDR 3,842.73 trillion (original); post-efisiensi ~3,534T
 *   Defisit APBN:                IDR 689.15 trillion (2.68% of GDP)
 *   Nominal GDP assumption:      IDR 25,714.2 trillion
 *
 * Data source: Trading Economics (monthly IDR trillion).
 * Each month's figure is stored in DB; fiscal engine sums current-year entries
 * to compute YTD actuals vs pro-rata target.
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { upsertPoints, getLatestPoint, getLastN } from './time-series-db.js';
import { alertFromScore, alertLabel } from './scoring.js';
import { fetchFiscalRealization } from './sources/kemenkeu.js';
import { fetchSubsidiRealisasi } from './sources/subsidi.js';
import type { AlertLevel } from './types.js';

export const FISCAL_DESCRIPTION = `
MACRO INTELLIGENCE — Fiscal Stress Engine (Module 10)

Tracks Indonesia APBN (State Budget) realization vs 2026 targets.
Detects revenue shortfall, spending overrun, and deficit trajectory risk.

APBN 2026 targets: Revenue IDR 3,154T | Spending IDR 3,843T | Deficit IDR 689T (2.68% GDP)
Post-efisiensi Prabowo: spending revised ~3,534T. Source: UU No.17/2025 / Perpres No.118/2025

Detects:
- Revenue shortfall: actual pace below pro-rata target
- Spending overrun: actual pace above approved budget
- Deficit widening: trajectory exceeds 3% GDP constitutional limit
- Fiscal drag: below-target revenue constrains economic stimulus capacity
- Subsidi energi overshoot: BBM+LPG run rate >110% of APBN target (Rp87T) — oil shock pass-through
- Subsidi pupuk overshoot: fertilizer run rate >120% of APBN target (Rp46.8T)

## When to Use

- "Check APBN realisasi"
- "Is Indonesia fiscal deficit on track?"
- "Revenue absorption rate?"
- "Government spending pace vs target"
- Monthly budget monitoring
- "Subsidi BBM berapa realisasinya?"
- "Is the subsidy budget blowing out?"
`.trim();

// APBN 2026 annual targets (IDR trillion) — UU No. 17 Tahun 2025 / Perpres No. 118 Tahun 2025
// Post-efisiensi spending: ~3,534T (Prabowo Feb 2026 cut Rp308T). Use original for target comparisons.
const APBN_2026 = {
  revenueTrn: 3153.58,
  spendingTrn: 3842.73,
  deficitTrn: 689.15,
  deficitPctGdp: 2.68,
  gdpTrn: 25714.2,
  spendingPostEfisiensiTrn: 3534.73, // informational — post Prabowo ~Rp308T cut
  // Pembayaran bunga utang (interest payments) — from APBN 2026 document
  // S&P threshold: interest/revenue > 15% sustained = negative rating action risk
  // S&P Feb 2026: Indonesia "very likely exceeded" 15% threshold in 2025
  interestPaymentsTrn: 552.7,
  spInterestThresholdPct: 15.0,
  // SBN annual rollover estimate for BI rate uplift calc (~Rp1,200T/yr)
  sbnAnnualRolloverTrn: 1200,
  biRateBaselinePct: 4.75, // BI Rate at start of 2026 hike cycle
  // Subsidi realisasi targets (UU No.17/2025)
  subsidiBbmLpgTrn: 87.0,    // Subsidi BBM + LPG energi annual target
  subsidiPupukTrn: 46.8,      // Subsidi pupuk annual target
};

interface FiscalOutput {
  alert: AlertLevel;
  stressScore: number;
  latestRevenueTrn: number | null;
  latestSpendingTrn: number | null;
  latestBudgetBalanceTrn: number | null;
  revenueDataDate: string | null;
  spendingDataDate: string | null;
  // YTD from DB accumulation (current year months)
  ytdRevenueTrn: number | null;
  ytdSpendingTrn: number | null;
  ytdDeficitTrn: number | null;
  // Pro-rata analysis
  monthsElapsed: number;
  proRataRevenueTrn: number;
  proRataSpendingTrn: number;
  revenueAbsorptionPct: number | null;  // actual YTD / pro-rata target × 100
  spendingAbsorptionPct: number | null;
  projectedAnnualRevenueTrn: number | null;
  projectedDeficitPctGdp: number | null;
  // SRBI sterilization cost (Trilemma quasi-fiscal)
  srbiOutstandingTrn: number | null;
  biRatePct: number | null;
  srbiAnnualCostTrn: number | null;
  srbiCostAsPctDeficit: number | null;
  // S&P interest/revenue ratio
  adjustedInterestTrn: number;
  biRateInterestUpliftTrn: number;
  spInterestRevenuePct: number | null;
  spThresholdBreached: boolean;
  // Subsidi realisasi
  subsidiBbmLpgYtdTrn: number | null;
  subsidiPupukYtdTrn: number | null;
  subsidiBbmLpgRunRatePct: number | null;  // annualized YTD / APBN target × 100
  subsidiPupukRunRatePct: number | null;
  subsidiDataDate: string | null;
  // Alerts
  revenueShortfall: boolean;
  spendingOverrun: boolean;
  deficitRisk: boolean;
  flags: string[];
  narrative: string;
}

/** Score revenue absorption: below pace = fiscal stress. */
function scoreRevenueAbsorption(pct: number): number {
  // pct = actual YTD / pro-rata target × 100
  // 100% = exactly on pace; <80% = significant shortfall
  if (pct >= 100) return 0;
  if (pct >= 90) return Math.round((100 - pct) / 10 * 20);
  if (pct >= 75) return Math.round(20 + (90 - pct) / 15 * 30);
  if (pct >= 60) return Math.round(50 + (75 - pct) / 15 * 30);
  return Math.min(100, Math.round(80 + (60 - pct) / 20 * 20));
}

/** Score spending absorption: above-target spending = stress (overrun). */
function scoreSpendingAbsorption(pct: number): number {
  if (pct <= 100) return 0;
  if (pct <= 110) return Math.round((pct - 100) / 10 * 20);
  if (pct <= 120) return Math.round(20 + (pct - 110) / 10 * 30);
  return Math.min(100, Math.round(50 + (pct - 120) / 20 * 50));
}

/** Compute months elapsed in current year as of latest data date. */
function monthsElapsedInYear(dateStr: string | null): number {
  if (!dateStr) {
    return new Date().getMonth() + 1; // current month
  }
  return parseInt(dateStr.slice(5, 7)); // YYYY-MM-DD → month
}

async function sumCurrentYearPoints(indicator: string): Promise<{ total: number; count: number }> {
  const currentYear = new Date().getFullYear().toString();
  // getLastN returns most recent N; we want all from current year
  // Use a large N (24 months) to ensure we get enough history
  const points = await getLastN(indicator, 24);
  const yearPoints = points.filter(p => p.date.startsWith(currentYear));
  const total = yearPoints.reduce((s, p) => s + p.value, 0);
  return { total, count: yearPoints.length };
}

// TE Indonesia government-revenues returns ANNUAL totals (not monthly).
// Annual revenue ~IDR 2,700-3,000T. Monthly revenue ~IDR 200-300T.
// Threshold to detect: >1000T = annual figure.
const ANNUAL_DATA_THRESHOLD_TRN = 1000;

export async function runFiscalEngine(): Promise<FiscalOutput> {
  // 1. Fetch live data (subsidi in parallel with fiscal realization)
  const [{ revenue, spending, budgetBalance }, subsidyData] = await Promise.all([
    fetchFiscalRealization(),
    fetchSubsidiRealisasi(),
  ]);

  const pointsToSave = [revenue, spending, budgetBalance].filter(Boolean);
  if (pointsToSave.length > 0) await upsertPoints(pointsToSave as NonNullable<typeof revenue>[]);

  // 2. Read latest from DB
  const [dbRevenue, dbSpending, dbBudgetBalance, dbSrbi, dbBiRate] = await Promise.all([
    getLatestPoint('apbn_revenue_monthly_trn'),
    getLatestPoint('apbn_spending_monthly_trn'),
    getLatestPoint('apbn_budget_balance_monthly_trn'),
    getLatestPoint('srbi_outstanding_trn_idr'),
    getLatestPoint('bi_rate_pct'),
  ]);

  const latestRevenueTrn = dbRevenue?.value ?? null;
  const latestSpendingTrn = dbSpending?.value ?? null;
  const latestBudgetBalanceTrn = dbBudgetBalance?.value ?? null;
  const revenueDataDate = dbRevenue?.date ?? null;
  const spendingDataDate = dbSpending?.date ?? null;

  // 3. Detect annual vs monthly data (TE Indonesia revenues = annual total, not monthly)
  const isAnnualRevenue = latestRevenueTrn !== null && latestRevenueTrn > ANNUAL_DATA_THRESHOLD_TRN;
  const isAnnualSpending = latestSpendingTrn !== null && latestSpendingTrn > ANNUAL_DATA_THRESHOLD_TRN;

  const monthsElapsed = monthsElapsedInYear(revenueDataDate);
  const monthFraction = monthsElapsed / 12;
  const proRataRevenueTrn = parseFloat((APBN_2026.revenueTrn * monthFraction).toFixed(1));
  const proRataSpendingTrn = parseFloat((APBN_2026.spendingTrn * monthFraction).toFixed(1));

  let ytdRevenueTrn: number | null = null;
  let ytdSpendingTrn: number | null = null;
  let revenueAbsorptionPct: number | null = null;
  let spendingAbsorptionPct: number | null = null;
  let projectedAnnualRevenueTrn: number | null = null;

  if (isAnnualRevenue && latestRevenueTrn !== null) {
    // Annual figure (prior-year actual from TE) — compare directly to current-year APBN target
    // This shows: "if revenue stays at prior-year level, gap vs APBN target = X%"
    ytdRevenueTrn = latestRevenueTrn;
    projectedAnnualRevenueTrn = latestRevenueTrn;
    revenueAbsorptionPct = parseFloat((latestRevenueTrn / APBN_2026.revenueTrn * 100).toFixed(1));
  } else if (!isAnnualRevenue) {
    // Monthly data — accumulate YTD
    const revYtd = await sumCurrentYearPoints('apbn_revenue_monthly_trn');
    ytdRevenueTrn = revYtd.count > 0 ? parseFloat(revYtd.total.toFixed(1)) : null;
    if (ytdRevenueTrn !== null) {
      projectedAnnualRevenueTrn = monthsElapsed > 0
        ? parseFloat(((ytdRevenueTrn / monthsElapsed) * 12).toFixed(1))
        : null;
      revenueAbsorptionPct = proRataRevenueTrn > 0
        ? parseFloat((ytdRevenueTrn / proRataRevenueTrn * 100).toFixed(1))
        : null;
    }
  }

  if (isAnnualSpending && latestSpendingTrn !== null) {
    ytdSpendingTrn = latestSpendingTrn;
    spendingAbsorptionPct = parseFloat((latestSpendingTrn / APBN_2026.spendingTrn * 100).toFixed(1));
  } else if (!isAnnualSpending) {
    const spdYtd = await sumCurrentYearPoints('apbn_spending_monthly_trn');
    ytdSpendingTrn = spdYtd.count > 0 ? parseFloat(spdYtd.total.toFixed(1)) : null;
    if (ytdSpendingTrn !== null && proRataSpendingTrn > 0) {
      spendingAbsorptionPct = parseFloat((ytdSpendingTrn / proRataSpendingTrn * 100).toFixed(1));
    }
  }

  const ytdDeficitTrn: number | null = null; // can't compute: annual revenue vs monthly spending inconsistent

  const projectedDeficitPctGdp = projectedAnnualRevenueTrn !== null
    ? parseFloat(((APBN_2026.spendingTrn - projectedAnnualRevenueTrn) / APBN_2026.gdpTrn * 100).toFixed(2))
    : null;

  // 4b. SRBI sterilization cost — Trilemma quasi-fiscal drag (R&R framework)
  // Trilemma: capital account open + monetary autonomy → cannot fix IDR without sterilizing FX intervention
  // BI issues SRBI to absorb excess Rupiah from USD purchases → pays BI Rate on outstanding → reduces BI profit remittance to Treasury
  const srbiOutstandingTrn = dbSrbi?.value ?? null;
  const biRatePct = dbBiRate?.value ?? 5.50; // fallback: BI Rate as of Jun 9 2026 (+25bps)
  const srbiAnnualCostTrn = srbiOutstandingTrn !== null
    ? parseFloat((srbiOutstandingTrn * (biRatePct / 100)).toFixed(1))
    : null;
  const srbiCostAsPctDeficit = srbiAnnualCostTrn !== null
    ? parseFloat((srbiAnnualCostTrn / APBN_2026.deficitTrn * 100).toFixed(1))
    : null;

  // 4c. S&P interest/revenue ratio — threshold 15% for negative rating action
  // BI hike uplift: each 25bps on ~Rp1,200T annual SBN rollover = +Rp3T/yr additional interest
  const biRateInterestUpliftTrn = biRatePct > APBN_2026.biRateBaselinePct
    ? parseFloat(((biRatePct - APBN_2026.biRateBaselinePct) / 100 * APBN_2026.sbnAnnualRolloverTrn).toFixed(1))
    : 0;
  const adjustedInterestTrn = APBN_2026.interestPaymentsTrn + biRateInterestUpliftTrn;
  const revenueForSpCalc = projectedAnnualRevenueTrn ?? (latestRevenueTrn ?? null);
  const spInterestRevenuePct = revenueForSpCalc !== null && revenueForSpCalc > 0
    ? parseFloat((adjustedInterestTrn / revenueForSpCalc * 100).toFixed(1))
    : null;
  const spThresholdBreached = spInterestRevenuePct !== null && spInterestRevenuePct > APBN_2026.spInterestThresholdPct;

  // 4d. Subsidi realisasi run-rate
  // Run rate = (YTD value / months_elapsed * 12) / APBN_target × 100
  // >100% = on pace; >110% = YELLOW; >130% = ORANGE (overshoot)
  const subsidiBbmLpgYtdTrn = subsidyData?.subsidiBbmLpgYtdTrn ?? (await getLatestPoint('subsidi_energi_ytd_idr_t'))?.value ?? null;
  const subsidiPupukYtdTrn = subsidyData?.subsidiPupukYtdTrn ?? (await getLatestPoint('subsidi_pupuk_ytd_idr_t'))?.value ?? null;
  const subsidiDataDate = subsidyData?.date ?? null;

  const subsidiBbmLpgRunRatePct = subsidiBbmLpgYtdTrn !== null && monthsElapsed > 0
    ? parseFloat(((subsidiBbmLpgYtdTrn / monthsElapsed * 12) / APBN_2026.subsidiBbmLpgTrn * 100).toFixed(1))
    : null;
  const subsidiPupukRunRatePct = subsidiPupukYtdTrn !== null && monthsElapsed > 0
    ? parseFloat(((subsidiPupukYtdTrn / monthsElapsed * 12) / APBN_2026.subsidiPupukTrn * 100).toFixed(1))
    : null;

  // 5. Stress score
  const components: Array<[number, number]> = [];
  if (revenueAbsorptionPct !== null) components.push([scoreRevenueAbsorption(revenueAbsorptionPct), 0.50]);
  if (spendingAbsorptionPct !== null) components.push([scoreSpendingAbsorption(spendingAbsorptionPct), 0.30]);
  if (projectedDeficitPctGdp !== null && projectedDeficitPctGdp > 3.0) {
    const deficitStress = Math.min(100, Math.round((projectedDeficitPctGdp - 3.0) / 1.0 * 60 + 40));
    components.push([deficitStress, 0.20]);
  }

  let stressScore = 15;
  if (components.length > 0) {
    const totalWeight = components.reduce((s, [, w]) => s + w, 0);
    stressScore = Math.round(components.reduce((s, [score, w]) => s + score * w, 0) / totalWeight);
  }

  // Subsidi run-rate stress contribution (weight 0.15 of total)
  if (subsidiBbmLpgRunRatePct !== null && subsidiBbmLpgRunRatePct > 100) {
    const subsidyStress = subsidiBbmLpgRunRatePct >= 130 ? 65 : subsidiBbmLpgRunRatePct >= 110 ? 40 : 15;
    components.push([subsidyStress, 0.15]);
  }

  // Constitutional breach floors: 3% GDP ceiling = YELLOW min; >4% = ORANGE min
  if (projectedDeficitPctGdp !== null && projectedDeficitPctGdp > 4.0) {
    stressScore = Math.max(stressScore, 55);
  } else if (projectedDeficitPctGdp !== null && projectedDeficitPctGdp > 3.0) {
    stressScore = Math.max(stressScore, 35);
  }
  // S&P interest/revenue floor: >15% = YELLOW min; >20% = ORANGE min
  if (spInterestRevenuePct !== null && spInterestRevenuePct > 20) {
    stressScore = Math.max(stressScore, 50);
  } else if (spThresholdBreached) {
    stressScore = Math.max(stressScore, 35);
  }

  const alert = alertFromScore(stressScore) as AlertLevel;

  // 6. Boolean flags
  const revenueShortfall = revenueAbsorptionPct !== null && revenueAbsorptionPct < 85;
  const spendingOverrun = spendingAbsorptionPct !== null && spendingAbsorptionPct > 110;
  const deficitRisk = projectedDeficitPctGdp !== null && projectedDeficitPctGdp > 3.0;

  const flags: string[] = [];
  if (revenueShortfall) {
    flags.push(`Revenue shortfall: ${revenueAbsorptionPct!.toFixed(0)}% of pro-rata target (expected 100% for month ${monthsElapsed})`);
  }
  if (spendingOverrun) {
    flags.push(`Spending overrun: ${spendingAbsorptionPct!.toFixed(0)}% of pro-rata target — above pace`);
  }
  if (deficitRisk) {
    flags.push(`Deficit trajectory: projected ${projectedDeficitPctGdp!.toFixed(2)}% GDP — approaching 3% constitutional limit`);
  }
  if (latestRevenueTrn === null && latestSpendingTrn === null) {
    flags.push('No fiscal data available — TE scrape failed. Check tradingeconomics.com/indonesia/government-revenues');
  }

  // Subsidi run-rate flags
  if (subsidiBbmLpgRunRatePct !== null) {
    if (subsidiBbmLpgRunRatePct >= 130) {
      flags.push(`SUBSIDI ENERGI OVERSHOOT: run rate ${subsidiBbmLpgRunRatePct.toFixed(0)}% of APBN target (Rp${APBN_2026.subsidiBbmLpgTrn}T) — high oil+IDR forcing fiscal rescue choice: hike BBM or blow deficit`);
    } else if (subsidiBbmLpgRunRatePct >= 110) {
      flags.push(`Subsidi energi elevated: run rate ${subsidiBbmLpgRunRatePct.toFixed(0)}% of APBN target — monitor for blowout if Brent stays above APBN $70/bbl assumption`);
    }
  }
  if (subsidiPupukRunRatePct !== null && subsidiPupukRunRatePct >= 120) {
    flags.push(`Subsidi pupuk overshoot: run rate ${subsidiPupukRunRatePct.toFixed(0)}% of APBN target (Rp${APBN_2026.subsidiPupukTrn}T) — LNG feedstock cost pass-through`);
  }

  if (srbiCostAsPctDeficit !== null && srbiCostAsPctDeficit > 10) {
    flags.push(`SRBI STERILIZATION BURDEN ELEVATED: IDR ${srbiAnnualCostTrn!.toFixed(0)}T/yr (${srbiCostAsPctDeficit.toFixed(1)}% of APBN deficit) — Trilemma cost: FX defense requires sterilization → reduces BI profit remittance to Treasury`);
  } else if (srbiCostAsPctDeficit !== null && srbiCostAsPctDeficit > 5) {
    flags.push(`SRBI sterilization cost notable: IDR ${srbiAnnualCostTrn!.toFixed(0)}T/yr (${srbiCostAsPctDeficit.toFixed(1)}% of APBN deficit) — quasi-fiscal drag on BI balance sheet`);
  }

  // S&P interest/revenue flags
  if (spInterestRevenuePct !== null) {
    if (spInterestRevenuePct > 20) {
      flags.push(`S&P THRESHOLD CRITICAL: interest/revenue ${spInterestRevenuePct.toFixed(1)}% (APBN ${APBN_2026.interestPaymentsTrn}T + BI hike uplift ${biRateInterestUpliftTrn}T vs revenue ${revenueForSpCalc?.toFixed(0)}T) — ${(spInterestRevenuePct - APBN_2026.spInterestThresholdPct).toFixed(1)}pp above S&P 15% negative-action threshold`);
    } else if (spThresholdBreached) {
      flags.push(`S&P threshold breached: interest/revenue ${spInterestRevenuePct.toFixed(1)}% > 15% — S&P Feb 2026 warning; sustained breach risks negative rating action on BBB`);
    }
    if (biRateInterestUpliftTrn > 0) {
      flags.push(`BI hike cycle adds Rp${biRateInterestUpliftTrn.toFixed(0)}T/yr to debt service (${((biRatePct ?? 5.5) - APBN_2026.biRateBaselinePct).toFixed(2)}pp × Rp${APBN_2026.sbnAnnualRolloverTrn}T rollover) — BI sinyal hike lagi memperburuk rasio`);
    }
  }

  // 7. Narrative
  const isAnnualRevenueFlag = latestRevenueTrn !== null && latestRevenueTrn > ANNUAL_DATA_THRESHOLD_TRN;
  const isAnnualSpendingFlag = latestSpendingTrn !== null && latestSpendingTrn > ANNUAL_DATA_THRESHOLD_TRN;

  const revenueStr = ytdRevenueTrn !== null
    ? isAnnualRevenueFlag
      ? `Prior-year annual revenue IDR ${ytdRevenueTrn.toFixed(0)}T (${revenueAbsorptionPct?.toFixed(0) ?? '?'}% of APBN 2026 target)`
      : `YTD revenue IDR ${ytdRevenueTrn.toFixed(0)}T (${revenueAbsorptionPct?.toFixed(0) ?? '?'}% of pro-rata target M${monthsElapsed})`
    : 'Revenue: n/a';
  const spendingStr = ytdSpendingTrn !== null
    ? isAnnualSpendingFlag
      ? `Prior-year annual spending IDR ${ytdSpendingTrn.toFixed(0)}T`
      : `YTD spending IDR ${ytdSpendingTrn.toFixed(0)}T`
    : latestSpendingTrn !== null ? `Latest monthly spending IDR ${latestSpendingTrn.toFixed(0)}T` : 'Spending: n/a';
  const projDefStr = projectedDeficitPctGdp !== null
    ? `Projected full-year deficit: ${projectedDeficitPctGdp.toFixed(2)}% GDP (target: ${APBN_2026.deficitPctGdp}% GDP).`
    : '';

  const narrative = [
    `Fiscal stress: ${stressScore}/100 — ${alertLabel(alert).toUpperCase()}.`,
    `${revenueStr}. ${spendingStr}.`,
    projDefStr,
    flags.length === 0 ? 'No fiscal stress flags.' : '',
  ].filter(Boolean).join(' ');

  return {
    alert, stressScore,
    latestRevenueTrn, latestSpendingTrn, latestBudgetBalanceTrn,
    revenueDataDate, spendingDataDate,
    ytdRevenueTrn, ytdSpendingTrn, ytdDeficitTrn,
    monthsElapsed, proRataRevenueTrn, proRataSpendingTrn,
    revenueAbsorptionPct, spendingAbsorptionPct,
    projectedAnnualRevenueTrn, projectedDeficitPctGdp,
    srbiOutstandingTrn, biRatePct, srbiAnnualCostTrn, srbiCostAsPctDeficit,
    adjustedInterestTrn, biRateInterestUpliftTrn, spInterestRevenuePct, spThresholdBreached,
    subsidiBbmLpgYtdTrn, subsidiPupukYtdTrn,
    subsidiBbmLpgRunRatePct, subsidiPupukRunRatePct, subsidiDataDate,
    revenueShortfall, spendingOverrun, deficitRisk,
    flags, narrative,
  };
}

function formatFiscalOutput(output: FiscalOutput): string {
  const isAnnualRev = output.latestRevenueTrn !== null && output.latestRevenueTrn > ANNUAL_DATA_THRESHOLD_TRN;
  const isAnnualSpd = output.latestSpendingTrn !== null && output.latestSpendingTrn > ANNUAL_DATA_THRESHOLD_TRN;

  const ytdRevStr = output.ytdRevenueTrn !== null
    ? isAnnualRev
      ? `IDR ${output.ytdRevenueTrn.toFixed(0)}T (prior-yr actual)`
      : `IDR ${output.ytdRevenueTrn.toFixed(0)}T YTD`
    : output.latestRevenueTrn !== null ? `IDR ${output.latestRevenueTrn.toFixed(0)}T/mo` : 'n/a';

  const ytdSpdStr = output.ytdSpendingTrn !== null
    ? isAnnualSpd
      ? `IDR ${output.ytdSpendingTrn.toFixed(0)}T (prior-yr actual)`
      : `IDR ${output.ytdSpendingTrn.toFixed(0)}T YTD`
    : output.latestSpendingTrn !== null ? `IDR ${output.latestSpendingTrn.toFixed(0)}T/mo` : 'n/a';

  const proRataLabel = isAnnualRev ? 'vs Annual Target' : `Pro-Rata (M${output.monthsElapsed})`;

  return [
    `## Fiscal Stress Engine — Module 10`,
    `**Alert:** ${alertLabel(output.alert).toUpperCase()} | **Stress Score:** ${output.stressScore}/100`,
    ``,
    `### APBN 2026 Targets`,
    `| Item | APBN 2026 Target | Actual | ${proRataLabel} | Absorption |`,
    `|------|--------|-----------|------|------------|`,
    `| Revenue | IDR ${APBN_2026.revenueTrn}T | ${ytdRevStr} | IDR ${isAnnualRev ? APBN_2026.revenueTrn.toFixed(0) : output.proRataRevenueTrn.toFixed(0)}T | ${output.revenueAbsorptionPct !== null ? output.revenueAbsorptionPct.toFixed(0) + '%' : 'n/a'} |`,
    `| Spending | IDR ${APBN_2026.spendingTrn}T | ${ytdSpdStr} | IDR ${isAnnualSpd ? APBN_2026.spendingTrn.toFixed(0) : output.proRataSpendingTrn.toFixed(0)}T | ${output.spendingAbsorptionPct !== null ? output.spendingAbsorptionPct.toFixed(0) + '%' : 'n/a'} |`,
    `| Deficit | IDR ${APBN_2026.deficitTrn}T (${APBN_2026.deficitPctGdp}% GDP) | ${output.ytdDeficitTrn !== null ? 'IDR ' + output.ytdDeficitTrn.toFixed(0) + 'T' : 'n/a'} | — | — |`,
    ``,
    output.projectedDeficitPctGdp !== null
      ? `**Projected full-year deficit:** ${output.projectedDeficitPctGdp.toFixed(2)}% GDP (target: ${APBN_2026.deficitPctGdp}% | limit: 3.0%)`
      : '',
    ``,
    `### Risk Flags`,
    `| Signal | Status |`,
    `|--------|--------|`,
    `| Revenue shortfall | ${output.revenueShortfall ? '⚠️ ACTIVE' : 'No'} |`,
    `| Spending overrun | ${output.spendingOverrun ? '⚠️ ACTIVE' : 'No'} |`,
    `| Deficit > 3% GDP | ${output.deficitRisk ? '⚠️ ACTIVE' : 'No'} |`,
    `| S&P interest/revenue >15% | ${output.spThresholdBreached ? `🔴 ${output.spInterestRevenuePct?.toFixed(1)}% — BREACHED` : output.spInterestRevenuePct !== null ? `✅ ${output.spInterestRevenuePct.toFixed(1)}%` : 'n/a'} |`,
    ``,
    output.flags.length > 0 ? `**Flags:**\n${output.flags.map(f => `- ${f}`).join('\n')}` : '**No active fiscal flags.**',
    ``,
    output.narrative,
    ``,
    output.srbiOutstandingTrn !== null
      ? [
          `### SRBI Sterilization Cost (Trilemma)`,
          `| Item | Value |`,
          `|------|-------|`,
          `| SRBI outstanding | IDR ${output.srbiOutstandingTrn.toFixed(0)}T |`,
          `| BI Rate | ${output.biRatePct?.toFixed(2)}% |`,
          `| Est. annual SRBI interest cost | IDR ${output.srbiAnnualCostTrn?.toFixed(0)}T/yr |`,
          `| Cost as % of APBN deficit | ${output.srbiCostAsPctDeficit?.toFixed(1)}% |`,
          `_Capital account open + monetary autonomy → sterilization mandatory. SRBI interest = quasi-fiscal drag on BI profit remittance to Treasury. [R&R Trilemma framework]_`,
          ``,
        ].join('\n')
      : '',
    output.subsidiBbmLpgYtdTrn !== null || output.subsidiPupukYtdTrn !== null ? [
      `### Subsidi Realisasi`,
      `| Subsidi | APBN 2026 Target | YTD Actual | Ann. Run Rate |`,
      `|---------|--------|-----------|--------------|`,
      `| BBM+LPG (energi) | IDR ${APBN_2026.subsidiBbmLpgTrn}T | ${output.subsidiBbmLpgYtdTrn !== null ? `IDR ${output.subsidiBbmLpgYtdTrn.toFixed(1)}T` : 'n/a'} | ${output.subsidiBbmLpgRunRatePct !== null ? `${output.subsidiBbmLpgRunRatePct.toFixed(0)}%` : 'n/a'} |`,
      `| Pupuk | IDR ${APBN_2026.subsidiPupukTrn}T | ${output.subsidiPupukYtdTrn !== null ? `IDR ${output.subsidiPupukYtdTrn.toFixed(1)}T` : 'n/a'} | ${output.subsidiPupukRunRatePct !== null ? `${output.subsidiPupukRunRatePct.toFixed(0)}%` : 'n/a'} |`,
      output.subsidiDataDate ? `_Data date: ${output.subsidiDataDate} (source: APBN Kita / media)_` : '',
      `_Run rate = annualized YTD / APBN target. >110% = elevated; >130% = overshoot alert._`,
    ].filter(Boolean).join('\n') : '',
    `_Data: Trading Economics monthly IDR trillion (government-revenues, government-spending)._`,
    `_YTD = sum of all current-year monthly entries in macro DB. Pro-rata = target × (months_elapsed/12)._`,
    `_Targets: APBN 2026 (UU No.17/2025 / Perpres No.118/2025). Post-efisiensi spending ~3,534T. YTD April 2026 deficit realization: 0.64% GDP (Rp164.4T)._`,
  ].filter(l => l !== '').join('\n');
}

export const fiscalEngine = new DynamicStructuredTool({
  name: 'fiscal_engine',
  description: FISCAL_DESCRIPTION,
  schema: z.object({
    query: z.string().describe('e.g. "APBN realisasi check" or "Revenue absorption rate?" or "Is deficit on track?"'),
  }),
  func: async (_input) => {
    try {
      const output = await runFiscalEngine();
      return formatToolResult(formatFiscalOutput(output));
    } catch (e) {
      return formatToolResult(`Fiscal Engine error: ${String(e)}`);
    }
  },
});
