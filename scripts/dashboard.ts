/**
 * Dexter Macro Dashboard — localhost:6080
 * Bun HTTP server reading directly from .dexter/macro/macro.db
 * Run: bun scripts/dashboard.ts
 */
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { silentCrisisDetector } from '../src/tools/macro/silent-crisis-detector.ts';
import {
  saveThesis, updateThesisStatus, getLatestThesis, getAllTheses,
} from '../src/tools/macro/time-series-db.ts';
import type { ThesisRecord } from '../src/tools/macro/time-series-db.ts';

const DB_PATH = join(import.meta.dir, '../.dexter/macro/macro.db');
const PORT = 6080;

// ── SCD on-demand state ───────────────────────────────────────────────────────

type ScdStatus = 'idle' | 'running' | 'done' | 'error';
let scdState: { status: ScdStatus; result?: string; error?: string; startedAt?: string; completedAt?: string } = { status: 'idle' };

function triggerScd(): void {
  if (scdState.status === 'running') return;
  scdState = { status: 'running', startedAt: new Date().toISOString() };
  (silentCrisisDetector as any).invoke({ query: 'full silent crisis scan' })
    .then((raw: string) => {
      let result = raw;
      try { const p = JSON.parse(raw); if (p?.data?.analysis) result = p.data.analysis; } catch {}
      scdState = { status: 'done', result, startedAt: scdState.startedAt, completedAt: new Date().toISOString() };
    })
    .catch((e: Error) => {
      scdState = { status: 'error', error: String(e), startedAt: scdState.startedAt, completedAt: new Date().toISOString() };
    });
}

// ── DB helpers ────────────────────────────────────────────────────────────────

function openDb(): Database {
  return new Database(DB_PATH, { readonly: true });
}

function getLatest(db: Database, indicators: string[]): Record<string, { value: number; date: string; unit: string }> {
  const result: Record<string, { value: number; date: string; unit: string }> = {};
  for (const ind of indicators) {
    const row = db.query<{ value: number; date: string; unit: string }, string>(
      `SELECT value, date, unit FROM macro_series WHERE indicator = ? ORDER BY date DESC, fetched_at DESC LIMIT 1`
    ).get(ind);
    if (row) result[ind] = row;
  }
  return result;
}

function getSeries(db: Database, indicator: string, days = 90): Array<{ date: string; value: number }> {
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  return db.query<{ date: string; value: number }, [string, string]>(
    `SELECT date, AVG(value) as value FROM macro_series WHERE indicator = ? AND date >= ? GROUP BY date ORDER BY date ASC`
  ).all(indicator, since);
}

// ── Snapshot API ──────────────────────────────────────────────────────────────

const SNAPSHOT_INDICATORS = [
  'usdidr_spot', 'bi_rate_pct', 'sbn_10y_yield_pct', 'indonesia_cds_5y_bps',
  'cds_velocity_bps_week', 'dxy_index', 'vix_level', 'ust_10y_yield_pct',
  'eido_price', 'idx_foreign_net_buy_idr_bn', 'sbn_foreign_ownership_pct',
  'srbi_bid_cover_ratio', 'srbi_outstanding_trn_idr',
  'brent_price_usd', 'dubai_crude_spot_usd', 'brent_dubai_spread_usd',
  'bbm_subsidy_gap_idr_liter', 'bbm_cost_recovery_idr_liter',
  'pertalite_price_idr_liter', 'pertamax_price_idr_liter', 'pertamax_green_price_idr_liter',
  'bi_fx_reserves_bn', 'trade_balance_bn',
  'bank_npl_gross_pct', 'bank_car_pct', 'bank_ldr_pct', 'indonia_3m_pct',
  'unemployment_rate_pct', 'inflation_cpi_pct', 'gdp_growth_pct',
  'greenspan_guidotti', 'uln_dsr_pct', 'uln_gdp_ratio_pct',
  'pihps_beras_medium_idr', 'pihps_cabai_rawit_merah_idr', 'pihps_cabai_merah_kriting_idr',
  'pihps_bawang_merah_idr', 'pihps_minyak_goreng_idr', 'pihps_telur_ayam_idr',
  'pihps_daging_sapi_idr', 'pihps_gula_pasir_idr',
  'nickel_price_usd', 'coal_etf_usd', 'cpo_price_myr', 'gold_price_usd',
  'copper_price_usd', 'silver_price_usd', 'natgas_price_usd',
  'steel_etf_usd', 'aluminum_price_usd', 'wti_price_usd',
  'fintech_npl_pct', 'ihsg_pe_ratio', 'idx_advance_decline_ratio',
  // political risk (m12)
  'political_social_unrest_score', 'political_food_stress_score', 'political_stability_stress_score',
  'political_x_social_score', 'political_tavily_social_score',
  // asean fx (IDR + 5 peers)
  'usdmyr_spot', 'usdsgd_spot', 'usdthb_spot', 'usdphp_spot', 'usdvnd_spot',
  // asean fx drivers (unique)
  'usdidr_vol_30d', 'indonesia_pmi_manufacturing', 'indonesia_debt_gdp_pct',
  // m12 macro context (unique)
  'food_inflation_yoy_pct',
  // uln/gg page — full indicator set
  'uln_shortterm_pct', 'indonesia_external_debt_bn',
  'uln_yoy_growth_pct', 'uln_hedging_compliance_pct',
  // m10 subsidi realisasi
  'subsidi_energi_ytd_idr_t', 'subsidi_pupuk_ytd_idr_t',
  // m6 morris-shin signal precision
  'narrative_ms_cv_pct',
  // m4 eia inventory + rubber + hormuz ghost transit
  'us_crude_stocks_mmbbl', 'natural_rubber_price_usd',
  'hormuz_visible_traffic_pct_prewar', 'hormuz_ghost_transit_mbpd',
  // m8 bnpl/fintech lending (npl leading indicator 2-3q lag)
  'fintech_lending_outstanding_idr_t', 'fintech_lending_growth_yoy_pct',
  // m10 fiscal monthly realisasi
  'apbn_revenue_monthly_trn', 'apbn_spending_monthly_trn', 'apbn_budget_balance_monthly_trn',
  // regime engine
  'ihsg_level',
  // m3 dndf — off-balance-sheet FX contingent liability
  'bi_dndf_outstanding_bn',
  // m5 msci classification — auto-detected post-Jun23 (0=confirmed, 1=under_review, 2=frontier)
  'msci_classification_numeric',
];

const CHART_INDICATORS = [
  'usdidr_spot', 'indonesia_cds_5y_bps', 'sbn_10y_yield_pct',
  'eido_price', 'bbm_subsidy_gap_idr_liter', 'brent_price_usd',
  'bi_fx_reserves_bn', 'sbn_foreign_ownership_pct',
];

const ASEAN_FX = ['usdidr_spot', 'usdmyr_spot', 'usdsgd_spot', 'usdthb_spot', 'usdphp_spot', 'usdvnd_spot'];
const ASEAN_LABELS: Record<string, string> = { usdidr_spot: 'IDR', usdmyr_spot: 'MYR', usdsgd_spot: 'SGD', usdthb_spot: 'THB', usdphp_spot: 'PHP', usdvnd_spot: 'VND' };

function get30dAgo(db: Database, indicator: string): number | null {
  const since = new Date(Date.now() - 35 * 86400_000).toISOString().slice(0, 10);
  const until = new Date(Date.now() - 25 * 86400_000).toISOString().slice(0, 10);
  const row = db.query<{ value: number }, [string, string, string]>(
    `SELECT value FROM macro_series WHERE indicator = ? AND date BETWEEN ? AND ? ORDER BY date DESC LIMIT 1`
  ).get(indicator, since, until);
  return row?.value ?? null;
}

function buildSnapshot() {
  const db = openDb();
  try {
    const data = getLatest(db, SNAPSHOT_INDICATORS);
    // derived monetary
    const sbn = data['sbn_10y_yield_pct']?.value ?? null;
    const bi = data['bi_rate_pct']?.value ?? null;
    const termPremium = sbn !== null && bi !== null ? +(sbn - bi).toFixed(2) : null;
    const cds = data['indonesia_cds_5y_bps']?.value ?? null;
    const ust = data['ust_10y_yield_pct']?.value ?? null;
    const sbnUstSpread = sbn !== null && ust !== null ? Math.round((sbn - ust) * 100) : null;
    const usdidr = data['usdidr_spot']?.value ?? null;
    const usdidrVsApbn = usdidr !== null ? +(((usdidr - 16500) / 16500) * 100).toFixed(1) : null;
    // ASEAN FX 30d changes
    const aseanFx: Record<string, { current: number | null; prior30d: number | null; changePct: number | null; label: string }> = {};
    for (const ind of ASEAN_FX) {
      const current = data[ind]?.value ?? null;
      const prior = get30dAgo(db, ind);
      const changePct = current !== null && prior !== null && prior !== 0
        ? +((current - prior) / prior * 100).toFixed(2) : null;
      aseanFx[ind] = { current, prior30d: prior, changePct, label: ASEAN_LABELS[ind] };
    }
    const envFlags = {
      hasX: !!process.env.X_BEARER_TOKEN,
      hasTavily: !!process.env.TAVILY_API_KEY,
      hasExa: !!process.env.EXASEARCH_API_KEY,
    };
    // Read latest module scores from DB (written by SCD / morning-check)
    const moduleScores: Record<string, { score: number; alertLevel: string; computedAt: string }> = {};
    try {
      const rows = db.query<{ module: string; score: number; alert_level: string; computed_at: string }>(
        `SELECT module, score, alert_level, computed_at FROM macro_scores
         WHERE (module, score_date) IN (SELECT module, MAX(score_date) FROM macro_scores GROUP BY module)`
      ).all();
      for (const r of rows) moduleScores[r.module] = { score: r.score, alertLevel: r.alert_level, computedAt: r.computed_at };
    } catch {}
    return { indicators: data, derived: { termPremium, sbnUstSpread, usdidrVsApbn, cds }, aseanFx, envFlags, moduleScores, ts: new Date().toISOString() };
  } finally {
    db.close();
  }
}

// ── Big Short Thesis Computation ──────────────────────────────────────────────

interface Divergence {
  id: string; label: string; market: string; structural: string;
  gap: number; unit: string; cls: string;
}

interface ComputedThesis {
  primaryDivergence: string;
  thesisStatement: string;
  triggerIndicator: string;
  triggerThreshold: number;
  triggerDirection: 'above' | 'below';
  triggerLabel: string;
  triggerFired: boolean;
  predictedCdsBps: number | null;
  predictedUsdidr: number | null;
  predictedSbn10y: number | null;
  crisisProbability: number;
  evEstimate: number;
  killConditions: string[];
  divergences: Divergence[];
  transmissionChain: Array<{ module: string; score: number; cls: string; label: string }>;
  marketExpression: Array<{ instrument: string; direction: string; rationale: string; carry: string; liq: string }>;
  contrarian: { consensus: string; whyWrong: string; whyNotPriced: string };
  conviction: number;
  analog: { name: string; year: string; similarity: string };
}

function computeThesis(snap: ReturnType<typeof buildSnapshot>): ComputedThesis {
  const ms = snap.moduleScores ?? {};
  const ind = snap.indicators ?? {};
  const der = snap.derived ?? {};

  const FINANCIAL = ['fx_defense','uln','bop','sovereign_risk','foreign_flow','banking','commodity','fiscal','market'];
  const financialScores = FINANCIAL.map(m => ms[m]?.score).filter((s): s is number => s != null);
  const financialAvg = financialScores.length
    ? Math.round(financialScores.reduce((a, b) => a + b, 0) / financialScores.length) : 0;

  const polScore   = ms['political_risk']?.score ?? 0;
  const narScore   = ms['narrative']?.score ?? 0;
  const fiscalScore = ms['fiscal']?.score ?? 0;
  const cds        = der.cds ?? null;
  const usdidr     = ind['usdidr_spot']?.value ?? null;
  const sbn        = ind['sbn_10y_yield_pct']?.value ?? null;
  const sbnOwn     = ind['sbn_foreign_ownership_pct']?.value ?? null;
  const srbiB      = ind['srbi_sterilization_burden_pct']?.value ?? null;
  const usdidrVsApbn = der.usdidrVsApbn ?? null;

  // ── Build divergence list ────────────────────────────────────────────────────
  const divs: Divergence[] = [];

  const polGap = polScore - financialAvg;
  divs.push({
    id: 'political_financial_gap',
    label: 'Political vs Financial',
    market: `Financial avg ${financialAvg}/100`,
    structural: `Political risk ${polScore}/100 RED`,
    gap: polGap,
    unit: 'pp',
    cls: polGap > 40 ? 'red' : polGap > 25 ? 'orange' : polGap > 10 ? 'yellow' : 'green',
  });

  if (usdidrVsApbn !== null) {
    const g = Math.abs(usdidrVsApbn);
    divs.push({
      id: 'idr_apbn_gap',
      label: 'IDR vs APBN 16,500',
      market: 'APBN assumes 16,500',
      structural: `Actual ${usdidr ? Math.round(usdidr).toLocaleString('id') : '—'} (+${g.toFixed(1)}%)`,
      gap: g,
      unit: '%',
      cls: g > 15 ? 'red' : g > 10 ? 'orange' : g > 5 ? 'yellow' : 'green',
    });
  }

  if (narScore > 0) {
    divs.push({
      id: 'narrative_credibility',
      label: 'Narrative vs Market',
      market: `Credibility ${100 - narScore}/100`,
      structural: `${narScore} stress pts vs official claims`,
      gap: narScore,
      unit: '/100',
      cls: narScore > 60 ? 'red' : narScore > 40 ? 'orange' : 'yellow',
    });
  }

  if (cds !== null) {
    const g = Math.max(0, cds - 60);
    divs.push({
      id: 'cds_narrative_gap',
      label: 'CDS vs "Stable Macro"',
      market: 'BI claims macro stable',
      structural: `CDS ${cds.toFixed(0)}bps (+${g.toFixed(0)}bps above stable baseline)`,
      gap: g,
      unit: 'bps',
      cls: cds > 150 ? 'red' : cds > 100 ? 'orange' : cds > 70 ? 'yellow' : 'green',
    });
  }

  if (sbnOwn !== null) {
    const g = 25 - sbnOwn;
    divs.push({
      id: 'sbn_foreign_exit',
      label: 'SBN Foreign Exit',
      market: `Current ownership ${sbnOwn.toFixed(1)}%`,
      structural: `Peak 25% in 2019; exit ${g.toFixed(1)}pp`,
      gap: Math.max(0, g),
      unit: 'pp',
      cls: sbnOwn < 10 ? 'red' : sbnOwn < 12 ? 'orange' : sbnOwn < 15 ? 'yellow' : 'green',
    });
  }

  divs.sort((a, b) => b.gap - a.gap);
  const primary = divs[0] ?? { id: 'political_financial_gap', label: '—', gap: 0, unit: '', market: '', structural: '', cls: 'green' };

  // ── Thesis & trigger from primary divergence ─────────────────────────────────
  let thesisStatement = '';
  let triggerIndicator = 'political_risk_score';
  let triggerThreshold = 75;
  let triggerDirection: 'above' | 'below' = 'above';
  let triggerLabel = '';

  if (primary.id === 'political_financial_gap') {
    thesisStatement = `Market prices Indonesia sovereign risk at ${financialAvg}/100 while political stress reads ${polScore}/100 — ${polGap}pp divergence. Demo BBM 12 Jun 2026 confirms social contract fracture. Political stress historically leads financial repricing 2-3 quarters.`;
    triggerIndicator = 'political_risk_score'; triggerThreshold = 75; triggerDirection = 'above';
    triggerLabel = 'Political risk score stays >75 for 30d OR SBN foreign ownership <11%';
  } else if (primary.id === 'idr_apbn_gap') {
    thesisStatement = `IDR trading ${usdidrVsApbn?.toFixed(1)}% above APBN 16,500 assumption. Fiscal math built on stale FX rate; each +1,000 IDR/USD adds ~IDR 4-5T to debt service. Convergence requires either fiscal rebase or IDR crash.`;
    triggerIndicator = 'usdidr_spot'; triggerThreshold = 19000; triggerDirection = 'above';
    triggerLabel = 'USDIDR breaks above 19,000 (APBN +15.2%)';
  } else if (primary.id === 'cds_narrative_gap') {
    thesisStatement = `Indonesia CDS at ${cds?.toFixed(0)}bps while BI claims macro stability. Market already pricing stress the official narrative denies. CDS velocity positive — momentum toward repricing.`;
    triggerIndicator = 'indonesia_cds_5y_bps'; triggerThreshold = 150; triggerDirection = 'above';
    triggerLabel = 'CDS breaks above 150bps (S&P watch zone)';
  } else {
    thesisStatement = `${primary.label}: market at ${primary.market} vs structural reality ${primary.structural}. Gap ${primary.gap.toFixed(1)}${primary.unit} exceeds noise threshold — repricing risk elevated.`;
    triggerLabel = `${primary.label} gap widens further`;
  }

  // Live trigger check vs current indicators
  const triggerCurrentVal = triggerIndicator === 'political_risk_score'
    ? (ms['political_risk']?.score ?? 0)
    : (ind[triggerIndicator]?.value ?? 0);
  const primaryTriggerFired = triggerDirection === 'above'
    ? triggerCurrentVal >= triggerThreshold
    : triggerCurrentVal <= triggerThreshold;

  // Secondary trigger: subsidi energi run rate >135% of APBN target (Rp87T)
  // Fires when oil shock forces fiscal rescue beyond APBN subsidi allocation
  const subsidiBbmLpgYtd = ind['subsidi_energi_ytd_idr_t']?.value ?? null;
  const subsidyMonthsNow = new Date().getMonth() + 1; // 1-12
  const subsidyRunRatePct = subsidiBbmLpgYtd !== null && subsidyMonthsNow > 0
    ? (subsidiBbmLpgYtd / subsidyMonthsNow * 12) / 87 * 100
    : null;
  const subsidyTriggerFired = subsidyRunRatePct !== null && subsidyRunRatePct >= 135;
  const triggerFired = primaryTriggerFired || subsidyTriggerFired;
  if (subsidyTriggerFired) {
    triggerLabel += ` | Subsidi energi run rate ${subsidyRunRatePct!.toFixed(0)}% (>135% FIRED — fiscal rescue underway)`;
  }

  // ── SCD-based crisis probability ─────────────────────────────────────────────
  const W: Record<string, number> = {
    fx_defense:0.16,uln:0.09,bop:0.10,sovereign_risk:0.09,foreign_flow:0.09,
    banking:0.08,commodity:0.07,fiscal:0.09,market:0.05,domestic_pressure:0.06,
    political_risk:0.05,regime:0.05,narrative:0.02,
  };
  let wsum = 0, wtotal = 0;
  for (const [mod, w] of Object.entries(W)) {
    if (ms[mod]) { wsum += ms[mod].score * w; wtotal += w; }
  }
  const stressed = Object.values(ms).filter(m => m.score >= 50).length;
  const amp = stressed >= 5 ? 1.4 : stressed >= 3 ? 1.2 : stressed >= 2 ? 1.1 : 1.0;
  const crisisProbability = Math.min(90, Math.round((wtotal > 0 ? wsum / wtotal : 30) * amp));

  // ── EV estimate (blended 4-instrument portfolio) ─────────────────────────────
  // Carry: CDS ~8bps/mo + EIDO borrow ~0.25%/mo + NDF ~0.5%/mo → blended ~0.12%/mo
  // Stress (partial): +8% | Crisis (full): CDS 97→200 + IDR 18→20k + EIDO -30% ≈ +25%
  const p = crisisProbability / 100;
  const pStress = 0.20;
  const pBase = Math.max(0, 1 - p - pStress);
  const evEstimate = Math.round((pBase * -1.44 + pStress * 8 + p * 25) * 10) / 10;

  // ── Kill conditions ───────────────────────────────────────────────────────────
  const killConditions = [
    `#1 — Political risk < 55 sustained 14d (social contract stress eased; BBM demo resolves)`,
    `#2 — BI announces coordinated stabilization package (fiscal letter + reserves defense ≥$5bn + rate guidance) [MANUAL CONFIRM]`,
    `#3 — SBN foreign ownership > 13% (capital return; inflows reversed crisis narrative)`,
    `#4 — CDS 5Y < 100bps sustained 7d (market stopped pricing crisis; thesis invalidated)`,
  ];

  // ── Transmission chain ────────────────────────────────────────────────────────
  const CHAIN = [
    { module: 'political_risk', label: 'M12 Political' },
    { module: 'domestic_pressure', label: 'M11 Food/BBM' },
    { module: 'fiscal', label: 'M10 Fiscal' },
    { module: 'sovereign_risk', label: 'M2 Sovereign' },
    { module: 'foreign_flow', label: 'M5 Foreign Flow' },
    { module: 'fx_defense', label: 'M3 FX Defense' },
    { module: 'banking', label: 'M8 Banking' },
  ];
  const transmissionChain = CHAIN.map(({ module, label }) => {
    const score = ms[module]?.score ?? 0;
    const c = score >= 70 ? 'red' : score >= 50 ? 'orange' : score >= 33 ? 'yellow' : 'green';
    return { module, score, cls: c, label };
  });

  // ── Market expression ─────────────────────────────────────────────────────────
  const marketExpression = [
    {
      instrument: 'Indonesia CDS 5Y',
      direction: 'Long protection (buyer)',
      rationale: `Entry ~${cds?.toFixed(0) ?? '97'}bps → target 200bps. Implied P(crisis) ${crisisProbability}%`,
      carry: `~${cds ? (cds/12).toFixed(0) : '8'}bps/mo`,
      liq: '~$50m/day',
    },
    {
      instrument: 'EIDO ETF',
      direction: 'Short',
      rationale: 'IDX foreign exit proxy. MSCI uncertainty + passive outflow dual cause',
      carry: '~0.25%/mo borrow',
      liq: '~$15m/day',
    },
    {
      instrument: 'USDIDR NDF 6M',
      direction: 'Long USD',
      rationale: `IDR ${usdidrVsApbn ? usdidrVsApbn.toFixed(1)+'% above APBN' : 'elevated vs APBN'}. Political→fiscal transmission → depreciation`,
      carry: '~0.5%/mo NDF premium',
      liq: '>$500m/day',
    },
    {
      instrument: 'SBN 10Y duration',
      direction: 'Underweight',
      rationale: `Yield ${sbn?.toFixed(2) ?? '7.3'}%. Foreign exit + fiscal deficit → yield spike. Term premium borderline ORANGE`,
      carry: 'Negative (yield holder)',
      liq: 'Domestic only',
    },
  ];

  // ── Contrarian validation ─────────────────────────────────────────────────────
  const contrarian = {
    consensus: `BI: macro stable; IDR weakness is global DXY story not ID-specific. Markets price CDS ${cds?.toFixed(0) ?? '97'}bps = moderate risk, not crisis. S&P/Fitch maintain BBB- stable. Bloomberg consensus: no sovereign event 12mo.`,
    whyWrong: `Political risk ${polScore}/100 RED vs financial avg ${financialAvg}/100 — ${polGap}pp divergence ignored by financial models. Demo BBM 12 Jun 2026 (Jakarta HI + Monas, Makassar) = social contract fracture visible. SRBI sterilization ${srbiB ? srbiB.toFixed(0)+'%' : '36%'} of FX reserves = pseudo-stability masking reserve depletion. Fiscal deficit trajectory 4.23% GDP → above 3% constitutional limit. S&P interest/revenue ratio 20.4% = 5.4pp above negative-action threshold.`,
    whyNotPriced: `Three structural lags: (1) Political leads financial 2-3 quarters — sell-side models are financial-first, political risk treated as exogenous noise; (2) MSCI EM review creates uncertainty paralysis — foreign funds wait-and-see rather than exit; (3) BI SRBI program maintains surface IDR calm through sterilization, hiding reserve depletion from casual observers.`,
  };

  // ── Historical analog ─────────────────────────────────────────────────────────
  // Simple rule: political stress dominant → 2018 EM selloff analog (EM-specific, not global)
  // If fiscal > 60 + political > 70 → 2022 (fiscal + rate shock combo)
  const analog = fiscalScore > 60 && polScore > 70
    ? { name: '2022 Fed Tightening Cycle', year: '2022', similarity: 'Fiscal stress + IDR depreciation + rate shock. SCD peaked at 90/100. IDR −9.6%.' }
    : polScore > 75
    ? { name: '2018 EM Selloff', year: '2018', similarity: 'Political uncertainty + capital outflow + IDR pressure. SCD peaked at 84/100. IDR −5.8%.' }
    : { name: '2013 Taper Tantrum', year: '2013', similarity: 'SBN yield spike + foreign exit + IDR weakness. SCD peaked at 81/100. IDR −20.8%.' };

  // Conviction = crisis probability amplified by political-financial divergence
  const conviction = Math.min(95, Math.round(crisisProbability * (1 + polGap / 200)));

  return {
    primaryDivergence: primary.id,
    thesisStatement, triggerIndicator, triggerThreshold, triggerDirection, triggerLabel, triggerFired,
    predictedCdsBps: cds ? Math.round(cds * 2) : 200,
    predictedUsdidr: usdidr ? Math.round(usdidr * 1.12) : 20000,
    predictedSbn10y: sbn ? +(sbn + 1.5).toFixed(2) : 8.8,
    crisisProbability, evEstimate, killConditions,
    divergences: divs, transmissionChain, marketExpression, contrarian,
    conviction, analog,
  };
}

