/**
 * Dubai crude oil spot price — multi-tier fetcher.
 *
 * Dubai (Fateh) crude is the physical benchmark for MEG→Asia crude flows.
 * Pertamina buys physical crude at Dubai/Oman spot + freight, NOT Brent paper.
 *
 * Data sources (in priority order):
 *   1. Exa search (primary)     — weekly, 7-day freshness gate
 *      Targets oil price news sites that publish Dubai crude assessments daily.
 *   2. World Bank Pink Sheet    — monthly, falls back if Exa fails or stale
 *      Same XLSX already fetched for CPO (shared cache — no extra download).
 *   3. Brent − 1.50 USD/bbl    — zero-cost computed proxy, labeled as estimated
 *      Historical average Brent-Dubai EFS spread ~$1.50. During Hormuz crisis
 *      the spread widens dramatically (Brent $107 vs Dubai $94 in Apr-May 2026).
 *      Use only when neither Exa nor Pink Sheet data available.
 *
 * Key signal for M6 (Narrative Divergence):
 *   - Dubai vs APBN $70: physical Pertamina cost overrun, more accurate than Brent
 *   - Brent-Dubai spread: >$5 = Hormuz physical disruption marker (paper spikes,
 *     physical discounts as buyers avoid Middle East delivery risk)
 *
 * Stored indicator: 'dubai_crude_spot_usd' (USD/bbl)
 * Derived: 'brent_dubai_spread_usd' = brent - dubai (positive = normal Brent premium)
 */

import { getLatestPoint, upsertPoints } from '../time-series-db.js';
import { fetchDubaiCrudeWorldBank } from './worldbank.js';
import type { MacroDataPoint } from '../types.js';

const NOW = () => new Date().toISOString();
const EXA_FRESHNESS_DAYS = 7;

// Historical avg EFS (Exchange of Futures for Swaps) spread, USD/bbl
// During Hormuz crisis (Apr-May 2026): spread widened to $12-27/bbl
const BRENT_DUBAI_EFS_ESTIMATE = 1.50;

export interface DubaiCrudeData {
  date: string;
  dubaiPriceUsd: number;
  source: 'exa_search' | 'worldbank_pinksheet' | 'brent_proxy';
  brentDubaiSpreadUsd: number | null; // positive = Brent premium (normal)
  hormuzFlag: boolean;                // spread >$5 = physical market disconnection
  fetchedAt: string;
}

// ── Exa search ────────────────────────────────────────────────────────────────

const EXA_DOMAINS = [
  'oilprice.com',
  'eia.gov',
  'reuters.com',
  'argusmedia.com',
  'rigzone.com',
  'energyintel.com',
];
const EXA_QUERY = 'Dubai crude oil spot price today USD per barrel week';

function parseDubaiPriceFromText(text: string): number | null {
  // Match patterns like "$94.67/bbl", "$94.67 per barrel", "94.67 USD/bbl"
  // near "Dubai" keyword
  const patterns = [
    // "Dubai crude ... $94.67" or "Dubai ... 94.67 $/bbl"
    /Dubai[\s\S]{0,200}?\$\s*([\d]{2,3}\.?\d*)\s*(?:\/bbl|per barrel)?/i,
    /Dubai[\s\S]{0,200}?([\d]{2,3}\.?\d*)\s*(?:USD|US\$)\s*(?:\/bbl|per barrel)/i,
    // Reverse: "$94.67 ... Dubai crude"
    /\$\s*([\d]{2,3}\.?\d*)\s*(?:\/bbl|per barrel)?[\s\S]{0,200}?Dubai\s*crude/i,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m?.[1]) {
      const v = parseFloat(m[1]);
      if (v >= 40 && v <= 250) return v; // sanity bounds
    }
  }
  return null;
}

