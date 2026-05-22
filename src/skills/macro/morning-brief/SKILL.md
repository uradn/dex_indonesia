---
name: asean-morning-brief
description: ASEAN sovereign stress morning brief for Indonesia. Run all macro modules in parallel, aggregate scores, and produce hedge-fund style daily briefing. Use at market open or when asked for "morning brief", "daily macro", "Indonesia macro update".
---

# ASEAN Macro Morning Brief — Indonesia

Produce an institutional-grade daily macro briefing. Tone: concise, probabilistic, signal-focused. No hype, no narrative bias.

## Execution Order

Run all these tools in parallel (they are concurrencySafe):

1. `fx_defense_engine` — IDR stress, reserves, intervention
2. `bop_engine` — trade balance, CA, import growth
3. `sovereign_risk_engine` — CDS, SBN yield, foreign ownership
4. `commodity_engine` — export cushion, oil import risk
5. `foreign_flow_engine` — silent exit detection
6. `regime_engine` — macro regime classification
7. `asean_relative_value_engine` — IDR vs peers, DXY decomposition
8. `narrative_divergence_engine` — official vs market credibility

After all return, call:
9. `silent_crisis_detector` — unified Silent Crisis Probability

## Brief Format

```
# Indonesia Macro Morning Brief — [DATE]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SILENT CRISIS PROBABILITY: [X]%
OVERALL ALERT: [GREEN/YELLOW/ORANGE/RED]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## Macro Regime
[Regime + shift probability — 1 line]

## Module Scorecard
| Module | Score | Alert |
|--------|-------|-------|
[fill from all engines]

## FX Defense
[2-3 lines: USDIDR, vol, reserves, intervention proxy]

## Sovereign Risk
[2-3 lines: CDS, SBN yield, foreign SBN ownership]

## BoP / External
[2-3 lines: trade balance, reserves, synthetic CAD flag]

## Commodity Cushion
[2-3 lines: top commodity moves, oil vulnerability]

## Foreign Flows
[2 lines: EIDO, SBN ownership, silent exit probability]

## ASEAN Context
[2 lines: IDR vs peers, DXY story or ID-specific]

## Narrative Credibility
[2 lines: official vs market divergence score]

## Active Flags
[All RED/ORANGE flags from all modules — sorted by severity]

## Bottom Line
[3-4 sentences: what market is pricing, what it means for IDR and sovereigns, key risk to watch]
```

## Rules

- Lead with the bottom line — what changed from yesterday
- Rate of change > absolute level
- Never say "stable" without checking if reserves are depleting
- If Silent Crisis Probability > 50%, flag explicitly at top
- Cross-confirmed signals (multiple modules same direction) = highest conviction
- Always note data lag for each source
