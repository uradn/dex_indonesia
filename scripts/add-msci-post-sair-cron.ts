/**
 * Registers update-msci-post-sair.ts as a crontab job.
 *
 * Schedule: 16:30 UTC = 23:30 WIB — fires Nov 12 2026 malam.
 * MSCI typically publishes SAIR at ~17:00 ET = 05:00 WIB Nov 13;
 * but press leaks sometimes earlier. Script is idempotent — once
 * MSCI_SAIR_DATE != 2026-11-12, it no-ops immediately.
 *
 * Also fires daily at same time until updated — safe if MSCI delays.
 *
 * Run once:
 *   bun scripts/add-msci-post-sair-cron.ts
 */

import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(__dir, '..');
const bunBin = '/Users/victoriuselvino/.bun/bin/bun';
const scriptPath = resolve(__dir, 'update-msci-post-sair.ts');
const logPath = resolve(projectDir, '.dexter', 'msci-post-sair.log');

// 16:30 UTC daily = 23:30 WIB — runs until script self-no-ops after update
const CRON_LINE = `30 16 * * * cd ${projectDir} && ${bunBin} ${scriptPath} >> ${logPath} 2>&1`;
const MARKER = 'update-msci-post-sair.ts';

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

console.log(`✓ Registered: msci-post-sair cron`);
console.log(`  Schedule: 30 16 * * * UTC → 23:30 WIB daily`);
console.log(`  Fires: Nov 12 2026 malam + daily until MSCI_SAIR_DATE updated`);
console.log(`  Log: ${logPath}`);
console.log(`\nVerify: crontab -l | grep msci-post-sair`);
console.log(`\nDry-run sekarang:`);
console.log(`  bun scripts/update-msci-post-sair.ts --dry-run`);
