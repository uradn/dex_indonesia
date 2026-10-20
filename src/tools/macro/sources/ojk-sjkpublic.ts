/**
 * OJK SJKPublic portal scraper — data.ojk.go.id/SJKPublic
 *
 * Fetches Bank Umum financial ratios (MetricID=338, IndustriID=45) from the new OJK portal
 * (live from July 2025+, supersedes legacy ojk.ts which maxes out at June 2025).
 *
 * Approach: Playwright intercepts XMLA Execute POST responses to /SJKPublic/datasource/.
 * The WAF only blocks plain HTTP clients, not browser-originated requests. The DevExtreme
 * XmlaStore sends XMLA automatically when the page loads — we just capture the response.
 *
 * XMLA structure (MetricID=338 BU_RasioKeuangan cube):
 *   Axis0 (cols): tuples of [Bulan × Measures] — 9 tuples (1 All + 8 months Jan-Aug)
 *   Axis1 (rows): tuples of [Akun × KBMI] — 40 tuples
 *     Row 0: All|All  Row 1: 001.CAR|All  ...  Row 6: 006.LDR|All
 *     Rows 8-11: All|KBMI 1/2/3/4  Rows 12+: individual ratios × KBMI groups
 *   CellData: Value with xsi:type="xsd:double" (scientific notation)
 *   ordinal = rowIdx * numCols + colIdx
 *
 * Available ratios: 001=CAR, 002=Tier1/ATMR, 003=ROA, 004=BOPO, 005=NIM, 006=LDR, 007=LAR
 * NPL is NOT in MetricID=338 — falls through to banking-news.ts fallback.
 *
 * DB indicators: bank_car_pct, bank_ldr_pct
 * Freshness gate: 30d (OJK publishes monthly, ~30d lag)
 */

import { withBrowserPage } from './playwright-browser.js';
import { getLatestPoint, upsertPoints } from '../time-series-db.js';
import type { MacroDataPoint } from '../types.js';

const OJK_DATASET_URL = 'https://data.ojk.go.id/SJKPublic/Dataset/Dataset/Dataset/338';
const FRESHNESS_DAYS = 30;
const NOW = () => new Date().toISOString();

const ID_MONTH_MAP: Record<string, string> = {
  januari: '01', februari: '02', maret: '03', april: '04',
  mei: '05', juni: '06', juli: '07', agustus: '08',
  september: '09', oktober: '10', november: '11', desember: '12',
};

// ─── XMLA parser ──────────────────────────────────────────────────────────────

interface XmlaTuple {
  captions: string[]; // one per member in the tuple
}

interface XmlaDataset {
  axis0Tuples: XmlaTuple[]; // columns
  axis1Tuples: XmlaTuple[]; // rows
  cells: Map<number, number>; // ordinal → numeric value
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

  return {
    axis0Tuples: parseTuples(ax0),
    axis1Tuples: parseTuples(ax1),
    cells,
  };
}

// ─── Data extraction ──────────────────────────────────────────────────────────

function extractRatios(ds: XmlaDataset): {
  car: number | null;
  ldr: number | null;
  date: string;
} | null {
  const numCols = ds.axis0Tuples.length;
  if (numCols < 2) return null;

  // Axis0 tuple captions: [0] = "All", [1] = "2026-01", ..., [last] = "2026-08"
  // Each tuple has 2 members (Bulan + Measures), so caption[0] = month label.
  // Find latest non-"All" column.
  let latestColIdx = 0;
  let latestMonthKey = '';
  for (let i = 0; i < ds.axis0Tuples.length; i++) {
    const cap0 = ds.axis0Tuples[i]!.captions[0] ?? '';
    if (/^\d{4}-\d{2}$/.test(cap0)) {
      if (cap0 > latestMonthKey) {
        latestMonthKey = cap0;
        latestColIdx = i;
      }
    }
  }
  if (!latestMonthKey) return null; // no monthly data found

  // Build date string: "2026-08" → "2026-08-31" (last day)
  const [yr, mo] = latestMonthKey.split('-').map(Number) as [number, number];
  const lastDay = new Date(yr, mo, 0).getDate();
  const date = `${yr}-${String(mo).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  // Axis1 rows: find rows where 2nd caption = "All" (KBMI = All banks total)
  // Row structure: [Akun caption | KBMI caption] — pick KBMI == "All"
  let car: number | null = null;
  let ldr: number | null = null;

  for (let rowIdx = 0; rowIdx < ds.axis1Tuples.length; rowIdx++) {
    const caps = ds.axis1Tuples[rowIdx]!.captions;
    const akunCap = (caps[0] ?? '').toLowerCase();
    const kbmiCap = (caps[1] ?? '').toLowerCase();

    if (kbmiCap !== 'all') continue; // only total-bank rows

    const ordinal = rowIdx * numCols + latestColIdx;
    const val = ds.cells.get(ordinal) ?? null;
    if (val === null) continue;

    // 001 = CAR (Rasio Pemenuhan Kecukupan Modal Minimum)
    if (akunCap.startsWith('001') || akunCap.includes('kecukupan modal') || akunCap.includes('car')) {
      if (car === null && val >= 5 && val <= 50) car = parseFloat(val.toFixed(2));
    }
    // 006 = LDR (Loan to Deposits Ratio)
    if (akunCap.startsWith('006') || akunCap.includes('loan to deposits') || akunCap.includes('ldr')) {
      if (ldr === null && val >= 30 && val <= 200) ldr = parseFloat(val.toFixed(2));
    }
  }

  return { car, ldr, date };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function fetchBankingRatiosSjkPublic(): Promise<{
  car: MacroDataPoint | null;
  ldr: MacroDataPoint | null;
}> {
  const empty = { car: null, ldr: null };

  try {
    // Freshness gate: skip if both car+ldr are fresh (< 30d)
    const [cachedCar, cachedLdr] = await Promise.all([
      getLatestPoint('bank_car_pct'),
      getLatestPoint('bank_ldr_pct'),
    ]);
    const isFresh = (pt: MacroDataPoint | null) =>
      pt !== null &&
      pt.source === 'ojk_sjkpublic' &&
      (Date.now() - new Date(pt.fetchedAt).getTime()) / 86_400_000 < FRESHNESS_DAYS;

    if (isFresh(cachedCar) && isFresh(cachedLdr)) return empty;

    const xmlaList = await withBrowserPage(async (page) => {
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
    });

    if (!xmlaList || xmlaList.length === 0) return empty;

    // Pick response with most cell data
    const bestXml = xmlaList.reduce((a, b) =>
      (b.match(/<Cell CellOrdinal/g) ?? []).length > (a.match(/<Cell CellOrdinal/g) ?? []).length ? b : a
    );

    const ds = parseXmlaDataset(bestXml);
    if (!ds || ds.cells.size === 0) return empty;

    const extracted = extractRatios(ds);
    if (!extracted) return empty;

    const base = {
      category: 'banking' as const,
      source: 'ojk_sjkpublic',
      fetchedAt: NOW(),
      date: extracted.date,
    };

    const carPt = extracted.car !== null
      ? { ...base, indicator: 'bank_car_pct', value: extracted.car, unit: '%' } as MacroDataPoint
      : null;
    const ldrPt = extracted.ldr !== null
      ? { ...base, indicator: 'bank_ldr_pct', value: extracted.ldr, unit: '%' } as MacroDataPoint
      : null;

    const toSave = [carPt, ldrPt].filter((p): p is MacroDataPoint => p !== null);
    if (toSave.length > 0) await upsertPoints(toSave);

    return { car: carPt, ldr: ldrPt };
  } catch {
    return empty;
  }
}
