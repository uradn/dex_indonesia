/**
 * MSCI SAIR Nov 12 2026 — one-time special brief cron jobs.
 *
 * Two one-time jobs (fulfillment: 'once'):
 *   1. Pre-SAIR  — Nov 12 07:00 WIB (00:00 UTC): last-minute positioning analysis
 *   2. Post-SAIR — Nov 13 11:00 WIB (04:00 UTC): reaction brief after MSCI announcement
 *      MSCI typically announces after US market close (~22:00 ET = Nov 13 10:00 WIB).
 *
 * Run once to register both jobs:
 *   bun scripts/add-sair-brief-cron.ts
 *
 * Post-Nov 12 env ops (no code change needed):
 *   MSCI_SAIR_DATE=2027-05-XX   (May 2027 SAIR — date announced by MSCI)
 *   MSCI_REVIEW_DATE=2027-04-30 (next milestone: consultation close)
 *   MSCI_CLASSIFICATION_STATUS  (stays downgrade_risk if Standalone confirmed; else under_review)
 */

import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { loadCronStore, saveCronStore } from '../src/cron/store.js';
import type { CronJob } from '../src/cron/types.js';

const PRE_NAME  = 'MSCI SAIR Nov 12 — Pre-SAIR Brief';
const POST_NAME = 'MSCI SAIR Nov 12 — Post-SAIR Reaction';

const store = loadCronStore();
store.jobs = store.jobs.filter((j) => j.name !== PRE_NAME && j.name !== POST_NAME);

const now = Date.now();

const preJob: CronJob = {
  id: randomBytes(8).toString('hex'),
  name: PRE_NAME,
  description: 'Pre-SAIR brief — 13 modules + MSCI positioning analysis. Nov 12 07:00 WIB. One-time.',
  enabled: true,
  createdAtMs: now,
  updatedAtMs: now,
  schedule: {
    kind: 'at',
    at: '2026-11-12T00:00:00Z',  // 07:00 WIB
  },
  payload: {
    message: [
      '[MSCI SAIR NOV 12 — PRE-ANNOUNCEMENT BRIEF]',
      'MSCI Semi-Annual Index Review fires today. Announcement expected after NY market close (~22:00 ET = Nov 13 05:00 WIB).',
      'This is a Bryant (1980) common knowledge event — pre-positioning window closes at open.',
      '',
      'STEP 1 — Run all 13 macro modules via asean-morning-brief skill.',
      'Focus on: M5 Foreign Flow (Bryant phase + MSCI scores), M3 FX Defense (Confidence Gate),',
      'M10 Fiscal (Calvo trap metric), M8 Banking (B-P spiral conditions), SCD + Impossible Trinity flag.',
      '',
      'STEP 2 — MSCI SAIR positioning assessment:',
      'a) P(downgrade) current estimate — Kreps (1982) credible commitment: consultation elapsed % → P(downgrade) formula.',
      'b) IHSG floor estimate — weighted PE: P(reversal)×12x + P(downgrade)×5.5x = target PE.',
      '   At P(reversal)=14%: floor ≈ 4,391 (−14% from last close). Show current IHSG vs floor.',
      'c) Bryant phase: which passive sell wave is active now (fast money / ETF / mandate rebal)?',
      'd) Expected SAIR outcomes: stock exclusions (free-float noncompliance), Standalone confirmation language.',
      '   Watch for: any softening of "expects to proceed" language = signal to update MSCI_CLASSIFICATION_STATUS.',
      '',
      'STEP 3 — Key tripwires to watch today:',
      '• CDS 5Y: if jumps >10bps intraday → Morris-Shin revelation event',
      '• USDIDR: if crosses 18,500 → M3 Confidence Gate tips ATTACK zone',
      '• IHSG: volume + A/D ratio — forced-sell vs panic distinction',
      '• EIDO: any unusual pre-close volume = active pre-positioning',
      '',
      'FORMAT (WhatsApp — use *bold* for headers):',
      '🔴 *MSCI SAIR DAY — [date]*',
      '',
      '*SCD: [X]% [LEVEL]* | 13-mod scorecard (condensed)',
      '',
      '*📊 MSCI Positioning*',
      'P(downgrade): [%] | IHSG floor: [level] | Bryant phase: [phase]',
      'Expected: [stock exclusions] + Standalone [status]',
      '',
      '*⚡ Tripwires*',
      'CDS [bps] (watch +10 jump) | IDR [rate] (watch 18,500) | IHSG [level] (floor [X])',
      '',
      '*🔑 Action*',
      'Post-announcement (Nov 13 ~05:00 WIB): update MSCI_CLASSIFICATION_STATUS if needed.',
      'If Standalone confirmed → MSCI_SAIR_DATE=2027-05-XX + MSCI_REVIEW_DATE=2027-04-30.',
      '',
      'Max 1000 characters. Prepend 🚨 SAIR ALERT if SCD ≥ 75%.',
    ].join('\n'),
    model: 'claude-sonnet-4-6',
  },
  fulfillment: 'once',
  state: {
    consecutiveErrors: 0,
    scheduleErrorCount: 0,
  },
};

