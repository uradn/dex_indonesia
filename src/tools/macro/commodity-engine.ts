import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { upsertPoints, getLatestPoint, getLastN } from './time-series-db.js';
import { buildSnapshot, compositeScore, alertFromScore, alertLabel, rollingZScore } from './scoring.js';
import {
  fetchCommodityPrices,
  INDONESIA_COMMODITIES,
  computeCommodityCushionScore,
  computeOilVulnerabilityIndex,
} from './sources/commodities.js';
import type { AlertLevel, IndicatorSnapshot, ModuleScoreCard } from './types.js';

export const COMMODITY_DESCRIPTION = `
MACRO INTELLIGENCE — Commodity Engine (Module 4)

Tracks Indonesia's commodity export cushion and oil import vulnerability.

Indonesia export basket (tracked):
- Coal ($24.5B) — BTU (Peabody Energy proxy; KOL delisted)
- CPO/Palm Oil ($24.4B) — World Bank Pink Sheet (FCPO.KL unavailable on Yahoo)
- Ferro-alloys/NPI ($15.9B) — SLX ETF (steel proxy for downstream nickel)
- Nickel ($8.4B) — VALE ADR (NI=F LME unavailable on Yahoo)
- LNG ($6.6B) — NG=F (Henry Hub proxy; JKM not freely available)
- Copper ($5B) — HG=F (COMEX Copper)
- Gold ($3B) — GC=F
- Natural Rubber ($2.5B) — RB=F (COMEX RSS3). Oil shock HEDGE: high Brent → synthetic rubber expensive → demand shift to natural rubber. Indonesia #2 world producer.
- Aluminum ($1.5B) — ALI=F (bauxite downstream proxy)

Oil Shock Positive Offset (when Brent >$90):
- Natural rubber + CPO biofuel premium + coal energy substitute = ~$8-12B/yr export upside
- Partially offsets crude import overrun (~$14-17B/yr additional at $150 oil)
- Net BoP deterioration at $150: ~$5-9B/yr (not the full $14-17B headline figure)

Oil Import Risk (net importer ~245M bbl/yr):
- Brent — BZ=F
- APBN assumption baseline: $82/bbl (APBN 2026 — update annually in sources/commodities.ts)

Scores:
- Commodity Cushion Score (0-100): 0 = max cushion, 100 = prices below trend
- Oil Vulnerability Index (0-100): higher oil price → more BoP drain

## When to Use

- "Show commodity risk"
- "Is the export cushion weakening?"
- "What happens to Indonesia if coal/nickel prices fall?"
- "Oil shock scenario"
- Any time commodity prices move >5% in a session
`.trim();

interface CommodityEngineOutput {
  scoreCard: ModuleScoreCard;
  commodityCushionScore: number;
  oilVulnerabilityIndex: number;
  brentPrice: number | null;
  impliedOilImportBillBnUsd: number | null;
  oilDeviation: number | null;
  topExportsByStress: Array<{ indicator: string; price: number; unit: string; zScore: number | null; stress: AlertLevel }>;
  // Oil shock positive offset: commodities that benefit when oil is high
  oilShockHedge: { rubberPriceUsd: number | null; cpoPriceUsd: number | null; coalEtfUsd: number | null; estimatedOffsetBnUsd: number | null } | null;
  narrative: string;
}

