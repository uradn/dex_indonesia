/**
 * LPS Deposit Coverage — M8 D-D depositor concentration signal.
 *
 * LPS (Lembaga Penjamin Simpanan) guarantees up to Rp2 billion per depositor
 * per bank. The insured VALUE share is typically 15–18% (most deposit VALUE
 * comes from large/institutional depositors above the guarantee ceiling).
 *
 * D-D relevance: uninsured depositors have first-mover incentive in a run
 * (no safety net → rational to withdraw early if others might). High uninsured
 * share = run coordination among large depositors easier = D-D threshold lower.
 *
 * D-D condition fires when: uninsuredShare > 85% (above Indonesia structural
 * baseline of ~82–84%; stress threshold calibrated to LPS 2019–2024 range).
 *
 * Source hierarchy:
 *   1. Env: LPS_DEPOSIT_COVERAGE_PCT (% of total deposit VALUE insured, e.g. "16.5")
 *   2. DB cache (90d freshness — quarterly LPS press releases)
 *   3. Exa neural search for latest LPS quarterly siaran pers
 *   4. Tavily fallback
 *   5. Default: 16.0% coverage (→ 84% uninsured; condition does NOT fire at baseline)
 *
 * DB indicator: lps_deposit_coverage_value_pct (unit: pct), category: banking.
 * LPS quarterly press releases: ~end of Mar/Jun/Sep/Dec (Q4/Q1/Q2/Q3 end-of-quarter).
 */

import { getLatestPoint, upsertPoints } from '../time-series-db.js';

const FRESHNESS_DAYS = 90;
const DEFAULT_COVERAGE_PCT = 16.0; // LPS 2024 typical; 84% uninsured → condition false at baseline

export interface LpsDepositCoverageData {
  coveragePct: number;       // % of total deposit VALUE that is insured by LPS
  uninsuredSharePct: number; // 100 − coveragePct
  source: string;
  date: string;
  fetchedAt: string;
}

function parseCoverageFromText(text: string): number | null {
  // Match "dijamin X%" or "insured X%" or "coverage X%" or "terjamin X%"
  // LPS press releases typically say "XX% dari nilai simpanan" or "dijamin X%"
  const lower = text.toLowerCase();
  if (!lower.includes('lps') && !lower.includes('penjaminan') && !lower.includes('dijamin') && !lower.includes('guarantee')) return null;

  const patterns = [
    /dijamin[^0-9]*(\d{1,3}\.?\d*)\s*%/i,
    /terjamin[^0-9]*(\d{1,3}\.?\d*)\s*%/i,
    /insured[^0-9]*(\d{1,3}\.?\d*)\s*%/i,
    /coverage[^0-9]*(\d{1,3}\.?\d*)\s*%/i,
    /(\d{1,3}\.?\d*)\s*%[^%0-9]{0,25}(dijamin|terjamin|insured|covered)/i,
    /nilai[^0-9]*(\d{1,3}\.?\d*)\s*%[^%]{0,30}(jamin|cover)/i,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      const val = parseFloat(m[1]!);
      if (val >= 5 && val <= 50) return val; // plausible LPS coverage range
    }
  }
  return null;
}

async function fetchViaExa(): Promise<LpsDepositCoverageData | null> {
  if (!process.env.EXASEARCH_API_KEY) return null;
  const startDate = new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10);
  try {
    const { default: Exa } = await import('exa-js');
    const exa = new Exa(process.env.EXASEARCH_API_KEY);
    const queries = [
      'LPS penjaminan simpanan nilai dijamin persen 2026 siaran pers',
      'LPS deposit insurance coverage ratio Indonesia 2026 percent value',
      'LPS tingkat penjaminan simpanan perbankan 2026',
    ];
    for (const query of queries) {
      const resp = await exa.search(query, {
        numResults: 4, type: 'neural', startPublishedDate: startDate,
        contents: { text: { maxCharacters: 600 } },
      } as Parameters<typeof exa.search>[1]);
      for (const r of resp.results ?? []) {
        const text = ((r as { text?: string }).text ?? '') + ' ' + (r.title ?? '');
        const val = parseCoverageFromText(text);
        if (val !== null) {
          return {
            coveragePct: val,
            uninsuredSharePct: parseFloat((100 - val).toFixed(1)),
            source: 'exa:' + (r.url ?? query),
            date: (r.publishedDate ?? new Date().toISOString()).slice(0, 10),
            fetchedAt: new Date().toISOString(),
          };
        }
      }
    }
  } catch { /* silent */ }
  return null;
}

