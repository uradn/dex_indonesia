/**
 * World Bank open data adapters.
 *
 * Sources:
 *   FX Reserves  — World Bank GEM API (indicator TOTRESV, source=15)
 *                  Monthly, JSON, no auth, confirmed working.
 *                  https://api.worldbank.org/v2/country/IDN/indicator/TOTRESV?source=15
 *
 *   Pink Sheet    — World Bank Commodity Price Data (Monthly Prices sheet)
 *                  CMO-Historical-Data-Monthly.xlsx, downloaded once per session (1h cache).
 *                  Sheet 2 (index 1) = "Monthly Prices" — verified column layout:
 *                    col 2: Crude oil, Brent  ($/bbl)
 *                    col 3: Crude oil, Dubai  ($/bbl)   ← M4/M6 use this
 *                    col 4: Crude oil, WTI    ($/bbl)
 *                    col 22: Palm oil         ($/MT)    ← CPO proxy
 *                  Landing page: https://www.worldbank.org/en/research/commodity-markets
 *                  Direct file URL updated monthly — fetch landing page to get current link.
 */
import type { MacroDataPoint } from '../types.js';

const WB_BASE = 'https://api.worldbank.org/v2';

// Stable landing page — scrape for current XLSX link
const PINK_SHEET_LANDING = 'https://www.worldbank.org/en/research/commodity-markets';
// Fallback hardcoded URL — update if the hash changes
const PINK_SHEET_FALLBACK = 'https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/CMO-Historical-Data-Monthly.xlsx';

const NOW = () => new Date().toISOString();
const TODAY = () => new Date().toISOString().slice(0, 10);

// ─── Pink Sheet shared cache ──────────────────────────────────────────────────
// Downloading the ~1MB XLSX is slow. Cache parsed rows for 1h so multiple
// commodity fetches (CPO, Dubai, Brent) share a single download per session.
let _pinkSheetCache: { rows: unknown[][]; fetchedAt: number } | null = null;
const PINK_SHEET_CACHE_TTL_MS = 3_600_000; // 1 hour

async function getOrFetchPinkSheetRows(): Promise<unknown[][]> {
  if (_pinkSheetCache && Date.now() - _pinkSheetCache.fetchedAt < PINK_SHEET_CACHE_TTL_MS) {
    return _pinkSheetCache.rows;
  }
  const xlsxUrl = await resolvePinkSheetUrl();
  const buf = await fetch(xlsxUrl).then((r) => {
    if (!r.ok) throw new Error(`Pink Sheet fetch ${r.status}`);
    return r.arrayBuffer();
  });
  const { read, utils } = await import('xlsx');
  const wb = read(new Uint8Array(buf), { type: 'array', dense: false });
  const sheetName = wb.SheetNames[1];
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error('Pink Sheet: Monthly Prices sheet not found');
  const rows = utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][];
  _pinkSheetCache = { rows, fetchedAt: Date.now() };
  return rows;
}

/**
 * Generic Pink Sheet column extractor.
 * Searches header row (rows 0-10) for a cell matching colKeyword (case-insensitive),
 * then extracts that column for the given number of trailing months.
 */
async function extractPinkSheetColumn(
  colKeyword: string,
  months: number,
  indicator: string,
  unit: string,
  category: 'commodity' | 'sovereign',
): Promise<MacroDataPoint[]> {
  const rows = await getOrFetchPinkSheetRows();
  const cutoff = new Date(Date.now() - months * 30 * 86_400_000);
  const fetchedAt = NOW();

  // Find header row and column index
  let headerRowIdx = -1;
  let colIdx = -1;
  let dateColIdx = 0;

  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = rows[i] as (string | null)[];
    const idx = row.findIndex(
      (c) => typeof c === 'string' && c.toUpperCase().includes(colKeyword.toUpperCase()),
    );
    if (idx !== -1) {
      headerRowIdx = i;
      colIdx = idx;
      const dcIdx = row.findIndex((c) => typeof c === 'string' && /year|month|date/i.test(c));
      dateColIdx = dcIdx !== -1 ? dcIdx : 0;
      break;
    }
  }

  if (colIdx === -1) throw new Error(`Pink Sheet: column '${colKeyword}' not found`);

  const results: MacroDataPoint[] = [];
  for (let i = headerRowIdx + 2; i < rows.length; i++) { // +2 to skip units row
    const row = rows[i] as (string | number | null)[];
    const dateCell = row[dateColIdx];
    const priceCell = row[colIdx];

    if (!dateCell || priceCell === null || priceCell === undefined) continue;
    const price = typeof priceCell === 'number' ? priceCell : parseFloat(String(priceCell));
    if (isNaN(price) || price <= 0) continue;

    const isoDate = parsePinkSheetDate(dateCell);
    if (!isoDate) continue;
    if (new Date(isoDate) < cutoff) continue;

    results.push({
      indicator,
      category,
      date: isoDate,
      value: parseFloat(price.toFixed(4)),
      unit,
      source: 'worldbank_pinksheet',
      fetchedAt,
    });
  }

  return results.sort((a, b) => a.date.localeCompare(b.date));
}

