/**
 * Backfill SRBI auction history (2023–2025 gap) via Exa news search.
 *
 * BI official pages not indexed by Exa for pre-2025 dates.
 * Media sources (CNBC Indonesia, Bisnis.com, Kontan, Bloomberg Technoz)
 * cover auction results with demand/allotment figures.
 *
 * Strategy: search per-date with date-specific queries, parse penawaran
 * (total demand) + pemenang/allotment figures, compute bid-cover ratio.
 *
 * Usage:
 *   bun scripts/backfill-srbi-news.ts            # fill all missing Fridays Sep 2023→May 2025
 *   bun scripts/backfill-srbi-news.ts --dry-run  # show queries only
 *   bun scripts/backfill-srbi-news.ts --from=2024-01-01 --to=2024-12-31
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '..'));

import Exa from 'exa-js';
import { upsertPoints, getHistory } from '../src/tools/macro/time-series-db.js';
import type { MacroDataPoint } from '../src/tools/macro/types.js';

const DRY_RUN = process.argv.includes('--dry-run');
const FROM_ARG = process.argv.find(a => a.startsWith('--from='))?.split('=')[1];
const TO_ARG   = process.argv.find(a => a.startsWith('--to='))?.split('=')[1];

// ── Helpers ────────────────────────────────────────────────────────────────
const ID_MONTH = [
  'Januari','Februari','Maret','April','Mei','Juni',
  'Juli','Agustus','September','Oktober','November','Desember',
];
const EN_MONTH = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function generateFridays(from: Date, to: Date): Date[] {
  const fridays: Date[] = [];
  const d = new Date(from);
  while (d.getDay() !== 5) d.setDate(d.getDate() + 1);
  while (d <= to) {
    fridays.push(new Date(d));
    d.setDate(d.getDate() + 7);
  }
  return fridays;
}

// Indonesian number parser: "24,46" → 24.46, "1.500" → 1500
function parseIdNum(s: string): number | null {
  // If has both dot and comma: dot=thousands, comma=decimal
  if (s.includes('.') && s.includes(',')) {
    const v = parseFloat(s.replace(/\./g, '').replace(',', '.'));
    return isNaN(v) ? null : v;
  }
  // Comma only = decimal (e.g. "24,46")
  if (s.includes(',') && !s.includes('.')) {
    const v = parseFloat(s.replace(',', '.'));
    return isNaN(v) ? null : v;
  }
  // Dot only: ambiguous — if decimal part ≤ 2 digits treat as decimal, else thousands
  if (s.includes('.') && !s.includes(',')) {
    const parts = s.split('.');
    if (parts[parts.length - 1]!.length <= 2) {
      const v = parseFloat(s);
      return isNaN(v) ? null : v;
    }
    const v = parseFloat(s.replace(/\./g, ''));
    return isNaN(v) ? null : v;
  }
  const v = parseFloat(s);
  return isNaN(v) ? null : v;
}

// Extract Rp triliun figures from text. Returns array sorted descending.
function extractTriliun(text: string): number[] {
  const results: number[] = [];
  // Pattern: Rp X triliun / Rp X T / Rp X,XX triliun
  const patterns = [
    /Rp\s*([\d.,]+)\s*[Tt]riliun/g,
    /Rp\s*([\d.,]+)\s*[Tt]\b/g,
    /([\d.,]+)\s*triliun/gi,
  ];
  for (const pat of patterns) {
    let m: RegExpExecArray | null;
    pat.lastIndex = 0;
    while ((m = pat.exec(text)) !== null) {
      const v = parseIdNum(m[1]!);
      // Plausible SRBI per-auction: 5T – 500T
      if (v !== null && v >= 5 && v <= 500) results.push(v);
    }
  }
  return [...new Set(results)].sort((a, b) => b - a);
}

interface ParsedResult {
  demandTrn: number;
  allotmentTrn: number;
  bidCover: number;
  source: string;
}

function parseArticle(text: string, url: string): ParsedResult | null {
  // Try explicit bid cover ratio first: "X kali" oversubscribed or "X,XX kali"
  const bidCoverMatch = text.match(/(\d+[,.]\d+)\s*kali/i);
  if (bidCoverMatch) {
    const bidCover = parseIdNum(bidCoverMatch[1]!);
    // If we have bid cover directly, try to find allotment
    const trns = extractTriliun(text);
    if (bidCover !== null && bidCover >= 1 && bidCover <= 20 && trns.length >= 1) {
      // allotment is the smaller figure (or look for pemenang/allotment context)
      const allotmentTrn = trns[trns.length - 1]!;
      const demandTrn = parseFloat((allotmentTrn * bidCover).toFixed(2));
      return { demandTrn, allotmentTrn, bidCover, source: url };
    }
  }

  // Look for penawaran (demand) and pemenang/allotment pair
  // Pattern: "penawaran Rp X triliun ... pemenang/allotment Rp Y triliun"
  const penMatch = text.match(/[Pp]enawaran[^.]*?Rp\s*([\d.,]+)\s*[Tt](?:riliun)?/);
  const pemMatch = text.match(/[Pp]emenang[^.]*?Rp\s*([\d.,]+)\s*[Tt](?:riliun)?/);
  if (penMatch && pemMatch) {
    const demand = parseIdNum(penMatch[1]!);
    const allot  = parseIdNum(pemMatch[1]!);
    if (demand !== null && allot !== null && allot > 0 && demand >= allot) {
      const bidCover = parseFloat((demand / allot).toFixed(4));
      if (bidCover >= 1 && bidCover <= 20) {
        return { demandTrn: demand, allotmentTrn: allot, bidCover, source: url };
      }
    }
  }

  // Fallback: two largest Rp triliun figures where larger/smaller >= 1.1 (oversubscribed)
  const trns = extractTriliun(text);
  if (trns.length >= 2) {
    const demand = trns[0]!;
    const allot  = trns[1]!;
    if (allot > 0 && demand > allot) {
      const bidCover = parseFloat((demand / allot).toFixed(4));
      if (bidCover >= 1.1 && bidCover <= 15) {
        return { demandTrn: demand, allotmentTrn: allot, bidCover, source: url };
      }
    }
  }

  // Single figure: if article has allotment keyword + single Rp figure, skip (need demand too)
  return null;
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const exa = new Exa(process.env.EXASEARCH_API_KEY!);

  // Determine missing Fridays
  const existingRows = await getHistory('srbi_bid_cover_ratio', 1500);
  const existingDates = new Set(existingRows.map(r => r.date));

  const fromDate = FROM_ARG ? new Date(FROM_ARG) : new Date('2023-09-15');
  const toDate   = TO_ARG   ? new Date(TO_ARG)   : new Date('2025-05-30');

  const allFridays = generateFridays(fromDate, toDate);
  const missing = allFridays.filter(d => !existingDates.has(d.toISOString().slice(0, 10)));

  console.log(`Gap range: ${fromDate.toISOString().slice(0,10)} → ${toDate.toISOString().slice(0,10)}`);
  console.log(`Total Fridays: ${allFridays.length} | Already in DB: ${allFridays.length - missing.length} | To search: ${missing.length}`);

  if (DRY_RUN) {
    for (const d of missing) {
      const iso = d.toISOString().slice(0, 10);
      const day = d.getDate();
      const mon = ID_MONTH[d.getMonth()]!;
      const yr  = d.getFullYear();
      console.log(`${iso}: "lelang SRBI ${day} ${mon} ${yr}"`);
    }
    return;
  }

  let saved = 0;
  let notFound = 0;

  // Process in batches of 5 (each = 1 Exa search call)
  const BATCH = 5;
  const SLEEP = 1500;

  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);

    for (const d of batch) {
      const iso  = d.toISOString().slice(0, 10);
      const day  = d.getDate();
      const monId = ID_MONTH[d.getMonth()]!;
      const monEn = EN_MONTH[d.getMonth()]!;
      const yr   = d.getFullYear();

      process.stdout.write(`${iso}: `);

      // Build date-specific query — both Indonesian and English month names
      const query = `lelang SRBI ${day} ${monId} ${yr} penawaran pemenang triliun Bank Indonesia`;

      try {
        const res = await exa.searchAndContents(query, {
          numResults: 5,
          type: 'neural',
          text: { maxCharacters: 3000 },
          includeDomains: [
            'cnbcindonesia.com','bloomberg.co.id','bisnis.com',
            'kontan.co.id','detik.com','kompas.com','katadata.co.id',
          ],
          // date filter ±7 days around auction date
          startPublishedDate: new Date(d.getTime() - 7 * 86400_000).toISOString().slice(0,10),
          endPublishedDate:   new Date(d.getTime() + 7 * 86400_000).toISOString().slice(0,10),
        });

        let found: ParsedResult | null = null;
        let usedUrl = '';

        for (const r of res.results) {
          const text = r.text ?? '';
          if (!text) continue;
          const parsed = parseArticle(text, r.url);
          if (parsed) {
            found = parsed;
            usedUrl = r.url;
            break;
          }
        }

        if (found) {
          const fetchedAt = new Date().toISOString();
          const pts: MacroDataPoint[] = [
            { indicator: 'srbi_bid_cover_ratio', category: 'fx', date: iso, value: found.bidCover,       unit: 'ratio',   source: 'media_news', fetchedAt },
            { indicator: 'srbi_demand_idr_t',    category: 'fx', date: iso, value: found.demandTrn,      unit: 'IDR_trn', source: 'media_news', fetchedAt },
            { indicator: 'srbi_allotment_idr_t', category: 'fx', date: iso, value: found.allotmentTrn,   unit: 'IDR_trn', source: 'media_news', fetchedAt },
          ];
          await upsertPoints(pts);
          saved++;
          console.log(`✓ bid-cover=${found.bidCover}x demand=${found.demandTrn}T allot=${found.allotmentTrn}T [${new URL(usedUrl).hostname}]`);
        } else {
          notFound++;
          console.log(`✗ no parseable data (${res.results.length} results)`);
        }
      } catch (e) {
        notFound++;
        console.log(`✗ ${String(e).slice(0, 60)}`);
      }

      await new Promise(r => setTimeout(r, 500));  // 500ms between individual searches
    }

    // Longer pause between batches
    if (i + BATCH < missing.length) {
      await new Promise(r => setTimeout(r, SLEEP));
    }
  }

  console.log(`\nDone. Saved: ${saved} | Not found: ${notFound}`);
}

main().catch(e => { console.error(e); process.exit(1); });
