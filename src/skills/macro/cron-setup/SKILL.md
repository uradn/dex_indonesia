---
name: macro-monitoring-setup
description: Set up automated macro monitoring cron jobs for Indonesia. Creates daily morning brief, intraday threshold tripwire, weekly sovereign stress deep dive, and monthly reserves check. Use when asked to "set up macro monitoring", "automate macro alerts", or "schedule macro cron".
---

# Macro Monitoring Cron Setup

Creates four recurring cron jobs. All use `tz: Asia/Jakarta` (WIB).

## Jobs to Create

Use the `cron` tool four times:

### Job 1 — Daily Morning Brief
```json
{
  "name": "indonesia-macro-morning-brief",
  "schedule": { "kind": "cron", "expr": "0 8 * * 1-5", "tz": "Asia/Jakarta" },
  "description": "Daily ASEAN macro morning brief (Mon-Fri 08:00 WIB)",
  "message": "Run the asean-morning-brief skill. Include all macro modules. If overall alert is ORANGE or RED, prepend: ⚠️ MACRO ALERT: [LEVEL] — [one-line reason]. Keep under 2000 characters for WhatsApp.",
  "fulfillment": "keep"
}
```

### Job 2 — Intraday Threshold Check
```json
{
  "name": "indonesia-macro-intraday",
  "schedule": { "kind": "cron", "expr": "0 12,16 * * 1-5", "tz": "Asia/Jakarta" },
  "description": "Intraday macro threshold tripwire (12:00 + 16:00 WIB)",
  "message": "Run macro_threshold_monitor. If any breaches detected, also run fx_defense_engine and silent_crisis_detector. Output: breach list + 3-sentence market context. If all clear, respond with DEXTER_OK.",
  "fulfillment": "keep"
}
```

### Job 3 — Weekly Sovereign Stress
```json
{
  "name": "indonesia-sovereign-weekly",
  "schedule": { "kind": "cron", "expr": "0 7 * * 1", "tz": "Asia/Jakarta" },
  "description": "Weekly sovereign stress deep dive (Monday 07:00 WIB)",
  "message": "Run the sovereign-stress-memo skill. Focus on: what changed this week, regime direction, key risk for the coming week. Include one stress scenario. Max 3000 characters.",
  "fulfillment": "keep"
}
```

### Job 4 — Monthly Reserves Check
```json
{
  "name": "indonesia-reserves-monthly",
  "schedule": { "kind": "cron", "expr": "0 9 1 * *", "tz": "Asia/Jakarta" },
  "description": "Monthly FX reserves + BoP check (1st of month 09:00 WIB)",
  "message": "Run bop_engine and fx_defense_engine. Focus on: MoM reserve change, reserve runway (months import cover), any synthetic CAD risk signals. Alert if reserves fell >3% MoM or runway <6 months.",
  "fulfillment": "keep"
}
```

## After Creating Jobs

Confirm to user:
- 4 cron jobs created, all timezone: Asia/Jakarta (WIB)
- Intraday tripwire uses `macro_threshold_monitor` (fast, cheap) before escalating to full engines
- Gateway must be running for WhatsApp delivery (`bun run gateway`)
- To disable any job: use `cron` tool with update action, set `enabled: false`
- To test immediately: use `cron` tool with `run` action

## Alert Thresholds (from macro-cron-alerts.ts)

- USDIDR daily move >1.5% → FX alert
- VIX ≥35 → global stress warning, ≥45 → critical
- DXY ≥108 → USD pressure warning
- Brent ±25% vs APBN $82 assumption → BoP alert
- Silent Crisis Probability >50% → systemic alert
- 3+ modules at ORANGE/RED → cross-confirmation alert

## Stress Scenario Supplements

For on-demand stress testing, use `stress_simulator` tool:
- "What if IDR hits 18,500 + VIX 45?"
- "What if commodities crash 30%?"
- "What if EIDO drops 25%?"
