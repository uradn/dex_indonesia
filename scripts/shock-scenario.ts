/**
 * Indonesia Macro Shock Scenario Simulator
 * Fetches live baselines from all 13 modules, applies transmission formulas,
 * and outputs a Before vs After stress table per module.
 *
 * Usage:
 *   bun scripts/shock-scenario.ts [preset] [options]
 *   bun scripts/shock-scenario.ts --list
 *
 * Presets: mild | moderate | severe | crisis
 *          trump-tariff | em-selloff | oil-spike | idr-freefall | bank-crisis | bi-hike
 *
 * Options (override preset or build custom):
 *   --sbn <bps>       SBN 10Y delta in bps      (e.g. --sbn 100)
 *   --usdidr <abs>    USDIDR delta absolute      (e.g. --usdidr 3000)
 *   --reserves <bn>   FX reserves delta USD bn   (e.g. --reserves -40)
 *   --npl <pp>        NPL delta percentage pts   (e.g. --npl 3)
 *   --bi-rate <bps>   BI Rate delta in bps       (e.g. --bi-rate 50)
 *   --oil-pct <pct>   Oil % above APBN $70       (e.g. --oil-pct 43 → Brent $100)
 */

import { runFxDefenseEngine } from '../src/tools/macro/fx-defense-engine.js';
import { runBoPEngine } from '../src/tools/macro/bop-engine.js';
import { runSovereignRiskEngine } from '../src/tools/macro/sovereign-risk-engine.js';
import { runForeignFlowEngine } from '../src/tools/macro/foreign-flow-engine.js';
import { runCommodityEngine } from '../src/tools/macro/commodity-engine.js';
import { runRegimeEngine } from '../src/tools/macro/regime-engine.js';
import { runNarrativeDivergenceEngine } from '../src/tools/macro/narrative-divergence-engine.js';
import { runBankingStressEngine } from '../src/tools/macro/banking-stress-engine.js';
import { runMarketStressEngine } from '../src/tools/macro/market-stress-engine.js';
import { runFiscalEngine } from '../src/tools/macro/fiscal-engine.js';
import { runDomesticPressureEngine } from '../src/tools/macro/domestic-pressure-engine.js';
import { runPoliticalRiskEngine } from '../src/tools/macro/political-risk-engine.js';
import { runUlnEngine } from '../src/tools/macro/uln-engine.js';

const DATE = new Date().toISOString().slice(0, 10);
const BAR = '━'.repeat(64);

// ── Types ──────────────────────────────────────────────────────────────────

interface ShockParams {
  sbnBps: number;
  usdidr: number;
  reservesBn: number;
  nplPp: number;
  biRateBps: number;
  oilPct: number;
  label: string;
  description: string;
}

interface Baseline {
  usdidr: number;
  fxReserves: number;
  sbn10y: number;
  biRate: number;
  npl: number;
  impliedCarHitPp: number | null;
  m2UsdBn: number | null;
  sbnForeignPct: number | null;
  deficitPctGdp: number;
  regimeLabel: string;
  greenspanGuidotti: number | null;
  ulnDsrPct: number | null;
  hedgingCompliancePct: number | null;
}

// ── Preset Scenarios ───────────────────────────────────────────────────────

const PRESETS: Record<string, ShockParams> = {
  // Severity tiers (SKILL.md calibration)
  mild: {
    sbnBps: 50, usdidr: 1500, reservesBn: -20, nplPp: 1, biRateBps: 0, oilPct: 0,
    label: 'Mild Stress',
    description: 'Moderate IDR pressure + minor yield spike (e.g. EM jitter, single-event risk-off)',
  },
  moderate: {
    sbnBps: 100, usdidr: 3000, reservesBn: -40, nplPp: 3, biRateBps: 50, oilPct: 0,
    label: 'Moderate Stress',
    description: 'Significant sell-off + banking stress emerging (e.g. prolonged EM headwind)',
  },
  severe: {
    sbnBps: 150, usdidr: 5000, reservesBn: -60, nplPp: 5, biRateBps: 100, oilPct: 0,
    label: 'Severe Stress',
    description: 'Acute crisis conditions — doom loop risk live (e.g. sudden stop analog)',
  },
  crisis: {
    sbnBps: 250, usdidr: 8000, reservesBn: -80, nplPp: 8, biRateBps: 150, oilPct: 0,
    label: 'Full Crisis',
    description: 'Systemic crisis — 1997/2008 severity analog',
  },
  // Named compound scenarios
  'trump-tariff': {
    sbnBps: 75, usdidr: 3000, reservesBn: -20, nplPp: 0.5, biRateBps: 50, oilPct: 0,
    label: 'Trump Tariff Shock',
    description: 'US tariff escalation: export slowdown + EM risk-off + BI forced hike to defend IDR',
  },
  'em-selloff': {
    sbnBps: 100, usdidr: 2000, reservesBn: -15, nplPp: 0, biRateBps: 25, oilPct: 0,
    label: 'EM Sell-off',
    description: 'DXY spike + global risk-off: simultaneous capital outflow across all EM',
  },
  'oil-spike': {
    sbnBps: 25, usdidr: 1500, reservesBn: -5, nplPp: 0, biRateBps: 0, oilPct: 43,
    label: 'Oil Spike (Brent $100)',
    description: 'Brent to $100 (+43% vs APBN $70): subsidy surge + import bill pressure on APBN',
  },
  'idr-freefall': {
    sbnBps: 150, usdidr: 5000, reservesBn: -50, nplPp: 1, biRateBps: 75, oilPct: 0,
    label: 'IDR Free-Fall',
    description: 'Sudden stop: BI reserves drain + forced aggressive hike cycle to defend floor',
  },
  'bank-crisis': {
    sbnBps: 50, usdidr: 500, reservesBn: 0, nplPp: 5, biRateBps: 0, oilPct: 0,
    label: 'Banking Crisis',
    description: 'Credit cycle bust: NPL surge as overleveraged borrowers default',
  },
  'bi-hike': {
    // BI +100bps → SBN yield rises 0.7× = +70bps (pre-applied in sbnBps)
    sbnBps: 70, usdidr: -300, reservesBn: 3, nplPp: 0, biRateBps: 100, oilPct: 0,
    label: 'BI Rate Hike +100bps',
    description: 'BI hikes 100bps to defend IDR: SBN yield +70bps, IDR firms, banking margins squeezed',
  },
};

