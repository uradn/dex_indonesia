/**
 * MSCI Indonesia Classification Auto-Detect
 *
 * WHY THIS MATTERS:
 *   MSCI Global Market Accessibility Review (Jun 18 2026) → classification result Jun 23.
 *   If Indonesia downgraded from Emerging to Frontier:
 *     - All EM-mandate passive funds must sell → forced outflow >> May 29 rebalancing
 *     - M5 foreign flow engine flags CRITICAL (+20 score bump)
 *     - Kill switch #3 for armed theses (SBN own >13% + MSCI confirm = capital return)
 *     - OR thesis accelerator (downgrade confirms thesis = no kill)
 *
 *   This module searches for the classification announcement and auto-updates
 *   the MSCI status in DB so foreign-flow-engine.ts doesn't need env var changes.
 *
 * NUMERIC ENCODING (stored in macro_series as `msci_classification_numeric`):
 *   0 = confirmed EM (no change / review closed)
 *   1 = under_review (result pending)
 *   2 = downgrade_risk / frontier reclassified
 *
 * FRESHNESS: 7-day gate before Jun 23; 30-day gate after result is known.
 */

import { getLatestPoint, upsertPoints } from '../time-series-db.js';

export type MsciStatus = 'confirmed' | 'under_review' | 'downgrade_risk';

export interface MsciClassificationResult {
  status: MsciStatus;
  resultDate: string | null;    // ISO date result was announced (null if still pending)
  sourceUrl: string | null;
  fetchedAt: string;
  raw: string | null;           // headline/excerpt for audit trail
}

const STATUS_NUMERIC: Record<MsciStatus, number> = {
  confirmed: 0,
  under_review: 1,
  downgrade_risk: 2,
};

// After Jun 23, result is stable — extend freshness gate significantly
function freshnessGateDays(status: MsciStatus): number {
  return status === 'under_review' ? 7 : 30;
}

const EXA_QUERIES = [
  'MSCI Indonesia classification result June 2026 emerging frontier',
  'MSCI Global Market Accessibility Review Indonesia reclassification 2026',
  'MSCI Indonesia frontier downgrade emerging market status 2026',
];

const TAVILY_QUERY = 'MSCI Indonesia June 2026 classification result emerging frontier market reclassification';

function parseClassificationText(text: string): MsciStatus | null {
  const lower = text.toLowerCase();

  // Definitive downgrade signals
  const downgradePhrases = [
    'downgraded to frontier',
    'reclassified as frontier',
    'reclassified to frontier',
    'classified as frontier market',
    'removed from emerging market',
    'frontier market status',
    'indonesia frontier',
    'diturunkan ke frontier',
    'direklasifikasi frontier',
  ];
  if (downgradePhrases.some(p => lower.includes(p))) return 'downgrade_risk';

  // Definitive "no change" / EM confirmed signals
  const confirmedPhrases = [
    'maintained emerging market',
    'retained emerging market',
    'emerging market status maintained',
    'emerging market status retained',
    'kept emerging market',
    'no change to emerging',
    'classification unchanged',
    'confirmed as emerging',
    'indonesia remains emerging',
    'tetap sebagai emerging',
    'tetap di emerging',
    'status emerging dipertahankan',
    'mempertahankan status indonesia sebagai emerging',
    'mempertahankan statusnya sebagai emerging',
    'pertahankan status indonesia sebagai emerging',
    'pertahankan status emerging',
    'mempertahankan emerging market',
    'batal turunkan status',
    'masih mempertahankan',
    'classification review completed',
    'reclassification not recommended',
  ];
  if (confirmedPhrases.some(p => lower.includes(p))) return 'confirmed';

  // Still under review
  const reviewPhrases = [
    'under review',
    'classification review',
    'accessibility review',
    'pending classification',
    'pending result',
    'awaiting result',
    'annual review',
  ];
  if (reviewPhrases.some(p => lower.includes(p))) return 'under_review';

  return null;
}

