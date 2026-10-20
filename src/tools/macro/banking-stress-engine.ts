import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { upsertPoints, getLatestPoint, getHistory } from './time-series-db.js';
import { getFreshPoint, stalenessFlag } from './freshness.js';
import { alertFromScore, alertLabel } from './scoring.js';
import { fetchBankingRatiosOjk } from './sources/ojk.js';
import { fetchBankingRatiosSjkPublic, fetchBankingDpkSjkPublic } from './sources/ojk-sjkpublic.js';
import { fetchBankingKpisNews } from './sources/banking-news.js';
import { fetchFintechLendingOjkIknb } from './sources/ojk-iknb.js';
import { fetchIndoniaRateTe, fetchExternalDebtTe, fetchIhprTe, fetchNplTe, fetchLdrTe, fetchCarTe, fetchM2MoneySupplyTe, fetchNplWorldBank, fetchM2WorldBank } from './sources/sovereign-scraper.js';
import type { AlertLevel, MacroDataPoint } from './types.js';
import { fetchAt1Secondary } from './sources/at1-bonds.js';
import { fetchOjkPdn } from './sources/ojk-pdn.js';

export const BANKING_STRESS_DESCRIPTION = `
MACRO INTELLIGENCE — Banking Stress Engine (Module 8)

Tracks Indonesia's banking sector health and hidden credit cycle stress. Detects:
- NPL buildup (the "mortgage delinquency" signal — stress accumulates before it's visible)
- LDR overextension (credit growth outpacing deposits = liquidity fragility)
- CAR erosion (capital buffer thinning = reduced shock absorption)
- IndONIA-BI Rate spread widening (interbank trust deterioration — equivalent to LIBOR-OIS in 2008)
- External debt accumulation (USD-denominated corporate debt + sovereign)

## When to Use

- "What is Indonesia's NPL ratio?"
- "Is the banking sector overleveraged?"
- "IndONIA spread check"
- "Show banking stress indicators"
- "Indonesia external debt exposure"
- Monthly banking KPI review

## Output

- Banking Stress Score (0–100, higher = more stress)
- GREEN/YELLOW/ORANGE/RED alert level
- NPL gross %, LDR %, CAR %, IndONIA spread, External Debt

## Data Sources

- CAR / LDR: OJK SJKPublic portal (data.ojk.go.id, Playwright XMLA intercept, monthly, Jul 2025+)
- NPL: OJK SPI Excel fallback (legacy portal, Jun 2025 max) → news scrape → World Bank
- IndONIA 3M: Trading Economics scraper (Playwright, monthly) — BI discontinued JIBOR Dec 2023
- BI Rate (for spread): macro DB (from sovereign_risk_engine last run)
- External Debt: Trading Economics scraper (Playwright, quarterly, source: Bank Indonesia)
`.trim();

interface BankingStressOutput {
  alert: AlertLevel;
  stressScore: number;
  nplPct: number | null;
  ldrPct: number | null;
  carPct: number | null;
  indoniaPct: number | null;
  biRatePct: number | null;
  indoniaSpreadBps: number | null;
  externalDebtBn: number | null;
  ihprYoy: number | null;
  sbn10yPct: number | null;
  cpiPct: number | null;
  realIndoniaPct: number | null;
  impliedCarHitPp: number | null;
  srbiOutstandingT: number | null;
  m2ReservesRatio: number | null;
  fxReservesBn: number | null;
  sectorNpl: Record<string, number>;
  fintechNplPct: number | null;
  fintechOutstandingIdrT: number | null;
  fintechGrowthYoyPct: number | null;
  bnplSignal: 'distress' | 'inclusion' | 'credit_cycle_turn' | 'watch' | 'unknown';
  depositoSharePct: number | null;
  diamondDybvig: DiamondDybvig;
  dataDate: string;
  flags: string[];
  summary: string;
}

// ─── Diamond-Dybvig Bank Run Coordination (P2 Game Theory — Diamond & Dybvig 1983) ──
// Bank run is a coordination game with two Nash equilibria:
//   (no-run, no-run) = bank survives | (run, run) = bank fails
// Run equilibrium is self-fulfilling: if enough depositors believe others will run, running is rational.
// Indonesia-calibrated threshold matrix: run risk HIGH when 3+ conditions simultaneously met.

interface DiamondDybvig {
  runRisk: 'low' | 'watch' | 'elevated' | 'critical';
  runCoordinationScore: number;  // 0–100
  conditionsMet: number;         // out of 5.5 effective conditions (c6 weight 0.5)
  conditions: {
    nplStress: boolean;          // NPL > 3.5% (depositors fear solvency)
    ldrOverextended: boolean;    // LDR > 92% (illiquidity = can't meet run demand)
    indoniaSpike: boolean;       // IndONIA spread > 40bps (interbank trust breakdown)
    fintechContagion: boolean;   // fintech NPL > 5% AND growing (shadow banking spillover)
    sbnCarErosion: boolean;      // implied CAR hit > 0.8pp (sovereign-bank nexus)
    backstopStrained: boolean;   // APBN deficit >4.5% GDP = sovereign bailout credibility impaired
                                 // [Gap D — Chatib Basri fiscal backstop, Oct 2026; weight 0.5]
  };
  scoreBump: number;             // contribution to M8 stress score
  flags: string[];
}

