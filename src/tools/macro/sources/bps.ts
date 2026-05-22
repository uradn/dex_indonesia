/**
 * BPS (Badan Pusat Statistik) — Indonesia's national statistics agency.
 *
 * Uses BPS WebAPI v1: https://webapi.bps.go.id/v1/api/
 * Requires BPS_API_KEY env var (free registration at webapi.bps.go.id).
 *
 * Key dataset IDs used:
 *  - Trade: domain 0000, var 201 (exports), var 202 (imports), var 200 (trade balance)
 *  - CPI/Inflation: domain 0000, var 3 (general CPI)
 */
import type { MacroDataPoint } from '../types.js';

const BPS_BASE = 'https://webapi.bps.go.id/v1/api';
const NOW = () => new Date().toISOString();

// BPS dataset variable IDs (subject to BPS schema changes)
const BPS_VAR = {
  EXPORTS_USD_MN: '201',
  IMPORTS_USD_MN: '202',
  TRADE_BALANCE_USD_MN: '200',
  CPI_INDEX: '3',
};

export function bpsAvailable(): boolean {
  return !!process.env.BPS_API_KEY;
}

async function bpsFetch(path: string): Promise<unknown> {
  const key = process.env.BPS_API_KEY;
  if (!key) throw new Error('BPS_API_KEY not set');
  const url = `${BPS_BASE}/${path}&key=${key}&lang=ind&type=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`BPS API ${res.status}: ${path}`);
  return res.json();
}

interface BpsListResponse {
  data?: Array<{ val?: string; label?: string; tahun?: string; bulan?: string }>;
}

/**
 * Fetch monthly trade balance from BPS.
 * Returns last N months of data (trade balance in bn USD).
 */
export async function fetchTradeBalance(months = 24): Promise<MacroDataPoint[]> {
  try {
    const raw = await bpsFetch(
      `list/domain/0000/var/${BPS_VAR.TRADE_BALANCE_USD_MN}/type/var`,
    ) as BpsListResponse;

    const data = raw?.data ?? [];
    const results: MacroDataPoint[] = [];

    for (const row of data.slice(-months)) {
      const val = parseFloat(row.val ?? '');
      if (isNaN(val)) continue;
      // BPS reports in million USD, convert to bn
      const yearMonth = `${row.tahun ?? ''}-${String(row.bulan ?? '').padStart(2, '0')}-01`;
      results.push({
        indicator: 'trade_balance_bn',
        category: 'bop',
        date: yearMonth,
        value: val / 1000,
        unit: 'bn_USD',
        source: 'bps',
        fetchedAt: NOW(),
      });
    }
    return results;
  } catch {
    return [];
  }
}

export async function fetchImports(months = 24): Promise<MacroDataPoint[]> {
  try {
    const raw = await bpsFetch(
      `list/domain/0000/var/${BPS_VAR.IMPORTS_USD_MN}/type/var`,
    ) as BpsListResponse;

    const data = raw?.data ?? [];
    return data.slice(-months).flatMap((row) => {
      const val = parseFloat(row.val ?? '');
      if (isNaN(val)) return [];
      const yearMonth = `${row.tahun ?? ''}-${String(row.bulan ?? '').padStart(2, '0')}-01`;
      return [{
        indicator: 'imports_bn',
        category: 'bop' as const,
        date: yearMonth,
        value: val / 1000,
        unit: 'bn_USD',
        source: 'bps',
        fetchedAt: NOW(),
      }];
    });
  } catch {
    return [];
  }
}

export async function fetchExports(months = 24): Promise<MacroDataPoint[]> {
  try {
    const raw = await bpsFetch(
      `list/domain/0000/var/${BPS_VAR.EXPORTS_USD_MN}/type/var`,
    ) as BpsListResponse;

    const data = raw?.data ?? [];
    return data.slice(-months).flatMap((row) => {
      const val = parseFloat(row.val ?? '');
      if (isNaN(val)) return [];
      const yearMonth = `${row.tahun ?? ''}-${String(row.bulan ?? '').padStart(2, '0')}-01`;
      return [{
        indicator: 'exports_bn',
        category: 'bop' as const,
        date: yearMonth,
        value: val / 1000,
        unit: 'bn_USD',
        source: 'bps',
        fetchedAt: NOW(),
      }];
    });
  } catch {
    return [];
  }
}
