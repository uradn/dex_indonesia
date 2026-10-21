/**
 * Policy Response Coordination Tracker — KS#2 automation feed.
 *
 * Detects whether BI/Kemenkeu have mounted a coordinated stabilization package
 * by scanning for 4 distinct instrument types in a 72h coordination window:
 *
 *   1. dndf       — BI announces new DNDF tranche / increase (off-balance-sheet FX hedge)
 *   2. bei_buyback — BEI or BUMN activate share buyback for market stabilization
 *   3. alco        — BI-Kemenkeu ALCo emergency coordination meeting / joint statement
 *   4. danantara   — Danantara SWF stabilization announcement / fund deployment
 *
 * Classification:
 *   none (0)                — no instruments detected (last 72h)
 *   isolated_instrument (1) — 1 instrument only (routine BI ops)
 *   partial_coordination (2) — 2 instruments within 72h window (multi-tool but not full package)
 *   full_package (3)        — 3+ instruments within 72h window (Bagehot coordinated package)
 *
 * Score impact in M3 FX Defense:
 *   partial_coordination → −4 score pts (partial effectiveness signal)
 *   full_package         → −8 score pts + KS#2 candidate flag
 *
 * MSCI Standalone constraint (Oct 15 2026+): even full_package has limited effectiveness
 * against mandate-driven outflow (compliance execution ≠ speculative attack).
 * KS#2 should NOT be auto-killed while MSCI Standalone consultation is active.
 *
 * DB indicator: policy_response_level (value 0/1/2/3), freshness 24h.
 */

import { getLatestPoint, upsertPoints } from '../time-series-db.js';

const FRESHNESS_HOURS = 24;
const COORDINATION_WINDOW_HOURS = 72;
const LOOKBACK_DAYS = 5; // scan last 5 days for signals

export type PolicyResponseLevel = 'none' | 'isolated_instrument' | 'partial_coordination' | 'full_package';
export type PolicyInstrument = 'dndf' | 'bei_buyback' | 'alco' | 'danantara';

export interface PolicyResponseSignal {
  instrument: PolicyInstrument;
  headline: string;
  url: string | null;
  publishedAt: string; // ISO date (YYYY-MM-DD or full ISO)
}

export interface PolicyResponseData {
  level: PolicyResponseLevel;
  levelNumeric: 0 | 1 | 2 | 3;
  signals: PolicyResponseSignal[];
  coordinationWindowHours: number | null; // hours between first and last signal; null if <2 signals
  fetchedAt: string;
}

// Per-instrument search configuration
const INSTRUMENT_CONFIG: Record<PolicyInstrument, {
  exaQueries: string[];
  tavilyQuery: string;
  keywords: string[];
}> = {
  dndf: {
    exaQueries: [
      'Bank Indonesia DNDF baru tambah intervensi forward Oktober 2026',
      'Bank Indonesia new DNDF tranche intervention forward dollar 2026',
      'BI tambah posisi DNDF miliar dolar stabilisasi rupiah 2026',
    ],
    tavilyQuery: 'Bank Indonesia DNDF baru intervensi forward rupiah Oktober 2026',
    keywords: ['dndf baru', 'tambah dndf', 'new dndf', 'dndf tranche', 'forward baru', 'tambah posisi forward',
               'menambah dndf', 'menambah intervensi forward', 'increase dndf', 'dndf tambah'],
  },
  bei_buyback: {
    exaQueries: [
      'BEI buyback saham stabilisasi pasar IDX 2026 BUMN beli kembali',
      'IDX stock buyback market stabilization Indonesia 2026 government',
      'BUMN buyback saham pasar modal Oktober 2026 stabilisasi',
    ],
    tavilyQuery: 'BEI buyback saham stabilisasi pasar modal Oktober 2026',
    keywords: ['buyback', 'beli kembali', 'stock buyback', 'market stabilization buyback',
               'stabilisasi pasar modal', 'pasar saham buyback', 'aksi beli bumn'],
  },
  alco: {
    exaQueries: [
      'ALCo Bank Indonesia Kemenkeu koordinasi darurat kurs rupiah 2026',
      'Bank Indonesia Ministry Finance joint coordination statement rupiah stabilization 2026',
      'BI Kemenkeu pertemuan darurat stabilisasi nilai tukar Oktober 2026',
    ],
    tavilyQuery: 'ALCo BI Kemenkeu koordinasi darurat rupiah Oktober 2026',
    keywords: ['alco', 'koordinasi darurat', 'joint statement', 'joint coordination', 'pertemuan darurat',
               'emergency meeting bi kemenkeu', 'koordinasi bi kemenkeu', 'paket kebijakan bersama',
               'stabilisasi bersama', 'integrated policy package'],
  },
  danantara: {
    exaQueries: [
      'Danantara stabilisasi pasar saham rupiah intervensi dana 2026',
      'Danantara sovereign wealth fund market stabilization Indonesia 2026',
      'Danantara deploy fund stabilization IHSG IDR Oktober 2026',
    ],
    tavilyQuery: 'Danantara stabilisasi pasar rupiah Oktober 2026',
    keywords: ['danantara stabilisasi', 'danantara intervensi', 'danantara pasar saham',
               'danantara rupiah', 'danantara deploy', 'danantara fund market', 'danantara swf stabiliz'],
  },
};

function isCoordinationKeyword(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some(kw => lower.includes(kw));
}

