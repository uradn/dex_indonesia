/**
 * Indonesia commodity price data.
 *
 * Indonesia export commodity basket:
 *   Coal ($24.5B) · CPO ($24.4B) · Ferro-alloys/NPI ($15.9B) · Iron & Steel ($28B)
 *   Nickel ($8.4B) · LNG ($6.6B) · Copper ($11B metals) · Tin · Rubber · Gold
 *
 * Indonesia import risk:
 *   Crude oil (600-700k bbl/day net importer) — Brent↑ = BoP drain
 *
 * Sources: Yahoo Finance (free) for most futures; web fallback for coal/LNG.
 */
import YahooFinance from 'yahoo-finance2';
import type { MacroDataPoint } from '../types.js';

const yf = new YahooFinance();
const NOW = () => new Date().toISOString();
const TODAY = () => new Date().toISOString().slice(0, 10);

interface CommoditySpec {
  ticker: string;
  indicator: string;
  unit: string;
  role: 'export' | 'import_risk';
  exportValueBnUsd?: number; // approximate annual export value for weighting
}

// Yahoo Finance tickers mapped to Indonesia commodity exposure
export const INDONESIA_COMMODITIES: CommoditySpec[] = [
  // ─── Major exports ────────────────────────────────────────────────
  // CPO — FCPO.KL unavailable on Yahoo; World Bank Pink Sheet used via fetchCpoPriceWorldBank()
  // Ticker placeholder — never actually queried; fallback populates cpo_price_myr via worldbank.ts
  { ticker: '_CPO_WB',  indicator: 'cpo_price_myr',         unit: 'USD/MT',  role: 'export', exportValueBnUsd: 24.4 },
  // Nickel — NI=F (LME) unavailable on Yahoo; Vale S.A. ADR as directional proxy
  { ticker: 'VALE',     indicator: 'nickel_price_usd',      unit: 'USD',     role: 'export', exportValueBnUsd: 8.4  },
  { ticker: 'HG=F',     indicator: 'copper_price_usd',      unit: 'USD/lb',  role: 'export', exportValueBnUsd: 5.0  },
  { ticker: 'GC=F',     indicator: 'gold_price_usd',        unit: 'USD/oz',  role: 'export', exportValueBnUsd: 3.0  },
  { ticker: 'SI=F',     indicator: 'silver_price_usd',      unit: 'USD/oz',  role: 'export', exportValueBnUsd: 0.5  },
  // Coal — KOL ETF delisted 2014; Peabody Energy (BTU) as US thermal coal proxy
  { ticker: 'BTU',      indicator: 'coal_etf_usd',          unit: 'USD',     role: 'export', exportValueBnUsd: 24.5 },
  // LNG/natural gas proxy — Henry Hub (JKM not freely available on Yahoo)
  { ticker: 'NG=F',     indicator: 'natgas_price_usd',      unit: 'USD/MMBtu', role: 'export', exportValueBnUsd: 6.6 },
  // Ferronickel/NPI proxy — VanEck Steel ETF
  { ticker: 'SLX',      indicator: 'steel_etf_usd',         unit: 'USD',     role: 'export', exportValueBnUsd: 15.9 },
  // Aluminum (bauxite downstream) — COMEX ALI futures in USD/MT
  { ticker: 'ALI=F',    indicator: 'aluminum_price_usd',    unit: 'USD/MT',  role: 'export', exportValueBnUsd: 1.5  },
  // ─── Import risk (net importer) ───────────────────────────────────
  { ticker: 'BZ=F',     indicator: 'brent_price_usd',       unit: 'USD/bbl', role: 'import_risk' },
  { ticker: 'CL=F',     indicator: 'wti_price_usd',         unit: 'USD/bbl', role: 'import_risk' },
];

