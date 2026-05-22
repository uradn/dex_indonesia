/**
 * Bloomberg data bridge.
 *
 * Bloomberg has no official TypeScript/JavaScript SDK.
 * This module supports two integration modes:
 *
 * Mode A — Bloomberg B-PIPE REST proxy (recommended for server deployments):
 *   Set BLOOMBERG_API_URL + BLOOMBERG_API_KEY in .env
 *   The proxy must implement GET /fields?securities={sec}&fields={fields}
 *   returning { data: { [security]: { [field]: value } } }
 *   Build your own proxy using Python blpapi or Bloomberg BEAP.
 *
 * Mode B — Bloomberg Open API via local blp subprocess:
 *   Not yet implemented. Use Mode A or free sources.
 *
 * Required env vars:
 *   BLOOMBERG_API_URL   — e.g. http://localhost:8080 or https://your-bbg-proxy.internal
 *   BLOOMBERG_API_KEY   — Bearer token for your proxy
 */
import type { MacroDataPoint } from '../types.js';

const NOW = () => new Date().toISOString();
const TODAY = () => new Date().toISOString().slice(0, 10);

export function bloombergAvailable(): boolean {
  return !!(process.env.BLOOMBERG_API_URL && process.env.BLOOMBERG_API_KEY);
}

interface BloombergProxyResponse {
  data?: Record<string, Record<string, number | string>>;
}

async function bbgFetch(securities: string[], fields: string[]): Promise<BloombergProxyResponse> {
  const url = process.env.BLOOMBERG_API_URL;
  const key = process.env.BLOOMBERG_API_KEY;
  if (!url || !key) throw new Error('Bloomberg not configured');

  const res = await fetch(
    `${url}/fields?securities=${securities.join(',')}&fields=${fields.join(',')}`,
    {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!res.ok) throw new Error(`Bloomberg proxy ${res.status}`);
  return res.json() as Promise<BloombergProxyResponse>;
}

// Indonesia sovereign CDS 5Y mid spread (bps)
export async function fetchIndonesiaCds5y(): Promise<MacroDataPoint | null> {
  if (!bloombergAvailable()) return null;
  try {
    const res = await bbgFetch(['INDOGB 5Y CDS SPREAD USD'], ['CDS_SPREAD_MID']);
    const val = res.data?.['INDOGB 5Y CDS SPREAD USD']?.['CDS_SPREAD_MID'];
    if (typeof val !== 'number') return null;
    return {
      indicator: 'indonesia_cds_5y_bps',
      category: 'sovereign',
      date: TODAY(),
      value: val,
      unit: 'bps',
      source: 'bloomberg',
      fetchedAt: NOW(),
    };
  } catch {
    return null;
  }
}

// Indonesia 10Y SBN yield (FR series, typically FR0100 or nearest benchmark)
export async function fetchSbn10yYield(): Promise<MacroDataPoint | null> {
  if (!bloombergAvailable()) return null;
  try {
    const res = await bbgFetch(['GSID10YR Index'], ['PX_LAST']);
    const val = res.data?.['GSID10YR Index']?.['PX_LAST'];
    if (typeof val !== 'number') return null;
    return {
      indicator: 'sbn_10y_yield_pct',
      category: 'sovereign',
      date: TODAY(),
      value: val,
      unit: '%',
      source: 'bloomberg',
      fetchedAt: NOW(),
    };
  } catch {
    return null;
  }
}

// EMBI Indonesia spread (JPMGEMBI)
export async function fetchEmbiSpread(): Promise<MacroDataPoint | null> {
  if (!bloombergAvailable()) return null;
  try {
    const res = await bbgFetch(['JBIDTOTL Index'], ['PX_LAST']);
    const val = res.data?.['JBIDTOTL Index']?.['PX_LAST'];
    if (typeof val !== 'number') return null;
    return {
      indicator: 'embi_indonesia_spread_bps',
      category: 'sovereign',
      date: TODAY(),
      value: val,
      unit: 'bps',
      source: 'bloomberg',
      fetchedAt: NOW(),
    };
  } catch {
    return null;
  }
}

// BI FX reserves (Bloomberg IID Total Reserves ex Gold)
export async function fetchBbgFxReserves(): Promise<MacroDataPoint | null> {
  if (!bloombergAvailable()) return null;
  try {
    const res = await bbgFetch(['IDINREVS Index'], ['PX_LAST']);
    const val = res.data?.['IDINREVS Index']?.['PX_LAST'];
    if (typeof val !== 'number') return null;
    return {
      indicator: 'bi_fx_reserves_bn',
      category: 'fx',
      date: TODAY(),
      value: val,
      unit: 'bn_USD',
      source: 'bloomberg',
      fetchedAt: NOW(),
    };
  } catch {
    return null;
  }
}

export async function fetchAllSovereignData(): Promise<MacroDataPoint[]> {
  const results = await Promise.allSettled([
    fetchIndonesiaCds5y(),
    fetchSbn10yYield(),
    fetchEmbiSpread(),
    fetchBbgFxReserves(),
  ]);
  return results
    .filter((r): r is PromiseFulfilledResult<MacroDataPoint | null> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((v): v is MacroDataPoint => v !== null);
}
