/**
 * Food Price Stress Test — simulate commodity price shocks on Module 11 + downstream.
 *
 * Two modes:
 *   --fx-delta 0.10   IDR depreciation % → auto-calculate per-commodity price via FX sensitivity
 *   --multiplier 1.15 Flat multiplier applied to ALL commodities (e.g. La Niña scenario)
 *
 * FX sensitivity coefficients are explicitly printed before run so assumptions are visible.
 * This is intentionally SEPARATE from stress-test-fx.ts — different shock, different time horizon.
 *
 * Usage:
 *   bun scripts/stress-test-food.ts --fx-delta 0.10
 *   bun scripts/stress-test-food.ts --multiplier 1.15
 *   bun scripts/stress-test-food.ts --fx-delta 0.10 --multiplier 1.05  (combine: FX + base spike)
 */

// ─── Parse args ───────────────────────────────────────────────────────────────
let fxDelta = 0;     // e.g. 0.10 = 10% IDR depreciation
let flatMult = 1.0;  // e.g. 1.05 = 5% general food spike (La Niña, drought)

for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--fx-delta' && process.argv[i + 1]) {
    fxDelta = parseFloat(process.argv[++i]!);
  } else if (process.argv[i] === '--multiplier' && process.argv[i + 1]) {
    flatMult = parseFloat(process.argv[++i]!);
  }
}

if (fxDelta === 0 && flatMult === 1.0) {
  console.error('Usage:');
  console.error('  bun scripts/stress-test-food.ts --fx-delta 0.10');
  console.error('  bun scripts/stress-test-food.ts --multiplier 1.15');
  console.error('  bun scripts/stress-test-food.ts --fx-delta 0.10 --multiplier 1.05');
  process.exit(1);
}

// ─── FX pass-through coefficients ────────────────────────────────────────────
// Source: import dependency + historical pass-through analysis.
// For every 1% IDR depreciation, commodity IDR price rises by coefficient%.
// These are structural estimates — NOT real-time — update manually if trade structure changes.
const FX_SENSITIVITY: Record<string, { label: string; coeff: number; reason: string }> = {
  pihps_bawang_putih_idr:       { label: 'Bawang Putih',        coeff: 0.75, reason: '~90% impor China' },
  pihps_daging_sapi_idr:        { label: 'Daging Sapi',         coeff: 0.40, reason: '~35% impor' },
  pihps_gula_pasir_idr:         { label: 'Gula Pasir',          coeff: 0.35, reason: '~40% impor raw sugar' },
  pihps_minyak_goreng_idr:      { label: 'Minyak Goreng',       coeff: 0.20, reason: 'CPO domestik, refining energy cost' },
  pihps_daging_ayam_idr:        { label: 'Daging Ayam',         coeff: 0.25, reason: 'pakan ~50% impor (jagung/soy)' },
  pihps_telur_ayam_idr:         { label: 'Telur Ayam',          coeff: 0.22, reason: 'pakan ~50% impor (jagung/soy)' },
  pihps_beras_medium_idr:       { label: 'Beras Medium',        coeff: 0.12, reason: 'pupuk + diesel pass-through' },
  pihps_bawang_merah_idr:       { label: 'Bawang Merah',        coeff: 0.08, reason: 'domestik, hanya transport/fuel' },
  pihps_cabai_merah_kriting_idr:{ label: 'Cabai Merah',         coeff: 0.08, reason: 'domestik, hanya transport/fuel' },
  pihps_cabai_rawit_merah_idr:  { label: 'Cabai Rawit',         coeff: 0.08, reason: 'domestik, hanya transport/fuel' },
};

// ─── Compute per-commodity multipliers ───────────────────────────────────────
// Final multiplier = flatMult × (1 + fxDelta × coeff)
const overrides: Record<string, number> = {};
for (const [indicator, meta] of Object.entries(FX_SENSITIVITY)) {
  const fxComponent = 1 + fxDelta * meta.coeff;
  overrides[indicator] = parseFloat((flatMult * fxComponent).toFixed(4));
}

