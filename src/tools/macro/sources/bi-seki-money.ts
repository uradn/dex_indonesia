/**
 * BI SEKI TABEL1_1 — Uang Beredar (M1 + M2) scraper.
 *
 * Source: Bank Indonesia SEKI Table I.1 "Uang Beredar dan Faktor-Faktor yang Mempengaruhinya"
 * URL: https://www.bi.go.id/SEKI/tabel/TABEL1_1.xls
 * Access: Direct HTTP download, no auth, no Playwright needed.
 * Coverage: Monthly since 1985, currently through ~Aug 2026 (provisional).
 * Unit: Miliar Rupiah (IDR billion).
 *
 * Target rows in "I.1" sheet (2010–present):
 *   Row 3:  Uang Kartal        — currency in circulation (M0 component)
 *   Row 8:  Giro Rupiah        — demand deposits IDR
 *   Row 11: Simpanan Berjangka — deposito total (IDR + Valas)
 *   Row 14: Tabungan Lainnya   — tabungan total (IDR + Valas)
 *   Row 17: Giro Valas         — demand deposits Valas
 *
 * Derived indicators:
 *   M1 = Uang Kartal + Giro (IDR+Valas)
 *   M2 = M1 + Tabungan + Deposito (= M1 + quasi-money)
 *   M1/M2 ratio — liquidity preference proxy (Diamond-Dybvig precursor):
 *     Normal: 45–52% | Watch >55% | Alert >60% (depositors fleeing quasi-money to cash/giro)
 *   bank_savings_deposito_ratio_pct = deposito / (deposito + tabungan) — hot-money concentration
 *     Normal: 52–57% | Watch >57% | Elevated >60%
 *
 * DB indicators saved:
 *   bank_uang_kartal_idr_bn       — currency in circulation (bn IDR)
 *   m1_money_supply_idr_bn        — M1 = kartal + giro (bn IDR)
 *   m1_m2_ratio_pct               — M1/M2 ratio (%) — D-D liquidity preference signal
 *   bank_deposito_idr_bn          — Simpanan Berjangka IDR+Valas (bn IDR)
 *   bank_tabungan_idr_bn          — Tabungan Lainnya IDR+Valas (bn IDR)
 *   bank_giro_idr_bn              — Giro total IDR+Valas (bn IDR)
 *   bank_dpk_idr_bn               — Total DPK = Giro + Tabungan + Deposito (bn IDR)
 *   bank_deposito_share_pct       — deposito / DPK-total (%)
 *   bank_savings_deposito_ratio_pct — deposito / (deposito+tabungan) (%)
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
  uangKartal: number;  // currency in circulation (0 if not found in sheet)
  giro: number;
  deposito: number;
  tabungan: number;
}

function cellNum(row: (string | number)[], col: number): number {
  const v = row[col];
  return typeof v === 'number' ? v : parseFloat(String(v ?? ''));
}

function parseSheet(rows: unknown[][]): MonthRow[] {
  if (rows.length < 20) return [];

  const r3 = rows[3] as (string | number)[];  // year headers
  const r4 = rows[4] as (string | number)[];  // month headers

  // Find row indices by label matching — check cols 0, 1, 2 for robustness
  let rowKartal = -1, rowGiro = -1, rowDeposito = -1, rowTabungan = -1, rowGiroVa = -1;
  for (let i = 2; i < Math.min(30, rows.length); i++) {
    const row = rows[i] as (string | number)[];
    for (let c = 0; c <= 2; c++) {
      const ket = String(row[c] ?? '').toLowerCase().trim().replace(/^[a-z]\.\s*/, '');
      if (rowKartal  < 0 && ket === 'uang kartal') rowKartal = i;
      if (rowGiro    < 0 && ket === 'giro rupiah') rowGiro = i;
      if (rowDeposito < 0 && ket.startsWith('simpanan berjangka')) rowDeposito = i;
      if (rowTabungan < 0 && ket.startsWith('tabungan lainnya')) rowTabungan = i;
      if (rowGiroVa  < 0 && ket === 'giro valas') rowGiroVa = i;
    }
  }

  if (rowGiro < 0 || rowDeposito < 0 || rowTabungan < 0) return [];

  const results: MonthRow[] = [];
  let currentYear = 0;

  for (let col = 3; col < r3.length; col++) {
    const yrCell = r3[col];
    if (typeof yrCell === 'number' && yrCell >= 1985 && yrCell <= 2030) currentYear = yrCell;

    const moRaw = String(r4[col] ?? '').replace('*', '').trim().toLowerCase();
    const moNum = MONTH_MAP[moRaw];
    if (!moNum || currentYear === 0) continue;

    const deposito  = cellNum(rows[rowDeposito] as (string | number)[], col);
    const tabungan  = cellNum(rows[rowTabungan] as (string | number)[], col);
    const giroRp    = cellNum(rows[rowGiro]     as (string | number)[], col);
    const giroVa    = rowGiroVa >= 0 ? cellNum(rows[rowGiroVa] as (string | number)[], col) : 0;
    const kartal    = rowKartal >= 0 ? cellNum(rows[rowKartal] as (string | number)[], col) : 0;

    if (isNaN(deposito) || isNaN(tabungan) || isNaN(giroRp)) continue;
    if (deposito <= 0 || tabungan <= 0) continue;

    const lastDay = new Date(currentYear, parseInt(moNum), 0).getDate();
    const date = `${currentYear}-${moNum}-${String(lastDay).padStart(2, '0')}`;

    results.push({
      date,
      uangKartal: isNaN(kartal) ? 0 : kartal,
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
  m1: MacroDataPoint | null;
  m1m2Ratio: MacroDataPoint | null;
  uangKartal: MacroDataPoint | null;
} | null> {
  // Freshness gate: skip if recent data exists
  const cached = await getLatestPoint('bank_deposito_idr_bn');
  if (cached && cached.source === 'bi_seki') {
    const ageDays = (Date.now() - new Date(cached.fetchedAt).getTime()) / 86_400_000;
    if (ageDays < FRESHNESS_DAYS) {
      const [dpkPt, ratioPt, tabPt, m1Pt, m1m2Pt, kartalPt] = await Promise.all([
        getLatestPoint('bank_dpk_idr_bn'),
        getLatestPoint('bank_savings_deposito_ratio_pct'),
        getLatestPoint('bank_tabungan_idr_bn'),
        getLatestPoint('m1_money_supply_idr_bn'),
        getLatestPoint('m1_m2_ratio_pct'),
        getLatestPoint('bank_uang_kartal_idr_bn'),
      ]);
      return {
        deposito: cached,
        tabungan: tabPt,
        dpk: dpkPt,
        savingsDepositoRatio: ratioPt,
        m1: m1Pt,
        m1m2Ratio: m1m2Pt,
        uangKartal: kartalPt,
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
    const dpkTotal  = r.giro + r.tabungan + r.deposito;
    const m1        = r.uangKartal + r.giro;
    const m2        = m1 + r.tabungan + r.deposito;
    const depositoShare = dpkTotal > 0 ? parseFloat(((r.deposito / dpkTotal) * 100).toFixed(1)) : null;
    const savingsRatio  = (r.deposito + r.tabungan) > 0
      ? parseFloat(((r.deposito / (r.deposito + r.tabungan)) * 100).toFixed(1))
      : null;
    const m1m2Ratio = m2 > 0 ? parseFloat(((m1 / m2) * 100).toFixed(1)) : null;

    points.push({ ...base, indicator: 'bank_deposito_idr_bn',  date: r.date, value: parseFloat(r.deposito.toFixed(0)),  unit: 'bn_IDR' });
    points.push({ ...base, indicator: 'bank_tabungan_idr_bn',  date: r.date, value: parseFloat(r.tabungan.toFixed(0)),  unit: 'bn_IDR' });
    points.push({ ...base, indicator: 'bank_giro_idr_bn',      date: r.date, value: parseFloat(r.giro.toFixed(0)),      unit: 'bn_IDR' });
    points.push({ ...base, indicator: 'bank_dpk_idr_bn',       date: r.date, value: parseFloat(dpkTotal.toFixed(0)),    unit: 'bn_IDR' });
    if (r.uangKartal > 0) {
      points.push({ ...base, indicator: 'bank_uang_kartal_idr_bn', date: r.date, value: parseFloat(r.uangKartal.toFixed(0)), unit: 'bn_IDR' });
      points.push({ ...base, indicator: 'm1_money_supply_idr_bn',  date: r.date, value: parseFloat(m1.toFixed(0)),           unit: 'bn_IDR' });
    }
    if (depositoShare !== null) {
      points.push({ ...base, indicator: 'bank_deposito_share_pct',         date: r.date, value: depositoShare, unit: '%' });
    }
    if (savingsRatio !== null) {
      points.push({ ...base, indicator: 'bank_savings_deposito_ratio_pct', date: r.date, value: savingsRatio,  unit: '%' });
    }
    if (m1m2Ratio !== null && r.uangKartal > 0) {
      points.push({ ...base, indicator: 'm1_m2_ratio_pct', date: r.date, value: m1m2Ratio, unit: '%' });
    }
  }

  if (points.length > 0) await upsertPoints(points);

  // Return latest month
  const latest   = unique[unique.length - 1]!;
  const dpkTotal = latest.giro + latest.tabungan + latest.deposito;
  const m1Latest = latest.uangKartal + latest.giro;
  const m2Latest = m1Latest + latest.tabungan + latest.deposito;
  const savingsRatio  = parseFloat(((latest.deposito / (latest.deposito + latest.tabungan)) * 100).toFixed(1));
  const m1m2RatioLat  = m2Latest > 0 ? parseFloat(((m1Latest / m2Latest) * 100).toFixed(1)) : null;

  return {
    deposito: { ...base, indicator: 'bank_deposito_idr_bn', date: latest.date, value: parseFloat(latest.deposito.toFixed(0)), unit: 'bn_IDR' },
    tabungan: { ...base, indicator: 'bank_tabungan_idr_bn', date: latest.date, value: parseFloat(latest.tabungan.toFixed(0)), unit: 'bn_IDR' },
    dpk:      { ...base, indicator: 'bank_dpk_idr_bn',      date: latest.date, value: parseFloat(dpkTotal.toFixed(0)),        unit: 'bn_IDR' },
    savingsDepositoRatio: { ...base, indicator: 'bank_savings_deposito_ratio_pct', date: latest.date, value: savingsRatio, unit: '%' },
    uangKartal: latest.uangKartal > 0 ? { ...base, indicator: 'bank_uang_kartal_idr_bn', date: latest.date, value: parseFloat(latest.uangKartal.toFixed(0)), unit: 'bn_IDR' } : null,
    m1:         latest.uangKartal > 0 ? { ...base, indicator: 'm1_money_supply_idr_bn',  date: latest.date, value: parseFloat(m1Latest.toFixed(0)),           unit: 'bn_IDR' } : null,
    m1m2Ratio:  m1m2RatioLat !== null  ? { ...base, indicator: 'm1_m2_ratio_pct',         date: latest.date, value: m1m2RatioLat,                             unit: '%'      } : null,
  };
}
