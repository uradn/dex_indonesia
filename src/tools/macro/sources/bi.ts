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
import { upsertPoints, getLatestPoint } from '../time-series-db.js';

const NOW = () => new Date().toISOString();
const TODAY = () => new Date().toISOString().slice(0, 10);

// Returns `count` business days ending at fromDateStr (inclusive), chronological order.
function prevBusinessDays(fromDateStr: string, count: number): string[] {
  const dates: string[] = [];
  const d = new Date(fromDateStr + 'T12:00:00Z');
  while (dates.length < count) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return dates.reverse();
}

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
 * Fetch FX reserves — 3-tier fallback chain.
 *
 * Priority:
 *   1. BI SEKI I1 Playwright scraper (real-time, breaks when site changes)
 *   2. World Bank GEM API source=15 (BROKEN as of Jun 2026 — returns zeros for 2025-2026)
 *   3. Trading Economics scrape (monthly, ~1-month BI publication lag, reliable)
 */
export async function fetchBiFxReserves(): Promise<MacroDataPoint | null> {
  // Tier 1: BI SEKI I1 — plain fetch first, Playwright fallback if blocked
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

  // Tier 2: World Bank GEM API — returns zeros for 2025-2026 (broken as of Jun 2026).
  // Also fails freshness: GEM may return real but stale data (>60d old) — fall through if so.
  try {
    const wbPoints = await fetchBiFxReservesWorldBank(6);
    const nonZero = wbPoints.filter(p => p.value > 0);
    if (nonZero.length > 0) {
      const latest = nonZero[nonZero.length - 1]!;
      const ageMs = Date.now() - new Date(latest.date).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      if (ageDays <= 60) return latest;
    }
  } catch {
    // ignore
  }

  // Tier 3: Trading Economics scrape — source: Bank Indonesia, monthly, ~1-month lag
  try {
    const te = await fetchFxReservesTe();
    if (te) return te;
  } catch {
    // ignore
  }

  return null;
}

/**
 * Fetch FX reserves from Trading Economics.
 * Source data: Bank Indonesia, monthly, published ~4-6 weeks after reference month.
 * Pattern: "Foreign Exchange Reserves in Indonesia increased to 151890.00 USD Million in April of 2026"
 */
