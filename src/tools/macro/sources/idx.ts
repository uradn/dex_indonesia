/**
 * IDX (Indonesia Stock Exchange) data scrapers.
 *
 * Foreign Net Flow: daily IDR billion foreign buy/sell balance on IDX equity market.
 * Positive = net buy (inflow). Negative = net sell (outflow).
 *
 * Primary: IDX JSON API endpoint (plain fetch, no auth required).
 * Fallback: Playwright scrape of IDX market summary page.
 *
 * Note: IDX API returns data in IDR billion. Values typically ±500–3000 IDR bn/day.
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
 * Try IDX JSON API for daily foreign net flow on equity market.
 * Returns net buy in IDR billion (positive = inflow).
 */
async function fetchIdxForeignFlowApi(): Promise<number | null> {
  // IDX trading data API — foreign investor net buy summary
  const urls = [
    'https://www.idx.co.id/primary/TradingData/GetForeignFlow?periode=1',
    'https://www.idx.co.id/umbraco/Surface/TradingData/GetForeignFlow?periode=1',
    'https://www.idx.co.id/primary/TradingData/GetForeignFlow',
    'https://www.idx.co.id/primary/StockData/GetForeignFlow?periode=1',
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: IDX_HEADERS,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) continue;
      const data = await res.json() as unknown;
      // API returns array of {Date, Buy, Sell, Net} or similar structure
      if (Array.isArray(data) && data.length > 0) {
        const latest = data[data.length - 1] as Record<string, unknown>;
        // Try common field names: Net, NetBuy, net_buy, Foreign_Net
        const net = latest['Net'] ?? latest['NetBuy'] ?? latest['net_buy'] ?? latest['Foreign_Net'];
        if (typeof net === 'number') return net / 1_000_000_000; // assume IDR, convert to IDR bn
        if (typeof net === 'string') {
          const parsed = parseFloat(net.replace(/,/g, ''));
          if (!isNaN(parsed)) return parsed / 1_000_000_000;
        }
      }
      // Try object with nested data
      if (data && typeof data === 'object') {
        const obj = data as Record<string, unknown>;
        const net = obj['Net'] ?? obj['netBuy'] ?? obj['net'];
        if (typeof net === 'number') return net / 1_000_000_000;
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
  let netBuyIdrBn = await fetchIdxForeignFlowApi();
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
    source: 'idx_scrape',
    fetchedAt: NOW(),
  };
}
