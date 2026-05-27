import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { upsertPoints, getLastN, getLatestPoint } from './time-series-db.js';
import { rollingZScore, alertFromZScore } from './scoring.js';
import { fetchGdpGrowth, fetchInflation } from './sources/imf.js';
import { fetchPmiManufacturingTe } from './sources/sovereign-scraper.js';
import type { MacroRegime, AlertLevel, MacroDataPoint } from './types.js';

export const REGIME_DESCRIPTION = `
MACRO INTELLIGENCE — Quad Regime Engine

Classifies Indonesia's current macroeconomic regime using Growth ROC × Inflation ROC framework.

Regimes:
- Q1: Growth↑ Inflation↓ — goldilocks, risk-on; bonds rally, equities strong
- Q2: Growth↑ Inflation↑ — reflation; commodities, FX stable; BI may tighten
- Q3: Growth↓ Inflation↑ — stagflation (worst); IDR under pressure, yields rise
- Q4: Growth↓ Inflation↓ — deflation/recession risk; easing bias, defensive assets

Output: current regime + probability of shift + historical analogs + asset implications.
`.trim();

export interface RegimeOutput {
  currentRegime: MacroRegime;
  regimeLabel: string;
  growthRoc: number;
  inflationRoc: number;
  growthTrend: 'accelerating' | 'decelerating' | 'stable';
  inflationTrend: 'accelerating' | 'decelerating' | 'stable';
  latestPmi: number | null;
  shiftProbability: number;
  mostLikelyShift: MacroRegime | null;
  historicalAnalogs: string[];
  assetImplications: Record<string, string>;
  alertLevel: AlertLevel;
  narrative: string;
}

const REGIME_LABELS: Record<MacroRegime, string> = {
  Q1: 'Q1 — Goldilocks (Growth↑ Inflation↓)',
  Q2: 'Q2 — Reflation (Growth↑ Inflation↑)',
  Q3: 'Q3 — Stagflation (Growth↓ Inflation↑)',
  Q4: 'Q4 — Contraction (Growth↓ Inflation↓)',
};

const HISTORICAL_ANALOGS: Record<MacroRegime, string[]> = {
  Q1: ['Indonesia 2017-2018 (pre-EM selloff)', 'EM rallies of 2003-2007', 'Post-COVID recovery 2021'],
  Q2: ['Indonesia 2010-2011 (commodity boom)', 'Global reflation 2021-2022', 'Commodity supercycle 2004-2008'],
  Q3: ['Indonesia 1997-1998 (Asian crisis)', 'Global stagflation 2022 (post-Ukraine)', 'Fed tightening 2013 taper tantrum'],
  Q4: ['Global recession 2008-2009', 'COVID shock Q1 2020', 'EM deflation scare 2015-2016'],
};

const ASSET_IMPLICATIONS: Record<MacroRegime, Record<string, string>> = {
  Q1: {
    IDR: 'Appreciating bias — favorable carry environment',
    SBN: 'Yields compress — bond rally',
    IHSG: 'Positive — growth stocks outperform',
    Commodities: 'Neutral-positive',
    BI_Bias: 'Hold / mild easing bias',
  },
  Q2: {
    IDR: 'Stable-to-weak — inflation erodes real yield appeal',
    SBN: 'Yields rise — BI tightening expected',
    IHSG: 'Mixed — commodity names outperform, banks neutral',
    Commodities: 'Strong — demand-driven commodity rally',
    BI_Bias: 'Tightening',
  },
  Q3: {
    IDR: 'High depreciation risk — worst regime for IDR',
    SBN: 'Yields spike — foreign exit risk',
    IHSG: 'Bearish — defensive rotation',
    Commodities: 'Supply shock dependent (stagflation implies cost-push)',
    BI_Bias: 'Forced tightening despite growth weakness',
  },
  Q4: {
    IDR: 'Weak but stable — deflation limits IDR upside',
    SBN: 'Yields fall — easing cycle',
    IHSG: 'Weak — earnings revision risk',
    Commodities: 'Weak demand — commodity price pressure',
    BI_Bias: 'Easing',
  },
};

function classifyTrend(series: number[]): { roc: number; trend: 'accelerating' | 'decelerating' | 'stable' } {
  if (series.length < 2) return { roc: 0, trend: 'stable' };
  const recent = series.slice(-3);
  const prior = series.slice(-6, -3);
  const recentMean = recent.reduce((a, b) => a + b, 0) / recent.length;
  const priorMean = prior.length > 0 ? prior.reduce((a, b) => a + b, 0) / prior.length : recentMean;
  const roc = priorMean !== 0 ? ((recentMean - priorMean) / Math.abs(priorMean)) * 100 : 0;
  const trend = roc > 0.5 ? 'accelerating' : roc < -0.5 ? 'decelerating' : 'stable';
  return { roc, trend };
}

