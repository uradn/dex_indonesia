/**
 * IDX daily short selling volume — via Exa/Tavily media search or FlareSolverr.
 *
 * IDX publishes short selling data daily after market close.
 * IDX direct pages (idx.co.id) return Cloudflare "Attention Required" — headless Playwright
 * cannot bypass this tier (binary-level Chrome detection). FlareSolverr (undetected-chromedriver)
 * handles it when running locally.
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
 *
 * DATA SOURCE TIER ORDER:
 *   1. Env override  IDX_SHORT_SELL_VOLUME_IDR_BN — manual pin (e.g. from terminal/media)
 *   2. Exa neural    — media search (bisnis/kontan/bloombergtechnoz/cnbcindonesia/pasardana)
 *   3. Tavily        — broad Indonesian financial media fallback
 *   4. cf_clearance cache — reuse solved CF cookie from FlareSolverr (25 min TTL, ~/.dexter/cf-clearance-idx.json)
 *   5. FlareSolverr  — if FLARESOLVERR_URL set (http://localhost:8191); bypasses CF "Attention Required"
 *                      docker: docker run -p 8191:8191 ghcr.io/flaresolverr/flaresolverr:latest
 *                      After successful solve, cf_clearance cookie saved for tier 4 reuse.
 *
 * NOTE: IDX launched intraday short selling Oct 2026 — data exists from Oct 2026 onward only.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { getLatestPoint, upsertPoints } from '../time-series-db.js';
import { injectCookies } from './playwright-browser.js';
import type { MacroDataPoint } from '../types.js';

const FRESHNESS_DAYS = 5;
const NOW = () => new Date().toISOString();
const TODAY = () => new Date().toISOString().slice(0, 10);

// cf_clearance cookie cache — reuse after FlareSolverr solves CF challenge.
// Avoids re-solving on every fetch; cookies typically last 30 minutes.
const CF_CLEARANCE_PATH = (() => {
  const base = process.env.DEXTER_DATA_DIR ?? (process.env.HOME ? `${process.env.HOME}/.dexter` : '.dexter');
  return `${base}/cf-clearance-idx.json`;
})();

interface CfClearanceStore {
  cookies: string; // cookie header value: "cf_clearance=xxx; __cf_bm=yyy"
  userAgent: string;
  savedAt: string;
}

function loadCfClearance(): CfClearanceStore | null {
  try {
    if (!existsSync(CF_CLEARANCE_PATH)) return null;
    const store = JSON.parse(readFileSync(CF_CLEARANCE_PATH, 'utf-8')) as CfClearanceStore;
    const ageMins = (Date.now() - new Date(store.savedAt).getTime()) / 60_000;
    return ageMins < 25 ? store : null; // cf_clearance lasts ~30 min; use 25 min TTL
  } catch { return null; }
}

function saveCfClearance(cookies: string, userAgent: string): void {
  try {
    const dir = CF_CLEARANCE_PATH.slice(0, CF_CLEARANCE_PATH.lastIndexOf('/'));
    mkdirSync(dir, { recursive: true });
    const store: CfClearanceStore = { cookies, userAgent, savedAt: NOW() };
    writeFileSync(CF_CLEARANCE_PATH, JSON.stringify(store, null, 2), 'utf-8');
  } catch { /* ignore */ }
}

const IDX_SHORT_SELL_URL = 'https://www.idx.co.id/en/market-data/stock-data/short-selling/';

const IDX_SS_DOMAINS = [
  'bloombergtechnoz.com', 'bisnis.com', 'kontan.co.id',
  'cnbcindonesia.com', 'pasardana.id', 'detik.com', 'kompas.com',
];

