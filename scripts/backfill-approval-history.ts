/**
 * Backfill presidential approval rating history.
 *
 * Addresses the >9-month gap problem with 3 tiers:
 *   1. Auto mode:        Exa/Tavily batch fetch per month (works ~60-70% for last 9 months)
 *   2. Interactive mode: Prompt user to manually enter gaps (--interactive)
 *   3. CSV import:       Bulk import from spreadsheet (--csv=path.csv)
 *
 * CSV format (no header required, but accepted):
 *   date,value,source
 *   2026-03,72.5,poltracking
 *   2026-04,71.0,lsi
 *   (date can be YYYY-MM or YYYY-MM-DD; value = approval %; source = optional label)
 *
 * Usage:
 *   bun scripts/backfill-approval-history.ts
 *   bun scripts/backfill-approval-history.ts --from=2025-10 --to=2026-09
 *   bun scripts/backfill-approval-history.ts --dry-run
 *   bun scripts/backfill-approval-history.ts --interactive
 *   bun scripts/backfill-approval-history.ts --csv=data/approval-history.csv
 *   bun scripts/backfill-approval-history.ts --min-confidence=70  (skip auto-stored if already ≥N)
 */

import { fetchApprovalViaExa, fetchApprovalViaTavily, storeApprovalPoint } from '../src/tools/macro/sources/approval-rating.js';
import { getLastN, upsertPoints } from '../src/tools/macro/time-series-db.js';
import { createInterface } from 'readline';
import { existsSync, readFileSync } from 'fs';

const args = process.argv.slice(2);
const DRY_RUN    = args.includes('--dry-run');
const INTERACTIVE = args.includes('--interactive');
const CSV_PATH   = args.find(a => a.startsWith('--csv='))?.slice(6) ?? null;
const FROM_ARG   = args.find(a => a.startsWith('--from='))?.slice(7) ?? null;
const TO_ARG     = args.find(a => a.startsWith('--to='))?.slice(5) ?? null;
const MIN_CONF   = parseInt(args.find(a => a.startsWith('--min-confidence='))?.slice(17) ?? '0');
// --interactive prompts when confidence < INTERACTIVE_PROMPT_THRESHOLD (even if result found)
const INTERACTIVE_PROMPT_THRESHOLD = parseInt(args.find(a => a.startsWith('--prompt-below='))?.slice(15) ?? '60');

// Domains known to return noisy generic content, not survey results
const BLOCKED_DOMAINS = ['bitvonline.com'];

// ── Month iteration helpers ───────────────────────────────────────────────────

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  const cur = new Date(`${from}-01`);
  const end = new Date(`${to}-01`);
  while (cur <= end) {
    months.push(monthKey(cur));
    cur.setMonth(cur.getMonth() + 1);
  }
  return months;
}

function defaultFrom(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 12);
  return monthKey(d);
}

function defaultTo(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1); // last completed month
  return monthKey(d);
}

// ── CSV import ───────────────────────────────────────────────────────────────

interface CsvRow { month: string; value: number; source: string }

function parseCsv(path: string): CsvRow[] {
  const text = readFileSync(path, 'utf-8');
  const rows: CsvRow[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(',').map(s => s.trim());
    const rawDate = parts[0] ?? '';
    const rawVal  = parts[1] ?? '';
    const rawSrc  = parts[2] ?? 'csv_import';
    // Accept YYYY-MM or YYYY-MM-DD
    const month = rawDate.length >= 7 ? rawDate.slice(0, 7) : null;
    const value = parseFloat(rawVal);
    if (!month || isNaN(value) || value < 30 || value > 100) continue;
    if (month === 'date') continue; // skip header row if present
    rows.push({ month, value, source: rawSrc });
  }
  return rows;
}

// ── Interactive prompt ────────────────────────────────────────────────────────

