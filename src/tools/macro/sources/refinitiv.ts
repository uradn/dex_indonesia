/**
 * Refinitiv/LSEG Data Platform (RDP) REST API client.
 *
 * Required env vars:
 *   REFINITIV_APP_KEY     — Application key from LSEG developer portal
 *   REFINITIV_USERNAME    — LSEG/Refinitiv username (email)
 *   REFINITIV_PASSWORD    — Password
 *
 * Auth flow: OAuth2 password grant → access token (30 min TTL)
 * Docs: https://developers.lseg.com/en/api-catalog/refinitiv-data-platform
 *
 * RICs used:
 *   USDIDR=   — USD/IDR spot FX
 *   IDN10YT=RR — Indonesia 10Y government bond yield
 *   INDN5YUSAC=R — Indonesia 5Y CDS (USD)
 *   EMEAIDNN.RB — EMBI Indonesia spread (JPMorgan EMBI series via Refinitiv)
 */
import type { MacroDataPoint } from '../types.js';

const RDP_AUTH_URL = 'https://api.refinitiv.com/auth/oauth2/v1/token';
const RDP_PRICING_URL = 'https://api.refinitiv.com/data/pricing/snapshots/v1/views/bid-ask';
const RDP_HISTORICAL_URL = 'https://api.refinitiv.com/data/historical-pricing/v1/views/summaries';
const NOW = () => new Date().toISOString();
const TODAY = () => new Date().toISOString().slice(0, 10);

let _token: string | null = null;
let _tokenExpiry = 0;

export function refinitivAvailable(): boolean {
  return !!(
    process.env.REFINITIV_APP_KEY &&
    process.env.REFINITIV_USERNAME &&
    process.env.REFINITIV_PASSWORD
  );
}

async function getToken(): Promise<string> {
  if (_token && Date.now() < _tokenExpiry) return _token;

  const appKey = process.env.REFINITIV_APP_KEY!;
  const username = process.env.REFINITIV_USERNAME!;
  const password = process.env.REFINITIV_PASSWORD!;

  const body = new URLSearchParams({
    grant_type: 'password',
    username,
    password,
    client_id: appKey,
    scope: 'trapi.data.pricing.read',
    takeExclusiveSignOnControl: 'true',
  });

  const res = await fetch(RDP_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Refinitiv auth failed: ${res.status}`);
  const json = await res.json() as { access_token: string; expires_in: number };
  _token = json.access_token;
  _tokenExpiry = Date.now() + (json.expires_in - 60) * 1000;
  return _token;
}

async function rdpGet(url: string): Promise<unknown> {
  if (!refinitivAvailable()) throw new Error('Refinitiv not configured');
  const token = await getToken();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Refinitiv API ${res.status}: ${url}`);
  return res.json();
}

interface RdpHistoricalResponse {
  data?: Array<Array<string | number | null>>;
  headers?: Array<{ name: string }>;
}

async function fetchHistoricalClose(ric: string, days = 1): Promise<number | null> {
  try {
    const startDate = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
    const data = await rdpGet(
      `${RDP_HISTORICAL_URL}/${encodeURIComponent(ric)}?start=${startDate}&fields=CLOSE`,
    ) as RdpHistoricalResponse;

    const rows = data?.data;
    if (!rows || rows.length === 0) return null;
    const lastRow = rows[rows.length - 1];
    // headers: [DATE, CLOSE]
    const val = lastRow[1];
    return typeof val === 'number' ? val : null;
  } catch {
    return null;
  }
}

export async function fetchUsdIdrRdp(): Promise<MacroDataPoint | null> {
  if (!refinitivAvailable()) return null;
  try {
    const val = await fetchHistoricalClose('USDIDR=');
    if (val === null) return null;
    return {
      indicator: 'usdidr_spot',
      category: 'fx',
      date: TODAY(),
      value: val,
      unit: 'IDR/USD',
      source: 'refinitiv',
      fetchedAt: NOW(),
    };
  } catch {
    return null;
  }
}

export async function fetchSbn10yRdp(): Promise<MacroDataPoint | null> {
  if (!refinitivAvailable()) return null;
  try {
    const val = await fetchHistoricalClose('IDN10YT=RR');
    if (val === null) return null;
    return {
      indicator: 'sbn_10y_yield_pct',
      category: 'sovereign',
      date: TODAY(),
      value: val,
      unit: '%',
      source: 'refinitiv',
      fetchedAt: NOW(),
    };
  } catch {
    return null;
  }
}

export async function fetchCds5yRdp(): Promise<MacroDataPoint | null> {
  if (!refinitivAvailable()) return null;
  try {
    const val = await fetchHistoricalClose('INDN5YUSAC=R');
    if (val === null) return null;
    return {
      indicator: 'indonesia_cds_5y_bps',
      category: 'sovereign',
      date: TODAY(),
      value: val,
      unit: 'bps',
      source: 'refinitiv',
      fetchedAt: NOW(),
    };
  } catch {
    return null;
  }
}
