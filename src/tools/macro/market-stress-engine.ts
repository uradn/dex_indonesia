/**
 * Market Stress Engine — Module 9
 *
 * IHSG valuation vs fundamentals + IDX market breadth.
 * Detects valuation disconnect (market stable but fundamentals deteriorating)
 * and breadth collapse (broad selling before index falls).
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { upsertPoints, getLatestPoint, getLastN } from './time-series-db.js';
import { alertFromScore, alertLabel } from './scoring.js';
import { getFreshPoint, stalenessFlag } from './freshness.js';
import { fetchIhsgMarketData } from './sources/ihsg.js';
import { fetchIdxShortSelling } from './sources/idx-short-selling.js';
import type { AlertLevel } from './types.js';

export const MARKET_STRESS_DESCRIPTION = `
MACRO INTELLIGENCE — Market Stress Engine (Module 9)

Tracks IHSG equity market valuation and breadth as macro early-warning signals.

Detects:
- Valuation disconnect: IHSG P/E elevated while macro fundamentals deteriorate
- Breadth collapse: majority of stocks declining before headline index falls
- Overvaluation crash risk: P/E expansion above historical range on stressed backdrop
- Narrow leadership: few stocks propping up index while broad market sells off

Indicators:
- IHSG P/E Ratio: historical avg 14-16x. >22x = elevated. >28x = bubble risk.
- Advance/Decline Ratio: >1.5 bullish breadth. <0.67 bearish. <0.5 panic selling.

## When to Use

- "Is IHSG overvalued?"
- "Show market breadth"
- "Is the rally narrow or broad-based?"
- "IHSG P/E vs historical"
- Market stress check alongside sovereign/FX signals
`.trim();

export type MarketTiming = 'oversold' | 'neutral' | 'overheated';

export interface CascadeNode {
  threshold: number;
  label: string;
  status: 'breached' | 'approaching' | 'clear';
  description: string;
}

export interface StopLossCascade {
  priceLevel: number | null;
  levelsBreached: number;
  nodes: CascadeNode[];
  cascadeBonus: number;
  active: boolean;
}

interface MarketStressOutput {
  alert: AlertLevel;
  stressScore: number;
  peRatio: number | null;
  adRatio: number | null;
  peAlert: AlertLevel;
  breadthAlert: AlertLevel;
  valuationDisconnect: boolean;
  timing: MarketTiming;
  cascade: StopLossCascade;
  dataDate: string;
  flags: string[];
  narrative: string;
}

/**
 * Stop-loss cascade thresholds — each level represents a different institutional
 * forced-sell type. Cascade is mechanical (not fundamental-driven); amplifies
 * Morris-Shin confidence erosion independently of macro signals.
 *
 * 5,000 — Psychological floor: retail stop-losses + momentum algos + EM mandate soft floors.
 *          First breach expands speculator attack window (Morris-Shin DCI +5pts).
 * 4,800 — Mandate-driven institutional floor: EM benchmark funds with drawdown limits
 *          (post-MSCI Standalone = forced exit regardless of fundamentals); insurance
 *          fund regulatory minimums (OJK Solvency floor triggers rebalancing).
 * 4,500 — Systemic cascade: domestic margin calls on leveraged retail + pension fund
 *          rebalancing mandates + foreign custody clearing thresholds. At this level
 *          forced supply overwhelms any fundamental bid.
 */
const CASCADE_NODES: Array<{ threshold: number; label: string; description: string }> = [
  {
    threshold: 5000,
    label: '5,000 psychological floor',
    description: 'Retail stop-losses + momentum algos + EM benchmark soft floors. Morris-Shin DCI +5pts at breach.',
  },
  {
    threshold: 4800,
    label: '4,800 mandate-driven floor',
    description: 'EM mandate forced exits (post-MSCI Standalone) + OJK insurance fund solvency floor rebalancing.',
  },
  {
    threshold: 4500,
    label: '4,500 systemic cascade',
    description: 'Domestic margin calls + pension fund rebalancing mandates + foreign custody clearing thresholds.',
  },
];

