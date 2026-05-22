import type { AlertLevel } from '../types.js';

export interface CrisisEvent {
  id: string;
  name: string;
  startDate: string;     // ISO date — when stress became visible
  peakDate: string;      // ISO date — worst point
  endDate: string;       // ISO date — resolution/stabilization
  idrDepreciationPct: number;  // peak depreciation %
  description: string;
  rootCause: string;
  tags: string[];
}

export interface BacktestPoint {
  date: string;
  indicator: string;
  value: number;
  zScore30d: number | null;
  zScore90d: number | null;
  alertLevel: AlertLevel;
  rollingMean30d: number | null;
  rollingStd30d: number | null;
}

export interface ModuleSignalAtDate {
  date: string;
  moduleScores: Record<string, number>;
  alertLevels: Record<string, AlertLevel>;
  compositeScore: number;
  overallAlert: AlertLevel;
  stressedModuleCount: number;
}

export interface CrisisValidation {
  crisis: CrisisEvent;
  firstAlertDate: string | null;     // first YELLOW or above
  firstOrangeDate: string | null;    // first ORANGE or above
  firstRedDate: string | null;       // first RED
  leadTimeDaysYellow: number | null; // days before crisis start
  leadTimeDaysOrange: number | null;
  leadTimeDaysRed: number | null;
  peakScore: number;
  peakAlertLevel: AlertLevel;
  signalAtCrisisStart: AlertLevel;
  signalAtCrisisPeak: AlertLevel;
  caught: boolean;  // true if signal reached YELLOW before or at crisis start
}

export interface BacktestResult {
  runDate: string;
  dataRange: { start: string; end: string };
  indicatorsBacktested: string[];
  crisisValidations: CrisisValidation[];
  overallHitRate: number;       // % of crises caught with advance warning
  avgLeadTimeDays: number;      // avg days of advance warning
  falsePositiveRate: number;     // ORANGE+ signals outside crisis windows
  totalAlertDays: number;
  totalDays: number;
  summary: string;
}
