export type AlertLevel = 'green' | 'yellow' | 'orange' | 'red';

export type MacroRegime = 'Q1' | 'Q2' | 'Q3' | 'Q4';
// Q1 = Growth↑ Inflation↓  (risk-on, goldilocks)
// Q2 = Growth↑ Inflation↑  (reflation)
// Q3 = Growth↓ Inflation↑  (stagflation — worst)
// Q4 = Growth↓ Inflation↓  (deflation / recession)

export interface MacroDataPoint {
  indicator: string;
  category: 'fx' | 'bop' | 'sovereign' | 'commodity' | 'flow' | 'regime';
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
  syntheticCadRisk: boolean;
}

export interface FxDefenseEngineOutput {
  scoreCard: ModuleScoreCard;
  usdIdr: IndicatorSnapshot;
  usdIdrVol30d: IndicatorSnapshot;
  fxReserves: IndicatorSnapshot;
  reserveBurnRate: number | null;     // months remaining at current pace
  srbiOutstanding: IndicatorSnapshot | null;
  biInterventionProxy: string;        // 'active' | 'passive' | 'unknown'
  pseudoStabilityFlag: boolean;
  interventionSustainability: AlertLevel;
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
