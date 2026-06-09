/**
 * M12 Divergence Check — political risk vs macro stress signals
 *
 * Flags when M12 (political risk) scores GREEN while other macro modules
 * are stressed — indicating keyword coverage gap or lagging sentiment data.
 *
 * Run:  bun scripts/check-m12-divergence.ts
 * Cron: add to macro-cron-alerts or morning brief pipeline
 *
 * Exit codes:
 *   0 = no divergence
 *   1 = stale data (DB indicators >48h old — run engines first)
 *   2 = divergence detected → review political-risk-terms.ts
 */

import { getLatestPoint } from '../src/tools/macro/time-series-db.js';

const STALE_HOURS = 48;
const M12_GREEN_THRESHOLD = 33;    // score below this = GREEN (no political stress detected)
const DIVERGENCE_MIN_SIGNALS = 2;  // need ≥N other modules stressed to flag divergence

// ── Stress thresholds (from CLAUDE.md / module calibrations) ────────────────
const THRESHOLDS = {
  usdidr_spot:          { warn: 17_000,  label: 'USDIDR',  unit: '',    dir: 'above', note: '>3% gap from APBN 16,500' },
  indonesia_cds_5y_bps: { warn: 150,     label: 'CDS 5Y',  unit: 'bps', dir: 'above', note: 'narrative divergence flag' },
  sbn_10y_yield_pct:    { warn: 7.5,     label: 'SBN 10Y', unit: '%',   dir: 'above', note: 'term premium >2.25pp above BI 5.25%' },
  vix_level:            { warn: 25,      label: 'VIX',     unit: '',    dir: 'above', note: 'global risk-off context' },
  unemployment_rate_pct:{ warn: 5.5,     label: 'Unemployment', unit: '%', dir: 'above', note: 'above BPS stress watch zone' },
} as const;

type IndicatorKey = keyof typeof THRESHOLDS;

function staleDays(fetchedAt: string): number {
  return (Date.now() - new Date(fetchedAt).getTime()) / 3_600_000;
}

function fmt(val: number, unit: string): string {
  return unit === 'bps' ? `${val.toFixed(0)}${unit}` : `${val.toLocaleString('en-US', { maximumFractionDigits: 2 })}${unit}`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const DATE = new Date().toISOString().slice(0, 10);
console.log(`\nM12 Divergence Check — ${DATE}`);
console.log('─'.repeat(52));

// 1. Compute approximate M12 score from stored components
const [food, unrest, stability, unemployment] = await Promise.all([
  getLatestPoint('political_food_stress_score'),
  getLatestPoint('political_social_unrest_score'),
  getLatestPoint('political_stability_stress_score'),
  getLatestPoint('unemployment_rate_pct'),
]);

const foodScore       = food?.value       ?? 20;
const unrestScore     = unrest?.value     ?? 15;
const stabilityScore  = stability?.value  ?? 10;
const unemploymentPct = unemployment?.value ?? 4.8;
const unemploymentComponent = Math.min(25, Math.max(0, Math.round(((unemploymentPct - 4.8) / (6.5 - 4.8)) * 25)));
const m12Score = Math.min(100, 10 + unemploymentComponent + Math.min(35, foodScore) + Math.min(30, unrestScore) + Math.min(25, stabilityScore));

const m12Freshness = food?.fetchedAt ?? unrest?.fetchedAt ?? null;
const m12Stale = m12Freshness ? staleDays(m12Freshness) > STALE_HOURS : true;

console.log(`\nM12 Political Risk Score (approx): ${m12Score}/100 ${m12Score < M12_GREEN_THRESHOLD ? '🟢 GREEN' : m12Score < 50 ? '🟡 YELLOW' : m12Score < 70 ? '🟠 ORANGE' : '🔴 RED'}`);
console.log(`  food_pressure=${foodScore}  social_unrest=${unrestScore}  stability=${stabilityScore}  unemployment=${unemploymentPct}%`);
if (m12Stale) console.log(`  ⚠️  M12 data stale (>48h) — run political_risk_engine first`);

// 2. Check cross-module stress signals
console.log(`\nCross-module stress signals:`);

const stressedSignals: string[] = [];
let staleCount = 0;

for (const [indicator, cfg] of Object.entries(THRESHOLDS) as [IndicatorKey, typeof THRESHOLDS[IndicatorKey]][]) {
  if (indicator === 'unemployment_rate_pct') continue; // already in M12

  const point = await getLatestPoint(indicator);
  if (!point) {
    console.log(`  ${cfg.label.padEnd(14)} n/a   (not in DB — run relevant engine)`);
    continue;
  }

  const stale = staleDays(point.fetchedAt) > STALE_HOURS;
  if (stale) staleCount++;

  const breached = cfg.dir === 'above' ? point.value > cfg.warn : point.value < cfg.warn;
  const status = breached ? '🔴 STRESSED' : '🟢 ok';
  const staleTag = stale ? ' [STALE]' : '';

  console.log(`  ${cfg.label.padEnd(14)} ${fmt(point.value, cfg.unit).padEnd(10)} threshold=${fmt(cfg.warn, cfg.unit)}  ${status}${staleTag}  (${cfg.note})`);

  if (breached) {
    stressedSignals.push(`${cfg.label}=${fmt(point.value, cfg.unit)} (>${fmt(cfg.warn, cfg.unit)})`);
  }
}

// 3. Divergence verdict
console.log(`\n${'─'.repeat(52)}`);

if (m12Stale && staleCount >= 2) {
  console.log(`⚠️  STALE DATA — refresh engines before interpreting divergence`);
  console.log(`   Run: bun scripts/morning-check.ts`);
  process.exit(1);
}

if (m12Score < M12_GREEN_THRESHOLD && stressedSignals.length >= DIVERGENCE_MIN_SIGNALS) {
  console.log(`\n🚨 M12 DIVERGENCE DETECTED`);
  console.log(`   M12 score: ${m12Score}/100 (GREEN — no political stress flagged)`);
  console.log(`   But ${stressedSignals.length} macro module(s) stressed:`);
  stressedSignals.forEach((s) => console.log(`     • ${s}`));
  console.log(`\n   ACTION: Review src/tools/macro/sources/political-risk-terms.ts`);
  console.log(`   → Check if emerging protest/unrest vocabulary is missing from keyword lists`);
  console.log(`   → Check Exa/X recent results for signals M12 is not catching`);
  process.exit(2);
} else if (stressedSignals.length > 0) {
  console.log(`${stressedSignals.length} macro signal(s) stressed but M12=${m12Score} (not GREEN) — consistent.`);
} else {
  console.log(`No divergence — M12 score consistent with macro context.`);
}
