/**
 * Sets up permanent ASEAN market monitoring cron jobs in Dexter.
 *
 * Run once: bun run scripts/setup-asean-monitoring.ts
 *
 * Jobs created:
 *   1. ASEAN Pre-Market    — 01:30 UTC Mon-Fri (30 min before IDX opens)
 *   2. ASEAN Market Open   — 02:05 UTC Mon-Fri (IDX opens 09:00 WIB = 02:00 UTC)
 *   3. ASEAN Mid-Session   — 06:30 UTC Mon-Fri (IDX afternoon session opens)
 *   4. ASEAN Close Summary — 09:15 UTC Mon-Fri (after IDX closes 15:49 WIB = 08:49 UTC)
 *   5. ASEAN FX Watch      — every 2h, 01:00-10:00 UTC Mon-Fri
 *   6. Weekly ASEAN Wrap   — Friday 10:00 UTC
 */

import { randomBytes } from 'node:crypto';
import { loadCronStore, saveCronStore } from '../src/cron/store.js';
import type { CronJob } from '../src/cron/types.js';

const JOBS_TO_CREATE: Omit<CronJob, 'id' | 'createdAtMs' | 'updatedAtMs' | 'state'>[] = [
  {
    name: 'ASEAN Pre-Market',
    description: 'Pre-market check 30 min before IDX opens — overnight direction from US/SGX/Bursa',
    enabled: true,
    schedule: { kind: 'cron', expr: '30 1 * * 1-5', tz: 'UTC' },
    fulfillment: 'keep',
    payload: {
      message: `[ASEAN PRE-MARKET CHECK]
It is 30 minutes before the Indonesia Stock Exchange opens (IDX opens at 09:00 WIB).

Using get_asean_data, check:
1. Overnight direction: quote ^JKSE, ^JKLQ45, ^KLSE, ^STI (SGX and Bursa are already open)
2. IDR/USD rate (IDR=X) — is Rupiah strengthening or weakening pre-market?
3. Any breaking regional news via web_search: "Indonesia market outlook today IHSG"

Synthesize a pre-market brief: what direction is IDX likely to open, key risks or tailwinds. Keep it under 150 words. Only send if there is something notable — skip routine flat openings.`,
    },
    activeHours: { start: '01:00', end: '02:30', timezone: 'UTC', daysOfWeek: [1, 2, 3, 4, 5] },
  },
  {
    name: 'ASEAN Market Open',
    description: 'Full ASEAN market briefing at IDX open (09:05 WIB)',
    enabled: true,
    schedule: { kind: 'cron', expr: '5 2 * * 1-5', tz: 'UTC' },
    fulfillment: 'keep',
    payload: {
      message: `[ASEAN MARKET OPEN BRIEFING]
The Indonesia Stock Exchange has just opened. Run the asean-monitor skill for a full ASEAN market open briefing.

The briefing must include:
1. All ASEAN composite indices: ^JKSE, ^JKLQ45, ^KLSE, ^STI, ^SET.BK, ^PSEi
2. IDX sectoral indices: ^JKAGRI, ^JKCONS, ^JKPROP, ^JKMISC
3. IDX blue-chip pulse: BBCA.JK, BBRI.JK, BMRI.JK, TLKM.JK, BREN.JK, BYAN.JK, ASII.JK, GOTO.JK
4. IDR vs USD, MYR, SGD, THB (cross-rates)
5. One key headline from web_search if any breaking news

Format: structured table + 2-sentence signal summary. Target under 200 words total.`,
    },
    activeHours: { start: '02:00', end: '04:00', timezone: 'UTC', daysOfWeek: [1, 2, 3, 4, 5] },
  },
  {
    name: 'ASEAN Mid-Session',
    description: 'Mid-day ASEAN update at IDX afternoon session open (13:30 WIB = 06:30 UTC)',
    enabled: true,
    schedule: { kind: 'cron', expr: '30 6 * * 1-5', tz: 'UTC' },
    fulfillment: 'keep',
    payload: {
      message: `[ASEAN MID-SESSION UPDATE]
IDX afternoon session is opening. Provide a mid-session ASEAN update.

Using get_asean_data, check:
1. IHSG (^JKSE) and LQ45 (^JKLQ45) current levels vs morning open
2. IDR/USD current rate vs this morning
3. Top 3 IDX gainers and top 3 losers among: BBCA.JK, BBRI.JK, BMRI.JK, TLKM.JK, BREN.JK, BYAN.JK, ASII.JK, GOTO.JK, MEDC.JK, PGAS.JK
4. SET.BK (Thailand) — only market still active alongside IDX at this hour

Only send if IHSG has moved more than 0.5% from open, or if any blue-chip has moved more than 3%. Otherwise respond with the suppression token.`,
    },
    activeHours: { start: '06:00', end: '08:00', timezone: 'UTC', daysOfWeek: [1, 2, 3, 4, 5] },
  },
  {
    name: 'ASEAN Close Summary',
    description: 'ASEAN daily closing summary after IDX closes (15:49 WIB = 08:49 UTC)',
    enabled: true,
    schedule: { kind: 'cron', expr: '15 9 * * 1-5', tz: 'UTC' },
    fulfillment: 'keep',
    payload: {
      message: `[ASEAN DAILY CLOSING SUMMARY]
All major ASEAN markets have closed for the day. Run the asean-monitor skill for a daily close summary.

Include:
1. Final close levels for all ASEAN indices: ^JKSE, ^JKLQ45, ^KLSE, ^STI, ^SET.BK
2. IDR/USD closing rate + daily change
3. IDX blue-chip final standings: top 3 gainers, top 3 losers, advancers vs decliners count
4. One-paragraph market signal: what drove today's session, any divergence between markets
5. Tomorrow's watch: any scheduled data releases or events (via web_search if needed)

Format: clean closing table + signal paragraph. Under 250 words.`,
    },
    activeHours: { start: '09:00', end: '11:00', timezone: 'UTC', daysOfWeek: [1, 2, 3, 4, 5] },
  },
  {
    name: 'ASEAN FX Watch',
    description: 'IDR + ASEAN currency monitoring every 2 hours during ASEAN trading session',
    enabled: true,
    schedule: { kind: 'cron', expr: '0 1,3,5,7,9 * * 1-5', tz: 'UTC' },
    fulfillment: 'keep',
    payload: {
      message: `[ASEAN FX WATCH]
Check current ASEAN currency rates via get_asean_data or direct quote.

Fetch these FX rates: IDR=X, MYR=X, SGD=X, THB=X, PHP=X

Calculate:
- USD/IDR current rate and daily change %
- IDR per 1 MYR, IDR per 1 SGD (cross-rates)
- Which ASEAN currency is strongest/weakest vs USD today

Only send an alert if:
- USD/IDR has moved more than 0.8% from prior close, OR
- USD/IDR is above 17,800, OR
- Any ASEAN currency has moved more than 1.2% vs USD today

If no threshold breached, respond with the suppression token. Do not spam routine updates.`,
    },
    activeHours: { start: '01:00', end: '10:00', timezone: 'UTC', daysOfWeek: [1, 2, 3, 4, 5] },
  },
  {
    name: 'Weekly ASEAN Wrap',
    description: 'End-of-week ASEAN market summary every Friday after close',
    enabled: true,
    schedule: { kind: 'cron', expr: '0 10 * * 5', tz: 'UTC' },
    fulfillment: 'keep',
    payload: {
      message: `[WEEKLY ASEAN WRAP]
It is end of week. Provide a weekly ASEAN market summary.

Using get_asean_data:
1. Weekly performance of all ASEAN indices (get 5-day history for ^JKSE, ^KLSE, ^STI, ^SET.BK)
2. IDR weekly change vs USD (get 5-day history for IDR=X)
3. IDX top 5 weekly gainers and top 5 losers among LQ45 blue-chips
4. ASEAN upstream O&G weekly: MEDC.JK, ENRG.JK, PTTEP.BK weekly history
5. WTI and Brent crude weekly change (CL=F, BZ=F)

Use web_search for: "ASEAN market weekly recap [current week]" to supplement with key macro themes.

Format: weekly performance table + 3-4 sentence narrative on what drove the week + 1 sentence on next week's key risks/events.`,
    },
  },
];