// Broad query: cover both media articles AND IDX trading summary recaps
const IDX_SS_QUERY =
  'IDX BEI "short selling" volume nilai transaksi total harian miliar IDR ' +
  'OR "ringkasan perdagangan" "short selling" BEI ' +
  'OR "rekap transaksi" "short selling" bursa efek indonesia ' +
  'OR "transaksi short sell" BEI miliar';

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

  // Volume patterns — IDR billions (narrative text from media articles)
  let volumeIdrBn = matchNum(text,
    /short.?sell(?:ing)?\s+(?:sebesar\s+)?Rp\s*([\d.,]+)\s*(?:miliar|billion)/i,
    /transaksi\s+short.?sell(?:ing)?\s+(?:mencapai\s+)?Rp\s*([\d.,]+)\s*(?:miliar|billion)/i,
    /short.?sell(?:ing)?\s+(?:volume\s+)?(?:senilai\s+)?Rp\s*([\d.,]+)\s*(?:miliar|billion)/i,
    /nilai\s+short.?sell(?:ing)?\s+Rp\s*([\d.,]+)\s*(?:miliar|billion)/i,
    /nilai\s+transaksi\s+short.?sell(?:ing)?[^.]*?([\d.,]+)\s*(?:miliar|Miliar)/i,
  );

  // Trillion IDR → convert to bn
  const volumeTrn = matchNum(text,
    /short.?sell(?:ing)?\s+(?:sebesar\s+)?Rp\s*([\d.,]+)\s*triliun/i,
    /transaksi\s+short.?sell(?:ing)?[^.]*?Rp\s*([\d.,]+)\s*triliun/i,
    /nilai\s+transaksi\s+short.?sell(?:ing)?[^.]*?([\d.,]+)\s*(?:triliun|Triliun)/i,
  );
  if (volumeTrn !== null && volumeIdrBn === null) {
    volumeIdrBn = volumeTrn * 1000;
  }

  // IDX page table format: "Nilai Transaksi Short Selling (Juta Rp)" column — convert juta→bn
  // Table cells appear as bare numbers after HTML stripping: look for large round numbers near SS context
  if (volumeIdrBn === null) {
    const jutaMatch = matchNum(text,
      /nilai\s+transaksi\s+short\s+selling[^0-9]*([\d.,]+)\s*(?:juta|Juta)/i,
      /short\s+selling[^0-9]{0,30}([\d.,]+)\s*(?:juta|Juta)/i,
    );
    if (jutaMatch !== null) volumeIdrBn = jutaMatch / 1000; // juta → bn
  }

  // Sanity: IDX daily short selling typically 10–50,000 IDR bn
  if (volumeIdrBn !== null && (volumeIdrBn < 1 || volumeIdrBn > 100_000)) volumeIdrBn = null;

  // Percentage of total volume
  const pctOfTotalVolume = matchNum(text,
    /short.?sell(?:ing)?[^.]*?([\d.,]+)\s*%\s+(?:dari\s+total|of\s+total)/i,
    /porsi\s+short.?sell(?:ing)?[^.]*?([\d.,]+)\s*%/i,
    /short.?sell(?:ing)?[^.]*?(?:porsi|bagian)[^.]*?([\d.,]+)\s*%/i,
  );

  return { volumeIdrBn, pctOfTotalVolume };
}

