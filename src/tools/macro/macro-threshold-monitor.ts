/**
 * Macro Threshold Monitor — cheap tripwire for cron jobs.
 *
 * Fetches current spot values and compares against fixed thresholds.
 * No LLM reasoning, no full engine runs. Returns "all clear" or breach list.
 * Designed for intraday cron checks where speed and cost matter.
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { fetchUsdIdrSpot } from './sources/yahoo-macro.js';
import YahooFinance from 'yahoo-finance2';
import { MACRO_ALERT_THRESHOLDS } from './macro-cron-alerts.js';

const yf = new YahooFinance();

interface ThresholdBreach {
  indicator: string;
  value: number;
  threshold: number;
  direction: 'above' | 'below';
  severity: 'warning' | 'critical';
}

async function fetchCurrentSpots(): Promise<{
  usdidr: number | null;
  vix: number | null;
  dxy: number | null;
  brent: number | null;
  eido: number | null;
}> {
  const [idrResult, vixResult, dxyResult, brentResult, eidoResult] = await Promise.allSettled([
    fetchUsdIdrSpot().then((dp) => dp?.value ?? null),
    yf.quote('^VIX').then((q) => q.regularMarketPrice ?? null).catch(() => null),
    yf.quote('DX-Y.NYB').then((q) => q.regularMarketPrice ?? null).catch(() => null),
    yf.quote('BZ=F').then((q) => q.regularMarketPrice ?? null).catch(() => null),
    yf.quote('EIDO').then((q) => q.regularMarketPrice ?? null).catch(() => null),
  ]);

  return {
    usdidr: idrResult.status === 'fulfilled' ? idrResult.value : null,
    vix:    vixResult.status === 'fulfilled' ? vixResult.value : null,
    dxy:    dxyResult.status === 'fulfilled' ? dxyResult.value : null,
    brent:  brentResult.status === 'fulfilled' ? brentResult.value : null,
    eido:   eidoResult.status === 'fulfilled' ? eidoResult.value : null,
  };
}

export const THRESHOLD_MONITOR_DESCRIPTION = `
Fast macro threshold monitor — checks current spot values against fixed alert thresholds.
No full engine runs. Returns breach list or "all clear" in seconds.

Used for:
- Intraday cron tripwire checks (cheap, fast)
- Quick "are we in threshold-breach territory?" check before running full engines
- Pre-screening before silent_crisis_detector

Monitors: USDIDR, VIX, DXY, Brent vs APBN assumption.
`.trim();

export const macroThresholdMonitor = new DynamicStructuredTool({
  name: 'macro_threshold_monitor',
  description: THRESHOLD_MONITOR_DESCRIPTION,
  schema: z.object({
    checkFx: z.boolean().optional().default(true).describe('Check USDIDR threshold'),
    checkSovereign: z.boolean().optional().default(true).describe('Check VIX/DXY thresholds'),
    checkCommodity: z.boolean().optional().default(true).describe('Check Brent vs APBN assumption'),
    previousUsdIdr: z.number().optional().describe('Previous session USDIDR for daily move % calc'),
  }),
  func: async ({ checkFx, checkSovereign, checkCommodity, previousUsdIdr }) => {
    const spots = await fetchCurrentSpots();
    const breaches: ThresholdBreach[] = [];
    const dataLines: string[] = [];

    // ── FX Defense thresholds ──────────────────────────────────────────
    if (checkFx && spots.usdidr !== null) {
      dataLines.push(`USDIDR: ${spots.usdidr.toLocaleString()}`);

      if (previousUsdIdr) {
        const dailyMovePct = ((spots.usdidr - previousUsdIdr) / previousUsdIdr) * 100;
        dataLines.push(`  Daily move: ${dailyMovePct >= 0 ? '+' : ''}${dailyMovePct.toFixed(2)}%`);
        if (Math.abs(dailyMovePct) >= MACRO_ALERT_THRESHOLDS.USDIDR_DAILY_MOVE_PCT) {
          breaches.push({
            indicator: 'USDIDR daily move',
            value: dailyMovePct,
            threshold: MACRO_ALERT_THRESHOLDS.USDIDR_DAILY_MOVE_PCT,
            direction: 'above',
            severity: Math.abs(dailyMovePct) >= 3 ? 'critical' : 'warning',
          });
        }
      }
    }

    // ── Sovereign / global stress thresholds ──────────────────────────
    if (checkSovereign) {
      if (spots.vix !== null) {
        dataLines.push(`VIX: ${spots.vix.toFixed(1)}`);
        if (spots.vix >= 35) {
          breaches.push({
            indicator: 'VIX',
            value: spots.vix,
            threshold: 35,
            direction: 'above',
            severity: spots.vix >= 45 ? 'critical' : 'warning',
          });
        }
      }
      if (spots.dxy !== null) {
        dataLines.push(`DXY: ${spots.dxy.toFixed(1)}`);
        if (spots.dxy >= 108) {
          breaches.push({
            indicator: 'DXY',
            value: spots.dxy,
            threshold: 108,
            direction: 'above',
            severity: spots.dxy >= 112 ? 'critical' : 'warning',
          });
        }
      }
    }

    // ── Commodity thresholds ───────────────────────────────────────────
    if (checkCommodity && spots.brent !== null) {
      const APBN_OIL = 70; // APBN 2026 ICP assumption (UU No.17/2025); APBN 2025 was $82
      const brentDevPct = ((spots.brent - APBN_OIL) / APBN_OIL) * 100;
      dataLines.push(`Brent: $${spots.brent.toFixed(1)} (APBN: $${APBN_OIL}, dev: ${brentDevPct >= 0 ? '+' : ''}${brentDevPct.toFixed(1)}%)`);
      if (Math.abs(brentDevPct) >= MACRO_ALERT_THRESHOLDS.BRENT_VS_APBN_DEVIATION) {
        breaches.push({
          indicator: `Brent vs APBN assumption`,
          value: brentDevPct,
          threshold: MACRO_ALERT_THRESHOLDS.BRENT_VS_APBN_DEVIATION,
          direction: brentDevPct > 0 ? 'above' : 'below',
          severity: Math.abs(brentDevPct) >= 40 ? 'critical' : 'warning',
        });
      }
    }

    if (breaches.length === 0) {
      return [
        '✅ MACRO THRESHOLDS: ALL CLEAR',
        '',
        '**Current Spots:**',
        ...dataLines,
        '',
        `_Checked at ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB_`,
      ].join('\n');
    }

    const criticalBreaches = breaches.filter((b) => b.severity === 'critical');
    const warningBreaches  = breaches.filter((b) => b.severity === 'warning');

    const lines: string[] = [
      criticalBreaches.length > 0 ? '🔴 MACRO THRESHOLD BREACH — CRITICAL' : '🟠 MACRO THRESHOLD BREACH — WARNING',
      '',
      '**Breaches:**',
      ...breaches.map((b) => {
        const emoji = b.severity === 'critical' ? '🔴' : '🟡';
        const dir = b.direction === 'above' ? '>' : '<';
        return `${emoji} ${b.indicator}: ${b.value.toFixed(2)} (${dir} ${b.threshold})`;
      }),
      '',
      '**Current Spots:**',
      ...dataLines,
      '',
      `_${criticalBreaches.length} critical, ${warningBreaches.length} warning breach(es)_`,
      `_Checked at ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB_`,
      '',
      '→ Run `silent_crisis_detector` for full system-wide assessment.',
    ];

    return lines.filter((l) => l !== '').join('\n');
  },
});