async function scanInstrumentViaExa(
  instrument: PolicyInstrument,
): Promise<PolicyResponseSignal | null> {
  if (!process.env.EXASEARCH_API_KEY) return null;
  const cfg = INSTRUMENT_CONFIG[instrument];
  const startDate = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);

  try {
    const { default: Exa } = await import('exa-js');
    const exa = new Exa(process.env.EXASEARCH_API_KEY);

    for (const query of cfg.exaQueries) {
      const resp = await exa.search(query, {
        numResults: 4,
        type: 'neural',
        startPublishedDate: startDate,
        contents: { text: { maxCharacters: 600 } },
      } as Parameters<typeof exa.search>[1]);

      for (const r of resp.results ?? []) {
        const text = ((r as { text?: string }).text ?? '') + ' ' + (r.title ?? '');
        if (isCoordinationKeyword(text, cfg.keywords)) {
          return {
            instrument,
            headline: r.title ?? query,
            url: r.url ?? null,
            publishedAt: (r.publishedDate ?? new Date().toISOString()).slice(0, 10),
          };
        }
      }
    }
  } catch { /* silent */ }
  return null;
}

async function scanInstrumentViaTavily(
  instrument: PolicyInstrument,
): Promise<PolicyResponseSignal | null> {
  if (!process.env.TAVILY_API_KEY) return null;
  const cfg = INSTRUMENT_CONFIG[instrument];

  try {
    const { TavilySearchAPIWrapper } = await import('@langchain/tavily');
    const tavily = new TavilySearchAPIWrapper({ tavilyApiKey: process.env.TAVILY_API_KEY });
    const resp = await tavily.rawResults({
      query: cfg.tavilyQuery,
      max_results: 4,
      include_raw_content: false,
      time_range: 'week',
    } as Parameters<typeof tavily.rawResults>[0]);

    for (const r of resp.results ?? []) {
      const text = (r.content ?? '') + ' ' + (r.title ?? '');
      if (isCoordinationKeyword(text, cfg.keywords)) {
        return {
          instrument,
          headline: r.title ?? cfg.tavilyQuery,
          url: r.url ?? null,
          publishedAt: new Date().toISOString().slice(0, 10),
        };
      }
    }
  } catch { /* silent */ }
  return null;
}

async function scanInstrument(instrument: PolicyInstrument): Promise<PolicyResponseSignal | null> {
  return (await scanInstrumentViaExa(instrument)) ?? (await scanInstrumentViaTavily(instrument));
}

function classifyLevel(signals: PolicyResponseSignal[]): {
  level: PolicyResponseLevel;
  levelNumeric: 0 | 1 | 2 | 3;
  coordinationWindowHours: number | null;
} {
  if (signals.length === 0) return { level: 'none', levelNumeric: 0, coordinationWindowHours: null };
  if (signals.length === 1) return { level: 'isolated_instrument', levelNumeric: 1, coordinationWindowHours: null };

  // Compute window between earliest and latest signal
  const times = signals.map(s => new Date(s.publishedAt).getTime()).filter(t => !isNaN(t));
  const windowHours = times.length >= 2
    ? (Math.max(...times) - Math.min(...times)) / 3_600_000
    : COORDINATION_WINDOW_HOURS; // assume within window if dates missing

  if (windowHours > COORDINATION_WINDOW_HOURS) {
    // Signals too spread out — only count isolated
    return { level: 'isolated_instrument', levelNumeric: 1, coordinationWindowHours: windowHours };
  }

  const level: PolicyResponseLevel = signals.length >= 3 ? 'full_package' : 'partial_coordination';
  const levelNumeric: 0 | 1 | 2 | 3 = signals.length >= 3 ? 3 : 2;
  return { level, levelNumeric, coordinationWindowHours: windowHours };
}

/**
 * Fetch policy response coordination level.
 * Scans all 4 instrument types in parallel; classifies by 72h window count.
 */
export async function fetchPolicyResponse(): Promise<PolicyResponseData> {
  const today = new Date().toISOString().slice(0, 10);
  const fetchedAt = new Date().toISOString();

  // DB cache check (24h freshness)
  const cached = await getLatestPoint('policy_response_level');
  if (cached) {
    const ageH = (Date.now() - new Date(cached.fetchedAt ?? cached.date).getTime()) / 3_600_000;
    if (ageH < FRESHNESS_HOURS) {
      const numericLevel = cached.value as 0 | 1 | 2 | 3;
      const levelMap: Record<number, PolicyResponseLevel> = { 0: 'none', 1: 'isolated_instrument', 2: 'partial_coordination', 3: 'full_package' };
      return {
        level: levelMap[numericLevel] ?? 'none',
        levelNumeric: numericLevel,
        signals: [],
        coordinationWindowHours: null,
        fetchedAt: cached.fetchedAt ?? cached.date,
      };
    }
  }

  // Scan all 4 instruments in parallel
  const instruments: PolicyInstrument[] = ['dndf', 'bei_buyback', 'alco', 'danantara'];
  const results = await Promise.allSettled(instruments.map(scanInstrument));
  const signals: PolicyResponseSignal[] = results
    .map(r => r.status === 'fulfilled' ? r.value : null)
    .filter((s): s is PolicyResponseSignal => s !== null);

  const { level, levelNumeric, coordinationWindowHours } = classifyLevel(signals);

  // Persist to DB
  await upsertPoints([{
    indicator: 'policy_response_level',
    category: 'sovereign' as const,
    date: today,
    value: levelNumeric,
    unit: 'level_0_3',
    source: 'exa_tavily',
    fetchedAt,
  }]);

  return { level, levelNumeric, signals, coordinationWindowHours, fetchedAt };
}
