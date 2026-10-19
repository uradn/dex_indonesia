/**
 * HIMBARA AT1 Perpetual Bond Secondary Market Price Tracker
 *
 * WHY THIS MATTERS:
 *   BNI ($700M, Apr 2026) + Mandiri ($750M, Sep 2026) issued USD AT1 perpetual bonds.
 *   AT1 (Additional Tier 1) bonds are written down or converted to equity if bank CAR
 *   falls below trigger (5.125% CET1). They are LOSS-ABSORBING capital.
 *
 *   Secondary market price < 80% par = market pricing meaningful loss-absorption risk.
 *   This precedes OJK/BI official stress signals by weeks — institutional bond desks
 *   reprice before regulators act.
 *
 *   Additionally: AT1 bonds are USD-denominated. If USDIDR weakens, the IDR burden of
 *   coupon payment rises. AT1 = both credit stress AND FX mismatch signal.
 *
 * DB INDICATOR: himbara_at1_secondary_pct (price as % of par; 100 = par, 80 = stressed)
 *   Separate: himbara_at1_yield_pct (yield if parseable; >12% = distress territory)
 */

import { getLatestPoint, upsertPoints } from '../time-series-db.js';

const TODAY = () => new Date().toISOString().slice(0, 10);
const NOW = () => new Date().toISOString();
const CACHE_DAYS = 3;

export interface At1BondData {
  pricePct: number;     // price as % of par (100 = par)
  yieldPct: number | null;  // yield if parseable
  issuer: string | null;    // 'bni' | 'mandiri' | null
  sourceUrl: string | null;
  fetchedAt: string;
}

const EXA_QUERIES = [
  'BNI Bank Negara Indonesia AT1 perpetual bond price secondary market 2026',
  'Bank Mandiri perpetual bond AT1 secondary market price 2026 USD',
  'HIMBARA AT1 USD perpetual bond price cents dollar secondary 2026',
  'Indonesia bank BUMN AT1 perpetual bond secondary market price 2026',
  'BNI Mandiri perpetual bond yield secondary trading 2026',
];

const TAVILY_QUERY = 'BNI Mandiri HIMBARA AT1 perpetual bond secondary market price yield 2026 Indonesia bank';

function parseAt1Price(text: string): { pricePct: number; yieldPct: number | null; issuer: string | null } | null {
  const lower = text.toLowerCase();

  // Identify issuer
  const issuer = lower.includes('bni') || lower.includes('negara') ? 'bni'
    : lower.includes('mandiri') ? 'mandiri'
    : null;

  // Price as % of par — patterns:
  // "trading at 87.5", "price of 89", "bid at 88 cents", "87 cents on the dollar"
  // "AT1 price 91.00", "priced at 92.5%"
  const pricePatterns = [
    /(?:trading|priced?|bid|quoted?|mark(?:ed)?)\s+at\s+(\d{2,3}(?:\.\d{1,2})?)\b/i,
    /(\d{2,3}(?:\.\d{1,2})?)\s*cents?\s+on\s+the\s+dollar/i,
    /price\s+of\s+(\d{2,3}(?:\.\d{1,2})?)\b/i,
    /AT1[^0-9]{0,20}(\d{2,3}(?:\.\d{1,2})?)\s*%?\s*(?:of\s+par|par\s+value)/i,
    /perpetual[^0-9]{0,20}(\d{2,3}(?:\.\d{1,2})?)\s*(?:cents?|%)/i,
  ];

  for (const re of pricePatterns) {
    const m = text.match(re);
    if (m) {
      const val = parseFloat(m[1]!);
      if (val >= 50 && val <= 110) {
        // Try to extract yield too
        let yieldPct: number | null = null;
        const yieldMatch = text.match(/yield\s+(?:of\s+)?(\d{1,2}(?:\.\d{1,2})?)\s*%/i);
        if (yieldMatch) {
          const y = parseFloat(yieldMatch[1]!);
          if (y >= 3 && y <= 25) yieldPct = y;
        }
        return { pricePct: val, yieldPct, issuer };
      }
    }
  }

  // Yield-only fallback: convert yield → approximate price for AT1 perpetual
  // Price = coupon / yield (perpetuity). BNI coupon ~6.375%, Mandiri ~6.5%
  const yieldMatch = text.match(/AT1[^0-9]{0,30}yield[^0-9]{0,10}(\d{1,2}(?:\.\d{1,2})?)\s*%/i)
    ?? text.match(/perpetual[^0-9]{0,30}yield[^0-9]{0,10}(\d{1,2}(?:\.\d{1,2})?)\s*%/i);
  if (yieldMatch) {
    const y = parseFloat(yieldMatch[1]!);
    if (y >= 3 && y <= 25) {
      const avgCoupon = 6.4;
      const impliedPrice = Math.min(110, Math.round((avgCoupon / y) * 100));
      if (impliedPrice >= 50) return { pricePct: impliedPrice, yieldPct: y, issuer };
    }
  }

  return null;
}

