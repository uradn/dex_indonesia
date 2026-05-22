/**
 * IMF Data API — Balance of Payments, Current Account, FX Reserves.
 * Free REST API, no key required.
 *
 * Docs: https://datahelp.imf.org/knowledgebase/articles/630877
 * Base: https://www.imf.org/external/datamapper/api/v1/
 *
 * Indonesia ISO code: IDN
 */
import type { MacroDataPoint } from '../types.js';

const IMF_BASE = 'https://www.imf.org/external/datamapper/api/v1';
const NOW = () => new Date().toISOString();

// IMF indicator codes
const IMF_INDICATORS = {
  CURRENT_ACCOUNT_PCT_GDP: 'BCA_NGDPD',   // Current Account Balance (% GDP)
  FX_RESERVES_MONTHS_IMPORT: 'RESERVES',   // Reserves in months of imports
  EXTERNAL_DEBT_PCT_GDP: 'D',              // External Debt (% GDP)
  GDP_GROWTH: 'NGDP_RPCH',               // Real GDP growth %
  INFLATION_CPI: 'PCPIPCH',              // CPI inflation %
};

interface ImfApiResponse {
  values?: Record<string, Record<string, Record<string, number>>>;
}

async function imfFetch(indicator: string, country = 'IDN'): Promise<Record<string, number>> {
  const url = `${IMF_BASE}/${indicator}/${country}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`IMF API ${res.status}: ${indicator}`);
  const json = await res.json() as ImfApiResponse;
  const values = json?.values?.[indicator]?.[country];
  if (!values) return {};
  return values;
}

function latestYearData(data: Record<string, number>, yearsBack = 8): MacroDataPoint[] {
  const entries = Object.entries(data)
    .filter(([year, val]) => !isNaN(Number(year)) && !isNaN(val))
    .sort(([a], [b]) => Number(a) - Number(b))
    .slice(-yearsBack);
  return entries.map(([year, value]) => ({ year, value })) as unknown as MacroDataPoint[];
}

export async function fetchCurrentAccount(): Promise<MacroDataPoint[]> {
  try {
    const data = await imfFetch(IMF_INDICATORS.CURRENT_ACCOUNT_PCT_GDP);
    return Object.entries(data)
      .filter(([y, v]) => !isNaN(Number(y)) && !isNaN(v))
      .slice(-10)
      .map(([year, value]) => ({
        indicator: 'current_account_pct_gdp',
        category: 'bop' as const,
        date: `${year}-12-31`,
        value,
        unit: '%_GDP',
        source: 'imf',
        fetchedAt: NOW(),
      }));
  } catch {
    return [];
  }
}

export async function fetchFxReservesMonths(): Promise<MacroDataPoint[]> {
  try {
    const data = await imfFetch(IMF_INDICATORS.FX_RESERVES_MONTHS_IMPORT);
    return Object.entries(data)
      .filter(([y, v]) => !isNaN(Number(y)) && !isNaN(v))
      .slice(-10)
      .map(([year, value]) => ({
        indicator: 'fx_reserves_months_import',
        category: 'bop' as const,
        date: `${year}-12-31`,
        value,
        unit: 'months_imports',
        source: 'imf',
        fetchedAt: NOW(),
      }));
  } catch {
    return [];
  }
}

export async function fetchGdpGrowth(): Promise<MacroDataPoint[]> {
  try {
    const data = await imfFetch(IMF_INDICATORS.GDP_GROWTH);
    return Object.entries(data)
      .filter(([y, v]) => !isNaN(Number(y)) && !isNaN(v))
      .slice(-10)
      .map(([year, value]) => ({
        indicator: 'gdp_growth_pct',
        category: 'regime' as const,
        date: `${year}-12-31`,
        value,
        unit: '%',
        source: 'imf',
        fetchedAt: NOW(),
      }));
  } catch {
    return [];
  }
}

export async function fetchInflation(): Promise<MacroDataPoint[]> {
  try {
    const data = await imfFetch(IMF_INDICATORS.INFLATION_CPI);
    return Object.entries(data)
      .filter(([y, v]) => !isNaN(Number(y)) && !isNaN(v))
      .slice(-10)
      .map(([year, value]) => ({
        indicator: 'inflation_cpi_pct',
        category: 'regime' as const,
        date: `${year}-12-31`,
        value,
        unit: '%',
        source: 'imf',
        fetchedAt: NOW(),
      }));
  } catch {
    return [];
  }
}

// IMF WEO current account balance in USD bn (absolute, not % GDP)
export async function fetchCurrentAccountBn(): Promise<MacroDataPoint[]> {
  try {
    const data = await imfFetch('BCA');
    return Object.entries(data)
      .filter(([y, v]) => !isNaN(Number(y)) && !isNaN(v))
      .slice(-8)
      .map(([year, value]) => ({
        indicator: 'current_account_bn',
        category: 'bop' as const,
        date: `${year}-12-31`,
        value,
        unit: 'bn_USD',
        source: 'imf',
        fetchedAt: NOW(),
      }));
  } catch {
    return [];
  }
}
