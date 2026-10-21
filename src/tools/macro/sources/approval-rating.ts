/**
 * Presidential Approval Rating — monthly time-series for M12 Tsebelis VPI.
 *
 * Solves the Poltracking data acquisition problem sustainably:
 *   - Poltracking.com is paywalled + anti-bot → DO NOT scrape directly
 *   - Instead: scrape Indonesian MEDIA COVERAGE of poll releases (free, legal)
 *   - CNBC Indonesia / Kompas / Tempo / Detik / Bisnis regularly quote exact numbers
 *   - Multiple surveys same month → store median (robust vs house effects)
 *
 * Source hierarchy (monthly refresh):
 *   1. Env: PRABOWO_APPROVAL_PCT (always wins; monthly manual fallback)
 *   2. DB cache: prabowo_approval_pct (30d freshness — monthly cadence)
 *   3. Exa neural search: media articles citing Poltracking/LSI/Indikator/SMRC
 *   4. Tavily: Indonesian portal coverage (Detik/Kompas/Tempo/Bisnis)
 *   5. null → caller uses env or default
 *
 * DB schema:
 *   indicator: prabowo_approval_pct
 *   date:      YYYY-MM-01  (monthly resolution; one row per month)
 *   value:     approval % (e.g., 72.5)
 *   unit:      pct
 *   source:    "poltracking|lsi|indikator|smrc:median:url1,url2" or "exa:url" or "manual"
 *   category:  sovereign
 *
 * Confidence scoring:
 *   pollster named (Poltracking/LSI/Indikator/SMRC) → 85
 *   generic survey reference ("survei", "polling")   → 50
 *   no survey context                                → 25
 *   manual entry (backfill script)                   → 100
 *
 * Backfill: `bun scripts/backfill-approval-history.ts`
 *   Batch auto for 6–9 months; interactive + CSV import for older gaps.
 */

import { getLatestPoint, getLastN, upsertPoints } from '../time-series-db.js';

const FRESHNESS_DAYS = 30;

export const POLLSTERS = ['poltracking', 'lsi', 'indikator', 'smrc', 'saifulmujani', 'charta politika'] as const;
export type Pollster = (typeof POLLSTERS)[number] | null;

export interface ApprovalPoint {
  approvalPct: number;
  month: string;        // YYYY-MM
  pollsters: Pollster[]; // which pollsters found this month
  confidence: number;   // 0-100
  source: string;
  fetchedAt: string;
}

export interface ApprovalSeries {
  points: ApprovalPoint[];  // up to N most-recent months, asc
  avg3m: number | null;     // 3-month rolling median (null if <1 point)
  trend: 'rising' | 'falling' | 'stable' | null; // vs 3 months ago
}

// ── Parser ────────────────────────────────────────────────────────────────────

interface ParseResult {
  pct: number;
  pollster: Pollster;
  confidence: number;
}

const POLLSTER_PATTERNS: Array<{ name: Pollster; patterns: RegExp[] }> = [
  { name: 'poltracking', patterns: [/poltracking/i] },
  { name: 'lsi',        patterns: [/\blsi\b/i, /lembaga survei indonesia/i] },
  { name: 'indikator',  patterns: [/\bindikator politik\b/i, /\bindikator\.co\.id\b/i] },
  { name: 'smrc',       patterns: [/\bsmrc\b/i, /saiful mujani/i] },
  { name: 'charta politika', patterns: [/charta politika/i] },
];

function detectPollster(text: string): Pollster {
  const lower = text.toLowerCase();
  for (const { name, patterns } of POLLSTER_PATTERNS) {
    if (patterns.some(p => p.test(lower))) return name;
  }
  return null;
}

// Plausible Prabowo approval range since inauguration Oct 2024
const APPROVAL_MIN = 45;
const APPROVAL_MAX = 92;

// Negative context: reject if nearby text is about FUTURE election simulation, not current kinerja
// "capres", "pilpres 2029", "calon presiden", "head to head", "dedi mulyadi", "simulasi"
// These indicate elektabilitas capres polls, not kepuasan kinerja presiden
const CAPRES_CONTEXT = /capres|pilpres\s*20[0-9]{2}|calon presiden|head.to.head|simulasi elekt|anies|ganjar|dedi mulyadi|puan maharani|kandidat presiden/i;

