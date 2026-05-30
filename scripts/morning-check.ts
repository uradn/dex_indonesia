/**
 * Indonesia Macro Morning Brief — all 12 modules + silent crisis detector.
 * Run: bun scripts/morning-check.ts
 */
import { runFxDefenseEngine } from '../src/tools/macro/fx-defense-engine.js';
import { runBoPEngine } from '../src/tools/macro/bop-engine.js';
import { runSovereignRiskEngine } from '../src/tools/macro/sovereign-risk-engine.js';
import { runForeignFlowEngine } from '../src/tools/macro/foreign-flow-engine.js';
import { runCommodityEngine } from '../src/tools/macro/commodity-engine.js';
import { runRegimeEngine } from '../src/tools/macro/regime-engine.js';
import { runNarrativeDivergenceEngine } from '../src/tools/macro/narrative-divergence-engine.js';
import { runBankingStressEngine } from '../src/tools/macro/banking-stress-engine.js';
import { runMarketStressEngine } from '../src/tools/macro/market-stress-engine.js';
import { runFiscalEngine } from '../src/tools/macro/fiscal-engine.js';
import { runDomesticPressureEngine } from '../src/tools/macro/domestic-pressure-engine.js';
import { runPoliticalRiskEngine } from '../src/tools/macro/political-risk-engine.js';
import { runSilentCrisisDetector } from '../src/tools/macro/silent-crisis-detector.js';

const DATE = new Date().toISOString().slice(0, 10);
const BAR = '━'.repeat(50);

function emoji(level: string): string {
  return level === 'red' ? '🔴' : level === 'orange' ? '🟠' : level === 'yellow' ? '🟡' : '🟢';
}

console.log(`\n# Indonesia Macro Morning Brief — ${DATE}`);
console.log('Running all 12 modules in parallel...\n');

const [fx, bop, sov, flow, commodity, regime, narrative, banking, market, fiscal, domestic, political] =
  await Promise.allSettled([
    runFxDefenseEngine(),
    runBoPEngine(),
    runSovereignRiskEngine(),
    runForeignFlowEngine(),
    runCommodityEngine(),
    runRegimeEngine(),
    runNarrativeDivergenceEngine(),
    runBankingStressEngine(),
    runMarketStressEngine(),
    runFiscalEngine(),
    runDomesticPressureEngine(),
    runPoliticalRiskEngine(),
  ]);

const crisis = await runSilentCrisisDetector();

// ─── HEADER ────────────────────────────────────────────────────────────────
console.log(BAR);
console.log(`SILENT CRISIS PROBABILITY: ${crisis.silentCrisisProbability}%  ${emoji(crisis.alertLevel)} ${crisis.alertLevel.toUpperCase()}`);
console.log(`SYNTHETIC STABILITY SCORE: ${crisis.syntheticStabilityScore}/100`);
console.log(`CROSS-CONFIRMED MODULES:   ${crisis.crossConfirmationCount}/12`);
console.log(BAR);

// ─── MODULE SCORECARD ──────────────────────────────────────────────────────
console.log('\n## Module Scorecard\n');
for (const m of crisis.moduleScores) {
  const avail = m.available ? '' : ' [NO DATA]';
  console.log(`  ${emoji(m.alertLevel)} ${m.module.padEnd(24)} ${String(m.score).padStart(3)}/100  ${m.alertLevel.toUpperCase()}${avail}`);
}

// ─── CRITICAL FLAGS ────────────────────────────────────────────────────────
if (crisis.keyFlags.length > 0) {
  console.log('\n## Critical Flags\n');
  for (const f of crisis.keyFlags) console.log(`  ⚠️  ${f}`);
}

// ─── MODULE DETAIL ─────────────────────────────────────────────────────────
console.log('\n## Module Detail\n');

// 1 — FX Defense
if (fx.status === 'fulfilled') {
  const r = fx.value;
  const spot = r.usdIdr?.current;
  const vol = r.usdIdrVol30d?.current;
  const res = r.fxReserves?.current;
  console.log(`### 1. FX Defense  ${emoji(r.scoreCard.alertLevel)} ${r.scoreCard.score}/100`);
  console.log(`  USDIDR: ${spot?.toLocaleString() ?? 'n/a'} | Vol 30d: ${vol?.toFixed(2) ?? 'n/a'}% | Reserves: ${res?.toFixed(1) ?? 'n/a'} bn USD`);
  if (r.pseudoStabilityFlag) console.log('  ⚠️  PSEUDO-STABILITY: low vol while reserves depleting');
  for (const f of r.scoreCard.flags ?? []) console.log(`  ⚠️  ${f}`);
} else {
  console.log(`### 1. FX Defense  ❌ ${String(fx.reason).slice(0, 80)}`);
}

