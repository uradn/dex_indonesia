import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { upsertPoints, getLatestPoint, getLastN } from './time-series-db.js';
import { alertFromScore, alertLabel } from './scoring.js';
import { fetchAseanFxSpots } from './sources/yahoo-macro.js';
import type { AlertLevel } from './types.js';

export const ASEAN_RELATIVE_VALUE_DESCRIPTION = `
MACRO INTELLIGENCE — ASEAN Relative Value Engine (Module 7)

Compares Indonesia vs ASEAN peers + India to determine:
1. Is IDR weakness Indonesia-specific or a global USD-strength story?
2. Where does Indonesia rank on sovereign/macro vulnerability vs peers?

Peers tracked: Malaysia, Thailand, Philippines, Vietnam (proxy), India

Metrics compared:
- FX depreciation vs USD (YTD, 3M, 1M)
- CDS spread (Bloomberg if available)
- Inflation differential
- Policy rate and real yield
- Current account balance (% GDP, IMF)
- FX reserves adequacy

Output:
- Indonesia vulnerability rank vs ASEAN peers
- Global USD story vs Indonesia-specific signal
- Relative value entry/exit signals for IDR assets

## When to Use

- "Is IDR weak or is USD just strong?"
- "Show ASEAN relative value"
- "Compare Indonesia vs Malaysia/Thailand"
- "ASEAN morning brief"
`.trim();

interface PeerData {
  country: string;
  fxIndicator: string;
  fxCurrent: number | null;
  fxChange1m: number | null;
  fxChangeYtd: number | null;
}

interface AseanRelativeValueOutput {
  date: string;
  alertLevel: AlertLevel;
  usdStrengthStory: boolean;   // true = DXY driving all ASEAN FX, not ID-specific
  indonesiaVulnerabilityRank: number; // 1 = most vulnerable among peers
  peers: PeerData[];
  indonesiaFxChange1m: number | null;
  aseanMedianFxChange1m: number | null;
  idiosyncraticComponent: number | null; // IDR change minus ASEAN median = ID-specific
  // UIP Carry Attractiveness (R&R framework)
  sbn10yPct: number | null;
  ust10yPct: number | null;
  carrySpreadPct: number | null;         // SBN 10Y − UST 10Y
  idr3mAnnualizedPct: number | null;     // annualized 3M IDR depreciation
  realCarryPct: number | null;           // carry spread − expected depreciation
  carryLabel: 'attractive' | 'neutral' | 'watch' | 'unattractive' | null;
  narrative: string;
  flags: string[];
}

const PEER_FX: Array<{ country: string; indicator: string }> = [
  { country: 'Malaysia',    indicator: 'usdmyr_spot' },
  { country: 'Singapore',   indicator: 'usdsgd_spot' },
  { country: 'Thailand',    indicator: 'usdthb_spot' },
  { country: 'Philippines', indicator: 'usdphp_spot' },
  { country: 'Vietnam',     indicator: 'usdvnd_spot' },
];

