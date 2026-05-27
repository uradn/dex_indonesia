/**
 * OJK (Otoritas Jasa Keuangan) banking statistics scraper.
 *
 * Source: OJK Statistik Perbankan Indonesia (SPI) Excel download.
 * Page: https://ojk.go.id/id/kanal/perbankan/data-dan-statistik/statistik-perbankan-indonesia/
 *
 * Note (audited 2026-05-27):
 *   - Old OJK SPI page (pre-July 2025): Excel downloads accessible via Playwright with OJK cookies.
 *     Most recent available: June 2025.
 *   - New OJK portal (July 2025+): data.ojk.go.id/SJKPublic — MetricID 338 (Rasio Keuangan,
 *     Bank Umum, IndustriID=45). Portal is DevExtreme SPA; download endpoint not yet identified.
 *     TODO: implement new portal scraper for more recent data.
 *   - Data staleness is clearly marked in MacroDataPoint.date.
 *   - DB caches last known value if live fetch fails.
 *
 * Parsed indicators:
 *   - bank_ldr_pct: Loan-to-Deposit Ratio (%) — Sheet "Kinerja_KBMI 1.16.-1.20.", last column
 *   - bank_car_pct: Capital Adequacy Ratio (%) — same sheet
 *   - bank_npl_gross_pct: Gross NPL Ratio (%) — computed from "Kredit LU_KBMI 3.1-3.5."
 *     as sum(NPL/NPF rows, last month col) / sum(credit rows, last month col) × 100
 */
import * as XLSX from 'xlsx';
import { withBrowserPage } from './playwright-browser.js';
import type { MacroDataPoint } from '../types.js';

const OJK_SPI_PAGE = 'https://ojk.go.id/id/kanal/perbankan/data-dan-statistik/statistik-perbankan-indonesia/Default.aspx';
const NOW = () => new Date().toISOString();

const MONTH_MAP: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', mei: '05', jun: '06',
  jul: '07', ags: '08', sep: '09', okt: '10', nov: '11', des: '12',
};

async function downloadLatestSpiExcel(): Promise<Buffer | null> {
  return withBrowserPage(async (page) => {
    await page.goto(OJK_SPI_PAGE, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForTimeout(1500);

    // Click on the most recent SPI publication to reveal the Excel download link
    const titles = page.locator('text=Statistik Perbankan Indonesia');
    const count = await titles.count();
    for (let i = 0; i < count; i++) {
      const text = await titles.nth(i).textContent();
      if (text?.match(/\b20\d{2}\b/)) {
        await titles.nth(i).click();
        await page.waitForTimeout(1500);
        break;
      }
    }

    // Find the .xlsx download link revealed by clicking
    const href = await page.locator('a[href$=".xlsx"], a[href$=".xls"]').first().getAttribute('href').catch(() => null);
    if (!href) return null;

    // Download via page.evaluate with OJK session cookies
    const bytes = await page.evaluate(async (url: string) => {
      const r = await fetch(url, { credentials: 'include' });
      if (!r.ok) return null;
      return Array.from(new Uint8Array(await r.arrayBuffer()));
    }, href);

    if (!bytes) return null;
    return Buffer.from(bytes);
  });
}

/** Detect last data month column (0-indexed) by scanning row 2 for month names. */
function detectLastMonthCol(ws: XLSX.WorkSheet): { col: number; dateStr: string } {
  const cells = ws as Record<string, XLSX.CellObject>;
  const ref = ws['!ref'];
  if (!ref) return { col: -1, dateStr: '' };

  const range = XLSX.utils.decode_range(ref);
  let lastMonthCol = -1;
  let lastMonthName = '';
  let lastYear = new Date().getFullYear() - 1;

  // Row 1 (0-indexed) has years, row 2 has month names
  for (let c = range.s.c; c <= range.e.c; c++) {
    const yearAddr = XLSX.utils.encode_cell({ r: 1, c });
    const monthAddr = XLSX.utils.encode_cell({ r: 2, c });
    const yearCell = cells[yearAddr];
    const monthCell = cells[monthAddr];

    if (yearCell && typeof yearCell.v === 'number' && yearCell.v > 2000) {
      lastYear = yearCell.v;
    }
    if (monthCell && typeof monthCell.v === 'string') {
      const m = monthCell.v.toLowerCase().replace(/\s*r\)/, '').trim();
      if (MONTH_MAP[m]) {
        lastMonthCol = c;
        lastMonthName = m;
      }
    }
  }

  const monthNum = MONTH_MAP[lastMonthName] ?? '06';
  // Use last day of month
  const lastDay = new Date(lastYear, parseInt(monthNum), 0).getDate();
  return { col: lastMonthCol, dateStr: `${lastYear}-${monthNum}-${String(lastDay).padStart(2, '0')}` };
}

