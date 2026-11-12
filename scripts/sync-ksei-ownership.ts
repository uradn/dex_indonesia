/**
 * sync-ksei-ownership.ts
 * Download KSEI individual shareholder data (>1% holders, all IDX emiten)
 * and insert into macro.db idx_shareholders table.
 *
 * Primary source: fzn0x/idx GitHub releases (ownership-data tag)
 *   - JSON parts: ksei-above1-YYYY-MM-DD.part0N.json
 *   - Already parsed, normalized, includes entity_key dedup + controller flag
 *   - Coverage: Feb 2026 → latest (updated monthly)
 *
 * Fallback: KSEI BalanceposEfek ZIP (aggregate category data, written to ksei_balpos table)
 *   - web.ksei.co.id/Download/BalanceposEfek{YYYYMMDD}.zip
 *   - Different dataset: aggregate per investor category, NOT individual names
 *
 * Usage:
 *   bun scripts/sync-ksei-ownership.ts              # sync latest 2 months
 *   bun scripts/sync-ksei-ownership.ts --backfill   # sync all available months
 *   bun scripts/sync-ksei-ownership.ts --dry-run    # print plan only
 */

import {
  upsertShareholders, computeAndSaveDelta, getAvailableDates, getOwnershipStats,
  type ShareholderRow,
} from '../src/tools/ownership/ownership-db.js';

const DRY_RUN = process.argv.includes('--dry-run');
const BACKFILL = process.argv.includes('--backfill');

const GITHUB_RELEASES_BASE = 'https://github.com/fzn0x/idx/releases/download/ownership-data';

// Known monthly data files from fzn0x/idx ownership-data release
// Each month has 8 JSON parts (split for GitHub 25MB limit)
const AVAILABLE_MONTHS: { date: string; parts: number }[] = [
  { date: '2026-02-27', parts: 8 },
  { date: '2026-03-31', parts: 8 },
  { date: '2026-04-30', parts: 8 },
  { date: '2026-05-29', parts: 8 },
  { date: '2026-06-30', parts: 8 },
  { date: '2026-07-31', parts: 8 },
  { date: '2026-08-31', parts: 8 },
  { date: '2026-09-30', parts: 8 },
  { date: '2026-10-30', parts: 8 },
];

type FznRecord = {
  symbol: string;
  issuer_name: string;
  entity_key: string;
  holder: string;
  holder_raw: string;
  investor_type: string;
  local_foreign: string;
  nationality: string | null;
  domicile: string | null;
  shares_scripless: number;
  shares_scrip: number;
  shares_total: number;
  pct: number;
  accounts: number;
  controller_or_affiliate: string | null;
};

function normalizeLocalForeign(raw: string): 'L' | 'A' {
  const t = String(raw ?? '').trim().toUpperCase();
  if (t === 'A' || t === 'F' || t === 'ASING' || t === 'FOREIGN') return 'A';
  return 'L';
}

function normalizeInvestorType(raw: string): string {
  const t = String(raw ?? '').trim().toUpperCase();
  const map: Record<string, string> = {
    'CORPORATE': 'CP', 'CP': 'CP',
    'INDIVIDUAL': 'ID', 'ID': 'ID',
    'INSTITUTION': 'IB', 'BANK': 'IB', 'IB': 'IB',
    'FUND': 'FD', 'MUTUAL FUND': 'FD', 'FD': 'FD',
    'GOVERNMENT': 'GV', 'GV': 'GV',
    'INSURANCE': 'IS', 'IS': 'IS',
    'PENSION FUND': 'PF', 'PF': 'PF',
    'FOUNDATION': 'FN', 'FN': 'FN',
  };
  for (const [k, v] of Object.entries(map)) {
    if (t.includes(k)) return v;
  }
  return t.slice(0, 2) || 'OT';
}

