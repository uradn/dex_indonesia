/**
 * ULN Engine — Module 13: Indonesia External Debt Stress
 *
 * Tracks Utang Luar Negeri (ULN) across 3 policy domains:
 *   Kemenkeu: government debt service vs APBN fiscal space
 *   BI:       FX reserve adequacy (Greenspan-Guidotti), macro-prudential compliance
 *   OJK:      private sector USD exposure → NPL lead indicator (2-3Q lag)
 *
 * Indicators stored in macro.db (cross-module readable):
 *   uln_total_bn           — total gross external debt (bn USD, quarterly via TE)
 *   uln_shortterm_pct      — short-term as % of total (%, annual WB)
 *   uln_dsr_pct            — debt service ratio % of exports (%, annual WB)
 *   uln_yoy_growth_pct     — YoY growth rate (%, derived)
 *   uln_gdp_ratio_pct      — ULN / GDP at current USDIDR (%, derived)
 *   greenspan_guidotti     — FX reserves / short-term ULN (ratio, derived)
 *   uln_hedging_compliance_pct — BI compliance rate (%, Playwright BI SULNI, optional)
 *
 * Cross-feeds (written to DB, read by other modules):
 *   → bop-engine:      greenspan_guidotti replaces CA/reserves proxy
 *   → fx-defense:      uln_hedging_compliance_pct → unhedged exposure flag
 *   → banking-engine:  uln_total_bn already read from DB (line 182)
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { upsertPoints, getLatestPoint, getLastN } from './time-series-db.js';
import { getFreshPoint, stalenessFlag } from './freshness.js';
import { alertFromScore, alertLabel } from './scoring.js';
import { fetchExternalDebtTe } from './sources/sovereign-scraper.js';
import { fetchUlnDsrWorldBank, fetchUlnShorttermPctWorldBank } from './sources/sovereign-scraper.js';
import { fetchHedgingComplianceBi } from './sources/bi.js';
import { fetchHedgingComplianceNews } from './sources/hedging-news.js';
import {
  fetchUlnDsrSulni,
  SULNI_DSR_TIER1_THRESHOLD_GREEN,
  SULNI_DSR_TIER1_THRESHOLD_YELLOW,
  SULNI_DSR_TIER1_THRESHOLD_ORANGE,
  SULNI_DSR_TIER1_THRESHOLD_RED,
} from './sources/sulni-dsr.js';
import type { AlertLevel, MacroDataPoint } from './types.js';

export const ULN_DESCRIPTION = `
MACRO INTELLIGENCE — ULN Engine (Module 13): Indonesia External Debt Stress

Tracks Indonesia's external debt (ULN) across 3 policy domains:
- Kemenkeu: government debt service vs APBN fiscal capacity
- BI: FX reserve adequacy (Greenspan-Guidotti ratio), macro-prudential hedging compliance
- OJK: private sector USD exposure → NPL leading indicator (2-3 quarter lag)

## When to Use

- "What is Indonesia's external debt?"
- "Is ULN sustainable?"
- "Greenspan-Guidotti ratio Indonesia"
- "Corporate hedging compliance check"
- "BI macro-prudential ULN risk"
- Quarterly after BI ULN press release

## Key Thresholds

- ULN/GDP:            GREEN <35% | YELLOW 35-40% | ORANGE 40-45% | RED >45%
- DSR:                GREEN <20% | YELLOW 20-25% | ORANGE 25-30% | RED >30%
- Greenspan-Guidotti: GREEN >2.0 | YELLOW 1.5-2.0 | ORANGE 1.0-1.5 | RED <1.0
- ULN YoY growth:     GREEN <6%  | YELLOW 6-10%   | ORANGE 10-15%  | RED >15%
- Hedging compliance: GREEN >85% | YELLOW 70-85%  | ORANGE 55-70%  | RED <55%

## 1997 Mechanism

Low hedging compliance + ULN growth > GDP growth + IDR weakening
  → Forced USD buying by unhedged corporates
  → Amplified IDR depreciation (negative feedback loop)
  → Balance sheet shock → NPL spike (2-3Q lag)
  → BI dilemma: hike (fiscal cost) or let IDR fall (more balance sheet stress)

## Data Sources

- Total ULN: Trading Economics scraper (Playwright, quarterly, source: Bank Indonesia)
- DSR + short-term %: World Bank API (annual, free, no Playwright)
- Hedging compliance: BI SULNI page (Playwright, quarterly, degrades gracefully)
`.trim();

// APBN 2026 macro constants for derived ratios
const GDP_IDR_TRN = 25_714.2;   // IDR trillion
// Lapsem Jun 2026 rate (Rp17,500) used for GDP USD conversion — not UU original 16,500.
// Using 16,500 overstates GDP_USD by ~6% → understates ULN/GDP stress.
// Source: Kemenkeu APBN KiTa Nov 2026, Hidayat Amir (Plt. DJA), Nov 13-14 2026.
const GDP_USD_BN_AT_LAPSEM = (GDP_IDR_TRN * 1e12) / (17_500 * 1e9); // ≈ 1,470 bn USD at Lapsem Rp17,500

const ULN_KPI_TTL_MS = 48 * 3_600_000; // 48h — ULN is quarterly, no need to re-scrape daily

// ─── Scoring functions ────────────────────────────────────────────────────────

function scoreUlnGdp(ratio: number): number {
  if (ratio < 27) return 0;
  if (ratio < 35) return Math.round((ratio - 27) / 8 * 25);
  if (ratio < 40) return Math.round(25 + (ratio - 35) / 5 * 25);
  if (ratio < 45) return Math.round(50 + (ratio - 40) / 5 * 25);
  return Math.min(100, Math.round(75 + (ratio - 45) / 5 * 25));
}

function scoreDsr(dsr: number): number {
  // World Bank basis (DT.TDS.DECT.EX.ZS): exports+GNI denominator. IMF stress threshold = 25%.
  if (dsr < 20) return 0;
  if (dsr < 25) return Math.round((dsr - 20) / 5 * 35);
  if (dsr < 30) return Math.round(35 + (dsr - 25) / 5 * 30);
  if (dsr < 35) return Math.round(65 + (dsr - 30) / 5 * 20);
  return Math.min(100, Math.round(85 + (dsr - 35) / 5 * 15));
}

function scoreDsrSulni(dsr: number): number {
  // SULNI Tier-1 Annualized basis (current account receipts): calibrated thresholds = WB / 1.27.
  // GREEN <14%, YELLOW 14-19.5%, ORANGE 19.5-23.6%, RED >23.6%
  if (dsr < SULNI_DSR_TIER1_THRESHOLD_GREEN) return 0;
  if (dsr < SULNI_DSR_TIER1_THRESHOLD_YELLOW) return Math.round(
    (dsr - SULNI_DSR_TIER1_THRESHOLD_GREEN) / (SULNI_DSR_TIER1_THRESHOLD_YELLOW - SULNI_DSR_TIER1_THRESHOLD_GREEN) * 35,
  );
  if (dsr < SULNI_DSR_TIER1_THRESHOLD_ORANGE) return Math.round(
    35 + (dsr - SULNI_DSR_TIER1_THRESHOLD_YELLOW) / (SULNI_DSR_TIER1_THRESHOLD_ORANGE - SULNI_DSR_TIER1_THRESHOLD_YELLOW) * 30,
  );
  if (dsr < SULNI_DSR_TIER1_THRESHOLD_RED) return Math.round(
    65 + (dsr - SULNI_DSR_TIER1_THRESHOLD_ORANGE) / (SULNI_DSR_TIER1_THRESHOLD_RED - SULNI_DSR_TIER1_THRESHOLD_ORANGE) * 20,
  );
  return Math.min(100, Math.round(85 + (dsr - SULNI_DSR_TIER1_THRESHOLD_RED) / 5 * 15));
}

function scoreGg(gg: number): number {
  if (gg >= 2.0) return 0;
  if (gg >= 1.5) return Math.round((2.0 - gg) / 0.5 * 25);
  if (gg >= 1.0) return Math.round(25 + (1.5 - gg) / 0.5 * 45);
  return Math.min(100, Math.round(70 + (1.0 - gg) / 0.5 * 30));
}

function scoreGrowth(yoy: number): number {
  if (yoy < 6) return 0;
  if (yoy < 10) return Math.round((yoy - 6) / 4 * 30);
  if (yoy < 15) return Math.round(30 + (yoy - 10) / 5 * 30);
  if (yoy < 20) return Math.round(60 + (yoy - 15) / 5 * 25);
  return Math.min(100, Math.round(85 + (yoy - 20) / 5 * 15));
}

/** Hedging compliance multiplier — unhedged exposure amplifies base ULN risk */
function hedgingAmplifier(compliance: number | null): number {
  if (compliance === null) return 1.10; // unknown → conservative default
  if (compliance >= 85) return 1.00;
  if (compliance >= 70) return 1.15;
  if (compliance >= 55) return 1.30;
  return 1.50; // <55% = 1997-style unhedged exposure risk
}

