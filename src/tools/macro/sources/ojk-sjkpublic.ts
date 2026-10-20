/**
 * OJK SJKPublic portal scraper — data.ojk.go.id/SJKPublic
 *
 * Fetches Bank Umum financial ratios and balance sheet data from the new OJK portal
 * (live from July 2025+, supersedes legacy ojk.ts which maxes out at June 2025).
 *
 * Approach: Playwright intercepts XMLA Execute POST responses to /SJKPublic/datasource/.
 * The WAF only blocks plain HTTP clients, not browser-originated requests. The DevExtreme
 * XmlaStore sends XMLA automatically when the page loads — we just capture the response.
 *
 * MetricID=338 (BU_RasioKeuangan cube):
 *   Axis0 (cols): tuples of [Bulan × Measures] — 9 tuples (1 All + 8 months Jan-Aug)
 *   Axis1 (rows): tuples of [Akun × KBMI] — 40 tuples
 *   CellData: Value with xsi:type="xsd:double" (scientific notation)
 *   Available ratios: 001=CAR, 002=Tier1/ATMR, 003=ROA, 004=BOPO, 005=NIM, 006=LDR, 007=LAR
 *   NPL is NOT in MetricID=338.
 *   DB indicators: bank_car_pct, bank_ldr_pct
 *
 * MetricID=331 (BU_LaporanPosisiKeuangan / balance sheet cube):
 *   May be bundled as a secondary XMLA response during Dataset/338 page load.
 *   Dataset/331 URL does NOT trigger XMLA itself (SPA shell only, no DevExtreme XMLA fired).
 *   DPK extraction attempted on ALL captured XMLA responses from Dataset/338.
 *   DB indicators: bank_dpk_idr_bn, bank_tabungan_idr_bn, bank_deposito_idr_bn,
 *                  bank_deposito_share_pct
 *
 * NPL is NOT in either cube — falls through to banking-news.ts fallback.
 * Freshness gate: 30d (OJK publishes monthly, ~30d lag)
 */

import { withBrowserPage } from './playwright-browser.js';
import { getLatestPoint, upsertPoints } from '../time-series-db.js';
import type { MacroDataPoint } from '../types.js';

const OJK_DATASET_URL = 'https://data.ojk.go.id/SJKPublic/Dataset/Dataset/Dataset/338';
const FRESHNESS_DAYS = 30;
const NOW = () => new Date().toISOString();

// ─── XMLA parser ──────────────────────────────────────────────────────────────

interface XmlaTuple {
  captions: string[];
}

interface XmlaDataset {
  axis0Tuples: XmlaTuple[];
  axis1Tuples: XmlaTuple[];
  cells: Map<number, number>;
}

function parseTuples(axisXml: string): XmlaTuple[] {
  const tuples: XmlaTuple[] = [];
  for (const tm of axisXml.matchAll(/<Tuple>([\s\S]*?)<\/Tuple>/g)) {
    const captions: string[] = [];
    for (const cm of tm[1]!.matchAll(/<Caption>([^<]*)<\/Caption>/g)) {
      captions.push(cm[1]!.trim());
    }
    tuples.push({ captions });
  }
  return tuples;
}

function parseXmlaDataset(xml: string): XmlaDataset | null {
  const ax0 = xml.match(/<Axis name="Axis0"[^>]*>([\s\S]*?)<\/Axis>/)?.[1];
  const ax1 = xml.match(/<Axis name="Axis1"[^>]*>([\s\S]*?)<\/Axis>/)?.[1];
  const cd  = xml.match(/<CellData>([\s\S]*?)<\/CellData>/)?.[1];
  if (!ax0 || !ax1 || !cd) return null;

  const cells = new Map<number, number>();
  // Value has xsi:type attribute: <Value xsi:type="xsd:double">2.337E1</Value>
  for (const m of cd.matchAll(/<Cell CellOrdinal="(\d+)"><Value[^>]*>([^<]*)<\/Value>/g)) {
    const ordinal = parseInt(m[1]!);
    const val = parseFloat(m[2]!.replace(',', '.'));
    if (!isNaN(val)) cells.set(ordinal, val);
  }

  return { axis0Tuples: parseTuples(ax0), axis1Tuples: parseTuples(ax1), cells };
}

// ─── Data extraction ──────────────────────────────────────────────────────────

