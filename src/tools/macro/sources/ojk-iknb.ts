/**
 * OJK IKNB (Industri Keuangan Non-Bank) fintech lending statistics.
 *
 * Tracks P2P lending + paylater/BNPL combined (OJK IKNB monthly release).
 * OJK distinguishes two populations:
 *   - Total fintech lending (P2P + paylater): ~Rp117T (OJK Jul 2025)
 *   - BNPL/paylater-only: ~Rp56.3T (IdScore early 2026)
 * This module tracks OJK's combined figure — consistent, official, auditable.
 *
 * WHY IT MATTERS FOR M8:
 *   fintech NPL ~5% (Kontan Jun 2026) vs bank NPL 1.96% — already 2.5× higher.
 *   Fintech NPL is a 2–3Q LEADING indicator for bank NPL: stress concentrates in
 *   unsecured digital credit first, then spills into formal banking as banks
 *   acquire fintechs or via credit-line exposure.
 *   BI Rate hike → fintech cost-of-funds rises → underwriting tightens OR
 *   existing borrowers stressed → NPL rises → dual-signal classification needed.
 *
 * DUAL SIGNAL:
 *   high growth + low NPL  → INCLUSION (healthy, more people accessing credit)
 *   high growth + high NPL → DISTRESS  (catch-up spending, income insufficient)
 *   low growth  + high NPL → CREDIT_CYCLE_TURN (contraction + defaults)
 *
 * DATA SOURCE:
 *   Tier 0: FINTECH_NPL_PCT env override — manual pin from OJK SPI press release.
 *   Tier 1: Exa neural — media + OJK Siaran Pers coverage (kontan/bisnis/cnbcindonesia).
 *   Tier 2: Tavily — broad Indonesian financial media fallback.
 *   ojk.go.id direct (Excel/API) blocked by F5 BIG-IP WAF; Exa/Tavily is the only
 *   automated path. Monthly release cadence, ~6-week pub lag.
 *   30-day freshness gate.
 *
 * DB INDICATORS:
 *   fintech_npl_pct                — NPL/NPB rate fintech lending %
 *   fintech_lending_outstanding_idr_t — outstanding Rp T (P2P + paylater)
 *   fintech_lending_growth_yoy_pct — YoY outstanding growth %
 */

import { getLatestPoint, upsertPoints, getHistory } from '../time-series-db.js';
import type { MacroDataPoint } from '../types.js';

const FRESHNESS_DAYS = 30;

const IKNB_DOMAINS = [
  'kontan.co.id', 'bisnis.com', 'cnbcindonesia.com',
  'ojk.go.id', 'republika.co.id', 'infobanknews.com',
  'finansial.bisnis.com', 'investor.id', 'idxchannel.com',
];

// Two queries: growth query targets media articles (kontan/bisnis/cnbci) with outstanding+YoY%.
// NPL query targets OJK siaran pers + media with TWP90/NPB — returns official pages.
// Merged across both fetches to get all three fields reliably.
const IKNB_GROWTH_QUERY =
  'fintech lending P2P outstanding triliun tumbuh YoY OJK 2026';
const IKNB_NPL_QUERY =
  'OJK IKNB fintech TWP90 NPB pembiayaan bermasalah 2026 siaran pers';
// Legacy combined query kept for Tavily (Tavily handles OR-queries better than Exa neural).
const IKNB_TAVILY_QUERY =
  '(OJK IKNB "fintech lending" OR "pinjaman online" OR "P2P lending") ' +
  '("pembiayaan bermasalah" OR NPB OR TWP90 OR TKB90) ' +
  '(triliun OR outstanding OR penyaluran) 2026';

/** Parse Indonesian number: "56,3" → 56.3, "1.500" → 1500 */
function parseIdNumber(s: string): number | null {
  const cleaned = s.replace(/\./g, '').replace(',', '.');
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

function parseFirst(text: string, ...patterns: RegExp[]): number | null {
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) {
      const val = parseIdNumber(m[1]);
      if (val !== null) return val;
    }
  }
  return null;
}

interface FintechLendingRaw {
  fintechNplPct: number | null;
  outstandingIdrT: number | null;
  growthYoyPct: number | null;
}

