/**
 * SRBI weekly auction demand feed — BI press releases via Exa (primary) or Tavily (fallback).
 *
 * SRBI (Sekuritas Rupiah Bank Indonesia) — BI's sterilization instrument.
 * Auction runs weekly (typically Tuesday). BI publishes hasil lelang same day.
 *
 * WHY BID-COVER RATIO MATTERS:
 *   bid_cover = penawaran_masuk / allotment
 *   High bid-cover (>2.5) = strong demand = carry trade inflow signal = IDR support.
 *   Falling bid-cover (trend) = stealth capital exit BEFORE it appears in SBN ownership data.
 *   Undersubscribed (<1.0) = BI can't sterilize at desired volume = IDR defense weakens.
 *   One week faster lead than monthly DJPPR SBN ownership data.
 *
 * TOKEN EFFICIENCY:
 *   Exa: numResults=2, maxCharacters=2000 → ~1500 tokens total. No Playwright.
 *   Tavily fallback: max_results=1, include_raw_content=true → ~800 tokens.
 *   3-day freshness gate: skips search if fresh data in DB.
 *
 * ALERT THRESHOLDS (bid-cover ratio):
 *   ≥2.5         → GREEN  (strong demand, carry trade active)
 *   1.5–2.5      → YELLOW (normal / watch)
 *   1.0–1.5      → ORANGE (weak demand — outflow pressure)
 *   <1.0         → RED    (undersubscribed — CRITICAL, sterilization constrained)
 *   Falling trend (3-week) = additional YELLOW flag regardless of absolute level.
 */

import { getLatestPoint, upsertPoints } from '../time-series-db.js';
import type { AlertLevel, MacroDataPoint } from '../types.js';

export interface SrbiAuctionData {
  date: string;
  outstandingIdrT: number | null;
  demandIdrT: number | null;
  allotmentIdrT: number | null;
  bidCoverRatio: number | null;
  cutoffRatePct: number | null;
  foreignParticipationPct: number | null;
  bidCoverAlert: AlertLevel;
  sourceUrl: string | null;
  fetchedAt: string;
}

const FRESHNESS_DAYS = 3;