function buildCharts() {
  const db = openDb();
  try {
    const result: Record<string, Array<{ date: string; value: number }>> = {};
    for (const ind of CHART_INDICATORS) result[ind] = getSeries(db, ind);
    return result;
  } finally {
    db.close();
  }
}

// ── HTML ──────────────────────────────────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dexter — Indonesia Macro Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
<style>
  :root {
    --bg: #0d1117; --surface: #161b22; --border: #30363d;
    --text: #e6edf3; --muted: #8b949e;
    --green: #3fb950; --yellow: #d29922; --orange: #e3721c; --red: #f85149;
    --green-bg: rgba(63,185,80,.12); --yellow-bg: rgba(210,153,34,.12);
    --orange-bg: rgba(227,114,28,.12); --red-bg: rgba(248,81,73,.12);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: 'SF Mono', ui-monospace, monospace; font-size: 12px; }
  header { padding: 16px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 16px; }
  header h1 { font-size: 16px; font-weight: 600; }
  #last-updated { color: var(--muted); font-size: 11px; margin-left: auto; }
  #refresh-btn { padding: 4px 12px; background: var(--surface); border: 1px solid var(--border); color: var(--text); border-radius: 4px; cursor: pointer; font-family: inherit; font-size: 11px; }
  #refresh-btn:hover { background: var(--border); }
  .layout { display: grid; grid-template-columns: 340px 1fr; gap: 0; height: calc(100vh - 53px); overflow: hidden; }
  .sidebar { border-right: 1px solid var(--border); overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
  .main { overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; }
  .card-title { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin-bottom: 8px; }
  .kv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 8px; }
  .kv { display: flex; justify-content: space-between; align-items: baseline; padding: 2px 0; border-bottom: 1px solid var(--border); }
  .kv:last-child { border-bottom: none; }
  .kv-label { color: var(--muted); font-size: 11px; }
  .kv-val { font-size: 12px; font-weight: 600; }
  .tag { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 700; }
  .green { color: var(--green); } .yellow { color: var(--yellow); } .orange { color: var(--orange); } .red { color: var(--red); }
  .tag.green { background: var(--green-bg); color: var(--green); }
  .tag.yellow { background: var(--yellow-bg); color: var(--yellow); }
  .tag.orange { background: var(--orange-bg); color: var(--orange); }
  .tag.red { background: var(--red-bg); color: var(--red); }
  .scd-gauge { text-align: center; padding: 8px 0; }
  .scd-number { font-size: 48px; font-weight: 700; line-height: 1; }
  .scd-label { font-size: 11px; color: var(--muted); margin-top: 4px; }
  .doom-item { display: flex; justify-content: space-between; align-items: center; padding: 3px 0; border-bottom: 1px solid var(--border); font-size: 11px; }
  .doom-item:last-child { border-bottom: none; }
  .doom-score { font-size: 20px; font-weight: 700; }
  .charts-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
  .chart-card { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; }
  .chart-title { font-size: 9px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin-bottom: 4px; }
  .chart-current { font-size: 16px; font-weight: 700; margin-bottom: 4px; }
  .chart-sparse { font-size: 10px; color: var(--muted); margin-top: 4px; font-style: italic; }
  canvas { min-height: 180px; max-height: 180px; }
  .food-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }
  .top-panels { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .bar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; font-size: 11px; }
  .bar-label { width: 46px; color: var(--muted); flex-shrink: 0; font-size: 10px; }
  .bar-track { flex: 1; height: 14px; background: rgba(255,255,255,.06); border-radius: 2px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 2px; transition: width .3s; }
  .bar-val { width: 56px; text-align: right; font-weight: 700; flex-shrink: 0; font-size: 11px; }
  .template98-item { display: flex; justify-content: space-between; padding: 2px 0; font-size: 11px; border-bottom: 1px solid var(--border); }
  .template98-item:last-child { border-bottom: none; }
  /* pastel panel cards */
  .card.polrisk-card { background: rgba(248,81,73,.08); border-color: rgba(248,81,73,.28); }
  .card.polrisk-card .card-title { color: rgba(248,81,73,.7); }
  .card.asean-card { background: rgba(63,185,80,.08); border-color: rgba(63,185,80,.28); }
  .card.asean-card .card-title { color: rgba(63,185,80,.7); }
  .scd-run-btn { margin-top: 8px; padding: 6px 14px; background: #1f2937; border: 1px solid var(--border); color: var(--text); border-radius: 4px; cursor: pointer; font-family: inherit; font-size: 11px; width: 100%; }
  .scd-run-btn:hover { background: var(--border); }
  .scd-run-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  #scd-result-panel { margin-top: 10px; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 12px; display: none; max-height: 55vh; overflow-y: auto; }
  #scd-result-panel .scd-md { font-size: 11px; color: var(--text); line-height: 1.6; }
  #scd-result-panel .scd-md h2 { font-size: 13px; margin: 8px 0 4px; border-bottom: 1px solid var(--border); padding-bottom: 3px; }
  #scd-result-panel .scd-md h3 { font-size: 12px; color: var(--muted); margin: 6px 0 2px; }
  #scd-result-panel .scd-md .tbl-row { display: flex; gap: 6px; padding: 2px 0; border-bottom: 1px solid rgba(48,54,61,.6); font-size: 10px; }
  #scd-result-panel .scd-md .tbl-row span { flex: 1; }
  #scd-result-panel .scd-md .tbl-row.tbl-header { font-weight: 700; color: var(--muted); border-bottom: 1px solid var(--border); }
  #scd-result-panel .scd-md ul { padding-left: 14px; margin: 3px 0; }
  #scd-result-panel .scd-md li { margin: 1px 0; font-size: 10px; }
  #scd-result-panel .scd-md p { margin: 3px 0; font-size: 10px; }
  #scd-result-panel .scd-md b { color: var(--text); }
</style>
</head>
<body>
<header>
  <h1>🇮🇩 Dexter — Indonesia Macro Dashboard</h1>
  <span id="last-updated">—</span>
  <button id="refresh-btn" onclick="refresh()">↻ Refresh</button>
  <a href="/rr" style="margin-left:auto;font-size:11px;color:var(--muted);text-decoration:none;padding:4px 8px;border:1px solid var(--border);border-radius:4px;white-space:nowrap" onmouseover="this.style.color='var(--fg)'" onmouseout="this.style.color='var(--muted)'">R&amp;R / G-G →</a>
  <a href="/bs" style="font-size:11px;color:var(--muted);text-decoration:none;padding:4px 8px;border:1px solid var(--border);border-radius:4px;white-space:nowrap" onmouseover="this.style.color='var(--fg)'" onmouseout="this.style.color='var(--muted)'">Big Short →</a>
</header>
<div class="layout">
  <div class="sidebar">
    <div class="card">
      <div class="card-title">Silent Crisis Detector</div>
      <div class="scd-gauge">
        <div class="scd-number" id="scd-score">—</div>
        <div class="scd-label">SCD Score (0-100)</div>
        <div id="scd-alert" style="margin-top:6px"></div>
      <div style="font-size:10px;color:var(--muted);margin-top:6px">↑ proxy heuristic — indicators only</div>
      </div>
      <button class="scd-run-btn" id="scd-btn" onclick="runScd()">▶ Run Full SCD (13 modules ~60-120s)</button>
      <div id="scd-status" style="font-size:10px;color:var(--muted);margin-top:4px;text-align:center"></div>
    </div>

    <div id="scd-result-panel">
      <div class="card-title" style="margin-bottom:6px">Full SCD Result</div>
      <div id="scd-result-content" class="scd-md"></div>
    </div>

    <div class="card">
      <div class="card-title">Monetary & FX</div>
      <div id="panel-monetary"></div>
    </div>

    <div class="card">
      <div class="card-title">Capital Flow</div>
      <div id="panel-flow"></div>
    </div>

    <div class="card">
      <div class="card-title">Fiscal & External</div>
      <div id="panel-fiscal"></div>
    </div>

    <div class="card">
      <div class="card-title">Banking</div>
      <div id="panel-banking"></div>
    </div>

    <div class="card">
      <div class="card-title">Doom Loop Tracker</div>
      <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:8px">
        <span class="doom-score" id="doom-score">—</span>
        <span id="doom-label" style="font-size:11px;color:var(--muted)"></span>
      </div>
      <div id="panel-doom"></div>
    </div>

    <div class="card">
      <div class="card-title">Food Stress (PIHPS)</div>
      <div class="food-grid" id="panel-food"></div>
    </div>
  </div>

  <div class="main">
    <div class="top-panels">
      <div class="card polrisk-card">
        <div class="card-title">Political Risk — Unrest Monitor (M12)</div>
        <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:8px">
          <span class="doom-score" id="polrisk-score">—</span>
          <span id="polrisk-label" style="font-size:11px;color:var(--muted)"></span>
          <span style="font-size:10px;color:var(--muted);margin-left:auto">1998 template: <span id="template98-score" style="font-weight:700">—</span>/5</span>
        </div>
        <div id="panel-polrisk"></div>
      </div>
      <div class="card asean-card">
        <div class="card-title">ASEAN FX Peers — IDR Idiosyncratic Check (M7)</div>
        <div style="font-size:10px;color:var(--muted);margin-bottom:6px">30d change — positive = depreciation vs USD</div>
        <div id="panel-asean"></div>
        <div style="margin-top:8px;font-size:10px;color:var(--muted)" id="asean-narrative"></div>
      </div>
    </div>
    <div class="charts-grid" id="charts-grid"></div>
  </div>
</div>

<script>
let snapshot = null;
let charts = null;
let chartInstances = {};

const CHART_CONFIGS = [
  { key: 'usdidr_spot', label: 'USDIDR', color: '#e3721c', fmt: v => v.toLocaleString('id') },
  { key: 'indonesia_cds_5y_bps', label: 'CDS 5Y (bps)', color: '#f85149', fmt: v => v.toFixed(1)+'bps' },
  { key: 'sbn_10y_yield_pct', label: 'SBN 10Y Yield', color: '#d29922', fmt: v => v.toFixed(2)+'%' },
  { key: 'eido_price', label: 'EIDO ETF (USD)', color: '#58a6ff', fmt: v => '$'+v.toFixed(2) },
  { key: 'bbm_subsidy_gap_idr_liter', label: 'BBM Subsidy Gap (IDR/L)', color: '#ff7b72', fmt: v => 'Rp'+Math.round(v).toLocaleString('id') },
  { key: 'brent_price_usd', label: 'Brent (USD/bbl)', color: '#ffa657', fmt: v => '$'+v.toFixed(1) },
  { key: 'srbi_outstanding_trn_idr', label: 'SRBI Outstanding (T IDR)', color: '#3fb950', fmt: v => 'Rp'+v.toFixed(0)+'T' },
  { key: 'sbn_foreign_ownership_pct', label: 'SBN Foreign Ownership %', color: '#bc8cff', fmt: v => v.toFixed(2)+'%' },
];

function alertClass(val, thresholds) {
  // thresholds: { yellow, orange, red } — higher = worse (default)
  // or { yellow, orange, red, inverse: true } — lower = worse
  if (!thresholds) return '';
  const { yellow, orange, red, inverse } = thresholds;
  if (!inverse) {
    if (val >= red) return 'red';
    if (val >= orange) return 'orange';
    if (val >= yellow) return 'yellow';
    return 'green';
  } else {
    if (val <= red) return 'red';
    if (val <= orange) return 'orange';
    if (val <= yellow) return 'yellow';
    return 'green';
  }
}

function fmtNum(v, decimals=2) { return v != null ? (+v).toFixed(decimals) : '—'; }
function fmtK(v) { return v != null ? Math.round(v).toLocaleString('id') : '—'; }

function kv(label, value, cls='', tag=false) {
  const valHtml = tag ? \`<span class="tag \${cls}">\${value}</span>\` : \`<span class="kv-val \${cls}">\${value}</span>\`;
  return \`<div class="kv"><span class="kv-label">\${label}</span>\${valHtml}</div>\`;
}

// Returns stale warning suffix if date older than thresholdDays
function stale(dateStr, thresholdDays=180) {
  if (!dateStr) return '';
  const ageDays = Math.round((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (ageDays <= thresholdDays) return '';
  const color = ageDays > 365 ? 'var(--orange)' : 'var(--muted)';
  return \` <span style="font-size:9px;color:\${color}">⚠ \${ageDays}d old</span>\`;
}

function renderMonetary(d) {
  const { indicators: ind, derived } = d;
  const usdidr = ind['usdidr_spot']?.value;
  const bi = ind['bi_rate_pct']?.value;
  const sbn = ind['sbn_10y_yield_pct']?.value;
  const cds = ind['indonesia_cds_5y_bps']?.value;
  const cdvelo = ind['cds_velocity_bps_week']?.value;
  const dxy = ind['dxy_index']?.value;
  const vix = ind['vix_level']?.value;
  const tp = derived.termPremium;
  const spread = derived.sbnUstSpread;
  const usdidrGap = derived.usdidrVsApbn;

  const usdidrCls = usdidr ? alertClass(usdidr, { yellow: 17000, orange: 18000, red: 19500 }) : '';
  const cdsCls = cds ? alertClass(cds, { yellow: 100, orange: 150, red: 200 }) : '';
  const vixCls = vix ? alertClass(vix, { yellow: 25, orange: 35, red: 45 }) : '';
  const tpCls = tp ? alertClass(tp, { yellow: 1.8, orange: 2.0, red: 3.0 }) : '';
  const spreadCls = spread ? alertClass(spread, { yellow: 250, orange: 300, red: 350, inverse: false }) : '';
  const spreadLowCls = spread ? alertClass(200 - (spread || 999), { yellow: 0, orange: 20, red: 50 }) : '';

  return [
    kv('USDIDR', fmtK(usdidr), usdidrCls),
    kv('vs APBN 16,500', usdidrGap != null ? (usdidrGap > 0 ? '+' : '') + usdidrGap + '%' : '—', usdidrGap > 9 ? 'orange' : usdidrGap > 6 ? 'yellow' : 'green'),
    kv('BI Rate', bi ? fmtNum(bi, 2) + '%' : '—', bi >= 5.5 ? 'orange' : ''),
    kv('SBN 10Y', sbn ? fmtNum(sbn, 2) + '%' : '—', sbn >= 7.5 ? 'orange' : sbn >= 7.0 ? 'yellow' : ''),
    kv('Term Premium', tp != null ? fmtNum(tp, 2) + '%' : '—', tpCls),
    kv('CDS 5Y', cds ? fmtNum(cds, 1) + 'bps' : '—', cdsCls),
    kv('CDS Velocity', cdvelo != null ? (cdvelo > 0 ? '+' : '') + fmtNum(cdvelo, 1) + 'bps/wk' : '—', cdvelo > 7 ? 'red' : cdvelo > 3 ? 'orange' : cdvelo > 0 ? 'yellow' : 'green'),
    kv('SBN-UST Spread', spread != null ? spread + 'bps' : '—', spread < 200 ? 'red' : spread < 250 ? 'orange' : ''),
    kv('DXY', dxy ? fmtNum(dxy, 1) : '—', dxy > 108 ? 'orange' : ''),
    kv('VIX', vix ? fmtNum(vix, 1) : '—', vixCls),
  ].join('');
}

function renderFlow(d) {
  const ind = d.indicators;
  const eido = ind['eido_price']?.value;
  const idxFlow = ind['idx_foreign_net_buy_idr_bn']?.value;
  const sbnOwn = ind['sbn_foreign_ownership_pct']?.value;
  const srbiCover = ind['srbi_bid_cover_ratio']?.value;
  const srbiOuts = ind['srbi_outstanding_trn_idr']?.value;

  return [
    kv('EIDO ETF', eido ? '$' + fmtNum(eido, 2) : '—', eido < 10 ? 'red' : eido < 12 ? 'orange' : ''),
    kv('IDX Net Foreign', idxFlow != null ? (idxFlow < 0 ? '' : '+') + fmtK(idxFlow) + 'T' : '—', idxFlow < -2000 ? 'red' : idxFlow < -500 ? 'orange' : idxFlow < 0 ? 'yellow' : 'green'),
    kv('SBN Foreign Own', sbnOwn ? fmtNum(sbnOwn, 2) + '%' : '—', sbnOwn < 10 ? 'red' : sbnOwn < 12 ? 'orange' : sbnOwn < 14 ? 'yellow' : 'green'),
    kv('SRBI Bid-Cover', srbiCover ? fmtNum(srbiCover, 2) + 'x' : '—', srbiCover < 1.0 ? 'red' : srbiCover < 1.5 ? 'orange' : srbiCover < 2.5 ? 'yellow' : 'green'),
    kv('SRBI Outstanding', srbiOuts ? fmtNum(srbiOuts, 0) + 'T IDR' : '—'),
  ].join('');
}

function renderFiscal(d) {
  const ind = d.indicators;
  const brent    = ind['brent_price_usd']?.value;
  const gap      = ind['bbm_subsidy_gap_idr_liter']?.value;
  const cr       = ind['bbm_cost_recovery_idr_liter']?.value;
  const pertalite = ind['pertalite_price_idr_liter']?.value;
  const pertamax  = ind['pertamax_price_idr_liter']?.value;
  const pertamaxG = ind['pertamax_green_price_idr_liter']?.value;
  const reserves = ind['bi_fx_reserves_bn']?.value;
  const resDate  = ind['bi_fx_reserves_bn']?.date;
  const trade    = ind['trade_balance_bn']?.value;
  const gg       = ind['greenspan_guidotti']?.value;
  const dsr      = ind['uln_dsr_pct']?.value;
  const dsrDate  = ind['uln_dsr_pct']?.date;

  return [
    kv('Brent', brent ? '$' + fmtNum(brent, 1) + '/bbl' : '—', brent > 100 ? 'red' : brent > 90 ? 'orange' : brent > 80 ? 'yellow' : 'green'),
    kv('BBM Subsidy Gap', gap ? 'Rp' + fmtK(gap) + '/L' : '—', gap > 7000 ? 'red' : gap > 4000 ? 'orange' : gap > 2000 ? 'yellow' : 'green'),
    kv('Cost Recovery', cr ? 'Rp' + fmtK(cr) + '/L' : '—'),
    kv('Pertalite', pertalite ? 'Rp' + Math.round(pertalite).toLocaleString('id') + '/L' : '—'),
    kv('Pertamax', pertamax ? 'Rp' + Math.round(pertamax).toLocaleString('id') + '/L' : '—'),
    kv('Pertamax Green', pertamaxG ? 'Rp' + Math.round(pertamaxG).toLocaleString('id') + '/L' : '—'),
    kv('FX Reserves', reserves ? '$' + fmtNum(reserves, 1) + 'bn' + stale(resDate, 90) : '—', reserves < 100 ? 'red' : reserves < 120 ? 'orange' : reserves < 130 ? 'yellow' : 'green'),
    kv('Trade Balance', trade != null ? (trade > 0 ? '+' : '') + fmtNum(trade, 1) + 'bn' : '—', trade < -5 ? 'red' : trade < 0 ? 'orange' : 'green'),
    kv('G-G Ratio', gg ? fmtNum(gg, 2) + 'x' : '—', gg < 1.0 ? 'red' : gg < 1.5 ? 'orange' : gg < 2.0 ? 'yellow' : 'green'),
    kv('ULN DSR', dsr ? fmtNum(dsr, 1) + '%' + stale(dsrDate, 365) : '—', dsr > 30 ? 'red' : dsr > 25 ? 'orange' : dsr > 20 ? 'yellow' : 'green'),
  ].join('');
}

function renderBanking(d) {
  const ind = d.indicators;
  const npl     = ind['bank_npl_gross_pct']?.value;
  const nplDate = ind['bank_npl_gross_pct']?.date;
  const car     = ind['bank_car_pct']?.value;
  const carDate = ind['bank_car_pct']?.date;
  const ldr     = ind['bank_ldr_pct']?.value;
  const ldrDate = ind['bank_ldr_pct']?.date;
  const indonia     = ind['indonia_3m_pct']?.value;
  const indoniaDate = ind['indonia_3m_pct']?.date;
  const fintechNpl = ind['fintech_npl_pct']?.value;
  const pe = ind['ihsg_pe_ratio']?.value;
  const ad = ind['idx_advance_decline_ratio']?.value;

  return [
    kv('NPL Gross', npl ? fmtNum(npl, 2) + '%' + stale(nplDate, 365) : '—', npl > 5 ? 'red' : npl > 3 ? 'orange' : npl > 2 ? 'yellow' : 'green'),
    kv('CAR', car ? fmtNum(car, 1) + '%' + stale(carDate, 270) : '—', car < 14 ? 'red' : car < 16 ? 'orange' : car < 18 ? 'yellow' : 'green'),
    kv('LDR', ldr ? fmtNum(ldr, 1) + '%' + stale(ldrDate, 180) : '—', ldr > 92 ? 'red' : ldr > 85 ? 'orange' : ldr > 78 ? 'yellow' : 'green'),
    kv('IndONIA 3M', indonia ? fmtNum(indonia, 2) + '%' + stale(indoniaDate, 180) : '—'),
    kv('Fintech NPL', fintechNpl ? fmtNum(fintechNpl, 1) + '%' : '—', fintechNpl > 5 ? 'orange' : fintechNpl > 3 ? 'yellow' : 'green'),
    kv('IHSG P/E', pe ? fmtNum(pe, 1) + 'x' : '—', pe > 12 ? 'orange' : pe > 10 ? 'yellow' : ''),
    kv('A/D Ratio', ad ? fmtNum(ad, 2) : '—', ad < 0.5 ? 'red' : ad < 0.67 ? 'orange' : ad < 0.8 ? 'yellow' : 'green'),
  ].join('');
}

function computeDoomLoop(d) {
  const ind = d.indicators;
  const items = [];

  const eido = ind['eido_price']?.value;
  const idxFlow = ind['idx_foreign_net_buy_idr_bn']?.value;
  items.push({ label: 'Foreign outflows continuing', active: (idxFlow != null && idxFlow < -1000) || (eido != null && eido < 12) });

  const reserves = ind['bi_fx_reserves_bn']?.value;
  items.push({ label: 'FX reserves declining', active: reserves != null && reserves < 140 });

  const cdvelo = ind['cds_velocity_bps_week']?.value;
  items.push({ label: 'CDS widening', active: cdvelo != null && cdvelo > 1 });

  const sbn = ind['sbn_10y_yield_pct']?.value;
  items.push({ label: 'SBN yields rising', active: sbn != null && sbn > 7.0 });

  const gap = ind['bbm_subsidy_gap_idr_liter']?.value;
  const brent = ind['brent_price_usd']?.value;
  items.push({ label: 'Fiscal pressures rising', active: (gap != null && gap > 4000) || (brent != null && brent > 90) });

  const unemp = ind['unemployment_rate_pct']?.value;
  items.push({ label: 'Labor market deteriorating', active: unemp != null && unemp > 5.0, detail: unemp != null ? unemp.toFixed(2)+'% (>5.0%)' : null });

  const npl      = ind['bank_npl_gross_pct']?.value;
  const nplDate  = ind['bank_npl_gross_pct']?.date ?? null;
  const nplStale = nplDate ? (Date.now() - new Date(nplDate).getTime()) > 365*86400_000 : false;
  const nplDetail = npl != null ? npl.toFixed(2)+'%' + (nplStale ? ' ⚠ stale ('+nplDate+')' : '') : null;
  items.push({ label: 'Credit stress building', active: npl != null && npl > 3.0, detail: nplDetail });

  const score = items.filter(i => i.active).length;
  return { items, score };
}

function renderDoom(d) {
  const { items, score } = computeDoomLoop(d);
  document.getElementById('doom-score').textContent = score;
  const label = score >= 7 ? 'DOOM LOOP RISK' : score >= 5 ? 'Stress' : score >= 3 ? 'Watch' : 'Normal';
  const cls = score >= 7 ? 'red' : score >= 5 ? 'orange' : score >= 3 ? 'yellow' : 'green';
  document.getElementById('doom-label').innerHTML = \`<span class="tag \${cls}">\${label}</span>\`;

  return items.map(item =>
    \`<div class="doom-item">
      <span style="flex:1">\${item.label}</span>
      \${item.detail ? \`<span style="color:var(--muted);font-size:9px;flex:1;text-align:center;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">\${item.detail}</span>\` : ''}
      <span class="\${item.active ? 'red' : 'green'}" style="flex:0 0 42px;text-align:right">\${item.active ? '▲ YES' : '○ no'}</span>
    </div>\`
  ).join('');
}

function renderFood(d) {
  const ind = d.indicators;
  const foods = [
    { key: 'pihps_beras_medium_idr', label: 'Beras Medium', fmt: v => 'Rp'+fmtK(v)+'/kg' },
    { key: 'pihps_cabai_rawit_merah_idr', label: 'Cabai Rawit', fmt: v => 'Rp'+fmtK(v)+'/kg' },
    { key: 'pihps_cabai_merah_kriting_idr', label: 'Cabai Merah', fmt: v => 'Rp'+fmtK(v)+'/kg' },
    { key: 'pihps_bawang_merah_idr', label: 'Bawang Merah', fmt: v => 'Rp'+fmtK(v)+'/kg' },
    { key: 'pihps_minyak_goreng_idr', label: 'Minyak Goreng', fmt: v => 'Rp'+fmtK(v)+'/kg' },
    { key: 'pihps_telur_ayam_idr', label: 'Telur Ayam', fmt: v => 'Rp'+fmtK(v)+'/kg' },
    { key: 'pihps_daging_sapi_idr', label: 'Daging Sapi', fmt: v => 'Rp'+fmtK(v)+'/kg' },
    { key: 'pihps_gula_pasir_idr', label: 'Gula Pasir', fmt: v => 'Rp'+fmtK(v)+'/kg' },
  ];
  return foods.map(f => {
    const v = ind[f.key]?.value;
    return kv(f.label, v ? f.fmt(v) : '—');
  }).join('');
}

// SCD score computed from key indicators (simplified proxy — no engine run)
function computeScdProxy(d) {
  const ind = d.indicators;
  const signals = [];
  const usdidr = ind['usdidr_spot']?.value;
  if (usdidr) signals.push(usdidr > 19500 ? 3 : usdidr > 18000 ? 2 : usdidr > 17000 ? 1 : 0);
  const cds = ind['indonesia_cds_5y_bps']?.value;
  if (cds) signals.push(cds > 200 ? 3 : cds > 150 ? 2 : cds > 100 ? 1 : 0);
  const sbn = ind['sbn_10y_yield_pct']?.value;
  if (sbn) signals.push(sbn > 8.5 ? 3 : sbn > 7.5 ? 2 : sbn > 7.0 ? 1 : 0);
  const eido = ind['eido_price']?.value;
  if (eido) signals.push(eido < 10 ? 3 : eido < 12 ? 2 : eido < 13 ? 1 : 0);
  const reserves = ind['bi_fx_reserves_bn']?.value;
  if (reserves) signals.push(reserves < 100 ? 3 : reserves < 120 ? 2 : reserves < 135 ? 1 : 0);
  const npl = ind['bank_npl_gross_pct']?.value;
  if (npl) signals.push(npl > 5 ? 3 : npl > 3 ? 2 : npl > 2 ? 1 : 0);
  const gap = ind['bbm_subsidy_gap_idr_liter']?.value;
  if (gap) signals.push(gap > 7000 ? 3 : gap > 4000 ? 2 : gap > 2000 ? 1 : 0);

  if (!signals.length) return null;
  const avg = signals.reduce((a,b)=>a+b,0) / signals.length;
  return Math.min(100, Math.round(avg / 3 * 100));
}

function moduleScoreBadge(d, moduleKey) {
  const ms = d.moduleScores?.[moduleKey];
  if (!ms) return '';
  const c = ms.score >= 70 ? 'red' : ms.score >= 50 ? 'orange' : ms.score >= 33 ? 'yellow' : 'green';
  const age = ms.computedAt ? Math.round((Date.now() - new Date(ms.computedAt).getTime()) / 3600000) : null;
  const ageTxt = age !== null ? (age < 1 ? ' <1h ago' : age+'h ago') : '';
  return \`<span class="tag \${c}" style="font-size:9px;margin-left:6px">\${ms.score}/100\${ageTxt}</span>\`;
}

function renderScd(d) {
  const ms = d.moduleScores ?? {};
  // Use real SCD score if available (from last morning-check/SCD run)
  const scdMs = Object.keys(ms).length;
  let score, label, cls;
  if (scdMs > 0) {
    // Replicate SCD weighted sum from module scores
    const W = { fx_defense:0.16, uln:0.09, bop:0.10, sovereign_risk:0.09, foreign_flow:0.09,
                banking:0.08, commodity:0.07, fiscal:0.09, market:0.05, domestic_pressure:0.06,
                political_risk:0.05, regime:0.05, narrative:0.02 };
    let wsum = 0, wtotal = 0;
    for (const [mod, w] of Object.entries(W)) {
      if (ms[mod]) { wsum += ms[mod].score * w; wtotal += w; }
    }
    const stressed = Object.values(ms).filter(m => m.score >= 50).length;
    const amp = stressed >= 5 ? 1.4 : stressed >= 3 ? 1.2 : 1.0;
    score = Math.min(95, Math.round((wtotal > 0 ? wsum / wtotal : 0) * amp));
    const latest = Object.values(ms).sort((a,b) => b.computedAt.localeCompare(a.computedAt))[0];
    const age = latest ? Math.round((Date.now() - new Date(latest.computedAt).getTime()) / 3600000) : null;
    const ageTxt = age !== null ? (age < 1 ? ' · <1h ago' : ' · '+age+'h ago') : '';
    label = (score >= 70 ? '🔴 RED — CRISIS RISK' : score >= 50 ? '🟠 ORANGE — ELEVATED' : score >= 33 ? '🟡 YELLOW — WATCH' : '🟢 GREEN — NORMAL') + ageTxt;
  } else {
    score = computeScdProxy(d);
    label = score == null ? '—' : (score >= 70 ? '🔴 RED — CRISIS RISK' : score >= 50 ? '🟠 ORANGE — ELEVATED' : score >= 33 ? '🟡 YELLOW — WATCH' : '🟢 GREEN — NORMAL') + ' (proxy)';
    if (score == null) { document.getElementById('scd-score').textContent = '?'; return; }
  }
  cls = score >= 70 ? 'red' : score >= 50 ? 'orange' : score >= 33 ? 'yellow' : 'green';
  const el = document.getElementById('scd-score');
  el.textContent = score + '%';
  el.className = 'scd-number ' + cls;
  document.getElementById('scd-alert').innerHTML = \`<span class="tag \${cls}">\${label}</span>\`;
}

function renderCharts(chartsData) {
  const grid = document.getElementById('charts-grid');
  grid.innerHTML = '';
  for (const cfg of CHART_CONFIGS) {
    const series = chartsData[cfg.key] || [];
    const latest = series.length ? series[series.length - 1].value : null;
    const div = document.createElement('div');
    div.className = 'chart-card';
    const canvasId = 'chart-' + cfg.key;
    div.innerHTML = \`
      <div class="chart-title">\${cfg.label}</div>
      <div class="chart-current">\${latest != null ? cfg.fmt(latest) : '—'}</div>
      <canvas id="\${canvasId}"></canvas>
    \`;
    grid.appendChild(div);

    if (chartInstances[canvasId]) { chartInstances[canvasId].destroy(); delete chartInstances[canvasId]; }

    if (series.length >= 2) {
      const ctx = div.querySelector('canvas').getContext('2d');
      chartInstances[canvasId] = new Chart(ctx, {
        type: 'line',
        data: {
          labels: series.map(p => p.date.slice(5)),
          datasets: [{
            data: series.map(p => p.value),
            borderColor: cfg.color,
            backgroundColor: cfg.color + '22',
            fill: true,
            tension: 0.3,
            pointRadius: series.length < 10 ? 3 : 0,
            borderWidth: 1.5,
          }]
        },
        options: {
          responsive: true,
          animation: false,
          plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
          scales: {
            x: { ticks: { color: '#8b949e', font: { size: 9 }, maxTicksLimit: 6 }, grid: { color: '#30363d' } },
            y: { ticks: { color: '#8b949e', font: { size: 9 }, maxTicksLimit: 5 }, grid: { color: '#30363d' } }
          }
        }
      });
      if (series.length < 10) {
        const sparse = div.querySelector('canvas').insertAdjacentElement('afterend', document.createElement('div'));
        sparse.className = 'chart-sparse';
        sparse.textContent = series.length + ' data points — run morning brief to populate history';
      }
    } else if (series.length === 1) {
      const canvas = div.querySelector('canvas');
      canvas.style.display = 'none';
      const msg = document.createElement('div');
      msg.style.cssText = 'height:180px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;';
      msg.innerHTML = \`<span style="font-size:28px;font-weight:700;color:\${cfg.color}">\${cfg.fmt(series[0].value)}</span><span class="chart-sparse">1 data point (\${series[0].date}) — no history yet</span>\`;
      canvas.parentNode.insertBefore(msg, canvas);
    } else {
      const canvas = div.querySelector('canvas');
      canvas.style.display = 'none';
      const msg = document.createElement('div');
      msg.style.cssText = 'height:180px;display:flex;align-items:center;justify-content:center;';
      msg.innerHTML = \`<span class="chart-sparse">No series data — run morning brief to populate</span>\`;
      canvas.parentNode.insertBefore(msg, canvas);
    }
  }
}

async function refresh() {
  document.getElementById('last-updated').textContent = 'Loading...';
  try {
    const [snap, chrt] = await Promise.all([
      fetch('/api/snapshot').then(r => r.json()),
      fetch('/api/charts').then(r => r.json()),
    ]);
    snapshot = snap;
    charts = chrt;

    renderScd(snapshot);
    document.getElementById('panel-monetary').innerHTML = renderMonetary(snapshot);
    document.getElementById('panel-flow').innerHTML = renderFlow(snapshot);
    document.getElementById('panel-fiscal').innerHTML = renderFiscal(snapshot);
    document.getElementById('panel-banking').innerHTML = renderBanking(snapshot);
    document.getElementById('panel-doom').innerHTML = renderDoom(snapshot);
    document.getElementById('panel-food').innerHTML = renderFood(snapshot);
    document.getElementById('panel-polrisk').innerHTML = renderPolRisk(snapshot);
    document.getElementById('panel-asean').innerHTML = renderAsean(snapshot);
    renderCharts(charts);

    // Inject module score badges into sidebar card titles
    const MODULE_TITLES = {
      sovereign_risk: 'Monetary & FX',
      foreign_flow:   'Capital Flow',
      fiscal:         'Fiscal & External',
      banking:        'Banking',
    };
    document.querySelectorAll('.card-title').forEach(el => {
      el.querySelectorAll('.mod-badge').forEach(b => b.remove());
      const text = el.textContent.trim();
      for (const [mod, title] of Object.entries(MODULE_TITLES)) {
        if (text === title) {
          const badge = document.createElement('span');
          badge.innerHTML = moduleScoreBadge(snapshot, mod);
          badge.className = 'mod-badge';
          el.appendChild(badge);
        }
      }
    });

    document.getElementById('last-updated').textContent = 'Updated: ' + new Date().toLocaleTimeString('id-ID');
  } catch (e) {
    document.getElementById('last-updated').textContent = 'Error: ' + e.message;
  }
}

// ── Political Risk Panel ──────────────────────────────────────────────────────
function renderPolRisk(d) {
  const ind = d.indicators;
  const unrest  = ind['political_social_unrest_score']?.value ?? null;
  const food    = ind['political_food_stress_score']?.value ?? null;
  const stab    = ind['political_stability_stress_score']?.value ?? null;
  const unemp   = ind['unemployment_rate_pct']?.value ?? null;
  const usdidr  = ind['usdidr_spot']?.value ?? null;
  const gap     = ind['bbm_subsidy_gap_idr_liter']?.value ?? null;

  // Use module score from DB if available (accurate), else compute proxy from raw indicators
  const msPolRisk = d.moduleScores?.['political_risk'];
  const composite = msPolRisk ? msPolRisk.score
    : (() => { const s = [unrest, food, stab ? (100-stab) : null].filter(x=>x!==null); return s.length ? Math.round(s.reduce((a,b)=>a+b,0)/s.length) : null; })();

  const scoreEl = document.getElementById('polrisk-score');
  const labelEl = document.getElementById('polrisk-label');
  if (composite !== null) {
    scoreEl.textContent = composite.toString();
    const cls = composite >= 70 ? 'red' : composite >= 50 ? 'orange' : composite >= 33 ? 'yellow' : 'green';
    scoreEl.className = 'doom-score ' + cls;
    const lbl = composite >= 70 ? 'HIGH RISK' : composite >= 50 ? 'Elevated' : composite >= 33 ? 'Watch' : 'Stable';
    const src = msPolRisk ? '' : ' <span style="font-size:9px;color:var(--muted)">(proxy)</span>';
    labelEl.innerHTML = \`<span class="tag \${cls}">\${lbl}</span>\${src}\`;
  } else {
    scoreEl.textContent = '?';
  }

  const unempDate  = ind['unemployment_rate_pct']?.date ?? null;
  const unrestDate = ind['political_social_unrest_score']?.date ?? null;
  const cds        = ind['indonesia_cds_5y_bps']?.value ?? null;
  const eido       = ind['eido_price']?.value ?? null;
  const idxFlow    = ind['idx_foreign_net_buy_idr_bn']?.value ?? null;

  // 1998 analog: 5 distinct macro conditions (none overlap with M12 score bars above)
  const t98 = [
    { label: 'Food unaffordable',      detail: food != null ? 'food stress '+food+'/100' : '—',                                                             active: (food ?? 0) > 50 },
    { label: 'IDR lemah (>17,000)',    detail: usdidr != null ? fmtK(usdidr) : '',                                                                            active: (usdidr ?? 0) > 17000 },
    { label: 'Pengangguran naik',       detail: unemp != null ? fmtNum(unemp,2)+'% ['+(unempDate ?? 'n/a')+'] BPS' : 'BPS quarterly',                         active: (unemp ?? 0) > 4.8 },
    { label: 'CDS widening (>100bps)', detail: cds != null ? fmtNum(cds,1)+'bps' : '—',                                                                      active: (cds ?? 0) > 100 },
    { label: 'Capital exit signal',    detail: eido != null ? 'EIDO $'+fmtNum(eido,2) : idxFlow != null ? fmtK(idxFlow)+'B IDR' : '—',                       active: (eido ?? 999) < 12 || (idxFlow ?? 0) < -1000 },
  ];
  const t98score = t98.filter(x => x.active).length;
  const t98cls = t98score >= 4 ? 'red' : t98score >= 3 ? 'orange' : t98score >= 2 ? 'yellow' : 'green';
  document.getElementById('template98-score').className = t98cls;
  document.getElementById('template98-score').textContent = t98score.toString();

  // All bars: raw stress score 0-100, higher = worse (consistent direction)
  const scoreRows = [
    { label: 'Social Unrest', val: unrest, date: unrestDate },
    { label: 'Food Stress',   val: food,   date: ind['political_food_stress_score']?.date ?? null },
    { label: 'Stab Stress',   val: stab,   date: ind['political_stability_stress_score']?.date ?? null },
  ].map(({ label, val, date }) => {
    if (val === null) return \`<div class="bar-row"><span class="bar-label">\${label}</span><span style="color:var(--muted)">n/a</span></div>\`;
    const cls   = val >= 70 ? 'red' : val >= 50 ? 'orange' : val >= 33 ? 'yellow' : 'green';
    const color = val >= 70 ? 'var(--red)' : val >= 50 ? 'var(--orange)' : val >= 33 ? 'var(--yellow)' : 'var(--green)';
    const dateStr = date ? date.slice(5) : '';
    return \`<div class="bar-row">
      <span class="bar-label">\${label}</span>
      <div class="bar-track"><div class="bar-fill" style="width:\${val}%;background:\${color}"></div></div>
      <span style="font-size:9px;color:var(--muted);flex-shrink:0;width:32px;text-align:right">\${dateStr}</span>
      <span class="bar-val \${cls}" style="width:36px">\${val}/100</span>
    </div>\`;
  }).join('');

  const t98rows = t98.map(item =>
    \`<div class="template98-item">
      <span style="flex:1">\${item.label}</span>
      <span style="color:var(--muted);font-size:9px;flex:1;text-align:center;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">\${item.detail}</span>
      <span class="\${item.active ? 'red' : 'green'}" style="flex:0 0 42px;text-align:right">\${item.active ? '▲ YES' : '○ no'}</span>
    </div>\`
  ).join('');

  // Economic Context — unique signals not shown in other panels
  const inflCpi    = ind['inflation_cpi_pct']?.value ?? null;
  const inflDate   = ind['inflation_cpi_pct']?.date ?? null;
  const gdpGrowth  = ind['gdp_growth_pct']?.value ?? null;
  const gdpDate    = ind['gdp_growth_pct']?.date ?? null;
  const foodInfl   = ind['food_inflation_yoy_pct']?.value ?? null;
  const pmi        = ind['indonesia_pmi_manufacturing']?.value ?? null;
  const now = new Date(), mo = now.getMonth()+1, dy = now.getDate(), yr = now.getFullYear();
  const seasonal = (yr===2026 && mo===6 && dy>=1 && dy<=15) ? 'Iduladha Jun 1–15'
                 : (yr===2027 && mo===5 && dy>=22) || (yr===2027 && mo===6 && dy<=5) ? 'Iduladha 2027'
                 : (mo===12 && dy>=20) || (mo===1 && dy<=7) ? 'Natal/Tahun Baru' : null;

  const inflCls    = inflCpi !== null ? (inflCpi > 5 ? 'red' : inflCpi > 3.5 ? 'orange' : inflCpi > 2.5 ? 'yellow' : 'green') : '';
  const gdpCls     = gdpGrowth !== null ? (gdpGrowth < 4 ? 'red' : gdpGrowth < 4.5 ? 'orange' : 'green') : '';
  const foodInflCls = foodInfl !== null ? (foodInfl > 7 ? 'red' : foodInfl > 5 ? 'orange' : foodInfl > 3.75 ? 'yellow' : 'green') : '';
  const pmiCls     = pmi !== null ? (pmi < 48 ? 'red' : pmi < 50 ? 'orange' : pmi < 51 ? 'yellow' : 'green') : '';

  const ctxSection = \`
    <div style="margin-top:8px;border-top:1px solid var(--border);padding-top:6px">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:4px">Macro Context</div>
      \${kv('CPI Inflation', inflCpi !== null ? fmtNum(inflCpi,1)+'%'+stale(inflDate,90)+' <span style="color:var(--muted)">(target 2.5%)</span>' : '—', inflCls)}
      \${kv('Food Inflation', foodInfl !== null ? fmtNum(foodInfl,2)+'% YoY' : '—', foodInflCls)}
      \${kv('GDP Growth', gdpGrowth !== null ? fmtNum(gdpGrowth,1)+'%'+stale(gdpDate,90) : '—', gdpCls)}
      \${kv('PMI Manufaktur', pmi !== null ? fmtNum(pmi,1)+(pmi >= 50 ? ' ▲ ekspansi' : ' ▼ kontraksi') : '—', pmiCls)}
      \${seasonal ? \`<div style="margin-top:4px;font-size:9px;color:var(--yellow);padding:2px 5px;background:rgba(210,153,34,.08);border-radius:2px;border:1px solid rgba(210,153,34,.15)">⚡ \${seasonal}: food stress −30% seasonal discount active</div>\` : ''}
    </div>
  \`;

  const env = d.envFlags ?? {};
  const missingFeed = [];
  if (!env.hasX) missingFeed.push('X (real-time demo)');
  if (!env.hasTavily) missingFeed.push('Tavily (Detik/Kompas/Tempo)');
  const feedWarning = missingFeed.length > 0
    ? \`<div style="margin-top:6px;font-size:9px;color:var(--orange);padding:3px 6px;background:rgba(227,114,28,.08);border-radius:3px;border:1px solid rgba(227,114,28,.2)">⚠ Feed offline: \${missingFeed.join(', ')}. Unrest score may be understated.\${!env.hasX ? ' Set X_BEARER_TOKEN for minute-zero demo detection.' : ''}</div>\`
    : \`<div style="margin-top:6px;font-size:9px;color:var(--green);padding:3px 6px;background:rgba(63,185,80,.08);border-radius:3px;border:1px solid rgba(63,185,80,.2)">✓ All 3 sources active: Exa + Tavily + X</div>\`;

  return \`
    \${scoreRows}
    <div style="margin-top:8px;font-size:10px;color:var(--muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.06em">1998 Template Checklist</div>
    \${t98rows}
    \${ctxSection}
    \${feedWarning}
  \`;
}

// ── ASEAN FX Peers Panel ──────────────────────────────────────────────────────
function fmtSpot(v, label) {
  if (label === 'IDR' || label === 'VND') return Math.round(v).toLocaleString('id');
  if (v >= 10) return v.toFixed(2);
  return v.toFixed(4);
}

function renderAsean(d) {
  const { aseanFx } = d;
  if (!aseanFx) return '<span style="color:var(--muted)">No data</span>';

  const entries = Object.values(aseanFx);
  entries.sort((a,b) => (b.changePct ?? -999) - (a.changePct ?? -999));

  // ASEAN median 30d change (excl IDR)
  const peerChanges = entries.filter(e => e.label !== 'IDR').map(e => e.changePct).filter(x => x !== null);
  const sortedPeers = [...peerChanges].sort((a,b) => a-b);
  const median = sortedPeers.length ? sortedPeers[Math.floor(sortedPeers.length/2)] : null;
  const idrChange = aseanFx['usdidr_spot']?.changePct ?? null;
  const idiosync = idrChange !== null && median !== null ? +(idrChange - median).toFixed(2) : null;

  // Summary stats
  const validEntries = entries.filter(e => e.changePct !== null);
  const depreciating = validEntries.filter(e => (e.changePct ?? 0) > 0.5).length;
  const appreciating = validEntries.filter(e => (e.changePct ?? 0) < -0.5).length;
  const allDepreciating = validEntries.length > 0 && validEntries.every(e => (e.changePct ?? 0) > 0);

  // IDR rank (1 = most depreciated)
  const idrEntry = entries.find(e => e.label === 'IDR');
  const idrRank = idrEntry ? entries.filter(e => e.changePct !== null).findIndex(e => e.label === 'IDR') + 1 : null;

  // Summary header bar
  const idiosCls = idiosync === null ? '' : Math.abs(idiosync) >= 3 ? 'red' : Math.abs(idiosync) >= 1 ? 'orange' : 'green';
  const summaryHtml = \`<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-bottom:8px">
    <div style="background:rgba(255,255,255,.04);border-radius:3px;padding:4px 6px;text-align:center">
      <div style="font-size:18px;font-weight:700;color:var(--text)">\${idrRank ?? '?'}<span style="font-size:10px;color:var(--muted)">/\${validEntries.length}</span></div>
      <div style="font-size:9px;color:var(--muted)">IDR rank</div>
    </div>
    <div style="background:rgba(255,255,255,.04);border-radius:3px;padding:4px 6px;text-align:center">
      <div style="font-size:18px;font-weight:700" class="\${idiosCls}">\${idiosync !== null ? (idiosync > 0 ? '+' : '')+idiosync+'%' : '—'}</div>
      <div style="font-size:9px;color:var(--muted)">IDR idiosync</div>
    </div>
    <div style="background:rgba(255,255,255,.04);border-radius:3px;padding:4px 6px;text-align:center">
      <div style="font-size:18px;font-weight:700;color:var(--orange)">\${depreciating}<span style="font-size:10px;color:var(--muted)">/\${validEntries.length}</span></div>
      <div style="font-size:9px;color:var(--muted)">depreciating</div>
    </div>
  </div>\`;

  // Bars with spot rate
  const maxAbs = Math.max(1, ...entries.map(e => Math.abs(e.changePct ?? 0)));
  const bars = entries.map(e => {
    const pct = e.changePct;
    const isIdr = e.label === 'IDR';
    if (pct === null) return \`<div class="bar-row">
      <span class="bar-label" style="\${isIdr ? 'color:var(--text);font-weight:700' : ''}">\${e.label}</span>
      <div class="bar-track"></div>
      <span style="font-size:10px;color:var(--muted);width:52px;text-align:right">n/a</span>
    </div>\`;
    const cls = pct >= 5 ? 'red' : pct >= 3 ? 'orange' : pct >= 1 ? 'yellow' : pct <= -1 ? 'green' : '';
    const color = pct >= 5 ? 'var(--red)' : pct >= 3 ? 'var(--orange)' : pct >= 1 ? 'var(--yellow)' : pct <= -1 ? 'var(--green)' : 'var(--muted)';
    const widthPct = Math.min(100, Math.abs(pct) / maxAbs * 100);
    const spotStr = e.current !== null ? fmtSpot(e.current, e.label) : '';
    return \`<div class="bar-row" style="margin-bottom:4px">
      <span class="bar-label" style="\${isIdr ? 'color:var(--text);font-weight:700' : ''}">\${e.label}</span>
      <div class="bar-track"><div class="bar-fill" style="width:\${widthPct}%;background:\${color}"></div></div>
      <span style="font-size:9px;color:var(--muted);width:48px;text-align:right;flex-shrink:0">\${spotStr}</span>
      <span class="bar-val \${cls}" style="width:48px">\${pct > 0 ? '+' : ''}\${pct.toFixed(2)}%</span>
    </div>\`;
  }).join('');

  // Narrative — rendered inline, clear the external div
  let narrativeTxt = '';
  if (idiosync !== null && median !== null) {
    narrativeTxt = \`ASEAN median 30d: <b>\${median > 0 ? '+' : ''}\${median.toFixed(2)}%</b> (\${depreciating} depresiasi, \${appreciating} apresiasi).\`;
    if (allDepreciating && Math.abs(idiosync) < 1.5) narrativeTxt += \` <span class="yellow">DXY broad — bukan ID-specific.</span>\`;
    else if (idiosync >= 3) narrativeTxt += \` <span class="red">IDR ID-specific pressure (+\${idiosync}% vs median).</span>\`;
    else if (idiosync <= -2) narrativeTxt += \` <span class="green">IDR outperform peers.</span>\`;
    else narrativeTxt += \` IDR inline dengan peers.\`;
  }
  const narrativeHtml = narrativeTxt
    ? \`<div style="font-size:9px;color:var(--muted);margin:6px 0 2px;line-height:1.5">\${narrativeTxt}</div>\`
    : '';
  document.getElementById('asean-narrative').innerHTML = '';

  // FX Drivers — unique signals not shown in Monetary panel
  const ind = d.indicators;
  const bi    = ind['bi_rate_pct']?.value ?? null;
  const ust   = ind['ust_10y_yield_pct']?.value ?? null;
  const carry = bi !== null && ust !== null ? +(bi - ust).toFixed(2) : null;
  const idrVol = ind['usdidr_vol_30d']?.value ?? null;
  const pmi    = ind['indonesia_pmi_manufacturing']?.value ?? null;
  const debtGdp = ind['indonesia_debt_gdp_pct']?.value ?? null;

  const carryCls  = carry !== null ? (carry < 0.5 ? 'red' : carry < 1.0 ? 'orange' : carry < 1.5 ? 'yellow' : 'green') : '';
  const idrVolCls = idrVol !== null ? (idrVol > 15 ? 'red' : idrVol > 10 ? 'orange' : idrVol > 7 ? 'yellow' : 'green') : '';
  const pmiCls    = pmi !== null ? (pmi < 48 ? 'red' : pmi < 50 ? 'orange' : pmi < 51 ? 'yellow' : 'green') : '';

  const fxDrivers = \`
    <div style="margin-top:8px;border-top:1px solid var(--border);padding-top:8px">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:6px">IDR Risk Factors</div>
      \${kv('Carry (BI−UST)',   carry   != null ? (carry > 0 ? '+' : '')+fmtNum(carry,2)+'%'  : '—', carryCls)}
      \${kv('UST 10Y',          ust     ? fmtNum(ust,3)+'%'                                   : '—')}
      \${kv('IDR 30d Vol',      idrVol  ? fmtNum(idrVol,1)+'% ann.'                           : '—', idrVolCls)}
      \${kv('PMI Manufaktur',   pmi     ? fmtNum(pmi,1)+(pmi >= 50 ? ' ▲' : ' ▼')            : '—', pmiCls)}
      \${kv('Debt/GDP',         debtGdp ? fmtNum(debtGdp,1)+'%'                               : '—', debtGdp > 60 ? 'red' : debtGdp > 50 ? 'orange' : debtGdp > 40 ? 'yellow' : 'green')}
    </div>
  \`;

  const coverageNote = \`<div style="margin-top:6px;font-size:9px;color:var(--muted);padding:2px 4px">Coverage: 6 dari 10 ASEAN — 4 lainnya: BND=SGD peg, MMK/KHR/LAK non-float</div>\`;

  return summaryHtml + bars + narrativeHtml + fxDrivers + coverageNote;
}

// ── Markdown → HTML (minimal, SCD-tuned) ─────────────────────────────────────
function mdToHtml(md) {
  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const colorize = s => s
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\b(RED|CRISIS)\b/g, '<span class="red">$1</span>')
    .replace(/\b(ORANGE|ELEVATED)\b/g, '<span class="orange">$1</span>')
    .replace(/\b(YELLOW|WATCH)\b/g, '<span class="yellow">$1</span>')
    .replace(/\b(GREEN|NORMAL|STABLE)\b/g, '<span class="green">$1</span>');

  const lines = md.split('\\n');
  const out = [];
  let inTable = false;
  let tableRowCount = 0;
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    // Table rows
    if (line.startsWith('|')) {
      const cells = line.split('|').filter((_,j,a) => j > 0 && j < a.length - 1).map(c => c.trim());
      if (cells.every(c => /^[-:]+$/.test(c))) continue; // separator row
      if (!inTable) { out.push('<div class="tbl">'); inTable = true; tableRowCount = 0; }
      const isHeader = tableRowCount === 0;
      const cellHtml = cells.map(c => \`<span>\${colorize(esc(c))}</span>\`).join('');
      out.push(\`<div class="tbl-row\${isHeader ? ' tbl-header' : ''}">\${cellHtml}</div>\`);
      tableRowCount++;
      continue;
    }
    if (inTable) { out.push('</div>'); inTable = false; tableRowCount = 0; }

    // List items
    if (/^[-*] /.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(\`<li>\${colorize(esc(line.slice(2)))}</li>\`);
      continue;
    }
    if (inList) { out.push('</ul>'); inList = false; }

    if (!line) continue;
    if (line.startsWith('### ')) { out.push(\`<h3>\${colorize(esc(line.slice(4)))}</h3>\`); continue; }
    if (line.startsWith('## ')) { out.push(\`<h2>\${colorize(esc(line.slice(3)))}</h2>\`); continue; }
    if (line.startsWith('# ')) { out.push(\`<h2>\${colorize(esc(line.slice(2)))}</h2>\`); continue; }
    // blockquote
    if (line.startsWith('> ')) { out.push(\`<p style="border-left:2px solid var(--border);padding-left:8px;color:var(--muted)">\${colorize(esc(line.slice(2)))}</p>\`); continue; }
    out.push(\`<p>\${colorize(esc(line))}</p>\`);
  }

  if (inTable) out.push('</div>');
  if (inList) out.push('</ul>');
  return out.join('\\n');
}

// ── SCD on-demand ────────────────────────────────────────────────────────────
let scdPollTimer = null;

async function runScd() {
  const btn = document.getElementById('scd-btn');
  const status = document.getElementById('scd-status');
  btn.disabled = true;
  btn.textContent = '⏳ Running...';
  status.textContent = 'Starting SCD scan...';

  try {
    await fetch('/api/run-scd', { method: 'POST' });
    scdPollTimer = setInterval(pollScdResult, 5000);
    pollScdResult();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = '▶ Run Full SCD (13 modules ~60-120s)';
    status.textContent = 'Error: ' + e.message;
  }
}

async function pollScdResult() {
  const btn = document.getElementById('scd-btn');
  const statusEl = document.getElementById('scd-status');
  const panel = document.getElementById('scd-result-panel');
  const content = document.getElementById('scd-result-content');

  try {
    const r = await fetch('/api/scd-result').then(x => x.json());
    if (r.status === 'running') {
      const elapsed = r.startedAt ? Math.round((Date.now() - new Date(r.startedAt).getTime()) / 1000) : '?';
      statusEl.textContent = \`Running... \${elapsed}s elapsed\`;
      return;
    }
    if (scdPollTimer) { clearInterval(scdPollTimer); scdPollTimer = null; }
    btn.disabled = false;
    btn.textContent = '▶ Run Full SCD (13 modules ~60-120s)';

    if (r.status === 'done') {
      statusEl.textContent = 'Completed at ' + new Date(r.completedAt).toLocaleTimeString('id-ID');
      panel.style.display = 'block';
      content.innerHTML = mdToHtml(r.result || '(no result)');
    } else if (r.status === 'error') {
      statusEl.textContent = '❌ Error: ' + r.error;
    }
  } catch (e) {
    statusEl.textContent = 'Poll error: ' + e.message;
  }
}

refresh();
setInterval(refresh, 60_000);
</script>
</body>
</html>`;

// ── R&R / G-G Framework Page ─────────────────────────────────────────────────

const RR_HTML = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dexter — R&R / G-G Framework</title>
<style>
  :root {
    --bg:#0d1117; --surface:#161b22; --border:#30363d; --fg:#e6edf3;
    --muted:#8b949e; --green:#3fb950; --yellow:#d29922; --orange:#e3721c; --red:#f85149;
  }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--bg); color:var(--fg); font-family:'SF Mono',monospace; font-size:12px; }
  header { padding:14px 24px; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:16px; }
  header h1 { font-size:15px; font-weight:600; }
  a.back { font-size:11px; color:var(--muted); text-decoration:none; padding:4px 8px; border:1px solid var(--border); border-radius:4px; }
  a.back:hover { color:var(--fg); }
  .page { display:grid; grid-template-columns:1fr 1fr; gap:16px; padding:16px 24px; max-width:1400px; margin:0 auto; }
  .card { background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:14px; }
  .card-title { font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin-bottom:12px; }
  .big-num { font-size:36px; font-weight:700; line-height:1; }
  .tag { font-size:10px; padding:2px 7px; border-radius:3px; font-weight:600; text-transform:uppercase; }
  .green { color:var(--green); } .yellow { color:var(--yellow); } .orange { color:var(--orange); } .red { color:var(--red); }
  .tag.green { background:rgba(63,185,80,.12); } .tag.yellow { background:rgba(210,153,34,.12); }
  .tag.orange { background:rgba(227,114,28,.12); } .tag.red { background:rgba(248,81,73,.12); }
  .kv { display:flex; justify-content:space-between; align-items:baseline; padding:3px 0; border-bottom:1px solid var(--border); font-size:11px; }
  .kv:last-child { border-bottom:none; }
  .kv-label { color:var(--muted); }
  .kv-val { font-weight:500; }
  .section-title { font-size:10px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin:10px 0 6px; border-top:1px solid var(--border); padding-top:8px; }
  .fw-table { width:100%; border-collapse:collapse; margin-top:4px; }
  .fw-table th { font-size:9px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); text-align:left; padding:4px 6px; border-bottom:1px solid var(--border); font-weight:400; }
  .fw-table td { padding:5px 6px; border-bottom:1px solid rgba(48,54,61,.5); font-size:11px; vertical-align:middle; }
  .fw-table tr:last-child td { border-bottom:none; }
  .fw-theory { font-size:9px; color:var(--muted); font-style:italic; display:block; margin-top:1px; }
  .gauge-wrap { display:flex; align-items:center; gap:16px; margin-bottom:12px; }
  .gauge-arc { position:relative; width:80px; height:44px; overflow:visible; }
  .hist-note { margin-top:8px; font-size:9px; color:var(--muted); padding:4px 6px; background:rgba(48,54,61,.4); border-radius:3px; border-left:2px solid var(--border); }
  #last-updated-rr { font-size:10px; color:var(--muted); margin-left:auto; }