function isElectabilityContext(windowText: string): boolean {
  return CAPRES_CONTEXT.test(windowText);
}

function parseApproval(text: string): ParseResult | null {
  // Normalise Indonesian comma-decimal separator
  const normalized = text.replace(/(\d),(\d)/g, '$1.$2');
  const lower = normalized.toLowerCase();

  const pollster = detectPollster(lower);
  const confidence = pollster !== null ? 85 : (
    /survei|polling|survey|kepuasan|approval/.test(lower) ? 50 : 25
  );

  // Patterns ordered strongest → weakest — NOTE: removed standalone `elektabilitas` to avoid
  // capres simulation polls (elektabilitas capres 2029 ≠ kepuasan kinerja presiden)
  const patterns: RegExp[] = [
    /(?:kepuasan|approval|puas|approval rating|satisfaction)[^\d]*(\d{2,3}(?:\.\d)?)\s*%/i,
    /prabowo[^\d]{0,30}(\d{2,3}(?:\.\d)?)\s*%[^\d]{0,40}(?:puas|approv|survei|poltracking|lsi|kepuasan)/i,
    /(\d{2,3}(?:\.\d)?)\s*%[^\d]{0,30}(?:kepuasan|puas|approv)/i,
    /presiden[^\d]{0,20}(\d{2,3}(?:\.\d)?)\s*%[^\d]{0,30}(?:puas|kepuas|approv)/i,
  ];

  for (const pat of patterns) {
    const m = normalized.match(pat);
    if (m) {
      const val = parseFloat(m[1]!);
      if (val >= APPROVAL_MIN && val <= APPROVAL_MAX) {
        const window = normalized.slice(Math.max(0, (m.index ?? 0) - 120), (m.index ?? 0) + 120);
        if (isElectabilityContext(window)) continue; // capres simulation — skip
        return { pct: val, pollster, confidence };
      }
    }
  }
  return null;
}

