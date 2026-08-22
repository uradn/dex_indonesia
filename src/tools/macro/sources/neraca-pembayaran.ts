/**
 * BI Neraca Pembayaran Indonesia (NPI) — quarterly current account fetcher.
 *
 * BI publishes quarterly BoP data ~6-8 weeks after quarter end:
 *   Q1 (Jan-Mar) → May/Jun | Q2 (Apr-Jun) → Aug | Q3 → Nov | Q4 → Feb
 *
 * IMF annual data lags 1-2 quarters and misses intra-year deterioration.
 * This source captures the quarterly CAD signal in real time via Exa/Tavily.
 *
 * Indicators stored:
 *   'current_account_pct_gdp_quarterly'  — CAD as % GDP (negative = deficit)
 *   'current_account_quarterly_bn'       — CAD in USD billion (negative = deficit)
 *
 * Threshold (R&R Ch.14, Taper Tantrum 2013 calibration):
 *   >−2%  GREEN | −2% to −3% YELLOW | −3% to −4% ORANGE | <−4% RED
 *   Indonesia 2013 crisis peak: −4.4% GDP
 *   2026 Q2: −3.3% GDP → ORANGE
 *
 * Freshness gate: 30d (quarterly data, no point re-fetching more often)
 */

import { getLatestPoint, upsertPoints } from '../time-series-db.js';
import type { MacroDataPoint } from '../types.js';

const NOW = () => new Date().toISOString();
const FRESHNESS_DAYS = 30;

// GDP 2026 APBN constant (UU No.17/2025): Rp 25,714.2T ≈ USD 1,558B at 16,500
// Use approximate USD GDP for % calculation cross-check
const INDONESIA_GDP_2026_USD_BN = 1400; // conservative estimate at current IDR

export interface NpiQuarterlyData {
  quarter: string;           // e.g. "Q2-2026"
  cadPctGdp: number;         // negative = deficit
  cadBn: number;             // USD billion, negative = deficit
  source: 'exa_search' | 'tavily_search' | 'stale_db';
  fetchedAt: string;
}

function exaAvailable(): boolean {
  return !!(process.env.EXASEARCH_API_KEY);
}

function tavilyAvailable(): boolean {
  return !!(process.env.TAVILY_API_KEY);
}

async function searchNpi(useExa: boolean): Promise<string> {
  const query = 'neraca pembayaran indonesia transaksi berjalan defisit 2026 miliar dolar persen PDB BI';
  if (useExa) {
    const resp = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'x-api-key': process.env.EXASEARCH_API_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        numResults: 5,
        contents: { text: { maxCharacters: 1000 } },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) throw new Error(`Exa ${resp.status}`);
    const data = await resp.json() as { results?: Array<{ text?: string; title?: string }> };
    return (data.results ?? []).map(r => `${r.title ?? ''}: ${r.text ?? ''}`).join('\n');
  } else {
    const resp = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        max_results: 5,
        search_depth: 'basic',
        include_domains: ['bi.go.id', 'cnbcindonesia.com', 'bisnis.com', 'kontan.co.id', 'detik.com', 'kompas.com'],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) throw new Error(`Tavily ${resp.status}`);
    const data = await resp.json() as { results?: Array<{ content?: string; title?: string }> };
    return (data.results ?? []).map(r => `${r.title ?? ''}: ${r.content ?? ''}`).join('\n');
  }
}

/**
 * Parse CAD figures from search result text.
 * Looks for patterns like "12,5 miliar", "3,3% PDB", "USD 12.5 billion".
 */