function parseKinerjaSheet(wb: XLSX.WorkBook): {
  ldr: number | null;
  car: number | null;
  dateStr: string;
} {
  const sheetName = wb.SheetNames.find(n => n.match(/Kinerja_KBMI/i));
  if (!sheetName) return { ldr: null, car: null, dateStr: '' };

  const ws = wb.Sheets[sheetName]!;
  const { col: lastCol, dateStr } = detectLastMonthCol(ws);
  if (lastCol < 0) return { ldr: null, car: null, dateStr };

  const cells = ws as Record<string, XLSX.CellObject>;
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');

  let ldr: number | null = null;
  let car: number | null = null;

  for (let r = range.s.r; r <= range.e.r; r++) {
    const labelCell = cells[XLSX.utils.encode_cell({ r, c: 0 })];
    const label = String(labelCell?.v ?? '');
    const dataCell = cells[XLSX.utils.encode_cell({ r, c: lastCol })];
    const val = typeof dataCell?.v === 'number' ? dataCell.v : null;

    if (label.match(/Loan to Deposits Ratio/i) && val !== null) ldr = val;
    if (label.match(/Capital Adequacy Ratio/i) && val !== null && car === null) car = val;
  }

  return { ldr, car, dateStr };
}

function parseNplFromKreditSheet(wb: XLSX.WorkBook, lastMonthCol: number): number | null {
  const sheetName = wb.SheetNames.find(n => n.match(/Kredit LU_KBMI/i));
  if (!sheetName || lastMonthCol < 0) return null;

  const ws = wb.Sheets[sheetName]!;
  const cells = ws as Record<string, XLSX.CellObject>;
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');

  // Tabel 3.1 = aggregate Bank Umum (rows 3-53 0-indexed before Tabel 3.2 header at ~54)
  // Find where Tabel 3.2 starts
  let tabel31End = Math.min(54, range.e.r);
  for (let r = 4; r <= range.e.r; r++) {
    const cell = cells[XLSX.utils.encode_cell({ r, c: 0 })];
    if (String(cell?.v ?? '').match(/Tabel 3\.2/i)) {
      tabel31End = r;
      break;
    }
  }

  let totalCredit = 0;
  let totalNpl = 0;

  for (let r = 4; r < tabel31End; r++) {
    const cCell = cells[XLSX.utils.encode_cell({ r, c: 2 })]; // col C = sector name or "NPL/NPF"
    const dataCell = cells[XLSX.utils.encode_cell({ r, c: lastMonthCol })];
    const val = typeof dataCell?.v === 'number' ? dataCell.v : 0;
    if (val <= 0) continue;

    const cStr = String(cCell?.v ?? '').trim();
    if (cStr.toLowerCase().includes('npl') || cStr.toLowerCase().includes('npf')) {
      totalNpl += val;
    } else {
      totalCredit += val;
    }
  }

  if (totalCredit <= 0) return null;
  return (totalNpl / totalCredit) * 100;
}

// Key sectors to track for NPL by sector (col C label keywords)
const SECTOR_NPL_MAP: Record<string, string[]> = {
  real_estat:   ['real estat', 'properti', 'perumahan', 'property'],
  konstruksi:   ['konstruksi', 'construction'],
  perdagangan:  ['perdagangan', 'trade'],
  konsumsi:     ['konsumsi', 'rumah tangga', 'household', 'consumer'],
};