// ─── Engine ──────────────────────────────────────────────────────────────────

interface UlnEngineOutput {
  alert: AlertLevel;
  stressScore: number;
  ulnTotalBn: number | null;
  ulnGdpRatioPct: number | null;
  ulnShorttermPct: number | null;
  ulnDsrPct: number | null;        // World Bank basis (ULN_DSR_PCT env / WB API); threshold 25%
  ulnDsrTier1Pct: number | null;   // SULNI Tier-1 Annualized; threshold 19.5% (calibrated)
  dsrSource: 'sulni_tier1' | 'world_bank' | 'env_wb'; // which series drove DSR scoring
  dsrSlopePpPerYear: number | null; // annualized pp/year change; SOUL.md: slope is the risk, not level
  ulnYoyGrowthPct: number | null;
  greenspanGuidotti: number | null;
  hedgingCompliancePct: number | null;
  // R&R Ch.14-16 trajectory signal
  rg: number | null;
  rgLabel: 'stable' | 'knife_edge' | 'expanding' | 'explosive' | null;
  sbn10yPct: number | null;
  gdpGrowthPct: number | null;
  totalDebtGdpPct: number | null;
  primarySurplusRequiredPct: number | null;
  flags: string[];
  dataDate: string;
}

export async function runUlnEngine(): Promise<UlnEngineOutput> {
  const isFresh = (p: { fetchedAt: string } | null) =>
    p !== null && Date.now() - new Date(p.fetchedAt).getTime() < ULN_KPI_TTL_MS;

  // 1. ULN total: prefer indonesia_external_debt_bn written by banking-stress-engine
  // (both call fetchExternalDebtTe() — avoid double Playwright). Only fetch if stale.
  const cachedUln = await getLatestPoint('indonesia_external_debt_bn');
  if (!isFresh(cachedUln)) {
    const ulnPoint = await fetchExternalDebtTe().catch(() => null);
    if (ulnPoint) await upsertPoints([ulnPoint]);
  }

  // 2a. SULNI Tier-1 DSR — primary source (quarterly, calibrated threshold 19.5%).
  //   fetchUlnDsrSulni() handles its own cache (90d) + env override SULNI_DSR_TIER1_PCT.
  //   Runs in parallel with WB fetch below; result stored to DB as uln_dsr_tier1_ann_pct.
  //   On failure returns null → engine falls back to WB series (uln_dsr_pct).

  // 2b. World Bank annual indicators — env override wins (like BI_HEDGING_COMPLIANCE_PCT pattern).
  //   ULN_DSR_PCT default: 16.64 (WB 2025 — set when env unset and WB API stale).
  //   ULN_SHORTTERM_PCT: pin from BI SULNI quarterly press release.
  const dsrEnv = process.env.ULN_DSR_PCT;
  const stEnv  = process.env.ULN_SHORTTERM_PCT;
  const today  = new Date().toISOString().slice(0, 10);

  // Run SULNI fetch + WB fallback in parallel to minimize latency
  const [sulniDsrPoint] = await Promise.all([
    fetchUlnDsrSulni().catch(() => null),
    (async () => {
      if (dsrEnv) {
        const v = parseFloat(dsrEnv);
        if (!isNaN(v) && v >= 0 && v <= 100) {
          await upsertPoints([{ indicator: 'uln_dsr_pct', category: 'uln', date: today, value: v, unit: '%', source: 'env_manual', fetchedAt: new Date().toISOString() }]);
        }
      }
      if (stEnv) {
        const v = parseFloat(stEnv);
        if (!isNaN(v) && v >= 0 && v <= 100) {
          await upsertPoints([{ indicator: 'uln_shortterm_pct', category: 'uln', date: today, value: v, unit: '%', source: 'env_manual', fetchedAt: new Date().toISOString() }]);
        }
      }
      if (!dsrEnv || !stEnv) {
        const [cachedDsr, cachedSt] = await Promise.all([
          getLatestPoint('uln_dsr_pct'),
          getLatestPoint('uln_shortterm_pct'),
        ]);
        if (!isFresh(cachedDsr) || !isFresh(cachedSt)) {
          const [dsrPoint, stPoint] = await Promise.all([
            dsrEnv ? null : fetchUlnDsrWorldBank().catch(() => null),
            stEnv  ? null : fetchUlnShorttermPctWorldBank().catch(() => null),
          ]);
          const wbPoints = [dsrPoint, stPoint].filter((p): p is NonNullable<typeof p> => p !== null);
          if (wbPoints.length > 0) await upsertPoints(wbPoints);
        }
      }
    })(),
  ]);

  // 3. Hedging compliance — tier order: env override → BI SULNI Playwright → Exa/Tavily news.
  //    SULNI page often blocks Playwright in CI; news scrape catches the same number
  //    from Bisnis/Kontan/CNBC press recaps within ~1 week of BI quarterly release.
  //    Env override (BI_HEDGING_COMPLIANCE_PCT) lets user pin the value from the BI
  //    quarterly press release when auto-fetch fails — same pattern as BI_DNDF_OUTSTANDING_BN.
  let hedgingPoint: MacroDataPoint | null = null;
  const hedgingEnv = process.env.BI_HEDGING_COMPLIANCE_PCT;
  if (hedgingEnv) {
    const v = parseFloat(hedgingEnv);
    if (!isNaN(v) && v >= 0 && v <= 100) {
      hedgingPoint = {
        indicator: 'uln_hedging_compliance_pct', category: 'uln',
        date: new Date().toISOString().slice(0, 10),
        value: v, unit: '%',
        source: 'env_manual', fetchedAt: new Date().toISOString(),
      };
    }
  }
  if (!hedgingPoint) hedgingPoint = await fetchHedgingComplianceBi().catch(() => null);
  if (!hedgingPoint) hedgingPoint = await fetchHedgingComplianceNews().catch(() => null);
  if (hedgingPoint) await upsertPoints([hedgingPoint]);

  // 4. Retrieve from DB. Critical ULN inputs (DSR/total/ST%) gated by freshness —
  // RED-stale treated as missing so engine doesn't score against decade-old WB data.
  const [freshUln, freshDsr, freshSt, hedgingFromDb, fxReserves, sbn10yFromDb, gdpGrowthFromDb, debtGdpFromDb] = await Promise.all([
    getFreshPoint('indonesia_external_debt_bn', { treatStaleAsMissing: true }),
    getFreshPoint('uln_dsr_pct', { treatStaleAsMissing: true }),
    getFreshPoint('uln_shortterm_pct', { treatStaleAsMissing: true }),
    getLatestPoint('uln_hedging_compliance_pct'),
    getLatestPoint('bi_fx_reserves_bn'),
    getLatestPoint('sbn_10y_yield_pct'),
    getLatestPoint('gdp_growth_pct'),
    getLatestPoint('indonesia_debt_gdp_pct'),
  ]);
  const ulnPoint = freshUln.point;
  const dsrPoint = freshDsr.point;
  const stPoint = freshSt.point;

  // DSR slope: prefer SULNI Tier-1 history (quarterly, more current); fall back to WB
  const [dsrHistorySulni, dsrHistoryWb] = await Promise.all([
    getLastN('uln_dsr_tier1_ann_pct', 2),
    getLastN('uln_dsr_pct', 2),
  ]);
  const dsrHistory = dsrHistorySulni.length >= 2 ? dsrHistorySulni : dsrHistoryWb;
  let dsrSlopePpPerYear: number | null = null;
  if (dsrHistory.length === 2) {
    const days = (Date.parse(dsrHistory[0]!.date) - Date.parse(dsrHistory[1]!.date)) / 86_400_000;
    if (days > 0) {
      dsrSlopePpPerYear = parseFloat(((dsrHistory[0]!.value - dsrHistory[1]!.value) / days * 365).toFixed(2));
    }
  }

  // ULN time series for YoY growth (quarterly, ~2 years)
  const ulnHistory = await getLastN('indonesia_external_debt_bn', 8);

  const ulnTotal = ulnPoint?.value ?? null;
  const ulnDsrWb = dsrPoint?.value ?? null;   // World Bank basis (uln_dsr_pct); threshold 25%
  const ulnDsrT1 = sulniDsrPoint?.value ?? null; // SULNI Tier-1 (uln_dsr_tier1_ann_pct); threshold 19.5%
  const ulnSt = stPoint?.value ?? null;
  const hedging = hedgingPoint?.value ?? hedgingFromDb?.value ?? null;
  const reserves = fxReserves?.value ?? null;

  // 6. Derived metrics
  let ulnGdpRatio: number | null = null;
  if (ulnTotal !== null) {
    ulnGdpRatio = parseFloat(((ulnTotal / GDP_USD_BN_AT_LAPSEM) * 100).toFixed(1));
  }

  let greenspanGuidotti: number | null = null;
  if (ulnTotal !== null && ulnSt !== null && reserves !== null && ulnSt > 0) {
    const shortTermBn = ulnTotal * (ulnSt / 100);
    greenspanGuidotti = parseFloat((reserves / shortTermBn).toFixed(2));
  }

  let yoyGrowth: number | null = null;
  if (ulnHistory.length >= 5) {
    // Compare latest vs ~4 quarters ago
    const latest = ulnHistory[ulnHistory.length - 1]!.value;
    const yearAgo = ulnHistory[ulnHistory.length - 5]!.value;
    if (yearAgo > 0) {
      yoyGrowth = parseFloat((((latest - yearAgo) / yearAgo) * 100).toFixed(1));
    }
  }

  // 7. Persist derived points
  const derivedPoints = [];
  if (ulnGdpRatio !== null) {
    derivedPoints.push({
      indicator: 'uln_gdp_ratio_pct', category: 'uln' as const,
      date: ulnPoint!.date,
      value: ulnGdpRatio, unit: '%',
      source: 'derived', fetchedAt: new Date().toISOString(),
    });
  }
  if (greenspanGuidotti !== null) {
    derivedPoints.push({
      indicator: 'greenspan_guidotti', category: 'uln' as const,
      date: new Date().toISOString().slice(0, 10),
      value: greenspanGuidotti, unit: 'ratio',
      source: 'derived', fetchedAt: new Date().toISOString(),
    });
  }
  if (yoyGrowth !== null) {
    derivedPoints.push({
      indicator: 'uln_yoy_growth_pct', category: 'uln' as const,
      date: new Date().toISOString().slice(0, 10),
      value: yoyGrowth, unit: '%',
      source: 'derived', fetchedAt: new Date().toISOString(),
    });
  }
  if (derivedPoints.length > 0) await upsertPoints(derivedPoints);

  // 8. Composite score — dual-track DSR: SULNI Tier-1 preferred; WB fallback
  const subscores: Array<{ score: number; weight: number; label: string }> = [];
  // DSR: SULNI Tier-1 (threshold 19.5%) beats WB (threshold 25%) in freshness + precision
  let dsrScoreSource: 'sulni_tier1' | 'world_bank' | 'env_wb' = 'env_wb';
  const activeDsr = ulnDsrT1 ?? ulnDsrWb;
  if (activeDsr !== null) {
    const dsrScore = ulnDsrT1 !== null ? scoreDsrSulni(ulnDsrT1) : scoreDsr(ulnDsrWb!);
    dsrScoreSource = ulnDsrT1 !== null ? 'sulni_tier1' : (process.env.ULN_DSR_PCT ? 'env_wb' : 'world_bank');
    subscores.push({ score: dsrScore, weight: 0.25, label: `DSR (${dsrScoreSource})` });
  }
  if (ulnGdpRatio !== null) subscores.push({ score: scoreUlnGdp(ulnGdpRatio), weight: 0.30, label: 'ULN/GDP' });
  if (greenspanGuidotti !== null) subscores.push({ score: scoreGg(greenspanGuidotti), weight: 0.30, label: 'GG ratio' });
  if (yoyGrowth !== null)    subscores.push({ score: scoreGrowth(yoyGrowth),     weight: 0.15, label: 'YoY growth' });

  const totalWeight = subscores.reduce((s, x) => s + x.weight, 0);
  const baseScore = totalWeight > 0
    ? subscores.reduce((s, x) => s + x.score * x.weight, 0) / totalWeight
    : 50; // insufficient data → conservative mid

  const amplifier = hedgingAmplifier(hedging);
  const stressScore = Math.min(100, Math.round(baseScore * amplifier));
  const alert = alertFromScore(stressScore);

  // R&R Ch.14-16: r-g debt dynamics
  // r-g = r_nom − g_nom (CPI cancels: (r_nom−π) − (g_nom−π) = r_nom − g_nom)
  // Fallbacks: APBN 2026 assumptions if DB not yet populated by sovereign/regime engines
  const sbn10y = sbn10yFromDb?.value ?? 6.9;
  const gdpGrowth = gdpGrowthFromDb?.value ?? 5.4;
  const totalDebtGdp = debtGdpFromDb?.value ?? null;
  const rg = parseFloat((sbn10y - gdpGrowth).toFixed(2));
  const primarySurplusRequired = totalDebtGdp !== null
    ? parseFloat(((rg / 100) * totalDebtGdp).toFixed(2))
    : null;
  const rgLabel: 'stable' | 'knife_edge' | 'expanding' | 'explosive' =
    rg <= 0 ? 'stable' : rg <= 1.5 ? 'knife_edge' : rg <= 3.0 ? 'expanding' : 'explosive';

  // 9. Flags
  const flags: string[] = [];

  // Freshness gate: surface DSR/ULN-total/ST% staleness so users don't misread
  // GREEN as macro-current. Same pattern as M8 banking engine.
  for (const fp of [freshUln, freshDsr, freshSt] as const) {
    if ((fp.cls === 'red' || fp.cls === 'orange') && fp.spec && fp.ageDays != null) {
      flags.push(stalenessFlag(fp.spec.name, fp.ageDays, fp.spec, fp.cls));
    }
  }
  const ulnStaleCount = [freshUln, freshDsr, freshSt].filter(fp => fp.cls === 'red' || fp.cls === 'orange').length;
  if (ulnStaleCount >= 2) {
    flags.unshift(`LOW CONFIDENCE: ${ulnStaleCount}/3 critical ULN inputs ORANGE/RED-stale — alert level not representative of current external debt position`);
  }

  if (greenspanGuidotti !== null && greenspanGuidotti < 1.0) {
    flags.push(`GREENSPAN-GUIDOTTI BREACH: FX reserves ${reserves?.toFixed(0)}bn USD < short-term ULN ${(ulnTotal! * ulnSt! / 100).toFixed(0)}bn USD — rollover risk CRITICAL`);
  } else if (greenspanGuidotti !== null && greenspanGuidotti < 1.5) {
    flags.push(`GG RATIO WATCH: ${greenspanGuidotti.toFixed(2)} — buffer thinning toward Greenspan-Guidotti threshold (1.0)`);
  }

  if (dsrSlopePpPerYear !== null && dsrSlopePpPerYear > 5) {
    flags.push(`DSR SLOPE CRITICAL: +${dsrSlopePpPerYear.toFixed(1)}pp/yr — trajectory breaches threshold before next publication. Level may look safe; slope is the risk. [SOUL.md Persona V]`);
  } else if (dsrSlopePpPerYear !== null && dsrSlopePpPerYear > 3) {
    flags.push(`DSR SLOPE ELEVATED: +${dsrSlopePpPerYear.toFixed(1)}pp/yr — at this pace, threshold breach within 12–18 months`);
  }
  // DSR level flags — use whichever series is active, with appropriate threshold
  if (ulnDsrT1 !== null && ulnDsrT1 > SULNI_DSR_TIER1_THRESHOLD_ORANGE) {
    flags.push(`SULNI DSR TIER-1 ELEVATED: ${ulnDsrT1}% — above calibrated ORANGE threshold (${SULNI_DSR_TIER1_THRESHOLD_ORANGE}% = IMF 30%/1.27 adj). Current account receipts under pressure`);
  } else if (ulnDsrT1 !== null && ulnDsrT1 > SULNI_DSR_TIER1_THRESHOLD_YELLOW) {
    flags.push(`SULNI DSR TIER-1 WATCH: ${ulnDsrT1}% — approaching calibrated ORANGE (${SULNI_DSR_TIER1_THRESHOLD_ORANGE}%); WB-equivalent ~${(ulnDsrT1 * 1.27).toFixed(1)}%`);
  } else if (ulnDsrT1 === null && ulnDsrWb !== null && ulnDsrWb > 30) {
    flags.push(`DSR ELEVATED (WB basis): ${ulnDsrWb}% — above IMF stress threshold (25%), export earnings under debt service pressure`);
  }

  if (hedging !== null && hedging < 70) {
    const unhedgedEst = ulnTotal !== null
      ? `~${((ulnTotal * (1 - hedging / 100)) * 0.3).toFixed(0)}bn USD est. unhedged corporate exposure`
      : 'compliance critically low';
    flags.push(`HEDGING COMPLIANCE CRITICAL: ${hedging}% — ${unhedgedEst}. Forced USD buying risk if IDR weakens (1997 mechanism)`);
  } else if (hedging !== null && hedging < 85) {
    flags.push(`HEDGING COMPLIANCE SUB-OPTIMAL: ${hedging}% — below BI PBI 21/14/2019 comfort zone. IDR shock = amplified balance-sheet stress`);
  }

  if (yoyGrowth !== null && yoyGrowth > 10) {
    flags.push(`ULN GROWTH OUTPACING GDP: ${yoyGrowth.toFixed(1)}% YoY vs GDP ~5.4% — balance sheet leverage rising`);
  }

  if (ulnGdpRatio !== null && ulnGdpRatio > 35) {
    flags.push(`ULN/GDP ELEVATED: ${ulnGdpRatio}% — approaching YELLOW threshold (35%). Watch for sovereign rating pressure`);
  }

  if (rg > 1.0) {
    const surplusStr = primarySurplusRequired !== null
      ? ` — requires primary surplus ≥${primarySurplusRequired.toFixed(2)}% GDP to stabilize debt ratio`
      : '';
    flags.push(`R-G ADVERSE: r−g = +${rg.toFixed(2)}pp (SBN ${sbn10y.toFixed(2)}% − GDP ${gdpGrowth.toFixed(1)}%)${surplusStr}. Without primary surplus, debt/GDP expands mechanically [R&R Ch.14-16]`);
  }

  const dataDate = ulnPoint?.date ?? new Date().toISOString().slice(0, 10);

  return {
    alert, stressScore, ulnTotalBn: ulnTotal,
    ulnGdpRatioPct: ulnGdpRatio, ulnShorttermPct: ulnSt,
    ulnDsrPct: ulnDsrWb,         // World Bank basis — kept for backward compat / display
    ulnDsrTier1Pct: ulnDsrT1,   // SULNI Tier-1 Annualized (primary scoring source when available)
    dsrSource: dsrScoreSource,
    dsrSlopePpPerYear, ulnYoyGrowthPct: yoyGrowth,
    greenspanGuidotti, hedgingCompliancePct: hedging,
    rg, rgLabel, sbn10yPct: sbn10y, gdpGrowthPct: gdpGrowth,
    totalDebtGdpPct: totalDebtGdp, primarySurplusRequiredPct: primarySurplusRequired,
    flags, dataDate,
  };
}