// ── Scoring Helpers ────────────────────────────────────────────────────────

function scoreNpl(npl: number): number {
  if (npl < 2) return 0;
  if (npl < 5) return Math.round((npl - 2) / 3 * 40);
  if (npl < 8) return Math.round(40 + (npl - 5) / 3 * 30);
  if (npl < 10) return Math.round(70 + (npl - 8) / 2 * 30);
  return 100;
}

function alertEmoji(score: number): string {
  if (score >= 70) return '🔴';
  if (score >= 50) return '🟠';
  if (score >= 33) return '🟡';
  return '🟢';
}

function alertName(score: number): string {
  if (score >= 70) return 'RED';
  if (score >= 50) return 'ORANGE';
  if (score >= 33) return 'YELLOW';
  return 'GREEN';
}

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

// ── Transmission Formulas ──────────────────────────────────────────────────

function fxDelta(shock: ShockParams, b: Baseline): number {
  let d = 0;
  if (shock.usdidr !== 0) {
    const deprPct = shock.usdidr / b.usdidr * 100;
    d += Math.round(20 * (deprPct / 10));
  }
  if (shock.reservesBn < 0) {
    const shockedR = b.fxReserves + shock.reservesBn;
    const cover = shockedR / 19;
    const baseCover = b.fxReserves / 19;
    const coverScore = cover < 3 ? 60 : cover < 4 ? 45 : cover < 6 ? 25 : 0;
    const baseCoverScore = baseCover < 3 ? 60 : baseCover < 4 ? 45 : baseCover < 6 ? 25 : 0;
    d += Math.max(0, coverScore - baseCoverScore);
  }
  if (shock.sbnBps > 100) d += 5; // risk-off FX correlation
  return d;
}

function sovereignDelta(shock: ShockParams, b: Baseline): number {
  let d = 0;
  const shockedSbn = b.sbn10y + shock.sbnBps / 100;
  if (shockedSbn > 7.0) {
    d += Math.round(15 * Math.max(0, (shockedSbn - 7.0) / 0.5));
  }
  // Term premium widening
  const shockedBi = b.biRate + shock.biRateBps / 100;
  const basePrem = b.sbn10y - b.biRate;
  const shockedPrem = shockedSbn - shockedBi;
  if (shockedPrem > 3.5 && basePrem <= 3.5) d += 20;
  else if (shockedPrem > 3.0 && basePrem <= 3.0) d += 10;
  // NPL → CDS proxy
  const shockedNpl = b.npl + shock.nplPp;
  if (shockedNpl > 5 && b.npl <= 5) d += 15;
  else if (shockedNpl > 3 && b.npl <= 3) d += 5;
  return d;
}

function foreignFlowDelta(shock: ShockParams, b: Baseline): number {
  let d = 0;
  const shockedSbn = b.sbn10y + shock.sbnBps / 100;
  if (shockedSbn > 7.5) {
    d += Math.round(10 * Math.max(0, (shockedSbn - 7.5) / 0.5));
  }
  const deprPct = shock.usdidr / b.usdidr * 100;
  if (deprPct > 15) d += 20;
  else if (deprPct > 10) d += 12;
  else if (deprPct > 5) d += 5;
  return d;
}

