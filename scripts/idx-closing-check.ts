/**
 * IDX closing check — runs daily at 16:05 WIB (09:05 UTC) Mon–Fri.
 *
 * Captures same-day IHSG close + IDX foreign net flow from Yahoo Finance ^JKSE.
 * Yahoo Finance is 15-20min delayed for IDX → at 16:05 WIB (session ends 15:50 WIB),
 * data reflects the close price within the delay window.
 *
 * Writes to macro_series:
 *   ihsg_close_daily  — IHSG close price (IDR index points)
 *   ihsg_volume_daily — session volume
 *
 * Also attempts IDX foreign net flow refresh via fetchIdxForeignNetFlow().
 * macOS notification if:
 *   - IHSG move vs previous close > ±1.5%
 *   - Circuit breaker territory: move < −7% (IDX halt at −8%)
 *
 * Register cron:
 *   bun scripts/add-idx-closing-cron.ts
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dir = dirname(fileURLToPath(import.meta.url));
process.chdir(resolve(__dir, '..'));

import 'dotenv/config';
import YahooFinance from 'yahoo-finance2';
import { execSync } from 'node:child_process';
import { upsertPoints, getLatestPoint } from '../src/tools/macro/time-series-db.js';
import { fetchIdxForeignNetFlow } from '../src/tools/macro/sources/idx.js';
import type { MacroDataPoint } from '../src/tools/macro/types.js';

const TODAY = () => new Date().toISOString().slice(0, 10);
const NOW = () => new Date().toISOString();

function notify(title: string, body: string) {
  try {
    const safe = (s: string) => s.replace(/"/g, '\\"');
    execSync(`osascript -e 'display notification "${safe(body)}" with title "${safe(title)}" sound name "Glass"'`);
  } catch { /* non-Mac or osascript unavailable */ }
}

async function main() {
  const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
  const today = TODAY();
  const points: MacroDataPoint[] = [];

  console.log(`IDX Closing Check — ${today} 16:05 WIB`);

  // --- IHSG close ---
  let ihsgClose: number | null = null;
  let ihsgVolume: number | null = null;
  let ihsgPrevClose: number | null = null;

  try {
    const quote = await yf.quote('^JKSE');
    ihsgClose = quote.regularMarketPrice ?? null;
    ihsgVolume = quote.regularMarketVolume ?? null;
    ihsgPrevClose = quote.regularMarketPreviousClose ?? null;

    if (ihsgClose !== null) {
      points.push({
        indicator: 'ihsg_close_daily',
        category: 'market',
        date: today,
        value: parseFloat(ihsgClose.toFixed(2)),
        unit: 'IDR_index',
        source: 'yahoo_finance',
        fetchedAt: NOW(),
      });
      console.log(`IHSG close: ${ihsgClose.toFixed(0)}`);
    }

    if (ihsgVolume !== null) {
      points.push({
        indicator: 'ihsg_volume_daily',
        category: 'market',
        date: today,
        value: ihsgVolume,
        unit: 'shares',
        source: 'yahoo_finance',
        fetchedAt: NOW(),
      });
    }
  } catch (e) {
    console.log(`IHSG fetch error: ${String(e).slice(0, 60)}`);
  }

  // --- IDX foreign net flow refresh ---
  try {
    const flow = await fetchIdxForeignNetFlow();
    if (flow !== null) {
      points.push(flow);
      console.log(`IDX foreign flow: ${flow.value > 0 ? '+' : ''}${flow.value.toFixed(0)} IDR bn (${flow.source})`);
    } else {
      console.log('IDX foreign flow: not available');
    }
  } catch (e) {
    console.log(`IDX flow error: ${String(e).slice(0, 60)}`);
  }

  // --- Write to DB ---
  if (points.length > 0) {
    await upsertPoints(points);
    console.log(`Wrote ${points.length} point(s) to DB`);
  }

  // --- Alerts ---
  if (ihsgClose !== null) {
    // Use Yahoo prev close if available, else fetch from DB
    let prevClose = ihsgPrevClose;
    if (prevClose === null) {
      const prev = await getLatestPoint('ihsg_close_daily');
      if (prev && prev.date < today) prevClose = prev.value;
    }

    if (prevClose !== null && prevClose > 0) {
      const pct = ((ihsgClose - prevClose) / prevClose) * 100;
      const sign = pct >= 0 ? '+' : '';
      console.log(`IHSG vs prev close: ${sign}${pct.toFixed(2)}% (prev ${prevClose.toFixed(0)})`);

      if (pct <= -7) {
        // Circuit breaker approaching (-8% = IDX halt)
        notify(
          '⚠️ IHSG CIRCUIT BREAKER TERRITORY',
          `IHSG ${ihsgClose.toFixed(0)} (${sign}${pct.toFixed(2)}%) — IDX halt at −8%`,
        );
        // Write flag for engine
        const flagDate = TODAY();
        const existing = process.env.IDX_LAST_CIRCUIT_BREAKER_DATE;
        if (!existing || existing < flagDate) {
          console.log(`\n⚠ CIRCUIT BREAKER WATCH: set IDX_LAST_CIRCUIT_BREAKER_DATE=${flagDate} in .env`);
        }
      } else if (Math.abs(pct) >= 1.5) {
        const dir = pct > 0 ? '↑' : '↓';
        notify(
          `IHSG ${dir} ${sign}${pct.toFixed(2)}%`,
          `Close: ${ihsgClose.toFixed(0)} | Prev: ${prevClose.toFixed(0)}`,
        );
      }
    }
  }

  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