export async function runCommodityEngine(): Promise<CommodityEngineOutput> {
  // Fetch current prices
  const prices = await fetchCommodityPrices();
  if (prices.length > 0) await upsertPoints(prices);

  // Build snapshots for key indicators
  const snapshots: IndicatorSnapshot[] = [];
  const currentPrices: Record<string, number> = {};
  const historicalStats: Record<string, { mean: number; std: number }> = {};
  const stressDetails: Array<{ indicator: string; price: number; unit: string; zScore: number | null; stress: AlertLevel }> = [];

  const exportCommodities = INDONESIA_COMMODITIES.filter((c) => c.role === 'export');

  for (const spec of exportCommodities) {
    const current = await getLatestPoint(spec.indicator);
    if (!current) continue;
    currentPrices[spec.indicator] = current.value;

    const history = await getLastN(spec.indicator, 90);
    const values = history.map((p) => p.value);
    if (values.length >= 5) {
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const std = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
      historicalStats[spec.indicator] = { mean, std };
    }

    const prev = history.length > 1 ? history[history.length - 2] : null;
    const snap = await buildSnapshot(spec.indicator, current, prev);
    snapshots.push(snap);

    const zScore = historicalStats[spec.indicator]
      ? rollingZScore(
          history.slice(0, -1).map((p) => p.value),
          current.value,
        )
      : null;

    const stress: AlertLevel =
      zScore !== null
        ? Math.abs(zScore) >= 2.5 ? 'red' : Math.abs(zScore) >= 2.0 ? 'orange' : Math.abs(zScore) >= 1.5 ? 'yellow' : 'green'
        : 'green';

    stressDetails.push({
      indicator: spec.indicator,
      price: current.value,
      unit: spec.unit,
      zScore,
      stress,
    });
  }

  // Cushion score
  const { score: cushionScore } = computeCommodityCushionScore(currentPrices, historicalStats);

  // Oil vulnerability
  const brentPoint = await getLatestPoint('brent_price_usd');
  const brentPrice = brentPoint?.value ?? null;
  const oilResult = brentPrice !== null ? computeOilVulnerabilityIndex(brentPrice) : null;

  // Oil shock positive offset: rubber + CPO + coal rally at high oil prices
  // Natural rubber: high Brent → synthetic rubber (SBR/NBR) expensive → demand shift to natural rubber
  // CPO: biofuel mandate premium rises at high oil prices
  // Coal: energy substitute demand rises when oil expensive
  const rubberPoint  = await getLatestPoint('natural_rubber_price_usd');
  const cpoPoint     = await getLatestPoint('cpo_price_myr');
  const coalPoint    = await getLatestPoint('coal_etf_usd');
  const rubberPriceUsd = rubberPoint?.value ?? null;
  const cpoPriceUsd    = cpoPoint?.value ?? null;
  const coalEtfUsd     = coalPoint?.value ?? null;

  // Rough offset estimate (directional only, not precise):
  // Rubber: each $0.50/kg above $2.00 baseline × ~3M ton/yr export = ~$1.5B incremental
  // CPO: tracked in M4 cushion score already; biofuel premium ~$50/MT × ~50M ton → $2.5B
  // Coal: BTU proxy — directional only
  let estimatedOffsetBnUsd: number | null = null;
  if (rubberPriceUsd !== null && brentPrice !== null && brentPrice > 90) {
    const rubberBaseline = 2.0; // USD/kg approximate baseline at $70-80 oil
    const rubberPremium = Math.max(0, rubberPriceUsd - rubberBaseline);
    estimatedOffsetBnUsd = parseFloat((rubberPremium * 3_000_000 / 1_000_000_000).toFixed(2));
  }

  const oilShockHedge = (brentPrice !== null && brentPrice > 90)
    ? { rubberPriceUsd, cpoPriceUsd, coalEtfUsd, estimatedOffsetBnUsd }
    : null;

  const compositeAlert = alertFromScore(cushionScore);
  const flags: string[] = [];
  if (oilResult && oilResult.deviation > 20) {
    flags.push(`Oil ${oilResult.deviation.toFixed(0)}% above APBN assumption — import bill ${oilResult.impliedImportBillBnUsd.toFixed(1)} bn USD/yr`);
  }
  const redCommodities = stressDetails.filter((s) => s.stress === 'red' && s.zScore !== null && s.zScore < 0);
  if (redCommodities.length >= 2) {
    flags.push(`Multiple export commodities at stress lows: ${redCommodities.map((c) => c.indicator).join(', ')}`);
  }
  if (oilShockHedge && estimatedOffsetBnUsd !== null && estimatedOffsetBnUsd > 0.5) {
    flags.push(`OIL SHOCK HEDGE ACTIVE: rubber at $${rubberPriceUsd?.toFixed(2)}/kg — synthetic rubber substitution demand; estimated natural rubber export premium ~$${estimatedOffsetBnUsd.toFixed(1)}B/yr. CPO biofuel + coal energy substitute add further BoP cushion.`);
  }

  const narrative = buildNarrative({ cushionScore, oilResult, brentPrice, stressDetails, compositeAlert, oilShockHedge });

  return {
    scoreCard: {
      module: 'commodity',
      scoreDate: new Date().toISOString().slice(0, 10),
      score: cushionScore,
      alertLevel: compositeAlert,
      indicators: snapshots,
      narrative,
      flags,
    },
    commodityCushionScore: cushionScore,
    oilVulnerabilityIndex: oilResult?.score ?? 50,
    brentPrice,
    impliedOilImportBillBnUsd: oilResult?.impliedImportBillBnUsd ?? null,
    oilDeviation: oilResult?.deviation ?? null,
    topExportsByStress: stressDetails.sort((a, b) => (a.zScore ?? 0) - (b.zScore ?? 0)),
    oilShockHedge,
    narrative,
  };
}