// Within 2% of threshold = "approaching" warning zone
const CASCADE_APPROACH_PCT = 0.02;

function evaluateStopLossCascade(priceLevel: number | null): StopLossCascade {
  if (priceLevel === null) {
    return {
      priceLevel: null,
      levelsBreached: 0,
      nodes: CASCADE_NODES.map(n => ({ ...n, status: 'clear' as const })),
      cascadeBonus: 0,
      active: false,
    };
  }

  let levelsBreached = 0;
  const nodes: CascadeNode[] = CASCADE_NODES.map(n => {
    if (priceLevel <= n.threshold) {
      levelsBreached++;
      return { ...n, status: 'breached' as const };
    }
    if (priceLevel <= n.threshold * (1 + CASCADE_APPROACH_PCT)) {
      return { ...n, status: 'approaching' as const };
    }
    return { ...n, status: 'clear' as const };
  });

  // +10 per breached level, capped at 30
  const cascadeBonus = Math.min(30, levelsBreached * 10);

  return {
    priceLevel,
    levelsBreached,
    nodes,
    cascadeBonus,
    active: levelsBreached > 0,
  };
}

// EIDO ETF P/E proxy → approximate IHSG composite P/E.
// EIDO historical range ~8-15x; IHSG composite historical ~14-22x.
// Factor ~1.65 based on long-run ratio. All scoring/alert thresholds use composite-equiv.
const EIDO_TO_COMPOSITE_FACTOR = 1.65;
function compositeEquivPe(rawPe: number): number {
  return parseFloat((rawPe * EIDO_TO_COMPOSITE_FACTOR).toFixed(1));
}

/** Score P/E: expects composite-equivalent value. */
function scorePe(pe: number): number {
  // IHSG composite historical avg ~14-16x. Stress = high P/E vs fundamentals.
  if (pe < 12) return 10;  // very cheap — possible earnings collapse or deep value
  if (pe < 18) return 0;   // fair value range
  if (pe < 22) return 15;
  if (pe < 26) return 35;
  if (pe < 30) return 60;
  return Math.min(100, Math.round(60 + (pe - 30) / 5 * 40));
}

/** Score advance/decline: low ratio = broad selling = stress. */
function scoreAd(adRatio: number): number {
  if (adRatio >= 1.5) return 0;
  if (adRatio >= 1.0) return Math.round((1.5 - adRatio) / 0.5 * 20);
  if (adRatio >= 0.67) return Math.round(20 + (1.0 - adRatio) / 0.33 * 30);
  if (adRatio >= 0.5) return Math.round(50 + (0.67 - adRatio) / 0.17 * 20);
  return Math.min(100, Math.round(70 + (0.5 - adRatio) / 0.25 * 30));
}

function peAlertLevel(pe: number): AlertLevel {
  // pe is composite-equivalent
  if (pe < 18) return 'green';
  if (pe < 22) return 'yellow';
  if (pe < 27) return 'orange';
  return 'red';
}

function breadthAlertLevel(adRatio: number): AlertLevel {
  if (adRatio >= 1.2) return 'green';
  if (adRatio >= 0.8) return 'yellow';
  if (adRatio >= 0.5) return 'orange';
  return 'red';
}

