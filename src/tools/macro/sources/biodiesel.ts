/**
 * Biodiesel B40→B50 mandate tracker.
 *
 * Jul 1 2026: B50 mandate scheduled (CPO blend 50% in diesel) per ESDM.
 * Reality check: 2026 biodiesel quota = 15.65M kL (≈ flat vs 2025); B50 would need
 * ~19M kL. Industry expects de-facto B45, not B50. Three macro impact channels:
 *
 *   1. CPO export volume diversion → BoP drain (CPO export $24.4bn basket).
 *   2. BPDPKS biodiesel subsidy realisasi up → fiscal drag (M10).
 *   3. CPO domestic shortage risk → minyak goreng spike (M11 food).
 *
 * DATA SOURCE:
 *   Exa/Tavily for ESDM/APROBI/BPDPKS quotes on mandate status, quota, subsidy.
 *   Indicators:
 *     b50_status_numeric          — 40 (B40), 45 (B45), 50 (B50)
 *     biodiesel_quota_kl_m        — annual quota (million kL)
 *     biodiesel_subsidy_ytd_idr_t — BPDPKS biodiesel insentif realisasi (Rp T YTD)
 */

import { getLatestPoint, upsertPoints } from '../time-series-db.js';
import type { MacroDataPoint } from '../types.js';

export const B50_MANDATE_DATE = '2026-07-01';
export const B50_FEEDSTOCK_REQUIRED_MT = 18.0; // million metric tons CPO
export const BIODIESEL_CAPACITY_KL_M = 19.6;   // installed capacity million kL

const FRESHNESS_DAYS = 14;

const DOMAINS = [
  'esdm.go.id', 'bpdpks.id', 'aprobi.or.id',
  'cnbcindonesia.com', 'bisnis.com', 'kontan.co.id',
  'detik.com', 'tempo.co', 'antaranews.com', 'katadata.co.id',
];

const QUERY = 'Indonesia biodiesel B50 mandat CPO kuota juta kiloliter ESDM APROBI 2026';

function parseIdNumber(s: string): number | null {
  const cleaned = s.replace(/\./g, '').replace(',', '.');
  const v = parseFloat(cleaned);
  return isNaN(v) ? null : v;
}

function matchNum(text: string, range: [number, number], ...patterns: RegExp[]): number | null {
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m?.[1]) {
      const v = parseIdNumber(m[1]);
      if (v !== null && v >= range[0] && v <= range[1]) return v;
    }
  }
  return null;
}

interface BiodieselRaw {
  b50StatusNumeric: number | null;     // 40, 45, or 50
  quotaKlM: number | null;
  subsidyYtdIdrT: number | null;
}

function parseBiodieselText(text: string): BiodieselRaw {
  // B50/B45/B40 status — look for explicit mandate language
  let b50StatusNumeric: number | null = null;
  if (/(?:mandat|implementasi|berlaku|wajib|diterapkan)[\s\S]{0,80}?\bB50\b/i.test(text)
    || /\bB50\b[\s\S]{0,80}?(?:mulai|efektif|berlaku)/i.test(text)) b50StatusNumeric = 50;
  else if (/(?:mandat|implementasi|berlaku|wajib|diterapkan)[\s\S]{0,80}?\bB45\b/i.test(text)
    || /\bB45\b[\s\S]{0,80}?(?:mulai|efektif|berlaku)/i.test(text)) b50StatusNumeric = 45;
  else if (/(?:mandat|implementasi|berlaku|wajib|diterapkan)[\s\S]{0,80}?\bB40\b/i.test(text)
    || /\bB40\b[\s\S]{0,80}?(?:mulai|efektif|berlaku)/i.test(text)) b50StatusNumeric = 40;

  const quotaKlM = matchNum(
    text,
    [5, 30],
    /kuota\s+biodiesel[\s\S]{0,80}?([\d.,]+)\s*(?:juta\s+kl|juta\s+kiloliter)/i,
    /([\d.,]+)\s*(?:juta\s+kl|juta\s+kiloliter)[\s\S]{0,40}?biodiesel/i,
    /biodiesel\s+quota[\s\S]{0,60}?([\d.]+)\s*million\s*(?:kl|kiloliters)/i,
  );

  const subsidyYtdIdrT = matchNum(
    text,
    [0, 80],
    /insentif\s+biodiesel[\s\S]{0,80}?Rp\s*([\d.,]+)\s*triliun/i,
    /subsidi\s+biodiesel[\s\S]{0,80}?Rp\s*([\d.,]+)\s*triliun/i,
    /BPDPKS[\s\S]{0,120}?biodiesel[\s\S]{0,80}?Rp\s*([\d.,]+)\s*triliun/i,
  );

  return { b50StatusNumeric, quotaKlM, subsidyYtdIdrT };
}