// ─── Baseline prices (IDR) — used for projection when DB has no PIHPS data ───
// Source: kisaran harga pasar rata-rata Mei 2026.
// Update manually jika kondisi pasar berubah signifikan.
const BASELINE_PRICES: Record<string, number> = {
  pihps_bawang_putih_idr:        45_000,
  pihps_daging_sapi_idr:        135_000,
  pihps_gula_pasir_idr:          18_000,
  pihps_minyak_goreng_idr:       16_000,
  pihps_daging_ayam_idr:         35_000,
  pihps_telur_ayam_idr:          28_000,
  pihps_beras_medium_idr:        13_000,
  pihps_bawang_merah_idr:        30_000,
  pihps_cabai_merah_kriting_idr: 35_000,
  pihps_cabai_rawit_merah_idr:   45_000,
};

// ─── Print assumption table BEFORE running ───────────────────────────────────
const BAR = '━'.repeat(56);
console.log(`\n${BAR}`);
console.log('  FOOD PRICE STRESS TEST');
if (fxDelta > 0) console.log(`  FX delta:   +${(fxDelta * 100).toFixed(1)}% IDR depreciation`);
if (flatMult !== 1.0) console.log(`  Flat mult:  ×${flatMult.toFixed(2)} (drought/La Niña/supply shock)`);
console.log(`${BAR}`);
console.log('\n  Proyeksi harga (baseline estimasi — bukan data live):\n');
console.log(`  ${'Komoditas'.padEnd(22)} ${'Baseline'.padStart(10)}  ${'Stressed'.padStart(10)}  ${'Delta'.padStart(6)}  Alasan`);
console.log(`  ${'─'.repeat(22)} ${'─'.repeat(10)}  ${'─'.repeat(10)}  ${'─'.repeat(6)}  ${'─'.repeat(26)}`);
for (const [indicator, meta] of Object.entries(FX_SENSITIVITY)) {
  const mult   = overrides[indicator]!;
  const base   = BASELINE_PRICES[indicator]!;
  const stress = Math.round(base * mult);
  const pct    = ((mult - 1) * 100).toFixed(1);
  const baseStr   = base.toLocaleString('id-ID') + '/kg';
  const stressStr = stress.toLocaleString('id-ID') + '/kg';
  console.log(`  ${meta.label.padEnd(22)} ${baseStr.padStart(10)}  ${stressStr.padStart(10)}  +${pct.padStart(4)}%  ${meta.reason}`);
}
console.log('');
console.log('  ⚠️  Koefisien adalah estimasi struktural — bukan konstanta real-time.');
console.log('  ⚠️  Policy intervention (Bulog, HET, operasi pasar) bisa break transmisi ini.');
console.log('  ⚠️  Proyeksi di atas pakai baseline estimasi — akurasi naik jika DB punya data PIHPS live.');
console.log(`\n${BAR}\n`);

// ─── Set env var and import engines ──────────────────────────────────────────
// Must set BEFORE importing engines so override is picked up at module load time
process.env.DEXTER_STRESS_FOOD = JSON.stringify(overrides);

import { runDomesticPressureEngine } from '../src/tools/macro/domestic-pressure-engine.js';
import { runFiscalEngine } from '../src/tools/macro/fiscal-engine.js';
import { runNarrativeDivergenceEngine } from '../src/tools/macro/narrative-divergence-engine.js';
import { runPoliticalRiskEngine } from '../src/tools/macro/political-risk-engine.js';

function emoji(level: string) {
  return level === 'red' ? '🔴' : level === 'orange' ? '🟠' : level === 'yellow' ? '🟡' : '🟢';
}

console.log('Running affected modules with food price overrides...\n');

const [domestic, fiscal, narrative, political] = await Promise.allSettled([
  runDomesticPressureEngine(),
  runFiscalEngine(),
  runNarrativeDivergenceEngine(),
  runPoliticalRiskEngine(),
]);

