/**
 * Tsebelis Veto Player Friction Index — M12 institutional capacity layer.
 *
 * Tsebelis (2002): policy change requires agreement from all veto players.
 * More veto players + more preference divergence = higher policy gridlock risk.
 *
 * Distinct from PolEcon (which measures incentives: WILL they try to reform?).
 * VPI measures institutional capacity: IF they try, CAN they succeed?
 *
 * Indonesia veto player structure (2024–2029 Prabowo administration):
 *   1. President (Prabowo) — formal executive authority, sets agenda
 *   2. DPR coalition parties — must pass budget/legislation (Gerindra+Golkar+PKB+PKS+NasDem+others)
 *   3. PDI-P (opposition) — 18.6% seats; no veto on budget but signals legitimacy contest
 *   4. Regional governments — otonomi daerah; veto on implementation of unfunded mandates
 *
 * Component signals (automated via Exa/Tavily):
 *   A. Presidential approval  (weight 0.40) — low approval = reduced legislative leverage
 *   B. Coalition fragmentation (weight 0.35) — dissenting coalition partners = internal veto threat
 *   C. Opposition activism     (weight 0.25) — interpelasi/angket/judicial review = blocking signal
 *
 * DB indicator: veto_player_friction_index (0–100), category: 'sovereign', freshness 72h.
 *
 * Env override: PRABOWO_APPROVAL_PCT (0-100) — set when Exa parse fails (monthly polling refresh).
 * Score impact in M12: VPI <33 = +0, 33–66 = +5, >66 = +10 pts.
 */

import { getLatestPoint, upsertPoints } from '../time-series-db.js';
import { computeApproval3mMedian } from './approval-rating.js';

const FRESHNESS_HOURS = 72;

export interface VetoPlayerData {
  frictionIndex: number;           // 0–100 composite (higher = more gridlock)
  approvalPct: number | null;      // 3-month rolling median approval % (Poltracking/LSI/Indikator)
  approvalTrend: 'rising' | 'falling' | 'stable' | null; // vs prior 3 months
  approvalSource: string | null;
  coalitionFragmentation: 'low' | 'moderate' | 'high';
  oppositionActivism: 'low' | 'moderate' | 'high';
  frictionTier: 'low' | 'moderate' | 'high';
  scoreAdj: 0 | 5 | 10;           // M12 score contribution
  fetchedAt: string;
}


function scoreCoalitionFragmentation(text: string): 'low' | 'moderate' | 'high' {
  const lower = text.toLowerCase();
  const highKeywords = [
    'keluar koalisi', 'pecah koalisi', 'koalisi retak', 'partai hengkang',
    'mosi tidak percaya', 'angket presiden', 'coalition collapse',
    'golkar keluar', 'pkb keluar', 'pks keluar', 'nasdem keluar',
  ];
  const modKeywords = [
    'berseberangan', 'berbeda pendapat', 'tidak sejalan', 'kritik koalisi',
    'dissenting', 'coalition strain', 'intra-coalition', 'ketegangan koalisi',
    'ancam keluar', 'evaluasi koalisi',
  ];
  if (highKeywords.some(kw => lower.includes(kw))) return 'high';
  if (modKeywords.some(kw => lower.includes(kw))) return 'moderate';
  return 'low';
}

function scoreOppositionActivism(text: string): 'low' | 'moderate' | 'high' {
  const lower = text.toLowerCase();
  const highKeywords = [
    'interpelasi', 'angket dpr', 'hak angket', 'judicial review apbn',
    'mahkamah konstitusi apbn', 'mk gugatan anggaran', 'dpr tolak',
    'penolakan dpr', 'legislative block', 'filibuster',
  ];
  const modKeywords = [
    'pdip kritik', 'oposisi kritik', 'kritik keras dpr',
    'penolakan fraksi', 'fraksi menolak', 'opposition challenge',
    'pdip menolak', 'rapat paripurna walk out',
  ];
  if (highKeywords.some(kw => lower.includes(kw))) return 'high';
  if (modKeywords.some(kw => lower.includes(kw))) return 'moderate';
  return 'low';
}

function computeFrictionIndex(
  approvalPct: number | null,
  coalition: 'low' | 'moderate' | 'high',
  opposition: 'low' | 'moderate' | 'high',
): number {
  // Approval component (0–40): inverted — low approval = high friction
  const levelMap = { low: 0, moderate: 1, high: 2 };
  const approvalScore = approvalPct !== null
    ? approvalPct >= 70 ? 0
    : approvalPct >= 55 ? Math.round((70 - approvalPct) / 15 * 20)
    : Math.round(20 + (55 - approvalPct) / 30 * 20)
    : 15; // unknown → conservative
  const approvalComponent = Math.min(40, approvalScore);

  const coalitionComponent = levelMap[coalition] * 17.5; // 0, 17.5, 35
  const oppositionComponent = levelMap[opposition] * 12.5; // 0, 12.5, 25

  return Math.round(Math.min(100, approvalComponent + coalitionComponent + oppositionComponent));
}

