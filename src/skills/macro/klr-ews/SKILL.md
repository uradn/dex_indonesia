---
name: klr-ews
description: Kaminsky-Reinhart-Lizondo Early Warning System — threshold-based crisis probability assessment for Indonesia using 18 macro indicators. Classifies currency crisis and banking crisis risk using KLR signal approach.
---

# KLR Early Warning System — Indonesia

You are running the Kaminsky-Reinhart-Lizondo (KLR) Early Warning System for Indonesia. KLR is a threshold-based approach that fires binary signals when indicators breach empirically calibrated thresholds derived from EM crisis episodes (1970–2000, updated for post-GFC).

## What to Do

1. Run all relevant macro tools in parallel to gather current data:
   - `fx_defense_engine` — USDIDR, FX reserves, reserve trajectory
   - `bop_engine` — trade balance, current account, import growth
   - `sovereign_risk_engine` — SBN yield, CDS, credit rating
   - `banking_stress_engine` — NPL, LDR, CAR, IndONIA spread, M2, real rate
   - `regime_engine` — GDP growth trajectory, inflation ROC

2. For each KLR indicator below, extract the value and check if the signal fires (1) or not (0).

3. Count active signals and compute crisis probability.

## KLR Signal Matrix — Indonesia Calibration

### Currency Crisis Indicators (threshold → signal)

| # | Indicator | Signal Fires When | Source |
|---|-----------|-------------------|--------|
| 1 | USDIDR 12M depreciation | >25% depreciation | fx_defense |
| 2 | USDIDR 3M depreciation | >10% depreciation | fx_defense |
| 3 | FX Reserves 3M change | > −20% decline | fx_defense |
| 4 | FX Reserves / import cover | < 3 months | bop |
| 5 | M2 / FX Reserves ratio | > 5× (IDR money supply vs reserves) | banking |
| 6 | Real interest rate (IndONIA − CPI) | < −2% (severe financial repression) | banking |
| 7 | Exports 12M growth | < −15% decline | bop |
| 8 | Current account / GDP | < −5% deficit | bop |
| 9 | SBN 10Y yield | > 7.5% | sovereign |
| 10 | CDS 5Y | > 300 bps | sovereign |

### Banking Crisis Indicators (threshold → signal)

| # | Indicator | Signal Fires When | Source |
|---|-----------|-------------------|--------|
| 11 | NPL gross % | > 3% (KLR early warning) | banking |
| 12 | LDR % | > 100% | banking |
| 13 | IndONIA-BI Spread | > 50 bps (approaching corridor ceiling) | banking |
| 14 | CAR % | < 14% | banking |
| 15 | IHPR YoY | < 0% (collateral deflation) | banking |
| 16 | GDP growth trend | Decelerating for 2+ quarters | regime |
| 17 | Inflation ROC | Accelerating while growth decelerating (= Q3 Stagflation regime) | regime |
| 18 | SRBI-IndONIA nexus | SRBI > 900T IDR AND IndONIA spread > 30bps | banking |

## Crisis Probability Classification

- **0–3 signals:** LOW — no crisis signal. Monitor normally.
- **4–6 signals:** MODERATE — elevated. Increase monitoring frequency.
- **7–10 signals:** HIGH — pre-crisis conditions. Escalate to ORANGE.
- **11+ signals:** CRITICAL — twin crisis risk. RED alert.

## BI Transmission Context

When IndONIA-BI spread is elevated, interpret within BI corridor:
- BI Rate currently at 5.75% (check sovereign_risk for latest)
- Corridor: DFR = BI Rate − 75bps (floor), LF Rate = BI Rate + 75bps (ceiling)
- IndONIA > LF Rate = BI forced liquidity injection = systemic stress

## FSAP Sovereign-Bank Nexus

When SBN 10Y yield is elevated:
- Indonesia banks hold ~20% assets in SBN; portfolio duration ~6yr
- Yield +100bps = CAR erosion ~1.2pp
- Check `banking_stress_engine` for implied CAR hit field
- If implied CAR hit > 1.5pp: doom loop risk (sovereign stress → bank stress → sovereign)

## Output Format

```
## KLR Early Warning System — Indonesia [DATE]

**Currency Crisis Signals:** X/10 active
**Banking Crisis Signals:** X/8 active
**Total Active:** X/18
**Crisis Probability:** [LOW/MODERATE/HIGH/CRITICAL]

### Active Signals
[List only signals that fired, with current value vs threshold]

### Green Signals (not firing)
[List signals not firing — confirms what's holding]

### Assessment
[2-3 sentence synthesis: which crisis type is more imminent, what's the key risk vector, and how many quarters before potential transmission to financial markets if stress continues]

### KLR Recommendation
[SHORT-TERM: monitor / escalate / alert]
[STRUCTURAL: which module to watch most closely for next signal]
```

Use the dual-signal count to distinguish currency vs banking crisis risk — they may diverge, and the divergence itself is informative (e.g., banking stress without FX pressure = domestic credit cycle, not balance of payments crisis).
