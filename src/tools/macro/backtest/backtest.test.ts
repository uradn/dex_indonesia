import { describe, expect, test } from 'bun:test';
import { daysBetween, isInCrisisWindow, INDONESIA_CRISIS_CALENDAR } from './crisis-calendar.js';
import { replayIndicator, computeSignals } from './replay-engine.js';
import { validateCrisis, computeFalsePositiveRate } from './signal-validator.js';
import type { DailyBar } from './historical-loader.js';
import type { CrisisEvent, ModuleSignalAtDate } from './types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeBars(values: number[], startDate = '2020-01-01'): DailyBar[] {
  return values.map((close, i) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    return { date: d.toISOString().slice(0, 10), close };
  });
}

function makeSignal(date: string, score: number): ModuleSignalAtDate {
  const overallAlert =
    score >= 75 ? 'red' : score >= 55 ? 'orange' : score >= 35 ? 'yellow' : 'green';
  return {
    date,
    moduleScores: { fx_defense: score, commodity: 0, foreign_flow: 0, global_stress: 0 },
    alertLevels:  { fx_defense: overallAlert, commodity: 'green', foreign_flow: 'green' },
    compositeScore: score,
    overallAlert,
    stressedModuleCount: overallAlert === 'orange' || overallAlert === 'red' ? 1 : 0,
  };
}

const MOCK_CRISIS: CrisisEvent = {
  id: 'test_crisis',
  name: 'Test Crisis',
  startDate:  '2021-06-01',
  peakDate:   '2021-08-01',
  endDate:    '2021-10-01',
  idrDepreciationPct: 10,
  description: 'Test',
  rootCause: 'Test',
  tags: [],
};

// ─── crisis-calendar ─────────────────────────────────────────────────────────

describe('daysBetween', () => {
  test('same date = 0', () => {
    expect(daysBetween('2021-01-01', '2021-01-01')).toBe(0);
  });
  test('positive when b > a', () => {
    expect(daysBetween('2021-01-01', '2021-01-31')).toBe(30);
  });
  test('negative when b < a', () => {
    expect(daysBetween('2021-01-31', '2021-01-01')).toBe(-30);
  });
});

describe('isInCrisisWindow', () => {
  const crisis = MOCK_CRISIS;

  test('date within start→end = true', () => {
    expect(isInCrisisWindow('2021-07-01', crisis, 0)).toBe(true);
  });
  test('date before start outside buffer = false', () => {
    expect(isInCrisisWindow('2021-01-01', crisis, 0)).toBe(false);
  });
  test('date before start within buffer = true', () => {
    expect(isInCrisisWindow('2021-04-02', crisis, 60)).toBe(true);  // 60d before Jun 1
  });
  test('date after end = false', () => {
    expect(isInCrisisWindow('2021-11-01', crisis, 0)).toBe(false);
  });
});

describe('INDONESIA_CRISIS_CALENDAR', () => {
  test('has 6 crises', () => {
    expect(INDONESIA_CRISIS_CALENDAR).toHaveLength(6);
  });
  test('all crises have startDate before peakDate before endDate', () => {
    for (const c of INDONESIA_CRISIS_CALENDAR) {
      expect(c.startDate < c.peakDate).toBe(true);
      expect(c.peakDate < c.endDate).toBe(true);
    }
  });
  test('all IDR depreciations are positive and realistic', () => {
    for (const c of INDONESIA_CRISIS_CALENDAR) {
      expect(c.idrDepreciationPct).toBeGreaterThan(0);
      expect(c.idrDepreciationPct).toBeLessThan(50);
    }
  });
});

// ─── replay-engine ────────────────────────────────────────────────────────────

