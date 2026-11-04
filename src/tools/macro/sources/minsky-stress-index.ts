/**
 * Minsky Financial Instability Hypothesis — Indonesia Phase 1 implementation.
 *
 * Classifies 5 sectors (BPD, corporate FX, fiscal sovereign, BPDPKS, Pertamina) into
 * hedge/speculative/Ponzi financing regimes using existing DB indicators.
 *
 * Phase 1 (Nov 2026): derived entirely from existing DB + env vars. No new scrape paths.
 * Phase 2: add BPDPKS fund balance scraper (ESDM/APROBI quarterly report).
 * Phase 3: add Pertamina working capital loan data (OJK IKNB CCC quarterly).
 *
 * Ref: Minsky (1986, 1992), Toporowski-Cozzi (2006 EM extension), Vercelli (2009).
 * Indonesia 2026 application: Springer Ch.19, Jakarta Post May 15 2026 "Minsky stability".
 */
import { getLatestPoint } from '../time-series-db.js';

export type MinskyRegime = 'hedge' | 'speculative' | 'ponzi' | 'unknown';

export interface MinskySectorAssessment {
  sector: 'bpd' | 'corporate_fx' | 'fiscal' | 'bpdpks' | 'pertamina';
  regime: MinskyRegime;
  score: number;             // 0=hedge, 10=speculative, 20=ponzi
  keyRisk: string;
  dataSource: string;
  dataFresh: boolean;
}

