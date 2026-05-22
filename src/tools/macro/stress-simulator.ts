/**
 * Macro Stress Scenario Simulator.
 *
 * Takes hypothetical override values for key indicators, computes z-scores
 * against actual historical windows, runs the same composite scoring as the
 * live engines, and outputs baseline vs stressed comparison.
 *
 * No lookahead: uses only actual past data to compute the historical window.
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { fetchFullHistory } from './backtest/historical-loader.js';
import { rollingZScore, alertFromZScore } from './scoring.js';
import type { AlertLevel } from './types.js';

const EXPORT_TICKERS: Array<{ ticker: string; indicator: string }> = [
  { ticker: 'FCPO.KL',  indicator: 'cpo_price_myr'    },
  { ticker: 'NI=F',     indicator: 'nickel_price_usd'  },
  { ticker: 'HG=F',     indicator: 'copper_price_usd'  },
  { ticker: 'GC=F',     indicator: 'gold_price_usd'    },
  { ticker: 'KOL',      indicator: 'coal_etf_usd'      },
];

const STRESS_TICKERS: Array<{ ticker: string; indicator: string }> = [
  { ticker: 'IDR=X',    indicator: 'usdidr_spot'   },
  { ticker: '^VIX',     indicator: 'vix_level'      },
  { ticker: 'DX-Y.NYB', indicator: 'dxy_index'      },
  { ticker: 'EIDO',     indicator: 'eido_price'     },
  ...EXPORT_TICKERS,
];

interface ModuleBreakdown {
  fxStress: number;
  commodityStress: number;
  foreignFlowStress: number;
  vixStress: number;
  dxyStress: number;
  composite: number;
  alertLevel: AlertLevel;
}

interface HistorySeries {
  indicator: string;
  series90d: number[];
  currentValue: number;
}

async function fetchSeries(daysBack = 150): Promise<Map<string, HistorySeries>> {
  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - daysBack * 86400_000).toISOString().slice(0, 10);

  const result = new Map<string, HistorySeries>();

  await Promise.allSettled(
    STRESS_TICKERS.map(async ({ ticker, indicator }) => {
      const bars = await fetchFullHistory(ticker, startDate, endDate);
      if (bars.length < 5) return;
      const values = bars.map((b) => b.close);
      result.set(indicator, {
        indicator,
        series90d: values.slice(0, -1),       // exclude last point = "current"
        currentValue: values[values.length - 1],
      });
    }),
  );

  return result;
}

function computeZ(series: number[], value: number): number | null {
  return series.length >= 10 ? rollingZScore(series, value) : null;
}

function scoreModules(
  idrZ: number | null,
  avgExportZ: number | null,
  eidoZ: number | null,
  vixZ: number | null,
  dxyZ: number | null,
): ModuleBreakdown {
  const fxScore = idrZ !== null ? Math.min(100, Math.abs(idrZ) * 40) : 0;
  const fxStress = idrZ !== null && idrZ > 0 ? fxScore : fxScore * 0.3;

  const commodityStress = avgExportZ !== null
    ? Math.min(100, Math.max(0, 50 - avgExportZ * 25))
    : 30;

  const foreignFlowStress = eidoZ !== null && eidoZ < 0
    ? Math.min(100, Math.abs(eidoZ) * 40)
    : 0;

  const vixStress = vixZ !== null && vixZ > 0 ? Math.min(100, vixZ * 35) : 0;
  const dxyStress = dxyZ !== null && dxyZ > 0 ? Math.min(100, dxyZ * 35) : 0;

  const composite = Math.round(
    fxStress * 0.35 +
    commodityStress * 0.25 +
    foreignFlowStress * 0.20 +
    vixStress * 0.10 +
    dxyStress * 0.10,
  );

  const alertLevel: AlertLevel =
    composite >= 75 ? 'red' :
    composite >= 55 ? 'orange' :
    composite >= 35 ? 'yellow' : 'green';

  return {
    fxStress: Math.round(fxStress),
    commodityStress: Math.round(commodityStress),
    foreignFlowStress: Math.round(foreignFlowStress),
    vixStress: Math.round(vixStress),
    dxyStress: Math.round(dxyStress),
    composite,
    alertLevel,
  };
}

function alertLabel(level: AlertLevel): string {
  return { green: '🟢 GREEN', yellow: '🟡 YELLOW', orange: '🟠 ORANGE', red: '🔴 RED' }[level];
}

function formatBreakdown(b: ModuleBreakdown): string {
  return [
    `  FX Defense:     ${b.fxStress}/100`,
    `  Commodity:      ${b.commodityStress}/100`,
    `  Foreign Flow:   ${b.foreignFlowStress}/100`,
    `  Global Stress:  ${Math.round((b.vixStress + b.dxyStress) / 2)}/100 (VIX ${b.vixStress} / DXY ${b.dxyStress})`,
    `  ─────────────────────────`,
    `  COMPOSITE:      ${b.composite}/100  [${alertLabel(b.alertLevel)}]`,
  ].join('\n');
}

export const STRESS_SIMULATOR_DESCRIPTION = `
Run macro stress scenario simulation for Indonesia.

Given hypothetical shock inputs, computes how the composite stress score would change.
Uses actual historical data (last 90d) to anchor z-scores — not arbitrary scales.

Useful for:
- "What if IDR hits 18,500 / 19,000?"
- "What if VIX spikes to 45 + DXY to 115?"
- "What if coal + CPO crash 30%?"
- "What if EIDO drops 25% (foreign equity exit)?"
- Combined shock scenarios (e.g., Turkey-style EM crisis)

Outputs: baseline vs stressed scores, module-by-module breakdown, delta, alert level transition.
`.trim();

export const stressSimulator = new DynamicStructuredTool({
  name: 'stress_simulator',
  description: STRESS_SIMULATOR_DESCRIPTION,
  schema: z.object({
    scenarioName: z.string().optional().describe('Label for the scenario, e.g. "IDR 19000 + VIX 45"'),
    idrLevel: z.number().optional().describe('Hypothetical USDIDR spot rate, e.g. 18500'),
    vixLevel: z.number().optional().describe('Hypothetical VIX level, e.g. 45'),
    dxyLevel: z.number().optional().describe('Hypothetical DXY index level, e.g. 115'),
    eidoPctChange: z.number().optional().describe('% change to EIDO from current, e.g. -30 means EIDO falls 30%'),
    commodityShockPct: z.number().optional().describe('Uniform % shock to all export commodity prices, e.g. -25'),
    coalShockPct: z.number().optional().describe('% change to coal price specifically'),
    cpoShockPct: z.number().optional().describe('% change to CPO price specifically'),
    nickelShockPct: z.number().optional().describe('% change to nickel price specifically'),
  }),
  func: async (input) => {
    const {
      scenarioName,
      idrLevel,
      vixLevel,
      dxyLevel,
      eidoPctChange,
      commodityShockPct,
      coalShockPct,
      cpoShockPct,
      nickelShockPct,
    } = input;

    const label = scenarioName ?? 'Custom Stress Scenario';

    const series = await fetchSeries(150);

    if (series.size === 0) {
      return 'Failed to fetch historical data. Check network.';
    }

    const get = (ind: string) => series.get(ind);

    // ── Baseline z-scores ──────────────────────────────────────────────
    const idrData    = get('usdidr_spot');
    const vixData    = get('vix_level');
    const dxyData    = get('dxy_index');
    const eidoData   = get('eido_price');

    const exportIndicators = ['cpo_price_myr', 'nickel_price_usd', 'copper_price_usd', 'coal_etf_usd', 'gold_price_usd'];

    const baselineIdrZ = idrData ? computeZ(idrData.series90d, idrData.currentValue) : null;
    const baselineVixZ = vixData ? computeZ(vixData.series90d, vixData.currentValue) : null;
    const baselineDxyZ = dxyData ? computeZ(dxyData.series90d, dxyData.currentValue) : null;
    const baselineEidoZ = eidoData ? computeZ(eidoData.series90d, eidoData.currentValue) : null;

    const baselineExportZs = exportIndicators
      .map((ind) => {
        const d = get(ind);
        return d ? computeZ(d.series90d, d.currentValue) : null;
      })
      .filter((z): z is number => z !== null);
    const baselineAvgExportZ = baselineExportZs.length > 0
      ? baselineExportZs.reduce((a, b) => a + b, 0) / baselineExportZs.length
      : null;

    // ── Stressed values ────────────────────────────────────────────────
    const stressedIdrValue  = idrLevel ?? idrData?.currentValue ?? null;
    const stressedVixValue  = vixLevel ?? vixData?.currentValue ?? null;
    const stressedDxyValue  = dxyLevel ?? dxyData?.currentValue ?? null;
    const stressedEidoValue = eidoData
      ? eidoPctChange !== undefined
        ? eidoData.currentValue * (1 + eidoPctChange / 100)
        : eidoData.currentValue
      : null;

    // Per-commodity or blanket shock
    const applyShock = (ind: string, current: number): number => {
      if (ind === 'coal_etf_usd' && coalShockPct !== undefined) return current * (1 + coalShockPct / 100);
      if (ind === 'cpo_price_myr' && cpoShockPct !== undefined) return current * (1 + cpoShockPct / 100);
      if (ind === 'nickel_price_usd' && nickelShockPct !== undefined) return current * (1 + nickelShockPct / 100);
      if (commodityShockPct !== undefined) return current * (1 + commodityShockPct / 100);
      return current;
    };

    const stressedExportZs = exportIndicators
      .map((ind) => {
        const d = get(ind);
        if (!d) return null;
        const stressedValue = applyShock(ind, d.currentValue);
        return computeZ(d.series90d, stressedValue);
      })
      .filter((z): z is number => z !== null);
    const stressedAvgExportZ = stressedExportZs.length > 0
      ? stressedExportZs.reduce((a, b) => a + b, 0) / stressedExportZs.length
      : null;

    const stressedIdrZ  = idrData && stressedIdrValue !== null  ? computeZ(idrData.series90d, stressedIdrValue) : null;
    const stressedVixZ  = vixData && stressedVixValue !== null  ? computeZ(vixData.series90d, stressedVixValue) : null;
    const stressedDxyZ  = dxyData && stressedDxyValue !== null  ? computeZ(dxyData.series90d, stressedDxyValue) : null;
    const stressedEidoZ = eidoData && stressedEidoValue !== null ? computeZ(eidoData.series90d, stressedEidoValue) : null;

    // ── Score both ─────────────────────────────────────────────────────
    const baseline = scoreModules(baselineIdrZ, baselineAvgExportZ, baselineEidoZ, baselineVixZ, baselineDxyZ);
    const stressed = scoreModules(stressedIdrZ, stressedAvgExportZ, stressedEidoZ, stressedVixZ, stressedDxyZ);

    const delta = stressed.composite - baseline.composite;
    const deltaSign = delta >= 0 ? '+' : '';
    const levelChanged = baseline.alertLevel !== stressed.alertLevel;

    // ── Scenario inputs summary ────────────────────────────────────────
    const inputLines: string[] = [];
    if (idrLevel !== undefined)        inputLines.push(`USDIDR:    ${idrLevel.toLocaleString()} (current: ${idrData?.currentValue.toLocaleString() ?? 'n/a'})`);
    if (vixLevel !== undefined)        inputLines.push(`VIX:       ${vixLevel} (current: ${vixData?.currentValue.toFixed(1) ?? 'n/a'})`);
    if (dxyLevel !== undefined)        inputLines.push(`DXY:       ${dxyLevel} (current: ${dxyData?.currentValue.toFixed(1) ?? 'n/a'})`);
    if (eidoPctChange !== undefined)   inputLines.push(`EIDO:      ${eidoPctChange > 0 ? '+' : ''}${eidoPctChange}% from ${eidoData?.currentValue.toFixed(2) ?? 'n/a'}`);
    if (commodityShockPct !== undefined) inputLines.push(`Commodities (all): ${commodityShockPct > 0 ? '+' : ''}${commodityShockPct}%`);
    if (coalShockPct !== undefined)    inputLines.push(`Coal:      ${coalShockPct > 0 ? '+' : ''}${coalShockPct}%`);
    if (cpoShockPct !== undefined)     inputLines.push(`CPO:       ${cpoShockPct > 0 ? '+' : ''}${cpoShockPct}%`);
    if (nickelShockPct !== undefined)  inputLines.push(`Nickel:    ${nickelShockPct > 0 ? '+' : ''}${nickelShockPct}%`);

    if (inputLines.length === 0) {
      return 'No overrides provided. Specify at least one: idrLevel, vixLevel, dxyLevel, eidoPctChange, or commodityShockPct.';
    }

    // ── Historical analog ──────────────────────────────────────────────
    const analog = stressed.composite >= 75
      ? '⚠️  Comparable to 2020 COVID crash (composite 80+) or 1998 Asian Crisis dynamics'
      : stressed.composite >= 55
      ? '⚠️  Comparable to 2013 Taper Tantrum or 2018 EM Contagion (50–70 range)'
      : stressed.composite >= 35
      ? 'Comparable to 2023 USD surge episode (elevated but manageable)'
      : 'Below historical stress thresholds — no systemic risk flag';

    const lines = [
      `# Macro Stress Scenario: ${label}`,
      ``,
      `## Scenario Inputs`,
      ...inputLines,
      ``,
      `## Baseline (Current)`,
      formatBreakdown(baseline),
      ``,
      `## Stressed Scenario`,
      formatBreakdown(stressed),
      ``,
      `## Impact`,
      `Composite score: ${baseline.composite} → ${stressed.composite} (${deltaSign}${delta} pts)`,
      levelChanged
        ? `🚨 ALERT LEVEL CHANGE: ${alertLabel(baseline.alertLevel)} → ${alertLabel(stressed.alertLevel)}`
        : `Alert level unchanged: ${alertLabel(stressed.alertLevel)}`,
      ``,
      `## Historical Analog`,
      analog,
      ``,
      `_Note: Sovereign module (CDS/SBN) not included — no real-time data without Bloomberg/Refinitiv._`,
      `_Actual stress may be higher if sovereign repricing occurs simultaneously._`,
    ];

    return lines.filter((l) => l !== '').join('\n');
  },
});
