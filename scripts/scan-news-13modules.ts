/**
 * One-shot news scan across all 13 macro modules using Exa + Tavily.
 * Usage: bun scripts/scan-news-13modules.ts
 *
 * Prints ranked headlines per module, filtered to last 7 days.
 */
import 'dotenv/config';

type Hit = { title: string; url: string; date: string; snippet: string; source: 'exa' | 'tavily' };

const MODULES: Array<{ id: string; name: string; queries: string[] }> = [
  { id: 'M1', name: 'BoP / Current Account', queries: [
    'Indonesia neraca pembayaran current account defisit BI 2026',
    'Indonesia balance of payments Q2 2026 current account deficit',
  ]},
  { id: 'M2', name: 'Sovereign Risk (CDS, SBN, rating)', queries: [
    'Indonesia CDS 5Y spread bps sovereign risk 2026',
    'Indonesia SBN 10Y yield tenor 10 tahun imbal hasil terbaru',
    'Indonesia sovereign credit rating Fitch Moody S&P outlook 2026',
  ]},
  { id: 'M3', name: 'FX Defense (IDR, cadev, DNDF, BI intervention)', queries: [
    'Rupiah kurs USDIDR intervensi BI cadangan devisa Juli Agustus 2026',
    'Bank Indonesia FX intervention triple defense DNDF July August 2026',
  ]},
  { id: 'M4', name: 'Commodity (batubara, CPO, nikel, Brent)', queries: [
    'Indonesia ekspor batubara CPO nikel harga terbaru Agustus 2026',
    'Brent oil price Indonesia ICP August 2026 commodity export',
  ]},
  { id: 'M5', name: 'Foreign Flow (SBN, IHSG, offshore)', queries: [
    'foreign outflow SBN IHSG asing jual saham obligasi Juli Agustus 2026',
    'Indonesia foreign portfolio flow bonds equities net inflow outflow 2026',
  ]},
  { id: 'M6', name: 'Narrative Divergence (official vs market)', queries: [
    'Sri Mulyani Purbaya Airlangga menteri keuangan pernyataan ekonomi Agustus 2026',
    'Bank Indonesia Perry Warjiyo statement rupiah stabil outlook August 2026',
  ]},
  { id: 'M7', name: 'ASEAN Relative Value', queries: [
    'ASEAN currency baht ringgit peso rupiah performance August 2026',
    'ASEAN sovereign spread Thailand Malaysia Philippines Indonesia CDS 2026',
  ]},
  { id: 'M8', name: 'Banking Stress (NPL, CAR, LDR)', queries: [
    'OJK NPL CAR LDR perbankan Indonesia Juni Juli 2026',
    'Indonesia bank stress kredit macet likuiditas July August 2026',
  ]},
  { id: 'M9', name: 'Market Stress (VIX, DXY, EMFX)', queries: [
    'VIX DXY dollar index emerging market currency selloff August 2026',
    'global risk-off emerging market Asia August 2026 flight to quality',
  ]},
  { id: 'M10', name: 'Fiscal (APBN, defisit, tax, subsidi)', queries: [
    'APBN 2026 realisasi defisit pajak subsidi Kemenkeu Juli Agustus',
    'Indonesia fiscal deficit tax revenue subsidy realization July August 2026',
  ]},
  { id: 'M11', name: 'Domestic Pressure (inflasi, BBM, sembako, konsumsi)', queries: [
    'inflasi BPS Juli 2026 sembako BBM Pertalite Pertamax harga',
    'Indonesia inflation food fuel price CPI July August 2026',
  ]},
  { id: 'M12', name: 'Political Risk (demo, unrest, koalisi, Prabowo)', queries: [
    'demo protes Prabowo koalisi kabinet DPR Agustus 2026',
    'Indonesia political unrest protest cabinet reshuffle August 2026',
  ]},
  { id: 'M13', name: 'External Debt / ULN', queries: [
    'ULN Indonesia utang luar negeri swasta pemerintah Juni Juli 2026',
    'Indonesia external debt private public SULNI Q2 2026',
  ]},
];