function fznToRow(r: FznRecord, date: string): ShareholderRow | null {
  if (!r.symbol || !r.holder || r.pct <= 0) return null;
  return {
    date,
    share_code: r.symbol.toUpperCase(),
    issuer_name: r.issuer_name ?? r.symbol,
    investor_name: r.holder,
    investor_type: normalizeInvestorType(r.investor_type),
    local_foreign: normalizeLocalForeign(r.local_foreign),
    nationality: (r.nationality ?? 'IDN').toUpperCase(),
    domicile: r.domicile ?? '',
    holdings_scripless: r.shares_scripless ?? 0,
    holdings_scrip: r.shares_scrip ?? 0,
    total_shares: r.shares_total ?? 0,
    pct: r.pct,
  };
}

async function fetchPart(date: string, partNum: number): Promise<FznRecord[]> {
  const pad = String(partNum).padStart(2, '0');
  const url = `${GITHUB_RELEASES_BASE}/ksei-above1-${date}.part${pad}.json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for part${pad}`);
  return res.json() as Promise<FznRecord[]>;
}

async function syncMonth(date: string, parts: number, existingDates: Set<string>): Promise<boolean> {
  if (existingDates.has(date)) {
    console.log(`  ⏭  ${date} already synced`);
    return false;
  }

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would sync ${date} (${parts} parts)`);
    return true;
  }

  console.log(`  ⬇  ${date} (${parts} parts)…`);
  const allRecords: FznRecord[] = [];

  // Fetch all parts concurrently in batches of 4
  for (let batch = 0; batch < parts; batch += 4) {
    const batchNums = Array.from({ length: Math.min(4, parts - batch) }, (_, i) => batch + i + 1);
    const results = await Promise.allSettled(batchNums.map(n => fetchPart(date, n)));
    for (const r of results) {
      if (r.status === 'fulfilled') allRecords.push(...r.value);
      else console.log(`    ⚠ part error: ${r.reason}`);
    }
  }

  if (allRecords.length === 0) {
    console.log(`  ⚠  ${date}: no records fetched`);
    return false;
  }

  const rows = allRecords.map(r => fznToRow(r, date)).filter((r): r is ShareholderRow => r !== null);
  const inserted = await upsertShareholders(rows);
  const deltas = await computeAndSaveDelta(date);
  console.log(`  ✓  ${date}: ${inserted.toLocaleString()} holders, ${deltas.toLocaleString()} delta records`);
  return true;
}

// Also check if newer months are available via snapshot-v4.json index
async function fetchLatestIndex(): Promise<{ date: string; parts: number }[]> {
  try {
    const res = await fetch(`${GITHUB_RELEASES_BASE}/index.json`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return AVAILABLE_MONTHS;
    const index = await res.json() as { dates?: { date: string; parts?: number }[] };
    if (index?.dates?.length) {
      return index.dates.map(d => ({ date: d.date, parts: d.parts ?? 8 }));
    }
    return AVAILABLE_MONTHS;
  } catch {
    return AVAILABLE_MONTHS;
  }
}

async function main() {
  console.log('KSEI Individual Shareholder Sync (fzn0x/idx mirror)\n');

  const months = await fetchLatestIndex();
  const existing = new Set(await getAvailableDates());

  console.log(`Available: ${months.length} months (${months[0]?.date} → ${months.at(-1)?.date})`);
  console.log(`In DB: ${existing.size} months\n`);

  if (DRY_RUN) console.log('[DRY RUN — no writes]\n');

  const toSync = BACKFILL ? months : months.slice(-2);

  let synced = 0;
  for (const { date, parts } of toSync) {
    const ok = await syncMonth(date, parts, existing);
    if (ok) synced++;
  }

  console.log(`\nDone. ${synced} month(s) synced.`);

  if (!DRY_RUN && synced > 0) {
    const stats = await getOwnershipStats();
    console.log(`DB: ${stats.total_rows.toLocaleString()} rows | ${stats.emiten_count} emiten | ${stats.investor_count} investors | ${stats.months.length} months`);
  }
}

main().catch(err => { console.error('sync error:', err); process.exit(1); });