const postJob: CronJob = {
  id: randomBytes(8).toString('hex'),
  name: POST_NAME,
  description: 'Post-SAIR reaction brief — MSCI outcome analysis + env update guidance. Nov 13 11:00 WIB. One-time.',
  enabled: true,
  createdAtMs: now,
  updatedAtMs: now,
  schedule: {
    kind: 'at',
    at: '2026-11-13T04:00:00Z',  // 11:00 WIB — after MSCI announces
  },
  payload: {
    message: [
      '[MSCI SAIR NOV 12 — POST-ANNOUNCEMENT REACTION BRIEF]',
      'MSCI announced SAIR results ~Nov 13 05:00 WIB. This brief assesses market reaction and updates positioning.',
      '',
      'STEP 1 — Run all 13 macro modules via asean-morning-brief skill.',
      'Pay special attention to:',
      '• M5 Foreign Flow: Did EIDO/IHSG react? New Bryant phase?',
      '• M3 FX Defense: USDIDR move + SRBI bid-cover post-announcement',
      '• M8 Banking: AT1 secondary price change + B-P spiral conditions',
      '• SCD: did SCD change direction post-SAIR?',
      '',
      'STEP 2 — MSCI outcome assessment (search Exa/Tavily for MSCI announcement):',
      'a) What did MSCI announce? Standalone confirmed / delayed / reversed?',
      'b) Which stocks excluded (free-float noncompliance)? Estimate passive outflow impact.',
      'c) Language analysis: "expects to proceed" still present → P(reversal) stays ≤14%.',
      '   If language softened → P(reversal) update needed.',
      'd) New IHSG floor estimate given updated P(reversal).',
      '',
      'STEP 3 — Env update instructions (output as checklist):',
      '□ MSCI_SAIR_DATE=2027-05-XX  (advance to May 2027 SAIR — get exact date from announcement)',
      '□ MSCI_REVIEW_DATE=2027-04-30  (advance to consultation close)',
      '□ MSCI_CLASSIFICATION_STATUS — only change if unexpected (default: stays downgrade_risk)',
      '□ MSCI_REVERSAL_PROBABILITY_OVERRIDE — set based on SAIR language:',
      '    Standalone confirmed (base case): set to 0.08  (P(reversal) drops 14%→8%)',
      '    Language unchanged / ambiguous: leave UNSET  (auto-formula continues: ~13% → 5% by Apr 2027)',
      '    Language softens unexpectedly: set to 0.18 + MSCI_CLASSIFICATION_STATUS=under_review',
      '□ Run bun scripts/morning-check.ts after env update to verify score recalibration',
      '',
      'FORMAT (WhatsApp):',
      '📣 *MSCI SAIR Result — [date]*',
      '',
      '*Outcome: [STANDALONE CONFIRMED / DELAYED / REVERSED]*',
      'Exclusions: [stocks] | Passive outflow: ~$[X]B',
      'P(downgrade): [%] (was [%]) | P(reversal): [%] (was 14%)',
      'IHSG floor revised: [level] (was 4,391)',
      '',
      '*SCD: [X]% [LEVEL]* post-SAIR',
      'M5: [score] | M3: [score] | USDIDR: [rate]',
      '',
      '*✅ Env Update Checklist*',
      'MSCI_SAIR_DATE=2027-05-XX ← [confirm/update]',
      'MSCI_REVIEW_DATE=2027-04-30 ← [confirm/update]',
      'MSCI_CLASSIFICATION_STATUS=[value] ← [confirm/update]',
      'MSCI_REVERSAL_PROBABILITY_OVERRIDE=[0.08 if confirmed / unset if unchanged / 0.18 if softened] ← [confirm/update]',
      '',
      'Max 1200 characters.',
    ].join('\n'),
    model: 'claude-sonnet-4-6',
  },
  fulfillment: 'once',
  state: {
    consecutiveErrors: 0,
    scheduleErrorCount: 0,
  },
};

store.jobs.push(preJob);
store.jobs.push(postJob);
saveCronStore(store);

console.log(`✓ Pre-SAIR  job registered: "${PRE_NAME}"  (id: ${preJob.id})`);
console.log(`  Fires: 2026-11-12T00:00:00Z → 07:00 WIB Nov 12. One-time.`);
console.log(`✓ Post-SAIR job registered: "${POST_NAME}" (id: ${postJob.id})`);
console.log(`  Fires: 2026-11-13T04:00:00Z → 11:00 WIB Nov 13. One-time.`);
console.log(`  Store: .dexter/cron/jobs.json`);
console.log(`  Requires: bun run gateway (WhatsApp delivery)`);
