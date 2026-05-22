---
name: fx-defense-analysis
description: Deep FX defense analysis for Indonesia. Use when asked about IDR stress, BI intervention, reserve sustainability, USDIDR trajectory, or pseudo-stability detection. Produces hedge-fund style FX stress memo.
---

# FX Defense Analysis — Indonesia

You are producing an institutional-grade FX stress assessment. Tone: concise, probabilistic, signal-focused. No narrative bias.

## Step 1 — Run the Engine

Call `fx_defense_engine` with the user's query. This fetches:
- USDIDR spot and 365-day history (Yahoo Finance)
- 30-day realized volatility (computed)
- FX reserves (BI website / Bloomberg if configured)
- SRBI outstanding (BI — proxy for sterilization pressure)

## Step 2 — Cross-Market Confirmation

After the engine returns, call `get_asean_data` to get:
- ASEAN FX comparison: MYR, SGD, THB, PHP vs USD today
- This distinguishes global USD strength vs Indonesia-specific IDR weakness

Call `web_search` for:
- Latest BI rate decision and forward guidance
- Any recent BI intervention announcements
- Capital flow headlines (foreign SBN, equity outflows)

## Step 3 — Narrative Divergence Check

Compare:
- BI official statements vs what FX market is pricing
- APBN assumptions for USDIDR vs spot rate
- If BI says "rupiah fundamentals strong" but reserves falling → flag credibility gap

## Step 4 — Write the Memo

Format output as an institutional FX stress memo:

```
# IDR / FX Defense Brief — [DATE]

ALERT: [GREEN/YELLOW/ORANGE/RED] | Score: [X]/100

## Headline

[1-2 sentence bottom line: what market is pricing, what it means]

## FX Metrics
- USDIDR spot: [X,XXX]
- 3M depreciation: [X]%
- 30d realized vol: [X]% annualized
- Reserve level: [X] bn USD ([change] MoM)
- Reserve runway: [X] months
- BI intervention proxy: [active_sterilized / active_direct / passive]

## Cross-Market Check
[ASEAN FX comparison — is IDR underperforming peers?]

## Flags
[Any anomalies from engine]

## Signal vs Narrative
[Divergence between BI guidance and market pricing]

## Positioning Implication
[What a macro hedge fund would watch next]
```

## Rules

- Rate of change > absolute level. Acceleration matters more than the number.
- If IDR is stable but reserves are falling → call out pseudo-stability explicitly
- If ASEAN FX all weak → it's a DXY story, not Indonesia-specific
- Never dismiss stress signals because of political reassurances
- Always cite data source and lag for each indicator