async function fetchViaExa(): Promise<BiodieselRaw | null> {
  if (!process.env.EXASEARCH_API_KEY) return null;
  try {
    const { default: Exa } = await import('exa-js');
    const exa = new Exa(process.env.EXASEARCH_API_KEY);
    const startDate = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);

    const response = await exa.search(QUERY, {
      numResults: 4,
      type: 'auto',
      startPublishedDate: startDate,
      includeDomains: DOMAINS,
      contents: { text: { maxCharacters: 2500 } },
    } as Parameters<typeof exa.search>[1]);

    let best: BiodieselRaw = { b50StatusNumeric: null, quotaKlM: null, subsidyYtdIdrT: null };
    for (const r of (response.results ?? [])) {
      const text = (r as { text?: string }).text ?? r.title ?? '';
      if (!text) continue;
      const parsed = parseBiodieselText(text);
      best.b50StatusNumeric = best.b50StatusNumeric ?? parsed.b50StatusNumeric;
      best.quotaKlM = best.quotaKlM ?? parsed.quotaKlM;
      best.subsidyYtdIdrT = best.subsidyYtdIdrT ?? parsed.subsidyYtdIdrT;
    }
    return (best.b50StatusNumeric ?? best.quotaKlM ?? best.subsidyYtdIdrT) !== null ? best : null;
  } catch {
    return null;
  }
}

async function fetchViaTavily(): Promise<BiodieselRaw | null> {
  if (!process.env.TAVILY_API_KEY) return null;
  try {
    const { TavilySearchAPIWrapper } = await import('@langchain/tavily');
    const tavily = new TavilySearchAPIWrapper({ tavilyApiKey: process.env.TAVILY_API_KEY });

    const response = await tavily.rawResults({
      query: QUERY,
      max_results: 4,
      include_domains: DOMAINS,
      include_raw_content: true,
      time_range: 'month',
    } as Parameters<typeof tavily.rawResults>[0]);

    let best: BiodieselRaw = { b50StatusNumeric: null, quotaKlM: null, subsidyYtdIdrT: null };
    for (const r of (response.results ?? [])) {
      const text = (r.raw_content ?? r.content ?? '') as string;
      if (!text) continue;
      const parsed = parseBiodieselText(text);
      best.b50StatusNumeric = best.b50StatusNumeric ?? parsed.b50StatusNumeric;
      best.quotaKlM = best.quotaKlM ?? parsed.quotaKlM;
      best.subsidyYtdIdrT = best.subsidyYtdIdrT ?? parsed.subsidyYtdIdrT;
    }
    return (best.b50StatusNumeric ?? best.quotaKlM ?? best.subsidyYtdIdrT) !== null ? best : null;
  } catch {
    return null;
  }
}

export interface BiodieselData extends BiodieselRaw {
  date: string;
  fetchedAt: string;
}

export async function fetchBiodieselStatus(): Promise<BiodieselData | null> {
  const cached = await getLatestPoint('b50_status_numeric');
  if (cached) {
    const ageDays = (Date.now() - new Date(cached.fetchedAt).getTime()) / 86_400_000;
    if (ageDays < FRESHNESS_DAYS) {
      const [quota, subsidy] = await Promise.all([
        getLatestPoint('biodiesel_quota_kl_m'),
        getLatestPoint('biodiesel_subsidy_ytd_idr_t'),
      ]);
      return {
        date: cached.date,
        b50StatusNumeric: cached.value,
        quotaKlM: quota?.value ?? null,
        subsidyYtdIdrT: subsidy?.value ?? null,
        fetchedAt: cached.fetchedAt,
      };
    }
  }

  const raw = (await fetchViaExa()) ?? (await fetchViaTavily());
  if (!raw) return null;

  const date = new Date().toISOString().slice(0, 10);
  const fetchedAt = new Date().toISOString();
  const points: MacroDataPoint[] = [];

  if (raw.b50StatusNumeric !== null) {
    points.push({
      indicator: 'b50_status_numeric',
      category: 'commodity', date, value: raw.b50StatusNumeric,
      unit: 'B_blend_pct', source: 'exa_biodiesel', fetchedAt,
    });
  }
  if (raw.quotaKlM !== null) {
    points.push({
      indicator: 'biodiesel_quota_kl_m',
      category: 'commodity', date, value: raw.quotaKlM,
      unit: 'million_kl', source: 'exa_biodiesel', fetchedAt,
    });
  }
  if (raw.subsidyYtdIdrT !== null) {
    points.push({
      indicator: 'biodiesel_subsidy_ytd_idr_t',
      category: 'sovereign', date, value: raw.subsidyYtdIdrT,
      unit: 'IDR_trn', source: 'exa_biodiesel', fetchedAt,
    });
  }
  if (points.length > 0) await upsertPoints(points);

  return { ...raw, date, fetchedAt };
}
