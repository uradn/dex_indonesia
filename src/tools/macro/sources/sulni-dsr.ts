/**
 * SULNI TabI.7 DSR Fetcher — BI Tier-1 Annualized Debt Service Ratio
 *
 * WHY THIS FILE:
 *   World Bank DT.TDS.DECT.EX.ZS (env ULN_DSR_PCT) uses exports+GNI basis,
 *   consistently ~1.27× higher than BI SULNI Tier-1 (current account receipts basis).
 *   WB 2024 = 25.17%; SULNI Q4-2024 = 18.58%; SULNI Q3-2026 = 13.31%.
 *   The two series are NOT interchangeable. Engine uses SULNI Tier-1 with a calibrated
 *   threshold of 19.5% (= IMF 25% / 1.27 adjustment factor).
 *
 * DATA SOURCE:
 *   https://www.bi.go.id/en/statistik/ekonomi-keuangan/sulni/Documents/SULNI-{Month}-{Year}.zip
 *   Published ~6–7 weeks after quarter end. ZIP contains Excel workbook.
 *   Sheet: TabI.7 | Row 15 (0-based) = DSR Tier-1 Annualized | Latest quarter column.
 *
 * FRESHNESS: 90 days (quarterly cadence)
 * DB INDICATOR: uln_dsr_tier1_ann_pct
 * ENV OVERRIDE: SULNI_DSR_TIER1_PCT (always wins — same pattern as BI_DNDF_OUTSTANDING_BN)
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import * as XLSX from 'xlsx';
import { dexterPath } from '../../../utils/paths.js';
import { getLatestPoint, upsertPoints } from '../time-series-db.js';
import type { MacroDataPoint } from '../types.js';

const FRESHNESS_DAYS = 90;
const CACHE_DIR = dexterPath('cache', 'sulni_dsr');

// Calibrated SULNI Tier-1 threshold = IMF 25% / 1.27 methodology delta
// Exported so uln-engine.ts can import without hardcoding
export const SULNI_DSR_TIER1_THRESHOLD_GREEN  = 14;
export const SULNI_DSR_TIER1_THRESHOLD_YELLOW = 19.5;
export const SULNI_DSR_TIER1_THRESHOLD_ORANGE = 23.6; // = 30% / 1.27
export const SULNI_DSR_TIER1_THRESHOLD_RED    = 27.6; // = 35% / 1.27

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function quarterDateToIso(label: string): string | null {
  // "Q3-2026**" → "2026-09-30"
  const m = label.replace(/\*/g, '').trim().match(/^Q(\d)-(\d{4})$/);
  if (!m) return null;
  const q = parseInt(m[1]!, 10);
  const yr = m[2]!;
  const ends: Record<number, string> = { 1: '03-31', 2: '06-30', 3: '09-30', 4: '12-31' };
  return `${yr}-${ends[q] ?? '12-31'}`;
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function sulniZipUrl(monthName: string, year: number): string {
  return `https://www.bi.go.id/en/statistik/ekonomi-keuangan/sulni/Documents/SULNI-${monthName}-${year}.zip`;
}

async function downloadZip(url: string, destPath: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(60_000),
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    });
    if (!res.ok) return false;
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 10_000) return false; // sanity: real ZIP >500KB
    writeFileSync(destPath, Buffer.from(buf));
    return true;
  } catch {
    return false;
  }
}

function extractAndParse(zipPath: string): { dsr: number; quarter: string; date: string } | null {
  const extractDir = join(CACHE_DIR, 'extracted');
  ensureDir(extractDir);

  try {
    execSync(`unzip -o -q "${zipPath}" -d "${extractDir}"`, { timeout: 30_000 });
  } catch {
    return null;
  }

  // Find value Excel file (BI names it TABEL_INDONESIA {Month}{Year}_value.xlsx or similar)
  let xlsxPath: string | null = null;
  try {
    const hits = execSync(
      `find "${extractDir}" \\( -name "*value*.xlsx" -o -name "TABEL_INDONESIA*.xlsx" \\) 2>/dev/null`,
      { timeout: 10_000, encoding: 'utf8' },
    ).trim().split('\n').filter(Boolean);
    xlsxPath = hits[0] ?? null;
  } catch {
    return null;
  }
  if (!xlsxPath) return null;

  try {
    const buf = readFileSync(xlsxPath);
    const wb = XLSX.read(buf, { type: 'buffer', cellFormula: false, cellHTML: false });
    const ws = wb.Sheets['TabI.7'];
    if (!ws) return null;

    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });

    // Row 5 (0-based): header with period labels "Q1-2024", "Q3-2026**", etc.
    const headerRow = rows[5] as Array<unknown>;
    if (!headerRow) return null;

    // Find rightmost quarter column
    let latestColIdx = -1;
    let latestLabel = '';
    for (let i = headerRow.length - 1; i >= 0; i--) {
      const cell = String(headerRow[i] ?? '').trim();
      if (/^Q\d-\d{4}/.test(cell)) {
        latestColIdx = i;
        latestLabel = cell;
        break;
      }
    }
    if (latestColIdx === -1) return null;

    // Row 15 (0-based): DSR Tier-1 Annualized (% of current account receipts)
    const dsrRow = rows[15] as Array<unknown>;
    if (!dsrRow) return null;

    const rawVal = dsrRow[latestColIdx];
    const dsr = rawVal !== null && rawVal !== undefined ? parseFloat(String(rawVal)) : NaN;
    if (isNaN(dsr) || dsr <= 0 || dsr > 100) return null;

    const quarter = latestLabel.replace(/\*/g, '').trim();
    const date = quarterDateToIso(latestLabel);
    if (!date) return null;

    return { dsr: parseFloat(dsr.toFixed(2)), quarter, date };
  } catch {
    return null;
  }
}