function bankingDelta(shock: ShockParams, b: Baseline): number {
  let d = 0;
  const SBN_BASELINE = 6.5;
  const shockedSbn = b.sbn10y + shock.sbnBps / 100;
  const shockedCarHit = Math.max(0, (shockedSbn - SBN_BASELINE) * 6 * 0.20);
  const baseCarHit = b.impliedCarHitPp ?? Math.max(0, (b.sbn10y - SBN_BASELINE) * 6 * 0.20);
  d += Math.min(15, Math.round(Math.max(0, shockedCarHit - baseCarHit) * 5));

  const deprPct = shock.usdidr / b.usdidr * 100;
  const fxNplUplift = (deprPct / 10) * 0.2;
  const totalNplShock = shock.nplPp + fxNplUplift;
  d += Math.max(0, scoreNpl(b.npl + totalNplShock) - scoreNpl(b.npl));

  if (b.m2UsdBn !== null && shock.reservesBn < 0) {
    const shockedR = Math.max(1, b.fxReserves + shock.reservesBn);
    const shockedRatio = b.m2UsdBn / shockedR;
    const baseRatio = b.m2UsdBn / b.fxReserves;
    if (shockedRatio > 7 && baseRatio <= 7) d += 20;
    else if (shockedRatio > 5 && baseRatio <= 5) d += 15;
    else if (shockedRatio > 3 && baseRatio <= 3) d += 5;
  }

  if (shock.biRateBps > 75) d += 8;
  else if (shock.biRateBps > 50) d += 4;
  return d;
}

function fiscalDelta(shock: ShockParams, b: Baseline): number {
  const baseDeficit = b.deficitPctGdp;
  let shocked = baseDeficit;
  // SBN yield: +100bps on ~Rp 1,000T annual issuance ≈ +0.039% GDP
  shocked += shock.sbnBps * 0.00039;
  // USDIDR: each 10% IDR depr ≈ +0.1% GDP fiscal drag
  const deprPct = shock.usdidr / b.usdidr * 100;
  shocked += (deprPct / 10) * 0.1;
  // Oil spike: each 10% ICP above APBN ≈ +0.15% GDP drag
  shocked += (shock.oilPct / 10) * 0.15;

  const scoreDeficit = (def: number): number => {
    if (def <= 2.68) return 0;
    if (def <= 3.0) return Math.round((def - 2.68) / 0.32 * 20);
    if (def <= 4.0) return Math.round(20 + (def - 3.0) / 1.0 * 40);
    return Math.min(100, Math.round(60 + (def - 4.0) / 1.0 * 40));
  };
  return Math.max(0, scoreDeficit(shocked) - scoreDeficit(baseDeficit));
}

// ── ULN Transmission ──────────────────────────────────────────────────────

function ulnDelta(shock: ShockParams, b: Baseline): number {
  let d = 0;
  const deprPct = shock.usdidr / b.usdidr * 100;

  // IDR depreciation → DSR worsens (USD debt service / IDR GDP: each 10% depr ≈ +0.5pp DSR)
  if (deprPct > 0 && b.ulnDsrPct !== null) {
    const shockedDsr = b.ulnDsrPct + (deprPct / 10) * 0.5;
    if (shockedDsr > 25 && b.ulnDsrPct <= 25) d += 20; // IMF threshold breach
    else if (shockedDsr > 22 && b.ulnDsrPct <= 22) d += 10;
  }

  // Reserve depletion → GG ratio deteriorates (FX reserves / short-term ULN)
  if (shock.reservesBn < 0 && b.greenspanGuidotti !== null && b.fxReserves > 0) {
    const ggFactor = (b.fxReserves + shock.reservesBn) / b.fxReserves;
    const shockedGg = b.greenspanGuidotti * ggFactor;
    if (shockedGg < 1.0 && b.greenspanGuidotti >= 1.0) d += 30; // CRITICAL: FX < short-term ULN
    else if (shockedGg < 1.5 && b.greenspanGuidotti >= 1.5) d += 15; // ORANGE threshold
  }

  // Low hedging compliance + large IDR depreciation = 1997 mechanism (forced USD buying loop)
  const lowHedging = b.hedgingCompliancePct !== null ? b.hedgingCompliancePct < 70 : false;
  if (deprPct > 10 && lowHedging) d += 12;

  return d;
}

// ── SCP Calculation ────────────────────────────────────────────────────────

// Weights match silent-crisis-detector.ts (sum = 1.00)
const MODULE_WEIGHTS: Record<string, number> = {
  fx_defense: 0.16, uln: 0.09, bop: 0.10, sovereign_risk: 0.09,
  foreign_flow: 0.09, banking: 0.08, commodity: 0.07, fiscal: 0.09,
  market: 0.05, domestic_pressure: 0.06, political_risk: 0.05,
  regime: 0.05, narrative: 0.02,
};

function computeScp(scores: Record<string, number>): number {
  let weightedSum = 0, totalWeight = 0;
  for (const [mod, score] of Object.entries(scores)) {
    const w = MODULE_WEIGHTS[mod] ?? 0.05;
    weightedSum += score * w;
    totalWeight += w;
  }
  let base = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const stressed = Object.values(scores).filter(s => s >= 50).length;
  if (stressed >= 5) base = Math.min(95, base * 1.4);
  else if (stressed >= 3) base = Math.min(95, base * 1.2);
  return Math.min(95, Math.round(base));
}