function computeShiftProbability(
  growthTrend: string,
  inflationTrend: string,
  currentRegime: MacroRegime,
): { prob: number; mostLikely: MacroRegime | null } {
  // Regime transitions are more likely when one dimension is at inflection
  let prob = 0.1; // base 10%
  let mostLikely: MacroRegime | null = null;

  if (currentRegime === 'Q1') {
    if (inflationTrend === 'rising') { prob = 0.45; mostLikely = 'Q2'; }
    else if (growthTrend === 'decelerating') { prob = 0.35; mostLikely = 'Q4'; }
  } else if (currentRegime === 'Q2') {
    if (growthTrend === 'decelerating') { prob = 0.50; mostLikely = 'Q3'; }
    else if (inflationTrend === 'falling') { prob = 0.30; mostLikely = 'Q1'; }
  } else if (currentRegime === 'Q3') {
    if (growthTrend === 'accelerating') { prob = 0.40; mostLikely = 'Q2'; }
    else if (inflationTrend === 'falling') { prob = 0.45; mostLikely = 'Q4'; }
  } else if (currentRegime === 'Q4') {
    if (inflationTrend === 'rising') { prob = 0.40; mostLikely = 'Q3'; }
    else if (growthTrend === 'accelerating') { prob = 0.45; mostLikely = 'Q1'; }
  }

  return { prob, mostLikely };
}

export async function runRegimeEngine(): Promise<RegimeOutput> {
  const [gdpSeries, inflSeries, pmiPoint] = await Promise.all([
    fetchGdpGrowth(),
    fetchInflation(),
    fetchPmiManufacturingTe(),
  ]);
  if (gdpSeries.length > 0) await upsertPoints(gdpSeries);
  if (inflSeries.length > 0) await upsertPoints(inflSeries);
  if (pmiPoint) await upsertPoints([pmiPoint]);

  const gdpHistory = await getLastN('gdp_growth_pct', 10);
  const inflHistory = await getLastN('inflation_cpi_pct', 10);
  const pmiHistory = await getLastN('indonesia_pmi_manufacturing', 3);

  const gdpValues = gdpHistory.map((p) => p.value);
  const inflValues = inflHistory.map((p) => p.value);

  const growthResult = classifyTrend(gdpValues);
  const inflResult = classifyTrend(inflValues);

  // PMI signal: monthly leading indicator vs annual IMF GDP (1-2Q lag)
  // PMI < 48 for 2+ months = growth contraction signal regardless of IMF annual
  // PMI > 52 = confirms expansion
  const latestPmi = pmiHistory.length > 0 ? pmiHistory[pmiHistory.length - 1]!.value : null;
  const pmiContraction = pmiHistory.length >= 2 && pmiHistory.every((p) => p.value < 50);
  // Single PMI <50 is a leading warning even without sustained contraction
  const pmiContractionWarning = latestPmi !== null && latestPmi < 50;
  const pmiExpansion = latestPmi !== null && latestPmi > 52;

  // Classify regime — PMI can override/adjust annual GDP signal
  let growthUp = growthResult.trend === 'accelerating' || growthResult.roc > 0;
  if (pmiContraction) growthUp = false;   // PMI sustained contraction overrides annual lag
  else if (pmiExpansion) growthUp = true; // PMI strong expansion confirms growth
  const inflUp = inflResult.trend === 'accelerating' || inflResult.roc > 0;

  let currentRegime: MacroRegime;
  if (growthUp && !inflUp) currentRegime = 'Q1';
  else if (growthUp && inflUp) currentRegime = 'Q2';
  else if (!growthUp && inflUp) currentRegime = 'Q3';
  else currentRegime = 'Q4';

  const alertLevel: AlertLevel =
    currentRegime === 'Q3' ? 'red' :
    currentRegime === 'Q4' ? 'orange' :
    currentRegime === 'Q2' ? 'yellow' : 'green';

  let { prob: shiftProbability, mostLikely: mostLikelyShift } = computeShiftProbability(
    growthResult.trend,
    inflResult.trend,
    currentRegime,
  );
  // PMI contraction warning boosts shift probability: leading indicator disagrees with lagged GDP
  if (pmiContractionWarning && !pmiContraction) {
    shiftProbability = Math.min(0.95, shiftProbability + 0.15);
    if (!mostLikelyShift) mostLikelyShift = inflUp ? 'Q3' : 'Q4';
  }

  const latestGdp = gdpHistory[gdpHistory.length - 1];
  const latestInfl = inflHistory[inflHistory.length - 1];

  const pmiNote = latestPmi !== null
    ? ` PMI ${latestPmi.toFixed(1)} (${latestPmi >= 50 ? 'expansion' : 'contraction'})${pmiContraction ? ' — sustained contraction overrides GDP lag signal' : pmiContractionWarning ? ' — manufacturing contraction; leads GDP by 1-2Q' : ''}.`
    : '';

  const narrative = [
    `Indonesia in ${REGIME_LABELS[currentRegime]}.`,
    `GDP growth ${latestGdp?.value.toFixed(1) ?? 'n/a'}% (${growthResult.trend}).`,
    `CPI inflation ${latestInfl?.value.toFixed(1) ?? 'n/a'}% (${inflResult.trend}).`,
    pmiNote,
    mostLikelyShift
      ? `Regime shift probability ${(shiftProbability * 100).toFixed(0)}% toward ${REGIME_LABELS[mostLikelyShift]}.`
      : `Regime stable — shift probability ${(shiftProbability * 100).toFixed(0)}%.`,
  ].filter(Boolean).join(' ');

  return {
    currentRegime,
    regimeLabel: REGIME_LABELS[currentRegime],
    growthRoc: growthResult.roc,
    inflationRoc: inflResult.roc,
    growthTrend: growthResult.trend,
    inflationTrend: inflResult.trend,
    latestPmi,
    shiftProbability,
    mostLikelyShift,
    historicalAnalogs: HISTORICAL_ANALOGS[currentRegime],
    assetImplications: ASSET_IMPLICATIONS[currentRegime],
    alertLevel,
    narrative,
  };
}

