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
import { fetchIhsgMarketData } from './sources/ihsg.js';
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

interface MarketStressOutput {
  alert: AlertLevel;
  stressScore: number;
  peRatio: number | null;
  adRatio: number | null;
  peAlert: AlertLevel;
  breadthAlert: AlertLevel;
  valuationDisconnect: boolean;
  dataDate: string;
  flags: string[];
  narrative: string;
}

/** Score P/E: elevated P/E on deteriorating fundamentals = stress. */
function scorePe(pe: number): number {
  // IHSG historical avg ~14-16x. Stress = high P/E suggests overshoot before repricing.
  if (pe < 10) return 20;  // below avg: possible earnings collapse (mild stress signal)
  if (pe < 16) return 0;   // fair value range
  if (pe < 20) return 15;
  if (pe < 24) return 35;
  if (pe < 28) return 60;
  return Math.min(100, Math.round(60 + (pe - 28) / 5 * 40));
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
  if (pe < 16) return 'green';
  if (pe < 20) return 'yellow';
  if (pe < 25) return 'orange';
  return 'red';
}

function breadthAlertLevel(adRatio: number): AlertLevel {
  if (adRatio >= 1.2) return 'green';
  if (adRatio >= 0.8) return 'yellow';
  if (adRatio >= 0.5) return 'orange';
  return 'red';
}

export async function runMarketStressEngine(): Promise<MarketStressOutput> {
  // 1. Fetch live data
  const { peRatio: pePoint, advanceDecline: adPoint } = await fetchIhsgMarketData();

  const pointsToSave = [pePoint, adPoint].filter(Boolean);
  if (pointsToSave.length > 0) await upsertPoints(pointsToSave as NonNullable<typeof pePoint>[]);

  // 2. Read from DB (use cached if live fetch failed)
  const [dbPe, dbAd] = await Promise.all([
    getLatestPoint('ihsg_pe_ratio'),
    getLatestPoint('idx_advance_decline_ratio'),
  ]);

  const peRatio = dbPe?.value ?? null;
  const adRatio = dbAd?.value ?? null;

  // 3. Compute stress score
  const components: Array<[number, number]> = [];
  if (peRatio !== null) components.push([scorePe(peRatio), 0.50]);
  if (adRatio !== null) components.push([scoreAd(adRatio), 0.50]);

  let stressScore = 15;
  if (components.length > 0) {
    const totalWeight = components.reduce((s, [, w]) => s + w, 0);
    stressScore = Math.round(components.reduce((s, [score, w]) => s + score * w, 0) / totalWeight);
  }

  const alert = alertFromScore(stressScore) as AlertLevel;

  // 4. Detect valuation disconnect
  // P/E elevated (>20x) while breadth is negative (<0.8) = market propped by few names
  const valuationDisconnect = (peRatio !== null && peRatio > 20) && (adRatio !== null && adRatio < 0.8);

  // 5. Flags
  const flags: string[] = [];
  if (peRatio !== null && peRatio > 24) flags.push(`IHSG P/E ${peRatio.toFixed(1)}x — elevated vs historical avg (14-16x)`);
  if (adRatio !== null && adRatio < 0.67) flags.push(`Breadth bearish: A/D ratio ${adRatio.toFixed(2)} — majority of stocks declining`);
  if (adRatio !== null && adRatio < 0.5) flags.push(`Breadth panic: A/D ratio ${adRatio.toFixed(2)} — broad selling signal`);
  if (valuationDisconnect) flags.push('Valuation disconnect: elevated P/E + negative breadth — narrow leadership risk');

  // 6. Data date
  const dates = [dbPe, dbAd].filter(Boolean).map(p => p!.date).sort().reverse();
  const dataDate = dates[0] ?? 'unknown';

  // 7. Alert levels per indicator
  const peAlert: AlertLevel = peRatio !== null ? peAlertLevel(peRatio) : 'green';
  const breadthAlert: AlertLevel = adRatio !== null ? breadthAlertLevel(adRatio) : 'green';

  // 8. Narrative
  const peStr = peRatio !== null ? `${peRatio.toFixed(1)}x P/E` : 'P/E n/a';
  const adStr = adRatio !== null ? `A/D ratio ${adRatio.toFixed(2)}` : 'breadth n/a';
  const narrative = [
    `IHSG market stress score: ${stressScore}/100 — ${alertLabel(alert).toUpperCase()}.`,
    `${peStr} (historical avg 14-16x); ${adStr}.`,
    valuationDisconnect ? 'Valuation disconnect detected: narrow leadership masking broad market weakness.' : '',
    flags.length === 0 ? 'No active stress flags.' : '',
  ].filter(Boolean).join(' ');

  return { alert, stressScore, peRatio, adRatio, peAlert, breadthAlert, valuationDisconnect, dataDate, flags, narrative };
}

function formatMarketStressOutput(output: MarketStressOutput): string {
  return [
    `## Market Stress Engine — Module 9`,
    `**Alert:** ${alertLabel(output.alert).toUpperCase()} | **Stress Score:** ${output.stressScore}/100`,
    ``,
    `| Indicator | Value | Alert | Threshold |`,
    `|-----------|-------|-------|-----------|`,
    `| IHSG P/E Ratio | ${output.peRatio !== null ? output.peRatio.toFixed(1) + 'x' : 'n/a'} | ${output.peAlert.toUpperCase()} | YELLOW >20x, RED >25x |`,
    `| A/D Ratio | ${output.adRatio !== null ? output.adRatio.toFixed(2) : 'n/a'} | ${output.breadthAlert.toUpperCase()} | YELLOW <0.8, RED <0.5 |`,
    `| Valuation Disconnect | ${output.valuationDisconnect ? 'DETECTED' : 'No'} | — | P/E>20 + A/D<0.8 |`,
    ``,
    output.flags.length > 0 ? `**Flags:**\n${output.flags.map(f => `- ${f}`).join('\n')}` : '**No active flags.**',
    ``,
    output.narrative,
    ``,
    `_P/E: Trading Economics / IDX composite. A/D: IDX daily breadth. Historical IHSG P/E avg ~14-16x._`,
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
