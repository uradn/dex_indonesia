import type { CrisisEvent, CrisisValidation, BacktestResult, ModuleSignalAtDate } from './types.js';
import { daysBetween, isInCrisisWindow, INDONESIA_CRISIS_CALENDAR } from './crisis-calendar.js';
import type { AlertLevel } from '../types.js';

/**
 * Validate signals against a single crisis event.
 */
const PRE_CRISIS_WINDOW_DAYS = 180;

export function validateCrisis(
  crisis: CrisisEvent,
  signals: ModuleSignalAtDate[],
): CrisisValidation {
  // Extended 180d pre-crisis window (was 90d — too narrow for slow-burn Fed cycles)
  const windowStart = new Date(new Date(crisis.startDate).getTime() - PRE_CRISIS_WINDOW_DAYS * 86400_000)
    .toISOString().slice(0, 10);
  const precrisisSignals = signals.filter(
    (s) => s.date >= windowStart && s.date <= crisis.startDate,
  );

  let firstAlertDate: string | null = null;
  let firstOrangeDate: string | null = null;
  let firstRedDate: string | null = null;

  for (const s of precrisisSignals.sort((a, b) => a.date.localeCompare(b.date))) {
    if (!firstAlertDate && (s.overallAlert === 'yellow' || s.overallAlert === 'orange' || s.overallAlert === 'red')) {
      firstAlertDate = s.date;
    }
    if (!firstOrangeDate && (s.overallAlert === 'orange' || s.overallAlert === 'red')) {
      firstOrangeDate = s.date;
    }
    if (!firstRedDate && s.overallAlert === 'red') {
      firstRedDate = s.date;
    }
  }

  const leadTimeYellow = firstAlertDate ? daysBetween(firstAlertDate, crisis.startDate) : null;
  const leadTimeOrange = firstOrangeDate ? daysBetween(firstOrangeDate, crisis.startDate) : null;
  const leadTimeRed = firstRedDate ? daysBetween(firstRedDate, crisis.startDate) : null;

  // Nearest trading day lookup (avoids green fallback on holidays/weekends)
  const findNearest = (targetDate: string): AlertLevel => {
    const sorted = signals
      .filter((s) => s.date <= targetDate)
      .sort((a, b) => b.date.localeCompare(a.date));
    return sorted[0]?.overallAlert ?? 'green';
  };
  const signalAtStart = findNearest(crisis.startDate);
  const signalAtPeak  = findNearest(crisis.peakDate);

  const crisisSignals = signals.filter((s) => isInCrisisWindow(s.date, crisis, 0));
  const peakScore = crisisSignals.reduce((max, s) => Math.max(max, s.compositeScore), 0);
  const alertOrder: AlertLevel[] = ['green', 'yellow', 'orange', 'red'];
  const peakAlertLevel = crisisSignals.reduce<AlertLevel>(
    (max, s) => alertOrder.indexOf(s.overallAlert) > alertOrder.indexOf(max) ? s.overallAlert : max,
    'green',
  );

  // Within-crisis ORANGE detection: when did the first ORANGE fire after crisis start?
  const inCrisisOnly = signals.filter(
    (s) => s.date > crisis.startDate && s.date <= crisis.peakDate,
  ).sort((a, b) => a.date.localeCompare(b.date));

  const firstOrangeInCrisis = inCrisisOnly.find(
    (s) => s.overallAlert === 'orange' || s.overallAlert === 'red',
  ) ?? null;

  // Signal peak = date of highest composite score within full crisis window
  const signalPeakEntry = crisisSignals.reduce<ModuleSignalAtDate | null>(
    (max, s) => (max === null || s.compositeScore > max.compositeScore) ? s : max,
    null,
  );

  return {
    crisis,
    firstAlertDate,
    firstOrangeDate,
    firstRedDate,
    leadTimeDaysYellow: leadTimeYellow,
    leadTimeDaysOrange: leadTimeOrange,
    leadTimeDaysRed: leadTimeRed,
    firstOrangeDateInCrisis: firstOrangeInCrisis?.date ?? null,
    daysFromStartToOrange: firstOrangeInCrisis
      ? daysBetween(crisis.startDate, firstOrangeInCrisis.date)
      : null,
    signalPeakDate: signalPeakEntry?.date ?? null,
    signalPeakDaysFromStart: signalPeakEntry
      ? daysBetween(crisis.startDate, signalPeakEntry.date)
      : null,
    peakScore,
    peakAlertLevel,
    signalAtCrisisStart: signalAtStart,
    signalAtCrisisPeak: signalAtPeak,
    caught: firstAlertDate !== null,
  };
}

