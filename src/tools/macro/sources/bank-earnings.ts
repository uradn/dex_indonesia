/**
 * BBRI Bank Earnings — M8 bellwether quarterly signal.
 *
 * BBRI (IDX: BBRI) = largest bank by assets, most sensitive to credit cycle and
 * rural/MSME segment. Quarterly earnings lead OJK SPI aggregate by 30-45 days.
 *
 * Key metrics tracked:
 *   bbri_nim_pct       — Net Interest Margin %; compression = funding cost pressure
 *   bbri_npl_pct       — Non-Performing Loan %; leading credit deterioration signal
 *   bbri_loan_growth_pct — YoY loan growth; <5% = credit crunch / risk-off
 *   bbri_provisions_pct  — Provisions/total loans %; spike = forward NPL concern
 *
 * Score impact in M8:
 *   NIM < 5%:           +5 (compressed margins → funding stress)
 *   NPL > 3.5%:         +8 (credit deterioration above BI systemic threshold)
 *   Loan growth < 3%:   +5 (credit crunch signal)
 *   Provisions > 2%:    +6 (pre-emptive provisioning = expected NPL rise)
 *
 * Source: Exa/Tavily — BBRI quarterly earnings press release + IDX announcement.
 * Freshness: 95 days (quarterly cadence + 45d lag buffer).
 * Env override: BBRI_NIM_PCT / BBRI_NPL_PCT (always wins, DNDF pattern).
 *
 * Note: Does NOT replace OJK SPI banking aggregate. Complements as forward signal:
 * BBRI earnings (30-45d post quarter) > OJK SPI press release (~60d post quarter).
 */

import { getLatestPoint, upsertPoints } from '../time-series-db.js';

const FRESHNESS_DAYS = 95;
const EARNINGS_DOMAINS = [
  'bbri.co.id', 'idx.co.id', 'stockanalysis.com', 'brights.id',
  'cnbcindonesia.com', 'bisnis.com', 'kontan.co.id', 'bloombergtechnoz.com',
  'idnfinancials.com', 'antaranews.com',
];

export interface BbriEarningsData {
  nim_pct: number | null;
  npl_pct: number | null;
  loan_growth_pct: number | null;
  provisions_pct: number | null;
  date: string;
  source: string;
  quarter: string | null;
}

function parseEarningsText(text: string): Omit<BbriEarningsData, 'date' | 'source' | 'quarter'> {
  const t = text.toLowerCase();
  let nim_pct: number | null = null;
  let npl_pct: number | null = null;
  let loan_growth_pct: number | null = null;
  let provisions_pct: number | null = null;

  // NIM — "NIM... 7.2%" or "net interest margin 7.2" or "NIM sebesar 7,2%"
  const nimM = text.match(/\bnim\b[^0-9%]{0,30}(\d{1,2}[.,]\d{1,2})\s*%/i)
    ?? text.match(/net\s+interest\s+margin[^0-9%]{0,30}(\d{1,2}[.,]\d{1,2})/i)
    ?? text.match(/(\d{1,2}[.,]\d{1,2})\s*%[^0-9]{0,20}\bnim\b/i);
  if (nimM) {
    const v = parseFloat(nimM[1]!.replace(',', '.'));
    if (v >= 2 && v <= 15) nim_pct = v;
  }

  // NPL gross — "NPL... 2.1%" — reject if following "net" (want gross)
  const nplM = text.match(/\bnpl\b(?!\s+net)[^0-9%]{0,30}(\d{1,2}[.,]\d{1,2})\s*%/i)
    ?? text.match(/non.?performing[^0-9%]{0,30}(\d{1,2}[.,]\d{1,2})\s*%/i)
    ?? text.match(/kredit\s+bermasalah[^0-9%]{0,30}(\d{1,2}[.,]\d{1,2})\s*%/i);
  if (nplM) {
    const v = parseFloat(nplM[1]!.replace(',', '.'));
    if (v >= 0.5 && v <= 15) npl_pct = v;
  }

  // Loan/credit growth — "pertumbuhan kredit 12%" or "loan growth 12%"
  const loanM = text.match(/(?:loan|credit|kredit)\s+growth[^0-9%-]{0,30}(\d{1,2}[.,]\d?)\s*%/i)
    ?? text.match(/pertumbuhan\s+kredit[^0-9%]{0,30}(\d{1,2}[.,]\d?)\s*%/i)
    ?? text.match(/kredit[^0-9%]{0,30}tumbuh[^0-9%]{0,30}(\d{1,2}[.,]\d?)\s*%/i);
  if (loanM) {
    const v = parseFloat(loanM[1]!.replace(',', '.'));
    if (v >= -20 && v <= 50) loan_growth_pct = v;
  }

  // Provisions ratio — "provisions... 1.5%" or "CKPN... 1,5%"
  const provM = text.match(/(?:provision|ckpn|pencadangan)[^0-9%]{0,40}(\d{1,2}[.,]\d{1,2})\s*%/i)
    ?? text.match(/cost\s+of\s+credit[^0-9%]{0,30}(\d{1,2}[.,]\d{1,2})\s*%/i);
  if (provM) {
    const v = parseFloat(provM[1]!.replace(',', '.'));
    if (v >= 0.1 && v <= 10) provisions_pct = v;
  }

  return { nim_pct, npl_pct, loan_growth_pct, provisions_pct };
}