// ── Help ───────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log('\nIndonesia Macro Shock Scenario Simulator');
  console.log('Usage: bun scripts/shock-scenario.ts [preset] [options]\n');
  console.log('Presets:');
  for (const [name, p] of Object.entries(PRESETS)) {
    console.log(`  ${name.padEnd(15)} ${p.label}`);
    console.log(`                  ${p.description}`);
  }
  console.log('\nOptions (override preset or build custom):');
  console.log('  --sbn <bps>       SBN 10Y delta bps      (e.g. --sbn 100)');
  console.log('  --usdidr <abs>    USDIDR delta absolute   (e.g. --usdidr 3000)');
  console.log('  --reserves <bn>   FX reserves delta USD bn (e.g. --reserves -40)');
  console.log('  --npl <pp>        NPL delta pp            (e.g. --npl 3)');
  console.log('  --bi-rate <bps>   BI Rate delta bps       (e.g. --bi-rate 50)');
  console.log('  --oil-pct <pct>   Oil % above APBN $70   (e.g. --oil-pct 43)');
  console.log('\nExamples:');
  console.log('  bun scripts/shock-scenario.ts moderate');
  console.log('  bun scripts/shock-scenario.ts trump-tariff');
  console.log('  bun scripts/shock-scenario.ts --sbn 150 --usdidr 4000');
  console.log('  bun scripts/shock-scenario.ts em-selloff --npl 1\n');
}

// ── Main ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--list')) {
  printHelp();
  process.exit(0);
}

// Parse args
const shock: ShockParams = {
  sbnBps: 0, usdidr: 0, reservesBn: 0, nplPp: 0, biRateBps: 0, oilPct: 0,
  label: 'Custom Shock', description: '',
};

for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a in PRESETS) {
    Object.assign(shock, PRESETS[a]);
  } else if (a === '--sbn')      shock.sbnBps      = parseFloat(args[++i]!);
  else if (a === '--usdidr')     shock.usdidr      = parseFloat(args[++i]!);
  else if (a === '--reserves')   shock.reservesBn  = parseFloat(args[++i]!);
  else if (a === '--npl')        shock.nplPp       = parseFloat(args[++i]!);
  else if (a === '--bi-rate')    shock.biRateBps   = parseFloat(args[++i]!);
  else if (a === '--oil-pct')    shock.oilPct      = parseFloat(args[++i]!);
}

if (!shock.description) {
  const parts: string[] = [];
  if (shock.sbnBps)     parts.push(`SBN ${shock.sbnBps > 0 ? '+' : ''}${shock.sbnBps}bps`);
  if (shock.usdidr)     parts.push(`USDIDR ${shock.usdidr > 0 ? '+' : ''}${shock.usdidr.toLocaleString()}`);
  if (shock.reservesBn) parts.push(`Reserves ${shock.reservesBn > 0 ? '+' : ''}$${shock.reservesBn}bn`);
  if (shock.nplPp)      parts.push(`NPL +${shock.nplPp}pp`);
  if (shock.biRateBps)  parts.push(`BI Rate ${shock.biRateBps > 0 ? '+' : ''}${shock.biRateBps}bps`);
  if (shock.oilPct)     parts.push(`Oil +${shock.oilPct.toFixed(0)}% vs APBN`);
  shock.description = parts.join(', ') || 'no shock parameters set';
}

console.log(`\n# Shock Scenario: ${shock.label}`);
console.log('Fetching live baselines from all 13 modules...\n');

// Fetch all 13 modules in parallel
const [fx, bop, sov, flow, commodity, regime, narrative, banking, market, fiscal, domestic, political, ulnRes] =
  await Promise.allSettled([
    runFxDefenseEngine(),
    runBoPEngine(),
    runSovereignRiskEngine(),
    runForeignFlowEngine(),
    runCommodityEngine(),
    runRegimeEngine(),
    runNarrativeDivergenceEngine(),
    runBankingStressEngine(),
    runMarketStressEngine(),
    runFiscalEngine(),
    runDomesticPressureEngine(),
    runPoliticalRiskEngine(),
    runUlnEngine(),
  ]);

// Extract baseline values (fall back to session-current defaults if engine fails)
const b: Baseline = {
  usdidr: 17_879, fxReserves: 151.9, sbn10y: 6.71, biRate: 5.25,
  npl: 1.96, impliedCarHitPp: null, m2UsdBn: null,
  sbnForeignPct: 12.68, deficitPctGdp: 2.68, regimeLabel: 'Q1',
  greenspanGuidotti: 2.27, ulnDsrPct: 24.69, hedgingCompliancePct: null,
};

