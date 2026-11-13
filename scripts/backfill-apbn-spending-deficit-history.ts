/**
 * Seed `apbn_deficit_ytd_idr_t` and `apbn_spending_ytd_idr_t` with historical APBN KiTa data.
 *
 * Sources: Kemenkeu APBN KiTa konferensi pers bulanan/tahunan.
 * Definition:
 *   apbn_deficit_ytd_idr_t  — realisasi defisit YTD (IDR triliun, negative = deficit; stored as absolute)
 *   apbn_spending_ytd_idr_t — realisasi belanja negara YTD (IDR triliun)
 *
 * Usage:
 *   bun scripts/backfill-apbn-spending-deficit-history.ts          # seed all
 *   bun scripts/backfill-apbn-spending-deficit-history.ts --dry-run # print, no DB write
 *
 * Run once; idempotent (INSERT OR REPLACE via UNIQUE(indicator, date)).
 */

import { upsertPoints } from '../src/tools/macro/time-series-db.js';
import type { MacroDataPoint } from '../src/tools/macro/types.js';

const DRY_RUN = process.argv.includes('--dry-run');
const NOW = new Date().toISOString();

// ─────────────────────────────────────────────────────────────────────────────
// apbn_deficit_ytd_idr_t — annual full-year realisasi defisit
// Source: APBN KiTa konpers realisasi sementara (Jan following year)
// ─────────────────────────────────────────────────────────────────────────────
interface DeficitRecord {
  date: string;      // YYYY-MM-DD (use 31 Dec for annual; last known pressconf date for YTD)
  valueT: number;    // IDR triliun (absolute; deficit stored positive)
  source: string;
  note: string;
}

const DEFICIT_RECORDS: DeficitRecord[] = [
  {
    date: '2024-12-31',
    valueT: 509.2,
    source: 'kemenkeu_apbnkita_jan2025_pressconf',
    note: 'Realisasi defisit APBN 2024: Rp509.2T = 2.29% PDB. APBN KiTa Konpers Jan 2025.',
  },
  {
    date: '2025-12-31',
    valueT: 695.1,
    source: 'kemenkeu_apbnkita_jan2026_pressconf',
    note: 'Realisasi defisit APBN 2025: Rp695.1T = 2.85% PDB. Slide 11 APBN KiTa Realisasi Sementara 8 Jan 2026.',
  },
  {
    date: '2026-10-31',
    valueT: 379.0,
    source: 'kemenkeu_apbnkita_pressconf_nov13',
    note: 'YTD Oktober 2026: defisit Rp379.0T = 54.9% dari pagu Rp689.15T. APBN KiTa konpers Nov 13 2026.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// apbn_spending_ytd_idr_t — realisasi belanja negara YTD
// Source: APBN KiTa pressconf slides
// ─────────────────────────────────────────────────────────────────────────────
interface SpendingRecord {
  date: string;
  valueT: number;
  source: string;
  note: string;
}

const SPENDING_RECORDS: SpendingRecord[] = [
  {
    date: '2024-12-31',
    valueT: 3359.8,
    source: 'kemenkeu_apbnkita_jan2025_pressconf',
    note: 'Realisasi belanja APBN 2024 full-year: Rp3,359.8T (87.4% dari pagu Rp3,842.73T). APBN KiTa Jan 2025.',
  },
  {
    date: '2025-03-31',
    valueT: 620.27,
    source: 'kemenkeu_apbnkita_apr2025_pressconf',
    note: 'Realisasi belanja Q1 2025: Rp620.27T. APBN KiTa konpers Apr 2025.',
  },
  {
    date: '2025-06-30',
    valueT: 1407.1,
    source: 'kemenkeu_apbnkita_jul2025_pressconf',
    note: 'Realisasi belanja s.d. Juni 2025: Rp1,407.1T (36.6% dari pagu). APBN KiTa konpers Jul 2025.',
  },
  {
    date: '2025-09-30',
    valueT: 2234.8,
    source: 'kemenkeu_apbnkita_oct2025_pressconf',
    note: 'Realisasi belanja s.d. September 2025: Rp2,234.8T. APBN KiTa konpers Okt 2025.',
  },
  {
    date: '2025-12-31',
    valueT: 3451.4,
    source: 'kemenkeu_apbnkita_jan2026_pressconf',
    note: 'Realisasi belanja APBN 2025 full-year: Rp3,451.4T (89.8% dari pagu). Slide 11 APBN KiTa Realisasi Sementara 8 Jan 2026.',
  },
  {
    date: '2026-10-31',
    valueT: 2763.1,
    source: 'kemenkeu_apbnkita_pressconf_nov13',
    note: 'Realisasi belanja s.d. Oktober 2026: Rp2,763.1T (71.9% dari pagu Rp3,842.73T). APBN KiTa konpers Nov 13 2026.',
  },
];

const DEFICIT_POINTS: MacroDataPoint[] = DEFICIT_RECORDS.map(r => ({
  indicator: 'apbn_deficit_ytd_idr_t',
  category: 'fiscal',
  date: r.date,
  value: r.valueT,
  unit: 'idr_triliun',
  source: r.source,
  fetchedAt: NOW,
}));

const SPENDING_POINTS: MacroDataPoint[] = SPENDING_RECORDS.map(r => ({
  indicator: 'apbn_spending_ytd_idr_t',
  category: 'fiscal',
  date: r.date,
  value: r.valueT,
  unit: 'idr_triliun',
  source: r.source,
  fetchedAt: NOW,
}));

if (DRY_RUN) {
  console.log(`[DRY-RUN] apbn_deficit_ytd_idr_t — ${DEFICIT_POINTS.length} points:\n`);
  for (const [i, r] of DEFICIT_RECORDS.entries()) {
    const p = DEFICIT_POINTS[i]!;
    console.log(`  ${p.date}  Rp${r.valueT}T  [${r.source}]`);
    console.log(`           ${r.note}`);
  }
  console.log(`\n[DRY-RUN] apbn_spending_ytd_idr_t — ${SPENDING_POINTS.length} points:\n`);
  for (const [i, r] of SPENDING_RECORDS.entries()) {
    const p = SPENDING_POINTS[i]!;
    console.log(`  ${p.date}  Rp${r.valueT}T  [${r.source}]`);
    console.log(`           ${r.note}`);
  }
  console.log('\n[DRY-RUN] No DB writes.');
  process.exit(0);
}

console.log(`Seeding ${DEFICIT_POINTS.length} apbn_deficit_ytd_idr_t points...`);
await upsertPoints(DEFICIT_POINTS);
for (const [i, r] of DEFICIT_RECORDS.entries()) {
  console.log(`  ✓ ${DEFICIT_POINTS[i]!.date}  Rp${r.valueT}T  [${r.source}]`);
}

console.log(`\nSeeding ${SPENDING_POINTS.length} apbn_spending_ytd_idr_t points...`);
await upsertPoints(SPENDING_POINTS);
for (const [i, r] of SPENDING_RECORDS.entries()) {
  console.log(`  ✓ ${SPENDING_POINTS[i]!.date}  Rp${r.valueT}T  [${r.source}]`);
}

console.log('\nDone.');
console.log('Note: 2026 Oct figures are from APBN KiTa konpers Nov 13 2026 (Suahasil Nazara).');
console.log('      Update 2026 monthly as each konpers is published (~10th of following month).');
