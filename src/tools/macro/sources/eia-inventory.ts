/**
 * US crude oil commercial stocks from EIA (Energy Information Administration).
 *
 * Used as OECD inventory proxy for the Sawan thesis tracker:
 *   Wael Sawan (Shell CEO) May 2026: China SPR destocking 700-800k bpd ending Q3 2026
 *   → OECD commercial stocks fall to 2003 lows by December 2026
 *   → violent price discovery → $150-160/bbl
 *
 * Indicator: EPC0 (crude oil excluding SPR) at NUS (national US level).
 * Series: EIA Weekly Petroleum Status Report — published every Wednesday 10:30 AM ET.
 *
 * API: EIA API v2 (free, no registration for DEMO_KEY; ~500 req/day limit).
 *   Uses DEMO_KEY by default; EIAAPI_KEY env var overrides if available.
 *
 * Freshness gate: 7 days (aligns with weekly EIA release cadence).
 *
 * 2003 reference low: ~270 Mmbbl (commercial crude, US only; OECD total ~2,500 Mmbbl).
 * US roughly 18-20% of OECD total → US <290 Mmbbl ≈ OECD approaching 2003 lows.
 */

import { getLatestPoint, upsertPoints } from '../time-series-db.js';

const FRESHNESS_DAYS = 7;
// 2003 lows reference — Sawan thesis trigger level (US commercial crude, Mmbbl)
const SAWAN_CRITICAL_MMBBL = 290;
// 5-year average US commercial crude (2019-2023 avg ~435 Mmbbl)
const FIVE_YEAR_AVG_MMBBL = 435;

export interface EiaInventoryData {
  date: string;                     // YYYY-MM-DD of EIA report period
  usCrudeStocksMmbbl: number;
  pctVs5yrAvg: number;              // (current / 5yr_avg - 1) × 100
  distanceToSawanLowMmbbl: number;  // positive = above critical level
  sawanThesisAlert: 'green' | 'yellow' | 'orange' | 'red';
  fetchedAt: string;
}

function scoreSawanThesis(stocks: number): EiaInventoryData['sawanThesisAlert'] {
  if (stocks <= SAWAN_CRITICAL_MMBBL) return 'red';       // At or below 2003 lows
  if (stocks <= SAWAN_CRITICAL_MMBBL + 30) return 'orange'; // 30 Mmbbl above critical
  if (stocks <= SAWAN_CRITICAL_MMBBL + 80) return 'yellow'; // 80 Mmbbl above critical
  return 'green';
}

/**
 * Fetch US crude commercial stocks from EIA API v2.
 * Returns latest weekly figure in million barrels.
 */
export async function fetchEiaCrudeStocks(): Promise<EiaInventoryData | null> {
  // Freshness gate
  const cached = await getLatestPoint('us_crude_stocks_mmbbl');
  if (cached) {
    const ageDays = (Date.now() - new Date(cached.fetchedAt).getTime()) / 86_400_000;
    if (ageDays < FRESHNESS_DAYS) {
      const stocks = cached.value;
      return {
        date: cached.date,
        usCrudeStocksMmbbl: stocks,
        pctVs5yrAvg: parseFloat(((stocks / FIVE_YEAR_AVG_MMBBL - 1) * 100).toFixed(1)),
        distanceToSawanLowMmbbl: parseFloat((stocks - SAWAN_CRITICAL_MMBBL).toFixed(1)),
        sawanThesisAlert: scoreSawanThesis(stocks),
        fetchedAt: cached.fetchedAt,
      };
    }
  }

  try {
    const apiKey = process.env.EIAAPI_KEY ?? 'DEMO_KEY';
    // EIA API v2: weekly crude stocks (commercial, excluding SPR), national US
    // EPC0 = Crude Oil (Commodity Code), NUS = National US, frequency = weekly
    const url = new URL('https://api.eia.gov/v2/petroleum/stoc/wstk/data/');
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('frequency', 'weekly');
    url.searchParams.append('data[]', 'value');
    url.searchParams.append('facets[product][]', 'EPC0');
    url.searchParams.append('facets[duoarea][]', 'NUS');
    url.searchParams.append('facets[process][]', 'SAX'); // Ending Stocks excluding SPR (commercial only)
    url.searchParams.append('sort[0][column]', 'period');
    url.searchParams.append('sort[0][direction]', 'desc');
    url.searchParams.set('offset', '0');
    url.searchParams.set('length', '2'); // latest + prior for change calculation

    const res = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return null;

    const json = await res.json() as {
      response?: { data?: Array<{ period: string; value: string | number }> };
    };
    const rows = json.response?.data ?? [];
    if (rows.length === 0) return null;

    const latest = rows[0]!;
    // EIA returns value in MBBL (thousand barrels) — convert to Mmbbl (million barrels)
    const stocks = parseFloat(String(latest.value)) / 1000;
    if (isNaN(stocks) || stocks <= 0) return null;

    const date = String(latest.period); // "2026-06-06"
    const fetchedAt = new Date().toISOString();

    await upsertPoints([{
      indicator: 'us_crude_stocks_mmbbl',
      category: 'commodity',
      date,
      value: parseFloat(stocks.toFixed(3)),
      unit: 'Mmbbl',
      source: 'eia_api',
      fetchedAt,
    }]);

    return {
      date,
      usCrudeStocksMmbbl: stocks,
      pctVs5yrAvg: parseFloat(((stocks / FIVE_YEAR_AVG_MMBBL - 1) * 100).toFixed(1)),
      distanceToSawanLowMmbbl: parseFloat((stocks - SAWAN_CRITICAL_MMBBL).toFixed(1)),
      sawanThesisAlert: scoreSawanThesis(stocks),
      fetchedAt,
    };
  } catch {
    return null;
  }
}
