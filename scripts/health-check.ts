/**
 * Indonesia macro health check — data freshness + env var audit.
 *
 *   bun scripts/health-check.ts          # default — show stale + missing
 *   bun scripts/health-check.ts --all    # also list fresh indicators
 *
 * Exit code: 0 if no critical issues, 1 if any RED-tier gaps detected.
 */
import { Database } from 'bun:sqlite';
import { INDICATORS, type IndicatorFreshnessSpec } from '../src/tools/macro/freshness.js';

const showAll = process.argv.includes('--all');
type IndicatorSpec = IndicatorFreshnessSpec;

// Env vars and the features they enable.
const ENV_VARS: Array<{ name: string; required: boolean; feature: string }> = [
  // Required for engine to function at all
  { name: 'EXASEARCH_API_KEY',                  required: true,  feature: 'Exa neural news search (M12 political, M5 MSCI, M8 fintech, M10 subsidi, M4 B50/DMO, M12 PHK)' },
  { name: 'TAVILY_API_KEY',                     required: false, feature: 'Tavily Indonesian portal fallback for all Exa-using sources' },
  // LLM
  { name: 'ANTHROPIC_API_KEY',                  required: false, feature: 'Claude LLM (default model)' },
  { name: 'OPENAI_API_KEY',                     required: false, feature: 'OpenAI LLM + embeddings' },
  // Module-specific
  { name: 'X_BEARER_TOKEN',                     required: false, feature: 'M12 X/Twitter API v2 real-time social feed' },
  { name: 'BPS_API_KEY',                        required: false, feature: 'BPS WebAPI direct CPI/trade/unemployment' },
  { name: 'EODHD_API_KEY',                      required: false, feature: 'EODHD USDIDR + IHSG tertiary fallback' },
  // Manual overrides
  { name: 'BI_DNDF_OUTSTANDING_BN',             required: false, feature: 'M3 FX defense DNDF off-balance-sheet adjustment (annual LKT manual update)' },
  { name: 'MSCI_CLASSIFICATION_STATUS',         required: false, feature: 'M5 MSCI status override (default: auto-detect)' },
  { name: 'PERTALITE_PRICE_IDR',                required: false, feature: 'M11 BBM subsidy gap override on price hike' },
];

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const fs = Bun.file('.env');
    const content = fs.text();
    // synchronous text read via Bun.file().text() returns Promise; use fallback
    // we'll read sync via readFileSync
  } catch {}
  const env = process.env;
  return Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined)) as Record<string, string>;
}

function color(s: string, c: 'green'|'yellow'|'orange'|'red'|'muted'): string {
  const codes = { green: 32, yellow: 33, orange: 33, red: 31, muted: 90 };
  return `\x1b[${codes[c]}m${s}\x1b[0m`;
}

function emoji(c: 'green'|'yellow'|'orange'|'red'): string {
  return c === 'red' ? '🔴' : c === 'orange' ? '🟠' : c === 'yellow' ? '🟡' : '🟢';
}

function ageDays(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
}

console.log('━'.repeat(70));
console.log('Indonesia Macro Health Check — ' + new Date().toISOString().slice(0, 19));
console.log('━'.repeat(70));

// ── 1. Env var audit ──
console.log('\n## Environment Variables\n');
const env = loadEnv();
const envReport: Array<{ status: string; name: string; feature: string }> = [];
let missingRequired = 0;
for (const v of ENV_VARS) {
  const has = !!env[v.name];
  const status = has ? color('SET    ', 'green') : v.required ? color('MISSING', 'red') : color('—      ', 'muted');
  if (!has && v.required) missingRequired++;
  envReport.push({ status, name: v.name, feature: v.feature });
}
for (const r of envReport) {
  console.log(`  ${r.status}  ${r.name.padEnd(32)} ${r.feature}`);
}
if (missingRequired > 0) {
  console.log(color(`\n  ⚠ ${missingRequired} required env var(s) missing — core engine functionality degraded.`, 'red'));
}

// ── 2. Data freshness ──
console.log('\n## Data Freshness (vs source publication cadence)\n');
const db = new Database('.dexter/macro/macro.db', { readonly: true });
const counts = { green: 0, yellow: 0, orange: 0, red: 0, missing: 0 };
const issues: Array<{ name: string; module: string; age: number; spec: IndicatorSpec; cls: 'red'|'orange'|'yellow' }> = [];

for (const spec of INDICATORS) {
  const row = db.query<{ date: string; fetched_at: string; value: number }, [string]>(
    `SELECT date, fetched_at, value FROM macro_series WHERE indicator = ? ORDER BY date DESC LIMIT 1`,
  ).get(spec.name);

  if (!row) {
    counts.missing++;
    if (showAll || true) {
      console.log(`  ${color('NO DATA', 'red')}  ${spec.module}  ${spec.name}`);
    }
    continue;
  }

  const age = ageDays(row.date);
  let cls: 'green'|'yellow'|'orange'|'red';
  if (age <= spec.freshDays) cls = 'green';
  else if (age <= spec.yellowDays) cls = 'yellow';
  else if (age <= spec.redDays) cls = 'orange';
  else cls = 'red';

  counts[cls]++;
  if (cls === 'green' && !showAll) continue;
  if (cls !== 'green') {
    issues.push({ name: spec.name, module: spec.module, age, spec, cls });
  }
  console.log(
    `  ${emoji(cls)}  ${spec.module.padEnd(3)} ${spec.name.padEnd(36)} ${String(age).padStart(4)}d  (target ≤${spec.freshDays}d)  ${row.value}`,
  );
}

// ── 3. Summary ──
console.log('\n' + '━'.repeat(70));
console.log(
  `Summary: ${color(String(counts.green) + ' fresh', 'green')} | ` +
  `${color(String(counts.yellow) + ' aging', 'yellow')} | ` +
  `${color(String(counts.orange) + ' stale', 'orange')} | ` +
  `${color(String(counts.red) + ' critical', 'red')} | ` +
  `${counts.missing} no-data`,
);

const critical = counts.red + counts.missing;
if (critical > 0) {
  console.log(color(`\n⚠ ${critical} critical issue(s) — engine output may be unreliable.`, 'red'));
  process.exit(1);
}
console.log(color('\n✓ All indicators within acceptable freshness windows.', 'green'));
process.exit(0);
