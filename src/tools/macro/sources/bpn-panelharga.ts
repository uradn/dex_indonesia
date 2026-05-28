/**
 * Badan Pangan Nasional (BPN) Panel Harga scraper — Tier 2 PIHPS fallback.
 *
 * URL: panelharga.badanpangan.go.id/harga-eceran (retail price panel)
 *
 * Both are AJAX-heavy SPAs. Strategy:
 *   1. Navigate, intercept ALL JSON responses from BPN domains
 *   2. Scan intercepted payloads for objects containing commodity name + IDR price
 *   3. Fall back to rendered page text parsing (extractPriceNearTerm)
 *
 * Main site enters maintenance periodically → dev instance tried as fallback.
 * JSON schema unknown (can't probe without live Playwright) so parser is schema-flexible.
 */
import type { MacroDataPoint } from '../types.js';
import { withBrowserPage } from './playwright-browser.js';
import { PIHPS_COMMODITIES } from './pihps.js';

const NOW = () => new Date().toISOString();
const TODAY = () => new Date().toISOString().slice(0, 10);

const TARGETS = [
  'https://panelharga.badanpangan.go.id/harga-eceran',
  'https://dev-panelharga.badanpangan.go.id/harga-eceran',
];

// Commodity name variants → PIHPS indicator (BPN may use different naming than hargapangan.id)
const BPN_NAME_MAP: Record<string, string> = {
  'beras medium':           'pihps_beras_medium_idr',
  'beras kualitas medium':  'pihps_beras_medium_idr',
  'beras kualitas medium ii': 'pihps_beras_medium_idr',
  'cabai merah keriting':   'pihps_cabai_merah_kriting_idr',
  'cabai merah kriting':    'pihps_cabai_merah_kriting_idr',
  'cabe merah keriting':    'pihps_cabai_merah_kriting_idr',
  'cabai rawit merah':      'pihps_cabai_rawit_merah_idr',
  'cabe rawit merah':       'pihps_cabai_rawit_merah_idr',
  'bawang merah':           'pihps_bawang_merah_idr',
  'bawang putih':           'pihps_bawang_putih_idr',
  'bawang putih bonggol':   'pihps_bawang_putih_idr',
  'daging sapi murni':      'pihps_daging_sapi_idr',
  'daging sapi':            'pihps_daging_sapi_idr',
  'daging sapi has':        'pihps_daging_sapi_idr',
  'daging ayam ras':        'pihps_daging_ayam_idr',
  'ayam ras segar':         'pihps_daging_ayam_idr',
  'telur ayam ras':         'pihps_telur_ayam_idr',
  'telur ayam':             'pihps_telur_ayam_idr',
  'minyak goreng curah':    'pihps_minyak_goreng_idr',
  'minyak goreng':          'pihps_minyak_goreng_idr',
  'gula pasir lokal':       'pihps_gula_pasir_idr',
  'gula pasir':             'pihps_gula_pasir_idr',
  'gula pasir premium':     'pihps_gula_pasir_idr',
};

// Walk any JSON value and collect { name, price } candidates
function extractCandidates(val: unknown, out: Array<{ name: string; price: number }>): void {
  if (!val || typeof val !== 'object') return;

  if (Array.isArray(val)) {
    for (const item of val) extractCandidates(item, out);
    return;
  }

  const obj = val as Record<string, unknown>;

  // Look for an object that has BOTH a string field (commodity name) AND a number field (price)
  const strings: string[] = [];
  const numbers: number[] = [];

  for (const v of Object.values(obj)) {
    if (typeof v === 'string' && v.length > 2 && v.length < 60) strings.push(v);
    if (typeof v === 'number' && v > 1_000 && v < 500_000) numbers.push(v);
    // Recurse into nested objects/arrays
    if (v && typeof v === 'object') extractCandidates(v, out);
  }

  // Pair each string with each candidate number
  for (const name of strings) {
    const indicator = BPN_NAME_MAP[name.toLowerCase().trim()];
    if (!indicator) continue;
    const spec = PIHPS_COMMODITIES.find(c => c.indicator === indicator);
    if (!spec) continue;
    for (const num of numbers) {
      if (num >= spec.minPrice && num <= spec.maxPrice) {
        out.push({ name: indicator, price: num });
      }
    }
  }
}