// ─── FX Reserves ─────────────────────────────────────────────────────────────

interface WBReserveRow {
  date: string;    // "2024M12"
  value: number | null;
}

/**
 * Fetch monthly Indonesia FX reserves from World Bank GEM API.
 * Returns MacroDataPoint[] sorted ascending by date.
 * Values are in millions USD — converted to billions.
 */
export async function fetchBiFxReservesWorldBank(months = 48): Promise<MacroDataPoint[]> {
  const endDate = new Date();
  const startDate = new Date(Date.now() - months * 30 * 86400_000);

  const fmtMonth = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}M${m}`;
  };

  const url = `${WB_BASE}/country/IDN/indicator/TOTRESV?source=15&format=json&per_page=${months + 6}&date=${fmtMonth(startDate)}:${fmtMonth(endDate)}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`World Bank reserves API ${res.status}`);

  const json: [unknown, WBReserveRow[]] = await res.json();
  const rows = json[1] ?? [];
  const fetchedAt = NOW();

  return rows
    .filter((r): r is WBReserveRow & { value: number } => r.value !== null)
    .map((r) => ({
      indicator: 'bi_fx_reserves_bn',
      category: 'bop' as MacroDataPoint['category'],
      date: wbMonthToIsoDate(r.date),
      value: r.value / 1000,   // millions → billions
      unit: 'bn_USD',
      source: 'worldbank_gem',
      fetchedAt,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Convert World Bank month format "2024M12" → "2024-12-01" */
function wbMonthToIsoDate(wbDate: string): string {
  const [year, month] = wbDate.split('M');
  return `${year}-${month.padStart(2, '0')}-01`;
}

// ─── CPO Price (Pink Sheet XLSX) ─────────────────────────────────────────────

/**
 * Fetch monthly CPO price from World Bank Pink Sheet.
 * Downloads the XLSX, extracts PALM_OIL column (USD/MT).
 * Tries the current URL from the landing page first; falls back to hardcoded URL.
 */
/**
 * Fetch CPO (Palm Oil) monthly prices from World Bank Pink Sheet.
 * Column keyword: "Palm oil" (col 22 in current layout).
 * Bug fix: previous code searched "PALM_OIL" (underscore) but header is "Palm oil" (space).
 */
export async function fetchCpoPriceWorldBank(months = 48): Promise<MacroDataPoint[]> {
  const points = await extractPinkSheetColumn('Palm oil', months, 'cpo_price_myr', 'USD/MT', 'commodity');
  return points;
}

/**
 * Fetch Dubai crude oil monthly spot price from World Bank Pink Sheet.
 * Column keyword: "Dubai" (col 3 in current layout). Unit: USD/bbl.
 * Physical MEG→Asia benchmark — more accurate than Brent for Pertamina procurement cost.
 * Brent-Dubai spread: normally $1-3 Brent premium; widens >$10 during Hormuz disruption
 * (paper Brent spikes on war fear; physical Dubai discounts on delivery risk).
 */
export async function fetchDubaiCrudeWorldBank(months = 6): Promise<MacroDataPoint[]> {
  const points = await extractPinkSheetColumn('Dubai', months, 'dubai_crude_spot_usd', 'USD/bbl', 'commodity');
  return points;
}

/**
 * Parse Pink Sheet date cell. Handles formats:
 * - Excel serial number (e.g. 45000)
 * - String like "Jan-2024", "2024M01", "2024-01"
 */
function parsePinkSheetDate(cell: string | number | null): string | null {
  if (cell === null || cell === undefined) return null;

  if (typeof cell === 'number') {
    // Excel serial date — convert
    const d = new Date(Math.round((cell - 25569) * 86400 * 1000));
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 7) + '-01';
  }

  const s = String(cell).trim();

  // "Jan-2024" or "Jan 2024"
  const monthYear = s.match(/^([A-Za-z]{3})[-\s](\d{4})$/);
  if (monthYear) {
    const months: Record<string, string> = {
      jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
      jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12',
    };
    const m = months[monthYear[1].toLowerCase()];
    return m ? `${monthYear[2]}-${m}-01` : null;
  }

  // "2024M01" or "2024-01"
  const ymMatch = s.match(/^(\d{4})[M-](\d{2})$/);
  if (ymMatch) return `${ymMatch[1]}-${ymMatch[2]}-01`;

  return null;
}

/**
 * Resolve current Pink Sheet XLSX URL from the World Bank landing page.
 * Falls back to hardcoded URL if scraping fails.
 */
async function resolvePinkSheetUrl(): Promise<string> {
  try {
    const html = await fetch(PINK_SHEET_LANDING, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Dexter/1.0)' },
    }).then((r) => r.text());

    // Find the CMO-Historical-Data-Monthly.xlsx link in the page
    const match = html.match(/https:\/\/thedocs\.worldbank\.org\/[^"'\s]*CMO-Historical-Data-Monthly\.xlsx/);
    if (match) return match[0];
  } catch {
    // fall through to hardcoded
  }
  return PINK_SHEET_FALLBACK;
}
