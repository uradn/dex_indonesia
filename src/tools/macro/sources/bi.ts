/**
 * Bank Indonesia (BI) public data sources.
 *
 * STATUS (audited 2026-05-27):
 *   FX Reserves  — BI website scraper (Playwright) → World Bank GEM API fallback ✅
 *   USDIDR rate  — BI SOAP endpoint DEAD (404). Use yahoo-macro.ts fetchUsdIdrSpot() instead.
 *   SBN foreign ownership — DJPPR switched to PDF-only downloads. HTML pages blocked.
 *                           Requires PDF parser (not yet implemented) → returns null.
 *   SRBI outstanding — ZIP→XLSX scraper via Playwright + browser cookies ✅
 *                      Structure: Row 16 TOTAL, last column = latest Trn IDR value.
 *
 * For USDIDR: use fetchUsdIdrSpot() from yahoo-macro.ts (real-time, always works).
 * For SBN/SRBI: accept null until PDF parsing is added.
 */
import type { MacroDataPoint } from '../types.js';
import * as XLSX from 'xlsx';
import { fetchBiFxReservesWorldBank } from './worldbank.js';
import { fetchHtmlWithBrowser, fetchRenderedTextWithBrowser, withBrowserPage } from './playwright-browser.js';
import { extractPdfText } from './pdf-parser.js';

const NOW = () => new Date().toISOString();
const TODAY = () => new Date().toISOString().slice(0, 10);

// BI publishes FX reserves monthly in its monetary statistics.
const BI_RESERVES_URL =
  'https://www.bi.go.id/en/statistik/ekonomi-keuangan/seki/Default.aspx?seki=I1';

// DJPPR (Treasury) — new URL renders with Playwright but serves PDF downloads only.
// Data: https://djppr.kemenkeu.go.id/kepemilikansbndomestikyangdapatdiperdagangkan
// PDF API: https://api-djppr.kemenkeu.go.id/web/api/v1/media/{UUID} → PDF, ~394KB each
const DJPPR_OWNERSHIP_URL = 'https://djppr.kemenkeu.go.id/kepemilikansbndomestikyangdapatdiperdagangkan';

// BI SRBI ownership page — new URL, lists PDF publications, no inline data
const SRBI_PUBLICATIONS_URL = 'https://www.bi.go.id/en/iru/economic-market-data/srbi/default.aspx';

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
 * Fetch FX reserves — BI website scraper with World Bank GEM API fallback.
 * Returns the latest available monthly figure (bn USD).
 *
 * Priority:
 *   1. BI website scraper (real-time, but breaks when site changes)
 *   2. World Bank GEM API (monthly JSON, ~1-2 month lag, always works)
 */