async function fetchViaExa(): Promise<DubaiCrudeData | null> {
  if (!process.env.EXASEARCH_API_KEY) return null;
  try {
    const { default: Exa } = await import('exa-js');
    const exa = new Exa(process.env.EXASEARCH_API_KEY);
    const startDate = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);

    const response = await exa.search(EXA_QUERY, {
      numResults: 4,
      type: 'auto',
      startPublishedDate: startDate,
      includeDomains: EXA_DOMAINS,
      contents: { text: { maxCharacters: 1500 } },
    } as Parameters<typeof exa.search>[1]);

    for (const r of response.results ?? []) {
      const text = (r as { text?: string }).text ?? r.title ?? '';
      const price = parseDubaiPriceFromText(text);
      if (price !== null) {
        const date = (r.publishedDate ?? NOW()).slice(0, 10);
        return {
          date,
          dubaiPriceUsd: price,
          source: 'exa_search',
          brentDubaiSpreadUsd: null, // computed after Brent lookup
          hormuzFlag: false,
          fetchedAt: NOW(),
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ── World Bank Pink Sheet fallback ────────────────────────────────────────────

async function fetchViaWorldBank(): Promise<DubaiCrudeData | null> {
  try {
    const points = await fetchDubaiCrudeWorldBank(3); // last 3 months
    if (points.length === 0) return null;
    const latest = points[points.length - 1]!;
    return {
      date: latest.date,
      dubaiPriceUsd: latest.value,
      source: 'worldbank_pinksheet',
      brentDubaiSpreadUsd: null,
      hormuzFlag: false,
      fetchedAt: latest.fetchedAt,
    };
  } catch {
    return null;
  }
}

// ── Main fetch ────────────────────────────────────────────────────────────────

/**
 * Fetch latest Dubai crude spot price. Returns null only if all tiers fail AND
 * no Brent price available for proxy.
 */
export async function fetchDubaiCrude(): Promise<DubaiCrudeData | null> {
  // Freshness gate: skip Exa if DB has fresh data (7 days)
  const cached = await getLatestPoint('dubai_crude_spot_usd');
  const brentPoint = await getLatestPoint('brent_price_usd');
  const brentPrice = brentPoint?.value ?? null;

  let data: DubaiCrudeData | null = null;

  if (cached) {
    const ageDays = (Date.now() - new Date(cached.fetchedAt).getTime()) / 86_400_000;
    if (ageDays < EXA_FRESHNESS_DAYS) {
      const src: DubaiCrudeData['source'] =
        cached.source === 'worldbank_pinksheet' ? 'worldbank_pinksheet'
        : cached.source === 'brent_proxy'       ? 'brent_proxy'
        : 'exa_search';
      data = {
        date: cached.date,
        dubaiPriceUsd: cached.value,
        source: src,
        brentDubaiSpreadUsd: null,
        hormuzFlag: false,
        fetchedAt: cached.fetchedAt,
      };
    }
  }

  // Tier 1: Exa search
  if (!data) data = await fetchViaExa();

  // Tier 2: World Bank Pink Sheet (monthly, ~1 month lag)
  if (!data) data = await fetchViaWorldBank();

  // Tier 3: Brent − EFS spread computed proxy
  if (!data && brentPrice !== null) {
    data = {
      date: new Date().toISOString().slice(0, 10),
      dubaiPriceUsd: parseFloat((brentPrice - BRENT_DUBAI_EFS_ESTIMATE).toFixed(2)),
      source: 'brent_proxy',
      brentDubaiSpreadUsd: BRENT_DUBAI_EFS_ESTIMATE,
      hormuzFlag: false,
      fetchedAt: NOW(),
    };
  }

  if (!data) return null;

  // Compute Brent-Dubai spread only if data is fresh (< 20 days).
  // Pink Sheet has ~1 month lag → comparing to live BZ=F creates false signals
  // (Dubai May price vs live Brent June = artificial inversion).
  const dataDaysOld = (Date.now() - new Date(data.date + 'T00:00:00Z').getTime()) / 86_400_000;
  if (brentPrice !== null && dataDaysOld < 20) {
    const spread = parseFloat((brentPrice - data.dubaiPriceUsd).toFixed(2));
    data.brentDubaiSpreadUsd = spread;
    // spread > $5:  paper Brent spikes; physical Dubai discounts = Hormuz disruption
    // spread < -$2: Dubai > Brent = physical supply premium (very unusual, also alert)
    data.hormuzFlag = spread > 5 || spread < -2;
  }

  // Persist to DB (skip if from cache)
  if (data.source !== 'exa_search' || !cached || (Date.now() - new Date(cached.fetchedAt).getTime()) >= EXA_FRESHNESS_DAYS * 86_400_000) {
    const points: MacroDataPoint[] = [{
      indicator: 'dubai_crude_spot_usd',
      category: 'commodity',
      date: data.date,
      value: data.dubaiPriceUsd,
      unit: 'USD/bbl',
      source: data.source === 'exa_search' ? 'exa_oilprice' : data.source,
      fetchedAt: data.fetchedAt,
    }];
    if (data.brentDubaiSpreadUsd !== null) {
      points.push({
        indicator: 'brent_dubai_spread_usd',
        category: 'commodity',
        date: data.date,
        value: data.brentDubaiSpreadUsd,
        unit: 'USD/bbl',
        source: data.source === 'exa_search' ? 'exa_oilprice' : data.source,
        fetchedAt: data.fetchedAt,
      });
    }
    await upsertPoints(points);
  }

  return data;
}
