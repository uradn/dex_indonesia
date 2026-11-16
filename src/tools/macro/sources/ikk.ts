/**
 * IKK — Indeks Keyakinan Konsumen (BI Consumer Confidence Index).
 *
 * BI publishes IKK monthly (~10th of following month) via Survei Konsumen.
 * Two variants tracked:
 *   ikk_overall     — composite index (all income groups). Range 80–130. 100 = neutral.
 *   ikk_low_income  — pengeluaran <Rp2.5jt/month group. Leads political stress by 1-2 months.
 *                     LPEM FEB UI uses this as "perceived growth" proxy (Q3 2026: 107.4).
 *
 * Score impact in M11 Domestic Pressure:
 *   ikk_overall < 100:        +15 pts (pessimism zone — Reinhart-Rogoff demand cliff)
 *   ikk_overall 100-105:      +8 pts  (borderline; low-income stress likely)
 *   ikk_overall 105-115:      +3 pts  (mild concern)
 *   ikk_low_income < 105:     +5 pts  (additional — low-income group leads aggregate by 1-2mo)
 *   ikk_low_income < 100:     +10 pts (additional — alarm level; social contract under stress)
 *
 * Source priority:
 *   1. Env override (IKK_OVERALL / IKK_LOW_INCOME) — always wins (DNDF pattern)
 *   2. DB cache (35d freshness gate)
 *   3. Exa news search (BI press release, media coverage)
 *   4. Tavily fallback (bi.go.id / kontan / bisnis)
 *
 * DB indicators: ikk_overall (unit: index_100), ikk_low_income (unit: index_100)
 * Category: domestic_pressure. Freshness target: 35d.
 *
 * Future: BI SEKI Playwright scrape (bi.go.id/en/statistik/ekonomi-keuangan/seki/Default.aspx?seki=I1)
 * — deferred until BI website rendering is confirmed stable.
 */

import { getLatestPoint, upsertPoints } from '../time-series-db.js';

const FRESHNESS_DAYS = 35;
const IKK_DOMAINS = ['bi.go.id', 'kontan.co.id', 'bisnis.com', 'cnbcindonesia.com', 'katadata.co.id', 'antaranews.com'];

export interface IkkData {
  overall: number | null;
  lowIncome: number | null;
  date: string;
  source: string;
}

function parseIkkFromText(text: string): { overall: number | null; lowIncome: number | null } {
  let overall: number | null = null;
  let lowIncome: number | null = null;

  // IKK overall — BI survey prose: "Indeks Keyakinan Konsumen... sebesar 117,8"
  const overallPatterns = [
    /indeks\s+keyakinan\s+konsumen[^0-9]{0,60}(\d{2,3}[.,]\d)/i,
    /IKK[^0-9]{0,40}(\d{2,3}[.,]\d)/i,
    /keyakinan\s+konsumen[^0-9]{0,60}(\d{2,3}[.,]\d)/i,
    /consumer\s+confidence[^0-9]{0,60}(\d{2,3}[.,]\d)/i,
  ];
  for (const p of overallPatterns) {
    const m = text.match(p);
    if (m) {
      const v = parseFloat(m[1]!.replace(',', '.'));
      if (v >= 60 && v <= 160) { overall = v; break; }
    }
  }

  // IKK low-income — "pengeluaran di bawah Rp2.5 juta... 107,4" or "rendah... 107,4"
  const lowPatterns = [
    /(?:bawah|rendah|low.income|pengeluaran[^0-9]{0,20}2[.,]5)[^0-9]{0,60}(\d{2,3}[.,]\d)/i,
    /(?:kelompok\s+(?:bawah|rendah))[^0-9]{0,40}(\d{2,3}[.,]\d)/i,
  ];
  for (const p of lowPatterns) {
    const m = text.match(p);
    if (m) {
      const v = parseFloat(m[1]!.replace(',', '.'));
      if (v >= 60 && v <= 160) { lowIncome = v; break; }
    }
  }

  return { overall, lowIncome };
}

async function fetchViaExa(): Promise<IkkData | null> {
  if (!process.env.EXASEARCH_API_KEY) return null;
  try {
    const { default: Exa } = await import('exa-js');
    const exa = new Exa(process.env.EXASEARCH_API_KEY);
    const now = new Date();
    const curMonth = now.toLocaleString('id-ID', { month: 'long', year: 'numeric' });
    const startDate = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);
    const queries = [
      `indeks keyakinan konsumen BI survei konsumen ${curMonth}`,
      `IKK BI consumer confidence Indonesia ${curMonth}`,
      `survei konsumen Bank Indonesia keyakinan konsumen terbaru`,
    ];
    for (const query of queries) {
      const resp = await exa.search(query, {
        numResults: 5,
        type: 'auto',
        startPublishedDate: startDate,
        includeDomains: IKK_DOMAINS,
        contents: { text: { maxCharacters: 2000 } },
      } as Parameters<typeof exa.search>[1]);
      for (const r of resp.results ?? []) {
        const text = ((r as { text?: string }).text ?? '') + ' ' + (r.title ?? '');
        const parsed = parseIkkFromText(text);
        if (parsed.overall !== null) {
          return {
            overall: parsed.overall,
            lowIncome: parsed.lowIncome,
            date: (r.publishedDate ?? new Date().toISOString()).slice(0, 10),
            source: 'exa_news:' + (r.url ?? query),
          };
        }
      }
    }
  } catch { /* silent */ }
  return null;
}

