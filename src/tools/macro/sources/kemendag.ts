/**
 * Kemendag EWS (SP2KP) commodity price adapter — Tier 3 PIHPS fallback.
 * API endpoint: ews.kemendag.go.id/api/harga
 * Key registration: api.kemendag.go.id
 *
 * Returns 401 without KEMENDAG_API_KEY. No-op when key is absent.
 * Used by fetchPihpsCommodities() after hargapangan.id + bi.go.id both fail.
 */
import type { MacroDataPoint } from '../types.js';
import { PIHPS_COMMODITIES } from './pihps.js';

const NOW = () => new Date().toISOString();
const TODAY = () => new Date().toISOString().slice(0, 10);

const BASE_URL = 'https://ews.kemendag.go.id/api';

// SP2KP naming → canonical PIHPS indicator
const KEMENDAG_NAME_MAP: Record<string, string> = {
  'beras medium':           'pihps_beras_medium_idr',
  'beras kualitas medium':  'pihps_beras_medium_idr',
  'cabai merah keriting':   'pihps_cabai_merah_kriting_idr',
  'cabai merah kriting':    'pihps_cabai_merah_kriting_idr',
  'cabe merah keriting':    'pihps_cabai_merah_kriting_idr',
  'cabai rawit merah':      'pihps_cabai_rawit_merah_idr',
  'cabe rawit merah':       'pihps_cabai_rawit_merah_idr',
  'bawang merah':           'pihps_bawang_merah_idr',
  'bawang putih':           'pihps_bawang_putih_idr',
  'daging sapi murni':      'pihps_daging_sapi_idr',
  'daging sapi':            'pihps_daging_sapi_idr',
  'daging ayam ras':        'pihps_daging_ayam_idr',
  'ayam ras segar':         'pihps_daging_ayam_idr',
  'telur ayam ras':         'pihps_telur_ayam_idr',
  'telur ayam':             'pihps_telur_ayam_idr',
  'minyak goreng curah':    'pihps_minyak_goreng_idr',
  'minyak goreng':          'pihps_minyak_goreng_idr',
  'gula pasir lokal':       'pihps_gula_pasir_idr',
  'gula pasir':             'pihps_gula_pasir_idr',
};

interface KemendagItem {
  komoditas?: string;
  nama_komoditas?: string;
  commodity?: string;
  harga?: number;
  price?: number;
  harga_nasional?: number;
  nilai?: number;
  tanggal?: string;
  date?: string;
}

function extractItems(data: unknown): KemendagItem[] {
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data)) return data as KemendagItem[];
  const obj = data as Record<string, unknown>;
  if (Array.isArray(obj['data']))   return obj['data']   as KemendagItem[];
  if (Array.isArray(obj['items']))  return obj['items']  as KemendagItem[];
  if (Array.isArray(obj['harga']))  return obj['harga']  as KemendagItem[];
  // Nested: { data: { items: [...] } }
  const inner = obj['data'];
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
    const i = inner as Record<string, unknown>;
    if (Array.isArray(i['items'])) return i['items'] as KemendagItem[];
    if (Array.isArray(i['data']))  return i['data']  as KemendagItem[];
  }
  return [];
}

export async function fetchKemendagEws(): Promise<MacroDataPoint[]> {
  const apiKey = process.env.KEMENDAG_API_KEY;
  if (!apiKey) return [];

  let json: unknown;
  try {
    const res = await fetch(`${BASE_URL}/harga`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'x-api-key': apiKey,
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    json = await res.json() as unknown;
  } catch {
    return [];
  }

  const items = extractItems(json);
  if (items.length === 0) return [];

  const today = TODAY();
  const fetchedAt = NOW();
  const results: MacroDataPoint[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const rawName = (item.komoditas ?? item.nama_komoditas ?? item.commodity ?? '').toString();
    if (!rawName) continue;

    const indicator = KEMENDAG_NAME_MAP[rawName.toLowerCase().trim()];
    if (!indicator || seen.has(indicator)) continue;

    const spec = PIHPS_COMMODITIES.find(c => c.indicator === indicator);
    if (!spec) continue;

    const rawPrice = item.harga ?? item.price ?? item.harga_nasional ?? item.nilai;
    if (typeof rawPrice !== 'number' || rawPrice < spec.minPrice || rawPrice > spec.maxPrice) continue;

    seen.add(indicator);
    results.push({
      indicator,
      category: 'pangan',
      date: item.tanggal ?? item.date ?? today,
      value: rawPrice,
      unit: spec.unit,
      source: 'kemendag_ews',
      fetchedAt,
    });
  }

  return results;
}