interface SectorNplEntry { credit: number; npl: number }

/**
 * Extract sector-level NPL from Kredit LU sheet.
 * Pairs credit rows and NPL/NPF sub-rows by sector keyword matching in col C.
 * Returns NPL% per key sector. Returns empty object if sheet unavailable.
 */
function parseSectorNplFromKreditSheet(
  wb: XLSX.WorkBook,
  lastMonthCol: number,
): Record<string, number> {
  const sheetName = wb.SheetNames.find(n => n.match(/Kredit LU_KBMI/i));
  if (!sheetName || lastMonthCol < 0) return {};

  const ws = wb.Sheets[sheetName]!;
  const cells = ws as Record<string, XLSX.CellObject>;
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');

  let tabel31End = Math.min(54, range.e.r);
  for (let r = 4; r <= range.e.r; r++) {
    const cell = cells[XLSX.utils.encode_cell({ r, c: 0 })];
    if (String(cell?.v ?? '').match(/Tabel 3\.2/i)) { tabel31End = r; break; }
  }

  const sectorData: Record<string, SectorNplEntry> = {};
  for (const key of Object.keys(SECTOR_NPL_MAP)) {
    sectorData[key] = { credit: 0, npl: 0 };
  }

  for (let r = 4; r < tabel31End; r++) {
    const cCell = cells[XLSX.utils.encode_cell({ r, c: 2 })];
    const dataCell = cells[XLSX.utils.encode_cell({ r, c: lastMonthCol })];
    const val = typeof dataCell?.v === 'number' ? dataCell.v : 0;
    if (val <= 0) continue;

    const cStr = String(cCell?.v ?? '').trim().toLowerCase();
    const isNplRow = cStr.includes('npl') || cStr.includes('npf');

    for (const [key, keywords] of Object.entries(SECTOR_NPL_MAP)) {
      if (keywords.some(k => cStr.includes(k))) {
        if (isNplRow) sectorData[key]!.npl += val;
        else sectorData[key]!.credit += val;
      }
    }
  }

  const result: Record<string, number> = {};
  for (const [key, { credit, npl }] of Object.entries(sectorData)) {
    if (credit > 0) result[key] = parseFloat(((npl / credit) * 100).toFixed(2));
  }
  return result;
}

export async function fetchBankingRatiosOjk(): Promise<{
  npl: MacroDataPoint | null;
  ldr: MacroDataPoint | null;
  car: MacroDataPoint | null;
  sectorNpl: Record<string, number>;
}> {
  const empty = { npl: null, ldr: null, car: null, sectorNpl: {} };
  try {
    const buf = await downloadLatestSpiExcel();
    if (!buf || buf.length < 50_000) return empty;

    const wb = XLSX.read(buf, { type: 'buffer' });

    const kinerjaName = wb.SheetNames.find(n => n.match(/Kinerja_KBMI/i));
    if (!kinerjaName) return empty;
    const kinerjaWs = wb.Sheets[kinerjaName]!;
    const { col: lastCol, dateStr } = detectLastMonthCol(kinerjaWs);

    const { ldr, car, dateStr: ds } = parseKinerjaSheet(wb);
    const nplPct = parseNplFromKreditSheet(wb, lastCol);
    const sectorNpl = parseSectorNplFromKreditSheet(wb, lastCol);
    const date = ds || dateStr;

    const base = { category: 'banking' as const, source: 'ojk_spi_xlsx', fetchedAt: NOW(), date };
    return {
      npl: nplPct !== null ? { ...base, indicator: 'bank_npl_gross_pct', value: parseFloat(nplPct.toFixed(2)), unit: '%' } : null,
      ldr: ldr !== null ? { ...base, indicator: 'bank_ldr_pct', value: parseFloat(ldr.toFixed(2)), unit: '%' } : null,
      car: car !== null ? { ...base, indicator: 'bank_car_pct', value: parseFloat(car.toFixed(2)), unit: '%' } : null,
      sectorNpl,
    };
  } catch {
    return empty;
  }
}
