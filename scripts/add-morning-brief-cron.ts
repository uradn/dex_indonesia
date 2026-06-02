/**
 * Option B: Add morning brief to Dexter's built-in cron system.
 *
 * Requires the WhatsApp gateway to be running (bun run gateway).
 * Delivers the morning brief to WhatsApp at 08:00 WIB (01:00 UTC) on weekdays.
 *
 * Run once to register the job:
 *   bun scripts/add-morning-brief-cron.ts
 *
 * To view registered jobs:
 *   cat .dexter/cron/jobs.json
 *
 * To disable the job, edit .dexter/cron/jobs.json and set "enabled": false.
 */

import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { loadCronStore, saveCronStore } from '../src/cron/store.js';
import type { CronJob } from '../src/cron/types.js';

const JOB_NAME = 'Indonesia Macro Morning Brief';

const store = loadCronStore();

// Idempotent: remove existing job with same name before re-adding
store.jobs = store.jobs.filter((j) => j.name !== JOB_NAME);

const now = Date.now();

const job: CronJob = {
  id: randomBytes(8).toString('hex'),
  name: JOB_NAME,
  description: 'Run all 13 macro modules + Silent Crisis Detector. Deliver via WhatsApp.',
  enabled: true,
  createdAtMs: now,
  updatedAtMs: now,
  schedule: {
    kind: 'cron',
    expr: '0 1 * * 1-5',  // 01:00 UTC = 08:00 WIB, Mon-Fri
    tz: 'UTC',
  },
  payload: {
    message: [
      'Run the Indonesia macro morning brief.',
      'Use the asean-morning-brief skill.',
      'Call all macro engine tools in parallel: fx_defense_engine, bop_engine, uln_engine,',
      'sovereign_risk_engine, commodity_engine, foreign_flow_engine, regime_engine,',
      'asean_relative_value_engine, narrative_divergence_engine.',
      'Then call silent_crisis_detector.',
      'Output the full brief in the format specified by the skill.',
    ].join(' '),
    model: 'claude-sonnet-4-6',
  },
  fulfillment: 'keep',
  activeHours: {
    start: '01:00',
    end: '03:00',
    timezone: 'UTC',
    daysOfWeek: [1, 2, 3, 4, 5],
  },
  state: {
    consecutiveErrors: 0,
    scheduleErrorCount: 0,
  },
};

store.jobs.push(job);
saveCronStore(store);

console.log(`✓ Job registered: "${JOB_NAME}" (id: ${job.id})`);
console.log(`  Schedule: ${job.schedule.kind === 'cron' ? (job.schedule as { expr: string }).expr : ''} UTC → 08:00 WIB weekdays`);
console.log(`  Delivery: WhatsApp (requires gateway running: bun run gateway)`);
console.log(`  Store: .dexter/cron/jobs.json`);