if (fx.status === 'fulfilled') {
  b.usdidr    = fx.value.usdIdr?.current    ?? b.usdidr;
  b.fxReserves = fx.value.fxReserves?.current ?? b.fxReserves;
}
if (sov.status === 'fulfilled') {
  b.sbn10y = sov.value.sbn10y?.current ?? b.sbn10y;
}
if (banking.status === 'fulfilled') {
  const bk = banking.value;
  b.npl           = bk.nplPct          ?? b.npl;
  b.biRate        = bk.biRatePct       ?? b.biRate;
  b.impliedCarHitPp = bk.impliedCarHitPp;
  b.fxReserves    = bk.fxReservesBn    ?? b.fxReserves;
  if (bk.m2ReservesRatio !== null && b.fxReserves > 0) {
    b.m2UsdBn = bk.m2ReservesRatio * b.fxReserves;
  }
}
if (flow.status === 'fulfilled') {
  b.sbnForeignPct = flow.value.sbnForeignOwnership?.current ?? b.sbnForeignPct;
}
if (fiscal.status === 'fulfilled') {
  b.deficitPctGdp = fiscal.value.projectedDeficitPctGdp ?? b.deficitPctGdp;
}
if (regime.status === 'fulfilled') {
  b.regimeLabel = regime.value.regimeLabel; // already includes Q-label prefix
}
if (ulnRes.status === 'fulfilled') {
  b.greenspanGuidotti   = ulnRes.value.greenspanGuidotti   ?? b.greenspanGuidotti;
  b.ulnDsrPct           = ulnRes.value.ulnDsrPct           ?? b.ulnDsrPct;
  b.hedgingCompliancePct = ulnRes.value.hedgingCompliancePct ?? b.hedgingCompliancePct;
}

// Derived shocked values for display
const shockedUsdidr   = b.usdidr + shock.usdidr;
const shockedSbn      = b.sbn10y + shock.sbnBps / 100;
const shockedReserves = b.fxReserves + shock.reservesBn;
const shockedBiRate   = b.biRate + shock.biRateBps / 100;
const shockedNpl      = b.npl + shock.nplPp + (shock.usdidr / b.usdidr * 100 / 10 * 0.2);
const deprPct         = shock.usdidr / b.usdidr * 100;
const shockedDeficit  = b.deficitPctGdp
  + shock.sbnBps * 0.00039
  + (deprPct / 10) * 0.1
  + (shock.oilPct / 10) * 0.15;

// Baseline scores from engines
const scoresBefore: Record<string, number> = {
  fx_defense:       fx.status        === 'fulfilled' ? fx.value.scoreCard.score            : 20,
  uln:              ulnRes.status    === 'fulfilled' ? ulnRes.value.stressScore             : 12,
  bop:              bop.status       === 'fulfilled' ? bop.value.scoreCard.score            : 20,
  sovereign_risk:   sov.status       === 'fulfilled' ? sov.value.sovereignRiskScore         : 20,
  foreign_flow:     flow.status      === 'fulfilled' ? flow.value.scoreCard.score           : 20,
  commodity:        commodity.status === 'fulfilled' ? commodity.value.scoreCard.score      : 20,
  banking:          banking.status   === 'fulfilled' ? banking.value.stressScore            : 20,
  market:           market.status    === 'fulfilled' ? market.value.stressScore             : 20,
  fiscal:           fiscal.status    === 'fulfilled' ? fiscal.value.stressScore             : 20,
  domestic_pressure: domestic.status === 'fulfilled' ? domestic.value.stressScore           : 20,
  political_risk:   political.status === 'fulfilled' ? political.value.stressScore          : 20,
  narrative:        narrative.status === 'fulfilled' ? (100 - narrative.value.narrativeCredibilityScore) : 30,
  regime:           regime.status    === 'fulfilled'
    ? (['Q3'].includes(regime.value.currentRegime) ? 65 : ['Q4'].includes(regime.value.currentRegime) ? 50 : ['Q2'].includes(regime.value.currentRegime) ? 35 : 15)
    : 20,
};

// Apply transmission deltas
const scoresAfter: Record<string, number> = { ...scoresBefore };
scoresAfter.fx_defense    = clamp(scoresBefore.fx_defense    + fxDelta(shock, b));
scoresAfter.uln           = clamp(scoresBefore.uln           + ulnDelta(shock, b));
scoresAfter.sovereign_risk = clamp(scoresBefore.sovereign_risk + sovereignDelta(shock, b));
scoresAfter.foreign_flow  = clamp(scoresBefore.foreign_flow  + foreignFlowDelta(shock, b));
scoresAfter.banking       = clamp(scoresBefore.banking       + bankingDelta(shock, b));
scoresAfter.fiscal        = clamp(scoresBefore.fiscal        + fiscalDelta(shock, b));
// Regime shift signal
if (deprPct > 15 || shock.biRateBps > 100) {
  scoresAfter.regime = Math.max(scoresAfter.regime, 65);
} else if (deprPct > 10 || shock.biRateBps > 75) {
  scoresAfter.regime = Math.max(scoresAfter.regime, 50);
}

// ── Output ─────────────────────────────────────────────────────────────────