async function runAseanRelativeValueEngine(): Promise<AseanRelativeValueOutput> {
  // Fetch fresh ASEAN FX spots
  const fxData = await fetchAseanFxSpots();
  if (fxData.length > 0) await upsertPoints(fxData);

  const [idrCurrent, sbn10yFromDb, ust10yFromDb] = await Promise.all([
    getLatestPoint('usdidr_spot'),
    getLatestPoint('sbn_10y_yield_pct'),
    getLatestPoint('ust_10y_yield_pct'),
  ]);

  // 90-day history covers both 1M FX change and 3M annualized depreciation
  const idrHistory90 = await getLastN('usdidr_spot', 90);
  const idrChange1m = idrCurrent && idrHistory90.length > 1
    ? ((idrCurrent.value - idrHistory90[Math.max(0, idrHistory90.length - 30)].value)
       / idrHistory90[Math.max(0, idrHistory90.length - 30)].value) * 100
    : null;

  const peers: PeerData[] = [];
  const allChanges1m: number[] = [];

  for (const peer of PEER_FX) {
    const current = await getLatestPoint(peer.indicator);
    const hist30 = await getLastN(peer.indicator, 30);
    const change1m = current && hist30.length > 1
      ? ((current.value - hist30[0].value) / hist30[0].value) * 100
      : null;
    if (change1m !== null) allChanges1m.push(change1m);
    peers.push({
      country: peer.country,
      fxIndicator: peer.indicator,
      fxCurrent: current?.value ?? null,
      fxChange1m: change1m,
      fxChangeYtd: null, // would need YTD start price
    });
  }

  // ASEAN median FX change
  const aseanMedianFxChange1m = allChanges1m.length > 0
    ? allChanges1m.sort((a, b) => a - b)[Math.floor(allChanges1m.length / 2)]
    : null;

  // Idiosyncratic component: IDR change - ASEAN median
  const idiosyncraticComponent = idrChange1m !== null && aseanMedianFxChange1m !== null
    ? idrChange1m - aseanMedianFxChange1m
    : null;

  // USD strength story: if all ASEAN FX depreciating together → DXY-driven
  const allDepreciating = allChanges1m.length >= 3 && allChanges1m.every((c) => c > 0);
  const usdStrengthStory = allDepreciating && (idiosyncraticComponent ?? 0) < 2;

  // Indonesia vulnerability rank (1 = most depreciated = most vulnerable)
  const allPeerChanges = [...allChanges1m, idrChange1m ?? 0].sort((a, b) => b - a);
  const indonesiaRank = allPeerChanges.indexOf(idrChange1m ?? 0) + 1;

  // UIP Carry Attractiveness (R&R framework)
  // UIP equilibrium: carry_spread ≈ expected_depreciation → real carry measures excess return
  const sbn10y = sbn10yFromDb?.value ?? null;
  const ust10y = ust10yFromDb?.value ?? null;
  const carrySpread = sbn10y !== null && ust10y !== null
    ? parseFloat((sbn10y - ust10y).toFixed(2))
    : null;

  // 3M annualized IDR depreciation: oldest available point in 90-day window vs current
  let idr3mAnnualized: number | null = null;
  if (idrCurrent && idrHistory90.length >= 10) {
    const oldest = idrHistory90[0]!;
    const daysBetween = (Date.parse(idrCurrent.date) - Date.parse(oldest.date)) / 86_400_000;
    if (daysBetween >= 14) {
      idr3mAnnualized = parseFloat(
        (((idrCurrent.value - oldest.value) / oldest.value) * (365 / daysBetween) * 100).toFixed(2),
      );
    }
  }

  const realCarry = carrySpread !== null && idr3mAnnualized !== null
    ? parseFloat((carrySpread - idr3mAnnualized).toFixed(2))
    : null;

  const carryLabel: AseanRelativeValueOutput['carryLabel'] =
    realCarry === null ? null :
    realCarry > 3.0 ? 'attractive' :
    realCarry > 1.0 ? 'neutral' :
    realCarry > 0.0 ? 'watch' : 'unattractive';

  // FX idiosyncratic alert (existing logic)
  const fxAlertLevel: AlertLevel =
    idiosyncraticComponent !== null
      ? idiosyncraticComponent > 5 ? 'red' :
        idiosyncraticComponent > 3 ? 'orange' :
        idiosyncraticComponent > 1 ? 'yellow' : 'green'
      : 'green';

  // Carry alert — UIP predicts exit when real carry goes negative
  const carryAlertLevel: AlertLevel =
    realCarry === null ? 'green' :
    realCarry < -2 ? 'orange' :
    realCarry < 0 ? 'yellow' : 'green';

  const ALERT_ORDER: AlertLevel[] = ['green', 'yellow', 'orange', 'red'];
  const alertLevel: AlertLevel = ALERT_ORDER[
    Math.max(ALERT_ORDER.indexOf(fxAlertLevel), ALERT_ORDER.indexOf(carryAlertLevel))
  ]!;

  const flags: string[] = [];
  if (!usdStrengthStory && (idiosyncraticComponent ?? 0) > 3) {
    flags.push(`IDR underperforming ASEAN peers by ${idiosyncraticComponent?.toFixed(1)}% — Indonesia-specific repricing`);
  }
  if (usdStrengthStory) {
    flags.push('All ASEAN FX weakening together — DXY story, not Indonesia-specific');
  }
  if (indonesiaRank === 1) {
    flags.push('Indonesia most depreciated ASEAN currency in past 30 days');
  }

  if (realCarry !== null && realCarry < 0) {
    flags.push(`UIP CARRY UNATTRACTIVE: real carry ${realCarry.toFixed(2)}pp (SBN spread ${carrySpread?.toFixed(2)}% − annualized IDR depreciation ${idr3mAnnualized?.toFixed(2)}%) — UIP predicts foreign SBN exit as yield no longer compensates for FX loss [R&R UIP]`);
  } else if (realCarry !== null && realCarry < 1.0) {
    flags.push(`Carry thin: real carry ${realCarry.toFixed(2)}pp — thin margin before carry trade unwinds. Watch SBN foreign ownership trend`);
  }

  const narrative = buildNarrative({ idrChange1m, aseanMedianFxChange1m, idiosyncraticComponent, usdStrengthStory, indonesiaRank, realCarry, carryLabel });

  return {
    date: new Date().toISOString().slice(0, 10),
    alertLevel,
    usdStrengthStory,
    indonesiaVulnerabilityRank: indonesiaRank,
    peers,
    indonesiaFxChange1m: idrChange1m,
    aseanMedianFxChange1m,
    idiosyncraticComponent,
    sbn10yPct: sbn10y,
    ust10yPct: ust10y,
    carrySpreadPct: carrySpread,
    idr3mAnnualizedPct: idr3mAnnualized,
    realCarryPct: realCarry,
    carryLabel,
    narrative,
    flags,
  };
}

