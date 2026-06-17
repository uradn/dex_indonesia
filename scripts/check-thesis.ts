/**
 * Thesis Milestone Checker — T+3 / T+6 / T+12 walk-forward backtest.
 * Run: bun scripts/check-thesis.ts
 * Cron: Monday 07:30 WIB via add-thesis-check-cron.ts
 *
 * Kill switches (auto-detect; #1/#3/#4 auto-kill; #2 candidate only):
 *   #1 — Political risk < 55 sustained 14d (social stress eased)
 *   #2 — BI coordinated stabilization package announced (Exa detect, manual confirm)
 *   #3 — SBN foreign ownership > 13% (capital return; foreign inflows reversed crisis)
 *   #4 — CDS 5Y < 100bps sustained 7d (market stopped pricing crisis; thesis invalidated)
 */
import { getAllTheses, updateThesisStatus, getLatestPoint, getLastN, getModuleScoreHistory } from '../src/tools/macro/time-series-db.js';

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

// Kill switch #2: Exa/Tavily search for BI coordinated stabilization package announcement.
// Returns { detected: true, url, headline } if found; null otherwise.
// Does NOT auto-kill — qualitative judgment call (need to verify it's a genuine package, not routine statement).
async function detectBiCoordinatedPackage(): Promise<{ headline: string; url: string | null } | null> {
  const query = 'Bank Indonesia coordinated stabilization package rupiah 2026 OR paket kebijakan BI stabilisasi nilai tukar koordinasi 2026';
  try {
    if (process.env.EXASEARCH_API_KEY) {
      const { default: Exa } = await import('exa-js');
      const exa = new Exa(process.env.EXASEARCH_API_KEY);
      const startDate = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
      const response = await exa.search(query, {
        numResults: 3,
        type: 'neural',
        startPublishedDate: startDate,
        contents: { text: { maxCharacters: 500 } },
      } as Parameters<typeof exa.search>[1]);
      for (const r of response.results ?? []) {
        const text = ((r as { text?: string }).text ?? r.title ?? '').toLowerCase();
        const isCoordinated =
          (text.includes('coordinated') || text.includes('koordinasi') || text.includes('paket kebijakan')) &&
          (text.includes('stabiliz') || text.includes('stabilisasi') || text.includes('rupiah') || text.includes('idr'));
        if (isCoordinated) {
          return { headline: r.title ?? 'BI coordinated package detected', url: r.url ?? null };
        }
      }
    }
    if (process.env.TAVILY_API_KEY) {
      const { TavilySearchAPIWrapper } = await import('@langchain/tavily');
      const tavily = new TavilySearchAPIWrapper({ tavilyApiKey: process.env.TAVILY_API_KEY });
      const response = await tavily.rawResults({
        query: 'Bank Indonesia coordinated stabilization package rupiah 2026',
        max_results: 3,
        time_range: 'month',
      } as Parameters<typeof tavily.rawResults>[0]);
      for (const r of (response.results ?? [])) {
        const text = (r.content ?? '').toLowerCase();
        const isCoordinated =
          (text.includes('coordinated') || text.includes('koordinasi') || text.includes('paket kebijakan')) &&
          (text.includes('stabiliz') || text.includes('stabilisasi') || text.includes('rupiah'));
        if (isCoordinated) {
          return { headline: r.title ?? 'BI coordinated package detected', url: r.url ?? null };
        }
      }
    }
  } catch { /* silent */ }
  return null;
}

async function main() {
  const today = new Date();
  const allTheses = await getAllTheses(50);
  const active = allTheses.filter(t => t.status === 'armed' || t.status === 'triggered');

  if (active.length === 0) {
    console.log('No active theses to check.');
    return;
  }

  // Fetch live indicators once — all in parallel
  const [cdsPoint, idrPoint, sbnPoint, polScores, sbnOwnPoint, cdsHistory, biPkg] = await Promise.all([
    getLatestPoint('indonesia_cds_5y_bps'),
    getLatestPoint('usdidr_spot'),
    getLatestPoint('sbn_10y_yield_pct'),
    getModuleScoreHistory('political_risk', 20),
    getLatestPoint('sbn_foreign_ownership_pct'),
    getLastN('indonesia_cds_5y_bps', 10),              // for KS #4 sustained CDS check
    detectBiCoordinatedPackage(),                       // KS #2 Exa/Tavily search
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

  // Kill switch #3: SBN foreign ownership > 13% — capital return, crisis narrative reversed
  const killSwitch3 = sbnOwnActual != null && sbnOwnActual > 13;

  // Kill switch #4: CDS < 100bps sustained 7d — market stopped pricing crisis; thesis invalidated
  const cdsLast7 = cdsHistory.filter(p => {
    const age = (today.getTime() - new Date(p.date).getTime()) / 86400000;
    return age <= 7;
  });
  const killSwitch4 = cdsLast7.length >= 3 && cdsLast7.every(p => p.value < 100);

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

    // #2 — BI coordinated package (Exa-detected, manual confirm)
    if (biPkg !== null) {
      console.log(`  ⚠️  #2 CANDIDATE: BI coordinated package detected — MANUAL CONFIRM required before killing`);
      console.log(`     Headline: "${biPkg.headline.slice(0, 120)}"`);
      if (biPkg.url) console.log(`     Source: ${biPkg.url}`);
    } else {
      console.log(`  ❌ #2 clear: No BI coordinated stabilization package found in news (last 30d)`);
    }

    // #3 — SBN foreign ownership return
    if (killSwitch3) {
      console.log(`  ✅ #3 FIRED: SBN foreign ownership ${sbnOwnActual?.toFixed(1)}% > 13% → capital return confirmed, auto-killing`);
    } else {
      console.log(`  ❌ #3 clear: SBN foreign ownership ${sbnOwnActual?.toFixed(1) ?? '—'}% (need >13% for capital return signal)`);
    }

    // #4 — CDS below 100bps sustained (thesis invalidated)
    if (killSwitch4) {
      console.log(`  ✅ #4 FIRED: CDS 5Y < 100bps sustained 7d (${cdsLast7.length} readings, min ${Math.min(...cdsLast7.map(p=>p.value)).toFixed(0)}bps) → market no longer pricing crisis, auto-killing`);
    } else {
      const cdsMin7 = cdsLast7.length > 0 ? Math.min(...cdsLast7.map(p => p.value)) : null;
      console.log(`  ❌ #4 clear: CDS min ${cdsMin7?.toFixed(0) ?? '—'}bps last 7d (need <100bps sustained 7d)`);
    }

    // ── Auto-kill logic ───────────────────────────────────────────────────
    const autoKillFired = killSwitch1Sustained || killSwitch3 || killSwitch4;
    if (autoKillFired && (thesis.status === 'armed' || thesis.status === 'triggered')) {
      const reasons = [
        killSwitch1Sustained ? `KS#1 political_risk<55 sustained 14d` : '',
        killSwitch3 ? `KS#3 SBN own ${sbnOwnActual?.toFixed(1)}%>13%` : '',
        killSwitch4 ? `KS#4 CDS<100bps sustained 7d` : '',
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