/**
 * Compute false positive rate: ORANGE+ days outside all crisis windows.
 */
export function computeFalsePositiveRate(
  signals: ModuleSignalAtDate[],
  crises: CrisisEvent[],
): { falsePositiveRate: number; totalAlertDays: number; totalDays: number } {
  const totalDays = signals.length;
  let alertDaysOutsideCrisis = 0;

  for (const s of signals) {
    if (s.overallAlert !== 'orange' && s.overallAlert !== 'red') continue;
    const inAnyCrisis = crises.some((c) => isInCrisisWindow(s.date, c, 60));
    if (!inAnyCrisis) alertDaysOutsideCrisis++;
  }

  const totalAlertDays = signals.filter(
    (s) => s.overallAlert === 'orange' || s.overallAlert === 'red',
  ).length;

  return {
    falsePositiveRate: totalDays > 0 ? (alertDaysOutsideCrisis / totalDays) * 100 : 0,
    totalAlertDays,
    totalDays,
  };
}

/**
 * Aggregate all validations into a BacktestResult summary.
 */
export function buildBacktestResult(
  validations: CrisisValidation[],
  signals: ModuleSignalAtDate[],
  dataRange: { start: string; end: string },
  indicatorsBacktested: string[],
): BacktestResult {
  const hitRate = validations.filter((v) => v.caught).length / validations.length * 100;
  const caughtLeadTimes = validations
    .filter((v) => v.leadTimeDaysYellow !== null)
    .map((v) => v.leadTimeDaysYellow!);
  const avgLeadTime = caughtLeadTimes.length > 0
    ? caughtLeadTimes.reduce((a, b) => a + b, 0) / caughtLeadTimes.length
    : 0;

  const { falsePositiveRate, totalAlertDays, totalDays } = computeFalsePositiveRate(
    signals,
    INDONESIA_CRISIS_CALENDAR,
  );

  const summary = buildSummary(validations, hitRate, avgLeadTime, falsePositiveRate);

  return {
    runDate: new Date().toISOString().slice(0, 10),
    dataRange,
    indicatorsBacktested,
    crisisValidations: validations,
    overallHitRate: hitRate,
    avgLeadTimeDays: avgLeadTime,
    falsePositiveRate,
    totalAlertDays,
    totalDays,
    summary,
  };
}

function buildSummary(
  validations: CrisisValidation[],
  hitRate: number,
  avgLeadTime: number,
  falsePositiveRate: number,
): string {
  const caught = validations.filter((v) => v.caught);
  const missed = validations.filter((v) => !v.caught);
  const parts: string[] = [];
  parts.push(`System caught ${caught.length}/${validations.length} crises (${hitRate.toFixed(0)}% hit rate).`);
  if (avgLeadTime > 0) parts.push(`Average advance warning: ${avgLeadTime.toFixed(0)} days before crisis start.`);
  if (missed.length > 0) parts.push(`Missed: ${missed.map((v) => v.crisis.name).join(', ')}.`);
  const fpQuality = falsePositiveRate <= 3 ? 'excellent' : falsePositiveRate <= 7 ? 'acceptable' : 'high — potential alert fatigue';
  parts.push(`False positive rate: ${falsePositiveRate.toFixed(1)}% of non-crisis trading days flagged ORANGE+ (${fpQuality}; lower is better — target <5%).`);
  return parts.join(' ');
}

