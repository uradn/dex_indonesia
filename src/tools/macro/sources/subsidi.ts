/**
 * Indonesia subsidi realisasi feed — APBN Kita monthly reports via Exa (primary) or Tavily (fallback).
 *
 * Tracks cumulative YTD realization of energy subsidies (BBM+LPG) and fertilizer subsidies
 * vs APBN 2026 annual targets.
 *
 * WHY SUBSIDI RUN RATE MATTERS:
 *   High oil price + weak IDR → subsidi BBM+LPG cost overshoots APBN assumption ($70/bbl, Rp16,500)
 *   Overshoot → fiscal pressure → either hike BBM (social unrest) or blow deficit past 3% GDP
 *   M10 gets early warning of subsidy blowout before it appears in Kemenkeu deficit figures.
 *   Pupuk subsidi overshoot = similar dynamic (LNG feedstock price-linked).
 *
 * APBN 2026 targets (hardcoded — UU No.17/2025):
 *   Subsidi BBM+LPG (energi): ~Rp87T
 *   Subsidi pupuk:             ~Rp46.8T
 *
 * TOKEN EFFICIENCY:
 *   Exa: numResults=3, maxCharacters=2500 → ~2000 tokens total. No Playwright.
 *   Tavily fallback: max_results=3, include_raw_content=true → ~1500 tokens.
 *   30-day freshness gate: APBN Kita released ~monthly; re-fetch only when stale.
 */

import { getLatestPoint, upsertPoints } from '../time-series-db.js';
import type { MacroDataPoint } from '../types.js';

export interface SubsidiData {
  date: string;
  subsidiBbmLpgYtdTrn: number | null;
  subsidiPupukYtdTrn: number | null;
  sourceUrl: string | null;
  fetchedAt: string;
}

const FRESHNESS_DAYS = 30;

/** Parse Indonesian number format: "87,5" → 87.5; "1.234,5" → 1234.5 */
function parseIdNumber(s: string): number | null {
  const cleaned = s.replace(/\./g, '').replace(',', '.');
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

function parseSubsidiText(text: string): Pick<SubsidiData, 'subsidiBbmLpgYtdTrn' | 'subsidiPupukYtdTrn'> {
  // Indonesian realisasi numbers appear as "Rp87,5 triliun" or "Rp 87.5 triliun"
  // We want realisasi figures, not pagu/target figures.
  // Key phrase patterns: "realisasi subsidi energi", "subsidi BBM", "subsidi LPG"

  const matchNum = (t: string, ...pats: RegExp[]): number | null => {
    for (const pat of pats) {
      const m = t.match(pat);
      if (m?.[1]) {
        const v = parseIdNumber(m[1]);
        // Sanity: subsidi energi realisasi should be 0–300T range
        if (v !== null && v > 0 && v < 500) return v;
      }
    }
    return null;
  };

  // Subsidi energi / BBM+LPG — look for realisasi context first
  const subsidiBbmLpgYtdTrn = matchNum(text,
    // "realisasi subsidi energi/BBM/LPG ... Rp87,5 triliun"
    /realisasi[\s\S]{0,150}?subsidi[\s\S]{0,80}?(?:energi|BBM|LPG|minyak bumi)[\s\S]{0,150}?Rp\s*([\d.,]+)\s*triliun/i,
    /subsidi[\s\S]{0,80}?(?:energi|BBM|LPG)[\s\S]{0,80}?(?:terealisasi|realisasi|mencapai|sebesar|senilai)[\s\S]{0,150}?Rp\s*([\d.,]+)\s*triliun/i,
    // Reverse order: "mencapai Rp87 triliun untuk subsidi energi"
    /Rp\s*([\d.,]+)\s*triliun[\s\S]{0,100}?subsidi[\s\S]{0,80}?(?:energi|BBM|LPG)/i,
    // English variants from bilingual sources
    /(?:energy|BBM|LPG)\s+subsid[\w]*[\s\S]{0,100}?IDR\s*([\d.,]+)\s*(?:T|trillion)/i,
  );

  // Subsidi pupuk (fertilizer)
  const subsidiPupukYtdTrn = matchNum(text,
    /realisasi[\s\S]{0,150}?subsidi\s+pupuk[\s\S]{0,150}?Rp\s*([\d.,]+)\s*triliun/i,
    /subsidi\s+pupuk[\s\S]{0,80}?(?:terealisasi|realisasi|mencapai|sebesar|senilai)[\s\S]{0,150}?Rp\s*([\d.,]+)\s*triliun/i,
    /Rp\s*([\d.,]+)\s*triliun[\s\S]{0,80}?subsidi\s+pupuk/i,
    /fertilizer\s+subsid[\w]*[\s\S]{0,100}?IDR\s*([\d.,]+)\s*(?:T|trillion)/i,
  );

  return { subsidiBbmLpgYtdTrn, subsidiPupukYtdTrn };
}

const SUBSIDI_DOMAINS = [
  'kemenkeu.go.id',
  'bisnis.com',
  'kontan.co.id',
  'cnbcindonesia.com',
  'katadata.co.id',
  'detik.com',
];
const SUBSIDI_QUERY = 'realisasi subsidi energi BBM LPG pupuk APBN 2026 triliun Kemenkeu';

async function fetchViaExa(): Promise<SubsidiData | null> {
  if (!process.env.EXASEARCH_API_KEY) return null;
  try {
    const { default: Exa } = await import('exa-js');
    const exa = new Exa(process.env.EXASEARCH_API_KEY);
    const startDate = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);

    const response = await exa.search(SUBSIDI_QUERY, {
      numResults: 4,
      type: 'auto',
      startPublishedDate: startDate,
      includeDomains: SUBSIDI_DOMAINS,
      contents: { text: { maxCharacters: 2500 } },
    } as Parameters<typeof exa.search>[1]);

    const results = response.results ?? [];
    let best: SubsidiData | null = null;
    let bestScore = 0;

    for (const r of results) {
      const text = (r as { text?: string }).text ?? r.title ?? '';
      if (!text) continue;
      const parsed = parseSubsidiText(text);
      const score = (parsed.subsidiBbmLpgYtdTrn !== null ? 2 : 0) + (parsed.subsidiPupukYtdTrn !== null ? 1 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = {
          ...parsed,
          date: (r.publishedDate ?? new Date().toISOString()).slice(0, 10),
          sourceUrl: r.url ?? null,
          fetchedAt: new Date().toISOString(),
        };
      }
    }
    return bestScore > 0 ? best : null;
  } catch {
    return null;
  }
}

