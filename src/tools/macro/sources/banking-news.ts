/**
 * Banking KPI news-scrape fallback when OJK SPI Playwright fails.
 *
 * OJK publishes Statistik Perbankan Indonesia (SPI) monthly via two portals:
 *   - Legacy: ojk.go.id (JS-heavy, Excel link stuck at June 2025 max)
 *   - New:    data.ojk.go.id/SJKPublic (DevExtreme SPA, WAF-blocked from plain HTTPS)
 *
 * Both auto-fetch paths break in current environments. OJK also publishes a monthly
 * press release ("Komite Stabilitas Sistem Keuangan" / "Rapat Dewan Komisioner")
 * quoting NPL gross, CAR, LDR. Bisnis, CNBC Indonesia, Kontan recap within ~1 week.
 *
 * 35-day freshness gate (monthly cadence).
 *
 * DB indicators: bank_npl_gross_pct, bank_car_pct, bank_ldr_pct
 */
import { getLatestPoint, upsertPoints } from '../time-series-db.js';
import type { MacroDataPoint } from '../types.js';

const FRESHNESS_DAYS = 35;

const DOMAINS = [
  'ojk.go.id', 'bisnis.com', 'kontan.co.id', 'cnbcindonesia.com',
  'katadata.co.id', 'detik.com', 'investor.id', 'idnfinancials.com',
  'idxchannel.com', 'tempo.co', 'tribunnews.com', 'antaranews.com',
  'kompas.com', 'liputan6.com', 'medcom.id', 'sindonews.com',
];

const QUERIES = [
  'OJK NPL gross perbankan Indonesia persen bulanan rasio kredit bermasalah',
  'OJK CAR rasio kecukupan modal bank umum persen',
  'OJK LDR loan to deposit ratio perbankan Indonesia persen',
  'OJK SPI Statistik Perbankan Indonesia NPL CAR LDR bulanan terbaru',
  'OJK Komite Stabilitas Sistem Keuangan rasio NPL CAR LDR triwulan',
  'Indonesia banking NPL CAR LDR ratio monthly OJK percent latest',
];

function parseIdNumber(s: string): number | null {
  const cleaned = s.replace(/\./g, '').replace(',', '.');
  const v = parseFloat(cleaned);
  return isNaN(v) ? null : v;
}

// Patterns capture the indicator → value within 80 chars. Sanity ranges reject
// values likely matching other percentages (deposit growth, credit growth).
function parseNpl(text: string): number | null {
  const patterns: RegExp[] = [
    /NPL\s*gross[\s\S]{0,40}?([\d.,]+)\s*%/i,
    /(?:rasio\s+)?NPL\s+(?:gross\s+)?(?:perbankan|bank umum|tercatat)[\s\S]{0,60}?([\d.,]+)\s*%/i,
    /kredit\s+bermasalah[\s\S]{0,60}?([\d.,]+)\s*%/i,
    /([\d.,]+)\s*%[\s\S]{0,30}?NPL\s*gross/i,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m?.[1]) {
      const v = parseIdNumber(m[1]);
      if (v !== null && v >= 0.5 && v <= 12) return v;
    }
  }
  return null;
}

function parseCar(text: string): number | null {
  const patterns: RegExp[] = [
    /CAR[\s\S]{0,40}?([\d.,]+)\s*%/i,
    /(?:rasio\s+)?kecukupan\s+modal[\s\S]{0,60}?([\d.,]+)\s*%/i,
    /capital\s+adequacy\s+ratio[\s\S]{0,40}?([\d.,]+)\s*%/i,
    /([\d.,]+)\s*%[\s\S]{0,30}?(?:CAR|kecukupan modal)/i,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m?.[1]) {
      const v = parseIdNumber(m[1]);
      if (v !== null && v >= 12 && v <= 35) return v;
    }
  }
  return null;
}

function parseLdr(text: string): number | null {
  const patterns: RegExp[] = [
    /LDR[\s\S]{0,40}?([\d.,]+)\s*%/i,
    /loan\s+to\s+deposit\s+ratio[\s\S]{0,40}?([\d.,]+)\s*%/i,
    /(?:rasio\s+)?(?:kredit\s+)?(?:terhadap|per)\s+dana[\s\S]{0,40}?([\d.,]+)\s*%/i,
    /([\d.,]+)\s*%[\s\S]{0,30}?LDR/i,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m?.[1]) {
      const v = parseIdNumber(m[1]);
      if (v !== null && v >= 60 && v <= 110) return v;
    }
  }
  return null;
}

interface KpiHit {
  npl?: number;
  car?: number;
  ldr?: number;
  sourceUrl?: string;
}

