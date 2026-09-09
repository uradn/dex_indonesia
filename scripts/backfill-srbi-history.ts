/**
 * Backfill SRBI auction history from BI official pages.
 *
 * BI publishes auction results at deterministic URLs per date:
 *   https://www.bi.go.id/en/publikasi/lelang/operasi-moneter/Pages/
 *     Auction-Result-Announcement-of-Bank-Indonesia-Rupiah-Securities,-{Month}-{Nth}-{YYYY}.aspx
 *
 * SRBI launched Sep 2023. Auctions run weekly on Fridays.
 * Fetches via Exa (no Playwright needed — BI pages are Exa-indexable).
 *
 * Usage:
 *   bun scripts/backfill-srbi-history.ts            # all Fridays Sep 2023 → today
 *   bun scripts/backfill-srbi-history.ts --dry-run  # print URLs only, no DB write
 *   bun scripts/backfill-srbi-history.ts --from 2025-01-01  # from date override
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '..'));

import Exa from 'exa-js';
import { upsertPoints, getLatestPoint } from '../src/tools/macro/time-series-db.js';
import type { MacroDataPoint } from '../src/tools/macro/types.js';

const DRY_RUN = process.argv.includes('--dry-run');
const FROM_ARG = process.argv.find(a => a.startsWith('--from='))?.split('=')[1]
  ?? process.argv[process.argv.indexOf('--from') + 1];

const SRBI_LAUNCH = new Date('2023-09-15');  // first SRBI auction
const BATCH_SIZE = 10;                        // Exa getContents per call
const SLEEP_MS = 1200;                        // rate limit between batches

// ── Ordinal suffix ─────────────────────────────────────────────────────────
function ordinal(n: number): string {
  if (n >= 11 && n <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

// ── URL builder ────────────────────────────────────────────────────────────
const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function buildUrl(date: Date): string {
  const day = date.getDate();
  const month = MONTH_NAMES[date.getMonth()]!;
  const year = date.getFullYear();
  return (
    'https://www.bi.go.id/en/publikasi/lelang/operasi-moneter/Pages/' +
    `Auction-Result-Announcement-of-Bank-Indonesia-Rupiah-Securities,` +
    `-${month}-${ordinal(day)}-${year}.aspx`
  );
}

// ── Generate all Fridays in range ──────────────────────────────────────────
function generateFridays(from: Date, to: Date): Date[] {
  const fridays: Date[] = [];
  const d = new Date(from);
  while (d.getDay() !== 5) d.setDate(d.getDate() + 1);  // advance to first Friday
  while (d <= to) {
    fridays.push(new Date(d));
    d.setDate(d.getDate() + 7);
  }
  return fridays;
}

// ── Indonesian number parser (1.500,75 → 1500.75) ─────────────────────────
function parseIdNum(s: string): number | null {
  const cleaned = s.replace(/\./g, '').replace(',', '.');
  const v = parseFloat(cleaned);
  return isNaN(v) ? null : v;
}

// ── Parse BI auction page text ─────────────────────────────────────────────
interface ParsedAuction {
  date: string;
  totalDemandBn: number;   // Rp billion
  totalAwardedBn: number;  // Rp billion
  bidCoverRatio: number;
  yield12mPct: number | null;  // weighted avg winner 12M tenor
}

function parsePage(text: string, isoDate: string): ParsedAuction | null {
  // Validate it's an auction result page (not 404)
  if (!text.includes('Nominal Penawaran') && !text.includes('Bidding Amount')) return null;

  // ── Total demand: sum all per-tenor "Nominal Penawaran" values ────────────
  // Text block between "Nominal Penawaran" and "Rate Penawaran"
  const demandBlockMatch = text.match(
    /Nominal Penawaran[^]*?(?=Rate Penawaran|Rata-Rata Tertimbang Penawaran)/
  );
  let totalDemandBn = 0;
  if (demandBlockMatch) {
    // Extract all numbers in the block (skip label text)
    const numMatches = demandBlockMatch[0].match(/\b(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)\b/g) ?? [];
    for (const m of numMatches) {
      const v = parseIdNum(m);
      // Only count plausible per-tenor amounts (5 Miliar – 100,000 Miliar)
      if (v !== null && v >= 5 && v <= 200_000) totalDemandBn += v;
    }
  }

  // ── Total awarded ─────────────────────────────────────────────────────────
  const awardedMatch = text.match(/Total[^(]*\(Rp Miliar\)[^]*?(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)/);
  if (!awardedMatch) return null;
  const totalAwardedBn = parseIdNum(awardedMatch[1]);
  if (totalAwardedBn === null || totalAwardedBn <= 0) return null;

  // If demand block failed, try extracting from per-tenor + total
  if (totalDemandBn <= 0) {
    // Fallback: look for individual tenor demand values before "Nominal Pemenang"
    const beforePemenang = text.split(/Nominal Pemenang/)[0] ?? text;
    const allNums = beforePemenang.match(/\b(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)\b/g) ?? [];
    const candidates = allNums.map(n => parseIdNum(n) ?? 0).filter(v => v >= 5 && v <= 200_000);
    // Use 3 largest as 3 tenors (6M, 9M, 12M)
    if (candidates.length >= 1) {
      totalDemandBn = candidates.reduce((s, v) => s + v, 0);
    }
  }

  if (totalDemandBn <= 0) return null;
  const bidCoverRatio = parseFloat((totalDemandBn / totalAwardedBn).toFixed(4));

  // ── 12M tenor weighted avg yield ─────────────────────────────────────────
  // Look for last "Rata-Rata Tertimbang Pemenang" value (12M is last tenor listed)
  const yieldMatches = text.match(/Rata-Rata Tertimbang Pemenang[^]*?(\d+[,.]\d+)/g);
  let yield12mPct: number | null = null;
  if (yieldMatches && yieldMatches.length > 0) {
    const lastYield = yieldMatches[yieldMatches.length - 1]!;
    const numM = lastYield.match(/(\d+[,.]\d+)/g);
    if (numM) {
      const v = parseIdNum(numM[numM.length - 1]!);
      if (v !== null && v > 0 && v < 30) yield12mPct = v;
    }
  }

  return {
    date: isoDate,
    totalDemandBn,
    totalAwardedBn,
    bidCoverRatio,
    yield12mPct,
  };
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const exa = new Exa(process.env.EXASEARCH_API_KEY!);

  const fromDate = FROM_ARG ? new Date(FROM_ARG) : SRBI_LAUNCH;
  const toDate = new Date();
  toDate.setDate(toDate.getDate() - 1);  // up to yesterday

  const fridays = generateFridays(fromDate, toDate);
  console.log(`SRBI Backfill — ${fridays.length} Fridays from ${fromDate.toISOString().slice(0,10)} to ${toDate.toISOString().slice(0,10)}`);

  if (DRY_RUN) {
    for (const d of fridays) console.log(buildUrl(d));
    return;
  }

  // Skip dates already in DB (check DB first)
  const latestInDb = await getLatestPoint('srbi_bid_cover_ratio');
  const latestDateInDb = latestInDb?.date ?? '2000-01-01';
  console.log(`Latest in DB: ${latestDateInDb} (${latestInDb?.value ?? 'none'}x)`);

  const toFetch = fridays.filter(d => d.toISOString().slice(0,10) > latestDateInDb);
  console.log(`To fetch: ${toFetch.length} dates (skipping ${fridays.length - toFetch.length} already in DB)`);

  if (toFetch.length === 0) {
    console.log('All dates already in DB.');
    return;
  }

  let saved = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    const batch = toFetch.slice(i, i + BATCH_SIZE);
    const urls = batch.map(d => buildUrl(d));
    const isoDates = batch.map(d => d.toISOString().slice(0, 10));

    process.stdout.write(`Batch ${Math.floor(i/BATCH_SIZE)+1}/${Math.ceil(toFetch.length/BATCH_SIZE)}: `);
    process.stdout.write(isoDates[0] + ' → ' + isoDates[isoDates.length-1] + ' ... ');

    try {
      const res = await exa.getContents(urls, { text: { maxCharacters: 4000 } });
      const points: MacroDataPoint[] = [];
      const fetchedAt = new Date().toISOString();

      for (let j = 0; j < res.results.length; j++) {
        const r = res.results[j]!;
        const isoDate = isoDates[j]!;
        const text = r.text ?? '';

        if (!text || text.includes('404') && !text.includes('Nominal Penawaran')) {
          skipped++;
          continue;
        }

        const parsed = parsePage(text, isoDate);
        if (!parsed) {
          skipped++;
          continue;
        }

        points.push({ indicator: 'srbi_bid_cover_ratio',   category: 'fx', date: isoDate, value: parsed.bidCoverRatio,    unit: 'ratio',    source: 'bi_official', fetchedAt });
        points.push({ indicator: 'srbi_demand_idr_t',       category: 'fx', date: isoDate, value: parsed.totalDemandBn/1000, unit: 'IDR_trn', source: 'bi_official', fetchedAt });
        points.push({ indicator: 'srbi_allotment_idr_t',    category: 'fx', date: isoDate, value: parsed.totalAwardedBn/1000, unit: 'IDR_trn', source: 'bi_official', fetchedAt });
        if (parsed.yield12mPct !== null) {
          points.push({ indicator: 'srbi_cutoff_rate_pct', category: 'fx', date: isoDate, value: parsed.yield12mPct,       unit: '%',        source: 'bi_official', fetchedAt });
        }
        saved++;
      }

      if (points.length > 0) await upsertPoints(points);
      console.log(`✓ ${saved} saved, ${skipped} no-auction, ${failed} err`);
    } catch (e) {
      failed++;
      console.log(`✗ ${String(e).slice(0, 80)}`);
    }

    if (i + BATCH_SIZE < toFetch.length) await new Promise(r => setTimeout(r, SLEEP_MS));
  }

  console.log(`\nDone. Saved: ${saved} auctions | Skipped: ${skipped} no-auction days | Failed: ${failed}`);
}

main().catch(e => { console.error(e); process.exit(1); });
