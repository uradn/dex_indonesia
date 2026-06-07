/**
 * IDX (Indonesia Stock Exchange) data scrapers.
 *
 * Foreign Net Flow: daily IDR billion foreign buy/sell balance on IDX equity market.
 * Positive = net buy (inflow). Negative = net sell (outflow).
 *
 * Source priority:
 *   1. CNBC Indonesia market page (cnbcindonesia.com — plain fetch, daily close headline)
 *   2. EODHD macro indicator API (eodhd.com — requires EODHD_API_KEY; no foreign-flow series currently)
 *   3. IDX JSON API endpoints (idx.co.id — frequently 403)
 *   4. IDX market summary Playwright scrape (idx.co.id — JS-rendered, last resort)
 *
 * Note: values in IDR billion. Typical daily range ±500–3000 IDR bn.
 * Monthly cumulative > -5000 IDR bn = significant exit signal.
 */
import type { MacroDataPoint } from '../types.js';
import { fetchRenderedTextWithBrowser } from './playwright-browser.js';

const NOW = () => new Date().toISOString();
const TODAY = () => new Date().toISOString().slice(0, 10);

const IDX_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/html, */*',
  'Referer': 'https://www.idx.co.id/',
};

/**
 * CNBC Indonesia market page scrape — primary source.
 * cnbcindonesia.com/market publishes daily end-of-session foreign net buy/sell
 * in article headlines, e.g. "Tutup Perdagangan dengan Net Sell Rp1,27 T".
 * Plain fetch, no Playwright, no auth required.
 *
 * Sign convention: Net Sell → negative IDR bn. Net Buy → positive IDR bn.
 * Indonesian number format: comma = decimal separator ("1,27" = 1.27 trillion).
 */
async function fetchIdxForeignFlowCnbcIndonesia(): Promise<number | null> {
  try {
    const res = await fetch('https://www.cnbcindonesia.com/market', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*',
        'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Extract candidate strings from dtr-ttl attributes and h2 text nodes.
    // Target: end-of-session aggregate articles, e.g.:
    //   "Tutup Perdagangan dengan Net Sell Rp1,27 T"
    //   "Asing Net Buy Rp0,83 T di Sesi Penutupan"
    const candidates: string[] = [];
    const attrMatches = html.matchAll(/dtr-ttl="([^"]*(?:net\s+(?:sell|buy)|net\s+asing)[^"]*)"/gi);
    for (const m of attrMatches) candidates.push(m[1]!);
    const h2Matches = html.matchAll(/<h2[^>]*>([^<]*(?:net\s+(?:sell|buy)|net\s+asing)[^<]*)<\/h2>/gi);
    for (const m of h2Matches) candidates.push(m[1]!);

    // Parse "Net Sell Rp1,27 T" or "Net Buy Rp0,83 T"
    // Indonesian decimal: comma ("1,27" = 1.27). Thousand sep: dot ("1.270" = 1270).
    for (const candidate of candidates) {
      const m = candidate.match(/Net\s+(Sell|Buy)\s+Rp([\d.,]+)\s*T/i);
      if (!m) continue;
      const isSell = m[1]!.toLowerCase() === 'sell';
      // Normalize: remove dot thousand-sep, replace comma decimal with dot
      const normalized = m[2]!.replace(/\./g, '').replace(',', '.');
      const val = parseFloat(normalized);
      if (isNaN(val) || val <= 0 || val > 50) continue; // sanity: 0–50 trillion range
      const idrBn = val * 1000;
      return isSell ? -idrBn : idrBn;
    }
  } catch { /* fall through */ }
  return null;
}

/**
 * EODHD macro indicator fallback.
 * EODHD does not currently publish an IDX foreign-flow series; returns null.
 * Placeholder: if EODHD adds the series, set EODHD_FOREIGN_FLOW_INDICATOR here.
 */
async function fetchIdxForeignFlowEodhd(): Promise<number | null> {
  const key = process.env.EODHD_API_KEY;
  if (!key) return null;
  // No known EODHD series for IDX daily foreign net flow as of 2026.
  // Kept as fallback slot; returns null to pass through to IDX sources.
  return null;
}

/**
 * Try IDX JSON API for daily foreign net flow on equity market.
 * Returns net buy in IDR billion (positive = inflow).
 */
async function fetchIdxForeignFlowApi(): Promise<number | null> {
  // IDX TradingSummary API — foreign investor net buy summary
  // Note: old TradingData/StockData prefixes return 503; TradingSummary is current.
  const urls = [
    'https://www.idx.co.id/primary/TradingSummary/GetForeignSummary?length=5&start=0',
    'https://www.idx.co.id/primary/TradingSummary/GetForeignFlow?length=5&start=0',
    'https://www.idx.co.id/primary/TradingSummary/GetForeignSummary',
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: IDX_HEADERS,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) continue;
      const data = await res.json() as unknown;

      // TradingSummary returns {data: [...], recordsTotal: N}
      const rows = Array.isArray(data)
        ? data
        : (data as Record<string, unknown>)?.['data'] as unknown[] | undefined;

      if (Array.isArray(rows) && rows.length > 0) {
        const latest = rows[rows.length - 1] as Record<string, unknown>;
        // Field names: SellValue/BuyValue (IDR), or Net/NetBuy/NetValue
        const net = latest['Net'] ?? latest['NetBuy'] ?? latest['net_buy'] ?? latest['Foreign_Net'] ?? latest['NetValue'];
        const buy = latest['BuyValue'] ?? latest['Buy'];
        const sell = latest['SellValue'] ?? latest['Sell'];

        if (typeof net === 'number' && Math.abs(net) > 0) {
          // TradingSummary values are in IDR (not already in bn) if >1e9, else already in bn
          return Math.abs(net) > 1e6 ? net / 1_000_000_000 : net;
        }
        if (typeof buy === 'number' && typeof sell === 'number') {
          const netVal = buy - sell;
          return Math.abs(netVal) > 1e6 ? netVal / 1_000_000_000 : netVal;
        }
        if (typeof net === 'string') {
          const parsed = parseFloat(net.replace(/,/g, ''));
          if (!isNaN(parsed)) return Math.abs(parsed) > 1e6 ? parsed / 1_000_000_000 : parsed;
        }
      }
    } catch { /* try next */ }
  }
  return null;
}