function findLatestCol(tuples: XmlaTuple[]): { colIdx: number; dateStr: string } | null {
  let latestColIdx = -1;
  let latestMonthKey = '';
  for (let i = 0; i < tuples.length; i++) {
    const cap0 = tuples[i]!.captions[0] ?? '';
    if (/^\d{4}-\d{2}$/.test(cap0) && cap0 > latestMonthKey) {
      latestMonthKey = cap0;
      latestColIdx = i;
    }
  }
  if (latestColIdx < 0) return null;
  const [yr, mo] = latestMonthKey.split('-').map(Number) as [number, number];
  const lastDay = new Date(yr, mo, 0).getDate();
  return {
    colIdx: latestColIdx,
    dateStr: `${yr}-${String(mo).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  };
}

function extractRatios(ds: XmlaDataset): {
  car: number | null;
  ldr: number | null;
  date: string;
} | null {
  const latest = findLatestCol(ds.axis0Tuples);
  if (!latest) return null;
  const { colIdx, dateStr } = latest;
  const numCols = ds.axis0Tuples.length;

  let car: number | null = null;
  let ldr: number | null = null;

  for (let rowIdx = 0; rowIdx < ds.axis1Tuples.length; rowIdx++) {
    const caps = ds.axis1Tuples[rowIdx]!.captions;
    const akunCap = (caps[0] ?? '').toLowerCase();
    const kbmiCap = (caps[1] ?? '').toLowerCase();
    if (kbmiCap !== 'all') continue;

    const val = ds.cells.get(rowIdx * numCols + colIdx) ?? null;
    if (val === null) continue;

    if (car === null && (akunCap.startsWith('001') || akunCap.includes('kecukupan modal') || akunCap.includes('car'))) {
      if (val >= 5 && val <= 50) car = parseFloat(val.toFixed(2));
    }
    if (ldr === null && (akunCap.startsWith('006') || akunCap.includes('loan to deposits') || akunCap.includes('ldr'))) {
      if (val >= 30 && val <= 200) ldr = parseFloat(val.toFixed(2));
    }
  }

  return { car, ldr, date: dateStr };
}

interface DpkExtracted {
  tabungan: number | null;
  deposito: number | null;
  dpkTotal: number | null;
  date: string;
}

function extractDpk(ds: XmlaDataset): DpkExtracted | null {
  const latest = findLatestCol(ds.axis0Tuples);
  if (!latest) return null;
  const { colIdx, dateStr } = latest;
  const numCols = ds.axis0Tuples.length;

  let tabungan: number | null = null;
  let deposito: number | null = null;
  let dpkTotal: number | null = null;

  for (let rowIdx = 0; rowIdx < ds.axis1Tuples.length; rowIdx++) {
    const caps = ds.axis1Tuples[rowIdx]!.captions;
    const rowCap = (caps[0] ?? '').toLowerCase();
    const kbmiCap = (caps[1] ?? '').toLowerCase();
    if (kbmiCap !== 'all') continue;

    const rawVal = ds.cells.get(rowIdx * numCols + colIdx) ?? null;
    if (rawVal === null || rawVal <= 0) continue;

    if (rowCap.includes('tabungan') && tabungan === null) {
      tabungan = rawVal;
    } else if ((rowCap.includes('deposito') || rowCap.includes('deposit')) && deposito === null) {
      deposito = rawVal;
    } else if (
      (rowCap.includes('dana pihak ketiga') || rowCap.includes('total dpk') || rowCap.includes(' dpk')) &&
      dpkTotal === null
    ) {
      dpkTotal = rawVal;
    }
  }

  return { tabungan, deposito, dpkTotal, date: dateStr };
}

// ─── Playwright session ───────────────────────────────────────────────────────

async function captureXmlaFromDataset338(): Promise<string[]> {
  return await withBrowserPage(async (page) => {
    const captured: string[] = [];
    page.on('response', async (response) => {
      if (response.url().includes('/datasource/') && response.status() === 200) {
        try {
          const body = await response.text();
          if (body.includes('CellData')) captured.push(body);
        } catch { /* ignore */ }
      }
    });
    await page.goto(OJK_DATASET_URL, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForTimeout(6_000);
    return captured;
  }) ?? [];
}

// ─── Public exports ───────────────────────────────────────────────────────────

/**
 * Fetch Bank Umum CAR + LDR from OJK SJKPublic MetricID=338.
 * As a side effect, also persists DPK data if MetricID=331 XMLA is captured
 * in the same Dataset/338 Playwright session.
 * Freshness gate: 30d.
 */
export async function fetchBankingRatiosSjkPublic(): Promise<{
  car: MacroDataPoint | null;
  ldr: MacroDataPoint | null;
}> {
  const empty = { car: null, ldr: null };

  try {
    const [cachedCar, cachedLdr, cachedDpk] = await Promise.all([
      getLatestPoint('bank_car_pct'),
      getLatestPoint('bank_ldr_pct'),
      getLatestPoint('bank_dpk_idr_bn'),
    ]);
    const isFresh = (pt: MacroDataPoint | null) =>
      pt !== null &&
      pt.source === 'ojk_sjkpublic' &&
      (Date.now() - new Date(pt.fetchedAt).getTime()) / 86_400_000 < FRESHNESS_DAYS;

    if (isFresh(cachedCar) && isFresh(cachedLdr) && isFresh(cachedDpk)) return empty;

    const xmlaList = await captureXmlaFromDataset338();
    if (xmlaList.length === 0) return empty;

    // Try both extractors on every captured XMLA response
    let ratiosExtracted: ReturnType<typeof extractRatios> = null;
    let dpkExtracted: DpkExtracted | null = null;

    for (const xml of xmlaList) {
      const ds = parseXmlaDataset(xml);
      if (!ds || ds.cells.size === 0) continue;
      if (ratiosExtracted === null) ratiosExtracted = extractRatios(ds);
      if (dpkExtracted === null) dpkExtracted = extractDpk(ds);
    }

    const toSave: MacroDataPoint[] = [];
    const base = { category: 'banking' as const, source: 'ojk_sjkpublic', fetchedAt: NOW() };
    let carPt: MacroDataPoint | null = null;
    let ldrPt: MacroDataPoint | null = null;

    if (ratiosExtracted) {
      if (ratiosExtracted.car !== null) {
        carPt = { ...base, indicator: 'bank_car_pct', value: ratiosExtracted.car, unit: '%', date: ratiosExtracted.date };
        toSave.push(carPt);
      }
      if (ratiosExtracted.ldr !== null) {
        ldrPt = { ...base, indicator: 'bank_ldr_pct', value: ratiosExtracted.ldr, unit: '%', date: ratiosExtracted.date };
        toSave.push(ldrPt);
      }
    }

    if (dpkExtracted) {
      // Scale: OJK MetricID=331 likely IDR Miliar. DPK ~8,000,000 miliar → divide by 1000 for bn.
      const scaleFactor = (dpkExtracted.dpkTotal ?? 0) > 1_000_000 ? 1000 : 1;
      const tobn = (v: number | null) => v !== null ? parseFloat((v / scaleFactor).toFixed(0)) : null;
      const dpkBn = tobn(dpkExtracted.dpkTotal);
      const tabBn = tobn(dpkExtracted.tabungan);
      const depBn = tobn(dpkExtracted.deposito);
      const depShare = dpkBn !== null && depBn !== null && dpkBn > 0
        ? parseFloat(((depBn / dpkBn) * 100).toFixed(1))
        : null;
      const dpkBase = { ...base, date: dpkExtracted.date };
      if (dpkBn !== null) toSave.push({ ...dpkBase, indicator: 'bank_dpk_idr_bn', value: dpkBn, unit: 'bn_IDR' });
      if (tabBn !== null) toSave.push({ ...dpkBase, indicator: 'bank_tabungan_idr_bn', value: tabBn, unit: 'bn_IDR' });
      if (depBn !== null) toSave.push({ ...dpkBase, indicator: 'bank_deposito_idr_bn', value: depBn, unit: 'bn_IDR' });
      if (depShare !== null) toSave.push({ ...dpkBase, indicator: 'bank_deposito_share_pct', value: depShare, unit: '%' });
    }

    if (toSave.length > 0) await upsertPoints(toSave);
    return { car: carPt, ldr: ldrPt };
  } catch {
    return empty;
  }
}

/**
 * Read Bank Umum DPK breakdown from DB.
 * Populated by fetchBankingRatiosSjkPublic() as a side effect when MetricID=331
 * XMLA is captured during Dataset/338 page load.
 * Returns empty if not populated or stale (graceful — deposito score bump skipped).
 */
export async function fetchBankingDpkSjkPublic(): Promise<{
  dpk: MacroDataPoint | null;
  tabungan: MacroDataPoint | null;
  deposito: MacroDataPoint | null;
  depositoSharePct: MacroDataPoint | null;
}> {
  const empty = { dpk: null, tabungan: null, deposito: null, depositoSharePct: null };

  try {
    const [dpkPt, tabPt, depPt, sharePt] = await Promise.all([
      getLatestPoint('bank_dpk_idr_bn'),
      getLatestPoint('bank_tabungan_idr_bn'),
      getLatestPoint('bank_deposito_idr_bn'),
      getLatestPoint('bank_deposito_share_pct'),
    ]);

    if (!dpkPt || dpkPt.source !== 'ojk_sjkpublic') return empty;
    const ageDays = (Date.now() - new Date(dpkPt.fetchedAt).getTime()) / 86_400_000;
    if (ageDays >= FRESHNESS_DAYS) return empty;

    return { dpk: dpkPt, tabungan: tabPt, deposito: depPt, depositoSharePct: sharePt };
  } catch {
    return empty;
  }
}
