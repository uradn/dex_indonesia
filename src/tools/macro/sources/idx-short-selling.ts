/**
 * IDX daily short selling volume — via Exa/Tavily media search.
 *
 * IDX publishes short selling data daily after market close.
 * IDX API endpoints (/GetShortSellSummary etc.) return 403 — blocked.
 * Media sources (Bloomberg Technoz, Bisnis, Kontan, CNBC Indonesia) report daily figures.
 *
 * WHY IT MATTERS:
 *   Rising short selling = institutional shorts building → bearish conviction signal.
 *   Short sell volume spike (>3× 20d avg) = forced repricing / cascade alert.
 *   Cross-check with IHSG level: short sell rising while IHSG falls = genuine stress.
 *
 * INDICATORS:
 *   idx_short_sell_volume_idr_bn  — daily short sell volume, IDR billions
 *   idx_short_sell_pct_volume     — short sell as % of total IHSG volume (if available)
 *
 * FRESHNESS: 2-day gate (daily publication)
 */

import { getLatestPoint, upsertPoints } from '../time-series-db.js';
import { fetchRenderedTextWithBrowser } from './playwright-browser.js';
import type { MacroDataPoint } from '../types.js';

const FRESHNESS_DAYS = 2;
const NOW = () => new Date().toISOString();
const TODAY = () => new Date().toISOString().slice(0, 10);

// IDX launched intraday short selling Oct 2026 — volume data available from Oct 2026 onward.
// Prior to Oct 2026: no intraday short selling existed on IDX. DO NOT query pre-Oct 2026.
// IDX API (/GetShortSell etc.) returns 403 — blocked.
// Media sources: Bisnis/Kontan/Bloomberg Technoz publish daily BEI trading summary ~3-4pm WIB.
const IDX_SS_DOMAINS = ['bloombergtechnoz.com', 'bisnis.com', 'kontan.co.id', 'cnbcindonesia.com', 'pasardana.id'];
// Note: "net sell" ≠ "short selling". Query must use "short selling" to avoid asing-net-sell articles.
const IDX_SS_QUERY   = 'IDX BEI intraday short selling volume miliar transaksi saham pendek harian total';

export interface IdxShortSellData {
  date: string;
  volumeIdrBn: number | null;
  pctOfTotalVolume: number | null;
  sourceUrl: string | null;
  fetchedAt: string;
}

/** Parse Indonesian number: "1.500,75" → 1500.75 */
function parseIdNum(s: string): number | null {
  const cleaned = s.replace(/\./g, '').replace(',', '.');
  const v = parseFloat(cleaned);
  return isNaN(v) ? null : v;
}

function parseShortSellText(text: string): { volumeIdrBn: number | null; pctOfTotalVolume: number | null } {
  const matchNum = (t: string, ...pats: RegExp[]): number | null => {
    for (const pat of pats) {
      const m = t.match(pat);
      if (m?.[1]) return parseIdNum(m[1]);
    }
    return null;
  };

  // Volume patterns (IDR billions / trillions — normalize to bn)
  let volumeIdrBn = matchNum(text,
    /short.?sell(?:ing)?\s+(?:sebesar\s+)?Rp\s*([\d.,]+)\s*(?:miliar|billion)/i,
    /transaksi\s+short.?sell(?:ing)?\s+(?:mencapai\s+)?Rp\s*([\d.,]+)\s*(?:miliar|billion)/i,
    /short.?sell(?:ing)?\s+(?:volume\s+)?(?:senilai\s+)?Rp\s*([\d.,]+)\s*(?:miliar|billion)/i,
    /nilai\s+short.?sell(?:ing)?\s+Rp\s*([\d.,]+)\s*(?:miliar|billion)/i,
  );

  // Trillion IDR → convert to bn
  const volumeTrn = matchNum(text,
    /short.?sell(?:ing)?\s+(?:sebesar\s+)?Rp\s*([\d.,]+)\s*triliun/i,
    /transaksi\s+short.?sell(?:ing)?[^.]*?Rp\s*([\d.,]+)\s*triliun/i,
  );
  if (volumeTrn !== null && volumeIdrBn === null) {
    volumeIdrBn = volumeTrn * 1000;
  }

  // Sanity: IDX daily short selling typically 100–10,000 IDR bn
  if (volumeIdrBn !== null && (volumeIdrBn < 10 || volumeIdrBn > 50_000)) volumeIdrBn = null;

  // Percentage of total volume
  const pctOfTotalVolume = matchNum(text,
    /short.?sell(?:ing)?[^.]*?([\d.,]+)\s*%\s+(?:dari\s+total|of\s+total)/i,
    /porsi\s+short.?sell(?:ing)?[^.]*?([\d.,]+)\s*%/i,
  );

  return { volumeIdrBn, pctOfTotalVolume };
}