describe('replayIndicator', () => {
  test('returns one point per bar', () => {
    const bars = makeBars(Array.from({ length: 50 }, (_, i) => 100 + i));
    const pts = replayIndicator(bars);
    expect(pts).toHaveLength(50);
  });

  test('z-score null when insufficient window', () => {
    const bars = makeBars([100, 101, 102]);
    const pts = replayIndicator(bars);
    expect(pts[0].zScore30d).toBeNull();
    expect(pts[1].zScore30d).toBeNull();
  });

  test('z-score non-null after 10 bars', () => {
    const bars = makeBars(Array.from({ length: 40 }, (_, i) => 100 + i));
    const pts = replayIndicator(bars);
    expect(pts[10].zScore30d).not.toBeNull();
  });

  test('rising series: late bars have positive z-score (above rolling mean)', () => {
    const bars = makeBars(Array.from({ length: 50 }, (_, i) => 100 + i));
    const pts = replayIndicator(bars);
    const last = pts[pts.length - 1];
    expect(last.zScore30d).toBeGreaterThan(0);
  });

  test('stable series: z-score near zero', () => {
    const bars = makeBars(Array.from({ length: 50 }, () => 100));
    const pts = replayIndicator(bars);
    const last = pts[pts.length - 1];
    // Flat series — current value equals mean, z-score should be 0 or null (zero std)
    expect(last.zScore30d === null || Math.abs(last.zScore30d) < 0.01).toBe(true);
  });

  test('no lookahead: point at index i only uses bars[0..i-1]', () => {
    // Spike at bar 35 should not affect z-scores computed before bar 35
    const values = Array.from({ length: 50 }, (_, i) => (i === 35 ? 9999 : 100));
    const bars = makeBars(values);
    const pts = replayIndicator(bars);
    // Bar 34 (just before spike) should have small z-score
    expect(Math.abs(pts[34].zScore30d ?? 0)).toBeLessThan(2);
  });
});

describe('computeSignals', () => {
  function makeData(idrValues: number[], extraDays = 0): Map<string, DailyBar[]> {
    return new Map([['usdidr_spot', makeBars(idrValues)]]);
  }

  test('returns one signal per date', () => {
    const bars = makeBars(Array.from({ length: 40 }, (_, i) => 14000 + i * 10));
    const data = new Map([['usdidr_spot', bars]]);
    const dates = bars.map(b => b.date);
    const signals = computeSignals(data, dates);
    expect(signals).toHaveLength(bars.length);
  });

  test('IDR depreciation (rising USDIDR) produces positive FX stress', () => {
    // Strongly rising USDIDR = IDR weakening = stress
    const bars = makeBars(Array.from({ length: 50 }, (_, i) => 14000 + i * 100));
    const data = new Map([['usdidr_spot', bars]]);
    const dates = bars.map(b => b.date);
    const signals = computeSignals(data, dates);
    const last = signals[signals.length - 1];
    expect(last.moduleScores.fx_defense).toBeGreaterThan(0);
  });

  test('IDR appreciation (falling USDIDR) produces near-zero FX stress', () => {
    // Falling USDIDR = IDR strengthening = negative stress (×0.3 dampener)
    const bars = makeBars(Array.from({ length: 50 }, (_, i) => 16000 - i * 50));
    const data = new Map([['usdidr_spot', bars]]);
    const dates = bars.map(b => b.date);
    const signals = computeSignals(data, dates);
    const last = signals[signals.length - 1];
    // Dampened by 0.3 factor — still positive but much lower than depreciation stress
    const depBars = makeBars(Array.from({ length: 50 }, (_, i) => 14000 + i * 50));
    const depData = new Map([['usdidr_spot', depBars]]);
    const depSignals = computeSignals(depData, depBars.map(b => b.date));
    expect(last.moduleScores.fx_defense).toBeLessThan(depSignals[depSignals.length - 1].moduleScores.fx_defense);
  });

  test('commodity cushion absent (no export indicators) defaults stress to 30', () => {
    const bars = makeBars(Array.from({ length: 40 }, () => 14000));
    const data = new Map([['usdidr_spot', bars]]);
    const dates = bars.map(b => b.date);
    const signals = computeSignals(data, dates);
    // All FX scores near 0 (flat IDR), commodity defaults to 30
    expect(signals[signals.length - 1].moduleScores.commodity).toBe(30);
  });

  test('positive export z-scores reduce commodity stress below 50', () => {
    const bars = makeBars(Array.from({ length: 50 }, (_, i) => 100 + i * 5)); // rising exports
    const data = new Map([
      ['usdidr_spot',   makeBars(Array.from({ length: 50 }, () => 15000))],
      ['nickel_price_usd', bars],
      ['coal_etf_usd',     bars],
    ]);
    const dates = bars.map(b => b.date);
    const signals = computeSignals(data, dates);
    const last = signals[signals.length - 1];
    expect(last.moduleScores.commodity).toBeLessThan(50);
  });

  test('falling EIDO (negative z) produces foreign flow stress', () => {
    const eidoBars = makeBars(Array.from({ length: 50 }, (_, i) => 30 - i * 0.5)); // declining
    const data = new Map([
      ['usdidr_spot', makeBars(Array.from({ length: 50 }, () => 15000))],
      ['eido_price',  eidoBars],
    ]);
    const dates = eidoBars.map(b => b.date);
    const signals = computeSignals(data, dates);
    const last = signals[signals.length - 1];
    expect(last.moduleScores.foreign_flow).toBeGreaterThan(0);
  });

  test('composite score boundaries: all-zero stress → green', () => {
    const bars = makeBars(Array.from({ length: 40 }, () => 15000));
    const data = new Map([['usdidr_spot', bars]]);
    const dates = bars.map(b => b.date);
    const signals = computeSignals(data, dates);
    const last = signals[signals.length - 1];
    expect(last.overallAlert).toBe('green');
  });
});