async function fetchViaTavily(): Promise<LpsDepositCoverageData | null> {
  if (!process.env.TAVILY_API_KEY) return null;
  try {
    const { TavilySearchAPIWrapper } = await import('@langchain/tavily');
    const tavily = new TavilySearchAPIWrapper({ tavilyApiKey: process.env.TAVILY_API_KEY });
    const resp = await tavily.rawResults({
      query: 'LPS penjaminan simpanan nilai perbankan Indonesia 2026 persen dijamin',
      max_results: 4, include_raw_content: false, time_range: 'month',
    } as Parameters<typeof tavily.rawResults>[0]);
    for (const r of resp.results ?? []) {
      const text = (r.content ?? '') + ' ' + (r.title ?? '');
      const val = parseCoverageFromText(text);
      if (val !== null) {
        return {
          coveragePct: val,
          uninsuredSharePct: parseFloat((100 - val).toFixed(1)),
          source: 'tavily:' + (r.url ?? ''),
          date: new Date().toISOString().slice(0, 10),
          fetchedAt: new Date().toISOString(),
        };
      }
    }
  } catch { /* silent */ }
  return null;
}

/**
 * Fetch LPS deposit coverage ratio.
 * Priority: env override → DB cache (90d) → Exa → Tavily → default 16%.
 */
export async function fetchLpsDepositCoverage(): Promise<LpsDepositCoverageData> {
  const today = new Date().toISOString().slice(0, 10);
  const fetchedAt = new Date().toISOString();

  // Env override always wins — also stores to DB so health-check tracks freshness
  if (process.env.LPS_DEPOSIT_COVERAGE_PCT) {
    const val = parseFloat(process.env.LPS_DEPOSIT_COVERAGE_PCT);
    if (!isNaN(val) && val >= 5 && val <= 50) {
      await upsertPoints([{ indicator: 'lps_deposit_coverage_value_pct', category: 'banking' as const, date: today, value: val, unit: 'pct', source: 'env:LPS_DEPOSIT_COVERAGE_PCT', fetchedAt }]);
      return { coveragePct: val, uninsuredSharePct: parseFloat((100 - val).toFixed(1)), source: 'env:LPS_DEPOSIT_COVERAGE_PCT', date: today, fetchedAt };
    }
  }

  // DB freshness check
  const cached = await getLatestPoint('lps_deposit_coverage_value_pct');
  if (cached) {
    const ageDays = (Date.now() - new Date(cached.fetchedAt ?? cached.date).getTime()) / 86_400_000;
    if (ageDays < FRESHNESS_DAYS) {
      return { coveragePct: cached.value, uninsuredSharePct: parseFloat((100 - cached.value).toFixed(1)), source: cached.source, date: cached.date, fetchedAt: cached.fetchedAt ?? cached.date };
    }
  }

  const result = (await fetchViaExa()) ?? (await fetchViaTavily());
  if (result) {
    await upsertPoints([{
      indicator: 'lps_deposit_coverage_value_pct',
      category: 'banking' as const,
      date: result.date,
      value: result.coveragePct,
      unit: 'pct',
      source: result.source,
      fetchedAt,
    }]);
    return result;
  }

  // Default fallback — structural Indonesia baseline (no DB write to avoid polluting time series)
  return { coveragePct: DEFAULT_COVERAGE_PCT, uninsuredSharePct: parseFloat((100 - DEFAULT_COVERAGE_PCT).toFixed(1)), source: 'default:lps_2024_baseline', date: today, fetchedAt };
}
