/**
 * PIHPS — Pusat Informasi Harga Pangan Strategis (BPS/Bappenas)
 * Source: hargapangan.id (daily), Trading Economics food inflation (monthly fallback)
 *
 * Primary:  hargapangan.id Playwright scrape → 10 strategic commodity prices in IDR
 * Tier 1B:  bi.go.id/hargapangan Playwright scrape (BI-hosted mirror, AJAX-loaded)
 * Fallback: Trading Economics meta scrape → aggregate food CPI YoY %
 *
 * hargapangan.id occasionally returns 522 (Cloudflare timeout). Playwright handles
 * cookie-based CF bypass. TE food inflation is the reliable fallback for the aggregate.
 *
 * Indonesian price format: 14.750 = IDR 14,750 (dot = thousand separator)
 */
import type { MacroDataPoint } from '../types.js';
import { withBrowserPage } from './playwright-browser.js';
import { fetchBpnPanelHarga } from './bpn-panelharga.js';
import { fetchKemendagEws } from './kemendag.js';

const NOW = () => new Date().toISOString();
const TODAY = () => new Date().toISOString().slice(0, 10);

// ─── Commodity specs ────────────────────────────────────────────────────────

export interface PihpsCommodity {
  label: string;        // display name
  indicator: string;    // DB indicator key
  unit: string;
  minPrice: number;     // IDR sanity floor
  maxPrice: number;     // IDR sanity ceiling
  searchTerms: string[];// text to look for near the price on the rendered page
}

export const PIHPS_COMMODITIES: PihpsCommodity[] = [
  {
    label: 'Beras Medium',
    indicator: 'pihps_beras_medium_idr',
    unit: 'IDR/kg',
    minPrice: 8_000, maxPrice: 25_000,
    searchTerms: ['Beras Medium', 'Beras Kualitas Medium'],
  },
  {
    label: 'Cabai Merah Kriting',
    indicator: 'pihps_cabai_merah_kriting_idr',
    unit: 'IDR/kg',
    minPrice: 15_000, maxPrice: 120_000,
    searchTerms: ['Cabai Merah Keriting', 'Cabai Merah Kriting', 'Cabe Merah Keriting'],
  },
  {
    label: 'Cabai Rawit Merah',
    indicator: 'pihps_cabai_rawit_merah_idr',
    unit: 'IDR/kg',
    minPrice: 20_000, maxPrice: 150_000,
    searchTerms: ['Cabai Rawit Merah', 'Cabe Rawit Merah'],
  },
  {
    label: 'Bawang Merah',
    indicator: 'pihps_bawang_merah_idr',
    unit: 'IDR/kg',
    minPrice: 15_000, maxPrice: 80_000,
    searchTerms: ['Bawang Merah'],
  },
  {
    label: 'Bawang Putih',
    indicator: 'pihps_bawang_putih_idr',
    unit: 'IDR/kg',
    minPrice: 20_000, maxPrice: 90_000,
    searchTerms: ['Bawang Putih'],
  },
  {
    label: 'Daging Sapi Murni',
    indicator: 'pihps_daging_sapi_idr',
    unit: 'IDR/kg',
    minPrice: 100_000, maxPrice: 200_000,
    searchTerms: ['Daging Sapi Murni', 'Daging Sapi'],
  },
  {
    label: 'Daging Ayam Ras',
    indicator: 'pihps_daging_ayam_idr',
    unit: 'IDR/kg',
    minPrice: 25_000, maxPrice: 75_000,
    searchTerms: ['Daging Ayam Ras', 'Ayam Ras Segar'],
  },
  {
    label: 'Telur Ayam Ras',
    indicator: 'pihps_telur_ayam_idr',
    unit: 'IDR/kg',
    minPrice: 20_000, maxPrice: 50_000,
    searchTerms: ['Telur Ayam Ras', 'Telur Ayam'],
  },
  {
    label: 'Minyak Goreng Curah',
    indicator: 'pihps_minyak_goreng_idr',
    unit: 'IDR/liter',
    minPrice: 12_000, maxPrice: 30_000,
    searchTerms: ['Minyak Goreng Curah', 'Minyak Goreng'],
  },
  {
    label: 'Gula Pasir Lokal',
    indicator: 'pihps_gula_pasir_idr',
    unit: 'IDR/kg',
    minPrice: 10_000, maxPrice: 30_000,
    searchTerms: ['Gula Pasir Lokal', 'Gula Pasir'],
  },
];

