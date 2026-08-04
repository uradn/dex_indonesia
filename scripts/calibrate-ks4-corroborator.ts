/**
 * Calibrate kill switch #4 corroborator thresholds:
 *   - SBN-UST 10Y spread (bps)
 *   - IDR realized vol 30d annualized (%)
 *
 * Method: for each of 6 historical crises, measure the quiet-zone (pre-crisis
 * 180d–90d window) baseline for both indicators. Corroborator threshold =
 * upper bound of quiet zone. If current market > threshold, thesis kill is
 * unwarranted (crisis IS being priced by these markets, even if CDS is not).
 */
import { fetchFullHistory } from '../src/tools/macro/backtest/historical-loader.ts';
import { fetchSbn10yHistoricalWgb } from '../src/tools/macro/sources/sovereign-scraper.ts';

const CRISES = [
  { id: 'taper_tantrum_2013',   start: '2013-05-22' },
  { id: 'china_devaluation_2015', start: '2015-08-11' },
  { id: 'em_selloff_2018',      start: '2018-05-01' },
  { id: 'covid_crash_2020',     start: '2020-02-24' },
  { id: 'fed_tightening_2022',  start: '2022-03-16' },
  { id: 'dollar_surge_2023',    start: '2023-07-01' },
];

function daysBefore(dateStr: string, n: number): string {
  const t = new Date(dateStr).getTime() - n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

function computeRealizedVol30d(bars: { date: string; close: number }[]): { date: string; volAnnPct: number }[] {
  const rets: { date: string; ret: number }[] = [];
  for (let i = 1; i < bars.length; i++) {
    rets.push({ date: bars[i].date, ret: Math.log(bars[i].close / bars[i - 1].close) });
  }
  const out: { date: string; volAnnPct: number }[] = [];
  for (let i = 29; i < rets.length; i++) {
    const window = rets.slice(i - 29, i + 1);
    const mean = window.reduce((s, r) => s + r.ret, 0) / window.length;
    const variance = window.reduce((s, r) => s + (r.ret - mean) ** 2, 0) / (window.length - 1);
    out.push({ date: rets[i].date, volAnnPct: Math.sqrt(variance) * Math.sqrt(252) * 100 });
  }
  return out;
}

function pctile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(p / 100 * (sorted.length - 1))));
  return sorted[idx];
}

