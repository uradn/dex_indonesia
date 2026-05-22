---
name: sovereign-stress-memo
description: Full sovereign stress analysis for Indonesia. Deep-dive into sovereign repricing risk, fiscal trajectory, and foreign exit scenarios. Use when asked for "sovereign stress", "full macro analysis", "Indonesia credit risk", or "big short Indonesia".
---

# Indonesia Sovereign Stress Memo

Produce an institutional sovereign stress assessment. Audience: macro hedge fund, sovereign credit desk.

## Step 1 — Run in Parallel

- `sovereign_risk_engine`
- `fx_defense_engine`
- `foreign_flow_engine`
- `narrative_divergence_engine`

## Step 2 — Stress Test

Call `web_search` for:
- Latest CDS quotes and movement (Indonesia vs EM peers)
- Rating agency actions/outlooks (Moody's, S&P, Fitch)
- Any IMF Article IV or World Bank Indonesia assessment
- Fiscal deficit trajectory vs APBN target
- Parliamentary/political risk (debt ceiling, subsidy cuts, etc.)

## Step 3 — Scenario Analysis

Build three scenarios:

**Bear Case (Silent Crisis materializing):**
- Triggers: external shock (Fed hike, oil spike, China slowdown)
- Foreign SBN exit >30% of foreign holdings
- IDR to [current + 15%]
- CDS to [current + 100bps]
- BI forced rate hike despite weak growth

**Base Case (Muddle Through):**
- Current trajectory sustained
- BI manages IDR through SRBI and intervention
- Fiscal deficit within APBN

**Bull Case (Normalization):**
- Commodity prices recover
- Fed pivot → EM inflows
- Current account improves
- Foreign SBN ownership stabilizes

## Step 4 — Write the Memo

```
# Indonesia Sovereign Stress Memo — [DATE]

SOVEREIGN RISK SCORE: [X]/100 | [ALERT LEVEL]
SILENT CRISIS PROBABILITY: [X]%

## Executive Summary
[3-4 sentences: current sovereign positioning, key risk, bottom line]

## Sovereign Indicators
[Table: CDS, SBN yield, EMBI, foreign ownership — current, MoM change, alert]

## Fiscal Trajectory
[APBN assumptions vs actuals: deficit, oil price, USDIDR, growth]
[Narrative credibility score: [X]/100]

## Foreign Exit Risk
[Current foreign SBN ownership %, MoM change]
[Domestic absorption: is BI/banks filling the gap?]
[Exit scenarios: mild (5%), moderate (15%), severe (30%)]

## Stress Scenarios
| Scenario | IDR Target | CDS Target | BI Response | Probability |
|----------|-----------|-----------|-------------|-------------|

## Positioning Implication
[What a sovereign CDS trader, FX desk, or EM bond fund should watch]
[Key trigger levels to monitor]
```

## Rules

- CDS acceleration > absolute level
- Foreign SBN exit is the key transmission mechanism for FX crisis
- Indonesia's 3-month reserve adequacy test: >3 months imports AND >100% short-term external debt
- Historical analog: 2013 taper tantrum saw IDR -20%, CDS +150bps in 3 months
- Don't anchor on government projections — mark to market
