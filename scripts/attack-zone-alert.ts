/**
 * Morris-Shin Attack Zone alert — run after morning-check to detect gate crossing.
 *
 * Reads gateZone from macro_scores DB (fx_defense components, written by SCD/morning-check).
 * Attack Zone = DC > AC by >20pts → dominant strategy = attack regardless of coordination.
 * This is qualitatively different from VULNERABILITY ZONE — communication/SRBI alone cannot deter.
 *
 * Fires macOS notification + flag file when gateZone transitions to 'attack'.
 * Cooldown: ATTACK_ZONE_COOLDOWN_H (default 12h) — repeats if gate stays in attack zone.
 *
 * Register to run after morning-check (e.g. 08:35 WIB = 01:35 UTC):
 *   35 1 * * 1-5 cd /path/to/dexter && bun scripts/attack-zone-alert.ts >> .dexter/attack-zone-alert.log 2>&1
 *
 * Env:
 *   ATTACK_ZONE_COOLDOWN_H   hours between repeat alerts while in attack zone — default 12
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dir = dirname(fileURLToPath(import.meta.url));
process.chdir(resolve(__dir, '..'));

import 'dotenv/config';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dexterPath } from '../src/utils/paths.js';
import Database from 'better-sqlite3';
import { resolve as resolvePath } from 'node:path';

const COOLDOWN_H  = parseFloat(process.env.ATTACK_ZONE_COOLDOWN_H ?? '12');
const STATE_FILE  = dexterPath('attack-zone-alert-state.json');

interface AlertState {
  lastAlertAt:  string | null;
  lastZone:     string | null;
  lastNet:      number | null;
  lastCheckAt:  string | null;
}

function loadState(): AlertState {
  if (!existsSync(STATE_FILE)) return { lastAlertAt: null, lastZone: null, lastNet: null, lastCheckAt: null };
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return { lastAlertAt: null, lastZone: null, lastNet: null, lastCheckAt: null }; }
}

function saveState(s: AlertState): void {
  const dir = dexterPath('');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

function notify(title: string, body: string): void {
  if (process.platform !== 'darwin') { console.log(`[ALERT] ${title}: ${body}`); return; }
  const safe = (s: string) => s.replace(/"/g, '\\"').replace(/'/g, "\\'");
  try {
    execSync(`osascript -e 'display notification "${safe(body)}" with title "${safe(title)}" sound name "Sosumi"'`);
  } catch {
    console.error('osascript failed');
  }
}

function getGateFromDb(): { zone: string | null; net: number | null; score: number | null } {
  const dbPath = resolvePath('.dexter', 'macro.db');
  if (!existsSync(dbPath)) return { zone: null, net: null, score: null };
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare(
      `SELECT score, components FROM macro_scores
       WHERE module = 'fx_defense'
       AND score_date = (SELECT MAX(score_date) FROM macro_scores WHERE module = 'fx_defense')`
    ).get() as { score: number; components: string } | undefined;
    if (!row) return { zone: null, net: null, score: null };
    let zone: string | null = null;
    let net: number | null = null;
    try {
      const comp = JSON.parse(row.components || '{}');
      zone = comp.gateZone ?? null;
      net  = comp.gateNet  ?? null;
    } catch {}
    return { zone, net, score: row.score };
  } finally {
    db.close();
  }
}

async function main() {
  const now = new Date();
  const { zone, net, score } = getGateFromDb();
  const state = loadState();

  console.log(`[attack-zone-alert] ${now.toISOString()} | gateZone=${zone ?? 'unknown'} net=${net ?? '?'} m3Score=${score ?? '?'}`);

  state.lastCheckAt = now.toISOString();
  state.lastZone    = zone;
  state.lastNet     = net;

  if (zone !== 'attack') {
    console.log(`Gate not in attack zone (${zone ?? 'unknown'}) — no alert.`);
    saveState(state);
    return;
  }

  // Check cooldown
  if (state.lastAlertAt) {
    const elapsed = (now.getTime() - new Date(state.lastAlertAt).getTime()) / 3_600_000;
    if (elapsed < COOLDOWN_H) {
      console.log(`In cooldown (${elapsed.toFixed(1)}h < ${COOLDOWN_H}h) — skipping.`);
      saveState(state);
      return;
    }
  }

  const netStr = net !== null ? (net > 0 ? `+${net}` : String(net)) : '?';
  notify(
    '🚨 Morris-Shin ATTACK ZONE (M3)',
    `DC${netStr} > AC — attack dominant regardless of coordination. M3=${score}/100. SRBI demand check: bid-cover threshold <1.5x.`
  );
  console.log(`[attack-zone-alert] ALERT FIRED — gateZone=attack DC${netStr} M3=${score}`);
  state.lastAlertAt = now.toISOString();
  saveState(state);
}

main().catch(console.error);