export function formatBacktestReport(result: BacktestResult): string {
  const lines: string[] = [
    `# Macro System Backtest Report — Indonesia`,
    `**Run Date:** ${result.runDate}`,
    `**Data Range:** ${result.dataRange.start} → ${result.dataRange.end}`,
    `**Indicators:** ${result.indicatorsBacktested.join(', ')}`,
    ``,
    `## Performance Summary`,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Crisis Hit Rate | ${result.overallHitRate.toFixed(0)}% (${result.crisisValidations.filter(v => v.caught).length}/${result.crisisValidations.length} crises) |`,
    `| Avg Lead Time (YELLOW) | ${result.avgLeadTimeDays.toFixed(0)} days before crisis start |`,
    `| False Positive Rate | ${result.falsePositiveRate.toFixed(1)}% ← lower is better; <5% target; measures phantom alerts on non-crisis days |`,
    `| Total Alert Days (ORANGE+) | ${result.totalAlertDays} of ${result.totalDays} days (${(result.totalAlertDays/result.totalDays*100).toFixed(1)}%) |`,
    ``,
    `## Summary`,
    result.summary,
    ``,
    `## Crisis-by-Crisis Validation`,
    `_Pre-crisis window: ${PRE_CRISIS_WINDOW_DAYS}d before crisis start. ORANGE "in crisis" = fired after start but before IDR peak._`,
    `| Crisis | Lead YELLOW | ORANGE pre | ORANGE in-crisis | Signal peak score | Caught |`,
    `|--------|-------------|------------|-----------------|-------------------|--------|`,
    ...result.crisisValidations.map((v) => {
      const orangePre = v.leadTimeDaysOrange !== null ? `${v.leadTimeDaysOrange}d` : 'none';
      const orangeIn  = v.firstOrangeDateInCrisis && v.daysFromStartToOrange !== null
        ? `+${v.daysFromStartToOrange}d` : (v.firstOrangeDate ? '—' : 'none');
      const sigPeak = v.signalPeakDate && v.signalPeakDaysFromStart !== null
        ? `${v.peakScore}/100 (+${v.signalPeakDaysFromStart}d)` : 'n/a';
      return `| ${v.crisis.name} | ${v.leadTimeDaysYellow !== null ? `${v.leadTimeDaysYellow}d` : 'n/a'} | ${orangePre} | ${orangeIn} | ${sigPeak} | ${v.caught ? '✅' : '❌'} |`;
    }),
    ``,
    `## Crisis Detail`,
    ...result.crisisValidations.map((v) => {
      const orangePreCrisis = v.firstOrangeDate
        ? `${v.firstOrangeDate} (${v.leadTimeDaysOrange}d before start)`
        : v.firstOrangeDateInCrisis
          ? `none pre-crisis → fired ${v.firstOrangeDateInCrisis} (+${v.daysFromStartToOrange}d after start)`
          : 'none';
      const signalPeak = v.signalPeakDate
        ? `${v.signalPeakDate} (+${v.signalPeakDaysFromStart}d from start) score=${v.peakScore}/100`
        : 'n/a';
      return [
        `### ${v.crisis.name} (${v.crisis.startDate} → ${v.crisis.endDate})`,
        `- **IDR Depreciation:** ${v.crisis.idrDepreciationPct}% peak`,
        `- **Root Cause:** ${v.crisis.rootCause}`,
        `- **First YELLOW signal:** ${v.firstAlertDate ?? 'none in 180d window'}${v.leadTimeDaysYellow !== null ? ` (${v.leadTimeDaysYellow} days before start)` : ''}`,
        `- **First ORANGE signal:** ${orangePreCrisis}`,
        `- **Signal peak:** ${signalPeak} [${v.peakAlertLevel.toUpperCase()}]`,
        `- **Signal@start:** ${v.signalAtCrisisStart.toUpperCase()} | **Signal@IDR peak (${v.crisis.peakDate}):** ${v.signalAtCrisisPeak.toUpperCase()}`,
      ].join('\n');
    }),
    ``,
    `_Note: Sovereign CDS from WorldGovernmentBonds.com (Playwright). Data starts Sep 2018 — pre-2018 crises use neutral sovereign baseline._`,
    `_SBN 10Y yield from WGB Playwright (\`bond-historical-data/indonesia/10-years/\`). Coverage from Sep 2016 — contributes to 2018/2020/2022/2023 crises. Pre-2016 crises (2013/2015) use neutral sovereign baseline (score 30)._`,
  ];

  return lines.filter((l) => l !== '').join('\n');
}