// Collect all survey readings from a block of text (for multi-survey median)
function parseAllApprovals(text: string): ParseResult[] {
  const results: ParseResult[] = [];
  const seen = new Set<number>();

  for (const pat of [
    /(?:kepuasan|approval|satisfaction)[^\d]*(\d{2,3}(?:\.\d)?)\s*%/gi,
    /(\d{2,3}(?:\.\d)?)\s*%[^\d]{0,30}(?:kepuasan|puas|approv)/gi,
  ]) {
    const normalized = text.replace(/(\d),(\d)/g, '$1.$2');
    for (const m of normalized.matchAll(pat)) {
      const val = parseFloat(m[1]!);
      if (val >= APPROVAL_MIN && val <= APPROVAL_MAX && !seen.has(val)) {
        const window = normalized.slice(Math.max(0, (m.index ?? 0) - 120), (m.index ?? 0) + 120);
        if (isElectabilityContext(window)) continue; // skip capres simulation
        seen.add(val);
        const pollster = detectPollster(window);
        const confidence = pollster !== null ? 85 : (/survei|polling|survey|kepuasan/.test(window.toLowerCase()) ? 50 : 25);
        results.push({ pct: val, pollster, confidence });
      }
    }
  }
  return results;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

// ── Exa fetch ────────────────────────────────────────────────────────────────

export async function fetchApprovalViaExa(
  lookbackDays = 45,
  targetMonth: string | null = null, // YYYY-MM, null = current month
): Promise<ApprovalPoint | null> {
  if (!process.env.EXASEARCH_API_KEY) return null;
  const monthStr = targetMonth ?? new Date().toISOString().slice(0, 7);
  const [year, mon] = monthStr.split('-');
  const monthName = new Date(`${monthStr}-01`).toLocaleString('id-ID', { month: 'long' });

  const startDate = new Date(Date.now() - lookbackDays * 86_400_000).toISOString().slice(0, 10);
  const queries = [
    `Prabowo kepuasan approval ${monthName} ${year} Poltracking LSI Indikator survei`,
    `survei elektabilitas Prabowo ${year} ${mon} Poltracking tingkat kepuasan`,
    `Prabowo approval rating ${monthStr} survey Indonesia political risk`,
  ];

  try {
    const { default: Exa } = await import('exa-js');
    const exa = new Exa(process.env.EXASEARCH_API_KEY);
    const allResults: ParseResult[] = [];
    const urls: string[] = [];

    for (const query of queries) {
      const resp = await exa.search(query, {
        numResults: 5,
        type: 'neural',
        startPublishedDate: startDate,
        contents: { text: { maxCharacters: 800 } },
      } as Parameters<typeof exa.search>[1]);
      for (const r of resp.results ?? []) {
        const text = ((r as { text?: string }).text ?? '') + ' ' + (r.title ?? '');
        const found = parseAllApprovals(text);
        if (found.length > 0) {
          allResults.push(...found);
          if (r.url) urls.push(r.url);
        }
      }
      if (allResults.length >= 3) break; // enough data
    }

    if (allResults.length === 0) return null;

    const approvalPct = parseFloat(median(allResults.map(r => r.pct)).toFixed(1));
    const pollsters = [...new Set(allResults.map(r => r.pollster).filter((p): p is Pollster => p !== null))];
    const confidence = Math.min(95, Math.round(allResults.reduce((s, r) => s + r.confidence, 0) / allResults.length));
    const sourceLabel = pollsters.length > 0 ? pollsters.join('+') : 'media_coverage';

    return {
      approvalPct,
      month: monthStr,
      pollsters,
      confidence,
      source: `exa:${sourceLabel}:${urls.slice(0, 2).join(',')}`,
      fetchedAt: new Date().toISOString(),
    };
  } catch { /* silent */ }
  return null;
}

// ── Tavily fetch ─────────────────────────────────────────────────────────────

export async function fetchApprovalViaTavily(
  targetMonth: string | null = null,
): Promise<ApprovalPoint | null> {
  if (!process.env.TAVILY_API_KEY) return null;
  const monthStr = targetMonth ?? new Date().toISOString().slice(0, 7);
  const [year, mon] = monthStr.split('-');
  const monthName = new Date(`${monthStr}-01`).toLocaleString('id-ID', { month: 'long' });

  try {
    const { TavilySearchAPIWrapper } = await import('@langchain/tavily');
    const tavily = new TavilySearchAPIWrapper({ tavilyApiKey: process.env.TAVILY_API_KEY });
    const resp = await tavily.rawResults({
      query: `Prabowo kepuasan survei ${monthName} ${year} Poltracking LSI Indikator tingkat approval`,
      max_results: 6,
      include_raw_content: false,
      time_range: 'month',
    } as Parameters<typeof tavily.rawResults>[0]);

    const allResults: ParseResult[] = [];
    const urls: string[] = [];
    for (const r of resp.results ?? []) {
      const text = (r.content ?? '') + ' ' + (r.title ?? '');
      const found = parseAllApprovals(text);
      if (found.length > 0) {
        allResults.push(...found);
        if (r.url) urls.push(r.url);
      }
    }
    if (allResults.length === 0) return null;

    const approvalPct = parseFloat(median(allResults.map(r => r.pct)).toFixed(1));
    const pollsters = [...new Set(allResults.map(r => r.pollster).filter((p): p is Pollster => p !== null))];
    const confidence = Math.min(90, Math.round(allResults.reduce((s, r) => s + r.confidence, 0) / allResults.length));
    const sourceLabel = pollsters.length > 0 ? pollsters.join('+') : 'media_coverage';

    void mon; // suppress unused var (used in query string)
    return {
      approvalPct,
      month: monthStr,
      pollsters,
      confidence,
      source: `tavily:${sourceLabel}:${urls.slice(0, 2).join(',')}`,
      fetchedAt: new Date().toISOString(),
    };
  } catch { /* silent */ }
  return null;
}

// ── DB helpers ───────────────────────────────────────────────────────────────

export async function storeApprovalPoint(point: ApprovalPoint): Promise<void> {
  await upsertPoints([{
    indicator: 'prabowo_approval_pct',
    category: 'sovereign' as const,
    date: `${point.month}-01`,
    value: point.approvalPct,
    unit: 'pct',
    source: point.source,
    fetchedAt: point.fetchedAt,
  }]);
}

// ── Main fetch ───────────────────────────────────────────────────────────────

/**
 * Fetch latest approval rating.
 * Priority: env override → DB cache (30d) → Exa → Tavily → null.
 */
export async function fetchLatestApprovalPoint(): Promise<ApprovalPoint | null> {
  const today = new Date().toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);
  const fetchedAt = new Date().toISOString();

  // Env override always wins
  if (process.env.PRABOWO_APPROVAL_PCT) {
    const val = parseFloat(process.env.PRABOWO_APPROVAL_PCT);
    if (!isNaN(val) && val >= APPROVAL_MIN && val <= APPROVAL_MAX) {
      return { approvalPct: val, month: currentMonth, pollsters: [], confidence: 100, source: 'env:PRABOWO_APPROVAL_PCT', fetchedAt };
    }
  }

  // DB freshness check
  const cached = await getLatestPoint('prabowo_approval_pct');
  if (cached) {
    const ageDays = (Date.now() - new Date(cached.fetchedAt ?? cached.date).getTime()) / 86_400_000;
    if (ageDays < FRESHNESS_DAYS) {
      return {
        approvalPct: cached.value,
        month: cached.date.slice(0, 7),
        pollsters: [],
        confidence: 80,
        source: cached.source,
        fetchedAt: cached.fetchedAt ?? cached.date,
      };
    }
  }

  const result = (await fetchApprovalViaExa()) ?? (await fetchApprovalViaTavily());
  if (result) {
    await storeApprovalPoint(result);
    return result;
  }
  return null;
}