function parseFintechText(text: string): FintechLendingRaw {
  // TWP90 = Tingkat Wanprestasi Pinjaman 90hari = direct NPL rate (OJK post-2024 terminology)
  // TKB90 = Tingkat Keberhasilan Bayar 90hari = success rate; NPB = 100 - TKB90
  let tkb90: number | null = null;
  const tkb90Raw = parseFirst(
    text,
    /TKB90[\s\S]{0,40}?([\d,]+)\s*%/i,
    /tingkat\s+keberhasilan\s+(?:bayar\s+)?90[\s\S]{0,40}?([\d,]+)\s*%/i,
  );
  if (tkb90Raw !== null && tkb90Raw >= 0 && tkb90Raw <= 100) tkb90 = tkb90Raw;

  const fintechNplPct = parseFirst(
    text,
    // TWP90 = direct wanprestasi (NPL) rate — OJK adopted this term from 2024
    /TWP90[\s\S]{0,40}?([\d,]+)\s*%/i,
    /tingkat\s+wanprestasi\s+(?:pinjaman\s+)?90[\s\S]{0,40}?([\d,]+)\s*%/i,
    /rasio\s+pembiayaan\s+bermasalah[\s\S]{0,80}?([\d,]+)\s*%/i,
    /tingkat\s+wanprestasi[\s\S]{0,60}?([\d,]+)\s*%/i,
    /NPB[\s\S]{0,60}?([\d,]+)\s*%/i,
    /NPL\s+fintech[\s\S]{0,60}?([\d,]+)\s*%/i,
    /pembiayaan\s+bermasalah[\s\S]{0,40}?([\d,]+)\s*%/i,
  ) ?? (tkb90 !== null ? parseFloat((100 - tkb90).toFixed(2)) : null);

  const outstandingIdrT = parseFirst(
    text,
    /penyaluran[\s\S]{0,60}?Rp\s*([\d.,]+)\s*triliun/i,
    /outstanding[\s\S]{0,60}?Rp\s*([\d.,]+)\s*triliun/i,
    /akumulasi[\s\S]{0,60}?Rp\s*([\d.,]+)\s*triliun/i,
    /total\s+pembiayaan[\s\S]{0,60}?Rp\s*([\d.,]+)\s*triliun/i,
  );

  // "tumbuh sebesar 17,02% secara Year on Year (YoY)" — Indonesian OJK press release format
  const growthYoyPct = parseFirst(
    text,
    /tumbuh\s+(?:sebesar\s+)?([\d,]+)\s*%\s*(?:secara\s+(?:year\s+on\s+year|tahunan|yoy)|\(yoy\)|year.on.year)/i,
    /meningkat\s+(?:sebesar\s+)?([\d,]+)\s*%\s*(?:secara\s+(?:year\s+on\s+year|tahunan|yoy)|\(yoy\)|year.on.year)/i,
    /naik\s+(?:sebesar\s+)?([\d,]+)\s*%\s*(?:secara\s+(?:year\s+on\s+year|tahunan|yoy)|\(yoy\)|secara\s+tahunan)/i,
    /pertumbuhan\s+(?:sebesar\s+)?([\d,]+)\s*%\s*(?:secara\s+(?:year\s+on\s+year|tahunan|yoy)|\(yoy\)|year.on.year)/i,
    // Headline format: "Tumbuh 17,02% per September" (without yoy qualifier)
    /fintech[^0-9]{0,60}tumbuh\s+(?:sebesar\s+)?([\d,]+)\s*%/i,
    /P2P[^0-9]{0,60}tumbuh\s+(?:sebesar\s+)?([\d,]+)\s*%/i,
  );

  return { fintechNplPct, outstandingIdrT, growthYoyPct };
}