export async function fetchBiFxReserves(): Promise<MacroDataPoint | null> {
  // Try BI's SEKI table I1 — plain fetch first, Playwright fallback if blocked
  let html = await fetchText(BI_RESERVES_URL);
  if (!html) html = await fetchHtmlWithBrowser(BI_RESERVES_URL);
  if (html) {
    const matches = html.match(/(\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d+)?)\s*(?:million|juta)/gi);
    if (matches) {
      for (const m of matches) {
        const numStr = m.replace(/[^\d.]/g, '');
        const value = parseFloat(numStr);
        if (value > 50_000 && value < 500_000) {
          return {
            indicator: 'bi_fx_reserves_bn',
            category: 'bop' as MacroDataPoint['category'],
            date: TODAY(),
            value: value / 1000,
            unit: 'bn_USD',
            source: 'bi_website',
            fetchedAt: NOW(),
          };
        }
      }
    }
  }

  // Fallback: World Bank GEM API (free, monthly, confirmed working)
  try {
    const wbPoints = await fetchBiFxReservesWorldBank(3);
    if (wbPoints.length > 0) {
      return wbPoints[wbPoints.length - 1]; // most recent
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * BI official IDR/USD mid-rate.
 * NOTE: BI SOAP endpoint (biwebservice/wsclient.asmx) returns 404 as of 2026-05-27.
 * Use fetchUsdIdrSpot() from yahoo-macro.ts instead — it's more current (real-time vs daily).
 * This function is retained for fallback compatibility but will always return null.
 */
export async function fetchBiOfficialRate(): Promise<MacroDataPoint | null> {
  return null;
}

/**
 * Fetch SBN foreign ownership from DJPPR PDF.
 * Returns percentage of total SBN (SUN+SBN) held by non-residents.
 * Historically: ~40% peak → declining to ~13% by 2025–2026.
 *
 * Method: Playwright → kepemilikan SBN page → first api-djppr media link → PDF →
 *   Section B "Dalam Persentase" → "Non Residen" row → last TOTAL% value (9th triplet).
 */
export async function fetchSbnForeignOwnership(): Promise<MacroDataPoint | null> {
  // 1. Get page HTML (Playwright) to extract first API media link + date text
  const [html, renderedText] = await Promise.all([
    fetchHtmlWithBrowser(DJPPR_OWNERSHIP_URL),
    fetchRenderedTextWithBrowser(DJPPR_OWNERSHIP_URL),
  ]);
  if (!html) return null;

  // Match only href links (not src/background images which appear first in HTML)
  const linkMatch = html.match(/href="(https:\/\/api-djppr\.kemenkeu\.go\.id\/web\/api\/v1\/media\/[A-F0-9-]+)"/i);
  if (!linkMatch) return null;
  const pdfUrl = linkMatch[1];

  // Parse date from rendered text: "Data Harian s.d. 22 Mei 2026"
  const BULAN: Record<string, string> = {
    januari:'01', februari:'02', maret:'03', april:'04', mei:'05', juni:'06',
    juli:'07', agustus:'08', september:'09', oktober:'10', november:'11', desember:'12',
  };
  let dataDate = TODAY();
  if (renderedText) {
    const dateMatch = renderedText.match(/s\.d\.\s+(\d{1,2})\s+(\w+)\s+(\d{4})/i);
    if (dateMatch) {
      const [, day, bulan, year] = dateMatch;
      const mm = BULAN[bulan.toLowerCase()];
      if (mm) dataDate = `${year}-${mm}-${String(day).padStart(2, '0')}`;
    }
  }

  // 2. Download + parse PDF
  const pdfText = await extractPdfText(pdfUrl);
  if (!pdfText) return null;

  // 3. Find "B. Dalam Persentase" section
  const secBIdx = pdfText.indexOf('B. Dalam Persentase');
  if (secBIdx < 0) return null;
  const secB = pdfText.slice(secBIdx);

  // 4. Find "Non Residen" row: "Non Residen{SUN%}  {SBN%}  {TOTAL%}  ..." × 9 dates
  const nrMatch = secB.match(/Non Residen\s*([\d,.\s\-]+)/);
  if (!nrMatch) return null;

  const nums = (nrMatch[1].match(/\d+[,.]\d+/g) ?? [])
    .map((n) => parseFloat(n.replace(',', '.')))
    .filter((v) => !isNaN(v));
  if (nums.length < 3) return null;

  // Each triplet: SUN%, SBN%, TOTAL% — pick last TOTAL% (index of last multiple-of-3 - 1)
  const totalIndices = nums
    .map((_, i) => i)
    .filter((i) => (i + 1) % 3 === 0);
  const latestTotal = totalIndices.length > 0 ? nums[totalIndices[totalIndices.length - 1]!] : null;

  if (latestTotal === null || latestTotal === undefined || latestTotal < 5 || latestTotal > 50) return null;

  return {
    indicator: 'sbn_foreign_ownership_pct',
    category: 'sovereign',
    date: dataDate,
    value: latestTotal,
    unit: '%',
    source: 'djppr_pdf',
    fetchedAt: NOW(),
  };
}

const BI_BASE = 'https://www.bi.go.id';

/**
 * Fetch SRBI (Sekuritas Rupiah Bank Indonesia) outstanding.
 * SRBI is BI's sterilization instrument — proxy for BI liquidity absorption pressure.
 *
 * Strategy:
 *   1. Multi-step Playwright: load SRBI SharePoint list → paginate until 2026 link found
 *   2. Follow report page → find ZIP download link
 *   3. Download ZIP (needs browser cookies), extract XLSX, parse TOTAL row
 *
 * XLSX structure (as of 2026):
 *   Row 9  — date columns (Excel serials)
 *   Row 16 — TOTAL outstanding (Trillion IDR), last column = most recent
 *   Filename pattern: IRU_Ownership..._YYYY-MM-DD.xlsx
 */
export async function fetchSrbiOutstanding(): Promise<MacroDataPoint | null> {
  const result = await withBrowserPage(async (page) => {
    // Step 1: load publications list
    await page.goto(`${BI_BASE}/en/iru/economic-market-data/srbi/default.aspx`, {
      waitUntil: 'load',
      timeout: 30_000,
    });
    await page.waitForTimeout(3_000);

    // Step 2: most recent 2026 link is on page 1 — use locator (HTML regex misses it)
    const link = page.locator('a[href*="2026"]').first();
    if (await link.count() === 0) return null;
    const reportHref = await link.getAttribute('href');
    if (!reportHref) return null;

    // Step 3: navigate to report page, find ZIP download link
    await page.goto(reportHref.startsWith('http') ? reportHref : BI_BASE + reportHref, {
      waitUntil: 'load',
      timeout: 25_000,
    });
    await page.waitForTimeout(2_000);
    const reportHtml = await page.content();

    const zipMatch = reportHtml.match(/href="(\/en\/iru\/economic-market-data\/SRBI\/Documents\/[^"]+\.zip)"/i);
    if (!zipMatch) return null;
    const zipUrl = BI_BASE + zipMatch[1]!;

    // Step 4: download ZIP via Playwright download event (Node fetch returns 400 — BI blocks it)
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.evaluate((url: string) => { window.location.href = url; }, zipUrl),
    ]);
    const tmpPath = `/tmp/srbi-dl-${Date.now()}.zip`;
    await download.saveAs(tmpPath);
    const zipBuf = Buffer.from(await Bun.file(tmpPath).arrayBuffer());
    await Bun.spawn(['rm', '-f', tmpPath]);

    return { zipBuf, zipUrl };
  });

  if (!result) return null;

  // Step 5: extract XLSX from ZIP → parse TOTAL row
  return parseSrbiZip(result.zipBuf);
}

