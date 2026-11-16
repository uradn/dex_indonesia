/**
 * BPS Sakernas — National Labor Force Survey (Survei Angkatan Kerja Nasional).
 *
 * Published bi-annually: February (Feb survey) + August (Aug survey), ~2 weeks after survey.
 * Key indicator: informal_employment_pct — % of total workforce in informal sector.
 *
 * Indonesia structural range: 55-62% informal. Signal is about TREND not level:
 *   Rising informal (↑ YoY) = formal job destruction → social contract stress
 *   Falling informal (↓ YoY) = structural formalization → stability signal
 *
 * Score impact in M12 Political Risk (via social contract):
 *   informal > 62%:   +8 (formal sector destruction accelerating)
 *   informal > 60%:   +4 (above trend ceiling)
 *   YoY rise > 1pp:   +4 (deterioration signal even if level low)
 *
 * Source priority:
 *   1. BPS WebAPI v1 (domain 0000, subject 'ketenagakerjaan') — if BPS_API_KEY set
 *      NOTE: trade vars confirmed dead; Sakernas vars may also fail — Exa is reliable fallback
 *   2. Exa news (BPS siaran pers coverage, media)
 *   3. Tavily fallback
 *
 * DB indicator: informal_employment_pct (unit: %, category: pangan)
 * Freshness: 180d (bi-annual; allow full 6-month window before stale)
 * Env override: INFORMAL_EMPLOYMENT_PCT (always wins, DNDF pattern)
 */

import { getLatestPoint, getLastN, upsertPoints } from '../time-series-db.js';

const FRESHNESS_DAYS = 180;
const SAKERNAS_DOMAINS = [
  'bps.go.id', 'cnbcindonesia.com', 'bisnis.com', 'kontan.co.id',
  'antaranews.com', 'katadata.co.id', 'detik.com', 'tempo.co',
];

export interface SakernasData {
  value: number;
  date: string;
  source: string;
}

function parseInformalPct(text: string): number | null {
  const t = text.toLowerCase();
  // Must be about labor/employment, not other context
  if (!/(tenaga kerja|angkatan kerja|informal|sakernas|pekerja|employment|workforce)/i.test(t)) return null;

  // Patterns: "sektor informal... 59,17%", "informal employment... 59.17%",
  //           "pekerja informal... 59,17 persen", "59,17% bekerja di sektor informal"
  const patterns = [
    /(?:sektor\s+informal|informal\s+sector|pekerja\s+informal|informal\s+employment)[^0-9%]{0,60}(\d{2}[.,]\d{1,2})\s*(?:%|persen)/i,
    /(\d{2}[.,]\d{1,2})\s*(?:%|persen)[^0-9%]{0,60}(?:sektor\s+informal|bekerja\s+di\s+sektor\s+informal)/i,
    /(?:informal|tidak\s+formal)[^0-9%]{0,80}(\d{2}[.,]\d{1,2})\s*(?:%|persen)/i,
  ];

  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const v = parseFloat(m[1]!.replace(',', '.'));
      if (v >= 40 && v <= 80) return v;
    }
  }
  return null;
}

function parseSurveyDate(text: string): string {
  const m = text.match(/(?:agustus|februari|august|february)\s+(202[0-9])/i);
  if (m) {
    const year = parseInt(m[1]);
    const month = /agustus|august/i.test(m[0]) ? 8 : 2;
    return `${year}-${String(month).padStart(2, '0')}-01`;
  }
  return new Date().toISOString().slice(0, 10);
}

async function fetchViaBpsApi(): Promise<SakernasData | null> {
  if (!process.env.BPS_API_KEY) return null;
  // BPS WebAPI v1 — Sakernas labor vars. Var IDs to try (may be broken like trade vars):
  //   529: pekerja informal %, domain 0000
  //   530: employment by sector
  // If all fail silently → Exa fallback activates.
  const key = process.env.BPS_API_KEY;
  const varIds = ['529', '530'];
  for (const varId of varIds) {
    try {
      const url = `https://webapi.bps.go.id/v1/api/list/model/data/lang/ind/domain/0000/var/${varId}/key/${key}`;
      const { fetchJsonWithBrowser } = await import('./playwright-browser.js');
      const json = await fetchJsonWithBrowser(url);
      if (json && typeof json === 'object' && (json as { status?: number }).status === 200) {
        const data = (json as { data?: Array<{ val?: number; period?: string }> }).data ?? [];
        const latest = data[data.length - 1];
        if (latest?.val && latest.val >= 40 && latest.val <= 80) {
          return {
            value: latest.val,
            date: latest.period ? latest.period + '-01' : new Date().toISOString().slice(0, 10),
            source: `bps_webapi_var${varId}`,
          };
        }
      }
    } catch { /* try next var */ }
  }
  return null;
}

