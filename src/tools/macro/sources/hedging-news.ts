/**
 * Hedging compliance — news scrape fallback when BI SULNI Playwright fails.
 *
 * PBI 16/21/2014 jo 21/14/2019 requires non-bank corporates with net USD
 * liabilities maturing ≤3 months to hedge ≥25%. BI publishes the quarterly
 * compliance rate in the SULNI press release. SULNI page is JS-heavy and
 * blocked from Playwright in CI; the same number gets quoted in Bisnis,
 * Kontan, Detik, CNBC press recaps within ~1 week of release.
 *
 * 90-day freshness gate (quarterly cadence).
 *
 * DB indicator: uln_hedging_compliance_pct
 */

import { getLatestPoint, upsertPoints } from '../time-series-db.js';
import type { MacroDataPoint } from '../types.js';

const FRESHNESS_DAYS = 90;

const DOMAINS = [
  'bi.go.id', 'kontan.co.id', 'bisnis.com', 'cnbcindonesia.com',
  'detik.com', 'katadata.co.id', 'antaranews.com', 'kompas.com',
];

const QUERY = 'rasio kepatuhan pemenuhan kewajiban lindung nilai ULN korporasi BI persen 2026';

function parseIdNumber(s: string): number | null {
  const cleaned = s.replace(/\./g, '').replace(',', '.');
  const v = parseFloat(cleaned);
  return isNaN(v) ? null : v;
}

function parseHedgingText(text: string): number | null {
  const patterns: RegExp[] = [
    /pemenuhan\s+(?:kewajiban\s+)?lindung\s+nilai[\s\S]{0,80}?([\d.,]+)\s*%/i,
    /rasio\s+(?:kepatuhan\s+)?lindung\s+nilai[\s\S]{0,80}?([\d.,]+)\s*%/i,
    /tingkat\s+kepatuhan\s+(?:hedging|lindung\s+nilai)[\s\S]{0,80}?([\d.,]+)\s*%/i,
    /(?:kepatuhan|compliance)\s+hedging[\s\S]{0,80}?([\d.,]+)\s*%/i,
    /([\d.,]+)\s*%[\s\S]{0,80}?(?:dari\s+total\s+)?kewajiban\s+lindung\s+nilai/i,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m?.[1]) {
      const v = parseIdNumber(m[1]);
      // Sanity: 0-100% range; reject values likely matching ULN growth or yield
      if (v !== null && v >= 0 && v <= 100) return v;
    }
  }
  return null;
}

async function fetchViaExa(): Promise<{ value: number; sourceUrl: string | null } | null> {
  if (!process.env.EXASEARCH_API_KEY) return null;
  try {
    const { default: Exa } = await import('exa-js');
    const exa = new Exa(process.env.EXASEARCH_API_KEY);
    const startDate = new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10);

    const response = await exa.search(QUERY, {
      numResults: 5,
      type: 'auto',
      startPublishedDate: startDate,
      includeDomains: DOMAINS,
      contents: { text: { maxCharacters: 2500 } },
    } as Parameters<typeof exa.search>[1]);

    for (const r of (response.results ?? [])) {
      const text = (r as { text?: string }).text ?? r.title ?? '';
      if (!text) continue;
      const v = parseHedgingText(text);
      if (v !== null) return { value: v, sourceUrl: r.url ?? null };
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchViaTavily(): Promise<{ value: number; sourceUrl: string | null } | null> {
  if (!process.env.TAVILY_API_KEY) return null;
  try {
    const { TavilySearchAPIWrapper } = await import('@langchain/tavily');
    const tavily = new TavilySearchAPIWrapper({ tavilyApiKey: process.env.TAVILY_API_KEY });
    const response = await tavily.rawResults({
      query: QUERY,
      max_results: 5,
      include_domains: DOMAINS,
      include_raw_content: true,
      time_range: 'year',
    } as Parameters<typeof tavily.rawResults>[0]);

    for (const r of (response.results ?? [])) {
      const text = (r.raw_content ?? r.content ?? '') as string;
      if (!text) continue;
      const v = parseHedgingText(text);
      if (v !== null) return { value: v, sourceUrl: r.url ?? null };
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchHedgingComplianceNews(): Promise<MacroDataPoint | null> {
  const cached = await getLatestPoint('uln_hedging_compliance_pct');
  if (cached) {
    const ageDays = (Date.now() - new Date(cached.fetchedAt).getTime()) / 86_400_000;
    if (ageDays < FRESHNESS_DAYS) return null;
  }

  const data = (await fetchViaExa()) ?? (await fetchViaTavily());
  if (!data) return null;

  const point: MacroDataPoint = {
    indicator: 'uln_hedging_compliance_pct',
    category: 'uln',
    date: new Date().toISOString().slice(0, 10),
    value: data.value,
    unit: '%',
    source: data.sourceUrl ?? 'exa_hedging_news',
    fetchedAt: new Date().toISOString(),
  };
  await upsertPoints([point]);
  return point;
}