</style>
</head>
<body>
<header>
  <h1>🇮🇩 R&R / G-G — Theoretical Framework Monitor</h1>
  <span id="last-updated-rr">—</span>
  <a href="/" class="back">← Dashboard</a>
  <a href="/bs" class="back" style="margin-left:6px">Big Short →</a>
</header>
<div class="page">
  <div class="card" id="panel-gg">
    <div class="card-title">G-G Shield — Greenspan-Guidotti Ratio</div>
    <div style="color:var(--muted)">Loading…</div>
  </div>
  <div class="card" id="panel-rr">
    <div class="card-title">R&R Open Economy — 9 Frameworks Live</div>
    <div style="color:var(--muted)">Loading…</div>
  </div>
</div>
<script>
function fmtNum(v,d=2){ return v != null ? (+v).toFixed(d) : '—'; }
function fmtK(v){ return v != null ? (v/1000).toFixed(1)+'k' : '—'; }
function cls(v, g, y, o){ return v >= o ? 'red' : v >= y ? 'orange' : v >= g ? 'yellow' : 'green'; }
function clsInv(v, g, y, o){ return v <= o ? 'red' : v <= y ? 'orange' : v <= g ? 'yellow' : 'green'; }
function kv(label,val,c=''){ return \`<div class="kv"><span class="kv-label">\${label}</span><span class="kv-val \${c}">\${val}</span></div>\`; }
function tag(label,c){ return \`<span class="tag \${c}">\${label}</span>\`; }

function renderGG(d) {
  const ind = d.indicators;
  const gg      = ind['greenspan_guidotti']?.value ?? null;
  const res     = ind['bi_fx_reserves_bn']?.value ?? null;
  const dndf    = ind['bi_dndf_outstanding_bn']?.value ?? null;
  const effRes  = (res != null && dndf != null) ? +(res - dndf).toFixed(1) : null;
  const dsr     = ind['uln_dsr_pct']?.value ?? null;
  const ulnGdp  = ind['uln_gdp_ratio_pct']?.value ?? null;
  const stPct   = ind['uln_shortterm_pct']?.value ?? null;
  const sbn     = ind['sbn_10y_yield_pct']?.value ?? null;
  const gdp     = ind['gdp_growth_pct']?.value ?? null;
  const rg      = (sbn != null && gdp != null) ? +(sbn - gdp).toFixed(2) : null;
  const extDebt = ind['indonesia_external_debt_bn']?.value ?? null;
  const stDebt  = (extDebt != null && stPct != null) ? +(extDebt * stPct / 100).toFixed(1) : null;
  // Adjusted GG using effective reserves (cadev − DNDF)
  const adjGG   = (effRes != null && stDebt != null && stDebt > 0) ? +(effRes / stDebt).toFixed(2) : null;
  const adjGGCls = adjGG != null ? (adjGG < 1.0 ? 'red' : adjGG < 1.5 ? 'orange' : adjGG < 2.0 ? 'yellow' : 'green') : '';

  const ggCls  = gg != null ? (gg < 1.0 ? 'red' : gg < 1.5 ? 'orange' : gg < 2.0 ? 'yellow' : 'green') : '';
  const ggLbl  = gg != null ? (gg < 1.0 ? 'KRITIS' : gg < 1.5 ? 'Elevated' : gg < 2.0 ? 'Watch' : 'Aman') : '—';
  const dsrCls = dsr != null ? (dsr > 30 ? 'red' : dsr > 25 ? 'orange' : dsr > 20 ? 'yellow' : 'green') : '';
  const rgCls  = rg != null ? (rg > 3 ? 'red' : rg > 2 ? 'orange' : rg > 1 ? 'yellow' : 'green') : '';
  const rgLbl  = rg != null ? (rg > 2 ? '▲ snowball risk' : rg > 1 ? '▲ watch' : '✓ ok') : '';

  // SVG semi-circle gauge for G-G
  const pct = gg != null ? Math.min(gg / 3, 1) : 0;
  const angle = pct * 180;
  const rad   = (180 - angle) * Math.PI / 180;
  const cx = 40, cy = 40, r = 34;
  const x = cx + r * Math.cos(rad);
  const y = cy - r * Math.sin(rad);
  const arc = gg != null ? \`M\${cx-r},\${cy} A\${r},\${r} 0 0,1 \${x.toFixed(1)},\${y.toFixed(1)}\` : '';
  const gaugeColor = gg != null ? (gg < 1.0 ? 'var(--red)' : gg < 1.5 ? 'var(--orange)' : gg < 2.0 ? 'var(--yellow)' : 'var(--green)') : 'var(--muted)';

  const gauge = \`<svg width="80" height="44" viewBox="0 0 80 44">
    <path d="M6,40 A34,34 0 0,1 74,40" fill="none" stroke="var(--border)" stroke-width="6" stroke-linecap="round"/>
    \${arc ? \`<path d="\${arc}" fill="none" stroke="\${gaugeColor}" stroke-width="6" stroke-linecap="round"/>\` : ''}
    <line x1="\${x.toFixed(1)}" y1="\${y.toFixed(1)}" x2="\${cx}" y2="\${cy}" stroke="\${gaugeColor}" stroke-width="1.5" opacity=".6"/>
    <text x="\${cx}" y="38" text-anchor="middle" font-size="9" fill="var(--muted)">0</text>
  </svg>\`;

  return \`
    <div class="gauge-wrap">
      \${gauge}
      <div>
        <div class="big-num \${ggCls}">\${gg != null ? fmtNum(gg,2)+'x' : '—'}</div>
        <div style="margin-top:4px">\${tag(ggLbl, ggCls)}</div>
        <div style="font-size:9px;color:var(--muted);margin-top:3px">Threshold kritis: &lt;1.0x</div>
      </div>
    </div>
    \${kv('FX Reserves (published)', res ? '$'+fmtNum(res,1)+'bn' : '—')}
    \${dndf != null ? kv('DNDF Outstanding', '-$'+fmtNum(dndf,1)+'bn (off-balance-sheet)', 'orange') : ''}
    \${effRes != null ? kv('Effective Reserves', '$'+fmtNum(effRes,1)+'bn (cadev − DNDF)', effRes < 100 ? 'red' : effRes < 120 ? 'orange' : 'green') : ''}
    \${adjGG != null ? kv('GG Adjusted (eff.)', fmtNum(adjGG,2)+'x vs published '+fmtNum(gg,2)+'x', adjGGCls) : ''}
    \${kv('External Debt', extDebt ? '$'+fmtNum(extDebt,1)+'bn' : '—')}
    \${kv('Short-term ULN', stDebt ? '$'+fmtNum(stDebt,1)+'bn ('+fmtNum(stPct,1)+'%)' : stPct ? stPct+'%' : '—')}
    \${kv('ULN DSR', dsr ? fmtNum(dsr,2)+'%' : '—', dsrCls)}
    \${kv('ULN / GDP', ulnGdp ? fmtNum(ulnGdp,1)+'%' : '—', ulnGdp > 45 ? 'red' : ulnGdp > 40 ? 'orange' : ulnGdp > 35 ? 'yellow' : 'green')}
    <div class="section-title">r − g Debt Dynamics</div>
    \${kv('SBN 10Y (r)', sbn ? fmtNum(sbn,2)+'%' : '—')}
    \${kv('GDP Growth (g)', gdp ? fmtNum(gdp,1)+'%' : '—')}
    \${kv('r − g spread', rg != null ? (rg > 0 ? '+' : '')+fmtNum(rg,2)+'% '+rgLbl : '—', rgCls)}
    <div class="hist-note">1997 analog: GG ratio Indonesia ~0.4x saat krisis — reserves depleted vs ST debt. Saat ini 2.27x = buffer signifikan, tapi DSR 24.69% naik (2022→2023→2024: 23.3%→20.3%→24.7%).</div>
  \`;
}

function renderRR(d) {
  const ind = d.indicators;
  const bi       = ind['bi_rate_pct']?.value ?? null;
  const ust      = ind['ust_10y_yield_pct']?.value ?? null;
  const carry    = (bi != null && ust != null) ? +(bi - ust).toFixed(2) : null;
  const usdidr   = ind['usdidr_spot']?.value ?? null;
  const apbnRate = 16500;
  const pppDev   = usdidr != null ? +(((usdidr - apbnRate) / apbnRate) * 100).toFixed(1) : null;
  const sbn      = ind['sbn_10y_yield_pct']?.value ?? null;
  const gdp      = ind['gdp_growth_pct']?.value ?? null;
  const rg       = (sbn != null && gdp != null) ? +(sbn - gdp).toFixed(2) : null;
  const srbi     = ind['srbi_outstanding_trn_idr']?.value ?? null;
  const sbnOwn   = ind['sbn_foreign_ownership_pct']?.value ?? null;
  const cdsVelo  = ind['cds_velocity_bps_week']?.value ?? null;
  const cds      = ind['indonesia_cds_5y_bps']?.value ?? null;
  const idrVol   = ind['usdidr_vol_30d']?.value ?? null;

  const carryCls  = carry != null ? (carry < 0.5 ? 'red' : carry < 1.0 ? 'orange' : carry < 1.5 ? 'yellow' : 'green') : '';
  const pppCls    = pppDev != null ? (pppDev > 15 ? 'red' : pppDev > 9 ? 'orange' : pppDev > 5 ? 'yellow' : 'green') : '';
  const rgCls     = rg != null ? (rg > 3 ? 'red' : rg > 2 ? 'orange' : rg > 1 ? 'yellow' : 'green') : '';
  const srnCls    = srbi != null ? (srbi > 1200 ? 'orange' : srbi > 800 ? 'yellow' : 'green') : '';
  const ssCls     = sbnOwn != null ? (sbnOwn < 10 ? 'red' : sbnOwn < 12 ? 'orange' : sbnOwn < 14 ? 'yellow' : 'green') : '';
  const cdsCls    = cdsVelo != null ? (cdsVelo > 7 ? 'red' : cdsVelo > 3 ? 'orange' : cdsVelo > 0 ? 'yellow' : 'green') : '';
  const volCls    = idrVol != null ? (idrVol > 15 ? 'red' : idrVol > 10 ? 'orange' : idrVol > 7 ? 'yellow' : 'green') : '';

  const frameworks = [
    {
      fw: 'UIP / Carry Trade',
      theory: 'Uncovered Interest Parity — carry tipis → unwind risk',
      signal: carry != null ? (carry > 0 ? '+' : '')+fmtNum(carry,2)+'% (BI '+fmtNum(bi,2)+'% − UST '+fmtNum(ust,3)+'%)' : '—',
      cls: carryCls,
      label: carry != null ? (carry < 0.5 ? 'KRITIS' : carry < 1.0 ? 'Tipis' : carry < 1.5 ? 'Watch' : 'Aman') : '—',
    },
    {
      fw: 'PPP Misalignment',
      theory: 'Purchasing Power Parity — IDR vs APBN 16,500 proxy',
      signal: pppDev != null ? (pppDev > 0 ? '+' : '')+fmtNum(pppDev,1)+'% (IDR '+Math.round(usdidr).toLocaleString('id')+')' : '—',
      cls: pppCls,
      label: pppDev != null ? (pppDev > 15 ? 'Sangat Lemah' : pppDev > 9 ? 'Lemah' : pppDev > 5 ? 'Watch' : 'Wajar') : '—',
    },
    {
      fw: 'r − g Debt Dynamics',
      theory: 'r > g → debt/GDP naik otomatis (Blanchard, R&R Ch.13)',
      signal: rg != null ? (rg > 0 ? '+' : '')+fmtNum(rg,2)+'% (r='+fmtNum(sbn,2)+'% g='+fmtNum(gdp,1)+'%)' : '—',
      cls: rgCls,
      label: rg != null ? (rg > 2 ? 'Snowball' : rg > 1 ? 'Watch' : rg > 0 ? 'Borderline' : 'Favorable') : '—',
    },
    {
      fw: 'Trilemma / Sterilisasi',
      theory: 'SRBI = biaya sterilisasi — makin besar = trilemma makin ketat',
      signal: srbi != null ? fmtNum(srbi,0)+'T IDR outstanding' : '—',
      cls: srnCls,
      label: srbi != null ? (srbi > 1200 ? 'Tinggi' : srbi > 800 ? 'Watch' : 'Normal') : '—',
    },
    {
      fw: 'Sudden Stop (SSVI)',
      theory: 'SBN foreign ownership turun = sudden stop risk (R&R Ch.6)',
      signal: sbnOwn != null ? fmtNum(sbnOwn,2)+'% kepemilikan asing (warning <12%)' : '—',
      cls: ssCls,
      label: sbnOwn != null ? (sbnOwn < 10 ? 'KRITIS' : sbnOwn < 12 ? 'Watch' : sbnOwn < 14 ? 'Monitor' : 'Aman') : '—',
    },
    {
      fw: '1st-Gen Shadow Rate',
      theory: 'CDS velocity = pasar pricing default sebelum BI intervensi',
      signal: cdsVelo != null ? (cdsVelo > 0 ? '+' : '')+fmtNum(cdsVelo,1)+' bps/wk (CDS '+fmtNum(cds,1)+'bps)' : '—',
      cls: cdsCls,
      label: cdsVelo != null ? (cdsVelo > 7 ? 'AKSELERASI' : cdsVelo > 3 ? 'Melebar' : cdsVelo > 0 ? 'Watch' : 'Stabil') : '—',
    },
    {
      fw: 'Dornbusch Overshoot',
      theory: 'IDR vol tinggi = overshooting — reverts ke fundamental',
      signal: idrVol != null ? fmtNum(idrVol,1)+'% annualized 30d realized vol' : '—',
      cls: volCls,
      label: idrVol != null ? (idrVol > 15 ? 'Overshoot' : idrVol > 10 ? 'Elevated' : idrVol > 7 ? 'Watch' : 'Normal') : '—',
    },
  ];

  const rows = frameworks.map(f => \`<tr>
    <td><b>\${f.fw}</b><span class="fw-theory">\${f.theory}</span></td>
    <td>\${f.signal}</td>
    <td><span class="tag \${f.cls}">\${f.label}</span></td>
  </tr>\`).join('');

  const stressed = frameworks.filter(f => ['red','orange','yellow'].includes(f.cls)).length;
  const stressedCls = stressed >= 5 ? 'red' : stressed >= 3 ? 'orange' : stressed >= 2 ? 'yellow' : 'green';

  return \`
    <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:10px">
      <span class="big-num \${stressedCls}">\${stressed}/7</span>
      <span style="color:var(--muted);font-size:11px">frameworks dalam stress zone</span>
    </div>
    <table class="fw-table">
      <thead><tr><th>Framework (R&R)</th><th>Signal Live</th><th>Status</th></tr></thead>
      <tbody>\${rows}</tbody>
    </table>
    <div class="hist-note" style="margin-top:10px">Mundell-Fleming &amp; 2nd-gen confidence gate: hanya tersedia via stress-sim (bukan live signal). Invoke skill <code>shock-scenario</code> untuk analisis.</div>
  \`;
}

async function refresh() {
  const snap = await fetch('/api/snapshot').then(r => r.json());
  document.getElementById('panel-gg').innerHTML = '<div class="card-title">G-G Shield — Greenspan-Guidotti Ratio</div>' + renderGG(snap);
  document.getElementById('panel-rr').innerHTML = '<div class="card-title">R&R Open Economy — 7 Frameworks Live</div>' + renderRR(snap);
  document.getElementById('last-updated-rr').textContent = 'Updated ' + new Date().toLocaleTimeString('id-ID');
}

refresh();
setInterval(refresh, 60_000);
</script>
</body>
</html>`;

// ── Big Short Dashboard Page ──────────────────────────────────────────────────

const BS_HTML = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dexter — Big Short Thesis</title>
<style>
  :root {
    --bg:#0d1117; --surface:#161b22; --border:#30363d; --fg:#e6edf3;
    --muted:#8b949e; --green:#3fb950; --yellow:#d29922; --orange:#e3721c; --red:#f85149;
  }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--bg); color:var(--fg); font-family:'SF Mono',monospace; font-size:12px; }
  header { padding:12px 20px; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
  header h1 { font-size:14px; font-weight:600; }
  .nav-links { display:flex; gap:6px; margin-left:auto; align-items:center; }
  a.nav { font-size:11px; color:var(--muted); text-decoration:none; padding:3px 8px; border:1px solid var(--border); border-radius:4px; }
  a.nav:hover { color:var(--fg); }
  a.nav.active { color:var(--fg); border-color:var(--fg); }
  .conviction-bar { padding:10px 20px; background:var(--surface); border-bottom:1px solid var(--border); display:flex; align-items:center; gap:16px; }
  .conv-gauge { position:relative; }
  .conv-num { font-size:28px; font-weight:700; line-height:1; }
  .conv-label { font-size:9px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin-top:2px; }
  .thesis-status { font-size:11px; padding:4px 10px; border-radius:4px; font-weight:600; }
  .thesis-status.armed { background:rgba(210,153,34,.15); color:var(--yellow); border:1px solid rgba(210,153,34,.3); }
  .thesis-status.triggered { background:rgba(248,81,73,.15); color:var(--red); border:1px solid rgba(248,81,73,.3); }
  .thesis-status.killed { background:rgba(139,148,158,.1); color:var(--muted); border:1px solid var(--border); }
  .thesis-status.none { background:rgba(139,148,158,.1); color:var(--muted); border:1px solid var(--border); }
  .page { display:grid; grid-template-columns:1fr 1.4fr 1fr; gap:12px; padding:14px 20px; max-width:1500px; margin:0 auto; }
  .col { display:flex; flex-direction:column; gap:10px; }
  .card { background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:12px; }
  .card-title { font-size:10px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin-bottom:10px; }
  .tag { font-size:10px; padding:2px 7px; border-radius:3px; font-weight:600; text-transform:uppercase; }
  .green { color:var(--green); } .yellow { color:var(--yellow); } .orange { color:var(--orange); } .red { color:var(--red); }
  .tag.green { background:rgba(63,185,80,.12); } .tag.yellow { background:rgba(210,153,34,.12); }
  .tag.orange { background:rgba(227,114,28,.12); } .tag.red { background:rgba(248,81,73,.12); }
  .kv { display:flex; justify-content:space-between; align-items:baseline; padding:3px 0; border-bottom:1px solid var(--border); font-size:11px; }
  .kv:last-child { border-bottom:none; }
  .kv-label { color:var(--muted); flex-shrink:0; }
  .kv-val { font-weight:500; text-align:right; }
  /* Divergence bars */
  .div-row { margin-bottom:8px; }
  .div-header { display:flex; justify-content:space-between; font-size:11px; margin-bottom:3px; }
  .div-bar-bg { height:6px; background:rgba(48,54,61,.8); border-radius:3px; overflow:hidden; }
  .div-bar { height:6px; border-radius:3px; transition:width .4s; }
  .div-sub { font-size:9px; color:var(--muted); margin-top:2px; }
  /* Transmission chain — vertical stepper */
  .chain-step { display:flex; gap:0; }
  .chain-spine { display:flex; flex-direction:column; align-items:center; flex-shrink:0; width:28px; }
  .chain-num { width:22px; height:22px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:700; border:1px solid transparent; }
  .chain-num.green { background:rgba(63,185,80,.15); border-color:rgba(63,185,80,.4); color:var(--green); }
  .chain-num.yellow { background:rgba(210,153,34,.15); border-color:rgba(210,153,34,.4); color:var(--yellow); }
  .chain-num.orange { background:rgba(227,114,28,.2); border-color:rgba(227,114,28,.5); color:var(--orange); }
  .chain-num.red { background:rgba(248,81,73,.2); border-color:rgba(248,81,73,.5); color:var(--red); }
  .chain-connector { width:2px; flex:1; min-height:10px; margin:2px 0; border-radius:1px; }
  .chain-connector.green { background:rgba(63,185,80,.2); }
  .chain-connector.yellow { background:rgba(210,153,34,.25); }
  .chain-connector.orange { background:rgba(227,114,28,.5); }
  .chain-connector.red { background:rgba(248,81,73,.6); }
  .chain-body { flex:1; padding:0 0 10px 10px; position:relative; }
  .chain-row { display:flex; align-items:center; justify-content:space-between; gap:6px; }
  .chain-label { font-size:11px; font-weight:600; }
  .chain-score-badge { font-size:10px; font-weight:700; padding:2px 6px; border-radius:3px; }
  .chain-status { font-size:9px; text-transform:uppercase; letter-spacing:.05em; }
  /* Tooltip */
  .chain-wrap { position:relative; cursor:default; }
  .chain-tip {
    display:none; position:absolute; left:0; top:100%; margin-top:4px; z-index:200;
    background:#1c2128; border:1px solid var(--border); border-radius:6px;
    padding:10px 12px; width:260px; font-size:10px; line-height:1.55;
    box-shadow:0 6px 20px rgba(0,0,0,.6); pointer-events:none;
  }
  .chain-wrap:hover .chain-tip { display:block; }
  .chain-tip-row { margin-bottom:5px; }
  .chain-tip-row:last-child { margin-bottom:0; }
  .chain-tip-label { font-size:9px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin-bottom:1px; }
  .chain-tip-val { color:var(--fg); }
  .chain-node.red { background:rgba(248,81,73,.1); border-color:rgba(248,81,73,.3); color:var(--red); }
  .chain-arrow { color:var(--muted); font-size:10px; }
  /* Market expression table */
  .mkt-table { width:100%; border-collapse:collapse; }
  .mkt-table th { font-size:9px; text-transform:uppercase; color:var(--muted); text-align:left; padding:3px 5px; border-bottom:1px solid var(--border); font-weight:400; }
  .mkt-table td { padding:5px 5px; border-bottom:1px solid rgba(48,54,61,.4); font-size:10px; vertical-align:top; }
  .mkt-table tr:last-child td { border-bottom:none; }
  /* Kill switches */
  .kill-row { display:flex; gap:8px; align-items:flex-start; padding:5px 0; border-bottom:1px solid var(--border); font-size:11px; }
  .kill-row:last-child { border-bottom:none; }
  .kill-icon { flex-shrink:0; font-size:13px; }
  /* EV calculator */
  .ev-grid { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:8px; }
  .ev-cell { background:rgba(48,54,61,.4); border-radius:4px; padding:6px 8px; }
  .ev-cell-label { font-size:9px; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; }
  .ev-cell-val { font-size:16px; font-weight:700; margin-top:2px; }
  .ev-total { background:rgba(48,54,61,.6); border-radius:4px; padding:8px 10px; text-align:center; border:1px solid var(--border); }
  .ev-total-label { font-size:9px; color:var(--muted); text-transform:uppercase; }
  .ev-total-val { font-size:22px; font-weight:700; margin-top:2px; }
  /* Archive table */
  .arch-table { width:100%; border-collapse:collapse; }
  .arch-table th { font-size:9px; text-transform:uppercase; color:var(--muted); text-align:left; padding:3px 5px; border-bottom:1px solid var(--border); font-weight:400; }
  .arch-table td { padding:4px 5px; border-bottom:1px solid rgba(48,54,61,.4); font-size:10px; }
  .arch-table tr:last-child td { border-bottom:none; }
  /* Timeline */
  .timeline { display:flex; flex-direction:column; gap:6px; }
  .tl-row { display:flex; gap:10px; align-items:flex-start; }
  .tl-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; margin-top:3px; }
  .tl-dot.past { background:var(--green); }
  .tl-dot.now { background:var(--yellow); }
  .tl-dot.future { background:var(--border); }
  .tl-content { flex:1; }
  .tl-label { font-size:10px; font-weight:600; color:var(--muted); }
  .tl-text { font-size:11px; margin-top:2px; }
  /* Analog */
  .analog-box { background:rgba(48,54,61,.3); border-radius:4px; padding:8px 10px; border-left:3px solid var(--yellow); }
  .analog-name { font-size:12px; font-weight:600; margin-bottom:4px; }
  .analog-sim { font-size:10px; color:var(--muted); }
  /* Contrarian / Burry Method */
  .burry-quote { font-style:italic; font-size:11px; color:var(--muted); border-left:3px solid var(--yellow);
    padding:6px 10px; margin-bottom:12px; background:rgba(210,153,34,.05); border-radius:0 4px 4px 0; line-height:1.5; }
  .burry-quote cite { display:block; font-style:normal; font-size:9px; color:var(--muted); margin-top:4px; }
  .ctr-block { margin-bottom:8px; }
  .ctr-block:last-child { margin-bottom:0; }
  .ctr-q { font-size:9px; text-transform:uppercase; letter-spacing:.07em; margin-bottom:4px; font-weight:600; }
  .ctr-q.q1 { color:var(--muted); }
  .ctr-q.q2 { color:var(--orange); }
  .ctr-q.q3 { color:var(--red); }
  .ctr-a { font-size:11px; line-height:1.55; padding:6px 8px; border-radius:4px; }
  .ctr-a.q1 { color:var(--fg); background:rgba(48,54,61,.3); }
  .ctr-a.q2 { color:var(--fg); background:rgba(227,114,28,.07); border-left:2px solid rgba(227,114,28,.5); }
  .ctr-a.q3 { color:var(--fg); background:rgba(248,81,73,.07); border-left:2px solid rgba(248,81,73,.5); }
  /* Research Foundation */
  .research-item { padding:6px 0; border-bottom:1px solid rgba(48,54,61,.6); }
  .research-item:last-child { border-bottom:none; }
  .research-cat { font-size:9px; text-transform:uppercase; letter-spacing:.07em; color:var(--muted); margin-bottom:3px; }
  .research-title { font-size:11px; font-weight:500; line-height:1.4; }
  .research-meta { font-size:9px; color:var(--muted); margin-top:2px; }
  .research-link { font-size:9px; color:var(--yellow); text-decoration:none; }
  .research-link:hover { text-decoration:underline; }
  /* ARM/KILL inline buttons */
  .action-btn { padding:5px 12px; border-radius:5px; border:none; font-size:11px; font-weight:600;
    font-family:inherit; cursor:pointer; transition:.15s; white-space:nowrap; }
  .action-btn.arm { background:rgba(210,153,34,.2); color:var(--yellow); border:1px solid rgba(210,153,34,.4); }
  .action-btn.arm:hover { background:rgba(210,153,34,.35); }
  .action-btn.kill { background:rgba(248,81,73,.1); color:var(--red); border:1px solid rgba(248,81,73,.3); }
  .action-btn.kill:hover { background:rgba(248,81,73,.2); }
  /* Archive full-width */
  .archive-row { padding:10px 20px 20px; max-width:1500px; margin:0 auto; }
  #ts { font-size:10px; color:var(--muted); }
  #action-msg-bar { font-size:10px; color:var(--muted); }