// ─── signal-validator ─────────────────────────────────────────────────────────

describe('validateCrisis', () => {
  test('catches crisis when YELLOW fires within 180d pre-window', () => {
    const signals: ModuleSignalAtDate[] = [
      makeSignal('2021-01-01', 40),  // YELLOW, 151d before start
      makeSignal('2021-06-01', 20),  // GREEN @ crisis start
      makeSignal('2021-07-15', 20),  // GREEN
      makeSignal('2021-08-01', 20),  // GREEN @ peak
    ];
    const result = validateCrisis(MOCK_CRISIS, signals);
    expect(result.caught).toBe(true);
    expect(result.firstAlertDate).toBe('2021-01-01');
    expect(result.leadTimeDaysYellow).toBe(151);
  });

  test('misses crisis when no signal within 180d pre-window', () => {
    const signals: ModuleSignalAtDate[] = [
      makeSignal('2020-01-01', 60),  // ORANGE, way too early (>180d)
      makeSignal('2021-06-01', 20),
      makeSignal('2021-08-01', 20),
    ];
    const result = validateCrisis(MOCK_CRISIS, signals);
    expect(result.caught).toBe(false);
    expect(result.firstAlertDate).toBeNull();
  });

  test('pre-crisis ORANGE detected when within 180d window', () => {
    const signals: ModuleSignalAtDate[] = [
      makeSignal('2021-02-01', 60),  // ORANGE, 120d before start
      makeSignal('2021-06-01', 20),
      makeSignal('2021-08-01', 20),
    ];
    const result = validateCrisis(MOCK_CRISIS, signals);
    expect(result.firstOrangeDate).toBe('2021-02-01');
    expect(result.leadTimeDaysOrange).toBe(120);
    expect(result.firstOrangeDateInCrisis).toBeNull();  // pre-crisis found, in-crisis = null
  });

  test('in-crisis ORANGE detected when pre-crisis ORANGE absent', () => {
    const signals: ModuleSignalAtDate[] = [
      makeSignal('2021-04-01', 40),  // YELLOW only, 61d before start
      makeSignal('2021-06-01', 20),  // GREEN @ start
      makeSignal('2021-06-20', 60),  // ORANGE, +19d after start
      makeSignal('2021-08-01', 20),
    ];
    const result = validateCrisis(MOCK_CRISIS, signals);
    expect(result.firstOrangeDate).toBeNull();          // no ORANGE pre-crisis
    expect(result.firstOrangeDateInCrisis).toBe('2021-06-20');
    expect(result.daysFromStartToOrange).toBe(19);
  });

  test('signal peak date is date of highest composite score', () => {
    const signals: ModuleSignalAtDate[] = [
      makeSignal('2021-04-01', 40),
      makeSignal('2021-06-01', 30),
      makeSignal('2021-06-15', 85),  // highest in crisis window
      makeSignal('2021-07-01', 70),
      makeSignal('2021-08-01', 20),
    ];
    const result = validateCrisis(MOCK_CRISIS, signals);
    expect(result.signalPeakDate).toBe('2021-06-15');
    expect(result.peakScore).toBe(85);
  });

  test('nearest-day lookup for signalAtCrisisStart (no exact match)', () => {
    // No signal on exactly 2021-06-01 — nearest prior is 2021-05-30 (GREEN)
    const signals: ModuleSignalAtDate[] = [
      makeSignal('2021-03-01', 40),
      makeSignal('2021-05-30', 20),  // prior to start, no exact-start entry
      makeSignal('2021-06-10', 60),
      makeSignal('2021-08-01', 20),
    ];
    const result = validateCrisis(MOCK_CRISIS, signals);
    expect(result.signalAtCrisisStart).toBe('green');  // nearest prior = 2021-05-30 = 20 = green
  });

  test('peakAlertLevel reflects highest alert in crisis window', () => {
    const signals: ModuleSignalAtDate[] = [
      makeSignal('2021-06-01', 30),
      makeSignal('2021-06-20', 80),  // RED during crisis
      makeSignal('2021-08-01', 20),
    ];
    const result = validateCrisis(MOCK_CRISIS, signals);
    expect(result.peakAlertLevel).toBe('red');
  });

  test('180d window boundary: signal exactly 180d before start is included', () => {
    const exactly180 = new Date('2021-06-01');
    exactly180.setDate(exactly180.getDate() - 180);
    const dateStr = exactly180.toISOString().slice(0, 10);  // '2020-12-03'
    const signals: ModuleSignalAtDate[] = [
      makeSignal(dateStr, 40),  // exactly at window edge
      makeSignal('2021-08-01', 20),
    ];
    const result = validateCrisis(MOCK_CRISIS, signals);
    expect(result.caught).toBe(true);
    expect(result.leadTimeDaysYellow).toBe(180);
  });

  test('signal 181d before start is outside window — not caught', () => {
    const tooEarly = new Date('2021-06-01');
    tooEarly.setDate(tooEarly.getDate() - 181);
    const dateStr = tooEarly.toISOString().slice(0, 10);
    const signals: ModuleSignalAtDate[] = [
      makeSignal(dateStr, 40),  // 181d = outside 180d window
      makeSignal('2021-08-01', 20),
    ];
    const result = validateCrisis(MOCK_CRISIS, signals);
    expect(result.caught).toBe(false);
  });
});

