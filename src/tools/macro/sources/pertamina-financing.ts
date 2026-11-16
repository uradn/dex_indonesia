/**
 * Pertamina Quasi-Fiscal Financing Monitor — M10 signal.
 *
 * When APBN subsidi energi transfer is delayed (fiscal stress), Pertamina bridges
 * via commercial paper (CP) or bond issuance. This creates quasi-fiscal debt that
 * does NOT appear in APBN deficit but transfers fiscal risk to Pertamina balance sheet.
 *
 * Academic basis: Calvo (1988) quasi-fiscal deficit = off-balance-sheet fiscal
 * obligation. When government delays subsidi payment, Pertamina's working capital
 * borrowing = fiscal deficit in disguise. Visible via bond issuance timing vs APBN
 * transfer calendar (transfers typically 5th and 15th of each month).
 *
 * Key signal: news of Pertamina bond/CP issuance within 30 days → subsidi_delay_flag.
 *   subsidi_delay_flag = 1 → quasi-fiscal stress (+8 M10 score)
 *   bond_issuance_amount_idr_t > 0 → scale of Pertamina market borrowing
 *
 * Source: Exa/Tavily — Pertamina IR page + media (cnbcindonesia, bisnis, kontan).
 * Freshness: 30d (monthly gate — APBN transfers monthly).
 * Env override: PERTAMINA_SUBSIDI_DELAY_FLAG ('true'/'false') — always wins.
 *
 * Note: Bloomberg/Reuters terminal required for CP spread data. This implementation
 * provides binary flag + amount only. Spread monitoring deferred until Bloomberg
 * proxy configured (BLOOMBERG_API_URL env).
 */

import { getLatestPoint, upsertPoints } from '../time-series-db.js';

const FRESHNESS_DAYS = 30;
const PERTAMINA_DOMAINS = [
  'pertamina.com', 'cnbcindonesia.com', 'bisnis.com', 'kontan.co.id',
  'bloombergtechnoz.com', 'antaranews.com', 'katadata.co.id', 'detik.com',
];

export interface PertaminaFinancingData {
  subsidi_delay_flag: boolean;
  bond_issuance_idr_t: number | null;  // IDR triliun if disclosed
  date: string;
  source: string;
  headline: string | null;
}

function parseFinancingText(text: string, url: string | null): { flag: boolean; amount_idr_t: number | null } {
  const t = text.toLowerCase();
  // Must mention Pertamina + financing keyword
  if (!t.includes('pertamina')) return { flag: false, amount_idr_t: null };
  const financingKeywords = ['obligasi', 'bond', 'commercial paper', 'cp pertamina', 'utang', 'pinjaman',
    'working capital', 'modal kerja', 'hutang', 'surat utang', 'medium term note', 'mtn'];
  if (!financingKeywords.some(k => t.includes(k))) return { flag: false, amount_idr_t: null };
  // Reject routine corporate news (earnings, production, general ops)
  if (/(laba|produksi|lifting|revenue|pendapatan|drilling|refinery|kilang\s+(?!utang))/i.test(t) &&
      !financingKeywords.some(k => t.includes(k))) return { flag: false, amount_idr_t: null };

  let amount_idr_t: number | null = null;
  // "Pertamina terbitkan obligasi Rp 15 triliun" or "Rp 15 T"
  const amtM = text.match(/Rp\s*([\d,.]+)\s*(?:triliun|T\b)/i)
    ?? text.match(/([\d,.]+)\s*triliun/i);
  if (amtM) {
    const v = parseFloat(amtM[1]!.replace(',', '.').replace('.', ''));
    if (v >= 0.5 && v <= 200) amount_idr_t = v;
  }

  return { flag: true, amount_idr_t };
}

async function fetchViaExa(): Promise<PertaminaFinancingData | null> {
  if (!process.env.EXASEARCH_API_KEY) return null;
  try {
    const { default: Exa } = await import('exa-js');
    const exa = new Exa(process.env.EXASEARCH_API_KEY);
    const startDate = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);
    const queries = [
      'Pertamina obligasi bond issuance utang modal kerja 2026',
      'Pertamina commercial paper surat utang jangka pendek 2026',
      'Pertamina keuangan hutang subsidi BBM keterlambatan pembayaran',
    ];
    for (const query of queries) {
      const resp = await exa.search(query, {
        numResults: 5,
        type: 'auto',
        startPublishedDate: startDate,
        includeDomains: PERTAMINA_DOMAINS,
        contents: { text: { maxCharacters: 1500 } },
      } as Parameters<typeof exa.search>[1]);
      for (const r of resp.results ?? []) {
        const text = ((r as { text?: string }).text ?? '') + ' ' + (r.title ?? '');
        const parsed = parseFinancingText(text, r.url ?? null);
        if (parsed.flag) {
          return {
            subsidi_delay_flag: true,
            bond_issuance_idr_t: parsed.amount_idr_t,
            date: (r.publishedDate ?? new Date().toISOString()).slice(0, 10),
            source: 'exa_news:' + (r.url ?? query),
            headline: r.title ?? null,
          };
        }
      }
    }
  } catch { /* silent */ }
  return null;
}

