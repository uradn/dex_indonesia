/**
 * Fiscal Stress Engine — Module 10
 *
 * Tracks APBN (Indonesia State Budget) realization vs annual targets.
 * Detects revenue shortfall, spending overrun, and deficit trajectory divergence
 * from Perpres 201/2024 (APBN 2026) targets.
 *
 * APBN 2026 targets (hardcoded — verify if revised mid-year):
 *   Pendapatan Negara (Revenue): IDR 2,996.9 trillion
 *   Belanja Negara (Spending):   IDR 3,621.3 trillion
 *   Defisit APBN:                IDR 624.4 trillion (~2.56% of GDP)
 *   Nominal GDP assumption:      IDR 24,378.5 trillion
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
import type { AlertLevel } from './types.js';

export const FISCAL_DESCRIPTION = `
MACRO INTELLIGENCE — Fiscal Stress Engine (Module 10)

Tracks Indonesia APBN (State Budget) realization vs 2026 targets.
Detects revenue shortfall, spending overrun, and deficit trajectory risk.

APBN 2026 targets: Revenue IDR 2,997T | Spending IDR 3,621T | Deficit IDR 624T (2.56% GDP)

Detects:
- Revenue shortfall: actual pace below pro-rata target
- Spending overrun: actual pace above approved budget
- Deficit widening: trajectory exceeds 3% GDP constitutional limit
- Fiscal drag: below-target revenue constrains economic stimulus capacity

## When to Use

- "Check APBN realisasi"
- "Is Indonesia fiscal deficit on track?"
- "Revenue absorption rate?"
- "Government spending pace vs target"
- Monthly budget monitoring
`.trim();

// APBN 2026 annual targets (IDR trillion)
const APBN_2026 = {
  revenueTrn: 2996.9,
  spendingTrn: 3621.3,
  deficitTrn: 624.4,
  deficitPctGdp: 2.56,
  gdpTrn: 24378.5,
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
  // 1. Fetch live data
  const { revenue, spending, budgetBalance } = await fetchFiscalRealization();

  const pointsToSave = [revenue, spending, budgetBalance].filter(Boolean);
  if (pointsToSave.length > 0) await upsertPoints(pointsToSave as NonNullable<typeof revenue>[]);

  // 2. Read latest from DB
  const [dbRevenue, dbSpending, dbBudgetBalance] = await Promise.all([
    getLatestPoint('apbn_revenue_monthly_trn'),
    getLatestPoint('apbn_spending_monthly_trn'),
    getLatestPoint('apbn_budget_balance_monthly_trn'),
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
    ``,
    output.flags.length > 0 ? `**Flags:**\n${output.flags.map(f => `- ${f}`).join('\n')}` : '**No active fiscal flags.**',
    ``,
    output.narrative,
    ``,
    `_Data: Trading Economics monthly IDR trillion (government-revenues, government-spending)._`,
    `_YTD = sum of all current-year monthly entries in macro DB. Pro-rata = target × (months_elapsed/12)._`,
    `_Targets: APBN 2026 (Perpres 201/2024). Verify if mid-year revision (APBN-P) issued._`,
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
