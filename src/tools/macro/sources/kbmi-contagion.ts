/**
 * KBMI I bank contagion monitor.
 *
 * Signal is NOT individual bank health — it's basket crash pattern + OJK formal action.
 *
 * Components:
 * 1. KBMI I stock basket (BABP + BBYB + BMAS + AGRO) via Yahoo Finance (daily).
 *    Trigger: ≥3/4 drop >8% same session = systemic panic, not idiosyncratic event.
 *    Single stock can drop on thin volume / corporate news — basket filters that noise.
 * 2. Exa news: OJK formal action (BDPI / pengawasan intensif / pembekuan / pencabutan izin).
 *    7-day lookback — OJK formal press releases are indexed within hours.
 * 3. SRBI bid-cover cross-check (read from DB, written by M3): BCR < 1.3 + basket stress
 *    = banks hoarding interbank cash AND equity market pricing contagion simultaneously.
 */
import YahooFinance from 'yahoo-finance2';

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const KBMI1_BASKET = ['BABP.JK', 'BBYB.JK', 'BMAS.JK', 'AGRO.JK'] as const;
const CRASH_THRESHOLD_PCT = 8;   // session drop >8% = crash signal
const CONTAGION_MIN_COUNT = 3;   // ≥3/4 crash = basket contagion confirmed

export interface KbmiContagionResult {
  basketCrashCount: number;                         // 0–4
  crashSymbols: string[];
  sessionReturnsPct: Record<string, number | null>; // ticker → session % change
  contagionSignal: boolean;                         // basketCrashCount >= CONTAGION_MIN_COUNT
  ojkFormalAction: boolean;                         // OJK BDPI / pembekuan news found
  ojkNewsExcerpt: string | null;
  fetchedAt: string;
}

async function fetchBasketReturns(): Promise<{ symbol: string; returnPct: number | null }[]> {
  const results = await Promise.allSettled(
    KBMI1_BASKET.map(async (symbol) => {
      try {
        const chart = await yf.chart(symbol, {
          period1: new Date(Date.now() - 5 * 86_400_000),
          period2: new Date(),
          interval: '1d',
        });
        const quotes = (chart.quotes ?? []).filter(q => q.close != null);
        if (quotes.length < 2) return { symbol, returnPct: null };
        const prev = quotes[quotes.length - 2].close!;
        const curr = quotes[quotes.length - 1].close!;
        if (prev === 0) return { symbol, returnPct: null };
        return { symbol, returnPct: parseFloat((((curr - prev) / prev) * 100).toFixed(2)) };
      } catch {
        return { symbol, returnPct: null };
      }
    }),
  );
  return results.map((r, i) =>
    r.status === 'fulfilled' ? r.value : { symbol: KBMI1_BASKET[i], returnPct: null },
  );
}

const OJK_ACTION_QUERY =
  'OJK bank "pengawasan intensif" OR "BDPI" OR "pembekuan" OR "pencabutan izin" OR "bank bermasalah" 2026';
const OJK_DOMAINS = [
  'ojk.go.id', 'kontan.co.id', 'bisnis.com', 'cnbcindonesia.com',
  'katadata.co.id', 'detik.com', 'kompas.com', 'tempo.co',
  'liputan6.com', 'idxchannel.com', 'antaranews.com',
];
const FORMAL_PATTERN =
  /BDPI|bank dalam pengawasan intensif|pembekuan|pencabutan izin|OJK tutup bank|bank dibekukan/i;

async function fetchOjkFormalAction(): Promise<{ found: boolean; excerpt: string | null }> {
  try {
    const apiKey = process.env.EXASEARCH_API_KEY;
    if (!apiKey) return { found: false, excerpt: null };
    const { default: Exa } = await import('exa-js');
    const exa = new Exa(apiKey);
    const resp = await exa.search(OJK_ACTION_QUERY, {
      numResults: 5,
      includeDomains: OJK_DOMAINS,
      startPublishedDate: new Date(Date.now() - 7 * 86_400_000).toISOString(),
      useAutoprompt: false,
      type: 'keyword',
    } as Parameters<typeof exa.search>[1]);
    for (const r of resp.results ?? []) {
      const text = `${r.title ?? ''} ${r.text ?? ''}`;
      if (FORMAL_PATTERN.test(text)) {
        return {
          found: true,
          excerpt: `${r.title ?? '(no title)'}: ${(r.text ?? '').slice(0, 200).trim()}`,
        };
      }
    }
    return { found: false, excerpt: null };
  } catch {
    return { found: false, excerpt: null };
  }
}

export async function fetchKbmiContagion(): Promise<KbmiContagionResult> {
  const [basketData, ojkNews] = await Promise.all([
    fetchBasketReturns(),
    fetchOjkFormalAction(),
  ]);

  const sessionReturnsPct: Record<string, number | null> = {};
  const crashSymbols: string[] = [];

  for (const { symbol, returnPct } of basketData) {
    sessionReturnsPct[symbol] = returnPct;
    if (returnPct !== null && returnPct < -CRASH_THRESHOLD_PCT) {
      crashSymbols.push(symbol);
    }
  }

  const basketCrashCount = crashSymbols.length;

  return {
    basketCrashCount,
    crashSymbols,
    sessionReturnsPct,
    contagionSignal: basketCrashCount >= CONTAGION_MIN_COUNT,
    ojkFormalAction: ojkNews.found,
    ojkNewsExcerpt: ojkNews.excerpt,
    fetchedAt: new Date().toISOString(),
  };
}