async function fetchViaExa(daysBack: number): Promise<FintechLendingRaw | null> {
  if (!process.env.EXASEARCH_API_KEY) return null;
  try {
    const { default: Exa } = await import('exa-js');
    const exa = new Exa(process.env.EXASEARCH_API_KEY);
    const startDate = new Date(Date.now() - daysBack * 86_400_000).toISOString().slice(0, 10);

    // Two-pass: growth query targets media articles (outstanding + YoY%),
    // NPL query targets OJK siaran pers (TWP90/NPB). Merge across both.
    const merged: FintechLendingRaw = { fintechNplPct: null, outstandingIdrT: null, growthYoyPct: null };

    for (const query of [IKNB_GROWTH_QUERY, IKNB_NPL_QUERY]) {
      if (merged.fintechNplPct !== null && merged.outstandingIdrT !== null && merged.growthYoyPct !== null) break;
      const response = await exa.search(query, {
        numResults: 5,
        type: 'auto',
        startPublishedDate: startDate,
        includeDomains: IKNB_DOMAINS,
        contents: { text: { maxCharacters: 4000 } },
      } as Parameters<typeof exa.search>[1]);

      for (const r of (response.results ?? [])) {
        const text = (r as { text?: string }).text ?? r.title ?? '';
        if (!text) continue;
        const parsed = parseFintechText(text);
        if (merged.fintechNplPct === null && parsed.fintechNplPct !== null) merged.fintechNplPct = parsed.fintechNplPct;
        if (merged.outstandingIdrT === null && parsed.outstandingIdrT !== null) merged.outstandingIdrT = parsed.outstandingIdrT;
        if (merged.growthYoyPct === null && parsed.growthYoyPct !== null) merged.growthYoyPct = parsed.growthYoyPct;
        if (merged.fintechNplPct !== null && merged.outstandingIdrT !== null && merged.growthYoyPct !== null) break;
      }
    }

    if (merged.fintechNplPct !== null || merged.outstandingIdrT !== null) return merged;
    return null;
  } catch {
    return null;
  }
}

async function fetchViaTavily(daysBack: number): Promise<FintechLendingRaw | null> {
  if (!process.env.TAVILY_API_KEY) return null;
  try {
    const { TavilySearchAPIWrapper } = await import('@langchain/tavily');
    const tavily = new TavilySearchAPIWrapper({ tavilyApiKey: process.env.TAVILY_API_KEY });

    const response = await tavily.rawResults({
      query: IKNB_TAVILY_QUERY,
      max_results: 5,
      include_domains: IKNB_DOMAINS,
      include_raw_content: true,
      time_range: 'month',
    } as Parameters<typeof tavily.rawResults>[0]);

    const merged: FintechLendingRaw = { fintechNplPct: null, outstandingIdrT: null, growthYoyPct: null };
    for (const r of (response.results ?? [])) {
      const text = (r.raw_content ?? r.content ?? '') as string;
      if (!text) continue;
      const parsed = parseFintechText(text);
      if (merged.fintechNplPct === null && parsed.fintechNplPct !== null) merged.fintechNplPct = parsed.fintechNplPct;
      if (merged.outstandingIdrT === null && parsed.outstandingIdrT !== null) merged.outstandingIdrT = parsed.outstandingIdrT;
      if (merged.growthYoyPct === null && parsed.growthYoyPct !== null) merged.growthYoyPct = parsed.growthYoyPct;
      if (merged.fintechNplPct !== null && merged.outstandingIdrT !== null && merged.growthYoyPct !== null) break;
    }
    if (merged.fintechNplPct !== null || merged.outstandingIdrT !== null) return merged;
    return null;
  } catch {
    return null;
  }
}

export interface FintechLendingData {
  fintechNplPct: number | null;
  outstandingIdrT: number | null;
  growthYoyPct: number | null;
}