// 2 — BoP
if (bop.status === 'fulfilled') {
  const r = bop.value;
  const tb = r.tradeBalance.current;
  const res = r.fxReserves.current;
  console.log(`\n### 2. BoP / External  ${emoji(r.scoreCard.alertLevel)} ${r.scoreCard.score}/100`);
  console.log(`  Trade balance: ${tb?.toFixed(1) ?? 'n/a'} bn USD | Reserves: ${res?.toFixed(1) ?? 'n/a'} bn USD`);
  for (const f of r.scoreCard.flags ?? []) console.log(`  ⚠️  ${f}`);
} else {
  console.log(`\n### 2. BoP  ❌ ${String(bop.reason).slice(0, 80)}`);
}

// 3 — Sovereign Risk
if (sov.status === 'fulfilled') {
  const r = sov.value;
  const cds = r.cds5y?.current;
  const sbn = r.sbn10y?.current;
  console.log(`\n### 3. Sovereign Risk  ${emoji(r.scoreCard.alertLevel)} ${r.sovereignRiskScore}/100`);
  console.log(`  CDS 5Y: ${cds?.toFixed(1) ?? 'n/a'} bps | SBN 10Y: ${sbn?.toFixed(3) ?? 'n/a'}% | Fiscal credibility: ${r.fiscalCredibilityIndex}/100`);
  for (const f of r.scoreCard.flags ?? []) console.log(`  ⚠️  ${f}`);
} else {
  console.log(`\n### 3. Sovereign Risk  ❌ ${String(sov.reason).slice(0, 80)}`);
}

// 4 — Foreign Flow
if (flow.status === 'fulfilled') {
  const r = flow.value;
  console.log(`\n### 4. Foreign Flow  ${emoji(r.scoreCard.alertLevel)} ${r.scoreCard.score}/100`);
  for (const f of r.scoreCard.flags ?? []) console.log(`  ⚠️  ${f}`);
} else {
  console.log(`\n### 4. Foreign Flow  ❌ ${String(flow.reason).slice(0, 80)}`);
}

// 5 — Commodity
if (commodity.status === 'fulfilled') {
  const r = commodity.value;
  console.log(`\n### 5. Commodity  ${emoji(r.scoreCard.alertLevel)} ${r.scoreCard.score}/100`);
  const oilStr = r.brentPrice !== null
    ? `Brent: $${r.brentPrice.toFixed(1)}/bbl` + (r.oilDeviation !== null ? ` (${r.oilDeviation > 0 ? '+' : ''}${r.oilDeviation.toFixed(0)}% vs APBN)` : '')
    : null;
  const cushionStr = `Cushion: ${r.commodityCushionScore}/100 | Oil Vuln: ${r.oilVulnerabilityIndex}/100`;
  if (oilStr) console.log(`  ${oilStr} | ${cushionStr}`);
  else console.log(`  ${cushionStr}`);
  const stressed = r.topExportsByStress.filter((c) => c.stress === 'red' || c.stress === 'orange').slice(0, 3);
  if (stressed.length > 0) {
    console.log(`  Stressed exports: ${stressed.map((c) => `${c.indicator.replace('_usd_per_', '($/')}@${c.price.toFixed(0)} z=${c.zScore?.toFixed(1) ?? 'n/a'}`).join(' | ')}`);
  }
  for (const f of r.scoreCard.flags ?? []) console.log(`  ⚠️  ${f}`);
} else {
  console.log(`\n### 5. Commodity  ❌ ${String(commodity.reason).slice(0, 80)}`);
}

// 6 — Regime
if (regime.status === 'fulfilled') {
  const r = regime.value;
  console.log(`\n### 6. Regime  ${emoji(r.alertLevel)} | ${r.regimeLabel ?? r.currentRegime}`);
  const pmiStr = r.latestPmi !== null ? ` | PMI: ${r.latestPmi.toFixed(1)}` : '';
  console.log(`  Growth ROC: ${r.growthRoc >= 0 ? '+' : ''}${r.growthRoc.toFixed(2)}% (${r.growthTrend}) | Inflation ROC: ${r.inflationRoc >= 0 ? '+' : ''}${r.inflationRoc.toFixed(2)}% (${r.inflationTrend})${pmiStr}`);
  if (r.shiftProbability > 20) {
    console.log(`  ⚠️  Regime shift probability: ${r.shiftProbability.toFixed(0)}%${r.mostLikelyShift ? ` → ${r.mostLikelyShift}` : ''}`);
  }
} else {
  console.log(`\n### 6. Regime  ❌ ${String(regime.reason).slice(0, 80)}`);
}