describe('computeFalsePositiveRate', () => {
  test('zero rate when all ORANGE+ days are inside crisis windows', () => {
    const crises = [MOCK_CRISIS];
    const signals: ModuleSignalAtDate[] = [
      makeSignal('2021-06-15', 60),  // ORANGE inside crisis window
      makeSignal('2021-07-01', 80),  // RED inside crisis window
      makeSignal('2020-01-01', 20),  // GREEN outside
    ];
    const { falsePositiveRate } = computeFalsePositiveRate(signals, crises);
    expect(falsePositiveRate).toBe(0);
  });

  test('100% rate when all ORANGE+ days are outside any crisis', () => {
    const crises = [MOCK_CRISIS];
    const signals: ModuleSignalAtDate[] = [
      makeSignal('2019-01-01', 60),  // ORANGE, far outside crisis
      makeSignal('2019-06-01', 80),  // RED, far outside crisis
    ];
    const { falsePositiveRate, totalAlertDays } = computeFalsePositiveRate(signals, crises);
    expect(totalAlertDays).toBe(2);
    expect(falsePositiveRate).toBe(100);
  });

  test('60d buffer around crisis window absorbs near-miss signals', () => {
    const crises = [MOCK_CRISIS];
    // 30d before MOCK_CRISIS.startDate (2021-06-01) = 2021-05-02 → inside 60d buffer
    const signals: ModuleSignalAtDate[] = [
      makeSignal('2021-05-02', 60),  // ORANGE, 30d before start (within 60d buffer)
    ];
    const { falsePositiveRate } = computeFalsePositiveRate(signals, crises);
    expect(falsePositiveRate).toBe(0);  // counted as crisis-adjacent, not FP
  });

  test('empty signals returns zero rate', () => {
    const { falsePositiveRate } = computeFalsePositiveRate([], [MOCK_CRISIS]);
    expect(falsePositiveRate).toBe(0);
  });
});