console.log(BAR);
console.log(`## Shock Scenario: ${shock.label}`);
console.log(`**As of:** ${DATE}  |  **Baseline regime:** ${b.regimeLabel}`);
console.log(shock.description);
console.log(BAR);

// Shock parameters table
console.log('\n### Shock Parameters\n');
console.log('| Parameter    | Baseline          | Shocked           | Delta         |');
console.log('|--------------|-------------------|-------------------|---------------|');
if (shock.sbnBps !== 0)
  console.log(`| SBN 10Y      | ${b.sbn10y.toFixed(3)}%           | ${shockedSbn.toFixed(3)}%           | ${shock.sbnBps > 0 ? '+' : ''}${shock.sbnBps}bps         |`);
if (shock.usdidr !== 0)
  console.log(`| USDIDR       | ${b.usdidr.toLocaleString()}              | ${shockedUsdidr.toLocaleString()}              | ${shock.usdidr > 0 ? '+' : ''}${shock.usdidr.toLocaleString()}          |`);
if (shock.reservesBn !== 0)
  console.log(`| FX Reserves  | $${b.fxReserves.toFixed(1)}bn          | $${shockedReserves.toFixed(1)}bn          | ${shock.reservesBn > 0 ? '+' : ''}$${shock.reservesBn}bn       |`);
if (shock.nplPp !== 0)
  console.log(`| NPL Gross    | ${b.npl.toFixed(2)}%              | ${(b.npl + shock.nplPp).toFixed(2)}%              | +${shock.nplPp}pp             |`);
if (shock.biRateBps !== 0)
  console.log(`| BI Rate      | ${b.biRate.toFixed(2)}%             | ${shockedBiRate.toFixed(2)}%             | ${shock.biRateBps > 0 ? '+' : ''}${shock.biRateBps}bps         |`);
if (shock.oilPct !== 0) {
  const brentShocked = 70 * (1 + shock.oilPct / 100);
  console.log(`| Brent (ICP)  | $70/bbl (APBN)    | $${brentShocked.toFixed(0)}/bbl            | +${shock.oilPct.toFixed(0)}% vs APBN     |`);
}

// Module impact table
const LABELS: Record<string, string> = {
  fx_defense: 'FX Defense', uln: 'ULN / Ext Debt', bop: 'BoP', sovereign_risk: 'Sovereign Risk',
  foreign_flow: 'Foreign Flow', commodity: 'Commodity', banking: 'Banking Stress',
  market: 'Market (IHSG)', fiscal: 'Fiscal', domestic_pressure: 'Domestic',
  political_risk: 'Political Risk', regime: 'Regime', narrative: 'Narrative',
};

const AFFECTED = new Set(['fx_defense', 'uln', 'sovereign_risk', 'foreign_flow', 'banking', 'fiscal', 'regime']);

console.log('\n### Module Impact — Before vs After\n');
console.log('| Module           | Score Before        | Score After         | Alert Δ            | Key Driver                         |');
console.log('|------------------|---------------------|---------------------|--------------------|-------------------------------------|');

const allMods = Object.keys(scoresBefore);
for (const mod of allMods) {
  const sb = scoresBefore[mod]!;
  const sa = scoresAfter[mod]!;
  const diff = sa - sb;
  const label = (LABELS[mod] ?? mod).padEnd(16);
  const beforeCell = `${String(sb).padStart(3)} ${alertEmoji(sb)} ${alertName(sb).padEnd(6)}`;
  const afterCell  = `${String(sa).padStart(3)} ${alertEmoji(sa)} ${alertName(sa).padEnd(6)}`;

  if (!AFFECTED.has(mod) || diff === 0) {
    console.log(`| ${label} | ${beforeCell} | — (unchanged)       | —                  | —                                   |`);
    continue;
  }

  const alertChange = alertName(sb) === alertName(sa)
    ? alertName(sa).padEnd(18)
    : `${alertName(sb)}→${alertName(sa)}`.padEnd(18);

  let driver = '—';
  switch (mod) {
    case 'uln': {
      const deprPct2 = shock.usdidr / b.usdidr * 100;
      const p: string[] = [];
      if (b.ulnDsrPct !== null) {
        const shockedDsr = b.ulnDsrPct + (deprPct2 / 10) * 0.5;
        p.push(`DSR ${b.ulnDsrPct.toFixed(1)}%→${shockedDsr.toFixed(1)}%`);
      }
      if (b.greenspanGuidotti !== null && shock.reservesBn < 0) {
        const ggF = (b.fxReserves + shock.reservesBn) / b.fxReserves;
        p.push(`GG ${b.greenspanGuidotti.toFixed(2)}→${(b.greenspanGuidotti * ggF).toFixed(2)}`);
      }
      driver = p.join(', ');
      break;
    }
    case 'fx_defense': {
      const p: string[] = [];
      if (shock.usdidr) p.push(`IDR ${deprPct > 0 ? '−' : '+'}${Math.abs(deprPct).toFixed(1)}%`);
      if (shock.reservesBn) p.push(`reserves $${shockedReserves.toFixed(0)}bn (${(shockedReserves / 19).toFixed(1)}mo)`);
      driver = p.join(', ');
      break;
    }
    case 'sovereign_risk': {
      const p: string[] = [];
      if (shock.sbnBps) p.push(`SBN ${shockedSbn.toFixed(2)}%`);
      if (shockedNpl > 3) p.push(`NPL ${shockedNpl.toFixed(2)}% → CDS`);
      driver = p.join(', ');
      break;
    }
    case 'foreign_flow': {
      const p: string[] = [];
      if (shockedSbn > 7.5) p.push(`SBN ${shockedSbn.toFixed(2)}% > 7.5% exit risk`);
      if (deprPct > 5) p.push(`IDR outflow`);
      driver = p.join(', ');
      break;
    }
    case 'banking': {
      const carHit = Math.max(0, (shockedSbn - 6.5) * 6 * 0.20);
      const p: string[] = [];
      if (shock.sbnBps) p.push(`CAR hit ${carHit.toFixed(2)}pp`);
      if (shock.nplPp || shock.usdidr) p.push(`NPL ${shockedNpl.toFixed(2)}%`);
      driver = p.join(', ');
      break;
    }
    case 'fiscal':
      driver = `deficit ~${shockedDeficit.toFixed(2)}% GDP`;
      break;
    case 'regime':
      driver = deprPct > 15 ? 'Q3 stagflation — forced hike' : 'growth deceleration';
      break;
  }

  console.log(`| ${label} | ${beforeCell} | ${afterCell} | ${alertChange} | ${driver.slice(0, 35).padEnd(35)} |`);
}

