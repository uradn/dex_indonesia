---
name: macro-positioning
description: >
  Indonesia macro regime classification + market timing + positioning decision rules.
  Synthesizes all 13 modules into: 6-regime label, Timing, Resolved check, and
  explicit IF-THEN positioning signal. Invoke when user asks about market stance,
  positioning, "should I buy/sell/hold IDR or IHSG", or regime classification.
---

# Macro Positioning Skill

Synthesizes Dexter's 13-module system into an actionable positioning output.

## Step 1 — Gather inputs (run in parallel)

Always call all four tools fresh — do not rely on context from prior turns:
- `silent_crisis_detector` — SCD score, stressed module count, weighted composite
- `regime_engine` — current quadrant (Q1/Q2/Q3/Q4), regime label
- `market_stress_engine` — stressScore, timing (oversold/neutral/overheated), P/E, A/D
- `foreign_flow_engine` — EIDO MoM %, SBN ownership direction, IDX net flow, silentExitProbability

**Derive CapitalFlow status from `foreign_flow_engine` output:**
- `Deteriorating` — EIDO MoM < −2% OR SBN ownership falling OR IDX net sell < −2,000 IDR bn AND silentExitProbability > 40%
- `Improving` — EIDO MoM > +2% AND SBN ownership stable/rising AND IDX net sell > −500 IDR bn
- `Stable` — everything else

## Step 2 — Compute Timing

Use `market_stress_engine.timing` directly:
- `OVERSOLD` — P/E cheap + selling pressure, or panic breadth (A/D < 0.5)
- `OVERHEATED` — P/E elevated (>22x composite-equiv) + breadth still positive
- `NEUTRAL` — everything else

## Step 3 — Resolved Check

Answer: **"Are the underlying issues improving?"**

Assess 5 dimensions using latest module outputs:
1. **Fiscal credibility** — M10 Fiscal: is S&P ratio trending down? Deficit trajectory improving?
2. **Capital flow stabilization** — M5 Foreign Flow: EIDO recovering? SBN ownership floor holding? IDX net sell slowing?
3. **External balance** — M1 BoP + M4 Commodity: trade surplus holding? Brent below ICP threshold?
4. **Monetary pressure easing** — M2 Sovereign: CDS velocity slowing? Term premium below 2%? BI Rate cycle peaking?
5. **Investor confidence** — M5 SSVI phase: WATCH → stabilizing? MSCI review outcome positive?

Output: `Resolved = Yes | Partial | No`
- `Yes` — 4-5 dimensions improving, SCD trending down
- `Partial` — 2-3 dimensions improving, others mixed or stagnant
- `No` — 0-1 dimensions improving, SCD flat or rising with ORANGE/RED modules

## Step 4 — 6-Regime Classification

Map quadrant + SCD + Timing → one of 6 regimes:

