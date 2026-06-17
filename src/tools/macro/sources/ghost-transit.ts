/**
 * Hormuz Ghost Transit Signal — dark shipping / AIS-invisible tanker flow.
 *
 * WHY THIS MATTERS:
 *   "Ghost transits" = tankers that disable AIS transponders near Hormuz to avoid
 *   targeting. Kpler, Lloyd's of London, and GS commodity desk track these separately
 *   from official visible flows. Per Haye thread (Jun 2026):
 *     visible Hormuz traffic ≈ 15% of pre-war baseline
 *     ghost transits ≈ 2M bbl/day (off-AIS, higher risk premium)
 *
 *   Implication: actual physical supply through Hormuz is LESS disrupted than zero-ghost
 *   models assume, but EACH barrel carries embedded risk premium → Rotterdam/Singapore
 *   spread spikes when ghost traffic falls (fewer ships willing to run dark).
 *
 *   When ghost transits fall AND Brent-Dubai spread widens:
 *     → physical supply crunch more severe than paper market implies
 *     → M6 check #11 Hormuz flag + ghost transit = compounding signal
 *
 * DATA SOURCE:
 *   Exa neural search → Bloomberg, Reuters, Lloyd's List, Kpler, Platts, GS/MS desk notes.
 *   Primary search: English-language shipping/commodity financial news.
 *   3-day freshness gate (data shifts with tanker repositioning cadence).
 *
 * PRE-WAR BASELINE: ~20M bbl/day (2024 Hormuz average, EIA/IEA).
 *
 * ALERT THRESHOLDS (visible traffic as % of pre-war):
 *   GREEN:  >80% — minimal disruption, spot rerouting
 *   YELLOW: 50-80% — moderate disruption, freight premium elevated
 *   ORANGE: 20-50% — severe disruption, ghost traffic fills gap
 *   RED:    <20%  — extreme, physical supply constraint; ghost traffic dominant
 */

import { getLatestPoint, upsertPoints } from '../time-series-db.js';
import type { AlertLevel } from '../types.js';

export interface GhostTransitData {
  date: string;
  visibleTrafficMbpd: number | null;      // AIS-visible tanker flow (M bbl/day)
  ghostTransitMbpd: number | null;        // off-AIS estimate (M bbl/day)
  visiblePctPrewar: number | null;        // visible as % of 20M bbl/day baseline
  totalEstimatedMbpd: number | null;      // visible + ghost
  alert: AlertLevel;
  sourceUrl: string | null;
  fetchedAt: string;
}

const FRESHNESS_DAYS = 3;
const PREWAR_BASELINE_MBPD = 20;         // EIA/IEA 2024 Hormuz baseline

const SEARCH_DOMAINS = [
  'bloomberg.com', 'reuters.com', 'lloydslist.com',
  'platts.com', 'spglobal.com', 'oilprice.com',
  'bloombergtechnoz.com', 'bisnis.com', 'cnbcindonesia.com',
];
const SEARCH_QUERY = 'Hormuz strait tanker traffic ghost transit dark shipping AIS million barrels per day 2026';

function scoreAlert(visiblePct: number | null): AlertLevel {
  if (visiblePct === null) return 'green';
  if (visiblePct < 20)  return 'red';
  if (visiblePct < 50)  return 'orange';
  if (visiblePct < 80)  return 'yellow';
  return 'green';
}

function parseNumber(text: string, patterns: RegExp[]): number | null {
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) {
      const val = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(val)) return val;
    }
  }
  return null;
}

