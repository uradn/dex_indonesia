/**
 * Thesis Milestone Checker — T+3 / T+6 / T+12 walk-forward backtest.
 * Run: bun scripts/check-thesis.ts
 * Cron: add to daily brief or run weekly separately.
 *
 * For each armed/triggered thesis:
 *   - Checks if we're at a T+3/6/12 milestone (±5d window)
 *   - Compares actual CDS/IDR/SBN vs predicted
 *   - Auto-detects kill switch #1 (political<55 sustained 14d) and #3 (SBN own>13%)
 *   - Writes accuracy report to thesis notes
 */
import { getAllTheses, updateThesisStatus, getLatestPoint, getModuleScoreHistory } from '../src/tools/macro/time-series-db.js';

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

async function main() {
  const today = new Date();
  const allTheses = await getAllTheses(50);
  const active = allTheses.filter(t => t.status === 'armed' || t.status === 'triggered');

  if (active.length === 0) {
    console.log('No active theses to check.');
    return;
  }

  // Fetch live indicators once
  const [cdsPoint, idrPoint, sbnPoint, polScores, sbnOwnPoint] = await Promise.all([
    getLatestPoint('indonesia_cds_5y_bps'),
    getLatestPoint('usdidr_spot'),
    getLatestPoint('sbn_10y_yield_pct'),
    getModuleScoreHistory('political_risk', 20),  // macro_scores table, not macro_series
    getLatestPoint('sbn_foreign_ownership_pct'),
  ]);

  const cdsActual    = cdsPoint?.value ?? null;
  const idrActual    = idrPoint?.value ?? null;
  const sbnActual    = sbnPoint?.value ?? null;
  const sbnOwnActual = sbnOwnPoint?.value ?? null;

  // Kill switch #1: political_risk module score < 55 for last 14d
  const polLast14 = polScores.filter(p => {
    const age = (today.getTime() - new Date(p.date).getTime()) / 86400000;
    return age <= 14;
  });
  const killSwitch1Sustained = polLast14.length >= 5 && polLast14.every(p => p.score < 55);

  // Kill switch #3: SBN foreign ownership > 13%
  const killSwitch3 = sbnOwnActual != null && sbnOwnActual > 13;

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
    if (killSwitch1Sustained) {
      console.log(`  ✅ #1 FIRED: Political risk < 55 sustained 14d (${polLast14.length} readings)`);
    } else {
      const minPol = polLast14.length > 0 ? Math.min(...polLast14.map(p => p.score)) : null;
      console.log(`  ❌ #1 clear: Political risk min ${minPol?.toFixed(0) ?? '—'}/100 over last ${polLast14.length}d (need <55 sustained 14d)`);
    }
    console.log(`  ❌ #2 manual: BI coordinated package — check BI website for announcement`);
    if (killSwitch3) {
      console.log(`  ✅ #3 candidate: SBN foreign ownership ${sbnOwnActual?.toFixed(1)}% > 13% — verify MSCI confirmation`);
    } else {
      console.log(`  ❌ #3 clear: SBN foreign ownership ${sbnOwnActual?.toFixed(1) ?? '—'}% (need >13% + MSCI confirm)`);
    }

    // ── Auto-update if kill switch 1 sustained ────────────────────────────
    if (killSwitch1Sustained) {
      const note = `[AUTO-KILL ${today.toISOString().slice(0,10)}] Kill switch #1 sustained: political_risk <55 for 14d`;
      await updateThesisStatus(thesis.id!, 'killed', { notes: note });
      console.log(`\n  ⚡ Auto-killed: status updated to killed.`);
    }

    // ── Write milestone notes ────────────────────────────────────────────
    if (milestoneNotes.length > 0) {
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