function makeJob(spec: Omit<CronJob, 'id' | 'createdAtMs' | 'updatedAtMs' | 'state'>): CronJob {
  const now = Date.now();
  return {
    ...spec,
    id: randomBytes(8).toString('hex'),
    createdAtMs: now,
    updatedAtMs: now,
    state: {
      consecutiveErrors: 0,
      scheduleErrorCount: 0,
    },
  };
}

const store = loadCronStore();
const existingNames = new Set(store.jobs.map((j) => j.name));

let added = 0;
let skipped = 0;

for (const spec of JOBS_TO_CREATE) {
  if (existingNames.has(spec.name)) {
    console.log(`  SKIP  ${spec.name} (already exists)`);
    skipped++;
    continue;
  }
  store.jobs.push(makeJob(spec));
  console.log(`  ADD   ${spec.name}`);
  added++;
}

saveCronStore(store);

console.log(`\nDone. Added ${added} job(s), skipped ${skipped} duplicate(s).`);
console.log(`Total jobs in store: ${store.jobs.length}`);
console.log('\nNext steps:');
console.log('  1. Start the WhatsApp gateway: bun run gateway:login  (first time)');
console.log('  2. Run the gateway:            bun run gateway');
console.log('  3. Jobs fire automatically on schedule. Results delivered via WhatsApp.');
console.log('  4. To request O&G monitoring:  ask Dexter "ASEAN O&G update" at any time.');
console.log('  5. To adjust jobs:             use the /cron command inside Dexter CLI.');
