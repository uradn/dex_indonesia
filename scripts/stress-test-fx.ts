/**
 * FX Stress Test — simulate USDIDR at a hypothetical level.
 * Injects rate via DEXTER_STRESS_FX env var (overrides Yahoo live fetch).
 * Runs all 12 modules + silent crisis detector, then clears override.
 *
 * Usage: bun scripts/stress-test-fx.ts [rate]
 * Example: bun scripts/stress-test-fx.ts 18000
 */

const STRESS_RATE = parseFloat(process.argv[2] ?? '18000');
if (isNaN(STRESS_RATE) || STRESS_RATE < 10_000 || STRESS_RATE > 30_000) {
  console.error('Usage: bun scripts/stress-test-fx.ts <rate>  (e.g. 18000)');
  process.exit(1);
}

// Must set BEFORE any module import so fetchUsdIdrSpot() picks it up
process.env.DEXTER_STRESS_FX = String(STRESS_RATE);

import { getLatestPoint } from '../src/tools/macro/time-series-db.js';
import { runSilentCrisisDetector } from '../src/tools/macro/silent-crisis-detector.js';

const TODAY = new Date().toISOString().slice(0, 10);
const BAR = '━'.repeat(50);

function emoji(level: string) {
  return level === 'red' ? '🔴' : level === 'orange' ? '🟠' : level === 'yellow' ? '🟡' : '🟢';
}

// Baseline from DB
const baseline = await getLatestPoint('usdidr_spot');
const baselineRate = baseline?.value ?? null;

console.log(`\n${BAR}`);
console.log(`  FX STRESS TEST — USDIDR = ${STRESS_RATE.toLocaleString('id-ID')}`);
console.log(`  Baseline (live): ${baselineRate?.toLocaleString('id-ID') ?? 'unknown'}`);
if (baselineRate) {
  const delta = ((STRESS_RATE - baselineRate) / baselineRate * 100);
  console.log(`  Delta from live: ${delta > 0 ? '+' : ''}${delta.toFixed(2)}%`);
}
console.log(`  vs APBN 16,500: +${((STRESS_RATE - 16_500) / 16_500 * 100).toFixed(2)}%`);
console.log(`${BAR}\n`);

console.log('Running all 12 modules with USDIDR override...\n');
const crisis = await runSilentCrisisDetector();

// Clear override
delete process.env.DEXTER_STRESS_FX;

const sc = crisis.scoreCard;
const lvl = sc?.alertLevel ?? 'green';
const emojiMain = emoji(lvl);

console.log(BAR);
console.log(`SILENT CRISIS PROBABILITY: ${crisis.silentCrisisProbability}%  ${emojiMain} ${lvl.toUpperCase()}`);
console.log(`SYNTHETIC STABILITY SCORE: ${crisis.syntheticStabilityScore}/100`);
console.log(`CROSS-CONFIRMED MODULES:   ${crisis.crossConfirmationCount}/12`);
console.log(BAR);

console.log(`\n## Module Scorecard (stress USDIDR=${STRESS_RATE.toLocaleString('id-ID')})\n`);
for (const m of crisis.moduleScores) {
  const s = Math.round(m.score);
  const l = m.alertLevel;
  console.log(`  ${emoji(l)} ${m.module.padEnd(20)} ${String(s).padStart(3)}/100  ${l.toUpperCase()}`);
}

if (crisis.criticalFlags?.length) {
  console.log('\n## Critical Flags\n');
  for (const f of crisis.criticalFlags) console.log(`  ⚠️  ${f}`);
}

console.log(`\n${BAR}`);
if (baselineRate) {
  console.log(`Baseline ${baselineRate.toLocaleString('id-ID')} | Stress ${STRESS_RATE.toLocaleString('id-ID')} | Δ ${((STRESS_RATE-baselineRate)/baselineRate*100).toFixed(2)}%`);
}
console.log(BAR + '\n');
