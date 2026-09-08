/**
 * MSCI Nov 2026 countdown alert — macOS notification at T-60, T-30, T-7, and day-of.
 *
 * MSCI Global Market Accessibility Review extended to Nov 12 2026.
 * Indonesia EM status maintained Jun 23 2026 but outcome still uncertain.
 * Alert fires once per milestone; re-fires after 48h cooldown if still in window.
 *
 * Run via crontab daily at 08:00 WIB (01:00 UTC):
 *   0 1 * * 1-5 /Users/victoriuselvino/.bun/bin/bun scripts/msci-countdown.ts >> /Users/victoriuselvino/Downloads/dexter/.dexter/msci-countdown.log 2>&1
 *
 * Env vars:
 *   MSCI_REVIEW_DATE        ISO date of next review — default 2026-11-12
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

const REVIEW_DATE   = new Date(process.env.MSCI_REVIEW_DATE ?? '2026-11-12');
const COOLDOWN_H    = parseFloat(process.env.MSCI_ALERT_COOLDOWN_H ?? '48');
const STATE_FILE    = dexterPath('msci-countdown-state.json');

// Milestones in days-before (ascending): pick smallest milestone we've reached
const MILESTONES = [0, 7, 30, 60];

interface CountdownState {
  firedMilestones: number[];   // days-before milestones already fired
  lastAlertAt: string | null;
}

function loadState(): CountdownState {
  if (existsSync(STATE_FILE)) {
    try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch {}
  }
  return { firedMilestones: [], lastAlertAt: null };
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

function main() {
  const now = new Date();
  const daysUntil = Math.ceil((REVIEW_DATE.getTime() - now.getTime()) / 86_400_000);
  const reviewDateStr = REVIEW_DATE.toISOString().slice(0, 10);

  if (daysUntil < -7) {
    console.log(`[msci-countdown] ${now.toISOString()} Review date ${reviewDateStr} passed >7d ago. No action.`);
    return;
  }

  // Find tightest milestone: smallest M where daysUntil <= M (MILESTONES already ascending)
  const activeMilestone = MILESTONES.find(m => daysUntil <= m);
  if (activeMilestone === undefined) {
    console.log(`[msci-countdown] ${now.toISOString()} T-${daysUntil}d until MSCI ${reviewDateStr} — next alert at T-60.`);
    return;
  }

  const state = loadState();

  // Already fired this milestone?
  if (state.firedMilestones.includes(activeMilestone)) {
    // Check cooldown for re-fire within same window
    const cooledDown = state.lastAlertAt
      ? (now.getTime() - new Date(state.lastAlertAt).getTime()) / 3_600_000 >= COOLDOWN_H
      : true;
    if (!cooledDown) {
      console.log(`[msci-countdown] ${now.toISOString()} T-${daysUntil}d — milestone T-${activeMilestone} already fired, in cooldown. Skip.`);
      return;
    }
  }

  // Compose alert
  const urgency = daysUntil <= 0 ? '🚨 TODAY' : daysUntil <= 7 ? '⚠️ THIS WEEK' : daysUntil <= 30 ? '⚠️' : '📅';
  const title = `${urgency} MSCI Indonesia Review — T-${Math.max(0, daysUntil)}d`;

  const statusEnv = (process.env.MSCI_CLASSIFICATION_STATUS ?? 'under_review');
  const statusNote =
    statusEnv === 'confirmed'      ? 'EM status confirmed Jun 23 — extended review still active' :
    statusEnv === 'downgrade_risk' ? '⚠️ DOWNGRADE RISK — frontier reclassification possible' :
                                     'under_review — outcome uncertain';

  const body = [
    `Review: ${reviewDateStr} (${daysUntil <= 0 ? 'TODAY' : `${daysUntil}d`}) | Status: ${statusNote}`,
    `Key risks: free-float <15%, CPIN/GOTO removal, passive outflow ~$1.8bn`,
    `→ Check /bs + foreign_flow_engine M5 signal`,
  ].join('\n');

  console.log(`\n📅 [msci-countdown] MILESTONE T-${activeMilestone} — ${now.toISOString()}`);
  console.log(`   Days until MSCI review (${reviewDateStr}): ${daysUntil}`);
  console.log(`   Status env: ${statusEnv}`);
  console.log(`   → Check M5 foreign flow + /bs dashboard\n`);

  macosSend(title, body);

  if (!state.firedMilestones.includes(activeMilestone)) {
    state.firedMilestones.push(activeMilestone);
  }
  state.lastAlertAt = now.toISOString();
  saveState(state);
}

main();
