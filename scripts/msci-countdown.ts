/**
 * MSCI milestone countdown — macOS notification at T-60, T-30, T-7, and day-of.
 *
 * Tracks multiple milestones in sequence; auto-advances when current target passes.
 * MSCI Standalone consultation timeline:
 *   2026-11-12 — MSCI November Index Review (confirm Standalone parameters)
 *   2027-04-30 — Consultation closes
 *   2027-06-30 — Final decision (reclassify EM→Standalone or reverse)
 *   2027-09-01 — Implementation begins if downgrade confirmed
 *
 * After each milestone passes, set MSCI_REVIEW_DATE to next milestone date.
 * See CLAUDE.md for full operator update procedure.
 *
 * Run via crontab daily at 08:00 WIB (01:00 UTC):
 *   0 1 * * 1-5 /Users/victoriuselvino/.bun/bin/bun scripts/msci-countdown.ts >> /Users/victoriuselvino/Downloads/dexter/.dexter/msci-countdown.log 2>&1
 *
 * Env vars:
 *   MSCI_REVIEW_DATE        ISO date of current target milestone — default 2026-11-12
 *   MSCI_ALERT_COOLDOWN_H   hours between repeat alerts — default 48
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dir = dirname(fileURLToPath(import.meta.url));
process.chdir(resolve(__dir, '..'));

import 'dotenv/config';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dexterPath } from '../src/utils/paths.js';

// Ordered milestone dates. Operator sets MSCI_REVIEW_DATE to current target; advances manually after each passes.
const MILESTONE_DATES = [
  { date: '2026-11-12', label: 'November Index Review — Standalone parameters confirmed' },
  { date: '2027-04-30', label: 'Consultation closes — MSCI evaluates reform evidence' },
  { date: '2027-06-30', label: 'Final decision — EM maintained or Standalone reclassification' },
  { date: '2027-09-01', label: 'Implementation begins (if downgrade confirmed)' },
];

const REVIEW_DATE   = new Date(process.env.MSCI_REVIEW_DATE ?? MILESTONE_DATES[0]!.date);
const COOLDOWN_H    = parseFloat(process.env.MSCI_ALERT_COOLDOWN_H ?? '48');
const STATE_FILE    = dexterPath('msci-countdown-state.json');

// Milestones in days-before (ascending): pick smallest milestone we've reached
const ALERT_WINDOWS = [0, 7, 30, 60];

interface CountdownState {
  firedMilestones: number[];   // days-before alert windows already fired for current REVIEW_DATE
  lastAlertAt: string | null;
  reviewDateTracked: string;   // which REVIEW_DATE was active when state was last saved
}

function loadState(): CountdownState {
  if (existsSync(STATE_FILE)) {
    try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch {}
  }
  const reviewDateStr = REVIEW_DATE.toISOString().slice(0, 10);
  return { firedMilestones: [], lastAlertAt: null, reviewDateTracked: reviewDateStr };
}

function saveState(s: CountdownState) {
  const dir = STATE_FILE.replace(/\/[^/]+$/, '');
  mkdirSync(dir, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

function macosSend(title: string, body: string) {
  try {
    const safe = (s: string) => s.replace(/"/g, '\\"').replace(/'/g, "\\'");
    execSync(`osascript -e 'display notification "${safe(body)}" with title "${safe(title)}" sound name "Purr"'`);
  } catch { /* non-Mac or osascript unavailable */ }
}

function getMilestoneLabel(dateStr: string): string {
  return MILESTONE_DATES.find(m => m.date === dateStr)?.label ?? 'MSCI milestone';
}

function getNextMilestoneHint(currentDateStr: string): string {
  const idx = MILESTONE_DATES.findIndex(m => m.date === currentDateStr);
  if (idx >= 0 && idx < MILESTONE_DATES.length - 1) {
    const next = MILESTONE_DATES[idx + 1]!;
    return `Next: set MSCI_REVIEW_DATE=${next.date} (${next.label})`;
  }
  return 'Final milestone — no further dates required.';
}

function main() {
  const now = new Date();
  const reviewDateStr = REVIEW_DATE.toISOString().slice(0, 10);
  const daysUntil = Math.ceil((REVIEW_DATE.getTime() - now.getTime()) / 86_400_000);

  if (daysUntil < -7) {
    console.log(`[msci-countdown] ${now.toISOString()} Milestone ${reviewDateStr} passed >7d ago. No action.`);
    console.log(`  → ${getNextMilestoneHint(reviewDateStr)}`);
    return;
  }

  const activeWindow = ALERT_WINDOWS.find(m => daysUntil <= m);
  if (activeWindow === undefined) {
    console.log(`[msci-countdown] ${now.toISOString()} T-${daysUntil}d until MSCI ${reviewDateStr} — next alert at T-60.`);
    return;
  }

  const state = loadState();

  // Reset state if REVIEW_DATE changed (operator advanced to next milestone)
  if (state.reviewDateTracked !== reviewDateStr) {
    state.firedMilestones = [];
    state.lastAlertAt = null;
    state.reviewDateTracked = reviewDateStr;
  }

  if (state.firedMilestones.includes(activeWindow)) {
    const cooledDown = state.lastAlertAt
      ? (now.getTime() - new Date(state.lastAlertAt).getTime()) / 3_600_000 >= COOLDOWN_H
      : true;
    if (!cooledDown) {
      console.log(`[msci-countdown] ${now.toISOString()} T-${daysUntil}d — window T-${activeWindow} already fired, in cooldown. Skip.`);
      return;
    }
  }

  const urgency = daysUntil <= 0 ? '🚨 TODAY' : daysUntil <= 7 ? '⚠️ THIS WEEK' : daysUntil <= 30 ? '⚠️' : '📅';
  const title = `${urgency} MSCI Indonesia — T-${Math.max(0, daysUntil)}d`;

  const statusEnv = (process.env.MSCI_CLASSIFICATION_STATUS ?? 'downgrade_risk');
  const statusNote =
    statusEnv === 'confirmed'      ? 'EM status confirmed — monitor for reversal' :
    statusEnv === 'downgrade_risk' ? '⚠️ DOWNGRADE RISK — Standalone consultation active' :
                                     'under_review — outcome uncertain';

  const milestoneLabel = getMilestoneLabel(reviewDateStr);
  const nextHint = getNextMilestoneHint(reviewDateStr);

  const body = [
    `Milestone: ${reviewDateStr} — ${milestoneLabel}`,
    `T-${Math.max(0, daysUntil)}d | Status: ${statusNote}`,
    `→ Check /bs + M5 foreign_flow_engine | ${nextHint}`,
  ].join('\n');

  console.log(`\n📅 [msci-countdown] MILESTONE T-${activeWindow} — ${now.toISOString()}`);
  console.log(`   Target: ${reviewDateStr} — ${milestoneLabel}`);
  console.log(`   Days until: ${daysUntil}`);
  console.log(`   Status: ${statusEnv}`);
  console.log(`   Next: ${nextHint}\n`);

  macosSend(title, body);

  if (!state.firedMilestones.includes(activeWindow)) {
    state.firedMilestones.push(activeWindow);
  }
  state.lastAlertAt = now.toISOString();
  saveState(state);
}

main();
