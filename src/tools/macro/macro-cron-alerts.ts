/**
 * Macro Intelligence Cron Alert System.
 *
 * Defines threshold-based alert jobs that run on schedule and
 * push notifications via the WhatsApp gateway when thresholds breach.
 *
 * Cron schedules (Croner format):
 *   Daily market open:  "0 8 * * 1-5" (Mon-Fri 08:00 WIB)
 *   Intraday check:     "0 12,16 * * 1-5" (12:00 + 16:00 WIB)
 *   Weekly deep check:  "0 7 * * 1" (Monday 07:00 WIB)
 *
 * To activate via Dexter CLI, ask: "Set up macro monitoring cron jobs"
 * Dexter will create the cron jobs using the cron tool.
 */

export const MACRO_CRON_SCHEDULES = {
  MORNING_BRIEF:     '0 8 * * 1-5',
  INTRADAY_CHECK:    '0 12,16 * * 1-5',
  WEEKLY_DEEP_DIVE:  '0 7 * * 1',
  RESERVES_CHECK:    '0 9 1 * *',   // 1st of each month after BI publishes
} as const;

export const MACRO_ALERT_THRESHOLDS = {
  // FX Defense
  USDIDR_DAILY_MOVE_PCT:       1.5,   // Alert if IDR moves >1.5% in session
  USDIDR_MONTHLY_DEPRECIATION: 5.0,   // Alert if IDR depreciates >5% in month
  FX_RESERVES_MOM_DECLINE:    -3.0,   // Alert if reserves fall >3% MoM
  FX_RESERVES_FLOOR_BN:       100.0,  // Alert if reserves fall below $100bn
  RESERVE_RUNWAY_MONTHS:        6.0,  // Alert if <6 months runway

  // Sovereign Risk
  CDS_5Y_LEVEL:               200,    // Alert if CDS 5Y > 200bps
  CDS_5Y_DAILY_MOVE:           15,    // Alert if CDS moves >15bps in session
  SBN_10Y_YIELD:               7.5,   // Alert if SBN 10Y yield > 7.5%
  FOREIGN_SBN_MOM_DECLINE:    -5.0,   // Alert if foreign SBN ownership falls >5% MoM

  // BoP
  TRADE_BALANCE_DEFICIT:        0,    // Alert if trade balance turns negative
  IMPORT_GROWTH_YOY:           20,    // Alert if imports grow >20% YoY

  // Commodity
  BRENT_VS_APBN_DEVIATION:     25,    // Alert if Brent >25% above APBN assumption
  NICKEL_PRICE_FALL_90D:      -20,    // Alert if nickel falls >20% in 90 days

  // Banking Stress (Module 8)
  NPL_GROSS_PCT:                5.0,  // Alert if NPL gross > 5%
  LDR_PCT:                    100.0,  // Alert if LDR > 100% (credit > deposits)
  CAR_PCT:                     15.0,  // Alert if CAR < 15% (thinning buffer)
  INDONIA_SPREAD_BPS:          50,    // Alert if IndONIA-BI spread > 50bps (approaching BI corridor ceiling 75bps)
  BANKING_STRESS_SCORE:        50,    // Alert if banking stress score > 50/100

  // Silent Crisis
  SILENT_CRISIS_PROBABILITY:   50,    // Alert if silent crisis prob > 50%
  CROSS_CONFIRMED_MODULES:      3,    // Alert if 3+ modules in stress simultaneously
} as const;

export const MACRO_CRON_PROMPTS = {
  MORNING_BRIEF: `
Run the asean-morning-brief skill. Include all 9 macro modules.
After completion, if overall alert is ORANGE or RED, prepend:
"⚠️ MACRO ALERT: [ALERT LEVEL] — [one-line reason]"
If GREEN or YELLOW, use standard morning brief format.
Keep total response under 2000 characters for WhatsApp readability.
`.trim(),

  INTRADAY_CHECK: `
Quick intraday check — run these tools in parallel:
1. fx_defense_engine (query: "quick FX check")
2. commodity_engine (query: "commodity update")
3. asean_relative_value_engine (query: "ASEAN FX update")

If any module returns ORANGE or RED, run silent_crisis_detector.
Output: 3-5 bullet points. Flag any threshold breaches from MACRO_ALERT_THRESHOLDS.
`.trim(),

  WEEKLY_DEEP_DIVE: `
Weekly sovereign stress deep dive. Run sovereign-stress-memo skill.
Focus on: what changed this week, regime direction, key risk for next week.
Include stress scenarios.
Format for WhatsApp: use sections with headers, max 3000 characters.
`.trim(),
} as const;

/**
 * Alert message builder for WhatsApp gateway.
 * Called when a threshold breach is detected.
 */
export function buildAlertMessage(
  module: string,
  indicator: string,
  value: number,
  threshold: number,
  alertLevel: string,
): string {
  const emoji = alertLevel === 'red' ? '🔴' : alertLevel === 'orange' ? '🟠' : '🟡';
  return `${emoji} MACRO ALERT — ${module.toUpperCase()}\n${indicator}: ${value.toFixed(2)} (threshold: ${threshold})\nLevel: ${alertLevel.toUpperCase()}\nTime: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB`;
}
