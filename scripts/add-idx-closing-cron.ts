/**
 * Registers idx-closing-check.ts as a crontab job.
 *
 * Schedule: 09:05 UTC = 16:05 WIB — 15 minutes after IDX session closes (15:50 WIB).
 * Yahoo Finance ^JKSE 15-20min delay → data reflects session close by 16:05 WIB.
 *
 * Run once:
 *   bun scripts/add-idx-closing-cron.ts
 */

import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(__dir, '..');
const bunBin = '/Users/victoriuselvino/.bun/bin/bun';
const scriptPath = resolve(__dir, 'idx-closing-check.ts');
const logPath = resolve(projectDir, '.dexter', 'idx-closing.log');

// 09:05 UTC Mon-Fri = 16:05 WIB
const CRON_LINE = `5 9 * * 1-5 cd ${projectDir} && ${bunBin} ${scriptPath} >> ${logPath} 2>&1`;
const MARKER = 'idx-closing-check.ts';

let existing = '';
try {
  existing = execSync('crontab -l 2>/dev/null', { encoding: 'utf8' });
} catch {
  // no existing crontab
}

if (existing.includes(MARKER)) {
  console.log(`✓ Already registered — crontab contains '${MARKER}'. No change.`);
  process.exit(0);
}

const updated = existing.trimEnd() + (existing.trimEnd() ? '\n' : '') + CRON_LINE + '\n';
execSync(`echo ${JSON.stringify(updated)} | crontab -`);

console.log(`✓ Registered: idx-closing-check cron`);
console.log(`  Schedule: 5 9 * * 1-5 UTC → 16:05 WIB Mon–Fri`);
console.log(`  Fires: 15 min after IDX session close (15:50 WIB)`);
console.log(`  Log: ${logPath}`);
console.log(`\nVerify: crontab -l | grep idx-closing`);
console.log(`\nManual run sekarang:`);
console.log(`  bun scripts/idx-closing-check.ts`);
