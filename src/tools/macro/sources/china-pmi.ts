/**
 * China Manufacturing PMI — M4 demand signal for Indonesia export basket.
 *
 * Tracks Caixin/NBS China manufacturing PMI. China = Indonesia's largest export
 * market (coal ~40%, nickel ~60%, CPO). PMI <50 = demand contraction = cushion erosion.
 *
 * Release calendar:
 *   NBS PMI:    last business day of each month (official)
 *   Caixin PMI: 1st business day of each month (private, market-sensitive)
 *
 * Score impact in M4 commodity:
 *   PMI > 51:  −3 pts  (demand expansion — export cushion positive)
 *   PMI 50-51:  0 pts  (neutral)
 *   PMI 49-50: +5 pts  (mild contraction)
 *   PMI 48-49: +10 pts (notable contraction)
 *   PMI < 48:  +15 pts (demand destruction — coal/nickel/CPO at risk)
 *
 * DB indicator: china_pmi_manufacturing (unit: index_50), category: commodity.
 * Freshness: 35 days (monthly release + buffer).
 *
 * Env override: CHINA_PMI_MANUFACTURING — always wins when set (e.g. "49.5").
 */

import { getLatestPoint, upsertPoints } from '../time-series-db.js';

const FRESHNESS_DAYS = 35;

export interface ChinaPmiData {
  value: number;
  date: string;
  source: string;
  fetchedAt: string;
}

function parsePmiFromText(text: string, url?: string | null): number | null {
  const lower = text.toLowerCase();
  // Must mention China/Caixin/NBS — also accept Chinese-language PMI titles or known trusted domains
  const trustedDomain = url && /caixin\.com|stats\.gov\.cn|xinhuanet|xinhua\.net|english\.news\.cn/.test(url);
  const hasChina = trustedDomain
    || lower.includes('china')
    || lower.includes('caixin')
    || lower.includes('nbs china')
    || lower.includes('tiongkok')
    || lower.includes('统计局') // NBS Chinese
    || lower.includes('制造业pmi'); // "manufacturing PMI" in Chinese
  if (!hasChina) return null;
  if (!lower.includes('pmi') && !lower.includes('caixin') && !lower.includes('制造业pmi')) return null;
  // Reject other-country PMIs
  if (/\bindia\b.*pmi|\bpmi\b.*\bindia\b|\beuropean?\b.*pmi|\bus\s+pmi|\bunited states.*pmi/i.test(text)) return null;
  // Reject forward-looking forecasts (calendar events, previews, expectations)
  if (/forecast|preview|expecte[d]|calendar|upcoming|konsensus|prediksi/i.test(lower) && !lower.includes('actual')) return null;

  // Number near "pmi" with any intervening words (e.g. "PMI falls to 49.3", "PMI降至49.3")
  const afterPmi = text.match(/pmi[降至:\s至到]+(\d{2}\.?\d?)/i)
    ?? text.match(/pmi[^0-9]{0,40}?(\d{2}\.\d)/i);
  if (afterPmi) {
    const val = parseFloat(afterPmi[1]!);
    if (val >= 40 && val <= 65) return val;
  }

  // Number right before or after "caixin" (e.g. "Caixin PMI Slows to 50.9")
  const caixin = text.match(/caixin[^0-9]*(\d{2}\.?\d)/i) ?? text.match(/(\d{2}\.?\d)[^%\d]{0,20}caixin/i);
  if (caixin) {
    const val = parseFloat(caixin[1]!);
    if (val >= 40 && val <= 65) return val;
  }

  // Generic: number near "china manufacturing" or "制造业PMI"
  const generic = text.match(/china[^0-9]{0,50}manufacturing[^0-9]*(\d{2}\.?\d)/i)
    ?? text.match(/manufacturing[^0-9]{0,50}china[^0-9]*(\d{2}\.?\d)/i)
    ?? text.match(/制造业pmi[^0-9]*(\d{2}\.?\d)/i)
    ?? text.match(/(\d{2}\.\d)[^0-9]{0,20}制造业/i);
  if (generic) {
    const val = parseFloat(generic[1]!);
    if (val >= 40 && val <= 65) return val;
  }

  return null;
}