async function fetchViaTavily(): Promise<SubsidiData | null> {
  if (!process.env.TAVILY_API_KEY) return null;
  try {
    const { TavilySearchAPIWrapper } = await import('@langchain/tavily');
    const tavily = new TavilySearchAPIWrapper({ tavilyApiKey: process.env.TAVILY_API_KEY });

    const response = await tavily.rawResults({
      query: SUBSIDI_QUERY,
      max_results: 4,
      include_domains: SUBSIDI_DOMAINS,
      include_raw_content: true,
      time_range: 'month',
    } as Parameters<typeof tavily.rawResults>[0]);

    let best: SubsidiData | null = null;
    let bestScore = 0;

    for (const r of (response.results ?? [])) {
      const text = r.raw_content ?? r.content ?? '';
      if (!text) continue;
      const parsed = parseSubsidiText(text);
      const score = (parsed.subsidiBbmLpgYtdTrn !== null ? 2 : 0) + (parsed.subsidiPupukYtdTrn !== null ? 1 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = {
          ...parsed,
          date: new Date().toISOString().slice(0, 10),
          sourceUrl: r.url ?? null,
          fetchedAt: new Date().toISOString(),
        };
      }
    }
    return bestScore > 0 ? best : null;
  } catch {
    return null;
  }
}

/**
 * Fetch latest subsidi realisasi (BBM+LPG energi + pupuk).
 * 30-day freshness gate — APBN Kita is published monthly.
 */
export async function fetchSubsidiRealisasi(): Promise<SubsidiData | null> {
  // Freshness gate: skip if recent data already in DB
  const cached = await getLatestPoint('subsidi_energi_ytd_idr_t');
  if (cached) {
    const ageDays = (Date.now() - new Date(cached.fetchedAt).getTime()) / 86_400_000;
    if (ageDays < FRESHNESS_DAYS) {
      const pupukPt = await getLatestPoint('subsidi_pupuk_ytd_idr_t');
      return {
        date: cached.date,
        subsidiBbmLpgYtdTrn: cached.value,
        subsidiPupukYtdTrn: pupukPt?.value ?? null,
        sourceUrl: null,
        fetchedAt: cached.fetchedAt,
      };
    }
  }

  const data = (await fetchViaExa()) ?? (await fetchViaTavily());
  if (!data) return null;

  // Persist to DB
  const points: MacroDataPoint[] = [];
  const { date, fetchedAt } = data;

  if (data.subsidiBbmLpgYtdTrn !== null) {
    points.push({
      indicator: 'subsidi_energi_ytd_idr_t',
      category: 'sovereign',
      date,
      value: data.subsidiBbmLpgYtdTrn,
      unit: 'IDR_trn',
      source: 'exa_kemenkeu',
      fetchedAt,
    });
  }
  if (data.subsidiPupukYtdTrn !== null) {
    points.push({
      indicator: 'subsidi_pupuk_ytd_idr_t',
      category: 'sovereign',
      date,
      value: data.subsidiPupukYtdTrn,
      unit: 'IDR_trn',
      source: 'exa_kemenkeu',
      fetchedAt,
    });
  }

  if (points.length > 0) await upsertPoints(points);

  return data;
}
