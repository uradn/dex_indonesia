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
const KEMNAKER_YTD_FRESHNESS_DAYS = 35;

const MONTH_NAMES_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

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

function parseYtdWorkers(text: string): number | null {
  const lower = text.toLowerCase();
  const contextPatterns: RegExp[] = [
    /jkp[\s\S]{0,200}?(\d{2,3}[.,]\d{3})\s*(?:orang|pekerja|tenaga\s+kerja)/i,
    /phk[\s\S]{0,100}?(\d{2,3}[.,]\d{3})\s*(?:orang|pekerja|tenaga\s+kerja)/i,
    /(\d{2,3}[.,]\d{3})\s*(?:orang|pekerja|tenaga\s+kerja)[\s\S]{0,100}?(?:kumulatif|ytd|sepanjang|sejak awal|total)/i,
    /kumulatif[\s\S]{0,150}?(\d{2,3}[.,]\d{3})\s*(?:orang|pekerja|tenaga\s+kerja)/i,
  ];
  for (const pat of contextPatterns) {
    const m = lower.match(pat);
    if (m) {
      const raw = m[1]!.replace(/\./g, '').replace(',', '');
      const v = parseInt(raw, 10);
      if (!isNaN(v) && v >= 1_000 && v <= 500_000) return v;
    }
  }
  return null;
}

/**
 * Fetch Kemnaker JKP cumulative YTD PHK count from Exa/Tavily media search.
 * This is the monthly cumulative total (satudata.kemnaker.go.id JKP data),
 * NOT the same as phk_workers_at_risk_30d (single-event max).
 * Freshness: 35 days (Kemnaker publishes monthly, media covers first week of each month).
 */
export async function fetchPhkYtdKemnaker(): Promise<number | null> {
  const cached = await getLatestPoint('phk_ytd_kemnaker');
  if (cached) {
    const ageMs = Date.now() - new Date(cached.fetchedAt ?? cached.date).getTime();
    if (ageMs < KEMNAKER_YTD_FRESHNESS_DAYS * 86_400_000) return cached.value;
  }

  if (!process.env.EXASEARCH_API_KEY && !process.env.TAVILY_API_KEY) return null;

  const now = new Date();
  const year = now.getFullYear();
  const monthName = MONTH_NAMES_ID[now.getMonth()]!;
  const query = `Kemnaker JKP PHK ${monthName} ${year} kumulatif tenaga kerja total Indonesia`;

  let rawText = '';
  try {
    if (process.env.EXASEARCH_API_KEY) {
      const resp = await fetch('https://api.exa.ai/search', {
        method: 'POST',
        headers: { 'x-api-key': process.env.EXASEARCH_API_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          numResults: 5,
          includeDomains: ['satudata.kemnaker.go.id', 'kemnaker.go.id', 'cnbcindonesia.com', 'bisnis.com', 'kompas.com', 'detik.com', 'antaranews.com'],
          contents: { text: { maxCharacters: 1500 } },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (resp.ok) {
        const data = await resp.json() as { results?: Array<{ text?: string; title?: string }> };
        rawText = (data.results ?? []).map(r => `${r.title ?? ''}: ${r.text ?? ''}`).join('\n');
      }
    }
    if (!rawText && process.env.TAVILY_API_KEY) {
      const resp = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: process.env.TAVILY_API_KEY,
          query,
          max_results: 5,
          include_domains: ['kemnaker.go.id', 'cnbcindonesia.com', 'bisnis.com', 'kompas.com', 'detik.com', 'antaranews.com'],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (resp.ok) {
        const data = await resp.json() as { results?: Array<{ content?: string; title?: string }> };
        rawText = (data.results ?? []).map(r => `${r.title ?? ''}: ${r.content ?? ''}`).join('\n');
      }
    }
  } catch { return null; }

  if (!rawText) return null;
  const value = parseYtdWorkers(rawText);
  if (value === null) return null;

  const today = new Date().toISOString().slice(0, 10);
  await upsertPoints([{
    indicator: 'phk_ytd_kemnaker',
    category: 'pangan',
    date: today,
    value,
    unit: 'workers',
    source: 'exa_kemnaker_ytd',
    fetchedAt: new Date().toISOString(),
  }]);

  return value;
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
