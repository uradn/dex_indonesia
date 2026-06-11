/**
 * Dexter Macro Dashboard — localhost:6080
 * Bun HTTP server reading directly from .dexter/macro/macro.db
 * Run: bun scripts/dashboard.ts
 */
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { silentCrisisDetector } from '../src/tools/macro/silent-crisis-detector.ts';

const DB_PATH = join(import.meta.dir, '../.dexter/macro/macro.db');
const PORT = 6080;

// ── SCD on-demand state ───────────────────────────────────────────────────────

type ScdStatus = 'idle' | 'running' | 'done' | 'error';
let scdState: { status: ScdStatus; result?: string; error?: string; startedAt?: string; completedAt?: string } = { status: 'idle' };

function triggerScd(): void {
  if (scdState.status === 'running') return;
  scdState = { status: 'running', startedAt: new Date().toISOString() };
  (silentCrisisDetector as any).invoke({ query: 'full silent crisis scan' })
    .then((result: string) => {
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
  'brent_price_usd', 'bbm_subsidy_gap_idr_liter', 'bbm_cost_recovery_idr_liter',
  'pertalite_price_idr_liter', 'bi_fx_reserves_bn', 'trade_balance_bn',
  'bank_npl_gross_pct', 'bank_car_pct', 'bank_ldr_pct', 'indonia_3m_pct',
  'unemployment_rate_pct', 'inflation_cpi_pct', 'gdp_growth_pct',
  'greenspan_guidotti', 'uln_dsr_pct', 'uln_gdp_ratio_pct',
  'pihps_beras_medium_idr', 'pihps_cabai_rawit_merah_idr', 'pihps_cabai_merah_kriting_idr',
  'pihps_bawang_merah_idr', 'pihps_minyak_goreng_idr', 'pihps_telur_ayam_idr',
  'pihps_daging_sapi_idr', 'pihps_gula_pasir_idr',
  'nickel_price_usd', 'coal_etf_usd', 'cpo_price_myr', 'gold_price_usd',
  'fintech_npl_pct', 'ihsg_pe_ratio', 'idx_advance_decline_ratio',
  // political risk
  'political_social_unrest_score', 'political_food_stress_score', 'political_stability_stress_score',
  // asean fx (IDR + 5 peers)
  'usdmyr_spot', 'usdsgd_spot', 'usdthb_spot', 'usdphp_spot', 'usdvnd_spot',
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
    return { indicators: data, derived: { termPremium, sbnUstSpread, usdidrVsApbn, cds }, aseanFx, envFlags, ts: new Date().toISOString() };
  } finally {
    db.close();
  }
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
  const brent = ind['brent_price_usd']?.value;
  const gap = ind['bbm_subsidy_gap_idr_liter']?.value;
  const cr = ind['bbm_cost_recovery_idr_liter']?.value;
  const reserves = ind['bi_fx_reserves_bn']?.value;
  const trade = ind['trade_balance_bn']?.value;
  const gg = ind['greenspan_guidotti']?.value;
  const dsr = ind['uln_dsr_pct']?.value;

  return [
    kv('Brent', brent ? '$' + fmtNum(brent, 1) + '/bbl' : '—', brent > 100 ? 'red' : brent > 90 ? 'orange' : brent > 80 ? 'yellow' : 'green'),
    kv('BBM Subsidy Gap', gap ? 'Rp' + fmtK(gap) + '/L' : '—', gap > 7000 ? 'red' : gap > 4000 ? 'orange' : gap > 2000 ? 'yellow' : 'green'),
    kv('Cost Recovery', cr ? 'Rp' + fmtK(cr) + '/L' : '—'),
    kv('FX Reserves', reserves ? '$' + fmtNum(reserves, 1) + 'bn' : '—', reserves < 100 ? 'red' : reserves < 120 ? 'orange' : reserves < 130 ? 'yellow' : 'green'),
    kv('Trade Balance', trade != null ? (trade > 0 ? '+' : '') + fmtNum(trade, 1) + 'bn' : '—', trade < -5 ? 'red' : trade < 0 ? 'orange' : 'green'),
    kv('G-G Ratio', gg ? fmtNum(gg, 2) + 'x' : '—', gg < 1.0 ? 'red' : gg < 1.5 ? 'orange' : gg < 2.0 ? 'yellow' : 'green'),
    kv('ULN DSR', dsr ? fmtNum(dsr, 1) + '%' : '—', dsr > 30 ? 'red' : dsr > 25 ? 'orange' : dsr > 20 ? 'yellow' : 'green'),
  ].join('');
}

function renderBanking(d) {
  const ind = d.indicators;
  const npl = ind['bank_npl_gross_pct']?.value;
  const car = ind['bank_car_pct']?.value;
  const ldr = ind['bank_ldr_pct']?.value;
  const indonia = ind['indonia_3m_pct']?.value;
  const fintechNpl = ind['fintech_npl_pct']?.value;
  const pe = ind['ihsg_pe_ratio']?.value;
  const ad = ind['idx_advance_decline_ratio']?.value;

  return [
    kv('NPL Gross', npl ? fmtNum(npl, 2) + '%' : '—', npl > 5 ? 'red' : npl > 3 ? 'orange' : npl > 2 ? 'yellow' : 'green'),
    kv('CAR', car ? fmtNum(car, 1) + '%' : '—', car < 14 ? 'red' : car < 16 ? 'orange' : car < 18 ? 'yellow' : 'green'),
    kv('LDR', ldr ? fmtNum(ldr, 1) + '%' : '—', ldr > 92 ? 'red' : ldr > 85 ? 'orange' : ldr > 78 ? 'yellow' : 'green'),
    kv('IndONIA 3M', indonia ? fmtNum(indonia, 2) + '%' : '—'),
    kv('Fintech NPL', fintechNpl ? fmtNum(fintechNpl, 1) + '%' : '—', fintechNpl > 5 ? 'orange' : fintechNpl > 3 ? 'yellow' : 'green'),
    kv('IHSG P/E (EIDO)', pe ? fmtNum(pe, 1) + 'x' : '—', pe > 12 ? 'orange' : pe > 10 ? 'yellow' : ''),
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
  items.push({ label: 'Labor market deteriorating', active: unemp != null && unemp > 5.5 });

  const npl = ind['bank_npl_gross_pct']?.value;
  items.push({ label: 'Credit stress building', active: npl != null && npl > 3.0 });

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
      <span>\${item.label}</span>
      <span class="\${item.active ? 'red' : 'green'}">\${item.active ? '▲ YES' : '○ no'}</span>
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

function renderScd(d) {
  const score = computeScdProxy(d);
  const el = document.getElementById('scd-score');
  const alertEl = document.getElementById('scd-alert');
  if (score == null) { el.textContent = '?'; return; }
  el.textContent = score + '%';
  const cls = score >= 70 ? 'red' : score >= 50 ? 'orange' : score >= 33 ? 'yellow' : 'green';
  el.className = 'scd-number ' + cls;
  const label = score >= 70 ? '🔴 RED — CRISIS RISK' : score >= 50 ? '🟠 ORANGE — ELEVATED' : score >= 33 ? '🟡 YELLOW — WATCH' : '🟢 GREEN — NORMAL';
  alertEl.innerHTML = \`<span class="tag \${cls}">\${label}</span>\`;
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

  // composite score
  const scores = [unrest, food, stab ? (100 - stab) : null].filter(x => x !== null);
  const composite = scores.length ? Math.round(scores.reduce((a,b)=>a+b,0)/scores.length) : null;

  const scoreEl = document.getElementById('polrisk-score');
  const labelEl = document.getElementById('polrisk-label');
  if (composite !== null) {
    scoreEl.textContent = composite.toString();
    const cls = composite >= 70 ? 'red' : composite >= 50 ? 'orange' : composite >= 33 ? 'yellow' : 'green';
    scoreEl.className = 'doom-score ' + cls;
    const lbl = composite >= 70 ? 'HIGH RISK' : composite >= 50 ? 'Elevated' : composite >= 33 ? 'Watch' : 'Stable';
    labelEl.innerHTML = \`<span class="tag \${cls}">\${lbl}</span>\`;
  } else {
    scoreEl.textContent = '?';
  }

  const unempDate = ind['unemployment_rate_pct']?.date ?? null;
  const unrestDate = ind['political_social_unrest_score']?.date ?? null;

  // 1998 template conditions
  // Thresholds: unemployment >4.8% (CLAUDE.md normal=4.8%); social unrest >33 (system YELLOW)
  const t98 = [
    { label: 'Food unaffordable',         detail: gap != null ? 'gap Rp'+Math.round(gap).toLocaleString('id')+'/L' : food != null ? 'score '+food : '',    active: (food ?? 0) > 50 || (gap ?? 0) > 4000 },
    { label: 'IDR lemah (>17,000)',        detail: usdidr != null ? fmtK(usdidr) : '',                                                                        active: (usdidr ?? 0) > 17000 },
    { label: 'Unemployment naik (>4.8%)', detail: unemp != null ? fmtNum(unemp,2)+'% ['+(unempDate ?? 'n/a')+']' : 'n/a — BPS quarterly',                    active: (unemp ?? 0) > 4.8 },
    { label: 'Social unrest elevated',    detail: unrest != null ? 'score '+unrest+'/100 ['+(unrestDate ? unrestDate.slice(5) : 'n/a')+']' : 'n/a',           active: (unrest ?? 0) > 33 },
    { label: 'Political stability stress', detail: stab != null ? 'stab '+stab+'/100' : 'n/a',                                                                active: stab !== null && stab < 50 },
  ];
  const t98score = t98.filter(x => x.active).length;
  const t98cls = t98score >= 4 ? 'red' : t98score >= 3 ? 'orange' : t98score >= 2 ? 'yellow' : 'green';
  document.getElementById('template98-score').className = t98cls;
  document.getElementById('template98-score').textContent = t98score.toString();

  const scoreRows = [
    { label: 'Social Unrest', val: unrest, inverse: false },
    { label: 'Food Stress',   val: food,   inverse: false },
    { label: 'Stability',     val: stab,   inverse: true },
  ].map(({ label, val, inverse }) => {
    if (val === null) return \`<div class="bar-row"><span class="bar-label">\${label}</span><span style="color:var(--muted)">n/a</span></div>\`;
    const displayVal = inverse ? 100 - val : val;
    const cls = displayVal >= 70 ? 'red' : displayVal >= 50 ? 'orange' : displayVal >= 33 ? 'yellow' : 'green';
    const color = displayVal >= 70 ? 'var(--red)' : displayVal >= 50 ? 'var(--orange)' : displayVal >= 33 ? 'var(--yellow)' : 'var(--green)';
    return \`<div class="bar-row">
      <span class="bar-label">\${label}</span>
      <div class="bar-track"><div class="bar-fill" style="width:\${displayVal}%;background:\${color}"></div></div>
      <span class="bar-val \${cls}">\${displayVal}/100</span>
    </div>\`;
  }).join('');

  const t98rows = t98.map(item =>
    \`<div class="template98-item">
      <span style="flex:1">\${item.label}</span>
      <span style="color:var(--muted);font-size:9px;flex:1;text-align:center;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">\${item.detail}</span>
      <span class="\${item.active ? 'red' : 'green'}" style="flex:0 0 42px;text-align:right">\${item.active ? '▲ YES' : '○ no'}</span>
    </div>\`
  ).join('');

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

  // FX Drivers — global forces driving ASEAN FX
  const ind = d.indicators;
  const dxy   = ind['dxy_index']?.value ?? null;
  const vix   = ind['vix_level']?.value ?? null;
  const spr   = d.derived?.sbnUstSpread ?? null;
  const gap   = d.derived?.usdidrVsApbn ?? null;
  const bi    = ind['bi_rate_pct']?.value ?? null;
  const ust   = ind['ust_10y_yield_pct']?.value ?? null;
  const carry = bi !== null && ust !== null ? +(bi - ust).toFixed(2) : null;

  const fxDrivers = \`
    <div style="margin-top:8px;border-top:1px solid var(--border);padding-top:8px">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:6px">FX Drivers</div>
      \${kv('DXY Index',       dxy   ? fmtNum(dxy,1)       : '—', dxy > 108 ? 'orange' : dxy > 104 ? 'yellow' : 'green')}
      \${kv('VIX',             vix   ? fmtNum(vix,1)       : '—', vix > 35 ? 'red' : vix > 25 ? 'orange' : vix > 20 ? 'yellow' : 'green')}
      \${kv('SBN-UST Spread',  spr   != null ? spr+'bps'  : '—', spr < 200 ? 'red' : spr < 250 ? 'orange' : '')}
      \${kv('IDR vs APBN 16.5k', gap != null ? (gap > 0 ? '+' : '')+gap+'%' : '—', gap > 9 ? 'orange' : gap > 6 ? 'yellow' : 'green')}
      \${kv('Carry (BI−UST)',  carry != null ? (carry > 0 ? '+' : '')+fmtNum(carry,2)+'%' : '—', carry < 0.5 ? 'red' : carry < 1.0 ? 'orange' : carry < 1.5 ? 'yellow' : 'green')}
      \${kv('BI Rate',         bi    ? fmtNum(bi,2)+'%'   : '—')}
      \${kv('UST 10Y',         ust   ? fmtNum(ust,2)+'%'  : '—')}
    </div>
  \`;

  return summaryHtml + bars + narrativeHtml + fxDrivers;
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

// ── Server ────────────────────────────────────────────────────────────────────

const server = Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === '/') {
      return new Response(HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
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