function parseGhostTransitText(text: string): Omit<GhostTransitData, 'date' | 'alert' | 'sourceUrl' | 'fetchedAt'> {
  const lower = text.toLowerCase();

  // Visible traffic as % of pre-war
  // e.g. "15% of pre-war", "15 percent of pre-conflict", "fallen to 15%"
  const visiblePctPrewar = parseNumber(lower, [
    /(\d+(?:\.\d+)?)\s*%\s*(?:of\s+)?(?:pre[-\s]?war|pre[-\s]?conflict|pre[-\s]?crisis)\s+(?:baseline|level|flow|traffic)/i,
    /(?:traffic|flow|transit)\s+(?:at|to|of)\s+(\d+(?:\.\d+)?)\s*%\s*(?:of\s+)?(?:pre[-\s]?war|normal)/i,
    /(?:fallen|declined|dropped)\s+to\s+(\d+(?:\.\d+)?)\s*%/i,
  ]);

  // Visible traffic in M bbl/day
  // e.g. "3 million barrels per day", "3 mbpd", "3M bpd visible"
  const visibleTrafficMbpd = parseNumber(text, [
    /visible\s+(?:traffic|flow|transit)[^\d]{0,30}(\d+(?:\.\d+)?)\s*(?:million\s+barrels?(?:\s+per\s+day)?|m?\s*b(?:pd|bl\/d))/i,
    /(\d+(?:\.\d+)?)\s*(?:million\s+barrels?(?:\s+per\s+day)?|m?\s*b(?:pd|bl\/d))\s+(?:visible|through|transiting|passing)/i,
    /strait\s+(?:traffic|flow)[^\d]{0,30}(\d+(?:\.\d+)?)\s*(?:million|M)\s*b(?:pd|bl)/i,
  ]);

  // Ghost transit / dark shipping estimate
  // e.g. "ghost transits of 2 million", "dark shipping approximately 2 mbpd"
  const ghostTransitMbpd = parseNumber(text, [
    /ghost\s+transit[^\d]{0,30}(\d+(?:\.\d+)?)\s*(?:million\s+barrels?(?:\s+per\s+day)?|m?\s*b(?:pd|bl\/d))/i,
    /dark\s+(?:shipping|transit|flow)[^\d]{0,30}(\d+(?:\.\d+)?)\s*(?:million|M)\s*b(?:pd|bl)/i,
    /(?:off[-\s]?AIS|AIS[-\s]?dark|transponder[-\s]?off)[^\d]{0,50}(\d+(?:\.\d+)?)\s*(?:million|M)?\s*(?:barrels?|bbl|b(?:pd|\/d))/i,
    /approximately\s+(\d+(?:\.\d+)?)\s*(?:million\s+barrels?(?:\s+per\s+day)?|M\s*bpd)\s+(?:ghost|dark|off[-\s]?AIS)/i,
  ]);

  // Derive visible % from mbpd if not found directly
  const derivedVisiblePct = visiblePctPrewar !== null
    ? visiblePctPrewar
    : (visibleTrafficMbpd !== null
        ? parseFloat(((visibleTrafficMbpd / PREWAR_BASELINE_MBPD) * 100).toFixed(1))
        : null);

  const totalEstimatedMbpd = (visibleTrafficMbpd !== null && ghostTransitMbpd !== null)
    ? parseFloat((visibleTrafficMbpd + ghostTransitMbpd).toFixed(2))
    : null;

  return { visibleTrafficMbpd, ghostTransitMbpd, visiblePctPrewar: derivedVisiblePct, totalEstimatedMbpd };
}

