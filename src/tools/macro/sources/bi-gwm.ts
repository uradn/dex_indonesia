/**
 * BI GWM (Giro Wajib Minimum) — Required Reserve Ratio fetcher.
 *
 * GWM = % of DPK banks must hold at BI. Direct liquidity constraint on bank credit.
 * Changes announced at RDG press conferences (8–10×/yr). Env override is the primary
 * source; DB time series used for direction detection.
 *
 * Key signal for M8 Banking Stress:
 *   Level: GWM > 8% = tightening squeeze; GWM < 5% = BI emergency floor (distress)
 *   Direction: hike within 90d = tightening headwind; cut to <5% = emergency easing
 *   LDR interaction: OJK nominal LDR doesn't deduct GWM reserves from DPK denominator.
 *     → High GWM inflates effective funding pressure beyond what nominal LDR shows.
 *
 * Historical calibration:
 *   COVID 2020:  3.5% (emergency floor)
 *   Normal:      5.0–6.5% (pre-tightening)
 *   Tightening:  9.0% (2022–2026 BI cycle; released ~Rp200T when cut)
 *   Oct 23 2026: 7.0% (normalization cut — announced RDG Oct 23)
 *
 * Env override: BI_GWM_PCT — always wins (like BI_DNDF_OUTSTANDING_BN pattern).
 * Update when BI announces GWM change at RDG press conference.
 *
 * DB indicator: 'bi_gwm_pct' (category: 'banking')
 * Direction detection: getLastN('bi_gwm_pct', 2) → compare latest vs previous.
 */

import { getLatestPoint, getLastN, upsertPoints } from '../time-series-db.js';
import type { MacroDataPoint } from '../types.js';

const NOW = () => new Date().toISOString();
const TODAY = () => new Date().toISOString().slice(0, 10);

// Pre-tightening normal GWM anchor for effective LDR computation.
// 5% = BI GWM baseline prior to 2022 tightening cycle.
export const GWM_NORMAL_ANCHOR_PCT = 5.0;
// LDR sensitivity: each 1pp GWM above anchor adds this many pp of effective LDR pressure.
export const GWM_LDR_SENSITIVITY = 0.5;

export interface BiGwmData {
  gwmPct: number;
  prevGwmPct: number | null;
  changeDate: string | null;
  direction: 'hike' | 'cut' | 'unchanged' | 'unknown';
  changePp: number | null;         // positive = hike, negative = cut
  daysSinceChange: number | null;
  effectiveLdrAdjPp: number;       // extra LDR pressure vs normal-GWM baseline (can be negative = easing)
  source: 'env_override' | 'db_cache';
}

/** Backfill pre-cut GWM 9% so direction detection has a baseline. Idempotent. */
async function ensureGwmHistory(): Promise<void> {
  const history = await getLastN('bi_gwm_pct', 10);
  const has9pct = history.some(p => p.value === 9.0 && p.date <= '2026-10-22');
  if (has9pct) return;
  // BI GWM was at 9% throughout 2026 until Oct 23 cut.
  // Store 2026-01-01 as representative anchor for the tightening peak.
  const pt: MacroDataPoint = {
    indicator: 'bi_gwm_pct',
    category: 'banking',
    date: '2026-01-01',
    value: 9.0,
    unit: '%',
    source: 'bi_announcement',
    fetchedAt: NOW(),
  };
  await upsertPoints([pt]);
}

