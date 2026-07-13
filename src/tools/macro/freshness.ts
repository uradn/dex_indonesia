/**
 * Per-indicator freshness spec + runtime gating helpers.
 *
 * Engines use `getFreshPoint(indicator)` to treat RED-stale data as missing,
 * preventing false-GREEN scores when source scrapers silently fail (e.g. OJK NPL
 * 907 days stale → engine reads 1.96% → reports score 4 GREEN despite the data
 * being from a different macro era).
 *
 * Spec table is the single source of truth — shared with `scripts/health-check.ts`.
 */
import { getLatestPoint } from './time-series-db.js';
import type { MacroDataPoint } from './types.js';

export type FreshnessClass = 'green' | 'yellow' | 'orange' | 'red' | 'missing';

export interface IndicatorFreshnessSpec {
  name: string;
  module: string;
  freshDays: number;   // ≤ this = GREEN
  yellowDays: number;  // ≤ this = YELLOW
  redDays: number;     // ≤ this = ORANGE; past this = RED (treat-as-missing tier)
}

export const INDICATORS: IndicatorFreshnessSpec[] = [
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
  { name: 'srbi_outstanding_trn_idr',    module: 'M3',  freshDays: 45, yellowDays: 60,  redDays: 90 },
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
  // ULN quarterly + annual WB / IMF series
  { name: 'indonesia_external_debt_bn',  module: 'M13', freshDays: 100,yellowDays: 130, redDays: 180 },
  { name: 'uln_dsr_pct',                 module: 'M13', freshDays: 400,yellowDays: 540, redDays: 730 },
  { name: 'uln_shortterm_pct',           module: 'M13', freshDays: 400,yellowDays: 540, redDays: 730 },
  { name: 'indonesia_debt_gdp_pct',      module: 'M2',  freshDays: 400,yellowDays: 540, redDays: 730 },
  { name: 'gdp_growth_pct',              module: 'M0',  freshDays: 400,yellowDays: 540, redDays: 730 },
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

const SPEC_BY_NAME: Map<string, IndicatorFreshnessSpec> = new Map(INDICATORS.map(s => [s.name, s]));

export function getSpec(indicator: string): IndicatorFreshnessSpec | undefined {
  return SPEC_BY_NAME.get(indicator);
}

export function ageDays(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
}

export function classifyFreshness(
  indicator: string,
  dateStr: string | null | undefined,
): { cls: FreshnessClass; ageDays: number | null; spec: IndicatorFreshnessSpec | null } {
  const spec = SPEC_BY_NAME.get(indicator) ?? null;
  if (!dateStr) return { cls: 'missing', ageDays: null, spec };
  const age = ageDays(dateStr);
  if (!spec) return { cls: age <= 30 ? 'green' : age <= 90 ? 'yellow' : age <= 365 ? 'orange' : 'red', ageDays: age, spec: null };
  if (age <= spec.freshDays) return { cls: 'green', ageDays: age, spec };
  if (age <= spec.yellowDays) return { cls: 'yellow', ageDays: age, spec };
  if (age <= spec.redDays) return { cls: 'orange', ageDays: age, spec };
  return { cls: 'red', ageDays: age, spec };
}

export interface FreshPointResult {
  point: MacroDataPoint | null;
  cls: FreshnessClass;
  ageDays: number | null;
  spec: IndicatorFreshnessSpec | null;
}

/**
 * Get latest point with freshness classification. When `treatStaleAsMissing` is true,
 * RED-tier stale data returns `point: null` so engines treat it as missing rather than
 * scoring against decade-old values. Default false to preserve existing engine behavior.
 */
export async function getFreshPoint(
  indicator: string,
  opts: { treatStaleAsMissing?: boolean } = {},
): Promise<FreshPointResult> {
  const point = await getLatestPoint(indicator);
  const { cls, ageDays: age, spec } = classifyFreshness(indicator, point?.date);
  if (opts.treatStaleAsMissing && cls === 'red') {
    return { point: null, cls, ageDays: age, spec };
  }
  return { point, cls, ageDays: age, spec };
}

/** Build a "DATA STALE" flag string. `cls` distinguishes ORANGE warn vs RED treat-as-missing. */
export function stalenessFlag(
  indicator: string,
  ageDays: number,
  spec: IndicatorFreshnessSpec | null,
  cls: FreshnessClass = 'orange',
): string {
  const target = spec ? `(fresh ≤${spec.freshDays}d, red >${spec.redDays}d)` : '';
  const tag = cls === 'red' ? 'DATA STALE (RED — treated as missing)' : 'DATA STALE';
  return `${tag}: ${indicator} ${ageDays}d old ${target}`;
}