// ─── sovereign CDS module ─────────────────────────────────────────────────────
//
// z-score math for step-function series (p spike bars + q stable bars in window):
//   z = sqrt(q / p)  when current is at spike level.
// Example: 24 stable + 6 spike → z = sqrt(24/6) = 2.0 → ORANGE fxAlert.

describe('computeSignals — sovereign CDS module', () => {
  const flatIDR = (n: number) => makeBars(Array.from({ length: n }, () => 15000));

  test('no CDS data → sovereign score defaults to 30 (neutral baseline)', () => {
    const bars = flatIDR(50);
    const data = new Map([['usdidr_spot', bars]]);
    const signals = computeSignals(data, bars.map(b => b.date));
    expect(signals[signals.length - 1].moduleScores.sovereign).toBe(30);
  });

  test('rising CDS (widening spread) → sovereignStressScore > 0', () => {
    const n = 50;
    const data = new Map([
      ['usdidr_spot', flatIDR(n)],
      ['indonesia_cds_5y_bps', makeBars(Array.from({ length: n }, (_, i) => 100 + i * 5))],
    ]);
    const dates = flatIDR(n).map(b => b.date);
    const signals = computeSignals(data, dates);
    expect(signals[signals.length - 1].moduleScores.sovereign).toBeGreaterThan(0);
  });

  test('falling CDS (tightening) → sovereignStressScore = 0', () => {
    const n = 50;
    const data = new Map([
      ['usdidr_spot', flatIDR(n)],
      ['indonesia_cds_5y_bps', makeBars(Array.from({ length: n }, (_, i) => 500 - i * 8))],
    ]);
    const dates = flatIDR(n).map(b => b.date);
    const signals = computeSignals(data, dates);
    // Negative z (CDS falling) → no sovereign stress
    expect(signals[signals.length - 1].moduleScores.sovereign).toBe(0);
  });

  test('CDS spike with few bars in window → sovereignAlert = orange', () => {
    // 50 stable + 5 spike → at last bar: q=26, p=4 → z≈2.55 → sovereignStressScore=100
    const n = 55;
    const cdsValues = [...Array(50).fill(100), ...Array(5).fill(1000)];
    const idrBars = makeBars(Array.from({ length: n }, (_, i) => 15000 + i * 0.1));
    const data = new Map([
      ['usdidr_spot', idrBars],
      ['indonesia_cds_5y_bps', makeBars(cdsValues)],
    ]);
    const signals = computeSignals(data, idrBars.map(b => b.date));
    const last = signals[signals.length - 1];
    expect(last.alertLevels.sovereign).toBe('orange');
    expect(last.moduleScores.sovereign).toBeGreaterThan(66);
  });

  test('CDS stress contributes to composite score', () => {
    // Compare two runs: one with rising CDS, one without.
    // The run with rising CDS should produce higher composite.
    const n = 50;
    const dates = flatIDR(n).map(b => b.date);

    const withCds = computeSignals(
      new Map([
        ['usdidr_spot', flatIDR(n)],
        ['indonesia_cds_5y_bps', makeBars(Array.from({ length: n }, (_, i) => 100 + i * 5))],
      ]),
      dates,
    );
    const withoutCds = computeSignals(
      new Map([['usdidr_spot', flatIDR(n)]]),
      dates,
    );
    const last = withCds.length - 1;
    // Rising CDS produces sovereignStressScore > 30 (neutral), so composite should be higher
    expect(withCds[last].compositeScore).toBeGreaterThanOrEqual(withoutCds[last].compositeScore);
  });

  test('alertLevels output includes sovereign, vix, dxy keys', () => {
    const bars = flatIDR(40);
    const data = new Map([['usdidr_spot', bars]]);
    const signals = computeSignals(data, bars.map(b => b.date));
    const last = signals[signals.length - 1];
    expect('sovereign' in last.alertLevels).toBe(true);
    expect('vix' in last.alertLevels).toBe(true);
    expect('dxy' in last.alertLevels).toBe(true);
  });

  test('moduleScores output includes sovereign key', () => {
    const bars = flatIDR(40);
    const data = new Map([['usdidr_spot', bars]]);
    const signals = computeSignals(data, bars.map(b => b.date));
    expect('sovereign' in signals[signals.length - 1].moduleScores).toBe(true);
  });
});

