import type { AlertLevel, IndicatorSnapshot, MacroDataPoint } from './types.js';
import { getLastN } from './time-series-db.js';

export function rollingZScore(series: number[], current: number): number {
  if (series.length < 3) return 0;
  const mean = series.reduce((a, b) => a + b, 0) / series.length;
  const variance = series.reduce((sum, v) => sum + (v - mean) ** 2, 0) / series.length;
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return (current - mean) / std;
}

export function alertFromZScore(z: number): AlertLevel {
  const abs = Math.abs(z);
  if (abs >= 2.5) return 'red';
  if (abs >= 2.0) return 'orange';
  if (abs >= 1.5) return 'yellow';
  return 'green';
}

export function alertFromScore(score: number): AlertLevel {
  if (score >= 75) return 'red';
  if (score >= 55) return 'orange';
  if (score >= 35) return 'yellow';
  return 'green';
}

export function alertLabel(level: AlertLevel): string {
  const map: Record<AlertLevel, string> = {
    green:  '🟢 GREEN',
    yellow: '🟡 YELLOW',
    orange: '🟠 ORANGE',
    red:    '🔴 RED',
  };
  return map[level];
}

export function rateOfChange(current: number, prior: number): number {
  if (prior === 0) return 0;
  return ((current - prior) / Math.abs(prior)) * 100;
}

export async function buildSnapshot(
  indicator: string,
  current: MacroDataPoint,
  prior: MacroDataPoint | null,
  lookback30 = 30,
  lookback90 = 90,
): Promise<IndicatorSnapshot> {
  const h30 = await getLastN(indicator, lookback30);
  const h90 = await getLastN(indicator, lookback90);

  const vals30 = h30.map((p) => p.value);
  const vals90 = h90.map((p) => p.value);

  const z30 = vals30.length >= 5 ? rollingZScore(vals30.slice(0, -1), current.value) : undefined;
  const z90 = vals90.length >= 10 ? rollingZScore(vals90.slice(0, -1), current.value) : undefined;

  const ORDER: AlertLevel[] = ['green', 'yellow', 'orange', 'red'];
  const a30 = z30 !== undefined ? alertFromZScore(z30) : 'green';
  const a90 = z90 !== undefined ? alertFromZScore(z90) : 'green';
  const alertLevel: AlertLevel = ORDER.indexOf(a30) >= ORDER.indexOf(a90) ? a30 : a90;

  return {
    indicator,
    current: current.value,
    prev: prior?.value ?? current.value,
    unit: current.unit,
    source: current.source,
    date: current.date,
    roc: prior ? rateOfChange(current.value, prior.value) : 0,
    zScore30d: z30,
    zScore90d: z90,
    alertLevel,
  };
}

export function compositeScore(snapshots: IndicatorSnapshot[]): number {
  if (snapshots.length === 0) return 0;
  const weights: Record<AlertLevel, number> = {
    green: 0, yellow: 33, orange: 66, red: 100,
  };
  const total = snapshots.reduce((sum, s) => sum + weights[s.alertLevel], 0);
  return Math.round(total / snapshots.length);
}

export function detectFlags(snapshots: IndicatorSnapshot[]): string[] {
  const flags: string[] = [];
  for (const s of snapshots) {
    if (s.alertLevel === 'red') {
      const z = s.zScore90d ?? s.zScore30d;
      flags.push(`${s.indicator} at extreme (z=${z?.toFixed(2) ?? 'n/a'})`);
    }
    if (s.roc < -10 && (s.indicator.includes('reserve') || s.indicator.includes('fx_reserve'))) {
      flags.push(`Rapid reserve drawdown: ${s.roc.toFixed(1)}% MoM`);
    }
    if (s.roc > 15 && s.indicator.includes('import')) {
      flags.push(`Import surge: +${s.roc.toFixed(1)}% YoY — BoP deterioration risk`);
    }
    if (s.roc > 20 && s.indicator.includes('usdidr')) {
      flags.push(`IDR rapid depreciation: +${s.roc.toFixed(1)}% — intervention likely`);
    }
  }
  return [...new Set(flags)];
}
