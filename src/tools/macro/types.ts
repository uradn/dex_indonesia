export type AlertLevel = 'green' | 'yellow' | 'orange' | 'red';

export type MacroRegime = 'Q1' | 'Q2' | 'Q3' | 'Q4';
// Q1 = Growth↑ Inflation↓  (risk-on, goldilocks)
// Q2 = Growth↑ Inflation↑  (reflation)
// Q3 = Growth↓ Inflation↑  (stagflation — worst)
// Q4 = Growth↓ Inflation↓  (deflation / recession)

export interface MacroDataPoint {
  indicator: string;
  category: 'fx' | 'bop' | 'sovereign' | 'commodity' | 'flow' | 'regime' | 'banking' | 'pangan' | 'uln';
  date: string;          // ISO date YYYY-MM-DD
  value: number;
  unit: string;
  source: string;
  fetchedAt: string;
}

export interface IndicatorSnapshot {
  indicator: string;
  current: number;
  prev: number;         // prior period
  unit: string;
  source: string;
  date: string;
  roc: number;          // rate of change vs prior period (%)
  zScore30d?: number;
  zScore90d?: number;
  alertLevel: AlertLevel;
}

export interface ModuleScoreCard {
  module: string;
  scoreDate: string;
  score: number;        // 0-100 (100 = max stress)
  alertLevel: AlertLevel;
  indicators: IndicatorSnapshot[];
  narrative: string;    // 1-2 sentence summary
  flags: string[];      // specific anomalies detected
}

export interface BoPEngineOutput {
  scoreCard: ModuleScoreCard;
  tradeBalance: IndicatorSnapshot;
  fxReserves: IndicatorSnapshot;
  importGrowth: IndicatorSnapshot;
  currentAccount: IndicatorSnapshot | null;
  externalDebt: IndicatorSnapshot | null;
  bopStressScore: number;
  fxFragilityScore: number;
  externalFundingDependency: number;
  greenspanGuidotti: number | null;
  syntheticCadRisk: boolean;
}

// ─── Obstfeld (1994, 1996) Escape Clause ──────────────────────────────────────────
// Government loss function: L = (y*−y)² + λ(e−ē)²
// Defends peg while defense cost < escape clause threshold (political/credibility cost).
// Escape pressure = composite of 3 observable fiscal+monetary+FX signals.
// Sources: Obstfeld (1994) Cahiers 43:189 | Obstfeld (1996) EER 40(3-5):1037

export interface ObstfeldEscapeClause {
  regime: 'stable' | 'watch' | 'elevated' | 'critical';
  escapePressure: number;           // 0–100 composite escape pressure
  components: {
    fiscalSignal: number;           // 0–40: APBN deficit constrains rate-hike defense capacity
    srbiSignal: number;             // 0–30: BI quasi-fiscal sterilization drain
    idrDeviationSignal: number;     // 0–30: IDR deviation from APBN anchor (λ(e−ē)² proxy)
  };
  deficitPctGdp: number | null;
  srbiCostTrn: number | null;
  idrDevPct: number;
  scoreBump: number;                // 0–15 pts added to M3 score
  flags: string[];
}

export interface ConfidenceGateData {
  zone: 'safe' | 'vulnerable' | 'attack';
  defenseCostIndex: number;       // 0-100: cost to BI of defending peg
  abandonmentCostIndex: number;   // 0-100: cost to BI of abandoning peg
  netScore: number;               // DC - AC: negative=SAFE, near-zero=VULNERABLE, positive=ATTACK
  dcFactors: { rateHikeBurden: number; growthSacrifice: number; reserveRunway: number };
  acFactors: { ulnShock: number; inflationPassthrough: number; credibilityLoss: number };
}

export interface ShadowRateData {
  impliedUsdidr: number | null;        // projected USDIDR when defense capacity exhausted
  monthsToGgBreach: number | null;     // months until GG ratio hits 1.0 at current burn rate
  monthsToSrbiCeiling: number | null;  // months until SRBI hits stress ceiling (1,500T IDR)
  monthsToAttack: number | null;       // binding constraint = min(gg, srbi)
  depreciationAtAttack: number | null; // implied % IDR depreciation from current to attack point
}

export interface FxDefenseEngineOutput {
  scoreCard: ModuleScoreCard;
  usdIdr: IndicatorSnapshot;
  usdIdrVol30d: IndicatorSnapshot;
  fxReserves: IndicatorSnapshot;
  reserveBurnRate: number | null;
  dndfOutstandingBn: number | null;       // BI DNDF contingent liability (USD bn, off-balance-sheet)
  effectiveReserveBn: number | null;      // cadev − DNDF = true firing power
  srbiOutstanding: IndicatorSnapshot | null;
  srbiSterilizationRatio: number | null;  // SRBI outstanding / FX reserves in IDR — >0.5 = stretched
  srbiAuction: import('./sources/srbi-auction.js').SrbiAuctionData | null;
  biInterventionProxy: string;
  pseudoStabilityFlag: boolean;
  interventionSustainability: AlertLevel;
  shadowRate: ShadowRateData | null;
  confidenceGate: ConfidenceGateData | null;
  escapeClause: ObstfeldEscapeClause | null;
  policyResponseLevel: import('./sources/policy-response.js').PolicyResponseLevel | null;
  policyResponseSignals: import('./sources/policy-response.js').PolicyResponseSignal[];
}

export interface MacroDataSource {
  name: string;
  available(): boolean;
  fetchUsdIdr(days?: number): Promise<MacroDataPoint[]>;
  fetchFxReserves(): Promise<MacroDataPoint | null>;
  fetchTradeBalance(months?: number): Promise<MacroDataPoint[]>;
  fetchCurrentAccount(quarters?: number): Promise<MacroDataPoint[]>;
  fetchExternalDebt(): Promise<MacroDataPoint | null>;
  fetchSrbiOutstanding(): Promise<MacroDataPoint | null>;
  fetchSbnForeignOwnership(): Promise<MacroDataPoint | null>;
}