</style>
</head>
<body>
<header>
  <h1>🇮🇩 Big Short — Indonesia Contrarian Thesis</h1>
  <span id="ts">—</span>
  <div class="nav-links">
    <a href="/" class="nav">Dashboard</a>
    <a href="/rr" class="nav">R&amp;R / G-G</a>
    <a href="/bs" class="nav active">Big Short</a>
  </div>
</header>

<!-- Conviction bar -->
<div class="conviction-bar">
  <div class="conv-gauge">
    <div class="conv-num" id="conv-num" style="color:var(--yellow)">—</div>
    <div class="conv-label">Conviction / 95</div>
  </div>
  <div style="flex:1;padding:0 14px">
    <div id="thesis-stmt" style="font-size:11px;line-height:1.55;color:var(--fg)">Loading thesis…</div>
  </div>
  <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;flex-shrink:0">
    <div style="display:flex;align-items:center;gap:8px">
      <span id="thesis-badge" class="thesis-status none">No Active Thesis</span>
      <div id="conv-actions" style="display:flex;gap:6px"></div>
    </div>
    <span id="action-msg-bar"></span>
  </div>
</div>

<div class="page">
  <!-- ── Left column ──────────────────────────────────────────────────────── -->
  <div class="col">
    <div class="card">
      <div class="card-title">Divergence Scanner — 5 Ranked Gaps</div>
      <div id="panel-divs">Loading…</div>
    </div>
    <div class="card">
      <div class="card-title">Kill Switch Status</div>
      <div id="panel-kill">Loading…</div>
    </div>
    <div class="card" style="border-left:3px solid var(--orange)">
      <div class="card-title" style="color:var(--orange)">Haye Oil Framework — Delivered Cost & BoP Drain</div>
      <div id="panel-haye">Loading…</div>
    </div>
    <div class="card">
      <div class="card-title">Historical Analog</div>
      <div id="panel-analog">Loading…</div>
    </div>
  </div>

  <!-- ── Center column ────────────────────────────────────────────────────── -->
  <div class="col">
    <div class="card">
      <div class="card-title">Trigger Monitor</div>
      <div id="panel-trigger">Loading…</div>
    </div>
    <div class="card">
      <div class="card-title">Transmission Chain</div>
      <div id="panel-chain">Loading…</div>
    </div>
    <div class="card">
      <div class="card-title">Timeline — T+0 / T+3 / T+6 / T+12</div>
      <div id="panel-timeline">Loading…</div>
    </div>
    <div class="card" style="border-left:3px solid var(--yellow)">
      <div class="card-title" style="color:var(--yellow)">Burry Method — Contrarian Validation</div>
      <div id="panel-ctr">Loading…</div>
    </div>
  </div>

  <!-- ── Right column ─────────────────────────────────────────────────────── -->
  <div class="col">
    <div class="card">
      <div class="card-title">Market Expression</div>
      <div id="panel-mkt">Loading…</div>
    </div>
    <div class="card">
      <div class="card-title">Expected Value Calculator</div>
      <div id="panel-ev">Loading…</div>
    </div>
    <div class="card">
      <div class="card-title">Research Foundation</div>
      <div id="panel-research">Loading…</div>
    </div>
  </div>