const TODAY = new Date();
const LOOKBACK_DAYS = 7;
const FRESH_MS = LOOKBACK_DAYS * 86_400_000;
const START_DATE = new Date(Date.now() - FRESH_MS).toISOString().slice(0, 10);

async function exaSearch(query: string): Promise<Hit[]> {
  if (!process.env.EXASEARCH_API_KEY) return [];
  try {
    const { default: Exa } = await import('exa-js');
    const exa = new Exa(process.env.EXASEARCH_API_KEY);
    const res = await exa.search(query, {
      numResults: 5,
      type: 'neural',
      startPublishedDate: START_DATE,
      contents: { text: { maxCharacters: 500 } },
    } as Parameters<typeof exa.search>[1]);
    return (res.results ?? []).map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      date: (r.publishedDate ?? '').slice(0, 10),
      snippet: ((r as { text?: string }).text ?? '').replace(/\s+/g, ' ').slice(0, 220),
      source: 'exa' as const,
    })).filter((h) => h.title && h.url);
  } catch (e) {
    return [];
  }
}

async function tavilySearch(query: string): Promise<Hit[]> {
  if (!process.env.TAVILY_API_KEY) return [];
  try {
    const { TavilySearchAPIWrapper } = await import('@langchain/tavily');
    const tv = new TavilySearchAPIWrapper({ tavilyApiKey: process.env.TAVILY_API_KEY });
    const res = await tv.rawResults({
      query,
      max_results: 5,
      include_raw_content: false,
      time_range: 'week',
    } as Parameters<typeof tv.rawResults>[0]);
    return ((res.results ?? []) as Array<{ title?: string; url?: string; content?: string; published_date?: string }>).map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      date: (r.published_date ?? '').slice(0, 10),
      snippet: (r.content ?? '').replace(/\s+/g, ' ').slice(0, 220),
      source: 'tavily' as const,
    })).filter((h) => h.title && h.url);
  } catch {
    return [];
  }
}

function dedup(hits: Hit[]): Hit[] {
  const seen = new Set<string>();
  const out: Hit[] = [];
  for (const h of hits) {
    const key = h.url.split('?')[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}

function scoreFreshness(h: Hit): number {
  if (!h.date) return 0;
  const t = new Date(h.date).getTime();
  if (Number.isNaN(t)) return 0;
  const age = (TODAY.getTime() - t) / 86_400_000;
  if (age < 0 || age > LOOKBACK_DAYS) return 0;
  return Math.round((LOOKBACK_DAYS - age) * 10);
}

async function scanModule(mod: (typeof MODULES)[number]): Promise<Hit[]> {
  const all: Hit[] = [];
  for (const q of mod.queries) {
    const [e, t] = await Promise.all([exaSearch(q), tavilySearch(q)]);
    all.push(...e, ...t);
  }
  const uniq = dedup(all);
  uniq.sort((a, b) => scoreFreshness(b) - scoreFreshness(a));
  return uniq.slice(0, 6);
}

function fmt(h: Hit): string {
  const d = h.date || '????-??-??';
  const src = h.source === 'exa' ? 'EXA' : 'TAV';
  return `    [${d}] (${src}) ${h.title}\n      ${h.url}\n      ${h.snippet}`;
}

(async () => {
  console.log(`\n=== NEWS SCAN — 13 MODULES — ${TODAY.toISOString().slice(0, 10)} (lookback ${LOOKBACK_DAYS}d) ===\n`);
  const exaKey = process.env.EXASEARCH_API_KEY ? 'ON' : 'MISSING';
  const tavKey = process.env.TAVILY_API_KEY ? 'ON' : 'MISSING';
  console.log(`Exa: ${exaKey} · Tavily: ${tavKey}\n`);

  const results = await Promise.all(MODULES.map(async (m) => ({ mod: m, hits: await scanModule(m) })));

  let total = 0;
  for (const { mod, hits } of results) {
    console.log(`\n── ${mod.id} · ${mod.name} ── (${hits.length} hits)`);
    if (hits.length === 0) {
      console.log('    (no fresh hits)');
      continue;
    }
    total += hits.length;
    for (const h of hits) console.log(fmt(h));
  }
  console.log(`\n=== TOTAL: ${total} hits across ${MODULES.length} modules ===\n`);
})();
