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

import { getLatestPoint, upsertPoints } from '../time-series-db.js';
import type { MacroDataPoint } from '../types.js';

const FRESHNESS_DAYS = 30;

const IKNB_DOMAINS = [
  'kontan.co.id', 'bisnis.com', 'cnbcindonesia.com',
  'ojk.go.id', 'republika.co.id', 'infobanknews.com',
  'finansial.bisnis.com', 'investor.id', 'idxchannel.com',
];

// OJK uses "NPB" (Non-Performing Borrower) for fintech; "NPL" in headlines; both covered.
// "Siaran Pers OJK" + "IKNB" = official press release language. "pembiayaan bermasalah" = NPL in Indonesian.
const IKNB_QUERY =
  '(OJK IKNB "fintech lending" OR "pinjaman online" OR "P2P lending") ' +
  '("pembiayaan bermasalah" OR NPB OR NPL OR TKB90) ' +
  '(triliun OR outstanding OR penyaluran) 2026 ' +
  'OR "Siaran Pers OJK" IKNB fintech NPB 2026';

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
  // TKB90 = tingkat keberhasilan bayar 90 (success rate); NPB = 100 - TKB90
  let tkb90: number | null = null;
  const tkb90Raw = parseFirst(
    text,
    /TKB90[\s\S]{0,40}?([\d,]+)\s*%/i,
    /tingkat\s+keberhasilan\s+(?:bayar\s+)?90[\s\S]{0,40}?([\d,]+)\s*%/i,
  );
  if (tkb90Raw !== null && tkb90Raw >= 0 && tkb90Raw <= 100) tkb90 = tkb90Raw;

  const fintechNplPct = parseFirst(
    text,
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

  const growthYoyPct = parseFirst(
    text,
    /tumbuh\s+([\d,]+)\s*%\s*(?:\(yoy\)|year.on.year)/i,
    /meningkat\s+([\d,]+)\s*%\s*(?:\(yoy\)|year.on.year)/i,
    /naik\s+([\d,]+)\s*%\s*(?:\(yoy\)|secara\s+tahunan)/i,
    /pertumbuhan\s+([\d,]+)\s*%\s*(?:\(yoy\)|year.on.year)/i,
  );

  return { fintechNplPct, outstandingIdrT, growthYoyPct };
}

async function fetchViaExa(daysBack: number): Promise<FintechLendingRaw | null> {
  if (!process.env.EXASEARCH_API_KEY) return null;
  try {
    const { default: Exa } = await import('exa-js');
    const exa = new Exa(process.env.EXASEARCH_API_KEY);
    const startDate = new Date(Date.now() - daysBack * 86_400_000).toISOString().slice(0, 10);

    const response = await exa.search(IKNB_QUERY, {
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
      if (parsed.fintechNplPct !== null || parsed.outstandingIdrT !== null) return parsed;
    }
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
      query: IKNB_QUERY,
      max_results: 5,
      include_domains: IKNB_DOMAINS,
      include_raw_content: true,
      time_range: 'month',
    } as Parameters<typeof tavily.rawResults>[0]);

    for (const r of (response.results ?? [])) {
      const text = (r.raw_content ?? r.content ?? '') as string;
      if (!text) continue;
      const parsed = parseFintechText(text);
      if (parsed.fintechNplPct !== null || parsed.outstandingIdrT !== null) return parsed;
    }
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
  // 30-day freshness gate — OJK IKNB releases monthly, ~6-week lag
  const cached = await getLatestPoint('fintech_npl_pct');
  if (cached) {
    const ageDays = (Date.now() - new Date(cached.fetchedAt).getTime()) / 86_400_000;
    if (ageDays < FRESHNESS_DAYS) {
      const [cachedOutstanding, cachedGrowth] = await Promise.all([
        getLatestPoint('fintech_lending_outstanding_idr_t'),
        getLatestPoint('fintech_lending_growth_yoy_pct'),
      ]);
      return {
        fintechNplPct: cached.value,
        outstandingIdrT: cachedOutstanding?.value ?? null,
        growthYoyPct: cachedGrowth?.value ?? null,
      };
    }
  }

  // Tier 0: env override — wins over all auto-fetch (DNDF pattern)
  // ojk.go.id blocks all direct requests (F5 BIG-IP WAF); update manually from OJK SPI press release.
  const envNpl = process.env.FINTECH_NPL_PCT;
  if (envNpl) {
    const v = parseFloat(envNpl);
    if (!isNaN(v) && v > 0 && v < 100) {
      const date = new Date().toISOString().slice(0, 10);
      const fetchedAt = new Date().toISOString();
      await upsertPoints([{
        indicator: 'fintech_npl_pct', category: 'banking',
        date, value: v, unit: '%', source: 'env_manual', fetchedAt,
      }]);
      return { fintechNplPct: v, outstandingIdrT: null, growthYoyPct: null };
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
  if (raw.growthYoyPct !== null) {
    points.push({
      indicator: 'fintech_lending_growth_yoy_pct',
      category: 'banking',
      date, value: raw.growthYoyPct, unit: '%',
      source: 'ojk_iknb_exa', fetchedAt,
    });
  }
  if (points.length > 0) await upsertPoints(points);

  return raw;
}
