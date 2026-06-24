/**
 * Indonesia macro health check — data freshness + env var audit.
 *
 *   bun scripts/health-check.ts          # default — show stale + missing
 *   bun scripts/health-check.ts --all    # also list fresh indicators
 *
 * Exit code: 0 if no critical issues, 1 if any RED-tier gaps detected.
 */
import { Database } from 'bun:sqlite';

const showAll = process.argv.includes('--all');

interface IndicatorSpec {
  name: string;
  module: string;
  freshDays: number;       // GREEN ≤ this
  yellowDays: number;      // YELLOW ≤ this
  redDays: number;         // anything past this = RED critical
}

// Expected freshness per indicator. Aligned with source freshness gates.
const INDICATORS: IndicatorSpec[] = [
  // Yahoo / EODHD daily
  { name: 'usdidr_spot',                 module: 'M3',  freshDays: 2,  yellowDays: 4,   redDays: 7 },
  { name: 'brent_price_usd',             module: 'M4',  freshDays: 2,  yellowDays: 4,   redDays: 7 },
  { name: 'ihsg_level',                  module: 'M9',  freshDays: 4,  yellowDays: 7,   redDays: 14 },
  { name: 'vix_level',                   module: 'M0',  freshDays: 2,  yellowDays: 4,   redDays: 7 },
  { name: 'dxy_index',                   module: 'M0',  freshDays: 2,  yellowDays: 4,   redDays: 7 },
  { name: 'eido_price',                  module: 'M5',  freshDays: 4,  yellowDays: 7,   redDays: 14 },
  // Sovereign scrape
  { name: 'indonesia_cds_5y_bps',        module: 'M2',  freshDays: 3,  yellowDays: 7,   redDays: 14 },
  { name: 'sbn_10y_yield_pct',           module: 'M2',  freshDays: 3,  yellowDays: 7,   redDays: 14 },
  { name: 'sbn_foreign_ownership_pct',   module: 'M5',  freshDays: 30, yellowDays: 45,  redDays: 60 },
  // BI monthly
  { name: 'bi_fx_reserves_bn',           module: 'M1',  freshDays: 35, yellowDays: 50,  redDays: 75 },
  { name: 'bi_rate_pct',                 module: 'M2',  freshDays: 30, yellowDays: 45,  redDays: 60 },
  { name: 'srbi_outstanding_trn_idr',    module: 'M3',  freshDays: 35, yellowDays: 50,  redDays: 75 },
  // SRBI auction weekly
  { name: 'srbi_bid_cover_ratio',        module: 'M3',  freshDays: 7,  yellowDays: 14,  redDays: 30 },
  // Kemenkeu monthly
  { name: 'apbn_revenue_monthly_trn',    module: 'M10', freshDays: 35, yellowDays: 50,  redDays: 75 },
  { name: 'subsidi_energi_ytd_idr_t',    module: 'M10', freshDays: 35, yellowDays: 50,  redDays: 75 },
  { name: 'mbg_realisasi_ytd_idr_t',     module: 'M10', freshDays: 35, yellowDays: 50,  redDays: 75 },
  // OJK / fintech
  { name: 'fintech_npl_pct',             module: 'M8',  freshDays: 35, yellowDays: 50,  redDays: 75 },
  { name: 'bank_npl_gross_pct',          module: 'M8',  freshDays: 400,yellowDays: 730, redDays: 1000 },
  { name: 'bank_car_pct',                module: 'M8',  freshDays: 120,yellowDays: 200, redDays: 365 },
  { name: 'bank_ldr_pct',                module: 'M8',  freshDays: 60, yellowDays: 120, redDays: 240 },
  // ULN quarterly
  { name: 'indonesia_external_debt_bn',  module: 'M13', freshDays: 100,yellowDays: 130, redDays: 180 },
  { name: 'uln_dsr_pct',                 module: 'M13', freshDays: 400,yellowDays: 540, redDays: 730 },
  // Political quarterly
  { name: 'unemployment_rate_pct',       module: 'M12', freshDays: 100,yellowDays: 130, redDays: 180 },
  { name: 'phk_workers_at_risk_30d',     module: 'M12', freshDays: 5,  yellowDays: 14,  redDays: 30 },
  // Food daily (Playwright)
  { name: 'pihps_beras_medium_idr',      module: 'M11', freshDays: 3,  yellowDays: 7,   redDays: 14 },
  // M4 commodity supplementary
  { name: 'b50_status_numeric',          module: 'M4',  freshDays: 21, yellowDays: 45,  redDays: 90 },
  { name: 'hba_price_usd_ton',           module: 'M4',  freshDays: 21, yellowDays: 45,  redDays: 90 },
  { name: 'pln_coal_secured_pct',        module: 'M4',  freshDays: 21, yellowDays: 45,  redDays: 90 },
  // MSCI status — auto-refresh after Jun 23 2026 cutoff
  { name: 'msci_classification_numeric', module: 'M5',  freshDays: 14, yellowDays: 21,  redDays: 30 },
  // DNDF — env_manual annual update from BI LKT
  { name: 'bi_dndf_outstanding_bn',      module: 'M3',  freshDays: 100,yellowDays: 200, redDays: 400 },
  { name: 'uln_hedging_compliance_pct',  module: 'M13', freshDays: 120,yellowDays: 200, redDays: 365 },
];

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