// Transmission chain
console.log('\n### Transmission Chain\n');
{
  const lines: string[] = [];
  const primary: string[] = [];
  if (shock.sbnBps)     primary.push(`SBN 10Y rises ${shock.sbnBps}bps to ${shockedSbn.toFixed(2)}%`);
  if (shock.usdidr)     primary.push(`IDR ${deprPct > 0 ? 'depreciates' : 'appreciates'} ${Math.abs(deprPct).toFixed(1)}% to ${shockedUsdidr.toLocaleString()}`);
  if (shock.reservesBn) primary.push(`FX reserves ${shock.reservesBn < 0 ? 'fall' : 'rise'} $${Math.abs(shock.reservesBn)}bn to $${shockedReserves.toFixed(1)}bn (${(shockedReserves / 19).toFixed(1)} months cover)`);
  if (shock.nplPp)      primary.push(`NPL surges +${shock.nplPp}pp to ${(b.npl + shock.nplPp).toFixed(2)}%`);
  if (shock.biRateBps)  primary.push(`BI Rate ${shock.biRateBps > 0 ? 'hikes' : 'cuts'} ${Math.abs(shock.biRateBps)}bps to ${shockedBiRate.toFixed(2)}%`);
  if (shock.oilPct > 0) primary.push(`Brent surges ${shock.oilPct.toFixed(0)}% above APBN $70 assumption`);
  if (primary.length) lines.push(primary.join('; ') + '.');

  const carHit = Math.max(0, (shockedSbn - 6.5) * 6 * 0.20);
  if (shockedSbn > 7.0) {
    const doomLoop = carHit >= 1.5 ? ' — DOOM LOOP TERRITORY (>1.5pp threshold)' : '';
    lines.push(`SBN yield above 7.0% activates FSAP sovereign-bank nexus: implied CAR erosion ${carHit.toFixed(2)}pp${doomLoop}.`);
  }
  if (shockedDeficit > 3.0) {
    lines.push(`Fiscal deficit projects to ${shockedDeficit.toFixed(2)}% GDP — above 3% constitutional ceiling; additional SBN issuance needed, amplifying yield pressure.`);
  }
  if (b.sbnForeignPct !== null && shockedSbn > 7.5) {
    const buf = b.sbnForeignPct - 10;
    lines.push(`SBN foreign ownership ${b.sbnForeignPct.toFixed(1)}% — ${buf.toFixed(1)}pp buffer before 10% sudden stop threshold; yield spike above 7.5% accelerates EM index-driven exit.`);
  }
  if (deprPct > 15 || shock.biRateBps > 100) {
    lines.push(`Sharp IDR depreciation (${deprPct.toFixed(1)}%) combined with forced BI tightening risks Q3 stagflation regime — growth contraction + sustained inflation + sovereign premium expansion.`);
  }
  // ULN / Greenspan-Guidotti transmission
  if (b.greenspanGuidotti !== null && shock.reservesBn < 0) {
    const ggFactor = (b.fxReserves + shock.reservesBn) / b.fxReserves;
    const shockedGg = b.greenspanGuidotti * ggFactor;
    if (shockedGg < 1.5) {
      const ggSeverity = shockedGg < 1.0
        ? `CRITICAL — FX reserves no longer cover short-term ULN rollover demand; forced USD buying loop risk`
        : `ORANGE — reserve adequacy buffer thinning toward Greenspan-Guidotti threshold (1.0)`;
      lines.push(`GG ratio deteriorates ${b.greenspanGuidotti.toFixed(2)} → ${shockedGg.toFixed(2)}: ${ggSeverity}.`);
    }
  }
  if (b.ulnDsrPct !== null && deprPct > 5) {
    const shockedDsr = b.ulnDsrPct + (deprPct / 10) * 0.5;
    if (shockedDsr > 25) {
      lines.push(`IDR depreciation pushes DSR ${b.ulnDsrPct.toFixed(2)}% → ~${shockedDsr.toFixed(2)}% — breaches IMF 25% threshold; debt service crowding risk on APBN fiscal space.`);
    }
  }
  const lowHedging = b.hedgingCompliancePct !== null ? b.hedgingCompliancePct < 70 : false;
  if (deprPct > 10 && lowHedging) {
    lines.push(`Low ULN hedging compliance (${b.hedgingCompliancePct?.toFixed(1)}%) + IDR depreciation ${deprPct.toFixed(1)}% activates 1997 transmission mechanism: unhedged corporate USD demand amplifies IDR depreciation loop.`);
  }
  for (const l of lines) console.log(l);
}

