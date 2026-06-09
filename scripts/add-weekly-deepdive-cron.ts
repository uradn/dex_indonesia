/**
 * Weekly macro deep dive cron job.
 *
 * Runs every Monday 07:00 WIB (00:00 UTC) — before IDX opens.
 * Full 13-module brief + sovereign stress memo + Hormuz shock scenario.
 * Delivers via WhatsApp (requires bun run gateway).
 *
 * Run once to register:
 *   bun scripts/add-weekly-deepdive-cron.ts
 *
 * Idempotent — removes existing job with same name before re-adding.
 */

import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { loadCronStore, saveCronStore } from '../src/cron/store.js';
import type { CronJob } from '../src/cron/types.js';

const JOB_NAME = 'Indonesia Macro Weekly Deep Dive';

const store = loadCronStore();
store.jobs = store.jobs.filter((j) => j.name !== JOB_NAME);

// Also replace the old lightweight weekly job if present
store.jobs = store.jobs.filter((j) => j.name !== 'Indonesia Sovereign Stress Weekly');

const now = Date.now();

const job: CronJob = {
  id: randomBytes(8).toString('hex'),
  name: JOB_NAME,
  description: 'Weekly deep dive — all 13 macro modules + sovereign stress memo + Hormuz shock scenario. Monday 07:00 WIB.',
  enabled: true,
  createdAtMs: now,
  updatedAtMs: now,
  schedule: {
    kind: 'cron',
    expr: '0 0 * * 1',  // 00:00 UTC = 07:00 WIB, every Monday
    tz: 'UTC',
  },
  payload: {
    message: [
      '[WEEKLY MACRO DEEP DIVE — INDONESIA]',
      'Today is Monday. Run the full Indonesia macro weekly assessment.',
      '',
      'STEP 1 — Full morning brief via asean-morning-brief skill.',
      'Run all 13 modules in parallel. Get Silent Crisis Probability + full module scorecard.',
      '',
      'STEP 2 — Sovereign stress deep dive via sovereign-stress-memo skill.',
      'Focus on: CDS trajectory, SBN foreign ownership trend, APBN credibility gap,',
      'and three scenarios (bear/base/bull) for IDR + sovereign spread.',
      '',
      'STEP 3 — Shock scenario: Hormuz escalation.',
      'Apply shock: Brent +$12 (to ~$105/bbl) + USDIDR +1,000 (to ~19,000).',
      'Use shock-scenario skill. Show Before vs After module scorecard.',
      'Compute new Silent Crisis Probability post-shock.',
      '',
      'FORMAT (WhatsApp — use *bold* for headers):',
      '📊 *Weekly Deep Dive — [date]*',
      '',
      '*🔴 Silent Crisis: [X]% [LEVEL]*',
      '*Module Scorecard:* [table: module | score | alert]',
      '',
      '*📉 Sovereign Deep Dive*',
      'CDS 5Y: [bps] | SBN 10Y: [%] | Foreign SBN: [%]',
      'Scenario Bear: [IDR target] | CDS +[bps]',
      'Scenario Bull: [IDR target] | inflow signal',
      '',
      '*⚡ Hormuz Shock (Brent $105 + IDR 19,000)*',
      '[Before vs After table — only affected modules]',
      'SCD: [X]% → [Y]%',
      '',
      '*🔑 Key Risks This Week*',
      '[3 bullet points: top risks to watch, with specific numeric tripwires]',
      '',
      'Max 1200 characters total. If SCD ≥ 50%, prepend: 🚨 SYSTEMIC RISK ALERT.',
    ].join('\n'),
    model: 'claude-sonnet-4-6',
  },
  fulfillment: 'keep',
  activeHours: {
    start: '00:00',
    end: '03:00',
    timezone: 'UTC',
    daysOfWeek: [1],  // Monday only
  },
  state: {
    consecutiveErrors: 0,
    scheduleErrorCount: 0,
  },
};

store.jobs.push(job);
saveCronStore(store);

console.log(`✓ Job registered: "${JOB_NAME}" (id: ${job.id})`);
console.log(`  Schedule: 0 0 * * 1 UTC → 07:00 WIB every Monday`);
console.log(`  Scope: all 13 modules + sovereign memo + Hormuz shock scenario`);
console.log(`  Delivery: WhatsApp (requires gateway running: bun run gateway)`);
console.log(`  Store: .dexter/cron/jobs.json`);
console.log(`  Note: replaced "Indonesia Sovereign Stress Weekly" (incomplete, 7 engines only)`);