function buildNarrative(ctx: {
  idrChange1m: number | null;
  aseanMedianFxChange1m: number | null;
  idiosyncraticComponent: number | null;
  usdStrengthStory: boolean;
  indonesiaRank: number;
  realCarry: number | null;
  carryLabel: AseanRelativeValueOutput['carryLabel'];
}): string {
  const parts: string[] = [];
  if (ctx.idrChange1m !== null) parts.push(`IDR: ${ctx.idrChange1m >= 0 ? '+' : ''}${ctx.idrChange1m.toFixed(2)}% vs USD (1M).`);
  if (ctx.aseanMedianFxChange1m !== null) parts.push(`ASEAN median: ${ctx.aseanMedianFxChange1m >= 0 ? '+' : ''}${ctx.aseanMedianFxChange1m.toFixed(2)}%.`);
  if (ctx.idiosyncraticComponent !== null) {
    parts.push(
      ctx.usdStrengthStory
        ? 'DXY-driven depreciation — ASEAN-wide, not Indonesia-specific.'
        : `Idiosyncratic component: ${ctx.idiosyncraticComponent >= 0 ? '+' : ''}${ctx.idiosyncraticComponent.toFixed(2)}% — ${ctx.idiosyncraticComponent > 2 ? 'Indonesia underperforming peers.' : 'broadly in line with peers.'}`,
    );
  }
  if (ctx.realCarry !== null) {
    const carryStr = ctx.realCarry >= 0 ? `+${ctx.realCarry.toFixed(2)}pp` : `${ctx.realCarry.toFixed(2)}pp`;
    parts.push(`UIP real carry: ${carryStr} [${ctx.carryLabel}].`);
  }
  return parts.join(' ') || 'Insufficient ASEAN FX data.';
}

