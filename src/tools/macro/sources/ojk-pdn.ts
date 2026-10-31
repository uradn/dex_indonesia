/**
 * OJK PDN (Posisi Devisa Neto) — Bank Net Open FX Position
 *
 * Published monthly in OJK SPI (Statistik Perbankan Indonesia).
 * OJK WAF blocks direct scrape — use Exa/Tavily targeting financial media.
 *
 * WHY IT MATTERS:
 *   PDN = banking sector net unhedged FX exposure as % of regulatory capital.
 *   OJK limit: max 20% (PBI 5/13/2003 jo OJK POJK 6/2024).
 *   PDN rising → banks more exposed to IDR depreciation → amplifies M8 banking stress.
 *   Acts as MONTHLY proxy for corporate hedging compliance (BI SULNI = quarterly only).
 *   Cross-signal: high PDN + IDR depreciation + rising NPL = 3rd-gen balance sheet cascade.
 *
 * THRESHOLDS (% of capital):
 *   < 5%    — conservative, minimal FX risk
 *   5–10%   — normal operating range for Indonesian banks
 *   10–15%  — elevated; watch for depreciation pressure
 *   > 15%   — approaching OJK limit; concentrated FX stress signal
 *   > 18%   — CRITICAL: near regulatory ceiling; forced deleveraging risk
 *
 * DB INDICATOR: bank_pdnl_pct (%, 0–20 range)
 * FRESHNESS: 35d (monthly publication)
 */

import { getLatestPoint, upsertPoints } from '../time-series-db.js';
import type { MacroDataPoint } from '../types.js';

const FRESHNESS_DAYS = 35;
const NOW = () => new Date().toISOString();
const TODAY = () => new Date().toISOString().slice(0, 10);

// OJK SPI blocked — Indonesian financial media reliably report the monthly PDN figure
const PDN_DOMAINS = ['bloombergtechnoz.com', 'bisnis.com', 'kontan.co.id', 'cnbcindonesia.com'];
function pdnQueries(): { exa: string; tavily: string } {
  const yr = new Date().getFullYear();
  return {
    exa:    `OJK PDN posisi devisa neto perbankan persen modal ${yr}`,
    tavily: `OJK PDN posisi devisa neto bank persen modal statistik perbankan ${yr}`,
  };
}

export interface OjkPdnData {
  date: string;
  pdnPct: number;       // % of capital
  sourceUrl: string | null;
  fetchedAt: string;
}

function parsePdnText(text: string): number | null {
  const patterns = [
    // "PDN sebesar X,XX%" or "PDN X,X persen"
    /PDN[^.]{0,40}?([\d]+[,.][\d]+)\s*%/i,
    /PDN[^.]{0,40}?([\d]+[,.][\d]+)\s*persen/i,
    /posisi devisa neto[^.]{0,50}?([\d]+[,.][\d]+)\s*%/i,
    /posisi devisa neto[^.]{0,50}?([\d]+[,.][\d]+)\s*persen/i,
    // "sebesar X% dari modal" pattern
    /([\d]+[,.][\d]+)\s*%\s+dari\s+modal[^.]{0,30}?PDN/i,
    /PDN[^.]{0,20}?berada\s+di\s+([\d]+[,.][\d]+)\s*%/i,
  ];

  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      const val = parseFloat(m[1]!.replace(',', '.'));
      if (!isNaN(val) && val >= 0 && val <= 22) return val;
    }
  }
  return null;
}

async function fetchViaExa(): Promise<OjkPdnData | null> {
  if (!process.env.EXASEARCH_API_KEY) return null;
  try {
    const { default: Exa } = await import('exa-js');
    const exa = new Exa(process.env.EXASEARCH_API_KEY);
    const startDate = new Date(Date.now() - 50 * 86_400_000).toISOString().slice(0, 10);
    const { exa: EXA_QUERY } = pdnQueries();

    const tryResults = (results: Array<{ text?: string; title?: string | null; publishedDate?: string | null; url?: string | null }>): OjkPdnData | null => {
      for (const r of results) {
        const text = (r as { text?: string }).text ?? r.title ?? '';
        if (!text) continue;
        const pdnPct = parsePdnText(text);
        if (pdnPct !== null) return { date: (r.publishedDate ?? NOW()).slice(0, 10), pdnPct, sourceUrl: r.url ?? null, fetchedAt: NOW() };
      }
      return null;
    };

    // Pass 1: target financial domains (high precision)
    const r1 = await exa.search(EXA_QUERY, {
      numResults: 4, type: 'auto', startPublishedDate: startDate,
      includeDomains: PDN_DOMAINS, contents: { text: { maxCharacters: 2000 } },
    } as Parameters<typeof exa.search>[1]);
    const hit1 = tryResults(r1.results ?? []);
    if (hit1) return hit1;

    // Pass 2: no domain restriction — broader coverage
    const r2 = await exa.search(EXA_QUERY, {
      numResults: 5, type: 'auto', startPublishedDate: startDate,
      contents: { text: { maxCharacters: 2000 } },
    } as Parameters<typeof exa.search>[1]);
    return tryResults(r2.results ?? []);
  } catch {
    return null;
  }
}

async function fetchViaTavily(): Promise<OjkPdnData | null> {
  if (!process.env.TAVILY_API_KEY) return null;
  try {
    const { TavilySearchAPIWrapper } = await import('@langchain/tavily');
    const tavily = new TavilySearchAPIWrapper({ tavilyApiKey: process.env.TAVILY_API_KEY });

    const response = await tavily.rawResults({
      query: pdnQueries().tavily,
      max_results: 4,
      include_domains: PDN_DOMAINS,
      time_range: 'month',
      include_raw_content: true,
    } as Parameters<typeof tavily.rawResults>[0]);

    for (const r of (response.results ?? [])) {
      const text = r.raw_content ?? r.content ?? '';
      const pdnPct = parsePdnText(text);
      if (pdnPct !== null) {
        return {
          date: TODAY(),
          pdnPct,
          sourceUrl: r.url ?? null,
          fetchedAt: NOW(),
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch OJK PDN monthly. 35-day freshness gate.
 * Returns null if no data found (graceful — engine handles absence).
 */
export async function fetchOjkPdn(): Promise<OjkPdnData | null> {
  // Gate on data DATE so monthly OJK releases trigger re-fetch even if we searched recently
  const cached = await getLatestPoint('bank_pdnl_pct');
  if (cached) {
    const ageDays = (Date.now() - new Date(cached.date).getTime()) / 86_400_000;
    if (ageDays < FRESHNESS_DAYS) {
      return { date: cached.date, pdnPct: cached.value, sourceUrl: null, fetchedAt: cached.fetchedAt };
    }
  }

  const data = (await fetchViaExa()) ?? (await fetchViaTavily());
  if (!data) return null;

  const point: MacroDataPoint = {
    indicator: 'bank_pdnl_pct',
    category: 'banking',
    date: data.date,
    value: data.pdnPct,
    unit: 'pct_capital',
    source: data.sourceUrl ?? 'exa_media_search',
    fetchedAt: data.fetchedAt,
  };
  await upsertPoints([point]);
  return data;
}