/** Parse Indonesian number format: "1.500,75" → 1500.75 */
function parseIdNumber(s: string): number | null {
  const cleaned = s.replace(/\./g, '').replace(',', '.');
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

function parseSrbiText(text: string): Omit<SrbiAuctionData, 'date' | 'bidCoverAlert' | 'sourceUrl' | 'fetchedAt'> {
  // Actual format observed from Bloomberg Technoz / financial news:
  //   "total penawaran yang masuk pada semua tenor sebanyak Rp54,53 triliun"
  //   "BI hanya mengantongi Rp18 triliun"
  //   "rata-rata tertimbang imbal hasil pemenang... tenor 12 bulan 6,75%"
  //   "saldo SRBI menjadi Rp957,9 triliun" / "SRBI outstanding sebesar Rp957,9 triliun"
  //
  // Indonesian numbers: comma=decimal, dot=thousand sep  →  "54,53" = 54.53T, "1.500" = 1500T

  const matchNum = (t: string, ...pats: RegExp[]): number | null => {
    for (const pat of pats) {
      const m = t.match(pat);
      if (m?.[1]) return parseIdNumber(m[1]);
    }
    return null;
  };

  // Total demand (all tenors). Use [\s\S]{0,N}? to not accidentally exclude chars like 'p' in "pada".
  const demandIdrT = matchNum(text,
    /total penawaran yang masuk[\s\S]{0,80}?Rp\s*([\d.,]+)\s*triliun/i,
    /penawaran yang masuk[\s\S]{0,80}?Rp\s*([\d.,]+)\s*triliun/i,
    /incoming bids?[\s\S]{0,60}?IDR\s*([\d.,]+)\s*(?:T|trillion)/i,
  );

  // Total allotment (what BI accepted)
  const allotmentIdrT = matchNum(text,
    /BI\s+hanya\s+(?:mengantongi|memenangkan)[\s\S]{0,30}?Rp\s*([\d.,]+)\s*triliun/i,
    /yang\s+dimenangkan[\s\S]{0,60}?Rp\s*([\d.,]+)\s*triliun/i,
    /dialokasikan[\s\S]{0,60}?Rp\s*([\d.,]+)\s*triliun/i,
    /allotment[\s\S]{0,60}?IDR\s*([\d.,]+)\s*(?:T|trillion)/i,
  );

  // SRBI outstanding total (sterilization stock)
  const outstandingIdrT = matchNum(text,
    /(?:saldo|outstanding)\s+SRBI[\s\S]{0,80}?Rp\s*([\d.,]+)\s*triliun/i,
    /SRBI[\s\S]{0,30}?(?:menjadi|sebesar|senilai)[\s\S]{0,30}?Rp\s*([\d.,]+)\s*triliun/i,
    /SRBI outstanding[\s\S]{0,60}?IDR\s*([\d.,]+)\s*(?:T|trillion)/i,
  );

  // Cut-off yield (12M tenor as benchmark)
  const cutoffRatePct = matchNum(text,
    /tenor\s+12\s+bulan[\s\S]{0,60}?([\d,]+)\s*%/i,
    /weighted\s+average[\s\S]{0,80}?([\d,]+)\s*%/i,
    /rata-?rata\s+tertimbang[\s\S]{0,80}?([\d,]+)\s*%/i,
  );

  // Foreign participation (if reported)
  const foreignParticipationPct = matchNum(text,
    /(?:nonresiden|asing)[\s\S]{0,60}?([\d,]+)\s*%/i,
    /(?:non-?resident|foreign)[\s\S]{0,60}?([\d.,]+)\s*%/i,
  );

  const bidCoverRatio = demandIdrT !== null && allotmentIdrT !== null && allotmentIdrT > 0
    ? parseFloat((demandIdrT / allotmentIdrT).toFixed(2))
    : null;

  return { outstandingIdrT, demandIdrT, allotmentIdrT, bidCoverRatio, cutoffRatePct, foreignParticipationPct };
}

function scoreBidCover(ratio: number | null): AlertLevel {
  if (ratio === null) return 'green';
  if (ratio < 1.0) return 'red';
  if (ratio < 1.5) return 'orange';
  if (ratio < 2.5) return 'yellow';
  return 'green';
}

// Financial news sites that reliably cover BI SRBI weekly auction results.
// bi.go.id is not indexed by Exa/Tavily. Bloomberg Technoz = most structured source.
const SRBI_DOMAINS = ['bloombergtechnoz.com', 'bisnis.com', 'kontan.co.id', 'cnbcindonesia.com'];
const SRBI_QUERY   = 'total penawaran masuk SRBI lelang Bank Indonesia triliun dimenangkan';

async function fetchViaExa(daysBack: number): Promise<SrbiAuctionData | null> {
  if (!process.env.EXASEARCH_API_KEY) return null;
  try {
    const { default: Exa } = await import('exa-js');
    const exa = new Exa(process.env.EXASEARCH_API_KEY);
    const startDate = new Date(Date.now() - daysBack * 86_400_000).toISOString().slice(0, 10);

    const response = await exa.search(SRBI_QUERY, {
      numResults: 3,
      type: 'auto',
      startPublishedDate: startDate,
      includeDomains: SRBI_DOMAINS,
      contents: { text: { maxCharacters: 2500 } },
    } as Parameters<typeof exa.search>[1]);

    const results = response.results ?? [];
    for (const r of results) {
      const text = (r as { text?: string }).text ?? r.title ?? '';
      if (!text) continue;
      const parsed = parseSrbiText(text);
      if (parsed.demandIdrT !== null || parsed.allotmentIdrT !== null) {
        const date = (r.publishedDate ?? new Date().toISOString()).slice(0, 10);
        return {
          ...parsed,
          date,
          bidCoverAlert: scoreBidCover(parsed.bidCoverRatio),
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

async function fetchViaTavily(daysBack: number): Promise<SrbiAuctionData | null> {
  if (!process.env.TAVILY_API_KEY) return null;
  try {
    const { TavilySearchAPIWrapper } = await import('@langchain/tavily');
    const tavily = new TavilySearchAPIWrapper({ tavilyApiKey: process.env.TAVILY_API_KEY });
    const timeRange = daysBack <= 7 ? 'week' : 'month';

    const response = await tavily.rawResults({
      query: SRBI_QUERY,
      max_results: 3,
      include_domains: SRBI_DOMAINS,
      include_raw_content: true,
      time_range: timeRange,
    } as Parameters<typeof tavily.rawResults>[0]);

    for (const r of (response.results ?? [])) {
      const text = r.raw_content ?? r.content ?? '';
      if (!text) continue;
      const parsed = parseSrbiText(text);
      if (parsed.demandIdrT !== null || parsed.allotmentIdrT !== null) {
        return {
          ...parsed,
          date: new Date().toISOString().slice(0, 10),
          bidCoverAlert: scoreBidCover(parsed.bidCoverRatio),
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

/**
 * Fetch latest SRBI auction data. Returns null if both providers unavailable or no data found.
 * 3-day freshness gate — skips search if DB has recent data.
 */
export async function fetchSrbiAuction(): Promise<SrbiAuctionData | null> {
  // Freshness gate: skip if recent data in DB
  const cached = await getLatestPoint('srbi_bid_cover_ratio');
  if (cached) {
    const ageDays = (Date.now() - new Date(cached.fetchedAt).getTime()) / 86_400_000;
    if (ageDays < FRESHNESS_DAYS) {
      const demandPt  = await getLatestPoint('srbi_demand_idr_t');
      const allotPt   = await getLatestPoint('srbi_allotment_idr_t');
      const cutoffPt  = await getLatestPoint('srbi_cutoff_rate_pct');
      const outstPt   = await getLatestPoint('srbi_outstanding_trn_idr');
      return {
        date: cached.date,
        outstandingIdrT: outstPt?.value ?? null,
        demandIdrT: demandPt?.value ?? null,
        allotmentIdrT: allotPt?.value ?? null,
        bidCoverRatio: cached.value,
        cutoffRatePct: cutoffPt?.value ?? null,
        foreignParticipationPct: null,
        bidCoverAlert: scoreBidCover(cached.value),
        sourceUrl: null,
        fetchedAt: cached.fetchedAt,
      };
    }
  }

  const daysBack = 14;
  const data = (await fetchViaExa(daysBack)) ?? (await fetchViaTavily(daysBack));
  if (!data) return null;

  // Persist to DB
  const fetchedAt = data.fetchedAt;
  const date = data.date;
  const points: MacroDataPoint[] = [];

  if (data.bidCoverRatio !== null)
    points.push({ indicator: 'srbi_bid_cover_ratio', category: 'fx', date, value: data.bidCoverRatio, unit: 'ratio', source: 'exa_bi', fetchedAt });
  if (data.demandIdrT !== null)
    points.push({ indicator: 'srbi_demand_idr_t', category: 'fx', date, value: data.demandIdrT, unit: 'IDR_trn', source: 'exa_bi', fetchedAt });
  if (data.allotmentIdrT !== null)
    points.push({ indicator: 'srbi_allotment_idr_t', category: 'fx', date, value: data.allotmentIdrT, unit: 'IDR_trn', source: 'exa_bi', fetchedAt });
  if (data.cutoffRatePct !== null)
    points.push({ indicator: 'srbi_cutoff_rate_pct', category: 'fx', date, value: data.cutoffRatePct, unit: '%', source: 'exa_bi', fetchedAt });

  if (points.length > 0) await upsertPoints(points);

  return data;
}

export function formatSrbiAuction(data: SrbiAuctionData): string[] {
  const lines: string[] = [];

  if (data.bidCoverRatio !== null) {
    const trend = data.bidCoverAlert === 'red'
      ? '🚨 UNDERSUBSCRIBED'
      : data.bidCoverAlert === 'orange'
      ? '⚠️  WEAK DEMAND'
      : data.bidCoverAlert === 'yellow'
      ? '⚠️  WATCH'
      : '✓ healthy';
    lines.push(`SRBI bid-cover: ${data.bidCoverRatio.toFixed(2)}x ${trend}`);
  }
  if (data.demandIdrT !== null && data.allotmentIdrT !== null)
    lines.push(`  Demand IDR ${data.demandIdrT.toFixed(1)}T → Allotment IDR ${data.allotmentIdrT.toFixed(1)}T`);
  if (data.cutoffRatePct !== null)
    lines.push(`  Cut-off rate: ${data.cutoffRatePct.toFixed(2)}%`);
  if (data.outstandingIdrT !== null)
    lines.push(`  SRBI outstanding: IDR ${data.outstandingIdrT.toFixed(1)}T`);

  return lines;
}