function parseIntercepted(payloads: string[]): Map<string, number> {
  const prices = new Map<string, number>();

  for (const payload of payloads) {
    let json: unknown;
    try { json = JSON.parse(payload); } catch { continue; }

    const candidates: Array<{ name: string; price: number }> = [];
    extractCandidates(json, candidates);

    for (const { name, price } of candidates) {
      // First match per indicator wins (national average usually comes first)
      if (!prices.has(name)) prices.set(name, price);
    }
  }

  return prices;
}

// Indonesian price string → number (14.750 → 14750)
function parseIndonesianPrice(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.,]/g, '').trim();
  if (!cleaned) return null;
  if (cleaned.includes(',')) {
    const val = parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
    return isNaN(val) ? null : val;
  }
  if (cleaned.includes('.')) {
    const parts = cleaned.split('.');
    const last = parts[parts.length - 1]!;
    if (last.length === 3) return parseFloat(cleaned.replace(/\./g, '')) || null;
    return parseFloat(cleaned) || null;
  }
  return parseFloat(cleaned) || null;
}

function extractPriceNearTerm(text: string, terms: string[], min: number, max: number): number | null {
  for (const term of terms) {
    const idx = text.toLowerCase().indexOf(term.toLowerCase());
    if (idx < 0) continue;
    const section = text.slice(idx, idx + 200);
    for (const m of section.matchAll(/[\d]{1,3}(?:[.,][\d]{3})*(?:[.,]\d{1,2})?/g)) {
      const val = parseIndonesianPrice(m[0]);
      if (val !== null && val >= min && val <= max) return val;
    }
  }
  return null;
}

async function scrapeUrl(url: string): Promise<MacroDataPoint[]> {
  const result = await withBrowserPage(async (page) => {
    const intercepted: string[] = [];

    page.on('response', async (response) => {
      try {
        if (!response.url().includes('badanpangan.go.id')) return;
        if (response.status() !== 200) return;
        const ct = response.headers()['content-type'] ?? '';
        if (!ct.includes('json')) return;
        const body = await response.text().catch(() => '');
        if (body.length > 20) intercepted.push(body);
      } catch { /* ignore */ }
    });

    await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
    await page.waitForTimeout(5_000);

    const pageText = await page.locator('body').innerText().catch(() => '');
    return { intercepted, pageText };
  });

  if (!result) return [];

  const today = TODAY();
  const fetchedAt = NOW();
  const out: MacroDataPoint[] = [];
  const seen = new Set<string>();

  // 1. Try AJAX-intercepted JSON payloads
  const priceMap = parseIntercepted(result.intercepted);
  for (const [indicator, price] of priceMap) {
    if (seen.has(indicator)) continue;
    const spec = PIHPS_COMMODITIES.find(c => c.indicator === indicator);
    if (!spec) continue;
    seen.add(indicator);
    out.push({ indicator, category: 'pangan', date: today, value: price, unit: spec.unit, source: 'bpn_panelharga_scrape', fetchedAt });
  }

  // 2. Text fallback for any remaining commodities
  if (result.pageText.length > 100) {
    for (const spec of PIHPS_COMMODITIES) {
      if (seen.has(spec.indicator)) continue;
      const price = extractPriceNearTerm(result.pageText, spec.searchTerms, spec.minPrice, spec.maxPrice);
      if (price !== null) {
        seen.add(spec.indicator);
        out.push({ indicator: spec.indicator, category: 'pangan', date: today, value: price, unit: spec.unit, source: 'bpn_panelharga_scrape', fetchedAt });
      }
    }
  }

  return out;
}

/**
 * Scrape BPN Panel Harga retail prices.
 * Tries main URL first, dev URL second.
 * Returns empty array if both unavailable.
 */
export async function fetchBpnPanelHarga(): Promise<MacroDataPoint[]> {
  for (const url of TARGETS) {
    const results = await scrapeUrl(url);
    if (results.length >= 3) return results;
  }
  return [];
}