async function fetchViaTavily(): Promise<PertaminaFinancingData | null> {
  if (!process.env.TAVILY_API_KEY) return null;
  try {
    const { TavilySearchAPIWrapper } = await import('@langchain/tavily');
    const tavily = new TavilySearchAPIWrapper({ tavilyApiKey: process.env.TAVILY_API_KEY });
    const resp = await tavily.rawResults({
      query: 'Pertamina obligasi utang modal kerja 2026 penerbitan',
      max_results: 5,
      include_domains: PERTAMINA_DOMAINS,
      include_raw_content: false,
      time_range: 'month',
    } as Parameters<typeof tavily.rawResults>[0]);
    for (const r of resp.results ?? []) {
      const text = ((r as { raw_content?: string | null; content?: string | null }).raw_content ?? r.content ?? '') + ' ' + ((r as { title?: string }).title ?? '');
      const parsed = parseFinancingText(text, (r as { url?: string }).url ?? null);
      if (parsed.flag) {
        return {
          subsidi_delay_flag: true,
          bond_issuance_idr_t: parsed.amount_idr_t,
          date: new Date().toISOString().slice(0, 10),
          source: 'tavily:' + ((r as { url?: string }).url ?? ''),
          headline: (r as { title?: string }).title ?? null,
        };
      }
    }
  } catch { /* silent */ }
  return null;
}

/**
 * Fetch Pertamina quasi-fiscal financing signal.
 * Priority: env override → DB cache (30d) → Exa → Tavily.
 * Returns null if no financing signal detected (= normal, no flag).
 */
export async function fetchPertaminaFinancing(): Promise<PertaminaFinancingData | null> {
  const today = new Date().toISOString().slice(0, 10);
  const fetchedAt = new Date().toISOString();

  // Env override — set when confirmed from Pertamina IR or media
  if (process.env.PERTAMINA_SUBSIDI_DELAY_FLAG === 'true') {
    return { subsidi_delay_flag: true, bond_issuance_idr_t: null, date: today, source: 'env_manual', headline: 'Manual override: PERTAMINA_SUBSIDI_DELAY_FLAG=true' };
  }
  if (process.env.PERTAMINA_SUBSIDI_DELAY_FLAG === 'false') {
    return { subsidi_delay_flag: false, bond_issuance_idr_t: null, date: today, source: 'env_manual', headline: null };
  }

  // DB freshness check (flag value: 1=active, 0=no signal)
  const cached = await getLatestPoint('pertamina_subsidi_delay_flag');
  if (cached) {
    const ageDays = (Date.now() - new Date(cached.date).getTime()) / 86_400_000;
    if (ageDays < FRESHNESS_DAYS) {
      return { subsidi_delay_flag: cached.value === 1, bond_issuance_idr_t: null, date: cached.date, source: cached.source, headline: null };
    }
  }

  const result = (await fetchViaExa()) ?? (await fetchViaTavily());
  if (result) {
    await upsertPoints([
      { indicator: 'pertamina_subsidi_delay_flag', category: 'sovereign', date: result.date, value: result.subsidi_delay_flag ? 1 : 0, unit: 'flag_0_1', source: result.source, fetchedAt },
      ...(result.bond_issuance_idr_t !== null ? [{
        indicator: 'pertamina_bond_issuance_idr_t', category: 'sovereign' as const,
        date: result.date, value: result.bond_issuance_idr_t, unit: 'IDR_triliun',
        source: result.source, fetchedAt,
      }] : []),
    ]);
    return result;
  }
  // No signal found = no active Pertamina financing stress
  return null;
}

/** Score contribution to M10 fiscal (0 or +8 pts). */
export function scorePertaminaFinancing(d: PertaminaFinancingData | null): { score: number; flag: string | null } {
  if (!d || !d.subsidi_delay_flag) return { score: 0, flag: null };
  const amtStr = d.bond_issuance_idr_t !== null ? ` (Rp${d.bond_issuance_idr_t.toFixed(1)}T issuance)` : '';
  const headline = d.headline ? ` — "${d.headline.slice(0, 80)}"` : '';
  return {
    score: 8,
    flag: `PERTAMINA QUASI-FISCAL STRESS: Pertamina market borrowing detected${amtStr}. ` +
      `Calvo (1988): subsidi transfer delay → Pertamina WC borrowing = off-APBN fiscal obligation. ` +
      `Real deficit > headline APBN figures. (+8 score)${headline}`,
  };
}