async function fetchViaExa(): Promise<IdxShortSellData | null> {
  if (!process.env.EXASEARCH_API_KEY) return null;
  try {
    const { default: Exa } = await import('exa-js');
    const exa = new Exa(process.env.EXASEARCH_API_KEY);
    const startDate = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

    const response = await exa.search(IDX_SS_QUERY, {
      numResults: 3,
      type: 'auto',
      startPublishedDate: startDate,
      includeDomains: IDX_SS_DOMAINS,
      contents: { text: { maxCharacters: 2000 } },
    } as Parameters<typeof exa.search>[1]);

    for (const r of (response.results ?? [])) {
      const text = (r as { text?: string }).text ?? r.title ?? '';
      if (!text) continue;
      const parsed = parseShortSellText(text);
      if (parsed.volumeIdrBn !== null) {
        return {
          date: (r.publishedDate ?? NOW()).slice(0, 10),
          ...parsed,
          sourceUrl: r.url ?? null,
          fetchedAt: NOW(),
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Playwright fallback: render IDX short selling page to bypass Cloudflare. */
async function fetchViaPlaywright(): Promise<IdxShortSellData | null> {
  try {
    const text = await fetchRenderedTextWithBrowser(
      'https://www.idx.co.id/en/market-data/stock-data/short-selling/',
    );
    if (!text || text.length < 200) return null;
    const parsed = parseShortSellText(text);
    if (parsed.volumeIdrBn === null) return null;
    return { date: TODAY(), ...parsed, sourceUrl: 'https://www.idx.co.id/en/market-data/stock-data/short-selling/', fetchedAt: NOW() };
  } catch {
    return null;
  }
}

async function fetchViaTavily(): Promise<IdxShortSellData | null> {
  if (!process.env.TAVILY_API_KEY) return null;
  try {
    const { TavilySearchAPIWrapper } = await import('@langchain/tavily');
    const tavily = new TavilySearchAPIWrapper({ tavilyApiKey: process.env.TAVILY_API_KEY });

    const response = await tavily.rawResults({
      query: IDX_SS_QUERY,
      max_results: 3,
      include_domains: IDX_SS_DOMAINS,
      include_raw_content: true,
      time_range: 'week',
    } as Parameters<typeof tavily.rawResults>[0]);

    for (const r of (response.results ?? [])) {
      const text = r.raw_content ?? r.content ?? '';
      if (!text) continue;
      const parsed = parseShortSellText(text);
      if (parsed.volumeIdrBn !== null) {
        return {
          date: TODAY(),
          ...parsed,
          sourceUrl: r.url ?? null,
          fetchedAt: NOW(),
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch IDX daily short selling volume. 2-day freshness gate.
 * Returns null if no data found.
 */
export async function fetchIdxShortSelling(): Promise<IdxShortSellData | null> {
  const cached = await getLatestPoint('idx_short_sell_volume_idr_bn');
  if (cached) {
    const ageDays = (Date.now() - new Date(cached.fetchedAt).getTime()) / 86_400_000;
    if (ageDays < FRESHNESS_DAYS) {
      const pctPt = await getLatestPoint('idx_short_sell_pct_volume');
      return {
        date: cached.date,
        volumeIdrBn: cached.value,
        pctOfTotalVolume: pctPt?.value ?? null,
        sourceUrl: null,
        fetchedAt: cached.fetchedAt,
      };
    }
  }

  const data = (await fetchViaExa()) ?? (await fetchViaTavily()) ?? (await fetchViaPlaywright());
  if (!data || data.volumeIdrBn === null) return null;

  const points: MacroDataPoint[] = [{
    indicator: 'idx_short_sell_volume_idr_bn',
    category: 'regime',
    date: data.date,
    value: data.volumeIdrBn,
    unit: 'bn_IDR',
    source: 'exa_media_search',
    fetchedAt: data.fetchedAt,
  }];

  if (data.pctOfTotalVolume !== null) {
    points.push({
      indicator: 'idx_short_sell_pct_volume',
      category: 'regime',
      date: data.date,
      value: data.pctOfTotalVolume,
      unit: '%',
      source: 'exa_media_search',
      fetchedAt: data.fetchedAt,
    });
  }

  await upsertPoints(points);
  return data;
}
