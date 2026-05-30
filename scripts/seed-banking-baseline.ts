/**
 * Seed banking KPIs with latest verified OJK data.
 * Run when OJK scraper is unavailable or to refresh stale DB entries.
 * Usage: bun scripts/seed-banking-baseline.ts
 *
 * Sources:
 *   CAR 25.81%  — OJK LSPI Triwulan II 2025 (Q2 2025)
 *   LDR 83.99%  — OJK SPI November 2025
 *
 * Update these values each quarter from:
 *   https://ojk.go.id/id/kanal/perbankan/data-dan-statistik/laporan-profil-industri-perbankan
 */
import { upsertPoints } from '../src/tools/macro/time-series-db.js';
import type { MacroDataPoint } from '../src/tools/macro/time-series-db.js';

const NOW = () => new Date().toISOString();

const SEEDS: MacroDataPoint[] = [
  {
    indicator: 'bank_car_pct',
    category: 'banking',
    date: '2025-06-30',
    value: 25.81,
    unit: '%',
    source: 'ojk_lspi_q2_2025',
    fetchedAt: NOW(),
  },
  {
    indicator: 'bank_ldr_pct',
    category: 'banking',
    date: '2025-11-30',
    value: 83.99,
    unit: '%',
    source: 'ojk_spi_nov_2025',
    fetchedAt: NOW(),
  },
];

await upsertPoints(SEEDS);

console.log('Banking baseline seeded:');
for (const s of SEEDS) {
  console.log(`  ${s.indicator}: ${s.value}% (${s.date}, source: ${s.source})`);
}
console.log('\nNote: update quarterly from OJK LSPI reports.');