export async function runMarketStressEngine(): Promise<MarketStressOutput> {
  // 1. Fetch live data (parallel: IHSG + short selling)
  const [{ peRatio: pePoint, advanceDecline: adPoint, priceLevel: priceLevelPoint }, shortSell] = await Promise.all([
    fetchIhsgMarketData(),
    fetchIdxShortSelling(),
  ]);

  const pointsToSave = [pePoint, adPoint, priceLevelPoint].filter(Boolean);
  if (pointsToSave.length > 0) await upsertPoints(pointsToSave as NonNullable<typeof pePoint>[]);

  // 2. Read from DB (use cached if live fetch failed)
  const [dbPe, dbAd, dbPrice] = await Promise.all([
    getLatestPoint('ihsg_pe_ratio'),
    getLatestPoint('idx_advance_decline_ratio'),
    getLatestPoint('ihsg_price_level'),
  ]);

  const peRatio = dbPe?.value ?? null;
  const adRatio = dbAd?.value ?? null;
  const priceLevel = dbPrice?.value ?? null;

  // Convert EIDO proxy P/E to composite-equivalent before scoring
  const peForScoring = peRatio !== null ? compositeEquivPe(peRatio) : null;

  // 3. Compute stress score
  const components: Array<[number, number]> = [];
  if (peForScoring !== null) components.push([scorePe(peForScoring), 0.50]);
  if (adRatio !== null) components.push([scoreAd(adRatio), 0.50]);

  let baseScore = 15;
  if (components.length > 0) {
    const totalWeight = components.reduce((s, [, w]) => s + w, 0);
    baseScore = Math.round(components.reduce((s, [score, w]) => s + score * w, 0) / totalWeight);
  }

  // 3b. Stop-loss cascade bonus (mechanical forced-sell amplifier, independent of fundamentals)
  const cascade = evaluateStopLossCascade(priceLevel);

  // 3c. Short selling surge bonus — rising institutional shorts = bearish conviction
  let ssBonus = 0;
  if (shortSell?.volumeIdrBn !== null && shortSell?.volumeIdrBn !== undefined) {
    const ssHistory = await getLastN('idx_short_sell_volume_idr_bn', 20);
    if (ssHistory.length >= 5) {
      const avg20d = ssHistory.reduce((s, p) => s + p.value, 0) / ssHistory.length;
      const ratio = shortSell.volumeIdrBn / avg20d;
      if (ratio > 3) ssBonus = 15;
      else if (ratio > 2) ssBonus = 8;
      else if (ratio > 1.5) ssBonus = 4;
    }
  }

  const stressScore = Math.min(100, baseScore + cascade.cascadeBonus + ssBonus);

  const alert = alertFromScore(stressScore) as AlertLevel;

  // 4. Detect valuation disconnect (use composite-equiv for threshold comparison)
  const valuationDisconnect = (peForScoring !== null && peForScoring > 20) && (adRatio !== null && adRatio < 0.8);

  // 4b. Market timing signal
  // oversold: P/E cheap (<14x) + breadth selling, OR panic breadth (<0.5) regardless of valuation
  // overheated: P/E elevated (>22x) + breadth still positive (>1.0) = expensive + still being bought
  // neutral: everything else
  const timing: MarketTiming =
    (adRatio !== null && adRatio < 0.5) ||
    (peForScoring !== null && peForScoring < 14 && adRatio !== null && adRatio < 0.8)
      ? 'oversold'
    : (peForScoring !== null && peForScoring > 22 && adRatio !== null && adRatio >= 1.0)
      ? 'overheated'
    : 'neutral';

  // 5. Flags + freshness gate
  const flags: string[] = [];
  const [freshPe, freshAd] = await Promise.all([
    getFreshPoint('ihsg_pe_ratio'),
    getFreshPoint('idx_advance_decline_ratio'),
  ]);
  for (const fp of [freshPe, freshAd]) {
    if (fp.cls === 'orange' || fp.cls === 'red') {
      flags.push(stalenessFlag(fp.spec?.name ?? 'unknown', fp.ageDays!, fp.spec, fp.cls));
    }
  }
  const criticalStaleM9 = [freshPe, freshAd].filter(fp => fp.cls === 'red').length;
  if (criticalStaleM9 >= 1) {
    flags.unshift('LOW CONFIDENCE: IHSG P/E or A/D ratio RED-stale — M9 market stress score may not reflect current market conditions');
  }
  if (peForScoring !== null && peForScoring > 24) flags.push(`IHSG P/E ~${peForScoring}x (composite-equiv) — elevated vs historical avg (14-16x)`);
  if (adRatio !== null && adRatio < 0.67) flags.push(`Breadth bearish: A/D ratio ${adRatio.toFixed(2)} — majority of stocks declining`);
  if (adRatio !== null && adRatio < 0.5) flags.push(`Breadth panic: A/D ratio ${adRatio.toFixed(2)} — broad selling signal`);
  if (valuationDisconnect) flags.push('Valuation disconnect: elevated P/E + negative breadth — narrow leadership risk');

  // IDX circuit breaker / trading halt — env pin IDX_LAST_CIRCUIT_BREAKER_DATE (YYYY-MM-DD)
  // Update when circuit breaker fires (−8% intraday triggers halt). Flag active 30d post-event.
  const cbDate = process.env.IDX_LAST_CIRCUIT_BREAKER_DATE ?? null;
  if (cbDate) {
    const cbAgeDays = Math.floor((Date.now() - new Date(cbDate).getTime()) / 86_400_000);
    if (cbAgeDays <= 30) {
      flags.push(`IDX CIRCUIT BREAKER FIRED ${cbDate} (${cbAgeDays}d ago) — trading halt asymmetric aftermath: halt pauses selling but does not create buyers; resumes against thinner bid; historically fires next cascade level on reopen. [SOUL.md Persona III]`);
    }
  }

  // Stop-loss cascade flags
  if (cascade.active) {
    const breachedLabels = cascade.nodes.filter(n => n.status === 'breached').map(n => n.label).join(', ');
    flags.push(
      `STOP-LOSS CASCADE: ${cascade.levelsBreached}/3 threshold(s) BREACHED (${breachedLabels}) — mechanical forced-sell amplifier active (+${cascade.cascadeBonus}pts). Selling is mandate-driven, not fundamental.`,
    );
  }
  for (const node of cascade.nodes) {
    if (node.status === 'approaching') {
      flags.push(`CASCADE APPROACH: IHSG approaching ${node.label} — ${node.description}`);
    }
  }

  // Short selling surge flags
  if (shortSell?.volumeIdrBn !== null && shortSell?.volumeIdrBn !== undefined && ssBonus > 0) {
    const ssHistory = await getLastN('idx_short_sell_volume_idr_bn', 20);
    const avg20d = ssHistory.length >= 5
      ? ssHistory.reduce((s, p) => s + p.value, 0) / ssHistory.length
      : null;
    const ratio = avg20d ? (shortSell.volumeIdrBn / avg20d) : null;
    const ratioStr = ratio ? `${ratio.toFixed(1)}× 20d avg` : '';
    if (ssBonus >= 15) {
      flags.push(`SHORT SELL SPIKE: ${shortSell.volumeIdrBn.toFixed(0)} IDR bn (${ratioStr}) — institutional shorts at critical surge level; forced repricing risk.`);
    } else if (ssBonus >= 8) {
      flags.push(`Short sell elevated: ${shortSell.volumeIdrBn.toFixed(0)} IDR bn (${ratioStr}) — bearish conviction building.`);
    } else if (ssBonus >= 4) {
      flags.push(`Short sell rising: ${shortSell.volumeIdrBn.toFixed(0)} IDR bn (${ratioStr}).`);
    }
  }

  // 6. Data date
  const dates = [dbPe, dbAd].filter(Boolean).map(p => p!.date).sort().reverse();
  const dataDate = dates[0] ?? 'unknown';

  // 7. Alert levels per indicator (use composite-equiv for threshold)
  const peAlert: AlertLevel = peForScoring !== null ? peAlertLevel(peForScoring) : 'green';
  const breadthAlert: AlertLevel = adRatio !== null ? breadthAlertLevel(adRatio) : 'green';

  // 8. Narrative
  const peStr = peRatio !== null
    ? `EIDO ${peRatio.toFixed(1)}x P/E (~${peForScoring}x composite-equiv)`
    : 'P/E n/a';
  const adStr = adRatio !== null ? `A/D ratio ${adRatio.toFixed(2)}` : 'breadth n/a';
  const narrative = [
    `IHSG market stress score: ${stressScore}/100 — ${alertLabel(alert).toUpperCase()}.`,
    `${peStr} (historical avg 14-16x); ${adStr}.`,
    valuationDisconnect ? 'Valuation disconnect detected: narrow leadership masking broad market weakness.' : '',
    flags.length === 0 ? 'No active stress flags.' : '',
  ].filter(Boolean).join(' ');

  return { alert, stressScore, peRatio, adRatio, peAlert, breadthAlert, valuationDisconnect, timing, cascade, dataDate, flags, narrative };
}

