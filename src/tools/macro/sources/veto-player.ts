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

const FRESHNESS_HOURS = 72;

export interface VetoPlayerData {
  frictionIndex: number;           // 0–100 composite (higher = more gridlock)
  approvalPct: number | null;      // presidential approval % (Poltracking/LSI/Indikator)
  approvalSource: string | null;
  coalitionFragmentation: 'low' | 'moderate' | 'high';
  oppositionActivism: 'low' | 'moderate' | 'high';
  frictionTier: 'low' | 'moderate' | 'high';
  scoreAdj: 0 | 5 | 10;           // M12 score contribution
  fetchedAt: string;
}

function parseApprovalFromText(text: string): number | null {
  // Match "72.5%", "approval 68%", "elektabilitas 71.3%", "tingkat kepuasan 65%"
  const patterns = [
    /approval[^0-9]*(\d{2,3}\.?\d*)\s*%/i,
    /elektabilitas[^0-9]*(\d{2,3}\.?\d*)\s*%/i,
    /kepuasan[^0-9]*(\d{2,3}\.?\d*)\s*%/i,
    /(\d{2,3}\.?\d*)\s*%[^0-9a-z]{0,20}approval/i,
    /prabowo[^0-9]*(\d{2,3}\.?\d*)\s*%/i,
    /presiden[^0-9]*(\d{2,3}\.?\d*)\s*%[^0-9]{0,30}(approv|kepuas|puas|survey|survei)/i,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      const val = parseFloat(m[1]!);
      if (val >= 20 && val <= 100) return val;
    }
  }
  return null;
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

async function fetchViaExa(): Promise<{ approvalPct: number | null; approvalSource: string | null; coalitionText: string; oppositionText: string } | null> {
  if (!process.env.EXASEARCH_API_KEY) return null;
  const startDate = new Date(Date.now() - 35 * 86_400_000).toISOString().slice(0, 10);
  try {
    const { default: Exa } = await import('exa-js');
    const exa = new Exa(process.env.EXASEARCH_API_KEY);

    // Fetch approval + coalition + opposition signals in parallel
    const [approvalResp, coalitionResp, oppositionResp] = await Promise.allSettled([
      exa.search('Prabowo elektabilitas kepuasan approval rating 2026 Poltracking LSI Indikator', {
        numResults: 4, type: 'neural', startPublishedDate: startDate,
        contents: { text: { maxCharacters: 500 } },
      } as Parameters<typeof exa.search>[1]),
      exa.search('koalisi Indonesia berseberangan Prabowo 2026 DPR partai keluar', {
        numResults: 4, type: 'neural', startPublishedDate: startDate,
        contents: { text: { maxCharacters: 400 } },
      } as Parameters<typeof exa.search>[1]),
      exa.search('interpelasi angket DPR oposisi PDI-P kritik pemerintah 2026', {
        numResults: 4, type: 'neural', startPublishedDate: startDate,
        contents: { text: { maxCharacters: 400 } },
      } as Parameters<typeof exa.search>[1]),
    ]);

    let approvalPct: number | null = null;
    let approvalSource: string | null = null;
    const coalitionTexts: string[] = [];
    const oppositionTexts: string[] = [];

    if (approvalResp.status === 'fulfilled') {
      for (const r of approvalResp.value.results ?? []) {
        const text = ((r as { text?: string }).text ?? '') + ' ' + (r.title ?? '');
        const val = parseApprovalFromText(text);
        if (val !== null && approvalPct === null) {
          approvalPct = val;
          approvalSource = r.url ?? null;
        }
      }
    }
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

    return {
      approvalPct,
      approvalSource,
      coalitionText: coalitionTexts.join(' '),
      oppositionText: oppositionTexts.join(' '),
    };
  } catch { /* silent */ }
  return null;
}

