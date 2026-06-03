/**
 * Political Risk data sources — Module 12
 *
 * 1. Unemployment rate — Trading Economics meta scrape (BPS quarterly)
 * 2. News sentiment — Exa search across 3 political risk signals
 *
 * Exa searches:
 *   food_pressure    — government response to sembako prices, farmer protests
 *   social_unrest    — labor protests (demo, PHK, unjuk rasa, mogok)
 *   political_stability — international/domestic political risk assessments
 *
 * Scoring: keyword-based title analysis (no LLM call). High-severity keywords
 * (Economist, otoriter, authoritarian, chaos) count 2x.
 *
 * Results cached as MacroDataPoint in time-series DB (once per day).
 * Exa only called when EXASEARCH_API_KEY is set.
 */
import type { MacroDataPoint } from '../types.js';

const NOW = () => new Date().toISOString();
const TODAY = () => new Date().toISOString().slice(0, 10);

// ─── Unemployment (BPS quarterly via Trading Economics) ────────────────────

/**
 * Fetch Indonesia unemployment rate from Trading Economics.
 * BPS quarterly — latest as of Q1 2026: 4.68%.
 * Pattern: "Unemployment Rate in Indonesia decreased to 4.68 ... in Q1 of 2026"
 */
export async function fetchUnemploymentTe(): Promise<MacroDataPoint | null> {
  try {
    const res = await fetch('https://tradingeconomics.com/indonesia/unemployment-rate', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Value: "Unemployment Rate in Indonesia decreased to 4.68"
    const valMatch = html.match(/Unemployment Rate in Indonesia \w+ to\s*([\d.]+)/i);
    if (!valMatch) return null;
    const value = parseFloat(valMatch[1]!);
    if (isNaN(value) || value < 1 || value > 25) return null;

    // Date: "in Q1 of 2026" or "in Q3 2025"
    const dateMatch = html.match(/in Q(\d)\s+(?:of\s+)?(\d{4})/i);
    let dateStr = TODAY();
    if (dateMatch) {
      const quarter = parseInt(dateMatch[1]!);
      const year = dateMatch[2]!;
      const quarterEndMonth: Record<number, string> = { 1: '03-31', 2: '06-30', 3: '09-30', 4: '12-31' };
      dateStr = `${year}-${quarterEndMonth[quarter] ?? '12-31'}`;
    }

    return {
      indicator: 'unemployment_rate_pct',
      category: 'pangan', // re-use available category — political is closest to social/pangan context
      date: dateStr,
      value: parseFloat(value.toFixed(2)),
      unit: '%',
      source: 'trading_economics_scrape',
      fetchedAt: NOW(),
    };
  } catch {
    return null;
  }
}

// ─── Exa news sentiment ────────────────────────────────────────────────────

export type NewsSentimentSignal = 'food_pressure' | 'social_unrest' | 'political_stability';

export interface SentimentResult {
  signal: NewsSentimentSignal;
  stressScore: number;   // 0-100
  negativeCount: number;
  positiveCount: number;
  highSeverityCount: number;
  headlines: string[];
  urls: string[];
  publishedDates: string[];  // ISO date per headline, parallel to headlines[]
}

const SIGNAL_QUERIES: Record<NewsSentimentSignal, string> = {
  food_pressure:       'Indonesia Prabowo sembako harga naik protes 2026',
  social_unrest:       'Indonesia demo unjuk rasa protes PHK pengangguran buruh 2026',
  political_stability: 'Indonesia politik risiko stabilitas Prabowo ekonomi 2026',
};

// Negative keywords — political stress signals
const NEGATIVE_TERMS = [
  'protes', 'demo', 'unjuk rasa', 'phk', 'naik', 'mahal', 'krisis', 'darurat',
  'kelangkaan', 'tuntut', 'kekacauan', 'risiko', 'berisiko', 'gejolak', 'otoriter',
  'mogok', 'aksi massa', 'ancaman', 'gagal', 'tidak terjangkau', 'tak terjangkau',
  'protest', 'unrest', 'crisis', 'chaotic', 'authoritarian', 'volatile', 'layoff',
  'strike', 'surge', 'soaring', 'unstable', 'risk', 'threat', 'concern',
];

// Positive keywords — stability signals
const POSITIVE_TERMS = [
  'stabil', 'terkendali', 'turun', 'normal', 'aman', 'terjangkau', 'surplus',
  'stable', 'controlled', 'decrease', 'recovery', 'growth', 'improved',
];

// High-severity — international attention or structural political risk (count 2×)
const HIGH_SEVERITY_TERMS = [
  'economist', 'internasional', 'otoriter', 'authoritarian', 'chaos', 'kekacauan',
  'darurat', 'emergency', 'krisis politik', 'political crisis', 'perbatasan krisis',
  'berisiko', 'jalur berisiko', 'gejolak mata uang',
];

function scoreTitle(title: string): { negative: number; positive: number; highSeverity: number } {
  const lower = title.toLowerCase();
  const negative = NEGATIVE_TERMS.filter((t) => lower.includes(t)).length;
  const positive = POSITIVE_TERMS.filter((t) => lower.includes(t)).length;
  const highSeverity = HIGH_SEVERITY_TERMS.filter((t) => lower.includes(t)).length;
  return { negative, positive, highSeverity };
}

/**
 * Run a single Exa news search and compute sentiment score.
 * Returns null if EXASEARCH_API_KEY not set or search fails.
 */
export async function searchNewsSentiment(signal: NewsSentimentSignal, daysBack = 7): Promise<SentimentResult | null> {
  if (!process.env.EXASEARCH_API_KEY) return null;

  try {
    const { default: Exa } = await import('exa-js');
    const exa = new Exa(process.env.EXASEARCH_API_KEY);
    const startDate = new Date(Date.now() - daysBack * 86_400_000).toISOString().slice(0, 10);

    const response = await exa.search(SIGNAL_QUERIES[signal], {
      numResults: 8,
      type: 'auto',
      startPublishedDate: startDate,
    });

    const results = response.results ?? [];
    let totalNegative = 0;
    let totalPositive = 0;
    let totalHighSeverity = 0;

    for (const item of results) {
      const { negative, positive, highSeverity } = scoreTitle(item.title ?? '');
      totalNegative += negative + highSeverity; // high-severity adds to negative
      totalPositive += positive;
      totalHighSeverity += highSeverity;
    }

    // Stress score: (negativeWeighted - positive) / results × 100, clamped 0-100
    const weightedNegative = totalNegative + totalHighSeverity; // high-severity counted twice
    const netStress = Math.max(0, weightedNegative - totalPositive);
    const stressScore = Math.min(100, Math.round((netStress / Math.max(results.length, 1)) * 25));

    const top4 = results.slice(0, 4);
    return {
      signal,
      stressScore,
      negativeCount: totalNegative,
      positiveCount: totalPositive,
      highSeverityCount: totalHighSeverity,
      headlines: top4.map((r) => r.title ?? '').filter(Boolean),
      urls: top4.map((r) => r.url ?? '').filter(Boolean),
      publishedDates: top4.map((r) => (r.publishedDate ?? '').slice(0, 10)),
    };
  } catch {
    return null;
  }
}

// ─── Seasonal context ──────────────────────────────────────────────────────

interface SeasonalEvent {
  name: string;
  // year: specific year only; undefined = every year (Natal/Tahun Baru are fixed-date)
  window: { year?: number; month: number; dayStart: number; dayEnd: number };
}

// Iduladha (10 Dzulhijjah) drifts ~11 days earlier each solar year — must be year-specific.
// Government sets date via rukyat; these are SKB/Kepmen confirmed dates + ±5d window.
// 2025: Jun 6  → Jun 1-15
// 2026: Jun 6  → Jun 1-15  (rukyat; hisab est. May 27)
// 2027: May 27 → May 22-31 + Jun 1-5
// 2028: May 16 → May 11-25
// Update each year when SKB 3 Menteri is published (biasanya Feb-Mar).
const SEASONAL_EVENTS: SeasonalEvent[] = [
  { name: 'Iduladha', window: { year: 2025, month: 6, dayStart: 1,  dayEnd: 15 } },
  { name: 'Iduladha', window: { year: 2026, month: 6, dayStart: 1,  dayEnd: 15 } },
  { name: 'Iduladha', window: { year: 2027, month: 5, dayStart: 22, dayEnd: 31 } },
  { name: 'Iduladha', window: { year: 2027, month: 6, dayStart: 1,  dayEnd: 5  } },
  { name: 'Iduladha', window: { year: 2028, month: 5, dayStart: 11, dayEnd: 25 } },
  { name: 'Natal/Tahun Baru', window: { month: 12, dayStart: 20, dayEnd: 31 } },
  { name: 'Tahun Baru',       window: { month: 1,  dayStart: 1,  dayEnd: 7  } },
];

/**
 * Returns seasonal event name if today is within a known food-price spike window.
 * Food price stress during these windows = partially expected (seasonal, lower political weight).
 */
export function detectSeasonalContext(): string | null {
  const now = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1;
  const day   = now.getDate();
  for (const event of SEASONAL_EVENTS) {
    if (event.window.year !== undefined && event.window.year !== year) continue;
    if (event.window.month === month && day >= event.window.dayStart && day <= event.window.dayEnd) {
      return event.name;
    }
  }
  return null;
}