function formatUlnOutput(o: UlnEngineOutput): string {
  const pct = (v: number | null, d = 1) => v !== null ? `${v.toFixed(d)}%` : 'N/A';
  const bn = (v: number | null) => v !== null ? `$${v.toFixed(0)}bn` : 'N/A';
  const ratio = (v: number | null) => v !== null ? v.toFixed(2) : 'N/A';

  const shortTermBn = o.ulnTotalBn !== null && o.ulnShorttermPct !== null
    ? (o.ulnTotalBn * o.ulnShorttermPct / 100).toFixed(0)
    : null;

  const lines: string[] = [
    `## ULN Engine — Module 13: Indonesia External Debt`,
    `**Data as of:** ${o.dataDate} | **Alert:** ${alertLabel(o.alert)} | **Stress Score:** ${o.stressScore}/100`,
    '',
    `| Indicator | Value | Threshold |`,
    `|-----------|-------|-----------|`,
    `| Total ULN | ${bn(o.ulnTotalBn)} | — |`,
    `| ULN/GDP | ${pct(o.ulnGdpRatioPct)} | YELLOW >35%, ORANGE >40%, RED >45% |`,
    `| Short-term ULN | ${o.ulnShorttermPct !== null && o.ulnTotalBn !== null ? `$${shortTermBn}bn (${pct(o.ulnShorttermPct, 0)} of total)` : 'N/A'} | — |`,
    `| Greenspan-Guidotti | ${ratio(o.greenspanGuidotti)} | ORANGE <1.5, RED <1.0 |`,
    `| DSR Tier-1 (SULNI) | ${o.ulnDsrTier1Pct !== null ? `${pct(o.ulnDsrTier1Pct)} ★` : 'N/A'} | calibrated: YELLOW >19.5%, ORANGE >23.6%, RED >27.6% |`,
    `| DSR (WB basis) | ${pct(o.ulnDsrPct)} | IMF stress >25%, ORANGE >30% |`,
    `| DSR scoring source | ${o.dsrSource === 'sulni_tier1' ? 'SULNI Tier-1 ★ (primary)' : o.dsrSource === 'world_bank' ? 'World Bank API' : 'env ULN_DSR_PCT'} | — |`,
    `| ULN YoY growth | ${pct(o.ulnYoyGrowthPct)} | YELLOW >6%, ORANGE >10%, RED >15% |`,
    `| Hedging compliance | ${pct(o.hedgingCompliancePct)} | YELLOW <85%, ORANGE <70%, RED <55% |`,
    '',
  ];

  // R-G Debt Dynamics section
  if (o.rg !== null) {
    const rgLabelStr = {
      stable: 'STABLE (r < g — debt/GDP self-corrects)',
      knife_edge: 'KNIFE-EDGE (r slightly > g — small primary surplus sufficient)',
      expanding: 'EXPANDING (r >> g — debt/GDP rising without significant surplus)',
      explosive: 'EXPLOSIVE (r >>> g — debt/GDP unsustainable without major adjustment)',
    }[o.rgLabel ?? 'knife_edge'];
    lines.push(`### R-G Debt Dynamics (R&R Ch.14–16)`);
    lines.push(`r−g = SBN 10Y ${o.sbn10yPct?.toFixed(2)}% − GDP growth ${o.gdpGrowthPct?.toFixed(1)}% = **${o.rg > 0 ? '+' : ''}${o.rg.toFixed(2)}pp** [${rgLabelStr}]`);
    if (o.totalDebtGdpPct !== null) {
      lines.push(`Debt/GDP: ${o.totalDebtGdpPct.toFixed(1)}% → Primary surplus needed to stabilize: **${o.primarySurplusRequiredPct !== null ? (o.primarySurplusRequiredPct > 0 ? '+' : '') + o.primarySurplusRequiredPct.toFixed(2) + '% GDP' : 'N/A'}**`);
    }
    lines.push('');
  }

  if (o.flags.length > 0) {
    lines.push(`### Flags`);
    o.flags.forEach((f) => lines.push(`- ${f}`));
    lines.push('');
  }

  // Cross-module nexus
  lines.push(`### Policy Nexus`);
  lines.push(`- **Kemenkeu**: ULN/GDP ${pct(o.ulnGdpRatioPct)} — govt debt service = APBN belanja bunga. IDR -10% → IDR-equivalent service rises proportionally`);
  lines.push(`- **BI**: GG ratio ${ratio(o.greenspanGuidotti)} — reserve adequacy vs rollover demand. Hedging compliance ${pct(o.hedgingCompliancePct)} → unhedged USD demand risk`);
  lines.push(`- **OJK/Banking**: Private ULN exposure → NPL lead indicator 2-3 quarter lag. Watch sector NPL (konstruksi, real estat, consumer)`);

  return lines.join('\n');
}

export const ulnEngine = new DynamicStructuredTool({
  name: 'uln_engine',
  description: ULN_DESCRIPTION,
  schema: z.object({
    query: z.string().describe('e.g. "ULN stress check" or "Greenspan-Guidotti ratio" or "corporate hedging compliance"'),
  }),
  func: async () => {
    try {
      const output = await runUlnEngine();
      return formatToolResult(formatUlnOutput(output));
    } catch (e) {
      return formatToolResult(`ULN Engine error: ${String(e)}`);
    }
  },
});