async function fetchViaTavily(): Promise<{ approvalPct: number | null; approvalSource: string | null; coalitionText: string; oppositionText: string } | null> {
  if (!process.env.TAVILY_API_KEY) return null;
  try {
    const { TavilySearchAPIWrapper } = await import('@langchain/tavily');
    const tavily = new TavilySearchAPIWrapper({ tavilyApiKey: process.env.TAVILY_API_KEY });

    const [approvalResp, coalitionResp] = await Promise.allSettled([
      tavily.rawResults({
        query: 'Prabowo approval rating elektabilitas 2026 survei Poltracking LSI',
        max_results: 4, include_raw_content: false, time_range: 'month',
      } as Parameters<typeof tavily.rawResults>[0]),
      tavily.rawResults({
        query: 'koalisi Indonesia DPR 2026 oposisi interpelasi berseberangan',
        max_results: 4, include_raw_content: false, time_range: 'month',
      } as Parameters<typeof tavily.rawResults>[0]),
    ]);

    let approvalPct: number | null = null;
    let approvalSource: string | null = null;
    const combinedText: string[] = [];

    if (approvalResp.status === 'fulfilled') {
      for (const r of approvalResp.value.results ?? []) {
        const text = (r.content ?? '') + ' ' + (r.title ?? '');
        const val = parseApprovalFromText(text);
        if (val !== null && approvalPct === null) {
          approvalPct = val;
          approvalSource = r.url ?? null;
        }
        combinedText.push(text);
      }
    }
    if (coalitionResp.status === 'fulfilled') {
      for (const r of coalitionResp.value.results ?? []) combinedText.push((r.content ?? '') + ' ' + (r.title ?? ''));
    }

    const allText = combinedText.join(' ');
    return { approvalPct, approvalSource, coalitionText: allText, oppositionText: allText };
  } catch { /* silent */ }
  return null;
}

/**
 * Fetch veto player friction index.
 * Priority: env override → DB cache (72h) → Exa → Tavily.
 */
export async function fetchVetoPlayerFriction(): Promise<VetoPlayerData> {
  const fetchedAt = new Date().toISOString();
  const today = new Date().toISOString().slice(0, 10);

  // Env override for presidential approval
  const envApproval = process.env.PRABOWO_APPROVAL_PCT ? parseFloat(process.env.PRABOWO_APPROVAL_PCT) : null;

  // DB freshness check (72h)
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
        approvalSource: null,
        coalitionFragmentation: 'low',
        oppositionActivism: 'low',
        frictionTier: tier,
        scoreAdj,
        fetchedAt: cached.fetchedAt ?? cached.date,
      };
    }
  }

  // Fetch
  const raw = (await fetchViaExa()) ?? (await fetchViaTavily());
  const approvalPct = envApproval ?? raw?.approvalPct ?? null;
  const approvalSource = envApproval ? 'env:PRABOWO_APPROVAL_PCT' : (raw?.approvalSource ?? null);
  const coalitionFragmentation = raw ? scoreCoalitionFragmentation(raw.coalitionText) : 'low';
  const oppositionActivism = raw ? scoreOppositionActivism(raw.oppositionText) : 'low';

  const frictionIndex = computeFrictionIndex(approvalPct, coalitionFragmentation, oppositionActivism);
  const tier: VetoPlayerData['frictionTier'] = frictionIndex >= 67 ? 'high' : frictionIndex >= 33 ? 'moderate' : 'low';
  const scoreAdj: 0 | 5 | 10 = tier === 'high' ? 10 : tier === 'moderate' ? 5 : 0;

  await upsertPoints([{
    indicator: 'veto_player_friction_index',
    category: 'sovereign' as const,
    date: today,
    value: frictionIndex,
    unit: 'index_0_100',
    source: approvalSource ?? (raw ? 'exa_tavily' : 'default'),
    fetchedAt,
  }]);

  return { frictionIndex, approvalPct, approvalSource, coalitionFragmentation, oppositionActivism, frictionTier: tier, scoreAdj, fetchedAt };
}
