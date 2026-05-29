import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { upsertPoints, getLatestPoint } from './time-series-db.js';
import { alertFromScore, alertLabel } from './scoring.js';
import { fetchBankingRatiosOjk } from './sources/ojk.js';
import { fetchIndoniaRateTe, fetchExternalDebtTe, fetchIhprTe, fetchNplTe, fetchLdrTe, fetchCarTe } from './sources/sovereign-scraper.js';
import type { AlertLevel } from './types.js';

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

- NPL / LDR / CAR: OJK SPI Excel (Playwright, monthly, ~11 month lag due to portal migration)
  TODO: new OJK portal (data.ojk.go.id) for July 2025+ data
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
  sectorNpl: Record<string, number>;
  dataDate: string;
  flags: string[];
  summary: string;
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

/** Score IndONIA spread vs BI Rate (bps): 0–50 normal, 50–150 elevated, >200 crisis */
function scoreIndoniaSpread(spreadBps: number): number {
  if (spreadBps < 0) spreadBps = 0; // negative spread = unusually loose
  if (spreadBps < 50) return Math.round(spreadBps / 50 * 20);
  if (spreadBps < 150) return Math.round(20 + (spreadBps - 50) / 100 * 40);
  if (spreadBps < 250) return Math.round(60 + (spreadBps - 150) / 100 * 30);
  return 100;
}