// Coalition + opposition signals only (approval now via approval-rating.ts)
async function fetchCoalitionOppositionViaExa(): Promise<{ coalitionText: string; oppositionText: string } | null> {
  if (!process.env.EXASEARCH_API_KEY) return null;
  const startDate = new Date(Date.now() - 35 * 86_400_000).toISOString().slice(0, 10);
  try {
    const { default: Exa } = await import('exa-js');
    const exa = new Exa(process.env.EXASEARCH_API_KEY);

    const [coalitionResp, oppositionResp] = await Promise.allSettled([
      exa.search('koalisi Indonesia berseberangan Prabowo 2026 DPR partai keluar', {
        numResults: 4, type: 'neural', startPublishedDate: startDate,
        contents: { text: { maxCharacters: 400 } },
      } as Parameters<typeof exa.search>[1]),
      exa.search('interpelasi angket DPR oposisi PDI-P kritik pemerintah 2026', {
        numResults: 4, type: 'neural', startPublishedDate: startDate,
        contents: { text: { maxCharacters: 400 } },
      } as Parameters<typeof exa.search>[1]),
    ]);

    const coalitionTexts: string[] = [];
    const oppositionTexts: string[] = [];

    if (coalitionResp.status === 'fulfilled') {
      for (const r of coalitionResp.value.results ?? []) {
        coalitionTexts.push(((r as { text?: string }).text ?? '') + ' ' + (r.title ?? ''));
      }
    }
    if (oppositionResp.status === 'fulfilled') {
      for (const r of oppositionResp.value.results ?? []) {
        oppositionTexts.push(((r as { text?: string }).text ?? '') + ' ' + (r.title ?? ''));
      }
    }
    return { coalitionText: coalitionTexts.join(' '), oppositionText: oppositionTexts.join(' ') };
  } catch { /* silent */ }
  return null;
}

async function fetchCoalitionOppositionViaTavily(): Promise<{ coalitionText: string; oppositionText: string } | null> {
  if (!process.env.TAVILY_API_KEY) return null;
  try {
    const { TavilySearchAPIWrapper } = await import('@langchain/tavily');
    const tavily = new TavilySearchAPIWrapper({ tavilyApiKey: process.env.TAVILY_API_KEY });

    const resp = await tavily.rawResults({
      query: 'koalisi Indonesia DPR 2026 oposisi interpelasi berseberangan Prabowo',
      max_results: 6, include_raw_content: false, time_range: 'month',
    } as Parameters<typeof tavily.rawResults>[0]);

    const text = (resp.results ?? []).map((r: { content?: string; title?: string }) => (r.content ?? '') + ' ' + (r.title ?? '')).join(' ');
    return { coalitionText: text, oppositionText: text };
  } catch { /* silent */ }
  return null;
}

/**
 * Fetch veto player friction index.
 * Approval: 3-month rolling median via approval-rating.ts (Exa/Tavily media scrape).
 * Coalition/opposition: fresh Exa/Tavily 35d scan.
 * Cache: DB 72h for the composite VPI index.
 */
export async function fetchVetoPlayerFriction(): Promise<VetoPlayerData> {
  const fetchedAt = new Date().toISOString();
  const today = new Date().toISOString().slice(0, 10);

  // Env override bypasses cache and forces recompute with given approval value
  const envApproval = process.env.PRABOWO_APPROVAL_PCT ? parseFloat(process.env.PRABOWO_APPROVAL_PCT) : null;

  // DB freshness check (72h) — skip if env override set (env always forces fresh compute)
  const cached = await getLatestPoint('veto_player_friction_index');
  if (cached && !envApproval) {
    const ageH = (Date.now() - new Date(cached.fetchedAt ?? cached.date).getTime()) / 3_600_000;
    if (ageH < FRESHNESS_HOURS) {
      const frictionIndex = cached.value;
      const tier: VetoPlayerData['frictionTier'] = frictionIndex >= 67 ? 'high' : frictionIndex >= 33 ? 'moderate' : 'low';
      const scoreAdj: 0 | 5 | 10 = tier === 'high' ? 10 : tier === 'moderate' ? 5 : 0;
      return {
        frictionIndex,
        approvalPct: null,
        approvalTrend: null,
        approvalSource: 'db:veto_player_friction_index',
        coalitionFragmentation: 'low',
        oppositionActivism: 'low',
        frictionTier: tier,
        scoreAdj,
        fetchedAt: cached.fetchedAt ?? cached.date,
      };
    }
  }

  // Parallel fetch: approval 3m series + coalition/opposition signals
  const [approvalSeries, coalitionRaw] = await Promise.all([
    envApproval
      ? Promise.resolve(null) // env override bypasses approval-rating.ts
      : computeApproval3mMedian().catch(() => null),
    fetchCoalitionOppositionViaExa().catch(() => null)
      .then(r => r ?? fetchCoalitionOppositionViaTavily().catch(() => null)),
  ]);

  const approvalPct = envApproval ?? approvalSeries?.avg3m ?? null;
  const approvalTrend = envApproval ? null : (approvalSeries?.trend ?? null);
  const approvalSource = envApproval
    ? 'env:PRABOWO_APPROVAL_PCT'
    : (approvalSeries?.points[approvalSeries.points.length - 1]?.source ?? null);

  const coalitionFragmentation = coalitionRaw ? scoreCoalitionFragmentation(coalitionRaw.coalitionText) : 'low';
  const oppositionActivism     = coalitionRaw ? scoreOppositionActivism(coalitionRaw.oppositionText)    : 'low';

  const frictionIndex = computeFrictionIndex(approvalPct, coalitionFragmentation, oppositionActivism);
  const tier: VetoPlayerData['frictionTier'] = frictionIndex >= 67 ? 'high' : frictionIndex >= 33 ? 'moderate' : 'low';
  const scoreAdj: 0 | 5 | 10 = tier === 'high' ? 10 : tier === 'moderate' ? 5 : 0;

  await upsertPoints([{
    indicator: 'veto_player_friction_index',
    category: 'sovereign' as const,
    date: today,
    value: frictionIndex,
    unit: 'index_0_100',
    source: approvalSource ?? 'default',
    fetchedAt,
  }]);

  return { frictionIndex, approvalPct, approvalTrend, approvalSource, coalitionFragmentation, oppositionActivism, frictionTier: tier, scoreAdj, fetchedAt };
}
