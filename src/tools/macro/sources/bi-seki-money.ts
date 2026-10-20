/**
 * BI SEKI TABEL1_1 — Uang Beredar (Broad Money Supply / M2) scraper.
 *
 * Source: Bank Indonesia SEKI Table I.1 "Uang Beredar dan Faktor-Faktor yang Mempengaruhinya"
 * URL: https://www.bi.go.id/SEKI/tabel/TABEL1_1.xls
 * Access: Direct HTTP download, no auth, no Playwright needed.
 * Coverage: Monthly since 1985, currently through ~Aug 2026 (provisional).
 * Unit: Miliar Rupiah (IDR billion).
 *
 * Replaces MetricID=331 (OJK SJKPublic balance sheet XMLA) — that page never fires XMLA calls.
 * This source is authoritative (Bank Indonesia official) and covers 40 years.
 *
 * Target rows in "I.1" sheet (2010–present):
 *   Row 8:  Giro Rupiah        — demand deposits IDR
 *   Row 11: Simpanan Berjangka — deposito total (IDR + Valas)
 *   Row 12: └─ Rupiah only
 *   Row 14: Tabungan Lainnya   — tabungan total (IDR + Valas)
 *   Row 15: └─ Rupiah only
 *   Row 17: Giro Valas         — demand deposits Valas
 *
 * Key derived indicator:
 *   bank_savings_deposito_ratio_pct = deposito / (deposito + tabungan)
 *   Measures hot-money concentration in savings DPK (excludes transactional giro).
 *   Historical range: ~52-60% (2010=60%, 2026=52.5% — structural decline via fin-inclusion).
 *   Thresholds: >57% = watch (+4), >60% = elevated (+8).
 *
 * DB indicators saved:
 *   bank_deposito_idr_bn          — Simpanan Berjangka IDR+Valas (bn IDR)
 *   bank_tabungan_idr_bn          — Tabungan Lainnya IDR+Valas (bn IDR)
 *   bank_giro_idr_bn              — Giro total IDR+Valas (bn IDR)
 *   bank_dpk_idr_bn               — Total DPK = Giro + Tabungan + Deposito (bn IDR)
 *   bank_deposito_share_pct       — deposito / DPK-total (%) — approx 35-47%
 *   bank_savings_deposito_ratio_pct — deposito / (deposito+tabungan) (%) — hot-money proxy
 *
 * Freshness gate: 30d (BI SEKI updates monthly, ~30d lag from reference month)
 */

import * as XLSX from 'xlsx';
import { getLatestPoint, upsertPoints } from '../time-series-db.js';
import type { MacroDataPoint } from '../types.js';

const SEKI_URL = 'https://www.bi.go.id/SEKI/tabel/TABEL1_1.xls';
const FRESHNESS_DAYS = 30;
const NOW = () => new Date().toISOString();

const MONTH_MAP: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

interface MonthRow {
  date: string;   // YYYY-MM-DD (last day of month)
  giro: number;
  deposito: number;
  tabungan: number;
}

function parseSheet(rows: unknown[][]): MonthRow[] {
  if (rows.length < 20) return [];

  const r3 = rows[3] as (string | number)[];  // year headers
  const r4 = rows[4] as (string | number)[];  // month headers

  // Find row indices by label matching
  let rowGiro = -1, rowDeposito = -1, rowTabungan = -1, rowGiroVa = -1;
  for (let i = 5; i < Math.min(25, rows.length); i++) {
    const row = rows[i] as (string | number)[];
    const ket = String(row[2] ?? '').toLowerCase().trim();
    if (rowGiro < 0 && ket === 'giro rupiah') rowGiro = i;
    if (rowDeposito < 0 && ket.startsWith('simpanan berjangka')) rowDeposito = i;
    if (rowTabungan < 0 && ket.startsWith('tabungan lainnya')) rowTabungan = i;
    if (rowGiroVa < 0 && ket === 'giro valas') rowGiroVa = i;
  }

  if (rowGiro < 0 || rowDeposito < 0 || rowTabungan < 0) return [];

  const results: MonthRow[] = [];
  let currentYear = 0;

  for (let col = 3; col < r3.length; col++) {
    // Update current year when a numeric year header appears
    const yrCell = r3[col];
    if (typeof yrCell === 'number' && yrCell >= 1985 && yrCell <= 2030) {
      currentYear = yrCell;
    }

    // Get month
    const moRaw = String(r4[col] ?? '').replace('*', '').trim().toLowerCase();
    const moNum = MONTH_MAP[moRaw];
    if (!moNum || currentYear === 0) continue;

    // Extract values
    const rowD = rows[rowDeposito] as (string | number)[];
    const rowT = rows[rowTabungan] as (string | number)[];
    const rowG = rows[rowGiro] as (string | number)[];
    const rowGv = rowGiroVa >= 0 ? rows[rowGiroVa] as (string | number)[] : null;

    const deposito = typeof rowD[col] === 'number' ? rowD[col] as number : parseFloat(String(rowD[col]));
    const tabungan = typeof rowT[col] === 'number' ? rowT[col] as number : parseFloat(String(rowT[col]));
    const giroRp   = typeof rowG[col] === 'number' ? rowG[col] as number : parseFloat(String(rowG[col]));
    const giroVa   = rowGv ? (typeof rowGv[col] === 'number' ? rowGv[col] as number : parseFloat(String(rowGv[col]))) : 0;

    if (isNaN(deposito) || isNaN(tabungan) || isNaN(giroRp)) continue;
    if (deposito <= 0 || tabungan <= 0) continue;

    const lastDay = new Date(currentYear, parseInt(moNum), 0).getDate();
    const date = `${currentYear}-${moNum}-${String(lastDay).padStart(2, '0')}`;

    results.push({
      date,
      giro: giroRp + (isNaN(giroVa) ? 0 : giroVa),
      deposito,
      tabungan,
    });
  }

  return results;
}