function computeDiamondDybvig(
  nplPct: number | null,
  ldrPct: number | null,
  indoniaSpreadBps: number | null,
  fintechNplPct: number | null,
  fintechGrowthYoyPct: number | null,
  impliedCarHitPp: number | null,
  apbnDeficitPctGdp: number | null,
): DiamondDybvig {
  const c = {
    nplStress:        (nplPct ?? 0) > 3.5,
    ldrOverextended:  (ldrPct ?? 0) > 92,
    indoniaSpike:     (indoniaSpreadBps ?? 0) > 40,
    fintechContagion: (fintechNplPct ?? 0) > 5 && (fintechGrowthYoyPct ?? 0) > 10,
    sbnCarErosion:    (impliedCarHitPp ?? 0) > 0.8,
    // Sovereign backstop condition (weight 0.5): fiscal stress impairs LPS/BI LOLR credibility.
    // Threshold 4.5% GDP: above 3% ceiling AND S&P watchlist territory — sovereign rescue less credible.
    backstopStrained: apbnDeficitPctGdp !== null && apbnDeficitPctGdp > 4.5,
  };
  // Effective conditions: 5 full + 1 half-weight = max 5.5
  const conditionsMet = [c.nplStress, c.ldrOverextended, c.indoniaSpike, c.fintechContagion, c.sbnCarErosion].filter(Boolean).length
    + (c.backstopStrained ? 0.5 : 0);

  // Coordination risk: ≥3/5.5 effective conditions = two equilibria unstable; panic is rational
  let runCoordinationScore = 0;
  let runRisk: DiamondDybvig['runRisk'] = 'low';
  if (conditionsMet >= 4) { runCoordinationScore = 85; runRisk = 'critical'; }
  else if (conditionsMet >= 3) { runCoordinationScore = 60; runRisk = 'elevated'; }
  else if (conditionsMet >= 2) { runCoordinationScore = 35; runRisk = 'watch'; }
  else if (conditionsMet >= 1) { runCoordinationScore = 15; runRisk = 'watch'; }

  const scoreBump = Math.round(runCoordinationScore * 0.15); // max +12.75 at score=85

  const condStr = `NPL ${c.nplStress ? '✓' : '✗'} LDR ${c.ldrOverextended ? '✓' : '✗'} IndONIA ${c.indoniaSpike ? '✓' : '✗'} Fintech ${c.fintechContagion ? '✓' : '✗'} CAR-erosion ${c.sbnCarErosion ? '✓' : '✗'} Backstop ${c.backstopStrained ? '✓(½)' : '✗'}`;
  const flags: string[] = [];
  if (runRisk === 'critical') {
    flags.push(`DIAMOND-DYBVIG CRITICAL: ${conditionsMet}/5.5 run conditions met — bank run equilibrium reachable. Depositor panic self-fulfilling if sentiment shifts. [Diamond-Dybvig 1983]`);
  } else if (runRisk === 'elevated') {
    flags.push(`Diamond-Dybvig ELEVATED: ${conditionsMet}/5.5 conditions (${condStr}) — run coordination risk elevated. [Diamond-Dybvig 1983]`);
  } else if (runRisk === 'watch' && conditionsMet > 0) {
    flags.push(`Diamond-Dybvig watch: ${conditionsMet}/5.5 run condition(s) — insufficient for coordination failure now. Monitor.`);
  }
  if (c.backstopStrained) {
    flags.push(`Sovereign backstop STRAINED: APBN deficit ${apbnDeficitPctGdp!.toFixed(2)}% GDP >4.5% threshold — LPS/BI LOLR credibility impaired; D-D panic equilibrium easier to reach. [Chatib Basri 2026]`);
  }

  return { runRisk, runCoordinationScore, conditionsMet, conditions: c, scoreBump, flags };
}

/** Score NPL: lower is better. 2%=0, 5%=40, 8%=70, 10%+=100 */
function scoreNpl(npl: number): number {
  if (npl < 2) return 0;
  if (npl < 5) return Math.round((npl - 2) / 3 * 40);
  if (npl < 8) return Math.round(40 + (npl - 5) / 3 * 30);
  if (npl < 10) return Math.round(70 + (npl - 8) / 2 * 30);
  return 100;
}

/** Score LDR: 70–90% = healthy(0). >100% = stress. */
function scoreLdr(ldr: number): number {
  if (ldr < 90) return 0;
  if (ldr < 100) return Math.round((ldr - 90) / 10 * 40);
  if (ldr < 110) return Math.round(40 + (ldr - 100) / 10 * 40);
  return Math.min(100, Math.round(80 + (ldr - 110) / 5 * 20));
}

/** Score CAR: higher is safer. <8%=100, <12%=70, <15%=40, 15%+=0 */
function scoreCar(car: number): number {
  if (car >= 15) return 0;
  if (car >= 12) return Math.round((15 - car) / 3 * 40);
  if (car >= 8) return Math.round(40 + (12 - car) / 4 * 30);
  return Math.min(100, Math.round(70 + (8 - car) / 2 * 30));
}

/** Score IndONIA spread vs BI Rate (bps): BI corridor-calibrated.
 * LF Rate ceiling = BI Rate + 75bps. IndONIA at ceiling = BI forced to inject liquidity.
 * Normal: 0–30bps | Tension: 30–50bps | Stressed: 50–75bps | Crisis: >75bps
 */
function scoreIndoniaSpread(spreadBps: number): number {
  if (spreadBps < 0) spreadBps = 0;
  if (spreadBps < 30) return Math.round(spreadBps / 30 * 15);
  if (spreadBps < 50) return Math.round(15 + (spreadBps - 30) / 20 * 25);
  if (spreadBps < 75) return Math.round(40 + (spreadBps - 50) / 25 * 30);
  if (spreadBps < 150) return Math.round(70 + (spreadBps - 75) / 75 * 20);
  return Math.min(100, Math.round(90 + (spreadBps - 150) / 50 * 10));
}

/** Dual-signal: high growth + high NPL = distress, NOT inclusion.
 *  Context: BI Rate hike + BBM hike → income squeeze → BNPL catch-up spending.
 *  Thresholds calibrated to Indonesia IKNB: OJK normal NPL ~3%, stress ~5%, crisis ~8%. */
function classifyBnplSignal(
  nplPct: number | null,
  growthYoyPct: number | null,
): BankingStressOutput['bnplSignal'] {
  if (nplPct === null) return 'unknown';
  if (growthYoyPct !== null && growthYoyPct > 30 && nplPct > 5) return 'distress';
  if (growthYoyPct !== null && growthYoyPct > 30 && nplPct <= 3) return 'inclusion';
  if (growthYoyPct !== null && growthYoyPct < 10 && nplPct > 5) return 'credit_cycle_turn';
  if (nplPct > 5) return 'watch';
  return 'unknown';
}

