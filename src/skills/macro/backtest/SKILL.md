---
name: macro-backtest
description: Run walk-forward backtest validating Indonesia macro stress signals against 6 historical crisis events. Proves the system would have issued advance warnings with quantified lead times.
---

# Macro Backtest Skill

Run the backtest engine and interpret results.

## Steps

1. Call `backtest_engine` with default params (all 6 crises, full history from 2012)
2. Interpret the output:
   - **Hit rate**: % of crises caught with advance warning (target: >80%)
   - **Avg lead time**: days of advance warning before crisis start (target: >20d)
   - **False positive rate**: % of non-crisis days flagged ORANGE+ (target: <5%)
3. Note which crises were missed and why (usually commodity-only events where FX defense showed pseudo-stability)
4. If user wants to backtest specific crises only, pass `crisisIds` filter

## Valid Crisis IDs

- `taper_tantrum_2013`
- `china_devaluation_2015`
- `em_selloff_2018`
- `covid_crash_2020`
- `fed_tightening_2022`
- `dollar_surge_2023`

## Caveats

- Sovereign module (CDS 5Y, SBN yield) excluded — no free historical data
- Bloomberg/Refinitiv users get better results via real sovereign signals
- First 90 days of data insufficient for z-score (warm-up period)
- KOL ETF delisted in 2014 — coal proxy may show gaps in 2015 crisis