async function parseSrbiZip(zipBuf: Buffer): Promise<MacroDataPoint | null> {
  const tmpZip = `/tmp/srbi-${Date.now()}.zip`;
  try {
    await Bun.write(tmpZip, zipBuf);
    // unzip -p: pipe first file to stdout (no header noise)
    const proc = Bun.spawn(['unzip', '-p', tmpZip], { stdout: 'pipe' });
    const xlsxBuf = Buffer.from(await new Response(proc.stdout).arrayBuffer());
    await proc.exited;
    if (!xlsxBuf.length) return null;

    const wb = XLSX.read(xlsxBuf, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]!];
    if (!ws) return null;
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, defval: '' });

    // Row 16 (index 15) = TOTAL; last numeric cell = most recent outstanding
    const totalRow = rows[15] as (string | number)[];
    if (!totalRow) return null;
    const nums = totalRow.filter((v): v is number => typeof v === 'number' && v > 100 && v < 3_000);
    if (!nums.length) return null;
    const value = nums[nums.length - 1]!;

    // Date from filename: "_YYYY-MM-DD.xlsx"
    const ws2 = Object.values(wb.Sheets)[0]!;
    const range = XLSX.utils.decode_range(ws2['!ref'] ?? 'A1:A1');
    // Row 9 index 8: last date column holds the Excel serial for the data date
    const dateRow = rows[8] as (string | number)[];
    const lastSerial = [...(dateRow ?? [])].filter((v): v is number => typeof v === 'number').pop();
    let date = TODAY();
    if (lastSerial) {
      // Excel serial → JS Date (offset: 25569 days from 1900-01-01 to Unix epoch, +1 for Excel leap year bug)
      const d = new Date((lastSerial - 25569) * 86_400_000);
      date = d.toISOString().slice(0, 10);
    }

    return {
      indicator: 'srbi_outstanding_trn_idr',
      category: 'fx',
      date,
      value,
      unit: 'trn_IDR',
      source: 'bi_srbi_xlsx',
      fetchedAt: NOW(),
    };
  } catch {
    return null;
  } finally {
    await Bun.file(tmpZip).exists().then(e => e && Bun.spawn(['rm', tmpZip]));
  }
}
