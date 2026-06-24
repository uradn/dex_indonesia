/**
 * Coal DMO (Domestic Market Obligation) compliance + PLN coal supply tracker.
 *
 * Why it matters:
 *   PLN 2026 coal need: 154 Mt. Contracted: 134 Mt (~87%). Shortfall: ~20 Mt.
 *   DMO price fixed at $70/ton since 2018; HBA Jun-2026 Period I = $84.5–121.8/ton.
 *   Gap = 20–74% — producers prefer export → DMO compliance pressure.
 *
 *   Coal is both M4 export cushion AND domestic energy security input. If DMO
 *   compliance slips → PLN forced to import OR raise TDL → political backlash
 *   (M12) + subsidi listrik blow-out (M10) + minyak goreng / food CPI knock-on
 *   via input cost (M11).
 *
 * DB INDICATORS:
 *   coal_dmo_compliance_pct  — PLN coal received / contracted target (0–100)
 *   hba_price_usd_ton        — Harga Batu Bara Acuan (HBA) latest period
 *   pln_coal_secured_pct     — contracted volume / annual need (134/154 ~87% baseline)
 */

import { getLatestPoint, upsertPoints } from '../time-series-db.js';
import type { MacroDataPoint } from '../types.js';

const FRESHNESS_DAYS = 14;

const DOMAINS = [
  'esdm.go.id', 'pln.co.id', 'minerba.esdm.go.id',
  'cnbcindonesia.com', 'bisnis.com', 'kontan.co.id',
  'detik.com', 'tempo.co', 'bloombergtechnoz.com', 'liputan6.com',
];

const QUERY = 'PLN batu bara DMO domestic market obligation HBA pasokan kuota juta ton ESDM 2026';

function parseIdNumber(s: string): number | null {
  const cleaned = s.replace(/\./g, '').replace(',', '.');
  const v = parseFloat(cleaned);
  return isNaN(v) ? null : v;
}

function matchNum(text: string, range: [number, number], ...patterns: RegExp[]): number | null {
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m?.[1]) {
      const v = parseIdNumber(m[1]);
      if (v !== null && v >= range[0] && v <= range[1]) return v;
    }
  }
  return null;
}

interface CoalDmoRaw {
  hbaUsdTon: number | null;
  dmoCompliancePct: number | null;
  plnSecuredPct: number | null;
}

function parseCoalDmoText(text: string): CoalDmoRaw {
  // HBA (Harga Batu Bara Acuan) — usually quoted in USD/ton
  const hbaUsdTon = matchNum(
    text,
    [40, 200],
    /HBA[\s\S]{0,40}?(?:periode|June|Juni)[\s\S]{0,60}?US\$\s*([\d.,]+)\s*per\s*ton/i,
    /Harga\s+Batu\s+Bara\s+Acuan[\s\S]{0,60}?US\$\s*([\d.,]+)/i,
    /HBA[\s\S]{0,40}?US\$\s*([\d.,]+)\s*per\s*ton/i,
    /HBA[\s\S]{0,40}?\$\s*([\d.,]+)\s*\/\s*ton/i,
  );

  // DMO compliance % — "% dari target", "% target DMO", "% target pasokan"
  const dmoCompliancePct = matchNum(
    text,
    [0, 200],
    /([\d.,]+)\s*%\s+(?:dari\s+target|target)\s+(?:pasokan\s+)?DMO/i,
    /(?:pemenuhan|kepatuhan|realisasi)\s+DMO[\s\S]{0,60}?([\d.,]+)\s*%/i,
    /DMO[\s\S]{0,60}?(?:pemenuhan|tercapai|terealisasi)[\s\S]{0,40}?([\d.,]+)\s*%/i,
  );

  // PLN coal secured — "X dari Y juta ton", "X juta ton terkontrak"
  // Find "X juta ton" + "Y juta ton" pair; require PLN annual need-scale (target >=80Mt)
  // and plausible secured (50-120% range) to avoid mis-pairing with smaller producer figures.
  let plnSecuredPct: number | null = null;
  const pairRe = /(\d+(?:[.,]\d+)?)\s*juta\s*ton[\s\S]{0,80}?(?:dari|target|kebutuhan)[\s\S]{0,40}?(\d+(?:[.,]\d+)?)\s*juta\s*ton/gi;
  let pairMatch: RegExpExecArray | null;
  while ((pairMatch = pairRe.exec(text)) !== null) {
    const secured = parseIdNumber(pairMatch[1]!);
    const target = parseIdNumber(pairMatch[2]!);
    if (secured !== null && target !== null && target >= 80 && target <= 250) {
      const pct = (secured / target) * 100;
      if (pct >= 50 && pct <= 120) {
        plnSecuredPct = parseFloat(pct.toFixed(1));
        break;
      }
    }
  }

  return { hbaUsdTon, dmoCompliancePct, plnSecuredPct };
}