/**
 * Fetch DSR Tier-1 Annualized from BI SULNI quarterly ZIP publication.
 *
 * Source priority:
 *   1. SULNI_DSR_TIER1_PCT env var — emergency manual override
 *   2. DB cache (90-day gate on fetchedAt)
 *   3. SULNI ZIP download → TabI.7 Excel parse
 *
 * Returns null if unavailable. Caller (uln-engine) falls back to ULN_DSR_PCT / WB API.
 */
export async function fetchUlnDsrSulni(): Promise<MacroDataPoint | null> {
  const NOW = new Date().toISOString();
  const today = NOW.slice(0, 10);

  // Tier 1: env override
  const envVal = process.env.SULNI_DSR_TIER1_PCT;
  if (envVal) {
    const v = parseFloat(envVal);
    if (!isNaN(v) && v > 0 && v < 100) {
      const pt: MacroDataPoint = {
        indicator: 'uln_dsr_tier1_ann_pct', category: 'uln',
        date: today, value: v, unit: '%',
        source: 'env_manual', fetchedAt: NOW,
      };
      await upsertPoints([pt]);
      return pt;
    }
  }

  // Tier 2: DB cache (gate on fetchedAt — data is quarterly but ZIP re-releases are rare)
  const cached = await getLatestPoint('uln_dsr_tier1_ann_pct');
  if (cached) {
    const ageDays = (Date.now() - new Date(cached.fetchedAt ?? cached.date).getTime()) / 86_400_000;
    if (ageDays < FRESHNESS_DAYS) {
      return {
        indicator: 'uln_dsr_tier1_ann_pct', category: 'uln',
        date: cached.date, value: cached.value, unit: '%',
        source: cached.source, fetchedAt: cached.fetchedAt,
      };
    }
  }

  // Tier 3: download + parse SULNI ZIP
  ensureDir(CACHE_DIR);

  const now = new Date();
  // Try current month then 1–2 months back (BI publishes ~6-7 wks after quarter end)
  const monthsToTry: Array<[string, number]> = [];
  for (let offset = 0; offset <= 2; offset++) {
    const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    monthsToTry.push([MONTH_NAMES[d.getMonth()]!, d.getFullYear()]);
  }

  for (const [monthName, year] of monthsToTry) {
    const zipFileName = `SULNI-${monthName}-${year}.zip`;
    const zipPath = join(CACHE_DIR, zipFileName);

    if (existsSync(zipPath)) {
      // Re-download if cached ZIP is older than FRESHNESS_DAYS (stale quarter)
      const { mtimeMs } = await stat(zipPath);
      if ((Date.now() - mtimeMs) / 86_400_000 > FRESHNESS_DAYS) {
        const url = sulniZipUrl(monthName, year);
        if (!await downloadZip(url, zipPath)) continue;
      }
    } else {
      const url = sulniZipUrl(monthName, year);
      if (!await downloadZip(url, zipPath)) continue;
    }

    const parsed = extractAndParse(zipPath);
    if (!parsed) continue;

    const pt: MacroDataPoint = {
      indicator: 'uln_dsr_tier1_ann_pct', category: 'uln',
      date: parsed.date, value: parsed.dsr, unit: '%',
      source: `bi_sulni_zip_tabi7_${parsed.quarter.toLowerCase().replace('-', '')}`,
      fetchedAt: NOW,
    };
    await upsertPoints([pt]);
    return pt;
  }

  return null;
}
