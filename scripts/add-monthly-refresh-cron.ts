/**
 * Register monthly data refresh cron job.
 * Runs 8th of each month 09:00 WIB (02:00 UTC) — after BI releases cadev (~7th).
 * Fetches: CPI, GDP, cadev, PMI, ULN/GDP ratio → writes to time-series DB.
 *
 * Run once to register:
 *   bun scripts/add-monthly-refresh-cron.ts
 *
 * Idempotent — removes existing job with same name before re-adding.
 */

import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { loadCronStore, saveCronStore } from '../src/cron/store.js';
import type { CronJob } from '../src/cron/types.js';

const JOB_NAME = 'Indonesia Monthly Data Refresh';

const store = loadCronStore();
store.jobs = store.jobs.filter((j) => j.name !== JOB_NAME);

const now = Date.now();

const job: CronJob = {
  id: randomBytes(8).toString('hex'),
  name: JOB_NAME,
  description: 'Monthly auto-refresh: CPI, GDP, cadev, PMI, ULN/GDP → DB. 8th of month 09:00 WIB.',
  enabled: true,
  createdAtMs: now,
  updatedAtMs: now,
  schedule: {
    kind: 'cron',
    expr: '0 2 8 * *',  // 02:00 UTC = 09:00 WIB, 8th of each month
    tz: 'UTC',
  },
  payload: {
    message: [
      '[MONTHLY DATA REFRESH — AUTO]',
      'Run the monthly macro data refresh script.',
      'Execute: bun scripts/refresh-monthly-data.ts',
      'This fetches fresh CPI/GDP from BPS, cadev from BI, PMI from S&P Global,',
      'and ULN/GDP ratio from SULNI — writes all to time-series DB.',
      'After completion, confirm which indicators were updated and their values.',
      'If any fetch failed, report which ones and why.',
    ].join('\n'),
  },
};

store.jobs.push(job);
saveCronStore(store);

console.log(`✓ Registered cron: "${JOB_NAME}"`);
console.log(`  Schedule: 8th of month 09:00 WIB (02:00 UTC)`);
console.log(`  Job ID: ${job.id}`);
console.log(`  Total active jobs: ${store.jobs.filter(j => j.enabled).length}`);
