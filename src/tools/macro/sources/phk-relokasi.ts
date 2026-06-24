/**
 * PHK + relokasi pabrik tracker — M12 augmentation.
 *
 * Captures mass layoff and factory relocation events with worker-count magnitude,
 * not just sentiment scoring (which Module 12's existing social_unrest signal already does).
 *
 * Key signal: when a single event shows ≥5,000 workers at risk, that is a leading
 * indicator for FDI exit + political stress concentration in industrial regions
 * (Jatim, Jabar, Banten). The current Toyota/Honda Pasuruan-Mojokerto story
 * (~7,000 workers at risk per BISNIS Jun 23 2026) is the active example.
 *
 * DB INDICATORS:
 *   phk_workers_at_risk_30d   — max single-event worker count in 30-day window
 *   phk_events_30d_count       — distinct PHK/relokasi event count in 30-day window
 *   phk_top_headline_url       — pointer to source article (sourceUrl in cached point)
 */

import { getLatestPoint, upsertPoints } from '../time-series-db.js';
import type { MacroDataPoint } from '../types.js';

const FRESHNESS_DAYS = 3;

const DOMAINS = [
  'detik.com', 'cnbcindonesia.com', 'bisnis.com', 'kontan.co.id',
  'kompas.com', 'tempo.co', 'tribunnews.com', 'jpnn.com',
  'antaranews.com', 'liputan6.com', 'editor.id', 'mistar.id',
];

const QUERY = 'PHK massal Indonesia relokasi pabrik karyawan terancam tutup ribuan pekerja 2026';

/** Parse "7.000", "7 ribu", "7000" → 7000 */
function parseWorkerCount(s: string, unit: string): number | null {
  const cleaned = s.replace(/\./g, '').replace(',', '.');
  const v = parseFloat(cleaned);
  if (isNaN(v)) return null;
  // unit normalization: "ribu" multiplier 1000
  if (/ribu/i.test(unit)) return v * 1000;
  return v;
}

interface PhkEvent {
  workerCount: number;
  headline: string;
  url: string;
}

function extractEventsFromText(text: string, sourceUrl: string, title: string): PhkEvent[] {
  const events: PhkEvent[] = [];
  // Patterns covering "7.000 karyawan", "ribuan pegawai", "5 ribu buruh", "PHK 7.000 orang"
  const patterns: RegExp[] = [
    /(\d{1,3}(?:[.,]\d{3})+|\d+)\s*(karyawan|pegawai|pekerja|buruh|orang|tenaga\s+kerja)\s+(?:terancam|kena|terdampak|berpotensi)\s+PHK/gi,
    /PHK\s+(?:terhadap\s+|kepada\s+|sekitar\s+)?(\d{1,3}(?:[.,]\d{3})+|\d+)\s*(karyawan|pegawai|pekerja|buruh|orang|tenaga\s+kerja)/gi,
    /(\d+)\s+(ribu)\s+(karyawan|pegawai|pekerja|buruh)\s+(?:terancam|kena|khawatir|terdampak)/gi,
    /relokasi[\s\S]{0,80}?(\d{1,3}(?:[.,]\d{3})+|\d+)\s*(karyawan|pegawai|pekerja|buruh|tenaga\s+kerja)/gi,
  ];

  for (const pat of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pat.exec(text)) !== null) {
      const count = parseWorkerCount(m[1]!, m[2] ?? '');
      // sanity: 500-100,000 single-event range
      if (count !== null && count >= 500 && count <= 100_000) {
        events.push({ workerCount: count, headline: title, url: sourceUrl });
      }
    }
  }
  return events;
}

export interface PhkRelokasiData {
  date: string;
  workersAtRisk30d: number;
  eventCount30d: number;
  topHeadline: string;
  topUrl: string | null;
  fetchedAt: string;
}

async function fetchViaExa(): Promise<PhkRelokasiData | null> {
  if (!process.env.EXASEARCH_API_KEY) return null;
  try {
    const { default: Exa } = await import('exa-js');
    const exa = new Exa(process.env.EXASEARCH_API_KEY);
    const startDate = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

    const response = await exa.search(QUERY, {
      numResults: 8,
      type: 'auto',
      startPublishedDate: startDate,
      includeDomains: DOMAINS,
      contents: { text: { maxCharacters: 2000 } },
    } as Parameters<typeof exa.search>[1]);

    const all: PhkEvent[] = [];
    for (const r of (response.results ?? [])) {
      const text = ((r as { text?: string }).text ?? '') + ' ' + (r.title ?? '');
      all.push(...extractEventsFromText(text, r.url ?? '', r.title ?? ''));
    }
    if (all.length === 0) return null;
    all.sort((a, b) => b.workerCount - a.workerCount);
    const top = all[0]!;

    return {
      date: new Date().toISOString().slice(0, 10),
      workersAtRisk30d: top.workerCount,
      eventCount30d: all.length,
      topHeadline: top.headline,
      topUrl: top.url || null,
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

async function fetchViaTavily(): Promise<PhkRelokasiData | null> {
  if (!process.env.TAVILY_API_KEY) return null;
  try {
    const { TavilySearchAPIWrapper } = await import('@langchain/tavily');
    const tavily = new TavilySearchAPIWrapper({ tavilyApiKey: process.env.TAVILY_API_KEY });
    const response = await tavily.rawResults({
      query: QUERY,
      max_results: 8,
      include_domains: DOMAINS,
      include_raw_content: true,
      time_range: 'month',
    } as Parameters<typeof tavily.rawResults>[0]);

    const all: PhkEvent[] = [];
    for (const r of (response.results ?? [])) {
      const text = ((r.raw_content ?? r.content ?? '') as string) + ' ' + (r.title ?? '');
      all.push(...extractEventsFromText(text, r.url ?? '', r.title ?? ''));
    }
    if (all.length === 0) return null;
    all.sort((a, b) => b.workerCount - a.workerCount);
    const top = all[0]!;

    return {
      date: new Date().toISOString().slice(0, 10),
      workersAtRisk30d: top.workerCount,
      eventCount30d: all.length,
      topHeadline: top.headline,
      topUrl: top.url || null,
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function fetchPhkRelokasi(): Promise<PhkRelokasiData | null> {
  const cached = await getLatestPoint('phk_workers_at_risk_30d');
  if (cached) {
    const ageDays = (Date.now() - new Date(cached.fetchedAt).getTime()) / 86_400_000;
    if (ageDays < FRESHNESS_DAYS) {
      const ev = await getLatestPoint('phk_events_30d_count');
      return {
        date: cached.date,
        workersAtRisk30d: cached.value,
        eventCount30d: ev?.value ?? 0,
        topHeadline: '',
        topUrl: null,
        fetchedAt: cached.fetchedAt,
      };
    }
  }

  const data = (await fetchViaExa()) ?? (await fetchViaTavily());
  if (!data) return null;

  const points: MacroDataPoint[] = [
    {
      indicator: 'phk_workers_at_risk_30d',
      category: 'pangan',
      date: data.date,
      value: data.workersAtRisk30d,
      unit: 'workers',
      source: data.topUrl ?? 'exa_phk_relokasi',
      fetchedAt: data.fetchedAt,
    },
    {
      indicator: 'phk_events_30d_count',
      category: 'pangan',
      date: data.date,
      value: data.eventCount30d,
      unit: 'events',
      source: 'exa_phk_relokasi',
      fetchedAt: data.fetchedAt,
    },
  ];
  await upsertPoints(points);

  return data;
}
