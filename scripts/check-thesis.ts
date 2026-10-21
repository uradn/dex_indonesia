/**
 * Thesis Milestone Checker — T+3 / T+6 / T+12 walk-forward backtest.
 * Run: bun scripts/check-thesis.ts
 * Cron: Monday 07:30 WIB via add-thesis-check-cron.ts
 *
 * Kill switches (auto-detect; #1/#3/#4 auto-kill; #2 candidate only):
 *   #1 — Political risk < 55 sustained 14d (social stress eased)
 *   #2 — BI coordinated stabilization package announced (Exa detect, manual confirm)
 *   #3 — SBN foreign ownership > 15% (capital return; foreign inflows reversed crisis)
 *   #4 — CDS 5Y < 75bps sustained 7d + ALL 3 credit signals must confirm (thesis invalidated)
 */
import { getAllTheses, updateThesisStatus, getLatestPoint, getLastN, getModuleScoreHistory, getHistory } from '../src/tools/macro/time-series-db.js';
import { fetchPolicyResponse } from '../src/tools/macro/sources/policy-response.js';

const MILESTONES = [
  { days: 90,  label: 'T+3' },
  { days: 180, label: 'T+6' },
  { days: 365, label: 'T+12' },
];
const WINDOW = 5; // ±5 days counts as "at milestone"
const BAR = '─'.repeat(50);

function pctDiff(actual: number, predicted: number): string {
  const d = ((actual - predicted) / predicted * 100).toFixed(1);
  return (parseFloat(d) > 0 ? '+' : '') + d + '%';
}

// Kill switch #2 detection is now handled by sources/policy-response.ts (fetchPolicyResponse).
// Classification: none | isolated_instrument | partial_coordination | full_package.
// Does NOT auto-kill — manual confirm required for all levels (qualitative judgment call).