export async function fetchFintechLendingOjkIknb(): Promise<FintechLendingData | null> {
  // FINTECH_NPL_PCT env always wins for NPL (DNDF pattern — OJK WAF blocks auto-scrape).
  // But env only covers NPL — outstanding + growth still need Exa unless DB cache is fresh.
  const envNpl = process.env.FINTECH_NPL_PCT;
  let forcedNplPct: number | null = null;
  if (envNpl) {
    const v = parseFloat(envNpl);
    if (!isNaN(v) && v > 0 && v < 100) {
      forcedNplPct = v;
      const fetchedAt = new Date().toISOString();
      await upsertPoints([{
        indicator: 'fintech_npl_pct', category: 'banking',
        date: fetchedAt.slice(0, 10), value: v, unit: '%', source: 'env_manual', fetchedAt,
      }]);
    }
  }

  // Check cache for outstanding + growth (separate from NPL freshness gate)
  const [cachedOutstanding, cachedGrowth] = await Promise.all([
    getLatestPoint('fintech_lending_outstanding_idr_t'),
    getLatestPoint('fintech_lending_growth_yoy_pct'),
  ]);
  const outstandingAgeDays = cachedOutstanding
    ? (Date.now() - new Date(cachedOutstanding.fetchedAt).getTime()) / 86_400_000
    : Infinity;
  const outstandingFresh = outstandingAgeDays < FRESHNESS_DAYS;

  const growthFresh = cachedGrowth !== null &&
    (Date.now() - new Date(cachedGrowth.fetchedAt).getTime()) / 86_400_000 < FRESHNESS_DAYS;

  // If env NPL set AND outstanding+growth are both fresh → return merged without Exa
  if (forcedNplPct !== null && outstandingFresh && growthFresh) {
    return {
      fintechNplPct: forcedNplPct,
      outstandingIdrT: cachedOutstanding?.value ?? null,
      growthYoyPct: cachedGrowth?.value ?? null,
    };
  }

  // 30-day freshness gate — also covers case where env NPL NOT set
  if (forcedNplPct === null) {
    const cachedNpl = await getLatestPoint('fintech_npl_pct');
    if (cachedNpl) {
      const ageDays = (Date.now() - new Date(cachedNpl.fetchedAt).getTime()) / 86_400_000;
      if (ageDays < FRESHNESS_DAYS && outstandingFresh && growthFresh) {
        return {
          fintechNplPct: cachedNpl.value,
          outstandingIdrT: cachedOutstanding?.value ?? null,
          growthYoyPct: cachedGrowth?.value ?? null,
        };
      }
    }
  }

  const raw = await fetchViaExa(60) ?? await fetchViaTavily(60);
  if (!raw) return null;

  const date = new Date().toISOString().slice(0, 10);
  const fetchedAt = new Date().toISOString();
  const points: MacroDataPoint[] = [];

  if (raw.fintechNplPct !== null) {
    points.push({
      indicator: 'fintech_npl_pct',
      category: 'banking',
      date, value: raw.fintechNplPct, unit: '%',
      source: 'ojk_iknb_exa', fetchedAt,
    });
  }
  if (raw.outstandingIdrT !== null) {
    points.push({
      indicator: 'fintech_lending_outstanding_idr_t',
      category: 'banking',
      date, value: raw.outstandingIdrT, unit: 'IDR T',
      source: 'ojk_iknb_exa', fetchedAt,
    });
  }

  // YoY from Exa parse — OR compute from DB outstanding history if Exa parse missed it.
  // DB computation: find point from ~365d ago (±45d window), compute YoY from outstanding series.
  let growthYoyPct = raw.growthYoyPct;
  if (growthYoyPct === null && raw.outstandingIdrT !== null) {
    const history = await getHistory('fintech_lending_outstanding_idr_t', 420);
    if (history.length >= 2) {
      const targetDate = new Date(Date.now() - 365 * 86_400_000);
      const prior = history
        .filter(p => Math.abs(new Date(p.date).getTime() - targetDate.getTime()) < 45 * 86_400_000)
        .sort((a, b) => Math.abs(new Date(a.date).getTime() - targetDate.getTime()) - Math.abs(new Date(b.date).getTime() - targetDate.getTime()))[0];
      if (prior && prior.value > 0) {
        growthYoyPct = parseFloat(((raw.outstandingIdrT - prior.value) / prior.value * 100).toFixed(2));
      }
    }
  }

  if (growthYoyPct !== null) {
    points.push({
      indicator: 'fintech_lending_growth_yoy_pct',
      category: 'banking',
      date, value: growthYoyPct, unit: '%',
      source: raw.growthYoyPct !== null ? 'ojk_iknb_exa' : 'computed_yoy',
      fetchedAt,
    });
    raw.growthYoyPct = growthYoyPct;
  }

  if (points.length > 0) await upsertPoints(points);

  // Merge env-forced NPL with Exa-fetched outstanding + growth
  return {
    fintechNplPct: forcedNplPct ?? raw.fintechNplPct,
    outstandingIdrT: raw.outstandingIdrT,
    growthYoyPct: raw.growthYoyPct,
  };
}
