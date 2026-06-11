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
];

const CHART_INDICATORS = [
  'usdidr_spot', 'indonesia_cds_5y_bps', 'sbn_10y_yield_pct',
  'eido_price', 'bbm_subsidy_gap_idr_liter', 'brent_price_usd',
  'bi_fx_reserves_bn', 'sbn_foreign_ownership_pct',
];

function buildSnapshot() {
  const db = openDb();
  try {
    const data = getLatest(db, SNAPSHOT_INDICATORS);
    // derived
    const sbn = data['sbn_10y_yield_pct']?.value ?? null;
    const bi = data['bi_rate_pct']?.value ?? null;
    const termPremium = sbn !== null && bi !== null ? +(sbn - bi).toFixed(2) : null;
    const cds = data['indonesia_cds_5y_bps']?.value ?? null;
    const ust = data['ust_10y_yield_pct']?.value ?? null;
    const sbnUstSpread = sbn !== null && ust !== null ? Math.round((sbn - ust) * 100) : null;
    const usdidr = data['usdidr_spot']?.value ?? null;
    const usdidrVsApbn = usdidr !== null ? +(((usdidr - 16500) / 16500) * 100).toFixed(1) : null;
    return { indicators: data, derived: { termPremium, sbnUstSpread, usdidrVsApbn, cds }, ts: new Date().toISOString() };
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
  .charts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .chart-card { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; }
  .chart-title { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin-bottom: 6px; }
  .chart-current { font-size: 16px; font-weight: 700; margin-bottom: 4px; }
  canvas { max-height: 120px; }
  .food-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 3px; }
  .scd-run-btn { margin-top: 8px; padding: 6px 14px; background: #1f2937; border: 1px solid var(--border); color: var(--text); border-radius: 4px; cursor: pointer; font-family: inherit; font-size: 11px; width: 100%; }
  .scd-run-btn:hover { background: var(--border); }
  .scd-run-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  #scd-result-panel { margin-top: 10px; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 12px; display: none; }
  #scd-result-panel pre { white-space: pre-wrap; font-size: 11px; color: var(--text); line-height: 1.5; max-height: 60vh; overflow-y: auto; }
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
      <pre id="scd-result-text"></pre>
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
  { key: 'bi_fx_reserves_bn', label: 'FX Reserves (USD bn)', color: '#3fb950', fmt: v => '$'+v.toFixed(1)+'bn' },
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
    return \`<div class="kv">\${kv(f.label, v ? f.fmt(v) : '—')}</div>\`;
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

    if (series.length > 1) {
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
            pointRadius: 0,
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
    renderCharts(charts);

    document.getElementById('last-updated').textContent = 'Updated: ' + new Date().toLocaleTimeString('id-ID');
  } catch (e) {
    document.getElementById('last-updated').textContent = 'Error: ' + e.message;
  }
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
  const text = document.getElementById('scd-result-text');

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
      text.textContent = r.result || '(no result)';
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