async function fetchFxReservesTe(): Promise<MacroDataPoint | null> {
  const text = await fetchRenderedTextWithBrowser(
    'https://tradingeconomics.com/indonesia/foreign-exchange-reserves',
  );
  if (!text) return null;

  const MONTHS: Record<string, string> = {
    january: '01', february: '02', march: '03', april: '04',
    may: '05', june: '06', july: '07', august: '08',
    september: '09', october: '10', november: '11', december: '12',
  };

  // Primary: TE prose — "Indonesia's foreign exchange reserves fell to USD 144.9 billion in May 2026"
  // Use matchAll + pick latest date (page may have multiple historical sentences).
  const proseRe = /Indonesia.{1,3}s foreign exchange reserves (?:fell|rose|increased|decreased|remained[^.]*?) to USD\s+([\d.]+)\s+billion\s+in\s+(\w+)\s+(\d{4})/gi;
  let bestProse: { val: number; date: string } | null = null;
  for (const m of text.matchAll(proseRe)) {
    const val = parseFloat(m[1]!);
    const mm = MONTHS[m[2]!.toLowerCase()];
    const year = m[3]!;
    if (!mm || val <= 50 || val >= 500) continue;
    const lastDay = new Date(parseInt(year), parseInt(mm), 0).getDate();
    const date = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;
    if (!bestProse || date > bestProse.date) bestProse = { val, date };
  }
  if (bestProse) {
    return {
      indicator: 'bi_fx_reserves_bn',
      category: 'bop' as MacroDataPoint['category'],
      date: bestProse.date,
      value: parseFloat(bestProse.val.toFixed(2)),
      unit: 'bn_USD',
      source: 'trading_economics_scrape',
      fetchedAt: NOW(),
    };
  }

  // Fallback: table row "Foreign Exchange Reserves  144900  146200  USD Million  May/26"
  const table = text.match(/Foreign Exchange Reserves\s+([\d,.]+)\s+[\d,.]+\s+USD Million\s+(\w{3})\/(\d{2,4})/i);
  if (table) {
    const val = parseFloat(table[1]!.replace(/,/g, '')) / 1000;
    const mon = table[2]!;
    const yr = table[3]!.length === 2 ? `20${table[3]}` : table[3]!;
    const monthMap: Record<string, string> = {
      Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
      Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12',
    };
    const mm = monthMap[mon];
    if (mm && val > 50 && val < 500) {
      const lastDay = new Date(parseInt(yr), parseInt(mm), 0).getDate();
      return {
        indicator: 'bi_fx_reserves_bn',
        category: 'bop' as MacroDataPoint['category'],
        date: `${yr}-${mm}-${String(lastDay).padStart(2, '0')}`,
        value: parseFloat(val.toFixed(2)),
        unit: 'bn_USD',
        source: 'trading_economics_scrape',
        fetchedAt: NOW(),
      };
    }
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
  // Env override — manual pin (DNDF pattern). Use when DJPPR TCP-blocks non-ID IPs.
  // Source: DJPPR daily kepemilikan SBN page or BI/Kemenkeu press releases.
  const envVal = process.env.SBN_FOREIGN_OWNERSHIP_PCT;
  if (envVal) {
    const v = parseFloat(envVal);
    if (!isNaN(v) && v >= 5 && v <= 50) {
      const pt: MacroDataPoint = {
        indicator: 'sbn_foreign_ownership_pct',
        category: 'sovereign',
        date: TODAY(),
        value: v,
        unit: '%',
        source: 'env_manual',
        fetchedAt: NOW(),
      };
      await upsertPoints([pt]);
      return pt;
    }
  }

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

  // Each triplet: SUN%, SBN%, TOTAL% — extract all TOTAL% values (every 3rd, 0-indexed: 2,5,8,...)
  const totalValues = nums
    .filter((_, i) => (i + 1) % 3 === 0)
    .filter(v => v >= 5 && v <= 50);
  if (totalValues.length === 0) return null;

  // Map each value to a business day — last value = dataDate, earlier values = prior biz days
  const dates = prevBusinessDays(dataDate, totalValues.length);
  const allPoints: MacroDataPoint[] = totalValues.map((value, idx) => ({
    indicator: 'sbn_foreign_ownership_pct',
    category: 'sovereign' as MacroDataPoint['category'],
    date: dates[idx]!,
    value,
    unit: '%',
    source: 'djppr_pdf',
    fetchedAt: NOW(),
  }));

  // Bulk-upsert all points as side effect (engine upserts latest separately — idempotent)
  await upsertPoints(allPoints);

  return allPoints[allPoints.length - 1]!;
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

/**
 * Fetch BI macro-prudential hedging compliance rate for non-bank corporates.
 * Source: BI quarterly ULN press release — "tingkat pemenuhan kewajiban lindung nilai".
 * PBI 16/21/2014 jo 21/14/2019: min 25% hedge of net ULN maturing within 3 months.
 * Returns % compliance (0-100). Degrades gracefully to null if page structure changes.
 */
export async function fetchHedgingComplianceBi(): Promise<MacroDataPoint | null> {
  const text = await fetchRenderedTextWithBrowser(
    'https://www.bi.go.id/id/statistik/statistik-utang-luar-negeri-indonesia/Default.aspx',
  );
  if (!text) return null;

  // BI press release pattern: "mencapai XX,X% dari total kewajiban lindung nilai"
  // or "pemenuhan kewajiban lindung nilai sebesar XX,X%"
  const patterns = [
    /pemenuhan\s+kewajiban\s+lindung\s+nilai[^.]*?sebesar\s+([\d]+[,.][\d]+)\s*%/i,
    /mencapai\s+([\d]+[,.][\d]+)\s*%\s+dari\s+total\s+kewajiban\s+lindung\s+nilai/i,
    /tingkat\s+pemenuhan[^.]*?([\d]+[,.][\d]+)\s*%/i,
  ];

  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      const val = parseFloat(m[1]!.replace(',', '.'));
      if (!isNaN(val) && val >= 0 && val <= 100) {
        return {
          indicator: 'uln_hedging_compliance_pct', category: 'uln',
          date: TODAY(),
          value: val, unit: '%',
          source: 'bi_sulni_scrape', fetchedAt: NOW(),
        };
      }
    }
  }
  return null;
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

/**
 * Fetch BI IndONIA compounded 30d rate directly from BI's IndONIA/JIBOR page.
 *
 * Source: bi.go.id/en/fungsi-utama/moneter/indonia-jibor/default.aspx
 * BI publishes this daily at 19:30 WIB; Playwright renders the JS-loaded table.
 * Indicator: indonia_compounded_30d_pct — backward 30-day compounded average of daily O/N rates.
 * Freshness gate: 1d (BI publishes daily; re-fetch on every morning-check run).
 *
 * Distinction from indonia_3m_pct (TE source):
 *   - indonia_compounded_30d_pct: BI official, O/N 30d backward average, < 1d lag
 *   - indonia_3m_pct: TE proxy, 3M term rate (JIBOR 3M behavior), ~4-week lag
 */
const INDONIA_QUERIES = [
  'IndONIA compounded 30 hari Bank Indonesia persen terbaru',
  'Compounded INDONIA 30 days percent Bank Indonesia rate',
  'IndONIA rate Bank Indonesia overnight index average percent',
  'suku bunga IndONIA Bank Indonesia persen bulan ini',
];
const INDONIA_DOMAINS = [
  'bi.go.id', 'bisnis.com', 'cnbcindonesia.com', 'kontan.co.id',
  'katadata.co.id', 'antaranews.com', 'bloombergtechnoz.com', 'tempo.co',
  'bca.co.id', 'mandiri.co.id', 'bri.co.id', 'investor.id', 'idntimes.com',
];
const INDONIA_RANGE = { min: 2, max: 12 };

function parseIndoniaRate(text: string): number | null {
  const pats = [
    // "Compounded INDONIA 30 ... 5.56789%"
    /compounded\s+indonia\s*(?:30\s*(?:days?|hari))?\s*[:\s]+\**\s*([\d]+[.,][\d]{3,6})\s*%?/i,
    // "IndONIA ... 5.56% compounded"
    /indonia\s*(?:compounded)?\s+30?\s*[:\s]+\**\s*([\d]+[.,][\d]{2,6})\s*%/i,
    // generic: "IndONIA ... sebesar/mencapai/di 5.56%"
    /indonia[\s\S]{0,60}?(?:sebesar|mencapai|menjadi|di|pada|:)\s*([\d]+[.,][\d]{2,6})\s*%/i,
    // "5.56% ... IndONIA"
    /([\d]+[.,][\d]{2,6})\s*%[\s\S]{0,50}?indonia/i,
  ];
  for (const p of pats) {
    const m = text.match(p);
    if (m?.[1]) {
      const v = parseFloat(m[1].replace(',', '.'));
      if (!isNaN(v) && v >= INDONIA_RANGE.min && v <= INDONIA_RANGE.max) return v;
    }
  }
  return null;
}

async function fetchIndoniaViaExa(): Promise<{ rate: number | null; sourceUrl: string | null }> {
  if (!process.env.EXASEARCH_API_KEY) return { rate: null, sourceUrl: null };
  try {
    const { default: Exa } = await import('exa-js');
    const exa = new Exa(process.env.EXASEARCH_API_KEY);
    const startDate = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    for (const query of INDONIA_QUERIES) {
      const resp = await exa.search(query, {
        numResults: 6, type: 'auto', startPublishedDate: startDate,
        includeDomains: INDONIA_DOMAINS,
        contents: { text: { maxCharacters: 3000 } },
      } as Parameters<typeof exa.search>[1]).catch(() => null);
      if (!resp) continue;
      for (const r of (resp.results ?? [])) {
        const combined = `${r.title ?? ''} ${(r as any).text ?? ''}`;
        const rate = parseIndoniaRate(combined);
        if (rate != null) return { rate, sourceUrl: r.url ?? null };
      }
    }
  } catch { /* ignore */ }
  return { rate: null, sourceUrl: null };
}

async function fetchIndoniaViaTavily(): Promise<{ rate: number | null; sourceUrl: string | null }> {
  if (!process.env.TAVILY_API_KEY) return { rate: null, sourceUrl: null };
  try {
    const { TavilySearchAPIWrapper } = await import('@langchain/tavily');
    const tavily = new TavilySearchAPIWrapper({ tavilyApiKey: process.env.TAVILY_API_KEY });
    for (const query of INDONIA_QUERIES) {
      const resp = await tavily.rawResults({
        query, maxResults: 5, searchDepth: 'advanced',
        includeRawContent: true, days: 14,
      } as Parameters<typeof tavily.rawResults>[0]).catch(() => null);
      if (!resp) continue;
      for (const r of ((resp as any).results ?? [])) {
        const combined = `${r.title ?? ''} ${r.content ?? ''} ${r.raw_content ?? ''}`;
        const rate = parseIndoniaRate(combined);
        if (rate != null) return { rate, sourceUrl: r.url ?? null };
      }
    }
  } catch { /* ignore */ }
  return { rate: null, sourceUrl: null };
}

export async function fetchIndoniaBiDirect(): Promise<MacroDataPoint | null> {
  // Env override: BI_INDONIA_COMPOUNDED_30D_PCT — always wins (env_manual pattern like BI_DNDF).
  // Set manually when BI Playwright scrape fails. Source: bi.go.id IndONIA/JIBOR page (daily 19:30 WIB).
  const envVal = process.env.BI_INDONIA_COMPOUNDED_30D_PCT;
  if (envVal) {
    const val = parseFloat(envVal);
    if (!isNaN(val) && val >= INDONIA_RANGE.min && val <= INDONIA_RANGE.max) {
      const today = new Date().toISOString().slice(0, 10);
      const pt: MacroDataPoint = {
        indicator: 'indonia_compounded_30d_pct', category: 'banking', date: today,
        value: parseFloat(val.toFixed(5)), unit: '%', source: 'env_manual',
        fetchedAt: new Date().toISOString(),
      };
      await upsertPoints([pt]);
      return pt;
    }
  }

  // Cache gate: 1d freshness, any source
  const cached = await getLatestPoint('indonia_compounded_30d_pct');
  if (cached) {
    const ageDays = (Date.now() - new Date(cached.fetchedAt).getTime()) / 86_400_000;
    if (ageDays < 1) return cached;
  }

  // Tier 1: BI Playwright (direct; blocked on some networks — ERR_CONNECTION_RESET)
  const text = await fetchRenderedTextWithBrowser(
    'https://www.bi.go.id/en/fungsi-utama/moneter/indonia-jibor/default.aspx',
  );
  if (text) {
    const textPatterns = [
      /compounded\s+indonia\s+30\s*(?:days?|hari)?\s*\n+\s*([\d]+\.[\d]{3,6})/i,
      /compounded\s+indonia[^\n]*\n(?:[^\n]{0,80}\n){0,3}[^\n]*?([\d]+\.[\d]{3,6})\s*%?/i,
      /indonia[^\n]*\n(?:[^\n]{0,80}\n){0,5}[^\n]*?([\d]+\.[\d]{4,6})/i,
    ];
    for (const pat of textPatterns) {
      const m = text.match(pat);
      if (m) {
        const val = parseFloat(m[1]!);
        if (!isNaN(val) && val >= INDONIA_RANGE.min && val <= INDONIA_RANGE.max) {
          const pt: MacroDataPoint = {
            indicator: 'indonia_compounded_30d_pct', category: 'banking',
            date: TODAY(), value: parseFloat(val.toFixed(5)),
            unit: '%', source: 'bi_indonia_direct', fetchedAt: NOW(),
          };
          await upsertPoints([pt]);
          return pt;
        }
      }
    }
  }

  // Tier 2: Exa news search
  const exaResult = await fetchIndoniaViaExa();
  if (exaResult.rate != null) {
    const pt: MacroDataPoint = {
      indicator: 'indonia_compounded_30d_pct', category: 'banking',
      date: TODAY(), value: parseFloat(exaResult.rate.toFixed(5)),
      unit: '%', source: exaResult.sourceUrl ?? 'exa_indonia_news', fetchedAt: NOW(),
    };
    await upsertPoints([pt]);
    return pt;
  }

  // Tier 3: Tavily fallback
  const tavilyResult = await fetchIndoniaViaTavily();
  if (tavilyResult.rate != null) {
    const pt: MacroDataPoint = {
      indicator: 'indonia_compounded_30d_pct', category: 'banking',
      date: TODAY(), value: parseFloat(tavilyResult.rate.toFixed(5)),
      unit: '%', source: tavilyResult.sourceUrl ?? 'tavily_indonia_news', fetchedAt: NOW(),
    };
    await upsertPoints([pt]);
    return pt;
  }

  return null;
}