export async function fetchCommodityPrices(): Promise<MacroDataPoint[]> {
  const results: MacroDataPoint[] = [];

  await Promise.allSettled(
    INDONESIA_COMMODITIES.map(async (spec) => {
      try {
        const q = await yf.quote(spec.ticker);
        const price = q.regularMarketPrice;
        if (!price) return;
        results.push({
          indicator: spec.indicator,
          category: 'commodity',
          date: TODAY(),
          value: price,
          unit: spec.unit,
          source: 'yahoo_finance',
          fetchedAt: NOW(),
        });
      } catch { /* skip unavailable tickers */ }
    }),
  );

  // CPO fallback: World Bank Pink Sheet (if BO=F proxy didn't populate)
  const hasCpo = results.some((r) => r.indicator === 'cpo_price_myr');
  if (!hasCpo) {
    try {
      const { fetchCpoPriceWorldBank } = await import('./worldbank.js');
      const cpoPoints = await fetchCpoPriceWorldBank(3);
      if (cpoPoints.length > 0) {
        results.push(cpoPoints[cpoPoints.length - 1]); // latest month
      }
    } catch { /* ignore */ }
  }

  return results;
}

export async function fetchCommodityHistory(indicator: string, days = 365): Promise<MacroDataPoint[]> {
  const spec = INDONESIA_COMMODITIES.find((c) => c.indicator === indicator);
  if (!spec) return [];
  try {
    const result = await yf.chart(spec.ticker, {
      period1: new Date(Date.now() - days * 86400_000),
      period2: new Date(),
      interval: '1d',
    });
    return (result.quotes ?? [])
      .filter((q) => q.close != null)
      .map((q) => ({
        indicator: spec.indicator,
        category: 'commodity' as const,
        date: new Date(q.date).toISOString().slice(0, 10),
        value: q.close!,
        unit: spec.unit,
        source: 'yahoo_finance',
        fetchedAt: NOW(),
      }));
  } catch {
    return [];
  }
}

/**
 * Compute Indonesia Commodity Cushion Score.
 *
 * Weighted by each commodity's share of total export value.
 * Z-score of each commodity vs 90-day average.
 * Positive z → price above trend → cushion improving (lower stress).
 * Negative z → price below trend → cushion eroding (higher stress).
 *
 * Returns 0-100 where 0 = max cushion (all prices above trend), 100 = max stress.
 */
export function computeCommodityCushionScore(
  currentPrices: Record<string, number>,
  historicalMeans: Record<string, { mean: number; std: number }>,
): { score: number; breakdown: Record<string, number> } {
  const exportSpecs = INDONESIA_COMMODITIES.filter((c) => c.role === 'export' && c.exportValueBnUsd);
  const totalWeight = exportSpecs.reduce((s, c) => s + (c.exportValueBnUsd ?? 0), 0);
  const breakdown: Record<string, number> = {};
  let weightedStress = 0;

  for (const spec of exportSpecs) {
    const current = currentPrices[spec.indicator];
    const hist = historicalMeans[spec.indicator];
    if (current == null || hist == null || hist.std === 0) continue;
    const z = (current - hist.mean) / hist.std;
    // Negative z → below mean → stress for exporter
    const stressContribution = Math.max(0, Math.min(100, 50 - z * 25));
    const weight = (spec.exportValueBnUsd ?? 0) / totalWeight;
    weightedStress += stressContribution * weight;
    breakdown[spec.indicator] = stressContribution;
  }

  return { score: Math.round(weightedStress), breakdown };
}

/**
 * Oil Vulnerability Index.
 * Based on: Brent price deviation from APBN assumption ($65-75/bbl baseline).
 * Higher oil → higher import bill → BoP pressure.
 */
export function computeOilVulnerabilityIndex(
  brentPrice: number,
  apbnOilAssumption = 70,
): { score: number; impliedImportBillBnUsd: number; deviation: number } {
  const deviation = ((brentPrice - apbnOilAssumption) / apbnOilAssumption) * 100;
  // Indonesia imports ~600-700k bbl/day → ~240-255M bbl/year
  const annualImportBbl = 245_000_000;
  const impliedImportBillBnUsd = (brentPrice * annualImportBbl) / 1_000_000_000;
  const score = Math.max(0, Math.min(100, Math.round(50 + deviation)));
  return { score, impliedImportBillBnUsd, deviation };
}
