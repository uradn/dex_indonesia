/**
 * Walk-forward replay engine — no lookahead bias.
 *
 * For each date t, computes indicator z-scores using ONLY data available
 * up to t. Simulates what the system would have output in real-time.
 */
import type { DailyBar } from './historical-loader.js';
import type { BacktestPoint, ModuleSignalAtDate } from './types.js';
import type { AlertLevel } from '../types.js';
import { rollingZScore, alertFromZScore } from '../scoring.js';
import { computeRealizedVol } from '../sources/yahoo-macro.js';

const WINDOW_30 = 30;
const WINDOW_90 = 90;

/**
 * Compute rolling z-scores walk-forward for a single indicator series.
 */
export function replayIndicator(bars: DailyBar[]): BacktestPoint[] {
  const points: BacktestPoint[] = [];

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];

    // Need at least WINDOW_30 prior bars for meaningful z-score
    const window30 = bars.slice(Math.max(0, i - WINDOW_30), i).map((b) => b.close);
    const window90 = bars.slice(Math.max(0, i - WINDOW_90), i).map((b) => b.close);

    const zScore30 = window30.length >= 10 ? rollingZScore(window30, bar.close) : null;
    const zScore90 = window90.length >= 20 ? rollingZScore(window90, bar.close) : null;

    const mean30 = window30.length > 0 ? window30.reduce((a, b) => a + b, 0) / window30.length : null;
    const std30 = mean30 !== null && window30.length > 1
      ? Math.sqrt(window30.reduce((s, v) => s + (v - mean30) ** 2, 0) / window30.length)
      : null;

    const alertLevel: AlertLevel = zScore30 !== null
      ? alertFromZScore(zScore30)
      : zScore90 !== null ? alertFromZScore(zScore90) : 'green';

    points.push({
      date: bar.date,
      indicator: '',
      value: bar.close,
      zScore30d: zScore30,
      zScore90d: zScore90,
      alertLevel,
      rollingMean30d: mean30,
      rollingStd30d: std30,
    });
  }

  return points;
}

/**
 * Compute realized volatility walk-forward.
 * Returns map of date → annualized 30d realized vol.
 */
export function replayRealizedVol(bars: DailyBar[], window = 30): Map<string, number> {
  const result = new Map<string, number>();
  for (let i = window; i < bars.length; i++) {
    const slice = bars.slice(i - window, i + 1).map((b) => b.close);
    const vol = computeRealizedVol(slice, window);
    if (vol !== null) {
      result.set(bars[i].date, vol);
    }
  }
  return result;
}

/**
 * Compute composite module signal at each date.
 *
 * Modules scored:
 * - FX Defense: USDIDR z-score (weight 0.30)
 * - Commodity Cushion: export commodity basket avg z-score (weight 0.25)
 * - Foreign Flow: EIDO z-score (weight 0.15)
 * - Sovereign: Indonesia 5Y CDS z-score via WGB (weight 0.10; neutral 30 when no data pre-2018)
 * - Regime proxy: VIX z-score (weight 0.10)
 * - Global stress: DXY z-score (weight 0.10)
 */