async function fetchViaExa(): Promise<CoalDmoRaw | null> {
  if (!process.env.EXASEARCH_API_KEY) return null;
  try {
    const { default: Exa } = await import('exa-js');
    const exa = new Exa(process.env.EXASEARCH_API_KEY);
    const startDate = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);

    const response = await exa.search(QUERY, {
      numResults: 5,
      type: 'auto',
      startPublishedDate: startDate,
      includeDomains: DOMAINS,
      contents: { text: { maxCharacters: 2500 } },
    } as Parameters<typeof exa.search>[1]);

    const acc: CoalDmoRaw = { hbaUsdTon: null, dmoCompliancePct: null, plnSecuredPct: null };
    for (const r of (response.results ?? [])) {
      const text = (r as { text?: string }).text ?? r.title ?? '';
      if (!text) continue;
      const parsed = parseCoalDmoText(text);
      acc.hbaUsdTon = acc.hbaUsdTon ?? parsed.hbaUsdTon;
      acc.dmoCompliancePct = acc.dmoCompliancePct ?? parsed.dmoCompliancePct;
      acc.plnSecuredPct = acc.plnSecuredPct ?? parsed.plnSecuredPct;
    }
    return (acc.hbaUsdTon ?? acc.dmoCompliancePct ?? acc.plnSecuredPct) !== null ? acc : null;
  } catch {
    return null;
  }
}

async function fetchViaTavily(): Promise<CoalDmoRaw | null> {
  if (!process.env.TAVILY_API_KEY) return null;
  try {
    const { TavilySearchAPIWrapper } = await import('@langchain/tavily');
    const tavily = new TavilySearchAPIWrapper({ tavilyApiKey: process.env.TAVILY_API_KEY });

    const response = await tavily.rawResults({
      query: QUERY,
      max_results: 5,
      include_domains: DOMAINS,
      include_raw_content: true,
      time_range: 'month',
    } as Parameters<typeof tavily.rawResults>[0]);

    const acc: CoalDmoRaw = { hbaUsdTon: null, dmoCompliancePct: null, plnSecuredPct: null };
    for (const r of (response.results ?? [])) {
      const text = (r.raw_content ?? r.content ?? '') as string;
      if (!text) continue;
      const parsed = parseCoalDmoText(text);
      acc.hbaUsdTon = acc.hbaUsdTon ?? parsed.hbaUsdTon;
      acc.dmoCompliancePct = acc.dmoCompliancePct ?? parsed.dmoCompliancePct;
      acc.plnSecuredPct = acc.plnSecuredPct ?? parsed.plnSecuredPct;
    }
    return (acc.hbaUsdTon ?? acc.dmoCompliancePct ?? acc.plnSecuredPct) !== null ? acc : null;
  } catch {
    return null;
  }
}

export interface CoalDmoData extends CoalDmoRaw {
  date: string;
  fetchedAt: string;
}

export async function fetchCoalDmoStatus(): Promise<CoalDmoData | null> {
  const cached = await getLatestPoint('hba_price_usd_ton');
  if (cached) {
    const ageDays = (Date.now() - new Date(cached.fetchedAt).getTime()) / 86_400_000;
    if (ageDays < FRESHNESS_DAYS) {
      const [comp, pln] = await Promise.all([
        getLatestPoint('coal_dmo_compliance_pct'),
        getLatestPoint('pln_coal_secured_pct'),
      ]);
      return {
        date: cached.date,
        hbaUsdTon: cached.value,
        dmoCompliancePct: comp?.value ?? null,
        plnSecuredPct: pln?.value ?? null,
        fetchedAt: cached.fetchedAt,
      };
    }
  }

  const raw = (await fetchViaExa()) ?? (await fetchViaTavily());
  if (!raw) return null;

  const date = new Date().toISOString().slice(0, 10);
  const fetchedAt = new Date().toISOString();
  const points: MacroDataPoint[] = [];

  if (raw.hbaUsdTon !== null) {
    points.push({
      indicator: 'hba_price_usd_ton',
      category: 'commodity', date, value: raw.hbaUsdTon,
      unit: 'USD_ton', source: 'exa_coal_dmo', fetchedAt,
    });
  }
  if (raw.dmoCompliancePct !== null) {
    points.push({
      indicator: 'coal_dmo_compliance_pct',
      category: 'commodity', date, value: raw.dmoCompliancePct,
      unit: '%', source: 'exa_coal_dmo', fetchedAt,
    });
  }
  if (raw.plnSecuredPct !== null) {
    points.push({
      indicator: 'pln_coal_secured_pct',
      category: 'commodity', date, value: raw.plnSecuredPct,
      unit: '%', source: 'exa_coal_dmo', fetchedAt,
    });
  }
  if (points.length > 0) await upsertPoints(points);

  return { ...raw, date, fetchedAt };
}
