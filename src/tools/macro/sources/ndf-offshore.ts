/**
 * IDR NDF (Non-Deliverable Forward) Offshore Rate — 1-Month Tenor
 *
 * WHY THIS MATTERS:
 *   Offshore NDF market prices IDR BEFORE the onshore spot market can react.
 *   NDF premium (NDF rate − spot rate) = offshore consensus on future IDR weakness.
 *   Signal leads onshore FX pressure by hours to days.
 *   In crisis regime (active_transmission), NDF premium typically widens 3-5% ahead
 *   of spot move — institutional hedgers reprice first, onshore retail follows.
 *
 *   Primary source: BI DNDF auction results (domestic synthetic NDF, related but not
 *   identical to offshore). Secondary: Exa financial news search for USD/IDR NDF quotes.
 *
 * DB INDICATOR: usdidr_ndf_1m_rate (IDR per USD, ~same range as spot: 14000-22000)
 * NDF PREMIUM:  ndf_rate − spot_rate. >100 = mild pressure. >500 = strong offshore signal.
 */

import { getLatestPoint, upsertPoints } from '../time-series-db.js';

const TODAY = () => new Date().toISOString().slice(0, 10);
const NOW = () => new Date().toISOString();
const CACHE_DAYS = 2;

export interface NdfData {
  rate: number;       // USD/IDR NDF 1M rate
  premium: number | null;  // rate - spot (if spot available); positive = IDR weakness priced in
  sourceUrl: string | null;
  fetchedAt: string;
}

const EXA_QUERIES = [
  'USD IDR NDF 1 month rate 2026 rupiah non-deliverable forward',
  'USDIDR NDF 1M offshore forward rate today Indonesia rupiah',
  'Indonesia rupiah NDF offshore rate 1 bulan kurs NDF dolar',
  'rupiah non-deliverable forward NDF 1 month price 2026',
];

const TAVILY_QUERY = 'USD/IDR NDF 1 month offshore forward rate Indonesia rupiah 2026';

function parseNdfRate(text: string): number | null {
  const t = text.replace(/[,\.]/g, (m, offset, str) => {
    // Preserve decimal separator for numbers like 18,040 → keep comma in context
    const before = str.slice(Math.max(0, offset - 5), offset).replace(/[^0-9]/g, '');
    const after = str.slice(offset + 1, offset + 4).replace(/[^0-9]/g, '');
    if (before.length === 2 && after.length === 3) return '';  // thousands sep
    return m;
  });

  const patterns = [
    // "NDF 1m: 18,200" or "NDF 1M 18200"
    /NDF\s*(?:1[Mm]|1-?month)[^0-9]{0,15}(1[3-9][0-9]{3})\b/i,
    // "USD/IDR NDF ... 18,040"
    /USD\/?IDR\s+NDF[^0-9]{0,25}(1[3-9][0-9]{3})\b/i,
    // "IDR NDF forward 18000"
    /IDR\s+NDF[^0-9]{0,20}(1[3-9][0-9]{3})\b/i,
    // "kurs NDF rupiah 18.040"
    /kurs\s+NDF[^0-9]{0,20}(1[3-9][0-9]{3})\b/i,
    // Generic: non-deliverable forward followed by number in IDR range
    /non-deliverable\s+forward[^0-9]{0,40}(1[3-9][0-9]{3})\b/i,
  ];

  for (const re of patterns) {
    const m = text.replace(/[,\.]/g, '') .match(re) ?? text.match(re);
    if (m) {
      const raw = m[1]!.replace(/[,\.]/g, '');
      const val = parseFloat(raw);
      if (val >= 13_000 && val <= 25_000) return val;
    }
  }
  return null;
}

async function fetchViaExa(): Promise<NdfData | null> {
  if (!process.env.EXASEARCH_API_KEY) return null;
  try {
    const { default: Exa } = await import('exa-js');
    const exa = new Exa(process.env.EXASEARCH_API_KEY);
    const startDate = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

    for (const query of EXA_QUERIES) {
      const response = await exa.search(query, {
        numResults: 5,
        type: 'neural',
        startPublishedDate: startDate,
        contents: { text: { maxCharacters: 1500 } },
      } as Parameters<typeof exa.search>[1]);

      for (const r of response.results ?? []) {
        const text = ((r as { text?: string }).text ?? r.title ?? '');
        const rate = parseNdfRate(text);
        if (rate !== null) {
          return {
            rate,
            premium: null,  // computed in engine with spot
            sourceUrl: r.url ?? null,
            fetchedAt: NOW(),
          };
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchViaTavily(): Promise<NdfData | null> {
  if (!process.env.TAVILY_API_KEY) return null;
  try {
    const { TavilySearchAPIWrapper } = await import('@langchain/tavily');
    const tavily = new TavilySearchAPIWrapper({ tavilyApiKey: process.env.TAVILY_API_KEY });
    const response = await tavily.rawResults({
      query: TAVILY_QUERY,
      max_results: 4,
      time_range: 'week',
      include_raw_content: true,
    } as Parameters<typeof tavily.rawResults>[0]);

    for (const r of (response.results ?? [])) {
      const text = r.raw_content ?? r.content ?? '';
      const rate = parseNdfRate(text);
      if (rate !== null) {
        return {
          rate,
          premium: null,
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
 * Fetch USD/IDR NDF 1-month offshore rate.
 * Returns null if no data found (graceful — engine handles absence).
 * Env override: USDIDR_NDF_1M_RATE (always wins when set).
 */
export async function fetchNdfOffshore(): Promise<NdfData | null> {
  // Env always wins
  if (process.env.USDIDR_NDF_1M_RATE) {
    const rate = parseFloat(process.env.USDIDR_NDF_1M_RATE);
    if (rate >= 13_000 && rate <= 25_000) {
      return { rate, premium: null, sourceUrl: null, fetchedAt: NOW() };
    }
  }

  // Check cache
  const cached = await getLatestPoint('usdidr_ndf_1m_rate');
  if (cached) {
    const ageDays = (Date.now() - new Date(cached.fetchedAt ?? cached.date).getTime()) / 86_400_000;
    if (ageDays < CACHE_DAYS) {
      return { rate: cached.value, premium: null, sourceUrl: null, fetchedAt: cached.fetchedAt ?? cached.date };
    }
  }

  const data = await fetchViaExa() ?? await fetchViaTavily();
  if (!data) return null;

  await upsertPoints([{
    indicator: 'usdidr_ndf_1m_rate',
    category: 'fx' as const,
    date: TODAY(),
    value: data.rate,
    unit: 'IDR/USD',
    source: data.sourceUrl ?? 'exa_search',
    fetchedAt: data.fetchedAt,
  }]);

  return data;
}