async function downloadSekiXls(): Promise<Buffer | null> {
  try {
    const res = await fetch(SEKI_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/vnd.ms-excel,*/*',
      },
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Fetch BI SEKI M2 data: deposito + tabungan + giro monthly series.
 * On first run, backfills DB with all available history (2010–present from "I.1" sheet).
 * Returns the latest month's indicators, or null if download fails.
 * Freshness gate: 30d.
 */
export async function fetchBankingDpkBiSeki(): Promise<{
  deposito: MacroDataPoint | null;
  tabungan: MacroDataPoint | null;
  dpk: MacroDataPoint | null;
  savingsDepositoRatio: MacroDataPoint | null;
} | null> {
  // Freshness gate: skip if recent data exists
  const cached = await getLatestPoint('bank_deposito_idr_bn');
  if (cached && cached.source === 'bi_seki') {
    const ageDays = (Date.now() - new Date(cached.fetchedAt).getTime()) / 86_400_000;
    if (ageDays < FRESHNESS_DAYS) {
      const [dpkPt, ratioPt, tabPt] = await Promise.all([
        getLatestPoint('bank_dpk_idr_bn'),
        getLatestPoint('bank_savings_deposito_ratio_pct'),
        getLatestPoint('bank_tabungan_idr_bn'),
      ]);
      return {
        deposito: cached,
        tabungan: tabPt,
        dpk: dpkPt,
        savingsDepositoRatio: ratioPt,
      };
    }
  }

  const buf = await downloadSekiXls();
  if (!buf) return null;

  const wb = XLSX.read(buf, { type: 'buffer' });

  // Collect all months from all sheets (sheets may overlap — upsert handles dedup)
  const allRows: MonthRow[] = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, defval: '' });
    const parsed = parseSheet(rows);
    allRows.push(...parsed);
  }

  if (allRows.length === 0) return null;

  // Sort by date; deduplicate by date (last write wins — later sheet has more accurate data)
  allRows.sort((a, b) => a.date.localeCompare(b.date));
  const seen = new Map<string, MonthRow>();
  for (const r of allRows) seen.set(r.date, r);
  const unique = Array.from(seen.values());

  const fetchedAt = NOW();
  const points: MacroDataPoint[] = [];
  const base = { category: 'banking' as const, source: 'bi_seki', fetchedAt };

  for (const r of unique) {
    const dpkTotal = r.giro + r.tabungan + r.deposito;
    const depositoShare = dpkTotal > 0 ? parseFloat(((r.deposito / dpkTotal) * 100).toFixed(1)) : null;
    const savingsRatio = (r.deposito + r.tabungan) > 0
      ? parseFloat(((r.deposito / (r.deposito + r.tabungan)) * 100).toFixed(1))
      : null;

    points.push({ ...base, indicator: 'bank_deposito_idr_bn', date: r.date, value: parseFloat(r.deposito.toFixed(0)), unit: 'bn_IDR' });
    points.push({ ...base, indicator: 'bank_tabungan_idr_bn', date: r.date, value: parseFloat(r.tabungan.toFixed(0)), unit: 'bn_IDR' });
    points.push({ ...base, indicator: 'bank_giro_idr_bn',    date: r.date, value: parseFloat(r.giro.toFixed(0)), unit: 'bn_IDR' });
    points.push({ ...base, indicator: 'bank_dpk_idr_bn',     date: r.date, value: parseFloat(dpkTotal.toFixed(0)), unit: 'bn_IDR' });
    if (depositoShare !== null) {
      points.push({ ...base, indicator: 'bank_deposito_share_pct', date: r.date, value: depositoShare, unit: '%' });
    }
    if (savingsRatio !== null) {
      points.push({ ...base, indicator: 'bank_savings_deposito_ratio_pct', date: r.date, value: savingsRatio, unit: '%' });
    }
  }

  if (points.length > 0) await upsertPoints(points);

  // Return latest month
  const latest = unique[unique.length - 1]!;
  const dpkTotal = latest.giro + latest.tabungan + latest.deposito;
  const savingsRatio = parseFloat(((latest.deposito / (latest.deposito + latest.tabungan)) * 100).toFixed(1));

  return {
    deposito: { ...base, indicator: 'bank_deposito_idr_bn', date: latest.date, value: parseFloat(latest.deposito.toFixed(0)), unit: 'bn_IDR' },
    tabungan: { ...base, indicator: 'bank_tabungan_idr_bn', date: latest.date, value: parseFloat(latest.tabungan.toFixed(0)), unit: 'bn_IDR' },
    dpk:      { ...base, indicator: 'bank_dpk_idr_bn',      date: latest.date, value: parseFloat(dpkTotal.toFixed(0)), unit: 'bn_IDR' },
    savingsDepositoRatio: { ...base, indicator: 'bank_savings_deposito_ratio_pct', date: latest.date, value: savingsRatio, unit: '%' },
  };
}
