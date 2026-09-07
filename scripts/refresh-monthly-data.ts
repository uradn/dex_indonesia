/**
 * Monthly data refresh — auto-fetch BPS CPI/GDP, BI cadev, S&P PMI, SULNI ULN/GDP.
 * Writes to time-series DB; dashboard picks up on next reload.
 *
 * Run manually: bun scripts/refresh-monthly-data.ts
 * Registered cron: 8th of month 09:00 WIB (02:00 UTC) — after BI releases cadev on ~7th.
 *
 * Dependencies: EXASEARCH_API_KEY (required). Reads BI_DNDF_OUTSTANDING_BN from env.
 */

import 'dotenv/config';
import { upsertPoints } from '../src/tools/macro/time-series-db.js';
import type { MacroDataPoint } from '../src/tools/macro/types.js';

function parseNum(text: string, patterns: RegExp[]): number | null {
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const v = parseFloat(m[1].replace(',', '.'));
      if (!isNaN(v)) return v;
    }
  }
  return null;
}

// Use Grok (fast, good at extracting numbers from news text) to parse a value from search results.
// Falls back to regex if XAI_API_KEY not set or LLM call fails.
async function grokExtract(text: string, prompt: string, fallbackFn: () => number | null): Promise<number | null> {
  const key = process.env.XAI_API_KEY;
  if (!key) return fallbackFn();
  try {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'grok-3-mini',
        messages: [
          { role: 'system', content: 'Extract a single numeric value from the text. Reply with ONLY the number (e.g. 3.19 or 49.8). If not found, reply: null' },
          { role: 'user', content: `${prompt}\n\nText:\n${text.slice(0, 4000)}` },
        ],
        temperature: 0,
        max_tokens: 20,
      }),
    });
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content?.trim() ?? 'null';
    if (raw === 'null') return fallbackFn();
    const v = parseFloat(raw.replace(',', '.'));
    return isNaN(v) ? fallbackFn() : v;
  } catch {
    return fallbackFn();
  }
}

function lastDayOfPrevMonth(): string {
  const d = new Date();
  d.setDate(0);
  return d.toISOString().slice(0, 10);
}

function latestGdpQuarterEnd(): string {
  const now = new Date();
  const mo = now.getMonth() + 1;
  const yr = now.getFullYear();
  // Q2 (Apr-Jun) releases ~Aug 5. Q3 (Jul-Sep) releases ~Nov. Q4 releases ~Feb. Q1 releases ~May.
  if (mo >= 8)  return `${yr}-06-30`;
  if (mo >= 5)  return `${yr}-03-31`;
  if (mo >= 2)  return `${yr - 1}-12-31`;
  return `${yr - 1}-09-30`;
}

async function searchExa(query: string): Promise<string> {
  const key = process.env.EXASEARCH_API_KEY;
  if (!key) throw new Error('EXASEARCH_API_KEY not set');
  const { default: Exa } = await import('exa-js');
  const exa = new Exa(key);
  const startDate = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);
  const res = await exa.searchAndContents(query, {
    numResults: 5,
    startPublishedDate: startDate,
    text: { maxCharacters: 3000 },
  } as Parameters<typeof exa.searchAndContents>[1]);
  return (res.results ?? []).map((r: { text?: string; title?: string }) => r.text ?? r.title ?? '').join('\n');
}

async function fetchCpi(): Promise<MacroDataPoint | null> {
  const text = await searchExa('BPS Indonesia inflasi CPI persen year-on-year yoy bulan terbaru 2026');
  const val = await grokExtract(
    text,
    'What is the latest Indonesia CPI inflation rate year-on-year (YoY) in percent? Return just the number.',
    () => parseNum(text, [
      /inflasi.*?(\d+[.,]\d+)\s*(?:persen|%)[^\n]*(?:yoy|tahunan|year)/i,
      /annual inflation.*?(\d+[.,]\d+)\s*(?:percent|%)/i,
      /(\d+[.,]\d+)\s*(?:persen|percent)\s*(?:year.on.year|\(yoy\)|yoy)/i,
    ]),
  );
  if (val === null || val < 0 || val > 20) return null;
  const date = lastDayOfPrevMonth();
  console.log(`  CPI YoY: ${val}% → ${date}`);
  return { indicator: 'inflation_cpi_pct', category: 'regime', date, value: val, unit: '%', source: 'bps_exa', fetchedAt: new Date().toISOString() };
}

async function fetchGdp(): Promise<MacroDataPoint | null> {
  const text = await searchExa('BPS Indonesia GDP economic growth percent YoY quarterly 2026');
  const val = await grokExtract(
    text,
    'What is the latest Indonesia GDP growth rate year-on-year (YoY) in percent for the most recent quarter? Return just the number.',
    () => parseNum(text, [
      /economy.*?grew.*?(\d+[.,]\d+)\s*(?:percent|%)[^\n]*(?:y.on.y|yoy)/i,
      /(?:tumbuh|pertumbuhan).*?(\d+[.,]\d+)\s*(?:persen|%)[^\n]*(?:yoy|tahunan)/i,
      /(\d+[.,]\d+)\s*(?:persen|percent)[^\n]*(?:q\d|kuartal|quarter)/i,
    ]),
  );
  if (val === null || val < -5 || val > 15) return null;
  const date = latestGdpQuarterEnd();
  console.log(`  GDP YoY: ${val}% → ${date}`);
  return { indicator: 'gdp_growth_pct', category: 'regime', date, value: val, unit: '%', source: 'bps_exa', fetchedAt: new Date().toISOString() };
}