async function fetchViaExa(): Promise<GhostTransitData | null> {
  if (!process.env.EXASEARCH_API_KEY) return null;
  try {
    const { default: Exa } = await import('exa-js');
    const exa = new Exa(process.env.EXASEARCH_API_KEY);
    const startDate = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);

    const response = await exa.search(SEARCH_QUERY, {
      numResults: 4,
      type: 'neural',
      startPublishedDate: startDate,
      contents: { text: { maxCharacters: 2000 } },
    } as Parameters<typeof exa.search>[1]);

    const results = response.results ?? [];
    for (const r of results) {
      const text = (r as { text?: string }).text ?? r.title ?? '';
      if (!text) continue;
      const parsed = parseGhostTransitText(text);
      // Accept if at least one meaningful field found
      if (parsed.visiblePctPrewar !== null || parsed.ghostTransitMbpd !== null || parsed.visibleTrafficMbpd !== null) {
        const date = (r.publishedDate ?? new Date().toISOString()).slice(0, 10);
        return {
          ...parsed,
          date,
          alert: scoreAlert(parsed.visiblePctPrewar),
          sourceUrl: r.url ?? null,
          fetchedAt: new Date().toISOString(),
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchViaTavily(): Promise<GhostTransitData | null> {
  if (!process.env.TAVILY_API_KEY) return null;
  try {
    const { TavilySearchAPIWrapper } = await import('@langchain/tavily');
    const tavily = new TavilySearchAPIWrapper({ tavilyApiKey: process.env.TAVILY_API_KEY });

    const response = await tavily.rawResults({
      query: 'Hormuz strait tanker traffic ghost transit dark shipping mbpd percent pre-war 2026',
      max_results: 3,
      include_raw_content: true,
      time_range: 'month',
    } as Parameters<typeof tavily.rawResults>[0]);

    for (const r of (response.results ?? [])) {
      const text = r.raw_content ?? r.content ?? '';
      if (!text) continue;
      const parsed = parseGhostTransitText(text);
      if (parsed.visiblePctPrewar !== null || parsed.ghostTransitMbpd !== null || parsed.visibleTrafficMbpd !== null) {
        return {
          ...parsed,
          date: new Date().toISOString().slice(0, 10),
          alert: scoreAlert(parsed.visiblePctPrewar),
          sourceUrl: r.url ?? null,
          fetchedAt: new Date().toISOString(),
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch Hormuz ghost transit signal. Returns null if Hormuz not disrupted or no data.
 * Freshness gate: 3 days. Tries Exa first, Tavily fallback.
 */
export async function fetchHormuzGhostTransit(): Promise<GhostTransitData | null> {
  // Freshness gate
  const cached = await getLatestPoint('hormuz_visible_traffic_pct_prewar');
  if (cached) {
    const ageDays = (Date.now() - new Date(cached.fetchedAt ?? cached.date).getTime()) / 86_400_000;
    if (ageDays < FRESHNESS_DAYS) {
      const ghostCached = await getLatestPoint('hormuz_ghost_transit_mbpd');
      return {
        date: cached.date,
        visiblePctPrewar: cached.value,
        visibleTrafficMbpd: cached.value !== null ? parseFloat(((cached.value / 100) * PREWAR_BASELINE_MBPD).toFixed(2)) : null,
        ghostTransitMbpd: ghostCached?.value ?? null,
        totalEstimatedMbpd: null,
        alert: scoreAlert(cached.value),
        sourceUrl: null,
        fetchedAt: cached.fetchedAt ?? cached.date,
      };
    }
  }

  const data = await fetchViaExa() ?? await fetchViaTavily();
  if (!data) return null;

  // Persist to DB
  const points = [];
  if (data.visiblePctPrewar !== null) {
    points.push({
      indicator: 'hormuz_visible_traffic_pct_prewar',
      category: 'commodity' as const,
      date: data.date,
      value: data.visiblePctPrewar,
      unit: '%_of_prewar',
      source: data.sourceUrl ?? 'exa_search',
      fetchedAt: data.fetchedAt,
    });
  }
  if (data.ghostTransitMbpd !== null) {
    points.push({
      indicator: 'hormuz_ghost_transit_mbpd',
      category: 'commodity' as const,
      date: data.date,
      value: data.ghostTransitMbpd,
      unit: 'M_bbl_day',
      source: data.sourceUrl ?? 'exa_search',
      fetchedAt: data.fetchedAt,
    });
  }
  if (points.length > 0) await upsertPoints(points);

  return data;
}

export function formatGhostTransit(data: GhostTransitData): string {
  const visible = data.visiblePctPrewar !== null ? `${data.visiblePctPrewar.toFixed(0)}% of pre-war` : 'n/a';
  const ghost   = data.ghostTransitMbpd  !== null ? `${data.ghostTransitMbpd.toFixed(1)}M bbl/d ghost` : '';
  const total   = data.totalEstimatedMbpd !== null ? `${data.totalEstimatedMbpd.toFixed(1)}M bbl/d total est.` : '';
  return [
    `Hormuz visible traffic: ${visible}`,
    ghost,
    total,
    data.alert !== 'green' ? `[${data.alert.toUpperCase()}]` : '',
  ].filter(Boolean).join(' | ');
}