async function promptManual(monthWithHint: string): Promise<number | null> {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(
      `  → Enter approval % for ${monthWithHint} (or press Enter to skip): `,
      answer => {
        rl.close();
        const val = parseFloat(answer.trim());
        if (!isNaN(val) && val >= 30 && val <= 100) resolve(val);
        else resolve(null);
      },
    );
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

const fromMonth = FROM_ARG ?? defaultFrom();
const toMonth   = TO_ARG   ?? defaultTo();
const months    = monthsBetween(fromMonth, toMonth);

console.log(`\n# Approval Rating Backfill — ${fromMonth} → ${toMonth} (${months.length} months)`);
if (DRY_RUN)    console.log('  [DRY RUN — no DB writes]');
if (INTERACTIVE) console.log('  [INTERACTIVE — will prompt for gaps]');
if (CSV_PATH)   console.log(`  [CSV IMPORT from ${CSV_PATH}]`);
console.log('');

// ── CSV import path ───────────────────────────────────────────────────────────
if (CSV_PATH) {
  if (!existsSync(CSV_PATH)) {
    console.error(`CSV file not found: ${CSV_PATH}`);
    process.exit(1);
  }
  const csvRows = parseCsv(CSV_PATH);
  console.log(`Importing ${csvRows.length} rows from CSV...`);
  for (const row of csvRows) {
    console.log(`  ${row.month}  ${row.value}%  [${row.source}]`);
    if (!DRY_RUN) {
      await upsertPoints([{
        indicator: 'prabowo_approval_pct',
        category: 'sovereign' as const,
        date: `${row.month}-01`,
        value: row.value,
        unit: 'pct',
        source: `csv:${row.source}`,
        fetchedAt: new Date().toISOString(),
      }]);
    }
  }
  console.log(`\n✓ CSV import done (${csvRows.length} rows${DRY_RUN ? ', dry run' : ' written'}).`);
  process.exit(0);
}

// ── Check which months are already in DB ─────────────────────────────────────
const existing = await getLastN('prabowo_approval_pct', 36);
const existingByMonth = new Map(existing.map(p => [p.date.slice(0, 7), p]));

// ── Batch auto-fetch then gap report ─────────────────────────────────────────
type ResultStatus = 'existing' | 'found' | 'gap' | 'skipped';
const results: Array<{ month: string; status: ResultStatus; value: number | null; confidence: number; source: string }> = [];

for (const month of months) {
  const existing_ = existingByMonth.get(month);
  if (existing_) {
    results.push({ month, status: 'existing', value: existing_.value, confidence: 80, source: existing_.source });
    continue;
  }

  process.stdout.write(`  Fetching ${month}...`);

  // Lookback for older months: extend window to cover the target month's media cycle
  const monthDate   = new Date(`${month}-01`);
  const daysAgo     = Math.ceil((Date.now() - monthDate.getTime()) / 86_400_000);
  const lookback    = Math.min(daysAgo + 45, 400); // 45d buffer after month end

  let rawPoint = (await fetchApprovalViaExa(lookback, month)) ?? (await fetchApprovalViaTavily(month));

  // Block known noisy domains (same article returned for many different month queries)
  if (rawPoint && BLOCKED_DOMAINS.some(d => rawPoint!.source.includes(d))) {
    console.log(` ✗ blocked domain (${rawPoint.source.slice(0, 60)}) — treating as gap`);
    rawPoint = null;
  }

  const point = rawPoint;
  const isLowConf = point !== null && point.confidence < INTERACTIVE_PROMPT_THRESHOLD;
  const shouldPrompt = INTERACTIVE && (point === null || isLowConf);

  if (point && !isLowConf && point.confidence >= MIN_CONF) {
    console.log(` ✓ ${point.approvalPct}% (conf=${point.confidence}% pollsters=${point.pollsters.join('+') || 'none'})`);
    if (!DRY_RUN) await storeApprovalPoint(point);
    results.push({ month, status: 'found', value: point.approvalPct, confidence: point.confidence, source: point.source });
  } else if (point && !isLowConf) {
    console.log(` ⚠ ${point.approvalPct}% LOW CONF ${point.confidence}% (below --min-confidence=${MIN_CONF}, skipped)`);
    results.push({ month, status: 'skipped', value: point.approvalPct, confidence: point.confidence, source: point.source });
  } else {
    if (point && isLowConf) {
      console.log(` ⚠ ${point.approvalPct}% LOW CONF ${point.confidence}% (pollsters=${point.pollsters.join('+') || 'none'} — below prompt threshold ${INTERACTIVE_PROMPT_THRESHOLD}%)`);
      results.push({ month, status: 'skipped', value: point.approvalPct, confidence: point.confidence, source: point.source });
    } else {
      console.log(` ✗ not found`);
      results.push({ month, status: 'gap', value: null, confidence: 0, source: '' });
    }

    if (shouldPrompt) {
      const hint = point ? ` [Exa found ${point.approvalPct}% conf=${point.confidence}% — override or Enter to skip]` : '';
      const manual = await promptManual(month + hint);
      if (manual !== null) {
        if (!DRY_RUN) {
          await upsertPoints([{
            indicator: 'prabowo_approval_pct',
            category: 'sovereign' as const,
            date: `${month}-01`,
            value: manual,
            unit: 'pct',
            source: `manual:${month}`,
            fetchedAt: new Date().toISOString(),
          }]);
        }
        results[results.length - 1] = { month, status: 'found', value: manual, confidence: 100, source: 'manual' };
        console.log(`    ✓ Stored ${manual}% (manual)`);
      }
    }
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
const found    = results.filter(r => r.status === 'found' || r.status === 'existing');
const gaps     = results.filter(r => r.status === 'gap');
const skipped  = results.filter(r => r.status === 'skipped');

console.log(`\n${'─'.repeat(60)}`);
console.log(`Backfill summary (${fromMonth} → ${toMonth}):`);
console.log(`  Existing in DB:  ${results.filter(r => r.status === 'existing').length}`);
console.log(`  Auto-fetched:    ${results.filter(r => r.status === 'found').length}`);
console.log(`  Gaps remaining:  ${gaps.length}`);
console.log(`  Low-conf skip:   ${skipped.length}`);

if (gaps.length > 0) {
  console.log(`\nGap months (no data found):`);
  for (const g of gaps) console.log(`  ${g.month}  → no data`);
  console.log(`\nTo fill gaps manually:`);
  console.log(`  bun scripts/backfill-approval-history.ts --from=${gaps[0]!.month} --to=${gaps[gaps.length - 1]!.month} --interactive`);
  console.log(`\nOr compile a CSV and import:`);
  console.log(`  echo "date,value,source" > approval-gaps.csv`);
  for (const g of gaps) console.log(`  echo "${g.month},<pct>,manual" >> approval-gaps.csv`);
  console.log(`  bun scripts/backfill-approval-history.ts --csv=approval-gaps.csv`);
}

if (skipped.length > 0) {
  console.log(`\nLow-confidence results (not stored, re-run without --min-confidence to accept):`);
  for (const s of skipped) console.log(`  ${s.month}  ${s.value ?? '?'}%  conf=${s.confidence}%`);
}

const stored = found.filter(r => r.status === 'found');
if (stored.length > 0 && !DRY_RUN) {
  console.log(`\n✓ Stored ${stored.length} new approval points.`);
}