// ─── hargapangan.id Playwright scraper ────────────────────────────────────

/** Convert Indonesian number string to float (14.750 → 14750, 1.500,50 → 1500.50) */
function parseIndonesianPrice(raw: string): number | null {
  // Strip currency symbols and whitespace
  const cleaned = raw.replace(/[^\d.,]/g, '').trim();
  if (!cleaned) return null;

  // If contains comma, treat comma as decimal separator, dots as thousands
  // e.g. "14.750,50" → 14750.50
  if (cleaned.includes(',')) {
    const val = parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
    return isNaN(val) ? null : val;
  }

  // No comma — dots are thousand separators if value would be >10,000 without them
  // e.g. "14.750" → 14750 (not 14.75)
  if (cleaned.includes('.')) {
    const parts = cleaned.split('.');
    const lastPart = parts[parts.length - 1]!;
    // If last segment has 3 digits, it's a thousand separator
    if (lastPart.length === 3) {
      const val = parseFloat(cleaned.replace(/\./g, ''));
      return isNaN(val) ? null : val;
    }
    // Otherwise treat as decimal
    const val = parseFloat(cleaned);
    return isNaN(val) ? null : val;
  }

  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

function extractPriceNearTerm(text: string, terms: string[], minPrice: number, maxPrice: number): number | null {
  for (const term of terms) {
    const idx = text.toLowerCase().indexOf(term.toLowerCase());
    if (idx < 0) continue;

    // Search for a price in the 200 chars after the term
    const section = text.slice(idx, idx + 200);

    // Match numbers with optional dots/commas: e.g. "14.750" or "14,750" or "14750"
    const matches = section.matchAll(/[\d]{1,3}(?:[.,][\d]{3})*(?:[.,]\d{1,2})?/g);
    for (const m of matches) {
      const val = parseIndonesianPrice(m[0]);
      if (val !== null && val >= minPrice && val <= maxPrice) {
        return val;
      }
    }
  }
  return null;
}

/** Scrape hargapangan.id via Playwright. Returns empty array on failure. */
async function fetchPihpsHargapangan(): Promise<MacroDataPoint[]> {
  const text = await withBrowserPage(async (page) => {
    await page.goto('https://hargapangan.id', { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForTimeout(3_000);
    return page.locator('body').innerText();
  });

  if (!text) return [];

  const today = TODAY();
  const fetchedAt = NOW();
  const results: MacroDataPoint[] = [];

  for (const spec of PIHPS_COMMODITIES) {
    const price = extractPriceNearTerm(text, spec.searchTerms, spec.minPrice, spec.maxPrice);
    if (price !== null) {
      results.push({
        indicator: spec.indicator,
        category: 'pangan',
        date: today,
        value: price,
        unit: spec.unit,
        source: 'hargapangan_id_scrape',
        fetchedAt,
      });
    }
  }

  return results;
}

/**
 * Tier 1B fallback: scrape BI-hosted PIHPS mirror at bi.go.id/hargapangan.
 * Page is AJAX-driven (ASP.NET ScriptManager). Strategy:
 *   1. Intercept any JSON responses from BI domain for price data
 *   2. Parse rendered page text with extractPriceNearTerm() as safety net
 * Longer timeout than hargapangan.id — BI AJAX is slower.
 */
async function fetchPihpsBi(): Promise<MacroDataPoint[]> {
  const combined = await withBrowserPage(async (page) => {
    const captured: string[] = [];

    // Intercept AJAX JSON responses — BI PIHPS loads via ScriptManager endpoints
    page.on('response', async (response) => {
      try {
        if (!response.url().includes('bi.go.id')) return;
        if (response.status() !== 200) return;
        const ct = response.headers()['content-type'] ?? '';
        if (!ct.includes('json') && !ct.includes('text')) return;
        const body = await response.text().catch(() => '');
        // Only keep responses that look like they contain price data (IDR numbers)
        if (body.length > 50 && /\d{4,}/.test(body)) {
          captured.push(body);
        }
      } catch { /* ignore */ }
    });

    // BI pages can be slow + AJAX may need full network quiet
    await page.goto('https://www.bi.go.id/hargapangan', { waitUntil: 'networkidle', timeout: 45_000 });
    await page.waitForTimeout(5_000);

    const pageText = await page.locator('body').innerText().catch(() => '');
    // Combine AJAX payload text + rendered page text so extractPriceNearTerm hits both
    return [...captured, pageText].join(' ');
  });

  if (!combined || combined.trim().length < 50) return [];

  const today = TODAY();
  const fetchedAt = NOW();
  const results: MacroDataPoint[] = [];

  for (const spec of PIHPS_COMMODITIES) {
    const price = extractPriceNearTerm(combined, spec.searchTerms, spec.minPrice, spec.maxPrice);
    if (price !== null) {
      results.push({
        indicator: spec.indicator,
        category: 'pangan',
        date: today,
        value: price,
        unit: spec.unit,
        source: 'bi_pihps_scrape',
        fetchedAt,
      });
    }
  }

  return results;
}

/**
 * Fetch 10 PIHPS commodity prices. Fallback chain:
 *   Tier 1A: hargapangan.id (primary, daily)
 *   Tier 1B: bi.go.id/hargapangan (BI-hosted PIHPS mirror, AJAX)
 *   Tier 2:  panelharga.badanpangan.go.id (BPN Panel Harga retail, AJAX)
 *   Tier 3:  Kemendag EWS SP2KP API (requires KEMENDAG_API_KEY)
 */
export async function fetchPihpsCommodities(): Promise<MacroDataPoint[]> {
  const primary = await fetchPihpsHargapangan();
  if (primary.length >= 5) return primary;

  const bi = await fetchPihpsBi();
  if (bi.length >= 5) return bi;

  const bpn = await fetchBpnPanelHarga();
  if (bpn.length >= 5) return bpn;

  // All Playwright sources failed — try Kemendag REST API
  const kemendag = await fetchKemendagEws();
  if (kemendag.length > 0) return kemendag;

  // Return best partial data available
  return [primary, bi, bpn].reduce((best, cur) => cur.length > best.length ? cur : best, []);
}

// ─── Trading Economics food inflation fallback ─────────────────────────────

/**
 * Fetch Indonesia aggregate food inflation YoY % from Trading Economics.
 * Plain HTML meta scrape — no Playwright needed.
 * Pattern: "Cost of food in Indonesia increased 1.54 percent in January..."
 */
export async function fetchFoodInflationTe(): Promise<MacroDataPoint | null> {
  try {
    const res = await fetch('https://tradingeconomics.com/indonesia/food-inflation', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Primary: meta description contains the latest value
    const metaMatch = html.match(/Cost of food in Indonesia[^0-9-]*([-\d.]+)\s*percent/i);
    if (metaMatch) {
      const value = parseFloat(metaMatch[1]!);
      if (!isNaN(value) && value > -20 && value < 50) {
        return {
          indicator: 'food_inflation_yoy_pct',
          category: 'pangan',
          date: TODAY(),
          value: parseFloat(value.toFixed(2)),
          unit: '%_yoy',
          source: 'trading_economics_scrape',
          fetchedAt: NOW(),
        };
      }
    }

    // Fallback: find TESymbol and last value in script tags
    const symMatch = html.match(/TESymbol\s*=\s*['"]INDONESIAFOOINF['"]/);
    const lastMatch = html.match(/"last"\s*:\s*([-\d.]+)[^}]*INDONESIAFOOINF/);
    if (symMatch && lastMatch) {
      const value = parseFloat(lastMatch[1]!);
      if (!isNaN(value) && value > -20 && value < 50) {
        return {
          indicator: 'food_inflation_yoy_pct',
          category: 'pangan',
          date: TODAY(),
          value: parseFloat(value.toFixed(2)),
          unit: '%_yoy',
          source: 'trading_economics_scrape',
          fetchedAt: NOW(),
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}
