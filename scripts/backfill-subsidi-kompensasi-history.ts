/**
 * Seed `subsidi_kompensasi_combined_ytd_idr_t` with 10 years of annual APBN KiTa data.
 *
 * Sources: Kemenkeu APBN KiTa konferensi pers tahunan (realisasi sementara/final).
 * Definition: total belanja subsidi (energi + non-energi) + kompensasi energi (BBM/LPG/Listrik
 *   ke Pertamina/PLN). Pre-2022: kompensasi negligible/off-budget — figure = subsidi energi.
 *   From 2022: formal kompensasi line appeared in APBN as BBM hike was delayed → massive overrun.
 *
 * Usage:
 *   bun scripts/backfill-subsidi-kompensasi-history.ts          # seed all
 *   bun scripts/backfill-subsidi-kompensasi-history.ts --dry-run # print, no DB write
 *
 * Run once; idempotent (INSERT OR REPLACE via UNIQUE(indicator, date)).
 */

import { upsertPoints } from '../src/tools/macro/time-series-db.js';
import type { MacroDataPoint } from '../src/tools/macro/types.js';

const DRY_RUN = process.argv.includes('--dry-run');
const NOW = new Date().toISOString();

// ─────────────────────────────────────────────────────────────────────────────
// Historical annual figures (IDR triliun, s.d. 31 Desember each year)
// Sources: Kemenkeu APBN KiTa konpers realisasi sementara, media verified.
// ─────────────────────────────────────────────────────────────────────────────
interface SubsidiRecord {
  year: number;
  valueT: number;         // IDR triliun
  source: string;
  note: string;
}

const RECORDS: SubsidiRecord[] = [
  {
    year: 2016,
    valueT: 106.8,
    source: 'kemenkeu_apbnkita_2016_annual',
    note: 'Subsidi energi (BBM+LPG+Listrik). Kompensasi pre-era (negligible/off-budget).',
  },
  {
    year: 2017,
    valueT: 97.6,
    source: 'kemenkeu_apbnkita_2017_annual',
    note: 'Subsidi energi 108.7% dari target APBN-P (Rp89.9T). BBM+LPG Rp47T + Listrik Rp50.6T.',
  },
  {
    year: 2018,
    valueT: 153.5,
    source: 'kemenkeu_apbnkita_2018_annual',
    note: 'Subsidi energi 162.4% dari pagu Rp94.5T. BBM+LPG Rp97T + Listrik Rp56.5T. High oil price year; BBM hike delayed → overrun.',
  },
  {
    year: 2019,
    valueT: 136.9,
    source: 'kemenkeu_apbnkita_2019_annual',
    note: 'Subsidi energi (BBM+LPG+Listrik). Sri Mulyani confirmed realisasi below target.',
  },
  {
    year: 2020,
    valueT: 108.8,
    source: 'kemenkeu_apbnkita_2020_annual',
    note: 'COVID year. Subsidi energi compressed (travel/fuel demand collapse). Rp108.8T.',
  },
  {
    year: 2021,
    valueT: 131.5,
    source: 'kemenkeu_apbnkita_2021_annual',
    note: 'Subsidi energi recovery. BBM+LPG Rp83.7T + Listrik Rp47.8T = Rp131.5T (Liputan6/Kemenkeu).',
  },
  {
    year: 2022,
    valueT: 551.2,
    source: 'kemenkeu_apbnkita_jan2023_pressconf',
    note: 'Kompensasi Rp379.3T + Subsidi Rp171.9T. 3× dari pagu awal Rp152.5T. BBM hike Sep 2022 too late to avoid overrun.',
  },
  {
    year: 2023,
    valueT: 475.66,
    source: 'kemenkeu_apbnkita_jan2024_pressconf',
    note: '111.63% dari APBN 2023. Subsidi energi + kompensasi energi total. Source: APBN KiTa Edisi Januari 2024.',
  },
  {
    year: 2024,
    valueT: 436.0,
    source: 'kemenkeu_apbnkita_2024_estimate',
    // Nov YTD Rp420.5T (subsidi energi 157.2T + non-energi 87T + kompensasi 176.4T).
    // Dec addition estimated ~15.5T. Update with Jan 2025 konpers when confirmed.
    note: 'Provisional. Nov 2024 YTD Rp420.5T (APBN KiTa Des 2024) + Dec ~15.5T est. Update with APBN KiTa Jan 2025 konpers.',
  },
  {
    year: 2025,
    valueT: 401.6,
    source: 'kemenkeu_apbnkita_jan2026_pressconf',
    note: 'OFFICIAL. Slide 28: "Subsidi Rp281.6T + Kompensasi Rp120T = Subsidi & Kompensasi Rp401.6T" s.d. 31 Des 2025. APBN KiTa Konpers Realisasi Sementara 8 Jan 2026.',
  },
];

const POINTS: MacroDataPoint[] = RECORDS.map(r => ({
  indicator: 'subsidi_kompensasi_combined_ytd_idr_t',
  category: 'fiscal',
  date: `${r.year}-12-31`,
  value: r.valueT,
  unit: 'idr_triliun',
  source: r.source,
  fetchedAt: NOW,
}));

if (DRY_RUN) {
  console.log(`[DRY-RUN] Would seed ${POINTS.length} points:\n`);
  for (const [i, r] of RECORDS.entries()) {
    const p = POINTS[i]!;
    console.log(`  ${p.date}  Rp${r.valueT}T  [${r.source}]`);
    console.log(`           ${r.note}`);
  }
  console.log('\n[DRY-RUN] No DB writes.');
  process.exit(0);
}

console.log(`Seeding ${POINTS.length} subsidi_kompensasi_combined_ytd_idr_t historical points...`);
await upsertPoints(POINTS);
console.log('Done.\n');

for (const [i, r] of RECORDS.entries()) {
  const p = POINTS[i]!;
  console.log(`  ✓ ${p.date}  Rp${r.valueT}T  [${r.source}]`);
}
console.log('\nNote: 2026 Oct YTD (415.8T) already seeded in DB (kemenkeu_apbnkita_pressconf_nov13).');
console.log('      2024 (436T) is provisional — update when APBN KiTa Jan 2025 konpers is verified.');