function detectQuarter(text: string): string | null {
  const m = text.match(/[Qq]([1-4])\s*(?:20)?2[0-9]/);
  if (m) {
    const qNum = m[1];
    const yrM = text.match(/20([0-9]{2})/);
    return yrM ? `Q${qNum} 20${yrM[1]}` : null;
  }
  return null;
}

async function fetchViaExa(): Promise<BbriEarningsData | null> {
  if (!process.env.EXASEARCH_API_KEY) return null;
  try {
    const { default: Exa } = await import('exa-js');
    const exa = new Exa(process.env.EXASEARCH_API_KEY);
    const startDate = new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10);
    const queries = [
      'BBRI Bank Rakyat Indonesia quarterly earnings NIM NPL 2026',
      'BBRI Q3 2026 results net interest margin non-performing loan',
      'BRI kinerja keuangan triwulan NIM kredit bermasalah 2026',
    ];
    for (const query of queries) {
      const resp = await exa.search(query, {
        numResults: 5,
        type: 'auto',
        startPublishedDate: startDate,
        includeDomains: EARNINGS_DOMAINS,
        contents: { text: { maxCharacters: 3000 } },
      } as Parameters<typeof exa.search>[1]);
      for (const r of resp.results ?? []) {
        const text = ((r as { text?: string }).text ?? '') + ' ' + (r.title ?? '');
        const parsed = parseEarningsText(text);
        if (parsed.nim_pct !== null || parsed.npl_pct !== null) {
          return {
            ...parsed,
            date: (r.publishedDate ?? new Date().toISOString()).slice(0, 10),
            source: 'exa_news:' + (r.url ?? query),
            quarter: detectQuarter(text),
          };
        }
      }
    }
  } catch { /* silent */ }
  return null;
}

async function fetchViaTavily(): Promise<BbriEarningsData | null> {
  if (!process.env.TAVILY_API_KEY) return null;
  try {
    const { TavilySearchAPIWrapper } = await import('@langchain/tavily');
    const tavily = new TavilySearchAPIWrapper({ tavilyApiKey: process.env.TAVILY_API_KEY });
    const resp = await tavily.rawResults({
      query: 'BBRI kinerja keuangan NIM NPL kredit Q3 2026 laporan keuangan',
      max_results: 5,
      include_domains: EARNINGS_DOMAINS,
      include_raw_content: false,
      time_range: 'month',
    } as Parameters<typeof tavily.rawResults>[0]);
    for (const r of resp.results ?? []) {
      const text = ((r as { raw_content?: string | null; content?: string | null }).raw_content ?? r.content ?? '') + ' ' + ((r as { title?: string }).title ?? '');
      const parsed = parseEarningsText(text);
      if (parsed.nim_pct !== null || parsed.npl_pct !== null) {
        return {
          ...parsed,
          date: new Date().toISOString().slice(0, 10),
          source: 'tavily:' + ((r as { url?: string }).url ?? ''),
          quarter: detectQuarter(text),
        };
      }
    }
  } catch { /* silent */ }
  return null;
}

/**
 * Fetch BBRI quarterly earnings metrics.
 * Priority: env override → DB cache (95d) → Exa → Tavily.
 */