function formatRegimeOutput(output: RegimeOutput): string {
  return [
    `# Macro Regime Engine — Indonesia`,
    `**Current Regime:** ${output.regimeLabel}`,
    `**Alert:** ${output.alertLevel.toUpperCase()}`,
    ``,
    `## Regime Drivers`,
    `| Dimension | ROC | Trend |`,
    `|-----------|-----|-------|`,
    `| GDP Growth | ${output.growthRoc >= 0 ? '+' : ''}${output.growthRoc.toFixed(2)}% | ${output.growthTrend} |`,
    `| CPI Inflation | ${output.inflationRoc >= 0 ? '+' : ''}${output.inflationRoc.toFixed(2)}% | ${output.inflationTrend} |`,
    output.latestPmi !== null ? `| PMI Manufacturing | ${output.latestPmi.toFixed(1)} | ${output.latestPmi >= 50 ? 'expansion' : 'contraction'} (monthly leading) |` : '',
    ``,
    `## Regime Shift Risk`,
    `- **Probability:** ${(output.shiftProbability * 100).toFixed(0)}%`,
    output.mostLikelyShift ? `- **Most Likely Shift:** → ${REGIME_LABELS[output.mostLikelyShift]}` : '',
    ``,
    `## Historical Analogs`,
    output.historicalAnalogs.map((a) => `- ${a}`).join('\n'),
    ``,
    `## Asset Implications (${output.currentRegime})`,
    Object.entries(output.assetImplications).map(([k, v]) => `- **${k}:** ${v}`).join('\n'),
    output.latestPmi !== null && output.latestPmi < 50
      ? `\n> ⚠️ **PMI Caveat:** Manufacturing PMI ${output.latestPmi.toFixed(1)} signals contraction. Annual GDP (IMF) lags by 1-2 quarters. Equity/IDR implications above may deteriorate if PMI stays <50.`
      : '',
    ``,
    `## Summary`,
    output.narrative,
    ``,
    `_Growth: IMF WEO annual (~1-2Q lag) + S&P Global Manufacturing PMI monthly (leading, real-time). PMI sustained <50 overrides annual GDP signal._`,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

export const regimeEngine = new DynamicStructuredTool({
  name: 'regime_engine',
  description:
    'Quad Regime Engine: classifies Indonesia macro regime (Q1–Q4) using Growth ROC × Inflation ROC. Outputs current regime, shift probability, historical analogs, and asset class implications.',
  schema: z.object({
    query: z.string().describe('e.g. "What macro regime is Indonesia in?" or "Is stagflation risk rising?"'),
  }),
  func: async (_input) => {
    try {
      const output = await runRegimeEngine();
      return formatToolResult(
        { analysis: formatRegimeOutput(output), raw: output },
        ['https://www.imf.org/external/datamapper'],
      );
    } catch (error) {
      return formatToolResult({ error: error instanceof Error ? error.message : String(error) });
    }
  },
});