async function fetchViaExa(): Promise<ChinaPmiData | null> {
  if (!process.env.EXASEARCH_API_KEY) return null;
  try {
    const { default: Exa } = await import('exa-js');
    const exa = new Exa(process.env.EXASEARCH_API_KEY);
    const now = new Date();
    const cur = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
    // Tier 1: tight 7d window for current month official release
    const tight7d = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    // Tier 2: wider 45d window for prev month / fallback
    const wide45d = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);
    const queries: [string, string][] = [
      [`Caixin China manufacturing PMI ${cur} reading`, tight7d],
      [`China NBS manufacturing PMI ${cur}`, tight7d],
      [`China manufacturing PMI falls ${cur}`, tight7d],
      [`Caixin China manufacturing PMI ${prev} reading`, wide45d],
      ['China factory PMI latest monthly reading index', wide45d],
    ];
    for (const [query, startDate] of queries) {
      const resp = await exa.search(query, {
        numResults: 5,
        type: 'auto',
        startPublishedDate: startDate,
        contents: { text: { maxCharacters: 600 } },
      } as Parameters<typeof exa.search>[1]);
      for (const r of resp.results ?? []) {
        const text = ((r as { text?: string }).text ?? '') + ' ' + (r.title ?? '');
        const val = parsePmiFromText(text, r.url);
        if (val !== null) {
          return {
            value: val,
            date: (r.publishedDate ?? new Date().toISOString()).slice(0, 10),
            source: 'exa:' + (r.url ?? query),
            fetchedAt: new Date().toISOString(),
          };
        }
      }
    }
  } catch { /* silent */ }
  return null;
}

async function fetchViaTavily(): Promise<ChinaPmiData | null> {
  if (!process.env.TAVILY_API_KEY) return null;
  try {
    const { TavilySearchAPIWrapper } = await import('@langchain/tavily');
    const tavily = new TavilySearchAPIWrapper({ tavilyApiKey: process.env.TAVILY_API_KEY });
    const now = new Date();
    const cur = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    const resp = await tavily.rawResults({
      query: `Caixin China manufacturing PMI ${cur} latest reading`,
      max_results: 5,
      include_raw_content: false,
      time_range: 'month',
    } as Parameters<typeof tavily.rawResults>[0]);
    for (const r of resp.results ?? []) {
      const text = (r.content ?? '') + ' ' + (r.title ?? '');
      const val = parsePmiFromText(text, r.url);
      if (val !== null) {
        return {
          value: val,
          date: new Date().toISOString().slice(0, 10),
          source: 'tavily:' + (r.url ?? ''),
          fetchedAt: new Date().toISOString(),
        };
      }
    }
  } catch { /* silent */ }
  return null;
}

/**
 * Fetch China manufacturing PMI.
 * Priority: env override → DB cache (35d) → Exa → Tavily.
 */
export async function fetchChinaPmi(): Promise<ChinaPmiData | null> {
  // Env override always wins
  if (process.env.CHINA_PMI_MANUFACTURING) {
    const val = parseFloat(process.env.CHINA_PMI_MANUFACTURING);
    if (!isNaN(val) && val >= 40 && val <= 65) {
      const today = new Date().toISOString().slice(0, 10);
      return { value: val, date: today, source: 'env:CHINA_PMI_MANUFACTURING', fetchedAt: new Date().toISOString() };
    }
  }

  const fetchedAt = new Date().toISOString();
  const today = new Date().toISOString().slice(0, 10);

  // DB freshness check — gate on data DATE (not fetchedAt) so monthly releases trigger re-fetch
  const cached = await getLatestPoint('china_pmi_manufacturing');
  if (cached) {
    const ageDays = (Date.now() - new Date(cached.date).getTime()) / 86_400_000;
    if (ageDays < FRESHNESS_DAYS) {
      return { value: cached.value, date: cached.date, source: cached.source, fetchedAt: cached.fetchedAt ?? cached.date };
    }
  }

  const result = (await fetchViaExa()) ?? (await fetchViaTavily());
  if (result) {
    await upsertPoints([{
      indicator: 'china_pmi_manufacturing',
      category: 'commodity' as const,
      date: result.date,
      value: result.value,
      unit: 'index_50',
      source: result.source,
      fetchedAt,
    }]);
    return result;
  }

  // Return cached (stale) rather than null if available
  if (cached) return { value: cached.value, date: cached.date, source: cached.source + ':stale', fetchedAt: cached.fetchedAt ?? cached.date };
  return null;
}

/** Score contribution to M4 commodity engine (0 or negative = cushion, positive = stress). */
export function scoreChinaPmi(pmi: number): number {
  if (pmi > 51) return -3;
  if (pmi >= 50) return 0;
  if (pmi >= 49) return 5;
  if (pmi >= 48) return 10;
  return 15;
}
