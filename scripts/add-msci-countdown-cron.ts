/**
 * Registers msci-countdown.ts as a daily system crontab job.
 *
 * Fires every weekday at 08:00 WIB (01:00 UTC).
 * Alerts at T-60, T-30, T-7, T-0 before MSCI review date (Nov 12 2026).
 *
 * Run once to register (idempotent — skips if already present):
 *   bun scripts/add-msci-countdown-cron.ts
 */

import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(__dir, '..');
const bunBin = '/Users/victoriuselvino/.bun/bin/bun';
const scriptPath = resolve(__dir, 'msci-countdown.ts');
const logPath = resolve(projectDir, '.dexter', 'msci-countdown.log');

const CRON_LINE = `0 1 * * 1-5 ${bunBin} ${scriptPath} >> ${logPath} 2>&1`;
const MARKER = 'msci-countdown.ts';

let existing = '';
try {
  existing = execSync('crontab -l 2>/dev/null', { encoding: 'utf8' });
} catch {
  // no existing crontab — start fresh
}

if (existing.includes(MARKER)) {
  console.log(`✓ Already registered — crontab contains '${MARKER}'. No change.`);
  process.exit(0);
}

const updated = existing.trimEnd() + (existing.trimEnd() ? '\n' : '') + CRON_LINE + '\n';
execSync(`echo ${JSON.stringify(updated)} | crontab -`);

console.log(`✓ Registered: msci-countdown daily cron`);
console.log(`  Schedule: 0 1 * * 1-5 UTC → 08:00 WIB Mon-Fri`);
console.log(`  Milestones: T-60, T-30, T-7, T-0 before MSCI Nov 12 2026`);
console.log(`  Log: ${logPath}`);
console.log(`\nVerify: crontab -l | grep msci`);