| Regime | Conditions | Implication |
|--------|-----------|-------------|
| **DoomLoopWatch** | SCD ≥ 50 AND stressed_modules ≥ 3 (any quadrant) | Non-linear deterioration; ×1.2 amplifier active; monitor daily — **highest priority, overrides all below** |
| **ConsensusBear** | Q3/Q4 + SCD ≥ 33 + Timing = Oversold (and DoomLoop not triggered) | Consensus already short/bearish; short squeeze risk; do NOT chase shorts |
| **Stress** | Q3 (Growth↓ Inflation↑) + SCD 33-69 + Timing ≠ Oversold | IDR under pressure; SBN foreign exit risk; defensive stance |
| **LateCycle** | Q2 (Growth↑ Inflation↑) + SCD 33-49 + Timing = Overheated | BI hike risk; reduce duration; commodities outperform |
| **WatchMode** | Any quadrant + SCD 33-49 (not Q3/not Overheated — doesn't fit above) | Deterioration emerging but not acute; tighten stops, reduce new exposure |
| **Recovery** | Q1/Q2 + SCD < 33 + Timing = Oversold | Early recovery post-selloff; asymmetric upside if Resolved improving |
| **RiskOn** | Q1 + SCD < 33 + Timing ≠ Overheated (default Green state) | Favorable entry; IDR stable; SBN carry attractive |

**Priority order (top wins):** DoomLoopWatch → ConsensusBear → Stress → LateCycle → WatchMode → Recovery → RiskOn

## Step 5 — Decision Rules (IF-THEN)

Apply in order — first matching rule wins:

```
IF SCD ≥ 50 AND stressed_modules ≥ 5
→ AMPLIFIED RISK: non-linear deterioration. ×1.4 multiplier active.
  Stance: Maximum defensive. No new IDR/SBN exposure.

IF CapitalFlow (M5) = Deteriorating AND Resolved = No
→ ESCALATE: foreign exit without fundamental improvement = structural, not tactical.
  Stance: Reduce IDR exposure. Avoid SBN duration.

IF DoomLoopWatch AND Timing = Overheated
→ DEFENSIVE: expensive market + systemic stress = asymmetric downside.
  Stance: Sell IDR rallies. No IHSG accumulation.

IF DoomLoopWatch AND Timing = Oversold
→ CONSENSUS BEAR: market oversold in stressed macro = short squeeze risk.
  Stance: Do not initiate new shorts. Tactically neutral. Wait for Resolved signal.

IF CapitalFlow stabilizing AND Resolved = Partial AND Timing = Oversold
→ EARLY RECOVERY WATCH: potential inflection. Not confirmed yet.
  Stance: Small tactical long IHSG. Tight stop. Watch M5 SSVI for confirmation.

IF CapitalFlow improving AND Resolved = Yes AND SCD < 33
→ RECOVERY CONFIRMED: fundamentals and flows aligned.
  Stance: Add IDR/SBN exposure. Accumulate IHSG on dips.

IF SCD < 33 AND Regime = RiskOn AND Timing = Neutral
→ BASELINE LONG: no active stress. Normal macro environment.
  Stance: Hold existing positions. No defensive action needed.
```

## Step 6 — Output Format

```
## Macro Positioning — [DATE]

### Regime
Quadrant: [Q1/Q2/Q3/Q4] — [label]
**Regime Classification: [RiskOn | Recovery | LateCycle | Stress | DoomLoopWatch | ConsensusBear]**

### Key Metrics
| Metric | Value | Signal |
|--------|-------|--------|
| SCD Score | [x]% | [GREEN/YELLOW/ORANGE/RED] |
| Stressed Modules | [n]/13 | [Normal/Watch/Stress/High] |
| Market Timing | [OVERSOLD/NEUTRAL/OVERHEATED] | — |
| Resolved Check | [Yes/Partial/No] | — |

### Resolved — 5-Dimension Assessment
1. Fiscal credibility: [Improving/Stable/Deteriorating] — [1-line rationale]
2. Capital flow: [Improving/Stable/Deteriorating] — [1-line rationale]
3. External balance: [Improving/Stable/Deteriorating] — [1-line rationale]
4. Monetary pressure: [Improving/Stable/Deteriorating] — [1-line rationale]
5. Investor confidence: [Improving/Stable/Deteriorating] — [1-line rationale]

### Decision Rule Triggered
> [Rule text from Step 5]

### Positioning Signal
**Stance: [Maximum defensive | Defensive | Neutral | Early Recovery Watch | Recovery | Baseline Long]**

| Asset | Signal | Rationale |
|-------|--------|-----------|
| IDR (USDIDR) | [Buy/Hold/Sell/Reduce] | [1-line] |
| SBN 10Y | [Buy/Hold/Sell/Reduce] | [1-line] |
| IHSG equity | [Accumulate/Hold/Reduce/Avoid] | [1-line] |

### Core Question
> "If foreign outflows continue, are the underlying issues improving or unresolved?"
> **Answer: [direct 1-2 sentence answer]**
```

## Invocation phrases

User says: "apa stance sekarang?", "posisi apa yang benar sekarang?", "buy or sell IDR?", "IHSG accumulate or reduce?", "what's the macro regime?", "apakah ini recovery atau doom loop?", "consensus bear kah sekarang?", "should I be defensive?", "macro positioning check"