async function fetchViaTavily(): Promise<IkkData | null> {
  if (!process.env.TAVILY_API_KEY) return null;
  try {
    const { TavilySearchAPIWrapper } = await import('@langchain/tavily');
    const tavily = new TavilySearchAPIWrapper({ tavilyApiKey: process.env.TAVILY_API_KEY });
    const resp = await tavily.rawResults({
      query: 'indeks keyakinan konsumen BI survei terbaru 2026',
      max_results: 5,
      include_domains: IKK_DOMAINS,
      include_raw_content: false,
      time_range: 'month',
    } as Parameters<typeof tavily.rawResults>[0]);
    for (const r of resp.results ?? []) {
      const text = ((r as { raw_content?: string | null; content?: string | null }).raw_content ?? r.content ?? '') + ' ' + ((r as { title?: string }).title ?? '');
      const parsed = parseIkkFromText(text);
      if (parsed.overall !== null) {
        return {
          overall: parsed.overall,
          lowIncome: parsed.lowIncome,
          date: new Date().toISOString().slice(0, 10),
          source: 'tavily:' + ((r as { url?: string }).url ?? ''),
        };
      }
    }
  } catch { /* silent */ }
  return null;
}

/**
 * Fetch IKK overall + low-income variant.
 * Priority: env override → DB cache (35d) → Exa → Tavily.
 */
export async function fetchIkk(): Promise<IkkData | null> {
  const today = new Date().toISOString().slice(0, 10);
  const fetchedAt = new Date().toISOString();

  // Env overrides — always win (DNDF pattern)
  const envOverall = process.env.IKK_OVERALL ? parseFloat(process.env.IKK_OVERALL) : null;
  const envLow = process.env.IKK_LOW_INCOME ? parseFloat(process.env.IKK_LOW_INCOME) : null;
  if (envOverall !== null && !isNaN(envOverall) && envOverall >= 60 && envOverall <= 160) {
    const pt: IkkData = { overall: envOverall, lowIncome: envLow, date: today, source: 'env_manual' };
    await upsertPoints([
      { indicator: 'ikk_overall', category: 'pangan', date: today, value: envOverall, unit: 'index_100', source: 'env_manual', fetchedAt },
      ...(envLow !== null && !isNaN(envLow) ? [{ indicator: 'ikk_low_income', category: 'pangan' as const, date: today, value: envLow, unit: 'index_100', source: 'env_manual', fetchedAt }] : []),
    ]);
    return pt;
  }

  // DB freshness check
  const cachedOverall = await getLatestPoint('ikk_overall');
  if (cachedOverall) {
    const ageDays = (Date.now() - new Date(cachedOverall.date).getTime()) / 86_400_000;
    if (ageDays < FRESHNESS_DAYS) {
      let cachedLow = await getLatestPoint('ikk_low_income');
      // Seed ikk_low_income from env override when Exa never found it
      if (cachedLow === null && envLow !== null && !isNaN(envLow) && envLow >= 60 && envLow <= 160) {
        await upsertPoints([{ indicator: 'ikk_low_income', category: 'pangan', date: cachedOverall.date, value: envLow, unit: 'index_100', source: 'env_manual', fetchedAt }]);
        cachedLow = { indicator: 'ikk_low_income', category: 'pangan', date: cachedOverall.date, value: envLow, unit: 'index_100', source: 'env_manual', fetchedAt };
      }
      return { overall: cachedOverall.value, lowIncome: cachedLow?.value ?? null, date: cachedOverall.date, source: cachedOverall.source };
    }
  }

  const result = (await fetchViaExa()) ?? (await fetchViaTavily());
  if (result) {
    const pts = [
      { indicator: 'ikk_overall', category: 'pangan' as const, date: result.date, value: result.overall!, unit: 'index_100', source: result.source, fetchedAt },
    ];
    // Prefer Exa low-income if found; fall back to env IKK_LOW_INCOME override.
    // IKK_LOW_INCOME env can be set independently of IKK_OVERALL (e.g. LPEM quarterly report
    // discloses low-income breakout that BI media articles don't include).
    const lowIncomeVal = result.lowIncome ?? (envLow !== null && !isNaN(envLow) && envLow >= 60 && envLow <= 160 ? envLow : null);
    if (lowIncomeVal !== null) {
      pts.push({ indicator: 'ikk_low_income', category: 'pangan' as const, date: result.date, value: lowIncomeVal, unit: 'index_100', source: result.lowIncome !== null ? result.source : 'env_manual', fetchedAt });
    }
    await upsertPoints(pts);
    return { ...result, lowIncome: lowIncomeVal };
  }

  if (cachedOverall) {
    const cachedLow = await getLatestPoint('ikk_low_income');
    // Seed ikk_low_income from env if DB still empty (Exa never found it)
    if (cachedLow === null && envLow !== null && !isNaN(envLow) && envLow >= 60 && envLow <= 160) {
      await upsertPoints([{ indicator: 'ikk_low_income', category: 'pangan', date: cachedOverall.date, value: envLow, unit: 'index_100', source: 'env_manual', fetchedAt }]);
      return { overall: cachedOverall.value, lowIncome: envLow, date: cachedOverall.date, source: cachedOverall.source };
    }
    return { overall: cachedOverall.value, lowIncome: cachedLow?.value ?? null, date: cachedOverall.date, source: cachedOverall.source + ':stale' };
  }
  return null;
}

/** Score contribution to M11 (0–25 pts). */
export function scoreIkk(overall: number, lowIncome: number | null): number {
  let pts = 0;
  if (overall < 100) pts += 15;
  else if (overall < 105) pts += 8;
  else if (overall < 115) pts += 3;
  if (lowIncome !== null) {
    if (lowIncome < 100) pts += 10;
    else if (lowIncome < 105) pts += 5;
  }
  return Math.min(25, pts);
}