async function fetchViaExa(): Promise<KpiHit> {
  if (!process.env.EXASEARCH_API_KEY) return {};
  try {
    const { default: Exa } = await import('exa-js');
    const exa = new Exa(process.env.EXASEARCH_API_KEY);
    const startDate = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
    const hit: KpiHit = {};

    for (const query of QUERIES) {
      const response = await exa.search(query, {
        numResults: 5,
        type: 'auto',
        startPublishedDate: startDate,
        includeDomains: DOMAINS,
        contents: { text: { maxCharacters: 3000 } },
      } as Parameters<typeof exa.search>[1]).catch(() => null);
      if (!response) continue;

      for (const r of (response.results ?? [])) {
        const text = (r as { text?: string }).text ?? r.title ?? '';
        if (!text) continue;
        if (hit.npl == null) { const v = parseNpl(text); if (v != null) { hit.npl = v; hit.sourceUrl = r.url ?? hit.sourceUrl; } }
        if (hit.car == null) { const v = parseCar(text); if (v != null) { hit.car = v; hit.sourceUrl = r.url ?? hit.sourceUrl; } }
        if (hit.ldr == null) { const v = parseLdr(text); if (v != null) { hit.ldr = v; hit.sourceUrl = r.url ?? hit.sourceUrl; } }
        if (hit.npl != null && hit.car != null && hit.ldr != null) return hit;
      }
    }
    return hit;
  } catch {
    return {};
  }
}

async function fetchViaTavily(): Promise<KpiHit> {
  if (!process.env.TAVILY_API_KEY) return {};
  try {
    const { TavilySearchAPIWrapper } = await import('@langchain/tavily');
    const tavily = new TavilySearchAPIWrapper({ tavilyApiKey: process.env.TAVILY_API_KEY });
    const hit: KpiHit = {};

    for (const query of QUERIES) {
      const response = await tavily.rawResults({
        query,
        max_results: 5,
        include_domains: DOMAINS,
        include_raw_content: true,
        time_range: 'month',
      } as Parameters<typeof tavily.rawResults>[0]).catch(() => null);
      if (!response) continue;

      for (const r of (response.results ?? [])) {
        const text = (r.raw_content ?? r.content ?? '') as string;
        if (!text) continue;
        if (hit.npl == null) { const v = parseNpl(text); if (v != null) { hit.npl = v; hit.sourceUrl = r.url ?? hit.sourceUrl; } }
        if (hit.car == null) { const v = parseCar(text); if (v != null) { hit.car = v; hit.sourceUrl = r.url ?? hit.sourceUrl; } }
        if (hit.ldr == null) { const v = parseLdr(text); if (v != null) { hit.ldr = v; hit.sourceUrl = r.url ?? hit.sourceUrl; } }
        if (hit.npl != null && hit.car != null && hit.ldr != null) return hit;
      }
    }
    return hit;
  } catch {
    return {};
  }
}

/**
 * Returns {npl, ldr, car} as MacroDataPoints (any may be null). Fields populated
 * from news only when value passes sanity range filter — never returns
 * wildly-out-of-band numbers from text parsing noise.
 */
export async function fetchBankingKpisNews(): Promise<{
  npl: MacroDataPoint | null;
  ldr: MacroDataPoint | null;
  car: MacroDataPoint | null;
}> {
  // Freshness gate: if any KPI is < 35d old in DB, skip news fetch (let DB serve).
  const [cachedNpl, cachedLdr, cachedCar] = await Promise.all([
    getLatestPoint('bank_npl_gross_pct'),
    getLatestPoint('bank_ldr_pct'),
    getLatestPoint('bank_car_pct'),
  ]);
  const ageDays = (p: { fetchedAt: string } | null) =>
    p ? (Date.now() - new Date(p.fetchedAt).getTime()) / 86_400_000 : Infinity;
  const minAge = Math.min(ageDays(cachedNpl), ageDays(cachedLdr), ageDays(cachedCar));
  if (minAge < FRESHNESS_DAYS) return { npl: null, ldr: null, car: null };

  const exaHit = await fetchViaExa();
  const tavilyHit = (exaHit.npl == null || exaHit.car == null || exaHit.ldr == null)
    ? await fetchViaTavily()
    : {} as KpiHit;
  const hit: KpiHit = {
    npl: exaHit.npl ?? tavilyHit.npl,
    car: exaHit.car ?? tavilyHit.car,
    ldr: exaHit.ldr ?? tavilyHit.ldr,
    sourceUrl: exaHit.sourceUrl ?? tavilyHit.sourceUrl,
  };

  const date = new Date().toISOString().slice(0, 10);
  const base = {
    category: 'banking' as const,
    date,
    unit: '%',
    source: hit.sourceUrl ?? 'exa_banking_news',
    fetchedAt: new Date().toISOString(),
  };
  const points: { npl: MacroDataPoint | null; ldr: MacroDataPoint | null; car: MacroDataPoint | null } = {
    npl: hit.npl != null ? { ...base, indicator: 'bank_npl_gross_pct', value: hit.npl } : null,
    ldr: hit.ldr != null ? { ...base, indicator: 'bank_ldr_pct', value: hit.ldr } : null,
    car: hit.car != null ? { ...base, indicator: 'bank_car_pct', value: hit.car } : null,
  };
  const toSave: MacroDataPoint[] = [];
  if (points.npl) toSave.push(points.npl);
  if (points.ldr) toSave.push(points.ldr);
  if (points.car) toSave.push(points.car);
  if (toSave.length > 0) await upsertPoints(toSave);
  return points;
}