async function main() {
  const today = new Date();
  const allTheses = await getAllTheses(50);
  const active = allTheses.filter(t => t.status === 'armed' || t.status === 'triggered');

  if (active.length === 0) {
    console.log('No active theses to check.');
    return;
  }

  // Fetch live indicators once — all in parallel
  const [cdsPoint, idrPoint, sbnPoint, ustPoint, polScores, sbnOwnPoint, cdsHistory, idrHistory, policyResp] = await Promise.all([
    getLatestPoint('indonesia_cds_5y_bps'),
    getLatestPoint('usdidr_spot'),
    getLatestPoint('sbn_10y_yield_pct'),
    getLatestPoint('ust_10y_yield_pct'),
    getModuleScoreHistory('political_risk', 20),
    getLatestPoint('sbn_foreign_ownership_pct'),
    getLastN('indonesia_cds_5y_bps', 10),              // for KS #4 sustained CDS check
    getHistory('usdidr_spot', 45),                     // for KS #4 IDR 30d realized vol
    fetchPolicyResponse(),                             // KS #2 — 4-instrument coordination scan
  ]);

  const cdsActual    = cdsPoint?.value ?? null;
  const idrActual    = idrPoint?.value ?? null;
  const sbnActual    = sbnPoint?.value ?? null;
  const ustActual    = ustPoint?.value ?? null;
  const sbnOwnActual = sbnOwnPoint?.value ?? null;

  // Kill switch #1: political_risk module score < 55 for last 14d
  const polLast14 = polScores.filter(p => {
    const age = (today.getTime() - new Date(p.date).getTime()) / 86400000;
    return age <= 14;
  });
  const killSwitch1Sustained = polLast14.length >= 5 && polLast14.every(p => p.score < 55);

  // Kill switch #3: SBN foreign ownership > 15% — meaningful capital return, crisis narrative reversed
  const killSwitch3 = sbnOwnActual != null && sbnOwnActual > 15;

  // Kill switch #4: 3-signal WEIGHTED credit-market benign check. Kill fires only when
  // majority-weight of independent markets confirm "not pricing crisis". Prevents single-source
  // manipulation (thin CDS or intervention-pinned spot) from wrongly invalidating thesis.
  //
  // Signals (weights reflect information quality):
  //   s1 — CDS 5Y persist < 75bps (last 3 consecutive readings, latest ≤10d fresh)   w=1
  //   s2 — SBN-UST 10Y spread < 366bps (below historical pre-crisis quiet-zone median) w=2
  //   s3 — IDR realized vol 30d ann < 5% (below 2018 EM quiet baseline)               w=3
  // Kill fires if sum(weights_passed) > 3 (of 6 max). Equivalent to: any 2 of {s2, s3}
  // OR all three. Prevents kill on CDS+SBN benign only (both distortable by intervention).
  const CDS_KILL_THRESHOLD_BPS = 75;
  const CDS_MAX_AGE_DAYS = 10;
  const SBN_SPREAD_THRESHOLD_BPS = 366;   // calibrated: 80% × median-of-p75 across 6 crises (real UST fix applied)
  const IDR_VOL_THRESHOLD_PCT = 5;         // calibrated: below 2018 EM quiet-zone p75 (3.47%) buffered

  // s1 — CDS
  const cdsSorted = [...cdsHistory].sort((a, b) => b.date.localeCompare(a.date));
  const latest3 = cdsSorted.slice(0, 3);
  const latestAgeDays = latest3.length > 0
    ? (today.getTime() - new Date(latest3[0].date).getTime()) / 86400000
    : Infinity;
  const cdsDataFresh = latestAgeDays <= CDS_MAX_AGE_DAYS;
  const cdsPersistBelow = latest3.length >= 3 && latest3.every(p => p.value < CDS_KILL_THRESHOLD_BPS);
  const s1_cdsPass = cdsPersistBelow && cdsDataFresh;
  const cdsUncomputable = !cdsDataFresh || latest3.length < 3;

  // s2 — SBN-UST spread
  const sbnUstSpreadBps = (sbnActual != null && ustActual != null)
    ? (sbnActual - ustActual) * 100
    : null;
  const s2_spreadPass = sbnUstSpreadBps != null && sbnUstSpreadBps < SBN_SPREAD_THRESHOLD_BPS;

  // s3 — IDR realized vol 30d annualized
  const idrSorted = [...idrHistory].sort((a, b) => a.date.localeCompare(b.date));
  let idrVol30dAnn: number | null = null;
  if (idrSorted.length >= 30) {
    const rets: number[] = [];
    for (let i = 1; i < idrSorted.length; i++) {
      rets.push(Math.log(idrSorted[i].value / idrSorted[i - 1].value));
    }
    const last30 = rets.slice(-30);
    const mean = last30.reduce((s, r) => s + r, 0) / last30.length;
    const variance = last30.reduce((s, r) => s + (r - mean) ** 2, 0) / (last30.length - 1);
    idrVol30dAnn = Math.sqrt(variance) * Math.sqrt(252) * 100;
  }
  const s3_volPass = idrVol30dAnn != null && idrVol30dAnn < IDR_VOL_THRESHOLD_PCT;

  const ks4Weight = (s1_cdsPass ? 1 : 0) + (s2_spreadPass ? 2 : 0) + (s3_volPass ? 3 : 0);
  const killSwitch4 = ks4Weight >= 6; // all 3 signals must confirm benign (prevents s2+s3 alone killing)

  console.log(`\n## Thesis Milestone Check — ${today.toISOString().slice(0, 10)}`);
  console.log(`Active theses: ${active.length}\n`);

  for (const thesis of active) {
    const createdAt = new Date(thesis.createdAt);
    const daysSince = Math.round((today.getTime() - createdAt.getTime()) / 86400000);
    console.log(`${BAR}`);
    console.log(`Thesis ID ${thesis.id} — ${thesis.thesisDate} [${thesis.status.toUpperCase()}] (${daysSince}d since creation)`);
    console.log(`Divergence: ${thesis.primaryDivergence.replace(/_/g,' ')}`);
    console.log(`EV: ${thesis.evEstimate != null ? (thesis.evEstimate > 0 ? '+' : '') + thesis.evEstimate.toFixed(1) + '%' : '—'} | P(crisis): ${thesis.crisisProbability ?? '—'}%`);

    // ── Milestone check ───────────────────────────────────────────────────
    const milestoneNotes: string[] = [];
    for (const ms of MILESTONES) {
      const diff = Math.abs(daysSince - ms.days);
      if (diff <= WINDOW) {
        console.log(`\n  ★ AT MILESTONE: ${ms.label} (${daysSince}d)`);
        const lines: string[] = [`[${ms.label} check ${today.toISOString().slice(0,10)}]`];

        if (cdsActual != null && thesis.predictedCdsBps != null) {
          const acc = pctDiff(cdsActual, thesis.predictedCdsBps);
          const status = Math.abs(cdsActual - thesis.predictedCdsBps) < thesis.predictedCdsBps * 0.15 ? 'ON TRACK' : cdsActual > thesis.predictedCdsBps ? 'EXCEEDED' : 'BELOW';
          console.log(`  CDS actual ${cdsActual.toFixed(0)}bps vs predicted ${thesis.predictedCdsBps}bps (${acc}) → ${status}`);
          lines.push(`CDS: actual=${cdsActual.toFixed(0)} pred=${thesis.predictedCdsBps} diff=${acc} ${status}`);
        }
        if (idrActual != null && thesis.predictedUsdidr != null) {
          const acc = pctDiff(idrActual, thesis.predictedUsdidr);
          const status = idrActual >= thesis.predictedUsdidr * 0.9 ? 'ON TRACK' : 'BELOW TARGET';
          console.log(`  IDR actual ${Math.round(idrActual).toLocaleString('id')} vs predicted ${Math.round(thesis.predictedUsdidr).toLocaleString('id')} (${acc}) → ${status}`);
          lines.push(`IDR: actual=${Math.round(idrActual)} pred=${Math.round(thesis.predictedUsdidr)} diff=${acc} ${status}`);
        }
        if (sbnActual != null && thesis.predictedSbn10y != null) {
          const acc = pctDiff(sbnActual, thesis.predictedSbn10y);
          const status = sbnActual >= thesis.predictedSbn10y * 0.9 ? 'ON TRACK' : 'BELOW TARGET';
          console.log(`  SBN 10Y actual ${sbnActual.toFixed(2)}% vs predicted ${thesis.predictedSbn10y.toFixed(2)}% (${acc}) → ${status}`);
          lines.push(`SBN: actual=${sbnActual.toFixed(2)} pred=${thesis.predictedSbn10y.toFixed(2)} diff=${acc} ${status}`);
        }

        milestoneNotes.push(lines.join(' | '));
      }
    }

    // ── Kill switch checks ────────────────────────────────────────────────
    console.log(`\n  Kill Switches:`);

    // #1 — political risk
    if (killSwitch1Sustained) {
      console.log(`  ✅ #1 FIRED: Political risk < 55 sustained 14d (${polLast14.length} readings) → auto-killing`);
    } else {
      const minPol = polLast14.length > 0 ? Math.min(...polLast14.map(p => p.score)) : null;
      console.log(`  ❌ #1 clear: Political risk min ${minPol?.toFixed(0) ?? '—'}/100 over last ${polLast14.length}d (need <55 sustained 14d)`);
    }

    // #2 — BI coordinated package (policy-response.ts 4-instrument scan, manual confirm)
    // Structural constraint: post-MSCI Standalone consultation (Oct 15 2026), mandate-driven outflow
    // is compliance execution, not speculative attack. BI rate/FX intervention cannot halt it.
    // KS#2 effectiveness severely limited until Jun 30 2027 MSCI decision.
    const msciStandalone = (await getLatestPoint('msci_classification_numeric'))?.value === 2;
    const prLevel = policyResp.level;
    const prSignals = policyResp.signals;
    if (prLevel === 'full_package') {
      const instruments = prSignals.map(s => s.instrument).join('+');
      const windowStr = policyResp.coordinationWindowHours != null ? `${policyResp.coordinationWindowHours.toFixed(0)}h` : '<72h';
      console.log(`  ⚠️  #2 CANDIDATE [FULL PACKAGE]: ${instruments} in ${windowStr} — MANUAL CONFIRM required before killing`);
      prSignals.forEach(s => console.log(`     [${s.instrument}] "${s.headline.slice(0, 100)}" (${s.publishedAt})`));
      if (msciStandalone) {
        console.log(`     ⚠️  MSCI STANDALONE CONSTRAINT: mandate-exit selling = compliance execution, not speculative attack. BI package cannot sterilize it. KS#2 ineffective until Jun 30 2027. Manual confirm must address forced-sell mechanism.`);
      }
    } else if (prLevel === 'partial_coordination') {
      const instruments = prSignals.map(s => s.instrument).join('+');
      console.log(`  ⚠️  #2 PARTIAL: ${instruments} detected (${prSignals.length}/4 instruments) — insufficient for kill; monitor for escalation to full_package`);
      prSignals.forEach(s => console.log(`     [${s.instrument}] "${s.headline.slice(0, 100)}"`));
    } else if (prLevel === 'isolated_instrument' && prSignals.length > 0) {
      console.log(`  ❌ #2 clear [isolated]: ${prSignals[0]!.instrument} only — routine BI ops, not coordinated package`);
    } else {
      console.log(`  ❌ #2 clear: No policy coordination signals detected (last 5d, 4 instruments: dndf/bei_buyback/alco/danantara)`);
      if (msciStandalone) {
        console.log(`     ℹ️  MSCI Standalone active — BI rate/FX intervention cannot stop mandate-exit selling. KS#2 baseline effectiveness: LOW.`);
      }
    }

    // #3 — SBN foreign ownership return
    if (killSwitch3) {
      console.log(`  ✅ #3 FIRED: SBN foreign ownership ${sbnOwnActual?.toFixed(1)}% > 15% → capital return confirmed, auto-killing`);
    } else {
      console.log(`  ❌ #3 clear: SBN foreign ownership ${sbnOwnActual?.toFixed(1) ?? '—'}% (need >15% for capital return signal)`);
    }

    // #4 — 3-signal weighted market-benign check (thesis invalidated only when majority-weight confirms)
    const s1Mark = s1_cdsPass ? '✓' : (cdsUncomputable ? '?' : '✗');
    const s2Mark = s2_spreadPass ? '✓' : (sbnUstSpreadBps == null ? '?' : '✗');
    const s3Mark = s3_volPass ? '✓' : (idrVol30dAnn == null ? '?' : '✗');
    const cdsMinStr = latest3.length > 0 ? Math.min(...latest3.map(p => p.value)).toFixed(0) : '—';
    const spreadStr = sbnUstSpreadBps?.toFixed(0) ?? '—';
    const volStr = idrVol30dAnn?.toFixed(1) ?? '—';
    console.log(`  ${killSwitch4 ? '✅ #4 FIRED' : '❌ #4 clear'} weighted=${ks4Weight}/6 (need 6/6 — all signals must confirm)`);
    console.log(`      s1 CDS<${CDS_KILL_THRESHOLD_BPS}bps persist [w=1]     ${s1Mark}  latest3 min=${cdsMinStr}bps age=${latestAgeDays.toFixed(0)}d`);
    console.log(`      s2 SBN-UST<${SBN_SPREAD_THRESHOLD_BPS}bps         [w=2]     ${s2Mark}  current=${spreadStr}bps`);
    console.log(`      s3 IDR vol30d<${IDR_VOL_THRESHOLD_PCT}%           [w=3]     ${s3Mark}  current=${volStr}%`);

    // ── Auto-kill logic ───────────────────────────────────────────────────
    const autoKillFired = killSwitch1Sustained || killSwitch3 || killSwitch4;
    if (autoKillFired && (thesis.status === 'armed' || thesis.status === 'triggered')) {
      const reasons = [
        killSwitch1Sustained ? `KS#1 political_risk<55 sustained 14d` : '',
        killSwitch3 ? `KS#3 SBN own ${sbnOwnActual?.toFixed(1)}%>15%` : '',
        killSwitch4 ? `KS#4 credit-market benign weighted=${ks4Weight}/6 (CDS ${latest3[0]?.value.toFixed(0)}bps, SBN-UST ${sbnUstSpreadBps?.toFixed(0)}bps, IDR vol ${idrVol30dAnn?.toFixed(1)}%)` : '',
      ].filter(Boolean).join(' | ');
      const note = `[AUTO-KILL ${today.toISOString().slice(0,10)}] ${reasons}`;
      await updateThesisStatus(thesis.id!, 'killed', { notes: note });
      console.log(`\n  ⚡ Auto-killed: status updated to killed. Reason: ${reasons}`);
    }

    // ── Write milestone notes ────────────────────────────────────────────
    if (milestoneNotes.length > 0 && !autoKillFired) {
      await updateThesisStatus(thesis.id!, thesis.status, {
        notes: milestoneNotes.join('\n'),
        ...(cdsActual != null ? { actualCdsBps: cdsActual } : {}),
        ...(idrActual != null ? { actualUsdidr: idrActual } : {}),
        ...(sbnActual != null ? { actualSbn10y: sbnActual } : {}),
      });
      console.log(`\n  ✓ Milestone notes saved to DB.`);
    }
  }

  console.log(`\n${BAR}`);
  console.log('Check complete.');
}

main().catch(console.error);