// Silent Crisis Probability
const scpBefore = computeScp(scoresBefore);
const scpAfter  = computeScp(scoresAfter);
const stressedMods = Object.entries(scoresAfter)
  .filter(([, s]) => s >= 50)
  .map(([m]) => LABELS[m] ?? m);

console.log('\n### Silent Crisis Probability\n');
console.log(`- **Before:** ${scpBefore}%  ${alertEmoji(scpBefore)} ${alertName(scpBefore)}`);
console.log(`- **After shock:** ${scpAfter}%  ${alertEmoji(scpAfter)} ${alertName(scpAfter)}`);
if (stressedMods.length > 0)
  console.log(`- **Stressed modules (≥50):** ${stressedMods.join(', ')}`);
else
  console.log('- **Stressed modules (≥50):** none');

// Critical thresholds
console.log('\n### Critical Thresholds to Watch\n');
{
  const triples: string[] = [];
  if (shockedSbn > 7.0 && shockedSbn < 8.0)
    triples.push(`SBN 10Y at 8.0%: implied CAR hit ${((8.0 - 6.5) * 6 * 0.20).toFixed(2)}pp → doom loop entry (currently shocked to ${shockedSbn.toFixed(2)}%).`);
  if (shockedReserves > 60 && shockedReserves < 115)
    triples.push(`FX reserves at $76bn: import cover 4 months (ORANGE) → BI balance sheet at risk (currently $${shockedReserves.toFixed(1)}bn = ${(shockedReserves / 19).toFixed(1)}mo).`);
  if (shockedNpl > 2 && shockedNpl < 6)
    triples.push(`NPL at 5.0%: KLR acute signal + CDS +30-50bps expected (currently shocked to ${shockedNpl.toFixed(2)}%).`);
  if (shockedDeficit > 2.5 && shockedDeficit < 5.0)
    triples.push(`Fiscal deficit at 4.0% GDP: constitutional ceiling breach → rating watch (currently ${shockedDeficit.toFixed(2)}%).`);
  if (b.greenspanGuidotti !== null && shock.reservesBn < 0) {
    const ggF = (b.fxReserves + shock.reservesBn) / b.fxReserves;
    const sGg = b.greenspanGuidotti * ggF;
    if (sGg > 1.0 && sGg < 2.0)
      triples.push(`GG ratio at 1.0: FX reserves = short-term ULN — forced USD buying loop entry (currently shocked to ${sGg.toFixed(2)}).`);
  }
  if (b.ulnDsrPct !== null && shock.usdidr > 0) {
    const sDepr = shock.usdidr / b.usdidr * 100;
    const sDsr = b.ulnDsrPct + (sDepr / 10) * 0.5;
    if (sDsr > 23 && sDsr < 30)
      triples.push(`DSR at 25% IMF threshold: debt service crowding APBN fiscal space (currently shocked to ${sDsr.toFixed(2)}%).`);
  }
  if (triples.length === 0)
    triples.push('No immediate critical thresholds breached in this scenario.');
  for (const t of triples) console.log(`- ${t}`);
}

// Caveats
console.log('\n### Caveats\n');
console.log('- Transmission formulas calibrated to Indonesia historical episodes; speed may differ');
console.log('- Compound shocks are non-linear; this model applies linear approximations per channel');
console.log('- BoP, Commodity, Market, Domestic, Political, Narrative modules held at baseline');
console.log('- SCP amplification: ×1.2 if ≥3 stressed modules, ×1.4 if ≥5');
if (b.m2UsdBn === null)
  console.log('- M2/reserves ratio unavailable — M2 data missing from DB (run seed or wait for WB fetch)');
console.log(`\n${BAR}\n`);