export async function runBankingStressEngine(): Promise<BankingStressOutput> {
  // 1a. Freshness gate: NPL/LDR/CAR are monthly OJK data — skip Playwright re-scrape if < 48h old.
  // Prevents Playwright browser contention under 12-module parallel morning brief runs.
  // To force re-seed: run banking_stress_engine standalone (not during morning brief).
  const [cachedNpl, cachedLdr, cachedCar] = await Promise.all([
    getLatestPoint('bank_npl_gross_pct'),
    getLatestPoint('bank_ldr_pct'),
    getLatestPoint('bank_car_pct'),
  ]);
  const BANKING_KPI_TTL_MS = 48 * 3_600_000;
  const isKpiFresh = (p: { fetchedAt: string } | null) =>
    p !== null && Date.now() - new Date(p.fetchedAt).getTime() < BANKING_KPI_TTL_MS;
  const kpisFresh = isKpiFresh(cachedNpl) && isKpiFresh(cachedLdr) && isKpiFresh(cachedCar);

  // 1b. KPI fetch tier order:
  //   Tier 0: env overrides — ALWAYS applied (zero cost, user-explicit, range-validated)
  //   Tier 1+: OJK Playwright → news scrape → WB API → TE — only when 48h cache stale
  let ratios: { npl: MacroDataPoint | null; ldr: MacroDataPoint | null; car: MacroDataPoint | null; sectorNpl: Record<string, number> }
    = { npl: null, ldr: null, car: null, sectorNpl: {} };

  // Tier 0: env overrides — instant manual pin from OJK monthly press release
  const envOverride = (envName: string, indicator: string, lo: number, hi: number): MacroDataPoint | null => {
    const raw = process.env[envName];
    if (!raw) return null;
    const v = parseFloat(raw);
    if (isNaN(v) || v < lo || v > hi) return null;
    return {
      indicator, category: 'banking', date: new Date().toISOString().slice(0, 10),
      value: v, unit: '%', source: 'env_manual', fetchedAt: new Date().toISOString(),
    };
  };
  ratios.npl = envOverride('BANK_NPL_GROSS_PCT', 'bank_npl_gross_pct', 0.5, 12);
  ratios.ldr = envOverride('BANK_LDR_PCT', 'bank_ldr_pct', 60, 110);
  ratios.car = envOverride('BANK_CAR_PCT', 'bank_car_pct', 12, 35);

  if (!kpisFresh) {
    // Tier 1: OJK SJKPublic portal (data.ojk.go.id — live Jul 2025+, CAR+LDR only; NPL not in MetricID=338)
    if (!ratios.ldr || !ratios.car) {
      const sjkResult = await fetchBankingRatiosSjkPublic().catch(() => null);
      if (sjkResult) {
        ratios.ldr ??= sjkResult.ldr;
        ratios.car ??= sjkResult.car;
      }
    }
    // Tier 2: OJK SPI Playwright (legacy portal, stuck at Jun 2025; kept as NPL fallback)
    if (!ratios.npl || !ratios.ldr || !ratios.car) {
      const ojkResult = await fetchBankingRatiosOjk().catch(() => null);
      if (ojkResult) {
        ratios.npl ??= ojkResult.npl;
        ratios.ldr ??= ojkResult.ldr;
        ratios.car ??= ojkResult.car;
        ratios.sectorNpl = ojkResult.sectorNpl;
      }
    }
    // Tier 2: News scrape (OJK press release recaps via Exa/Tavily)
    if (!ratios.npl || !ratios.ldr || !ratios.car) {
      const newsResult = await fetchBankingKpisNews().catch(() => null);
      if (newsResult) {
        ratios.npl ??= newsResult.npl;
        ratios.ldr ??= newsResult.ldr;
        ratios.car ??= newsResult.car;
      }
    }
    // Tier 3: World Bank API (NPL only, annual lag)
    if (!ratios.npl) {
      const wbNpl = await fetchNplWorldBank().catch(() => null);
      if (wbNpl) ratios.npl = wbNpl;
    }
    // Tier 4: TE Playwright (monthly OJK mirror) — currently returns "no data"; future safety net
    if (!ratios.npl && !ratios.ldr && !ratios.car) {
      const [teNpl, teLdr, teCar] = await Promise.allSettled([fetchNplTe(), fetchLdrTe(), fetchCarTe()]);
      if (teNpl.status === 'fulfilled' && teNpl.value) ratios.npl = teNpl.value;
      if (teLdr.status === 'fulfilled' && teLdr.value) ratios.ldr = teLdr.value;
      if (teCar.status === 'fulfilled' && teCar.value) ratios.car = teCar.value;
    }
  }

  // 1c. Frequently-updated indicators always fetched fresh (IndONIA monthly, ext debt quarterly)
  const [indoniaPoint, extDebtPoint, ihprPoint, m2Point] = await Promise.allSettled([
    fetchIndoniaRateTe(),
    fetchExternalDebtTe(),
    fetchIhprTe(),
    fetchM2MoneySupplyTe(),
  ]);
  const indonia = indoniaPoint.status === 'fulfilled' ? indoniaPoint.value : null;
  const extDebt = extDebtPoint.status === 'fulfilled' ? extDebtPoint.value : null;
  const ihpr = ihprPoint.status === 'fulfilled' ? ihprPoint.value : null;
  let m2 = m2Point.status === 'fulfilled' ? m2Point.value : null;
  if (m2 === null) {
    // Tier 2: World Bank annual M2 (no Playwright, free API, 1-year lag)
    m2 = await fetchM2WorldBank();
  }

  // DPK: OJK SJKPublic MetricID=331 (replaces broken TE deposits scrape)
  // tabungan=savings (sticky), deposito=time deposits (hot money, rate-sensitive)
  const dpkResult = await fetchBankingDpkSjkPublic().catch(() => null);
  // dpkResult already upserts to DB internally; dpk point for pointsToSave covered

  // 1d. Fintech lending / BNPL (OJK IKNB, monthly, 30d TTL — fetch in parallel with 1c)
  const fintechResult = await fetchFintechLendingOjkIknb().catch(() => null);

  // 2. Persist to DB
  const pointsToSave = [ratios.npl, ratios.ldr, ratios.car, indonia, extDebt, ihpr, m2].filter(Boolean);
  if (pointsToSave.length > 0) await upsertPoints(pointsToSave as NonNullable<typeof ratios.npl>[]);

  // Persist sector NPL as individual DB points
  const sectorNplPoints = Object.entries(ratios.sectorNpl).map(([sector, pct]) => ({
    indicator: `bank_npl_sector_${sector}_pct`,
    category: 'banking' as const,
    date: ratios.npl?.date ?? new Date().toISOString().slice(0, 10),
    value: pct,
    unit: '%',
    source: 'ojk_spi_xlsx',
    fetchedAt: new Date().toISOString(),
  }));
  if (sectorNplPoints.length > 0) await upsertPoints(sectorNplPoints);

  // 3. Read from DB (use cached if live fetch failed)
  // Critical banking KPIs (NPL/LDR/CAR) gated by freshness — RED-stale data treated as
  // missing so engine doesn't report a false GREEN score from a different macro era.
  const [freshNpl, freshLdr, freshCar, dbIndonia, dbBiRate, dbExtDebt, dbIhpr, dbSbn10y, dbCpi, dbSrbi, dbM2Idr, dbFxReserves, dbUsdidr, dbFintechNpl, dbFintechOutstanding, dbFintechGrowth, dbDeficitPct, dbDepositoShare] = await Promise.all([
    getFreshPoint('bank_npl_gross_pct', { treatStaleAsMissing: true }),
    getFreshPoint('bank_ldr_pct', { treatStaleAsMissing: true }),
    getFreshPoint('bank_car_pct', { treatStaleAsMissing: true }),
    getLatestPoint('indonia_3m_pct'),
    getLatestPoint('bi_rate_pct'),
    getLatestPoint('indonesia_external_debt_bn'),
    getLatestPoint('indonesia_ihpr_yoy_pct'),
    getLatestPoint('sbn_10y_yield_pct'),
    getLatestPoint('inflation_cpi_pct'),
    getLatestPoint('srbi_outstanding_trn_idr'),
    getLatestPoint('m2_money_supply_idr_bn'),
    getLatestPoint('bi_fx_reserves_bn'),
    getLatestPoint('usdidr_spot'),
    getLatestPoint('fintech_npl_pct'),
    getLatestPoint('fintech_lending_outstanding_idr_t'),
    getLatestPoint('fintech_lending_growth_yoy_pct'),
    getLatestPoint('apbn_deficit_pct_gdp'),   // Gap D: sovereign backstop proxy for D-D condition_6
    getLatestPoint('bank_deposito_share_pct'), // hot money concentration (deposito/total DPK %)
  ]);
  const dbNpl = freshNpl.point;
  const dbLdr = freshLdr.point;
  const dbCar = freshCar.point;

  const nplPct = dbNpl?.value ?? null;
  const ldrPct = dbLdr?.value ?? null;
  const carPct = dbCar?.value ?? null;
  const apbnDeficitPctGdp = dbDeficitPct?.value ?? null;
  const indoniaPct = dbIndonia?.value ?? null;
  const biRatePct = dbBiRate?.value ?? null;
  const externalDebtBn = dbExtDebt?.value ?? null;
  const ihprYoy = dbIhpr?.value ?? null;
  const sbn10yPct = dbSbn10y?.value ?? null;
  const cpiPct = dbCpi?.value ?? null;
  const srbiOutstandingT = dbSrbi?.value ?? null;
  const m2IdrBn = dbM2Idr?.value ?? null;
  const fxReservesBn = dbFxReserves?.value ?? null;
  const usdidrSpot = dbUsdidr?.value ?? null;
  const depositoSharePct = dbDepositoShare?.value ?? null;

  // FINTECH_NPL_PCT env override — pin from OJK SPI monthly release when Playwright blocked (WAF).
  const fintechNplEnv = process.env.FINTECH_NPL_PCT;
  const fintechNplFromEnv = fintechNplEnv ? parseFloat(fintechNplEnv) : null;
  const fintechNplPct      = fintechNplFromEnv ?? fintechResult?.fintechNplPct ?? dbFintechNpl?.value ?? null;
  const fintechOutstandingIdrT = fintechResult?.outstandingIdrT ?? dbFintechOutstanding?.value ?? null;
  const fintechGrowthYoyPct   = fintechResult?.growthYoyPct    ?? dbFintechGrowth?.value      ?? null;
  const bnplSignal = classifyBnplSignal(fintechNplPct, fintechGrowthYoyPct);

  // KLR M2/reserves ratio: M2 (USD equiv) / FX reserves — most critical KLR capital flight indicator
  // M2 in IDR bn ÷ USDIDR = M2 in USD bn; then ÷ FX reserves (USD bn)
  const m2UsdBn = m2IdrBn !== null && usdidrSpot !== null ? m2IdrBn / usdidrSpot : null;
  const m2ReservesRatio = m2UsdBn !== null && fxReservesBn !== null && fxReservesBn > 0
    ? parseFloat((m2UsdBn / fxReservesBn).toFixed(2))
    : null;

  // Real IndONIA rate (KLR: negative real rate = financial repression + capital flight signal)
  const realIndoniaPct = indoniaPct !== null && cpiPct !== null
    ? parseFloat((indoniaPct - cpiPct).toFixed(2))
    : null;

  // FSAP sovereign-bank nexus: SBN yield elevation → implied bank CAR erosion.
  // Indonesia banks hold ~20% assets in SBN; portfolio duration ~6yr.
  // Formula: (sbn_10y - 6.5% baseline) × 6yr × 0.20 = CAR pp hit.
  const SBN_FSAP_BASELINE_PCT = 6.5;
  const impliedCarHitPp = sbn10yPct !== null && sbn10yPct > SBN_FSAP_BASELINE_PCT
    ? parseFloat(((sbn10yPct - SBN_FSAP_BASELINE_PCT) * 6 * 0.20).toFixed(2))
    : null;

  // Sector NPL from DB (read back what was persisted)
  const sectorNpl: Record<string, number> = {};
  await Promise.all(
    ['real_estat', 'konstruksi', 'perdagangan', 'konsumsi'].map(async (s) => {
      const p = await getLatestPoint(`bank_npl_sector_${s}_pct`);
      if (p) sectorNpl[s] = p.value;
    }),
  );

  const indoniaSpreadBps = indoniaPct !== null && biRatePct !== null
    ? Math.round((indoniaPct - biRatePct) * 100)
    : null;

  // 4. Compute stress score (weighted)
  const components: Array<[number, number]> = []; // [score, weight]
  if (nplPct !== null) components.push([scoreNpl(nplPct), 0.30]);
  if (ldrPct !== null) components.push([scoreLdr(ldrPct), 0.25]);
  if (carPct !== null) components.push([scoreCar(carPct), 0.25]);
  if (indoniaSpreadBps !== null) components.push([scoreIndoniaSpread(indoniaSpreadBps), 0.20]);

  let stressScore = 20; // default neutral if no data
  if (components.length > 0) {
    const totalWeight = components.reduce((s, [, w]) => s + w, 0);
    stressScore = Math.round(components.reduce((s, [score, w]) => s + score * w, 0) / totalWeight);
  }

  // FSAP amplifier: SBN yield shock transmits to banking CAR via sovereign-bank nexus
  if (impliedCarHitPp !== null && impliedCarHitPp > 0.5) {
    stressScore = Math.min(100, stressScore + Math.min(15, Math.round(impliedCarHitPp * 5)));
  }

  // BNPL amplifier: fintech NPL is 2-3Q leading indicator for bank NPL
  if (fintechNplPct !== null) {
    const bnplAmplifier = bnplSignal === 'credit_cycle_turn' ? 10
      : bnplSignal === 'distress' ? 8
      : fintechNplPct > 5 ? 5
      : 0;
    stressScore = Math.min(100, stressScore + bnplAmplifier);
  }

  // ── Diamond-Dybvig (P2 Game Theory) ──────────────────────────────────────────
  const diamondDybvig = computeDiamondDybvig(
    nplPct, ldrPct, indoniaSpreadBps,
    fintechNplPct, fintechGrowthYoyPct,
    impliedCarHitPp,
    apbnDeficitPctGdp,
  );
  stressScore = Math.min(100, stressScore + diamondDybvig.scoreBump);

  // ── AT1 Perpetual Bond — Himbara capital stress signal ───────────────────────
  // Issuance signal (manual env pin): preemptive CAR buffer = forward-looking concern.
  const at1Bn   = parseFloat(process.env.BANK_AT1_ISSUANCE_BUMN_USD_BN ?? '0');
  const at1Date = process.env.BANK_AT1_ISSUANCE_DATE ?? null;
  const at1AgeDays = at1Date
    ? Math.floor((Date.now() - new Date(at1Date).getTime()) / 86_400_000)
    : null;
  const at1Active = at1Bn > 0 && at1AgeDays !== null && at1AgeDays <= 180;
  const at1Bump = at1Active ? (at1Bn >= 1.0 ? 10 : 6) : 0;
  stressScore = Math.min(100, stressScore + at1Bump);

  // Secondary market price signal (Exa-fetched): AT1 < 80% par = market pricing loss risk.
  // More timely than issuance signal — bond desks reprice before regulators act.
  const [at1Secondary, ojkPdn] = await Promise.all([fetchAt1Secondary(), fetchOjkPdn()]);
  if (at1Secondary) await upsertPoints([{
    indicator: 'himbara_at1_secondary_pct',
    category: 'banking' as const,
    date: new Date().toISOString().slice(0, 10),
    value: at1Secondary.pricePct,
    unit: 'pct_par',
    source: at1Secondary.sourceUrl ?? 'exa_search',
    fetchedAt: at1Secondary.fetchedAt,
  }]);
  if (at1Secondary) {
    if (at1Secondary.pricePct < 80) {
      stressScore = Math.min(100, stressScore + 15);
    } else if (at1Secondary.pricePct < 90) {
      stressScore = Math.min(100, stressScore + 8);
    }
  }

  // Deposito hot money concentration (OJK SJKPublic MetricID=331)
  // deposito = time deposits, rate-sensitive, can be pulled at maturity → flight risk amplifier
  // Historical Indonesia norm: ~50-55% of DPK. >58% = elevated; >62% = high hot money exposure.
  let depositoBump = 0;
  if (depositoSharePct !== null) {
    if (depositoSharePct > 62) depositoBump = 8;
    else if (depositoSharePct > 58) depositoBump = 4;
  }
  stressScore = Math.min(100, stressScore + depositoBump);

  // OJK PDN — bank net open FX position (monthly proxy for corporate hedging stress)
  let pdnBump = 0;
  if (ojkPdn !== null) {
    if (ojkPdn.pdnPct > 18) pdnBump = 15;
    else if (ojkPdn.pdnPct > 15) pdnBump = 10;
    else if (ojkPdn.pdnPct > 10) pdnBump = 5;
    stressScore = Math.min(100, stressScore + pdnBump);
  }

  // 3rd-gen balance sheet amplifier: unhedged FX exposure × realized IDR depreciation.
  // Formula: (1 − hedging_compliance) × uln_shortterm_pct × idr_depr_30d
  // No new data needed — pure cross-module computation from M3/M13 env pins.
  let thirdGenBump = 0;
  let thirdGenAmp: number | null = null;
  {
    const hedgingPct = parseFloat(process.env.BI_HEDGING_COMPLIANCE_PCT ?? '') || null;
    const stPct      = parseFloat(process.env.ULN_SHORTTERM_PCT ?? '') || null;
    const [spotNow, spot30d] = await Promise.all([
      getLatestPoint('usdidr_spot'),
      getHistory('usdidr_spot', 35),
    ]);
    const spot30dVal = spot30d.length >= 20 ? spot30d[0]?.value ?? null : null;
    const idrDepr30d = (spotNow && spot30dVal)
      ? Math.max(0, (spotNow.value - spot30dVal) / spot30dVal)
      : null;

    if (hedgingPct !== null && stPct !== null && idrDepr30d !== null) {
      thirdGenAmp = (1 - hedgingPct / 100) * (stPct / 100) * idrDepr30d;
      thirdGenBump = Math.min(20, Math.round(thirdGenAmp * 5000));
      stressScore = Math.min(100, stressScore + thirdGenBump);
    }
  }

  // 5. Alert level: high stressScore = more stress = higher alert
  const alert = alertFromScore(stressScore) as AlertLevel;

  // 6. Flags
  const flags: string[] = [];

  // Freshness gate: RED-stale → treated as missing (null) above. ORANGE/RED stale
  // critical inputs still surface as flags so the alert level isn't misread as
  // current-state GREEN. When ≥2/3 are ORANGE+ the score loses representativeness.
  for (const fp of [freshNpl, freshLdr, freshCar] as const) {
    if ((fp.cls === 'red' || fp.cls === 'orange') && fp.spec && fp.ageDays != null) {
      flags.push(stalenessFlag(fp.spec.name, fp.ageDays, fp.spec, fp.cls));
    }
  }
  const criticalInputsStale = [freshNpl, freshLdr, freshCar].filter(fp => fp.cls === 'red' || fp.cls === 'orange').length;
  if (criticalInputsStale >= 2) {
    flags.unshift(`LOW CONFIDENCE: ${criticalInputsStale}/3 critical banking KPIs ORANGE/RED-stale — alert level not representative of current banking sector`);
  }

  // KLR NPL thresholds (Kaminsky-Reinhart EM calibration: 3% early warning, 5% acute)
  if (nplPct !== null && nplPct > 3 && nplPct <= 5) {
    flags.push(`NPL ${nplPct.toFixed(1)}% — above KLR early-warning threshold (3%); approaching acute threshold (5%)`);
  }
  if (nplPct !== null && nplPct > 5) {
    flags.push(`NPL ${nplPct.toFixed(1)}% — above KLR acute stress threshold (5%)`);
  }

  if (ldrPct !== null && ldrPct > 100) flags.push(`LDR ${ldrPct.toFixed(1)}% — credit exceeds deposits`);
  if (carPct !== null && carPct < 15) flags.push(`CAR ${carPct.toFixed(1)}% — capital buffer thinning`);

  // IndONIA spread — BI corridor calibrated (LF Rate ceiling = BI Rate + 75bps)
  if (indoniaSpreadBps !== null && indoniaSpreadBps > 30 && indoniaSpreadBps <= 50) {
    flags.push(`IndONIA spread ${indoniaSpreadBps}bps — interbank tension (30bps threshold; BI corridor ceiling 75bps)`);
  }
  if (indoniaSpreadBps !== null && indoniaSpreadBps > 50) {
    flags.push(`IndONIA spread ${indoniaSpreadBps}bps — approaching BI corridor ceiling (75bps = BI forced to inject)`);
  }
  if (indoniaSpreadBps !== null && indoniaSpreadBps > 30 && nplPct !== null && nplPct > 3) {
    flags.push('IndONIA spread + NPL both elevated — early interbank-credit stress signal');
  }

  // FSAP sovereign-bank nexus
  if (impliedCarHitPp !== null && impliedCarHitPp > 0.5) {
    flags.push(`FSAP nexus: SBN 10Y ${sbn10yPct?.toFixed(3)}% implies ~${impliedCarHitPp.toFixed(1)}pp CAR erosion (6yr duration × 20% SBN/assets)`);
  }
  if (impliedCarHitPp !== null && impliedCarHitPp > 1.5) {
    flags.push(`FSAP critical: ${impliedCarHitPp.toFixed(1)}pp implied CAR hit — sovereign-bank doom loop risk if SBN yields spike further`);
  }

  // SRBI-IndONIA nexus: structural liquidity drain tightening credit
  if (srbiOutstandingT !== null && srbiOutstandingT > 900 && indoniaSpreadBps !== null && indoniaSpreadBps > 30) {
    flags.push(`SRBI-IndONIA nexus: SRBI ${srbiOutstandingT.toFixed(0)}T outstanding + spread ${indoniaSpreadBps}bps — structural liquidity drain tightening credit channels`);
  }

  // Real rate (KLR: negative real rate = financial repression → capital flight signal)
  if (realIndoniaPct !== null && realIndoniaPct < 0) {
    flags.push(`Real IndONIA rate ${realIndoniaPct.toFixed(2)}% (IndONIA ${indoniaPct?.toFixed(2)}% − CPI ${cpiPct?.toFixed(1)}%) — financial repression; KLR capital flight signal`);
  }

  // KLR M2/reserves ratio (most critical capital flight early warning indicator)
  if (m2ReservesRatio !== null && m2ReservesRatio > 5) {
    flags.push(`KLR M2/reserves ratio ${m2ReservesRatio.toFixed(1)}x — CRITICAL capital flight risk (>5x threshold)`);
  } else if (m2ReservesRatio !== null && m2ReservesRatio > 3) {
    flags.push(`KLR M2/reserves ratio ${m2ReservesRatio.toFixed(1)}x — watch zone (3–5x; Indonesia M2 ~$500bn vs reserves $${fxReservesBn?.toFixed(0)}bn)`);
  }

  if (ihprYoy !== null && ihprYoy < 0) flags.push(`IHPR ${ihprYoy.toFixed(1)}% YoY — property prices falling (KPR collateral risk)`);
  if (ihprYoy !== null && ihprYoy < 0 && nplPct !== null && nplPct > 3) {
    flags.push('Property price decline + elevated NPL — mortgage collateral deflation risk');
  }

  // Sector NPL flags
  for (const [sector, npl] of Object.entries(sectorNpl)) {
    if (npl > 5) flags.push(`Sector NPL ${sector}: ${npl.toFixed(1)}% — above 5% threshold`);
  }

  // BNPL / fintech lending flags (OJK IKNB)
  if (bnplSignal === 'distress') {
    flags.push(`BNPL/fintech DISTRESS: high growth + NPL ${fintechNplPct?.toFixed(1)}% (>5%) — catch-up spending while income insufficient; 2-3Q bank NPL leading indicator`);
  } else if (bnplSignal === 'credit_cycle_turn') {
    flags.push(`BNPL/fintech CREDIT_CYCLE_TURN: slowing growth + NPL ${fintechNplPct?.toFixed(1)}% — contraction + defaults; formal banking stress in 2-3Q`);
  } else if (bnplSignal === 'watch' && fintechNplPct !== null) {
    flags.push(`BNPL/fintech WATCH: NPL ${fintechNplPct.toFixed(1)}% — fintech NPL 2.5× bank NPL; monitor for credit-cycle transmission`);
  }
  if (fintechNplPct !== null && nplPct !== null && fintechNplPct > nplPct * 2) {
    flags.push(`Fintech NPL ${fintechNplPct.toFixed(1)}% vs bank NPL ${nplPct.toFixed(1)}% — gap ${(fintechNplPct / nplPct).toFixed(1)}× indicates unsecured digital credit stress concentrating ahead of formal banking`);
  }

  // AT1 issuance flag
  if (at1Active) {
    const idrTrn = (at1Bn * (fxReservesBn ? 17_915 : 17_000) / 1_000).toFixed(1);
    flags.push(
      `HIMBARA AT1 ISSUANCE: $${at1Bn.toFixed(2)}bn USD perpetual bond (${at1Date}) — ` +
      `BNI $700M Apr + Mandiri $750M Sep 2026; preemptive CAR buffer; ` +
      `USD capital = FX mismatch ~Rp${idrTrn}T on capital base; domestic market insufficient to absorb`,
    );
  }

  // AT1 secondary market price flag
  if (at1Secondary) {
    if (at1Secondary.pricePct < 80) {
      flags.push(`HIMBARA AT1 SECONDARY STRESS: price ${at1Secondary.pricePct.toFixed(1)}% of par${at1Secondary.yieldPct ? ` (yield ${at1Secondary.yieldPct.toFixed(1)}%)` : ''} — market pricing loss-absorption risk. Bond desks ahead of regulators. (+15 score)`);
    } else if (at1Secondary.pricePct < 90) {
      flags.push(`HIMBARA AT1 secondary watch: ${at1Secondary.pricePct.toFixed(1)}% par${at1Secondary.yieldPct ? ` / yield ${at1Secondary.yieldPct.toFixed(1)}%` : ''} — mild secondary stress, monitor for decline below 80. (+8 score)`);
    } else {
      flags.push(`HIMBARA AT1 secondary: ${at1Secondary.pricePct.toFixed(1)}% par${at1Secondary.yieldPct ? ` / yield ${at1Secondary.yieldPct.toFixed(1)}%` : ''} — no secondary stress signal.`);
    }
  }

  // OJK PDN flag
  if (ojkPdn !== null) {
    if (ojkPdn.pdnPct > 18) {
      flags.push(`OJK PDN CRITICAL: ${ojkPdn.pdnPct.toFixed(1)}% of capital — near 20% regulatory ceiling. Forced deleveraging risk if IDR depreciates further. (+${pdnBump} score)`);
    } else if (ojkPdn.pdnPct > 15) {
      flags.push(`OJK PDN elevated: ${ojkPdn.pdnPct.toFixed(1)}% of capital — concentrated FX exposure; banks absorbing IDR risk. (+${pdnBump} score)`);
    } else if (ojkPdn.pdnPct > 10) {
      flags.push(`OJK PDN watch: ${ojkPdn.pdnPct.toFixed(1)}% of capital — above normal operating range (5–10%). (+${pdnBump} score)`);
    } else {
      flags.push(`OJK PDN: ${ojkPdn.pdnPct.toFixed(1)}% of capital — within normal range (<10%).`);
    }
  }

  // Deposito hot money concentration flag
  if (depositoSharePct !== null) {
    if (depositoSharePct > 62) {
      flags.push(`DEPOSITO HOT MONEY HIGH: ${depositoSharePct.toFixed(1)}% of DPK is time deposits — elevated flight risk. Rate-sensitive; institutional depositors pull at maturity. (+${depositoBump} score)`);
    } else if (depositoSharePct > 58) {
      flags.push(`Deposito concentration elevated: ${depositoSharePct.toFixed(1)}% of DPK — above 58% norm. Monitor for deposit rotation if BI Rate declines. (+${depositoBump} score)`);
    } else {
      flags.push(`Deposito share: ${depositoSharePct.toFixed(1)}% of DPK — within normal range. Deposit base stable.`);
    }
  }

  // 3rd-gen balance sheet amplifier flag
  if (thirdGenAmp !== null && thirdGenBump > 0) {
    const hedgingPct = parseFloat(process.env.BI_HEDGING_COMPLIANCE_PCT ?? '');
    const stPct      = parseFloat(process.env.ULN_SHORTTERM_PCT ?? '');
    flags.push(
      `3RD-GEN BALANCE SHEET: unhedged FX exposure × IDR depreciation amplifier = ${(thirdGenAmp * 100).toFixed(3)}% (+${thirdGenBump} score). ` +
      `Non-compliance ${(100 - hedgingPct).toFixed(1)}% × ST debt ${stPct}% × IDR move → cross-module M3+M8+M13 stress feed.`,
    );
  }

  // Diamond-Dybvig flags
  flags.push(...diamondDybvig.flags);

  // 7. Data date (most recent of all fetched points)
  const dates = [dbNpl, dbLdr, dbCar, dbIndonia, dbExtDebt]
    .filter(Boolean)
    .map(p => p!.date)
    .sort()
    .reverse();
  const dataDate = dates[0] ?? 'unknown';

  // 8. Summary text
  const nplStr = nplPct !== null ? `NPL ${nplPct.toFixed(1)}%` : 'NPL n/a';
  const ldrStr = ldrPct !== null ? `LDR ${ldrPct.toFixed(1)}%` : 'LDR n/a';
  const carStr = carPct !== null ? `CAR ${carPct.toFixed(1)}%` : 'CAR n/a';
  const spreadStr = indoniaSpreadBps !== null ? `IndONIA spread ${indoniaSpreadBps}bps` : 'IndONIA n/a';
  const extDebtStr = externalDebtBn !== null ? `External Debt $${externalDebtBn.toFixed(0)}bn` : '';

  const summary = [
    `Banking Stress: ${stressScore}/100 — ${alertLabel(alert).toUpperCase()}`,
    `${nplStr} | ${ldrStr} | ${carStr} | ${spreadStr}`,
    extDebtStr ? extDebtStr : '',
    flags.length > 0 ? `\nFlags: ${flags.join('; ')}` : '',
    `\nData as of: ${dataDate}`,
  ].filter(Boolean).join('\n');

  return {
    alert, stressScore,
    nplPct, ldrPct, carPct,
    indoniaPct, biRatePct, indoniaSpreadBps,
    externalDebtBn, ihprYoy,
    sbn10yPct, cpiPct, realIndoniaPct, impliedCarHitPp, srbiOutstandingT,
    m2ReservesRatio, fxReservesBn,
    sectorNpl,
    fintechNplPct, fintechOutstandingIdrT, fintechGrowthYoyPct, bnplSignal,
    depositoSharePct,
    diamondDybvig,
    dataDate, flags, summary,
  };
}

