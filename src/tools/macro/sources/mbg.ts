/**
 * MBG (Makan Bergizi Gratis) realisasi tracker.
 *
 * APBN 2026 target: Rp 335T (Rp 1.2T/hari, target 82.9M penerima).
 * 8.7% of total APBN spending (Rp 3,843T) — 4× larger than energy subsidy.
 *
 * 2025 baseline: Rp 71T allocated, Rp 51.5T realized (72.5%).
 *
 * WHY IT MATTERS FOR M10:
 *   Largest single discretionary spending line outside subsidies. Burn rate >110%
 *   of pro-rata = early signal for spending overrun → deficit blowout.
 *   Distinct from subsidi because demand-side: every SPPG operational adds Rp1.2T/day
 *   so velocity is policy-fixed, not price-driven.
 *
 * DATA SOURCE:
 *   Exa/Tavily search Kemenkeu APBN KiTa + Indonesian financial news.
 *   30-day freshness gate (APBN KiTa monthly).
 *
 * DB INDICATOR:
 *   mbg_realisasi_ytd_idr_t — YTD spending in IDR trillion
 */

import { getLatestPoint, upsertPoints } from '../time-series-db.js';
import type { MacroDataPoint } from '../types.js';

export const MBG_APBN_2026_TARGET_TRN = 335.0;

const FRESHNESS_DAYS = 30;

const MBG_DOMAINS = [
  'kemenkeu.go.id', 'bgn.go.id', 'kompas.com',
  'cnbcindonesia.com', 'bisnis.com', 'kontan.co.id',
  'detik.com', 'tempo.co', 'katadata.co.id', 'republika.co.id',
];

const MBG_QUERY = 'realisasi anggaran MBG makan bergizi gratis 2026 triliun APBN Kemenkeu';

function parseIdNumber(s: string): number | null {
  const cleaned = s.replace(/\./g, '').replace(',', '.');
  const v = parseFloat(cleaned);
  return isNaN(v) ? null : v;
}

function matchNum(text: string, ...patterns: RegExp[]): number | null {
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m?.[1]) {
      const v = parseIdNumber(m[1]);
      // MBG realisasi sanity: 0–400T range
      if (v !== null && v > 0 && v < 400) return v;
    }
  }
  return null;
}

function parseMbgText(text: string): number | null {
  return matchNum(
    text,
    /realisasi[\s\S]{0,120}?(?:MBG|makan bergizi gratis)[\s\S]{0,120}?Rp\s*([\d.,]+)\s*triliun/i,
    /(?:MBG|makan bergizi gratis)[\s\S]{0,80}?(?:terealisasi|realisasi|telah dibelanjakan|sudah disalurkan|terserap)[\s\S]{0,120}?Rp\s*([\d.,]+)\s*triliun/i,
    /Rp\s*([\d.,]+)\s*triliun[\s\S]{0,80}?(?:untuk\s+)?(?:program\s+)?(?:MBG|makan bergizi gratis)/i,
    /anggaran\s+(?:MBG|makan bergizi)[\s\S]{0,120}?(?:telah\s+)?(?:digunakan|terserap|disalurkan)[\s\S]{0,80}?Rp\s*([\d.,]+)\s*triliun/i,
  );
}

export interface MbgData {
  date: string;
  realisasiYtdTrn: number;
  sourceUrl: string | null;
  fetchedAt: string;
}

async function fetchViaExa(): Promise<MbgData | null> {
  if (!process.env.EXASEARCH_API_KEY) return null;
  try {
    const { default: Exa } = await import('exa-js');
    const exa = new Exa(process.env.EXASEARCH_API_KEY);
    const startDate = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);

    const response = await exa.search(MBG_QUERY, {
      numResults: 4,
      type: 'auto',
      startPublishedDate: startDate,
      includeDomains: MBG_DOMAINS,
      contents: { text: { maxCharacters: 2500 } },
    } as Parameters<typeof exa.search>[1]);

    for (const r of (response.results ?? [])) {
      const text = (r as { text?: string }).text ?? r.title ?? '';
      if (!text) continue;
      const v = parseMbgText(text);
      if (v !== null) {
        return {
          date: (r.publishedDate ?? new Date().toISOString()).slice(0, 10),
          realisasiYtdTrn: v,
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

async function fetchViaTavily(): Promise<MbgData | null> {
  if (!process.env.TAVILY_API_KEY) return null;
  try {
    const { TavilySearchAPIWrapper } = await import('@langchain/tavily');
    const tavily = new TavilySearchAPIWrapper({ tavilyApiKey: process.env.TAVILY_API_KEY });

    const response = await tavily.rawResults({
      query: MBG_QUERY,
      max_results: 4,
      include_domains: MBG_DOMAINS,
      include_raw_content: true,
      time_range: 'month',
    } as Parameters<typeof tavily.rawResults>[0]);

    for (const r of (response.results ?? [])) {
      const text = (r.raw_content ?? r.content ?? '') as string;
      if (!text) continue;
      const v = parseMbgText(text);
      if (v !== null) {
        return {
          date: new Date().toISOString().slice(0, 10),
          realisasiYtdTrn: v,
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

export async function fetchMbgRealisasi(): Promise<MbgData | null> {
  const cached = await getLatestPoint('mbg_realisasi_ytd_idr_t');
  if (cached) {
    const ageDays = (Date.now() - new Date(cached.fetchedAt).getTime()) / 86_400_000;
    if (ageDays < FRESHNESS_DAYS) {
      return {
        date: cached.date,
        realisasiYtdTrn: cached.value,
        sourceUrl: null,
        fetchedAt: cached.fetchedAt,
      };
    }
  }

  const data = (await fetchViaExa()) ?? (await fetchViaTavily());
  if (!data) return null;

  const points: MacroDataPoint[] = [{
    indicator: 'mbg_realisasi_ytd_idr_t',
    category: 'sovereign',
    date: data.date,
    value: data.realisasiYtdTrn,
    unit: 'IDR_trn',
    source: 'exa_kemenkeu_mbg',
    fetchedAt: data.fetchedAt,
  }];
  await upsertPoints(points);

  return data;
}
