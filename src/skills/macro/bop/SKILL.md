---
name: bop-analysis
description: Balance of Payments deep analysis for Indonesia. Use when asked about trade balance, current account, import growth, FX reserves adequacy, external vulnerability, or synthetic CAD risk.
---

# Balance of Payments Analysis — Indonesia

You are producing an institutional-grade BoP stress assessment. Tone: concise, probabilistic, anti-hype.

## Step 1 — Run the Engine

Call `bop_engine` with the user's query. This fetches:
- Trade balance: BPS (monthly) — most current
- FX reserves: BI website or Bloomberg
- Current account: IMF API (annual, 1-2Q lag)
- Import growth: computed YoY from BPS series

## Step 2 — Component Decomposition

Call `web_search` for:
- Latest BPS trade data release (headline: exports, imports, balance)
- Oil vs non-oil trade balance split (Indonesia = net oil importer)
- Commodity export performance: coal, CPO, nickel, LNG prices

For commodity context, note:
- Coal price ↓ + palm oil ↓ → export revenue pressure → CA widening risk
- Oil price ↑ → import bill surge → BoP deterioration
- Nickel/copper ↑ → partial offset

## Step 3 — Synthetic CAD Check

If engine flags `syntheticCadRisk = true`:
- Run `fx_defense_engine` to confirm reserves falling
- Cross-check with SRBI issuance (rising = BI sterilizing outflows)
- This is the most dangerous scenario: hidden capital flight behind surface surplus

## Step 4 — Stress Scenarios

Based on data, simulate:

**Base case:** current trajectory → BoP in 6 months
**Shock case:** oil +30%, commodity exports -20% → CA impact
**Tail case:** capital flow reversal (foreign SBN exit 50%) → reserve impact

## Step 5 — Write the Memo

```
# BoP / External Sector Brief — [DATE]

ALERT: [GREEN/YELLOW/ORANGE/RED]
BoP Stress Score: [X]/100 | FX Fragility: [X]/100

## Bottom Line
[1-2 sentences: what the BoP position means for IDR and sovereign stability]

## Trade Account
- Balance: [X] bn USD ([direction] [%] MoM)
- Exports: [X] bn | Imports: [X] bn
- Import growth YoY: [X]%
- Key commodity moves: [coal/CPO/nickel/oil]

## Current Account
- Latest estimate: [X]% GDP ([year], IMF)
- Trend: [improving/deteriorating]

## FX Reserves
- Level: [X] bn USD
- Monthly change: [X] bn
- Import cover: [X] months (threshold: 3 months IMF minimum)
- Synthetic CAD: [Yes/No — explanation]

## Risk Flags
[Engine flags + commodity risk]

## Stress Scenarios
| Scenario | CA Impact | Reserve Impact | IDR Pressure |
|----------|-----------|----------------|--------------|
| Base | ... | ... | ... |
| Oil shock | ... | ... | ... |
| Capital flight | ... | ... | ... |
```

## Rules

- IMF CA data is 1-2Q stale — flag this clearly
- Trade data is most current (BPS monthly, ~5wk lag)
- Synthetic CAD is the most underappreciated risk — always check
- Reserve adequacy benchmark: 3 months imports (IMF), 100% of short-term external debt (Greenspan-Guidotti)
- Never confuse trade surplus with BoP health — capital account matters