// ── Time-series helpers ──────────────────────────────────────────────────────

/**
 * Get last N monthly approval points from DB.
 * Returns ASC (oldest first).
 */
export async function getApprovalSeries(n = 6): Promise<ApprovalPoint[]> {
  const rows = await getLastN('prabowo_approval_pct', n);
  return rows.map(r => ({
    approvalPct: r.value,
    month: r.date.slice(0, 7),
    pollsters: [],
    confidence: 80,
    source: r.source,
    fetchedAt: r.fetchedAt ?? r.date,
  }));
}

/**
 * Compute 3-month rolling median of approval ratings from DB.
 * Returns null if no data (caller uses env or default).
 */
export async function computeApproval3mMedian(): Promise<ApprovalSeries> {
  // Ensure latest point is fresh
  const latest = await fetchLatestApprovalPoint();
  const rows = await getLastN('prabowo_approval_pct', 6);

  if (rows.length === 0) {
    return { points: latest ? [{ approvalPct: latest.approvalPct, month: latest.month, pollsters: [], confidence: latest.confidence, source: latest.source, fetchedAt: latest.fetchedAt }] : [], avg3m: latest?.approvalPct ?? null, trend: null };
  }

  const recent3 = rows.slice(-3);
  const avg3m = parseFloat(median(recent3.map(r => r.value)).toFixed(1));

  // Trend: compare latest 3m median vs prior 3m median (if 6 points available)
  let trend: ApprovalSeries['trend'] = 'stable';
  if (rows.length >= 6) {
    const prior3 = rows.slice(-6, -3);
    const priorMedian = median(prior3.map(r => r.value));
    const delta = avg3m - priorMedian;
    trend = delta > 2 ? 'rising' : delta < -2 ? 'falling' : 'stable';
  } else if (rows.length >= 2) {
    const delta = rows[rows.length - 1]!.value - rows[0]!.value;
    trend = delta > 2 ? 'rising' : delta < -2 ? 'falling' : 'stable';
  }

  const points: ApprovalPoint[] = rows.map(r => ({
    approvalPct: r.value,
    month: r.date.slice(0, 7),
    pollsters: [],
    confidence: 80,
    source: r.source,
    fetchedAt: r.fetchedAt ?? r.date,
  }));

  return { points, avg3m, trend };
}