export function computeSignals(
  historicalData: Map<string, DailyBar[]>,
  dates: string[],
): ModuleSignalAtDate[] {
  // Pre-compute replay series for each indicator
  const replayed = new Map<string, BacktestPoint[]>();
  for (const [indicator, bars] of historicalData) {
    replayed.set(indicator, replayIndicator(bars));
  }

  // Build lookup: indicator → date → BacktestPoint
  const lookup = new Map<string, Map<string, BacktestPoint>>();
  for (const [indicator, points] of replayed) {
    const byDate = new Map(points.map((p) => [p.date, p]));
    lookup.set(indicator, byDate);
  }

  // Commodity export indicators with weights
  const exportIndicators = ['cpo_price_myr', 'nickel_price_usd', 'copper_price_usd', 'coal_etf_usd', 'gold_price_usd'];

  const alertToScore: Record<AlertLevel, number> = {
    green: 0, yellow: 33, orange: 66, red: 100,
  };

  const signals: ModuleSignalAtDate[] = [];

  for (const date of dates) {
    const getZ = (ind: string): number | null => lookup.get(ind)?.get(date)?.zScore30d ?? null;
    const getAlert = (ind: string): AlertLevel => lookup.get(ind)?.get(date)?.alertLevel ?? 'green';

    // FX Defense score
    const idrZ = getZ('usdidr_spot');
    const fxScore = idrZ !== null ? Math.min(100, Math.abs(idrZ) * 40) : 0;
    const fxAlert = getAlert('usdidr_spot');

    // IDR positive z = depreciation = stress (IDR/USD goes UP when IDR weakens)
    const fxStressScore = idrZ !== null && idrZ > 0 ? fxScore : fxScore * 0.3;

    // Commodity cushion score (negative z = prices below mean = cushion eroding = stress)
    const exportZScores = exportIndicators
      .map((ind) => getZ(ind))
      .filter((z): z is number => z !== null);
    const avgExportZ = exportZScores.length > 0
      ? exportZScores.reduce((a, b) => a + b, 0) / exportZScores.length
      : null;
    const commodityStressScore = avgExportZ !== null
      ? Math.min(100, Math.max(0, 50 - avgExportZ * 25))   // negative z = stress
      : 30;
    const commodityAlert: AlertLevel = commodityStressScore > 66 ? 'orange' : commodityStressScore > 33 ? 'yellow' : 'green';

    // Foreign flow (EIDO): negative z = EIDO falling = foreigners exiting = stress
    const eidoZ = getZ('eido_price');
    const flowStressScore = eidoZ !== null && eidoZ < 0 ? Math.min(100, Math.abs(eidoZ) * 40) : 0;
    const flowAlert: AlertLevel = flowStressScore > 66 ? 'orange' : flowStressScore > 33 ? 'yellow' : 'green';

    // Global stress proxy: VIX z-score (high VIX = high global stress)
    const vixZ = getZ('vix_level');
    const vixStressScore = vixZ !== null && vixZ > 0 ? Math.min(100, vixZ * 35) : 0;

    // DXY: positive z = strong USD = EM pressure
    const dxyZ = getZ('dxy_index');
    const dxyStressScore = dxyZ !== null && dxyZ > 0 ? Math.min(100, dxyZ * 35) : 0;

    // Sovereign: Indonesia 5Y CDS (WGB). Positive z = CDS widening = stress.
    // Falls back to neutral 30 when data unavailable (pre-2018 dates).
    const cdsZ = getZ('indonesia_cds_5y_bps');
    const sovereignStressScore = cdsZ !== null
      ? (cdsZ > 0 ? Math.min(100, cdsZ * 40) : 0)
      : 30;  // neutral default when no CDS data
    const sovereignAlert: AlertLevel = sovereignStressScore > 66 ? 'orange' : sovereignStressScore > 33 ? 'yellow' : 'green';

    // Composite (weights sum to 1.0)
    const compositeScore = Math.round(
      fxStressScore       * 0.30 +
      commodityStressScore * 0.25 +
      flowStressScore      * 0.15 +
      sovereignStressScore * 0.10 +
      vixStressScore       * 0.10 +
      dxyStressScore       * 0.10,
    );

    const vixAlert: AlertLevel    = vixStressScore > 66 ? 'orange' : vixStressScore > 33 ? 'yellow' : 'green';
    const dxyAlert: AlertLevel    = dxyStressScore > 66 ? 'orange' : dxyStressScore > 33 ? 'yellow' : 'green';

    const stressedModuleCount = [fxAlert, commodityAlert, flowAlert, sovereignAlert, vixAlert, dxyAlert].filter(
      (a) => a === 'orange' || a === 'red',
    ).length;

    // Confirmation gate: ORANGE/RED require ≥2 modules stressed.
    // Prevents single-indicator spikes (e.g. isolated VIX/DXY surge) from
    // triggering phantom alerts on non-crisis days (FP rate reduction).
    const rawAlert: AlertLevel =
      compositeScore >= 75 ? 'red' :
      compositeScore >= 55 ? 'orange' :
      compositeScore >= 35 ? 'yellow' : 'green';

    const overallAlert: AlertLevel =
      (rawAlert === 'orange' || rawAlert === 'red') && stressedModuleCount < 2
        ? 'yellow'
        : rawAlert;

    signals.push({
      date,
      moduleScores: {
        fx_defense: Math.round(fxStressScore),
        commodity: Math.round(commodityStressScore),
        foreign_flow: Math.round(flowStressScore),
        sovereign: Math.round(sovereignStressScore),
        global_stress: Math.round((vixStressScore + dxyStressScore) / 2),
      },
      alertLevels: {
        fx_defense: fxAlert,
        commodity: commodityAlert,
        foreign_flow: flowAlert,
        sovereign: sovereignAlert,
        vix: vixAlert,
        dxy: dxyAlert,
      },
      compositeScore,
      overallAlert,
      stressedModuleCount,
    });
  }

  return signals;
}