</div>

<!-- ── Archive full-width ────────────────────────────────────────────────── -->
<div class="archive-row">
  <div class="card">
    <div class="card-title">Archive — Thesis Lifecycle & Backtest Record</div>
    <div id="panel-archive">Loading…</div>
  </div>
</div>

<script>
let currentThesis = null;
let activeArmed = null;

function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fmt(v,d=2){ return v!=null ? (+v).toFixed(d) : '—'; }
function cls(v,g,y,o){ return v>=o?'red':v>=y?'orange':v>=g?'yellow':'green'; }
function tag(l,c){ return \`<span class="tag \${c}">\${esc(l)}</span>\`; }
function kv(l,v,c=''){ return \`<div class="kv"><span class="kv-label">\${esc(l)}</span><span class="kv-val \${c}">\${v}</span></div>\`; }

function renderDivs(t) {
  if (!t || !t.divergences || !t.divergences.length) return '<span style="color:var(--muted)">No module scores — run SCD first</span>';
  const maxGap = Math.max(...t.divergences.map(d => d.gap), 1);
  return t.divergences.map((d, i) => {
    const pct = Math.min(100, Math.round(d.gap / maxGap * 100));
    const barColor = d.cls === 'red' ? 'var(--red)' : d.cls === 'orange' ? 'var(--orange)' : d.cls === 'yellow' ? 'var(--yellow)' : 'var(--green)';
    const isPrimary = i === 0;
    return \`<div class="div-row">
      <div class="div-header">
        <span class="\${d.cls}" style="font-weight:\${isPrimary?'700':'400'}">\${esc(d.label)}\${isPrimary?' ★':''}</span>
        <span class="\${d.cls}" style="font-weight:600">\${fmt(d.gap,1)}\${esc(d.unit)}</span>
      </div>
      <div class="div-bar-bg"><div class="div-bar" style="width:\${pct}%;background:\${barColor}"></div></div>
      <div class="div-sub">\${esc(d.market)} → \${esc(d.structural)}</div>
    </div>\`;
  }).join('');
}

function renderTrigger(t) {
  if (!t) return '—';
  const fired = t.triggerFired;
  const fireColor = fired ? 'var(--red)' : 'var(--yellow)';
  const fireIcon = fired ? '🔴' : '🟡';
  const fireStatus = fired ? 'FIRED — Thesis TRIGGERED' : 'ARMED — Monitoring';
  return \`
    <div style="text-align:center;padding:8px 0;margin-bottom:10px">
      <div style="font-size:24px">\${fireIcon}</div>
      <div style="font-size:13px;font-weight:700;color:\${fireColor};margin-top:4px">\${fireStatus}</div>
    </div>
    \${kv('Trigger Condition', esc(t.triggerLabel), fired ? 'red' : 'yellow')}
    \${kv('Indicator', esc(t.triggerIndicator), 'kv-val')}
    \${kv('Threshold', fmt(t.triggerThreshold, 0) + ' (' + t.triggerDirection + ')')}
    \${kv('Target CDS', fmt(t.predictedCdsBps, 0) + ' bps')}
    \${kv('Target IDR', t.predictedUsdidr ? Math.round(t.predictedUsdidr).toLocaleString('id') : '—')}
    \${kv('Target SBN 10Y', fmt(t.predictedSbn10y, 2) + '%')}
  \`;
}

const CHAIN_META = {
  political_risk: {
    tracks: 'Social unrest, demo massa, food affordability, Prabowo approval',
    readings: 'Unemployment 4.68% | Unrest 30/30 | Demo BBM Jakarta+Makassar 12 Jun',
    fires: 'Social contract fractures → govt forced into fiscal response (subsidi, bansos)',
    lag: 'Leads financial modules by 2-3 quarters historically',
  },
  domestic_pressure: {
    tracks: 'PIHPS food basket (10 commodities), BBM subsidy gap, ICP threshold',
    readings: 'Food Stress 57/100 | BBM gap Rp3,973/L | 4 komoditas spiked',
    fires: 'Food+energy spike → CPI overshoot → BI terpaksa hike → SBN yield naik',
    lag: 'Contemporaneous signal; feeds Narrative & Regime engines',
  },
  fiscal: {
    tracks: 'APBN deficit trajectory, revenue absorption, S&P interest/revenue ratio',
    readings: 'Deficit 4.23% GDP | S&P ratio 20.4% (threshold 15%) | Overrun 179%',
    fires: 'Deficit >3% GDP (constitutional limit) → S&P negative watch → CDS repricing',
    lag: '~1-2 quarters to S&P action; deficit realization is monthly',
  },
  sovereign_risk: {
    tracks: 'CDS 5Y velocity, SBN 10Y yield, EMBI spread, foreign SBN ownership cliff',
    readings: 'CDS 97.4bps (+vel. positive) | SBN 7.29% | Term premium 1.9%',
    fires: 'CDS >150bps → S&P watch zone → panic exit → yield spiral → rollover stress',
    lag: 'CDS reprices within days; S&P action ~1 quarter after fiscal deterioration',
  },
  foreign_flow: {
    tracks: 'EIDO ETF, SBN foreign ownership %, IDX daily net sell, silent exit prob.',
    readings: 'SBN ownership 12.6% | IDX net sell −2,750bn IDR | MSCI review pending',
    fires: 'Ownership <10% → sudden stop risk | BI/bank absorption fails → yield spike',
    lag: 'DJPPR data monthly lag; EIDO = daily proxy; sudden stop = days not weeks',
  },
  fx_defense: {
    tracks: 'USDIDR spot+vol, FX reserves burn, SRBI sterilization burden, confidence gate',
    readings: 'USDIDR 17,900 | Vol 7.25% (z=3.61) | SRBI 36% of FX reserves | GG 2.27',
    fires: 'Reserves depleted by SRBI cost → Morris-Shin confidence gate tips → IDR attack',
    lag: 'Self-fulfilling once confidence breaks; no advance warning by design (2nd-gen model)',
  },
  banking: {
    tracks: 'NPL, CAR, LDR, SBN-nexus CAR erosion, fintech NPL leading indicator',
    readings: 'NPL 1.96% | CAR 25.8% | SBN nexus −0.9pp CAR | Fintech NPL 5.0% (2.5× banks)',
    fires: 'SBN yield spike → CAR erosion → NPL rise; fintech NPL = 2-3Q leading indicator',
    lag: 'Longest lag in chain — banking stress lags sovereign/FX by 2-4 quarters',
  },
};

const STATUS_LABEL = { red: 'FIRED', orange: 'ACTIVATED', yellow: 'WARMING', green: 'DORMANT' };

function renderChain(t) {
  if (!t || !t.transmissionChain) return '—';
  const fired = t.transmissionChain.filter(n => n.cls === 'red' || n.cls === 'orange').length;
  const steps = t.transmissionChain.map((n, i) => {
    const isLast = i === t.transmissionChain.length - 1;
    const meta = CHAIN_META[n.module] ?? {};
    const connCls = isLast ? '' : (t.transmissionChain[i + 1]?.cls ?? 'green');
    const tip = \`
      <div class="chain-tip">
        <div class="chain-tip-row"><div class="chain-tip-label">Tracks</div><div class="chain-tip-val">\${esc(meta.tracks ?? '—')}</div></div>
        <div class="chain-tip-row"><div class="chain-tip-label">Current readings</div><div class="chain-tip-val">\${esc(meta.readings ?? '—')}</div></div>
        <div class="chain-tip-row"><div class="chain-tip-label">Fires when</div><div class="chain-tip-val">\${esc(meta.fires ?? '—')}</div></div>
        <div class="chain-tip-row"><div class="chain-tip-label">Lag</div><div class="chain-tip-val">\${esc(meta.lag ?? '—')}</div></div>
      </div>\`;
    return \`
      <div class="chain-step">
        <div class="chain-spine">
          <div class="chain-num \${n.cls}">\${i + 1}</div>
          \${!isLast ? \`<div class="chain-connector \${connCls}"></div>\` : ''}
        </div>
        <div class="chain-body">
          <div class="chain-wrap">
            <div class="chain-row">
              <span class="chain-label \${n.cls}">\${esc(n.label)}</span>
              <span class="chain-score-badge \${n.cls}" style="background:rgba(0,0,0,.2)">\${n.score}/100</span>
              <span class="chain-status \${n.cls}">\${STATUS_LABEL[n.cls] ?? ''}</span>
            </div>
            \${tip}
          </div>
        </div>
      </div>\`;
  }).join('');
  return \`
    <div style="margin-bottom:4px;font-size:9px;color:var(--muted)">Hover tiap node untuk detail modul ↓</div>
    \${steps}
    <div style="margin-top:6px;font-size:10px;color:var(--muted)">
      \${fired}/\${t.transmissionChain.length} node aktif. Full crisis = 5+ nodes activated.
    </div>
  \`;
}

function renderTimeline(t) {
  if (!t) return '—';
  const now = new Date().toISOString().slice(0,10);
  const t3 = new Date(Date.now() + 90*864e5).toISOString().slice(0,7);
  const t6 = new Date(Date.now() + 180*864e5).toISOString().slice(0,7);
  const t12 = new Date(Date.now() + 365*864e5).toISOString().slice(0,7);
  return \`<div class="timeline">
    <div class="tl-row">
      <div class="tl-dot now"></div>
      <div class="tl-content">
        <div class="tl-label">T+0 — NOW (\${now})</div>
        <div class="tl-text">Political risk \${t.transmissionChain?.[0]?.score ?? '—'}/100 RED. Financial avg ~\${fmt(t.divergences?.[0]?.gap > 0 ? t.transmissionChain?.[0]?.score - t.divergences?.[0]?.gap : 0, 0)}/100. Crisis prob \${t.crisisProbability}%. Thesis \${t.triggerFired ? 'TRIGGERED' : 'ARMED'}.</div>
      </div>
    </div>
    <div class="tl-row">
      <div class="tl-dot future"></div>
      <div class="tl-content">
        <div class="tl-label">T+3 — Early Warning (\${t3})</div>
        <div class="tl-text">Watch: SBN foreign ownership &lt;11%, CDS &gt;130bps, IDR &gt;18,500, M10 Fiscal &gt;70/100. Any 2 of 4 = stress confirmation.</div>
      </div>
    </div>
    <div class="tl-row">
      <div class="tl-dot future"></div>
      <div class="tl-content">
        <div class="tl-label">T+6 — Stress Confirmation (\${t6})</div>
        <div class="tl-text">If fiscal deficit hits 3% GDP limit, BI forced hike cycle, EIDO −15% from entry. Transmission chain: M12→M10→M2 activated.</div>
      </div>
    </div>
    <div class="tl-row">
      <div class="tl-dot future"></div>
      <div class="tl-content">
        <div class="tl-label">T+12 — Payoff Zone (\${t12})</div>
        <div class="tl-text">Terminal: CDS \${fmt(t.predictedCdsBps,0)}bps, IDR \${t.predictedUsdidr ? Math.round(t.predictedUsdidr).toLocaleString('id') : '—'}, SBN 10Y \${fmt(t.predictedSbn10y,2)}%. Full PnL ~+25% blended portfolio.</div>
      </div>
    </div>
  </div>\`;
}

function renderKill(t, armed, snap) {
  if (!t || !t.killConditions) return '—';
  const ind = snap?.indicators ?? {};
  // Live checks — #1 from transmission chain, #3/#4 from snapshot indicators
  const polScore  = t.transmissionChain?.[0]?.score ?? 999;
  const sbnOwn    = ind['sbn_foreign_ownership_pct']?.value ?? null;
  const cds       = ind['indonesia_cds_5y_bps']?.value ?? null;
  // #4 uses current point only (sustained check done in check-thesis.ts; here = early indicator)
  const killFired = [
    polScore < 55,
    false,                              // #2: manual confirm always required
    sbnOwn != null && sbnOwn > 13,
    cds != null && cds < 100,
  ];
  const manualOnly = [false, true, false, false];
  return t.killConditions.map((k, i) => {
    const fired = killFired[i];
    const manual = manualOnly[i];
    const icon = manual ? '🔍' : fired ? '✅' : '❌';
    const color = fired ? 'var(--green)' : manual ? 'var(--yellow)' : 'var(--muted)';
    const badge = fired ? \` — <b style="color:var(--red)">KILL SWITCH FIRED</b>\`
      : manual ? \` — <span style="color:var(--yellow)">manual confirm required</span>\` : '';
    return \`<div class="kill-row">
      <span class="kill-icon">\${icon}</span>
      <span style="color:\${color}">\${esc(k)}\${badge}</span>
    </div>\`;
  }).join('') + (armed ? \`<div style="margin-top:8px;font-size:10px;color:var(--muted)">auto-kill: #1/#3/#4 via check-thesis.ts Monday 07:30 WIB. #2 = manual only.</div>\` : '');
}

function renderHaye(snap) {
  const ind = snap?.indicators ?? {};
  const brent  = ind['brent_price_usd']?.value ?? null;
  const dubai  = ind['dubai_crude_spot_usd']?.value ?? null;
  const spread = ind['brent_dubai_spread_usd']?.value ?? null;
  const msCv   = ind['narrative_ms_cv_pct']?.value ?? null;

  const L1 = 70, L2 = 80;
  const L3 = brent;
  const L4 = dubai != null ? +(dubai + 20).toFixed(1) : null;
  const maxP = Math.max(L1, L2, L3 ?? L1, L4 ?? L1, 100);
  const pct = p => p != null ? Math.min(100, Math.round(p / maxP * 100)) : 0;
  const bg  = c => c==='red'?'var(--red)':c==='orange'?'var(--orange)':c==='yellow'?'var(--yellow)':'rgba(255,255,255,.18)';

  const bCls = brent == null ? '' : brent > 100 ? 'red' : brent > 90 ? 'orange' : brent > 80 ? 'yellow' : 'green';
  const dCls = L4   == null ? '' : L4 > 120 ? 'red' : L4 > 110 ? 'orange' : L4 > 90 ? 'yellow' : 'green';
  const bGap = brent != null ? '+'+((brent-L1)/L1*100).toFixed(1)+'% vs APBN' : '';
  const dGap = L4   != null ? '+'+((L4  -L1)/L1*100).toFixed(1)+'% vs APBN' : '';
  const spCls   = spread == null ? '' : spread > 10 ? 'red' : spread > 7 ? 'orange' : spread > 3 ? 'yellow' : 'green';
  const spLabel = spread == null ? '—' : spread > 10 ? 'EXTREME' : spread > 7 ? 'HIGH' : spread > 3 ? 'ELEVATED' : 'NORMAL';
  const cvCls   = msCv == null ? '' : msCv > 25 ? 'red' : msCv > 15 ? 'orange' : msCv > 8 ? 'yellow' : 'green';
  const cvLabel = msCv == null ? '—' : msCv > 25 ? 'HIGH DISPERSION — threshold region' : msCv > 15 ? 'ELEVATED — coordination risk' : msCv > 8 ? 'MODERATE' : 'LOW';

  function brow(label, price, note, c) {
    return \`<div style="margin-bottom:5px">
      <div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px">
        <span style="color:var(--muted)">\${esc(label)}</span>
        <span class="\${c}" style="font-weight:600">\${price!=null?'$'+price.toFixed(1)+'/bbl':'—'}\${note?' <span style="color:var(--muted);font-weight:400">'+esc(note)+'</span>':''}</span>
      </div>
      <div style="height:8px;background:rgba(255,255,255,.06);border-radius:2px;overflow:hidden">
        <div style="height:100%;width:\${pct(price)}%;background:\${bg(c)};border-radius:2px"></div>
      </div>
    </div>\`;
  }

  return \`
    <div style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:6px">4-Level Belief Stack</div>
    \${brow('L1 — APBN Official', L1, null, 'green')}
    \${brow('L2 — Stale Analyst Consensus', L2, null, 'yellow')}
    \${brow('L3 — ICP Actual (Brent proxy)', L3, bGap, bCls)}
    \${brow('L4 — Pertamina Delivered (Dubai+$20)', L4, dGap, dCls)}
    <div style="margin-top:10px;font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:4px">Brent-Dubai Spread (Hormuz Proxy)</div>
    \${kv('B-D Spread', spread!=null?'$'+fmt(spread,1)+'/bbl':'—', spCls)}
    \${kv('Signal', spLabel, spCls)}
    <div style="font-size:9px;color:var(--muted);margin-bottom:8px">&lt;$3 normal · $3-7 elevated · $7-10 HIGH · &gt;$10 EXTREME</div>
    <div style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:4px">BPS HS27 O&amp;G Import Bill</div>
    \${kv('2025 Actual', '$32.77B', 'orange')}
    \${kv('APBN Implied', '$26.0B (crude-only)', 'green')}
    \${kv('Hidden BoP Gap', '+$6.77B/yr', 'red')}
    \${kv('2026 Run-Rate', '$38.8B (+49%)', 'red')}
    <div style="font-size:9px;color:var(--muted);margin-bottom:8px">APBN formula misses 72% refined+LPG. True BoP drain ~$13B/yr above APBN baseline.</div>
    <div style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:4px">Morris-Shin CV% (M6)</div>
    \${kv('CV% Dispersion', msCv!=null?fmt(msCv,1)+'%':'—', cvCls)}
    \${kv('Regime', cvLabel, cvCls)}
    <div style="font-size:9px;color:var(--muted)">High CV = low signal precision → coordination attack self-fulfilling. Sudden disclosure collapses CV → discontinuous CDS jump.</div>
  \`;
}

function renderMkt(t) {
  if (!t || !t.marketExpression) return '—';
  return \`<table class="mkt-table">
    <thead><tr><th>Instrument</th><th>Direction</th><th>Carry/Mo</th><th>Liq</th></tr></thead>
    <tbody>\${t.marketExpression.map(m => \`<tr>
      <td style="font-weight:600">\${esc(m.instrument)}</td>
      <td style="color:var(--yellow)">\${esc(m.direction)}</td>
      <td style="color:var(--muted)">\${esc(m.carry)}</td>
      <td style="color:var(--muted)">\${esc(m.liq)}</td>
    </tr>
    <tr><td colspan="4" style="font-size:9px;color:var(--muted);padding-top:0;padding-bottom:6px">\${esc(m.rationale)}</td></tr>
    \`).join('')}</tbody>
  </table>\`;
}

function renderEv(t) {
  if (!t) return '—';
  const p = t.crisisProbability; const ps = 20; const pb = Math.max(0, 100 - p - ps);
  const evColor = t.evEstimate > 0 ? 'var(--green)' : 'var(--red)';
  const be = (1.44 / (25 - 1.44) * 100).toFixed(1);
  return \`
    <div class="ev-grid">
      <div class="ev-cell">
        <div class="ev-cell-label">P(Crisis)</div>
        <div class="ev-cell-val \${p > 40 ? 'orange' : 'yellow'}">\${p}%</div>
      </div>
      <div class="ev-cell">
        <div class="ev-cell-label">P(Stress)</div>
        <div class="ev-cell-val yellow">\${ps}%</div>
      </div>
      <div class="ev-cell">
        <div class="ev-cell-label">P(Base)</div>
        <div class="ev-cell-val green">\${pb}%</div>
      </div>
      <div class="ev-cell">
        <div class="ev-cell-label">Carry/yr</div>
        <div class="ev-cell-val red">−1.44%</div>
      </div>
    </div>
    <div class="ev-total">
      <div class="ev-total-label">Expected Value</div>
      <div class="ev-total-val" style="color:\${evColor}">\${t.evEstimate > 0 ? '+' : ''}\${fmt(t.evEstimate,1)}%</div>
    </div>
    <div style="margin-top:8px;font-size:10px;color:var(--muted)">
      EV = \${pb}% × (−1.44%) + \${ps}% × (+8%) + \${p}% × (+25%)<br>
      Break-even P(crisis): \${be}% | \${p > +be ? '<span class=\\"green\\">ACTIONABLE</span>' : '<span class=\\"yellow\\">MARGINAL</span>'}
    </div>
  \`;
}

function renderAnalog(t) {
  if (!t || !t.analog) return '—';
  return \`<div class="analog-box">
    <div class="analog-name">\${esc(t.analog.name)}</div>
    <div class="analog-sim">\${esc(t.analog.similarity)}</div>
  </div>
  <div style="margin-top:8px;font-size:10px;color:var(--muted)">
    Similarity based on: political stress level, fiscal score, IDR deviation from APBN assumption.<br>
    Not a guarantee — analog informs transmission sequence, not magnitude.
  </div>\`;
}

function renderCtr(t) {
  if (!t || !t.contrarian) return '—';
  const qs = [
    { label:'Consensus believes', cls:'q1', a: t.contrarian.consensus },
    { label:'Why consensus is WRONG', cls:'q2', a: t.contrarian.whyWrong },
    { label:'Why market hasn\\'t priced this yet', cls:'q3', a: t.contrarian.whyNotPriced },
  ];
  return \`
    <blockquote class="burry-quote">
      "My edge was not that I was smarter — it was that I read the prospectus when no one else did."
      <cite>— Michael Burry, Scion Capital (2005)</cite>
    </blockquote>
    \${qs.map(q => \`<div class="ctr-block">
      <div class="ctr-q \${q.cls}">\${esc(q.label)}</div>
      <div class="ctr-a \${q.cls}">\${esc(q.a)}</div>
    </div>\`).join('')}
  \`;
}

function renderResearch() {
  const refs = [
    {
      cat: 'Primary Methodology',
      items: [
        { title: 'Michael Burry — Scion Capital Shareholder Letters', meta: '2001–2008. Source: "The Big Short" (Lewis, 2010). Methodology: read prospectus, compute structural default prob, find mis-priced CDS.', link: null },
        { title: 'Michael Lewis — The Big Short', meta: 'W.W. Norton, 2010. ISBN 978-0393072235. Narrative account of the 2005 Scion CDS trade.', link: null },
      ],
    },
    {
      cat: 'Exchange Rate & Currency Crisis',
      items: [
        { title: 'Dornbusch (1976) — Expectations and Exchange Rate Dynamics', meta: 'J. Political Economy 84(6), 1161–1176. Overshooting model — IDR post-shock reversion basis.', link: 'https://doi.org/10.1086/260580' },
        { title: 'Morris & Shin (1998) — Unique Equilibrium in Self-Fulfilling Currency Attacks', meta: 'AER 88(3), 587–597. 2nd-gen confidence gate model used in M3 FX Defense.', link: null },
        { title: 'Kaminsky, Lizondo & Reinhart (1998) — Leading Indicators of Currency Crises', meta: 'IMF Staff Papers 45(1), 1–48. KLR 21-indicator EWS — basis of klr-ews skill.', link: null },
      ],
    },
    {
      cat: 'Sovereign & Financial Crises',
      items: [
        { title: 'Reinhart & Rogoff (2009) — This Time Is Different', meta: 'Princeton UP. 8 centuries of financial folly. R-G debt dynamics (Ch.13-16), PPP (Ch.4-5), UIP carry (Ch.3) — core of R&R framework page.', link: null },
        { title: 'Kindleberger & Aliber (2011) — Manias, Panics, and Crashes', meta: 'Palgrave Macmillan, 6th ed. Minsky 5-stage cycle: displacement→boom→euphoria→distress→revulsion.', link: null },
        { title: 'Corsetti, Pesenti & Roubini (1999) — Paper Tigers? Asian Crisis Model', meta: 'European Economic Review 43(7), 1211–1236. Fundamental + self-fulfilling hybrid — basis of 1997 analog.', link: null },
      ],
    },
    {
      cat: 'Indonesia-Specific',
      items: [
        { title: 'Radelet & Sachs (1998) — The East Asian Financial Crisis', meta: 'NBER WP 6680. Sudden stop mechanism, capital flow reversal — informs M5 Foreign Flow thresholds.', link: null },
      ],
    },
  ];
  return refs.map(section => \`
    <div style="margin-bottom:10px">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:4px;padding-bottom:3px;border-bottom:1px solid var(--border)">\${esc(section.cat)}</div>
      \${section.items.map(r => \`
        <div class="research-item">
          <div class="research-title">\${r.link ? \`<a href="\${r.link}" target="_blank" rel="noopener" class="research-link">\${esc(r.title)} ↗</a>\` : esc(r.title)}</div>
          <div class="research-meta">\${esc(r.meta)}</div>
        </div>
      \`).join('')}
    </div>
  \`).join('');
}

function renderArchive(theses) {
  if (!theses || !theses.length) {
    return '<span style="color:var(--muted);font-size:11px">No archived theses yet. Arm a thesis to begin tracking.</span>';
  }
  return \`<table class="arch-table">
    <thead><tr><th>Date</th><th>Divergence</th><th>P%</th><th>EV</th><th>Status</th></tr></thead>
    <tbody>\${theses.map(t => {
      const sc = t.status === 'armed' ? 'yellow' : t.status === 'triggered' || t.status === 'confirmed' ? 'orange' : t.status === 'killed' ? '' : 'muted';
      return \`<tr>
        <td>\${t.thesisDate}</td>
        <td style="font-size:9px;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\${esc(t.primaryDivergence.replace(/_/g,' '))}</td>
        <td>\${t.crisisProbability ?? '—'}%</td>
        <td class="\${t.evEstimate > 0 ? 'green' : 'red'}">\${t.evEstimate != null ? (t.evEstimate > 0 ? '+' : '') + t.evEstimate.toFixed(1)+'%' : '—'}</td>
        <td><span class="tag \${sc}">\${t.status}</span></td>
      </tr>\`;
    }).join('')}</tbody>
  </table>\`;
}

function renderConvActions(armed) {
  const today = new Date().toISOString().slice(0,10);
  const hasArmed = armed && (armed.status === 'armed' || armed.status === 'triggered');
  return (!hasArmed
    ? \`<button class="action-btn arm" onclick="armThesis()">⚡ ARM (\${today})</button>\`
    : \`<button class="action-btn arm" onclick="armThesis()">🔄 Re-ARM</button>
       <button class="action-btn kill" onclick="killThesis(\${armed.id})">❌ KILL</button>\`
  );
}

function setMsg(txt) { const el = document.getElementById('action-msg-bar'); if (el) el.textContent = txt; }

async function armThesis() {
  setMsg('Arming…');
  try {
    const r = await fetch('/api/thesis/arm', { method:'POST' }).then(x => x.json());
    setMsg(r.ok ? 'Armed ✓ ID: ' + r.id : 'Error: ' + (r.error ?? 'unknown'));
    if (r.ok) await loadData();
  } catch (e) { setMsg('Error: ' + e.message); }
}

async function killThesis(id) {
  if (!confirm('Kill this thesis? Records kill switch fired.')) return;
  setMsg('Killing…');
  try {
    const r = await fetch('/api/thesis/kill/' + id, { method:'POST' }).then(x => x.json());
    setMsg(r.ok ? 'Killed ✓' : 'Error: ' + (r.error ?? 'unknown'));
    if (r.ok) await loadData();
  } catch (e) { setMsg('Error: ' + e.message); }
}

async function loadData() {
  try {
    const [thesis, archive, snap] = await Promise.all([
      fetch('/api/thesis/compute').then(x => x.json()),
      fetch('/api/thesis/all').then(x => x.json()),
      fetch('/api/snapshot').then(x => x.json()),
    ]);
    currentThesis = thesis;
    activeArmed = archive.find(t => t.status === 'armed' || t.status === 'triggered') ?? null;

    // Conviction bar
    const convEl = document.getElementById('conv-num');
    const convVal = thesis.conviction ?? 0;
    const convCls = convVal >= 70 ? 'var(--red)' : convVal >= 50 ? 'var(--orange)' : convVal >= 35 ? 'var(--yellow)' : 'var(--green)';
    convEl.textContent = convVal;
    convEl.style.color = convCls;

    // Thesis statement
    document.getElementById('thesis-stmt').textContent = thesis.thesisStatement ?? '—';

    // Status badge
    const badge = document.getElementById('thesis-badge');
    const trigFired = thesis.triggerFired;
    const hasArmed = activeArmed && (activeArmed.status === 'armed' || activeArmed.status === 'triggered');
    if (hasArmed && trigFired) {
      badge.className = 'thesis-status triggered'; badge.textContent = '🔴 TRIGGERED';
    } else if (hasArmed) {
      badge.className = 'thesis-status armed'; badge.textContent = '🟡 ARMED';
    } else {
      badge.className = 'thesis-status none'; badge.textContent = 'Not Armed';
    }

    // Panels
    document.getElementById('panel-divs').innerHTML = renderDivs(thesis);
    document.getElementById('panel-trigger').innerHTML = renderTrigger(thesis);
    document.getElementById('panel-chain').innerHTML = renderChain(thesis);
    document.getElementById('panel-timeline').innerHTML = renderTimeline(thesis);
    document.getElementById('panel-kill').innerHTML = renderKill(thesis, activeArmed, snap);
    document.getElementById('panel-haye').innerHTML = renderHaye(snap);
    document.getElementById('panel-mkt').innerHTML = renderMkt(thesis);
    document.getElementById('panel-ev').innerHTML = renderEv(thesis);
    document.getElementById('panel-analog').innerHTML = renderAnalog(thesis);
    document.getElementById('panel-ctr').innerHTML = renderCtr(thesis);
    document.getElementById('panel-archive').innerHTML = renderArchive(archive);
    document.getElementById('panel-research').innerHTML = renderResearch();
    document.getElementById('conv-actions').innerHTML = renderConvActions(activeArmed);

    document.getElementById('ts').textContent = 'Updated ' + new Date().toLocaleTimeString('id-ID');
  } catch (e) {
    document.getElementById('action-msg-bar').textContent = 'Load error: ' + e.message;
  }
}

loadData();
setInterval(loadData, 120_000);
</script>
</body>
</html>`;

// ── Server ────────────────────────────────────────────────────────────────────

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === '/') {
      return new Response(HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    if (url.pathname === '/rr') {
      return new Response(RR_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    if (url.pathname === '/bs') {
      return new Response(BS_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    }

    if (url.pathname === '/api/thesis/compute') {
      try {
        const snap = buildSnapshot();
        return Response.json(computeThesis(snap));
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 500 });
      }
    }

    if (url.pathname === '/api/thesis/all') {
      try {
        const theses = await getAllTheses(30);
        return Response.json(theses);
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 500 });
      }
    }

    if (url.pathname === '/api/thesis/arm' && req.method === 'POST') {
      try {
        const snap = buildSnapshot();
        const t = computeThesis(snap);
        const today = new Date().toISOString().slice(0, 10);
        const id = await saveThesis({
          thesisDate: today,
          primaryDivergence: t.primaryDivergence,
          thesisStatement: t.thesisStatement,
          triggerIndicator: t.triggerIndicator,
          triggerThreshold: t.triggerThreshold,
          triggerDirection: t.triggerDirection,
          predictedCdsBps: t.predictedCdsBps,
          predictedUsdidr: t.predictedUsdidr,
          predictedSbn10y: t.predictedSbn10y,
          crisisProbability: t.crisisProbability,
          evEstimate: t.evEstimate,
          killConditions: t.killConditions,
          status: t.triggerFired ? 'triggered' : 'armed',
          createdAt: new Date().toISOString(),
        });
        return Response.json({ ok: true, id });
      } catch (e) {
        return Response.json({ ok: false, error: String(e) }, { status: 500 });
      }
    }

    if (url.pathname.startsWith('/api/thesis/kill/') && req.method === 'POST') {
      try {
        const id = parseInt(url.pathname.slice('/api/thesis/kill/'.length));
        await updateThesisStatus(id, 'killed');
        return Response.json({ ok: true });
      } catch (e) {
        return Response.json({ ok: false, error: String(e) }, { status: 500 });
      }
    }

    if (url.pathname === '/api/snapshot') {
      try {
        return Response.json(buildSnapshot());
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 500 });
      }
    }

    if (url.pathname === '/api/charts') {
      try {
        return Response.json(buildCharts());
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 500 });
      }
    }

    if (url.pathname.startsWith('/api/series/')) {
      const indicator = url.pathname.slice('/api/series/'.length);
      const days = parseInt(url.searchParams.get('days') ?? '90');
      try {
        const db = openDb();
        const data = getSeries(db, indicator, days);
        db.close();
        return Response.json(data);
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 500 });
      }
    }

    if (url.pathname === '/api/run-scd' && req.method === 'POST') {
      if (scdState.status === 'running') {
        return Response.json({ status: 'running', message: 'SCD already running — check /api/scd-result' });
      }
      triggerScd();
      return Response.json({ status: 'running', message: 'SCD scan started (all 13 modules — takes 60-120s)' });
    }

    if (url.pathname === '/api/scd-result') {
      return Response.json(scdState);
    }

    return new Response('Not found', { status: 404 });
  },
});

console.log(`Dexter Dashboard → http://localhost:${PORT}`);
