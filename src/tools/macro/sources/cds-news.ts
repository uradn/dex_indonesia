/**
 * Indonesia CDS 5Y news-scrape fallback — Exa (primary) / Tavily (fallback).
 *
 * Called when Bloomberg/Refinitiv/WGB Playwright all fail to return a CDS value.
 * Parses bps values from financial news headlines + body text.
 *
 * Sanity range: 40–600bps (Indonesia peacetime 50–300; 600 = extreme crisis ceiling).
 * 1-day freshness gate — skips if DB already has CDS data < 1d old from any source.
 *
 * DB indicator: indonesia_cds_5y_bps
 */
import { getLatestPoint, upsertPoints } from '../time-series-db.js';
import type { MacroDataPoint } from '../types.js';

const FRESHNESS_DAYS = 1;

const DOMAINS = [
  'bloombergtechnoz.com',
  'bisnis.com',
  'cnbcindonesia.com',
  'kontan.co.id',
  'katadata.co.id',
  'reuters.com',
  'investing.com',
  'en.tempo.co',
  'antaranews.com',
  'marketwatch.com',
];

const QUERIES = [
  'Indonesia CDS 5Y basis points sovereign credit default swap bps widened',
  'Indonesia 5-year credit default swap spread basis points Bloomberg',
  'Indonesia sovereign CDS bps credit risk premium latest',
  'CDS Indonesia 5 tahun basis points kredit risiko terbaru',
];

const CDS_MIN = 40;
const CDS_MAX = 600;

function parseCdsBps(text: string): number | null {
  const patterns: RegExp[] = [
    // "Indonesia ... CDS ... 97.1 bps" or "CDS ... Indonesia ... 97.1 basis points"
    /Indonesia[\s\S]{0,80}?CDS[\s\S]{0,60}?([\d]+(?:[.,][\d]+)?)\s*(?:bps|basis\s*points)/i,
    /CDS[\s\S]{0,60}?Indonesia[\s\S]{0,60}?([\d]+(?:[.,][\d]+)?)\s*(?:bps|basis\s*points)/i,
    // "credit default swap ... 97 bps"
    /credit\s+default\s+swap[\s\S]{0,80}?([\d]+(?:[.,][\d]+)?)\s*(?:bps|basis\s*points)/i,
    // "97.1 bps ... Indonesia CDS"
    /([\d]+(?:[.,][\d]+)?)\s*(?:bps|basis\s*points)[\s\S]{0,50}?(?:Indonesia|Indonesian)[\s\S]{0,30}?CDS/i,
    // Indonesian: "CDS Indonesia mencapai/sebesar/menjadi 97 bps"
    /CDS\s+Indonesia[\s\S]{0,40}?(?:mencapai|sebesar|menjadi|di|pada)\s+([\d]+(?:[.,][\d]+)?)\s*(?:bps|basis\s*points)/i,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m?.[1]) {
      const raw = m[1].replace(',', '.');
      const v = parseFloat(raw);
      if (!isNaN(v) && v >= CDS_MIN && v <= CDS_MAX) return v;
    }
  }
  return null;
}

async function fetchViaExa(): Promise<{ cds: number | null; sourceUrl: string | null }> {
  if (!process.env.EXASEARCH_API_KEY) return { cds: null, sourceUrl: null };
  try {
    const { default: Exa } = await import('exa-js');
    const exa = new Exa(process.env.EXASEARCH_API_KEY);
    const startDate = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

    for (const query of QUERIES) {
      const response = await exa.search(query, {
        numResults: 6,
        type: 'auto',
        startPublishedDate: startDate,
        includeDomains: DOMAINS,
        contents: { text: { maxCharacters: 3000 } },
      } as Parameters<typeof exa.search>[1]).catch(() => null);
      if (!response) continue;

      for (const r of (response.results ?? [])) {
        const text = (r as { text?: string }).text ?? r.title ?? '';
        if (!text) continue;
        const v = parseCdsBps(text);
        if (v != null) return { cds: v, sourceUrl: r.url ?? null };
      }
    }
    return { cds: null, sourceUrl: null };
  } catch {
    return { cds: null, sourceUrl: null };
  }
}

async function fetchViaTavily(): Promise<{ cds: number | null; sourceUrl: string | null }> {
  if (!process.env.TAVILY_API_KEY) return { cds: null, sourceUrl: null };
  try {
    const { TavilySearchAPIWrapper } = await import('@langchain/tavily');
    const tavily = new TavilySearchAPIWrapper({ tavilyApiKey: process.env.TAVILY_API_KEY });

    for (const query of QUERIES) {
      const response = await tavily.rawResults({
        query,
        max_results: 6,
        include_domains: DOMAINS,
        include_raw_content: true,
        time_range: 'week',
      } as Parameters<typeof tavily.rawResults>[0]).catch(() => null);
      if (!response) continue;

      for (const r of (response.results ?? [])) {
        const text = (r.raw_content ?? r.content ?? '') as string;
        if (!text) continue;
        const v = parseCdsBps(text);
        if (v != null) return { cds: v, sourceUrl: (r.url as string | undefined) ?? null };
      }
    }
    return { cds: null, sourceUrl: null };
  } catch {
    return { cds: null, sourceUrl: null };
  }
}

/**
 * Fetch Indonesia CDS 5Y bps from news when primary sources (Bloomberg/Refinitiv/WGB) fail.
 * Returns MacroDataPoint or null. Writes to DB on success.
 */
export async function fetchCds5yNews(): Promise<MacroDataPoint | null> {
  // Freshness gate: skip if DB has CDS data < 1d old (any source)
  const cached = await getLatestPoint('indonesia_cds_5y_bps');
  if (cached) {
    const ageDays = (Date.now() - new Date(cached.fetchedAt).getTime()) / 86_400_000;
    if (ageDays < FRESHNESS_DAYS) return null;
  }

  const exaResult  = await fetchViaExa();
  const result = exaResult.cds != null ? exaResult : await fetchViaTavily();

  if (result.cds == null) return null;

  const point: MacroDataPoint = {
    indicator: 'indonesia_cds_5y_bps',
    category: 'sovereign',
    date: new Date().toISOString().slice(0, 10),
    value: result.cds,
    unit: 'bps',
    source: result.sourceUrl ?? 'exa_cds_news',
    fetchedAt: new Date().toISOString(),
  };
  await upsertPoints([point]);
  return point;
}