export const bankingStressEngine = new DynamicStructuredTool({
  name: 'banking_stress_engine',
  description: BANKING_STRESS_DESCRIPTION,
  schema: z.object({
    query: z.string().describe('Analysis query or focus area'),
  }),
  func: async ({ query: _ }) => {
    try {
      const output = await runBankingStressEngine();
      const lines = [
        `## Banking Stress Engine — Module 8`,
        `**Alert:** ${alertLabel(output.alert).toUpperCase()} | **Stress Score:** ${output.stressScore}/100`,
        ``,
        `| Indicator | Value | Threshold |`,
        `|-----------|-------|-----------|`,
        `| NPL Gross % | ${output.nplPct?.toFixed(1) ?? 'n/a'} | KLR EW >3%, Acute >5% |`,
        `| LDR % | ${output.ldrPct?.toFixed(1) ?? 'n/a'} | YELLOW >90%, RED >110% |`,
        `| CAR % | ${output.carPct?.toFixed(1) ?? 'n/a'} | YELLOW <15%, RED <8% |`,
        `| IndONIA 3M % | ${output.indoniaPct?.toFixed(2) ?? 'n/a'} | — |`,
        `| BI Rate % | ${output.biRatePct?.toFixed(2) ?? 'n/a'} | — |`,
        `| IndONIA-BI Spread | ${output.indoniaSpreadBps !== null ? output.indoniaSpreadBps + 'bps' : 'n/a'} | YELLOW >30bps, ORANGE >50bps, RED >75bps (BI corridor) |`,
        `| Real IndONIA Rate | ${output.realIndoniaPct !== null ? output.realIndoniaPct.toFixed(2) + '%' : 'n/a'} | <0% = financial repression (KLR signal) |`,
        `| SBN 10Y Yield | ${output.sbn10yPct !== null ? output.sbn10yPct.toFixed(3) + '%' : 'n/a'} | FSAP baseline 6.5%; >7.5% = alert |`,
        `| Implied CAR Hit | ${output.impliedCarHitPp !== null ? output.impliedCarHitPp.toFixed(1) + 'pp' : 'n/a'} | FSAP: 6yr dur × 20% SBN/assets |`,
        `| SRBI Outstanding | ${output.srbiOutstandingT !== null ? output.srbiOutstandingT.toFixed(0) + 'T IDR' : 'n/a'} | >900T = structural drain |`,
        `| M2/FX Reserves ratio | ${output.m2ReservesRatio !== null ? output.m2ReservesRatio.toFixed(1) + 'x' : 'n/a'} | KLR: watch >3x, critical >5x |`,
        `| External Debt | ${output.externalDebtBn !== null ? '$' + output.externalDebtBn.toFixed(0) + 'bn' : 'n/a'} | — |`,
        `| IHPR YoY % | ${output.ihprYoy !== null ? output.ihprYoy.toFixed(1) + '%' : 'n/a'} | <0% = collateral risk |`,
        `| Fintech NPL % | ${output.fintechNplPct !== null ? output.fintechNplPct.toFixed(1) + '%' : 'n/a'} | OJK IKNB; >5% = watch, 2-3Q bank lead |`,
        `| Fintech Outstanding | ${output.fintechOutstandingIdrT !== null ? 'Rp' + output.fintechOutstandingIdrT.toFixed(1) + 'T' : 'n/a'} | P2P + paylater combined (OJK IKNB) |`,
        `| Fintech Growth YoY | ${output.fintechGrowthYoyPct !== null ? output.fintechGrowthYoyPct.toFixed(1) + '%' : 'n/a'} | BNPL signal: ${output.bnplSignal.toUpperCase()} |`,
        `| Deposito Share | ${output.depositoSharePct !== null ? output.depositoSharePct.toFixed(1) + '%' : 'n/a'} | Hot money: norm <58%, >62% = elevated flight risk |`,
        ``,
        Object.keys(output.sectorNpl).length > 0
          ? `**Sector NPL:**\n${Object.entries(output.sectorNpl).map(([s, v]) => `- ${s}: ${v.toFixed(1)}%`).join('\n')}`
          : '_Sector NPL: n/a (OJK SPI session required)_',
        ``,
        output.flags.length > 0 ? `**Flags:**\n${output.flags.map(f => `- ${f}`).join('\n')}` : '**No active flags.**',
        ``,
        `_Data as of: ${output.dataDate} WIB. OJK SPI lag ~11mo (portal migration); IndONIA/ULN near-real-time. IHPR: BI SHPR quarterly._`,
        `_Frameworks: KLR EWS (Kaminsky-Reinhart EM calibration) | IMF FSAP sovereign-bank nexus (6yr SBN duration × 20% bank SBN/assets) | BI interest rate corridor (LF Rate = BI Rate + 75bps)._`,
      ];
      return formatToolResult(lines.join('\n'));
    } catch (e) {
      return formatToolResult(`Banking Stress Engine error: ${String(e)}`);
    }
  },
});