async function fetchCadev(): Promise<MacroDataPoint | null> {
  const text = await searchExa('Bank Indonesia cadangan devisa cadev miliar dolar posisi akhir bulan 2026');
  const val = await grokExtract(
    text,
    'What is the latest Bank Indonesia foreign exchange reserves (cadangan devisa) in USD billion? Return just the number (e.g. 146.5).',
    () => parseNum(text, [
      /cadev.*?(\d{3}[.,]\d)\s*miliar/i,
      /cadangan devisa.*?(\d{3}[.,]\d)\s*(?:miliar|billion)/i,
      /(\d{3}[.,]\d)\s*(?:miliar|billion)\s*(?:dolar|dollar)/i,
      /reserves.*?(\d{3}[.,]\d)\s*(?:bn|billion)/i,
    ]),
  );
  if (val === null || val < 50 || val > 300) return null;
  const date = lastDayOfPrevMonth();
  console.log(`  Cadev: $${val}bn → ${date}`);
  return { indicator: 'bi_fx_reserves_bn', category: 'bop', date, value: val, unit: 'bn_USD', source: 'bi_exa', fetchedAt: new Date().toISOString() };
}

async function fetchPmi(): Promise<MacroDataPoint | null> {
  const text = await searchExa('Indonesia S&P Global manufacturing PMI index latest month 2026');
  const val = await grokExtract(
    text,
    'What is the latest Indonesia S&P Global manufacturing PMI index value? Return just the number (e.g. 49.8).',
    () => parseNum(text, [
      /PMI.*?(\d{2}[.,]\d)/i,
      /(\d{2}[.,]\d)\s*(?:in|pada|points?)[^\n]*(?:August|September|October|November|Agustus|September|Oktober)/i,
      /purchasing managers.{0,30}(\d{2}[.,]\d)/i,
    ]),
  );
  if (val === null || val < 20 || val > 80) return null;
  const date = lastDayOfPrevMonth();
  console.log(`  PMI: ${val} → ${date}`);
  return { indicator: 'indonesia_pmi_manufacturing', category: 'regime', date, value: val, unit: 'index', source: 'sp_global_exa', fetchedAt: new Date().toISOString() };
}

async function fetchUlnGdp(): Promise<MacroDataPoint | null> {
  const text = await searchExa('Indonesia utang luar negeri ULN rasio PDB persen SULNI BI 2026');
  const val = await grokExtract(
    text,
    'What is the latest Indonesia external debt (ULN) to GDP ratio in percent? Return just the number (e.g. 30.5).',
    () => parseNum(text, [
      /rasio ULN.*?(\d{2}[.,]\d)\s*(?:persen|%)/i,
      /ULN.*?(?:GDP|PDB).*?(\d{2}[.,]\d)\s*(?:persen|%)/i,
      /external debt.*?(\d{2}[.,]\d)\s*(?:percent|%)[^\n]*(?:gdp|pdb)/i,
      /(\d{2}[.,]\d)\s*(?:persen|%)[^\n]*(?:PDB|GDP)/i,
    ]),
  );
  if (val === null || val < 5 || val > 80) return null;
  const date = latestGdpQuarterEnd();
  console.log(`  ULN/GDP: ${val}% → ${date}`);
  return { indicator: 'uln_gdp_ratio_pct', category: 'uln', date, value: val, unit: '%', source: 'bi_sulni_exa', fetchedAt: new Date().toISOString() };
}

async function main() {
  console.log('=== Monthly Data Refresh — Indonesia Macro ===');
  console.log(`Run: ${new Date().toISOString()}\n`);

  const results = await Promise.allSettled([fetchCpi(), fetchGdp(), fetchCadev(), fetchPmi(), fetchUlnGdp()]);
  const points: MacroDataPoint[] = results
    .filter((r): r is PromiseFulfilledResult<MacroDataPoint | null> => r.status === 'fulfilled')
    .map(r => r.value)
    .filter((p): p is MacroDataPoint => p !== null);

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      const names = ['CPI','GDP','Cadev','PMI','ULN/GDP'];
      console.error(`  ✗ ${names[i]} failed: ${r.reason}`);
    }
  });

  if (points.length === 0) {
    console.error('\nNo data points fetched — check EXASEARCH_API_KEY.');
    process.exit(1);
  }

  await upsertPoints(points);
  console.log(`\n✓ Saved ${points.length}/5 indicators to DB`);

  // Auto-recompute G-G ratio if cadev updated
  const newCadev = points.find(p => p.indicator === 'bi_fx_reserves_bn');
  if (newCadev) {
    const ST_ULN_BN = 70.1; // update quarterly from SULNI
    const DNDF_BN = parseFloat(process.env.BI_DNDF_OUTSTANDING_BN ?? '8');
    const gg = parseFloat((newCadev.value / ST_ULN_BN).toFixed(2));
    await upsertPoints([{
      indicator: 'greenspan_guidotti', category: 'uln',
      date: newCadev.date, value: gg, unit: 'ratio',
      source: 'derived', fetchedAt: new Date().toISOString(),
    }]);
    console.log(`  greenspan_guidotti: ${gg}x (cadev $${newCadev.value}bn / ST $${ST_ULN_BN}bn)`);
    console.log(`  effective_reserves: $${(newCadev.value - DNDF_BN).toFixed(1)}bn (−DNDF $${DNDF_BN}bn)`);
  }

  console.log('\n✓ Done. Reload dashboard to see updated values.');
}

main().catch(err => { console.error(err); process.exit(1); });