function formatOutput(output: AseanRelativeValueOutput & { idrSpotPrice?: number }): string {
  const idrDisplay = output.idrSpotPrice
    ? `IDR ${output.idrSpotPrice.toLocaleString()}`
    : 'IDR n/a';
  return [
    `# ASEAN Relative Value Engine — Indonesia`,
    `**Date:** ${output.date}`,
    `**Alert:** ${alertLabel(output.alertLevel)} | **Indonesia Vulnerability Rank:** #${output.indonesiaVulnerabilityRank} (1=worst)`,
    ``,
    `## Summary`,
    output.narrative,
    ``,
    `## FX Performance vs USD (1M)`,
    `| Country | FX Rate | 1M Change | Note |`,
    `|---------|---------|-----------|------|`,
    `| 🇮🇩 Indonesia | ${idrDisplay} | ${output.indonesiaFxChange1m !== null ? `${output.indonesiaFxChange1m >= 0 ? '+' : ''}${output.indonesiaFxChange1m.toFixed(2)}%` : 'n/a'} | Subject |`,
    ...output.peers.map((p) =>
      `| ${p.country} | ${p.fxCurrent?.toFixed(4) ?? 'n/a'} | ${p.fxChange1m !== null ? `${p.fxChange1m >= 0 ? '+' : ''}${p.fxChange1m.toFixed(2)}%` : 'n/a'} | Peer |`,
    ),
    ``,
    `## Signal Decomposition`,
    `| Component | Value |`,
    `|-----------|-------|`,
    `| IDR 1M Change | ${output.indonesiaFxChange1m !== null ? `${output.indonesiaFxChange1m >= 0 ? '+' : ''}${output.indonesiaFxChange1m.toFixed(2)}%` : 'n/a'} |`,
    `| ASEAN Median 1M | ${output.aseanMedianFxChange1m !== null ? `${output.aseanMedianFxChange1m >= 0 ? '+' : ''}${output.aseanMedianFxChange1m.toFixed(2)}%` : 'n/a'} |`,
    `| Idiosyncratic (ID-specific) | ${output.idiosyncraticComponent !== null ? `${output.idiosyncraticComponent >= 0 ? '+' : ''}${output.idiosyncraticComponent.toFixed(2)}%` : 'n/a'} |`,
    `| Narrative | ${output.usdStrengthStory ? '🌐 DXY story (global USD strength)' : '🎯 Indonesia-specific repricing'} |`,
    ``,
    `## UIP Carry Attractiveness (R&R)`,
    `| Component | Value |`,
    `|-----------|-------|`,
    `| SBN 10Y yield | ${output.sbn10yPct !== null ? output.sbn10yPct.toFixed(2) + '%' : 'n/a (run sovereign_risk_engine first)'} |`,
    `| UST 10Y yield | ${output.ust10yPct !== null ? output.ust10yPct.toFixed(2) + '%' : 'n/a'} |`,
    `| Carry spread (SBN − UST) | ${output.carrySpreadPct !== null ? (output.carrySpreadPct >= 0 ? '+' : '') + output.carrySpreadPct.toFixed(2) + 'pp' : 'n/a'} |`,
    `| IDR 3M depreciation (ann.) | ${output.idr3mAnnualizedPct !== null ? (output.idr3mAnnualizedPct >= 0 ? '+' : '') + output.idr3mAnnualizedPct.toFixed(2) + '%' : 'n/a'} |`,
    `| Real carry (UIP-adjusted) | ${output.realCarryPct !== null ? (output.realCarryPct >= 0 ? '+' : '') + output.realCarryPct.toFixed(2) + 'pp' : 'n/a'} |`,
    `| Carry status | ${output.carryLabel?.toUpperCase() ?? 'n/a'} |`,
    `_UIP (R&R): if real carry < 0, yield no longer compensates FX loss — rational foreign investors exit SBN. Leads Module 5 foreign flow data by 2-3 weeks._`,
    ``,
    output.flags.length > 0 ? `## Flags\n${output.flags.map((f) => `- ${f}`).join('\n')}` : '',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

export const aseanRelativeValueEngine = new DynamicStructuredTool({
  name: 'asean_relative_value_engine',
  description:
    'ASEAN Relative Value Engine: compares Indonesia vs ASEAN peers (Malaysia, Singapore, Thailand, Philippines) on FX depreciation. Decomposes IDR weakness into global DXY story vs Indonesia-specific repricing.',
  schema: z.object({
    query: z.string().describe('e.g. "Is IDR weak or is USD just strong?" or "Show ASEAN relative value" or "ASEAN FX comparison"'),
  }),
  func: async (_input) => {
    try {
      const output = await runAseanRelativeValueEngine();
      const idrSpot = await getLatestPoint('usdidr_spot');
      return formatToolResult(
        { analysis: formatOutput({ ...output, idrSpotPrice: idrSpot?.value }), raw: output },
        ['https://finance.yahoo.com'],
      );
    } catch (error) {
      return formatToolResult({ error: error instanceof Error ? error.message : String(error) });
    }
  },
});