async function fetchViaExa(): Promise<IdxShortSellData | null> {
  if (!process.env.EXASEARCH_API_KEY) return null;
  try {
    const { default: Exa } = await import('exa-js');
    const exa = new Exa(process.env.EXASEARCH_API_KEY);
    const startDate = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

    // First: targeted media domains; fallback to open search (new IDX feature — thin coverage)
    let results: typeof r1.results = [];
    const r1 = await exa.search(IDX_SS_QUERY, {
      numResults: 5,
      type: 'auto',
      startPublishedDate: startDate,
      includeDomains: IDX_SS_DOMAINS,
      contents: { text: { maxCharacters: 3000 } },
    } as Parameters<typeof exa.search>[1]);
    results = r1.results ?? [];
    if (results.every(r => parseShortSellText((r as { text?: string }).text ?? r.title ?? '').volumeIdrBn === null)) {
      const r2 = await exa.search(IDX_SS_QUERY, {
        numResults: 5,
        type: 'auto',
        startPublishedDate: startDate,
        contents: { text: { maxCharacters: 3000 } },
      } as Parameters<typeof exa.search>[1]);
      results = [...results, ...(r2.results ?? [])];
    }
    const response = { results };

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

async function fetchViaTavily(): Promise<IdxShortSellData | null> {
  if (!process.env.TAVILY_API_KEY) return null;
  try {
    const { TavilySearchAPIWrapper } = await import('@langchain/tavily');
    const tavily = new TavilySearchAPIWrapper({ tavilyApiKey: process.env.TAVILY_API_KEY });

    const response = await tavily.rawResults({
      query: IDX_SS_QUERY,
      max_results: 5,
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
 * Plain fetch using cached cf_clearance cookie — avoids FlareSolverr re-solve.
 * Works only while the 25-minute TTL cache is valid (cf_clearance lasts ~30 min).
 */
async function fetchViaCachedClearance(): Promise<IdxShortSellData | null> {
  const store = loadCfClearance();
  if (!store) return null;
  try {
    const res = await fetch(IDX_SHORT_SELL_URL, {
      headers: {
        'User-Agent': store.userAgent,
        'Cookie': store.cookies,
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    // If CF served a challenge page instead of the real page, bail
    if (html.includes('Just a moment') || html.includes('Attention Required') || html.length < 500) return null;
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ');
    const parsed = parseShortSellText(text);
    if (parsed.volumeIdrBn === null) return null;
    return { date: TODAY(), ...parsed, sourceUrl: IDX_SHORT_SELL_URL, fetchedAt: NOW() };
  } catch { return null; }
}

/**
 * FlareSolverr bypass — handles Cloudflare "Attention Required" (binary-level CF detection).
 * Requires FLARESOLVERR_URL env (e.g. http://localhost:8191).
 * Run: docker run -p 8191:8191 ghcr.io/flaresolverr/flaresolverr:latest
 * Saves cf_clearance cookie to cache after successful solve; reused by fetchViaCachedClearance().
 */
async function fetchViaFlareSolverr(): Promise<IdxShortSellData | null> {
  const solverrUrl = process.env.FLARESOLVERR_URL?.replace(/\/$/, '');
  if (!solverrUrl) return null;
  try {
    const res = await fetch(`${solverrUrl}/v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cmd: 'request.get',
        url: IDX_SHORT_SELL_URL,
        maxTimeout: 60000,
      }),
      signal: AbortSignal.timeout(70_000),
    });
    if (!res.ok) return null;
    const json = await res.json() as {
      solution?: {
        response?: string;
        status?: number;
        cookies?: Array<{ name: string; value: string }>;
        userAgent?: string;
      };
    };
    const html = json.solution?.response;
    if (!html || html.length < 500) return null;

    // Cache cf_clearance for (a) plain-fetch reuse and (b) Playwright context injection
    const rawCookies = json.solution?.cookies ?? [];
    if (rawCookies.length > 0) {
      const cookieHeader = rawCookies.map(c => `${c.name}=${c.value}`).join('; ');
      const ua = json.solution?.userAgent ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
      saveCfClearance(cookieHeader, ua);
      // Inject into Playwright context + disk store → idx.ts / ihsg.ts Playwright tiers reuse clearance
      void injectCookies(rawCookies);
    }

    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ');
    const parsed = parseShortSellText(text);
    if (parsed.volumeIdrBn === null) return null;
    return { date: TODAY(), ...parsed, sourceUrl: IDX_SHORT_SELL_URL, fetchedAt: NOW() };
  } catch {
    return null;
  }
}

/**
 * Fetch IDX daily short selling volume. 2-day freshness gate.
 * Returns null if no data found (all sources exhausted).
 */
export async function fetchIdxShortSelling(): Promise<IdxShortSellData | null> {
  // Freshness gate
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

  // Env override — manual pin (DNDF pattern); wins over all auto-fetch
  const envOverride = process.env.IDX_SHORT_SELL_VOLUME_IDR_BN;
  if (envOverride) {
    const v = parseFloat(envOverride);
    if (!isNaN(v) && v > 0) {
      const pt: MacroDataPoint = {
        indicator: 'idx_short_sell_volume_idr_bn',
        category: 'regime',
        date: TODAY(),
        value: v,
        unit: 'bn_IDR',
        source: 'env_manual',
        fetchedAt: NOW(),
      };
      await upsertPoints([pt]);
      return { date: TODAY(), volumeIdrBn: v, pctOfTotalVolume: null, sourceUrl: null, fetchedAt: NOW() };
    }
  }

  // Auto-fetch tier: Exa → Tavily → cf_clearance cache → FlareSolverr (if FLARESOLVERR_URL set)
  const data = (await fetchViaExa()) ?? (await fetchViaTavily()) ?? (await fetchViaCachedClearance()) ?? (await fetchViaFlareSolverr());
  if (!data || data.volumeIdrBn === null) return null;

  const source = process.env.EXASEARCH_API_KEY || process.env.TAVILY_API_KEY
    ? 'exa_media_search'
    : process.env.FLARESOLVERR_URL
      ? 'flaresolverr'
      : 'cf_clearance_cache';

  const points: MacroDataPoint[] = [{
    indicator: 'idx_short_sell_volume_idr_bn',
    category: 'regime',
    date: data.date,
    value: data.volumeIdrBn,
    unit: 'bn_IDR',
    source,
    fetchedAt: data.fetchedAt,
  }];

  if (data.pctOfTotalVolume !== null) {
    points.push({
      indicator: 'idx_short_sell_pct_volume',
      category: 'regime',
      date: data.date,
      value: data.pctOfTotalVolume,
      unit: '%',
      source,
      fetchedAt: data.fetchedAt,
    });
  }

  await upsertPoints(points);
  return data;
}
