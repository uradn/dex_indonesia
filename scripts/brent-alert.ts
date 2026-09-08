/**
 * Brent ICP threshold alert — runs every 4 hours via crontab.
 *
 * Checks live Brent price (Yahoo Finance BZ=F). If Brent > BRENT_ALERT_THRESHOLD
 * (default $99/bbl) AND no alert sent in last BRENT_ALERT_COOLDOWN_H hours (default 12h):
 *   - macOS notification (osascript)
 *   - Writes flag to .dexter/brent-alert-state.json (read by morning-check & dashboard)
 *   - Logs alert to stdout (captured by crontab mail / terminal)
 *
 * Register via crontab (run `crontab -e` and add):
 *   0 0,4,8,12,16,20 * * * cd /Users/victoriuselvino/Downloads/dexter && bun scripts/brent-alert.ts >> .dexter/brent-alert.log 2>&1
 *
 * Env vars:
 *   BRENT_ALERT_THRESHOLD   USD/bbl — default 99 (warn before Bahlil $100 breaks)
 *   BRENT_ALERT_COOLDOWN_H  hours between alerts — default 12 (no spam)
 */

import 'dotenv/config';
import YahooFinance from 'yahoo-finance2';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dexterPath } from '../src/utils/paths.js';

const THRESHOLD   = parseFloat(process.env.BRENT_ALERT_THRESHOLD  ?? '99');
const COOLDOWN_H  = parseFloat(process.env.BRENT_ALERT_COOLDOWN_H  ?? '12');
const STATE_FILE  = dexterPath('brent-alert-state.json');

interface AlertState {
  lastAlertAt:    string | null;   // ISO timestamp
  lastAlertBrent: number | null;
  lastCheckAt:    string | null;
  lastCheckBrent: number | null;
}

function loadState(): AlertState {
  if (existsSync(STATE_FILE)) {
    try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch {}
  }
  return { lastAlertAt: null, lastAlertBrent: null, lastCheckAt: null, lastCheckBrent: null };
}

function saveState(s: AlertState) {
  const dir = STATE_FILE.replace(/\/[^/]+$/, '');
  mkdirSync(dir, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

function macosSend(title: string, body: string) {
  try {
    const safe = (s: string) => s.replace(/"/g, '\\"');
    execSync(`osascript -e 'display notification "${safe(body)}" with title "${safe(title)}" sound name "Glass"'`);
  } catch { /* non-Mac or osascript unavailable — silent */ }
}

async function main() {
  const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
  const now = new Date();

  let brent: number | null = null;
  try {
    const q = await yf.quote('BZ=F');
    brent = q.regularMarketPrice ?? null;
  } catch (e) {
    console.error(`[brent-alert] Yahoo fetch failed: ${e}`);
    process.exit(1);
  }

  if (brent === null) {
    console.error('[brent-alert] Brent price null — skipping');
    process.exit(1);
  }

  const state = loadState();
  state.lastCheckAt    = now.toISOString();
  state.lastCheckBrent = brent;

  const margin = THRESHOLD - brent;
  const breached = brent >= THRESHOLD;

  // Cooldown check — don't re-alert within COOLDOWN_H
  let cooledDown = true;
  if (state.lastAlertAt) {
    const elapsed = (now.getTime() - new Date(state.lastAlertAt).getTime()) / 3_600_000;
    cooledDown = elapsed >= COOLDOWN_H;
  }

  if (!breached) {
    console.log(`[brent-alert] ${now.toISOString()} Brent $${brent.toFixed(2)} — below $${THRESHOLD} threshold (margin $${(-margin).toFixed(2)}/bbl). OK.`);
    saveState(state);
    return;
  }

  if (!cooledDown) {
    console.log(`[brent-alert] ${now.toISOString()} Brent $${brent.toFixed(2)} — THRESHOLD BREACHED but in cooldown (last alert: ${state.lastAlertAt}). Skipping.`);
    saveState(state);
    return;
  }

  // 🚨 Alert fires
  const title = `🚨 ICP ALERT: Brent $${brent.toFixed(2)}/bbl`;
  const body  = [
    `Brent $${brent.toFixed(2)} ≥ $${THRESHOLD} threshold`,
    `Margin ke Bahlil $100: $${(100 - brent).toFixed(2)}/bbl`,
    `Perlu: cek M11 domestic pressure + Hormuz status`,
    `→ Arm thesis ICP_threshold_breach?`,
  ].join('\n');

  console.log(`\n🚨 [brent-alert] THRESHOLD BREACHED — ${now.toISOString()}`);
  console.log(`   Brent: $${brent.toFixed(2)}/bbl (threshold: $${THRESHOLD})`);
  console.log(`   Margin ke Bahlil $100: $${(100 - brent).toFixed(2)}/bbl`);
  console.log(`   → Check dashboard /bs + arm ICP thesis\n`);

  macosSend(title, body);

  state.lastAlertAt    = now.toISOString();
  state.lastAlertBrent = brent;
  saveState(state);
}

main();