export async function runBankingStressEngine(): Promise<BankingStressOutput> {
  // 1. Fetch live data
  const [bankingRatios, indoniaPoint, extDebtPoint, ihprPoint] = await Promise.allSettled([
    fetchBankingRatiosOjk(),
    fetchIndoniaRateTe(),
    fetchExternalDebtTe(),
    fetchIhprTe(),
  ]);

  const ratios = bankingRatios.status === 'fulfilled' ? bankingRatios.value : { npl: null, ldr: null, car: null, sectorNpl: {} };
  const indonia = indoniaPoint.status === 'fulfilled' ? indoniaPoint.value : null;
  const extDebt = extDebtPoint.status === 'fulfilled' ? extDebtPoint.value : null;
  const ihpr = ihprPoint.status === 'fulfilled' ? ihprPoint.value : null;

  // OJK scraper fallback: if OJK unavailable, fetch NPL/LDR/CAR from Trading Economics
  // TE data source is still OJK via their platform; ~1-3mo lag, same underlying data
  if (!ratios.npl && !ratios.ldr && !ratios.car) {
    const [teNpl, teLdr, teCar] = await Promise.allSettled([fetchNplTe(), fetchLdrTe(), fetchCarTe()]);
    if (teNpl.status === 'fulfilled' && teNpl.value) ratios.npl = teNpl.value;
    if (teLdr.status === 'fulfilled' && teLdr.value) ratios.ldr = teLdr.value;
    if (teCar.status === 'fulfilled' && teCar.value) ratios.car = teCar.value;
  }

  // 2. Persist to DB
  const pointsToSave = [ratios.npl, ratios.ldr, ratios.car, indonia, extDebt, ihpr].filter(Boolean);
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
  const [dbNpl, dbLdr, dbCar, dbIndonia, dbBiRate, dbExtDebt, dbIhpr] = await Promise.all([
    getLatestPoint('bank_npl_gross_pct'),
    getLatestPoint('bank_ldr_pct'),
    getLatestPoint('bank_car_pct'),
    getLatestPoint('indonia_3m_pct'),
    getLatestPoint('bi_rate_pct'),
    getLatestPoint('indonesia_external_debt_bn'),
    getLatestPoint('indonesia_ihpr_yoy_pct'),
  ]);

  const nplPct = dbNpl?.value ?? null;
  const ldrPct = dbLdr?.value ?? null;
  const carPct = dbCar?.value ?? null;
  const indoniaPct = dbIndonia?.value ?? null;
  const biRatePct = dbBiRate?.value ?? null;
  const externalDebtBn = dbExtDebt?.value ?? null;
  const ihprYoy = dbIhpr?.value ?? null;

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

  // 5. Alert level: high stressScore = more stress = higher alert
  const alert = alertFromScore(stressScore) as AlertLevel;

  // 6. Flags
  const flags: string[] = [];
  if (nplPct !== null && nplPct > 5) flags.push(`NPL ${nplPct.toFixed(1)}% — above stress threshold (5%)`);
  if (ldrPct !== null && ldrPct > 100) flags.push(`LDR ${ldrPct.toFixed(1)}% — credit exceeds deposits`);
  if (carPct !== null && carPct < 15) flags.push(`CAR ${carPct.toFixed(1)}% — capital buffer thinning`);
  if (indoniaSpreadBps !== null && indoniaSpreadBps > 100) flags.push(`IndONIA spread ${indoniaSpreadBps}bps — interbank stress`);
  if (indoniaSpreadBps !== null && indoniaSpreadBps > 50 && nplPct !== null && nplPct > 3) {
    flags.push('IndONIA spread + NPL both elevated — early interbank-credit stress signal');
  }
  if (ihprYoy !== null && ihprYoy < 0) flags.push(`IHPR ${ihprYoy.toFixed(1)}% YoY — property prices falling (KPR collateral risk)`);
  if (ihprYoy !== null && ihprYoy < 0 && nplPct !== null && nplPct > 3) {
    flags.push('Property price decline + elevated NPL — mortgage collateral deflation risk');
  }
  // Sector NPL flags
  for (const [sector, npl] of Object.entries(sectorNpl)) {
    if (npl > 5) flags.push(`Sector NPL ${sector}: ${npl.toFixed(1)}% — above 5% threshold`);
  }

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
    externalDebtBn, ihprYoy, sectorNpl, dataDate, flags, summary,
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
        `| NPL Gross % | ${output.nplPct?.toFixed(1) ?? 'n/a'} | YELLOW >5%, RED >10% |`,
        `| LDR % | ${output.ldrPct?.toFixed(1) ?? 'n/a'} | YELLOW >90%, RED >110% |`,
        `| CAR % | ${output.carPct?.toFixed(1) ?? 'n/a'} | YELLOW <15%, RED <8% |`,
        `| IndONIA 3M % | ${output.indoniaPct?.toFixed(2) ?? 'n/a'} | — |`,
        `| BI Rate % | ${output.biRatePct?.toFixed(2) ?? 'n/a'} | — |`,
        `| IndONIA-BI Spread | ${output.indoniaSpreadBps !== null ? output.indoniaSpreadBps + 'bps' : 'n/a'} | YELLOW >50bps, RED >200bps |`,
        `| External Debt | ${output.externalDebtBn !== null ? '$' + output.externalDebtBn.toFixed(0) + 'bn' : 'n/a'} | — |`,
        `| IHPR YoY % | ${output.ihprYoy !== null ? output.ihprYoy.toFixed(1) + '%' : 'n/a'} | <0% = collateral risk |`,
        ``,
        Object.keys(output.sectorNpl).length > 0
          ? `**Sector NPL:**\n${Object.entries(output.sectorNpl).map(([s, v]) => `- ${s}: ${v.toFixed(1)}%`).join('\n')}`
          : '_Sector NPL: n/a (OJK SPI session required)_',
        ``,
        output.flags.length > 0 ? `**Flags:**\n${output.flags.map(f => `- ${f}`).join('\n')}` : '**No active flags.**',
        ``,
        `_Data as of: ${output.dataDate} WIB. OJK SPI lag ~11mo (portal migration); IndONIA/ULN near-real-time. IHPR: BI SHPR quarterly._`,
      ];
      return formatToolResult(lines.join('\n'));
    } catch (e) {
      return formatToolResult(`Banking Stress Engine error: ${String(e)}`);
    }
  },
});
