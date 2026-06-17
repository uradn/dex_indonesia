/**
 * BI DNDF (Domestic Non-Deliverable Forward) Outstanding Tracker
 *
 * WHY THIS MATTERS:
 *   BI uses DNDF contracts to stabilize IDR off-balance-sheet: it sells USD forward at a
 *   fixed rate, giving corporates an IDR hedge. When contracts mature, BI must deliver USD —
 *   so DNDF outstanding is a CONTINGENT FX LIABILITY not visible in official cadev figures.
 *
 *   Implication: published cadev ($X bn) overstates BI's true firing power by the DNDF
 *   notional. "Effective reserves" = cadev − DNDF outstanding. This matters for:
 *     (1) Shadow rate: GG breach happens sooner on adjusted reserves
 *     (2) Pseudo-stability: cadev flat while DNDF rises = hidden intervention
 *     (3) Confidence gate: DCI reserveRunway should use adjusted reserves
 *     (4) 2nd-gen attack: if traders learn DNDF size, crisis threshold moves forward
 *
 *   BI publishes DNDF quarterly in SULNI (Statistik ULN Indonesia) and sometimes via
 *   press releases. Bloomberg/Reuters report large positions during intervention periods.
 *   2018 peak: ~$17bn net forward. 2023: $5-10bn.
 *
 * DATA SOURCE:
 *   Exa neural search → Bloomberg Technoz, Bisnis, Kontan, Reuters for BI DNDF data.
 *   7-day freshness gate (data is monthly/quarterly, weekly news covers updates).
 *
 * DB INDICATOR: bi_dndf_outstanding_bn (USD billion, contingent liability)
 */

import { getLatestPoint, upsertPoints } from '../time-series-db.js';

const FRESHNESS_DAYS = 7;

const EXA_QUERIES = [
  'Bank Indonesia DNDF outstanding net forward position billion USD 2026',
  'posisi DNDF BI miliar dolar neraca intervensi valuta 2026',
  'Bank Indonesia domestic non-deliverable forward outstanding notional',
];

const TAVILY_QUERY = 'Bank Indonesia DNDF net forward position billion USD outstanding 2026';

export interface DndfData {
  date: string;
  outstandingBn: number;      // USD billion, contingent liability
  sourceUrl: string | null;
  fetchedAt: string;
}

function parseDndfText(text: string): number | null {
  // Patterns in order of confidence:
  // "DNDF outstanding $12.5 billion", "net forward position USD 12.5bn"
  // "posisi DNDF BI sebesar $12,5 miliar", "forward position Rp185 triliun" (convert at USDIDR)
  const patterns: RegExp[] = [
    // English: DNDF + USD amount
    /DNDF\s+(?:outstanding|position|notional|net)[^\d]{0,40}(?:USD?\s*|US\$\s*)?(\d+(?:[.,]\d+)?)\s*(?:billion|bn|B)\b/i,
    // English: net forward position + USD
    /net\s+forward\s+position[^\d]{0,40}(?:USD?\s*|US\$\s*)?(\d+(?:[.,]\d+)?)\s*(?:billion|bn|B)\b/i,
    // English: forward position first
    /forward\s+(?:position|contracts?|outstanding)[^\d]{0,40}\$(\d+(?:[.,]\d+)?)\s*(?:billion|bn|B)?\b/i,
    // Indonesian: posisi DNDF + miliar
    /(?:posisi|jumlah|nilai)\s+DNDF[^\d]{0,40}(?:USD?\s*|US\$\s*)?(\d+(?:[.,]\d+)?)\s*(?:miliar|milyard|bn|B)\b/i,
    // Indonesian: DNDF sebesar
    /DNDF[^\d]{0,20}sebesar[^\d]{0,20}(?:USD?\s*|US\$\s*)?(\d+(?:[.,]\d+)?)\s*(?:miliar|milyard|bn|B)\b/i,
    // Generic: BI forward + billion near DNDF context
    /BI[^\d]{0,30}(\d+(?:[.,]\d+)?)\s*(?:billion|bn|B)\s+(?:in\s+)?(?:forward|DNDF|NDF)/i,
  ];

  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) {
      const val = parseFloat(m[1].replace(',', '.'));
      if (!isNaN(val) && val > 0 && val < 100) return val; // sanity: 0-$100bn range
    }
  }

  // IDR trn fallback — convert at approximate USDIDR 16,500
  const idrPatterns: RegExp[] = [
    /DNDF[^\d]{0,40}(?:Rp\.?\s*|IDR\s*)?(\d+(?:[.,]\d+)?)\s*(?:triliun|trln|T)\b/i,
    /forward[^\d]{0,40}(?:Rp\.?\s*|IDR\s*)?(\d+(?:[.,]\d+)?)\s*(?:triliun|trln|T)\b/i,
  ];
  for (const re of idrPatterns) {
    const m = text.match(re);
    if (m?.[1]) {
      const idrTrn = parseFloat(m[1].replace(',', '.'));
      if (!isNaN(idrTrn) && idrTrn > 0 && idrTrn < 1_500) {
        // Convert IDR trn → USD bn at ~16,500
        return parseFloat((idrTrn * 1_000_000_000_000 / 16_500 / 1_000_000_000).toFixed(1));
      }
    }
  }

  return null;
}

async function fetchViaExa(): Promise<DndfData | null> {
  if (!process.env.EXASEARCH_API_KEY) return null;
  try {
    const { default: Exa } = await import('exa-js');
    const exa = new Exa(process.env.EXASEARCH_API_KEY);
    const startDate = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);

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
        const val = parseDndfText(text);
        if (val !== null) {
          return {
            outstandingBn: val,
            date: (r.publishedDate ?? new Date().toISOString()).slice(0, 10),
            sourceUrl: r.url ?? null,
            fetchedAt: new Date().toISOString(),
          };
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchViaTavily(): Promise<DndfData | null> {
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
      const val = parseDndfText(text);
      if (val !== null) {
        return {
          outstandingBn: val,
          date: new Date().toISOString().slice(0, 10),
          sourceUrl: r.url ?? null,
          fetchedAt: new Date().toISOString(),
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch BI DNDF outstanding (USD bn). Returns null if no data found or data too stale to update.
 * Uses cached DB value if within 7-day freshness gate.
 */
export async function fetchDndf(): Promise<DndfData | null> {
  const cached = await getLatestPoint('bi_dndf_outstanding_bn');
  if (cached) {
    const ageDays = (Date.now() - new Date(cached.fetchedAt ?? cached.date).getTime()) / 86_400_000;
    if (ageDays < FRESHNESS_DAYS) {
      return {
        outstandingBn: cached.value,
        date: cached.date,
        sourceUrl: null,
        fetchedAt: cached.fetchedAt ?? cached.date,
      };
    }
  }

  const data = await fetchViaExa() ?? await fetchViaTavily();
  if (!data) return null;

  await upsertPoints([{
    indicator: 'bi_dndf_outstanding_bn',
    category: 'fx' as const,
    date: data.date,
    value: data.outstandingBn,
    unit: 'bn_USD',
    source: data.sourceUrl ?? 'exa_search',
    fetchedAt: data.fetchedAt,
  }]);

  return data;
}