/**
 * Playwright fallback: parse IDX market summary page for foreign investor section.
 * IDX shows foreign net buy/sell in IDR trillion — converts to IDR billion.
 */
async function fetchIdxForeignFlowPlaywright(): Promise<number | null> {
  // Try both English and Indonesian market summary pages
  for (const url of [
    'https://www.idx.co.id/en/market-data/market-summary/',
    'https://www.idx.co.id/id/data-pasar/ringkasan-perdagangan/',
  ]) {
    const text = await fetchRenderedTextWithBrowser(url);
    if (!text) continue;

    // Pattern: "Foreign Net Buy/Sell  +1.23 T" or "-0.56 T" (IDR trillion)
    // IDX shows values like: "Net Beli Asing: -0.56T" or "Foreign Net: +1.23T"
    const patterns = [
      /Foreign\s+Net\s+(?:Buy|Sell)?\s*[:\s]\s*([+-]?[\d,]+\.?\d*)\s*T(?:rillion)?/i,
      /Net\s+(?:Beli|Jual)?\s*Asing\s*[:\s]\s*([+-]?[\d,]+\.?\d*)\s*T/i,
      /Asing\s+Net\s*[:\s]\s*([+-]?[\d,]+\.?\d*)\s*(?:T|Trn|IDR)?/i,
      /Foreign\s+Net\s+([+-]?[\d,]+\.?\d*)\s*(?:T|Trillion|IDR)/i,
    ];

    for (const pat of patterns) {
      const m = text.match(pat);
      if (m) {
        const val = parseFloat(m[1]!.replace(/,/g, ''));
        if (!isNaN(val) && Math.abs(val) < 50) { // T = trillion, typical ±3T/day max
          return val * 1000; // convert IDR trillion → IDR billion
        }
      }
    }

    // Fallback: "Buy: Rp X.XXt  Sell: Rp X.XXt" → compute net
    const buyMatch = text.match(/(?:Buy|Beli).*?(?:Rp\s*)?([\d.]+)\s*[tT]/);
    const sellMatch = text.match(/(?:Sell|Jual).*?(?:Rp\s*)?([\d.]+)\s*[tT]/);
    if (buyMatch && sellMatch) {
      const buy = parseFloat(buyMatch[1]!);
      const sell = parseFloat(sellMatch[1]!);
      if (!isNaN(buy) && !isNaN(sell) && buy < 50 && sell < 50) {
        return (buy - sell) * 1000; // net in IDR billion
      }
    }

    // Last resort: look for "Foreign Net" label and first number after it
    const fnIdx = text.toLowerCase().indexOf('foreign net');
    if (fnIdx >= 0) {
      const section = text.slice(fnIdx, fnIdx + 300);
      const numMatch = section.match(/([+-]?[\d,]+\.?\d+)\s*(?:T|Trn|IDR)?/);
      if (numMatch) {
        const val = parseFloat(numMatch[1]!.replace(/,/g, ''));
        if (!isNaN(val)) {
          // Heuristic: if value <50, likely trillion; if <50000, likely billion
          if (Math.abs(val) < 50) return val * 1000;
          if (Math.abs(val) < 50_000) return val;
        }
      }
    }
  }

  return null;
}

/**
 * Fetch IDX daily foreign equity net flow.
 * Returns MacroDataPoint with indicator 'idx_foreign_net_buy_idr_bn'.
 * Positive = net inflow (foreigners buying). Negative = net outflow (foreigners selling).
 */
export async function fetchIdxForeignNetFlow(): Promise<MacroDataPoint | null> {
  // Priority: RTI Business → EODHD → IDX API → IDX Playwright
  let netBuyIdrBn: number | null = null;
  let source = 'idx_scrape';

  netBuyIdrBn = await fetchIdxForeignFlowCnbcIndonesia();
  if (netBuyIdrBn !== null) { source = 'cnbc_indonesia'; }

  if (netBuyIdrBn === null) {
    netBuyIdrBn = await fetchIdxForeignFlowEodhd();
    if (netBuyIdrBn !== null) { source = 'eodhd'; }
  }

  if (netBuyIdrBn === null) {
    netBuyIdrBn = await fetchIdxForeignFlowApi();
  }

  if (netBuyIdrBn === null) {
    netBuyIdrBn = await fetchIdxForeignFlowPlaywright();
  }

  if (netBuyIdrBn === null) return null;

  return {
    indicator: 'idx_foreign_net_buy_idr_bn',
    category: 'flow',
    date: TODAY(),
    value: parseFloat(netBuyIdrBn.toFixed(2)),
    unit: 'IDR_bn',
    source,
    fetchedAt: NOW(),
  };
}