// 7 — Narrative Credibility
// narrativeCredibilityScore = 100 − avgDivergence (higher = more credible = LESS stress).
// Display stress score = 100 − credibility, consistent with all other modules.
if (narrative.status === 'fulfilled') {
  const r = narrative.value;
  const narrativeStress = 100 - r.narrativeCredibilityScore;
  console.log(`\n### 7. Narrative Credibility  ${emoji(r.alertLevel)} ${narrativeStress}/100`);
  console.log(`  Credibility index: ${r.narrativeCredibilityScore}/100`);
  for (const f of r.flags.slice(0, 2)) console.log(`  ⚠️  ${f}`);
} else {
  console.log(`\n### 7. Narrative  ❌ ${String(narrative.reason).slice(0, 80)}`);
}

// 8 — Banking Stress
if (banking.status === 'fulfilled') {
  const r = banking.value;
  console.log(`\n### 8. Banking Stress  ${emoji(r.alert)} ${r.stressScore}/100`);
  console.log(`  NPL: ${r.nplPct?.toFixed(2) ?? 'n/a'}% | LDR: ${r.ldrPct?.toFixed(1) ?? 'n/a'}% | CAR: ${r.carPct?.toFixed(1) ?? 'n/a'}%`);
  for (const f of r.flags ?? []) console.log(`  ⚠️  ${f}`);
} else {
  console.log(`\n### 8. Banking  ❌ ${String(banking.reason).slice(0, 80)}`);
}

// 9 — Market Stress
if (market.status === 'fulfilled') {
  const r = market.value;
  console.log(`\n### 9. Market (IHSG)  ${emoji(r.alert)} ${r.stressScore}/100`);
  console.log(`  P/E: ${r.peRatio?.toFixed(1) ?? 'n/a'} | A/D ratio: ${r.adRatio?.toFixed(2) ?? 'n/a'}`);
  for (const f of r.flags ?? []) console.log(`  ⚠️  ${f}`);
} else {
  console.log(`\n### 9. Market  ❌ ${String(market.reason).slice(0, 80)}`);
}

// 10 — Fiscal
if (fiscal.status === 'fulfilled') {
  const r = fiscal.value;
  console.log(`\n### 10. Fiscal  ${emoji(r.alert)} ${r.stressScore}/100`);
  console.log(`  Revenue absorption: ${r.revenueAbsorptionPct?.toFixed(0) ?? 'n/a'}% | Projected deficit: ${r.projectedDeficitPctGdp?.toFixed(2) ?? 'n/a'}% GDP`);
  for (const f of r.flags) console.log(`  ⚠️  ${f}`);
} else {
  console.log(`\n### 10. Fiscal  ❌ ${String(fiscal.reason).slice(0, 80)}`);
}

// 11 — Domestic Pressure (food/CPI)
if (domestic.status === 'fulfilled') {
  const r = domestic.value;
  console.log(`\n### 11. Domestic Pressure  ${emoji(r.alert)} ${r.stressScore}/100`);
  console.log(`  Food CPI: ${r.foodInflationYoy?.toFixed(2) ?? 'n/a'}% YoY | Food Stress Index: ${r.foodStressIndex.toFixed(0)}/100`);
  if (r.domesticPressureAlert) console.log(`  🚨 DOMESTIC PRESSURE ALERT: ${r.spikedCommodities.join(', ')}`);
  for (const f of r.flags) console.log(`  ⚠️  ${f}`);
} else {
  console.log(`\n### 11. Domestic Pressure  ❌ ${String(domestic.reason).slice(0, 80)}`);
}

// 12 — Political Risk
if (political.status === 'fulfilled') {
  const r = political.value;
  console.log(`\n### 12. Political Risk  ${emoji(r.alert)} ${r.stressScore}/100`);
  console.log(`  Unemployment: ${r.unemploymentRate?.toFixed(2) ?? 'n/a'}% | Social unrest: ${r.socialUnrestComponent}/30 | Stability: ${r.stabilityComponent}/25`);
  if (r.seasonalContext) console.log(`  📅 Seasonal: ${r.seasonalContext}`);
  for (const f of r.flags) console.log(`  ⚠️  ${f}`);
  if (r.topHeadlines.length > 0) {
    console.log(`  Top headlines:`);
    r.topHeadlines.slice(0, 3).forEach(h => console.log(`    • ${h}`));
  }
} else {
  console.log(`\n### 12. Political Risk  ❌ ${String(political.reason).slice(0, 80)}`);
}

// ─── BOTTOM LINE ───────────────────────────────────────────────────────────
console.log(`\n${BAR}`);
console.log('## Bottom Line\n');
console.log(crisis.narrative);
if (crisis.stressVectors.length > 0) {
  console.log(`\nActive stress vectors:`);
  for (const v of crisis.stressVectors) console.log(`  • ${v}`);
}
console.log(`\n${BAR}\n`);