async function fetchViaExa(): Promise<SakernasData | null> {
  if (!process.env.EXASEARCH_API_KEY) return null;
  try {
    const { default: Exa } = await import('exa-js');
    const exa = new Exa(process.env.EXASEARCH_API_KEY);
    const startDate = new Date(Date.now() - 200 * 86_400_000).toISOString().slice(0, 10);
    const queries = [
      'BPS Sakernas pekerja informal persen agustus 2026 survei ketenagakerjaan',
      'BPS Indonesia informal employment percent 2026 labor force survey',
      'BPS angkatan kerja pekerja sektor informal persen 2026',
    ];
    for (const query of queries) {
      const resp = await exa.search(query, {
        numResults: 5,
        type: 'auto',
        startPublishedDate: startDate,
        includeDomains: SAKERNAS_DOMAINS,
        contents: { text: { maxCharacters: 2000 } },
      } as Parameters<typeof exa.search>[1]);
      for (const r of resp.results ?? []) {
        const text = ((r as { text?: string }).text ?? '') + ' ' + (r.title ?? '');
        const val = parseInformalPct(text);
        if (val !== null) {
          return {
            value: val,
            date: parseSurveyDate(text),
            source: 'exa_news:' + (r.url ?? query),
          };
        }
      }
    }
  } catch { /* silent */ }
  return null;
}

async function fetchViaTavily(): Promise<SakernasData | null> {
  if (!process.env.TAVILY_API_KEY) return null;
  try {
    const { TavilySearchAPIWrapper } = await import('@langchain/tavily');
    const tavily = new TavilySearchAPIWrapper({ tavilyApiKey: process.env.TAVILY_API_KEY });
    const resp = await tavily.rawResults({
      query: 'BPS Sakernas pekerja informal persen 2026',
      max_results: 5,
      include_domains: SAKERNAS_DOMAINS,
      include_raw_content: false,
      time_range: 'year',
    } as Parameters<typeof tavily.rawResults>[0]);
    for (const r of resp.results ?? []) {
      const text = ((r as { raw_content?: string | null; content?: string | null }).raw_content ?? r.content ?? '') + ' ' + ((r as { title?: string }).title ?? '');
      const val = parseInformalPct(text);
      if (val !== null) {
        return {
          value: val,
          date: parseSurveyDate(text),
          source: 'tavily:' + ((r as { url?: string }).url ?? ''),
        };
      }
    }
  } catch { /* silent */ }
  return null;
}

/**
 * Fetch Sakernas informal employment %.
 * Priority: env override → DB cache (180d) → BPS WebAPI → Exa → Tavily.
 */
export async function fetchSakernas(): Promise<SakernasData | null> {
  const today = new Date().toISOString().slice(0, 10);
  const fetchedAt = new Date().toISOString();

  const envVal = process.env.INFORMAL_EMPLOYMENT_PCT ? parseFloat(process.env.INFORMAL_EMPLOYMENT_PCT) : null;
  if (envVal !== null && !isNaN(envVal) && envVal >= 40 && envVal <= 80) {
    await upsertPoints([{ indicator: 'informal_employment_pct', category: 'pangan', date: today, value: envVal, unit: '%', source: 'env_manual', fetchedAt }]);
    return { value: envVal, date: today, source: 'env_manual' };
  }

  const cached = await getLatestPoint('informal_employment_pct');
  if (cached) {
    const ageDays = (Date.now() - new Date(cached.date).getTime()) / 86_400_000;
    if (ageDays < FRESHNESS_DAYS) return { value: cached.value, date: cached.date, source: cached.source };
  }

  const result = (await fetchViaBpsApi()) ?? (await fetchViaExa()) ?? (await fetchViaTavily());
  if (result) {
    await upsertPoints([{ indicator: 'informal_employment_pct', category: 'pangan', date: result.date, value: result.value, unit: '%', source: result.source, fetchedAt }]);
    return result;
  }

  if (cached) return { value: cached.value, date: cached.date, source: cached.source + ':stale' };
  return null;
}

/** Score contribution to M12 (0–12 pts). */
export async function scoreSakernas(current: number): Promise<{ score: number; flag: string | null }> {
  let score = 0;
  let flag: string | null = null;

  const history = await getLastN('informal_employment_pct', 4);
  const prevYear = history.length >= 2 ? history[history.length - 2]?.value ?? null : null;
  const yoyChange = prevYear !== null ? current - prevYear : null;

  if (current > 62) {
    score += 8;
    flag = `Informal employment ${current.toFixed(1)}% — formal sector destruction >62% threshold; social contract stress elevated (+8)`;
  } else if (current > 60) {
    score += 4;
    flag = `Informal employment ${current.toFixed(1)}% — above 60% trend ceiling; labor market formalization stalled (+4)`;
  }

  if (yoyChange !== null && yoyChange > 1) {
    score += 4;
    const extra = `YoY +${yoyChange.toFixed(1)}pp deterioration`;
    flag = flag ? flag + ` [${extra}]` : `Informal employment rising +${yoyChange.toFixed(1)}pp YoY — formal job destruction accelerating (+4)`;
  }

  return { score: Math.min(12, score), flag };
}