function parseNpiText(text: string): { cadBn: number | null; cadPctGdp: number | null; quarter: string | null } {
  const lower = text.toLowerCase();

  // Quarter detection
  let quarter: string | null = null;
  const qMatch = text.match(/[Qq](\d)[- ]?(\d{4})|[Qq]uarter\s+(\d)[- ]?(\d{4})|triwulan\s+([IViv]+)[- ]?(\d{4})/i);
  if (qMatch) {
    const qNum = qMatch[1] ?? qMatch[3];
    const year = qMatch[2] ?? qMatch[4];
    if (qNum && year) quarter = `Q${qNum}-${year}`;
  }
  // Also check "april-juni" → Q2
  if (!quarter && lower.includes('april') && lower.includes('juni')) quarter = `Q2-${new Date().getFullYear()}`;
  if (!quarter && lower.includes('januari') && lower.includes('maret')) quarter = `Q1-${new Date().getFullYear()}`;
  if (!quarter && lower.includes('juli') && lower.includes('september')) quarter = `Q3-${new Date().getFullYear()}`;

  // CAD in USD billion — patterns: "12,5 miliar", "US$12,5 M", "USD 12.5 billion", "12.5 billion"
  let cadBn: number | null = null;
  const bnPatterns = [
    /US\$\s*([\d,\.]+)\s*[Mm]/,           // US$12,5 M
    /USD?\s*([\d,\.]+)\s*[Bb]illion/,     // USD 12.5 billion
    /([\d,\.]+)\s*miliar\s*(?:dolar|USD)/i, // 12,5 miliar dolar
    /defisit[^0-9]*([\d,\.]+)\s*miliar/i,  // defisit ... 12,5 miliar
  ];
  for (const pat of bnPatterns) {
    const m = text.match(pat);
    if (m) {
      const raw = m[1].replace(',', '.');
      const val = parseFloat(raw);
      if (!isNaN(val) && val > 0.5 && val < 50) { // sanity: 0.5–50B USD range
        cadBn = -Math.abs(val); // deficit = negative
        break;
      }
    }
  }

  // CAD % GDP — patterns: "3,3% PDB", "3.3% of GDP"
  let cadPctGdp: number | null = null;
  const pctPatterns = [
    /([\d,\.]+)\s*%\s*(?:dari\s*)?PDB/i,
    /([\d,\.]+)\s*%\s*(?:of\s*)?GDP/i,
    /([\d,\.]+)\s*persen\s*PDB/i,
  ];
  for (const pat of pctPatterns) {
    const m = text.match(pat);
    if (m) {
      const raw = m[1].replace(',', '.');
      const val = parseFloat(raw);
      if (!isNaN(val) && val > 0.1 && val < 10) {
        cadPctGdp = -Math.abs(val); // deficit = negative
        break;
      }
    }
  }

  // Cross-derive if one is missing
  if (cadBn !== null && cadPctGdp === null) {
    cadPctGdp = (cadBn / INDONESIA_GDP_2026_USD_BN) * 100;
  }
  if (cadPctGdp !== null && cadBn === null) {
    cadBn = (cadPctGdp / 100) * INDONESIA_GDP_2026_USD_BN;
  }

  return { cadBn, cadPctGdp, quarter };
}

export async function fetchNpiQuarterly(): Promise<NpiQuarterlyData | null> {
  // Freshness gate
  const cached = await getLatestPoint('current_account_pct_gdp_quarterly');
  if (cached) {
    const ageMs = Date.now() - new Date(cached.fetchedAt ?? cached.date).getTime();
    if (ageMs < FRESHNESS_DAYS * 86_400_000) {
      const cachedBn = await getLatestPoint('current_account_quarterly_bn');
      return {
        quarter: cached.date,
        cadPctGdp: cached.value,
        cadBn: cachedBn?.value ?? (cached.value / 100) * INDONESIA_GDP_2026_USD_BN,
        source: 'stale_db',
        fetchedAt: cached.fetchedAt ?? cached.date,
      };
    }
  }

  if (!exaAvailable() && !tavilyAvailable()) return null;

  let rawText = '';
  let source: 'exa_search' | 'tavily_search' = 'exa_search';

  try {
    if (exaAvailable()) {
      rawText = await searchNpi(true);
      source = 'exa_search';
    } else {
      rawText = await searchNpi(false);
      source = 'tavily_search';
    }
  } catch {
    if (tavilyAvailable() && exaAvailable()) {
      try {
        rawText = await searchNpi(false);
        source = 'tavily_search';
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }

  if (!rawText) return null;

  const { cadBn, cadPctGdp, quarter } = parseNpiText(rawText);
  if (cadBn === null || cadPctGdp === null) return null;

  const today = new Date().toISOString().slice(0, 10);
  const quarterLabel = quarter ?? `Q?-${new Date().getFullYear()}`;

  const points: MacroDataPoint[] = [
    {
      indicator: 'current_account_pct_gdp_quarterly',
      category: 'bop' as const,
      date: today,
      value: cadPctGdp,
      unit: '%_GDP',
      source,
      fetchedAt: NOW(),
    },
    {
      indicator: 'current_account_quarterly_bn',
      category: 'bop' as const,
      date: today,
      value: cadBn,
      unit: 'bn_USD',
      source,
      fetchedAt: NOW(),
    },
  ];
  await upsertPoints(points);

  return { quarter: quarterLabel, cadPctGdp, cadBn, source, fetchedAt: NOW() };
}