export async function fetchBbriEarnings(): Promise<BbriEarningsData | null> {
  const today = new Date().toISOString().slice(0, 10);
  const fetchedAt = new Date().toISOString();

  // Env overrides (DNDF pattern)
  const envNim = process.env.BBRI_NIM_PCT ? parseFloat(process.env.BBRI_NIM_PCT) : null;
  const envNpl = process.env.BBRI_NPL_PCT ? parseFloat(process.env.BBRI_NPL_PCT) : null;
  if (envNim !== null && !isNaN(envNim)) {
    const result: BbriEarningsData = {
      nim_pct: envNim, npl_pct: envNpl, loan_growth_pct: null, provisions_pct: null,
      date: today, source: 'env_manual', quarter: null,
    };
    await upsertBbri(result, fetchedAt);
    return result;
  }

  // DB freshness check
  const cached = await getLatestPoint('bbri_nim_pct');
  if (cached) {
    const ageDays = (Date.now() - new Date(cached.date).getTime()) / 86_400_000;
    if (ageDays < FRESHNESS_DAYS) {
      const nplCached = await getLatestPoint('bbri_npl_pct');
      const loanCached = await getLatestPoint('bbri_loan_growth_pct');
      const provCached = await getLatestPoint('bbri_provisions_pct');
      return {
        nim_pct: cached.value,
        npl_pct: nplCached?.value ?? null,
        loan_growth_pct: loanCached?.value ?? null,
        provisions_pct: provCached?.value ?? null,
        date: cached.date,
        source: cached.source,
        quarter: null,
      };
    }
  }

  const result = (await fetchViaExa()) ?? (await fetchViaTavily());
  if (result) {
    await upsertBbri(result, fetchedAt);
    return result;
  }

  if (cached) {
    const nplCached = await getLatestPoint('bbri_npl_pct');
    return {
      nim_pct: cached.value, npl_pct: nplCached?.value ?? null,
      loan_growth_pct: null, provisions_pct: null,
      date: cached.date, source: cached.source + ':stale', quarter: null,
    };
  }
  return null;
}

async function upsertBbri(r: BbriEarningsData, fetchedAt: string): Promise<void> {
  const pts = [];
  if (r.nim_pct !== null) pts.push({ indicator: 'bbri_nim_pct', category: 'banking' as const, date: r.date, value: r.nim_pct, unit: '%', source: r.source, fetchedAt });
  if (r.npl_pct !== null) pts.push({ indicator: 'bbri_npl_pct', category: 'banking' as const, date: r.date, value: r.npl_pct, unit: '%', source: r.source, fetchedAt });
  if (r.loan_growth_pct !== null) pts.push({ indicator: 'bbri_loan_growth_pct', category: 'banking' as const, date: r.date, value: r.loan_growth_pct, unit: '%', source: r.source, fetchedAt });
  if (r.provisions_pct !== null) pts.push({ indicator: 'bbri_provisions_pct', category: 'banking' as const, date: r.date, value: r.provisions_pct, unit: '%', source: r.source, fetchedAt });
  if (pts.length > 0) await upsertPoints(pts);
}

/** Score contribution to M8 (0–24 pts). */
export function scoreBbriEarnings(d: BbriEarningsData): { score: number; flags: string[] } {
  let score = 0;
  const flags: string[] = [];
  if (d.nim_pct !== null && d.nim_pct < 5) {
    score += 5;
    flags.push(`BBRI NIM ${d.nim_pct.toFixed(2)}% — compressed margins; funding cost rising (+5)`);
  }
  if (d.npl_pct !== null && d.npl_pct > 3.5) {
    score += 8;
    flags.push(`BBRI NPL ${d.npl_pct.toFixed(2)}% — above BI systemic threshold 3.5%; credit cycle deteriorating (+8)`);
  } else if (d.npl_pct !== null && d.npl_pct > 2.5) {
    score += 4;
    flags.push(`BBRI NPL ${d.npl_pct.toFixed(2)}% — elevated; watch for BI systemic threshold (+4)`);
  }
  if (d.loan_growth_pct !== null && d.loan_growth_pct < 3) {
    score += 5;
    flags.push(`BBRI loan growth ${d.loan_growth_pct.toFixed(1)}% YoY — credit crunch signal (<3% threshold) (+5)`);
  }
  if (d.provisions_pct !== null && d.provisions_pct > 2) {
    score += 6;
    flags.push(`BBRI provisions ${d.provisions_pct.toFixed(2)}% — elevated forward provisioning; expected NPL rise (+6)`);
  }
  return { score: Math.min(24, score), flags };
}