export interface MinskyStressIndex {
  assessments: MinskySectorAssessment[];
  overallRegime: 'systemic_hedge' | 'transition' | 'systemic_speculative' | 'ponzi_dominant';
  compositeScore: number;    // 0–100 (normalized from 5×20)
  minskyMomentRisk: boolean; // ≥2 sectors in Ponzi simultaneously
  m8Bump: number;            // score bump to M8 Banking engine
  m10Bump: number;           // score bump to M10 Fiscal engine
  transmissionPath: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-level TTL cache — M8 and M10 both call this in parallel during morning-check;
// 5-minute window is sufficient to deduplicate within a single run.
let _msiCache: { result: MinskyStressIndex; ts: number } | null = null;
const MSI_CACHE_TTL_MS = 5 * 60 * 1000;

export async function computeMinskyStressIndex(): Promise<MinskyStressIndex> {
  if (_msiCache !== null && Date.now() - _msiCache.ts < MSI_CACHE_TTL_MS) {
    return _msiCache.result;
  }
  const [
    indoniaSpread, usdIdr, hedgingCompliance, ldrPoint, tkdRealisasi,
    srbiOutstanding, apbnDeficit, subsidiYtd, apbnRevenue, biRate,
    indoniaTe, indoniaBi,
  ] = await Promise.all([
    getLatestPoint('bi_indonia_spread_bps'),           // PUAB O/N spread vs BI rate
    getLatestPoint('usdidr_spot'),
    getLatestPoint('uln_hedging_compliance_pct'),
    getLatestPoint('bank_ldr_pct'),
    getLatestPoint('tkd_realisasi_pct'),               // TKD transfer ke daerah YTD%
    getLatestPoint('srbi_outstanding_trn_idr'),
    getLatestPoint('apbn_deficit_pct_gdp'),
    getLatestPoint('subsidi_energi_ytd_idr_t'),
    getLatestPoint('apbn_revenue_monthly_trn'),
    getLatestPoint('bi_rate_pct'),
    getLatestPoint('indonia_3m_pct'),
    getLatestPoint('indonia_compounded_30d_pct'),
  ]);

  // Derive IndONIA spread from available data
  const indoniaPct = indoniaBi?.value ?? indoniaTe?.value ?? null;
  const biRatePct = biRate?.value ?? 5.75;
  const puabSpreadBps = indoniaPct !== null ? Math.round((indoniaPct - biRatePct) * 100) : null;

  const assessments: MinskySectorAssessment[] = [];

  // ── 1. BPD (Bank Pembangunan Daerah) ─────────────────────────────────────
  // Speculative: liabilities = DPK captive Pemda (can be pulled); assets = long-tenor loans
  // Ponzi: TKD shortfall → Pemda withdrawals → BPD funds via PUAB O/N (expensive)
  {
    const tkd = tkdRealisasi?.value ?? null;    // % of annual target
    const spread = puabSpreadBps ?? null;
    const ldr = ldrPoint?.value ?? null;

    let regime: MinskyRegime = 'unknown';
    let score = 0;
    let keyRisk = 'BPD: insufficient data';

    if (spread !== null) {
      if (spread > 150 && (tkd !== null && tkd < 70)) {
        // Pemda forced liquidation + PUAB prohibitively expensive → Ponzi
        regime = 'ponzi'; score = 20;
        keyRisk = `BPD: PUAB spread ${spread}bps ATH + TKD ${tkd?.toFixed(0)}% (withdrawal risk → Ponzi cost structure)`;
      } else if (spread > 100 || (ldr !== null && ldr > 85)) {
        regime = 'speculative'; score = 10;
        keyRisk = `BPD: PUAB spread ${spread}bps (liquidity cost rising) + LDR ${ldr?.toFixed(1) ?? '?'}%`;
      } else {
        regime = 'hedge'; score = 0;
        keyRisk = `BPD: PUAB spread ${spread}bps (normal), TKD ${tkd?.toFixed(0) ?? '?'}%`;
      }
    } else if (ldr !== null && ldr > 88) {
      regime = 'speculative'; score = 8;
      keyRisk = `BPD: LDR ${ldr.toFixed(1)}% (overextended); PUAB data missing`;
    }

    assessments.push({
      sector: 'bpd', regime, score, keyRisk,
      dataSource: spread !== null ? 'indonia_compounded_30d_pct+bi_rate' : 'bank_ldr_pct only',
      dataFresh: (indoniaBi ?? indoniaTe) !== null || ldrPoint !== null,
    });
  }

  // ── 2. Corporate FX (USD debt + IDR revenue mismatch) ────────────────────
  // Speculative: partial hedge or revenue partially USD
  // Ponzi: no hedge + pure IDR revenue + USDIDR > 19,000
  {
    const usdIdrVal = usdIdr?.value ?? null;
    const hedging = hedgingCompliance?.value ?? null;

    let regime: MinskyRegime = 'unknown';
    let score = 0;
    let keyRisk = 'Corporate FX: insufficient data';

    if (usdIdrVal !== null) {
      const idrWeakening = usdIdrVal > 19_000;
      const hedgingLow = hedging !== null && hedging < 55;
      const hedgingCritical = hedging !== null && hedging < 40;

      if (idrWeakening && hedgingCritical) {
        regime = 'ponzi'; score = 20;
        keyRisk = `Corporate FX: USDIDR ${usdIdrVal.toLocaleString()} (${((usdIdrVal / 15_900 - 1) * 100).toFixed(1)}% depreciation) + hedging compliance ${hedging?.toFixed(1)}% → unhedged USD debt service > EBITDA`;
      } else if (idrWeakening || hedgingLow) {
        regime = 'speculative'; score = 10;
        keyRisk = `Corporate FX: USDIDR ${usdIdrVal.toLocaleString()} + hedging ${hedging?.toFixed(1) ?? 'unknown'}% → elevated USD debt service cost`;
      } else if (usdIdrVal > 18_000) {
        regime = 'speculative'; score = 7;
        keyRisk = `Corporate FX: USDIDR ${usdIdrVal.toLocaleString()} (above BI APBN assumption 16,500 by ${((usdIdrVal / 16_500 - 1) * 100).toFixed(1)}%) → rising FX debt burden`;
      } else {
        regime = 'hedge'; score = 0;
        keyRisk = `Corporate FX: USDIDR ${usdIdrVal.toLocaleString()} within manageable range`;
      }
    }

    assessments.push({
      sector: 'corporate_fx', regime, score, keyRisk,
      dataSource: 'usdidr_spot + uln_hedging_compliance_pct',
      dataFresh: usdIdr !== null,
    });
  }

  // ── 3. Fiscal Sovereign (MBG + interest/revenue Ponzi boundary) ───────────
  // Speculative: revenue shortfall covered by SBN rollover; interest < revenue OK
  // Ponzi: interest/revenue > 20% (S&P watch) → new SBN to pay old SBN interest
  {
    const deficit = apbnDeficit?.value ?? null;
    // Approximate interest/revenue: APBN 2026 interest Rp506T / revenue Rp3,154T = 16%
    // Stressed: revenue shortfall → actual ratio higher
    const revenueYtd = apbnRevenue?.value ?? null;
    const subsidiYtdVal = subsidiYtd?.value ?? null;

    // Annualized revenue estimate from YTD (rough)
    const annualizedRevenue = revenueYtd !== null ? revenueYtd * 12 : null;
    const APBN_INTEREST_T = 506; // Rp506T interest payment 2026
    const interestRevenueRatio = annualizedRevenue !== null
      ? (APBN_INTEREST_T / annualizedRevenue) * 100
      : null;

    let regime: MinskyRegime = 'unknown';
    let score = 0;
    let keyRisk = 'Fiscal: insufficient data';

    if (deficit !== null) {
      if (deficit > 4.5 || (interestRevenueRatio !== null && interestRevenueRatio > 20)) {
        regime = 'ponzi'; score = 18;
        keyRisk = `Fiscal: deficit ${deficit.toFixed(2)}%GDP${interestRevenueRatio ? ` + interest/revenue ${interestRevenueRatio.toFixed(1)}%` : ''} → SBN rollover funds interest = sovereign Ponzi boundary`;
      } else if (deficit > 3.0 || (interestRevenueRatio !== null && interestRevenueRatio > 16)) {
        regime = 'speculative'; score = 10;
        keyRisk = `Fiscal: deficit ${deficit.toFixed(2)}%GDP (>${deficit > 3 ? '3%' : '2.68% APBN'} UU constraint)${interestRevenueRatio ? ` + interest/revenue ${interestRevenueRatio.toFixed(1)}%` : ''}`;
      } else {
        regime = 'hedge'; score = 0;
        keyRisk = `Fiscal: deficit ${deficit.toFixed(2)}%GDP within APBN 2.68% envelope`;
      }
    }

    assessments.push({
      sector: 'fiscal', regime, score, keyRisk,
      dataSource: 'apbn_deficit_pct_gdp + apbn_revenue_monthly_trn',
      dataFresh: apbnDeficit !== null || apbnRevenue !== null,
    });
  }

  // ── 4. BPDPKS B50 Biodiesel Fund ─────────────────────────────────────────
  // Phase 1: infer from CPO price and SOLAR_BLEND_RATIO env (no BPDPKS fund balance scraper yet)
  // Phase 2: add ESDM/APROBI quarterly fund adequacy ratio
  {
    const blendRatio = parseFloat(process.env.SOLAR_BLEND_RATIO ?? '0.50');
    // B50 (0.50) regime: levy income falls while subsidy obligation rises
    // Speculative zone: blend > 0.45 (levy-obligation crossover estimated)
    // Ponzi risk: blend = 0.50 + CPO price drop > 15% from baseline
    let regime: MinskyRegime;
    let score: number;
    let keyRisk: string;

    if (blendRatio >= 0.50) {
      regime = 'speculative'; score = 10;
      keyRisk = `BPDPKS: B${Math.round(blendRatio * 100)} mandate — levy income falling (fewer CPO exports) while FAME subsidy obligation rising; fund adequacy ratio declining`;
    } else if (blendRatio >= 0.45) {
      regime = 'speculative'; score = 7;
      keyRisk = `BPDPKS: B${Math.round(blendRatio * 100)} de-facto — approaching crossover where levy < subsidy obligation`;
    } else {
      regime = 'hedge'; score = 2;
      keyRisk = `BPDPKS: B${Math.round(blendRatio * 100)} blend — levy income adequate (Phase 1 estimate; no fund balance data)`;
    }

    assessments.push({
      sector: 'bpdpks', regime, score, keyRisk,
      dataSource: 'SOLAR_BLEND_RATIO env (Phase 1 proxy; Phase 2: ESDM/APROBI scraper)',
      dataFresh: true,  // env var is always current
    });
  }

  // ── 5. Pertamina Subsidi Gap (Quasi-Ponzi) ────────────────────────────────
  // Phase 1: derive from subsidi_energi_ytd and APBN subsidi allocation
  // If YTD pace >> APBN, Pertamina working capital loan risk rises
  {
    const subsidiVal = subsidiYtd?.value ?? null;
    // APBN 2026 subsidi energi: Rp204.5T total (BBM + LPG + listrik)
    const APBN_SUBSIDI_T = 204.5;
    const monthsElapsed = new Date().getMonth() + 1; // rough
    const pace = subsidiVal !== null ? (subsidiVal / monthsElapsed) * 12 : null;
    const paceRatio = pace !== null ? pace / APBN_SUBSIDI_T : null;

    let regime: MinskyRegime;
    let score: number;
    let keyRisk: string;

    if (paceRatio !== null) {
      if (paceRatio > 1.5) {
        regime = 'speculative'; score = 10;
        keyRisk = `Pertamina: subsidi energi on pace for Rp${pace?.toFixed(0)}T (${((paceRatio - 1) * 100).toFixed(0)}% over APBN) → APBN transfer delay risk → Pertamina working capital borrowing`;
      } else if (paceRatio > 1.2) {
        regime = 'speculative'; score = 6;
        keyRisk = `Pertamina: subsidi energi pace ${paceRatio.toFixed(2)}× APBN — elevated transfer delay risk`;
      } else {
        regime = 'hedge'; score = 0;
        keyRisk = `Pertamina: subsidi energi pace ${paceRatio?.toFixed(2) ?? '?'}× APBN (within envelope)`;
      }
    } else {
      regime = 'unknown'; score = 0;
      keyRisk = 'Pertamina: subsidi data missing';
    }

    assessments.push({
      sector: 'pertamina', regime, score, keyRisk,
      dataSource: 'subsidi_energi_ytd_idr_t vs APBN Rp204.5T',
      dataFresh: subsidiYtd !== null,
    });
  }

  // ── Composite ─────────────────────────────────────────────────────────────
  const totalScore = assessments.reduce((s, a) => s + a.score, 0);
  const compositeScore = Math.round((totalScore / 100) * 100); // 5 sectors × 20 = 100 max
  const ponziCount = assessments.filter(a => a.regime === 'ponzi').length;
  const speculativeCount = assessments.filter(a => a.regime === 'speculative').length;

  const overallRegime =
    ponziCount >= 2 ? 'ponzi_dominant' :
    ponziCount === 1 || speculativeCount >= 3 ? 'systemic_speculative' :
    speculativeCount >= 1 ? 'transition' : 'systemic_hedge';

  const minskyMomentRisk = ponziCount >= 2;

  // M8 bump: BPD + corporate FX sectors
  const bpdAssessment = assessments.find(a => a.sector === 'bpd')!;
  const fxAssessment = assessments.find(a => a.sector === 'corporate_fx')!;
  const m8Bump =
    (bpdAssessment.regime === 'ponzi' ? 15 : bpdAssessment.regime === 'speculative' ? 8 : 0) +
    (fxAssessment.regime === 'ponzi' ? 10 : fxAssessment.regime === 'speculative' ? 5 : 0) +
    (puabSpreadBps !== null && puabSpreadBps > 100 ? 5 : 0);

  // M10 bump: BPDPKS + fiscal sectors
  const bpdpksAssessment = assessments.find(a => a.sector === 'bpdpks')!;
  const fiscalAssessment = assessments.find(a => a.sector === 'fiscal')!;
  const pertaminaAssessment = assessments.find(a => a.sector === 'pertamina')!;
  const m10Bump =
    (bpdpksAssessment.regime === 'ponzi' ? 12 : bpdpksAssessment.regime === 'speculative' ? 5 : 0) +
    (fiscalAssessment.regime === 'ponzi' ? 8 : 0) +
    (pertaminaAssessment.regime === 'speculative' ? 4 : 0);

  const transmissionPath: string[] = [];
  if (bpdpksAssessment.regime !== 'hedge') transmissionPath.push('BPDPKS fund drain → subsidi delay');
  if (fiscalAssessment.regime === 'speculative' || fiscalAssessment.regime === 'ponzi')
    transmissionPath.push('Fiscal Ponzi → APBN transfer freeze → Pertamina/BPD liquidity crunch');
  if (bpdAssessment.regime !== 'hedge') transmissionPath.push('BPD DPK withdrawal → PUAB spread spike → IndONIA corridor breach');
  if (fxAssessment.regime !== 'hedge') transmissionPath.push('Corporate FX mismatch → forced dollar buying → IDR spiral');
  if (minskyMomentRisk) transmissionPath.push('⚠️ MINSKY MOMENT RISK: 2+ Ponzi sectors → coordinated deleveraging');

  const result: MinskyStressIndex = {
    assessments,
    overallRegime,
    compositeScore,
    minskyMomentRisk,
    m8Bump,
    m10Bump,
    transmissionPath,
  };
  _msiCache = { result, ts: Date.now() };
  return result;
}

/** Format MSI as markdown section for engine output. */
export function formatMinskySection(msi: MinskyStressIndex): string {
  const regimeEmoji: Record<MinskyRegime | string, string> = {
    hedge: '🟢', speculative: '🟡', ponzi: '🔴', unknown: '⚪',
  };
  const lines = [
    `### Minsky FIH Stress Index — ${msi.overallRegime.replace(/_/g, ' ').toUpperCase()} (${msi.compositeScore}/100)`,
    msi.minskyMomentRisk ? `**⚠️ MINSKY MOMENT RISK — 2+ sectors in Ponzi regime**` : '',
    `| Sector | Regime | Score | Key Risk |`,
    `|--------|--------|-------|----------|`,
    ...msi.assessments.map(a =>
      `| ${a.sector} | ${regimeEmoji[a.regime]} ${a.regime} | ${a.score}/20 | ${a.keyRisk.substring(0, 80)}${a.keyRisk.length > 80 ? '…' : ''} |`
    ),
    ``,
    msi.transmissionPath.length > 0
      ? `**Transmission path:** ${msi.transmissionPath.join(' → ')}`
      : '',
  ];
  return lines.filter(Boolean).join('\n');
}