/** Fetch current GWM and compute direction from DB time series. */
export async function fetchBiGwm(): Promise<BiGwmData | null> {
  await ensureGwmHistory();

  // Env override wins (always — matches DNDF pattern)
  const envVal = process.env.BI_GWM_PCT ? parseFloat(process.env.BI_GWM_PCT) : null;

  // DB: last 2 distinct GWM values for direction detection
  const history = await getLastN('bi_gwm_pct', 10);
  if (history.length === 0 && envVal === null) return null;

  // Env pin: store in DB if different from latest cached
  if (envVal !== null) {
    const latest = history.at(-1);
    if (!latest || Math.abs(latest.value - envVal) > 0.01) {
      await upsertPoints([{
        indicator: 'bi_gwm_pct',
        category: 'banking',
        date: TODAY(),
        value: envVal,
        unit: '%',
        source: 'env_override',
        fetchedAt: NOW(),
      }]);
      // Re-read to get updated history
      const updated = await getLastN('bi_gwm_pct', 10);
      return buildResult(envVal, updated, 'env_override');
    }
    return buildResult(envVal, history, 'env_override');
  }

  const latest = history.at(-1)!;
  return buildResult(latest.value, history, 'db_cache');
}

function buildResult(
  gwmPct: number,
  history: Awaited<ReturnType<typeof getLastN>>,
  source: BiGwmData['source'],
): BiGwmData {
  // Find previous distinct GWM value (different from current)
  const prevEntry = [...history].reverse().find(p => Math.abs(p.value - gwmPct) > 0.01);
  const prevGwmPct = prevEntry?.value ?? null;
  const changeDate = prevEntry ? history.at(-1)?.date ?? null : null;

  // Direction + magnitude
  let direction: BiGwmData['direction'] = 'unknown';
  let changePp: number | null = null;
  if (prevGwmPct !== null) {
    changePp = parseFloat((gwmPct - prevGwmPct).toFixed(2));
    direction = changePp > 0.01 ? 'hike' : changePp < -0.01 ? 'cut' : 'unchanged';
  }

  // Days since last change (from most recent non-current distinct point)
  let daysSinceChange: number | null = null;
  if (changeDate) {
    daysSinceChange = Math.floor(
      (Date.now() - new Date(changeDate + 'T00:00:00Z').getTime()) / 86_400_000,
    );
  }

  // Effective LDR adjustment: each 1pp GWM above anchor = +0.5pp LDR pressure.
  // Negative when GWM below anchor (unusual but possible in extreme easing).
  const effectiveLdrAdjPp = parseFloat(((gwmPct - GWM_NORMAL_ANCHOR_PCT) * GWM_LDR_SENSITIVITY).toFixed(2));

  return { gwmPct, prevGwmPct, changeDate, direction, changePp, daysSinceChange, effectiveLdrAdjPp, source };
}

/** Score GWM level for stress contribution.
 *
 * Level calibration (additive bump to M8 score):
 *   <4%  : +15 — BI crisis floor (COVID-level emergency easing)
 *   4–5% : +8  — near-crisis (BI injecting liquidity aggressively)
 *   5–7.5%: 0  — normal/easing range (no stress from GWM level)
 *   7.5–9%: +8 — tightening (above equilibrium, squeezing bank liquidity)
 *   >9%  : +12 — very tight (above 2022 peak — severe constraint)
 */
export function scoreGwmLevel(gwmPct: number): number {
  if (gwmPct < 4.0) return 15;
  if (gwmPct < 5.0) return 8;
  if (gwmPct <= 7.5) return 0;
  if (gwmPct <= 9.0) return 8;
  return 12;
}

/** Score GWM direction for additional stress bump.
 *
 * Direction calibration:
 *   Hike ≥1pp within 90d: +8 (deliberate tightening = reducing bank liquidity)
 *   Hike ≥2pp within 90d: +12 (aggressive tightening)
 *   Cut to <5% (emergency floor): +10 (BI desperate = confirms distress)
 *   Cut to ≥5% (normalization): 0 (pro-liquidity; informational flag only)
 */
export function scoreGwmDirection(data: BiGwmData): number {
  if (data.direction === 'hike' && data.daysSinceChange !== null && data.daysSinceChange <= 90) {
    const mag = data.changePp ?? 0;
    if (mag >= 2.0) return 12;
    if (mag >= 1.0) return 8;
  }
  // Emergency cut to crisis floor (BI responding to systemic distress)
  if (data.direction === 'cut' && data.gwmPct < 5.0) return 10;
  return 0;
}