delete process.env.DEXTER_STRESS_FOOD;

// ─── Print results ────────────────────────────────────────────────────────────
console.log(BAR);
console.log('  MODULE RESULTS\n');

if (domestic.status === 'fulfilled') {
  const r = domestic.value;
  const e = emoji(r.alert);
  console.log(`  ${e} domestic_pressure  ${String(r.stressScore).padStart(3)}/100  ${r.alert.toUpperCase()}`);
  console.log(`     Food Stress Index: ${r.foodStressIndex}/100`);
  console.log(`     Food CPI: ${r.foodInflationYoy?.toFixed(2) ?? 'n/a'}% YoY (APBN implied: 3.75%)`);
  if (r.spikedCommodities.length > 0) {
    console.log(`     Spiked: ${r.spikedCommodities.join(', ')}`);
  }
  const withData = r.commodityScores.filter(c => c.price !== null);
  const noData   = r.commodityScores.filter(c => c.price === null);
  if (withData.length > 0) {
    console.log('\n  Per-komoditas (stress):');
    for (const c of withData) {
      const origPrice = c.price! / (overrides[c.indicator] ?? 1);
      const delta = ((c.price! - origPrice) / origPrice * 100).toFixed(1);
      const zStr = c.zScore90d !== null ? `z=${c.zScore90d.toFixed(2)}` : 'z=n/a';
      console.log(`    ${emoji(c.alertLevel)} ${c.label.padEnd(22)} ${Math.round(origPrice).toLocaleString('id-ID').padStart(8)} → ${c.price!.toLocaleString('id-ID').padStart(8)} IDR  (+${delta}%)  ${zStr}`);
    }
  }
  if (noData.length > 0) {
    console.log(`\n  ⚠️  ${noData.length} komoditas tanpa data di DB: ${noData.map(c => c.label).join(', ')}`);
    console.log('     Jalankan morning-check atau health-check dulu untuk populate PIHPS data.');
  }
  if (r.flags.length > 0) {
    console.log('');
    for (const f of r.flags) console.log(`     ⚠️  ${f}`);
  }
}

console.log('');

if (fiscal.status === 'fulfilled') {
  const r = fiscal.value;
  console.log(`  ${emoji(r.alert)} fiscal              ${String(r.stressScore).padStart(3)}/100  ${r.alert.toUpperCase()}`);
  console.log(`     Revenue absorption: ${r.revenueAbsorption?.toFixed(0) ?? 'n/a'}% | Projected deficit: ${r.projectedDeficitPctGdp?.toFixed(2) ?? 'n/a'}% GDP`);
  if (r.flags?.length) for (const f of r.flags) console.log(`     ⚠️  ${f}`);
}

console.log('');

if (narrative.status === 'fulfilled') {
  const r = narrative.value;
  console.log(`  ${emoji(r.alertLevel)} narrative           ${String(Math.round(100 - r.narrativeCredibilityScore)).padStart(3)}/100  ${r.alertLevel.toUpperCase()}`);
  if (r.flags?.length) for (const f of r.flags.slice(0, 3)) console.log(`     ⚠️  ${f}`);
}

console.log('');

if (political.status === 'fulfilled') {
  const r = political.value;
  console.log(`  ${emoji(r.alert)} political_risk      ${String(r.stressScore).padStart(3)}/100  ${r.alert.toUpperCase()}`);
  console.log(`     Food→social contract transmission: food stress elevates unrest risk`);
  if (r.flags?.length) for (const f of r.flags.slice(0, 2)) console.log(`     ⚠️  ${f}`);
}

console.log(`\n${BAR}`);
console.log('  ⚠️  Ini bukan proyeksi — ini ilustrasi tekanan jika harga terealisasi.');
console.log('  ⚠️  Fiscal + political tidak secara langsung baca food prices: downstream interpretation.');
console.log(BAR + '\n');
