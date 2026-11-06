/**
 * Post-SAIR MSCI env auto-updater.
 *
 * Run after MSCI Semi-Annual Index Review (SAIR) announcement.
 * Registered via crontab to fire Nov 12 2026 23:30 WIB (16:30 UTC)
 * — after MSCI typically publishes at ~17:00 ET = 05:00 WIB Nov 13.
 * Also registered as daily check until MSCI_SAIR_DATE is updated.
 *
 * What it does:
 * 1. Checks if MSCI_SAIR_DATE has passed and still points to 2026-11-12
 * 2. If yes: searches Exa for MSCI press release to detect scenario
 * 3. Updates .env: MSCI_SAIR_DATE + MSCI_REVIEW_DATE (always)
 *    + MSCI_CLASSIFICATION_STATUS (if Exa detects scenario B/C)
 * 4. Logs what changed
 *
 * Idempotent: once MSCI_SAIR_DATE != 2026-11-12, script is a no-op.
 *
 * Usage:
 *   bun scripts/update-msci-post-sair.ts              # auto-detect + update
 *   bun scripts/update-msci-post-sair.ts --dry-run    # print what would change
 *   bun scripts/update-msci-post-sair.ts --scenario=A # force scenario A/B/C
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '..'));

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE_SCENARIO = process.argv.find(a => a.startsWith('--scenario='))?.split('=')[1] as 'A' | 'B' | 'C' | undefined;

const SAIR_OLD_DATE = '2026-11-12';
const NEXT_SAIR_DATE = '2027-05-08';        // 2nd Thursday May 2027 (estimate — verify from MSCI press release)
const NEXT_REVIEW_DATE = '2027-04-30';      // consultation closes Apr 30 2027

// Exa search for MSCI Nov 12 2026 press release
const MSCI_SEARCH_QUERY = 'MSCI November 2026 Semi-Annual Index Review Indonesia Standalone consultation result announcement';
const MSCI_DOMAINS = ['msci.com', 'bloomberg.com', 'reuters.com', 'ft.com', 'wsj.com', 'nikkei.com'];

// Language patterns for scenario detection
const SCENARIO_B_PATTERNS = [
  /acknowledges? (progress|improvement)/i,
  /conditional(ly)? (maintain|extend)/i,
  /significant(ly)? improve/i,
  /open to reconsider/i,
  /evidence of (material )?improvement/i,
];
const SCENARIO_C_PATTERNS = [
  /halt(ing|ed)? (standalone|reclassification)/i,
  /reaffirm(s|ed)? emerging market/i,
  /withdraw(ing|n)? (standalone|consultation)/i,
  /not proceed with (standalone|reclassification)/i,
  /remain(s|ing)? emerging market/i,
];

function readEnv(): string {
  try {
    return readFileSync('.env', 'utf8');
  } catch {
    throw new Error('.env not found — run from project root');
  }
}

function getEnvValue(content: string, key: string): string | null {
  const m = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m?.[1]?.trim() ?? null;
}

function setEnvValue(content: string, key: string, value: string): string {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`^${key}=`, 'm').test(content)) {
    return content.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);
  }
  return content.trimEnd() + `\n${key}=${value}\n`;
}

function removeEnvKey(content: string, key: string): string {
  return content.replace(new RegExp(`^${key}=.*\n?`, 'm'), '');
}

async function detectScenario(): Promise<'A' | 'B' | 'C' | null> {
  const apiKey = process.env.EXASEARCH_API_KEY;
  if (!apiKey) {
    console.log('⚠ No EXASEARCH_API_KEY — cannot auto-detect scenario');
    return null;
  }
  try {
    const { default: Exa } = await import('exa-js');
    const exa = new Exa(apiKey);
    const resp = await exa.search(MSCI_SEARCH_QUERY, {
      numResults: 5,
      includeDomains: MSCI_DOMAINS,
      startPublishedDate: new Date(Date.now() - 3 * 86_400_000).toISOString(), // last 3 days
      type: 'keyword',
      useAutoprompt: false,
    } as Parameters<typeof exa.search>[1]);

    const texts = (resp.results ?? []).map(r => `${r.title ?? ''} ${r.text ?? ''}`).join(' ');

    if (texts.length < 50) {
      console.log('⚠ Exa: no MSCI press release found yet — try again later');
      return null;
    }

    for (const p of SCENARIO_C_PATTERNS) {
      if (p.test(texts)) {
        console.log(`Scenario C detected: pattern "${p.source}" matched`);
        return 'C';
      }
    }
    for (const p of SCENARIO_B_PATTERNS) {
      if (p.test(texts)) {
        console.log(`Scenario B detected: pattern "${p.source}" matched`);
        return 'B';
      }
    }

    console.log('Scenario A (default): no B/C language detected');
    return 'A';
  } catch (e) {
    console.log(`⚠ Exa error: ${String(e).slice(0, 80)}`);
    return null;
  }
}

async function main() {
  const env = readEnv();
  const currentSairDate = getEnvValue(env, 'MSCI_SAIR_DATE');
  const today = new Date().toISOString().slice(0, 10);

  console.log(`MSCI Post-SAIR Updater — ${today}`);
  console.log(`Current MSCI_SAIR_DATE: ${currentSairDate ?? '(not set)'}`);

  // Already updated — no-op (null = not set = using code default 2026-11-12)
  if (currentSairDate !== null && currentSairDate !== SAIR_OLD_DATE) {
    console.log('✓ MSCI_SAIR_DATE already updated — nothing to do.');
    process.exit(0);
  }

  // Not yet past SAIR date — wait
  if (today < SAIR_OLD_DATE) {
    console.log(`⏳ SAIR date ${SAIR_OLD_DATE} not yet reached (today: ${today}) — no action.`);
    process.exit(0);
  }

  // Detect or force scenario
  const scenario = FORCE_SCENARIO ?? (await detectScenario()) ?? 'A';
  console.log(`\nScenario: ${scenario}`);

  const changes: string[] = [];
  let updated = env;

  // Always: shift SAIR + review dates
  updated = setEnvValue(updated, 'MSCI_SAIR_DATE', NEXT_SAIR_DATE);
  changes.push(`MSCI_SAIR_DATE: ${SAIR_OLD_DATE} → ${NEXT_SAIR_DATE}`);

  updated = setEnvValue(updated, 'MSCI_REVIEW_DATE', NEXT_REVIEW_DATE);
  const prevReview = getEnvValue(env, 'MSCI_REVIEW_DATE');
  if (prevReview !== NEXT_REVIEW_DATE) {
    changes.push(`MSCI_REVIEW_DATE: ${prevReview ?? '(not set)'} → ${NEXT_REVIEW_DATE}`);
  }

  // Scenario-specific
  if (scenario === 'B') {
    updated = setEnvValue(updated, 'MSCI_CLASSIFICATION_STATUS', 'under_review');
    updated = setEnvValue(updated, 'MSCI_REVERSAL_PROBABILITY_OVERRIDE', '0.20');
    changes.push(`MSCI_CLASSIFICATION_STATUS: downgrade_risk → under_review`);
    changes.push(`MSCI_REVERSAL_PROBABILITY_OVERRIDE: set → 0.20`);
  } else if (scenario === 'C') {
    updated = setEnvValue(updated, 'MSCI_CLASSIFICATION_STATUS', 'confirmed');
    updated = removeEnvKey(updated, 'MSCI_REVERSAL_PROBABILITY_OVERRIDE');
    changes.push(`MSCI_CLASSIFICATION_STATUS: downgrade_risk → confirmed`);
    changes.push(`MSCI_REVERSAL_PROBABILITY_OVERRIDE: removed`);
  }
  // Scenario A: classification stays downgrade_risk, override stays unset

  console.log('\nChanges:');
  for (const c of changes) console.log(`  • ${c}`);

  if (DRY_RUN) {
    console.log('\n[dry-run] No changes written.');
    process.exit(0);
  }

  writeFileSync('.env', updated, 'utf8');
  console.log('\n✓ .env updated.');

  if (scenario !== 'A') {
    console.log(`\n⚠ Scenario ${scenario} — VERIFY manually:`);
    if (scenario === 'B') console.log('  Check MSCI press release language before keeping under_review + 0.20 override');
    if (scenario === 'C') console.log('  Confirm MSCI explicitly stated EM status retained — then kill Thesis #14 KS#2');
  }

  console.log('\nNext: run morning check to see updated M5 score:');
  console.log('  bun scripts/morning-check.ts');
  console.log('\nSee doc/msci-sair-nov12-checklist.md for full scenario guide.');
}

main().catch(e => { console.error(e); process.exit(1); });