// ─── FP confirmation gate ─────────────────────────────────────────────────────
//
// Gate: ORANGE/RED requires stressedModuleCount ≥ 2.
// Prevents isolated single-indicator spikes from generating phantom alerts.

describe('computeSignals — FP confirmation gate', () => {
  // Builds a step-function series: `switchAt` bars at stable, rest at spikeVal.
  // Tiny linear increment in stable period ensures non-zero window std (avoids null z).
  function stepSeries(n: number, stableBase: number, spikeVal: number, switchAt = 45): DailyBar[] {
    return makeBars(Array.from({ length: n }, (_, i) =>
      i < switchAt ? stableBase + i * 0.01 : spikeVal,
    ));
  }

  test('invariant: stressedModuleCount < 2 → overallAlert never orange/red', () => {
    // Mild linear stress across 2 indicators — stays below ORANGE threshold for each
    const n = 60;
    const data = new Map([
      ['usdidr_spot', makeBars(Array.from({ length: n }, (_, i) => 15000 + i * 5))],
      ['vix_level',   makeBars(Array.from({ length: n }, (_, i) => 20   + i * 0.2))],
    ]);
    const signals = computeSignals(data, data.get('usdidr_spot')!.map(b => b.date));
    for (const s of signals) {
      if (s.stressedModuleCount < 2) {
        expect(s.overallAlert === 'orange' || s.overallAlert === 'red').toBe(false);
      }
    }
  });

  test('2+ stressed modules allow ORANGE when composite ≥ 55', () => {
    // IDR + EIDO + VIX + DXY all spike simultaneously.
    // At bar ~51: q=24 stable + p=6 spike → z≈2.0 → each module ORANGE.
    // Composite: 80×0.30 + 30×0.25 + 80×0.15 + 30×0.10 + 70×0.10 + 70×0.10 = 60.5 → ORANGE.
    const n = 60;
    const data = new Map([
      ['usdidr_spot', stepSeries(n, 15000, 20000)],
      ['eido_price',  stepSeries(n, 30,    5)],
      ['vix_level',   stepSeries(n, 20,    80)],
      ['dxy_index',   stepSeries(n, 100,   115)],
    ]);
    const dates = data.get('usdidr_spot')!.map(b => b.date);
    const signals = computeSignals(data, dates);

    const firstOrange = signals.find(s => s.overallAlert === 'orange' || s.overallAlert === 'red');
    expect(firstOrange).toBeDefined();
    expect(firstOrange!.stressedModuleCount).toBeGreaterThanOrEqual(2);
  });

  test('VIX spike is counted in stressedModuleCount', () => {
    // VIX: stable then large spike. IDR flat.
    // q=24, p=6 → z_vix = 2.0 → vixStressScore=70 → vixAlert=ORANGE → counted.
    const n = 60;
    const data = new Map([
      ['usdidr_spot', stepSeries(n, 15000, 15000)],  // flat IDR — no FX stress
      ['vix_level',   stepSeries(n, 20,    80)],
    ]);
    const dates = data.get('usdidr_spot')!.map(b => b.date);
    const signals = computeSignals(data, dates);

    const spikeSignals = signals.slice(46); // bars after spike settles
    const hasVixOrange = spikeSignals.some(s => s.alertLevels.vix === 'orange' || s.alertLevels.vix === 'red');
    expect(hasVixOrange).toBe(true);

    const vixOrangeSignal = spikeSignals.find(s => s.alertLevels.vix === 'orange' || s.alertLevels.vix === 'red');
    expect(vixOrangeSignal!.stressedModuleCount).toBeGreaterThanOrEqual(1);
  });

  test('stressedModuleCount = 0 when all indicators flat', () => {
    const bars = makeBars(Array.from({ length: 50 }, () => 15000));
    const data = new Map([['usdidr_spot', bars]]);
    const signals = computeSignals(data, bars.map(b => b.date));
    expect(signals[signals.length - 1].stressedModuleCount).toBe(0);
    expect(signals[signals.length - 1].overallAlert).not.toBe('orange');
    expect(signals[signals.length - 1].overallAlert).not.toBe('red');
  });
});