function formatCascadeStatus(cascade: StopLossCascade): string {
  if (cascade.priceLevel === null) return '| Stop-Loss Cascade | price n/a | — | 5,000 / 4,800 / 4,500 |';
  const nodeStr = cascade.nodes.map(n => {
    const icon = n.status === 'breached' ? '🔴' : n.status === 'approaching' ? '🟡' : '🟢';
    return `${icon} ${n.threshold.toLocaleString()}`;
  }).join(' → ');
  return `| Stop-Loss Cascade | IHSG ${cascade.priceLevel.toLocaleString()} pts | ${cascade.levelsBreached > 0 ? cascade.levelsBreached + '/3 BREACHED' : 'CLEAR'} | ${nodeStr} (+${cascade.cascadeBonus}pts bonus) |`;
}

function formatMarketStressOutput(output: MarketStressOutput): string {
  return [
    `## Market Stress Engine — Module 9`,
    `**Alert:** ${alertLabel(output.alert).toUpperCase()} | **Stress Score:** ${output.stressScore}/100`,
    ``,
    `| Indicator | Value | Alert | Threshold |`,
    `|-----------|-------|-------|-----------|`,
    `| IHSG P/E (EIDO proxy) | ${output.peRatio !== null ? output.peRatio.toFixed(1) + 'x raw / ~' + compositeEquivPe(output.peRatio) + 'x equiv' : 'n/a'} | ${output.peAlert.toUpperCase()} | YELLOW >22x, RED >27x (composite-equiv) |`,
    `| A/D Ratio | ${output.adRatio !== null ? output.adRatio.toFixed(2) : 'n/a'} | ${output.breadthAlert.toUpperCase()} | YELLOW <0.8, RED <0.5 |`,
    `| Valuation Disconnect | ${output.valuationDisconnect ? 'DETECTED' : 'No'} | — | P/E>20 + A/D<0.8 |`,
    `| Market Timing | ${output.timing.toUpperCase()} | — | Oversold: P/E<14+selling or A/D<0.5; Overheated: P/E>22+A/D>1.0 |`,
    formatCascadeStatus(output.cascade),
    ``,
    output.flags.length > 0 ? `**Flags:**\n${output.flags.map(f => `- ${f}`).join('\n')}` : '**No active flags.**',
    ``,
    output.narrative,
    ``,
    `_P/E: EIDO ETF proxy (iShares MSCI Indonesia, top ~85 stocks). Raw EIDO ×1.65 = composite-equiv. TE IHSG composite P/E removed from platform. A/D: IDX daily breadth. Cascade: stop-loss thresholds 5,000/4,800/4,500 pts._`,
    `_Data as of: ${output.dataDate}._`,
  ].join('\n');
}

export const marketStressEngine = new DynamicStructuredTool({
  name: 'market_stress_engine',
  description: MARKET_STRESS_DESCRIPTION,
  schema: z.object({
    query: z.string().describe('e.g. "Is IHSG overvalued?" or "Show market breadth" or "Check valuation disconnect"'),
  }),
  func: async (_input) => {
    try {
      const output = await runMarketStressEngine();
      return formatToolResult(formatMarketStressOutput(output));
    } catch (e) {
      return formatToolResult(`Market Stress Engine error: ${String(e)}`);
    }
  },
});