async function fetchViaExa(): Promise<MsciClassificationResult | null> {
  if (!process.env.EXASEARCH_API_KEY) return null;
  try {
    const { default: Exa } = await import('exa-js');
    const exa = new Exa(process.env.EXASEARCH_API_KEY);
    const startDate = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

    for (const query of EXA_QUERIES) {
      const response = await exa.search(query, {
        numResults: 4,
        type: 'neural',
        startPublishedDate: startDate,
        contents: { text: { maxCharacters: 2000 } },
      } as Parameters<typeof exa.search>[1]);

      for (const r of response.results ?? []) {
        const text = (r as { text?: string }).text ?? r.title ?? '';
        if (!text) continue;
        const status = parseClassificationText(text);
        if (status !== null) {
          return {
            status,
            resultDate: r.publishedDate ? r.publishedDate.slice(0, 10) : null,
            sourceUrl: r.url ?? null,
            fetchedAt: new Date().toISOString(),
            raw: text.slice(0, 300),
          };
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchViaTavily(): Promise<MsciClassificationResult | null> {
  if (!process.env.TAVILY_API_KEY) return null;
  try {
    const { TavilySearchAPIWrapper } = await import('@langchain/tavily');
    const tavily = new TavilySearchAPIWrapper({ tavilyApiKey: process.env.TAVILY_API_KEY });

    const response = await tavily.rawResults({
      query: TAVILY_QUERY,
      max_results: 4,
      include_raw_content: true,
      time_range: 'month',
    } as Parameters<typeof tavily.rawResults>[0]);

    for (const r of (response.results ?? [])) {
      const text = r.raw_content ?? r.content ?? '';
      if (!text) continue;
      const status = parseClassificationText(text);
      if (status !== null) {
        return {
          status,
          resultDate: new Date().toISOString().slice(0, 10),
          sourceUrl: r.url ?? null,
          fetchedAt: new Date().toISOString(),
          raw: text.slice(0, 300),
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch MSCI Indonesia classification status. Returns cached result if fresh.
 * Falls back to env var MSCI_CLASSIFICATION_STATUS if no search data available.
 */
export async function fetchMsciClassification(): Promise<MsciClassificationResult> {
  const envStatus = (process.env.MSCI_CLASSIFICATION_STATUS ?? 'under_review') as MsciStatus;

  const cached = await getLatestPoint('msci_classification_numeric');
  if (cached) {
    const cachedStatus = (Object.entries(STATUS_NUMERIC).find(([, v]) => v === cached.value)?.[0] ?? 'under_review') as MsciStatus;
    const ageDays = (Date.now() - new Date(cached.fetchedAt ?? cached.date).getTime()) / 86_400_000;
    if (ageDays < freshnessGateDays(cachedStatus)) {
      return {
        status: cachedStatus,
        resultDate: cached.date,
        sourceUrl: null,
        fetchedAt: cached.fetchedAt ?? cached.date,
        raw: null,
      };
    }
  }

  // Only search after Jun 23 2026 (result date) OR if already past that
  const resultReleaseDate = new Date('2026-06-23');
  const now = new Date();
  if (now < resultReleaseDate) {
    // Result not yet out — return env var status without wasting a search call
    return {
      status: envStatus,
      resultDate: null,
      sourceUrl: null,
      fetchedAt: new Date().toISOString(),
      raw: null,
    };
  }

  const data = await fetchViaExa() ?? await fetchViaTavily();
  if (!data) {
    // No result found — return env var as fallback
    return {
      status: envStatus,
      resultDate: null,
      sourceUrl: null,
      fetchedAt: new Date().toISOString(),
      raw: null,
    };
  }

  // Persist to DB
  await upsertPoints([{
    indicator: 'msci_classification_numeric',
    category: 'flow' as const,
    date: data.resultDate ?? new Date().toISOString().slice(0, 10),
    value: STATUS_NUMERIC[data.status],
    unit: 'categorical_0_1_2',
    source: data.sourceUrl ?? 'exa_search',
    fetchedAt: data.fetchedAt,
  }]);

  return data;
}
