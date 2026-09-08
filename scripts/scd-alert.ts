/**
 * SCD (Silent Crisis Detector) RED alert — run after morning-check to detect threshold breach.
 *
 * Reads latest module scores from macro_scores DB (written by morning-check/SCD run).
 * If SCD weighted score ≥ SCD_ALERT_THRESHOLD (default 75 = RED zone) AND not alerted
 * within SCD_ALERT_COOLDOWN_H hours → macOS notification + flag file.
 *
 * Also alerts if N_MODULES_RED ≥ SCD_RED_MODULES_THRESHOLD (default 3) modules simultaneously RED.
 *
 * Register via crontab to run after morning-check (e.g. 08:30 WIB = 01:30 UTC):
 *   30 1 * * 1-5 cd /path/to/dexter && bun scripts/scd-alert.ts >> .dexter/scd-alert.log 2>&1
 *
 * Env vars:
 *   SCD_ALERT_THRESHOLD       SCD score — default 75 (RED zone)
 *   SCD_RED_MODULES_THRESHOLD simultaneous RED modules — default 3
 *   SCD_ALERT_COOLDOWN_H      hours between repeat alerts — default 24
 */

import 'dotenv/config';
import { getLatestModuleScores } from '../src/tools/macro/time-series-db.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dexterPath } from '../src/utils/paths.js';

const SCD_THRESHOLD    = parseFloat(process.env.SCD_ALERT_THRESHOLD       ?? '75');
const RED_MOD_THRESH   = parseInt(process.env.SCD_RED_MODULES_THRESHOLD   ?? '3', 10);
const COOLDOWN_H       = parseFloat(process.env.SCD_ALERT_COOLDOWN_H      ?? '24');
const STATE_FILE       = dexterPath('scd-alert-state.json');

// SCD weights — must match silent_crisis_detector in registry.ts
const SCD_WEIGHTS: Record<string, number> = {
  fx_defense:      0.16,
  bop:             0.10,
  sovereign_risk:  0.10,
  foreign_flow:    0.10,
  commodity:       0.08,
  fiscal:          0.10,
  banking:         0.08,
  market:          0.05,
  domestic_pressure: 0.08,
  political_risk:  0.10,
  uln:             0.05,
};

interface AlertState {
  lastAlertAt:   string | null;
  lastAlertScd:  number | null;
  lastAlertMods: string[] | null;
  lastCheckAt:   string | null;
  lastCheckScd:  number | null;
}

function loadState(): AlertState {
  if (existsSync(STATE_FILE)) {
    try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch {}
  }
  return { lastAlertAt: null, lastAlertScd: null, lastAlertMods: null, lastCheckAt: null, lastCheckScd: null };
}

function saveState(s: AlertState) {
  const dir = STATE_FILE.replace(/\/[^/]+$/, '');
  mkdirSync(dir, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

function macosSend(title: string, body: string) {
  try {
    const safe = (s: string) => s.replace(/"/g, '\\"');
    execSync(`osascript -e 'display notification "${safe(body)}" with title "${safe(title)}" sound name "Basso"'`);
  } catch { /* non-Mac or osascript unavailable */ }
}

async function main() {
  const now = new Date();
  const scores = await getLatestModuleScores();

  if (Object.keys(scores).length === 0) {
    console.log(`[scd-alert] ${now.toISOString()} No module scores in DB — run morning-check first.`);
    process.exit(0);
  }

  // Compute weighted SCD score
  let scdScore = 0;
  let totalWeight = 0;
  const redModules: string[] = [];

  for (const [mod, weight] of Object.entries(SCD_WEIGHTS)) {
    const s = scores[mod];
    if (!s) continue;
    scdScore += s.score * weight;
    totalWeight += weight;
    if (s.alertLevel === 'red') redModules.push(`${mod}[${s.score}]`);
  }
  if (totalWeight > 0) scdScore = Math.round(scdScore / totalWeight * 100) / 100;

  const scdPct = Math.round(scdScore);
  const redCount = redModules.length;

  const state = loadState();
  state.lastCheckAt  = now.toISOString();
  state.lastCheckScd = scdPct;

  const breachScore = scdPct >= SCD_THRESHOLD;
  const breachMods  = redCount >= RED_MOD_THRESH;
  const breached    = breachScore || breachMods;

  // Cooldown check
  let cooledDown = true;
  if (state.lastAlertAt) {
    const elapsed = (now.getTime() - new Date(state.lastAlertAt).getTime()) / 3_600_000;
    cooledDown = elapsed >= COOLDOWN_H;
  }

  if (!breached) {
    console.log(`[scd-alert] ${now.toISOString()} SCD ${scdPct}% (${redCount} RED mods) — below thresholds (${SCD_THRESHOLD}% / ${RED_MOD_THRESH} RED). OK.`);
    saveState(state);
    return;
  }

  if (!cooledDown) {
    console.log(`[scd-alert] ${now.toISOString()} SCD ${scdPct}% — BREACHED but in cooldown (last: ${state.lastAlertAt}). Skip.`);
    saveState(state);
    return;
  }

  // 🚨 Alert
  const reasons: string[] = [];
  if (breachScore) reasons.push(`SCD ${scdPct}% ≥ ${SCD_THRESHOLD}% RED threshold`);
  if (breachMods)  reasons.push(`${redCount} modul RED (threshold ${RED_MOD_THRESH})`);

  const title = `🚨 SILENT CRISIS ALERT — SCD ${scdPct}%`;
  const body  = [
    reasons.join(' | '),
    `RED modules: ${redModules.join(', ')}`,
    `→ Check dashboard /bs — arm thesis?`,
  ].join('\n');

  console.log(`\n🚨 [scd-alert] BREACHED — ${now.toISOString()}`);
  console.log(`   SCD: ${scdPct}% | RED modules: ${redCount} → ${redModules.join(', ')}`);
  console.log(`   Reasons: ${reasons.join(' | ')}`);
  console.log(`   → Check dashboard /bs\n`);

  macosSend(title, body);

  state.lastAlertAt   = now.toISOString();
  state.lastAlertScd  = scdPct;
  state.lastAlertMods = redModules;
  saveState(state);
}

main().catch(err => { console.error(err); process.exit(1); });
