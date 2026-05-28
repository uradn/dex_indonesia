/**
 * Info Pangan Jakarta (IPJ) commodity price adapter.
 * API: infopangan.jakarta.go.id/api2/v1/public/master-data/commodities
 *
 * No auth required. Plain REST JSON. Updated daily.
 * Jakarta market average prices — proxy for national prices when PIHPS offline.
 *
 * Skips "Ayam Broiler/Ras" — priced per ekor (bird), not per kg.
 * Maps Jakarta commodity names to canonical PIHPS indicators.
 */
import type { MacroDataPoint } from '../types.js';
import { PIHPS_COMMODITIES } from './pihps.js';

const NOW = () => new Date().toISOString();

const API_URL = 'https://infopangan.jakarta.go.id/api2/v1/public/master-data/commodities?name=&date=';

// Exact Jakarta commodity names → PIHPS indicator
// Ayam Broiler/Ras intentionally omitted — priced per ekor, not per kg
const IPJ_NAME_MAP: Record<string, string> = {
  'Beras Medium':                    'pihps_beras_medium_idr',
  'Cabe Merah Keriting':             'pihps_cabai_merah_kriting_idr',
  'Cabe Rawit Merah':                'pihps_cabai_rawit_merah_idr',
  'Bawang Merah':                    'pihps_bawang_merah_idr',
  'Bawang Putih':                    'pihps_bawang_putih_idr',
  'Daging Sapi':                     'pihps_daging_sapi_idr',
  'Daging Sapi Murni (Semur)':       'pihps_daging_sapi_idr',
  'Daging Sapi Has (Paha Belakang)': 'pihps_daging_sapi_idr',
  'Telur Ayam Ras':                  'pihps_telur_ayam_idr',
  'Minyak Goreng (Kuning/Curah)':    'pihps_minyak_goreng_idr',
  'Gula Pasir':                      'pihps_gula_pasir_idr',
};

interface IpjCommodity {
  commodity_id: number;
  name: string;
  avg_price: number;
  newest_price: number;
  newest_price_date: string;
}

interface IpjResponse {
  status: number;
  data: {
    selected_price_date: string;
    data: IpjCommodity[];
  };
}

export async function fetchInfoPanganJakarta(): Promise<MacroDataPoint[]> {
  let json: IpjResponse;
  try {
    const res = await fetch(API_URL, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return [];
    json = await res.json() as IpjResponse;
  } catch {
    return [];
  }

  if (json.status !== 200 || !Array.isArray(json.data?.data)) return [];

  const priceDate = json.data.selected_price_date ?? new Date().toISOString().slice(0, 10);
  const fetchedAt = NOW();
  const results: MacroDataPoint[] = [];
  const seen = new Set<string>();

  for (const item of json.data.data) {
    const indicator = IPJ_NAME_MAP[item.name];
    if (!indicator || seen.has(indicator)) continue;

    const spec = PIHPS_COMMODITIES.find(c => c.indicator === indicator);
    if (!spec) continue;

    // Use avg_price (city-wide average); newest_price as fallback
    const price = item.avg_price ?? item.newest_price;
    if (typeof price !== 'number' || price < spec.minPrice || price > spec.maxPrice) continue;

    seen.add(indicator);
    results.push({
      indicator,
      category: 'pangan',
      date: item.newest_price_date ?? priceDate,
      value: Math.round(price),
      unit: spec.unit,
      source: 'infopangan_jakarta',
      fetchedAt,
    });
  }

  return results;
}