function buildNarrative(ctx: {
  cushionScore: number;
  oilResult: ReturnType<typeof computeOilVulnerabilityIndex> | null;
  brentPrice: number | null;
  stressDetails: Array<{ indicator: string; price: number; unit: string; zScore: number | null; stress: AlertLevel }>;
  compositeAlert: AlertLevel;
  oilShockHedge: { rubberPriceUsd: number | null; cpoPriceUsd: number | null; coalEtfUsd: number | null; estimatedOffsetBnUsd: number | null } | null;
}): string {
  const parts: string[] = [];
  parts.push(`Commodity Cushion Score: ${ctx.cushionScore}/100 (${ctx.compositeAlert.toUpperCase()}).`);
  if (ctx.brentPrice) {
    parts.push(`Brent crude: $${ctx.brentPrice.toFixed(1)}/bbl.`);
    if (ctx.oilResult) {
      const dir = ctx.oilResult.deviation >= 0 ? 'above' : 'below';
      parts.push(`${Math.abs(ctx.oilResult.deviation).toFixed(0)}% ${dir} APBN assumption — implied oil import bill ${ctx.oilResult.impliedImportBillBnUsd.toFixed(1)} bn USD/yr.`);
    }
  }
  const stressed = ctx.stressDetails.filter((s) => s.zScore !== null && s.zScore < -1.5);
  if (stressed.length > 0) {
    parts.push(`Export cushion eroding: ${stressed.map((s) => s.indicator.replace('_price_usd', '').replace('_etf_usd', '').replace('_etf_', '_')).join(', ')} below 90d trend.`);
  }
  if (ctx.oilShockHedge) {
    const { rubberPriceUsd, estimatedOffsetBnUsd } = ctx.oilShockHedge;
    parts.push(`Oil shock partial hedge: natural rubber $${rubberPriceUsd?.toFixed(2) ?? '?'}/kg (synthetic substitution demand); CPO biofuel premium + coal energy substitute provide additional BoP cushion (~$${estimatedOffsetBnUsd?.toFixed(1) ?? '?'}B/yr rubber premium estimate).`);
  }
  return parts.join(' ');
}

