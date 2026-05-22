/**
 * Bank Indonesia (BI) public data sources.
 *
 * BI does not publish a clean public REST API. Data is scraped from:
 * - bi.go.id statistical tables (FX reserves, SRBI, SBN ownership)
 * - BI Rate endpoint (7-Day Reverse Repo Rate)
 *
 * Monthly data — expect 4-6 week lag from reference period.
 */
import type { MacroDataPoint } from '../types.js';

const NOW = () => new Date().toISOString();
const TODAY = () => new Date().toISOString().slice(0, 10);

// BI publishes FX reserves monthly in its monetary statistics.
// This page returns an HTML table parseable via regex.
const BI_RESERVES_URL =
  'https://www.bi.go.id/en/statistik/ekonomi-keuangan/seki/Default.aspx?seki=I1';

// BI API for exchange rates (official mid-rate published daily)
const BI_EXCHANGE_RATE_URL = 'https://www.bi.go.id/biwebservice/wsclient.asmx/getKursLengkap';

// DJPPR (Treasury) publishes SBN foreign ownership daily
const DJPPR_OWNERSHIP_URL = 'https://www.djppr.kemenkeu.go.id/page/load/dataKepemilikanSBN';

async function fetchText(url: string, timeoutMs = 10_000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Fetch FX reserves from BI website.
 * Returns the latest available monthly figure (bn USD).
 */
export async function fetchBiFxReserves(): Promise<MacroDataPoint | null> {
  // Try BI's SEKI table I1 (international reserves)
  const html = await fetchText(BI_RESERVES_URL);
  if (!html) return null;

  // BI table typically shows values in millions USD — we convert to bn
  // Pattern: find decimal numbers near "reserve" context
  const matches = html.match(/(\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d+)?)\s*(?:million|juta)/gi);
  if (!matches || matches.length === 0) return null;

  // Extract first large number (reserves are typically 100,000-200,000 million USD)
  for (const m of matches) {
    const numStr = m.replace(/[^\d.]/g, '');
    const value = parseFloat(numStr);
    if (value > 50_000 && value < 500_000) {
      // Plausible reserve value in million USD
      return {
        indicator: 'bi_fx_reserves_bn',
        category: 'fx',
        date: TODAY(),
        value: value / 1000, // convert to bn USD
        unit: 'bn_USD',
        source: 'bi_website',
        fetchedAt: NOW(),
      };
    }
  }
  return null;
}

/**
 * Fetch BI official IDR/USD mid-rate.
 */
export async function fetchBiOfficialRate(): Promise<MacroDataPoint | null> {
  try {
    const html = await fetchText(BI_EXCHANGE_RATE_URL);
    if (!html) return null;
    const match = html.match(/<middle>([\d.]+)<\/middle>/i);
    if (!match) return null;
    const value = parseFloat(match[1]);
    if (!value || value < 10_000 || value > 25_000) return null;
    return {
      indicator: 'usdidr_bi_official',
      category: 'fx',
      date: TODAY(),
      value,
      unit: 'IDR/USD',
      source: 'bi_official',
      fetchedAt: NOW(),
    };
  } catch {
    return null;
  }
}

/**
 * Fetch SBN foreign ownership from DJPPR.
 * Returns percentage of total SBN held by foreigners.
 */
export async function fetchSbnForeignOwnership(): Promise<MacroDataPoint | null> {
  const html = await fetchText(DJPPR_OWNERSHIP_URL, 15_000);
  if (!html) return null;

  // DJPPR table: look for foreign ownership percentage (typically 15-30%)
  const pctMatch = html.match(/asing[^>]*>[\s\S]*?(\d{1,2}[.,]\d{1,2})[\s%]/i);
  if (!pctMatch) return null;
  const pct = parseFloat(pctMatch[1].replace(',', '.'));
  if (!pct || pct < 5 || pct > 60) return null;
  return {
    indicator: 'sbn_foreign_ownership_pct',
    category: 'sovereign',
    date: TODAY(),
    value: pct,
    unit: '%',
    source: 'djppr',
    fetchedAt: NOW(),
  };
}

/**
 * Fetch SRBI (Sekuritas Rupiah Bank Indonesia) outstanding.
 * SRBI is BI's sterilization instrument — growing outstanding signals BI absorbing excess liquidity.
 * Falls back to web_fetch scraping of BI website if direct parse fails.
 */
export async function fetchSrbiOutstanding(): Promise<MacroDataPoint | null> {
  // SRBI data is published on BI's money market statistics page
  const SRBI_URL = 'https://www.bi.go.id/en/statistik/ekonomi-keuangan/pasar-uang/Default.aspx';
  const html = await fetchText(SRBI_URL, 15_000);
  if (!html) return null;

  // Look for SRBI outstanding in trillion IDR (typically 500-1500 trn)
  const matches = html.match(/SRBI[\s\S]{0,200}?(\d{2,4}(?:[.,]\d+)?)\s*(?:triliun|T(?:rn)?|trillion)/i);
  if (!matches) return null;
  const value = parseFloat(matches[1].replace(',', '.'));
  if (!value || value < 100 || value > 3000) return null;
  return {
    indicator: 'srbi_outstanding_trn_idr',
    category: 'fx',
    date: TODAY(),
    value,
    unit: 'trn_IDR',
    source: 'bi_website',
    fetchedAt: NOW(),
  };
}
