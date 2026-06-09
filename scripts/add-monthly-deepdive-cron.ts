/**
 * Monthly macro deep dive cron job.
 *
 * Runs 1st of each month 08:00 WIB (01:00 UTC).
 * Most comprehensive run: all 13 modules + sovereign memo + APBN realisasi
 * focus + ULN/DSR update + compound shock scenario + backtest analog check.
 * Delivers via WhatsApp (requires bun run gateway).
 *
 * Run once to register:
 *   bun scripts/add-monthly-deepdive-cron.ts
 *
 * Idempotent — removes existing job with same name before re-adding.
 * NOTE: existing "Indonesia Reserves Monthly Check" (09:00 WIB) is preserved —
 * this job runs 1h earlier as the deep narrative layer.
 */

import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { loadCronStore, saveCronStore } from '../src/cron/store.js';
import type { CronJob } from '../src/cron/types.js';

const JOB_NAME = 'Indonesia Macro Monthly Deep Dive';

const store = loadCronStore();
store.jobs = store.jobs.filter((j) => j.name !== JOB_NAME);

const now = Date.now();

const job: CronJob = {
  id: randomBytes(8).toString('hex'),
  name: JOB_NAME,
  description: 'Monthly deep dive — all 13 modules + sovereign memo + APBN realisasi + ULN/DSR + compound shock. 1st of month 08:00 WIB.',
  enabled: true,
  createdAtMs: now,
  updatedAtMs: now,
  schedule: {
    kind: 'cron',
    expr: '0 1 1 * *',  // 01:00 UTC = 08:00 WIB, 1st of each month
    tz: 'UTC',
  },
  payload: {
    message: [
      '[MONTHLY MACRO DEEP DIVE — INDONESIA]',
      'It is the 1st of the month. Run the full Indonesia macro monthly assessment.',
      '',
      'STEP 1 — Full morning brief via asean-morning-brief skill.',
      'Run all 13 modules in parallel. Get Silent Crisis Probability + full module scorecard.',
      'Note any month-on-month changes in scores (compare vs DB historical values where available).',
      '',
      'STEP 2 — Sovereign stress deep dive via sovereign-stress-memo skill.',
      'Focus on: CDS trajectory MoM, SBN foreign ownership trend (is it falling?),',
      'APBN credibility gap (USDIDR vs 16,500 assumption, ICP vs $70 assumption),',
      'and three scenarios (bear/base/bull) for IDR + sovereign spread over next 3 months.',
      '',
      'STEP 3 — APBN realisasi focus.',
      'Run fiscal_engine. Check:',
      '  - Revenue absorption: are we on track for full-year target?',
      '  - Spending pace: above or below pro-rata? MBG overrun risk?',
      '  - Deficit trajectory: % GDP vs 3% constitutional ceiling.',
      '  - SRBI sterilization cost: quasi-fiscal drag on BI balance sheet.',
      '',
      'STEP 4 — ULN/external debt update.',
      'Run uln_engine. Check:',
      '  - DSR trend: 2022→2023→2024→latest (is it crossing 25% IMF threshold?)',
      '  - Greenspan-Guidotti ratio: still above 2.0?',
      '  - r−g dynamic: SBN yield − GDP growth — is primary surplus needed?',
      '  - Hedging compliance: any BI SULNI update available?',
      '',
      'STEP 5 — Compound shock scenario.',
      'Use shock-scenario skill. Apply: Brent +$30 (to ~$120/bbl) + USDIDR +2,500 (to ~20,500) + VIX spike to 45.',
      'This is the "full Hormuz closure + EM panic" scenario.',
      'Show Before vs After for all affected modules. Compute new SCD post-shock.',
      'Flag if this scenario would breach: 3% GDP deficit ceiling, GG ratio <1.5, NPL >3%.',
      '',
      'STEP 6 — Backtest analog check.',
      'Which historical Indonesia crisis does the current setup most resemble?',
      'Pick one: 2013 Taper Tantrum / 2015 China Deval / 2018 EM Contagion / 2020 COVID / 2022 Fed Tightening / 2023 Dollar Surge.',
      'State: analog name + current similarity score (1-5) + key difference from that episode.',
      '',
      'FORMAT (WhatsApp — use *bold* for headers, max 2000 characters):',
      '📅 *Monthly Deep Dive — [month year]*',
      '',
      '*🔴 Silent Crisis: [X]% [LEVEL]*',
      '*Module Scorecard:* [abbreviated table: top 5 stressed + overall]',
      '',
      '*📊 APBN Realisasi*',
      'Revenue: [X]% absorbed | Deficit: [X]% GDP',
      'Risk: [GREEN/YELLOW/ORANGE/RED + 1 line]',
      '',
      '*🏦 ULN / External Debt*',
      'DSR: [X]% (threshold 25%) | GG: [X] | r−g: [±X]pp',
      'Trend: [improving/worsening + 1 line]',
      '',
      '*⚡ Compound Shock (Brent $120 + IDR 20,500 + VIX 45)*',
      'SCD: [X]% → [Y]% | [key module that flips RED]',
      'Constitutional breach: YES/NO (deficit [X]% GDP)',
      '',
      '*📖 Historical Analog: [episode name]*',
      '[1 sentence: why similar + 1 sentence: key difference]',
      '',
      '*🔑 Monthly Watch (next 30 days)*',
      '[3 bullet points: most important data releases or risk events]',
      '',
      'If SCD ≥ 50%, prepend: 🚨 SYSTEMIC RISK ALERT.',
      'If compound shock breaches constitutional deficit ceiling, prepend: ⚠️ FISCAL CEILING RISK.',
    ].join('\n'),
    model: 'claude-sonnet-4-6',
  },
  fulfillment: 'keep',
  activeHours: {
    start: '01:00',
    end: '05:00',
    timezone: 'UTC',
  },
  state: {
    consecutiveErrors: 0,
    scheduleErrorCount: 0,
  },
};

store.jobs.push(job);
saveCronStore(store);

console.log(`✓ Job registered: "${JOB_NAME}" (id: ${job.id})`);
console.log(`  Schedule: 0 1 1 * * UTC → 08:00 WIB, 1st of each month`);
console.log(`  Scope: 13 modules + sovereign memo + APBN realisasi + ULN/DSR + compound shock + backtest analog`);
console.log(`  Delivery: WhatsApp (requires gateway running: bun run gateway)`);
console.log(`  Note: "Indonesia Reserves Monthly Check" (09:00 WIB) preserved separately`);
console.log(`  Store: .dexter/cron/jobs.json`);
