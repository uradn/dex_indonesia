/**
 * Fiscal Rhetoric Scanner — Gap A (Chatib Basri 2026, Oct 2026)
 *
 * Scans Menkeu press statements for commitment vs discretion signals on the 3% deficit rule.
 * Barro-Gordon pre-commitment: announcement credibility matters independently of realized data.
 * A single "fleksibel soal 3%" signal from Suahasil Nazara can shift CI before deficit data changes.
 *
 * Returns netSignal in [-3, +3]:
 *   positive = commitment signals dominate (CI adjusted DOWN — more credible)
 *   negative = discretion signals dominate (CI adjusted UP — less credible)
 *   0 = neutral or no data
 *
 * CI adjustment: netSignal × −2 (max ±6 pts on CI 0–100 scale).
 */

export interface FiscalRhetoricResult {
  netSignal: number;        // -3 to +3
  commitmentCount: number;
  discretionCount: number;
  sourceUrls: string[];
  fetchedAt: string;
  latestDate: string | null;
  snippets: string[];       // up to 3 raw text excerpts for audit trail
}

// Commitment signals: minister affirms fiscal discipline, 3% ceiling, consolidation path
const COMMITMENT_KEYWORDS = [
  'disiplin fiskal',
  'tetap 3 persen',
  'tetap pada 3%',
  'komitmen fiskal',
  'konsolidasi fiskal',
  'fiskal ortodoks',
  'efisiensi belanja',
  'penerimaan ditingkatkan',
  'fiskal sehat',
  'ruang fiskal terjaga',
  'fiscal discipline',
  'commitment to fiscal',
  '3 percent deficit',
  'fiscal consolidation',
];

// Discretion signals: minister weakens commitment to 3% rule or signals expansion intent
const DISCRETION_KEYWORDS = [
  'perlu dikaji ulang',
  'fleksibel',
  'tidak kaku',
  'kondisional',
  'sementara ditinggalkan',
  'ruang fiskal lebih lebar',
  'kebutuhan stimulus',
  'pelebaran defisit',
  'darurat fiskal',
  'perlu diperluas',
  'melampaui 3 persen',
  'above 3 percent',
  'fiscal flexibility',
  'widen deficit',
  'stimulus fiscal',
];

const EXA_QUERIES = [
  '"Menteri Keuangan" "defisit" "3 persen"',
  '"Suahasil Nazara" "fiskal" "defisit"',
  '"Kemenkeu" "defisit APBN" site:kemenkeu.go.id OR site:bisnis.com OR site:cnbcindonesia.com OR site:kontan.co.id',
];

function scoreText(text: string): { commitment: number; discretion: number } {
  const lower = text.toLowerCase();
  const commitment = COMMITMENT_KEYWORDS.filter((k) => lower.includes(k)).length;
  const discretion = DISCRETION_KEYWORDS.filter((k) => lower.includes(k)).length;
  return { commitment, discretion };
}

export async function fetchFiscalRhetoricExa(): Promise<FiscalRhetoricResult | null> {
  if (!process.env.EXASEARCH_API_KEY) return null;
  try {
    const { default: Exa } = await import('exa-js');
    const exa = new Exa(process.env.EXASEARCH_API_KEY);
    const startDate = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10); // 14d window

    let totalCommitment = 0;
    let totalDiscretion = 0;
    const sourceUrls: string[] = [];
    const snippets: string[] = [];
    let latestDate: string | null = null;

    for (const query of EXA_QUERIES) {
      let response: Awaited<ReturnType<typeof exa.search>>;
      try {
        response = await exa.search(query, {
          numResults: 5,
          type: 'neural',
          startPublishedDate: startDate,
          contents: { text: { maxCharacters: 1500 } },
        } as Parameters<typeof exa.search>[1]);
      } catch {
        continue;
      }

      for (const r of response.results ?? []) {
        const url = r.url ?? '';
        // Block low-credibility sources
        if (/blogspot|wordpress\.com|tumblr|weebly|wix\.com/i.test(url)) continue;
        const text = (r as { text?: string }).text ?? r.title ?? '';
        if (!text || text.length < 50) continue;

        const { commitment, discretion } = scoreText(text);
        if (commitment === 0 && discretion === 0) continue; // no signal in this article

        totalCommitment += commitment;
        totalDiscretion += discretion;
        if (!sourceUrls.includes(url)) sourceUrls.push(url);
        if (snippets.length < 3) snippets.push(text.slice(0, 200));

        const pubDate = r.publishedDate ? r.publishedDate.slice(0, 10) : null;
        if (pubDate && (!latestDate || pubDate > latestDate)) latestDate = pubDate;
      }
    }

    // Clamp net signal to [-3, +3]
    const netSignal = Math.max(-3, Math.min(3, totalCommitment - totalDiscretion));

    return {
      netSignal,
      commitmentCount: totalCommitment,
      discretionCount: totalDiscretion,
      sourceUrls,
      fetchedAt: new Date().toISOString(),
      latestDate,
      snippets,
    };
  } catch {
    return null;
  }
}

/** Tavily fallback for rhetoric scan */
export async function fetchFiscalRhetoricTavily(): Promise<FiscalRhetoricResult | null> {
  if (!process.env.TAVILY_API_KEY) return null;
  try {
    const { TavilySearchAPIWrapper } = await import('@langchain/tavily');
    const tavily = new TavilySearchAPIWrapper({ tavilyApiKey: process.env.TAVILY_API_KEY });

    const response = await tavily.rawResults({
      query: 'Menteri Keuangan Suahasil Nazara defisit APBN 3 persen fiskal',
      max_results: 5,
      include_raw_content: true,
      time_range: 'week',
    } as Parameters<typeof tavily.rawResults>[0]);

    let totalCommitment = 0;
    let totalDiscretion = 0;
    const sourceUrls: string[] = [];
    const snippets: string[] = [];
    let latestDate: string | null = null;

    for (const r of (response.results ?? [])) {
      const url = r.url ?? '';
      if (/blogspot|wordpress\.com/i.test(url)) continue;
      const text = r.raw_content ?? r.content ?? '';
      if (!text || text.length < 50) continue;

      const { commitment, discretion } = scoreText(text);
      if (commitment === 0 && discretion === 0) continue;

      totalCommitment += commitment;
      totalDiscretion += discretion;
      if (!sourceUrls.includes(url)) sourceUrls.push(url);
      if (snippets.length < 3) snippets.push(text.slice(0, 200));

      const pubDate = (r as { published_date?: string }).published_date?.slice(0, 10) ?? null;
      if (pubDate && (!latestDate || pubDate > latestDate)) latestDate = pubDate;
    }

    const netSignal = Math.max(-3, Math.min(3, totalCommitment - totalDiscretion));
    return { netSignal, commitmentCount: totalCommitment, discretionCount: totalDiscretion, sourceUrls, fetchedAt: new Date().toISOString(), latestDate, snippets };
  } catch {
    return null;
  }
}