async function main() {
  console.log('\n=== KS#4 CORROBORATOR CALIBRATION ===\n');

  // Load full history once (2012 → today)
  const idrBars = await fetchFullHistory('IDR=X', '2012-01-01', '2026-08-03');
  const ustBars = await fetchFullHistory('^TNX', '2012-01-01', '2026-08-03');
  console.log(`IDR daily bars: ${idrBars.length}`);
  console.log(`UST 10Y bars:   ${ustBars.length}`);

  let sbnRaw: Array<{ date: string; close: number }> = [];
  try {
    sbnRaw = (await fetchSbn10yHistoricalWgb()) ?? [];
  } catch (e) {
    console.log(`SBN WGB fetch failed: ${(e as Error).message}`);
  }
  console.log(`SBN 10Y readings: ${sbnRaw.length} (${sbnRaw[0]?.date} → ${sbnRaw[sbnRaw.length - 1]?.date})\n`);

  // Compute IDR realized vol 30d timeseries
  const idrVol = computeRealizedVol30d(idrBars);
  const idrVolMap = new Map(idrVol.map(p => [p.date, p.volAnnPct]));

  // Build UST daily map
  const ustMap = new Map(ustBars.map(b => [b.date, b.close]));

  // Build SBN daily map (interpolate forward-fill since weekly). Field is 'close' not 'value'.
  const sbnSorted = [...sbnRaw].sort((a, b) => a.date.localeCompare(b.date));
  const sbnMap = new Map(sbnSorted.map(p => [p.date, p.close]));

  // ^TNX Yahoo returns raw percentage (4.745 = 4.745%), NOT ×10. No conversion needed.
  const ustPct = ustMap;

  // Compute SBN-UST spread series (only where both exist). SBN weekly → forward-fill.
  const spreadSeries: { date: string; bps: number }[] = [];
  let lastSbn: number | null = null;
  const allDates = [...new Set([...ustPct.keys(), ...sbnMap.keys()])].sort();
  for (const date of allDates) {
    if (sbnMap.has(date)) lastSbn = sbnMap.get(date)!;
    const ust = ustPct.get(date);
    if (lastSbn != null && ust != null) {
      spreadSeries.push({ date, bps: (lastSbn - ust) * 100 });
    }
  }

  // For each crisis: measure pre-crisis quiet zone (180d–90d before start)
  console.log('CRISIS QUIET-ZONE STATS (180d–90d before start, pre-crisis calm):\n');
  console.log('crisis                     | metric              | count | min    | p25    | p50    | p75    | p95    | max');
  console.log('---------------------------|---------------------|-------|--------|--------|--------|--------|--------|--------');

  const spreadPreCrisisP75: number[] = [];
  const volPreCrisisP75: number[] = [];

  for (const c of CRISES) {
    const qStart = daysBefore(c.start, 180);
    const qEnd = daysBefore(c.start, 90);

    // IDR vol
    const volWindow = idrVol.filter(p => p.date >= qStart && p.date < qEnd).map(p => p.volAnnPct);
    if (volWindow.length > 0) {
      const stats = [Math.min(...volWindow), pctile(volWindow, 25), pctile(volWindow, 50), pctile(volWindow, 75), pctile(volWindow, 95), Math.max(...volWindow)];
      console.log(`${c.id.padEnd(26)} | IDR vol 30d ann %   | ${String(volWindow.length).padStart(5)} | ${stats.map(v => v.toFixed(2).padStart(6)).join(' | ')}`);
      volPreCrisisP75.push(pctile(volWindow, 75));
    }

    // SBN-UST spread
    const sprWindow = spreadSeries.filter(p => p.date >= qStart && p.date < qEnd).map(p => p.bps);
    if (sprWindow.length > 0) {
      const stats = [Math.min(...sprWindow), pctile(sprWindow, 25), pctile(sprWindow, 50), pctile(sprWindow, 75), pctile(sprWindow, 95), Math.max(...sprWindow)];
      console.log(`${c.id.padEnd(26)} | SBN-UST spread bps  | ${String(sprWindow.length).padStart(5)} | ${stats.map(v => v.toFixed(0).padStart(6)).join(' | ')}`);
      spreadPreCrisisP75.push(pctile(sprWindow, 75));
    } else {
      console.log(`${c.id.padEnd(26)} | SBN-UST spread bps  | (no SBN data pre-2016)`);
    }
    console.log();
  }

  console.log('\n=== SUGGESTED THRESHOLDS ===\n');
  if (volPreCrisisP75.length > 0) {
    const medianOfP75 = pctile(volPreCrisisP75, 50);
    console.log(`IDR vol 30d ann %:  quiet-zone p75 median = ${medianOfP75.toFixed(2)}%  → kill corroborator: < ${(medianOfP75 * 0.8).toFixed(1)}%`);
  }
  if (spreadPreCrisisP75.length > 0) {
    const medianOfP75 = pctile(spreadPreCrisisP75, 50);
    console.log(`SBN-UST spread:      quiet-zone p75 median = ${medianOfP75.toFixed(0)}bps → kill corroborator: < ${(medianOfP75 * 0.8).toFixed(0)}bps`);
  }

  // Current market snapshot
  console.log('\n=== TODAY (2026-08-03) ===');
  const todayVol = idrVol[idrVol.length - 1];
  const todaySpread = spreadSeries[spreadSeries.length - 1];
  console.log(`IDR vol 30d ann: ${todayVol?.volAnnPct.toFixed(2)}% (${todayVol?.date})`);
  console.log(`SBN-UST spread:  ${todaySpread?.bps.toFixed(0)}bps (${todaySpread?.date})`);
}

main().catch(e => { console.error(e); process.exit(1); });