async function fetchViaExa(): Promise<At1BondData | null> {
  if (!process.env.EXASEARCH_API_KEY) return null;
  try {
    const { default: Exa } = await import('exa-js');
    const exa = new Exa(process.env.EXASEARCH_API_KEY);
    const startDate = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);

    for (const query of EXA_QUERIES) {
      const response = await exa.search(query, {
        numResults: 5,
        type: 'neural',
        startPublishedDate: startDate,
        contents: { text: { maxCharacters: 2000 } },
      } as Parameters<typeof exa.search>[1]);

      for (const r of response.results ?? []) {
        const text = ((r as { text?: string }).text ?? r.title ?? '');
        const result = parseAt1Price(text);
        if (result !== null) {
          return {
            pricePct: result.pricePct,
            yieldPct: result.yieldPct,
            issuer: result.issuer,
            sourceUrl: r.url ?? null,
            fetchedAt: NOW(),
          };
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchViaTavily(): Promise<At1BondData | null> {
  if (!process.env.TAVILY_API_KEY) return null;
  try {
    const { TavilySearchAPIWrapper } = await import('@langchain/tavily');
    const tavily = new TavilySearchAPIWrapper({ tavilyApiKey: process.env.TAVILY_API_KEY });
    const response = await tavily.rawResults({
      query: TAVILY_QUERY,
      max_results: 4,
      time_range: 'month',
      include_raw_content: true,
    } as Parameters<typeof tavily.rawResults>[0]);

    for (const r of (response.results ?? [])) {
      const text = r.raw_content ?? r.content ?? '';
      const result = parseAt1Price(text);
      if (result !== null) {
        return {
          pricePct: result.pricePct,
          yieldPct: result.yieldPct,
          issuer: result.issuer,
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
 * Fetch HIMBARA AT1 perpetual bond secondary market price.
 * Returns null if not found (graceful — engine handles absence).
 * Env override: HIMBARA_AT1_SECONDARY_PCT (always wins when set; % of par).
 */
export async function fetchAt1Secondary(): Promise<At1BondData | null> {
  // Env always wins
  if (process.env.HIMBARA_AT1_SECONDARY_PCT) {
    const pct = parseFloat(process.env.HIMBARA_AT1_SECONDARY_PCT);
    if (pct >= 50 && pct <= 110) {
      return { pricePct: pct, yieldPct: null, issuer: null, sourceUrl: null, fetchedAt: NOW() };
    }
  }

  // Cache check
  const cached = await getLatestPoint('himbara_at1_secondary_pct');
  if (cached) {
    const ageDays = (Date.now() - new Date(cached.fetchedAt ?? cached.date).getTime()) / 86_400_000;
    if (ageDays < CACHE_DAYS) {
      return { pricePct: cached.value, yieldPct: null, issuer: null, sourceUrl: null, fetchedAt: cached.fetchedAt ?? cached.date };
    }
  }

  const data = await fetchViaExa() ?? await fetchViaTavily();
  if (!data) return null;

  await upsertPoints([{
    indicator: 'himbara_at1_secondary_pct',
    category: 'banking' as const,
    date: TODAY(),
    value: data.pricePct,
    unit: 'pct_par',
    source: data.sourceUrl ?? 'exa_search',
    fetchedAt: data.fetchedAt,
  }]);

  return data;
}