function formatOutput(output: CommodityEngineOutput): string {
  return [
    `# Commodity Engine — Indonesia`,
    `**Date:** ${output.scoreCard.scoreDate}`,
    `**Alert:** ${alertLabel(output.scoreCard.alertLevel)} | **Cushion Score:** ${output.commodityCushionScore}/100 | **Oil Vuln:** ${output.oilVulnerabilityIndex}/100`,
    ``,
    `## Summary`,
    output.narrative,
    ``,
    `## Export Commodities (Stress Ranking — worst first)`,
    `| Commodity | Price | Unit | 90d Z-Score | Stress |`,
    `|-----------|-------|------|-------------|--------|`,
    ...output.topExportsByStress.map((c) => {
      // Rename cpo_price_myr → Palm Oil (CPO) for clarity; indicator has misleading "myr" suffix
      const displayName = c.indicator === 'cpo_price_myr' ? 'palm_oil_cpo_usd' : c.indicator;
      return `| ${displayName} | ${c.price.toFixed(2)} | ${c.unit} | ${c.zScore?.toFixed(2) ?? 'n/a'} | ${c.stress.toUpperCase()} |`;
    }),
    ``,
    `## Oil Import Risk`,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Brent Price | $${output.brentPrice?.toFixed(2) ?? 'n/a'}/bbl |`,
    `| APBN Deviation | ${output.oilDeviation !== null ? `${output.oilDeviation >= 0 ? '+' : ''}${output.oilDeviation.toFixed(1)}%` : 'n/a'} |`,
    `| Implied Annual Import Bill | ${output.impliedOilImportBillBnUsd !== null ? `$${output.impliedOilImportBillBnUsd.toFixed(1)} bn` : 'n/a'} |`,
    `| Oil Vulnerability Index | ${output.oilVulnerabilityIndex}/100 |`,
    ``,
    output.scoreCard.flags.length > 0 ? `## Flags\n${output.scoreCard.flags.map((f) => `- ⚠️ ${f}`).join('\n')}` : '',
    ``,
    output.oilShockHedge ? [
      `## Oil Shock Positive Offset (Brent >$90)`,
      `| Commodity | Price | Mechanism |`,
      `|-----------|-------|-----------|`,
      `| Natural Rubber | $${output.oilShockHedge.rubberPriceUsd?.toFixed(2) ?? 'n/a'}/kg | Synthetic rubber (SBR/NBR) expensive → demand shift; ID #2 world producer |`,
      `| CPO Palm Oil | $${output.oilShockHedge.cpoPriceUsd?.toFixed(0) ?? 'n/a'}/MT | Biofuel mandate premium rises at high oil prices |`,
      `| Coal (BTU proxy) | $${output.oilShockHedge.coalEtfUsd?.toFixed(2) ?? 'n/a'} | Energy substitute demand surge |`,
      `_Estimated rubber export premium: ~$${output.oilShockHedge.estimatedOffsetBnUsd?.toFixed(1) ?? '?'}B/yr above $2.00/kg baseline._`,
      `_Net BoP impact at $150 oil: crude import +$14-17B/yr partially offset by rubber+CPO+coal ~$8-12B/yr._`,
    ].join('\n') : '',
    ``,
    `_Note: Coal proxy = BTU (Peabody Energy); LNG proxy = Henry Hub. Ferro-alloys proxy = SLX (steel ETF). Rubber proxy = RB=F (COMEX RSS3). Direct Newcastle/JKM prices require Bloomberg._`,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

export const commodityEngine = new DynamicStructuredTool({
  name: 'commodity_engine',
  description:
    'Commodity Engine: tracks Indonesia export commodity basket (coal, CPO, nickel, ferro-alloys, LNG, copper, gold) and oil import vulnerability. Computes Commodity Cushion Score and Oil Vulnerability Index.',
  schema: z.object({
    query: z.string().describe('e.g. "Show commodity risk" or "What if oil hits $100?" or "Is the export cushion weakening?"'),
  }),
  func: async (_input) => {
    try {
      const output = await runCommodityEngine();
      return formatToolResult(
        { analysis: formatOutput(output), raw: output },
        ['https://finance.yahoo.com'],
      );
    } catch (error) {
      return formatToolResult({ error: error instanceof Error ? error.message : String(error) });
    }
  },
});
