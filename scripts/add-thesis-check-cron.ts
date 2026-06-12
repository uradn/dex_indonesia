/**
 * Registers the Big Short thesis milestone checker as a weekly cron job.
 *
 * Runs every Monday 07:30 WIB (00:30 UTC) — after weekly deep dive (07:00 WIB).
 * Checks T+3/6/12 milestones for armed/triggered theses.
 * Auto-kills if kill switch #1 fires (political_risk <55 sustained 14d).
 *
 * Run once to register:
 *   bun scripts/add-thesis-check-cron.ts
 *
 * Idempotent — removes existing job with same name before re-adding.
 */

import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { loadCronStore, saveCronStore } from '../src/cron/store.js';
import type { CronJob } from '../src/cron/types.js';

const JOB_NAME = 'Big Short Thesis Milestone Check';

const store = loadCronStore();
store.jobs = store.jobs.filter((j) => j.name !== JOB_NAME);

const now = Date.now();

const job: CronJob = {
  id: randomBytes(8).toString('hex'),
  name: JOB_NAME,
  description: 'Weekly T+3/6/12 milestone check for armed/triggered Big Short theses. Auto-detects kill switches. Monday 07:30 WIB.',
  enabled: true,
  createdAtMs: now,
  updatedAtMs: now,
  schedule: {
    kind: 'cron',
    expr: '30 0 * * 1',  // 00:30 UTC = 07:30 WIB, every Monday
    tz: 'UTC',
  },
  payload: {
    message: [
      '[BIG SHORT THESIS MILESTONE CHECK]',
      'Run the thesis milestone checker for all active (armed/triggered) theses.',
      '',
      'Use the arm_thesis_check tool or run: bun scripts/check-thesis.ts',
      '',
      'For each active thesis:',
      '1. Check if at T+3/6/12 milestone (±5d window)',
      '2. Compare actual CDS/IDR/SBN vs predicted values',
      '3. Auto-detect kill switch #1 (political_risk_score <55 sustained 14d)',
      '4. Auto-detect kill switch #3 (SBN foreign ownership >13%)',
      '5. Save milestone accuracy report to DB',
      '',
      'Report format (WhatsApp):',
      '🎯 *Thesis Milestone Check — [date]*',
      '',
      'For each thesis: ID | status | days elapsed',
      'If at milestone: CDS/IDR/SBN actual vs predicted (% diff)',
      'Kill switch status: #1 political | #2 BI package | #3 SBN ownership',
      '',
      'If no active theses: "No active theses — run big-short-thesis skill to generate one."',
      'Max 800 characters.',
    ].join('\n'),
    model: 'claude-sonnet-4-6',
  },
  fulfillment: 'keep',
  activeHours: {
    start: '00:30',
    end: '02:00',
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
console.log(`  Schedule: 30 0 * * 1 UTC → 07:30 WIB every Monday`);
console.log(`  Scope: T+3/6/12 milestone checks + kill switch auto-detect`);
console.log(`  Runs: 30 min after weekly deep dive (07:00 WIB)`);
console.log(`  Store: .dexter/cron/jobs.json`);
